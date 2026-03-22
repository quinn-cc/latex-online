import { TextSelection } from "prosemirror-state";
import { normalizeAlignGroupCount } from "../backslash-commands/align.js";
import { normalizeGatherColumnCount } from "../backslash-commands/gather.js";
import { editorSchema } from "../schema.js";
import { normalizeTableStyle } from "../table-styles.js";
import {
  getWidgetTypeFromNode,
  isFullLineWidgetNode as isRegisteredFullLineWidgetNode,
} from "../widget-registry.js";

function findAncestorNodeInfo($pos, targetType) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);

    if (node.type === targetType) {
      return {
        node,
        pos: $pos.before(depth),
        depth,
      };
    }
  }

  return null;
}

export function getTableContext(state) {
  const { selection } = state;

  if (!(selection instanceof TextSelection) || !selection.empty) {
    return null;
  }

  const { $from } = selection;
  let tableInfo = null;
  let rowInfo = null;
  let cellInfo = null;
  let rowIndex = null;
  let cellIndex = null;

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);

    if (!cellInfo && node.type === editorSchema.nodes.table_cell) {
      cellInfo = {
        node,
        pos: $from.before(depth),
      };
      continue;
    }

    if (!rowInfo && node.type === editorSchema.nodes.table_row) {
      rowInfo = {
        node,
        pos: $from.before(depth),
      };
      cellIndex = $from.index(depth);
      continue;
    }

    if (!tableInfo && node.type === editorSchema.nodes.table) {
      tableInfo = {
        node,
        pos: $from.before(depth),
      };
      rowIndex = $from.index(depth);
      break;
    }
  }

  if (
    !tableInfo ||
    !rowInfo ||
    !cellInfo ||
    rowIndex == null ||
    cellIndex == null
  ) {
    return null;
  }

  return {
    table: tableInfo,
    row: {
      ...rowInfo,
      index: rowIndex,
    },
    cell: {
      ...cellInfo,
      index: cellIndex,
    },
  };
}

function getMathGridContextAtPos(doc, mathPos, { blockType, rowType, cellType }) {
  const cellNode = doc.nodeAt(mathPos);

  if (cellNode?.type !== cellType) {
    return null;
  }

  const $pos = doc.resolve(mathPos);
  let blockInfo = null;
  let rowInfo = null;
  let rowIndex = null;
  let cellIndex = null;

  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth);

    if (!rowInfo && node.type === rowType) {
      rowInfo = {
        node,
        pos: $pos.before(depth),
      };
      cellIndex = $pos.index(depth);
      continue;
    }

    if (!blockInfo && node.type === blockType) {
      blockInfo = {
        node,
        pos: $pos.before(depth),
      };
      rowIndex = $pos.index(depth);
      break;
    }
  }

  if (!blockInfo || !rowInfo || rowIndex == null || cellIndex == null) {
    return null;
  }

  return {
    block: blockInfo,
    row: {
      ...rowInfo,
      index: rowIndex,
    },
    cell: {
      node: cellNode,
      pos: mathPos,
      index: cellIndex,
    },
  };
}

export function getAlignContextAtPos(doc, alignMathPos) {
  return getMathGridContextAtPos(doc, alignMathPos, {
    blockType: editorSchema.nodes.align_block,
    rowType: editorSchema.nodes.align_row,
    cellType: editorSchema.nodes.align_math,
  });
}

export function getGatherContextAtPos(doc, gatherMathPos) {
  return getMathGridContextAtPos(doc, gatherMathPos, {
    blockType: editorSchema.nodes.gather_block,
    rowType: editorSchema.nodes.gather_row,
    cellType: editorSchema.nodes.gather_math,
  });
}

export function getSlashWidgetTypeFromNode(node) {
  return getWidgetTypeFromNode(node);
}

export function isFullLineWidgetNode(node) {
  return isRegisteredFullLineWidgetNode(node);
}

export function getActiveTableItem(state) {
  const { selection } = state;

  if (selection.node?.type === editorSchema.nodes.table) {
    return {
      type: "table",
      pos: selection.from,
      node: selection.node,
      settings: {
        rowCount: selection.node.childCount,
        columnCount: selection.node.firstChild?.childCount ?? 1,
        tableStyle: normalizeTableStyle(selection.node.attrs.tableStyle),
      },
    };
  }

  const fromTable = findAncestorNodeInfo(selection.$from, editorSchema.nodes.table);
  const toTable = findAncestorNodeInfo(selection.$to, editorSchema.nodes.table);

  if (!fromTable || !toTable || fromTable.pos !== toTable.pos) {
    return null;
  }

  return {
    type: "table",
    pos: fromTable.pos,
    node: fromTable.node,
    settings: {
      rowCount: fromTable.node.childCount,
      columnCount: fromTable.node.firstChild?.childCount ?? 1,
      tableStyle: normalizeTableStyle(fromTable.node.attrs.tableStyle),
    },
  };
}

export function getActiveAlignItem(state, alignMathPos = null) {
  if (alignMathPos != null) {
    const alignContext = getAlignContextAtPos(state.doc, alignMathPos);

    if (!alignContext) {
      return null;
    }

    return {
      type: "align",
      pos: alignContext.block.pos,
      node: alignContext.block.node,
      settings: {
        columnCount: normalizeAlignGroupCount(
          alignContext.block.node.attrs.groupCount,
          Math.ceil((alignContext.row.node.childCount ?? 2) / 2)
        ),
      },
    };
  }

  const { selection } = state;

  if (selection.node?.type === editorSchema.nodes.align_block) {
    return {
      type: "align",
      pos: selection.from,
      node: selection.node,
      settings: {
        columnCount: normalizeAlignGroupCount(
          selection.node.attrs.groupCount,
          Math.ceil((selection.node.firstChild?.childCount ?? 2) / 2)
        ),
      },
    };
  }

  const fromAlign = findAncestorNodeInfo(selection.$from, editorSchema.nodes.align_block);
  const toAlign = findAncestorNodeInfo(selection.$to, editorSchema.nodes.align_block);

  if (!fromAlign || !toAlign || fromAlign.pos !== toAlign.pos) {
    return null;
  }

  return {
    type: "align",
    pos: fromAlign.pos,
    node: fromAlign.node,
    settings: {
      columnCount: normalizeAlignGroupCount(
        fromAlign.node.attrs.groupCount,
        Math.ceil((fromAlign.node.firstChild?.childCount ?? 2) / 2)
      ),
    },
  };
}

export function getActiveGatherItem(state, gatherMathPos = null) {
  if (gatherMathPos != null) {
    const gatherContext = getGatherContextAtPos(state.doc, gatherMathPos);

    if (!gatherContext) {
      return null;
    }

    return {
      type: "gather",
      pos: gatherContext.block.pos,
      node: gatherContext.block.node,
      settings: {
        columnCount: normalizeGatherColumnCount(
          gatherContext.block.node.attrs.columnCount,
          gatherContext.row.node.childCount ?? 1
        ),
      },
    };
  }

  const { selection } = state;

  if (selection.node?.type === editorSchema.nodes.gather_block) {
    return {
      type: "gather",
      pos: selection.from,
      node: selection.node,
      settings: {
        columnCount: normalizeGatherColumnCount(
          selection.node.attrs.columnCount,
          selection.node.firstChild?.childCount ?? 1
        ),
      },
    };
  }

  const fromGather = findAncestorNodeInfo(selection.$from, editorSchema.nodes.gather_block);
  const toGather = findAncestorNodeInfo(selection.$to, editorSchema.nodes.gather_block);

  if (!fromGather || !toGather || fromGather.pos !== toGather.pos) {
    return null;
  }

  return {
    type: "gather",
    pos: fromGather.pos,
    node: fromGather.node,
    settings: {
      columnCount: normalizeGatherColumnCount(
        fromGather.node.attrs.columnCount,
        fromGather.node.firstChild?.childCount ?? 1
      ),
    },
  };
}

export function getTableAnchorIndices(state, tablePos) {
  const { selection } = state;

  if (selection.node?.type === editorSchema.nodes.table && selection.from === tablePos) {
    return {
      rowIndex: 0,
      cellIndex: 0,
    };
  }

  const tableInfo = findAncestorNodeInfo(selection.$from, editorSchema.nodes.table);

  if (!tableInfo || tableInfo.pos !== tablePos) {
    return null;
  }

  let rowIndex = 0;
  let cellIndex = 0;

  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth);

    if (node.type === editorSchema.nodes.table_row) {
      cellIndex = selection.$from.index(depth);
      continue;
    }

    if (node.type === editorSchema.nodes.table) {
      rowIndex = selection.$from.index(depth);
      break;
    }
  }

  return {
    rowIndex,
    cellIndex,
  };
}
