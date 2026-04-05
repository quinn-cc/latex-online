import { MATH_FONT_FAMILY_VARIABLES } from "../../core/config.js";
import {
  applyMathExtensions,
  expandMathExtensionMenuCommand,
  getSerializableMathLatex,
  getMathExtensionMenuState,
} from "./math-extensions/index.js";
import {
  deleteActiveMathArrayEnvironment,
  getActiveMathArrayItemState,
  getMathArrayEnvironmentRect,
  resizeActiveMathArrayEnvironment,
  toMathFieldClientRect,
} from "./math-extensions/array-structures.js";
import {
  handleMathKeyDown,
  handleMathTabNavigation,
  insertMathSpace,
  isGridMathVariant,
  moveWithinMathField,
  removeEmptyMath,
  requestMathExit,
  handoffMathArrayTab,
  selectMathArrayCell,
  deleteStructuredParentBackward,
} from "./interactions/math-navigation.js";
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
    this.pendingFocusOffset = null;
    this.pendingFocusSelectionMode = "collapse";
    this.pendingFocusAttempts = 0;
    this.pendingFocusFrame = 0;
    this.pendingBlurFrame = 0;
    this.activeSettingsItemSignature = null;

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
    this.mathField.setAttribute("data-editor-math", "true");
    this.mathField.setAttribute("data-editor-math-variant", variant);
    this.mathField.defaultMode = isInlineVariant ? "inline-math" : "math";
    this.mathField.smartMode = false;
    this.mathField.mathVirtualKeyboardPolicy = "manual";
    this.mathField.popoverPolicy = "off";
    this.mathField.environmentPopoverPolicy = "off";
    applyMathExtensions(this.mathField);
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
    this.handleMount = this.handleMount.bind(this);
    this.handleSelectionChange = this.handleSelectionChange.bind(this);
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
    this.mathField.addEventListener("mount", this.handleMount);
    this.mathField.addEventListener("selection-change", this.handleSelectionChange);
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
    this.cancelPendingBlur();
    this.cancelPendingFocus();
    this.pendingExitDirection = null;
    this.isExiting = false;
    this.dom.removeEventListener("mousedown", this.handleMouseDown);
    this.mathField.removeEventListener("focus", this.handleFocus);
    this.mathField.removeEventListener("blur", this.handleBlur);
    this.mathField.removeEventListener("focusin", this.handleFocus);
    this.mathField.removeEventListener("focusout", this.handleBlur);
    this.mathField.removeEventListener("beforeinput", this.handleBeforeInput);
    this.mathField.removeEventListener("input", this.handleInput);
    this.mathField.removeEventListener("change", this.handleInput);
    this.mathField.removeEventListener("keydown", this.handleKeyDown, true);
    this.mathField.removeEventListener("mount", this.handleMount);
    this.mathField.removeEventListener("selection-change", this.handleSelectionChange);
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

  focusForEntry({ edge = "start", offset = null, selectionMode = "collapse" } = {}) {
    this.pendingFocusEdge = edge;
    this.pendingFocusOffset = Number.isFinite(offset) ? offset : null;
    this.pendingFocusSelectionMode = selectionMode;
    this.pendingFocusAttempts = 0;
    this.options.debug?.("math.focusAtEdge.request", {
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      edge,
      offset: this.pendingFocusOffset,
      selectionMode,
      variant: this.variant,
      isMounted: this.isMounted,
      domConnected: this.dom.isConnected,
      mathFieldConnected: this.mathField.isConnected,
    });
    this.schedulePendingFocus();
  }

  focusAtEdge(edge = "start") {
    this.focusForEntry({
      edge,
      selectionMode: "collapse",
    });
  }

  focusAtOffset(offset) {
    this.focusForEntry({
      edge: offset <= 0 ? "start" : "end",
      offset,
      selectionMode: "collapse",
    });
  }

  getPointerContentRect() {
    const content =
      this.mathField.shadowRoot?.querySelector('[part="content"]') ?? null;

    if (content?.getBoundingClientRect) {
      return content.getBoundingClientRect();
    }

    return this.mathField.getBoundingClientRect();
  }

  resolvePointerFocusOffset(event) {
    if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) {
      return null;
    }

    const mathFieldRect = this.mathField.getBoundingClientRect();
    const bias = event.clientX < mathFieldRect.left
      ? -1
      : event.clientX > mathFieldRect.right
        ? 1
        : 0;
    const offset = this.mathField.getOffsetFromPoint(event.clientX, event.clientY, {
      bias,
    });

    if (!Number.isFinite(offset) || offset < 0) {
      return null;
    }

    return Math.max(0, Math.min(this.mathField.lastOffset, offset));
  }

  getPointerEntryContext(event) {
    if (event?.button != null && event.button !== 0) {
      return null;
    }

    const offset = this.resolvePointerFocusOffset(event);

    if (offset == null) {
      return null;
    }

    const contentRect = this.getPointerContentRect();
    const isOutsideContent = Number.isFinite(contentRect?.left)
      && Number.isFinite(contentRect?.right)
      && (event.clientX <= contentRect.left || event.clientX >= contentRect.right);
    const isContainerTarget = event.target === this.dom || event.target === this.mathField;

    if (!isContainerTarget && !isOutsideContent) {
      return null;
    }

    return {
      offset,
      isOutsideContent,
      targetRole:
        event.target === this.dom
          ? "container"
          : event.target === this.mathField
            ? "content-host"
            : "content",
    };
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
    const currentPos = this.getCurrentPos();
    const pointer = this.getPointerEntryContext(event);
    const pointerTarget = currentPos != null
      ? this.options.resolvePointerEntryTargetAtPos?.(currentPos, pointer) ?? null
      : null;
    this.options.debug?.("math.mouseDown", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      target: event.target,
      activeElement: document.activeElement,
      resolvedPos: currentPos,
      pointer,
      pointerTarget,
    });

    if (currentPos != null) {
      this.options.selectMathNode?.(currentPos);
    }

    if (pointerTarget) {
      event.preventDefault();
      const didApply = this.options.applyWidgetEntryTarget?.(
        pointerTarget,
        { entryMode: "pointer" }
      );

      if (!didApply && Number.isFinite(pointer?.offset)) {
        this.focusAtOffset(pointer.offset);
      }
    }
  }

  handleMount() {
    this.isMounted = true;
    applyMathExtensions(this.mathField);
    this.options.debug?.("math.mount", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
      domConnected: this.dom.isConnected,
      mathFieldConnected: this.mathField.isConnected,
    });
    this.options.scheduleWidgetFocusSync?.();
    this.schedulePendingFocus();
  }

  handleUnmount() {
    this.isMounted = false;
    this.cancelPendingBlur();
    this.cancelPendingFocus();
    this.options.debug?.("math.unmount", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      variant: this.variant,
    });
  }

  handleFocus() {
    this.cancelPendingBlur();

    if (this.isFocused) {
      return;
    }

    this.isRemoving = false;
    this.isFocused = true;
    this.pendingExitDirection = null;
    this.dom.classList.add("is-focused");
    const currentPos = this.getCurrentPos();
    this.options.debug?.("math.focus", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      resolvedPos: currentPos,
      variant: this.variant,
      activeElement: document.activeElement,
      value: this.mathField.getValue(),
      position: this.mathField.position,
      lastOffset: this.mathField.lastOffset,
    });

    if (currentPos != null) {
      this.options.handleMathFocus(this.node.attrs.id, currentPos);
    }

    this.options.scheduleWidgetFocusSync?.();
    this.notifySettingsItemChange(true);
    this.options.handleBackslashMenuChange?.();
  }

  handleBlur() {
    if (!this.isFocused) {
      return;
    }

    if (this.pendingBlurFrame) {
      return;
    }

    if (!this.isExiting && !this.isRemoving) {
      this.pendingBlurFrame = requestAnimationFrame(() => {
        this.pendingBlurFrame = 0;

        if (this.hasDomFocusWithinMathField()) {
          return;
        }

        this.finalizeBlur();
      });
      return;
    }

    this.finalizeBlur();
  }

  finalizeBlur() {
    if (!this.isFocused) {
      return;
    }

    this.isFocused = false;
    this.pendingExitDirection = null;
    this.dom.classList.remove("is-focused");

    if (this.isExiting) {
      this.isExiting = false;
      this.options.debug?.("math.blur.exit", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
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
    });

    if (this.isRemoving) {
      this.options.debug?.("math.blur.skipRemoving", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
      });
      return;
    }

    const pendingMathFocusId = this.options.getPendingMathFocusId?.() ?? null;

    if (pendingMathFocusId && pendingMathFocusId !== this.node.attrs.id) {
      this.options.debug?.("math.blur.skipHandoff", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        pendingMathFocusId,
      });
      this.notifySettingsItemChange(true);
      this.options.handleBackslashMenuChange?.();
      return;
    }

    if (!this.dom.isConnected) {
      return;
    }

    const currentPos = this.getCurrentPos();

    if (!isGridMathVariant(this.variant) && this.mathField.getValue().trim() === "") {
      if (currentPos != null) {
        this.options.removeMathNode(currentPos, "after");
      }
      return;
    }

    this.commitDraft();

    this.options.debug?.("math.blur", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      resolvedPos: currentPos,
      variant: this.variant,
      value: this.mathField.getValue(),
      activeElement: document.activeElement,
    });

    if (currentPos != null) {
      this.options.handleMathBlur(this.node.attrs.id, currentPos);
    }
    this.notifySettingsItemChange(true);
    this.options.handleBackslashMenuChange?.();
  }

  cancelPendingBlur() {
    if (!this.pendingBlurFrame) {
      return;
    }

    cancelAnimationFrame(this.pendingBlurFrame);
    this.pendingBlurFrame = 0;
  }

  handleSelectionChange() {
    this.notifySettingsItemChange();
    this.options.handleBackslashMenuChange?.();
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
    const fieldValue = this.syncDraftLatexFromField();

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

    this.options.handleBackslashMenuChange?.();
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

    handleMathKeyDown(this, event);
  }

  getNavigationSnapshot() {
    return JSON.stringify({
      position: this.mathField.position,
      lastOffset: this.mathField.lastOffset,
      selection: this.mathField.selection ?? null,
      value: this.mathField.getValue(),
    });
  }

  moveWithinMathField(direction) {
    return moveWithinMathField(this, direction);
  }

  insertMathSpace() {
    return insertMathSpace(this);
  }

  handleTabNavigation(direction) {
    return handleMathTabNavigation(this, direction);
  }

  requestExit(direction) {
    return requestMathExit(this, direction);
  }

  safeGetPos() {
    try {
      return this.getPos();
    } catch (_error) {
      return null;
    }
  }

  getCurrentPos() {
    const directPos = this.safeGetPos();

    if (directPos != null) {
      return directPos;
    }

    const fallbackPos = this.options.resolveMathPositionById?.(this.node.attrs.id) ?? null;

    if (fallbackPos != null) {
      this.options.debug?.("math.resolvePosById", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        variant: this.variant,
        fallbackPos,
      });
      return fallbackPos;
    }

    return null;
  }

  cancelPendingFocus() {
    if (this.pendingFocusFrame) {
      clearTimeout(this.pendingFocusFrame);
      this.pendingFocusFrame = 0;
    }

    this.pendingFocusEdge = null;
    this.pendingFocusOffset = null;
    this.pendingFocusSelectionMode = "collapse";
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
    const offset = this.pendingFocusOffset;
    const selectionMode = this.pendingFocusSelectionMode ?? "collapse";
    this.pendingFocusEdge = null;
    this.pendingFocusOffset = null;
    this.pendingFocusSelectionMode = "collapse";

    try {
      this.mathField.focus({ preventScroll: true });
    } catch (error) {
      this.pendingFocusEdge = edge;
      this.pendingFocusOffset = offset;
      this.pendingFocusSelectionMode = selectionMode;
      this.options.debug?.("math.focusAtEdge.error", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        edge,
        offset,
        selectionMode,
        message: error instanceof Error ? error.message : String(error),
      });
      this.schedulePendingFocus();
      return;
    }

    try {
      const keyboardSink = this.mathField.shadowRoot?.querySelector(
        '[part="keyboard-sink"]'
      );

      if (keyboardSink instanceof HTMLElement && !this.hasDomFocusWithinMathField()) {
        keyboardSink.focus({ preventScroll: true });
      }

      if (selectionMode === "select-all") {
        this.mathField.selection = {
          ranges: [[0, this.mathField.lastOffset]],
          direction: "forward",
        };
      } else {
        this.mathField.position = Number.isFinite(offset)
          ? offset
          : edge === "start"
            ? 0
            : this.mathField.lastOffset;
      }
      this.options.debug?.("math.focusAtEdge.applied", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        edge,
        offset,
        selectionMode,
        activeElement: document.activeElement,
        keyboardSinkActive:
          this.mathField.shadowRoot?.activeElement?.getAttribute?.("part") ?? null,
      });

      if (!this.isFocused) {
        this.options.debug?.("math.focusAtEdge.syntheticFocus", {
          instanceId: this.instanceId,
          id: this.node.attrs.id,
          pos: this.safeGetPos(),
          variant: this.variant,
          edge,
          offset,
          selectionMode,
        });
        this.handleFocus();
      }

      if (selectionMode === "select-all") {
        this.mathField.selection = {
          ranges: [[0, this.mathField.lastOffset]],
          direction: "forward",
        };
      } else {
        this.mathField.position = Number.isFinite(offset)
          ? offset
          : edge === "start"
            ? 0
            : this.mathField.lastOffset;
      }

      if (!this.hasDomFocusWithinMathField()) {
        if (this.pendingFocusAttempts < 4) {
          this.pendingFocusAttempts += 1;
          this.pendingFocusEdge = edge;
          this.pendingFocusOffset = offset;
          this.pendingFocusSelectionMode = selectionMode;
          this.options.debug?.("math.focusAtEdge.retry", {
            instanceId: this.instanceId,
            id: this.node.attrs.id,
            pos: this.safeGetPos(),
            variant: this.variant,
            edge,
            offset,
            selectionMode,
            pendingFocusAttempts: this.pendingFocusAttempts,
          });
          this.schedulePendingFocus();
          return;
        }
      }
    } catch (error) {
      this.options.debug?.("math.focusAtEdge.positionError", {
        instanceId: this.instanceId,
        id: this.node.attrs.id,
        pos: this.safeGetPos(),
        variant: this.variant,
        edge,
        offset,
        selectionMode,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  removeEmptyMath(direction) {
    return removeEmptyMath(this, direction);
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
    this.syncDraftLatexFromField();
    const patch = this.getDraftPatch();
    const currentPos = this.getCurrentPos();

    if (Object.keys(patch).length === 0 || currentPos == null) {
      return false;
    }

    const didCommit = this.options.commitMathNode(currentPos, patch);
    this.options.debug?.("math.commitDraft", {
      instanceId: this.instanceId,
      id: this.node.attrs.id,
      pos: this.safeGetPos(),
      resolvedPos: currentPos,
      variant: this.variant,
      patch,
      didCommit,
    });
    return didCommit;
  }

  syncDraftLatexFromField() {
    let fieldValue = "";

    try {
      fieldValue = getSerializableMathLatex(this.mathField);
    } catch (_error) {
      fieldValue = "";
    }

    if (!fieldValue) {
      try {
        fieldValue = this.mathField.getValue();
      } catch (_error) {
        fieldValue = "";
      }
    }

    this.draftAttrs = {
      ...this.draftAttrs,
      latex: fieldValue,
    };
    return fieldValue;
  }

  getActiveSettingsItemState({ requireFocus = true } = {}) {
    if (requireFocus && !this.hasSettingsInteractionFocus()) {
      return null;
    }

    return getActiveMathArrayItemState(this.mathField, {
      mathId: this.node.attrs.id,
      pos: this.safeGetPos(),
    });
  }

  hasDomFocusWithinMathField() {
    if (this.isDestroyed || !this.dom.isConnected) {
      return false;
    }

    const ownerDocument = this.mathField.ownerDocument ?? document;
    const activeElement = ownerDocument.activeElement;
    const shadowActiveElement = this.mathField.shadowRoot?.activeElement ?? null;

    if (shadowActiveElement) {
      return true;
    }

    if (activeElement === this.mathField) {
      return true;
    }

    if (typeof this.mathField.matches === "function" && this.mathField.matches(":focus")) {
      return true;
    }

    return false;
  }

  hasSettingsInteractionFocus() {
    return this.hasDomFocusWithinMathField()
      || this.isFocused
      || this.options.hasActiveMathFocusForId?.(this.node.attrs.id) === true
      || this.options.hasPendingMathFocusForId?.(this.node.attrs.id) === true;
  }

  resolveSettingsItemState(item) {
    if (item?.source !== "math-structure" || item.mathId !== this.node.attrs.id) {
      return null;
    }

    const activeItem = this.getActiveSettingsItemState({ requireFocus: false });

    if (!activeItem || activeItem.type !== item.type) {
      return null;
    }

    return activeItem;
  }

  getActiveBackslashMenuState() {
    if (!this.isFocused) {
      return null;
    }

    const menuState = getMathExtensionMenuState(this.mathField);

    if (!menuState) {
      return null;
    }

    return {
      ...menuState,
      mathId: this.node.attrs.id,
    };
  }

  getBackslashMenuClientRect(menuState) {
    if (!menuState || menuState.mathId !== this.node.attrs.id) {
      return null;
    }

    const info = this.mathField.getElementInfo(this.mathField.position);
    const bounds = info?.bounds;

    if (bounds && bounds.width >= 0 && bounds.height >= 0) {
      return toMathFieldClientRect(this.mathField, {
        top: bounds.bottom,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        width: Math.max(bounds.width, 1),
        height: Math.max(bounds.height, 1),
      });
    }

    const rect = this.mathField.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  }

  applyBackslashMenuCommand(commandName) {
    this.mathField.focus({ preventScroll: true });
    const didExpand = expandMathExtensionMenuCommand(this.mathField, commandName);

    if (!didExpand) {
      return false;
    }

    this.draftAttrs = {
      ...this.draftAttrs,
      latex: getSerializableMathLatex(this.mathField),
    };
    this.options.handleBackslashMenuChange?.();
    return true;
  }

  getSettingsItemClientRect(item) {
    if (item?.source !== "math-structure" || item.mathId !== this.node.attrs.id) {
      return null;
    }

    return getMathArrayEnvironmentRect(this.mathField, item.type);
  }

  updateMathArraySettings(item, settings) {
    if (item?.source !== "math-structure" || item.mathId !== this.node.attrs.id) {
      return false;
    }

    this.focusMathArraySettingsItem(item);

    const didUpdate = resizeActiveMathArrayEnvironment(this.mathField, settings, {
      expectedType: item.type,
      anchorRowIndex: item.anchorRowIndex,
      anchorColumnIndex: item.anchorColumnIndex,
    });

    if (!didUpdate) {
      return false;
    }

    this.draftAttrs = {
      ...this.draftAttrs,
      latex: getSerializableMathLatex(this.mathField),
    };
    this.notifySettingsItemChange(true);
    return true;
  }

  canDeleteMathStructureItem(item) {
    return this.resolveSettingsItemState(item) != null;
  }

  deleteMathStructureItem(item) {
    if (item?.source !== "math-structure" || item.mathId !== this.node.attrs.id) {
      return false;
    }

    this.focusMathArraySettingsItem(item);

    const didDelete = deleteActiveMathArrayEnvironment(this.mathField, {
      expectedType: item.type,
    });

    if (!didDelete) {
      return false;
    }

    this.draftAttrs = {
      ...this.draftAttrs,
      latex: getSerializableMathLatex(this.mathField),
    };
    this.notifySettingsItemChange(true);
    return true;
  }

  focusMathArraySettingsItem(item) {
    if (item?.source !== "math-structure" || item.mathId !== this.node.attrs.id) {
      return false;
    }

    const selectionRange = Array.isArray(item.anchorRange)
      ? item.anchorRange
      : Array.isArray(item.environmentRange)
        ? item.environmentRange
        : null;

    if (!selectionRange || selectionRange.length !== 2) {
      return false;
    }

    this.mathField.selection = {
      ranges: [selectionRange],
      direction: "forward",
    };
    this.mathField.focus({ preventScroll: true });
    return true;
  }

  notifySettingsItemChange(force = false) {
    const activeItem = this.getActiveSettingsItemState();
    const nextSignature = activeItem
      ? `${activeItem.type}:${activeItem.mathId}:${JSON.stringify(activeItem.settings)}`
      : null;

    if (!force && nextSignature === this.activeSettingsItemSignature) {
      return;
    }

    this.activeSettingsItemSignature = nextSignature;
    this.options.handleMathStructureChange?.(this.node.attrs.id, activeItem);
  }

  handoffMathArrayTab(direction) {
    return handoffMathArrayTab(this, direction);
  }

  selectMathArrayCell(row, column, direction = "forward") {
    return selectMathArrayCell(this, row, column, direction);
  }

  deleteStructuredParentBackward() {
    return deleteStructuredParentBackward(this);
  }
}

export { MathNodeView };
