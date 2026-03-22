import { TextSelection } from "prosemirror-state";

export function buildReplaceTableNode(state, {
  tablePos,
  currentTableNode,
  nextTable,
  findCellTextPos,
  nextRowIndex = 0,
  nextCellIndex = 0,
}) {
  const tableNode = currentTableNode ?? state.doc.nodeAt(tablePos);

  if (!tableNode || !nextTable || tableNode.type !== nextTable.type) {
    return null;
  }

  const tr = state.tr.replaceWith(
    tablePos,
    tablePos + tableNode.nodeSize,
    nextTable
  );
  const nextSelectionPos = findCellTextPos(
    nextTable,
    tablePos,
    nextRowIndex,
    nextCellIndex
  );

  tr.setSelection(TextSelection.near(tr.doc.resolve(nextSelectionPos), 1));

  return {
    tr,
    nextSelectionPos,
    nextRowIndex,
    nextCellIndex,
  };
}

export function buildReplaceMathGridBlock(state, {
  blockPos,
  currentBlockNode,
  nextBlockNode,
  blockNodeType,
  mathNodeType,
  findMathPos,
  nextRowIndex = 0,
  nextCellIndex = 0,
}) {
  const blockNode = currentBlockNode ?? state.doc.nodeAt(blockPos);

  if (blockNode?.type !== blockNodeType || nextBlockNode?.type !== blockNodeType) {
    return null;
  }

  const targetMathPos = findMathPos(
    nextBlockNode,
    blockPos,
    nextRowIndex,
    nextCellIndex
  );
  const targetMathRow = nextBlockNode.child(
    Math.max(0, Math.min(nextRowIndex, nextBlockNode.childCount - 1))
  );
  const targetMathCellCount = targetMathRow?.childCount ?? 1;
  const targetMathNode = targetMathRow?.child(
    Math.max(0, Math.min(nextCellIndex, targetMathCellCount - 1))
  );
  const targetMathId = targetMathNode?.attrs?.id ?? null;
  const tr = state.tr.replaceWith(
    blockPos,
    blockPos + blockNode.nodeSize,
    nextBlockNode
  );

  if (targetMathPos != null) {
    tr.setSelection(
      TextSelection.near(
        tr.doc.resolve(targetMathPos + (targetMathNode?.nodeSize ?? 1)),
        -1
      )
    );
  }

  return {
    tr,
    targetMathId,
    targetMathNode,
    targetMathPos,
    nextRowIndex,
    nextCellIndex,
  };
}
