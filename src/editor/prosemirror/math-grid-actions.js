import {
  createAlignBlockWithInsertedRow,
  createResizedAlignBlock,
  extractAlignRelationOperator,
  findAlignMathPos,
  getAlignRelationCellIndex,
  normalizeAlignGroupCount,
} from "./backslash-commands/align.js";
import {
  createGatherBlockWithInsertedRow,
  createResizedGatherBlock,
  findGatherMathPos,
  normalizeGatherColumnCount,
} from "./backslash-commands/gather.js";
import { editorSchema } from "./schema.js";
import { getAlignContextAtPos, getGatherContextAtPos } from "./slash-items/index.js";
import { setStoredMarksFromToolbarState } from "./state-helpers.js";
import {
  buildExitMathGridBoundary,
  buildMoveToMathGridCell,
} from "./transforms/math-structural.js";
import { buildReplaceMathGridBlock } from "./transforms/grid-structural.js";

export const mathGridActionMethods = {
  replaceMathGridBlock({
    blockPos,
    currentBlockNode,
    nextBlockNode,
    blockNodeType,
    mathNodeType,
    findMathPos,
    nextRowIndex = 0,
    nextCellIndex = 0,
    nextFocusEdge = "start",
    debugType = "controller.replaceMathGridBlock",
    debugDetail = {},
    debugPositionKey = "blockPos",
  }) {
    const result = buildReplaceMathGridBlock(this.view.state, {
      blockPos,
      currentBlockNode,
      nextBlockNode,
      blockNodeType,
      mathNodeType,
      findMathPos,
      nextRowIndex,
      nextCellIndex,
    });

    if (!result) {
      this.debugLog(`${debugType}.missingResult`, {
        [debugPositionKey]: blockPos,
        currentBlockType: currentBlockNode?.type?.name ?? null,
        nextBlockType: nextBlockNode?.type?.name ?? null,
        expectedBlockType: blockNodeType?.name ?? null,
        expectedMathType: mathNodeType?.name ?? null,
        nextRowIndex,
        nextCellIndex,
        ...debugDetail,
      });
      return false;
    }

    const { tr, targetMathId, targetMathNode } = result;
    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());

    if (targetMathId && targetMathNode?.type === mathNodeType) {
      this.beginWidgetFocusHandoff?.();
      this.prepareMathFocusHandoff?.(targetMathId, nextFocusEdge, {
        selectionMode: "collapse",
      });
      this.activeMathId = null;
      this.lastFocusedMathId = targetMathId;
      this.preservedTextSelection = null;
    }

    this.debugLog(debugType, {
      [debugPositionKey]: blockPos,
      nextRowIndex,
      nextCellIndex,
      targetMathId,
      ...debugDetail,
    });
    this.dispatchTransaction(tr);

    if (targetMathId && targetMathNode?.type === mathNodeType) {
      this.focusMathNode(targetMathId, nextFocusEdge);
      return true;
    }

    this.focus();
    return true;
  },

  moveToMathGridCellFromMath(
    pos,
    nextRowIndex,
    nextCellIndex,
    patch = null,
    {
      getContextAtPos,
      findMathPos,
      mathNodeType,
      focusEdge = "start",
      entryMode = "collapse",
      debugType = "controller.moveToMathGridCellFromMath",
      debugDetail = {},
    } = {}
  ) {
    const result = buildMoveToMathGridCell(this.view.state, {
      pos,
      nextRowIndex,
      nextCellIndex,
      patch,
      getContextAtPos,
      findMathPos,
      mathNodeType,
    });

    if (!result) {
      return false;
    }

    const { tr, targetMathId } = result;
    this.debugLog(debugType, {
      pos,
      nextRowIndex,
      nextCellIndex,
      targetMathId,
      focusEdge,
      entryMode,
      ...debugDetail,
    });
    return this.applyWidgetEntryTarget(
      this.createMathEntryTarget(targetMathId, focusEdge),
      {
        entryMode,
        transaction: tr,
        toolbarState: this.lastTextContext.toolbarState,
      }
    );
  },

  exitMathGridAfterBlock(
    pos,
    patch = null,
    {
      getContextAtPos,
      mathNodeType,
      debugType = "controller.exitMathGridAfterBlock",
    } = {}
  ) {
    const result = buildExitMathGridBoundary(this.view.state, {
      pos,
      patch,
      getContextAtPos,
      mathNodeType,
      direction: "after",
    });

    if (!result) {
      return false;
    }

    const { tr, exitPos, rowIndex, cellIndex } = result;
    setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };
    this.activeMathId = null;
    this.cancelPendingMathFocus();
    this.debugLog(debugType, {
      pos,
      rowIndex,
      cellIndex,
      exitPos,
    });
    this.dispatchTransaction(tr);
    this.focusEditorAfterMathExit({ immediate: true });
    return true;
  },

  exitMathGridBeforeBlock(
    pos,
    patch = null,
    {
      getContextAtPos,
      mathNodeType,
      debugType = "controller.exitMathGridBeforeBlock",
    } = {}
  ) {
    const result = buildExitMathGridBoundary(this.view.state, {
      pos,
      patch,
      getContextAtPos,
      mathNodeType,
      direction: "before",
    });

    if (!result) {
      return false;
    }

    const { tr, exitPos, rowIndex, cellIndex } = result;
    setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };
    this.activeMathId = null;
    this.cancelPendingMathFocus();
    this.debugLog(debugType, {
      pos,
      rowIndex,
      cellIndex,
      exitPos,
    });
    this.dispatchTransaction(tr);
    this.focusEditorAfterMathExit({ immediate: true });
    return true;
  },

  getMathGridTabSpecForNode(node) {
    if (node?.type === editorSchema.nodes.align_math) {
      return {
        getContextAtPos: getAlignContextAtPos,
        findMathPos: findAlignMathPos,
        mathNodeType: editorSchema.nodes.align_math,
        debugPrefix: "controller.handleAlignGridTab",
      };
    }

    if (node?.type === editorSchema.nodes.gather_math) {
      return {
        getContextAtPos: getGatherContextAtPos,
        findMathPos: findGatherMathPos,
        mathNodeType: editorSchema.nodes.gather_math,
        debugPrefix: "controller.handleGatherGridTab",
      };
    }

    return null;
  },

  handleMathGridTab(pos, direction, patch = null) {
    const node = this.view.state.doc.nodeAt(pos);
    const spec = this.getMathGridTabSpecForNode(node);

    if (!spec) {
      return false;
    }

    const context = spec.getContextAtPos(this.view.state.doc, pos);

    if (!context) {
      return false;
    }

    const rowIndex = context.row.index;
    const cellIndex = context.cell.index;
    const rowCount = context.block.node.childCount;
    const columnCount = context.row.node.childCount;

    if (direction === "forward") {
      if (cellIndex < columnCount - 1) {
        return this.moveToMathGridCellFromMath(pos, rowIndex, cellIndex + 1, patch, {
          getContextAtPos: spec.getContextAtPos,
          findMathPos: spec.findMathPos,
          mathNodeType: spec.mathNodeType,
          focusEdge: "end",
          entryMode: "tab",
          debugType: `${spec.debugPrefix}.moveForward`,
          debugDetail: { rowIndex, cellIndex },
        });
      }

      if (rowIndex < rowCount - 1) {
        return this.moveToMathGridCellFromMath(pos, rowIndex + 1, 0, patch, {
          getContextAtPos: spec.getContextAtPos,
          findMathPos: spec.findMathPos,
          mathNodeType: spec.mathNodeType,
          focusEdge: "end",
          entryMode: "tab",
          debugType: `${spec.debugPrefix}.moveNextRow`,
          debugDetail: { rowIndex, cellIndex },
        });
      }

      return this.exitMathGridAfterBlock(pos, patch, {
        getContextAtPos: spec.getContextAtPos,
        mathNodeType: spec.mathNodeType,
        debugType: `${spec.debugPrefix}.exitAfter`,
      });
    }

    if (cellIndex > 0) {
      return this.moveToMathGridCellFromMath(pos, rowIndex, cellIndex - 1, patch, {
        getContextAtPos: spec.getContextAtPos,
        findMathPos: spec.findMathPos,
        mathNodeType: spec.mathNodeType,
        focusEdge: "end",
        entryMode: "tab",
        debugType: `${spec.debugPrefix}.moveBackward`,
        debugDetail: { rowIndex, cellIndex },
      });
    }

    if (rowIndex > 0) {
      const previousRow = context.block.node.child(rowIndex - 1);
      return this.moveToMathGridCellFromMath(
        pos,
        rowIndex - 1,
        Math.max(0, previousRow.childCount - 1),
        patch,
        {
          getContextAtPos: spec.getContextAtPos,
          findMathPos: spec.findMathPos,
          mathNodeType: spec.mathNodeType,
          focusEdge: "end",
          entryMode: "tab",
          debugType: `${spec.debugPrefix}.movePreviousRow`,
          debugDetail: { rowIndex, cellIndex },
        }
      );
    }

    return this.exitMathGridBeforeBlock(pos, patch, {
      getContextAtPos: spec.getContextAtPos,
      mathNodeType: spec.mathNodeType,
      debugType: `${spec.debugPrefix}.exitBefore`,
    });
  },

  replaceAlignBlock(options) {
    return this.replaceMathGridBlock({
      ...options,
      blockPos: options.alignPos,
      currentBlockNode: options.currentBlockNode ?? options.currentAlignBlock,
      nextBlockNode: options.nextBlockNode ?? options.nextAlignBlock,
      blockNodeType: editorSchema.nodes.align_block,
      mathNodeType: editorSchema.nodes.align_math,
      findMathPos: findAlignMathPos,
      debugPositionKey: "alignPos",
    });
  },

  insertAlignRowBelowFromMath(pos, patch = null) {
    const currentNode = this.view.state.doc.nodeAt(pos);

    if (currentNode?.type !== editorSchema.nodes.align_math) {
      return false;
    }

    const nextPatch = patch
      ? Object.fromEntries(
          Object.entries(patch).filter(([key, value]) => currentNode.attrs[key] !== value)
        )
      : null;

    if (nextPatch && Object.keys(nextPatch).length > 0) {
      this.commitMathNode(pos, nextPatch);
    }

    const context = getAlignContextAtPos(this.view.state.doc, pos);

    if (!context) {
      return false;
    }

    const rowIndex = context.row.index;
    const cellIndex = context.cell.index;
    const relationCellIndex = Math.min(
      getAlignRelationCellIndex(cellIndex),
      context.row.node.childCount - 1
    );
    const relationCellNode = context.row.node.child(relationCellIndex);
    const relationSourceLatex =
      cellIndex === relationCellIndex
        ? nextPatch?.latex ?? currentNode.attrs.latex
        : relationCellNode?.attrs?.latex;
    const relationOperator = extractAlignRelationOperator(relationSourceLatex);
    const seededCellAttrs = relationOperator
      ? {
          [relationCellIndex]: this.createMathNodeAttrsForState(
            this.view.state,
            relationOperator
          ),
        }
      : null;

    const nextAlignBlock = createAlignBlockWithInsertedRow(
      editorSchema,
      context.block.node,
      rowIndex,
      () => this.createMathNodeAttrsForState(this.view.state),
      seededCellAttrs
    );
    const nextFocusEdge =
      relationOperator && cellIndex === relationCellIndex ? "end" : "start";

    return this.replaceAlignBlock({
      alignPos: context.block.pos,
      currentAlignBlock: context.block.node,
      nextAlignBlock,
      nextRowIndex: rowIndex + 1,
      nextCellIndex: cellIndex,
      nextFocusEdge,
      debugType: "controller.insertAlignRowBelowFromMath",
      debugDetail: {
        rowIndex,
        cellIndex,
        relationCellIndex,
        relationSourceLatex,
        relationOperator,
      },
    });
  },

  moveToAlignCellFromMath(pos, nextRowIndex, nextCellIndex, patch = null, options = {}) {
    return this.moveToMathGridCellFromMath(pos, nextRowIndex, nextCellIndex, patch, {
      getContextAtPos: getAlignContextAtPos,
      findMathPos: findAlignMathPos,
      mathNodeType: editorSchema.nodes.align_math,
      focusEdge: options.focusEdge ?? "start",
      entryMode: options.entryMode ?? "collapse",
      debugType: options.debugType ?? "controller.moveToAlignCellFromMath",
      debugDetail: options.debugDetail ?? {},
    });
  },

  handleAlignEnterFromMath(pos, patch = null) {
    const currentNode = this.view.state.doc.nodeAt(pos);

    if (currentNode?.type !== editorSchema.nodes.align_math) {
      return false;
    }

    const nextPatch = patch
      ? Object.fromEntries(
          Object.entries(patch).filter(([key, value]) => currentNode.attrs[key] !== value)
        )
      : null;

    if (nextPatch && Object.keys(nextPatch).length > 0) {
      this.commitMathNode(pos, nextPatch);
    }

    const context = getAlignContextAtPos(this.view.state.doc, pos);

    if (!context) {
      return false;
    }

    const rowIndex = context.row.index;
    const cellIndex = context.cell.index;

    if (rowIndex < context.block.node.childCount - 1) {
      return this.moveToAlignCellFromMath(pos, rowIndex + 1, cellIndex, null, {
        debugType: "controller.handleAlignEnterFromMath.moveDown",
        debugDetail: { rowIndex, cellIndex },
      });
    }

    return this.exitMathGridAfterBlock(pos, nextPatch, {
      getContextAtPos: getAlignContextAtPos,
      mathNodeType: editorSchema.nodes.align_math,
      debugType: "controller.handleAlignEnterFromMath.exitAfter",
    });
  },

  handleAlignMathExit(pos, direction, patch = null, options = {}) {
    return this.handleMathGridExit(pos, direction, patch, {
      getContextAtPos: getAlignContextAtPos,
      findMathPos: findAlignMathPos,
      mathNodeType: editorSchema.nodes.align_math,
      debugPrefix: "controller.handleAlignMathExit",
      deleteWhenEmpty: options.deleteWhenEmpty ?? false,
    });
  },

  replaceGatherBlock(options) {
    return this.replaceMathGridBlock({
      ...options,
      blockPos: options.gatherPos,
      currentBlockNode: options.currentBlockNode ?? options.currentGatherBlock,
      nextBlockNode: options.nextBlockNode ?? options.nextGatherBlock,
      blockNodeType: editorSchema.nodes.gather_block,
      mathNodeType: editorSchema.nodes.gather_math,
      findMathPos: findGatherMathPos,
      debugPositionKey: "gatherPos",
    });
  },

  insertGatherRowBelowFromMath(pos, patch = null) {
    const currentNode = this.view.state.doc.nodeAt(pos);

    if (currentNode?.type !== editorSchema.nodes.gather_math) {
      return false;
    }

    const nextPatch = patch
      ? Object.fromEntries(
          Object.entries(patch).filter(([key, value]) => currentNode.attrs[key] !== value)
        )
      : null;

    if (nextPatch && Object.keys(nextPatch).length > 0) {
      this.commitMathNode(pos, nextPatch);
    }

    const context = getGatherContextAtPos(this.view.state.doc, pos);

    if (!context) {
      return false;
    }

    const nextGatherBlock = createGatherBlockWithInsertedRow(
      editorSchema,
      context.block.node,
      context.row.index,
      () => this.createMathNodeAttrsForState(this.view.state)
    );

    return this.replaceGatherBlock({
      gatherPos: context.block.pos,
      currentGatherBlock: context.block.node,
      nextGatherBlock,
      nextRowIndex: context.row.index + 1,
      nextCellIndex: context.cell.index,
      debugType: "controller.insertGatherRowBelowFromMath",
      debugDetail: {
        rowIndex: context.row.index,
        cellIndex: context.cell.index,
      },
    });
  },

  moveToGatherCellFromMath(pos, nextRowIndex, nextCellIndex, patch = null, options = {}) {
    return this.moveToMathGridCellFromMath(pos, nextRowIndex, nextCellIndex, patch, {
      getContextAtPos: getGatherContextAtPos,
      findMathPos: findGatherMathPos,
      mathNodeType: editorSchema.nodes.gather_math,
      focusEdge: options.focusEdge ?? "start",
      entryMode: options.entryMode ?? "collapse",
      debugType: options.debugType ?? "controller.moveToGatherCellFromMath",
      debugDetail: options.debugDetail ?? {},
    });
  },

  handleGatherEnterFromMath(pos, patch = null) {
    const currentNode = this.view.state.doc.nodeAt(pos);

    if (currentNode?.type !== editorSchema.nodes.gather_math) {
      return false;
    }

    const nextPatch = patch
      ? Object.fromEntries(
          Object.entries(patch).filter(([key, value]) => currentNode.attrs[key] !== value)
        )
      : null;

    if (nextPatch && Object.keys(nextPatch).length > 0) {
      this.commitMathNode(pos, nextPatch);
    }

    const context = getGatherContextAtPos(this.view.state.doc, pos);

    if (!context) {
      return false;
    }

    const rowIndex = context.row.index;
    const cellIndex = context.cell.index;

    if (rowIndex < context.block.node.childCount - 1) {
      return this.moveToGatherCellFromMath(pos, rowIndex + 1, cellIndex, null, {
        debugType: "controller.handleGatherEnterFromMath.moveDown",
        debugDetail: { rowIndex, cellIndex },
      });
    }

    return this.exitMathGridAfterBlock(pos, nextPatch, {
      getContextAtPos: getGatherContextAtPos,
      mathNodeType: editorSchema.nodes.gather_math,
      debugType: "controller.handleGatherEnterFromMath.exitAfter",
    });
  },

  handleGatherMathExit(pos, direction, patch = null, options = {}) {
    return this.handleMathGridExit(pos, direction, patch, {
      getContextAtPos: getGatherContextAtPos,
      findMathPos: findGatherMathPos,
      mathNodeType: editorSchema.nodes.gather_math,
      debugPrefix: "controller.handleGatherMathExit",
      deleteWhenEmpty: options.deleteWhenEmpty ?? false,
    });
  },

  updateAlignSettings(alignPos, settings) {
    const alignNode = this.view.state.doc.nodeAt(alignPos);

    if (alignNode?.type !== editorSchema.nodes.align_block) {
      this.debugLog("controller.updateAlignSettings.missingNode", {
        alignPos,
        settings,
        foundType: alignNode?.type?.name ?? null,
      });
      return false;
    }

    const rowCount = Math.max(
      1,
      Number.parseInt(String(alignNode.childCount), 10) || alignNode.childCount || 1
    );
    const currentGroupCount = normalizeAlignGroupCount(
      alignNode.attrs.groupCount,
      Math.ceil((alignNode.firstChild?.childCount ?? 2) / 2)
    );
    const groupCount = normalizeAlignGroupCount(
      settings?.columnCount ?? currentGroupCount,
      currentGroupCount
    );
    const anchorTarget = this.getFocusedOrPendingMathTarget();
    const alignContext = anchorTarget?.node?.type === editorSchema.nodes.align_math
      ? getAlignContextAtPos(this.view.state.doc, anchorTarget.pos)
      : null;
    this.debugLog("controller.updateAlignSettings.begin", {
      alignPos,
      settings,
      currentGroupCount,
      nextGroupCount: groupCount,
      rowCount,
      anchorTarget: anchorTarget
        ? { id: anchorTarget.id, pos: anchorTarget.pos, type: anchorTarget.node?.type?.name ?? null }
        : null,
      alignContext: alignContext
        ? { rowIndex: alignContext.row.index, cellIndex: alignContext.cell.index }
        : null,
    });
    const nextAlignBlock = createResizedAlignBlock(
      editorSchema,
      alignNode,
      rowCount,
      groupCount,
      () => this.createMathNodeAttrsForState(this.view.state)
    );
    const nextRowIndex = Math.max(0, Math.min(alignContext?.row.index ?? 0, rowCount - 1));
    let nextCellIndex = Math.max(0, Math.min(alignContext?.cell.index ?? 0, groupCount * 2 - 1));

    if (!alignContext && groupCount > currentGroupCount) {
      nextCellIndex = Math.max(0, Math.min(currentGroupCount * 2, groupCount * 2 - 1));
    }

    return this.replaceAlignBlock({
      alignPos,
      currentAlignBlock: alignNode,
      nextAlignBlock,
      nextRowIndex,
      nextCellIndex,
      debugType: "controller.updateAlignSettings",
      debugDetail: { rowCount, groupCount },
    });
  },

  updateGatherSettings(gatherPos, settings) {
    const gatherNode = this.view.state.doc.nodeAt(gatherPos);

    if (gatherNode?.type !== editorSchema.nodes.gather_block) {
      return false;
    }

    const rowCount = Math.max(
      1,
      Number.parseInt(String(gatherNode.childCount), 10) || gatherNode.childCount || 1
    );
    const currentColumnCount = normalizeGatherColumnCount(
      gatherNode.attrs.columnCount,
      gatherNode.firstChild?.childCount ?? 1
    );
    const columnCount = normalizeGatherColumnCount(
      settings?.columnCount ?? currentColumnCount,
      currentColumnCount
    );
    const anchorTarget = this.getFocusedOrPendingMathTarget();
    const gatherContext = anchorTarget?.node?.type === editorSchema.nodes.gather_math
      ? getGatherContextAtPos(this.view.state.doc, anchorTarget.pos)
      : null;
    const nextGatherBlock = createResizedGatherBlock(
      editorSchema,
      gatherNode,
      rowCount,
      columnCount,
      () => this.createMathNodeAttrsForState(this.view.state)
    );
    const nextRowIndex = Math.max(0, Math.min(gatherContext?.row.index ?? 0, rowCount - 1));
    let nextCellIndex = Math.max(0, Math.min(gatherContext?.cell.index ?? 0, columnCount - 1));

    if (!gatherContext && columnCount > currentColumnCount) {
      nextCellIndex = Math.max(0, Math.min(currentColumnCount, columnCount - 1));
    }

    return this.replaceGatherBlock({
      gatherPos,
      currentGatherBlock: gatherNode,
      nextGatherBlock,
      nextRowIndex,
      nextCellIndex,
      debugType: "controller.updateGatherSettings",
      debugDetail: { rowCount, columnCount },
    });
  },

  deleteAlignAt(alignPos, options = {}) {
    const alignNode = this.view.state.doc.nodeAt(alignPos);

    if (alignNode?.type !== editorSchema.nodes.align_block) {
      return false;
    }

    return this.deleteWidgetAt(alignPos, {
      trigger: "direct",
      debugType: options.debugType ?? "controller.deleteAlignAt",
      debugDetail: { alignPos },
    });
  },

  deleteGatherAt(gatherPos, options = {}) {
    const gatherNode = this.view.state.doc.nodeAt(gatherPos);

    if (gatherNode?.type !== editorSchema.nodes.gather_block) {
      return false;
    }

    return this.deleteWidgetAt(gatherPos, {
      trigger: "direct",
      debugType: options.debugType ?? "controller.deleteGatherAt",
      debugDetail: { gatherPos },
    });
  },
};
