import { Fragment } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import {
  createGridRowsWithInsertedRow,
  createGridRowsWithoutRow,
  createResizedGridRows,
  findGridCellPos,
  normalizePositiveInt,
  resolveNodeAttrs,
} from "../grid-utils.js";

export function createTableParagraphAttrs(paragraphAttrs = {}) {
  return {
    ...paragraphAttrs,
    alignment: "center",
  };
}

function createParagraphNode(schema, attrs) {
  return schema.nodes.paragraph.createAndFill(createTableParagraphAttrs(attrs));
}

function createPlainParagraphNode(schema, attrs) {
  return schema.nodes.paragraph.createAndFill({ ...attrs });
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
  return {
    name: "table",
    title: "Table",
    description: "Insert a 2x2 table",
    execute({ state, match }) {
      const paragraphNode = match.paragraphNode;
      const parentNode = match.parentNode;

      if (!paragraphNode || !parentNode) {
        return null;
      }

      // First pass: keep table insertion in plain block flow.
      if (
        parentNode.type !== schema.nodes.page &&
        parentNode.type !== schema.nodes.table_cell
      ) {
        return null;
      }

      const tableNode = createDefaultTableNode(schema, 2, 2, paragraphNode.attrs);
      const trailingParagraph = createPlainParagraphNode(schema, paragraphNode.attrs);
      const replacement = Fragment.fromArray([tableNode, trailingParagraph]);
      const tablePos = match.paragraphPos;
      const tr = state.tr.replaceWith(
        match.paragraphPos,
        match.paragraphPos + paragraphNode.nodeSize,
        replacement
      );
      const selectionPos = findTableCellTextPos(tableNode, tablePos, 0, 0);

      tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos), 1));
      return tr;
    },
  };
}
