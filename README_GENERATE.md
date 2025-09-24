# generate_corpus.py

This script generates a large corpus (target ~1,000,000 words) using a local
Hugging Face compatible causal language model, cleans the output, tokenizes it,
and builds bigram and trigram frequency tables.

Quickstart

- Install dependencies: `pip install -r requirements.txt`
- Run generation (example):

```powershell
python generate_corpus.py --model-path PATH_TO_MODEL --target-words 1000000 \
  --chunk-words 2000 --output-raw data/raw.txt --output-ngrams data/ngrams
```

Or use an LM Studio-compatible HTTP API:

```powershell
python generate_corpus.py --api-url http://127.0.0.1:1234/v1/completions --api-model gpt-oss-20b `
  --target-words 1000000 --chunk-words 2000 --output-raw data/raw.txt --output-ngrams data/ngrams
```

Notes

- The script expects a local model directory or a model id that `transformers`
  can load. Running on CPU will be slow; prefer a CUDA-enabled PyTorch build
  and set `--device 0` for GPU.
- The script writes raw generated text incrementally to avoid memory issues,
  then reads it back to build n-grams. If you want to skip generation and only
  process an existing file, run `process_raw_to_ngrams` by editing the script
  or calling the functions from a separate wrapper.

Files produced

- Raw generated text: `--output-raw` (default `data/raw.txt`)
- N-gram CSVs: `--output-ngrams_bigram.csv.gz`, `--output-ngrams_trigram.csv.gz`
- Pickles: `--output-ngrams_bigram.pkl`, `--output-ngrams_trigram.pkl`
- The exact prompt used for generation is saved as `prompt.txt` alongside outputs

Adjustable parameters

- `--chunk-words`: approximate number of words to request per generation chunk
- `--temperature`, `--top-p`, `--top-k`: sampling parameters
- `--api-url`, `--api-model`: use an external API instead of a local model
- `--prompt`: inline prompt text (highest precedence)
- `--prompt-file`: path to a file containing the full prompt text
- `--prompt-preset`: built-in presets, currently: `daily_conversation`
  - Example: `--prompt-preset daily_conversation`
  - Example: `--prompt-file prompts/daily_conversation.txt`

Compatibility

- Python 3.10+
- Pip-installable dependencies in `requirements.txt`

Output directory structure

- Each run creates a timestamped folder under `--data-dir` (default `data/`).
- Outputs including `raw.txt`, n-gram files, and `prompt.txt` are written inside that folder.
