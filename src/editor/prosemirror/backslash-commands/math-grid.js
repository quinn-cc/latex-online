import {
  DEFAULT_MATH_STYLE,
  DEFAULT_TEXT_TOOLBAR_STATE,
} from "../../../core/config.js";
import {
  normalizeMathFontFamily,
  normalizeMathFontSize,
  normalizeTextFontSize,
} from "../options.js";

const mathGridIdCounters = new Map();

export function createMathGridId(prefix) {
  const nextCount = (mathGridIdCounters.get(prefix) ?? 0) + 1;
  mathGridIdCounters.set(prefix, nextCount);
  return `${prefix}-${Date.now().toString(36)}-${nextCount.toString(36)}`;
}

export function createMathGridCellAttrs(prefix, controller, state, attrs = {}) {
  const currentMathStyle = controller?.currentMathStyle ?? DEFAULT_MATH_STYLE;
  const currentTextToolbarState =
    controller?.getCurrentTextToolbarState?.() ?? DEFAULT_TEXT_TOOLBAR_STATE;

  return {
    id: createMathGridId(prefix),
    latex: "",
    fontFamily: normalizeMathFontFamily(currentMathStyle.fontFamily),
    fontSize: normalizeMathFontSize(currentMathStyle.fontSize),
    baseTextFontSize: normalizeTextFontSize(currentTextToolbarState.fontSize),
    ...attrs,
  };
}
