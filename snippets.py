import random
import os
import logging
from datetime import datetime
import argparse

# ----------------------------
# Configuration
# ----------------------------

# Topics of daily life
topics = [
    "waking up", "breakfast", "commute", "work", "lunch",
    "errands", "hobbies", "dinner", "relaxing", "social interactions"
]

# Roles to rotate
roles = [
    "teenager", "middle-class adult", "academic researcher",
    "student", "office worker", "artist"
]

# Number of snippets to generate
NUM_SNIPPETS = 1000

# Output file
OUTPUT_FILE = "snippets.txt"

# Defaults for LM API
API_URL = "http://127.0.0.1:1234/v1/completions"
API_MODEL = "gpt-oss-20b"

# Add CLI to control target words
parser = argparse.ArgumentParser(description='Generate snippets using local LLM')
parser.add_argument('--target-words', type=int, default=1000, help='Approximate total words to generate')
parser.add_argument('--data-dir', type=str, default='data', help='Base data directory for run outputs')
args = parser.parse_args()

TARGET_WORDS = args.target_words
DATA_DIR = args.data_dir

# ----------------------------
# System prompt (set once)
# ----------------------------
SYSTEM_PROMPT = (
    "Ramble as if you are a {role}." 
    " Do NOT include internal thoughts, analysis, chain-of-thought, reasoning steps, or any meta-commentary. "
    "Do NOT include channel markers like <|channel|>analysis. Output only the final snippet as plain text."
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
            prompt = create_prompt(topic, role1)
            role_text = role1
        else:
            role2 = random.choice([r for r in roles if r != role1])
            prompt = create_prompt(topic, role1, role2)
            role_text = f"{role1} and {role2}"

        # Build full prompt by formatting the simple system template with role_text
        system_text = SYSTEM_PROMPT.format(role=role_text)
        full_prompt = system_text + "\n\n" + prompt
        try:
            out = generate(full_prompt, max_new_tokens=100)
        except Exception as e:
            logging.exception('Generation failed, using placeholder: %s', e)
            out = f"[Failed generation for prompt: {prompt}]"

        # Clean newlines and write
        out_clean = out.replace('\n', ' ').strip()
        if not out_clean:
            out_clean = 'the'
        rawf.write(out_clean + ' ')
        rawf.flush()

        # Update counters
        nw = len(tokenize_words(out_clean))
        words_written += nw
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
