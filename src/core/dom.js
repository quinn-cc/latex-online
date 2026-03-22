export const editor = document.getElementById("paper-editor");
export const saveStatus = document.getElementById("save-status");
export const clearPageButton = document.getElementById("clear-page");
export const paperColumn = document.getElementById("paper-column");
export const fileMenu = document.getElementById("file-menu");
export const fileNewDocumentButton = document.getElementById("file-new-document");
export const fileOpenDocumentButton = document.getElementById("file-open-document");
export const fileSaveDocumentButton = document.getElementById("file-save-document");
export const fileAccountButton = document.getElementById("file-account");
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
export const accountDialog = document.getElementById("account-dialog");
export const accountForm = document.getElementById("account-form");
export const accountCloseButton = document.getElementById("account-close");
export const accountStatus = document.getElementById("account-status");
export const accountSignInButton = document.getElementById("account-sign-in");
export const accountRegisterButton = document.getElementById("account-register");
export const accountSignOutButton = document.getElementById("account-sign-out");
export const accountUsernameInput = document.getElementById("account-username");
export const accountPasswordInput = document.getElementById("account-password");
export const documentsDialog = document.getElementById("documents-dialog");
export const documentsForm = document.getElementById("documents-form");
export const documentsCloseButton = document.getElementById("documents-close");
export const documentsStatus = document.getElementById("documents-status");
export const documentsRefreshButton = document.getElementById("documents-refresh");
export const newDocumentTitleInput = document.getElementById("new-document-title");
export const createDocumentButton = document.getElementById("create-document");
export const documentList = document.getElementById("document-list");
export const documentHome = document.getElementById("document-home");
export const documentHomeStatus = document.getElementById("document-home-status");
export const documentHomeAccountButton = document.getElementById(
  "document-home-account-button"
);
export const documentHomeDocumentsStatus = document.getElementById(
  "document-home-documents-status"
);
export const documentHomeRefreshButton = document.getElementById(
  "document-home-refresh"
);
export const documentHomeNewDocumentTitleInput = document.getElementById(
  "document-home-new-document-title"
);
export const documentHomeCreateDocumentButton = document.getElementById(
  "document-home-create-document"
);
export const documentHomeDocumentList = document.getElementById(
  "document-home-document-list"
);
export const zoomOutButton = document.getElementById("zoom-out");
export const zoomInButton = document.getElementById("zoom-in");
export const zoomResetButton = document.getElementById("zoom-reset");
export const zoomLevel = document.getElementById("zoom-level");
export const documentStatus = document.getElementById("document-status");
export const cloudStatus = document.getElementById("cloud-status");
export const backslashMenu = document.getElementById("backslash-menu");
export const backslashMenuQuery = document.getElementById("backslash-menu-query");
export const backslashMenuList = document.getElementById("backslash-menu-list");
export const slashItemSettings = document.getElementById("slash-item-settings");
export const slashItemSettingsToggleButton = document.getElementById(
  "slash-item-settings-toggle"
);
export const slashItemSettingsPanel = document.getElementById(
  "slash-item-settings-panel"
);
export const slashItemSettingsTitle = document.getElementById(
  "slash-item-settings-title"
);
export const slashItemSettingsCloseButton = document.getElementById(
  "slash-item-settings-close"
);
export const slashItemSettingsForm = document.getElementById(
  "slash-item-settings-form"
);
export const slashItemSettingsFields = document.getElementById(
  "slash-item-settings-fields"
);
export const slashItemSettingsDeleteButton = document.getElementById(
  "slash-item-settings-delete"
);
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
export const textListTypeSelect = document.getElementById("text-list-type");
export const textLineSpacingSelect = document.getElementById("text-line-spacing");
export const textParagraphSpacingSelect = document.getElementById(
  "text-paragraph-spacing"
);
export const mathFontFamilySelect = document.getElementById("math-font-family");
export const mathFontSizeSelect = document.getElementById("math-font-size");
