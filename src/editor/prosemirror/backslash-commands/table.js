import {
  createGridRowsWithInsertedRow,
  createGridRowsWithoutRow,
  createResizedGridRows,
  findGridCellPos,
  normalizePositiveInt,
  resolveNodeAttrs,
} from "../grid-utils.js";
import { createFullLineWidgetCommand } from "./block-widgets.js";

export function createTableParagraphAttrs(paragraphAttrs = {}) {
  return {
    ...paragraphAttrs,
    alignment: "center",
  };
}

function createParagraphNode(schema, attrs) {
  return schema.nodes.paragraph.createAndFill(createTableParagraphAttrs(attrs));
}

export function createTableCellNode(schema, paragraphAttrs) {
  return schema.nodes.table_cell.create(
    null,
    createParagraphNode(schema, paragraphAttrs)
  );
}

export function createTableRowNode(schema, columnCount, paragraphAttrs) {
  const cells = [];

  for (let index = 0; index < columnCount; index += 1) {
    cells.push(createTableCellNode(schema, paragraphAttrs));
  }

  return schema.nodes.table_row.create(null, cells);
}

export function createDefaultTableNode(schema, rowCount, columnCount, paragraphAttrs) {
  const rows = [];
  const safeRowCount = normalizePositiveInt(rowCount);

  for (let index = 0; index < safeRowCount; index += 1) {
    rows.push(createTableRowNode(schema, columnCount, paragraphAttrs));
  }

  return schema.nodes.table.create(null, rows);
}

export function createResizedTableNode(
  schema,
  tableNode,
  rowCount,
  columnCount,
  paragraphAttrs,
  tableAttrs = null
) {
  const safeColumnCount = normalizePositiveInt(
    columnCount,
    tableNode.firstChild?.childCount ?? 1
  );
  const rows = createResizedGridRows(tableNode, rowCount, (_rowIndex, existingRow) => {
    const cells = [];

    for (let cellIndex = 0; cellIndex < safeColumnCount; cellIndex += 1) {
      const existingCell =
        existingRow && cellIndex < existingRow.childCount
          ? existingRow.child(cellIndex)
          : null;

      cells.push(existingCell ?? createTableCellNode(schema, paragraphAttrs));
    }

    return schema.nodes.table_row.create(existingRow?.attrs ?? null, cells);
  });

  return schema.nodes.table.create(resolveNodeAttrs(tableNode, tableAttrs), rows);
}

export function createTableNodeWithInsertedRow(
  schema,
  tableNode,
  insertAfterRowIndex,
  paragraphAttrs,
  tableAttrs = null
) {
  const columnCount = Math.max(1, tableNode.firstChild?.childCount ?? 1);
  const nextRows = createGridRowsWithInsertedRow(
    tableNode,
    insertAfterRowIndex,
    () => createTableRowNode(schema, columnCount, paragraphAttrs)
  );

  return schema.nodes.table.create(resolveNodeAttrs(tableNode, tableAttrs), nextRows);
}

export function createTableNodeWithoutRow(
  schema,
  tableNode,
  removeRowIndex,
  tableAttrs = null
) {
  const nextRows = createGridRowsWithoutRow(tableNode, removeRowIndex);

  if (nextRows.length === 0) {
    return null;
  }

  return schema.nodes.table.create(resolveNodeAttrs(tableNode, tableAttrs), nextRows);
}

export function findTableCellTextPos(tableNode, tablePos, rowIndex, cellIndex) {
  return findGridCellPos(tableNode, tablePos, rowIndex, cellIndex) + 2;
}

export function createTableCommand(schema) {
  return createFullLineWidgetCommand({
    schema,
    name: "table",
    title: "Table",
    description: "Insert a 2x2 table",
    allowedParentTypes: [
      schema.nodes.page,
      schema.nodes.table_cell,
    ],
    createBlockNode: ({ match }) => {
      const paragraphNode = match.paragraphNode;
      const tableNode = createDefaultTableNode(schema, 2, 2, paragraphNode.attrs);
      return tableNode;
    },
    getSelectionTarget: ({ blockNode, blockPos }) => ({
      selectionPos: findTableCellTextPos(blockNode, blockPos, 0, 0),
      selectionBias: 1,
    }),
  });
}
