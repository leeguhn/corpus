"""
generate_corpus.py

Generate ~1M words of text locally from a model, clean, tokenize,
and build bigram/trigram frequency tables.

Usage examples:
python src/generate_corpus.py --model-path ./local-model --api-url "" --target-words 1000000 \
    --chunk-words 2000 --output-raw data/raw.txt --output-ngrams data/ngrams

The script supports local Hugging Face compatible models (path or model id),
and writes raw text incrementally to avoid large memory use. It then cleans
the text, tokenizes by words, builds bigram and trigram frequency tables,
and saves them as compressed CSV and pickle files.

Requires: Python 3.10+, pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Iterable, List, Tuple
from datetime import datetime

try:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, GenerationConfig
except ImportError:
    torch = None
    AutoModelForCausalLM = None
    AutoTokenizer = None
    GenerationConfig = None

# Attempt to import tqdm; provide a fallback if unavailable
try:
    from tqdm import tqdm
except Exception:
    class tqdm:
        def __init__(self, total=None, desc=None):
            self.total = total
            self.desc = desc
            self.current = 0
        def update(self, n=1):
            self.current += n
            if self.total:
                pct = (self.current / self.total) * 100
                print(f"{self.desc or ''}: {self.current}/{self.total} ({pct:.1f}%)", end='\r')
        def close(self):
            print()

# Attempt to import requests; provide a urllib fallback
try:
    import requests
    _HAS_REQUESTS = True
except Exception:
    import json
    import urllib.request
    _HAS_REQUESTS = False
    def requests_post_fallback(url, json_payload, headers, timeout=120):
        data = json.dumps(json_payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={**headers, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return type('R', (), {'status_code': resp.getcode(), 'text': resp.read().decode('utf-8'), 'json': lambda: json.loads(resp.read().decode('utf-8'))})



@dataclass
class Config:
    model_path: str
    target_words: int = 1_000_000
    chunk_words: int = 2000
    temperature: float = 0.7
    top_p: float = 0.9
    top_k: int = 50
    device: int = -1  # -1 CPU, >=0 CUDA device
    output_raw: str = "data/raw.txt"
    output_ngrams: str = "data/ngrams"
    api_url: str = "http://127.0.0.1:1234/v1/completions"
    api_model: str = "gpt-oss-20b"
    prompt: str = ""
    prompt_file: str | None = None
    prompt_preset: str | None = None
    lowercase_raw: bool = False
    data_dir: str = "data"


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


def ensure_dir_for_file(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)


def load_generator(model_path: str, device: int, temperature: float, top_p: float, top_k: int):
    if AutoModelForCausalLM is None or AutoTokenizer is None or GenerationConfig is None or torch is None:
        raise RuntimeError("transformers/torch not available. Install requirements.txt")

    logging.info('Loading tokenizer and model from %s', model_path)
    tokenizer = AutoTokenizer.from_pretrained(model_path, use_fast=True)
    model = AutoModelForCausalLM.from_pretrained(model_path)

    if device >= 0 and torch and torch.cuda.is_available():
        model.to(torch.device(f'cuda:{device}'))
        device_str = f'cuda:{device}'
    else:
        device_str = 'cpu'

    gen_config = GenerationConfig(
        temperature=temperature,
        top_p=top_p,
        top_k=top_k,
        do_sample=True,
    )

    def generate(prompt: str, max_new_tokens: int) -> str:
        inputs = tokenizer(prompt, return_tensors="pt")
        if device_str != 'cpu':
            inputs = {k: v.to(device_str) for k, v in inputs.items()}
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=max_new_tokens, generation_config=gen_config)
        text = tokenizer.decode(out[0], skip_special_tokens=True)
        # Remove the prompt prefix (keep only generated continuation)
        if text.startswith(prompt):
            return text[len(prompt):]
        return text

    return generate
    
def load_api_generator(api_url: str, api_model: str, temperature: float, top_p: float, top_k: int):
    """
    Create a generator that calls LM Studio HTTP API.
    """
    headers = {'Content-Type': 'application/json'}
    def generate(prompt: str, max_new_tokens: int) -> str:
        import json as _json
        payload = {
            "model": api_model,
            "prompt": prompt,
            "max_tokens": max_new_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "stream": False,
        }
        try:
            if _HAS_REQUESTS:
                resp = requests.post(api_url, json=payload, headers=headers, timeout=120)
                resp.raise_for_status()
                data = resp.json()
            else:
                # Use urllib fallback
                import urllib.request as _urllib
                data_bytes = _json.dumps(payload).encode('utf-8')
                req = _urllib.Request(api_url, data=data_bytes, headers=headers)
                with _urllib.urlopen(req, timeout=120) as r:
                    resp_text = r.read().decode('utf-8')
                data = _json.loads(resp_text)
        except Exception as e:
            logging.exception('API request failed: %s', e)
            return ''

        # Robust parsing for multiple LM response formats (choices, response, output, message, result)
        text = ''
        if isinstance(data, dict):
            choices = data.get('choices') or data.get('response') or []
            if isinstance(choices, list):
                for c in choices:
                    if isinstance(c, dict):
                        if c.get('text'):
                            text += c.get('text', '')
                        elif isinstance(c.get('message'), dict) and c['message'].get('content'):
                            content = c['message']['content']
                            if isinstance(content, dict) and content.get('text'):
                                text += content.get('text', '')
                            elif isinstance(content, str):
                                text += content
                        elif isinstance(c.get('output'), list):
                            for o in c.get('output', []):
                                if isinstance(o, dict) and o.get('content'):
                                    cont = o.get('content')
                                    if isinstance(cont, list):
                                        for item in cont:
                                            if isinstance(item, dict) and item.get('text'):
                                                text += item.get('text', '')
                                    elif isinstance(cont, str):
                                        text += cont
            # Some variants: { output: [ { content: '...' } ] }
            if not text and isinstance(data.get('output'), list):
                for o in data.get('output', []):
                    if isinstance(o, dict):
                        cont = o.get('content')
                        if isinstance(cont, str):
                            text += cont
                        elif isinstance(cont, list):
                            for item in cont:
                                if isinstance(item, dict) and item.get('text'):
                                    text += item.get('text', '')
            # fallback to a simple string field
            if not text and isinstance(data.get('result'), str):
                text = data.get('result')

        if not text:
            # fallback to common direct text field
            if isinstance(data, dict) and data.get('text'):
                text = data.get('text')
            else:
                try:
                    text = _json.dumps(data)
                except Exception:
                    text = str(data)

        # Preserve existing marker trimming behavior if present
        marker = "<|end|><|start|>assistant<|channel|>final<|message|>"
        if marker in text:
            text = text.split(marker, 1)[1]

        # Remove any analysis/chain-of-thought blocks that models may include
        def _strip_analysis_sections(t: str) -> str:
            import re as _re
            if not t:
                return t
            # Remove blocks that start with an analysis channel marker and run until a final/assistant marker
            t = _re.sub(r"<\|channel\|>analysis.*?(?=<\|channel\|>final|<\|channel\|>assistant|\Z)", "", t, flags=_re.S|_re.I)
            # Remove common marker tokens left behind like <|channel|>analysis or other angle-bracket markers
            t = _re.sub(r"<\|/?[a-zA-Z0-9_\-]+\|>", "", t)
            # Normalize extra whitespace
            t = _re.sub(r"\s+", " ", t).strip()
            return t

        text = _strip_analysis_sections(text)

        return text
    return generate


def simple_clean(text: str) -> str:
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Remove markdown code fences and inline code
    text = re.sub(r"```.+?```", " ", text, flags=re.S)
    text = re.sub(r"`[^`]+`", " ", text)
    # Remove URLs
    text = re.sub(r"https?://\S+", " ", text)
    # Replace non-printable/control chars with space
    text = re.sub(r"[\x00-\x1F\x7F]+", " ", text)
    # Normalize whitespace
    text = re.sub(r"\s+", " ", text)
    text = text.strip()
    return text


def remove_internal_thoughts(text: str) -> str:
    """
    Remove common chain-of-thought, internal monologue, or model-meta sentences.
    Strategy:
    - Remove bracketed or parenthetical internal notes like [thinking], (thinking), {note}
    - Split into sentences and drop any sentence containing indicator phrases that signal
      explanation, reasoning, or model limitations (e.g. "as an AI", "let me think").
    - Return the remaining text joined with spaces.
    """
    if not text:
        return text
    # remove obvious bracketed comments
    text = re.sub(r"\[.*?\]", " ", text)
    text = re.sub(r"\(.*?\)", " ", text)
    text = re.sub(r"\{.*?\}", " ", text)
    # split into sentences (simple heuristic)
    parts = re.split(r'(?<=[\.\!\?])\s+', text)
    indicators = [
        "as an ai",
        "as a language model",
        "i'm an ai",
        "i am an ai",
        "i don't have access",
        "i do not have access",
        "i cannot browse",
        "i can't browse",
        "i can't access",
        "i cannot",
        "i don't",
        "let me think",
        "my thought",
        "thinking",
        "chain of thought",
        "chain-of-thought",
        "analysis",
        "to answer that",
        "here's my thought",
        "i will try to",
        "i will attempt",
        "i should",
        "i need to",
        "i'm going to",
        "in summary",
    ]
    out_parts = []
    for s in parts:
        s_clean = s.strip()
        if not s_clean:
            continue
        low = s_clean.lower()
        skip = False
        for ind in indicators:
            if ind in low:
                skip = True
                break
        if not skip:
            out_parts.append(s_clean)
    # join remaining parts into a single continuous string
    return " ".join(out_parts).strip()


def tokenize_words(text: str) -> List[str]:
    # Lowercase and split on word boundaries, keep contractions as single tokens
    text = text.lower()
    # Replace fancy punctuation with ASCII equivalents
    text = text.replace("–", "-").replace("—", "-").replace("’", "'")
    # Keep letters, numbers, and apostrophes inside words
    tokens = re.findall(r"[a-zA-Z0-9']+", text)
    return tokens


def build_ngrams(tokens: Iterable[str]) -> Tuple[Counter, Counter]:
    tokens = list(tokens)
    bigrams = Counter()
    trigrams = Counter()
    for i in range(len(tokens) - 1):
        bigrams[(tokens[i], tokens[i + 1])] += 1
    for i in range(len(tokens) - 2):
        trigrams[(tokens[i], tokens[i + 1], tokens[i + 2])] += 1
    return bigrams, trigrams


def save_ngrams(counter: Counter, path_prefix: str, name: str) -> None:
    # Save as CSV and pickle without pandas
    rows = []
    for k, v in counter.items():
        if isinstance(k, tuple):
            key = ' '.join(k)
        else:
            key = str(k)
        rows.append((key, v))

    # Sort rows by count descending
    rows.sort(key=lambda x: x[1], reverse=True)

    # Save as CSV (gz compression optional via gzip)
    csv_path = f"{path_prefix}_{name}.csv.gz"
    try:
        import gzip
        with gzip.open(csv_path, 'wt', encoding='utf-8') as csv_file:
            csv_file.write(f"{name},count\n")
            for key, count in rows:
                # Escape commas in keys
                safe_key = key.replace('\n', ' ').replace('\r', ' ').replace(',', ' ')
                csv_file.write(f"{safe_key},{count}\n")
    except Exception:
        # Fallback to plain CSV if gzip not available
        csv_path = f"{path_prefix}_{name}.csv"
        with open(csv_path, 'w', encoding='utf-8') as csv_file:
            csv_file.write(f"{name},count\n")
            for key, count in rows:
                safe_key = key.replace('\n', ' ').replace('\r', ' ').replace(',', ' ')
                csv_file.write(f"{safe_key},{count}\n")

    # Save as pickle
    pkl_path = f"{path_prefix}_{name}.pkl"
    with open(pkl_path, 'wb') as pkl_file:
        import pickle
        pickle.dump(rows, pkl_file)

    logging.info('Saved %s rows to %s and %s', len(rows), csv_path, pkl_path)


# Built-in prompt presets
PROMPT_PRESETS = {
    "daily_conversation": (
        "You are a human speaking or texting in everyday life. Your task is to write continuous sequences of casual, everyday conversational English about daily life. Follow these rules strictly:\n\n"
        "1. **No meta-commentary**: Do not talk about the prompt, yourself as a model, or the generation process.  \n"
        "2. **No speaker labels**: Do not use \"Person A:\", \"I said:\", names, or any identifiers. Just sentences in natural flow.  \n"
        "3. **Natural style**: Use concise, casual, spoken-style sentences. Include occasional filler words or interjections like \"like\", \"you know\", \"uh\".  \n"
        "4. **Role variety**: Occasionally vary the “speaker” style to reflect different levels of English:\n"
        "   - Teenager: simpler, slangy, casual words.  \n"
        "   - Middle-class adult: everyday conversational style, moderate complexity.  \n"
        "   - Academic researcher: slightly more formal, precise vocabulary, longer sentences.  \n"
        "   Switch roles occasionally in the text to ensure variety, but do not label the switch.  \n"
        "5. **Topic variety**: Focus on topics of daily life (waking up, breakfast, commute, work, lunch, errands, hobbies, dinner, relaxing, social interactions, small talk). Each snippet can change topic; do not attempt to maintain continuity across snippets.  \n"
        "6. **Paragraphs**: Write as a single continuous paragraph (or snippet) of 5–10 lines of text. Treat each snippet as self-contained.  \n"
        "7. **Punctuation**: Avoid using em dashes. Normal punctuation like commas, periods, question marks, and exclamation points are fine.  \n"
        "8. **Conciseness**: Keep sentences flowing naturally, avoid rambling, but simulate real spoken flow.  \n"
        "9. **Chunk generation**: Each snippet should be independent. You may randomly rotate topics and speaker styles.  \n\n"
        "Example snippet style:\n"
        "\"woke up at six, rolled out of bed, brewed coffee, checked messages, ran late for the bus, grabbed a sandwich for lunch, got stuck in traffic, and finally relaxed in the evening watching a show. like, you know, it was just one of those days.\"\n\n"
        "Now generate a single snippet following these rules. Focus on natural conversational English about daily life."
    )
}


def resolve_prompt_text(cfg: Config) -> str:
    # Priority: explicit --prompt > --prompt-file > --prompt-preset > empty
    if cfg.prompt:
        return cfg.prompt
    if cfg.prompt_file:
        try:
            with open(cfg.prompt_file, 'r', encoding='utf-8') as pf:
                return pf.read().strip()
        except Exception as e:
            logging.error('Failed reading prompt file %s: %s', cfg.prompt_file, e)
    if cfg.prompt_preset:
        preset = PROMPT_PRESETS.get(cfg.prompt_preset)
        if not preset:
            logging.warning('Unknown prompt preset %s; continuing with empty prompt', cfg.prompt_preset)
            return ""
        return preset
    return ""


def generate_and_stream(config: Config) -> None:
    ensure_dir_for_file(config.output_raw)
    # Choose generation mode: HTTP API if api_url is set, else local model
    if config.api_url:
        logging.info('Using LM Studio API at %s, model %s', config.api_url, config.api_model)
        generate = load_api_generator(config.api_url, config.api_model,
                                      config.temperature, config.top_p, config.top_k)
        prompt = ""  # LM Studio model uses prompt directly
    else:
        generate = load_generator(config.model_path, config.device,
                                  config.temperature, config.top_p, config.top_k)
        prompt = ""

    words_written = 0
    # Initialize prompt (carry-forward to preserve continuity)
    prompt = config.prompt or ""
    with open(config.output_raw, 'w', encoding='utf-8') as f:
        pbar = tqdm(total=config.target_words, desc='Words generated')
        while words_written < config.target_words:
            remaining = config.target_words - words_written
            chunk = min(config.chunk_words, remaining)
            # Heuristic tokens ~ words; request chunk*1.3 tokens
            max_new_tokens = int(chunk * 1.3)
            try:
                out = generate(prompt, max_new_tokens)
            except Exception as e:  # pragma: no cover - runtime
                logging.exception('Generation error: %s', e)
                break
            # Make output a continuous sequence: remove internal newlines and speaker labels
            out = out.replace('\n', ' ')
            # remove patterns like "Tom: " or "Alice:" at line starts (simple heuristic)
            out = re.sub(r"\b[A-Z][a-z]{1,20}:\s+", ' ', out)
            # remove internal/model ruminations or meta-comments
            out = remove_internal_thoughts(out)
            clean = simple_clean(out)
            if not clean:
                clean = 'the'
            if config.lowercase_raw:
                raw_chunk = clean.lower()
            else:
                raw_chunk = clean
            # Count words conservatively
            nwords = len(tokenize_words(clean))
            # Write with spaces and no extra separators so corpus is a continuous flow
            f.write(raw_chunk + ' ')
            f.flush()
            words_written += nwords
            pbar.update(nwords)
        pbar.close()
    logging.info('Finished generation. Total words approx: %d', words_written)


def process_raw_to_ngrams(raw_path: str, output_prefix: str) -> None:
    logging.info('Processing raw text %s', raw_path)
    with open(raw_path, 'r', encoding='utf-8') as f:
        tokens = []
        for line in f:
            # strip internal/model ruminations before tokenizing
            cleaned = remove_internal_thoughts(line)
            cleaned = simple_clean(cleaned)
            if not cleaned:
                continue
            tokens.extend(tokenize_words(cleaned))

    logging.info('Token count: %d', len(tokens))
    bigrams, trigrams = build_ngrams(tokens)
    ensure_dir_for_file(output_prefix + '_bigrams.csv')
    save_ngrams(bigrams, output_prefix, 'bigram')
    save_ngrams(trigrams, output_prefix, 'trigram')


def parse_args() -> Config:
    p = argparse.ArgumentParser(description='Generate corpus locally and build n-grams')
    p.add_argument('--model-path', type=str, default='', help='Local HF model path or id')
    p.add_argument('--target-words', type=int, default=1_000_000)
    p.add_argument('--chunk-words', type=int, default=2000)
    p.add_argument('--temperature', type=float, default=0.7)
    p.add_argument('--top-p', type=float, default=0.9)
    p.add_argument('--top-k', type=int, default=50)
    p.add_argument('--device', type=int, default=-1, help='CUDA device index or -1 for CPU')
    p.add_argument('--output-raw', type=str, default='data/raw.txt')
    p.add_argument('--output-ngrams', type=str, default='data/ngrams')
    p.add_argument('--api-url', type=str, default='http://127.0.0.1:1234/v1/completions', help='LM Studio API URL')
    p.add_argument('--api-model', type=str, default='gpt-oss-20b', help='LM Studio model identifier')
    p.add_argument('--prompt', type=str, default='', help='Initial prompt or role instruction to seed generation')
    p.add_argument('--prompt-file', type=str, default=None, help='Path to a file containing the full prompt text')
    p.add_argument('--prompt-preset', type=str, default=None, help=f"Name of built-in prompt preset: {list(PROMPT_PRESETS.keys())}")
    p.add_argument('--lowercase-raw', action='store_true', help='Lowercase raw output when writing to raw file')
    p.add_argument('--data-dir', type=str, default='data', help='Base directory to create timestamped run folder')
    args = p.parse_args()
    return Config(
        model_path=args.model_path,
        target_words=args.target_words,
        chunk_words=args.chunk_words,
        temperature=args.temperature,
        top_p=args.top_p,
        top_k=args.top_k,
        device=args.device,
        output_raw=args.output_raw,
        output_ngrams=args.output_ngrams,
        prompt=args.prompt,
        prompt_file=args.prompt_file,
        prompt_preset=args.prompt_preset,
        lowercase_raw=args.lowercase_raw,
        api_url=args.api_url,
        api_model=args.api_model,
        data_dir=args.data_dir,
    )


def main() -> None:
    setup_logging()
    cfg = parse_args()
    # create timestamped run folder under cfg.data_dir
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    run_dir = os.path.join(cfg.data_dir, ts)
    os.makedirs(run_dir, exist_ok=True)
    # adjust output paths to be inside run folder
    cfg.output_raw = os.path.join(run_dir, os.path.basename(cfg.output_raw))
    # ngram prefix (without extension)
    cfg.output_ngrams = os.path.join(run_dir, os.path.basename(cfg.output_ngrams))
    # resolve prompt content and persist for reproducibility
    resolved_prompt = resolve_prompt_text(cfg)
    cfg.prompt = resolved_prompt
    try:
        with open(os.path.join(run_dir, 'prompt.txt'), 'w', encoding='utf-8') as pf:
            pf.write(resolved_prompt)
    except Exception as e:
        logging.warning('Could not write prompt file: %s', e)
    logging.info('Configuration: %s', cfg)
    logging.info('Run outputs will be placed in %s', run_dir)
    generate_and_stream(cfg)
    process_raw_to_ngrams(cfg.output_raw, cfg.output_ngrams)


if __name__ == '__main__':
    main()
