import { normalizeTableStyle, TABLE_STYLE_OPTIONS } from "../table-styles.js";
import {
  getMathArrayStructureDefinitions,
  normalizeMathArraySettings,
} from "../math-extensions/array-structures.js";
import { editorSchema } from "../schema.js";
import {
  getActiveAlignItem,
  getActiveGatherItem,
  getActiveTableItem,
  getAlignContextAtPos,
  getGatherContextAtPos,
  isFullLineWidgetNode,
  getSlashWidgetTypeFromNode,
  getTableAnchorIndices,
  getTableContext,
} from "./context.js";

const mathArraySlashItemDefinitions = getMathArrayStructureDefinitions().map((definition) => [
  definition.type,
  {
    type: definition.type,
    title: definition.title,
    fields: definition.settingsFields,
    update(controller, item, settings) {
      return controller.updateMathArraySettings(
        item,
        normalizeMathArraySettings(definition.type, settings, item?.settings)
      );
    },
  },
]);

const slashItemDefinitions = new Map([
  ...mathArraySlashItemDefinitions,
  [
    "table",
    {
      type: "table",
      title: "Table",
      deleteLabel: "Delete table",
      fields: [
        {
          key: "rowCount",
          label: "Rows",
          type: "number",
          min: 1,
          max: 20,
          step: 1,
        },
        {
          key: "columnCount",
          label: "Columns",
          type: "number",
          min: 1,
          max: 12,
          step: 1,
        },
        {
          key: "tableStyle",
          label: "Style",
          type: "select",
          options: TABLE_STYLE_OPTIONS,
        },
      ],
      update(controller, item, settings) {
        return controller.updateTableSettings(item.pos, {
          ...settings,
          tableStyle: normalizeTableStyle(settings?.tableStyle),
        });
      },
      remove(controller, item) {
        return controller.deleteTableAt(item.pos);
      },
    },
  ],
  [
    "align",
    {
      type: "align",
      title: "Align",
      deleteLabel: "Delete align",
      fields: [
        {
          key: "columnCount",
          label: "Column groups",
          type: "number",
          min: 1,
          max: 6,
          step: 1,
        },
      ],
      update(controller, item, settings) {
        return controller.updateAlignSettings(item.pos, settings);
      },
      remove(controller, item) {
        return controller.deleteAlignAt(item.pos);
      },
    },
  ],
  [
    "gather",
    {
      type: "gather",
      title: "Gather",
      deleteLabel: "Delete gather",
      fields: [
        {
          key: "columnCount",
          label: "Columns",
          type: "number",
          min: 1,
          max: 6,
          step: 1,
        },
      ],
      update(controller, item, settings) {
        return controller.updateGatherSettings(item.pos, settings);
      },
      remove(controller, item) {
        return controller.deleteGatherAt(item.pos);
      },
    },
  ],
]);

export function getSlashItemDefinition(type) {
  return slashItemDefinitions.get(type) ?? null;
}

export function getActiveSlashItemState(controller) {
  const mathTarget = controller.getFocusedOrPendingMathTarget();
  const activeMathView = mathTarget ? controller.getMathView(mathTarget.id) : null;
  const activeMathStructureItem = activeMathView?.getActiveSettingsItemState?.() ?? null;

  if (activeMathStructureItem) {
    return activeMathStructureItem;
  }

  if (mathTarget?.node?.type === editorSchema.nodes.align_math) {
    return getActiveAlignItem(controller.view.state, mathTarget.pos);
  }

  if (mathTarget?.node?.type === editorSchema.nodes.gather_math) {
    return getActiveGatherItem(controller.view.state, mathTarget.pos);
  }

  return (
    getActiveGatherItem(controller.view.state) ??
    getActiveAlignItem(controller.view.state) ??
    getActiveTableItem(controller.view.state)
  );
}

export function updateSlashItemSettings(controller, item, settings) {
  const definition = getSlashItemDefinition(item?.type);

  return definition?.update?.(controller, item, settings) ?? false;
}

export function deleteSlashItem(controller, item) {
  const definition = getSlashItemDefinition(item?.type);

  return definition?.remove?.(controller, item) ?? false;
}

export {
  getAlignContextAtPos,
  getGatherContextAtPos,
  isFullLineWidgetNode,
  getSlashWidgetTypeFromNode,
  getTableAnchorIndices,
  getTableContext,
};
