import json
import os
from typing import List, Union

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
KEYPAD_DIR = os.path.dirname(BACKEND_DIR)
FRONTEND_PUBLIC_DIR = os.path.join(KEYPAD_DIR, "frontend", "public")


def _load_json_anywhere(basename: str):
    # Prefer the keypad's canonical assets; retain the backend directory as a legacy fallback.
    candidates = [
        os.path.join(FRONTEND_PUBLIC_DIR, basename),
        os.path.join(BACKEND_DIR, basename),
    ]
    for p in candidates:
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
    raise FileNotFoundError(f"Could not find {basename} in candidates: {candidates}")

# Load n-gram data
letter_bigram_next = _load_json_anywhere("letter_bigram_next.json")
letter_trigram_next = _load_json_anywhere("letter_trigram_next.json")
word_bigram_next = _load_json_anywhere("word_bigram_next.json")
word_trigram_next = _load_json_anywhere("word_trigram_next.json")

def _most_common_from_next_map(next_map: dict, top_n: int = 8) -> List[str]:
    # next_map: key -> list of [token, count]
    counts: dict = {}
    for lst in next_map.values():
        if not lst:
            continue
        # take top suggestion for this context
        token, cnt = lst[0][0], lst[0][1]
        counts[token] = counts.get(token, 0) + cnt
    # sort by aggregated counts
    items = sorted(counts.items(), key=lambda kv: -kv[1])
    return [t for t, _ in items[:top_n]]


def predict_next_letters(context: str, top_n: int = 8) -> List[str]:
    context = (context or '').lower()
    if len(context) >= 2 and context[-2:] in letter_trigram_next:
        return [x[0] for x in letter_trigram_next[context[-2:]][:top_n]]
    elif len(context) >= 1 and context[-1] in letter_bigram_next:
        return [x[0] for x in letter_bigram_next[context[-1]][:top_n]]
    else:
        # Fallback: most common letters across bigram next map
        return _most_common_from_next_map(letter_bigram_next, top_n)

def predict_next_words(context: Union[str, List[str]], top_n: int = 8) -> List[str]:
    if isinstance(context, str):
        words = [w for w in context.lower().split() if w]
    else:
        words = context
    # Helper to find trigram key in different possible formats
    def _find_trigram_key(w1: str, w2: str) -> Union[str, None]:
        # common formats: "w1 w2" or str((w1, w2))
        candidates = [f"{w1} {w2}", str((w1, w2))]
        for c in candidates:
            if c in word_trigram_next:
                return c
        return None

    if len(words) >= 2:
        key = _find_trigram_key(words[-2], words[-1])
        if key:
            return [x[0] for x in word_trigram_next[key][:top_n]]
    if len(words) >= 1 and words[-1] in word_bigram_next:
        return [x[0] for x in word_bigram_next[words[-1]][:top_n]]
    # Fallback: most common next words across bigram next map
    return _most_common_from_next_map(word_bigram_next, top_n)

if __name__ == "__main__":
    # Example usage
    print("Next letters after 'th':", predict_next_letters("th"))
    print("Next words after 'in the':", predict_next_words(["in", "the"]))
