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
- leading entry targets
- pointer entry targets
- boundary/leading match semantics

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
- `slash-items/index.js`
- `slash-item-settings-ui.js`

These are higher-level feature policies built on top of the transforms.

`widget-actions.js` is the shared widget orchestration layer:

- adjacent-widget entry
- widget deletion
- widget target application / entry intent

`slash-items/index.js` and `slash-item-settings-ui.js` form the shared settings/gear layer:

- active settings item resolution
- shared settings-item schema
- update/delete dispatch
- shared gear/popup lifecycle

Important architectural split:

- `widget`
  - document-level editor widget
  - delete through shared widget deletion
- `math-widget`
  - structure inside a math field
  - delete through shared math-structure deletion while preserving enclosing math

### Adapter / Composition

- `math-node-view.js`
- `controller.js`

`math-node-view.js` is the MathLive adapter layer.

It also owns math-widget-specific settings behavior for focused math structures:

- resolving active math-widget settings items
- updating math-widget settings
- deleting math widgets via math-structure helpers

`controller.js` is still the main composition/runtime entry point, but its role is shifting toward orchestration rather than housing feature logic.

See `docs/widget-refactor.md` for the current widget-specific design and invariants.
See `AGENT_SCHEMA.md` for the canonical settings-item schema and delete/update dispatch rules.

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
