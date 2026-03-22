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

const ALIGN_RELATION_OPERATOR_PATTERNS = [
  { pattern: /^\\leq/, value: "\\leq" },
  { pattern: /^\\le(?![a-zA-Z])/, value: "\\leq" },
  { pattern: /^\\geq/, value: "\\geq" },
  { pattern: /^\\ge(?![a-zA-Z])/, value: "\\geq" },
  { pattern: /^\\lt(?![a-zA-Z])/, value: "<" },
  { pattern: /^\\gt(?![a-zA-Z])/, value: ">" },
  { pattern: /^=/, value: "=" },
  { pattern: /^</, value: "<" },
  { pattern: /^>/, value: ">" },
];

export function normalizeAlignGroupCount(value, fallbackValue = 1) {
  const safeFallbackValue = normalizePositiveInt(fallbackValue, 1);
  const parsedValue = Number.parseInt(String(value ?? safeFallbackValue), 10);

  if (!Number.isFinite(parsedValue)) {
    return safeFallbackValue;
  }

  return normalizePositiveInt(parsedValue, safeFallbackValue);
}

export function getAlignRelationCellIndex(cellIndex) {
  const safeCellIndex = Math.max(0, Number.parseInt(String(cellIndex ?? 0), 10) || 0);
  return Math.floor(safeCellIndex / 2) * 2 + 1;
}

export function extractAlignRelationOperator(latex) {
  const value = String(latex ?? "").trim().replace(/^(\\,|\\;|\\!|\\quad|\\qquad)+/, "");

  for (const { pattern, value: normalizedValue } of ALIGN_RELATION_OPERATOR_PATTERNS) {
    if (pattern.test(value)) {
      return normalizedValue;
    }
  }

  return "";
}

function getAlignGroupCountFromNode(alignBlockNode) {
  return normalizeAlignGroupCount(
    alignBlockNode?.attrs?.groupCount,
    Math.ceil((alignBlockNode?.firstChild?.childCount ?? 2) / 2)
  );
}

function resolveAlignBlockAttrs(alignBlockNode, alignBlockAttrs = null) {
  const nextAttrs = resolveNodeAttrs(alignBlockNode, alignBlockAttrs);

  nextAttrs.groupCount = normalizeAlignGroupCount(
    nextAttrs.groupCount,
    getAlignGroupCountFromNode(alignBlockNode)
  );

  return nextAttrs;
}

function createAlignCellAttrs(controller, state, attrs = {}) {
  return createMathGridCellAttrs("align-math", controller, state, attrs);
}

export function createAlignMathNode(schema, attrs) {
  return schema.nodes.align_math.create(attrs);
}

export function createAlignRowNode(
  schema,
  groupCount,
  createCellAttrs,
  rowIndex = 0,
  existingRow = null
) {
  const safeGroupCount = normalizeAlignGroupCount(
    groupCount,
    Math.ceil((existingRow?.childCount ?? 2) / 2)
  );
  const cellCount = safeGroupCount * 2;
  const cells = [];

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const existingCell =
      existingRow && cellIndex < existingRow.childCount
        ? existingRow.child(cellIndex)
        : null;

    cells.push(
      existingCell ??
        createAlignMathNode(schema, createCellAttrs(rowIndex, cellIndex))
    );
  }

  return schema.nodes.align_row.create(existingRow?.attrs ?? null, cells);
}

export function createDefaultAlignBlock(
  schema,
  rowCount = 1,
  groupCount = 1,
  createCellAttrs = () => ({})
) {
  const rows = [];
  const safeRowCount = normalizePositiveInt(rowCount, 1);
  const safeGroupCount = normalizeAlignGroupCount(groupCount);

  for (let rowIndex = 0; rowIndex < safeRowCount; rowIndex += 1) {
    rows.push(createAlignRowNode(schema, safeGroupCount, createCellAttrs, rowIndex));
  }

  return schema.nodes.align_block.create(
    resolveAlignBlockAttrs(null, { groupCount: safeGroupCount }),
    rows
  );
}

export function createResizedAlignBlock(
  schema,
  alignBlockNode,
  rowCount,
  groupCount,
  createCellAttrs = () => ({})
) {
  const safeGroupCount = normalizeAlignGroupCount(
    groupCount,
    getAlignGroupCountFromNode(alignBlockNode)
  );
  const rows = createResizedGridRows(
    alignBlockNode,
    rowCount,
    (rowIndex, existingRow) =>
      createAlignRowNode(
        schema,
        safeGroupCount,
        createCellAttrs,
        rowIndex,
        existingRow
      )
  );

  return schema.nodes.align_block.create(
    resolveAlignBlockAttrs(alignBlockNode, { groupCount: safeGroupCount }),
    rows
  );
}

export function createAlignBlockWithInsertedRow(
  schema,
  alignBlockNode,
  insertAfterRowIndex,
  createCellAttrs = () => ({}),
  seededCellAttrs = null
) {
  const groupCount = getAlignGroupCountFromNode(alignBlockNode);
  const nextRows = createGridRowsWithInsertedRow(
    alignBlockNode,
    insertAfterRowIndex,
    (rowIndex) =>
      createAlignRowNode(
        schema,
        groupCount,
        (_createdRowIndex, cellIndex) => ({
          ...createCellAttrs(rowIndex, cellIndex),
          ...(seededCellAttrs?.[cellIndex] ?? {}),
        }),
        rowIndex
      )
  );

  return schema.nodes.align_block.create(
    resolveAlignBlockAttrs(alignBlockNode),
    nextRows
  );
}

export function findAlignMathPos(alignBlockNode, alignBlockPos, rowIndex, cellIndex) {
  return findGridCellPos(alignBlockNode, alignBlockPos, rowIndex, cellIndex);
}

export function createAlignCommand(schema) {
  return createFullLineWidgetCommand({
    schema,
    name: "align",
    title: "Align",
    description: "Insert an align environment",
    allowedParentTypes: [
      schema.nodes.page,
      schema.nodes.list_item,
      schema.nodes.table_cell,
    ],
    createBlockNode: ({ state, controller }) => {
      const alignBlock = createDefaultAlignBlock(
        schema,
        1,
        1,
        (_rowIndex, _cellIndex) => createAlignCellAttrs(controller, state)
      );
      return alignBlock;
    },
    getSelectionTarget: ({ blockNode, blockPos }) => {
      const firstMathNode = blockNode.firstChild?.firstChild;
      const firstMathPos = findAlignMathPos(blockNode, blockPos, 0, 0);

      return {
        selectionPos: firstMathPos + (firstMathNode?.nodeSize ?? 1),
        selectionBias: -1,
        focusMathId: firstMathNode?.attrs?.id ?? null,
        focusMathEdge: "start",
      };
    },
  });
}
