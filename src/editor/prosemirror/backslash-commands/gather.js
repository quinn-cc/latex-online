import { Fragment } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import {
  createGridRowsWithInsertedRow,
  createResizedGridRows,
  findGridCellPos,
  normalizePositiveInt,
  resolveNodeAttrs,
} from "../grid-utils.js";
import {
  createMathGridCellAttrs,
  createPlainParagraphNode,
} from "./math-grid.js";

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
  return {
    name: "gather",
    title: "Gather",
    description: "Insert a gather environment",
    execute({ state, match, controller }) {
      const paragraphNode = match.paragraphNode;
      const parentNode = match.parentNode;

      if (!paragraphNode || !parentNode) {
        return null;
      }

      if (
        parentNode.type !== schema.nodes.page &&
        parentNode.type !== schema.nodes.list_item &&
        parentNode.type !== schema.nodes.table_cell
      ) {
        return null;
      }

      const gatherBlock = createDefaultGatherBlock(
        schema,
        1,
        1,
        (_rowIndex, _cellIndex) => createGatherCellAttrs(controller, state)
      );
      const firstMathNode = gatherBlock.firstChild?.firstChild;
      const firstMathId = firstMathNode?.attrs?.id ?? null;
      const trailingParagraph = createPlainParagraphNode(schema, paragraphNode.attrs);
      const replacement = Fragment.fromArray([gatherBlock, trailingParagraph]);
      const gatherPos = match.paragraphPos;
      const firstMathPos = findGatherMathPos(gatherBlock, gatherPos, 0, 0);
      const tr = state.tr.replaceWith(
        match.paragraphPos,
        match.paragraphPos + paragraphNode.nodeSize,
        replacement
      );

      tr.setSelection(
        TextSelection.near(
          tr.doc.resolve(firstMathPos + (firstMathNode?.nodeSize ?? 1)),
          -1
        )
      );

      return {
        tr,
        focusMathId: firstMathId,
        focusMathEdge: "start",
      };
    },
  };
}
