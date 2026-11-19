"""Precompute top-N context maps and a prefix trie with top-K completions.

Creates a small `prediction-data` folder with:
- word_bigram_topn.pkl (dict: word -> [next_word,...])
- word_trigram_topn.pkl (dict: "w1 w2" -> [next_word,...])
- trie_topk.pkl (prefix trie where each node has 'top' list)

Defaults: N=12 (context top), K=20 (trie top per node). Adjust via constants.
"""
from __future__ import annotations

import json
import os
import pickle
from collections import Counter
from typing import Dict, List, Tuple

# Paths and configuration
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
KEYPAD_DIR = os.path.dirname(BACKEND_DIR)
FRONTEND_PUBLIC_DIR = os.path.join(KEYPAD_DIR, "frontend", "public")
DATA_DIR = os.path.join(KEYPAD_DIR, "prediction-data")
CONTEXT_N = 12
TRIE_K = 20


def _load_json_anywhere(basename: str):
    candidates = [
        os.path.join(FRONTEND_PUBLIC_DIR, basename),
        os.path.join(BACKEND_DIR, basename),
    ]
    for p in candidates:
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
    raise FileNotFoundError(f"Could not find {basename} in candidates: {candidates}")


def build_context_topn(bigram_map: Dict[str, List[List]], trigram_map: Dict[str, List[List]], n: int) -> Tuple[Dict[str, List[str]], Dict[str, List[str]]]:
    word_bigram_topn: Dict[str, List[str]] = {}
    word_trigram_topn: Dict[str, List[str]] = {}

    for k, lst in bigram_map.items():
        # lst elements look like [next_word, count]
        word_bigram_topn[k] = [w for w, c in lst[:n]]

    for k, lst in trigram_map.items():
        word_trigram_topn[k] = [w for w, c in lst[:n]]

    return word_bigram_topn, word_trigram_topn


def build_vocab_freq_from_maps(bigram_map: Dict[str, List[List]], trigram_map: Dict[str, List[List]]) -> Counter:
    freq = Counter()
    for lst in bigram_map.values():
        for w, c in lst:
            freq[w] += int(c)
    for lst in trigram_map.values():
        for w, c in lst:
            freq[w] += int(c)
    return freq


def insert_trie(root: dict, word: str, count: int, k: int):
    node = root
    # update root top
    _update_top(node, word, count, k)
    for ch in word:
        if 'c' not in node:
            node['c'] = {}
        if ch not in node['c']:
            node['c'][ch] = {'top': []}
        node = node['c'][ch]
        _update_top(node, word, count, k)


def _update_top(node: dict, word: str, count: int, k: int):
    top: List[Tuple[str, int]] = node.get('top') or []
    # find existing
    for i, (w, c) in enumerate(top):
        if w == word:
            top[i] = (w, c + count)
            break
    else:
        top.append((word, count))
    # keep sorted descending
    top.sort(key=lambda x: -x[1])
    if len(top) > k:
        top[:] = top[:k]
    node['top'] = top


def build_trie_from_freq(freq: Counter, k: int) -> dict:
    root = {'top': []}
    for word, cnt in freq.items():
        insert_trie(root, word, cnt, k)
    return root


def save_pickle(obj, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        pickle.dump(obj, f)


def main():
    print('Loading maps...')
    word_bigram_next = _load_json_anywhere('word_bigram_next.json')
    word_trigram_next = _load_json_anywhere('word_trigram_next.json')

    print('Building top-N context maps...')
    bigram_topn, trigram_topn = build_context_topn(word_bigram_next, word_trigram_next, CONTEXT_N)

    print('Aggregating vocab frequencies...')
    freq = build_vocab_freq_from_maps(word_bigram_next, word_trigram_next)
    print(f'Vocabulary size from maps: {len(freq)}')

    print('Building trie with top-K caches per node...')
    trie = build_trie_from_freq(freq, TRIE_K)

    out_dir = DATA_DIR
    os.makedirs(out_dir, exist_ok=True)
    print('Saving artifacts to', out_dir)
    save_pickle(bigram_topn, os.path.join(out_dir, 'word_bigram_topn.pkl'))
    save_pickle(trigram_topn, os.path.join(out_dir, 'word_trigram_topn.pkl'))
    save_pickle(trie, os.path.join(out_dir, 'trie_topk.pkl'))
    save_pickle(freq, os.path.join(out_dir, 'vocab_freq.pkl'))

    print('Done. Samples:')
    # sample prints
    sample_ctx = 'the'
    print('Top next words after', sample_ctx, ':', bigram_topn.get(sample_ctx, [])[:8])
    sample_tri = 'in the'
    print('Top next words after', sample_tri, ':', trigram_topn.get(sample_tri, [])[:8])
    # show trie prefix
    node = trie
    for ch in 'th':
        node = node.get('c', {}).get(ch) or {}
    print('Trie top at prefix "th":', [w for w, c in node.get('top', [])[:8]])


if __name__ == '__main__':
    main()
