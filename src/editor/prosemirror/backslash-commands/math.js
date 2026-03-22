import { createGatherCommand } from "./gather.js";

function getCommandTextRange(match) {
  const commandText = `\\${match.nameQuery}`;
  const from = match.paragraphPos + 1 + match.commandStart;
  return {
    from,
    to: from + commandText.length,
  };
}

export function createInlineMathCommand(schema) {
  return {
    name: "inline",
    title: "Inline Math",
    description: "Insert inline math",
    execute({ state, match, controller }) {
      const paragraphNode = match.paragraphNode;

      if (!paragraphNode) {
        return null;
      }

      const { from, to } = getCommandTextRange(match);
      const tr = controller.buildInlineMathInsertionTransaction(state, from, to, "");
      const inlineNode = tr.doc.nodeAt(from);

      return {
        tr,
        focusMathId: inlineNode?.attrs?.id ?? null,
        focusMathEdge: "start",
      };
    },
  };
}

export function createDisplayMathCommand(schema) {
  const gatherCommand = createGatherCommand(schema);

  return {
    name: "display",
    title: "Display Math",
    description: "Insert display math",
    execute(context) {
      return gatherCommand.execute(context);
    },
  };
}
