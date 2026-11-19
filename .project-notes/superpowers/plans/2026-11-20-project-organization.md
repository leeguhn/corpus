# Project Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the repository into an understandable corpus-building subsystem and keypad-prototype subsystem without changing application behavior or data.

**Architecture:** Offline generation and n-gram preparation will live in `corpus-building/`; the FastAPI prediction service, runtime artifacts, React client, and launch scripts will live in `keypad/`. Documentation will explain the handoff from generated corpus data to the runtime predictor.

**Tech Stack:** Python 3.10+, FastAPI, React 19, Vite 7, pickle/JSON n-gram artifacts

**Spec:** `.project-notes/superpowers/specs/2026-11-20-project-organization-design.md`

## Global Constraints

- Preserve existing generated corpora, source books, JSON maps, and prediction pickles.
- Do not change prediction algorithms or the keypad interaction design.
- Keep the backend default at `127.0.0.1:8000` and the frontend default at Vite's development server.
- Keep Windows launch helpers operational from their new location.

## Review Focus

- Python imports must resolve when commands are run exactly as documented.
- Backend artifact paths must remain independent of the caller's working directory.
- Frontend environment configuration must still point to the selected backend port.
- Launch scripts must handle their nested location without relying on the old root layout.
- No generated corpus or prediction artifact may be lost during moves.

---

### Task 1: Establish subsystem boundaries

**Files:**
- Move: corpus generation sources, books, prompts, generated runs, and generator requirements into `corpus-building/`
- Move: prediction backend, runtime artifacts, React app, and launch helpers into `keypad/`
- Remove: `.DS_Store` and `__pycache__/` artifacts

**Interfaces:**
- Produces: stable top-level boundaries consumed by documentation and launch commands

- [x] Move tracked files with `git mv`, preserving history.
- [x] Confirm the top level contains only `README.md`, `corpus-building/`, and `keypad/` as visible project content.
- [x] Compare moved data-file counts and sizes with the pre-move inventory.

### Task 2: Repair paths and startup behavior

**Files:**
- Modify: `keypad/backend/predict_server.py`
- Modify: `keypad/backend/precompute_topn.py`
- Modify: `keypad/backend/predict.py`
- Modify: `keypad/scripts/start_all.ps1`
- Modify: `keypad/scripts/start_backend.bat`
- Modify: corpus-building scripts containing old absolute or relative paths
- Create: `keypad/backend/requirements.txt`

**Interfaces:**
- Consumes: prediction artifacts in `keypad/prediction-data/`
- Produces: backend endpoints on port 8000 and a Vite frontend configured with `VITE_PREDICTOR_URL`

- [x] Update backend artifact discovery to use paths anchored to each script.
- [x] Update preprocessing output discovery for the new frontend and prediction-data locations.
- [x] Update launch helpers to resolve the project root from `keypad/scripts/`.
- [x] Replace machine-specific corpus paths with paths relative to the script.
- [x] Compile Python sources and build the React client.

### Task 3: Write newcomer documentation and verify the repository

**Files:**
- Create: `README.md`
- Create: `corpus-building/README.md`
- Create: `keypad/README.md`
- Create: focused data notes only where provenance or regeneration needs explanation

**Interfaces:**
- Produces: setup, architecture, data-flow, and command documentation for a reader with no prior context

- [x] Document the offline-to-runtime data flow in the root README.
- [x] Document corpus sources, generation options, outputs, and active versus legacy utilities.
- [x] Document backend endpoints, frontend interactions, setup, and startup commands.
- [x] Run documented smoke checks, inspect `git diff --check`, and review the final tree for clarity.
