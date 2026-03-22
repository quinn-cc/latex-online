import { liftListItem, sinkListItem } from "../../../vendor/prosemirror-schema-list/dist/index.js";
import { TextSelection } from "prosemirror-state";
import { createBlockPositionList } from "./page-layout.js";
import { mathGridActionMethods } from "./math-grid-actions.js";
import { editorSchema } from "./schema.js";
import {
  deleteSlashItem as deleteRegisteredSlashItem,
  isFullLineWidgetNode,
  getSlashWidgetTypeFromNode,
  getTableContext,
  updateSlashItemSettings as updateRegisteredSlashItemSettings,
} from "./slash-items/index.js";
import {
  getPageBlockBoundaryContext,
  isSelectionInsideListItem,
  setStoredMarksFromToolbarState,
} from "./state-helpers.js";
import { tableActionMethods } from "./table-actions.js";
import { buildExitFullLineWidgetBoundary } from "./transforms/full-line-widgets.js";
import {
  buildDeleteInlineMathAt,
  buildReplaceWidgetBlockWithParagraph,
  isMathGridBlockEmpty,
} from "./transforms/math-structural.js";

export const widgetActionMethods = {
  clearRemovedMathState(nodeId) {
    this.mathSession?.clearRemovedNode(nodeId);
  },

  replaceWidgetBlockWithParagraph(
    blockPos,
    blockNode,
    options = {}
  ) {
    const result = buildReplaceWidgetBlockWithParagraph(this.view.state, blockPos, blockNode);

    if (!result) {
      return false;
    }

    const {
      tr,
      blockNode: currentBlockNode,
      removedMathId,
      removedTrailingParagraph,
      nextSelectionPos,
    } = result;
    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
    this.clearRemovedMathState(removedMathId);
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };
    this.debugLog(options.debugType ?? "controller.replaceWidgetBlockWithParagraph", {
      blockPos,
      blockType: currentBlockNode.type.name,
      removedTrailingParagraph,
      removedMathId,
      nextSelectionPos,
      ...options.debugDetail,
    });
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  },

  deleteInlineMathAt(pos, direction = "after", options = {}) {
    const result = buildDeleteInlineMathAt(this.view.state, pos, direction);

    if (!result) {
      return false;
    }

    const { tr, node, targetSelection } = result;
    setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };
    this.clearRemovedMathState(node.attrs.id ?? null);
    this.debugLog(options.debugType ?? "controller.deleteInlineMathAt", {
      pos,
      direction,
      nodeId: node.attrs.id,
      targetSelection,
      ...options.debugDetail,
    });
    this.dispatchTransaction(tr);
    this.focusEditorAfterMathExit();
    return true;
  },

  exitFullLineWidgetBoundary(widgetPos, widgetNode, direction, options = {}) {
    const result = buildExitFullLineWidgetBoundary({
      state: this.view.state,
      widgetPos,
      widgetNode,
      direction,
      transaction: options.transaction ?? this.view.state.tr,
    });

    if (!result) {
      return false;
    }

    const { tr, targetPos, widgetType } = result;

    setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };
    this.activeMathId = null;
    this.clearBoundaryMathCapture?.();
    this.cancelPendingMathFocus?.();
    this.debugLog(options.debugType ?? "controller.exitFullLineWidgetBoundary", {
      widgetType,
      widgetPos,
      direction,
      targetSelection: tr.selection.from,
      ...options.debugDetail,
    });
    this.dispatchTransaction(tr);
    this.focusEditorAfterMathExit({ immediate: true });
    return true;
  },

  handleArrowLeft() {
    if (this.hasMathCapture()) {
      return false;
    }

    const tableContext = getTableContext(this.view.state);
    const selection = this.view.state.selection;

    if (
      tableContext &&
      selection instanceof TextSelection &&
      selection.empty &&
      selection.$from.parentOffset === 0 &&
      tableContext.row.index === 0 &&
      tableContext.cell.index === 0
    ) {
      return this.exitFullLineWidgetBoundary(
        tableContext.table.pos,
        tableContext.table.node,
        "before",
        {
          debugType: "controller.exitTableOnArrowLeft",
          debugDetail: {
            rowIndex: tableContext.row.index,
            cellIndex: tableContext.cell.index,
          },
        }
      );
    }

    return this.handleArrowIntoMath("left");
  },

  handleTab(isShift) {
    if (!this.isMathActive() && this.handleBoundaryMathTab(isShift)) {
      return true;
    }

    if (!this.isMathActive() && this.handlePendingMathTab(isShift)) {
      return true;
    }

    if (this.hasMathCapture()) {
      return false;
    }

    const tableContext = getTableContext(this.view.state);

    if (tableContext) {
      return isShift
        ? this.moveToPreviousTableCellOrExit(tableContext)
        : this.moveToNextTableCellOrExit(tableContext);
    }

    if (isSelectionInsideListItem(this.view.state)) {
      const listItemType = editorSchema.nodes.list_item;
      const command = isShift ? liftListItem(listItemType) : sinkListItem(listItemType);
      return command(this.view.state, this.view.dispatch, this.view);
    }

    return isShift ? false : this.insertTab();
  },

  handleBoundaryMathTab(isShift) {
    const target = this.getBoundaryMathTarget?.();

    if (!target || this.isMathActive()) {
      return false;
    }

    const nodeView = this.getMathView(target.id);
    const boundaryDirection = this.boundaryMathCaptureDirection;
    const focusEdge = boundaryDirection === "backward" ? "start" : "end";
    const navigationDirection = isShift ? "backward" : "forward";

    this.clearBoundaryMathCapture?.();

    if (nodeView?.focusAtEdge && nodeView?.handleTabNavigation) {
      try {
        nodeView.focusAtEdge(focusEdge);
        return nodeView.handleTabNavigation(navigationDirection);
      } catch (_error) {
        return false;
      }
    }

    return false;
  },

  handlePendingMathTab(isShift) {
    if (!this.hasPendingMathFocus() || this.isMathActive()) {
      return false;
    }

    const target = this.getMathTargetById(this.pendingMathFocusId);

    if (!target) {
      return false;
    }

    const direction = isShift ? "before" : "after";
    const gridDirection = isShift ? "backward" : "forward";
    const nodeView = this.getMathView(target.id);

    if (nodeView?.focusAtEdge && nodeView?.handleTabNavigation) {
      const focusEdge = this.pendingMathFocusEdge ?? (isShift ? "end" : "start");

      try {
        nodeView.focusAtEdge(focusEdge);
        return nodeView.handleTabNavigation(gridDirection);
      } catch (_error) {
        // Fall through to structural handling if the live node view isn't ready yet.
      }
    }

    const patch = nodeView?.getDraftPatch?.() ?? null;

    if (
      target.node.type === editorSchema.nodes.align_math ||
      target.node.type === editorSchema.nodes.gather_math
    ) {
      return this.handleMathGridTab(target.pos, gridDirection, patch);
    }

    if (String(target.node.attrs.latex ?? "").trim() === "") {
      return this.removeMathNode(target.pos, direction);
    }

    return this.commitAndExitMathNode(target.pos, direction, patch);
  },

  removeEmptyMathGridBlock(
    pos,
    {
      getContextAtPos,
      debugType = "controller.removeEmptyMathGridBlock",
      debugDetail = {},
    } = {}
  ) {
    const context = getContextAtPos?.(this.view.state.doc, pos);

    if (!context || !isMathGridBlockEmpty(context.block.node)) {
      return false;
    }

    return this.replaceWidgetBlockWithParagraph(
      context.block.pos,
      context.block.node,
      {
        debugType,
        debugDetail: {
          pos,
          rowIndex: context.row.index,
          cellIndex: context.cell.index,
          ...debugDetail,
        },
      }
    );
  },

  ...tableActionMethods,

  deletePreviousWidgetBlock() {
    const boundaryContext = getPageBlockBoundaryContext(
      this.view.state,
      createBlockPositionList
    );
    const previousWidgetType = getSlashWidgetTypeFromNode(
      boundaryContext?.previousBlock?.node
    );

    if (!boundaryContext || !previousWidgetType) {
      return false;
    }

    const { previousBlock, block } = boundaryContext;
    if (block.node?.type === editorSchema.nodes.paragraph && block.node.content.size === 0) {
      return this.replaceWidgetBlockWithParagraph(
        previousBlock.pos,
        previousBlock.node,
        {
          debugType: "controller.deletePreviousWidgetBlock",
          debugDetail: {
            deletedWidgetType: previousWidgetType,
            deletedWidgetPos: previousBlock.pos,
          },
        }
      );
    }

    const tr = this.view.state.tr.delete(
      previousBlock.pos,
      previousBlock.pos + previousBlock.node.nodeSize
    );
    const deletedSize = previousBlock.node.nodeSize;
    const nextBlockPos = Math.max(0, block.pos - deletedSize);
    const nextSelectionPos = Math.max(
      1,
      Math.min(nextBlockPos + 1, tr.doc.content.size)
    );

    tr.setSelection(TextSelection.near(tr.doc.resolve(nextSelectionPos), 1));
    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
    this.debugLog("controller.deletePreviousWidgetBlock", {
      deletedWidgetType: previousWidgetType,
      deletedWidgetPos: previousBlock.pos,
      nextBlockPos,
      nextSelectionPos,
      removedTrailingParagraph: false,
    });
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  },

  handleMathGridExit(
    pos,
    direction,
    patch = null,
    {
      getContextAtPos,
      findMathPos,
      mathNodeType,
      debugPrefix = "controller.handleMathGridExit",
      deleteWhenEmpty = false,
    } = {}
  ) {
    const node = this.view.state.doc.nodeAt(pos);

    if (node?.type !== mathNodeType) {
      return false;
    }

    const nextPatch = patch
      ? Object.fromEntries(
          Object.entries(patch).filter(([key, value]) => node.attrs[key] !== value)
        )
      : null;
    const context = getContextAtPos(this.view.state.doc, pos);

    if (!context) {
      return false;
    }

    const rowIndex = context.row.index;
    const cellIndex = context.cell.index;
    const rowCount = context.block.node.childCount;
    const columnCount = context.row.node.childCount;
    const moveForward = direction !== "before";
    const tr = this.view.state.tr;

    if (deleteWhenEmpty) {
      const didDeleteEmptyBlock = this.removeEmptyMathGridBlock(pos, {
        getContextAtPos,
        debugType: `${debugPrefix}.deleteEmptyBlock`,
        debugDetail: {
          direction,
        },
      });

      if (didDeleteEmptyBlock) {
        this.debugLog(`${debugPrefix}.deleteEmptyBlock`, {
          pos,
          rowIndex,
          cellIndex,
          direction,
        });
        return true;
      }
    }

    if (nextPatch && Object.keys(nextPatch).length > 0) {
      tr.setNodeMarkup(pos, null, {
        ...node.attrs,
        ...nextPatch,
      });
    }

    if (moveForward) {
      const hasNextCellInRow = cellIndex < columnCount - 1;
      const hasNextRow = rowIndex < rowCount - 1;

      if (hasNextCellInRow || hasNextRow) {
        const nextRowIndex = hasNextCellInRow ? rowIndex : rowIndex + 1;
        const nextCellIndex = hasNextCellInRow ? cellIndex + 1 : 0;
        const targetMathPos = findMathPos(
          context.block.node,
          context.block.pos,
          nextRowIndex,
          nextCellIndex
        );
        const targetMathNode = this.view.state.doc.nodeAt(targetMathPos);
        const targetMathId = targetMathNode?.attrs?.id ?? null;

        if (targetMathId && targetMathNode?.type === mathNodeType) {
          tr.setSelection(
            TextSelection.near(
              tr.doc.resolve(targetMathPos + targetMathNode.nodeSize),
              -1
            )
          );
          setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
          this.activeMathId = null;
          this.lastFocusedMathId = targetMathId;
          this.pendingMathFocusId = targetMathId;
          this.pendingMathFocusEdge = "start";
          this.preservedTextSelection = null;
          this.debugLog(`${debugPrefix}.moveForward`, {
            pos,
            rowIndex,
            cellIndex,
            nextRowIndex,
            nextCellIndex,
            targetMathId,
          });
          this.dispatchTransaction(tr);
          this.focusMathNode(targetMathId, "start");
          return true;
        }
      }

      return this.exitFullLineWidgetBoundary(
        context.block.pos,
        context.block.node,
        "after",
        {
          transaction: tr,
          debugType: `${debugPrefix}.exitAfter`,
          debugDetail: {
            pos,
            rowIndex,
            cellIndex,
          },
        }
      );
    }

    const hasPreviousCellInRow = cellIndex > 0;
    const hasPreviousRow = rowIndex > 0;

    if (hasPreviousCellInRow || hasPreviousRow) {
      const previousRowIndex = hasPreviousCellInRow ? rowIndex : rowIndex - 1;
      const previousCellIndex = hasPreviousCellInRow
        ? cellIndex - 1
        : context.block.node.child(previousRowIndex).childCount - 1;
      const targetMathPos = findMathPos(
        context.block.node,
        context.block.pos,
        previousRowIndex,
        previousCellIndex
      );
      const targetMathNode = this.view.state.doc.nodeAt(targetMathPos);
      const targetMathId = targetMathNode?.attrs?.id ?? null;

      if (targetMathId && targetMathNode?.type === mathNodeType) {
        tr.setSelection(
          TextSelection.near(
            tr.doc.resolve(targetMathPos + targetMathNode.nodeSize),
            -1
          )
        );
        setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
        this.activeMathId = null;
        this.lastFocusedMathId = targetMathId;
        this.pendingMathFocusId = targetMathId;
        this.pendingMathFocusEdge = "end";
        this.preservedTextSelection = null;
        this.debugLog(`${debugPrefix}.moveBackward`, {
          pos,
          rowIndex,
          cellIndex,
          previousRowIndex,
          previousCellIndex,
          targetMathId,
        });
        this.dispatchTransaction(tr);
        this.focusMathNode(targetMathId, "end");
        return true;
      }
    }

    return this.exitFullLineWidgetBoundary(
      context.block.pos,
      context.block.node,
      "before",
      {
        transaction: tr,
        debugType: `${debugPrefix}.exitBefore`,
        debugDetail: {
          pos,
          rowIndex,
          cellIndex,
        },
      }
    );
  },

  ...mathGridActionMethods,

  updateSlashItemSettings(item, settings) {
    return updateRegisteredSlashItemSettings(this, item, settings);
  },

  deleteSlashItem(item) {
    return deleteRegisteredSlashItem(this, item);
  },
};
