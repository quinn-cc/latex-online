import { TextSelection } from "prosemirror-state";
import { editorSchema } from "../schema.js";
import { createBlockPositionList } from "../page-layout.js";
import { isMathNode } from "../state-helpers.js";

function isEmptyParagraphNode(node) {
  return node?.type === editorSchema.nodes.paragraph && node.content.size === 0;
}

export function isMathGridBlockEmpty(blockNode) {
  if (!blockNode) {
    return false;
  }

  let hasMathCell = false;
  let isEmpty = true;

  blockNode.descendants((node) => {
    if (
      node.type !== editorSchema.nodes.align_math &&
      node.type !== editorSchema.nodes.gather_math
    ) {
      return true;
    }

    hasMathCell = true;

    if (String(node.attrs.latex ?? "").trim() !== "") {
      isEmpty = false;
      return false;
    }

    return true;
  });

  return hasMathCell && isEmpty;
}

export function buildReplaceWidgetBlockWithParagraph(state, blockPos, blockNode = null) {
  const currentBlockNode = blockNode ?? state.doc.nodeAt(blockPos);

  if (!currentBlockNode) {
    return null;
  }

  const blocks = createBlockPositionList(state.doc);
  const blockIndex = blocks.findIndex((entry) => entry.pos === blockPos);
  const followingBlock = blockIndex >= 0 ? blocks[blockIndex + 1] ?? null : null;
  const trailingParagraph = isEmptyParagraphNode(followingBlock?.node)
    ? followingBlock
    : null;
  const deleteTo = trailingParagraph
    ? trailingParagraph.pos + trailingParagraph.node.nodeSize
    : blockPos + currentBlockNode.nodeSize;
  const replacementParagraph = editorSchema.nodes.paragraph.createAndFill(
    trailingParagraph?.node?.attrs ?? null
  );

  if (!replacementParagraph) {
    return null;
  }

  const tr = state.tr.replaceWith(blockPos, deleteTo, replacementParagraph);
  const nextSelectionPos = Math.max(1, Math.min(blockPos + 1, tr.doc.content.size));
  const removedMathId = isMathNode(currentBlockNode)
    ? currentBlockNode.attrs.id ?? null
    : null;

  tr.setSelection(TextSelection.near(tr.doc.resolve(nextSelectionPos), 1));

  return {
    tr,
    blockNode: currentBlockNode,
    removedMathId,
    removedTrailingParagraph: Boolean(trailingParagraph),
    nextSelectionPos,
  };
}

export function buildDeleteInlineMathAt(state, pos, direction = "after") {
  const node = state.doc.nodeAt(pos);

  if (node?.type !== editorSchema.nodes.inline_math) {
    return null;
  }

  let tr = state.tr.delete(pos, pos + node.nodeSize);
  const resolvedPos = Math.max(0, Math.min(pos, tr.doc.content.size));
  tr = tr.setSelection(
    TextSelection.near(tr.doc.resolve(resolvedPos), direction === "before" ? -1 : 1)
  );

  return {
    tr,
    node,
    targetSelection: tr.selection.from,
  };
}

export function buildMoveToMathGridCell(state, {
  pos,
  nextRowIndex,
  nextCellIndex,
  patch = null,
  getContextAtPos,
  findMathPos,
  mathNodeType,
}) {
  const currentNode = state.doc.nodeAt(pos);

  if (currentNode?.type !== mathNodeType) {
    return null;
  }

  const nextPatch = patch
    ? Object.fromEntries(
        Object.entries(patch).filter(([key, value]) => currentNode.attrs[key] !== value)
      )
    : null;
  const context = getContextAtPos(state.doc, pos);

  if (!context) {
    return null;
  }

  const targetMathPos = findMathPos(
    context.block.node,
    context.block.pos,
    nextRowIndex,
    nextCellIndex
  );
  const targetMathNode = state.doc.nodeAt(targetMathPos);
  const targetMathId = targetMathNode?.attrs?.id ?? null;

  if (!targetMathId || targetMathNode?.type !== mathNodeType) {
    return null;
  }

  const tr = state.tr;

  if (nextPatch && Object.keys(nextPatch).length > 0) {
    tr.setNodeMarkup(pos, null, {
      ...currentNode.attrs,
      ...nextPatch,
    });
  }

  tr.setSelection(
    TextSelection.near(
      tr.doc.resolve(targetMathPos + targetMathNode.nodeSize),
      -1
    )
  );

  return {
    tr,
    targetMathId,
    nextRowIndex,
    nextCellIndex,
  };
}

export function buildExitMathGridBoundary(state, {
  pos,
  patch = null,
  getContextAtPos,
  mathNodeType,
  direction,
}) {
  const node = state.doc.nodeAt(pos);

  if (node?.type !== mathNodeType) {
    return null;
  }

  const nextPatch = patch
    ? Object.fromEntries(
        Object.entries(patch).filter(([key, value]) => node.attrs[key] !== value)
      )
    : null;
  const context = getContextAtPos(state.doc, pos);

  if (!context) {
    return null;
  }

  const tr = state.tr;

  if (nextPatch && Object.keys(nextPatch).length > 0) {
    tr.setNodeMarkup(pos, null, {
      ...node.attrs,
      ...nextPatch,
    });
  }

  const exitPos = direction === "before"
    ? context.block.pos
    : context.block.pos + context.block.node.nodeSize;

  tr.setSelection(TextSelection.near(tr.doc.resolve(exitPos), direction === "before" ? -1 : 1));

  return {
    tr,
    exitPos,
    rowIndex: context.row.index,
    cellIndex: context.cell.index,
  };
}
