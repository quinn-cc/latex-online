import { TextSelection } from "prosemirror-state";
import { createAlignCommand } from "./align.js";
import { createGatherCommand } from "./gather.js";
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
  const queryMatch = /^\\([A-Za-z]*)$/.exec(beforeText.trim());

  if (!queryMatch || afterText.trim() !== "") {
    return null;
  }

  return {
    nameQuery: queryMatch[1].toLowerCase(),
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
