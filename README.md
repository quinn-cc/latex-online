# Latex Online

Browser-based LaTeX editor built on ProseMirror with MathLive-backed math widgets, local persistence, and an optional local account/document backend.

## Bootstrap

Run the project bootstrap once after cloning:

```bash
./scripts/bootstrap.sh
```

What it does:
- creates `.venv` if missing
- installs Python dependencies used by the local server
- runs `npm install`

## Run

Start the local app server:

```bash
./run.sh
```

Or with an explicit port:

```bash
./run.sh 4179
```

Default URL:

```text
http://127.0.0.1:4173
```

## Project Layout

- `app.js`: top-level composition root
- `server.py`: local static/API server and SQLite-backed auth/document API
- `src/core/`: app shell, storage, document library UI/controllers
- `src/editor/prosemirror/`: editor schema, controller, widgets, math interactions
- `scripts/`: local maintenance/bootstrap scripts
- `smoke-*.html`: browser smoke tests

## Editor Architecture

The editor is now split along four main seams:

- `widget-registry.js`: widget traits and classification
- `transforms/`: pure structural document transforms
- `interactions/`: transient math session state and math navigation intent
- feature action modules:
  - `table-actions.js`
  - `math-grid-actions.js`

`controller.js` still assembles the runtime, but widget and math behavior is no longer concentrated in one file.

See [`docs/architecture.md`](./docs/architecture.md) for the current module map.

## Smoke Tests

Useful focused smokes:

```bash
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-grid-tab-flow.html
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-math-tab-exit.html
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-block-widget-command-split.html
```

Expected result is `data-result="pass"` in the dumped DOM.

## Notes

- The local backend stores data under `data/latex-online.sqlite3`.
- This repo currently assumes a local/dev workflow, not a production deployment stack.
