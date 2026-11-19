import random
import os
import logging
from datetime import datetime
from generate_corpus import load_api_generator, ensure_dir_for_file, process_raw_to_ngrams
import argparse

# Configuration
API_URL = "http://127.0.0.1:1234/v1/completions"
API_MODEL = "gpt-oss-20b"
CHUNK_WORDS = 200
OUTPUT_DIR = "data"

# Topics and roles
topics = [
    "waking up", "commute", "breakfast", "work", "lunch", "errands",
    "hobbies", "dinner", "relaxing", "social interactions"
]
roles = ["teenager", "middle-class adult", "academic researcher"]

# Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

def generate_snippet(api_url, api_model, topic, role_sequence):
    """Generate a single snippet using the API."""
    prompt = f"""
    Write a snippet of everyday conversational English about {topic}.
    Include sentences reflecting {role_sequence[0]}, {role_sequence[1]}, {role_sequence[2]} styles in natural rotation.
    Do not label speakers. No meta-commentary. Use casual style with filler words like 'like', 'you know'.
    Produce 5-10 sentences as a single paragraph. Avoid em dashes.
    """
    generator = load_api_generator(api_url, api_model, temperature=0.7, top_p=0.9, top_k=50)
    return generator(prompt, max_new_tokens=int(CHUNK_WORDS * 1.3))

def save_snippet(snippet, output_dir, index):
    """Save a snippet to a file."""
    ensure_dir_for_file(output_dir)
    snippet_path = os.path.join(output_dir, f"snippet_{index:04d}.txt")
    with open(snippet_path, "w", encoding="utf-8") as f:
        f.write(snippet)
    logging.info("Saved snippet %d to %s", index, snippet_path)

def combine_snippets_to_raw(snippet_dir, raw_path):
    """Combine all snippet files into a single raw.txt file."""
    with open(raw_path, "w", encoding="utf-8") as raw_file:
        for snippet_file in sorted(os.listdir(snippet_dir)):
            snippet_path = os.path.join(snippet_dir, snippet_file)
            if os.path.isfile(snippet_path):
                with open(snippet_path, "r", encoding="utf-8") as f:
                    raw_file.write(f.read() + " ")
    logging.info("Combined snippets into %s", raw_path)

def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description="Automated snippet generator with n-gram processing.")
    parser.add_argument("word_count", type=int, help="Total word count for the generated corpus.")
    return parser.parse_args()

def main():
    """Main function to generate snippets and process n-grams."""
    args = parse_args()
    target_words = args.word_count

    # Create timestamped output directory
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = os.path.join(OUTPUT_DIR, timestamp)
    snippet_dir = os.path.join(run_dir, "snippets")
    os.makedirs(snippet_dir, exist_ok=True)

    words_generated = 0
    snippet_index = 1

    # Generate snippets until the target word count is reached
    while words_generated < target_words:
        topic = random.choice(topics)
        role_sequence = random.choices(roles, k=3)
        try:
            snippet = generate_snippet(API_URL, API_MODEL, topic, role_sequence)
            save_snippet(snippet, snippet_dir, snippet_index)
            words_generated += len(snippet.split())
            snippet_index += 1
        except Exception as e:
            logging.error("Error generating snippet %d: %s", snippet_index, e)

    # Combine snippets into raw.txt
    raw_path = os.path.join(run_dir, "raw.txt")
    combine_snippets_to_raw(snippet_dir, raw_path)

    # Process raw.txt into n-grams
    ngram_prefix = os.path.join(run_dir, "ngrams")
    process_raw_to_ngrams(raw_path, ngram_prefix)

if __name__ == "__main__":
    main()