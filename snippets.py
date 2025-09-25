import random
import os
import logging
from datetime import datetime
import argparse
import re
import difflib

# Filtering utility must be defined before generation loop
def filter_and_normalize_sentence(sentence: str, prev_sentences: list[str]) -> str | None:
    """Return cleaned sentence or None to drop it.
    Filters out instruction echoes, 'previous output was cut off' messages, prompt leakage,
    duplicates, and normalizes punctuation issues.
    """
    if not sentence:
        return None
    s = sentence.strip()
    # Remove angle-bracket markers and asterisks (safety)
    s = re.sub(r"<\|/?[a-zA-Z0-9_\-]+\|>", "", s)
    s = s.replace('*', '')
    s = re.sub(r"\s+", ' ', s).strip()

    # Lowercase copy for checks
    low = s.lower()
    # Drop if it contains common instruction/analysis leakage
    instruction_patterns = [
        r"\bdo not\b",
        r"\bdon't\b",
        r"\bdo n't\b",
        r"compose an essay",
        r"previous output was cut off",
        r"the previous output was cut off",
        r"do not include",
        r"do not use",
        r"do not mention",
        r"do not add",
        r"do not include personal",
    ]
    for pat in instruction_patterns:
        if re.search(pat, low):
            return None

    # Drop if it's clearly an instruction/prompt echo (starts with verbs like 'compose', 'write', 'please')
    if re.match(r"^(compose|write|please|provide|generate)\b", low):
        return None

    # Remove repeated artifacts like 'Previous output was cut off' fragments embedded
    s = re.sub(r"previous output was cut off\.?", "", s, flags=re.I)

    # Fix punctuation glitches like 'However,.' -> 'However.' and ',.' -> '.'
    s = re.sub(r",\s*[\.\!\?]", '.', s)
    s = re.sub(r"\s+([,;:\.\!\?])", r"\1", s)
    s = re.sub(r"([\?\!\.]){2,}", r"\1", s)
    # Fix 'However,.' specifically
    s = re.sub(r"However,\.", "However.", s)

    # Trim repeated short phrase duplication: if sentence repeats earlier exactly or is a near-duplicate, drop
    for prev in prev_sentences[-8:]:
        if not prev:
            continue
        if s == prev:
            return None
        # similarity check
        ratio = difflib.SequenceMatcher(None, s, prev).ratio()
        if ratio > 0.9:
            return None

    # If sentence is extremely short or looks like leftover token, drop
    if len(s.split()) < 2:
        return None

    # Final normalize whitespace
    s = re.sub(r"\s+", ' ', s).strip()
    return s

# ----------------------------
# Configuration
# ----------------------------

# Topics of daily life
topics = [
    "waking up", "breakfast", "commute", "work", "lunch",
    "errands", "hobbies", "dinner", "relaxing", "social interactions",
    "morning routine", "shower", "coffee", "emails", "meetings",
    "brainstorming", "reading", "studying", "gym", "exercise",
    "grocery shopping", "cooking", "baking", "laundry", "dishes",
    "bedtime", "naps", "pet care", "parenting", "childcare",
    "teaching", "tutoring", "shopping", "budgeting", "paying bills",
    "gardening", "yard work", "walking the dog", "public transit", "traffic",
    "parking", "bike ride", "park", "library", "cafe",
    "nightlife", "movie night", "streaming", "gaming", "sports",
    "volunteering", "DIY", "home repairs", "appointments", "dentist",
    "doctor visit", "prescriptions", "packing", "unpacking", "travel planning",
    "seasonal chores", "study group", "group project", "networking", "interview prep",
    "small talk", "flirting", "date night", "family time", "chores",
    "celebration", "holidays", "home office", "commute woes", "free time"
]

# Roles to rotate
roles = [
    "teenager", "middle-class adult", "academic researcher",
    "student", "office worker", "artist",
    "retiree", "parent", "single parent", "chef", "barista",
    "nurse", "doctor", "engineer", "programmer", "designer",
    "salesperson", "manager", "ceo", "intern", "graduate student",
    "postdoc", "librarian", "teacher", "professor", "scientist",
    "activist", "musician", "actor", "writer", "journalist",
    "blogger", "social worker", "counselor", "psychologist", "therapist",
    "farmer", "gardener", "handyman", "mechanic", "driver",
    "taxi driver", "bus driver", "pilot", "flight attendant", "waiter",
    "waitress", "baker", "photographer", "filmmaker", "influencer",
    "entrepreneur", "founder", "investor", "accountant", "lawyer",
    "paralegal", "student-athlete", "coach", "personal trainer", "athlete",
    "consultant", "analyst", "it support", "sysadmin", "security guard",
    "police officer", "firefighter", "paramedic", "civil servant", "policy maker",
    "diplomat", "ngo worker", "small-business owner", "retail worker", "construction worker"
]

# Number of snippets to generate
NUM_SNIPPETS = 1000

# Output file
OUTPUT_FILE = "snippets.txt"

# Defaults for LM API
API_URL = "http://127.0.0.1:1234/v1/completions"
API_MODEL = "google/gemma-3-12b"

# Add CLI to control target words
parser = argparse.ArgumentParser(description='Generate snippets using local LLM')
parser.add_argument('--target-words', type=int, default=1000, help='Approximate total words to generate')
parser.add_argument('--data-dir', type=str, default='data', help='Base data directory for run outputs')
parser.add_argument('--max-sentence-tokens', type=int, default=120, help='Max tokens to request per sentence')
args = parser.parse_args()

TARGET_WORDS = args.target_words
DATA_DIR = args.data_dir
SENT_MAX_TOKENS = args.max_sentence_tokens

# ----------------------------
# System prompt (set once)
# ----------------------------
SYSTEM_PROMPT = (
    "Ramble as if you are a {role}." 
    " Do NOT include internal thoughts, analysis, chain-of-thought, reasoning steps, or any meta-commentary. "
    "Do NOT include channel markers like <|channel|>analysis. Do NOT use asterisks (*) or markdown-like formatting. Output only the final snippet as plain text."
)

# ----------------------------
# Minimal prompt generator
# ----------------------------

def create_prompt(topic, role1, role2=None):
    if role2:
        return f"Ramble about {topic} as if you are {role1} and {role2}."
    else:
        return f"Ramble about {topic} as if you are {role1}."

# ----------------------------
# New imports from generate_corpus helpers
from generate_corpus import load_api_generator, tokenize_words, build_ngrams, save_ngrams, ensure_dir_for_file

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Create run directory
run_ts = datetime.now().strftime('%Y%m%d_%H%M%S')
RUN_DIR = os.path.join(DATA_DIR, run_ts)
os.makedirs(RUN_DIR, exist_ok=True)

RAW_OUT = os.path.join(RUN_DIR, 'raw.txt')
NGRAM_PREFIX = os.path.join(RUN_DIR, 'ngrams')
PROMPT_FILE = os.path.join(RUN_DIR, 'prompt.txt')

# Save the system prompt for reproducibility
with open(PROMPT_FILE, 'w', encoding='utf-8') as pf:
    pf.write(SYSTEM_PROMPT)

# Initialize generator
generate = load_api_generator(API_URL, API_MODEL, temperature=0.7, top_p=0.9, top_k=50)

# Generation loop: produce snippets until TARGET_WORDS reached
words_written = 0
snippets_generated = 0

with open(RAW_OUT, 'w', encoding='utf-8') as rawf:
    while words_written < TARGET_WORDS:
        topic = random.choice(topics)
        role1 = random.choice(roles)
        # 50% chance of monologue
        if random.random() < 0.5:
            base_prompt = create_prompt(topic, role1)
            role_text = role1
        else:
            role2 = random.choice([r for r in roles if r != role1])
            base_prompt = create_prompt(topic, role1, role2)
            role_text = f"{role1} and {role2}"

        # Decide how many sentences for this snippet (5-10)
        sentences_target = random.randint(5, 10)
        prev_sentences = []

        for s_i in range(sentences_target):
            # Build per-sentence prompt: include role/system and the base prompt, plus context of prior sentences
            system_text = SYSTEM_PROMPT.format(role=role_text)
            context = ''
            if prev_sentences:
                # provide recent context to maintain coherence
                context = ' '.join(prev_sentences[-3:]) + '\n\n'
            sentence_request = system_text + "\n\n" + base_prompt + "\n\n" + context + "Write ONE complete sentence about the above. Do not include partial sentences or analysis. Output only a single sentence. Do not use '*' characters."
            try:
                out = generate(sentence_request, max_new_tokens=SENT_MAX_TOKENS)
            except Exception as e:
                logging.exception('Generation failed, using placeholder sentence: %s', e)
                out = "[Failed generation]"

            # Clean the generated sentence
            sentence = out.replace('\n', ' ').strip()
            # Remove any channel markers and angle-bracket tokens
            sentence = re.sub(r"<\|/?[a-zA-Z0-9_\-]+\|>", "", sentence)
            # Remove asterisks
            sentence = sentence.replace('*', '')
            # Trim extra whitespace
            sentence = re.sub(r"\s+", ' ', sentence).strip()

            # If sentence seems cut off (no terminal punctuation), attempt retries/finish
            retries = 0
            max_retries = 2
            while (not sentence or sentence[-1] not in '.!?' ) and retries < max_retries:
                retries += 1
                # Ask the model to finish the incomplete sentence only
                partial = sentence
                finish_prompt = system_text + "\n\n" + base_prompt + "\n\n" + context + f"The previous output was cut off. Finish the incomplete sentence below without adding new sentences or analysis. Previous partial: \"{partial}\""
                try:
                    cont = generate(finish_prompt, max_new_tokens=SENT_MAX_TOKENS)
                except Exception as e:
                    logging.exception('Finish request failed: %s', e)
                    cont = ''
                cont = cont.replace('\n', ' ').strip()
                cont = re.sub(r"<\|/?[a-zA-Z0-9_\-]+\|>", "", cont)
                cont = cont.replace('*', '')
                cont = re.sub(r"\s+", ' ', cont).strip()
                if cont:
                    # Append continuation to partial, ensuring spacing
                    if partial and not partial.endswith(' '):
                        sentence = partial + ' ' + cont
                    else:
                        sentence = partial + cont
                # if still no terminal punctuation, loop to retry

            # Ensure sentence ends with punctuation
            if sentence and sentence[-1] not in '.!?':
                sentence = sentence.rstrip() + '.'

            if not sentence:
                sentence = 'The.'

            # Final safety: remove stray asterisks or markers
            sentence = re.sub(r"<\|/?[a-zA-Z0-9_\-]+\|>", "", sentence)
            sentence = sentence.replace('*', '')
            sentence = re.sub(r"\s+", ' ', sentence).strip()

            # Filter and normalize; skip if None
            sentence_clean = filter_and_normalize_sentence(sentence, prev_sentences)
            if not sentence_clean:
                # do not write this sentence; continue to next sentence
                continue

            # Append sentence to previous and write to raw file
            prev_sentences.append(sentence_clean)
            rawf.write(sentence_clean + ' ')
            rawf.flush()

            # Update counters
            nw = len(tokenize_words(sentence_clean))
            words_written += nw

            # Break early if we've reached the global target
            if words_written >= TARGET_WORDS:
                break

        snippets_generated += 1

        if snippets_generated % 50 == 0:
            logging.info('%d snippets generated, %d words written', snippets_generated, words_written)

logging.info('Finished: %d snippets, approx %d words', snippets_generated, words_written)

# Post-process: build ngrams and save
with open(RAW_OUT, 'r', encoding='utf-8') as rf:
    all_text = rf.read()
tokens = tokenize_words(all_text)
logging.info('Token count: %d', len(tokens))
bigrams, trigrams = build_ngrams(tokens)
ensure_dir_for_file(NGRAM_PREFIX + '_bigram.csv')
save_ngrams(bigrams, NGRAM_PREFIX, 'bigram')
save_ngrams(trigrams, NGRAM_PREFIX, 'trigram')

print('Outputs saved to', RUN_DIR)
