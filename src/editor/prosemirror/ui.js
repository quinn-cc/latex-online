import {
  DEFAULT_MATH_STYLE,
  DEFAULT_TEXT_TOOLBAR_STATE,
  PAGE_ZOOM_STEP,
} from "../../core/config.js";
import {
  alignmentButtons,
  alignmentButtonsByValue,
  bookViewToggleButton,
  clearPageButton,
  editMenu,
  editPageSettingsButton,
  fileMenu,
  filePrintButton,
  fileSaveButton,
  formatButtons,
  formatButtonsByCommand,
  mathFontFamilySelect,
  mathFontSizeSelect,
  pageColumnsSelect,
  pageColumnGapInput,
  pageFooterInput,
  pageHeaderInput,
  pageMarginBottomInput,
  pageMarginLeftInput,
  pageMarginRightInput,
  pageMarginTopInput,
  pageNumberingSelect,
  pageSettingsCancelButton,
  pageSettingsDialog,
  pageSettingsForm,
  textFontFamilySelect,
  textFontSizeSelect,
  textLineSpacingSelect,
  textParagraphSpacingSelect,
  zoomInButton,
  zoomOutButton,
  zoomResetButton,
} from "../../core/dom.js";

function setPressed(button, value) {
  button.setAttribute("aria-pressed", value ? "true" : "false");
}

function setSelectValue(select, value, fallbackValue) {
  select.value = value;

  if (select.value !== value) {
    select.value = fallbackValue;
  }
}

function focusControllerSoon(controller) {
  requestAnimationFrame(() => {
    controller.focus();
  });
}

function syncPageSettingsDialog(pageSettings) {
  pageHeaderInput.value = pageSettings.headerText;
  pageFooterInput.value = pageSettings.footerText;
  pageNumberingSelect.value = pageSettings.pageNumbering;
  pageColumnsSelect.value = pageSettings.columnCount;
  pageColumnGapInput.value = pageSettings.columnGap;
  pageMarginTopInput.value = pageSettings.marginTop;
  pageMarginRightInput.value = pageSettings.marginRight;
  pageMarginBottomInput.value = pageSettings.marginBottom;
  pageMarginLeftInput.value = pageSettings.marginLeft;
}

function submitPageSettings(applyPageSettings) {
  applyPageSettings?.({
    headerText: pageHeaderInput.value,
    footerText: pageFooterInput.value,
    pageNumbering: pageNumberingSelect.value,
    columnCount: pageColumnsSelect.value,
    columnGap: pageColumnGapInput.value,
    marginTop: pageMarginTopInput.value,
    marginRight: pageMarginRightInput.value,
    marginBottom: pageMarginBottomInput.value,
    marginLeft: pageMarginLeftInput.value,
  });

  pageSettingsDialog?.close();
}

export function renderToolbarState(uiState) {
  const textState = uiState?.text ?? DEFAULT_TEXT_TOOLBAR_STATE;
  const mathState = uiState?.math ?? DEFAULT_MATH_STYLE;

  for (const [command, button] of formatButtonsByCommand) {
    setPressed(button, Boolean(textState[command]));
  }

  for (const [alignment, button] of alignmentButtonsByValue) {
    setPressed(button, textState.alignment === alignment);
  }

  setSelectValue(
    textFontFamilySelect,
    textState.fontFamily,
    DEFAULT_TEXT_TOOLBAR_STATE.fontFamily
  );
  setSelectValue(
    textFontSizeSelect,
    textState.fontSize,
    DEFAULT_TEXT_TOOLBAR_STATE.fontSize
  );
  setSelectValue(
    textLineSpacingSelect,
    textState.lineSpacing,
    DEFAULT_TEXT_TOOLBAR_STATE.lineSpacing
  );
  setSelectValue(
    textParagraphSpacingSelect,
    textState.paragraphSpacing,
    DEFAULT_TEXT_TOOLBAR_STATE.paragraphSpacing
  );
  setSelectValue(
    mathFontFamilySelect,
    mathState.fontFamily,
    DEFAULT_MATH_STYLE.fontFamily
  );
  setSelectValue(
    mathFontSizeSelect,
    mathState.fontSize,
    DEFAULT_MATH_STYLE.fontSize
  );
}

export function renderViewModeUi(viewMode) {
  if (!bookViewToggleButton) {
    return;
  }

  const isBookMode = viewMode === "book";
  bookViewToggleButton.setAttribute("aria-pressed", isBookMode ? "true" : "false");
  bookViewToggleButton.textContent = isBookMode ? "Single view" : "Book view";
}

export function bindEditorUi({
  controller,
  zoomController,
  saveLatexFile,
  printDocument,
  getPageSettings,
  getViewMode,
  setViewMode,
  applyPageSettings,
}) {
  document.addEventListener("keydown", (event) => {
    zoomController.handleZoomShortcut(event);
  });

  fileSaveButton?.addEventListener("click", () => {
    saveLatexFile?.();

    if (fileMenu) {
      fileMenu.open = false;
    }

    focusControllerSoon(controller);
  });

  filePrintButton?.addEventListener("click", () => {
    if (fileMenu) {
      fileMenu.open = false;
    }

    printDocument?.();
    focusControllerSoon(controller);
  });

  bookViewToggleButton?.addEventListener("click", () => {
    const nextViewMode = getViewMode?.() === "book" ? "single" : "book";
    setViewMode?.(nextViewMode);
    focusControllerSoon(controller);
  });

  editPageSettingsButton?.addEventListener("click", () => {
    if (fileMenu) {
      fileMenu.open = false;
    }

    if (editMenu) {
      editMenu.open = false;
    }

    const pageSettings = getPageSettings?.();
    if (pageSettings) {
      syncPageSettingsDialog(pageSettings);
    }

    if (pageSettingsDialog && !pageSettingsDialog.open) {
      pageSettingsDialog.showModal();
    }
  });

  pageSettingsDialog?.addEventListener("close", () => {
    focusControllerSoon(controller);
  });

  pageSettingsCancelButton?.addEventListener("click", () => {
    pageSettingsDialog?.close();
  });

  pageSettingsForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPageSettings(applyPageSettings);
  });

  clearPageButton.addEventListener("click", () => {
    controller.clear();
    controller.focus();
  });

  zoomOutButton.addEventListener("click", () => {
    zoomController.changePageZoom(-PAGE_ZOOM_STEP);
  });
  zoomInButton.addEventListener("click", () => {
    zoomController.changePageZoom(PAGE_ZOOM_STEP);
  });
  zoomResetButton.addEventListener("click", () => {
    zoomController.resetPageZoom();
  });

  for (const button of formatButtons) {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    const command = button.dataset.format;

    if (!command) {
      continue;
    }

    button.addEventListener("click", () => {
      controller.toggleTextMark(command);
      focusControllerSoon(controller);
    });
  }

  for (const button of alignmentButtons) {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      controller.setTextAlignment(button.dataset.align);
      focusControllerSoon(controller);
    });
  }

  textFontFamilySelect.addEventListener("change", () => {
    controller.setTextFontFamily(textFontFamilySelect.value);
    focusControllerSoon(controller);
  });
  textFontSizeSelect.addEventListener("change", () => {
    controller.setTextFontSize(textFontSizeSelect.value);
    focusControllerSoon(controller);
  });
  textLineSpacingSelect.addEventListener("change", () => {
    controller.setLineSpacing(textLineSpacingSelect.value);
    focusControllerSoon(controller);
  });
  textParagraphSpacingSelect.addEventListener("change", () => {
    controller.setParagraphSpacing(textParagraphSpacingSelect.value);
    focusControllerSoon(controller);
  });
  mathFontFamilySelect.addEventListener("change", () => {
    controller.setMathFontFamily(mathFontFamilySelect.value);
    focusControllerSoon(controller);
  });
  mathFontSizeSelect.addEventListener("change", () => {
    controller.setMathFontSize(mathFontSizeSelect.value);
    focusControllerSoon(controller);
  });
}
