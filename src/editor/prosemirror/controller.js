import { Fragment } from "prosemirror-model";
import { baseKeymap, splitBlockAs, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  liftListItem,
  sinkListItem,
  splitListItemKeepMarks,
  wrapInList,
} from "../../../vendor/prosemirror-schema-list/dist/index.js";
import {
  createDefaultPageSettings,
  normalizePageSettings,
  applyPageSettingsToPageElement,
} from "../../core/page-settings.js";
import {
  DEFAULT_MATH_STYLE,
  DEFAULT_TEXT_TOOLBAR_STATE,
} from "../../core/config.js";
import {
  createBackslashCommandRegistry,
  getExecutableBackslashCommandMatch,
} from "./backslash-commands/index.js";
import {
  createTableParagraphAttrs,
  createResizedTableNode,
  createTableNodeWithInsertedRow,
  createTableNodeWithoutRow,
  findTableCellTextPos,
} from "./backslash-commands/table.js";
import {
  createAlignBlockWithInsertedRow,
  extractAlignRelationOperator,
  findAlignMathPos,
  getAlignRelationCellIndex,
  createResizedAlignBlock,
  normalizeAlignGroupCount,
} from "./backslash-commands/align.js";
import {
  createGatherBlockWithInsertedRow,
  createResizedGatherBlock,
  findGatherMathPos,
  normalizeGatherColumnCount,
} from "./backslash-commands/gather.js";
import {
  DisplayMathNodeView,
  InlineMathNodeView,
  AlignMathNodeView,
  GatherMathNodeView,
} from "./math-node-view.js";
import { editorSchema } from "./schema.js";
import { createEmptyDocument } from "./document.js";
import { createMathTriggerPlugin } from "./math-trigger-plugin.js";
import {
  createDefaultMathStyle,
  createDefaultTextToolbarState,
  normalizeLineSpacing,
  normalizeMathFontFamily,
  normalizeMathFontSize,
  normalizeOrderedListStyle,
  normalizeParagraphSpacing,
  normalizeTextAlignment,
  normalizeTextFontFamily,
  normalizeTextFontSize,
} from "./options.js";
import { normalizeTableStyle } from "./table-styles.js";
import {
  deleteSlashItem as deleteRegisteredSlashItem,
  getActiveSlashItemState as getRegisteredSlashItemState,
  getAlignContextAtPos,
  getGatherContextAtPos,
  getSlashWidgetTypeFromNode,
  getTableAnchorIndices,
  getTableContext,
  updateSlashItemSettings as updateRegisteredSlashItemSettings,
} from "./slash-items/index.js";

let mathIdCounter = 0;

function isMathNode(node) {
  return (
    node?.type === editorSchema.nodes.inline_math ||
    node?.type === editorSchema.nodes.block_math ||
    node?.type === editorSchema.nodes.align_math ||
    node?.type === editorSchema.nodes.gather_math
  );
}

function createMathId() {
  mathIdCounter += 1;
  return `math-${Date.now().toString(36)}-${mathIdCounter.toString(36)}`;
}

function createLastTextContext(toolbarState = createDefaultTextToolbarState(), schema = editorSchema) {
  return {
    toolbarState: { ...toolbarState },
    marks: buildMarksFromToolbarState(toolbarState, schema),
  };
}

function buildMarksFromToolbarState(toolbarState, schema) {
  const marks = [];
  const { marks: markTypes } = schema;

  if (toolbarState.bold) {
    marks.push(markTypes.bold.create());
  }

  if (toolbarState.italic) {
    marks.push(markTypes.italic.create());
  }

  if (toolbarState.underline) {
    marks.push(markTypes.underline.create());
  }

  if (toolbarState.fontFamily !== DEFAULT_TEXT_TOOLBAR_STATE.fontFamily) {
    marks.push(markTypes.text_font_family.create({ value: toolbarState.fontFamily }));
  }

  if (toolbarState.fontSize !== DEFAULT_TEXT_TOOLBAR_STATE.fontSize) {
    marks.push(markTypes.text_font_size.create({ value: toolbarState.fontSize }));
  }

  return marks;
}

function getMarkValue(marks, markType, fallbackValue) {
  return marks.find((mark) => mark.type === markType)?.attrs?.value ?? fallbackValue;
}

function hasMark(marks, markType) {
  return marks.some((mark) => mark.type === markType);
}

function getSelectionMarks(state) {
  if (state.selection.empty) {
    return state.storedMarks ?? state.selection.$from.marks();
  }

  return state.selection.$from.marks();
}

function getPrimaryParagraphInfo(state, anchorPos = null) {
  const resolvedPos = anchorPos == null
    ? state.selection.$from
    : state.doc.resolve(anchorPos);

  for (let depth = resolvedPos.depth; depth >= 0; depth -= 1) {
    const node = resolvedPos.node(depth);

    if (node.type === editorSchema.nodes.paragraph) {
      return {
        node,
        pos: resolvedPos.before(depth),
      };
    }
  }

  return null;
}

function collectParagraphPositions(state, anchorFrom = null, anchorTo = null) {
  if (anchorFrom != null && anchorTo != null) {
    return collectParagraphPositionsInRange(state, anchorFrom, anchorTo);
  }

  if (!state.selection.empty) {
    return collectParagraphPositionsInRange(state, state.selection.from, state.selection.to);
  }

  const paragraph = getPrimaryParagraphInfo(state);
  return paragraph ? [paragraph.pos] : [];
}

function collectParagraphPositionsInRange(state, from, to) {
  const positions = [];

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === editorSchema.nodes.paragraph) {
      positions.push(pos);
    }
  });

  if (positions.length > 0) {
    return positions;
  }

  const paragraph = getPrimaryParagraphInfo(state, from);
  return paragraph ? [paragraph.pos] : [];
}

function collectMathPositionsInRange(state, from, to) {
  const positions = [];

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (isMathNode(node)) {
      positions.push(pos);
    }
  });

  return positions;
}

function getPrimaryListInfo(state, anchorPos = null) {
  const resolvedPos = anchorPos == null
    ? state.selection.$from
    : state.doc.resolve(anchorPos);

  for (let depth = resolvedPos.depth; depth >= 0; depth -= 1) {
    const node = resolvedPos.node(depth);

    if (
      node.type === editorSchema.nodes.bullet_list ||
      node.type === editorSchema.nodes.ordered_list
    ) {
      return {
        node,
        pos: resolvedPos.before(depth),
      };
    }
  }

  return null;
}

function getListToolbarType(node) {
  if (!node) {
    return DEFAULT_TEXT_TOOLBAR_STATE.listType;
  }

  if (node.type === editorSchema.nodes.bullet_list) {
    return "bullet";
  }

  if (node.type === editorSchema.nodes.ordered_list) {
    return normalizeOrderedListStyle(node.attrs.listStyle);
  }

  return DEFAULT_TEXT_TOOLBAR_STATE.listType;
}

function isSelectionInsideListItem(state) {
  const resolvedPos = state.selection.$from;

  for (let depth = resolvedPos.depth; depth >= 0; depth -= 1) {
    if (resolvedPos.node(depth).type === editorSchema.nodes.list_item) {
      return true;
    }
  }

  return false;
}

function isSelectionInEmptyListItem(state) {
  if (!state.selection.empty || !isSelectionInsideListItem(state)) {
    return false;
  }

  return state.selection.$from.parent.isTextblock &&
    state.selection.$from.parent.content.size === 0;
}

function getTableParagraphAttrs(state) {
  const paragraph = getPrimaryParagraphInfo(state)?.node;

  if (paragraph) {
    return createTableParagraphAttrs(paragraph.attrs);
  }

  return createTableParagraphAttrs({
    alignment: DEFAULT_TEXT_TOOLBAR_STATE.alignment,
    lineSpacing: DEFAULT_TEXT_TOOLBAR_STATE.lineSpacing,
    paragraphSpacing: DEFAULT_TEXT_TOOLBAR_STATE.paragraphSpacing,
  });
}

function getPageBlockBoundaryContext(state) {
  const { selection } = state;

  if (!(selection instanceof TextSelection) || !selection.empty) {
    return null;
  }

  const { $from } = selection;

  if (
    $from.parent.type !== editorSchema.nodes.paragraph ||
    $from.parentOffset !== 0
  ) {
    return null;
  }

  let blockPos = null;
  let blockNode = null;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (
      $from.node(depth).type === editorSchema.nodes.paragraph &&
      $from.node(depth - 1).type === editorSchema.nodes.page
    ) {
      blockNode = $from.node(depth);
      blockPos = $from.before(depth);
      break;
    }
  }

  if (!blockNode || blockPos == null) {
    return null;
  }

  const blocks = createBlockPositionList(state.doc);
  const blockIndex = blocks.findIndex((entry) => entry.pos === blockPos);

  if (blockIndex === -1) {
    return null;
  }

  return {
    block: {
      ...blocks[blockIndex],
      index: blockIndex,
    },
    previousBlock: blockIndex > 0 ? blocks[blockIndex - 1] : null,
  };
}

function createToolbarStateFromState(state, anchorPos = null) {
  const marks = getSelectionMarks(state);
  const paragraph = getPrimaryParagraphInfo(state, anchorPos);
  const paragraphAttrs = paragraph?.node.attrs ?? DEFAULT_TEXT_TOOLBAR_STATE;
  const list = getPrimaryListInfo(state, anchorPos);

  return {
    bold: hasMark(marks, editorSchema.marks.bold),
    italic: hasMark(marks, editorSchema.marks.italic),
    underline: hasMark(marks, editorSchema.marks.underline),
    listType: getListToolbarType(list?.node),
    alignment: normalizeTextAlignment(paragraphAttrs.alignment),
    lineSpacing: normalizeLineSpacing(paragraphAttrs.lineSpacing),
    paragraphSpacing: normalizeParagraphSpacing(paragraphAttrs.paragraphSpacing),
    fontFamily: normalizeTextFontFamily(
      getMarkValue(
        marks,
        editorSchema.marks.text_font_family,
        DEFAULT_TEXT_TOOLBAR_STATE.fontFamily
      )
    ),
    fontSize: normalizeTextFontSize(
      getMarkValue(
        marks,
        editorSchema.marks.text_font_size,
        DEFAULT_TEXT_TOOLBAR_STATE.fontSize
      )
    ),
  };
}

function createEmptySelectionState(doc) {
  return TextSelection.atStart(doc);
}

function createPageNode(blocks, pageNumber) {
  return editorSchema.nodes.page.create(
    { pageNumber },
    blocks.length > 0 ? blocks : [editorSchema.nodes.paragraph.createAndFill()]
  );
}

function flattenPageBlocks(doc) {
  const blocks = [];

  doc.forEach((pageNode) => {
    if (pageNode.type !== editorSchema.nodes.page) {
      return;
    }

    pageNode.forEach((blockNode) => {
      blocks.push(blockNode);
    });
  });

  return blocks;
}

function getCurrentPageBlockCounts(doc) {
  const counts = [];

  doc.forEach((pageNode) => {
    if (pageNode.type === editorSchema.nodes.page) {
      counts.push(pageNode.childCount);
    }
  });

  return counts.length > 0 ? counts : [1];
}

function arePageCountsEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((count, index) => count === right[index]);
}

function createBlockPositionList(doc) {
  const positions = [];

  doc.forEach((pageNode, pagePos) => {
    if (pageNode.type !== editorSchema.nodes.page) {
      return;
    }

    pageNode.forEach((blockNode, blockOffset) => {
      positions.push({
        node: blockNode,
        pos: pagePos + 1 + blockOffset,
      });
    });
  });

  return positions;
}

function measureBlockHeight(element) {
  if (!(element instanceof HTMLElement)) {
    return 0;
  }

  const styles = getComputedStyle(element);
  const marginTop = Number.parseFloat(styles.marginTop || "0") || 0;
  const marginBottom = Number.parseFloat(styles.marginBottom || "0") || 0;

  return element.offsetHeight + marginTop + marginBottom;
}

function createSelectionAnchor(doc, pos, assoc = 1) {
  const positions = createBlockPositionList(doc);
  const clampedPos = Math.max(0, Math.min(pos, doc.content.size));

  for (let index = 0; index < positions.length; index += 1) {
    const entry = positions[index];
    const start = entry.pos + 1;
    const end = entry.pos + entry.node.nodeSize - 1;

    if (clampedPos < start) {
      return {
        blockIndex: index,
        innerOffset: 0,
        assoc: -1,
      };
    }

    if (clampedPos <= end) {
      return {
        blockIndex: index,
        innerOffset: Math.max(0, Math.min(clampedPos - start, entry.node.content.size)),
        assoc,
      };
    }
  }

  const lastEntry = positions.at(-1);

  if (!lastEntry) {
    return {
      blockIndex: 0,
      innerOffset: 0,
      assoc: 1,
    };
  }

  return {
    blockIndex: positions.length - 1,
    innerOffset: lastEntry.node.content.size,
    assoc: 1,
  };
}

function resolveSelectionAnchor(doc, anchor) {
  const positions = createBlockPositionList(doc);
  const entry = positions[Math.max(0, Math.min(anchor.blockIndex, positions.length - 1))];

  if (!entry) {
    return 1;
  }

  const pos = entry.pos + 1 + Math.max(0, Math.min(anchor.innerOffset, entry.node.content.size));
  return Math.max(1, Math.min(pos, doc.content.size));
}

function setStoredMarksFromToolbarState(tr, toolbarState) {
  tr.setStoredMarks(buildMarksFromToolbarState(toolbarState, editorSchema));
}

function createTextMarkTransaction(state, markType, nextValue, isDefaultValue) {
  const tr = state.tr;
  const { from, to, empty } = state.selection;

  tr.removeMark(from, to, markType);

  if (empty) {
    const marks = (state.storedMarks ?? state.selection.$from.marks()).filter(
      (mark) => mark.type !== markType
    );

    if (!isDefaultValue) {
      marks.push(markType.create({ value: nextValue }));
    }

    tr.setStoredMarks(marks);
    return tr;
  }

  if (!isDefaultValue) {
    tr.addMark(from, to, markType.create({ value: nextValue }));
  }

  return tr;
}

function applyParagraphAttrs(tr, state, positions, patch) {
  for (const pos of positions) {
    const node = state.doc.nodeAt(pos);

    if (!node || node.type !== editorSchema.nodes.paragraph) {
      continue;
    }

    tr.setNodeMarkup(pos, null, {
      ...node.attrs,
      ...patch,
    });
  }
}

function applyMathAttrs(tr, state, positions, patch) {
  for (const pos of positions) {
    const node = state.doc.nodeAt(pos);

    if (!isMathNode(node)) {
      continue;
    }

    tr.setNodeMarkup(pos, null, {
      ...node.attrs,
      ...patch,
    });
  }
}

function documentHasContent(doc) {
  let hasContent = false;

  doc.descendants((node) => {
    if (node.isText && node.text?.length) {
      hasContent = true;
      return false;
    }

    if (isMathNode(node)) {
      hasContent = true;
      return false;
    }

    if (node.type === editorSchema.nodes.table) {
      hasContent = true;
      return false;
    }

    return true;
  });

  return hasContent;
}

function describeDomNode(node) {
  if (!node) {
    return null;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return `#text("${text.slice(0, 20)}")`;
  }

  if (!(node instanceof Element)) {
    return node.nodeName;
  }

  const id = node.id ? `#${node.id}` : "";
  const className = node.classList.length
    ? `.${Array.from(node.classList).slice(0, 3).join(".")}`
    : "";

  return `${node.tagName.toLowerCase()}${id}${className}`;
}

function summarizeDomSelection() {
  const selection = document.getSelection();

  return {
    anchorNode: describeDomNode(selection?.anchorNode),
    anchorOffset: selection?.anchorOffset ?? null,
    focusNode: describeDomNode(selection?.focusNode),
    focusOffset: selection?.focusOffset ?? null,
    type: selection?.type ?? null,
    rangeCount: selection?.rangeCount ?? 0,
  };
}

function summarizeMarks(marks) {
  return (marks ?? []).map((mark) => ({
    type: mark.type.name,
    attrs: { ...mark.attrs },
  }));
}

function summarizePmSelection(selection) {
  return {
    type: selection.constructor.name,
    from: selection.from,
    to: selection.to,
    anchor: selection.anchor,
    head: selection.head,
    empty: selection.empty,
  };
}

function summarizeMathTarget(target) {
  if (!target) {
    return null;
  }

  return {
    id: target.id,
    pos: target.pos,
    latex: target.node.attrs.latex,
    fontFamily: target.node.attrs.fontFamily,
    fontSize: target.node.attrs.fontSize,
    baseTextFontSize: target.node.attrs.baseTextFontSize,
  };
}

function summarizeTransaction(tr, prevState, nextState) {
  return {
    docChanged: tr.docChanged,
    selectionSet: tr.selectionSet,
    storedMarksSet: tr.storedMarksSet,
    stepCount: tr.steps.length,
    steps: tr.steps.map((step) => step.constructor.name),
    beforeSelection: summarizePmSelection(prevState.selection),
    afterSelection: summarizePmSelection(nextState.selection),
    transactionSelection: summarizePmSelection(tr.selection),
    storedMarks: summarizeMarks(
      nextState.storedMarks ?? nextState.selection.$from.marks()
    ),
  };
}

function createSplitParagraphCommand(controller) {
  const splitParagraph = splitBlockAs((node) => {
    if (node.type !== editorSchema.nodes.paragraph) {
      return null;
    }

    return {
      type: node.type,
      attrs: { ...node.attrs },
    };
  });

  return (state, dispatch) =>
    splitParagraph(state, (tr) => {
      setStoredMarksFromToolbarState(
        tr,
        controller.getCurrentTextToolbarState()
      );
      dispatch?.(tr);
    });
}

export class PaperEditorController {
  constructor({
    mount,
    initialDoc,
    initialPageSettings,
    saveDocument,
    MathfieldElementClass,
    onUiStateChange,
    onSlashItemStateChange,
    onPaginationChange,
    debug,
  }) {
    this.mount = mount;
    this.saveDocument = saveDocument;
    this.MathfieldElementClass = MathfieldElementClass;
    this.onUiStateChange = onUiStateChange;
    this.onSlashItemStateChange = onSlashItemStateChange;
    this.onPaginationChange = onPaginationChange;
    this.pageSettings = normalizePageSettings(
      initialPageSettings ?? createDefaultPageSettings()
    );
    this.debug = debug;
    this.backslashCommands = createBackslashCommandRegistry(editorSchema);

    this.mathViews = new Map();
    this.activeMathId = null;
    this.lastFocusedMathId = null;
    this.pendingMathFocusId = null;
    this.pendingMathFocusEdge = "start";
    this.pendingMathFocusFrame = 0;
    this.pendingRepaginationFrame = 0;
    this.preservedTextSelection = null;
    this.currentMathStyle = createDefaultMathStyle();
    this.lastTextContext = createLastTextContext();
    this.pageCount = Math.max(1, initialDoc?.childCount ?? 1);
    this.handleEnterCommand = createSplitParagraphCommand(this);

    const state = EditorState.create({
      schema: editorSchema,
      doc: initialDoc ?? createEmptyDocument(),
      plugins: this.createPlugins(),
    });

    this.mount.replaceChildren();
    this.view = new EditorView(this.mount, {
      state,
      dispatchTransaction: (tr) => this.dispatchTransaction(tr),
      nodeViews: {
        inline_math: (node, view, getPos) =>
          new InlineMathNodeView(node, view, getPos, {
            MathfieldElementClass: this.MathfieldElementClass,
            commitMathNode: (pos, patch) => this.commitMathNode(pos, patch),
            commitAndExitMathNode: (pos, direction, patch) =>
              this.commitAndExitMathNode(pos, direction, patch),
            exitMathNode: (pos, direction) => this.exitMathNode(pos, direction),
            handleMathBlur: (id, pos) => this.handleMathBlur(id, pos),
            handleMathFocus: (id, pos) => this.handleMathFocus(id, pos),
            registerMathView: (id, nodeView) => this.registerMathView(id, nodeView),
            removeMathNode: (pos, direction) => this.removeMathNode(pos, direction),
            selectMathNode: (pos) => this.selectMathNode(pos),
            shouldDebugLog: (type) => this.shouldDebugLog(type),
            unregisterMathView: (id, nodeView) => this.unregisterMathView(id, nodeView),
            debug: (type, detail) => this.debugLog(type, detail),
          }),
        block_math: (node, view, getPos) =>
          new DisplayMathNodeView(node, view, getPos, {
            MathfieldElementClass: this.MathfieldElementClass,
            commitMathNode: (pos, patch) => this.commitMathNode(pos, patch),
            commitAndExitMathNode: (pos, direction, patch) =>
              this.commitAndExitMathNode(pos, direction, patch),
            exitMathNode: (pos, direction) => this.exitMathNode(pos, direction),
            handleMathBlur: (id, pos) => this.handleMathBlur(id, pos),
            handleMathFocus: (id, pos) => this.handleMathFocus(id, pos),
            registerMathView: (id, nodeView) => this.registerMathView(id, nodeView),
            removeMathNode: (pos, direction) => this.removeMathNode(pos, direction),
            selectMathNode: (pos) => this.selectMathNode(pos),
            shouldDebugLog: (type) => this.shouldDebugLog(type),
            unregisterMathView: (id, nodeView) => this.unregisterMathView(id, nodeView),
            debug: (type, detail) => this.debugLog(type, detail),
          }),
        align_math: (node, view, getPos) =>
          new AlignMathNodeView(node, view, getPos, {
            MathfieldElementClass: this.MathfieldElementClass,
            commitMathNode: (pos, patch) => this.commitMathNode(pos, patch),
            commitAndExitMathNode: (pos, direction, patch) =>
              this.commitAndExitMathNode(pos, direction, patch),
            exitMathNode: (pos, direction) => this.exitMathNode(pos, direction),
            handleMathBlur: (id, pos) => this.handleMathBlur(id, pos),
            handleMathFocus: (id, pos) => this.handleMathFocus(id, pos),
            handleAlignEnter: (pos, patch) => this.handleAlignEnterFromMath(pos, patch),
            handleAlignShiftEnter: (pos, patch) =>
              this.insertAlignRowBelowFromMath(pos, patch),
            registerMathView: (id, nodeView) => this.registerMathView(id, nodeView),
            removeMathNode: (pos, direction) => this.removeMathNode(pos, direction),
            selectMathNode: (pos) => this.selectMathNode(pos),
            shouldDebugLog: (type) => this.shouldDebugLog(type),
            unregisterMathView: (id, nodeView) => this.unregisterMathView(id, nodeView),
            debug: (type, detail) => this.debugLog(type, detail),
          }),
        gather_math: (node, view, getPos) =>
          new GatherMathNodeView(node, view, getPos, {
            MathfieldElementClass: this.MathfieldElementClass,
            commitMathNode: (pos, patch) => this.commitMathNode(pos, patch),
            commitAndExitMathNode: (pos, direction, patch) =>
              this.commitAndExitMathNode(pos, direction, patch),
            exitMathNode: (pos, direction) => this.exitMathNode(pos, direction),
            handleMathBlur: (id, pos) => this.handleMathBlur(id, pos),
            handleMathFocus: (id, pos) => this.handleMathFocus(id, pos),
            handleGatherEnter: (pos, patch) => this.handleGatherEnterFromMath(pos, patch),
            handleGatherShiftEnter: (pos, patch) =>
              this.insertGatherRowBelowFromMath(pos, patch),
            registerMathView: (id, nodeView) => this.registerMathView(id, nodeView),
            removeMathNode: (pos, direction) => this.removeMathNode(pos, direction),
            selectMathNode: (pos) => this.selectMathNode(pos),
            shouldDebugLog: (type) => this.shouldDebugLog(type),
            unregisterMathView: (id, nodeView) => this.unregisterMathView(id, nodeView),
            debug: (type, detail) => this.debugLog(type, detail),
          }),
      },
      handleKeyDown: (_view, event) => this.handleEditorKeyDown(event),
      handleTextInput: (_view, from, to, text) => this.handleTextInput(from, to, text),
      attributes: {
        class: "ProseMirror pm-editor-root",
        spellcheck: "false",
        autocapitalize: "off",
        autocorrect: "off",
        autocomplete: "off",
      },
    });

    this.lastTextContext = createLastTextContext(
      createToolbarStateFromState(this.view.state),
      editorSchema
    );
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleRepagination();
    });
    this.resizeObserver.observe(this.mount);
    this.applyPageLayoutToDom();
    this.syncUi(false);
    this.emitUiState();
    this.emitSlashItemState();
    this.debugLog("controller.init", {
      selection: summarizePmSelection(this.view.state.selection),
    });
    this.updateDebugState("controller.init");
    this.notifyPageCount();
    this.scheduleRepagination();
  }

  createPlugins() {
    return [
      history(),
      createMathTriggerPlugin({
        convertLiteralMathTrigger: (state, triggerRange) =>
          this.convertLiteralMathTrigger(state, triggerRange),
        debug: (type, detail) => this.debugLog(type, detail),
      }),
      keymap({
        "Mod-b": () => this.toggleTextMark("bold"),
        "Mod-i": () => this.toggleTextMark("italic"),
        "Mod-u": () => this.toggleTextMark("underline"),
        "Mod-z": undo,
        "Shift-Mod-z": redo,
        "Mod-y": redo,
        Backspace: () => this.handleBackspace(),
        Enter: () => this.handleEnter(),
        "Shift-Enter": () => this.handleShiftEnter(),
        "Shift-Backspace": () => this.handleShiftBackspace(),
        Tab: () => this.handleTab(false),
        "Shift-Tab": () => this.handleTab(true),
        ArrowLeft: () => this.handleArrowIntoMath("left"),
        ArrowRight: () => this.handleArrowIntoMath("right"),
      }),
      keymap(baseKeymap),
    ];
  }

  destroy() {
    this.cancelPendingMathFocus();
    this.cancelPendingRepagination();
    this.resizeObserver?.disconnect();
    this.debugLog("controller.destroy");
    this.view.destroy();
  }

  focus() {
    this.view.focus();
    this.debugLog("controller.focus", {
      activeElement: describeDomNode(document.activeElement),
    });
    this.updateDebugState("controller.focus");
  }

  setPageSettings(pageSettings) {
    this.pageSettings = normalizePageSettings(pageSettings);
    this.applyPageLayoutToDom();
    this.scheduleRepagination();
  }

  clear() {
    this.currentMathStyle = createDefaultMathStyle();
    this.lastTextContext = createLastTextContext(
      createDefaultTextToolbarState(),
      editorSchema
    );
    this.activeMathId = null;
    this.lastFocusedMathId = null;
    this.pendingMathFocusId = null;
    this.preservedTextSelection = null;
    const doc = createEmptyDocument();
    const tr = this.view.state.tr.replaceWith(
      0,
      this.view.state.doc.content.size,
      doc.content
    );
    tr.setSelection(createEmptySelectionState(tr.doc));
    setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
    this.dispatchTransaction(tr);
    this.view.focus();
    this.debugLog("controller.clear");
  }

  applyPageLayoutToDom() {
    if (!this.view) {
      return;
    }

    const pageShells = Array.from(
      this.view.dom.querySelectorAll(".pm-page-shell")
    );
    const showHint = !documentHasContent(this.view.state.doc);

    pageShells.forEach((pageShell, index) => {
      applyPageSettingsToPageElement(pageShell, this.pageSettings, index + 1, {
        showHint: showHint && index === 0,
      });
    });
  }

  notifyPageCount() {
    const nextPageCount = Math.max(1, this.view.state.doc.childCount || 1);

    if (nextPageCount === this.pageCount) {
      return;
    }

    this.pageCount = nextPageCount;
    this.debugLog("controller.pageCount", {
      pageCount: nextPageCount,
    });
    this.onPaginationChange?.(nextPageCount);
    this.updateDebugState("controller.pageCount");
  }

  getDocument() {
    return this.createDocumentSnapshot();
  }

  createDocumentSnapshot() {
    let transaction = null;

    for (const [id, nodeView] of this.mathViews) {
      if (typeof nodeView.getDraftPatch !== "function") {
        continue;
      }

      const patch = nodeView.getDraftPatch();

      if (!patch || Object.keys(patch).length === 0) {
        continue;
      }

      const pos = this.findMathPositionById(id);

      if (pos == null) {
        continue;
      }

      const sourceDoc = transaction?.doc ?? this.view.state.doc;
      const node = sourceDoc.nodeAt(pos);

      if (!isMathNode(node)) {
        continue;
      }

      if (!transaction) {
        transaction = this.view.state.tr;
      }

      transaction.setNodeMarkup(pos, null, {
        ...node.attrs,
        ...patch,
      });
    }

    return transaction?.doc ?? this.view.state.doc;
  }

  handleEnter() {
    if (this.isMathActive()) {
      return false;
    }

    if (this.executeBackslashCommandAtSelection()) {
      return true;
    }

    const listItemType = editorSchema.nodes.list_item;

    if (splitListItemKeepMarks(listItemType)(this.view.state, this.view.dispatch, this.view)) {
      return true;
    }

    if (isSelectionInEmptyListItem(this.view.state)) {
      return liftListItem(listItemType)(
        this.view.state,
        this.view.dispatch,
        this.view
      );
    }

    return this.handleEnterCommand(
      this.view.state,
      this.view.dispatch,
      this.view
    );
  }

  handleShiftEnter() {
    const activeMathTarget = this.getFocusedOrPendingMathTarget();

    if (activeMathTarget?.node?.type === editorSchema.nodes.align_math) {
      const activeMathView = this.mathViews.get(activeMathTarget.id);
      const patch = activeMathView?.getDraftPatch?.() ?? null;

      return this.insertAlignRowBelowFromMath(activeMathTarget.pos, patch);
    }

    if (activeMathTarget?.node?.type === editorSchema.nodes.gather_math) {
      const activeMathView = this.mathViews.get(activeMathTarget.id);
      const patch = activeMathView?.getDraftPatch?.() ?? null;

      return this.insertGatherRowBelowFromMath(activeMathTarget.pos, patch);
    }

    if (this.hasMathCapture()) {
      return false;
    }

    return this.insertTableRowBelow();
  }

  handleShiftBackspace() {
    if (this.hasMathCapture()) {
      return false;
    }

    return this.removeTableRowOrTable();
  }

  handleBackspace() {
    if (this.hasMathCapture()) {
      return false;
    }

    return this.deletePreviousWidgetBlock();
  }

  executeBackslashCommandAtSelection() {
    const match = getExecutableBackslashCommandMatch(
      this.view.state,
      this.backslashCommands
    );

    if (!match) {
      return false;
    }

    const result = match.command.execute({
      state: this.view.state,
      match: match.query,
      controller: this,
    });

    const tr = result?.tr ?? result;

    if (!tr) {
      return false;
    }

    if (result?.focusMathId) {
      this.prepareMathInsertion(
        result.focusMathId,
        this.getCurrentTextToolbarState(),
        result.focusMathEdge ?? "start"
      );
    }

    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
    this.debugLog("controller.executeBackslashCommand", {
      command: match.command.name,
      paragraphPos: match.query.paragraphPos,
      parentNode: match.query.parentNode?.type?.name ?? null,
    });
    this.dispatchTransaction(tr);

    if (result?.focusMathId) {
      this.focusMathNode(
        result.focusMathId,
        result.focusMathEdge ?? "start"
      );
    }

    return true;
  }

  handleTab(isShift) {
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
  }

  moveToNextTableCellOrExit(tableContext = getTableContext(this.view.state)) {
    if (!tableContext) {
      return false;
    }

    const rowIndex = tableContext.row.index;
    const cellIndex = tableContext.cell.index;
    const rowCount = tableContext.table.node.childCount;
    const columnCount = tableContext.row.node.childCount;
    const hasNextCellInRow = cellIndex < columnCount - 1;
    const hasNextRow = rowIndex < rowCount - 1;

    if (hasNextCellInRow) {
      const nextSelectionPos = findTableCellTextPos(
        tableContext.table.node,
        tableContext.table.pos,
        rowIndex,
        cellIndex + 1
      );
      const tr = this.view.state.tr.setSelection(
        TextSelection.near(this.view.state.tr.doc.resolve(nextSelectionPos), 1)
      );

      setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
      this.debugLog("controller.moveToNextTableCell", {
        tablePos: tableContext.table.pos,
        rowIndex,
        cellIndex,
        nextRowIndex: rowIndex,
        nextCellIndex: cellIndex + 1,
      });
      this.dispatchTransaction(tr);
      this.focus();
      return true;
    }

    if (hasNextRow) {
      const nextSelectionPos = findTableCellTextPos(
        tableContext.table.node,
        tableContext.table.pos,
        rowIndex + 1,
        0
      );
      const tr = this.view.state.tr.setSelection(
        TextSelection.near(this.view.state.tr.doc.resolve(nextSelectionPos), 1)
      );

      setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
      this.debugLog("controller.moveToNextTableCell", {
        tablePos: tableContext.table.pos,
        rowIndex,
        cellIndex,
        nextRowIndex: rowIndex + 1,
        nextCellIndex: 0,
      });
      this.dispatchTransaction(tr);
      this.focus();
      return true;
    }

    const exitPos = tableContext.table.pos + tableContext.table.node.nodeSize;
    const tr = this.view.state.tr.setSelection(
      TextSelection.near(this.view.state.tr.doc.resolve(exitPos), 1)
    );

    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
    this.debugLog("controller.exitTableOnTab", {
      tablePos: tableContext.table.pos,
      rowIndex,
      cellIndex,
      exitPos,
    });
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  }

  moveToPreviousTableCellOrExit(tableContext = getTableContext(this.view.state)) {
    if (!tableContext) {
      return false;
    }

    const rowIndex = tableContext.row.index;
    const cellIndex = tableContext.cell.index;
    const hasPreviousCellInRow = cellIndex > 0;
    const hasPreviousRow = rowIndex > 0;

    if (hasPreviousCellInRow) {
      const previousSelectionPos = findTableCellTextPos(
        tableContext.table.node,
        tableContext.table.pos,
        rowIndex,
        cellIndex - 1
      );
      const tr = this.view.state.tr.setSelection(
        TextSelection.near(this.view.state.tr.doc.resolve(previousSelectionPos), 1)
      );

      setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
      this.debugLog("controller.moveToPreviousTableCell", {
        tablePos: tableContext.table.pos,
        rowIndex,
        cellIndex,
        nextRowIndex: rowIndex,
        nextCellIndex: cellIndex - 1,
      });
      this.dispatchTransaction(tr);
      this.focus();
      return true;
    }

    if (hasPreviousRow) {
      const previousRowIndex = rowIndex - 1;
      const previousRow = tableContext.table.node.child(previousRowIndex);
      const previousSelectionPos = findTableCellTextPos(
        tableContext.table.node,
        tableContext.table.pos,
        previousRowIndex,
        previousRow.childCount - 1
      );
      const tr = this.view.state.tr.setSelection(
        TextSelection.near(this.view.state.tr.doc.resolve(previousSelectionPos), 1)
      );

      setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
      this.debugLog("controller.moveToPreviousTableCell", {
        tablePos: tableContext.table.pos,
        rowIndex,
        cellIndex,
        nextRowIndex: previousRowIndex,
        nextCellIndex: previousRow.childCount - 1,
      });
      this.dispatchTransaction(tr);
      this.focus();
      return true;
    }

    const exitPos = tableContext.table.pos;
    const tr = this.view.state.tr.setSelection(
      TextSelection.near(this.view.state.tr.doc.resolve(exitPos), -1)
    );

    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
    this.debugLog("controller.exitTableOnShiftTab", {
      tablePos: tableContext.table.pos,
      rowIndex,
      cellIndex,
      exitPos,
    });
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  }

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
  }

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
  }

  deletePreviousWidgetBlock() {
    const boundaryContext = getPageBlockBoundaryContext(this.view.state);
    const previousWidgetType = getSlashWidgetTypeFromNode(
      boundaryContext?.previousBlock?.node
    );

    if (!boundaryContext || !previousWidgetType) {
      return false;
    }

    const { previousBlock, block } = boundaryContext;
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
    });
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  }

  replaceTableNode({
    tablePos,
    currentTableNode,
    nextTable,
    nextRowIndex = 0,
    nextCellIndex = 0,
    debugType = "controller.replaceTableNode",
    debugDetail = {},
  }) {
    const tableNode = currentTableNode ?? this.view.state.doc.nodeAt(tablePos);

    if (
      tableNode?.type !== editorSchema.nodes.table ||
      nextTable?.type !== editorSchema.nodes.table
    ) {
      return false;
    }

    const tr = this.view.state.tr.replaceWith(
      tablePos,
      tablePos + tableNode.nodeSize,
      nextTable
    );
    const nextSelectionPos = findTableCellTextPos(
      nextTable,
      tablePos,
      nextRowIndex,
      nextCellIndex
    );

    tr.setSelection(TextSelection.near(tr.doc.resolve(nextSelectionPos), 1));
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
  }

  createMathNodeAttrsForState(state, initialLatex = "") {
    const textToolbarState = this.hasMathCapture()
      ? this.getCurrentTextToolbarState()
      : createToolbarStateFromState(state);

    return {
      id: createMathId(),
      latex: initialLatex,
      fontFamily: this.currentMathStyle.fontFamily,
      fontSize: this.currentMathStyle.fontSize,
      baseTextFontSize: textToolbarState.fontSize,
    };
  }

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
    const blockNode = currentBlockNode ?? this.view.state.doc.nodeAt(blockPos);

    if (blockNode?.type !== blockNodeType || nextBlockNode?.type !== blockNodeType) {
      return false;
    }

    const targetMathPos = findMathPos(
      nextBlockNode,
      blockPos,
      nextRowIndex,
      nextCellIndex
    );
    const targetMathRow = nextBlockNode.child(
      Math.max(0, Math.min(nextRowIndex, nextBlockNode.childCount - 1))
    );
    const targetMathCellCount = targetMathRow?.childCount ?? 1;
    const targetMathNode = targetMathRow?.child(
      Math.max(0, Math.min(nextCellIndex, targetMathCellCount - 1))
    );
    const targetMathId = targetMathNode?.attrs?.id ?? null;
    const tr = this.view.state.tr.replaceWith(
      blockPos,
      blockPos + blockNode.nodeSize,
      nextBlockNode
    );

    if (targetMathPos != null) {
      tr.setSelection(
        TextSelection.near(
          tr.doc.resolve(targetMathPos + (targetMathNode?.nodeSize ?? 1)),
          -1
        )
      );
    }

    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());

    if (targetMathId && targetMathNode?.type === mathNodeType) {
      this.activeMathId = null;
      this.lastFocusedMathId = targetMathId;
      this.pendingMathFocusId = targetMathId;
      this.pendingMathFocusEdge = nextFocusEdge;
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
  }

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
      debugType = "controller.moveToMathGridCellFromMath",
      debugDetail = {},
    } = {}
  ) {
    const currentNode = this.view.state.doc.nodeAt(pos);

    if (currentNode?.type !== mathNodeType) {
      return false;
    }

    const nextPatch = patch
      ? Object.fromEntries(
          Object.entries(patch).filter(([key, value]) => currentNode.attrs[key] !== value)
        )
      : null;
    const context = getContextAtPos(this.view.state.doc, pos);

    if (!context) {
      return false;
    }

    const targetMathPos = findMathPos(
      context.block.node,
      context.block.pos,
      nextRowIndex,
      nextCellIndex
    );
    const targetMathNode = this.view.state.doc.nodeAt(targetMathPos);
    const targetMathId = targetMathNode?.attrs?.id ?? null;

    if (!targetMathId || targetMathNode?.type !== mathNodeType) {
      return false;
    }

    const tr = this.view.state.tr;

    if (nextPatch && Object.keys(nextPatch).length > 0) {
      tr.setNodeMarkup(pos, null, {
        ...currentNode.attrs,
        ...nextPatch,
      });
    }

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
    this.pendingMathFocusEdge = focusEdge;
    this.preservedTextSelection = null;
    this.debugLog(debugType, {
      pos,
      nextRowIndex,
      nextCellIndex,
      targetMathId,
      focusEdge,
      ...debugDetail,
    });
    this.dispatchTransaction(tr);
    this.focusMathNode(targetMathId, focusEdge);
    return true;
  }

  handleMathGridExit(
    pos,
    direction,
    patch = null,
    {
      getContextAtPos,
      findMathPos,
      mathNodeType,
      debugPrefix = "controller.handleMathGridExit",
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

      const exitPos = context.block.pos + context.block.node.nodeSize;

      tr.setSelection(TextSelection.near(tr.doc.resolve(exitPos), 1));
      setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
      this.preservedTextSelection = {
        from: tr.selection.from,
        to: tr.selection.to,
      };
      this.activeMathId = null;
      this.cancelPendingMathFocus();
      this.debugLog(`${debugPrefix}.exitAfter`, {
        pos,
        rowIndex,
        cellIndex,
        exitPos,
      });
      this.dispatchTransaction(tr);
      this.focusEditorAfterMathExit({ immediate: true });
      return true;
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

    const exitPos = context.block.pos;

    tr.setSelection(TextSelection.near(tr.doc.resolve(exitPos), -1));
    setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };
    this.activeMathId = null;
    this.cancelPendingMathFocus();
    this.debugLog(`${debugPrefix}.exitBefore`, {
      pos,
      rowIndex,
      cellIndex,
      exitPos,
    });
    this.dispatchTransaction(tr);
    this.focusEditorAfterMathExit({ immediate: true });
    return true;
  }

  exitMathGridAfterBlock(
    pos,
    patch = null,
    {
      getContextAtPos,
      mathNodeType,
      debugType = "controller.exitMathGridAfterBlock",
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

    const tr = this.view.state.tr;

    if (nextPatch && Object.keys(nextPatch).length > 0) {
      tr.setNodeMarkup(pos, null, {
        ...node.attrs,
        ...nextPatch,
      });
    }

    const exitPos = context.block.pos + context.block.node.nodeSize;

    tr.setSelection(TextSelection.near(tr.doc.resolve(exitPos), 1));
    setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };
    this.activeMathId = null;
    this.cancelPendingMathFocus();
    this.debugLog(debugType, {
      pos,
      rowIndex: context.row.index,
      cellIndex: context.cell.index,
      exitPos,
    });
    this.dispatchTransaction(tr);
    this.focusEditorAfterMathExit({ immediate: true });
    return true;
  }

  replaceAlignBlock({
    alignPos,
    currentAlignBlock,
    nextAlignBlock,
    nextRowIndex = 0,
    nextCellIndex = 0,
    nextFocusEdge = "start",
    debugType = "controller.replaceAlignBlock",
    debugDetail = {},
  }) {
    return this.replaceMathGridBlock({
      blockPos: alignPos,
      currentBlockNode: currentAlignBlock,
      nextBlockNode: nextAlignBlock,
      blockNodeType: editorSchema.nodes.align_block,
      mathNodeType: editorSchema.nodes.align_math,
      findMathPos: findAlignMathPos,
      nextRowIndex,
      nextCellIndex,
      nextFocusEdge,
      debugType,
      debugDetail,
      debugPositionKey: "alignPos",
    });
  }

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
  }

  moveToAlignCellFromMath(
    pos,
    nextRowIndex,
    nextCellIndex,
    patch = null,
    {
      focusEdge = "start",
      debugType = "controller.moveToAlignCellFromMath",
      debugDetail = {},
    } = {}
  ) {
    return this.moveToMathGridCellFromMath(pos, nextRowIndex, nextCellIndex, patch, {
      getContextAtPos: getAlignContextAtPos,
      findMathPos: findAlignMathPos,
      mathNodeType: editorSchema.nodes.align_math,
      focusEdge,
      debugType,
      debugDetail,
    });
  }

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
    const hasNextRow = rowIndex < context.block.node.childCount - 1;

    if (hasNextRow) {
      return this.moveToAlignCellFromMath(
        pos,
        rowIndex + 1,
        cellIndex,
        null,
        {
          debugType: "controller.handleAlignEnterFromMath.moveDown",
          debugDetail: {
            rowIndex,
            cellIndex,
          },
        }
      );
    }

    return this.exitMathGridAfterBlock(pos, nextPatch, {
      getContextAtPos: getAlignContextAtPos,
      mathNodeType: editorSchema.nodes.align_math,
      debugType: "controller.handleAlignEnterFromMath.exitAfter",
    });
  }

  handleAlignMathExit(pos, direction, patch = null) {
    return this.handleMathGridExit(pos, direction, patch, {
      getContextAtPos: getAlignContextAtPos,
      findMathPos: findAlignMathPos,
      mathNodeType: editorSchema.nodes.align_math,
      debugPrefix: "controller.handleAlignMathExit",
    });
  }

  replaceGatherBlock({
    gatherPos,
    currentGatherBlock,
    nextGatherBlock,
    nextRowIndex = 0,
    nextCellIndex = 0,
    nextFocusEdge = "start",
    debugType = "controller.replaceGatherBlock",
    debugDetail = {},
  }) {
    return this.replaceMathGridBlock({
      blockPos: gatherPos,
      currentBlockNode: currentGatherBlock,
      nextBlockNode: nextGatherBlock,
      blockNodeType: editorSchema.nodes.gather_block,
      mathNodeType: editorSchema.nodes.gather_math,
      findMathPos: findGatherMathPos,
      nextRowIndex,
      nextCellIndex,
      nextFocusEdge,
      debugType,
      debugDetail,
      debugPositionKey: "gatherPos",
    });
  }

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
  }

  moveToGatherCellFromMath(
    pos,
    nextRowIndex,
    nextCellIndex,
    patch = null,
    {
      focusEdge = "start",
      debugType = "controller.moveToGatherCellFromMath",
      debugDetail = {},
    } = {}
  ) {
    return this.moveToMathGridCellFromMath(pos, nextRowIndex, nextCellIndex, patch, {
      getContextAtPos: getGatherContextAtPos,
      findMathPos: findGatherMathPos,
      mathNodeType: editorSchema.nodes.gather_math,
      focusEdge,
      debugType,
      debugDetail,
    });
  }

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
    const hasNextRow = rowIndex < context.block.node.childCount - 1;

    if (hasNextRow) {
      return this.moveToGatherCellFromMath(
        pos,
        rowIndex + 1,
        cellIndex,
        null,
        {
          debugType: "controller.handleGatherEnterFromMath.moveDown",
          debugDetail: {
            rowIndex,
            cellIndex,
          },
        }
      );
    }

    return this.exitMathGridAfterBlock(pos, nextPatch, {
      getContextAtPos: getGatherContextAtPos,
      mathNodeType: editorSchema.nodes.gather_math,
      debugType: "controller.handleGatherEnterFromMath.exitAfter",
    });
  }

  handleGatherMathExit(pos, direction, patch = null) {
    return this.handleMathGridExit(pos, direction, patch, {
      getContextAtPos: getGatherContextAtPos,
      findMathPos: findGatherMathPos,
      mathNodeType: editorSchema.nodes.gather_math,
      debugPrefix: "controller.handleGatherMathExit",
    });
  }

  getActiveSlashItemState() {
    return getRegisteredSlashItemState(this);
  }

  getSlashItemClientRect(itemOrPos) {
    const itemPos = typeof itemOrPos === "number" ? itemOrPos : itemOrPos?.pos;

    if (!Number.isFinite(itemPos)) {
      return null;
    }

    const nodeDom = this.view.nodeDOM(itemPos);

    if (!(nodeDom instanceof HTMLElement)) {
      return null;
    }

    const rect = nodeDom.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  }

  updateSlashItemSettings(item, settings) {
    return updateRegisteredSlashItemSettings(this, item, settings);
  }

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
        ? {
            id: anchorTarget.id,
            pos: anchorTarget.pos,
            type: anchorTarget.node?.type?.name ?? null,
          }
        : null,
      alignContext: alignContext
        ? {
            rowIndex: alignContext.row.index,
            cellIndex: alignContext.cell.index,
          }
        : null,
    });
    const nextAlignBlock = createResizedAlignBlock(
      editorSchema,
      alignNode,
      rowCount,
      groupCount,
      () => this.createMathNodeAttrsForState(this.view.state)
    );
    const nextRowIndex = Math.max(
      0,
      Math.min(alignContext?.row.index ?? 0, rowCount - 1)
    );
    let nextCellIndex = Math.max(
      0,
      Math.min(alignContext?.cell.index ?? 0, groupCount * 2 - 1)
    );

    if (!alignContext && groupCount > currentGroupCount) {
      nextCellIndex = Math.max(
        0,
        Math.min(currentGroupCount * 2, groupCount * 2 - 1)
      );
    }

    return this.replaceAlignBlock({
      alignPos,
      currentAlignBlock: alignNode,
      nextAlignBlock,
      nextRowIndex,
      nextCellIndex,
      debugType: "controller.updateAlignSettings",
      debugDetail: {
        rowCount,
        groupCount,
      },
    });
  }

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
    const nextRowIndex = Math.max(
      0,
      Math.min(gatherContext?.row.index ?? 0, rowCount - 1)
    );
    let nextCellIndex = Math.max(
      0,
      Math.min(gatherContext?.cell.index ?? 0, columnCount - 1)
    );

    if (!gatherContext && columnCount > currentColumnCount) {
      nextCellIndex = Math.max(
        0,
        Math.min(currentColumnCount, columnCount - 1)
      );
    }

    return this.replaceGatherBlock({
      gatherPos,
      currentGatherBlock: gatherNode,
      nextGatherBlock,
      nextRowIndex,
      nextCellIndex,
      debugType: "controller.updateGatherSettings",
      debugDetail: {
        rowCount,
        columnCount,
      },
    });
  }

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
  }

  deleteSlashItem(item) {
    return deleteRegisteredSlashItem(this, item);
  }

  deleteAlignAt(alignPos, options = {}) {
    const alignNode = this.view.state.doc.nodeAt(alignPos);

    if (alignNode?.type !== editorSchema.nodes.align_block) {
      return false;
    }

    const tr = this.view.state.tr.delete(alignPos, alignPos + alignNode.nodeSize);
    const nextSelectionPos = Math.max(
      1,
      Math.min(alignPos, tr.doc.content.size)
    );

    tr.setSelection(TextSelection.near(tr.doc.resolve(nextSelectionPos), 1));
    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
    this.debugLog(options.debugType ?? "controller.deleteAlignAt", {
      alignPos,
      nextSelectionPos,
    });
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  }

  deleteGatherAt(gatherPos, options = {}) {
    const gatherNode = this.view.state.doc.nodeAt(gatherPos);

    if (gatherNode?.type !== editorSchema.nodes.gather_block) {
      return false;
    }

    const tr = this.view.state.tr.delete(gatherPos, gatherPos + gatherNode.nodeSize);
    const nextSelectionPos = Math.max(
      1,
      Math.min(gatherPos, tr.doc.content.size)
    );

    tr.setSelection(TextSelection.near(tr.doc.resolve(nextSelectionPos), 1));
    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
    this.debugLog(options.debugType ?? "controller.deleteGatherAt", {
      gatherPos,
      nextSelectionPos,
    });
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  }

  deleteTableAt(tablePos, options = {}) {
    const tableNode = this.view.state.doc.nodeAt(tablePos);

    if (tableNode?.type !== editorSchema.nodes.table) {
      return false;
    }

    const tr = this.view.state.tr.delete(tablePos, tablePos + tableNode.nodeSize);
    const nextSelectionPos = Math.max(
      1,
      Math.min(tablePos, tr.doc.content.size)
    );

    tr.setSelection(TextSelection.near(tr.doc.resolve(nextSelectionPos), 1));
    setStoredMarksFromToolbarState(tr, this.getCurrentTextToolbarState());
    this.debugLog(options.debugType ?? "controller.deleteTableAt", {
      tablePos,
      nextSelectionPos,
    });
    this.dispatchTransaction(tr);
    this.focus();
    return true;
  }

  toggleTextMark(markName) {
    if (this.hasMathCapture()) {
      this.updatePreservedTextContext({
        [markName]: !this.lastTextContext.toolbarState[markName],
      });
      return true;
    }

    const markType = editorSchema.marks[markName];

    if (!markType) {
      return false;
    }

    const selectionIsCollapsed = this.view.state.selection.empty;
    const nextToolbarState = selectionIsCollapsed
      ? {
          ...this.getCurrentTextToolbarState(),
          [markName]: !this.getCurrentTextToolbarState()[markName],
        }
      : null;
    const didApply = toggleMark(markType)(
      this.view.state,
      this.view.dispatch,
      this.view
    );

    if (didApply && selectionIsCollapsed && nextToolbarState) {
      this.lastTextContext = createLastTextContext(nextToolbarState, editorSchema);
      this.emitUiState();
    }

    return didApply;
  }

  setTextFontFamily(value) {
    const normalizedValue = normalizeTextFontFamily(value);

    if (this.hasMathCapture()) {
      this.updatePreservedTextContext({ fontFamily: normalizedValue });
      return true;
    }

    const selectionIsCollapsed = this.view.state.selection.empty;
    const currentToolbarState = this.getCurrentTextToolbarState();
    const tr = createTextMarkTransaction(
      this.view.state,
      editorSchema.marks.text_font_family,
      normalizedValue,
      normalizedValue === DEFAULT_TEXT_TOOLBAR_STATE.fontFamily
    );
    this.dispatchTransaction(tr);

    if (selectionIsCollapsed) {
      this.lastTextContext = createLastTextContext(
        {
          ...currentToolbarState,
          fontFamily: normalizedValue,
        },
        editorSchema
      );
      this.emitUiState();
    }

    return true;
  }

  setTextFontSize(value) {
    const normalizedValue = normalizeTextFontSize(value);

    if (this.hasMathCapture()) {
      this.updatePreservedTextContext({ fontSize: normalizedValue });
      return true;
    }

    const selectionIsCollapsed = this.view.state.selection.empty;
    const currentToolbarState = this.getCurrentTextToolbarState();
    const tr = createTextMarkTransaction(
      this.view.state,
      editorSchema.marks.text_font_size,
      normalizedValue,
      normalizedValue === DEFAULT_TEXT_TOOLBAR_STATE.fontSize
    );

    if (!this.view.state.selection.empty) {
      const mathPositions = collectMathPositionsInRange(
        this.view.state,
        this.view.state.selection.from,
        this.view.state.selection.to
      );
      applyMathAttrs(tr, this.view.state, mathPositions, {
        baseTextFontSize: normalizedValue,
      });
    }

    this.dispatchTransaction(tr);

    if (selectionIsCollapsed) {
      this.lastTextContext = createLastTextContext(
        {
          ...currentToolbarState,
          fontSize: normalizedValue,
        },
        editorSchema
      );
      this.emitUiState();
    }

    return true;
  }

  getListCommandSpec(listType) {
    switch (listType) {
      case "bullet":
        return {
          toolbarValue: "bullet",
          nodeType: editorSchema.nodes.bullet_list,
          attrs: null,
        };
      case "alpha-period":
      case "alpha-paren":
      case "alpha-wrapped":
      case "roman-period":
      case "roman-paren":
      case "roman-wrapped":
      case "decimal-period":
      case "decimal-paren":
      case "decimal-wrapped":
        return {
          toolbarValue: normalizeOrderedListStyle(listType),
          nodeType: editorSchema.nodes.ordered_list,
          attrs: {
            order: 1,
            listStyle: normalizeOrderedListStyle(listType),
          },
        };
      default:
        return null;
    }
  }

  setTextListType(listType) {
    if (this.hasMathCapture()) {
      return false;
    }

    const listInfo = getPrimaryListInfo(this.view.state);
    const currentToolbarState = this.getCurrentTextToolbarState();
    const selectionIsCollapsed = this.view.state.selection.empty;
    const normalizedValue = String(listType ?? "").toLowerCase();

    if (normalizedValue === DEFAULT_TEXT_TOOLBAR_STATE.listType) {
      if (!listInfo) {
        return false;
      }

      const didLift = liftListItem(editorSchema.nodes.list_item)(
        this.view.state,
        this.view.dispatch,
        this.view
      );

      if (didLift && selectionIsCollapsed) {
        this.lastTextContext = createLastTextContext(
          {
            ...currentToolbarState,
            listType: DEFAULT_TEXT_TOOLBAR_STATE.listType,
          },
          editorSchema
        );
        this.emitUiState();
      }

      return didLift;
    }

    const spec = this.getListCommandSpec(normalizedValue);

    if (!spec) {
      return false;
    }

    if (listInfo && getListToolbarType(listInfo.node) === spec.toolbarValue) {
      return false;
    }

    let didApply = false;

    if (listInfo) {
      const nextAttrs = spec.nodeType === editorSchema.nodes.ordered_list
        ? {
            ...(spec.attrs ?? {}),
            order: Number.isFinite(listInfo.node.attrs.order)
              ? Math.max(1, listInfo.node.attrs.order)
              : 1,
          }
        : spec.attrs;
      const tr = this.view.state.tr.setNodeMarkup(listInfo.pos, spec.nodeType, nextAttrs);
      this.dispatchTransaction(tr);
      didApply = true;
    } else {
      didApply = wrapInList(spec.nodeType, spec.attrs)(
        this.view.state,
        this.view.dispatch,
        this.view
      );
    }

    if (didApply && selectionIsCollapsed) {
      this.lastTextContext = createLastTextContext(
        {
          ...currentToolbarState,
          listType: spec.toolbarValue,
        },
        editorSchema
      );
      this.emitUiState();
    }

    return didApply;
  }

  setTextAlignment(value) {
    const normalizedValue = normalizeTextAlignment(value);
    const anchorRange = this.getParagraphCommandRange();
    const positions = collectParagraphPositions(
      this.view.state,
      anchorRange?.from ?? null,
      anchorRange?.to ?? null
    );

    if (positions.length === 0) {
      return false;
    }

    const selectionIsCollapsed = this.view.state.selection.empty;
    const currentToolbarState = this.getCurrentTextToolbarState();
    const tr = this.view.state.tr;
    applyParagraphAttrs(tr, this.view.state, positions, {
      alignment: normalizedValue,
    });
    this.dispatchTransaction(tr);

    if (selectionIsCollapsed) {
      this.lastTextContext = createLastTextContext(
        {
          ...currentToolbarState,
          alignment: normalizedValue,
        },
        editorSchema
      );
      this.emitUiState();
    } else if (this.hasMathCapture()) {
      this.updatePreservedTextContext({ alignment: normalizedValue }, false);
    }

    return true;
  }

  setLineSpacing(value) {
    const normalizedValue = normalizeLineSpacing(value);
    const anchorRange = this.getParagraphCommandRange();
    const positions = collectParagraphPositions(
      this.view.state,
      anchorRange?.from ?? null,
      anchorRange?.to ?? null
    );

    if (positions.length === 0) {
      return false;
    }

    const selectionIsCollapsed = this.view.state.selection.empty;
    const currentToolbarState = this.getCurrentTextToolbarState();
    const tr = this.view.state.tr;
    applyParagraphAttrs(tr, this.view.state, positions, {
      lineSpacing: normalizedValue,
    });
    this.dispatchTransaction(tr);

    if (selectionIsCollapsed) {
      this.lastTextContext = createLastTextContext(
        {
          ...currentToolbarState,
          lineSpacing: normalizedValue,
        },
        editorSchema
      );
      this.emitUiState();
    } else if (this.hasMathCapture()) {
      this.updatePreservedTextContext({ lineSpacing: normalizedValue }, false);
    }

    return true;
  }

  setParagraphSpacing(value) {
    const normalizedValue = normalizeParagraphSpacing(value);
    const anchorRange = this.getParagraphCommandRange();
    const positions = collectParagraphPositions(
      this.view.state,
      anchorRange?.from ?? null,
      anchorRange?.to ?? null
    );

    if (positions.length === 0) {
      return false;
    }

    const selectionIsCollapsed = this.view.state.selection.empty;
    const currentToolbarState = this.getCurrentTextToolbarState();
    const tr = this.view.state.tr;
    applyParagraphAttrs(tr, this.view.state, positions, {
      paragraphSpacing: normalizedValue,
    });
    this.dispatchTransaction(tr);

    if (selectionIsCollapsed) {
      this.lastTextContext = createLastTextContext(
        {
          ...currentToolbarState,
          paragraphSpacing: normalizedValue,
        },
        editorSchema
      );
      this.emitUiState();
    } else if (this.hasMathCapture()) {
      this.updatePreservedTextContext({ paragraphSpacing: normalizedValue }, false);
    }

    return true;
  }

  setMathFontFamily(value) {
    const normalizedValue = normalizeMathFontFamily(value);
    this.currentMathStyle = {
      ...this.currentMathStyle,
      fontFamily: normalizedValue,
    };

    const target = this.getMathTarget();

    if (!target) {
      this.emitUiState();
      return false;
    }

    const activeMathView = this.mathViews.get(target.id);

    if (activeMathView?.applyDraftPatch && this.hasMathCapture()) {
      activeMathView.applyDraftPatch({
        fontFamily: normalizedValue,
      });
      this.emitUiState();
      return true;
    }

    this.commitMathNode(target.pos, {
      fontFamily: normalizedValue,
    });
    return true;
  }

  setMathFontSize(value) {
    const normalizedValue = normalizeMathFontSize(value);
    this.currentMathStyle = {
      ...this.currentMathStyle,
      fontSize: normalizedValue,
    };

    const target = this.getMathTarget();

    if (!target) {
      this.emitUiState();
      return false;
    }

    const activeMathView = this.mathViews.get(target.id);

    if (activeMathView?.applyDraftPatch && this.hasMathCapture()) {
      activeMathView.applyDraftPatch({
        fontSize: normalizedValue,
      });
      this.emitUiState();
      return true;
    }

    this.commitMathNode(target.pos, {
      fontSize: normalizedValue,
    });
    return true;
  }

  insertInlineMath() {
    const selection = this.view.state.selection;
    const initialLatex = selection.empty
      ? ""
      : this.view.state.doc.textBetween(selection.from, selection.to, " ", " ");
    const tr = this.buildInlineMathInsertionTransaction(
      this.view.state,
      selection.from,
      selection.to,
      initialLatex
    );
    this.debugLog("controller.insertInlineMath", {
      from: selection.from,
      to: selection.to,
      initialLatex,
      activeMathId: this.activeMathId,
    });
    this.dispatchTransaction(tr);
    return true;
  }

  insertDisplayMath() {
    const selection = this.view.state.selection;
    const initialLatex = selection.empty
      ? ""
      : this.view.state.doc.textBetween(selection.from, selection.to, " ", " ");
    const tr = this.buildDisplayMathInsertionTransaction(
      this.view.state,
      initialLatex
    );

    if (!tr) {
      return false;
    }

    this.debugLog("controller.insertDisplayMath", {
      from: selection.from,
      to: selection.to,
      initialLatex,
      activeMathId: this.activeMathId,
    });
    this.dispatchTransaction(tr);
    return true;
  }

  insertTab() {
    if (this.hasMathCapture()) {
      return false;
    }

    const tr = this.view.state.tr.insertText("\t");
    this.dispatchTransaction(tr);
    return true;
  }

  handleArrowIntoMath(direction) {
    if (this.hasMathCapture()) {
      return false;
    }

    const target = this.getAdjacentMathTarget(direction);

    if (!target) {
      return false;
    }

    this.lastFocusedMathId = target.id;
    this.focusMathNode(target.id, direction === "left" ? "end" : "start");
    this.emitUiState();
    return true;
  }

  commitMathNode(pos, patch) {
    const node = this.view.state.doc.nodeAt(pos);

    if (!isMathNode(node)) {
      this.debugLog("controller.commitMathNode.missingNode", {
        pos,
        patch,
        activeMathId: this.activeMathId,
        mathTarget: summarizeMathTarget(this.getMathTarget()),
      });
      return false;
    }

    const nextAttrs = {
      ...node.attrs,
      ...patch,
    };

    const didChange = Object.entries(patch).some(
      ([key, value]) => node.attrs[key] !== value
    );

    if (!didChange) {
      this.debugLog("controller.commitMathNode.noop", {
        pos,
        patch,
        id: node.attrs.id,
      });
      return true;
    }

    this.debugLog("controller.commitMathNode.before", {
      pos,
      patch,
      id: node.attrs.id,
      previousAttrs: { ...node.attrs },
      activeMathId: this.activeMathId,
      activeElement: describeDomNode(document.activeElement),
      pmSelection: summarizePmSelection(this.view.state.selection),
      domSelection: summarizeDomSelection(),
    });
    const tr = this.view.state.tr.setNodeMarkup(pos, null, nextAttrs);
    this.debugLog("controller.commitMathNode", {
      pos,
      patch,
      id: node.attrs.id,
    });
    this.dispatchTransaction(tr);
    const nextNode = this.view.state.doc.nodeAt(pos);
    this.debugLog("controller.commitMathNode.after", {
      pos,
      id: node.attrs.id,
      nextNodeAttrs: nextNode?.attrs ? { ...nextNode.attrs } : null,
      activeMathId: this.activeMathId,
      activeElement: describeDomNode(document.activeElement),
      pmSelection: summarizePmSelection(this.view.state.selection),
      domSelection: summarizeDomSelection(),
    });
    return true;
  }

  selectMathNode(pos) {
    const node = this.view.state.doc.nodeAt(pos);

    if (!isMathNode(node)) {
      return false;
    }

    this.lastFocusedMathId = node.attrs.id;
    this.debugLog("controller.selectMathNode", {
      pos,
      nodeId: node.attrs.id,
    });
    this.emitUiState();
    return true;
  }

  removeMathNode(pos, direction) {
    const node = this.view.state.doc.nodeAt(pos);

    if (!isMathNode(node)) {
      return false;
    }

    if (node.type === editorSchema.nodes.align_math) {
      return this.handleAlignMathExit(pos, direction);
    }

    if (node.type === editorSchema.nodes.gather_math) {
      return this.handleGatherMathExit(pos, direction);
    }

    const nodeId = node.attrs.id;
    let tr = this.view.state.tr.delete(pos, pos + node.nodeSize);
    const targetPos = direction === "before" ? pos : pos;
    const resolvedPos = Math.max(0, Math.min(targetPos, tr.doc.content.size));
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(resolvedPos), direction === "before" ? -1 : 1));
    setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };

    if (this.activeMathId === nodeId) {
      this.cancelPendingMathFocus();
      this.activeMathId = null;
    }

    if (this.lastFocusedMathId === nodeId) {
      this.lastFocusedMathId = null;
    }

    this.debugLog("controller.removeMathNode", {
      pos,
      direction,
      nodeId,
      targetSelection: summarizePmSelection(tr.selection),
    });
    this.dispatchTransaction(tr);
    this.focusEditorAfterMathExit();
    return true;
  }

  exitMathNode(pos, direction) {
    return this.commitAndExitMathNode(pos, direction);
  }

  commitAndExitMathNode(pos, direction, patch = null) {
    const node = this.view.state.doc.nodeAt(pos);

    if (!isMathNode(node)) {
      return false;
    }

    if (node.type === editorSchema.nodes.align_math) {
      return this.handleAlignMathExit(pos, direction, patch);
    }

    if (node.type === editorSchema.nodes.gather_math) {
      return this.handleGatherMathExit(pos, direction, patch);
    }

    const nextPatch = patch
      ? Object.fromEntries(
          Object.entries(patch).filter(([key, value]) => node.attrs[key] !== value)
        )
      : null;

    let tr = this.view.state.tr;

    if (nextPatch && Object.keys(nextPatch).length > 0) {
      tr = tr.setNodeMarkup(pos, null, {
        ...node.attrs,
        ...nextPatch,
      });
    }

    const targetPos = direction === "before" ? pos : pos + node.nodeSize;
    tr = tr.setSelection(
      TextSelection.near(tr.doc.resolve(targetPos), direction === "before" ? -1 : 1)
    );
    setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
    this.preservedTextSelection = {
      from: tr.selection.from,
      to: tr.selection.to,
    };
    this.activeMathId = null;
    this.cancelPendingMathFocus();
    this.debugLog("controller.commitAndExitMathNode", {
      pos,
      direction,
      nodeId: node.attrs.id,
      patch: nextPatch,
      targetSelection: summarizePmSelection(tr.selection),
    });
    this.dispatchTransaction(tr);
    this.focusEditorAfterMathExit({ immediate: true });
    return true;
  }

  handleMathFocus(id, pos) {
    this.cancelPendingMathFocusFrame();
    if (this.pendingMathFocusId === id) {
      this.pendingMathFocusId = null;
    }
    this.activeMathId = id;
    this.lastFocusedMathId = id;
    this.preservedTextSelection = null;
    const node = this.view.state.doc.nodeAt(pos);

    if (isMathNode(node)) {
      this.currentMathStyle = {
        fontFamily: normalizeMathFontFamily(node.attrs.fontFamily),
        fontSize: normalizeMathFontSize(node.attrs.fontSize),
      };
    }

    this.debugLog("controller.handleMathFocus", {
      id,
      pos,
      activeElement: describeDomNode(document.activeElement),
      pmSelection: summarizePmSelection(this.view.state.selection),
      domSelection: summarizeDomSelection(),
      mathTarget: summarizeMathTarget(this.getMathTarget()),
    });
    this.emitUiState();
    this.emitSlashItemState();
    this.updateDebugState("controller.handleMathFocus");
  }

  handleMathBlur(id, pos) {
    if (this.activeMathId === id) {
      this.activeMathId = null;
    }

    const node = this.view.state.doc.nodeAt(pos);

    if (isMathNode(node)) {
      this.currentMathStyle = {
        fontFamily: normalizeMathFontFamily(node.attrs.fontFamily),
        fontSize: normalizeMathFontSize(node.attrs.fontSize),
      };
    }

    this.debugLog("controller.handleMathBlur", {
      id,
      pos,
      activeElement: describeDomNode(document.activeElement),
      pmSelection: summarizePmSelection(this.view.state.selection),
      domSelection: summarizeDomSelection(),
      mathTarget: summarizeMathTarget(this.getMathTarget()),
    });
    this.emitUiState();
    this.emitSlashItemState();
    this.updateDebugState("controller.handleMathBlur");
    this.scheduleRepagination();
  }

  registerMathView(id, nodeView) {
    this.mathViews.set(id, nodeView);
    this.debugLog("controller.registerMathView", {
      id,
      pendingMathFocusId: this.pendingMathFocusId,
      instanceId: nodeView.instanceId,
      activeMathId: this.activeMathId,
      fieldValue: nodeView.mathField?.getValue?.() ?? null,
    });

    if (this.pendingMathFocusId === id) {
      this.scheduleMathFocus(id, this.pendingMathFocusEdge);
    }
  }

  unregisterMathView(id, nodeView) {
    if (this.mathViews.get(id) === nodeView) {
      this.mathViews.delete(id);
    }

    this.debugLog("controller.unregisterMathView", {
      id,
      instanceId: nodeView.instanceId,
      activeMathId: this.activeMathId,
    });
  }

  dispatchTransaction(tr) {
    const prevState = this.view.state;
    if (this.shouldDebugLog("controller.dispatchTransaction.before")) {
      this.debugLog("controller.dispatchTransaction.before", {
        activeMathId: this.activeMathId,
        activeElement: describeDomNode(document.activeElement),
        pmSelection: summarizePmSelection(prevState.selection),
        domSelection: summarizeDomSelection(),
        mathTarget: summarizeMathTarget(this.getMathTarget()),
      });
    }
    const nextState = prevState.apply(tr);
    if (this.shouldDebugLog("controller.dispatchTransaction")) {
      this.debugLog("controller.dispatchTransaction", summarizeTransaction(tr, prevState, nextState));
    }
    this.view.updateState(nextState);
    if (this.shouldDebugLog("controller.dispatchTransaction.after")) {
      this.debugLog("controller.dispatchTransaction.after", {
        activeMathId: this.activeMathId,
        activeElement: describeDomNode(document.activeElement),
        pmSelection: summarizePmSelection(this.view.state.selection),
        domSelection: summarizeDomSelection(),
        mathTarget: summarizeMathTarget(this.getMathTarget()),
        mathViewIds: Array.from(this.mathViews.keys()),
      });
    }

    if (!this.hasMathCapture()) {
      const shouldPreserveTextContext = this.shouldPreserveTextContext(nextState);

      if (!(shouldPreserveTextContext && !tr.docChanged && !tr.storedMarksSet)) {
        this.lastTextContext = createLastTextContext(
          createToolbarStateFromState(nextState),
          editorSchema
        );
      }

      if (!shouldPreserveTextContext) {
        this.preservedTextSelection = null;
      }
    }

    this.syncUi(tr.docChanged);
    this.notifyPageCount();
    this.emitUiState();
    this.emitSlashItemState();
    this.updateDebugState("controller.dispatchTransaction");

    if (tr.docChanged && !this.hasMathCapture()) {
      this.scheduleRepagination();
    }
  }

  handleTextInput(from, to, text) {
    const mathCaptureTarget = this.getFocusedOrPendingMathTarget();

    if (mathCaptureTarget) {
      const didRouteToMath = this.routeTextInputToMathTarget(mathCaptureTarget, text);
      if (this.shouldDebugLog("controller.handleTextInput.routeToMath")) {
        this.debugLog("controller.handleTextInput.routeToMath", {
          from,
          to,
          text,
          activeMathId: this.activeMathId,
          pendingMathFocusId: this.pendingMathFocusId,
          targetId: mathCaptureTarget.id,
          didRouteToMath,
        });
      }
      return didRouteToMath;
    }

    if (text === "$") {
      if (this.shouldDebugLog("controller.handleTextInput.mathTrigger")) {
        this.debugLog("controller.handleTextInput.mathTrigger", {
          from,
          to,
          text,
        });
      }
      const tr = this.buildInlineMathInsertionTransaction(
        this.view.state,
        from,
        to,
        ""
      );
      this.dispatchTransaction(tr);
      return true;
    }

    if (text === "[") {
      const tr = this.buildDisplayMathInsertionTransaction(this.view.state, "");

      if (tr) {
        this.dispatchTransaction(tr);
        return true;
      }
    }

    const toolbarState = this.getCurrentTextToolbarState();
    const textNode = editorSchema.text(
      text,
      buildMarksFromToolbarState(toolbarState, editorSchema)
    );
    const tr = this.view.state.tr.replaceRangeWith(from, to, textNode);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + text.length), 1));
    setStoredMarksFromToolbarState(tr, toolbarState);
    this.preservedTextSelection = null;
    if (this.shouldDebugLog("controller.handleTextInput")) {
      this.debugLog("controller.handleTextInput", {
        from,
        to,
        text,
        toolbarState,
        activeElement: describeDomNode(document.activeElement),
        pmSelection: summarizePmSelection(this.view.state.selection),
      });
    }
    this.dispatchTransaction(tr);
    return true;
  }

  routeTextInputToMathTarget(target, text) {
    const nodeView = this.mathViews.get(target.id);

    if (nodeView?.appendText) {
      nodeView.appendText(text);
      this.focusMathNode(target.id, "end");
      if (this.shouldDebugLog("controller.routeTextInputToMathTarget")) {
        this.debugLog("controller.routeTextInputToMathTarget", {
          id: target.id,
          pos: target.pos,
          text,
          via: "nodeView",
          activeElement: describeDomNode(document.activeElement),
          pmSelection: summarizePmSelection(this.view.state.selection),
        });
      }
      return true;
    }

    const currentLatex = target.node.attrs.latex ?? "";
    const nextLatex = `${currentLatex}${text}`;
    const didCommit = this.commitMathNode(target.pos, {
      latex: nextLatex,
    });

    if (!didCommit) {
      if (this.shouldDebugLog("controller.routeTextInputToMathTarget.failed")) {
        this.debugLog("controller.routeTextInputToMathTarget.failed", {
          id: target.id,
          pos: target.pos,
          text,
        });
      }
      return false;
    }

    this.focusMathNode(target.id, "end");
    if (this.shouldDebugLog("controller.routeTextInputToMathTarget")) {
      this.debugLog("controller.routeTextInputToMathTarget", {
        id: target.id,
        pos: target.pos,
        text,
        via: "fallbackCommit",
        currentLatex,
        nextLatex,
        activeElement: describeDomNode(document.activeElement),
        pmSelection: summarizePmSelection(this.view.state.selection),
      });
    }
    return true;
  }

  handleEditorKeyDown(event) {
    const isPrimaryModifierOnly =
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey;
    const normalizedKey = String(event.key ?? "").toLowerCase();
    const alignmentByShortcutKey = {
      l: "left",
      r: "right",
      c: "center",
      e: "center",
      j: "justify",
    };
    const alignmentShortcut = isPrimaryModifierOnly
      ? alignmentByShortcutKey[normalizedKey] ?? null
      : null;

    if (this.shouldDebugLog("controller.handleEditorKeyDown")) {
      this.debugLog("controller.handleEditorKeyDown", {
        key: event.key,
        target: describeDomNode(event.target),
        defaultPrevented: event.defaultPrevented,
        isComposing: event.isComposing,
        activeMathId: this.activeMathId,
        activeElement: describeDomNode(document.activeElement),
      });
    }

    if (!event.defaultPrevented && !event.isComposing && alignmentShortcut) {
      if (normalizedKey === "c" && !this.view.state.selection.empty) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      return this.setTextAlignment(alignmentShortcut);
    }

    if (
      this.hasMathCapture() ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.key !== "$" && event.key !== "[")
    ) {
      return false;
    }

    const tr = event.key === "["
      ? this.buildDisplayMathInsertionTransaction(this.view.state, "")
      : this.buildInlineMathInsertionTransaction(
          this.view.state,
          this.view.state.selection.from,
          this.view.state.selection.to,
          ""
        );

    if (!tr) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    this.dispatchTransaction(tr);
    return true;
  }

  convertLiteralMathTrigger(state, triggerRange) {
    if (this.hasMathCapture()) {
      this.debugLog("controller.convertLiteralMathTrigger.blocked", {
        triggerRange,
        activeMathId: this.activeMathId,
      });
      return null;
    }

    this.debugLog("controller.convertLiteralMathTrigger", {
      triggerRange,
    });
    return this.buildInlineMathInsertionTransaction(
      state,
      triggerRange.from,
      triggerRange.to,
      ""
    );
  }

  getCurrentTextToolbarState() {
    if (this.hasMathCapture()) {
      return { ...this.lastTextContext.toolbarState };
    }

    if (this.shouldPreserveTextContext(this.view.state) || this.view.state.selection.empty) {
      return { ...this.lastTextContext.toolbarState };
    }

    return createToolbarStateFromState(this.view.state);
  }

  getMathTarget() {
    const targetId = this.activeMathId ?? this.lastFocusedMathId;

    if (!targetId) {
      return null;
    }

    const pos = this.findMathPositionById(targetId);

    if (pos == null) {
      if (this.activeMathId === targetId) {
        this.activeMathId = null;
      }

      if (this.lastFocusedMathId === targetId) {
        this.lastFocusedMathId = null;
      }

      return null;
    }

    const node = this.view.state.doc.nodeAt(pos);

    if (!isMathNode(node)) {
      return null;
    }

    return { id: targetId, node, pos };
  }

  getMathTargetById(id) {
    if (!id) {
      return null;
    }

    const pos = this.findMathPositionById(id);

    if (pos == null) {
      return null;
    }

    const node = this.view.state.doc.nodeAt(pos);

    if (!isMathNode(node)) {
      return null;
    }

    return { id, node, pos };
  }

  getFocusedOrPendingMathTarget() {
    const activeTarget = this.getMathTargetById(this.activeMathId);

    if (activeTarget) {
      return activeTarget;
    }

    const pendingTarget = this.getMathTargetById(this.pendingMathFocusId);

    if (pendingTarget) {
      return pendingTarget;
    }

    return null;
  }

  getParagraphCommandRange() {
    if (!this.isMathActive()) {
      return null;
    }

    const target = this.getMathTarget();

    if (!target) {
      return null;
    }

    return {
      from: target.pos,
      to: target.pos + target.node.nodeSize,
    };
  }

  isMathActive() {
    if (this.activeMathId == null) {
      return false;
    }

    if (this.findMathPositionById(this.activeMathId) == null) {
      this.activeMathId = null;
      return false;
    }

    return true;
  }

  hasPendingMathFocus() {
    if (this.pendingMathFocusId == null) {
      return false;
    }

    if (this.findMathPositionById(this.pendingMathFocusId) == null) {
      this.pendingMathFocusId = null;
      return false;
    }

    return true;
  }

  hasMathCapture() {
    return this.isMathActive() || this.hasPendingMathFocus();
  }

  findMathPositionById(id) {
    let foundPos = null;

    this.view.state.doc.descendants((node, pos) => {
      if (isMathNode(node) && node.attrs.id === id) {
        foundPos = pos;
        return false;
      }

      return true;
    });

    return foundPos;
  }

  getAdjacentMathTarget(direction) {
    const { selection, doc } = this.view.state;

    if (!(selection instanceof TextSelection) || !selection.empty) {
      return null;
    }

    const resolvedPos = selection.$from;
    const adjacentNode =
      direction === "left" ? resolvedPos.nodeBefore : resolvedPos.nodeAfter;

    if (!adjacentNode || adjacentNode.type !== editorSchema.nodes.inline_math) {
      return null;
    }

    const pos =
      direction === "left"
        ? resolvedPos.pos - adjacentNode.nodeSize
        : resolvedPos.pos;

    const node = doc.nodeAt(pos);

    if (!node || node.type !== editorSchema.nodes.inline_math) {
      return null;
    }

    return {
      id: node.attrs.id,
      node,
      pos,
    };
  }

  focusMathNode(id, edge) {
    const nodeView = this.mathViews.get(id);

    if (nodeView) {
      this.debugLog("controller.focusMathNode", {
        id,
        edge,
        via: "nodeView",
      });
      this.scheduleMathFocus(id, edge);
      return true;
    }

    this.pendingMathFocusId = id;
    this.pendingMathFocusEdge = edge;
    this.debugLog("controller.focusMathNode", {
      id,
      edge,
      via: "pending",
    });
    return false;
  }

  cancelPendingMathFocus() {
    this.cancelPendingMathFocusFrame();
    this.pendingMathFocusId = null;
  }

  cancelPendingMathFocusFrame() {
    if (this.pendingMathFocusFrame) {
      cancelAnimationFrame(this.pendingMathFocusFrame);
      this.pendingMathFocusFrame = 0;
    }
  }

  scheduleMathFocus(id, edge) {
    this.cancelPendingMathFocusFrame();
    this.pendingMathFocusId = id;
    this.pendingMathFocusEdge = edge;
    this.debugLog("controller.scheduleMathFocus", {
      id,
      edge,
    });
    this.pendingMathFocusFrame = requestAnimationFrame(() => {
      this.pendingMathFocusFrame = 0;

      if (this.activeMathId !== id && this.pendingMathFocusId !== id) {
        this.debugLog("controller.scheduleMathFocus.aborted", {
          id,
          edge,
          activeMathId: this.activeMathId,
          pendingMathFocusId: this.pendingMathFocusId,
        });
        return;
      }

      const nodeView = this.mathViews.get(id);

      if (!nodeView) {
        this.pendingMathFocusId = id;
        this.pendingMathFocusEdge = edge;
        this.debugLog("controller.scheduleMathFocus.missingNodeView", {
          id,
          edge,
        });
        return;
      }

      try {
        nodeView.focusAtEdge(edge);
        this.debugLog("controller.scheduleMathFocus.applied", {
          id,
          edge,
          activeElement: describeDomNode(document.activeElement),
        });
        this.updateDebugState("controller.scheduleMathFocus.applied");
      } catch (error) {
        this.pendingMathFocusId = id;
        this.pendingMathFocusEdge = edge;
        this.debugLog("controller.scheduleMathFocus.error", {
          id,
          edge,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  buildInlineMathInsertionTransaction(state, from, to, initialLatex = "") {
    const textToolbarState = createToolbarStateFromState(state);
    const node = editorSchema.nodes.inline_math.create(
      this.createMathNodeAttrsForState(state, initialLatex)
    );

    this.prepareMathInsertion(node.attrs.id, textToolbarState);
    this.debugLog("controller.buildInlineMathInsertionTransaction", {
      from,
      to,
      nodeId: node.attrs.id,
      initialLatex,
      textToolbarState,
      activeElement: describeDomNode(document.activeElement),
      pmSelection: summarizePmSelection(state.selection),
      domSelection: summarizeDomSelection(),
    });

    const tr = state.tr.replaceWith(from, to, node);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + node.nodeSize), -1));
    return tr;
  }

  buildDisplayMathInsertionTransaction(state, initialLatex = "") {
    const selection = state.selection;

    if (!(selection instanceof TextSelection) || !selection.empty) {
      return null;
    }

    const paragraphInfo = getPrimaryParagraphInfo(state);

    if (!paragraphInfo || selection.$from.parent.type !== editorSchema.nodes.paragraph) {
      return null;
    }

    const paragraph = selection.$from.parent;
    const paragraphPos = paragraphInfo.pos;
    const cursorOffset = selection.$from.parentOffset;
    const beforeContent = paragraph.content.cut(0, cursorOffset);
    const afterContent = paragraph.content.cut(cursorOffset, paragraph.content.size);
    const directParent = selection.$from.node(selection.$from.depth - 1);
    const isLeadingListParagraph =
      directParent?.type === editorSchema.nodes.list_item &&
      selection.$from.index(selection.$from.depth - 1) === 0;
    const createParagraphNode = (content) =>
      content.size > 0
        ? editorSchema.nodes.paragraph.create({ ...paragraph.attrs }, content)
        : editorSchema.nodes.paragraph.createAndFill({ ...paragraph.attrs });
    const beforeParagraph = beforeContent.size > 0 || isLeadingListParagraph
      ? createParagraphNode(beforeContent)
      : null;
    const afterParagraph = createParagraphNode(afterContent);
    const textToolbarState = createToolbarStateFromState(state);
    const node = editorSchema.nodes.block_math.create(
      this.createMathNodeAttrsForState(state, initialLatex)
    );
    const replacementNodes = beforeParagraph
      ? [beforeParagraph, node, afterParagraph]
      : [node, afterParagraph];
    const replacement = Fragment.fromArray(replacementNodes);
    const mathPos = beforeParagraph
      ? paragraphPos + beforeParagraph.nodeSize
      : paragraphPos;

    this.prepareMathInsertion(node.attrs.id, textToolbarState);
    this.debugLog("controller.buildDisplayMathInsertionTransaction", {
      paragraphPos,
      cursorOffset,
      nodeId: node.attrs.id,
      initialLatex,
      isLeadingListParagraph,
      textToolbarState,
      activeElement: describeDomNode(document.activeElement),
      pmSelection: summarizePmSelection(state.selection),
      domSelection: summarizeDomSelection(),
    });

    const tr = state.tr.replaceWith(
      paragraphPos,
      paragraphPos + paragraph.nodeSize,
      replacement
    );
    tr.setSelection(TextSelection.near(tr.doc.resolve(mathPos + node.nodeSize), -1));
    return tr;
  }

  prepareMathInsertion(nodeId, textToolbarState, edge = "start") {
    this.cancelPendingMathFocus();
    this.pendingMathFocusId = nodeId;
    this.pendingMathFocusEdge = edge;
    this.lastFocusedMathId = nodeId;
    this.preservedTextSelection = null;
    this.lastTextContext = createLastTextContext(textToolbarState, editorSchema);
    this.debugLog("controller.prepareMathInsertion", {
      nodeId,
      textToolbarState,
      activeMathId: this.activeMathId,
      pendingMathFocusId: this.pendingMathFocusId,
    });
  }

  focusEditorAfterMathExit({ immediate = false } = {}) {
    const focusEditor = () => {
      if (!this.isMathActive()) {
        this.view.focus();
        this.debugLog("controller.focusEditorAfterMathExit", {
          activeElement: describeDomNode(document.activeElement),
          domSelection: summarizeDomSelection(),
        });
        this.updateDebugState("controller.focusEditorAfterMathExit");
      }
    };

    if (immediate) {
      queueMicrotask(focusEditor);
      return;
    }

    requestAnimationFrame(focusEditor);
  }

  cancelPendingRepagination() {
    if (this.pendingRepaginationFrame) {
      cancelAnimationFrame(this.pendingRepaginationFrame);
      this.pendingRepaginationFrame = 0;
    }
  }

  scheduleRepagination() {
    if (this.pendingRepaginationFrame) {
      return;
    }

    this.pendingRepaginationFrame = requestAnimationFrame(() => {
      this.pendingRepaginationFrame = 0;
      this.repaginateDocument();
    });
  }

  getPageContentHeight() {
    const pageContent = this.view.dom.querySelector(".pm-page-content");
    return pageContent instanceof HTMLElement ? pageContent.clientHeight : 0;
  }

  measureDesiredPageCounts() {
    const contentHeight = this.getPageContentHeight();
    const columnCount = Math.max(
      1,
      Number.parseInt(this.pageSettings.columnCount ?? "1", 10) || 1
    );

    if (contentHeight <= 0) {
      return getCurrentPageBlockCounts(this.view.state.doc);
    }

    const blockPositions = createBlockPositionList(this.view.state.doc);
    const pageCounts = [];
    let currentCount = 0;
    let currentColumnIndex = 0;
    let currentColumnHeight = 0;

    for (const entry of blockPositions) {
      const blockElement = this.view.nodeDOM(entry.pos);

      if (!(blockElement instanceof HTMLElement)) {
        return getCurrentPageBlockCounts(this.view.state.doc);
      }

      const blockHeight = measureBlockHeight(blockElement);

      if (
        currentCount > 0 &&
        currentColumnHeight > 0 &&
        currentColumnHeight + blockHeight > contentHeight + 0.5
      ) {
        if (currentColumnIndex < columnCount - 1) {
          currentColumnIndex += 1;
          currentColumnHeight = 0;
        } else {
          pageCounts.push(currentCount);
          currentCount = 0;
          currentColumnIndex = 0;
          currentColumnHeight = 0;
        }
      }

      currentCount += 1;
      currentColumnHeight += blockHeight;
    }

    if (currentCount > 0) {
      pageCounts.push(currentCount);
    }

    return pageCounts.length > 0 ? pageCounts : [1];
  }

  buildRepaginatedDocument(pageCounts) {
    const blocks = flattenPageBlocks(this.view.state.doc);
    const pages = [];
    let offset = 0;

    pageCounts.forEach((count, index) => {
      const nextBlocks = blocks.slice(offset, offset + count);
      pages.push(createPageNode(nextBlocks, index + 1));
      offset += count;
    });

    if (offset < blocks.length) {
      pages.push(createPageNode(blocks.slice(offset), pages.length + 1));
    }

    return editorSchema.nodes.doc.create(null, pages);
  }

  repaginateDocument() {
    if (this.hasMathCapture()) {
      return;
    }

    const currentCounts = getCurrentPageBlockCounts(this.view.state.doc);
    const desiredCounts = this.measureDesiredPageCounts();

    if (arePageCountsEqual(currentCounts, desiredCounts)) {
      this.notifyPageCount();
      return;
    }

    const anchor = createSelectionAnchor(
      this.view.state.doc,
      this.view.state.selection.anchor,
      this.view.state.selection.anchor === this.view.state.selection.from ? -1 : 1
    );
    const head = createSelectionAnchor(
      this.view.state.doc,
      this.view.state.selection.head,
      this.view.state.selection.head >= this.view.state.selection.anchor ? 1 : -1
    );
    const nextDoc = this.buildRepaginatedDocument(desiredCounts);
    const nextAnchorPos = resolveSelectionAnchor(nextDoc, anchor);
    const nextHeadPos = resolveSelectionAnchor(nextDoc, head);
    let tr = this.view.state.tr.replaceWith(0, this.view.state.doc.content.size, nextDoc.content);
    tr = tr.setSelection(
      TextSelection.create(
        tr.doc,
        Math.max(1, Math.min(nextAnchorPos, tr.doc.content.size)),
        Math.max(1, Math.min(nextHeadPos, tr.doc.content.size))
      )
    );

    if (this.view.state.selection.empty) {
      const marks = this.view.state.storedMarks ?? this.view.state.selection.$from.marks();
      tr.setStoredMarks(marks);
    }

    this.debugLog("controller.repaginateDocument", {
      currentCounts,
      desiredCounts,
    });
    this.dispatchTransaction(tr);
  }

  debugLog(type, detail = {}) {
    this.debug?.log(type, detail);
  }

  shouldDebugLog(type) {
    return this.debug?.shouldLog?.(type) ?? false;
  }

  updateDebugState(label) {
    if (label === "controller.dispatchTransaction") {
      return;
    }

    this.debug?.setState(label, this.getDebugSnapshot());
  }

  getDebugSnapshot() {
    const marks = this.view
      ? this.view.state.storedMarks ?? this.view.state.selection.$from.marks()
      : [];
    const activeMathView = this.activeMathId
      ? this.mathViews.get(this.activeMathId)
      : null;

    return {
      activeElement: describeDomNode(document.activeElement),
      viewHasFocus: this.view?.hasFocus?.() ?? false,
      activeMathId: this.activeMathId,
      lastFocusedMathId: this.lastFocusedMathId,
      pendingMathFocusId: this.pendingMathFocusId,
      pendingMathFocusEdge: this.pendingMathFocusEdge,
      hasMathCapture: this.hasMathCapture(),
      pageCount: this.pageCount,
      preservedTextSelection: this.preservedTextSelection,
      mathViewIds: Array.from(this.mathViews.keys()),
      mathTarget: summarizeMathTarget(this.getMathTarget()),
      activeMathDraft: activeMathView?.getDraftPatch?.() ?? null,
      pmSelection: this.view ? summarizePmSelection(this.view.state.selection) : null,
      domSelection: summarizeDomSelection(),
      storedMarks: summarizeMarks(marks),
    };
  }

  shouldPreserveTextContext(state) {
    if (this.hasMathCapture() || !this.preservedTextSelection) {
      return false;
    }

    return (
      state.selection.empty &&
      state.selection.from === this.preservedTextSelection.from &&
      state.selection.to === this.preservedTextSelection.to
    );
  }

  updatePreservedTextContext(patch, updateMarks = true) {
    const toolbarState = {
      ...this.lastTextContext.toolbarState,
      ...patch,
    };

    this.lastTextContext = {
      toolbarState,
      marks: updateMarks
        ? buildMarksFromToolbarState(toolbarState, editorSchema)
        : this.lastTextContext.marks,
    };
    this.emitUiState();
  }

  syncUi(shouldPersist) {
    this.applyPageLayoutToDom();

    if (shouldPersist) {
      this.saveDocument(this.getDocument());
    }
  }

  emitUiState() {
    const mathTarget = this.getMathTarget();
    const activeMathView = mathTarget
      ? this.mathViews.get(mathTarget.id)
      : null;
    const activeDraftPatch = activeMathView?.getDraftPatch?.() ?? {};
    const mathStyle = mathTarget
      ? {
          fontFamily: normalizeMathFontFamily(
            activeDraftPatch.fontFamily ?? mathTarget.node.attrs.fontFamily
          ),
          fontSize: normalizeMathFontSize(
            activeDraftPatch.fontSize ?? mathTarget.node.attrs.fontSize
          ),
        }
      : { ...this.currentMathStyle };

    this.onUiStateChange?.({
      text: this.getCurrentTextToolbarState(),
      math: mathStyle,
      isMathActive: this.isMathActive(),
    });
  }

  emitSlashItemState() {
    this.onSlashItemStateChange?.(this.getActiveSlashItemState());
  }
}

export function createPaperEditorController(options) {
  return new PaperEditorController(options);
}
