import { buildFullLineWidgetInsertion } from "../transforms/full-line-widgets.js";
import { getWidgetDefinition } from "../widget-registry.js";

export function createFullLineWidgetCommand({
  schema,
  name,
  title,
  description,
  allowedParentTypes,
  createBlockNode,
  getSelectionTarget,
}) {
  return {
    name,
    title,
    description,
    widgetKind: getWidgetDefinition(name)?.widgetKind ?? "full-line",
    execute({ state, match, controller }) {
      return buildFullLineWidgetInsertion({
        state,
        match,
        allowedParentTypes,
        widgetType: name,
        schema,
        createBlockNode: ({ state: currentState, match: currentMatch, paragraphNode }) =>
          createBlockNode({
            state: currentState,
            match: currentMatch,
            controller,
            paragraphNode,
          }),
        getSelectionTarget,
      });
    },
  };
}
