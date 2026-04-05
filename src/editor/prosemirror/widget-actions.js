import { liftListItem, sinkListItem } from "../../../vendor/prosemirror-schema-list/dist/index.js";
import { TextSelection } from "prosemirror-state";
import { mathGridActionMethods } from "./math-grid-actions.js";
import { editorSchema } from "./schema.js";
import {
  canDeleteSlashItem as canDeleteRegisteredSlashItem,
  deleteSlashItem as deleteRegisteredSlashItem,
  getTableContext,
  updateSlashItemSettings as updateRegisteredSlashItemSettings,
} from "./slash-items/index.js";
import {
  getBlockBoundaryContext,
  isSelectionInsideListItem,
  isMathNode,
  setStoredMarksFromToolbarState,
} from "./state-helpers.js";
import { tableActionMethods } from "./table-actions.js";
import { buildExitFullLineWidgetBoundary } from "./transforms/full-line-widgets.js";
import {
  buildDeleteInlineMathAt,
  buildReplaceWidgetBlockWithParagraph,
  isMathGridBlockEmpty,
} from "./transforms/math-structural.js";
import {
  findEnclosingWidgetInfoAtPos,
  findEnclosingWidgetInfoForSelection,
  getWidgetDefinitionFromNode,
  isContentPosAtNodeLeadingBoundary,
  isSelectionAtNodeLeadingBoundary,
  resolveNodeBoundaryEntryTarget,
  resolveWidgetPointerEntryTarget,
} from "./widget-registry.js";

export const widgetActionMethods = {
  clearRemovedMathState(nodeId) {
    this.mathSession?.clearRemovedNode(nodeId);
  },

  clearRemovedMathStateFromNode(node) {
    if (!node) {
      return;
    }

    if (isMathNode(node)) {
      this.clearRemovedMathState(node.attrs.id ?? null);
    }

    node.descendants?.((childNode) => {
      if (isMathNode(childNode)) {
        this.clearRemovedMathState(childNode.attrs.id ?? null);
      }

      return true;
    });
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
    this.clearRemovedMathStateFromNode(currentBlockNode);
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

  createWidgetContext(widgetInfo, extra = {}) {
    if (!widgetInfo?.definition || !widgetInfo.node || widgetInfo.pos == null) {
      return null;
    }

    return {
      source: extra.source ?? "direct",
      definition: widgetInfo.definition,
      widget: {
        node: widgetInfo.node,
        pos: widgetInfo.pos,
      },
      ...extra,
    };
  },

  getWidgetContextAtPos(pos, extra = {}) {
    const widgetInfo = findEnclosingWidgetInfoAtPos(this.view.state.doc, pos);
    return this.createWidgetContext(widgetInfo, extra);
  },

  resolvePointerEntryTargetAtPos(pos, pointer = null) {
    if (!Number.isFinite(pos)) {
      return null;
    }

    const context = this.getWidgetContextAtPos(pos, {
      source: "pointer",
      contentPos: pos,
      pointer,
    });

    if (!context) {
      return null;
    }

    return resolveWidgetPointerEntryTarget(
      context.widget.node,
      context.widget.pos,
      {
        contentNode: this.view.state.doc.nodeAt(pos),
        contentPos: pos,
        pointer,
      }
    );
  },

  getEnclosingWidgetContextFromSelection(extra = {}) {
    const widgetInfo = findEnclosingWidgetInfoForSelection(this.view.state.selection);
    return this.createWidgetContext(widgetInfo, {
      source: "selection",
      ...extra,
    });
  },

  createTextEntryTarget(selectionPos, selectionBias = 1) {
    if (!Number.isFinite(selectionPos)) {
      return null;
    }

    let resolvedPos = null;

    try {
      resolvedPos = this.view.state.doc.resolve(selectionPos);
    } catch (_error) {
      return null;
    }

    const target = {
      kind: "selection",
      selectionPos,
      selectionBias,
    };

    if (resolvedPos.parent?.isTextblock) {
      target.selectionFrom = selectionPos;
      target.selectionTo = selectionPos + resolvedPos.parent.content.size;
    }

    return target;
  },

  createMathEntryTarget(mathId, edge = "start", extra = {}) {
    if (!mathId) {
      return null;
    }

    return {
      kind: "math",
      mathId,
      edge,
      ...extra,
    };
  },

  deleteWidget(context, options = {}) {
    const widgetNode = context?.widget?.node ?? null;
    const widgetPos = context?.widget?.pos ?? null;
    const definition = context?.definition ?? getWidgetDefinitionFromNode(widgetNode);

    if (!widgetNode || widgetPos == null || !definition) {
      return false;
    }

    const customDeleteResult = definition.deleteWidget?.({
      controller: this,
      context,
      options,
    });

    if (typeof customDeleteResult === "boolean") {
      return customDeleteResult;
    }

    if (options.trigger === "boundary" && context.blockBoundaryContext) {
      return this.removeBlockWidgetFromBoundary(context);
    }

    if (definition.placement === "inline") {
      const inlineDirection = options.direction ??
        (context.boundarySide === "after" ? "before" : "after");

      return this.deleteInlineMathAt(widgetPos, inlineDirection, {
        debugType: options.debugType ?? "controller.deleteWidget.inline",
        debugDetail: {
          trigger: options.trigger ?? "direct",
          widgetType: definition.type,
          ...options.debugDetail,
        },
      });
    }

    if (!definition.fullLine) {
      return false;
    }

    return this.replaceWidgetBlockWithParagraph(widgetPos, widgetNode, {
      debugType: options.debugType ?? "controller.deleteWidget.block",
      debugDetail: {
        trigger: options.trigger ?? "direct",
        widgetType: definition.type,
        ...options.debugDetail,
      },
    });
  },

  deleteWidgetAt(pos, options = {}) {
    const context = this.getWidgetContextAtPos(pos, {
      source: options.source ?? "direct",
      contentPos: options.contentPos ?? null,
    });

    if (!context) {
      return false;
    }

    return this.deleteWidget(context, options);
  },

  removeLeadingWidgetFromSelection() {
    const context = this.getEnclosingWidgetContextFromSelection();

    if (
      !context ||
      !isSelectionAtNodeLeadingBoundary(
        this.view.state,
        context.widget.node,
        context.widget.pos
      )
    ) {
      return false;
    }

    return this.deleteWidget(context, {
      trigger: "leading-boundary",
      debugType: "controller.removeLeadingWidgetFromSelection",
    });
  },

  removeLeadingWidgetFromContentPos(contentPos) {
    const context = this.getWidgetContextAtPos(contentPos, {
      source: "content",
      contentPos,
    });

    if (
      !context ||
      !isContentPosAtNodeLeadingBoundary(
        this.view.state.doc,
        context.widget.node,
        context.widget.pos,
        contentPos
      )
    ) {
      return false;
    }

    return this.deleteWidget(context, {
      trigger: "leading-boundary",
      direction: "before",
      debugType: "controller.removeLeadingWidgetFromContentPos",
      debugDetail: {
        contentPos,
      },
    });
  },

  getAdjacentWidgetContext(direction) {
    const { selection, doc } = this.view.state;

    if (!(selection instanceof TextSelection) || !selection.empty) {
      return null;
    }

    const boundarySide = direction === "backward" ? "after" : "before";
    const resolvedPos = selection.$from;
    const adjacentInlineNode =
      direction === "backward" ? resolvedPos.nodeBefore : resolvedPos.nodeAfter;
    const inlineDefinition = getWidgetDefinitionFromNode(adjacentInlineNode);

    if (inlineDefinition?.placement === "inline") {
      const widgetPos = direction === "backward"
        ? resolvedPos.pos - adjacentInlineNode.nodeSize
        : resolvedPos.pos;
      const widgetNode = doc.nodeAt(widgetPos);

      if (widgetNode) {
        return {
          source: "inline",
          direction,
          boundarySide,
          definition: inlineDefinition,
          widget: {
            node: widgetNode,
            pos: widgetPos,
          },
        };
      }
    }

    const blockBoundaryContext = getBlockBoundaryContext(this.view.state, direction);
    const adjacentBlock = blockBoundaryContext?.adjacentBlock ?? null;
    const blockDefinition = getWidgetDefinitionFromNode(adjacentBlock?.node);

    if (!adjacentBlock || !blockDefinition?.fullLine) {
      return null;
    }

    return {
      source: "block",
      direction,
      boundarySide,
      definition: blockDefinition,
      widget: {
        node: adjacentBlock.node,
        pos: adjacentBlock.pos,
      },
      blockBoundaryContext,
    };
  },

  applyWidgetEntryTarget(
    target,
    {
      entryMode = "collapse",
      transaction = null,
      toolbarState = null,
    } = {}
  ) {
    if (!target) {
      return false;
    }

    this.beginWidgetFocusHandoff?.();
    this.beginSlashItemStateHandoff?.();

    if (target.kind === "math") {
      if (!target.mathId) {
        return false;
      }

      const selectionMode = target.selectionMode ??
        (entryMode === "tab" ? "select-all" : "collapse");
      const offset = Number.isFinite(target.offset) ? target.offset : null;
      const edge = target.edge ?? (
        offset != null
          ? (offset <= 0 ? "start" : "end")
          : selectionMode === "select-all"
            ? "end"
            : "start"
      );

      this.lastFocusedMathId = target.mathId;
      this.prepareMathFocusHandoff?.(target.mathId, edge, {
        selectionMode,
        offset,
      });

      if (transaction) {
        if (toolbarState) {
          setStoredMarksFromToolbarState(transaction, toolbarState);
        }
        this.activeMathId = null;
        this.preservedTextSelection = null;
        this.dispatchTransaction(transaction);
      }

      this.focusMathNode(target.mathId, edge, {
        selectionMode,
        offset,
      });
      this.emitUiState();
      return true;
    }

    if (target.kind !== "selection" || !Number.isFinite(target.selectionPos)) {
      return false;
    }

    const tr = transaction ?? this.view.state.tr;
    const shouldSelectEntry = entryMode === "tab" &&
      Number.isFinite(target.selectionFrom) &&
      Number.isFinite(target.selectionTo);

    tr.setSelection(
      shouldSelectEntry
        ? TextSelection.create(
            tr.doc,
            target.selectionFrom,
            target.selectionTo
          )
        : TextSelection.near(
            tr.doc.resolve(target.selectionPos),
            target.selectionBias ?? 1
          )
    );
    setStoredMarksFromToolbarState(
      tr,
      toolbarState ?? this.getCurrentTextToolbarState()
    );
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  },

  enterAdjacentWidget(direction) {
    if (this.hasMathCapture()) {
      return false;
    }

    const context = this.getAdjacentWidgetContext(direction);

    if (!context) {
      return false;
    }

    const target = resolveNodeBoundaryEntryTarget(
      context.widget.node,
      context.widget.pos,
      context.boundarySide
    );

    if (!target) {
      return false;
    }

    const didEnter = this.applyWidgetEntryTarget(target);

    if (!didEnter) {
      return false;
    }

    this.debugLog("controller.enterAdjacentWidget", {
      direction,
      boundarySide: context.boundarySide,
      source: context.source,
      widgetType: context.definition.type,
      widgetPos: context.widget.pos,
      target,
    });
    return true;
  },

  removeBlockWidgetFromBoundary(context) {
    const blockBoundaryContext = context?.blockBoundaryContext;
    const widgetNode = context?.widget?.node ?? null;
    const widgetPos = context?.widget?.pos ?? null;
    const currentBlock = blockBoundaryContext?.block ?? null;

    if (
      !widgetNode ||
      widgetPos == null ||
      !currentBlock?.node ||
      currentBlock.pos == null
    ) {
      return false;
    }

    const selectionPosBeforeDelete = this.view.state.selection.from;
    let tr = this.view.state.tr;
    let nextSelectionPos = selectionPosBeforeDelete;
    let collapsedEmptyParagraph = false;

    if (
      currentBlock.node.type === editorSchema.nodes.paragraph &&
      currentBlock.node.content.size === 0
    ) {
      const replacementParagraph = editorSchema.nodes.paragraph.createAndFill(
        currentBlock.node.attrs
      );

      if (!replacementParagraph) {
        return false;
      }

      const replaceFrom = context.boundarySide === "after"
        ? widgetPos
        : currentBlock.pos;
      const replaceTo = context.boundarySide === "after"
        ? currentBlock.pos + currentBlock.node.nodeSize
        : widgetPos + widgetNode.nodeSize;

      tr = tr.replaceWith(replaceFrom, replaceTo, replacementParagraph);
      nextSelectionPos = replaceFrom + 1;
      collapsedEmptyParagraph = true;
    } else {
      tr = tr.delete(widgetPos, widgetPos + widgetNode.nodeSize);

      if (widgetPos < nextSelectionPos) {
        nextSelectionPos -= widgetNode.nodeSize;
      }

      nextSelectionPos = Math.max(1, Math.min(nextSelectionPos, tr.doc.content.size));
    }

    tr = tr.setSelection(
      TextSelection.near(
        tr.doc.resolve(nextSelectionPos),
        collapsedEmptyParagraph
          ? 1
          : context.boundarySide === "after"
            ? 1
            : -1
      )
    );
    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
    this.clearRemovedMathStateFromNode(widgetNode);
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };
    this.debugLog("controller.removeBlockWidgetFromBoundary", {
      boundarySide: context.boundarySide,
      collapsedEmptyParagraph,
      widgetType: context.definition.type,
      widgetPos,
      nextSelectionPos,
      containerType: blockBoundaryContext.container.node.type.name,
      currentBlockPos: currentBlock.pos,
    });
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  },

  removeAdjacentWidget(direction) {
    if (this.hasMathCapture()) {
      return false;
    }

    const context = this.getAdjacentWidgetContext(direction);

    if (!context) {
      return false;
    }

    return this.deleteWidget(context, {
      trigger: "boundary",
      direction: context.boundarySide === "after" ? "before" : "after",
      debugType: "controller.removeAdjacentWidget",
      debugDetail: {
        requestedDirection: direction,
        boundarySide: context.boundarySide,
        source: context.source,
      },
    });
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

    return this.enterAdjacentWidget("backward");
  },

  handleTab(isShift) {
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

    return this.deleteWidgetAt(context.block.pos, {
      trigger: "empty-grid",
      debugType,
      debugDetail: {
        pos,
        rowIndex: context.row.index,
        cellIndex: context.cell.index,
        ...debugDetail,
      },
    });
  },

  ...tableActionMethods,

  deletePreviousWidgetBlock() {
    return this.removeAdjacentWidget("backward");
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
          this.debugLog(`${debugPrefix}.moveForward`, {
            pos,
            rowIndex,
            cellIndex,
            nextRowIndex,
            nextCellIndex,
            targetMathId,
          });
          return this.applyWidgetEntryTarget(
            this.createMathEntryTarget(targetMathId, "start"),
            {
              transaction: tr,
              toolbarState: this.lastTextContext.toolbarState,
            }
          );
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
        this.debugLog(`${debugPrefix}.moveBackward`, {
          pos,
          rowIndex,
          cellIndex,
          previousRowIndex,
          previousCellIndex,
          targetMathId,
        });
        return this.applyWidgetEntryTarget(
          this.createMathEntryTarget(targetMathId, "end"),
          {
            transaction: tr,
            toolbarState: this.lastTextContext.toolbarState,
          }
        );
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

  canDeleteSlashItem(item) {
    return canDeleteRegisteredSlashItem(this, item);
  },

  deleteSlashItem(item) {
    return deleteRegisteredSlashItem(this, item);
  },
};
