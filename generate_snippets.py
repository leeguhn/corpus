import os
import random
import logging
from datetime import datetime
from generate_corpus import connect_to_local_llm

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Define system/role prompt
SYSTEM_PROMPT = (
    "You are a writer generating casual, everyday English snippets about daily life. "
    "Avoid meta-commentary, speaker labels, and em dashes. Include filler words like 'like' and 'you know'. "
    "Rotate roles naturally (gender, age, occupation). Each snippet should be a single paragraph of 5-10 sentences."
)

# Define topics and roles
TOPICS = [
    "waking up", "breakfast", "commute", "work", "lunch", "errands", "hobbies", "dinner", "relaxing", "social interactions"
]
ROLES = [
    "teenager", "middle-class adult", "academic researcher", "student", "office worker", "retiree", "parent", "artist"
]

# Output directory
OUTPUT_DIR = os.path.join("data", datetime.now().strftime("%Y%m%d_%H%M%S"))
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Function to generate a snippet
def generate_snippet(llm, topic, roles):
    minimal_prompt = f"Write a 7-sentence snippet about {topic} involving {roles[0]}"
    if len(roles) > 1:
        minimal_prompt += f" and {roles[1]}"
    
    try:
        response = llm.generate(SYSTEM_PROMPT, minimal_prompt)
        return response.strip()
    except Exception as e:
        logging.error(f"Error generating snippet: {e}")
        return None

# Main function to generate dataset
def generate_dataset(target_word_count):
    llm = connect_to_local_llm()
    total_words = 0
    snippet_count = 0

    while total_words < target_word_count:
        topic = random.choice(TOPICS)
        roles = random.sample(ROLES, k=random.choice([1, 2]))

        snippet = generate_snippet(llm, topic, roles)
        if snippet:
            snippet_count += 1
            total_words += len(snippet.split())

            # Save snippet to file
            snippet_file = os.path.join(OUTPUT_DIR, f"snippet_{snippet_count:04d}.txt")
            with open(snippet_file, "w", encoding="utf-8") as f:
                f.write(snippet)

            logging.info(f"Generated snippet {snippet_count}: {len(snippet.split())} words")

    logging.info(f"Dataset generation complete: {snippet_count} snippets, {total_words} words")

# Post-processing (optional)
def post_process_snippets():
    # Placeholder for cleaning, punctuation consistency, or tokenization
    pass

def setup_output_directory(base_dir: str) -> str:
    """
    Create a timestamped directory inside the base directory for organizing outputs.
    """
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    run_dir = os.path.join(base_dir, timestamp)
    os.makedirs(run_dir, exist_ok=True)
    return run_dir

if __name__ == "__main__":
    # Set up output directory similar to generate_corpus.py
    BASE_OUTPUT_DIR = "data"
    OUTPUT_DIR = setup_output_directory(BASE_OUTPUT_DIR)

    # Adjust logging to include output directory
    logging.info(f"Output directory: {OUTPUT_DIR}")

    # Generate dataset
    TARGET_WORD_COUNT = 1000  # Example target word count
    generate_dataset(TARGET_WORD_COUNT)

    # Save prompt for reproducibility
    prompt_file = os.path.join(OUTPUT_DIR, "prompt.txt")
    with open(prompt_file, "w", encoding="utf-8") as pf:
        pf.write(SYSTEM_PROMPT)

    # Post-process snippets
    post_process_snippets()