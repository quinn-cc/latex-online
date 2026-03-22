import {
  expandMathExtensionByName,
  expandMatchingMathExtension,
  getMathExtensionSuggestions,
  isMathExtensionAcceptKey,
} from "./registry.js";

const MATHFIELD_OVERRIDE_STYLE_ID = "latex-online-math-overrides";

const MATHFIELD_OVERRIDE_CSS = `
.ML__focused .ML__placeholder.ML__selected,
.ML__focused .ML__selected .ML__placeholder {
  background: var(--_selection-background-color);
  color: var(--_selection-color);
  border-radius: 0.2em;
  opacity: 1;
}
`;

function installMathfieldOverrides(mathField) {
  const shadowRoot = mathField.shadowRoot;

  if (!shadowRoot || shadowRoot.getElementById(MATHFIELD_OVERRIDE_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = MATHFIELD_OVERRIDE_STYLE_ID;
  style.textContent = MATHFIELD_OVERRIDE_CSS;
  shadowRoot.append(style);
}

export function applyMathExtensions(mathField) {
  installMathfieldOverrides(mathField);
}

export function shouldHandleMathExtensionAcceptKey(event) {
  return isMathExtensionAcceptKey(event);
}

export function expandMathExtensionCommand(mathField) {
  return expandMatchingMathExtension(mathField);
}

export function getMathExtensionMenuState(mathField) {
  return getMathExtensionSuggestions(mathField);
}

export function expandMathExtensionMenuCommand(mathField, commandName) {
  return expandMathExtensionByName(mathField, commandName);
}

export function getSerializableMathLatex(mathField) {
  try {
    return mathField.getValue("latex-expanded");
  } catch (_error) {
    return mathField.getValue();
  }
}
