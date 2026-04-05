import {
  createGridRowsWithInsertedRow,
  createResizedGridRows,
  findGridCellPos,
  normalizePositiveInt,
  resolveNodeAttrs,
} from "../grid-utils.js";
import {
  createMathGridCellAttrs,
} from "./math-grid.js";
import { createFullLineWidgetCommand } from "./block-widgets.js";

export function normalizeGatherColumnCount(value, fallbackValue = 1) {
  const safeFallbackValue = normalizePositiveInt(fallbackValue, 1);
  const parsedValue = Number.parseInt(String(value ?? safeFallbackValue), 10);

  if (!Number.isFinite(parsedValue)) {
    return safeFallbackValue;
  }

  return normalizePositiveInt(parsedValue, safeFallbackValue);
}

function getGatherColumnCountFromNode(gatherBlockNode) {
  return normalizeGatherColumnCount(
    gatherBlockNode?.attrs?.columnCount,
    gatherBlockNode?.firstChild?.childCount ?? 1
  );
}

function resolveGatherBlockAttrs(gatherBlockNode, gatherBlockAttrs = null) {
  const nextAttrs = resolveNodeAttrs(gatherBlockNode, gatherBlockAttrs);

  nextAttrs.columnCount = normalizeGatherColumnCount(
    nextAttrs.columnCount,
    getGatherColumnCountFromNode(gatherBlockNode)
  );

  return nextAttrs;
}

function createGatherCellAttrs(controller, state, attrs = {}) {
  return createMathGridCellAttrs("gather-math", controller, state, attrs);
}

export function createGatherMathNode(schema, attrs) {
  return schema.nodes.gather_math.create(attrs);
}

export function createGatherRowNode(
  schema,
  columnCount,
  createCellAttrs,
  rowIndex = 0,
  existingRow = null
) {
  const safeColumnCount = normalizeGatherColumnCount(
    columnCount,
    existingRow?.childCount ?? 1
  );
  const cells = [];

  for (let cellIndex = 0; cellIndex < safeColumnCount; cellIndex += 1) {
    const existingCell =
      existingRow && cellIndex < existingRow.childCount
        ? existingRow.child(cellIndex)
        : null;

    cells.push(
      existingCell ??
        createGatherMathNode(schema, createCellAttrs(rowIndex, cellIndex))
    );
  }

  return schema.nodes.gather_row.create(existingRow?.attrs ?? null, cells);
}

export function createDefaultGatherBlock(
  schema,
  rowCount = 1,
  columnCount = 1,
  createCellAttrs = () => ({})
) {
  const rows = [];
  const safeRowCount = normalizePositiveInt(rowCount, 1);
  const safeColumnCount = normalizeGatherColumnCount(columnCount);

  for (let rowIndex = 0; rowIndex < safeRowCount; rowIndex += 1) {
    rows.push(createGatherRowNode(schema, safeColumnCount, createCellAttrs, rowIndex));
  }

  return schema.nodes.gather_block.create(
    resolveGatherBlockAttrs(null, { columnCount: safeColumnCount }),
    rows
  );
}

export function createResizedGatherBlock(
  schema,
  gatherBlockNode,
  rowCount,
  columnCount,
  createCellAttrs = () => ({})
) {
  const safeColumnCount = normalizeGatherColumnCount(
    columnCount,
    getGatherColumnCountFromNode(gatherBlockNode)
  );
  const rows = createResizedGridRows(
    gatherBlockNode,
    rowCount,
    (rowIndex, existingRow) =>
      createGatherRowNode(
        schema,
        safeColumnCount,
        createCellAttrs,
        rowIndex,
        existingRow
      )
  );

  return schema.nodes.gather_block.create(
    resolveGatherBlockAttrs(gatherBlockNode, { columnCount: safeColumnCount }),
    rows
  );
}

export function createGatherBlockWithInsertedRow(
  schema,
  gatherBlockNode,
  insertAfterRowIndex,
  createCellAttrs = () => ({})
) {
  const columnCount = getGatherColumnCountFromNode(gatherBlockNode);
  const nextRows = createGridRowsWithInsertedRow(
    gatherBlockNode,
    insertAfterRowIndex,
    (rowIndex) => createGatherRowNode(schema, columnCount, createCellAttrs, rowIndex)
  );

  return schema.nodes.gather_block.create(
    resolveGatherBlockAttrs(gatherBlockNode),
    nextRows
  );
}

export function findGatherMathPos(gatherBlockNode, gatherBlockPos, rowIndex, cellIndex) {
  return findGridCellPos(gatherBlockNode, gatherBlockPos, rowIndex, cellIndex);
}

export function createGatherCommand(schema) {
  return createFullLineWidgetCommand({
    schema,
    name: "gather",
    title: "Gather",
    description: "Insert a gather environment",
    allowedParentTypes: [
      schema.nodes.page,
      schema.nodes.list_item,
      schema.nodes.table_cell,
    ],
    createBlockNode: ({ state, controller }) => {
      const gatherBlock = createDefaultGatherBlock(
        schema,
        1,
        1,
        (_rowIndex, _cellIndex) => createGatherCellAttrs(controller, state)
      );
      return gatherBlock;
    },
  });
}
