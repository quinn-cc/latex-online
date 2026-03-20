const PAGE_NUMBERING_VALUES = new Set([
  "none",
  "header-right",
  "footer-center",
  "footer-right",
]);

const PAGE_COLUMN_VALUES = new Set(["1", "2", "3"]);
const DEFAULT_MARGIN = "1";
const DEFAULT_COLUMN_GAP = "0.58";
const MIN_MARGIN = 0.25;
const MAX_MARGIN = 3;
const MIN_COLUMN_GAP = 0.1;
const MAX_COLUMN_GAP = 2;

export const DEFAULT_PAGE_SETTINGS = {
  headerText: "",
  footerText: "",
  pageNumbering: "none",
  columnCount: "1",
  columnGap: DEFAULT_COLUMN_GAP,
  marginTop: DEFAULT_MARGIN,
  marginRight: DEFAULT_MARGIN,
  marginBottom: DEFAULT_MARGIN,
  marginLeft: DEFAULT_MARGIN,
};

export function createDefaultPageSettings() {
  return { ...DEFAULT_PAGE_SETTINGS };
}

function normalizePageText(value) {
  return String(value ?? "").replace(/\s*\n+\s*/g, " ").trim();
}

function normalizeMarginValue(value) {
  const parsedValue = Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(parsedValue)) {
    return DEFAULT_MARGIN;
  }

  const clampedValue = Math.min(MAX_MARGIN, Math.max(MIN_MARGIN, parsedValue));
  const roundedValue = Math.round(clampedValue * 100) / 100;

  return roundedValue.toString().replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function normalizeColumnGapValue(value) {
  const parsedValue = Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(parsedValue)) {
    return DEFAULT_COLUMN_GAP;
  }

  const clampedValue = Math.min(MAX_COLUMN_GAP, Math.max(MIN_COLUMN_GAP, parsedValue));
  const roundedValue = Math.round(clampedValue * 100) / 100;

  return roundedValue.toString().replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

export function normalizePageSettings(value = {}) {
  return {
    headerText: normalizePageText(value.headerText),
    footerText: normalizePageText(value.footerText),
    pageNumbering: PAGE_NUMBERING_VALUES.has(value.pageNumbering)
      ? value.pageNumbering
      : DEFAULT_PAGE_SETTINGS.pageNumbering,
    columnCount: PAGE_COLUMN_VALUES.has(String(value.columnCount))
      ? String(value.columnCount)
      : DEFAULT_PAGE_SETTINGS.columnCount,
    columnGap: normalizeColumnGapValue(value.columnGap),
    marginTop: normalizeMarginValue(value.marginTop),
    marginRight: normalizeMarginValue(value.marginRight),
    marginBottom: normalizeMarginValue(value.marginBottom),
    marginLeft: normalizeMarginValue(value.marginLeft),
  };
}

function getPageElementRefs(pageShell) {
  if (!(pageShell instanceof HTMLElement)) {
    return null;
  }

  return {
    pageShell,
    pageSurface: pageShell.querySelector("[data-page-surface]"),
    pageHeader: pageShell.querySelector("[data-page-header]"),
    pageHeaderText: pageShell.querySelector("[data-page-header-text]"),
    pageHeaderRightNumber: pageShell.querySelector("[data-page-header-right-number]"),
    pageFooter: pageShell.querySelector("[data-page-footer]"),
    pageFooterText: pageShell.querySelector("[data-page-footer-text]"),
    pageFooterCenterNumber: pageShell.querySelector("[data-page-footer-center-number]"),
    pageFooterRightNumber: pageShell.querySelector("[data-page-footer-right-number]"),
    pageHint: pageShell.querySelector("[data-page-hint]"),
    pageContent: pageShell.querySelector("[data-page-content]"),
  };
}

export function applyPageSettingsToPageElement(
  pageShell,
  pageSettings,
  pageNumber = 1,
  { showHint = false } = {}
) {
  const refs = getPageElementRefs(pageShell);

  if (!refs?.pageSurface) {
    return;
  }

  const normalized = normalizePageSettings(pageSettings);
  const pageNumberText =
    normalized.pageNumbering === "none" ? "" : String(pageNumber);
  const headerVisible =
    normalized.headerText.length > 0 || normalized.pageNumbering === "header-right";
  const footerVisible =
    normalized.footerText.length > 0 ||
    normalized.pageNumbering === "footer-center" ||
    normalized.pageNumbering === "footer-right";

  refs.pageShell.dataset.pageNumber = String(pageNumber);
  refs.pageSurface.dataset.pageNumber = String(pageNumber);
  refs.pageSurface.dataset.pageNumbering = normalized.pageNumbering;
  refs.pageSurface.dataset.columnCount = normalized.columnCount;
  refs.pageSurface.style.setProperty("--page-column-count", normalized.columnCount);
  refs.pageSurface.style.setProperty("--page-column-gap", `${normalized.columnGap}in`);
  refs.pageSurface.style.setProperty("--page-margin-top", `${normalized.marginTop}in`);
  refs.pageSurface.style.setProperty("--page-margin-right", `${normalized.marginRight}in`);
  refs.pageSurface.style.setProperty("--page-margin-bottom", `${normalized.marginBottom}in`);
  refs.pageSurface.style.setProperty("--page-margin-left", `${normalized.marginLeft}in`);

  if (refs.pageContent instanceof HTMLElement) {
    refs.pageContent.style.setProperty("--page-column-count", normalized.columnCount);
    refs.pageContent.style.setProperty("--page-column-gap", `${normalized.columnGap}in`);
  }

  if (refs.pageHeaderText instanceof HTMLElement) {
    refs.pageHeaderText.textContent = normalized.headerText;
  }

  if (refs.pageFooterText instanceof HTMLElement) {
    refs.pageFooterText.textContent = normalized.footerText;
  }

  if (refs.pageHeaderRightNumber instanceof HTMLElement) {
    refs.pageHeaderRightNumber.textContent =
      normalized.pageNumbering === "header-right" ? pageNumberText : "";
  }

  if (refs.pageFooterCenterNumber instanceof HTMLElement) {
    refs.pageFooterCenterNumber.textContent =
      normalized.pageNumbering === "footer-center" ? pageNumberText : "";
  }

  if (refs.pageFooterRightNumber instanceof HTMLElement) {
    refs.pageFooterRightNumber.textContent =
      normalized.pageNumbering === "footer-right" ? pageNumberText : "";
  }

  if (refs.pageHeader instanceof HTMLElement) {
    refs.pageHeader.hidden = !headerVisible;
  }

  if (refs.pageFooter instanceof HTMLElement) {
    refs.pageFooter.hidden = !footerVisible;
  }

  if (refs.pageHint instanceof HTMLElement) {
    refs.pageHint.hidden = !showHint;
  }
}
