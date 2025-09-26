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
from fastapi import Body
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import re

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

# Build flexible CORS origins list.
_default_local_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]

_env_origins = os.environ.get('PREDICT_CORS_ORIGINS')  # comma-separated
if _env_origins:
    extra = [o.strip() for o in _env_origins.split(',') if o.strip()]
else:
    extra = []
allow_all = True

cors_origins = list(dict.fromkeys(_default_local_origins + extra))  # dedupe preserve order

_localhost_all = os.environ.get('PREDICT_ALLOW_LOCALHOST_ALL', '').lower() in {'1','true','yes'}

if allow_all:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_credentials=False,
        allow_methods=['*'],
        allow_headers=['*'],
    )
    print('CORS: wildcard * (no credentials)')
elif _localhost_all:
    # Use a permissive middleware that reflects Origin for any localhost/127.0.0.1 with any port
    class LocalhostAllCORS(BaseHTTPMiddleware):
        _pattern = re.compile(r'^https?://(localhost|127\.0\.0\.1)(:\d+)?$', re.I)
        def __init__(self, app):
            super().__init__(app)
        async def dispatch(self, request, call_next):
            origin = request.headers.get('origin')
            if origin and self._pattern.match(origin):
                if request.method == 'OPTIONS':
                    # Preflight short-circuit
                    resp = Response(status_code=204)
                else:
                    resp = await call_next(request)
                resp.headers['Access-Control-Allow-Origin'] = origin
                resp.headers['Vary'] = 'Origin'
                resp.headers['Access-Control-Allow-Credentials'] = 'true'
                resp.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
                resp.headers['Access-Control-Allow-Headers'] = request.headers.get('Access-Control-Request-Headers', '*')
                return resp
            # Fallback to normal handling
            return await call_next(request)
    app.add_middleware(LocalhostAllCORS)
    print('CORS: dynamic localhost/127.0.0.1 (any port) enabled')
    # Still register a conservative base for non-local origins to avoid accidental exposure
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*'],
    )
    print('CORS baseline allow_origins:', cors_origins)
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*'],
    )
    print('CORS allow_origins:', cors_origins)

# digit -> letters mapping for classic T9
T9_MAP = {
    '2': 'abc', '3': 'def', '4': 'ghi', '5': 'jkl', '6': 'mno', '7': 'pqrs', '8': 'tuv', '9': 'wxyz'
}


class SuggestResponse(BaseModel):
    suggestions: List[str]
    source: str | None = None


class SelectionEvent(BaseModel):
    context: str = ""
    selected: str
    mode: str | None = None  # 'words' | 'digits' | 'letters' | etc
    candidates: List[str] | None = None  # candidate list (optional from client)
    server_suggestions: List[str] | None = None  # suggestions array as served
    server_source: str | None = None
    digits: str | None = None
    ts: float | None = None


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


@app.post('/analytics/selection')
def selection_event(ev: SelectionEvent = Body(...)):
    """Receive a selection event from frontend and log rank/metadata.

    We attempt to compute:
      - rank_in_server: index in server_suggestions (if provided) or -1
      - rank_in_candidates: index in provided candidates (if provided)
    Logs a single TSV line for easy grep / later analysis.
    """
    import time as _t, json as _json, sys as _sys
    now = ev.ts or _t.time()
    rank_server = -1
    rank_candidates = -1
    if ev.server_suggestions:
        try:
            rank_server = ev.server_suggestions.index(ev.selected)
        except ValueError:
            pass
    if ev.candidates:
        try:
            rank_candidates = ev.candidates.index(ev.selected)
        except ValueError:
            pass
    record = {
        'ts': now,
        'mode': ev.mode,
        'context': ev.context[-120:],  # limit length
        'digits': ev.digits,
        'selected': ev.selected,
        'rank_server': rank_server,
        'rank_candidates': rank_candidates,
        'server_source': ev.server_source,
        'server_suggestions': ev.server_suggestions[:12] if ev.server_suggestions else None,
    }
    line = _json.dumps(record, ensure_ascii=False)
    print(f'[selection] {line}', file=_sys.stderr)
    return {'ok': True, 'rank_server': rank_server, 'rank_candidates': rank_candidates}


@app.get('/health')
def health():  # simple readiness probe
    return {
        'status': 'ok',
        'vocab_size': len(VOCAB_FREQ) if VOCAB_FREQ else 0,
        'bigram_keys': len(WORD_BIGRAM_TOPN) if WORD_BIGRAM_TOPN else 0,
        'trigram_keys': len(WORD_TRIGRAM_TOPN) if WORD_TRIGRAM_TOPN else 0,
    }


if __name__ == '__main__':
    import uvicorn, argparse
    # Allow overriding host/port via CLI or env vars so start scripts can choose a free port.
    parser = argparse.ArgumentParser(description='Prediction server')
    parser.add_argument('--host', default=os.environ.get('PREDICT_HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('PREDICT_PORT', '8000')))
    parser.add_argument('--reload', action='store_true', help='Enable uvicorn reload (dev only)')
    args = parser.parse_args()
    print(f'Starting server on http://{args.host}:{args.port}')
    uvicorn.run('predict_server:app', host=args.host, port=args.port, reload=args.reload)
