"""Lightweight FastAPI server to serve predictions from precomputed data.

Endpoints:
- GET /predict/words?context=...&n=5
- GET /predict/prefix?prefix=...&n=5
- GET /predict/digits?digits=...&n=5

Run for demo: python predict_server.py
"""
from __future__ import annotations

import os
import pickle
import time
from typing import List

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

ROOT = os.path.dirname(__file__)
DATA_DIR = os.path.join(ROOT, 'predict_data')


def _load_pickle(name: str):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    with open(path, 'rb') as f:
        return pickle.load(f)


print('Loading precomputed data from', DATA_DIR)
start = time.time()
try:
    WORD_BIGRAM_TOPN = _load_pickle('word_bigram_topn.pkl')
    WORD_TRIGRAM_TOPN = _load_pickle('word_trigram_topn.pkl')
    TRIE_TOPK = _load_pickle('trie_topk.pkl')
    VOCAB_FREQ = _load_pickle('vocab_freq.pkl')
except Exception as e:
    raise RuntimeError('Missing predict_data. Run precompute_topn.py first') from e
print('Loaded data in %.2f s' % (time.time() - start))

app = FastAPI(title='Predictor Demo')

# digit -> letters mapping for classic T9
T9_MAP = {
    '2': 'abc', '3': 'def', '4': 'ghi', '5': 'jkl', '6': 'mno', '7': 'pqrs', '8': 'tuv', '9': 'wxyz'
}


class SuggestResponse(BaseModel):
    suggestions: List[str]
    source: str | None = None


def trie_prefix_lookup(prefix: str, k: int = 5) -> List[str]:
    node = TRIE_TOPK
    for ch in prefix:
        node = node.get('c', {}).get(ch)
        if node is None:
            return []
    return [w for w, cnt in node.get('top', [])[:k]]


def trie_digits_lookup(digits: str, k: int = 5) -> List[str]:
    # BFS limited by top-K caches for speed
    nodes = [TRIE_TOPK]
    for d in digits:
        letters = T9_MAP.get(d, '')
        if not letters:
            return []
        nxt = []
        for node in nodes:
            children = node.get('c', {})
            for ch in letters:
                child = children.get(ch)
                if child:
                    nxt.append(child)
        nodes = nxt
        if not nodes:
            return []
    # aggregate tops
    counts = {}
    for node in nodes:
        for w, c in node.get('top', [])[:k]:
            counts[w] = counts.get(w, 0) + c
    return [w for w, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:k]]


@app.get('/predict/words', response_model=SuggestResponse)
def predict_words(context: str = Query('', description='Context words, e.g. "in the"'), n: int = 5):
    # prefer trigram key (space joined) then bigram
    ctx = context.strip().lower()
    if not ctx:
        # return some global commons
        top = [w for w, _ in VOCAB_FREQ.most_common(n)] if hasattr(VOCAB_FREQ, 'most_common') else list(VOCAB_FREQ)[:n]
        return {'suggestions': top, 'source': 'global'}
    parts = ctx.split()
    if len(parts) >= 2:
        key = f"{parts[-2]} {parts[-1]}"
        if key in WORD_TRIGRAM_TOPN:
            return {'suggestions': WORD_TRIGRAM_TOPN.get(key, [])[:n], 'source': 'trigram'}
    last = parts[-1]
    if last in WORD_BIGRAM_TOPN:
        return {'suggestions': WORD_BIGRAM_TOPN.get(last, [])[:n], 'source': 'bigram'}
    # fallback
    top = [w for w, _ in VOCAB_FREQ.most_common(n)] if hasattr(VOCAB_FREQ, 'most_common') else list(VOCAB_FREQ)[:n]
    return {'suggestions': top, 'source': 'fallback'}


@app.get('/predict/prefix', response_model=SuggestResponse)
def predict_prefix(prefix: str = Query('', description='Word prefix'), n: int = 5):
    p = prefix.strip().lower()
    if not p:
        return {'suggestions': [], 'source': 'empty'}
    return {'suggestions': trie_prefix_lookup(p, n), 'source': 'trie'}


@app.get('/predict/digits', response_model=SuggestResponse)
def predict_digits(digits: str = Query('', description='Digits sequence, e.g. 843'), n: int = 5):
    d = digits.strip()
    if not d:
        return {'suggestions': [], 'source': 'empty'}
    return {'suggestions': trie_digits_lookup(d, n), 'source': 't9'}


if __name__ == '__main__':
    import uvicorn
    print('Starting server on http://127.0.0.1:8000')
    uvicorn.run('predict_server:app', host='127.0.0.1', port=8000, reload=False)
