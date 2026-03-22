export const STORAGE_KEY = "latex-online-document";
export const BUILD_SIGNATURE_KEY = "latex-online-build-signature";
export const LAST_SAVE_TIME_KEY = "latex-online-last-save-time";
export const PAGE_ZOOM_STORAGE_KEY = "latex-online-page-zoom";
export const VIEW_MODE_STORAGE_KEY = "latex-online-view-mode";
export const CURRENT_DOCUMENT_STORAGE_KEY = "latex-online-current-document";
export const STORAGE_FORMAT_VERSION = 3;
export const DEFAULT_LATEX_FILENAME = "document.tex";
export const DEFAULT_DOCUMENT_TITLE = "Untitled document";
export const LEGACY_STORAGE_KEYS = [
  "latex-online-document-v2",
  "latex-online-document-v3",
];
export const PAGE_WIDTH = 8.5 * 96;
export const BOOK_SPREAD_GAP = 0.4 * 96;
export const DEFAULT_PAGE_ZOOM = 1;
export const MIN_PAGE_ZOOM = 0.7;
export const MAX_PAGE_ZOOM = 2.4;
export const PAGE_ZOOM_STEP = 0.1;
export const TEXT_LINE_SPACING_OPTIONS = [
  { value: "1", amount: 1 },
  { value: "1.15", amount: 1.15 },
  { value: "1.5", amount: 1.5 },
  { value: "1.6", amount: 1.6 },
  { value: "2", amount: 2 },
];
export const TEXT_LINE_SPACING_OPTIONS_BY_VALUE = new Map(
  TEXT_LINE_SPACING_OPTIONS.map((option) => [option.value, option])
);
export const TEXT_PARAGRAPH_SPACING_OPTIONS = [
  { value: "0", amount: 0 },
  { value: "0.5", amount: 0.5 },
  { value: "1", amount: 1 },
  { value: "1.5", amount: 1.5 },
];
export const TEXT_PARAGRAPH_SPACING_OPTIONS_BY_VALUE = new Map(
  TEXT_PARAGRAPH_SPACING_OPTIONS.map((option) => [option.value, option])
);
export const TEXT_LIST_TYPE_OPTIONS = [
  { value: "none", label: "Plain text" },
  { value: "bullet", label: "Bullets" },
  { value: "decimal-period", label: "1. 2. 3." },
  { value: "decimal-paren", label: "1) 2) 3)" },
  { value: "decimal-wrapped", label: "(1) (2) (3)" },
  { value: "alpha-period", label: "a. b. c." },
  { value: "alpha-paren", label: "a) b) c)" },
  { value: "alpha-wrapped", label: "(a) (b) (c)" },
  { value: "roman-period", label: "i. ii. iii." },
  { value: "roman-paren", label: "i) ii) iii)" },
  { value: "roman-wrapped", label: "(i) (ii) (iii)" },
];
export const TEXT_LIST_TYPE_VALUES = new Set(
  TEXT_LIST_TYPE_OPTIONS.map((option) => option.value)
);
export const TEXT_FONT_OPTIONS = [
  {
    value: "paper-serif",
    execValue: "Palatino Linotype",
    matchers: ["iowan old style", "palatino linotype", "book antiqua"],
  },
  {
    value: "georgia",
    execValue: "Georgia",
    matchers: ["georgia"],
  },
  {
    value: "times-new-roman",
    execValue: "Times New Roman",
    matchers: ["times new roman", "times"],
  },
  {
    value: "avenir-next",
    execValue: "Avenir Next",
    matchers: ["avenir next", "avenir"],
  },
  {
    value: "trebuchet-ms",
    execValue: "Trebuchet MS",
    matchers: ["trebuchet ms"],
  },
  {
    value: "courier-new",
    execValue: "Courier New",
    matchers: ["courier new", "courier"],
  },
];
export const TEXT_FONT_OPTIONS_BY_VALUE = new Map(
  TEXT_FONT_OPTIONS.map((option) => [option.value, option])
);
export const TEXT_FONT_SIZE_OPTIONS = [
  { value: "1", pt: 11 },
  { value: "2", pt: 12 },
  { value: "3", pt: 14 },
  { value: "4", pt: 16 },
  { value: "5", pt: 18 },
  { value: "6", pt: 20 },
  { value: "7", pt: 24 },
];
export const TEXT_FONT_SIZE_OPTIONS_BY_VALUE = new Map(
  TEXT_FONT_SIZE_OPTIONS.map((option) => [option.value, option])
);
export const DEFAULT_TEXT_TOOLBAR_STATE = {
  bold: false,
  italic: false,
  underline: false,
  listType: "none",
  alignment: "left",
  lineSpacing: "1.15",
  paragraphSpacing: "0",
  fontFamily: "paper-serif",
  fontSize: "1",
};
export const DEFAULT_MATH_STYLE = {
  fontFamily: "none",
  fontSize: "1",
};
export const MATH_FONT_FAMILY_VALUES = new Set([
  "none",
  "roman",
  "sans-serif",
  "monospace",
]);
export const MATH_FONT_SIZE_VALUES = new Set([
  "0.8",
  "0.9",
  "1",
  "1.1",
  "1.25",
  "1.4",
  "1.6",
  "1.85",
]);
export const MATH_FONT_FAMILY_VARIABLES = {
  none: null,
  roman: "KaTeX_Main",
  "sans-serif": "KaTeX_SansSerif",
  monospace: "KaTeX_Typewriter",
};
