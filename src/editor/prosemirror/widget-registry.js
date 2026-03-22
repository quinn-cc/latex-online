import { editorSchema } from "./schema.js";

const widgetDefinitions = new Map([
  [
    "table",
    {
      type: "table",
      widgetKind: "full-line",
      fullLine: true,
      grid: true,
      hasSettings: true,
    },
  ],
  [
    "align",
    {
      type: "align",
      widgetKind: "full-line",
      fullLine: true,
      grid: true,
      mathBacked: true,
      hasSettings: true,
      removeWhenEmpty: true,
    },
  ],
  [
    "gather",
    {
      type: "gather",
      widgetKind: "full-line",
      fullLine: true,
      grid: true,
      mathBacked: true,
      hasSettings: true,
      removeWhenEmpty: true,
    },
  ],
]);

const widgetTypeByNodeName = new Map([
  [editorSchema.nodes.table.name, "table"],
  [editorSchema.nodes.align_block.name, "align"],
  [editorSchema.nodes.gather_block.name, "gather"],
]);

export function getWidgetDefinition(type) {
  return type ? widgetDefinitions.get(type) ?? null : null;
}

export function getWidgetDefinitionFromNode(node) {
  if (!node) {
    return null;
  }

  const type = widgetTypeByNodeName.get(node.type?.name);
  return getWidgetDefinition(type);
}

export function getWidgetTypeFromNode(node) {
  return getWidgetDefinitionFromNode(node)?.type ?? null;
}

export function isFullLineWidgetType(type) {
  return getWidgetDefinition(type)?.fullLine === true;
}

export function isFullLineWidgetNode(node) {
  return getWidgetDefinitionFromNode(node)?.fullLine === true;
}
