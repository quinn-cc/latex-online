import {
  createResizedTableNode,
  createTableNodeWithInsertedRow,
  createTableNodeWithoutRow,
  findTableCellTextPos,
} from "./backslash-commands/table.js";
import { editorSchema } from "./schema.js";
import { getTableAnchorIndices, getTableContext } from "./slash-items/index.js";
import { normalizeTableStyle } from "./table-styles.js";
import { getTableParagraphAttrs, setStoredMarksFromToolbarState } from "./state-helpers.js";
import { buildReplaceTableNode } from "./transforms/grid-structural.js";

export const tableActionMethods = {
  moveToTableCell(
    tableContext,
    nextRowIndex,
    nextCellIndex,
    {
      entryMode = "collapse",
      debugType = "controller.moveToTableCell",
      debugDetail = {},
    } = {}
  ) {
    if (!tableContext) {
      return false;
    }

    const nextSelectionPos = findTableCellTextPos(
      tableContext.table.node,
      tableContext.table.pos,
      nextRowIndex,
      nextCellIndex
    );
    const target = this.createTextEntryTarget(nextSelectionPos, 1);

    if (!target) {
      return false;
    }

    const didMove = this.applyWidgetEntryTarget(target, {
      entryMode,
      toolbarState: this.getCurrentTextToolbarState(),
    });

    if (!didMove) {
      return false;
    }

    this.debugLog(debugType, {
      tablePos: tableContext.table.pos,
      rowIndex: tableContext.row.index,
      cellIndex: tableContext.cell.index,
      nextRowIndex,
      nextCellIndex,
      entryMode,
      ...debugDetail,
    });
    return true;
  },

  moveToNextTableCellOrExit(tableContext = getTableContext(this.view.state)) {
    if (!tableContext) {
      return false;
    }

    const rowIndex = tableContext.row.index;
    const cellIndex = tableContext.cell.index;
    const rowCount = tableContext.table.node.childCount;
    const columnCount = tableContext.row.node.childCount;

    if (cellIndex < columnCount - 1) {
      return this.moveToTableCell(tableContext, rowIndex, cellIndex + 1, {
        entryMode: "tab",
        debugType: "controller.moveToNextTableCell",
      });
    }

    if (rowIndex < rowCount - 1) {
      return this.moveToTableCell(tableContext, rowIndex + 1, 0, {
        entryMode: "tab",
        debugType: "controller.moveToNextTableCell",
      });
    }

    return this.exitFullLineWidgetBoundary(
      tableContext.table.pos,
      tableContext.table.node,
      "after",
      {
        debugType: "controller.exitTableOnTab",
        debugDetail: {
          rowIndex,
          cellIndex,
        },
      }
    );
  },

  moveToPreviousTableCellOrExit(tableContext = getTableContext(this.view.state)) {
    if (!tableContext) {
      return false;
    }

    const rowIndex = tableContext.row.index;
    const cellIndex = tableContext.cell.index;

    if (cellIndex > 0) {
      return this.moveToTableCell(tableContext, rowIndex, cellIndex - 1, {
        entryMode: "tab",
        debugType: "controller.moveToPreviousTableCell",
      });
    }

    if (rowIndex > 0) {
      const previousRowIndex = rowIndex - 1;
      const previousRow = tableContext.table.node.child(previousRowIndex);

      return this.moveToTableCell(
        tableContext,
        previousRowIndex,
        previousRow.childCount - 1,
        {
          entryMode: "tab",
          debugType: "controller.moveToPreviousTableCell",
        }
      );
    }

    return this.exitFullLineWidgetBoundary(
      tableContext.table.pos,
      tableContext.table.node,
      "before",
      {
        debugType: "controller.exitTableOnShiftTab",
        debugDetail: {
          rowIndex,
          cellIndex,
        },
      }
    );
  },

  insertTableRowBelow() {
    const tableContext = getTableContext(this.view.state);

    if (!tableContext) {
      return false;
    }

    const rowIndex = tableContext.row.index;
    const cellIndex = tableContext.cell.index;
    const nextTable = createTableNodeWithInsertedRow(
      editorSchema,
      tableContext.table.node,
      rowIndex,
      getTableParagraphAttrs(this.view.state)
    );

    return this.replaceTableNode({
      tablePos: tableContext.table.pos,
      currentTableNode: tableContext.table.node,
      nextTable,
      nextRowIndex: rowIndex + 1,
      nextCellIndex: cellIndex,
      debugType: "controller.insertTableRowBelow",
      debugDetail: {
        rowIndex,
        cellIndex,
      },
    });
  },

  removeTableRowOrTable() {
    const tableContext = getTableContext(this.view.state);

    if (!tableContext) {
      return false;
    }

    const rowIndex = tableContext.row.index;
    const cellIndex = tableContext.cell.index;
    const rowCount = tableContext.table.node.childCount;

    if (rowCount <= 1) {
      return this.deleteTableAt(tableContext.table.pos, {
        debugType: "controller.removeTableRowOrTable.deleteTable",
      });
    }

    const nextTable = createTableNodeWithoutRow(
      editorSchema,
      tableContext.table.node,
      rowIndex
    );
    const nextRowIndex = Math.max(0, rowIndex - 1);
    const nextCellIndex = Math.min(cellIndex, nextTable.child(nextRowIndex).childCount - 1);

    return this.replaceTableNode({
      tablePos: tableContext.table.pos,
      currentTableNode: tableContext.table.node,
      nextTable,
      nextRowIndex,
      nextCellIndex,
      debugType: "controller.removeTableRowOrTable.deleteRow",
      debugDetail: {
        rowIndex,
        cellIndex,
      },
    });
  },

  replaceTableNode({
    tablePos,
    currentTableNode,
    nextTable,
    nextRowIndex = 0,
    nextCellIndex = 0,
    debugType = "controller.replaceTableNode",
    debugDetail = {},
  }) {
    const result = buildReplaceTableNode(this.view.state, {
      tablePos,
      currentTableNode,
      nextTable,
      findCellTextPos: findTableCellTextPos,
      nextRowIndex,
      nextCellIndex,
    });

    if (!result) {
      return false;
    }

    const { tr } = result;
    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
    this.debugLog(debugType, {
      tablePos,
      nextRowIndex,
      nextCellIndex,
      ...debugDetail,
    });
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  },

  updateTableSettings(tablePos, settings) {
    const tableNode = this.view.state.doc.nodeAt(tablePos);

    if (tableNode?.type !== editorSchema.nodes.table) {
      return false;
    }

    const rowCount = Math.max(
      1,
      Number.parseInt(String(settings?.rowCount ?? tableNode.childCount), 10) ||
        tableNode.childCount
    );
    const columnCount = Math.max(
      1,
      Number.parseInt(
        String(settings?.columnCount ?? tableNode.firstChild?.childCount ?? 1),
        10
      ) || tableNode.firstChild?.childCount || 1
    );
    const tableStyle = normalizeTableStyle(
      settings?.tableStyle ?? tableNode.attrs.tableStyle
    );
    const nextTable = createResizedTableNode(
      editorSchema,
      tableNode,
      rowCount,
      columnCount,
      getTableParagraphAttrs(this.view.state),
      {
        ...tableNode.attrs,
        tableStyle,
      }
    );
    const anchor = getTableAnchorIndices(this.view.state, tablePos) ?? {
      rowIndex: 0,
      cellIndex: 0,
    };
    const nextRowIndex = Math.min(anchor.rowIndex, rowCount - 1);
    const nextCellIndex = Math.min(anchor.cellIndex, columnCount - 1);

    return this.replaceTableNode({
      tablePos,
      currentTableNode: tableNode,
      nextTable,
      nextRowIndex,
      nextCellIndex,
      debugType: "controller.updateTableSettings",
      debugDetail: {
        rowCount,
        columnCount,
        tableStyle,
      },
    });
  },

  deleteTableAt(tablePos, options = {}) {
    const tableNode = this.view.state.doc.nodeAt(tablePos);

    if (tableNode?.type !== editorSchema.nodes.table) {
      return false;
    }

    return this.deleteWidgetAt(tablePos, {
      trigger: "direct",
      debugType: options.debugType ?? "controller.deleteTableAt",
      debugDetail: {
        tablePos,
      },
    });
  },
};
