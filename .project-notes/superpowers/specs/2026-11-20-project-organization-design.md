# Project Organization Design

## Intent

Make the repository understandable to a newcomer by presenting two primary areas: building the language corpus and running the predictive keypad prototype.

## Goals

- Keep only `README.md`, `corpus-building/`, and `keypad/` as the meaningful top-level project entries, aside from repository metadata.
- Preserve all useful source text, generated corpora, prediction artifacts, and application behavior.
- Explain the overall system in the root README and each subsystem in its own README.
- Repair imports and startup paths after files move.

## Non-goals

- Redesigning the predictor, API, or keypad interface.
- Changing model output, n-gram algorithms, or prediction ranking.
- Introducing a new packaging system or deployment platform.

## Approach

Physically move files into responsibility-based directories instead of adding facade folders over the old layout. Corpus generators, cleaning code, prompts, source books, and generated runs live under `corpus-building/`. The FastAPI service, precomputed runtime data, React client, and launch helpers live under `keypad/`. Clearly disposable macOS and Python cache artifacts are removed.

This is preferred over leaving files in place because facade folders would retain confusing cross-root dependencies and would not make ownership clear.

## Constraints

- Existing generated datasets and pickles remain unchanged.
- The backend continues to locate prediction artifacts relative to its own file.
- The frontend remains a Vite project and continues to read `VITE_PREDICTOR_URL`.
- Documentation distinguishes offline corpus construction from runtime prediction.
