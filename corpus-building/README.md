# Corpus Building

This directory contains the offline tools and source material used to create English n-gram datasets. It supports two workflows: generating conversational text with a local language model, and deriving keypad lookup maps from checked-in source texts.

## Directory guide

```text
corpus-building/
├── data/               generated runs, including raw text and n-gram tables
├── docs/               detailed generation notes
├── prompts/            reusable language-model prompts
├── source-texts/       public-domain books used by the map builder
├── src/                generation, cleaning, and conversion scripts
└── requirements.txt    Python dependencies for corpus generation
```

`data/garbage/` contains retained trial runs. The named `100000_0` and `1000000_0` directories contain the substantial generated corpora.

## Environment

Run commands from this directory so generated output lands under `data/`:

```bash
cd corpus-building
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

On Windows, activate the environment with `.venv\Scripts\activate`.

## Generate conversational text

`src/generate_corpus.py` can use either a Hugging Face-compatible local model or an LM Studio-compatible completion endpoint. It cleans the output and writes raw text, bigram tables, trigram tables, and the exact prompt into a timestamped run directory.

```bash
python src/generate_corpus.py \
  --api-url http://127.0.0.1:1234/v1/completions \
  --api-model gpt-oss-20b \
  --prompt-preset daily_conversation \
  --target-words 100000
```

For parallel short-snippet generation, use:

```bash
python src/snippets_pipeline.py --target-words 100000 --workers 6
```

See [`docs/generating-corpora.md`](docs/generating-corpora.md) for all generation options.

## Rebuild the keypad's prediction maps

`src/build_prediction_maps.py` reads every `.txt` file in `source-texts/` and writes four JSON lookup maps to `../keypad/frontend/public/`:

```bash
python src/build_prediction_maps.py
python ../keypad/backend/precompute_topn.py
```

The second command converts the word maps into compact runtime pickles under `../keypad/prediction-data/`. Existing files are overwritten, so keep the checked-in versions if you only want to run the current prototype.

## Script status

The recommended entry points are `generate_corpus.py`, `snippets_pipeline.py`, and `build_prediction_maps.py`. `snippets.py`, `automated_snippet_generator.py`, and `generate_snippets.py` are earlier experimental variants retained for reference; they are not needed to run the keypad.
