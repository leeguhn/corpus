# Predictive Keypad and Corpus Toolkit

This repository contains two related projects:

- [`corpus-building/`](corpus-building/) creates and processes English text corpora.
- [`keypad/`](keypad/) runs a predictive text-entry prototype with a compact 3×3 keypad.

The keypad is a research prototype rather than a general-purpose keyboard. It surrounds a central control with eight changing letter or word suggestions. A FastAPI service supplies completions from precomputed n-gram data; a React client displays and records selections.

## How the parts relate

```text
source texts                         generated conversational text
     │                                           │
     ▼                                           ▼
build_prediction_maps.py                  generate_corpus.py
     │                                           │
     ▼                                           ▼
keypad/frontend/public/*.json       corpus-building/data/<run>/
     │
     ▼
keypad/backend/precompute_topn.py
     │
     ▼
keypad/prediction-data/*.pkl
     │
     ▼
FastAPI predictor ───────────────► React radial keypad
```

These are currently two distinct corpus workflows. The source-text workflow rebuilds the JSON and pickle files used by the keypad. The language-model workflow produces raw text plus bigram and trigram tables under `corpus-building/data/`; it is useful for corpus experiments but is not automatically connected to the runtime predictor.

## Start here

To run the existing keypad, follow [`keypad/README.md`](keypad/README.md). To generate or rebuild language data, follow [`corpus-building/README.md`](corpus-building/README.md).

Large generated data and precomputed prediction files are intentionally included so the project can be inspected without regenerating a million-word corpus.
