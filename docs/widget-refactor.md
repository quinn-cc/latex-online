# Widget Refactor

## Goal

Treat widgets as one editor system instead of "math plus special cases".

The current shape is:

- widget definitions live in `widget-registry.js`
- widget entry/deletion orchestration lives in `widget-actions.js`
- pure structural document edits stay in `transforms/`
- `math-node-view.js` is a DOM/MathLive adapter, not the source of widget policy
- `controller.js` wires the modules together

## What Changed

### 1. Widget registry owns more behavior

`widget-registry.js` no longer just classifies widgets. It now also owns shared widget semantics such as:

- placement (`inline` vs `block`)
- full-line/grid/math-backed traits
- boundary entry targets
- leading entry targets
- leading-boundary matching
- pointer-entry hooks

Important idea: the "first element" inside a widget is modeled as a widget-defined leading entry target, not as hardcoded controller logic.

### 2. Whole-widget deletion is centralized

Whole-widget removal now flows through shared widget actions instead of separate table/math special cases.

The important APIs are:

- `deleteWidget(context, options)`
- `deleteWidgetAt(pos, options)`
- `removeAdjacentWidget(direction)`
- `removeLeadingWidgetFromContentPos(contentPos)`

This means the same delete path is used for:

- backspacing a widget from the paragraph next to it
- backspacing from the leading element inside the widget
- direct widget delete entry points in table/align/gather actions
- empty-grid delete behavior

Rule of thumb: if the user action should remove the entire widget, route it through shared widget deletion.

### 3. Widget entry is normalized around entry intent

Widget entry now has a shared target applicator:

- `applyWidgetEntryTarget(target, { entryMode })`

The target answers "where do we go?" and the entry mode answers "how do we enter?".

Current entry modes:

- `collapse`: regular collapsed caret/focus entry
- `tab`: select the destination element/cell on entry
- `pointer`: pointer-driven entry, usually at a specific offset

That separation is what allows:

- Tab / Shift+Tab to select the destination entry
- arrow-based entry to stay collapsed
- boundary entry to stay collapsed
- pointer entry to land at an exact math offset

### 4. Math focus handoff now carries offset and selection mode

Math focus scheduling used to only carry "start/end" edge semantics. It now carries:

- `pendingMathFocusOffset`
- `pendingMathFocusSelectionMode`

through:

- `controller.js`
- `interactions/math-session.js`
- `math-node-view.js`

That is what makes shared widget entry work for:

- Tab select-all transitions
- pointer entry at exact offsets
- delayed math focus handoff after node-view mount/reconciliation

### 5. Pointer entry is registry-owned

`math-node-view.js` now only normalizes DOM pointer information into a pointer-entry context.

It does not decide widget pointer policy directly.

The current flow is:

1. `MathNodeView` converts the mouse event into `{ offset, targetRole, isOutsideContent }`
2. `widget-actions.js` resolves the enclosing widget/content position
3. `widget-registry.js` resolves the widget-specific pointer-entry target
4. `applyWidgetEntryTarget()` applies the target

This keeps future widget-specific pointer behavior extensible without turning the node view into a policy file.

### 6. End-of-field caret visibility is normalized for editor-owned math fields

MathLive draws the caret at the end of content with a zero-width inline box and negative right margin. That can leave a logical caret in place while clipping the visual caret at the field boundary.

The fix is intentionally shared:

- every editor-owned MathLive host is marked with `data-editor-math`
- `styles.css` adds shared inline-end caret clearance on `math-field[data-editor-math="true"]::part(content)`

This is not widget-specific. It applies to all editor-owned math widgets.

### 7. Gear/settings UI is shared across widget families

The settings gear is now one shared overlay system for:

- document widgets such as `table`, `align`, and `gather`
- math-internal widgets such as `cases` and `matrix`

The shared layer owns:

- focused-item resolution
- overlay positioning
- panel lifecycle
- apply button behavior
- delete button behavior

The UI should stay generic. Widget-specific logic belongs in slash-item resolution and dispatch, not in the overlay itself.

### 8. Slash items now distinguish widgets from math widgets

The important design split is:

- `widget`
  - a document-level ProseMirror widget
  - deleting it removes the whole widget from the editor document
- `math-widget`
  - a structure inside a math field
  - deleting it removes only that structure and preserves the enclosing math node

Current examples:

- `table`, `align`, `gather` -> `category: "widget"`
- `cases`, `matrix` -> `category: "math-widget"`

This keeps the gear UI universal while allowing delete/update dispatch to stay correct.

### 9. Slash-item state now has an explicit schema

The settings system no longer assumes every active item is just `{ type, pos }`.

Current shape:

- widget slash item
  - `category: "widget"`
  - `type`
  - `pos`
  - optional `source`
  - optional `settings`
- math-widget slash item
  - `category: "math-widget"`
  - `type`
  - `source: "math-structure"`
  - `mathId`
  - `pos`
  - `settings`
  - `anchorRowIndex`
  - `anchorColumnIndex`
  - `anchorRange`
  - `environmentRange`

The shared gear flow relies on that schema for:

- update dispatch
- delete dispatch
- overlay anchoring
- focus restoration into math structures

## Current Invariants

These invariants are important. New widget work should preserve them.

- Widget deletion should be routed through shared widget deletion when the intent is "remove the whole widget".
- Gear/settings UI should remain shared across widget families.
- Slash-item behavior may branch by slash-item category (`widget` vs `math-widget`), not by one-off widget names in the UI layer.
- Deleting a math widget should preserve the enclosing math node unless the user action explicitly targets whole-math removal.
- The leading element inside a widget is registry-owned, not controller-owned.
- Entry resolution and entry behavior are separate concerns.
- Tab entry is allowed to select-all; arrow/boundary entry should remain collapsed unless there is a strong reason otherwise.
- `math-node-view.js` should normalize DOM/MathLive events, not own high-level widget policy.
- Shared MathLive host styling should live in one place and apply to all editor-owned math fields.

## Smoke Coverage

These smokes currently defend the refactor:

- `smoke-widget-boundary-shared.html`
  - shared boundary entry and adjacent-widget deletion
- `smoke-widget-boundary-containers.html`
  - widget boundaries inside list items and table cells
- `smoke-widget-leading-backspace.html`
  - deleting a widget from its leading element
- `smoke-grid-tab-flow.html`
  - Tab/Shift+Tab select-all entry vs collapsed arrow entry
- `smoke-widget-pointer-entry.html`
  - pointer entry at the end of inline/align/gather math, including visible end-caret room
- `smoke-block-widget-command-split.html`
  - full-line command insertion structure
- `smoke-full-line-widget-backward-exit.html`
  - backward exit from full-line widgets
- `smoke-backspace-widget.html`
  - deleting widgets from neighboring text context
- `smoke-backspace-math-widget.html`
  - backspace behavior around math-backed widgets
- `smoke-cases-settings.html`
  - settings state for math-array structures
- `smoke-settings-gear-visibility.html`
  - shared gear lifecycle, apply behavior, widget delete, and math-widget delete
- `smoke-settings-gear-scroll-anchor.html`
  - shared gear anchoring while the page scrolls

## Remaining Work

The refactor is in a better place, but these are still reasonable next targets:

- move next/previous element traversal fully behind widget/registry hooks if more widget families are added
- add more negative smoke coverage for pointer entry and mixed selection states
- continue shrinking controller assembly logic where behavior can live in registry/actions/transforms instead
- keep future widget additions on the shared entry/delete paths instead of reintroducing controller branches
