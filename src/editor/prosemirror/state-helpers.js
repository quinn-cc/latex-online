import { TextSelection } from "prosemirror-state";
import { DEFAULT_TEXT_TOOLBAR_STATE } from "../../core/config.js";
import {
  createDefaultTextToolbarState,
  normalizeLineSpacing,
  normalizeOrderedListStyle,
  normalizeParagraphSpacing,
  normalizeTextAlignment,
  normalizeTextFontFamily,
  normalizeTextFontSize,
} from "./options.js";
import { editorSchema } from "./schema.js";
import { createTableParagraphAttrs } from "./backslash-commands/table.js";

export function isMathNode(node) {
  return (
    node?.type === editorSchema.nodes.inline_math ||
    node?.type === editorSchema.nodes.align_math ||
    node?.type === editorSchema.nodes.gather_math
  );
}

export function createLastTextContext(
  toolbarState = createDefaultTextToolbarState(),
  schema = editorSchema
) {
  return {
    toolbarState: { ...toolbarState },
    marks: buildMarksFromToolbarState(toolbarState, schema),
  };
}

export function buildMarksFromToolbarState(toolbarState, schema = editorSchema) {
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

export function getMarkValue(marks, markType, fallbackValue) {
  return marks.find((mark) => mark.type === markType)?.attrs?.value ?? fallbackValue;
}

export function hasMark(marks, markType) {
  return marks.some((mark) => mark.type === markType);
}

export function getSelectionMarks(state) {
  if (state.selection.empty) {
    return state.storedMarks ?? state.selection.$from.marks();
  }

  return state.selection.$from.marks();
}

export function getPrimaryParagraphInfo(state, anchorPos = null) {
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

export function collectParagraphPositions(state, anchorFrom = null, anchorTo = null) {
  if (anchorFrom != null && anchorTo != null) {
    return collectParagraphPositionsInRange(state, anchorFrom, anchorTo);
  }

  if (!state.selection.empty) {
    return collectParagraphPositionsInRange(state, state.selection.from, state.selection.to);
  }

  const paragraph = getPrimaryParagraphInfo(state);
  return paragraph ? [paragraph.pos] : [];
}

export function collectParagraphPositionsInRange(state, from, to) {
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

export function collectMathPositionsInRange(state, from, to) {
  const positions = [];

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (isMathNode(node)) {
      positions.push(pos);
    }
  });

  return positions;
}

export function getPrimaryListInfo(state, anchorPos = null) {
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

export function getListToolbarType(node) {
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

export function isSelectionInsideListItem(state) {
  const resolvedPos = state.selection.$from;

  for (let depth = resolvedPos.depth; depth >= 0; depth -= 1) {
    if (resolvedPos.node(depth).type === editorSchema.nodes.list_item) {
      return true;
    }
  }

  return false;
}

export function isSelectionInEmptyListItem(state) {
  if (!state.selection.empty || !isSelectionInsideListItem(state)) {
    return false;
  }

  return state.selection.$from.parent.isTextblock &&
    state.selection.$from.parent.content.size === 0;
}

export function getTableParagraphAttrs(state) {
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

function isWidgetBlockContainerNode(node) {
  return (
    node?.type === editorSchema.nodes.page ||
    node?.type === editorSchema.nodes.list_item ||
    node?.type === editorSchema.nodes.table_cell
  );
}

function getContainerChildEntries(containerNode, containerPos) {
  const entries = [];

  containerNode?.forEach((childNode, childOffset, index) => {
    entries.push({
      node: childNode,
      pos: containerPos + 1 + childOffset,
      index,
    });
  });

  return entries;
}

export function getBlockBoundaryContext(state, direction) {
  const { selection } = state;

  if (!(selection instanceof TextSelection) || !selection.empty) {
    return null;
  }

  const { $from } = selection;
  const requireStart = direction === "backward";
  const requireEnd = direction === "forward";

  if (
    $from.parent.type !== editorSchema.nodes.paragraph ||
    (requireStart && $from.parentOffset !== 0) ||
    (requireEnd && $from.parentOffset !== $from.parent.content.size)
  ) {
    return null;
  }

  let blockDepth = null;
  let blockNode = null;
  let blockPos = null;
  let containerNode = null;
  let containerPos = null;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (
      $from.node(depth).type === editorSchema.nodes.paragraph &&
      isWidgetBlockContainerNode($from.node(depth - 1))
    ) {
      blockDepth = depth;
      blockNode = $from.node(depth);
      blockPos = $from.before(depth);
      containerNode = $from.node(depth - 1);
      containerPos = depth - 1 > 0 ? $from.before(depth - 1) : 0;
      break;
    }
  }

  if (
    blockDepth == null ||
    !blockNode ||
    blockPos == null ||
    !containerNode ||
    containerPos == null
  ) {
    return null;
  }

  const childEntries = getContainerChildEntries(containerNode, containerPos);
  const blockIndex = childEntries.findIndex((entry) => entry.pos === blockPos);

  if (blockIndex < 0) {
    return null;
  }

  const adjacentBlock = direction === "backward"
    ? childEntries[blockIndex - 1] ?? null
    : childEntries[blockIndex + 1] ?? null;

  return {
    direction,
    container: {
      node: containerNode,
      pos: containerPos,
    },
    block: {
      ...childEntries[blockIndex],
      node: blockNode,
      index: blockIndex,
    },
    adjacentBlock,
  };
}

export function getPageBlockBoundaryContext(state, createBlockPositionList) {
  const boundaryContext = getBlockBoundaryContext(state, "backward");

  if (
    !boundaryContext ||
    boundaryContext.container.node.type !== editorSchema.nodes.page
  ) {
    return null;
  }

  const blocks = createBlockPositionList(state.doc);
  const blockIndex = blocks.findIndex((entry) => entry.pos === boundaryContext.block.pos);

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

export function createToolbarStateFromState(state, anchorPos = null) {
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

export function setStoredMarksFromToolbarState(tr, toolbarState) {
  tr.setStoredMarks(buildMarksFromToolbarState(toolbarState, editorSchema));
}

export function createTextMarkTransaction(state, markType, nextValue, isDefaultValue) {
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

export function applyParagraphAttrs(tr, state, positions, patch) {
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

export function applyMathAttrs(tr, state, positions, patch) {
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

export function documentHasContent(doc) {
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
