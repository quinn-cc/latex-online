import {
  DEFAULT_MATH_STYLE,
  DEFAULT_TEXT_TOOLBAR_STATE,
  MATH_FONT_FAMILY_VALUES,
  MATH_FONT_SIZE_VALUES,
  TEXT_FONT_OPTIONS,
  TEXT_FONT_OPTIONS_BY_VALUE,
  TEXT_FONT_SIZE_OPTIONS,
  TEXT_FONT_SIZE_OPTIONS_BY_VALUE,
  TEXT_LINE_SPACING_OPTIONS_BY_VALUE,
  TEXT_PARAGRAPH_SPACING_OPTIONS_BY_VALUE,
} from "../../core/config.js";

export {
  DEFAULT_MATH_STYLE,
  DEFAULT_TEXT_TOOLBAR_STATE,
  TEXT_FONT_OPTIONS,
  TEXT_FONT_SIZE_OPTIONS,
};

export function normalizeTextFontFamily(value) {
  return TEXT_FONT_OPTIONS_BY_VALUE.has(value)
    ? value
    : DEFAULT_TEXT_TOOLBAR_STATE.fontFamily;
}

export function normalizeTextFontSize(value) {
  return TEXT_FONT_SIZE_OPTIONS_BY_VALUE.has(value)
    ? value
    : DEFAULT_TEXT_TOOLBAR_STATE.fontSize;
}

export function normalizeTextAlignment(value) {
  switch (String(value ?? "").toLowerCase()) {
    case "center":
      return "center";
    case "right":
      return "right";
    case "justify":
      return "justify";
    default:
      return DEFAULT_TEXT_TOOLBAR_STATE.alignment;
  }
}

export function normalizeLineSpacing(value) {
  return TEXT_LINE_SPACING_OPTIONS_BY_VALUE.has(value)
    ? value
    : DEFAULT_TEXT_TOOLBAR_STATE.lineSpacing;
}

export function normalizeParagraphSpacing(value) {
  return TEXT_PARAGRAPH_SPACING_OPTIONS_BY_VALUE.has(value)
    ? value
    : DEFAULT_TEXT_TOOLBAR_STATE.paragraphSpacing;
}

export function normalizeMathFontFamily(value) {
  return MATH_FONT_FAMILY_VALUES.has(value)
    ? value
    : DEFAULT_MATH_STYLE.fontFamily;
}

export function normalizeMathFontSize(value) {
  return MATH_FONT_SIZE_VALUES.has(value)
    ? value
    : DEFAULT_MATH_STYLE.fontSize;
}

export function getTextFontFamilyOption(value) {
  return TEXT_FONT_OPTIONS_BY_VALUE.get(normalizeTextFontFamily(value)) ?? null;
}

export function getTextFontFamilyCssValue(value) {
  return getTextFontFamilyOption(value)?.execValue ?? null;
}

export function getTextFontSizePx(value) {
  const pointSize = TEXT_FONT_SIZE_OPTIONS_BY_VALUE.get(normalizeTextFontSize(value))?.pt
    ?? TEXT_FONT_SIZE_OPTIONS_BY_VALUE.get(DEFAULT_TEXT_TOOLBAR_STATE.fontSize)?.pt
    ?? 11;

  return (pointSize * 96) / 72;
}

export function createDefaultTextToolbarState() {
  return { ...DEFAULT_TEXT_TOOLBAR_STATE };
}

export function createDefaultMathStyle() {
  return { ...DEFAULT_MATH_STYLE };
}
