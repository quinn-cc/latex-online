import { MATHLIVE_COMMAND_CATALOG } from "./mathlive-command-catalog.js";

const BUILTIN_COMMAND_NAMES = new Set(MATHLIVE_COMMAND_CATALOG);

const POPULAR_COMMAND_ORDER = Object.freeze([
  "frac",
  "sqrt",
  "sum",
  "prod",
  "int",
  "lim",
  "alpha",
  "beta",
  "gamma",
  "theta",
  "lambda",
  "pi",
  "sigma",
  "phi",
  "infty",
  "leq",
  "geq",
  "neq",
  "approx",
  "rightarrow",
  "leftarrow",
  "leftrightarrow",
  "mapsto",
  "sin",
  "cos",
  "tan",
  "log",
  "ln",
  "text",
  "mathrm",
  "mathbf",
  "mathbb",
  "mathcal",
]);

const POPULAR_COMMAND_RANK = new Map(
  POPULAR_COMMAND_ORDER.map((name, index) => [name, POPULAR_COMMAND_ORDER.length - index])
);

const COMMAND_TITLE_OVERRIDES = Object.freeze({
  alpha: "Greek alpha",
  beta: "Greek beta",
  gamma: "Greek gamma",
  theta: "Greek theta",
  lambda: "Greek lambda",
  pi: "Greek pi",
  sigma: "Greek sigma",
  phi: "Greek phi",
  frac: "Fraction",
  sqrt: "Square root",
  sum: "Summation",
  prod: "Product",
  int: "Integral",
  lim: "Limit",
  infty: "Infinity",
  leq: "Less than or equal",
  geq: "Greater than or equal",
  neq: "Not equal",
  approx: "Approximately equal",
  leftarrow: "Left arrow",
  rightarrow: "Right arrow",
  leftrightarrow: "Left-right arrow",
  mapsto: "Maps to",
  sin: "Sine",
  cos: "Cosine",
  tan: "Tangent",
  log: "Logarithm",
  ln: "Natural log",
  text: "Text",
  mathrm: "Roman math text",
  mathbb: "Blackboard bold",
  mathcal: "Calligraphic",
  mathbf: "Bold math text",
});

function getPopularRank(name) {
  return POPULAR_COMMAND_RANK.get(name) ?? 0;
}

function getBuiltinQueryInfo(query) {
  const normalizedQuery = String(query ?? "").trim();
  return {
    raw: normalizedQuery,
    bare: normalizedQuery.startsWith("\\")
      ? normalizedQuery.slice(1)
      : normalizedQuery,
  };
}

function humanizeCommandName(name) {
  if (COMMAND_TITLE_OVERRIDES[name]) {
    return COMMAND_TITLE_OVERRIDES[name];
  }

  return name
    .replace(/\*/g, " *")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function scoreBuiltinCommand(name, queryInfo) {
  const { bare } = queryInfo;
  const popularity = getPopularRank(name);

  if (!bare) {
    return popularity > 0 ? 1000 + popularity : -1;
  }

  if (name === bare) {
    return 4000 + popularity;
  }

  if (name.startsWith(bare)) {
    return 3000 + popularity;
  }

  return -1;
}

export function getBuiltinMathCommandSuggestions(query, { limit = 14 } = {}) {
  const queryInfo = getBuiltinQueryInfo(query);
  const items = MATHLIVE_COMMAND_CATALOG.map((name) => ({
    name,
    score: scoreBuiltinCommand(name, queryInfo),
  }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.name.length !== right.name.length) {
        return left.name.length - right.name.length;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, limit)
    .map(({ name }) => ({
      name,
      title: humanizeCommandName(name),
      description: "Math command",
    }));

  return items.length > 0 ? items : [];
}

function clearActiveLatexGroup(mathField) {
  return mathField.executeCommand(["complete", "reject"]);
}

export function isBuiltinMathCommandName(commandName) {
  return BUILTIN_COMMAND_NAMES.has(commandName);
}

export function applyBuiltinMathCommand(mathField, commandName) {
  if (!isBuiltinMathCommandName(commandName)) {
    return false;
  }

  if (!clearActiveLatexGroup(mathField)) {
    return false;
  }

  return mathField.insert(`\\${commandName}`, {
    format: "latex",
    mode: "math",
    selectionMode: "placeholder",
  });
}
