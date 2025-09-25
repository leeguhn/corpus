import argparse
import logging
import os
import random
from collections import deque
import difflib
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List

from generate_corpus import load_api_generator, tokenize_words, build_ngrams, save_ngrams, ensure_dir_for_file
from constants import SYSTEM_PROMPT, topics, roles
from generate_corpus import remove_internal_thoughts, simple_clean

# reuse the shared filter implementation in-place to avoid importing snippets.py
def filter_and_normalize_sentence(sentence: str, prev_sentences: list[str]) -> str | None:
    import re
    import difflib
    if not sentence:
        return None
    s = sentence.strip()
    s = re.sub(r"<\|/?[a-zA-Z0-9_\-]+\|>", "", s)
    s = s.replace('*', '')
    s = re.sub(r"\s+", ' ', s).strip()
    low = s.lower()
    instruction_patterns = [
        r"\bdo not\b",
        r"\bdon't\b",
        r"compose an essay",
        r"previous output was cut off",
    ]
    for pat in instruction_patterns:
        if re.search(pat, low):
            return None
    if re.match(r"^(compose|write|please|provide|generate)\b", low):
        return None
    s = re.sub(r"previous output was cut off\.?", "", s, flags=re.I)
    s = re.sub(r",\s*[\.\!\?]", '.', s)
    s = re.sub(r"\s+([,;:\.\!\?])", r"\1", s)
    s = re.sub(r"([\?\!\.]){2,}", r"\1", s)
    s = re.sub(r"However,\.", "However.", s)
    for prev in prev_sentences[-8:]:
        if not prev:
            continue
        if s == prev:
            return None
        ratio = difflib.SequenceMatcher(None, s, prev).ratio()
        if ratio > 0.9:
            return None
    if len(s.split()) < 2:
        return None
    s = re.sub(r"\s+", ' ', s).strip()
    return s

# Simple logger
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


def compact_sentence(s: str) -> str:
    """Remove repeated trailing clauses and extra dashes from a sentence.

    Heuristic: if the last N-word clause repeats earlier in the sentence, drop the trailing repeat.
    Also remove sequences of multiple hyphens and trim surrounding spaces.
    """
    import re
    if not s:
        return s
    # normalize dashes
    s = s.replace('—', '-').replace('–', '-')
    s = re.sub(r"-{2,}", '-', s)
    s = re.sub(r"\s+-\s+", ' ', s)
    s = re.sub(r"\s+", ' ', s).strip()

    # split into clauses by commas or semicolons; check if last clause repeats earlier
    parts = re.split(r"[;,]\s*", s)
    if len(parts) > 1:
        last = parts[-1].strip()
        for earlier in parts[:-1]:
            e = earlier.strip()
            if not e or not last:
                continue
            # if last clause is contained or very similar to an earlier clause, drop it
            if last.lower() in e.lower() or difflib.SequenceMatcher(None, last, e).ratio() > 0.9:
                parts = parts[:-1]
                break
        s = ', '.join(p.strip() for p in parts if p.strip())
        # ensure terminal punctuation
        if s and s[-1] not in '.!?':
            s = s + '.'
    return s


def create_snippet_prompt(topic: str, role1: str, role2: str | None = None) -> str:
    role_text = role1 if not role2 else f"{role1} and {role2}"
    base = f"Ramble about {topic} as if you are {role_text}."
    system = SYSTEM_PROMPT.format(role=role_text)
    # Ask for a self-contained snippet of 5-10 sentences
    # Add explicit anti-repetition instructions to reduce looping/repeats
    anti_repeat = (
        "Do not repeat yourself. Avoid verbatim or near-verbatim repetition within the snippet or across outputs. "
        "If you would naturally repeat, instead rephrase or stop. Output only a single self-contained snippet of 5 to 10 sentences."
    )
    return system + "\n\n" + base + "\n\n" + anti_repeat


def generate_snippet_worker(generate_func, max_tokens: int, seed: int | None = None) -> str:
    # use a thread-local RNG to avoid reseeding the global random
    r = random.Random(seed)
    topic = r.choice(topics)
    role1 = r.choice(roles)
    role2 = None
    if r.random() < 0.5:
        role2 = r.choice([r2 for r2 in roles if r2 != role1])

    # add a short nonce to the prompt to reduce identical cached responses
    import time, hashlib
    nonce = hashlib.sha1(f"{time.time_ns()}_{seed}".encode()).hexdigest()[:8]
    prompt = create_snippet_prompt(topic, role1, role2) + f"\n\n# uid: {nonce}"

    # simple retry/backoff for transient failures
    backoff = 0.5
    for attempt in range(3):
        try:
            out = generate_func(prompt, max_new_tokens=max_tokens)
            return out
        except Exception as e:
            logging.warning('Generation attempt %d failed: %s', attempt + 1, e)
            time.sleep(backoff)
            backoff *= 2
    logging.error('All generation attempts failed for prompt uid %s', nonce)
    return ''


def clean_and_split_snippet(text: str, recent_history: deque[str]) -> List[str]:
    # Basic normalization and split into sentences on terminal punctuation
    import re
    t = text.replace('\n', ' ')
    t = re.sub(r"<\|/?[a-zA-Z0-9_\-]+\|>", "", t)
    t = t.replace('*', '')
    # Remove explicit uid markers like '# uid: abc...' and common UUID/GUID patterns
    t = re.sub(r"#\s*uid:\s*[^\s]+", "", t, flags=re.I)
    # Remove standard UUIDs (8-4-4-4-12) and loose variants that may include spaces or dots
    t = re.sub(r"[\s-]*[0-9a-fA-F]{8}(?:[-\s\._]?[0-9a-fA-F]{4}){3}[-\s\._]?[0-9a-fA-F]{12}[\s-]*", " ", t)
    # Remove hyphen-leading hex-like fragments (e.g. '-3c2e-4b3a-82f5-9d12adbbcd12' or '-e47b-4962-...')
    # This targets sequences that start with a hyphen followed by hex groups and avoids removing normal hyphenated words.
    t = re.sub(r"(?<!\w)-[0-9a-fA-F]{3,}(?:-[0-9a-fA-F]{2,})+", " ", t)
    # normalize dashes: em/en -> simple hyphen, then remove spaced hyphens used like separators
    t = t.replace('—', '-').replace('–', '-')
    # remove repeated sequences of ' - ' or ' -- '
    t = re.sub(r"\s+-\s+", ' ', t)
    t = re.sub(r"\s+", ' ', t).strip()
    # Split on sentence enders but keep the punctuation
    parts = re.split(r'(?<=[\.\!\?])\s+', t)
    cleaned = []
    prevs: List[str] = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # Ensure ends with punctuation
        if p[-1] not in '.!?':
            p = p.rstrip() + '.'
        f = filter_and_normalize_sentence(p, prevs)
        if f:
            # Reject if too similar to any recent sentence in global history
            too_similar = False
            for hist in recent_history:
                # quick length check skip
                if abs(len(hist) - len(f)) > max(40, len(f) * 0.5):
                    continue
                ratio = difflib.SequenceMatcher(None, f, hist).ratio()
                if ratio > 0.92:
                    too_similar = True
                    break
            if not too_similar:
                cleaned.append(f)
                prevs.append(f)
            else:
                # drop near-duplicate sentence
                continue
    # Additional intra-snippet deduplication: remove sentences that are near-duplicates of earlier ones
    final: List[str] = []
    for s in cleaned:
        dup = False
        for earlier in final[-12:]:
            if abs(len(earlier) - len(s)) > max(40, len(s) * 0.5):
                continue
            if difflib.SequenceMatcher(None, s, earlier).ratio() > 0.92:
                dup = True
                break
        if not dup:
            final.append(s)
    return final


def main():
    parser = argparse.ArgumentParser(description='Parallel snippet pipeline')
    parser.add_argument('--target-words', type=int, default=10000, help='Approx words to generate')
    parser.add_argument('--data-dir', type=str, default='data', help='Base data directory for runs')
    parser.add_argument('--workers', type=int, default=6, help='Number of concurrent workers')
    parser.add_argument('--max-tokens', type=int, default=200, help='Max tokens per snippet request')
    parser.add_argument('--api-url', type=str, default='http://127.0.0.1:1234/v1/completions')
    parser.add_argument('--api-model', type=str, default='google/gemma-3-12b')
    args = parser.parse_args()

    run_ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    run_dir = os.path.join(args.data_dir, run_ts)
    os.makedirs(run_dir, exist_ok=True)
    raw_out = os.path.join(run_dir, 'raw.txt')
    ngram_prefix = os.path.join(run_dir, 'ngrams')

    # persist a short prompt note
    with open(os.path.join(run_dir, 'prompt.txt'), 'w', encoding='utf-8') as pf:
        pf.write('Parallel snippet pipeline using system prompt from snippets.py\n')

    generate = load_api_generator(args.api_url, args.api_model, temperature=0.7, top_p=0.9, top_k=50)

    words_written = 0
    snippets = 0
    recent_history: deque[str] = deque(maxlen=2000)
    # Use ThreadPool to perform many snippet requests concurrently
    with open(raw_out, 'w', encoding='utf-8') as wf:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            # Submit initial batch
            futures = {ex.submit(generate_snippet_worker, generate, args.max_tokens, random.randint(0, 1_000_000)): i for i in range(args.workers)}
            seen_hashes: set[str] = set()
            try:
                while words_written < args.target_words and futures:
                    # iterate over completed futures as they finish
                    for fut in as_completed(list(futures.keys())):
                        try:
                            text = fut.result()
                        except Exception as e:
                            logging.exception('Future result error: %s', e)
                            text = ''

                        # Skip empty text
                        if not text:
                            sentences = []
                        else:
                            # Deduplicate entire snippet text by hash to avoid writing duplicate whole snippets
                            import hashlib
                            h = hashlib.sha1(text.encode('utf-8')).hexdigest()
                            if h in seen_hashes:
                                logging.info('Skipping duplicate snippet hash %s', h[:8])
                                sentences = []
                            else:
                                seen_hashes.add(h)
                                sentences = clean_and_split_snippet(text, recent_history)
                        for s in sentences:
                            # compact sentence: remove repeated trailing clauses and multiple dashes
                            s_clean = compact_sentence(s)
                            wf.write(s_clean + ' ')
                            wf.flush()
                            nw = len(tokenize_words(s_clean))
                            words_written += nw
                            # track sentence in recent history to prevent repeats across snippets
                            recent_history.append(s_clean)
                            if words_written >= args.target_words:
                                break
                        snippets += 1
                        if snippets % 50 == 0:
                            logging.info('%d snippets, %d words', snippets, words_written)

                        # remove completed future and schedule a new one
                        futures.pop(fut, None)
                        if words_written >= args.target_words:
                            break
                        # submit replacement if we still need more
                        newf = ex.submit(generate_snippet_worker, generate, args.max_tokens, random.randint(0, 1_000_000))
                        futures[newf] = 1
                    # loop continues until target reached
            finally:
                # wait for any in-flight workers to finish cleanly
                ex.shutdown(wait=True)

    logging.info('Generation done: %d snippets, approx %d words', snippets, words_written)

    # Post-process ngrams
    with open(raw_out, 'r', encoding='utf-8') as rf:
        all_text = rf.read()
    tokens = tokenize_words(all_text)
    logging.info('Token count: %d', len(tokens))
    bigrams, trigrams = build_ngrams(tokens)
    ensure_dir_for_file(ngram_prefix + '_bigram.csv')
    save_ngrams(bigrams, ngram_prefix, 'bigram')
    save_ngrams(trigrams, ngram_prefix, 'trigram')

    print('Outputs saved to', run_dir)


if __name__ == '__main__':
    main()
