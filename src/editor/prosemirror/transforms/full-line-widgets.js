import { Fragment } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { createBlockPositionList } from "../page-layout.js";
import { editorSchema } from "../schema.js";
import {
  getWidgetDefinitionFromNode,
  resolveNodeLeadingEntryTarget,
} from "../widget-registry.js";

function createParagraphNode(schema, attrs, content) {
  return content.size > 0
    ? schema.nodes.paragraph.create({ ...attrs }, content)
    : schema.nodes.paragraph.createAndFill({ ...attrs });
}

function isEmptyParagraphNode(node) {
  return node?.type === editorSchema.nodes.paragraph && node.content.size === 0;
}

function createSelectionTargetFromEntryTarget(target) {
  if (target?.kind === "selection" && Number.isFinite(target.selectionPos)) {
    return {
      selectionPos: target.selectionPos,
      selectionBias: target.selectionBias ?? 1,
    };
  }

  if (target?.kind === "math" && Number.isFinite(target.selectionPos)) {
    return {
      selectionPos: target.selectionPos,
      selectionBias: target.selectionBias ?? -1,
      focusMathId: target.mathId ?? null,
      focusMathEdge: target.edge ?? "start",
    };
  }

  return null;
}

export function buildFullLineWidgetInsertion({
  state,
  match,
  allowedParentTypes,
  createBlockNode,
  getSelectionTarget = null,
  schema = editorSchema,
  widgetType = null,
}) {
  const paragraphNode = match?.paragraphNode;
  const parentNode = match?.parentNode;

  if (!paragraphNode || !parentNode) {
    return null;
  }

  if (!allowedParentTypes.includes(parentNode.type)) {
    return null;
  }

  const commandName = widgetType ?? match.nameQuery;
  const commandText = `\\${commandName}`;
  const commandStart = Math.max(0, Math.min(match.commandStart, paragraphNode.content.size));
  const commandEnd = Math.max(
    commandStart,
    Math.min(commandStart + commandText.length, paragraphNode.content.size)
  );
  const beforeContent = paragraphNode.content.cut(0, commandStart);
  const afterContent = paragraphNode.content.cut(commandEnd, paragraphNode.content.size);
  const isLeadingListParagraph =
    parentNode.type === schema.nodes.list_item && match.parentIndex === 0;
  const beforeParagraph = beforeContent.size > 0 || isLeadingListParagraph
    ? createParagraphNode(schema, paragraphNode.attrs, beforeContent)
    : null;
  const afterParagraph = createParagraphNode(schema, paragraphNode.attrs, afterContent);
  const blockNode = createBlockNode({ state, match, paragraphNode });
  const replacementNodes = beforeParagraph
    ? [beforeParagraph, blockNode, afterParagraph]
    : [blockNode, afterParagraph];
  const replacement = Fragment.fromArray(replacementNodes);
  const blockPos = beforeParagraph
    ? match.paragraphPos + beforeParagraph.nodeSize
    : match.paragraphPos;
  const selectionTarget = getSelectionTarget
    ? getSelectionTarget({
        blockNode,
        blockPos,
      })
    : createSelectionTargetFromEntryTarget(
        resolveNodeLeadingEntryTarget(blockNode, blockPos)
      );

  if (!selectionTarget?.selectionPos) {
    return null;
  }

  const tr = state.tr.replaceWith(
    match.paragraphPos,
    match.paragraphPos + paragraphNode.nodeSize,
    replacement
  );

  tr.setSelection(
    TextSelection.near(
      tr.doc.resolve(selectionTarget.selectionPos),
      selectionTarget.selectionBias ?? -1
    )
  );

  return {
    tr,
    blockNode,
    blockPos,
    focusMathId: selectionTarget.focusMathId ?? null,
    focusMathEdge: selectionTarget.focusMathEdge ?? "start",
  };
}

export function buildExitFullLineWidgetBoundary({
  state,
  widgetPos,
  widgetNode = null,
  direction,
  transaction = null,
}) {
  const currentWidgetNode = widgetNode ?? state.doc.nodeAt(widgetPos);
  const widgetDefinition = getWidgetDefinitionFromNode(currentWidgetNode);

  if (!currentWidgetNode || !widgetDefinition?.fullLine) {
    return null;
  }

  const blocks = createBlockPositionList(state.doc);
  const blockIndex = blocks.findIndex((entry) => entry.pos === widgetPos);

  if (blockIndex < 0) {
    return null;
  }

  const adjacentBlock =
    direction === "before"
      ? blocks[blockIndex - 1] ?? null
      : blocks[blockIndex + 1] ?? null;
  const adjacentParagraph =
    adjacentBlock?.node?.type === editorSchema.nodes.paragraph
      ? adjacentBlock
      : null;
  const tr = transaction ?? state.tr;
  let targetPos = null;
  let createdParagraph = false;

  if (adjacentParagraph) {
    targetPos = direction === "before"
      ? adjacentParagraph.pos + adjacentParagraph.node.nodeSize - 1
      : adjacentParagraph.pos + 1;
  } else {
    const paragraphAttrs = direction === "before"
      ? blocks[blockIndex + 1]?.node?.type === editorSchema.nodes.paragraph
        ? blocks[blockIndex + 1].node.attrs
        : null
      : blocks[blockIndex - 1]?.node?.type === editorSchema.nodes.paragraph
        ? blocks[blockIndex - 1].node.attrs
        : null;
    const insertedParagraph = editorSchema.nodes.paragraph.createAndFill(paragraphAttrs);

    if (!insertedParagraph) {
      return null;
    }

    const insertPos =
      direction === "before"
        ? widgetPos
        : widgetPos + currentWidgetNode.nodeSize;

    tr.insert(insertPos, insertedParagraph);
    targetPos = insertPos + 1;
    createdParagraph = true;
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos), 1));

  return {
    tr,
    widgetType: widgetDefinition.type,
    targetPos,
    createdParagraph,
  };
}

export function getTrailingEmptyParagraphInfo(state, blockPos) {
  const blocks = createBlockPositionList(state.doc);
  const blockIndex = blocks.findIndex((entry) => entry.pos === blockPos);
  const followingBlock = blockIndex >= 0 ? blocks[blockIndex + 1] ?? null : null;
  return isEmptyParagraphNode(followingBlock?.node) ? followingBlock : null;
}
