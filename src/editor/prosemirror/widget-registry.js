import { TextSelection } from "prosemirror-state";
import { editorSchema } from "./schema.js";

const widgetDefinitions = new Map([
  [
    "inline_math",
    {
      type: "inline_math",
      widgetKind: "inline",
      placement: "inline",
      mathBacked: true,
      resolveFocusDom: resolveMathBackedWidgetFocusDom,
      resolvePointerEntryTarget: resolveMathPointerEntryTarget,
    },
  ],
  [
    "table",
    {
      type: "table",
      widgetKind: "full-line",
      placement: "block",
      fullLine: true,
      grid: true,
      hasSettings: true,
    },
  ],
  [
    "align",
    {
      type: "align",
      widgetKind: "full-line",
      placement: "block",
      fullLine: true,
      grid: true,
      mathBacked: true,
      hasSettings: true,
      removeWhenEmpty: true,
      resolveFocusDom: resolveMathBackedWidgetFocusDom,
      resolvePointerEntryTarget: resolveMathPointerEntryTarget,
    },
  ],
  [
    "gather",
    {
      type: "gather",
      widgetKind: "full-line",
      placement: "block",
      fullLine: true,
      grid: true,
      mathBacked: true,
      hasSettings: true,
      removeWhenEmpty: true,
      resolveFocusDom: resolveMathBackedWidgetFocusDom,
      resolvePointerEntryTarget: resolveMathPointerEntryTarget,
    },
  ],
]);

const widgetTypeByNodeName = new Map([
  [editorSchema.nodes.inline_math.name, "inline_math"],
  [editorSchema.nodes.table.name, "table"],
  [editorSchema.nodes.align_block.name, "align"],
  [editorSchema.nodes.gather_block.name, "gather"],
]);

function getBoundaryChildInfo(node, pos, boundarySide) {
  if (!node || pos == null || node.childCount <= 0) {
    return null;
  }

  const childIndex = boundarySide === "before" ? 0 : node.childCount - 1;
  let child = null;
  let childPos = null;

  node.forEach((currentChild, offset, index) => {
    if (child || index !== childIndex) {
      return;
    }

    child = currentChild;
    childPos = pos + 1 + offset;
  });

  if (!child || childPos == null) {
    return null;
  }

  return {
    node: child,
    pos: childPos,
    index: childIndex,
  };
}

function isMathBoundaryTargetNode(node) {
  return (
    node?.type === editorSchema.nodes.inline_math ||
    node?.type === editorSchema.nodes.align_math ||
    node?.type === editorSchema.nodes.gather_math
  );
}

function resolveMathPointerEntryTarget({
  contentNode,
  pointer,
}) {
  if (!isMathBoundaryTargetNode(contentNode) || !Number.isFinite(pointer?.offset)) {
    return null;
  }

  const isContainerTarget = pointer?.targetRole === "container"
    || pointer?.targetRole === "content-host";

  if (!isContainerTarget && pointer?.isOutsideContent !== true) {
    return null;
  }

  const mathId = contentNode.attrs?.id ?? null;

  if (!mathId) {
    return null;
  }

  return {
    kind: "math",
    mathId,
    edge: pointer.offset <= 0 ? "start" : "end",
    offset: pointer.offset,
  };
}

function resolveMathBackedWidgetFocusDom({
  controller,
  widgetInfo,
}) {
  const mathTarget = controller.getFocusedOrPendingMathTarget?.() ?? null;

  if (!mathTarget || widgetInfo?.pos == null) {
    return null;
  }

  const targetWidgetInfo = findEnclosingWidgetInfoAtPos(
    controller.view.state.doc,
    mathTarget.pos
  );

  if (!targetWidgetInfo || targetWidgetInfo.pos !== widgetInfo.pos) {
    return null;
  }

  const mathView = controller.getMathView?.(mathTarget.id) ?? null;
  const focusRoot = mathView?.dom?.closest?.("[data-widget-root]");

  return focusRoot instanceof HTMLElement ? focusRoot : null;
}

function createWidgetInfo(node, pos, definition, depth = null) {
  if (!node || pos == null || !definition) {
    return null;
  }

  return {
    definition,
    node,
    pos,
    depth,
  };
}

export function getWidgetDefinition(type) {
  return type ? widgetDefinitions.get(type) ?? null : null;
}

export function getWidgetDefinitionFromNode(node) {
  if (!node) {
    return null;
  }

  const type = widgetTypeByNodeName.get(node.type?.name);
  return getWidgetDefinition(type);
}

export function getWidgetTypeFromNode(node) {
  return getWidgetDefinitionFromNode(node)?.type ?? null;
}

export function isInlineWidgetType(type) {
  return getWidgetDefinition(type)?.placement === "inline";
}

export function isInlineWidgetNode(node) {
  return isInlineWidgetType(getWidgetTypeFromNode(node));
}

export function isFullLineWidgetType(type) {
  return getWidgetDefinition(type)?.fullLine === true;
}

export function isFullLineWidgetNode(node) {
  return getWidgetDefinitionFromNode(node)?.fullLine === true;
}

export function findEnclosingWidgetInfoAtResolvedPos($pos) {
  if (!$pos) {
    return null;
  }

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    const definition = getWidgetDefinitionFromNode(node);

    if (definition) {
      return createWidgetInfo(node, $pos.before(depth), definition, depth);
    }
  }

  return null;
}

export function findEnclosingWidgetInfoAtPos(doc, pos) {
  if (!doc || !Number.isFinite(pos)) {
    return null;
  }

  const node = doc.nodeAt(pos);
  const definition = getWidgetDefinitionFromNode(node);

  if (definition) {
    return createWidgetInfo(node, pos, definition);
  }

  try {
    return findEnclosingWidgetInfoAtResolvedPos(doc.resolve(pos));
  } catch (_error) {
    return null;
  }
}

export function findEnclosingWidgetInfoForSelection(selection) {
  if (!selection) {
    return null;
  }

  if (selection.node) {
    const definition = getWidgetDefinitionFromNode(selection.node);

    if (definition) {
      return createWidgetInfo(selection.node, selection.from, definition);
    }
  }

  const fromInfo = findEnclosingWidgetInfoAtResolvedPos(selection.$from);
  const toInfo = findEnclosingWidgetInfoAtResolvedPos(selection.$to);

  if (!fromInfo || !toInfo || fromInfo.pos !== toInfo.pos) {
    return null;
  }

  return fromInfo;
}

export function resolveNodeBoundaryEntryTarget(node, pos, boundarySide) {
  if (!node || pos == null) {
    return null;
  }

  if (isMathBoundaryTargetNode(node)) {
    return {
      kind: "math",
      mathId: node.attrs.id ?? null,
      edge: boundarySide === "before" ? "start" : "end",
      selectionPos: pos + node.nodeSize,
      selectionBias: -1,
    };
  }

  const widgetDefinition = getWidgetDefinitionFromNode(node);
  const customTarget = widgetDefinition?.enterFromBoundary?.({
    node,
    pos,
    boundarySide,
    resolveNodeBoundaryEntryTarget,
  });

  if (customTarget) {
    return customTarget;
  }

  if (node.isTextblock) {
    const boundaryInlineChild = getBoundaryChildInfo(node, pos, boundarySide);
    const inlineTarget = boundaryInlineChild &&
      isInlineWidgetNode(boundaryInlineChild.node)
      ? resolveNodeBoundaryEntryTarget(
          boundaryInlineChild.node,
          boundaryInlineChild.pos,
          boundarySide
        )
      : null;

    if (inlineTarget) {
      return inlineTarget;
    }

    return {
      kind: "selection",
      selectionPos: boundarySide === "before" ? pos + 1 : pos + node.nodeSize - 1,
      selectionBias: boundarySide === "before" ? 1 : -1,
    };
  }

  const boundaryChild = getBoundaryChildInfo(node, pos, boundarySide);
  if (!boundaryChild) {
    return null;
  }

  return resolveNodeBoundaryEntryTarget(
    boundaryChild.node,
    boundaryChild.pos,
    boundarySide
  );
}

export function resolveNodeLeadingEntryTarget(node, pos) {
  if (!node || pos == null) {
    return null;
  }

  const widgetDefinition = getWidgetDefinitionFromNode(node);
  const customTarget = widgetDefinition?.resolveLeadingEntryTarget?.({
    node,
    pos,
    resolveNodeBoundaryEntryTarget,
  });

  if (customTarget) {
    return customTarget;
  }

  return resolveNodeBoundaryEntryTarget(node, pos, "before");
}

export function resolveWidgetPointerEntryTarget(
  node,
  pos,
  {
    contentNode = null,
    contentPos = null,
    pointer = null,
  } = {}
) {
  if (!node || pos == null) {
    return null;
  }

  const widgetDefinition = getWidgetDefinitionFromNode(node);

  if (!widgetDefinition?.resolvePointerEntryTarget) {
    return null;
  }

  return widgetDefinition.resolvePointerEntryTarget({
    definition: widgetDefinition,
    node,
    pos,
    contentNode: contentNode ?? node,
    contentPos,
    pointer,
    resolveNodeBoundaryEntryTarget,
    resolveNodeLeadingEntryTarget,
  });
}

export function isSelectionAtNodeLeadingBoundary(state, node, pos) {
  if (
    !(state?.selection instanceof TextSelection) ||
    !state.selection.empty ||
    !node ||
    pos == null
  ) {
    return false;
  }

  const widgetDefinition = getWidgetDefinitionFromNode(node);
  const target = resolveNodeLeadingEntryTarget(node, pos);
  const customMatch = widgetDefinition?.matchesLeadingSelectionBoundary?.({
    state,
    node,
    pos,
    target,
  });

  if (typeof customMatch === "boolean") {
    return customMatch;
  }

  return (
    target?.kind === "selection" &&
    Number.isFinite(target.selectionPos) &&
    state.selection.from === target.selectionPos
  );
}

export function isContentPosAtNodeLeadingBoundary(doc, node, pos, contentPos) {
  if (!doc || !node || pos == null || !Number.isFinite(contentPos)) {
    return false;
  }

  const widgetDefinition = getWidgetDefinitionFromNode(node);
  const target = resolveNodeLeadingEntryTarget(node, pos);
  const customMatch = widgetDefinition?.matchesLeadingContentBoundary?.({
    doc,
    node,
    pos,
    contentPos,
    target,
  });

  if (typeof customMatch === "boolean") {
    return customMatch;
  }

  if (target?.kind === "math" && target.mathId) {
    return doc.nodeAt(contentPos)?.attrs?.id === target.mathId;
  }

  return target?.kind === "selection" && target.selectionPos === contentPos;
}
