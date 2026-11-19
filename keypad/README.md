# Predictive Keypad Prototype

This directory contains a compact predictive text-entry concept. Eight changing suggestions surround a central control in a 3×3 layout. Suggestions can be letters, prefix completions, or likely next words.

The client supports hover previews, a fixed space key, shuffled alternatives, hold gestures for capitals and accented characters, and hold actions for deletion and reset. Digit-only input uses classic T9 matching. Selection events are sent to the backend for rank logging.

## Directory guide

```text
keypad/
├── backend/            FastAPI service, preprocessing, tests, and legacy helper
├── frontend/           React 19 and Vite client
├── prediction-data/    precomputed vocabulary, context maps, and prefix trie
└── scripts/            Windows launch helpers
```

## Run the backend

From `keypad/`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
python backend/predict_server.py
```

The API listens on `http://127.0.0.1:8000` by default. Useful endpoints are:

- `GET /health`
- `GET /predict/words?context=in%20the&n=8`
- `GET /predict/prefix?prefix=pre&n=8`
- `GET /predict/digits?digits=843&n=8`
- `POST /analytics/selection`

## Run the frontend

In a second terminal:

```bash
cd keypad/frontend
npm install
npm run dev
```

The frontend reads `VITE_PREDICTOR_URL` and otherwise defaults to `http://127.0.0.1:8000`. For a production check, run `npm run build`.

On Windows, `scripts/start_all.ps1` creates the keypad virtual environment, optionally installs backend dependencies, starts the API, writes the frontend backend URL, and launches Vite. `scripts/start_backend.bat` starts only the API.

## Prediction model

Runtime prediction is deterministic and local; it does not call a language model. The backend prefers a two-word trigram context, falls back to a one-word bigram context, and finally uses global word frequency. Prefix and T9 completion use the cached prefix trie in `prediction-data/`.

To rebuild the runtime pickles after changing the JSON maps:

```bash
python backend/precompute_topn.py
```

## Verification

```bash
python3 -m unittest discover -s backend/tests -v
cd frontend && npm run build
```
