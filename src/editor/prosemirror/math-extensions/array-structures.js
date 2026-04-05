const DEFAULT_ROW_COUNT = 2;
const DEFAULT_COLUMN_COUNT = 2;

const MATRIX_STYLE_OPTIONS = Object.freeze([
  {
    value: "plain",
    label: "No brackets",
    commandName: "matrix",
    environmentName: "matrix",
  },
  {
    value: "parentheses",
    label: "Parentheses",
    commandName: "pmatrix",
    environmentName: "pmatrix",
  },
  {
    value: "brackets",
    label: "Brackets",
    commandName: "bmatrix",
    environmentName: "bmatrix",
  },
  {
    value: "braces",
    label: "Braces",
    commandName: "Bmatrix",
    environmentName: "Bmatrix",
  },
  {
    value: "bars",
    label: "Single bars",
    commandName: "vmatrix",
    environmentName: "vmatrix",
  },
  {
    value: "double-bars",
    label: "Double bars",
    commandName: "Vmatrix",
    environmentName: "Vmatrix",
  },
  {
    value: "angle-brackets",
    label: "Angle brackets",
    environmentName: "matrix",
    wrapper: {
      leftDelim: "\\langle",
      rightDelim: "\\rangle",
    },
  },
  {
    value: "left-angle",
    label: "Left angle",
    environmentName: "matrix",
    wrapper: {
      leftDelim: "\\langle",
      rightDelim: "|",
    },
  },
  {
    value: "right-angle",
    label: "Right angle",
    environmentName: "matrix",
    wrapper: {
      leftDelim: "|",
      rightDelim: "\\rangle",
    },
  },
]);

const MATRIX_STYLE_BY_VALUE = new Map(
  MATRIX_STYLE_OPTIONS.map((option) => [option.value, option])
);
const MATRIX_STYLE_BY_COMMAND = new Map(
  MATRIX_STYLE_OPTIONS.filter((option) => option.commandName).map((option) => [option.commandName, option])
);
const MATRIX_STYLE_BY_ENVIRONMENT = new Map(
  MATRIX_STYLE_OPTIONS.flatMap((option) => [
    [option.environmentName, option],
    [`${option.environmentName}*`, option],
  ])
);

const MATH_ARRAY_STRUCTURE_DEFINITIONS = Object.freeze([
  {
    type: "cases",
    title: "Cases",
    commandNames: ["cases"],
    commandItems: [
      {
        name: "cases",
        title: "Cases",
        description: "Insert a two-row cases block",
      },
    ],
    environmentNames: ["cases", "dcases", "rcases"],
    defaultRows: 2,
    defaultColumns: 2,
    settingsFields: [
      {
        key: "rowCount",
        label: "Rows",
        type: "number",
        min: 1,
        max: 20,
        step: 1,
      },
    ],
  },
  {
    type: "matrix",
    title: "Matrix",
    commandNames: MATRIX_STYLE_OPTIONS.map((option) => option.commandName),
    commandItems: MATRIX_STYLE_OPTIONS.filter((option) => option.commandName).map((option) => ({
      name: option.commandName,
      title: option.label,
      description: `Insert a ${option.label.toLowerCase()} matrix`,
    })),
    environmentNames: MATRIX_STYLE_OPTIONS.flatMap((option) => [
      option.environmentName,
      `${option.environmentName}*`,
    ]),
    defaultRows: 2,
    defaultColumns: 2,
    defaultStyle: "brackets",
    settingsFields: [
      {
        key: "style",
        label: "Style",
        type: "select",
        options: MATRIX_STYLE_OPTIONS.map(({ value, label }) => ({ value, label })),
      },
      {
        key: "rowCount",
        label: "Rows",
        type: "number",
        min: 1,
        max: 20,
        step: 1,
      },
      {
        key: "columnCount",
        label: "Columns",
        type: "number",
        min: 1,
        max: 12,
        step: 1,
      },
    ],
  },
]);

const MATH_ARRAY_STRUCTURES_BY_TYPE = new Map(
  MATH_ARRAY_STRUCTURE_DEFINITIONS.map((definition) => [definition.type, definition])
);

const MATH_ARRAY_STRUCTURES_BY_ENVIRONMENT = new Map(
  MATH_ARRAY_STRUCTURE_DEFINITIONS.flatMap((definition) =>
    definition.environmentNames.map((environmentName) => [environmentName, definition])
  )
);

const MATH_ARRAY_STRUCTURES_BY_COMMAND = new Map(
  MATH_ARRAY_STRUCTURE_DEFINITIONS.flatMap((definition) =>
    definition.commandNames.map((commandName) => [commandName, definition])
  )
);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCellLatex(value) {
  const latex = String(value ?? "").trim();
  return latex === "" ? "\\placeholder{}" : latex;
}

function hasSettingsField(definition, key) {
  return definition.settingsFields.some((field) => field.key === key);
}

function normalizeCount(value, fallback, { min = 1, max = 20 } = {}) {
  const normalizedFallback = Math.max(
    min,
    Number.parseInt(String(fallback), 10) || fallback || min
  );
  const parsedValue = Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsedValue)) {
    return normalizedFallback;
  }

  return clamp(parsedValue, min, max);
}

function normalizeMatrixStyle(value, fallback = "brackets") {
  if (MATRIX_STYLE_BY_VALUE.has(value)) {
    return value;
  }

  return MATRIX_STYLE_BY_VALUE.has(fallback) ? fallback : "brackets";
}

function normalizeDelimiter(delimiter) {
  if (!delimiter) {
    return "";
  }

  const value = String(delimiter).trim();
  const normalized = value.startsWith("\\") ? value : `\\${value}`;

  if (normalized === "\\<") {
    return "\\langle";
  }

  if (normalized === "\\>") {
    return "\\rangle";
  }

  return normalized;
}

function getMatrixStyleForContext(environment) {
  const environmentName = environment?.environmentName ?? "";
  const directStyle = MATRIX_STYLE_BY_ENVIRONMENT.get(environmentName)?.value ?? "plain";

  if (environment?.parent?.type === "leftright") {
    const leftDelim = normalizeDelimiter(environment.parent.leftDelim);
    const rightDelim = normalizeDelimiter(
      typeof environment.parent.matchingRightDelim === "function"
        ? environment.parent.matchingRightDelim()
        : environment.parent.rightDelim
    );

    const wrappedStyle = MATRIX_STYLE_OPTIONS.find(
      (option) =>
        normalizeDelimiter(option.wrapper?.leftDelim) === leftDelim &&
        normalizeDelimiter(option.wrapper?.rightDelim) === rightDelim
    )?.value;

    if (wrappedStyle) {
      return wrappedStyle;
    }
  }

  return directStyle;
}

function getMatrixEnvironmentForStyle(style, fallbackEnvironmentName = "bmatrix") {
  const option = MATRIX_STYLE_BY_VALUE.get(style);

  if (option) {
    return option.environmentName;
  }

  const fallbackOption = MATRIX_STYLE_BY_ENVIRONMENT.get(fallbackEnvironmentName);
  return fallbackOption?.environmentName ?? "bmatrix";
}

function getCommandStyle(type, commandName) {
  if (type !== "matrix") {
    return null;
  }

  return MATRIX_STYLE_BY_COMMAND.get(commandName)?.value ?? "brackets";
}

function getMathArrayReplacementTarget(environment, definition) {
  if (definition.type === "matrix" && environment?.parent?.type === "leftright") {
    return environment.parent;
  }

  return environment;
}

function getCellOffsetRange(model, environment, rowIndex, columnIndex) {
  const cell = environment?.getCell?.(rowIndex, columnIndex);

  if (!Array.isArray(cell) || cell.length === 0) {
    return null;
  }

  const start = model.offsetOf(cell[0]);
  const end = model.offsetOf(cell[cell.length - 1]);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return [start, end];
}

function getCellLatex(model, environment, rowIndex, columnIndex) {
  const offsetRange = getCellOffsetRange(model, environment, rowIndex, columnIndex);

  if (!offsetRange) {
    return "\\placeholder{}";
  }

  return normalizeCellLatex(model.getValue(offsetRange[0], offsetRange[1], "latex-expanded"));
}

function unionRects(left, right) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  const top = Math.min(left.top, right.top);
  const rightEdge = Math.max(left.right, right.right);
  const bottom = Math.max(left.bottom, right.bottom);
  const leftEdge = Math.min(left.left, right.left);

  return {
    top,
    right: rightEdge,
    bottom,
    left: leftEdge,
    width: rightEdge - leftEdge,
    height: bottom - top,
  };
}

function getAncestorScrollOffset(element) {
  let top = 0;
  let left = 0;
  let current = element?.parentElement ?? null;

  while (current) {
    top += current.scrollTop ?? 0;
    left += current.scrollLeft ?? 0;
    current = current.parentElement;
  }

  return { top, left };
}

export function toMathFieldClientRect(mathField, rect) {
  if (!rect || !mathField?.getBoundingClientRect) {
    return null;
  }

  const mathFieldClientRect = mathField.getBoundingClientRect();

  if (!Number.isFinite(mathFieldClientRect.top) || !Number.isFinite(mathFieldClientRect.left)) {
    return null;
  }

  const scrollOffset = getAncestorScrollOffset(mathField);
  // MathLive bounds stay in document/layout space when an ancestor scroller moves.
  // Subtract the accumulated ancestor scroll to get a viewport client rect.
  const deltaTop = -scrollOffset.top;
  const deltaLeft = -scrollOffset.left;

  return {
    top: rect.top + deltaTop,
    right: rect.right + deltaLeft,
    bottom: rect.bottom + deltaTop,
    left: rect.left + deltaLeft,
    width: rect.width,
    height: rect.height,
  };
}

function getCellRect(mathField, model, environment, rowIndex, columnIndex) {
  const offsetRange = getCellOffsetRange(model, environment, rowIndex, columnIndex);

  if (!offsetRange) {
    return null;
  }

  let rect = null;

  for (let offset = offsetRange[0]; offset <= offsetRange[1]; offset += 1) {
    const bounds = mathField.getElementInfo(offset)?.bounds;

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      continue;
    }

    rect = unionRects(rect, {
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      left: bounds.left,
      width: bounds.width,
      height: bounds.height,
    });
  }

  return rect;
}

function getEnvironmentSelectionRange(model, environment) {
  if (!model || !environment) {
    return null;
  }

  const leftSibling = environment.leftSibling;
  const end = model.offsetOf(environment);

  if (!Number.isFinite(end)) {
    return null;
  }

  if (leftSibling) {
    const start = model.offsetOf(leftSibling);

    if (Number.isFinite(start)) {
      return [start, end];
    }
  }

  const start = model.offsetOf(environment.firstChild ?? environment);
  return Number.isFinite(start) ? [start, end] : null;
}

function isCollapsedSelectionWithinEnvironment(model, environment) {
  if (!model?.selectionIsCollapsed) {
    return false;
  }

  const selectionRange = getEnvironmentSelectionRange(model, environment);

  if (!Array.isArray(selectionRange) || selectionRange.length !== 2) {
    return false;
  }

  const [start, end] = selectionRange;
  return model.position >= start && model.position < end;
}

function buildItemSettings(definition, environment) {
  const settings = {
    rowCount: normalizeCount(environment.rowCount, definition.defaultRows),
  };

  if (hasSettingsField(definition, "columnCount")) {
    settings.columnCount = normalizeCount(environment.colCount, definition.defaultColumns, {
      min: 1,
      max: 12,
    });
  }

  if (hasSettingsField(definition, "style")) {
    settings.style = getMatrixStyleForContext(environment);
  }

  return settings;
}

function buildRowsFromEnvironment(model, environment, rowCount, columnCount) {
  return Array.from({ length: rowCount }, (_unused, rowIndex) =>
    Array.from({ length: columnCount }, (_unusedColumn, columnIndex) =>
      rowIndex < environment.rowCount && columnIndex < environment.colCount
        ? getCellLatex(model, environment, rowIndex, columnIndex)
        : "\\placeholder{}"
    )
  );
}

function getActiveMathArrayContext(mathField, { expectedType = null } = {}) {
  const model = mathField?._mathfield?.model;
  const environment = getActiveMathArrayEnvironment(model);
  const definition = getMathArrayStructureDefinitionForEnvironment(environment);

  if (!model || !environment || !definition) {
    return null;
  }

  if (expectedType && definition.type !== expectedType) {
    return null;
  }

  return {
    model,
    environment,
    definition,
  };
}

export function getMathArrayStructureDefinitions() {
  return MATH_ARRAY_STRUCTURE_DEFINITIONS;
}

export function getMathArrayCommandItems() {
  return MATH_ARRAY_STRUCTURE_DEFINITIONS.flatMap(
    (definition) => definition.commandItems ?? []
  );
}

export function getMathArrayStructureDefinitionByType(type) {
  return MATH_ARRAY_STRUCTURES_BY_TYPE.get(type) ?? null;
}

export function getMathArrayStructureDefinitionForEnvironment(atomOrEnvironmentName) {
  const environmentName =
    typeof atomOrEnvironmentName === "string"
      ? atomOrEnvironmentName
      : atomOrEnvironmentName?.environmentName;

  return environmentName
    ? MATH_ARRAY_STRUCTURES_BY_ENVIRONMENT.get(environmentName) ?? null
    : null;
}

export function getMathArrayStructureDefinitionForCommand(commandName) {
  return commandName ? MATH_ARRAY_STRUCTURES_BY_COMMAND.get(commandName) ?? null : null;
}

export function isMathArrayEnvironment(atom) {
  return Boolean(atom && atom.type === "array" && getMathArrayStructureDefinitionForEnvironment(atom));
}

function getMathArrayEnvironmentFromAtom(atom) {
  let current = atom ?? null;

  while (current && !isMathArrayEnvironment(current)) {
    current = current.parent ?? null;
  }

  return isMathArrayEnvironment(current) ? current : null;
}

function normalizeModelOffset(model, offset) {
  const maxOffset = Number.isFinite(model?.lastOffset) ? model.lastOffset : 0;
  const normalizedOffset = Number(offset);

  if (!Number.isFinite(normalizedOffset)) {
    return null;
  }

  return clamp(Math.trunc(normalizedOffset), 0, maxOffset);
}

function pushOffsetCandidate(candidates, seen, model, offset) {
  const normalizedOffset = normalizeModelOffset(model, offset);

  if (normalizedOffset == null || seen.has(normalizedOffset)) {
    return;
  }

  seen.add(normalizedOffset);
  candidates.push(normalizedOffset);
}

function getMathArraySelectionOffsetCandidates(model) {
  if (!model) {
    return [];
  }

  const candidates = [];
  const seen = new Set();
  const selectionRanges = Array.isArray(model.selection?.ranges) ? model.selection.ranges : [];

  pushOffsetCandidate(candidates, seen, model, model.position);

  if (model.selectionIsCollapsed) {
    pushOffsetCandidate(candidates, seen, model, model.position + 1);
    return candidates;
  }

  pushOffsetCandidate(candidates, seen, model, model.position + 1);

  for (const range of selectionRanges) {
    if (!Array.isArray(range) || range.length !== 2) {
      continue;
    }

    const [start, end] = range;

    pushOffsetCandidate(candidates, seen, model, start);
    pushOffsetCandidate(candidates, seen, model, end);
    pushOffsetCandidate(candidates, seen, model, start + 1);

    if (end > start) {
      pushOffsetCandidate(candidates, seen, model, end - 1);
    }
  }

  return candidates;
}

function getMathArrayEnvironmentAtOffset(model, offset) {
  const normalizedOffset = normalizeModelOffset(model, offset);

  if (normalizedOffset == null) {
    return null;
  }

  return getMathArrayEnvironmentFromAtom(model.at(normalizedOffset));
}

function isMathArrayCellIndex(environment, value) {
  return Array.isArray(value)
    && value.length === 2
    && Number.isInteger(value[0])
    && Number.isInteger(value[1])
    && value[0] >= 0
    && value[1] >= 0
    && value[0] < (environment?.rowCount ?? 0)
    && value[1] < (environment?.colCount ?? 0);
}

function getActiveMathArrayCell(model, environment) {
  if (!model || !environment) {
    return null;
  }

  if (isMathArrayCellIndex(environment, model.parentCell)) {
    return model.parentCell;
  }

  if (model.selectionIsCollapsed && !isCollapsedSelectionWithinEnvironment(model, environment)) {
    return null;
  }

  for (const offset of getMathArraySelectionOffsetCandidates(model)) {
    const cell = typeof model.getParentCell === "function"
      ? model.getParentCell(offset)
      : null;

    if (isMathArrayCellIndex(environment, cell)) {
      return cell;
    }
  }

  return null;
}

export function getActiveMathArrayEnvironment(model) {
  const currentEnvironment = model?.parentEnvironment;

  if (isMathArrayEnvironment(currentEnvironment)) {
    return currentEnvironment;
  }

  for (const offset of getMathArraySelectionOffsetCandidates(model)) {
    const environment = getMathArrayEnvironmentAtOffset(model, offset);

    if (!environment) {
      continue;
    }

    if (model?.selectionIsCollapsed && !isCollapsedSelectionWithinEnvironment(model, environment)) {
      continue;
    }

    return environment;
  }

  return null;
}

export function normalizeMathArraySettings(type, settings, fallbackSettings = {}) {
  const definition = getMathArrayStructureDefinitionByType(type);

  if (!definition) {
    return null;
  }

  const normalizedSettings = {
    rowCount: normalizeCount(
      settings?.rowCount,
      fallbackSettings?.rowCount ?? definition.defaultRows
    ),
  };

  if (hasSettingsField(definition, "columnCount")) {
    normalizedSettings.columnCount = normalizeCount(
      settings?.columnCount,
      fallbackSettings?.columnCount ?? definition.defaultColumns,
      {
        min: 1,
        max: 12,
      }
    );
  }

  if (hasSettingsField(definition, "style")) {
    normalizedSettings.style = normalizeMatrixStyle(
      settings?.style,
      fallbackSettings?.style ?? definition.defaultStyle
    );
  }

  return normalizedSettings;
}

export function buildMathArrayLatex(type, rows, { environmentName = null, style = null } = {}) {
  const definition = getMathArrayStructureDefinitionByType(type);

  if (!definition) {
    return "";
  }

  let normalizedEnvironmentName = environmentName;

  if (definition.type === "matrix") {
    const normalizedStyle = normalizeMatrixStyle(style, getMatrixStyleForContext({ environmentName }));
    const styleOption = MATRIX_STYLE_BY_VALUE.get(normalizedStyle);
    normalizedEnvironmentName = getMatrixEnvironmentForStyle(
      normalizedStyle,
      environmentName ?? definition.defaultStyle
    );
    const rowLatex = rows.map((cells) =>
      cells.map((cellLatex) => normalizeCellLatex(cellLatex)).join(" & ")
    );
    const matrixLatex = `\\begin{${normalizedEnvironmentName}}\n${rowLatex.join(" \\\\\n")}\n\\end{${normalizedEnvironmentName}}`;

    if (styleOption?.wrapper) {
      return `\\left${styleOption.wrapper.leftDelim}\n${matrixLatex}\n\\right${styleOption.wrapper.rightDelim}`;
    }

    return matrixLatex;
  } else if (!definition.environmentNames.includes(normalizedEnvironmentName)) {
    normalizedEnvironmentName = definition.environmentNames[0];
  }

  const rowLatex = rows.map((cells) =>
    cells.map((cellLatex) => normalizeCellLatex(cellLatex)).join(" & ")
  );

  return `\\begin{${normalizedEnvironmentName}}\n${rowLatex.join(" \\\\\n")}\n\\end{${normalizedEnvironmentName}}`;
}

export function buildMathArrayTemplate(type, { commandName = null, style = null } = {}) {
  const definition = getMathArrayStructureDefinitionByType(type);

  if (!definition) {
    return "";
  }

  const rows = Array.from({ length: definition.defaultRows }, () =>
    Array.from({ length: definition.defaultColumns }, () => "\\placeholder{}")
  );

  return buildMathArrayLatex(type, rows, {
    style: style ?? getCommandStyle(type, commandName) ?? definition.defaultStyle,
  });
}

export function createMathArrayExtension(type) {
  const definition = getMathArrayStructureDefinitionByType(type);

  if (!definition) {
    return null;
  }

  return {
    name: definition.type,
    commands: definition.commandItems ?? [],
    matches(latex) {
      const commandName = String(latex ?? "").trim().replace(/^\\/, "");
      return definition.commandNames.includes(commandName);
    },
    matchesName(commandName) {
      return definition.commandNames.includes(String(commandName ?? "").trim());
    },
    expand(_mathField, context) {
      const commandName = String(context.latex ?? "").trim().replace(/^\\/, "");
      return context.replaceWithTemplate(
        buildMathArrayTemplate(definition.type, { commandName })
      );
    },
    expandByName(_mathField, commandName, context) {
      return context.replaceWithTemplate(
        buildMathArrayTemplate(definition.type, { commandName })
      );
    },
  };
}

export function getActiveMathArrayItemState(mathField, { mathId = null, pos = null } = {}) {
  const context = getActiveMathArrayContext(mathField);

  if (!context) {
    return null;
  }

  const { model, environment, definition } = context;
  const [rowIndex = 0, columnIndex = 0] = getActiveMathArrayCell(model, environment) ?? [0, 0];
  const normalizedRowIndex = clamp(rowIndex, 0, Math.max(0, environment.rowCount - 1));
  const normalizedColumnIndex = clamp(columnIndex, 0, Math.max(0, environment.colCount - 1));

  return {
    type: definition.type,
    source: "math-structure",
    mathId,
    pos,
    settings: buildItemSettings(definition, environment),
    anchorRowIndex: normalizedRowIndex,
    anchorColumnIndex: normalizedColumnIndex,
    anchorRange:
      getCellOffsetRange(model, environment, normalizedRowIndex, normalizedColumnIndex) ?? null,
    environmentRange: getEnvironmentSelectionRange(model, environment) ?? null,
  };
}

export function getMathArrayEnvironmentRect(mathField, expectedType = null) {
  const context = getActiveMathArrayContext(mathField, { expectedType });

  if (!context) {
    return null;
  }

  const { model, environment } = context;
  let rect = null;

  for (let rowIndex = 0; rowIndex < environment.rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < environment.colCount; columnIndex += 1) {
      rect = unionRects(rect, getCellRect(mathField, model, environment, rowIndex, columnIndex));
    }
  }

  return toMathFieldClientRect(mathField, rect);
}

export function selectMathArrayCell(mathField, rowIndex, columnIndex, direction = "forward") {
  const context = getActiveMathArrayContext(mathField);

  if (!context) {
    return false;
  }

  const { model, environment } = context;
  const offsetRange = getCellOffsetRange(model, environment, rowIndex, columnIndex);

  if (!offsetRange) {
    return false;
  }

  mathField.selection = {
    ranges: [offsetRange],
    direction,
  };
  mathField.focus({ preventScroll: true });
  return true;
}

export function getMathArrayTabAction(mathField, direction) {
  const context = getActiveMathArrayContext(mathField);
  const currentCell = context?.model?.parentCell;

  if (!context || !Array.isArray(currentCell)) {
    return { type: "none" };
  }

  const { environment } = context;
  const [row, column] = currentCell;
  const rowCount = environment.rowCount;
  const columnCount = environment.colCount;

  if (
    typeof row !== "number" ||
    typeof column !== "number" ||
    typeof rowCount !== "number" ||
    typeof columnCount !== "number" ||
    rowCount < 1 ||
    columnCount < 1
  ) {
    return { type: "none" };
  }

  const currentIndex = row * columnCount + column;
  const targetIndex = direction === "forward" ? currentIndex + 1 : currentIndex - 1;

  if (targetIndex < 0 || targetIndex >= rowCount * columnCount) {
    return {
      type: direction === "forward" ? "handoff-after" : "handoff-before",
    };
  }

  return {
    type: "move",
    rowIndex: Math.floor(targetIndex / columnCount),
    columnIndex: targetIndex % columnCount,
  };
}

export function resizeActiveMathArrayEnvironment(
  mathField,
  settings,
  {
    expectedType = null,
    anchorRowIndex = 0,
    anchorColumnIndex = 0,
  } = {}
) {
  const context = getActiveMathArrayContext(mathField, { expectedType });

  if (!context) {
    return false;
  }

  const { model, environment, definition } = context;
  const currentSettings = buildItemSettings(definition, environment);
  const nextSettings = normalizeMathArraySettings(definition.type, settings, currentSettings);

  if (!nextSettings) {
    return false;
  }

  const nextRowCount = nextSettings.rowCount;
  const nextColumnCount = nextSettings.columnCount ?? environment.colCount ?? definition.defaultColumns;
  const nextStyle = nextSettings.style ?? currentSettings.style ?? definition.defaultStyle ?? null;

  if (
    nextRowCount === currentSettings.rowCount &&
    nextColumnCount === (currentSettings.columnCount ?? environment.colCount) &&
    nextStyle === (currentSettings.style ?? null)
  ) {
    return selectMathArrayCell(
      mathField,
      clamp(anchorRowIndex, 0, nextRowCount - 1),
      clamp(anchorColumnIndex, 0, nextColumnCount - 1)
    );
  }

  const rows = buildRowsFromEnvironment(model, environment, nextRowCount, nextColumnCount);
  const selectionRange = getEnvironmentSelectionRange(
    model,
    getMathArrayReplacementTarget(environment, definition)
  );

  if (!selectionRange) {
    return false;
  }

  mathField.selection = {
    ranges: [selectionRange],
    direction: "forward",
  };

  const didReplace = mathField.insert(
    buildMathArrayLatex(definition.type, rows, {
      environmentName: environment.environmentName,
      style: nextStyle,
    }),
    {
      format: "latex",
      insertionMode: "replaceSelection",
      selectionMode: "placeholder",
    }
  );

  if (!didReplace) {
    return false;
  }

  return selectMathArrayCell(
    mathField,
    clamp(anchorRowIndex, 0, nextRowCount - 1),
    clamp(anchorColumnIndex, 0, nextColumnCount - 1)
  );
}

export function deleteActiveMathArrayEnvironment(
  mathField,
  {
    expectedType = null,
  } = {}
) {
  const context = getActiveMathArrayContext(mathField, { expectedType });

  if (!context) {
    return false;
  }

  const { model, environment, definition } = context;
  const selectionRange = getEnvironmentSelectionRange(
    model,
    getMathArrayReplacementTarget(environment, definition)
  );

  if (!selectionRange) {
    return false;
  }

  mathField.selection = {
    ranges: [selectionRange],
    direction: "forward",
  };

  return mathField.executeCommand("deleteBackward");
}
