# Architecture

## Runtime Shape

The app has three main layers:

- app shell and document management in `src/core/`
- editor runtime in `src/editor/prosemirror/`
- local backend in `server.py`

`app.js` is the composition root for the browser app.

## Editor Boundaries

The ProseMirror editor is split into these responsibilities:

### Registry

- `widget-registry.js`

Defines widget traits such as:

- full-line
- grid
- math-backed
- has-settings

### Interactions

- `interactions/math-session.js`
- `interactions/math-navigation.js`

These own transient math interaction state and key/navigation intent.

### Transforms

- `transforms/full-line-widgets.js`
- `transforms/math-structural.js`
- `transforms/grid-structural.js`

These build pure document transactions and selection moves without owning runtime side effects.

### Feature Modules

- `table-actions.js`
- `math-grid-actions.js`
- `backslash-commands/*`

These are higher-level feature policies built on top of the transforms.

### Adapter / Composition

- `math-node-view.js`
- `controller.js`

`math-node-view.js` is the MathLive adapter layer.

`controller.js` is still the main composition/runtime entry point, but its role is shifting toward orchestration rather than housing feature logic.

## Backend

`server.py` currently combines:

- static file serving
- auth/session handling
- SQLite setup/migrations
- document CRUD APIs

That is acceptable for local development, but it remains the main backend split point if server scope grows.

## Current Direction

The codebase is moving toward:

1. pure transforms for structural document edits
2. explicit interaction state machines for math/widget behavior
3. feature-specific action modules instead of one large widget/controller file

The largest remaining architectural target is reducing the amount of editor-wide assembly logic still concentrated in `controller.js`.
