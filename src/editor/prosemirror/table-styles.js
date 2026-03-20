export const DEFAULT_TABLE_STYLE = "grid";

export const TABLE_STYLE_OPTIONS = [
  { value: "grid", label: "Full grid" },
  { value: "inner-dividers", label: "Inner dividers" },
  { value: "header-rule", label: "Header divider" },
  { value: "rows-only", label: "Row dividers" },
  { value: "columns-only", label: "Column dividers" },
  { value: "borderless", label: "Borderless" },
];

const validTableStyles = new Set(TABLE_STYLE_OPTIONS.map((option) => option.value));

export function normalizeTableStyle(value) {
  const normalizedValue = String(value ?? "").trim().toLowerCase();
  return validTableStyles.has(normalizedValue)
    ? normalizedValue
    : DEFAULT_TABLE_STYLE;
}
