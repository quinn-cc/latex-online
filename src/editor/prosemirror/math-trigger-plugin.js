import { Plugin, TextSelection } from "prosemirror-state";

const MATH_TRIGGER_ARTIFACT_CHARS = new Set([
  "\u00a0",
  "\u200b",
  "\ufeff",
]);

function findLiteralMathTriggerRange(state) {
  const { selection } = state;

  if (!(selection instanceof TextSelection) || !selection.empty) {
    return null;
  }

  const { $from } = selection;

  if (!$from.parent.isTextblock) {
    return null;
  }

  const blockStart = $from.start();
  let cursorPos = selection.from;
  let sawDollar = false;

  while (cursorPos > blockStart) {
    const char = state.doc.textBetween(cursorPos - 1, cursorPos, "", "");

    if (!char) {
      break;
    }

    if (!sawDollar) {
      if (char !== "$") {
        return null;
      }

      sawDollar = true;
      cursorPos -= 1;
      continue;
    }

    if (!MATH_TRIGGER_ARTIFACT_CHARS.has(char)) {
      break;
    }

    cursorPos -= 1;
  }

  if (!sawDollar) {
    return null;
  }

  return {
    from: cursorPos,
    to: selection.from,
  };
}

export function createMathTriggerPlugin({ convertLiteralMathTrigger, debug }) {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const triggerRange = findLiteralMathTriggerRange(newState);

      if (!triggerRange) {
        return null;
      }

      debug?.("plugin.mathTrigger.detected", {
        triggerRange,
        selection: {
          from: newState.selection.from,
          to: newState.selection.to,
        },
      });

      return convertLiteralMathTrigger(newState, triggerRange);
    },
  });
}
