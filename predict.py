import json
from typing import List, Union

# Load n-gram data
with open("letter_bigram_next.json") as f:
    letter_bigram_next = json.load(f)
with open("letter_trigram_next.json") as f:
    letter_trigram_next = json.load(f)
with open("word_bigram_next.json") as f:
    word_bigram_next = json.load(f)
with open("word_trigram_next.json") as f:
    word_trigram_next = json.load(f)

def predict_next_letters(context: str, top_n: int = 8) -> List[str]:
    context = context.lower()
    if len(context) >= 2 and context[-2:] in letter_trigram_next:
        return [x[0] for x in letter_trigram_next[context[-2:]][:top_n]]
    elif len(context) >= 1 and context[-1] in letter_bigram_next:
        return [x[0] for x in letter_bigram_next[context[-1]][:top_n]]
    else:
        # Fallback: most common letters
        return [x[0] for x in sorted(letter_bigram_next.values(), key=lambda v: -v[0][1])[:top_n]]

def predict_next_words(context: Union[str, List[str]], top_n: int = 8) -> List[str]:
    if isinstance(context, str):
        words = [w for w in context.lower().split() if w]
    else:
        words = context
    if len(words) >= 2 and str((words[-2], words[-1])) in word_trigram_next:
        return [x[0] for x in word_trigram_next[str((words[-2], words[-1]))][:top_n]]
    elif len(words) >= 1 and words[-1] in word_bigram_next:
        return [x[0] for x in word_bigram_next[words[-1]][:top_n]]
    else:
        # Fallback: most common words
        return [x[0] for x in sorted(word_bigram_next.values(), key=lambda v: -v[0][1])[:top_n]]

if __name__ == "__main__":
    # Example usage
    print("Next letters after 'th':", predict_next_letters("th"))
    print("Next words after 'in the':", predict_next_words(["in", "the"]))
