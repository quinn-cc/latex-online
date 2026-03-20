export const editor = document.getElementById("paper-editor");
export const saveStatus = document.getElementById("save-status");
export const clearPageButton = document.getElementById("clear-page");
export const paperColumn = document.getElementById("paper-column");
export const fileMenu = document.getElementById("file-menu");
export const fileSaveButton = document.getElementById("file-save");
export const filePrintButton = document.getElementById("file-print");
export const editMenu = document.getElementById("edit-menu");
export const editPageSettingsButton = document.getElementById("edit-page-settings");
export const bookViewToggleButton = document.getElementById("toggle-book-view");
export const pageSettingsDialog = document.getElementById("page-settings-dialog");
export const pageSettingsForm = document.getElementById("page-settings-form");
export const pageSettingsCancelButton = document.getElementById("page-settings-cancel");
export const pageHeaderInput = document.getElementById("page-header-input");
export const pageFooterInput = document.getElementById("page-footer-input");
export const pageNumberingSelect = document.getElementById("page-numbering-select");
export const pageColumnsSelect = document.getElementById("page-columns-select");
export const pageColumnGapInput = document.getElementById("page-column-gap-input");
export const pageMarginTopInput = document.getElementById("page-margin-top-input");
export const pageMarginRightInput = document.getElementById("page-margin-right-input");
export const pageMarginBottomInput = document.getElementById("page-margin-bottom-input");
export const pageMarginLeftInput = document.getElementById("page-margin-left-input");
export const zoomOutButton = document.getElementById("zoom-out");
export const zoomInButton = document.getElementById("zoom-in");
export const zoomResetButton = document.getElementById("zoom-reset");
export const zoomLevel = document.getElementById("zoom-level");
export const debugDock = document.getElementById("debug-dock");
export const debugState = document.getElementById("debug-state");
export const debugLog = document.getElementById("debug-log");
export const debugCopyButton = document.getElementById("debug-copy");
export const debugClearButton = document.getElementById("debug-clear");
export const formatButtons = Array.from(
  document.querySelectorAll(".format-button[data-format]")
);
export const formatButtonsByCommand = new Map(
  formatButtons.map((button) => [button.dataset.format, button])
);
export const alignmentButtons = Array.from(
  document.querySelectorAll(".alignment-button")
);
export const alignmentButtonsByValue = new Map(
  alignmentButtons.map((button) => [button.dataset.align, button])
);
export const textFontFamilySelect = document.getElementById("text-font-family");
export const textFontSizeSelect = document.getElementById("text-font-size");
export const textLineSpacingSelect = document.getElementById("text-line-spacing");
export const textParagraphSpacingSelect = document.getElementById(
  "text-paragraph-spacing"
);
export const mathFontFamilySelect = document.getElementById("math-font-family");
export const mathFontSizeSelect = document.getElementById("math-font-size");
