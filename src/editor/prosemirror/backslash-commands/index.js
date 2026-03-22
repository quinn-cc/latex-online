import { TextSelection } from "prosemirror-state";
import { createAlignCommand } from "./align.js";
import { createGatherCommand } from "./gather.js";
import { createDisplayMathCommand, createInlineMathCommand } from "./math.js";
import { createTableCommand } from "./table.js";

function paragraphContainsOnlyText(paragraphNode) {
  let textOnly = true;

  paragraphNode.forEach((child) => {
    if (!child.isText) {
      textOnly = false;
      return false;
    }

    return true;
  });

  return textOnly;
}

export function createBackslashCommandRegistry(schema) {
  const commands = [
    createInlineMathCommand(schema),
    createDisplayMathCommand(schema),
    createTableCommand(schema),
    createAlignCommand(schema),
    createGatherCommand(schema),
  ];
  const commandsByName = new Map(commands.map((command) => [command.name, command]));

  return {
    commands,
    commandsByName,
  };
}

function scoreCommandMatch(command, query) {
  if (!query) {
    return 0;
  }

  const normalizedQuery = query.toLowerCase();
  const normalizedName = command.name.toLowerCase();

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

function getActiveBackslashSuffix(text) {
  const normalizedText = String(text ?? "").trim();

  if (!normalizedText.includes("\\")) {
    return null;
  }

  const commandStart = normalizedText.lastIndexOf("\\");
  const suffix = normalizedText.slice(commandStart + 1);

  if (!/^[A-Za-z]*$/.test(suffix)) {
    return null;
  }

  return {
    normalizedText,
    commandStart,
    nameQuery: suffix.toLowerCase(),
  };
}

export function getBackslashCommandQuery(state) {
  if (!(state.selection instanceof TextSelection) || !state.selection.empty) {
    return null;
  }

  const { $from } = state.selection;

  if ($from.parent.type !== state.schema.nodes.paragraph) {
    return null;
  }

  const paragraphNode = $from.parent;

  if (!paragraphContainsOnlyText(paragraphNode)) {
    return null;
  }

  const paragraphPos = $from.before();
  const fullText = paragraphNode.textContent;
  const beforeText = fullText.slice(0, $from.parentOffset);
  const afterText = fullText.slice($from.parentOffset);
  const activeSuffix = getActiveBackslashSuffix(beforeText);

  if (!activeSuffix || afterText.trim() !== "") {
    return null;
  }

  return {
    nameQuery: activeSuffix.nameQuery,
    commandStart: activeSuffix.commandStart,
    fullText,
    beforeText,
    afterText,
    paragraphNode,
    paragraphPos,
    parentNode: $from.node($from.depth - 1),
    parentIndex: $from.index($from.depth - 1),
  };
}

export function getExecutableBackslashCommandMatch(state, registry) {
  const query = getBackslashCommandQuery(state);

  if (!query || !query.nameQuery) {
    return null;
  }

  if (query.fullText.trim() !== `\\${query.nameQuery}`) {
    return null;
  }

  const command = registry.commandsByName.get(query.nameQuery);

  if (!command) {
    return null;
  }

  return {
    command,
    query,
  };
}

export function getBackslashCommandSuggestions(state, registry) {
  const query = getBackslashCommandQuery(state);

  if (!query) {
    return null;
  }

  const items = registry.commands
    .map((command) => ({
      command,
      score: scoreCommandMatch(command, query.nameQuery),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.command.name.localeCompare(right.command.name);
    })
    .map(({ command }) => ({
      name: command.name,
      title: command.title,
      description: command.description,
    }));

  if (items.length === 0) {
    return null;
  }

  return {
    source: "text",
    query: query.nameQuery,
    sessionKey: `${query.paragraphPos}:${query.commandStart}`,
    items,
    queryData: query,
  };
}
