# Next Agent Bootstrap

## Start

Bootstrap once:

```bash
./scripts/bootstrap.sh
```

Run the local server on the widget smoke port:

```bash
./run.sh 4179
```

Open:

```text
http://127.0.0.1:4179
```

## Read First

If you are continuing widget/editor work, read these first:

- `AGENT_SCHEMA.md`
- `docs/widget-refactor.md`
- `docs/architecture.md`
- `src/editor/prosemirror/widget-registry.js`
- `src/editor/prosemirror/widget-actions.js`
- `src/editor/prosemirror/slash-items/index.js`
- `src/editor/prosemirror/slash-item-settings-ui.js`
- `src/editor/prosemirror/math-node-view.js`
- `src/editor/prosemirror/interactions/math-session.js`
- `src/editor/prosemirror/table-actions.js`
- `src/editor/prosemirror/math-grid-actions.js`
- `src/editor/prosemirror/transforms/full-line-widgets.js`

## Current System Model

Use this model when deciding where code belongs:

- `widget-registry.js`
  - widget capabilities
  - leading/boundary/pointer entry semantics
- `widget-actions.js`
  - shared widget entry/deletion orchestration
- `slash-items/index.js`
  - shared settings-item schema
  - category-aware update/delete dispatch
- `slash-item-settings-ui.js`
  - shared gear overlay and popup lifecycle
- `table-actions.js` / `math-grid-actions.js`
  - widget-family traversal and feature policies
- `transforms/`
  - pure document edits
- `math-node-view.js`
  - DOM/MathLive adapter
  - math-widget settings/update/delete behavior
- `controller.js`
  - wiring and orchestration

## Settings Schema

Use this split consistently:

- `widget`
  - document-level widget
  - examples: `table`, `align`, `gather`
  - delete removes the whole widget
- `math-widget`
  - structure inside math mode
  - examples: `cases`, `matrix`
  - delete removes only the structure and preserves the enclosing math node

The gear UI stays shared across both categories.

## Guardrails

- Do not add widget-specific hotfix branches to `controller.js` if the behavior can be expressed through registry hooks or shared widget actions.
- Treat "which target do we enter?" separately from "how do we enter it?".
- Use shared whole-widget deletion for whole-widget removal.
- Keep the gear UI universal; branch by slash-item category, not by widget name in the overlay layer.
- Do not delete the enclosing `inline_math` node when the user deletes a math widget like `cases` or `matrix`.
- Keep pointer-entry policy out of `math-node-view.js`.
- Keep shared math-field caret/selection styling centralized.

## Refactor State

These behaviors are already normalized and should stay that way:

- adjacent-widget boundary entry
- shared whole-widget deletion
- deleting a widget from its leading element
- Tab / Shift+Tab select-all entry into widget elements
- collapsed arrow/boundary entry
- pointer entry to exact math offsets
- visible end-of-field caret room for editor-owned math widgets
- shared gear visibility, lifecycle, apply behavior, and scroll anchoring
- category-aware delete from the shared gear UI

## Focused Smokes

Run these after widget work:

```bash
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-widget-boundary-shared.html
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-widget-boundary-containers.html
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-widget-leading-backspace.html
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-grid-tab-flow.html
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-widget-pointer-entry.html
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-cases-settings.html
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-settings-gear-visibility.html
/snap/bin/chromium --headless --disable-gpu --virtual-time-budget=12000 --dump-dom http://127.0.0.1:4179/smoke-settings-gear-scroll-anchor.html
```

Expected result:

```text
data-result="pass"
```

## Good Next Work

If continuing the widget refactor, likely next targets are:

- moving traversal order behind registry hooks for future widget families
- expanding negative smoke coverage around pointer/selection transitions
- reducing remaining runtime assembly in `controller.js`
- adding new widgets by defining registry hooks first, then filling in family-specific traversal
- expanding the `math-widget` category if more math-internal structures get shared settings
