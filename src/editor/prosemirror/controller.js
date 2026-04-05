import { Fragment } from "prosemirror-model";
import { baseKeymap, splitBlockAs, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  liftListItem,
  splitListItemKeepMarks,
  wrapInList,
} from "../../../vendor/prosemirror-schema-list/dist/index.js";
import {
  createDefaultPageSettings,
  normalizePageSettings,
  applyPageSettingsToPageElement,
} from "../../core/page-settings.js";
import { DEFAULT_TEXT_TOOLBAR_STATE } from "../../core/config.js";
import {
  createBackslashCommandRegistry,
  getBackslashCommandSuggestions,
  getExecutableBackslashCommandMatch,
} from "./backslash-commands/index.js";
import { MathNodeView } from "./math-node-view.js";
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
import {
  createDefaultGatherBlock,
  findGatherMathPos,
} from "./backslash-commands/gather.js";
import { MathSession } from "./interactions/math-session.js";
import {
  arePageCountsEqual,
  createBlockPositionList,
  createEmptySelectionState,
  createPageNode,
  createSelectionAnchor,
  flattenPageBlocks,
  getCurrentPageBlockCounts,
  measureBlockHeight,
  resolveSelectionAnchor,
} from "./page-layout.js";
import {
  getActiveSlashItemState as getRegisteredSlashItemState,
  resolveSlashItemState as resolveRegisteredSlashItemState,
} from "./slash-items/index.js";
import {
  applyMathAttrs,
  applyParagraphAttrs,
  buildMarksFromToolbarState,
  collectMathPositionsInRange,
  collectParagraphPositions,
  createLastTextContext,
  createTextMarkTransaction,
  createToolbarStateFromState,
  documentHasContent,
  getPrimaryParagraphInfo,
  getPrimaryListInfo,
  isMathNode,
  isSelectionInEmptyListItem,
  setStoredMarksFromToolbarState,
} from "./state-helpers.js";
import {
  findEnclosingWidgetInfoAtPos,
  findEnclosingWidgetInfoForSelection,
} from "./widget-registry.js";
import { widgetActionMethods } from "./widget-actions.js";

let mathIdCounter = 0;

function createMathId() {
  mathIdCounter += 1;
  return `math-${Date.now().toString(36)}-${mathIdCounter.toString(36)}`;
}

function createWidgetFocusState(widgetInfo) {
  const type = widgetInfo?.definition?.type ?? null;
  const pos = widgetInfo?.pos ?? null;

  if (!type || !Number.isFinite(pos)) {
    return null;
  }

  return {
    type,
    pos,
  };
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
  get activeMathId() {
    return this.mathSession.activeMathId;
  }

  set activeMathId(value) {
    this.mathSession.activeMathId = value;
  }

  get lastFocusedMathId() {
    return this.mathSession.lastFocusedMathId;
  }

  set lastFocusedMathId(value) {
    this.mathSession.lastFocusedMathId = value;
  }

  get pendingMathFocusId() {
    return this.mathSession.pendingMathFocusId;
  }

  set pendingMathFocusId(value) {
    this.mathSession.pendingMathFocusId = value;
  }

  get pendingMathFocusEdge() {
    return this.mathSession.pendingMathFocusEdge;
  }

  set pendingMathFocusEdge(value) {
    this.mathSession.pendingMathFocusEdge = value;
  }

  get pendingMathFocusOffset() {
    return this.mathSession.pendingMathFocusOffset;
  }

  set pendingMathFocusOffset(value) {
    this.mathSession.pendingMathFocusOffset = value;
  }

  get pendingMathFocusSelectionMode() {
    return this.mathSession.pendingMathFocusSelectionMode;
  }

  set pendingMathFocusSelectionMode(value) {
    this.mathSession.pendingMathFocusSelectionMode = value;
  }

  get pendingMathFocusFrame() {
    return this.mathSession.pendingMathFocusFrame;
  }

  set pendingMathFocusFrame(value) {
    this.mathSession.pendingMathFocusFrame = value;
  }

  constructor({
    mount,
    initialDoc,
    initialPageSettings,
    saveDocument,
    MathfieldElementClass,
    onUiStateChange,
    onBackslashMenuStateChange,
    onSlashItemStateChange,
    onPaginationChange,
    debug,
  }) {
    this.mount = mount;
    this.saveDocument = saveDocument;
    this.MathfieldElementClass = MathfieldElementClass;
    this.onUiStateChange = onUiStateChange;
    this.onBackslashMenuStateChange = onBackslashMenuStateChange;
    this.onSlashItemStateChange = onSlashItemStateChange;
    this.onPaginationChange = onPaginationChange;
    this.pageSettings = normalizePageSettings(
      initialPageSettings ?? createDefaultPageSettings()
    );
    this.debug = debug;
    this.backslashCommands = createBackslashCommandRegistry(editorSchema);
    this.backslashMenuSelectionIndex = 0;
    this.backslashMenuDismissedKey = null;
    this.lastBackslashMenuKey = null;

    this.mathViews = new Map();
    this.mathSession = new MathSession({
      resolveMathTargetById: (id) => this.resolveMathTargetById(id),
      getMathView: (id) => this.mathViews.get(id) ?? null,
      debug: (type, detail) => this.debugLog(type, detail),
    });
    this.widgetFocusState = null;
    this.pendingWidgetFocusState = null;
    this.pendingWidgetFocusStateFrame = 0;
    this.widgetFocusSyncFrame = 0;
    this.activeWidgetFocusDom = null;
    this.slashItemState = null;
    this.pendingSlashItemState = null;
    this.pendingSlashItemStateFrame = 0;
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
      nodeViews: this.createMathNodeViews(),
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
    this.emitBackslashMenuState();
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
        ArrowLeft: () => this.handleArrowLeft(),
        ArrowRight: () => this.handleArrowIntoMath("right"),
      }),
      keymap(baseKeymap),
    ];
  }

  createSharedMathOptions() {
    return {
      MathfieldElementClass: this.MathfieldElementClass,
      commitMathNode: (pos, patch) => this.commitMathNode(pos, patch),
      commitAndExitMathNode: (pos, direction, patch) =>
        this.commitAndExitMathNode(pos, direction, patch),
      exitMathNode: (pos, direction) => this.exitMathNode(pos, direction),
      handleMathBlur: (id, pos) => this.handleMathBlur(id, pos),
      handleBackspaceAtStart: (pos) => this.removeLeadingWidgetFromContentPos(pos),
      handleMathFocus: (id, pos) => this.handleMathFocus(id, pos),
      handleBackslashMenuKey: (event, source) =>
        this.handleBackslashMenuKey(event, source),
      handleBackslashMenuChange: () => this.emitBackslashMenuState(),
      handleMathStructureChange: () => this.emitSlashItemState(),
      scheduleWidgetFocusSync: () => this.scheduleWidgetFocusSync(),
      hasActiveMathFocusForId: (id) => this.activeMathId === id,
      getPendingMathFocusId: () => this.pendingMathFocusId,
      hasPendingMathFocusForId: (id) => this.pendingMathFocusId === id,
      applyWidgetEntryTarget: (target, options = {}) =>
        this.applyWidgetEntryTarget(target, options),
      registerMathView: (id, nodeView) => this.registerMathView(id, nodeView),
      removeMathNode: (pos, direction) => this.removeMathNode(pos, direction),
      resolvePointerEntryTargetAtPos: (pos, pointer) =>
        this.resolvePointerEntryTargetAtPos(pos, pointer),
      resolveMathPositionById: (id) => this.findMathPositionById(id),
      selectMathNode: (pos) => this.selectMathNode(pos),
      shouldDebugLog: (type) => this.shouldDebugLog(type),
      unregisterMathView: (id, nodeView) => this.unregisterMathView(id, nodeView),
      debug: (type, detail) => this.debugLog(type, detail),
    };
  }

  createMathNodeViews() {
    const shared = this.createSharedMathOptions();
    return {
      inline_math: (node, view, getPos) =>
        new MathNodeView(node, view, getPos, shared, "inline"),
      align_math: (node, view, getPos) =>
        new MathNodeView(node, view, getPos, {
          ...shared,
          handleGridTab: (pos, direction, patch) =>
            this.handleMathGridTab(pos, direction, patch),
          handleAlignEnter: (pos, patch) => this.handleAlignEnterFromMath(pos, patch),
          handleAlignShiftEnter: (pos, patch) =>
            this.insertAlignRowBelowFromMath(pos, patch),
        }, "align"),
      gather_math: (node, view, getPos) =>
        new MathNodeView(node, view, getPos, {
          ...shared,
          handleGridTab: (pos, direction, patch) =>
            this.handleMathGridTab(pos, direction, patch),
          handleGatherEnter: (pos, patch) => this.handleGatherEnterFromMath(pos, patch),
          handleGatherShiftEnter: (pos, patch) =>
            this.insertGatherRowBelowFromMath(pos, patch),
        }, "gather"),
    };
  }

  destroy() {
    this.cancelPendingMathFocus();
    this.clearPendingWidgetFocusState();
    this.clearWidgetFocusSyncFrame();
    this.clearPendingSlashItemState();
    this.clearAppliedWidgetFocusDom();
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
    this.loadDocument(createEmptyDocument());
    this.debugLog("controller.clear");
  }

  loadDocument(doc) {
    this.currentMathStyle = createDefaultMathStyle();
    this.lastTextContext = createLastTextContext(
      createDefaultTextToolbarState(),
      editorSchema
    );
    this.mathSession.reset();
    this.clearPendingWidgetFocusState();
    this.clearWidgetFocusSyncFrame();
    this.clearAppliedWidgetFocusDom();
    this.widgetFocusState = null;
    this.clearPendingSlashItemState();
    this.slashItemState = null;
    this.preservedTextSelection = null;
    const tr = this.view.state.tr.replaceWith(
      0,
      this.view.state.doc.content.size,
      doc.content
    );
    tr.setSelection(createEmptySelectionState(tr.doc));
    setStoredMarksFromToolbarState(tr, this.lastTextContext.toolbarState);
    this.dispatchTransaction(tr);
    this.view.focus();
    this.debugLog("controller.loadDocument", {
      pageCount: doc.childCount,
    });
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

    return this.removeAdjacentWidget("backward") ||
      this.removeLeadingWidgetFromSelection();
  }

  getFallbackExecutableBackslashCommandMatch() {
    const selection = this.view.state.selection;

    if (!selection?.empty || !selection.$from?.parent) {
      return null;
    }

    const paragraphNode = selection.$from.parent;

    if (paragraphNode.type?.name !== "paragraph") {
      return null;
    }

    const fullText = paragraphNode.textContent;
    const trimmedText = fullText.trim();
    const commandMatch = /^\\([A-Za-z]+)$/.exec(trimmedText);

    if (!commandMatch) {
      return null;
    }

    const commandName = commandMatch[1].toLowerCase();
    const command = this.backslashCommands.commandsByName.get(commandName);

    if (!command) {
      return null;
    }

    const commandStart = fullText.lastIndexOf("\\");
    const paragraphPos = selection.$from.before();

    return {
      command,
      query: {
        nameQuery: commandName,
        commandStart,
        fullText,
        beforeText: fullText.slice(0, selection.$from.parentOffset),
        afterText: fullText.slice(selection.$from.parentOffset),
        paragraphNode,
        paragraphPos,
        parentNode: selection.$from.node(selection.$from.depth - 1),
        parentIndex: selection.$from.index(selection.$from.depth - 1),
      },
    };
  }

  executeBackslashCommandAtSelection() {
    const match =
      getExecutableBackslashCommandMatch(this.view.state, this.backslashCommands) ??
      this.getFallbackExecutableBackslashCommandMatch();

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

  executeBackslashCommandByName(commandName) {
    const command = this.backslashCommands.commandsByName.get(commandName);
    const query = getBackslashCommandSuggestions(
      this.view.state,
      this.backslashCommands
    )?.queryData;

    if (!command || !query) {
      return false;
    }

    const result = command.execute({
      state: this.view.state,
      match: query,
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
    this.dispatchTransaction(tr);

    if (result?.focusMathId) {
      this.focusMathNode(
        result.focusMathId,
        result.focusMathEdge ?? "start"
      );
    } else {
      this.focus();
    }

    return true;
  }

  getBackslashMenuIdentity(menuState) {
    if (!menuState) {
      return null;
    }

    return JSON.stringify({
      source: menuState.source,
      mathId: menuState.mathId ?? null,
      sessionKey: menuState.sessionKey ?? null,
      query: menuState.query ?? "",
      items: menuState.items?.map((item) => item.name) ?? [],
    });
  }

  getRawBackslashMenuState() {
    const mathTarget = this.getFocusedOrPendingMathTarget();
    const activeMathView = mathTarget ? this.getMathView(mathTarget.id) : null;
    const activeMathMenuState =
      activeMathView?.getActiveBackslashMenuState?.() ?? null;

    return mathTarget
      ? activeMathMenuState
      : getBackslashCommandSuggestions(this.view.state, this.backslashCommands);
  }

  syncBackslashMenuSession(rawMenuState) {
    const menuKey = this.getBackslashMenuIdentity(rawMenuState);

    if (!rawMenuState || !menuKey) {
      this.lastBackslashMenuKey = null;
      this.backslashMenuSelectionIndex = 0;
      this.backslashMenuDismissedKey = null;
      return null;
    }

    if (menuKey !== this.lastBackslashMenuKey) {
      this.lastBackslashMenuKey = menuKey;
      this.backslashMenuSelectionIndex = 0;
      this.backslashMenuDismissedKey = null;
    } else {
      const maxIndex = Math.max(0, rawMenuState.items.length - 1);
      this.backslashMenuSelectionIndex = Math.min(
        this.backslashMenuSelectionIndex,
        maxIndex
      );
    }

    return menuKey;
  }

  getActiveBackslashMenuState() {
    const rawMenuState = this.getRawBackslashMenuState();
    const menuKey = this.syncBackslashMenuSession(rawMenuState);

    if (!rawMenuState || !menuKey || this.backslashMenuDismissedKey === menuKey) {
      return null;
    }

    return {
      ...rawMenuState,
      selectedIndex: Math.max(
        0,
        Math.min(
          this.backslashMenuSelectionIndex,
          Math.max(0, (rawMenuState.items?.length ?? 1) - 1)
        )
      ),
    };
  }

  getBackslashMenuClientRect(menuState = null) {
    const activeMenuState = menuState ?? this.getActiveBackslashMenuState();

    if (!activeMenuState) {
      return null;
    }

    if (activeMenuState.source === "math") {
      const mathView = activeMenuState.mathId
        ? this.getMathView(activeMenuState.mathId)
        : null;
      return mathView?.getBackslashMenuClientRect?.(activeMenuState) ?? null;
    }

    const selection = this.view.state.selection;
    const coords = this.view.coordsAtPos(selection.from);

    return {
      top: coords.top,
      right: coords.right,
      bottom: coords.bottom,
      left: coords.left,
      width: Math.max(1, coords.right - coords.left),
      height: Math.max(1, coords.bottom - coords.top),
    };
  }

  setBackslashMenuSelectionIndex(index) {
    const menuState = this.getActiveBackslashMenuState();

    if (!menuState?.items?.length) {
      return false;
    }

    const nextIndex = Math.max(
      0,
      Math.min(Number.parseInt(String(index), 10) || 0, menuState.items.length - 1)
    );

    if (nextIndex === this.backslashMenuSelectionIndex) {
      return false;
    }

    this.backslashMenuSelectionIndex = nextIndex;
    this.emitBackslashMenuState();
    return true;
  }

  applyBackslashMenuCommand(menuState, commandName = null) {
    const activeMenuState = menuState ?? this.getActiveBackslashMenuState();
    const nextCommandName =
      commandName ??
      activeMenuState?.items?.[activeMenuState?.selectedIndex ?? 0]?.name ??
      null;

    if (!activeMenuState || !nextCommandName) {
      return false;
    }

    this.backslashMenuDismissedKey = null;

    if (activeMenuState.source === "math") {
      const mathView = activeMenuState.mathId
        ? this.getMathView(activeMenuState.mathId)
        : null;
      const didApply = mathView?.applyBackslashMenuCommand?.(nextCommandName) ?? false;

      if (didApply) {
        this.emitBackslashMenuState();
      }

      return didApply;
    }

    return this.executeBackslashCommandByName(nextCommandName);
  }

  handleBackslashMenuKey(event, source) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return false;
    }

    const menuState = this.getActiveBackslashMenuState();

    if (!menuState || menuState.source !== source) {
      return false;
    }

    if (event.key === "Escape") {
      const menuKey = this.getBackslashMenuIdentity(menuState);
      this.backslashMenuDismissedKey = menuKey;
      event.preventDefault();
      event.stopPropagation();
      this.emitBackslashMenuState();
      return true;
    }

    if (event.key === "ArrowDown" || (!event.shiftKey && event.key === "Tab")) {
      event.preventDefault();
      event.stopPropagation();
      this.setBackslashMenuSelectionIndex(menuState.selectedIndex + 1);
      return true;
    }

    if (event.key === "ArrowUp" || (event.shiftKey && event.key === "Tab")) {
      event.preventDefault();
      event.stopPropagation();
      this.setBackslashMenuSelectionIndex(menuState.selectedIndex - 1);
      return true;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      return this.applyBackslashMenuCommand(menuState);
    }

    return false;
  }

  getActiveSlashItemState() {
    return getRegisteredSlashItemState(this);
  }

  getActiveWidgetFocusState() {
    const slashItem = this.getActiveSlashItemState();

    if (Number.isFinite(slashItem?.pos)) {
      const slashItemWidgetInfo = findEnclosingWidgetInfoAtPos(
        this.view.state.doc,
        slashItem.pos
      );

      if (slashItemWidgetInfo) {
        return createWidgetFocusState(slashItemWidgetInfo);
      }
    }

    const mathTarget = this.getFocusedOrPendingMathTarget();

    if (mathTarget) {
      return createWidgetFocusState(
        findEnclosingWidgetInfoAtPos(this.view.state.doc, mathTarget.pos)
      );
    }

    if (!this.view?.hasFocus?.()) {
      return null;
    }

    return createWidgetFocusState(
      findEnclosingWidgetInfoForSelection(this.view.state.selection)
    );
  }

  resolveWidgetFocusState(item) {
    if (!item?.type || !Number.isFinite(item.pos)) {
      return null;
    }

    const widgetInfo = findEnclosingWidgetInfoAtPos(this.view.state.doc, item.pos);
    const resolvedState = createWidgetFocusState(widgetInfo);

    return resolvedState?.type === item.type ? resolvedState : null;
  }

  clearPendingWidgetFocusStateFrame() {
    if (!this.pendingWidgetFocusStateFrame) {
      return;
    }

    cancelAnimationFrame(this.pendingWidgetFocusStateFrame);
    this.pendingWidgetFocusStateFrame = 0;
  }

  clearPendingWidgetFocusState() {
    this.clearPendingWidgetFocusStateFrame();
    this.pendingWidgetFocusState = null;
  }

  clearWidgetFocusSyncFrame() {
    if (!this.widgetFocusSyncFrame) {
      return;
    }

    cancelAnimationFrame(this.widgetFocusSyncFrame);
    this.widgetFocusSyncFrame = 0;
  }

  clearAppliedWidgetFocusDom() {
    if (!this.activeWidgetFocusDom) {
      return;
    }

    this.activeWidgetFocusDom.classList.remove("is-widget-active");
    this.activeWidgetFocusDom = null;
  }

  getWidgetFocusDom(item) {
    if (!item || !Number.isFinite(item.pos)) {
      return null;
    }

    const widgetInfo = findEnclosingWidgetInfoAtPos(this.view.state.doc, item.pos);
    const customDom = widgetInfo?.definition?.resolveFocusDom?.({
      controller: this,
      item,
      widgetInfo,
    });

    if (customDom instanceof HTMLElement) {
      return customDom;
    }

    const nodeDom = this.view?.nodeDOM?.(item.pos);
    return nodeDom instanceof HTMLElement ? nodeDom : null;
  }

  getStableWidgetFocusState(item = this.getActiveWidgetFocusState()) {
    const resolvedActiveItem = item
      ? this.resolveWidgetFocusState(item) ?? item
      : null;

    if (resolvedActiveItem) {
      this.widgetFocusState = resolvedActiveItem;
      return resolvedActiveItem;
    }

    const resolvedPendingItem = this.pendingWidgetFocusState
      ? this.resolveWidgetFocusState(this.pendingWidgetFocusState)
        ?? this.pendingWidgetFocusState
      : null;

    if (resolvedPendingItem) {
      this.widgetFocusState = resolvedPendingItem;
      return resolvedPendingItem;
    }

    this.widgetFocusState = null;
    return null;
  }

  beginWidgetFocusHandoff(item = null) {
    const baseItem = item
      ? this.resolveWidgetFocusState(item) ?? item
      : this.widgetFocusState ?? this.getStableWidgetFocusState();

    if (!baseItem) {
      return;
    }

    this.pendingWidgetFocusState = baseItem;
    this.clearPendingWidgetFocusStateFrame();

    const settle = () => {
      this.pendingWidgetFocusStateFrame = 0;

      if (this.getActiveWidgetFocusState()) {
        this.emitUiState();
        return;
      }

      if (this.hasPendingMathFocus()) {
        this.pendingWidgetFocusStateFrame = requestAnimationFrame(settle);
        return;
      }

      this.pendingWidgetFocusState = null;
      this.emitUiState();
    };

    this.pendingWidgetFocusStateFrame = requestAnimationFrame(settle);
  }

  syncWidgetFocusState() {
    const nextItem = this.getStableWidgetFocusState();
    const nextDom = this.getWidgetFocusDom(nextItem);

    if (this.pendingWidgetFocusState && this.activeWidgetFocusDom && !nextDom) {
      return;
    }

    if (this.activeWidgetFocusDom && this.activeWidgetFocusDom !== nextDom) {
      this.activeWidgetFocusDom.classList.remove("is-widget-active");
    }

    if (nextDom) {
      nextDom.classList.add("is-widget-active");
    }

    this.activeWidgetFocusDom = nextDom;
  }

  scheduleWidgetFocusSync() {
    if (this.widgetFocusSyncFrame) {
      return;
    }

    this.widgetFocusSyncFrame = requestAnimationFrame(() => {
      this.widgetFocusSyncFrame = 0;
      this.syncWidgetFocusState();
    });
  }

  getStableSlashItemState(item = this.getActiveSlashItemState()) {
    const resolvedActiveItem = item
      ? this.resolveSlashItemState(item) ?? item
      : null;

    if (resolvedActiveItem) {
      this.slashItemState = resolvedActiveItem;
      this.clearPendingSlashItemState();
      return resolvedActiveItem;
    }

    const resolvedPendingItem = this.pendingSlashItemState
      ? this.resolveSlashItemState(this.pendingSlashItemState) ?? this.pendingSlashItemState
      : null;

    if (resolvedPendingItem) {
      this.slashItemState = resolvedPendingItem;
      return resolvedPendingItem;
    }

    this.slashItemState = null;
    return null;
  }

  resolveSlashItemState(item) {
    return resolveRegisteredSlashItemState(this, item);
  }

  clearPendingSlashItemStateFrame() {
    if (!this.pendingSlashItemStateFrame) {
      return;
    }

    cancelAnimationFrame(this.pendingSlashItemStateFrame);
    this.pendingSlashItemStateFrame = 0;
  }

  clearPendingSlashItemState() {
    this.clearPendingSlashItemStateFrame();
    this.pendingSlashItemState = null;
  }

  beginSlashItemStateHandoff(item = null) {
    const baseItem = item
      ? this.resolveSlashItemState(item) ?? item
      : this.slashItemState ?? this.getStableSlashItemState();

    if (!baseItem) {
      return;
    }

    this.pendingSlashItemState = baseItem;
    this.clearPendingSlashItemStateFrame();

    const settle = () => {
      this.pendingSlashItemStateFrame = 0;

      if (this.getActiveSlashItemState()) {
        this.emitSlashItemState();
        return;
      }

      if (this.hasPendingMathFocus()) {
        this.pendingSlashItemStateFrame = requestAnimationFrame(settle);
        return;
      }

      this.pendingSlashItemState = null;
      this.emitSlashItemState();
    };

    this.pendingSlashItemStateFrame = requestAnimationFrame(settle);
  }

  getSlashItemClientRect(itemOrPos) {
    if (
      itemOrPos &&
      typeof itemOrPos === "object" &&
      itemOrPos.source === "math-structure"
    ) {
      const mathView = itemOrPos.mathId ? this.getMathView(itemOrPos.mathId) : null;
      return mathView?.getSettingsItemClientRect?.(itemOrPos) ?? null;
    }

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

  updateMathArraySettings(item, settings) {
    if (item?.source !== "math-structure") {
      return false;
    }

    const mathView = item.mathId ? this.getMathView(item.mathId) : null;
    return mathView?.updateMathArraySettings?.(item, settings) ?? false;
  }

  canDeleteMathStructureItem(item) {
    if (item?.source !== "math-structure") {
      return false;
    }

    const mathView = item.mathId ? this.getMathView(item.mathId) : null;
    return mathView?.canDeleteMathStructureItem?.(item) ?? false;
  }

  deleteMathStructureItem(item) {
    if (item?.source !== "math-structure") {
      return false;
    }

    const mathView = item.mathId ? this.getMathView(item.mathId) : null;
    return mathView?.deleteMathStructureItem?.(item) ?? false;
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

    return this.enterAdjacentWidget(direction === "left" ? "backward" : "forward");
  }

  commitMathNode(pos, patch) {
    if (!Number.isFinite(pos)) {
      return false;
    }

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
    if (!Number.isFinite(pos)) {
      return false;
    }

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
    if (!Number.isFinite(pos)) {
      return false;
    }

    const node = this.view.state.doc.nodeAt(pos);

    if (!isMathNode(node)) {
      return false;
    }

    if (node.type === editorSchema.nodes.align_math) {
      return this.handleAlignMathExit(pos, direction, null, {
        deleteWhenEmpty: true,
      });
    }

    if (node.type === editorSchema.nodes.gather_math) {
      return this.handleGatherMathExit(pos, direction, null, {
        deleteWhenEmpty: true,
      });
    }

    if (node.type === editorSchema.nodes.inline_math) {
      return this.deleteWidgetAt(pos, {
        trigger: "math-remove",
        direction,
        debugType: "controller.removeMathNode.inline",
        debugDetail: {
          requestedBy: "controller.removeMathNode",
        },
      });
    }

    return false;
  }

  exitMathNode(pos, direction) {
    return this.commitAndExitMathNode(pos, direction);
  }

  commitAndExitMathNode(pos, direction, patch = null) {
    if (!Number.isFinite(pos)) {
      return false;
    }

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
    this.mathSession.handleFocus(id);
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
    this.emitBackslashMenuState();
    this.emitSlashItemState();
    this.updateDebugState("controller.handleMathFocus");
  }

  handleMathBlur(id, pos) {
    this.mathSession.handleBlur(id);

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
    this.emitBackslashMenuState();
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
      this.scheduleMathFocus(id, this.pendingMathFocusEdge, {
        offset: this.pendingMathFocusOffset,
        selectionMode: this.pendingMathFocusSelectionMode,
      });
    }
  }

  getMathView(id) {
    return this.mathViews.get(id) ?? null;
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
    this.emitBackslashMenuState();
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
      !event.defaultPrevented &&
      this.handleBackslashMenuKey(event, "text")
    ) {
      return true;
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
    return this.mathSession.getMathTarget();
  }

  resolveMathTargetById(id) {
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

  getMathTargetById(id) {
    return this.mathSession.getMathTargetById(id);
  }

  getFocusedOrPendingMathTarget() {
    return this.mathSession.getFocusedOrPendingTarget();
  }

  getActiveMathTarget() {
    return this.activeMathId ? this.resolveMathTargetById(this.activeMathId) : null;
  }

  getSettingsMathTarget() {
    const target = this.getFocusedOrPendingMathTarget();

    if (!target) {
      return null;
    }

    const nodeView = this.getMathView(target.id);

    return nodeView?.hasSettingsInteractionFocus?.() === true ? target : null;
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
    return this.mathSession.isMathActive();
  }

  hasPendingMathFocus() {
    return this.mathSession.hasPendingFocus();
  }

  hasMathCapture() {
    return this.mathSession.hasCapture();
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

  focusMathNode(id, edge, options = {}) {
    return this.mathSession.focusNode(id, edge, options);
  }

  prepareMathFocusHandoff(id, edge, options = {}) {
    return this.mathSession.prepareFocus(id, edge, options);
  }

  cancelPendingMathFocus() {
    this.mathSession.cancelPendingFocus();
  }

  cancelPendingMathFocusFrame() {
    this.mathSession.cancelPendingFocusFrame();
  }

  scheduleMathFocus(id, edge, options = {}) {
    this.mathSession.scheduleFocus(id, edge, options);
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
    const gatherBlock = createDefaultGatherBlock(
      editorSchema,
      1,
      1,
      (_rowIndex, _cellIndex) => this.createMathNodeAttrsForState(state, initialLatex)
    );
    const firstMathNode = gatherBlock.firstChild?.firstChild;
    const replacementNodes = beforeParagraph
      ? [beforeParagraph, gatherBlock, afterParagraph]
      : [gatherBlock, afterParagraph];
    const replacement = Fragment.fromArray(replacementNodes);
    const mathPos = beforeParagraph
      ? findGatherMathPos(gatherBlock, paragraphPos + beforeParagraph.nodeSize, 0, 0)
      : findGatherMathPos(gatherBlock, paragraphPos, 0, 0);
    const mathId = firstMathNode?.attrs?.id ?? null;

    if (!mathId || mathPos == null) {
      return null;
    }

    this.prepareMathInsertion(mathId, textToolbarState);
    this.debugLog("controller.buildDisplayMathInsertionTransaction", {
      paragraphPos,
      cursorOffset,
      nodeId: mathId,
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
    tr.setSelection(
      TextSelection.near(tr.doc.resolve(mathPos + (firstMathNode?.nodeSize ?? 1)), -1)
    );
    return tr;
  }

  prepareMathInsertion(nodeId, textToolbarState, edge = "start") {
    this.cancelPendingMathFocus();
    this.prepareMathFocusHandoff(nodeId, edge);
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
      pendingMathFocusOffset: this.pendingMathFocusOffset,
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
    this.syncWidgetFocusState();
    this.scheduleWidgetFocusSync();
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

  emitBackslashMenuState() {
    this.onBackslashMenuStateChange?.(this.getActiveBackslashMenuState());
  }

  emitSlashItemState() {
    this.syncWidgetFocusState();
    this.scheduleWidgetFocusSync();
    this.onSlashItemStateChange?.(this.getStableSlashItemState());
  }
}

Object.assign(PaperEditorController.prototype, widgetActionMethods);

export function createPaperEditorController(options) {
  return new PaperEditorController(options);
}
