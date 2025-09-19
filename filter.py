import os
import re
import json
from collections import Counter, defaultdict

# Folder containing your text files
FOLDER_PATH = "/Users/leeguhn/Desktop/bundle/hansel/corpus"  # Use current directory containing corpus files

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

def tokenize_words(text):
    # Split by spaces, remove empty tokens
    return [w for w in text.split(' ') if w]

def compute_bigrams_trigrams(text):
    bigram_counts = Counter()
    trigram_counts = Counter()
    for i in range(len(text)-1):
        bigram_counts[text[i:i+2]] += 1
    for i in range(len(text)-2):
        trigram_counts[text[i:i+3]] += 1
    return bigram_counts, trigram_counts

def compute_word_ngrams(words):
    word_bigram_counts = Counter()
    word_trigram_counts = Counter()
    for i in range(len(words)-1):
        word_bigram_counts[tuple(words[i:i+2])] += 1
    for i in range(len(words)-2):
        word_trigram_counts[tuple(words[i:i+3])] += 1
    return word_bigram_counts, word_trigram_counts

def build_next_letter_structure(bigram_counts, trigram_counts):
    bigram_next = defaultdict(list)
    for bg, count in bigram_counts.items():
        bigram_next[bg[0]].append((bg[1], count))
    trigram_next = defaultdict(list)
    for tg, count in trigram_counts.items():
        trigram_next[tg[:2]].append((tg[2], count))
    for k in bigram_next:
        bigram_next[k] = sorted(bigram_next[k], key=lambda x: -x[1])
    for k in trigram_next:
        trigram_next[k] = sorted(trigram_next[k], key=lambda x: -x[1])
    return bigram_next, trigram_next

def build_next_word_structure(word_bigram_counts, word_trigram_counts):
    word_bigram_next = defaultdict(list)
    for bg, count in word_bigram_counts.items():
        word_bigram_next[bg[0]].append((bg[1], count))
    word_trigram_next = defaultdict(list)
    for tg, count in word_trigram_counts.items():
        word_trigram_next[(tg[0], tg[1])].append((tg[2], count))
    for k in word_bigram_next:
        word_bigram_next[k] = sorted(word_bigram_next[k], key=lambda x: -x[1])
    for k in word_trigram_next:
        word_trigram_next[k] = sorted(word_trigram_next[k], key=lambda x: -x[1])
    return word_bigram_next, word_trigram_next

if __name__ == "__main__":
    text = load_and_clean_text(FOLDER_PATH)
    bigram_counts, trigram_counts = compute_bigrams_trigrams(text)
    bigram_next, trigram_next = build_next_letter_structure(bigram_counts, trigram_counts)

    words = tokenize_words(text)
    word_bigram_counts, word_trigram_counts = compute_word_ngrams(words)
    word_bigram_next, word_trigram_next = build_next_word_structure(word_bigram_counts, word_trigram_counts)

    # Save all n-gram data to JSON files
    with open("letter_bigram_next.json", "w") as f:
        json.dump({k: v for k, v in bigram_next.items()}, f)
    with open("letter_trigram_next.json", "w") as f:
        json.dump({k: v for k, v in trigram_next.items()}, f)
    with open("word_bigram_next.json", "w") as f:
        json.dump({k: v for k, v in word_bigram_next.items()}, f)
    with open("word_trigram_next.json", "w") as f:
        json.dump({str(k): v for k, v in word_trigram_next.items()}, f)

    # Example: top 5 next letters after 't'
    print("Top 5 bigram next letters after 't':", bigram_next.get('t', [])[:5])
    # Example: top 5 next letters after 'th'
    print("Top 5 trigram next letters after 'th':", trigram_next.get('th', [])[:5])
    # Example: top 5 next words after 'the'
    print("Top 5 bigram next words after 'the':", word_bigram_next.get('the', [])[:5])
    # Example: top 5 next words after ('in', 'the')
    print("Top 5 trigram next words after ('in', 'the'):", word_trigram_next.get(("in", "the"), [])[:5])
