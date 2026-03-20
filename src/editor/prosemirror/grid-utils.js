export function normalizePositiveInt(value, fallbackValue = 1) {
  const safeFallbackValue = Math.max(
    1,
    Number.parseInt(String(fallbackValue ?? 1), 10) || 1
  );
  const parsedValue = Number.parseInt(String(value ?? safeFallbackValue), 10);

  if (!Number.isFinite(parsedValue)) {
    return safeFallbackValue;
  }

  return Math.max(1, parsedValue);
}

export function resolveNodeAttrs(node, attrs = null) {
  if (!attrs) {
    return node?.attrs ?? null;
  }

  return {
    ...(node?.attrs ?? {}),
    ...(attrs ?? {}),
  };
}

export function createResizedGridRows(gridNode, rowCount, createRowNode) {
  const safeRowCount = normalizePositiveInt(rowCount, gridNode?.childCount ?? 1);
  const rows = [];

  for (let rowIndex = 0; rowIndex < safeRowCount; rowIndex += 1) {
    const existingRow =
      gridNode && rowIndex < gridNode.childCount ? gridNode.child(rowIndex) : null;

    rows.push(createRowNode(rowIndex, existingRow));
  }

  return rows;
}

export function createGridRowsWithInsertedRow(
  gridNode,
  insertAfterRowIndex,
  createRowNode
) {
  const parsedInsertAfterRowIndex = Number.parseInt(
    String(insertAfterRowIndex ?? gridNode.childCount - 1),
    10
  );
  const safeInsertAfterRowIndex = Math.max(
    -1,
    Math.min(
      Number.isFinite(parsedInsertAfterRowIndex)
        ? parsedInsertAfterRowIndex
        : gridNode.childCount - 1,
      gridNode.childCount - 1
    )
  );
  const nextRows = [];
  const newRow = createRowNode(safeInsertAfterRowIndex + 1, null);

  gridNode.forEach((rowNode, _offset, index) => {
    nextRows.push(rowNode);

    if (index === safeInsertAfterRowIndex) {
      nextRows.push(newRow);
    }
  });

  if (safeInsertAfterRowIndex < 0) {
    nextRows.unshift(newRow);
  }

  return nextRows;
}

export function createGridRowsWithoutRow(gridNode, removeRowIndex) {
  const parsedRemoveRowIndex = Number.parseInt(String(removeRowIndex ?? 0), 10);
  const safeRemoveRowIndex = Math.max(
    0,
    Math.min(
      Number.isFinite(parsedRemoveRowIndex) ? parsedRemoveRowIndex : 0,
      Math.max(0, gridNode.childCount - 1)
    )
  );
  const nextRows = [];

  gridNode.forEach((rowNode, _offset, index) => {
    if (index !== safeRemoveRowIndex) {
      nextRows.push(rowNode);
    }
  });

  return nextRows;
}

export function findGridCellPos(gridNode, gridPos, rowIndex, cellIndex) {
  const safeRowIndex = Math.max(0, Math.min(rowIndex, gridNode.childCount - 1));
  const rowNode = gridNode.child(safeRowIndex);
  const safeCellIndex = Math.max(0, Math.min(cellIndex, rowNode.childCount - 1));
  let rowPos = gridPos + 1;

  for (let index = 0; index < safeRowIndex; index += 1) {
    rowPos += gridNode.child(index).nodeSize;
  }

  let cellPos = rowPos + 1;

  for (let index = 0; index < safeCellIndex; index += 1) {
    cellPos += rowNode.child(index).nodeSize;
  }

  return cellPos;
}
