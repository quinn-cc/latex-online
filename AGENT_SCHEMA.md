# Agent Schema

## Purpose

This file is the canonical schema/handoff reference for widget and settings work.

Use it together with:

- `docs/widget-refactor.md`
- `docs/architecture.md`
- `NEXT_AGENT.md`

## Core Entity Types

### Widget

A `widget` is a document-level ProseMirror construct.

Examples:

- `table`
- `align`
- `gather`

Properties:

- it has a stable document `pos`
- deleting it removes the whole widget from the editor document
- boundary entry and leading-entry semantics are owned by `widget-registry.js`

### Math Widget

A `math-widget` is a structure inside a math field.

Examples:

- `cases`
- `matrix`

Properties:

- it belongs to an enclosing math node identified by `mathId`
- deleting it removes only the structure, not the enclosing `inline_math`
- focus/update/delete behavior is owned by math-structure helpers and `math-node-view.js`

### Settings Item

A settings item is the shared gear target shape used by the overlay.

The overlay should not care whether the item came from a document widget or a math widget beyond its category.

## Slash-Item Schema

### Widget Slash Item

Used for document widgets:

```js
{
  category: "widget",
  type,
  pos,
  source?,
  settings?
}
```

### Math-Widget Slash Item

Used for math-internal structures:

```js
{
  category: "math-widget",
  type,
  source: "math-structure",
  mathId,
  pos,
  settings,
  anchorRowIndex,
  anchorColumnIndex,
  anchorRange,
  environmentRange
}
```

Notes:

- `pos` is still useful for locating the enclosing editor math node.
- `mathId` identifies the owning math node view.
- `anchorRange` and `environmentRange` are MathLive model offsets, not ProseMirror positions.

## Shared Gear Contract

The settings gear/popup is universal across widget families.

It owns:

- active item rendering
- overlay anchoring
- panel open/close lifecycle
- apply button behavior
- delete button behavior

It should not own:

- widget-specific delete logic
- math-structure mutation logic
- one-off branches for `cases` vs `matrix` vs `table`

## Dispatch Rules

### Update

- `controller.updateSlashItemSettings(item, settings)`
- widget items resolve through slash-item definitions for document widgets
- math-widget items resolve through `math-node-view.js` and math-array helpers

### Delete

- `category: "widget"`
  - route through shared widget deletion
  - current path: `controller.deleteWidgetAt(...)`
- `category: "math-widget"`
  - route through shared math-structure deletion
  - current path: `controller.deleteMathStructureItem(...)`

Rule of thumb:

- if the user means "remove the whole editor widget", use widget deletion
- if the user means "remove the structure inside math mode", use math-widget deletion

## Ownership Map

- `src/editor/prosemirror/slash-items/index.js`
  - slash-item definitions
  - category assignment
  - shared update/delete dispatch
- `src/editor/prosemirror/slash-item-settings-ui.js`
  - shared gear overlay and popup lifecycle
- `src/editor/prosemirror/widget-actions.js`
  - shared editor-widget deletion and entry orchestration
- `src/editor/prosemirror/controller.js`
  - composition layer for widget and math-widget dispatch
- `src/editor/prosemirror/math-node-view.js`
  - math-widget resolution, update, and delete hooks
- `src/editor/prosemirror/math-extensions/array-structures.js`
  - math-array update/delete primitives for `cases` and `matrix`

## Smokes That Defend This Schema

- `smoke-settings-gear-visibility.html`
  - shared gear lifecycle
  - apply closes panel
  - widget delete removes the widget
  - math-widget delete preserves enclosing inline math
- `smoke-cases-settings.html`
  - math-widget settings resolution and update
- `smoke-settings-gear-scroll-anchor.html`
  - shared overlay anchoring during scroll

## Guardrails

- Keep the gear UI universal.
- Express behavior differences through slash-item category and shared dispatch.
- Do not treat math widgets as document widgets just because they have a `pos`.
- Do not delete the enclosing math node when the user asked to delete only a math widget.
