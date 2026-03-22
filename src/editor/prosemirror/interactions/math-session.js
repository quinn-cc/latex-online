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
    this.boundaryMathCaptureId = null;
    this.boundaryMathCaptureDirection = null;
    this.pendingMathFocusId = null;
    this.pendingMathFocusEdge = "start";
    this.pendingMathFocusFrame = 0;
  }

  reset() {
    this.cancelPendingFocus();
    this.activeMathId = null;
    this.lastFocusedMathId = null;
    this.clearBoundaryCapture();
  }

  handleFocus(id) {
    this.cancelPendingFocusFrame();

    if (this.pendingMathFocusId === id) {
      this.pendingMathFocusId = null;
    }

    if (this.boundaryMathCaptureId === id) {
      this.clearBoundaryCapture();
    }

    this.activeMathId = id;
    this.lastFocusedMathId = id;
  }

  handleBlur(id, { boundaryDirection } = {}) {
    if (this.activeMathId === id) {
      this.activeMathId = null;
    }

    if (boundaryDirection) {
      this.boundaryMathCaptureId = id;
      this.boundaryMathCaptureDirection = boundaryDirection;
      return;
    }

    if (this.boundaryMathCaptureId === id) {
      this.clearBoundaryCapture();
    }
  }

  clearBoundaryCapture() {
    this.boundaryMathCaptureId = null;
    this.boundaryMathCaptureDirection = null;
  }

  cancelPendingFocus() {
    this.cancelPendingFocusFrame();
    this.pendingMathFocusId = null;
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

    if (this.boundaryMathCaptureId === id) {
      this.clearBoundaryCapture();
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

  getBoundaryTarget() {
    const target = this.getMathTargetById(this.boundaryMathCaptureId);

    if (!target) {
      this.clearBoundaryCapture();
      return null;
    }

    return target;
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
      return false;
    }

    return true;
  }

  hasCapture() {
    return this.isMathActive() || this.hasPendingFocus();
  }

  focusNode(id, edge = "start") {
    if (this.boundaryMathCaptureId === id) {
      this.clearBoundaryCapture();
    }

    const nodeView = this.getMathView(id);

    if (nodeView) {
      this.debug?.("controller.focusMathNode", {
        id,
        edge,
        via: "nodeView",
      });
      this.scheduleFocus(id, edge);
      return true;
    }

    this.pendingMathFocusId = id;
    this.pendingMathFocusEdge = edge;
    this.debug?.("controller.focusMathNode", {
      id,
      edge,
      via: "pending",
    });
    return false;
  }

  scheduleFocus(id, edge = "start") {
    this.cancelPendingFocusFrame();
    this.pendingMathFocusId = id;
    this.pendingMathFocusEdge = edge;
    this.debug?.("controller.scheduleMathFocus", {
      id,
      edge,
    });
    this.pendingMathFocusFrame = this.requestFrame(() => {
      this.pendingMathFocusFrame = 0;

      if (this.activeMathId !== id && this.pendingMathFocusId !== id) {
        this.debug?.("controller.scheduleMathFocus.aborted", {
          id,
          edge,
          activeMathId: this.activeMathId,
          pendingMathFocusId: this.pendingMathFocusId,
        });
        return;
      }

      const nodeView = this.getMathView(id);

      if (!nodeView) {
        this.pendingMathFocusId = id;
        this.pendingMathFocusEdge = edge;
        this.debug?.("controller.scheduleMathFocus.missingNodeView", {
          id,
          edge,
        });
        return;
      }

      try {
        nodeView.focusAtEdge(edge);
        this.debug?.("controller.scheduleMathFocus.applied", {
          id,
          edge,
          activeElement: document.activeElement,
        });
      } catch (error) {
        this.pendingMathFocusId = id;
        this.pendingMathFocusEdge = edge;
        this.debug?.("controller.scheduleMathFocus.error", {
          id,
          edge,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}
