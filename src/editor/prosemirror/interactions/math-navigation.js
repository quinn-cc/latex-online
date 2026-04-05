import { shouldHandleMathExtensionAcceptKey, expandMathExtensionCommand } from "../math-extensions/index.js";
import {
  getActiveMathArrayEnvironment,
  getMathArrayTabAction,
  selectMathArrayCell as selectMathArrayEnvironmentCell,
} from "../math-extensions/array-structures.js";

export function isGridMathVariant(variant) {
  return variant === "align" || variant === "gather";
}

function getCurrentMathPos(nodeView) {
  return nodeView.getCurrentPos?.() ?? nodeView.safeGetPos?.() ?? null;
}

function isFullySelectedMathField(nodeView) {
  if (nodeView.mathField.selectionIsCollapsed) {
    return false;
  }

  const selection = nodeView.mathField.selection;
  const ranges = selection?.ranges;

  if (!Array.isArray(ranges) || ranges.length !== 1) {
    return false;
  }

  const [range] = ranges;

  if (!Array.isArray(range) || range.length !== 2) {
    return false;
  }

  return range[0] === 0 && range[1] === nodeView.mathField.lastOffset;
}

export function handleMathKeyDown(nodeView, event) {
  if (
    nodeView.options.handleBackslashMenuKey?.(event, "math")
  ) {
    return true;
  }

  if (
    nodeView.mathField.mode === "latex" &&
    shouldHandleMathExtensionAcceptKey(event) &&
    expandMathExtensionCommand(nodeView.mathField)
  ) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  if (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    (event.key === " " || event.key === "Spacebar")
  ) {
    if (insertMathSpace(nodeView)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
  }

  if (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    event.key === "Tab"
  ) {
    if (handleMathTabNavigation(nodeView, event.shiftKey ? "backward" : "forward")) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
  }

  if (
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    event.key === "Backspace" &&
    deleteStructuredParentBackward(nodeView)
  ) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  if (
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    event.key === "Backspace" &&
    nodeView.mathField.selectionIsCollapsed &&
    nodeView.mathField.position === 0
  ) {
    const currentPos = getCurrentMathPos(nodeView);

    if (currentPos != null) {
      const didDelete = nodeView.options.handleBackspaceAtStart?.(currentPos) ?? false;

      if (didDelete) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
    }
  }

  if (
    isGridMathVariant(nodeView.variant) &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    event.key === "Enter"
  ) {
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      const currentPos = getCurrentMathPos(nodeView);
      const shiftEnterHandler = nodeView.variant === "align"
        ? nodeView.options.handleAlignShiftEnter
        : nodeView.options.handleGatherShiftEnter;
      if (currentPos != null) {
        shiftEnterHandler?.(currentPos, nodeView.getDraftPatch());
      }
      return true;
    }

    if (nodeView.mathField.mode === "latex") {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    const currentPos = getCurrentMathPos(nodeView);
    const enterHandler = nodeView.variant === "align"
      ? nodeView.options.handleAlignEnter
      : nodeView.options.handleGatherEnter;
    if (currentPos != null) {
      enterHandler?.(currentPos, nodeView.getDraftPatch());
    }
    return true;
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
    requestMathExit(nodeView, "after");
    return true;
  }

  if (
    (event.key === "Backspace" || event.key === "Delete") &&
    nodeView.mathField.getValue().trim() === ""
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (isGridMathVariant(nodeView.variant)) {
      const currentPos = getCurrentMathPos(nodeView);

      if (currentPos != null) {
        nodeView.options.removeMathNode(
          currentPos,
          event.key === "Backspace" ? "before" : "after"
        );
      }
      return true;
    }

    removeEmptyMath(nodeView, event.key === "Backspace" ? "before" : "after");
    return true;
  }

  if (
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.key === "ArrowLeft" &&
    nodeView.mathField.selectionIsCollapsed &&
    nodeView.mathField.position === 0
  ) {
    event.preventDefault();
    event.stopPropagation();
    requestMathExit(nodeView, "before");
    return true;
  }

  if (
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.key === "ArrowRight" &&
    nodeView.mathField.selectionIsCollapsed &&
    nodeView.mathField.position === nodeView.mathField.lastOffset
  ) {
    event.preventDefault();
    event.stopPropagation();
    requestMathExit(nodeView, "after");
    return true;
  }

  if (
    nodeView.variant === "display" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.key === "ArrowUp"
  ) {
    event.preventDefault();
    event.stopPropagation();
    requestMathExit(nodeView, "before");
    return true;
  }

  if (
    nodeView.variant === "display" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.key === "ArrowDown"
  ) {
    event.preventDefault();
    event.stopPropagation();
    requestMathExit(nodeView, "after");
    return true;
  }

  return false;
}

export function handleMathTabNavigation(nodeView, direction) {
  if (isGridMathVariant(nodeView.variant)) {
    const currentPos = getCurrentMathPos(nodeView);
    const isTransitSelection = isFullySelectedMathField(nodeView);

    if (!isTransitSelection && moveWithinMathField(nodeView, direction)) {
      return true;
    }

    const didHandleGridTransition = currentPos != null
      ? (nodeView.options.handleGridTab?.(
          currentPos,
          direction,
          nodeView.getDraftPatch()
        ) ?? false)
      : false;

    if (didHandleGridTransition) {
      return true;
    }

    requestMathExit(nodeView, direction === "backward" ? "before" : "after");
    return true;
  }

  const mathArrayTabAction = getMathArrayTabAction(nodeView.mathField, direction);

  if (mathArrayTabAction.type === "move") {
    return selectMathArrayCell(
      nodeView,
      mathArrayTabAction.rowIndex,
      mathArrayTabAction.columnIndex,
      direction
    );
  }

  if (
    mathArrayTabAction.type === "handoff-before" ||
    mathArrayTabAction.type === "handoff-after"
  ) {
    return handoffMathArrayTab(
      nodeView,
      mathArrayTabAction.type === "handoff-before" ? "backward" : "forward"
    );
  }

  if (moveWithinMathField(nodeView, direction)) {
    return true;
  }

  requestMathExit(nodeView, direction === "backward" ? "before" : "after");
  return true;
}

export function requestMathExit(nodeView, direction) {
  if (nodeView.pendingExitDirection || nodeView.isExiting) {
    nodeView.options.debug?.("math.requestExit.ignored", {
      instanceId: nodeView.instanceId,
      id: nodeView.node.attrs.id,
      pos: nodeView.safeGetPos(),
      variant: nodeView.variant,
      direction,
      pendingExitDirection: nodeView.pendingExitDirection,
    });
    return false;
  }

  nodeView.pendingExitDirection = direction;
  nodeView.isExiting = true;
  nodeView.dom.classList.remove("is-focused");
  nodeView.options.debug?.("math.requestExit", {
    instanceId: nodeView.instanceId,
    id: nodeView.node.attrs.id,
    pos: nodeView.safeGetPos(),
    variant: nodeView.variant,
    direction,
    value: nodeView.mathField.getValue(),
  });

  if (!isGridMathVariant(nodeView.variant) && nodeView.mathField.getValue().trim() === "") {
    const currentPos = getCurrentMathPos(nodeView);
    const didRemove = currentPos != null
      ? nodeView.options.removeMathNode(currentPos, direction)
      : false;

    if (!didRemove) {
      nodeView.isExiting = false;
      nodeView.pendingExitDirection = null;
      nodeView.dom.classList.add("is-focused");
    }

    return didRemove;
  }

  nodeView.syncDraftLatexFromField();
  const patch = nodeView.getDraftPatch();
  const currentPos = getCurrentMathPos(nodeView);
  const didExit = currentPos != null
    ? nodeView.options.commitAndExitMathNode(currentPos, direction, patch)
    : false;

  if (!didExit) {
    nodeView.isExiting = false;
    nodeView.pendingExitDirection = null;
    nodeView.dom.classList.add("is-focused");
  }

  return didExit;
}

export function moveWithinMathField(nodeView, direction) {
  if (nodeView.mathField.getValue().trim() === "") {
    return false;
  }

  const command = direction === "backward"
    ? "moveToPreviousGroup"
    : "moveToNextGroup";
  const before = nodeView.getNavigationSnapshot();
  const didMove = nodeView.mathField.executeCommand(command);

  if (!didMove) {
    return false;
  }

  return nodeView.getNavigationSnapshot() !== before;
}

export function insertMathSpace(nodeView) {
  return nodeView.mathField.insert("\\space", {
    format: "latex",
    mode: "math",
  });
}

export function removeEmptyMath(nodeView, direction) {
  if (nodeView.isRemoving) {
    nodeView.options.debug?.("math.removeEmptyMath.ignored", {
      instanceId: nodeView.instanceId,
      id: nodeView.node.attrs.id,
      pos: nodeView.safeGetPos(),
      variant: nodeView.variant,
      direction,
    });
    return false;
  }

  nodeView.isRemoving = true;
  nodeView.isExiting = false;
  nodeView.pendingExitDirection = null;
  nodeView.dom.classList.remove("is-focused");
  nodeView.options.debug?.("math.removeEmptyMath", {
    instanceId: nodeView.instanceId,
    id: nodeView.node.attrs.id,
    pos: nodeView.safeGetPos(),
    variant: nodeView.variant,
    direction,
    activeElement: document.activeElement,
  });
  const currentPos = getCurrentMathPos(nodeView);

  if (currentPos == null) {
    nodeView.isRemoving = false;
    return false;
  }

  nodeView.options.removeMathNode(currentPos, direction);
  return true;
}

export function handoffMathArrayTab(nodeView, direction) {
  const model = nodeView.mathField._mathfield?.model;
  const environment = getActiveMathArrayEnvironment(model);

  if (!model || !environment) {
    return false;
  }

  if (direction === "forward") {
    const hasTrailingContent = Boolean(environment.rightSibling);
    const didMoveAfterParent = nodeView.mathField.executeCommand("moveAfterParent");

    if (!didMoveAfterParent) {
      return false;
    }

    if (hasTrailingContent) {
      nodeView.mathField.executeCommand("moveToNextGroup");
    }

    return true;
  }

  const hasLeadingContent = Boolean(environment.leftSibling);
  const didMoveBeforeParent = nodeView.mathField.executeCommand("moveBeforeParent");

  if (!didMoveBeforeParent) {
    return false;
  }

  if (hasLeadingContent) {
    nodeView.mathField.executeCommand("moveToPreviousGroup");
  }

  return true;
}

export function selectMathArrayCell(nodeView, row, column, direction = "forward") {
  return selectMathArrayEnvironmentCell(nodeView.mathField, row, column, direction);
}

export function deleteStructuredParentBackward(nodeView) {
  const model = nodeView.mathField._mathfield?.model;

  if (!model || !nodeView.mathField.selectionIsCollapsed) {
    return false;
  }

  const cursor = model.at(model.position);
  const parent = cursor?.parent;
  const branch = cursor?.parentBranch;

  if (
    !cursor ||
    !cursor.isFirstSibling ||
    !parent ||
    typeof branch !== "string" ||
    !["superscript", "subscript", "above", "below"].includes(branch) ||
    !["operator", "extensible-symbol", "subsup", "overunder"].includes(parent.type)
  ) {
    return false;
  }

  const selectionRange = getParentAtomSelectionRange(model, parent);

  if (!selectionRange) {
    return false;
  }

  nodeView.mathField.selection = {
    ranges: [selectionRange],
    direction: "backward",
  };

  return nodeView.mathField.executeCommand("deleteBackward");
}

function getParentAtomSelectionRange(model, parent) {
  if (!model || !parent) {
    return null;
  }

  const end = model.offsetOf(parent);

  if (!Number.isFinite(end)) {
    return null;
  }

  const startAtom = parent.leftSibling ?? parent.firstChild ?? parent;
  const start = model.offsetOf(startAtom);

  if (!Number.isFinite(start)) {
    return null;
  }

  return [start, end];
}
