import os
import re
from collections import Counter, defaultdict

# Folder containing your text files
FOLDER_PATH = "path_to_your_txt_folder"

def load_and_clean_text(folder_path):
    text = ""
    for filename in os.listdir(folder_path):
        if filename.endswith(".txt"):
            with open(os.path.join(folder_path, filename), "r", encoding="utf-8") as f:
                file_text = f.read().lower()
                # keep letters and spaces only
                file_text = re.sub(r'[^a-z ]', '', file_text)
                # collapse multiple spaces into one
                file_text = re.sub(r'\s+', ' ', file_text)
                text += file_text + " "
    return text.strip()

def compute_bigrams_trigrams(text):
    bigram_counts = Counter()
    trigram_counts = Counter()
    
    for i in range(len(text)-1):
        bigram_counts[text[i:i+2]] += 1
    for i in range(len(text)-2):
        trigram_counts[text[i:i+3]] += 1
    
    return bigram_counts, trigram_counts

def build_next_letter_structure(bigram_counts, trigram_counts):
    # For bigram: map first letter -> list of (next_letter, count)
    bigram_next = defaultdict(list)
    for bg, count in bigram_counts.items():
        bigram_next[bg[0]].append((bg[1], count))
    
    # For trigram: map first two letters -> list of (next_letter, count)
    trigram_next = defaultdict(list)
    for tg, count in trigram_counts.items():
        trigram_next[tg[:2]].append((tg[2], count))
    
    # Sort each list by descending count
    for k in bigram_next:
        bigram_next[k] = sorted(bigram_next[k], key=lambda x: -x[1])
    for k in trigram_next:
        trigram_next[k] = sorted(trigram_next[k], key=lambda x: -x[1])
    
    return bigram_next, trigram_next

if __name__ == "__main__":
    text = load_and_clean_text(FOLDER_PATH)
    bigram_counts, trigram_counts = compute_bigrams_trigrams(text)
    bigram_next, trigram_next = build_next_letter_structure(bigram_counts, trigram_counts)
    
    # Example: top 5 next letters after 't'
    print("Top 5 bigram next letters after 't':", bigram_next.get('t', [])[:5])
    # Example: top 5 next letters after 'th'
    print("Top 5 trigram next letters after 'th':", trigram_next.get('th', [])[:5])
