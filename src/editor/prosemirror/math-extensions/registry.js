import { createCasesMathExtension } from "./cases.js";
import {
  applyBuiltinMathCommand,
  getBuiltinMathCommandSuggestions,
} from "./builtin-commands.js";
import { createMatrixMathExtension } from "./matrix.js";

const MATH_EXTENSIONS = Object.freeze([
  createCasesMathExtension(),
  createMatrixMathExtension(),
]);

const MATH_EXTENSION_ACCEPT_KEYS = new Set(["Enter", "Tab", " ", "Spacebar"]);

function getActiveMathCommandQuery(query) {
  const normalized = String(query ?? "").trim();

  if (!normalized.includes("\\")) {
    return null;
  }

  const commandStart = normalized.lastIndexOf("\\");
  const suffix = normalized.slice(commandStart + 1);

  if (!/^[A-Za-z*]*$/.test(suffix)) {
    return null;
  }

  return {
    normalized,
    commandStart,
    nameQuery: suffix,
  };
}

function scoreMathExtensionMatch(item, query) {
  const normalizedQuery = String(query ?? "").toLowerCase();

  if (!normalizedQuery) {
    return 0;
  }

  const normalizedName = String(item.name ?? "").toLowerCase();

  if (normalizedName === normalizedQuery) {
    return 3;
  }

  if (normalizedName.startsWith(normalizedQuery)) {
    return 2;
  }

  if (normalizedName.includes(normalizedQuery)) {
    return 1;
  }

  return -1;
}

function getActiveLatexGroupInfo(mathField) {
  const internalMathfield = mathField._mathfield;
  const model = internalMathfield?.model;

  if (!model || model.mode !== "latex") {
    return null;
  }

  const latexGroup = model.atoms.find((atom) => atom.type === "latexgroup");

  if (!latexGroup || !Array.isArray(latexGroup.body)) {
    return null;
  }

  const latex = latexGroup.body
    .filter((atom) => atom.type === "latex" && !atom.isSuggestion)
    .map((atom) => atom.value)
    .join("");

  return {
    latex,
    latexGroup,
    model,
  };
}

function replaceActiveLatexGroupWithTemplate(mathField, template) {
  const didClearLatexGroup = mathField.executeCommand(["complete", "reject"]);

  if (!didClearLatexGroup) {
    return false;
  }

  return mathField.insert(template, {
    format: "latex",
    mode: "math",
    selectionMode: "placeholder",
  });
}

function expandMathExtension(mathField, extension, commandName, activeLatexGroup) {
  if (!extension) {
    return false;
  }

  const context = {
    ...activeLatexGroup,
    replaceWithTemplate(template) {
      return replaceActiveLatexGroupWithTemplate(mathField, template);
    },
  };

  if (typeof extension.expandByName === "function" && commandName) {
    return extension.expandByName(mathField, commandName, context);
  }

  return extension.expand(mathField, context);
}

function getCustomMathExtensionSuggestions(query) {
  return MATH_EXTENSIONS
    .flatMap((extension) => extension.commands ?? [])
    .map((item) => ({
      ...item,
      score: scoreMathExtensionMatch(item, query),
    }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.name.localeCompare(right.name);
    })
    .map(({ score: _score, ...item }) => item);
}

function mergeMathSuggestionItems(...groups) {
  const mergedItems = [];
  const seenNames = new Set();

  for (const group of groups) {
    for (const item of group ?? []) {
      if (!item?.name || seenNames.has(item.name)) {
        continue;
      }

      seenNames.add(item.name);
      mergedItems.push(item);
    }
  }

  return mergedItems;
}

export function isMathExtensionAcceptKey(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
    return false;
  }

  return MATH_EXTENSION_ACCEPT_KEYS.has(event.key);
}

export function expandMatchingMathExtension(mathField) {
  const activeLatexGroup = getActiveLatexGroupInfo(mathField);

  if (!activeLatexGroup) {
    return false;
  }

  const extension = MATH_EXTENSIONS.find((candidate) =>
    candidate.matches(activeLatexGroup.latex)
  );

  if (!extension) {
    return false;
  }

  return expandMathExtension(
    mathField,
    extension,
    activeLatexGroup.latex,
    activeLatexGroup
  );
}

export function getMathExtensionSuggestions(mathField) {
  const activeLatexGroup = getActiveLatexGroupInfo(mathField);

  if (!activeLatexGroup) {
    return null;
  }

  const activeQuery = getActiveMathCommandQuery(activeLatexGroup.latex);

  if (!activeQuery) {
    return null;
  }

  const customItems = getCustomMathExtensionSuggestions(activeQuery.nameQuery);
  const builtinItems = getBuiltinMathCommandSuggestions(activeQuery.nameQuery);
  const items = mergeMathSuggestionItems(customItems, builtinItems).slice(0, 14);

  if (items.length === 0) {
    return null;
  }

  return {
    source: "math",
    query: activeQuery.nameQuery,
    sessionKey: String(activeQuery.commandStart),
    items,
  };
}

export function expandMathExtensionByName(mathField, commandName) {
  const activeLatexGroup = getActiveLatexGroupInfo(mathField);

  if (!activeLatexGroup) {
    return false;
  }

  const extension = MATH_EXTENSIONS.find((candidate) =>
    typeof candidate.matchesName === "function" &&
      candidate.matchesName(commandName)
  );

  if (extension) {
    return expandMathExtension(
      mathField,
      extension,
      commandName,
      activeLatexGroup
    );
  }

  return applyBuiltinMathCommand(mathField, commandName);
}
