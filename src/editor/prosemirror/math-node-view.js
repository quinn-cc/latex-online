import { MATH_FONT_FAMILY_VARIABLES } from "../../core/config.js";
import {
  getTextFontSizePx,
  normalizeMathFontFamily,
  normalizeMathFontSize,
  normalizeTextFontSize,
} from "./options.js";

let mathNodeViewInstanceCounter = 0;

class MathNodeView {
  constructor(node, view, getPos, options, variant = "inline") {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.options = options;
    this.variant = variant;
    this.instanceId = ++mathNodeViewInstanceCounter;
    this.isRemoving = false;
    this.isFocused = false;
    this.isMounted = false;
    this.isDestroyed = false;
    this.pendingExitDirection = null;
    this.isExiting = false;
    this.pendingFocusEdge = null;
    this.pendingFocusAttempts = 0;
    this.pendingFocusFrame = 0;

    const isInlineVariant = variant === "inline";
    const isGridVariant = variant === "align" || variant === "gather";
    const domClassName = variant === "display"
      ? "pm-display-math"
      : variant === "align"
        ? "pm-align-math"
        : variant === "gather"
          ? "pm-gather-math"
        : "pm-inline-math";
    const domTagName = isInlineVariant ? "span" : isGridVariant ? "td" : "div";

    this.dom = document.createElement(domTagName);
    this.dom.className = domClassName;
    this.dom.contentEditable = "false";
    this.dom.setAttribute("data-math-id", node.attrs.id);

    this.mathField = new options.MathfieldElementClass();
    this.mathField.defaultMode = "math";
    this.mathField.smartMode = false;
    this.mathField.mathVirtualKeyboardPolicy = "manual";
    this.mathField.popoverPolicy = "off";
    this.mathField.environmentPopoverPolicy = "off";
    this.mathField.setAttribute(
      "aria-label",
      variant === "display"
        ? "Display math"
        : variant === "align"
          ? "Align math"
          : variant === "gather"
            ? "Gather math"
          : "Inline math"
    );

    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleFocus = this.handleFocus.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.handleBeforeInput = this.handleBeforeInput.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleMoveOut = this.handleMoveOut.bind(this);
    this.handleMount = this.handleMount.bind(this);
    this.handleUnmount = this.handleUnmount.bind(this);

    this.dom.addEventListener("mousedown", this.handleMouseDown);
    this.mathField.addEventListener("focus", this.handleFocus);
    this.mathField.addEventListener("blur", this.handleBlur);
    this.mathField.addEventListener("focusin", this.handleFocus);
    this.mathField.addEventListener("focusout", this.handleBlur);
    this.mathField.addEventListener("beforeinput", this.handleBeforeInput);
    this.mathField.addEventListener("input", this.handleInput);
    this.mathField.addEventListener("change", this.handleInput);
    this.mathField.addEventListener("keydown", this.handleKeyDown, true);
    this.mathField.addEventListener("move-out", this.handleMoveOut);
    this.mathField.addEventListener("mount", this.handleMount);
    this.mathField.addEventListener("unmount", this.handleUnmount);

    this.dom.append(this.mathField);
    this.draftAttrs = { ...node.attrs };
    this.syncFromNode(node);
    this.options.registerMathView(node.attrs.id, this);
    this.options.debug?.("math.nodeView.create", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      latex: this.node.attrs.latex,
      activeElement: document.activeElement,
    });
  }

  update(node) {
    if (node.type !== this.node.type) {
      return false;
    }

    const previousNode = this.node;

    if (node.attrs.id !== this.node.attrs.id) {
      this.options.unregisterMathView(this.node.attrs.id, this);
      this.options.registerMathView(node.attrs.id, this);
    }

    this.node = node;
    if (!this.isFocused) {
      this.draftAttrs = { ...node.attrs };
    } else {
      this.draftAttrs = {
        ...node.attrs,
        ...this.draftAttrs,
      };
    }
    this.syncFromNode(node);
    this.options.debug?.("math.nodeView.update", {
      instanceId: this.instanceId,
      id: node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      previousLatex: previousNode.attrs.latex,
      nextLatex: node.attrs.latex,
      draftLatex: this.draftAttrs.latex,
      isFocused: this.isFocused,
      activeElement: document.activeElement,
      fieldValue: this.mathField.getValue(),
    });
    return true;
  }

  selectNode() {
    this.dom.classList.add("is-selected");
  }

  deselectNode() {
    this.dom.classList.remove("is-selected");
  }

  stopEvent(event) {
    return this.dom.contains(event.target);
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.isDestroyed = true;
    this.cancelPendingFocus();
    this.dom.removeEventListener("mousedown", this.handleMouseDown);
    this.mathField.removeEventListener("focus", this.handleFocus);
    this.mathField.removeEventListener("blur", this.handleBlur);
    this.mathField.removeEventListener("focusin", this.handleFocus);
    this.mathField.removeEventListener("focusout", this.handleBlur);
    this.mathField.removeEventListener("beforeinput", this.handleBeforeInput);
    this.mathField.removeEventListener("input", this.handleInput);
    this.mathField.removeEventListener("change", this.handleInput);
    this.mathField.removeEventListener("keydown", this.handleKeyDown, true);
    this.mathField.removeEventListener("move-out", this.handleMoveOut);
    this.mathField.removeEventListener("mount", this.handleMount);
    this.mathField.removeEventListener("unmount", this.handleUnmount);
    this.options.unregisterMathView(this.node.attrs.id, this);
    this.options.debug?.("math.nodeView.destroy", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      activeElement: document.activeElement,
    });
  }

  focusAtEdge(edge = "start") {
    this.pendingFocusEdge = edge;
    this.pendingFocusAttempts = 0;
    this.options.debug?.("math.focusAtEdge.request", {
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      edge,
      variant: this.variant,
      isMounted: this.isMounted,
      domConnected: this.dom.isConnected,
      mathFieldConnected: this.mathField.isConnected,
    });
    this.schedulePendingFocus();
  }

  syncFromNode(node) {
    const fontFamily = normalizeMathFontFamily(this.draftAttrs.fontFamily);
    const fontSize = normalizeMathFontSize(this.draftAttrs.fontSize);
    const baseTextFontSize = normalizeTextFontSize(this.draftAttrs.baseTextFontSize);

    this.dom.setAttribute("data-math-id", node.attrs.id);
    this.dom.dataset.baseTextFontSize = baseTextFontSize;
    this.dom.dataset.mathFontFamily = fontFamily;
    this.dom.dataset.mathFontSize = fontSize;
    this.dom.style.fontSize = `${getTextFontSizePx(baseTextFontSize)}px`;

    if (this.mathField.getValue() !== this.draftAttrs.latex) {
      this.mathField.value = this.draftAttrs.latex;
    }

    this.mathField.setAttribute("data-math-font-family", fontFamily);
    this.mathField.setAttribute("data-math-font-size", fontSize);

    const fontFamilyVariable = MATH_FONT_FAMILY_VARIABLES[fontFamily];

    if (fontFamilyVariable) {
      this.mathField.style.setProperty("--text-font-family", fontFamilyVariable);
    } else {
      this.mathField.style.removeProperty("--text-font-family");
    }

    this.mathField.style.fontSize = `${fontSize}em`;
  }

  handleMouseDown(event) {
    this.options.debug?.("math.mouseDown", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      target: event.target,
      activeElement: document.activeElement,
    });
    this.options.selectMathNode?.(this.getPos());

    if (event.target === this.dom) {
      event.preventDefault();
      this.focusAtEdge("start");
    }
  }

  handleMount() {
    this.isMounted = true;
    this.options.debug?.("math.mount", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      domConnected: this.dom.isConnected,
      mathFieldConnected: this.mathField.isConnected,
    });
    this.schedulePendingFocus();
  }

  handleUnmount() {
    this.isMounted = false;
    this.cancelPendingFocus();
    this.options.debug?.("math.unmount", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
    });
  }

  handleFocus() {
    if (this.isFocused) {
      return;
    }

    this.isRemoving = false;
    this.isFocused = true;
    this.pendingExitDirection = null;
    this.dom.classList.add("is-focused");
    this.options.debug?.("math.focus", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      activeElement: document.activeElement,
      value: this.mathField.getValue(),
      position: this.mathField.position,
      lastOffset: this.mathField.lastOffset,
    });
    this.options.handleMathFocus(this.node.attrs.id, this.getPos());
  }

  handleBlur() {
    if (!this.isFocused) {
      return;
    }

    this.isFocused = false;

    if (this.isExiting) {
      this.isExiting = false;
      this.pendingExitDirection = null;
      this.dom.classList.remove("is-focused");
      this.options.debug?.("math.blur.skipExit", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        activeElement: document.activeElement,
      });
      return;
    }

    this.options.debug?.("math.blur.start", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      activeElement: document.activeElement,
      value: this.mathField.getValue(),
      pendingExitDirection: this.pendingExitDirection,
    });

    if (this.isRemoving) {
      this.dom.classList.remove("is-focused");
      this.options.debug?.("math.blur.skipRemoving", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
      });
      return;
    }

    requestAnimationFrame(() => {
      this.dom.classList.remove("is-focused");

      if (!this.dom.isConnected) {
        return;
      }

      const exitDirection = this.pendingExitDirection;
      this.pendingExitDirection = null;
      this.options.debug?.("math.blur", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        exitDirection,
        value: this.mathField.getValue(),
        activeElement: document.activeElement,
      });

      if (!isGridMathVariant(this.variant) && this.mathField.getValue().trim() === "") {
        this.options.removeMathNode(this.getPos(), exitDirection ?? "after");
        return;
      }

      this.commitDraft();

      if (exitDirection) {
        this.options.exitMathNode(this.getPos(), exitDirection);
        return;
      }

      this.options.handleMathBlur(this.node.attrs.id, this.getPos());
    });
  }

  handleBeforeInput(event) {
    if (!this.options.shouldDebugLog?.("math.beforeinput")) {
      return;
    }

    this.options.debug?.("math.beforeinput", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      inputType: event.inputType,
      data: event.data,
      defaultPrevented: event.defaultPrevented,
      value: this.mathField.getValue(),
      activeElement: document.activeElement,
    });
  }

  handleInput() {
    const fieldValue = this.mathField.getValue();
    this.draftAttrs = {
      ...this.draftAttrs,
      latex: fieldValue,
    };
    if (this.options.shouldDebugLog?.("math.input")) {
      this.options.debug?.("math.input", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        value: fieldValue,
        nodeLatexBefore: this.node.attrs.latex,
        draftLatex: this.draftAttrs.latex,
        activeElement: document.activeElement,
        position: this.mathField.position,
        lastOffset: this.mathField.lastOffset,
      });
      this.options.debug?.("math.input.draftUpdated", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        didUpdate: false,
        nodeLatexAfter: this.node.attrs.latex,
        activeElement: document.activeElement,
        value: this.mathField.getValue(),
      });
    }
  }

  handleKeyDown(event) {
    if (this.options.shouldDebugLog?.("math.keydown")) {
      this.options.debug?.("math.keydown", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        value: this.mathField.getValue(),
        position: this.mathField.position,
        lastOffset: this.mathField.lastOffset,
        selectionIsCollapsed: this.mathField.selectionIsCollapsed,
      });
    }

    if (
      isGridMathVariant(this.variant) &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.isComposing &&
      event.key === "Enter"
    ) {
      if (event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const shiftEnterHandler = this.variant === "align"
          ? this.options.handleAlignShiftEnter
          : this.options.handleGatherShiftEnter;
        shiftEnterHandler?.(this.getPos(), this.getDraftPatch());
        return;
      }

      if (this.mathField.mode === "latex") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const enterHandler = this.variant === "align"
        ? this.options.handleAlignEnter
        : this.options.handleGatherEnter;
      enterHandler?.(this.getPos(), this.getDraftPatch());
      return;
    }

    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.isComposing &&
      (event.key === "$" || event.key === "Escape")
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.requestExit("after");
      return;
    }

    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      this.mathField.getValue().trim() === ""
    ) {
      event.preventDefault();
      event.stopPropagation();

      if (isGridMathVariant(this.variant)) {
        this.requestExit(event.key === "Backspace" ? "before" : "after");
        return;
      }

      this.removeEmptyMath(event.key === "Backspace" ? "before" : "after");
      return;
    }

    if (
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key === "ArrowLeft" &&
      this.mathField.selectionIsCollapsed &&
      this.mathField.position === 0
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.requestExit("before");
      return;
    }

    if (
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key === "ArrowRight" &&
      this.mathField.selectionIsCollapsed &&
      this.mathField.position === this.mathField.lastOffset
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.requestExit("after");
      return;
    }

    if (
      this.variant === "display" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key === "ArrowUp"
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.requestExit("before");
      return;
    }

    if (
      this.variant === "display" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.requestExit("after");
    }
  }

  handleMoveOut(event) {
    this.options.debug?.("math.moveOut", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      direction: event.detail.direction,
    });

    if (event.detail.direction === "forward") {
      event.preventDefault();
      event.stopPropagation();
      this.requestExit("after");
      return;
    }

    if (event.detail.direction === "backward") {
      event.preventDefault();
      event.stopPropagation();
      this.requestExit("before");
    }
  }

  requestExit(direction) {
    if (this.pendingExitDirection || this.isExiting) {
      this.options.debug?.("math.requestExit.ignored", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        direction,
        pendingExitDirection: this.pendingExitDirection,
      });
      return;
    }

    this.pendingExitDirection = direction;
    this.isExiting = true;
    this.dom.classList.remove("is-focused");
    this.options.debug?.("math.requestExit", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      direction,
      value: this.mathField.getValue(),
    });

    if (!isGridMathVariant(this.variant) && this.mathField.getValue().trim() === "") {
      const didRemove = this.options.removeMathNode(this.getPos(), direction);

      if (!didRemove) {
        this.isExiting = false;
        this.pendingExitDirection = null;
        this.dom.classList.add("is-focused");
      }

      return;
    }

    const patch = this.getDraftPatch();
    const didExit = this.options.commitAndExitMathNode(this.getPos(), direction, patch);

    if (!didExit) {
      this.isExiting = false;
      this.pendingExitDirection = null;
      this.dom.classList.add("is-focused");
    }
  }

  safeGetPos() {
    try {
      return this.getPos();
    } catch (_error) {
      return null;
    }
  }

  cancelPendingFocus() {
    if (this.pendingFocusFrame) {
      clearTimeout(this.pendingFocusFrame);
      this.pendingFocusFrame = 0;
    }
  }

  schedulePendingFocus() {
    if (!this.pendingFocusEdge || this.pendingFocusFrame || this.isDestroyed) {
      return;
    }

    this.pendingFocusFrame = window.setTimeout(() => {
      this.pendingFocusFrame = 0;
      this.applyPendingFocus();
    }, 0);
  }

  applyPendingFocus() {
    if (!this.pendingFocusEdge || this.isDestroyed) {
      return;
    }

    if (!this.dom.isConnected || !this.mathField.isConnected || !this.isMounted) {
      this.options.debug?.("math.focusAtEdge.waiting", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        edge: this.pendingFocusEdge,
        isMounted: this.isMounted,
        domConnected: this.dom.isConnected,
        mathFieldConnected: this.mathField.isConnected,
      });
      return;
    }

    const edge = this.pendingFocusEdge;
    this.pendingFocusEdge = null;

    try {
      this.mathField.focus({ preventScroll: true });
    } catch (error) {
      this.pendingFocusEdge = edge;
      this.options.debug?.("math.focusAtEdge.error", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        edge,
        message: error instanceof Error ? error.message : String(error),
      });
      this.schedulePendingFocus();
      return;
    }

    try {
      const keyboardSink = this.mathField.shadowRoot?.querySelector(
        '[part="keyboard-sink"]'
      );

      if (keyboardSink instanceof HTMLElement && !this.isFocused) {
        keyboardSink.focus({ preventScroll: true });
      }

      this.mathField.position = edge === "start" ? 0 : this.mathField.lastOffset;
      this.options.debug?.("math.focusAtEdge.applied", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        edge,
        activeElement: document.activeElement,
        keyboardSinkActive:
          this.mathField.shadowRoot?.activeElement?.getAttribute?.("part") ?? null,
      });

      if (!this.isFocused) {
        if (this.pendingFocusAttempts < 4) {
          this.pendingFocusAttempts += 1;
          this.pendingFocusEdge = edge;
          this.options.debug?.("math.focusAtEdge.retry", {
            instanceId: this.instanceId,
            id: this.node.attrs.id,
            pos: this.safeGetPos(),
            variant: this.variant,
            edge,
            pendingFocusAttempts: this.pendingFocusAttempts,
          });
          this.schedulePendingFocus();
          return;
        }

        this.options.debug?.("math.focusAtEdge.syntheticFocus", {
          instanceId: this.instanceId,
          id: this.node.attrs.id,
          pos: this.safeGetPos(),
          variant: this.variant,
          edge,
        });
        this.handleFocus();
      }
    } catch (error) {
      this.options.debug?.("math.focusAtEdge.positionError", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        edge,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  removeEmptyMath(direction) {
    if (this.isRemoving) {
      this.options.debug?.("math.removeEmptyMath.ignored", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        direction,
      });
      return;
    }

    this.isRemoving = true;
    this.isExiting = false;
    this.pendingExitDirection = null;
    this.dom.classList.remove("is-focused");
    this.options.debug?.("math.removeEmptyMath", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      direction,
      activeElement: document.activeElement,
    });
    this.options.removeMathNode(this.getPos(), direction);
  }

  appendText(text) {
    const nextLatex = `${this.draftAttrs.latex ?? ""}${text}`;
    this.draftAttrs = {
      ...this.draftAttrs,
      latex: nextLatex,
    };
    this.syncFromNode(this.node);
    if (this.options.shouldDebugLog?.("math.appendText")) {
      this.options.debug?.("math.appendText", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        text,
        nextLatex,
        isFocused: this.isFocused,
      });
    }
  }

  applyDraftPatch(patch) {
    this.draftAttrs = {
      ...this.draftAttrs,
      ...patch,
    };
    this.syncFromNode(this.node);
    this.options.debug?.("math.applyDraftPatch", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      patch,
      draftAttrs: { ...this.draftAttrs },
    });
  }

  getDraftPatch() {
    const patch = {};

    for (const key of ["latex", "fontFamily", "fontSize", "baseTextFontSize"]) {
      if (this.draftAttrs[key] !== this.node.attrs[key]) {
        patch[key] = this.draftAttrs[key];
      }
    }

    return patch;
  }

  commitDraft() {
    const patch = this.getDraftPatch();

    if (Object.keys(patch).length === 0) {
      return false;
    }

    const didCommit = this.options.commitMathNode(this.getPos(), patch);
    this.options.debug?.("math.commitDraft", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      patch,
      didCommit,
    });
    return didCommit;
  }
}

function isGridMathVariant(variant) {
  return variant === "align" || variant === "gather";
}

export class InlineMathNodeView extends MathNodeView {
  constructor(node, view, getPos, options) {
    super(node, view, getPos, options, "inline");
  }
}

export class DisplayMathNodeView extends MathNodeView {
  constructor(node, view, getPos, options) {
    super(node, view, getPos, options, "display");
  }
}

export class AlignMathNodeView extends MathNodeView {
  constructor(node, view, getPos, options) {
    super(node, view, getPos, options, "align");
  }
}

export class GatherMathNodeView extends MathNodeView {
  constructor(node, view, getPos, options) {
    super(node, view, getPos, options, "gather");
  }
}
