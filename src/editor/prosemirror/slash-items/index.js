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
  getAlignItemAtPos,
  getAlignContextAtPos,
  getGatherContextAtPos,
  getGatherItemAtPos,
  isFullLineWidgetNode,
  getSlashWidgetTypeFromNode,
  getTableAnchorIndices,
  getTableContext,
  getTableItemAtPos,
} from "./context.js";

const SLASH_ITEM_CATEGORY_WIDGET = "widget";
const SLASH_ITEM_CATEGORY_MATH_WIDGET = "math-widget";

function resolveMathStructureItem(controller, item) {
  const mathView = item?.mathId ? controller.getMathView(item.mathId) : null;

  return mathView?.resolveSettingsItemState?.(item) ?? null;
}

function hasFocusedEditorSettingsContext(controller) {
  return controller.view?.hasFocus?.() === true;
}

function hasFocusedMathSettingsContext(controller, mathTarget, mathView) {
  if (!mathTarget || !mathView) {
    return false;
  }

  return mathView.hasSettingsInteractionFocus?.() === true;
}

const mathArraySlashItemDefinitions = getMathArrayStructureDefinitions().map((definition) => [
  definition.type,
  {
    category: SLASH_ITEM_CATEGORY_MATH_WIDGET,
    type: definition.type,
    title: definition.title,
    fields: definition.settingsFields,
    update(controller, item, settings) {
      return controller.updateMathArraySettings(
        item,
        normalizeMathArraySettings(definition.type, settings, item?.settings)
      );
    },
    resolve(controller, item) {
      const resolvedItem = resolveMathStructureItem(controller, item);

      return resolvedItem?.type === definition.type ? resolvedItem : null;
    },
  },
]);

const slashItemDefinitions = new Map([
  ...mathArraySlashItemDefinitions,
  [
    "table",
    {
      category: SLASH_ITEM_CATEGORY_WIDGET,
      type: "table",
      title: "Table",
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
      resolve(controller, item) {
        return getTableItemAtPos(controller.view.state.doc, item?.pos);
      },
    },
  ],
  [
    "align",
    {
      category: SLASH_ITEM_CATEGORY_WIDGET,
      type: "align",
      title: "Align",
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
      resolve(controller, item) {
        return getAlignItemAtPos(controller.view.state.doc, item?.pos);
      },
    },
  ],
  [
    "gather",
    {
      category: SLASH_ITEM_CATEGORY_WIDGET,
      type: "gather",
      title: "Gather",
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
      resolve(controller, item) {
        return getGatherItemAtPos(controller.view.state.doc, item?.pos);
      },
    },
  ],
]);

export function getSlashItemDefinition(type) {
  return slashItemDefinitions.get(type) ?? null;
}

function withSlashItemMetadata(item) {
  if (!item) {
    return null;
  }

  const definition = getSlashItemDefinition(item.type);

  if (!definition) {
    return item;
  }

  return {
    ...item,
    category: item.category ?? definition.category ?? SLASH_ITEM_CATEGORY_WIDGET,
  };
}

function getSlashItemCategory(item) {
  return withSlashItemMetadata(item)?.category ?? SLASH_ITEM_CATEGORY_WIDGET;
}

export function getActiveSlashItemState(controller) {
  const mathTarget = controller.getSettingsMathTarget?.() ?? null;
  const activeMathView = mathTarget ? controller.getMathView(mathTarget.id) : null;

  if (hasFocusedMathSettingsContext(controller, mathTarget, activeMathView)) {
    const activeMathStructureItem = activeMathView?.getActiveSettingsItemState?.({
      requireFocus: false,
    }) ?? null;

    if (activeMathStructureItem) {
      return withSlashItemMetadata(activeMathStructureItem);
    }

    if (mathTarget?.node?.type === editorSchema.nodes.align_math) {
      return withSlashItemMetadata(getActiveAlignItem(controller.view.state, mathTarget.pos));
    }

    if (mathTarget?.node?.type === editorSchema.nodes.gather_math) {
      return withSlashItemMetadata(getActiveGatherItem(controller.view.state, mathTarget.pos));
    }
  }

  if (!hasFocusedEditorSettingsContext(controller)) {
    return null;
  }

  return withSlashItemMetadata(
    getActiveGatherItem(controller.view.state) ??
    getActiveAlignItem(controller.view.state) ??
    getActiveTableItem(controller.view.state)
  );
}

export function updateSlashItemSettings(controller, item, settings) {
  const resolvedItem = resolveSlashItemState(controller, item) ?? withSlashItemMetadata(item);
  const definition = getSlashItemDefinition(resolvedItem?.type ?? item?.type);

  controller.beginSlashItemStateHandoff?.(resolvedItem);
  return definition?.update?.(controller, resolvedItem, settings) ?? false;
}

export function canDeleteSlashItem(controller, item) {
  const resolvedItem = resolveSlashItemState(controller, item) ?? withSlashItemMetadata(item);
  const category = getSlashItemCategory(resolvedItem);

  if (category === SLASH_ITEM_CATEGORY_MATH_WIDGET) {
    return controller.canDeleteMathStructureItem?.(resolvedItem) ?? false;
  }

  return Number.isFinite(resolvedItem?.pos)
    && controller.getWidgetContextAtPos?.(resolvedItem.pos) != null;
}

export function deleteSlashItem(controller, item) {
  const resolvedItem = resolveSlashItemState(controller, item) ?? withSlashItemMetadata(item);

  if (getSlashItemCategory(resolvedItem) === SLASH_ITEM_CATEGORY_MATH_WIDGET) {
    return controller.deleteMathStructureItem?.(resolvedItem) ?? false;
  }

  if (!Number.isFinite(resolvedItem?.pos)) {
    return false;
  }

  return controller.deleteWidgetAt(resolvedItem.pos, {
    trigger: "slash-item",
    debugType: "controller.deleteSlashItem",
    debugDetail: {
      slashItemType: resolvedItem?.type ?? item?.type ?? null,
      slashItemSource: resolvedItem?.source ?? item?.source ?? null,
      slashItemPos: resolvedItem.pos,
    },
  });
}

export function resolveSlashItemState(controller, item) {
  const definition = getSlashItemDefinition(item?.type);

  return withSlashItemMetadata(definition?.resolve?.(controller, item) ?? null);
}

export {
  getAlignContextAtPos,
  getGatherContextAtPos,
  isFullLineWidgetNode,
  getSlashWidgetTypeFromNode,
  getTableAnchorIndices,
  getTableContext,
};
