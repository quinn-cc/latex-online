export const DEFAULT_VIEW_MODE = "single";

const VIEW_MODE_VALUES = new Set([
  "single",
  "book",
]);

export function normalizeViewMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return VIEW_MODE_VALUES.has(normalized) ? normalized : DEFAULT_VIEW_MODE;
}

export function applyViewMode(viewMode, { rootElement } = {}) {
  const normalized = normalizeViewMode(viewMode);

  if (rootElement instanceof HTMLElement) {
    rootElement.dataset.viewMode = normalized;
  }

  return normalized;
}
