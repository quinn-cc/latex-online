export class MathSession {
  constructor({
    resolveMathTargetById,
    getMathView,
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (frameId) => cancelAnimationFrame(frameId),
    debug = null,
  }) {
    this.resolveMathTargetById = resolveMathTargetById;
    this.getMathView = getMathView;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.debug = debug;

    this.activeMathId = null;
    this.lastFocusedMathId = null;
    this.pendingMathFocusId = null;
    this.pendingMathFocusEdge = "start";
    this.pendingMathFocusOffset = null;
    this.pendingMathFocusSelectionMode = "collapse";
    this.pendingMathFocusFrame = 0;
  }

  reset() {
    this.cancelPendingFocus();
    this.activeMathId = null;
    this.lastFocusedMathId = null;
  }

  handleFocus(id) {
    if (this.pendingMathFocusId === id) {
      this.cancelPendingFocusFrame();
      this.pendingMathFocusId = null;
      this.pendingMathFocusOffset = null;
      this.pendingMathFocusSelectionMode = "collapse";
    } else if (this.pendingMathFocusId == null) {
      this.cancelPendingFocusFrame();
    }

    this.activeMathId = id;
    this.lastFocusedMathId = id;
  }

  handleBlur(id) {
    if (this.activeMathId === id) {
      this.activeMathId = null;
    }
  }

  cancelPendingFocus() {
    this.cancelPendingFocusFrame();
    this.pendingMathFocusId = null;
    this.pendingMathFocusOffset = null;
    this.pendingMathFocusSelectionMode = "collapse";
  }

  cancelPendingFocusFrame() {
    if (this.pendingMathFocusFrame) {
      this.cancelFrame(this.pendingMathFocusFrame);
      this.pendingMathFocusFrame = 0;
    }
  }

  clearRemovedNode(id) {
    if (!id) {
      return;
    }

    if (this.activeMathId === id) {
      this.cancelPendingFocus();
      this.activeMathId = null;
    }

    if (this.pendingMathFocusId === id) {
      this.cancelPendingFocus();
    }

    if (this.lastFocusedMathId === id) {
      this.lastFocusedMathId = null;
    }

  }

  getMathTarget() {
    const targetId = this.activeMathId ?? this.lastFocusedMathId;

    if (!targetId) {
      return null;
    }

    const target = this.getMathTargetById(targetId);

    if (!target) {
      if (this.activeMathId === targetId) {
        this.activeMathId = null;
      }

      if (this.lastFocusedMathId === targetId) {
        this.lastFocusedMathId = null;
      }
    }

    return target;
  }

  getMathTargetById(id) {
    if (!id) {
      return null;
    }

    return this.resolveMathTargetById(id);
  }

  getFocusedOrPendingTarget() {
    return this.getMathTargetById(this.activeMathId)
      ?? this.getMathTargetById(this.pendingMathFocusId)
      ?? null;
  }

  isMathActive() {
    if (this.activeMathId == null) {
      return false;
    }

    if (!this.getMathTargetById(this.activeMathId)) {
      this.activeMathId = null;
      return false;
    }

    return true;
  }

  hasPendingFocus() {
    if (this.pendingMathFocusId == null) {
      return false;
    }

    if (!this.getMathTargetById(this.pendingMathFocusId)) {
      this.pendingMathFocusId = null;
      this.pendingMathFocusOffset = null;
      this.pendingMathFocusSelectionMode = "collapse";
      return false;
    }

    return true;
  }

  hasCapture() {
    return this.isMathActive() || this.hasPendingFocus();
  }

  prepareFocus(id, edge = "start", options = {}) {
    if (!id) {
      return false;
    }

    const offset = Number.isFinite(options.offset) ? options.offset : null;
    const selectionMode = options.selectionMode ?? "collapse";

    this.cancelPendingFocusFrame();
    this.pendingMathFocusId = id;
    this.pendingMathFocusEdge = edge;
    this.pendingMathFocusOffset = offset;
    this.pendingMathFocusSelectionMode = selectionMode;

    return true;
  }

  focusNode(id, edge = "start", options = {}) {
    const offset = Number.isFinite(options.offset) ? options.offset : null;
    const selectionMode = options.selectionMode ?? "collapse";
    const nodeView = this.getMathView(id);

    this.prepareFocus(id, edge, { offset, selectionMode });

    if (nodeView) {
      this.debug?.("controller.focusMathNode", {
        id,
        edge,
        offset,
        selectionMode,
        via: "nodeView",
      });
      this.scheduleFocus(id, edge, { offset, selectionMode });
      return true;
    }

    this.debug?.("controller.focusMathNode", {
      id,
      edge,
      offset,
      selectionMode,
      via: "pending",
    });
    return false;
  }

  scheduleFocus(id, edge = "start", options = {}) {
    const offset = Number.isFinite(options.offset) ? options.offset : null;
    const selectionMode = options.selectionMode ?? "collapse";
    this.prepareFocus(id, edge, { offset, selectionMode });
    this.debug?.("controller.scheduleMathFocus", {
      id,
      edge,
      offset,
      selectionMode,
    });
    this.pendingMathFocusFrame = this.requestFrame(() => {
      this.pendingMathFocusFrame = 0;

      if (this.activeMathId !== id && this.pendingMathFocusId !== id) {
        this.debug?.("controller.scheduleMathFocus.aborted", {
          id,
          edge,
          offset,
          selectionMode,
          activeMathId: this.activeMathId,
          pendingMathFocusId: this.pendingMathFocusId,
        });
        return;
      }

      const nodeView = this.getMathView(id);

      if (!nodeView) {
        this.pendingMathFocusId = id;
        this.pendingMathFocusEdge = edge;
        this.pendingMathFocusOffset = offset;
        this.pendingMathFocusSelectionMode = selectionMode;
        this.debug?.("controller.scheduleMathFocus.missingNodeView", {
          id,
          edge,
          offset,
          selectionMode,
        });
        return;
      }

      try {
        nodeView.focusForEntry({
          edge,
          offset,
          selectionMode,
        });
        this.debug?.("controller.scheduleMathFocus.applied", {
          id,
          edge,
          offset,
          selectionMode,
          activeElement: document.activeElement,
        });
      } catch (error) {
        this.pendingMathFocusId = id;
        this.pendingMathFocusEdge = edge;
        this.pendingMathFocusOffset = offset;
        this.pendingMathFocusSelectionMode = selectionMode;
        this.debug?.("controller.scheduleMathFocus.error", {
          id,
          edge,
          offset,
          selectionMode,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}
