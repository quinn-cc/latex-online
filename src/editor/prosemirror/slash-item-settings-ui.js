import {
  slashItemSettings,
  slashItemSettingsCloseButton,
  slashItemSettingsDeleteButton,
  slashItemSettingsFields,
  slashItemSettingsForm,
  slashItemSettingsPanel,
  slashItemSettingsTitle,
  slashItemSettingsToggleButton,
} from "../../core/dom.js";
import { getSlashItemDefinition } from "./slash-items/index.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createFieldId(itemType, key) {
  return `slash-item-${itemType}-${key}`;
}

export function bindSlashItemSettingsUi({ controller }) {
  if (
    !slashItemSettings ||
    !slashItemSettingsToggleButton ||
    !slashItemSettingsPanel ||
    !slashItemSettingsFields ||
    !slashItemSettingsForm ||
    !slashItemSettingsDeleteButton ||
    !slashItemSettingsTitle
  ) {
    return {
      render: () => {},
    };
  }

  const overlayHost = document.getElementById("paper-stage") ?? document.body;

  if (slashItemSettings.parentElement !== overlayHost) {
    overlayHost.append(slashItemSettings);
  }

  let activeItem = null;
  let panelOpen = false;
  let overlayFrame = 0;
  let renderedFieldsSignature = null;
  const applyButton = slashItemSettingsForm.querySelector('[type="submit"]');

  const getItemIdentity = (item) => {
    if (!item) {
      return null;
    }

    return [
      item.type ?? "",
      item.source ?? "",
      item.mathId ?? "",
      Number.isFinite(item.pos) ? item.pos : "",
    ].join(":");
  };

  const getFieldsSignature = () => {
    const definition = getSlashItemDefinition(activeItem?.type);

    if (!definition || !activeItem) {
      return null;
    }

    return JSON.stringify({
      type: definition.type,
      fields: definition.fields?.map((field) => ({
        key: field.key,
        type: field.type,
        options: field.options ?? null,
      })),
      settings: activeItem.settings ?? {},
    });
  };

  const resolveValidItem = (item) => {
    if (!item) {
      return null;
    }

    return controller.resolveSlashItemState?.(item) ?? null;
  };

  const stopOverlayTracking = () => {
    if (!overlayFrame) {
      return;
    }

    cancelAnimationFrame(overlayFrame);
    overlayFrame = 0;
  };

  const trackOverlayPosition = () => {
    overlayFrame = 0;

    if (!activeItem) {
      return;
    }

    updateOverlayPosition();
    overlayFrame = requestAnimationFrame(trackOverlayPosition);
  };

  const ensureOverlayTracking = () => {
    if (!activeItem || overlayFrame) {
      return;
    }

    overlayFrame = requestAnimationFrame(trackOverlayPosition);
  };

  const closePanel = () => {
    panelOpen = false;
    render();
  };

  const hideSettingsUi = ({ clearItem = false } = {}) => {
    stopOverlayTracking();
    panelOpen = false;
    renderedFieldsSignature = null;

    if (clearItem) {
      activeItem = null;
    }

    slashItemSettings.hidden = true;
    slashItemSettingsPanel.hidden = true;
  };

  const getOverlayHostMetrics = () => {
    const hostRect = overlayHost.getBoundingClientRect();

    return {
      rect: hostRect,
      scrollTop: overlayHost.scrollTop ?? 0,
      scrollLeft: overlayHost.scrollLeft ?? 0,
      clientWidth: overlayHost.clientWidth ?? window.innerWidth,
      clientHeight: overlayHost.clientHeight ?? window.innerHeight,
    };
  };

  const toOverlaySpaceRect = (rect) => {
    if (!rect) {
      return null;
    }

    const metrics = getOverlayHostMetrics();

    return {
      top: rect.top - metrics.rect.top + metrics.scrollTop,
      right: rect.right - metrics.rect.left + metrics.scrollLeft,
      bottom: rect.bottom - metrics.rect.top + metrics.scrollTop,
      left: rect.left - metrics.rect.left + metrics.scrollLeft,
      width: rect.width,
      height: rect.height,
    };
  };

  const renderFields = () => {
    const definition = getSlashItemDefinition(activeItem?.type);
    const nextFieldsSignature = getFieldsSignature();

    if (
      nextFieldsSignature &&
      renderedFieldsSignature === nextFieldsSignature &&
      slashItemSettingsFields.childElementCount > 0
    ) {
      return;
    }

    slashItemSettingsFields.replaceChildren();
    renderedFieldsSignature = nextFieldsSignature;

    if (!definition || !activeItem) {
      return;
    }

    for (const field of definition.fields) {
      const label = document.createElement("label");
      label.className = "slash-item-settings-field";
      label.htmlFor = createFieldId(definition.type, field.key);

      const labelText = document.createElement("span");
      labelText.className = "slash-item-settings-field-label";
      labelText.textContent = field.label;

      let input;

      if (field.type === "select") {
        input = document.createElement("select");
        input.className = "slash-item-settings-input";
        input.name = field.key;
        input.id = createFieldId(definition.type, field.key);

        for (const option of field.options ?? []) {
          const optionElement = document.createElement("option");
          optionElement.value = option.value;
          optionElement.textContent = option.label;
          input.append(optionElement);
        }

        input.value = String(activeItem.settings?.[field.key] ?? "");
      } else {
        input = document.createElement("input");
        input.id = createFieldId(definition.type, field.key);
        input.className = "slash-item-settings-input";
        input.name = field.key;
        input.type = field.type;
        input.min = String(field.min);
        input.max = String(field.max);
        input.step = String(field.step);
        input.value = String(activeItem.settings?.[field.key] ?? "");
      }

      label.append(labelText, input);
      slashItemSettingsFields.append(label);
    }
  };

  const updateOverlayPosition = () => {
    if (!activeItem) {
      return;
    }

    const resolvedActiveItem = resolveValidItem(activeItem);

    if (!resolvedActiveItem) {
      hideSettingsUi({ clearItem: true });
      return;
    }

    activeItem = resolvedActiveItem;

    const rect = controller.getSlashItemClientRect(activeItem);

    if (!rect) {
      slashItemSettings.hidden = true;
      slashItemSettingsPanel.hidden = true;
      return;
    }

    const overlayRect = toOverlaySpaceRect(rect);

    if (!overlayRect) {
      slashItemSettings.hidden = true;
      slashItemSettingsPanel.hidden = true;
      return;
    }

    slashItemSettings.hidden = false;
    slashItemSettingsPanel.hidden = !panelOpen;
    const toggleSize = 22;
    const gutter = 8;
    const panelWidth = 220;
    const panelHeight = 180;
    const metrics = getOverlayHostMetrics();
    const toggleTop = overlayRect.top;
    const toggleLeft = overlayRect.right + gutter;

    slashItemSettings.style.setProperty("--slash-item-toggle-top", `${toggleTop}px`);
    slashItemSettings.style.setProperty("--slash-item-toggle-left", `${toggleLeft}px`);

    if (!panelOpen) {
      return;
    }

    const panelTop = clamp(
      toggleTop,
      metrics.scrollTop + 6,
      metrics.scrollTop + metrics.clientHeight - panelHeight - 6
    );
    const panelLeft = clamp(
      toggleLeft + toggleSize + gutter,
      metrics.scrollLeft + 6,
      metrics.scrollLeft + metrics.clientWidth - panelWidth - 6
    );

    slashItemSettings.style.setProperty("--slash-item-panel-top", `${panelTop}px`);
    slashItemSettings.style.setProperty("--slash-item-panel-left", `${panelLeft}px`);
  };

  const render = () => {
    const definition = getSlashItemDefinition(activeItem?.type);

    if (!activeItem || !definition) {
      controller.debugLog?.("slashItemSettings.render.hidden", {
        activeItem,
        panelOpen,
      });
      hideSettingsUi({ clearItem: true });
      return;
    }

    controller.debugLog?.("slashItemSettings.render", {
      activeItem,
      panelOpen,
    });
    slashItemSettingsTitle.textContent = definition.title;
    const canDeleteActiveItem = controller.canDeleteSlashItem?.(activeItem) === true;
    slashItemSettingsDeleteButton.hidden = !canDeleteActiveItem;
    if (canDeleteActiveItem) {
      slashItemSettingsDeleteButton.textContent = "Delete widget";
    }
    slashItemSettingsPanel.hidden = !panelOpen;

    if (panelOpen) {
      renderFields();
    }
    updateOverlayPosition();
    ensureOverlayTracking();
  };

  const applySettings = () => {
    const definition = getSlashItemDefinition(activeItem?.type);

    if (!activeItem || !definition) {
      controller.debugLog?.("slashItemSettings.apply.blocked", {
        activeItem,
        panelOpen,
      });
      return;
    }

    const rawValues = Object.fromEntries(new FormData(slashItemSettingsForm).entries());
    controller.debugLog?.("slashItemSettings.apply.begin", {
      activeItem,
      rawValues,
    });
    const didUpdate = controller.updateSlashItemSettings(activeItem, rawValues);
    controller.debugLog?.("slashItemSettings.apply.end", {
      activeItemAfterUpdate: controller.getActiveSlashItemState?.() ?? null,
      didUpdate,
      rawValues,
    });

    closePanel();
  };

  const preserveSettingsInteractionContext = (event) => {
    event.preventDefault();
  };

  slashItemSettingsToggleButton.addEventListener(
    "mousedown",
    preserveSettingsInteractionContext
  );
  slashItemSettingsToggleButton.addEventListener("click", () => {
    panelOpen = !panelOpen;
    render();
  });

  slashItemSettingsCloseButton?.addEventListener(
    "mousedown",
    preserveSettingsInteractionContext
  );
  slashItemSettingsCloseButton?.addEventListener("click", closePanel);

  slashItemSettingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applySettings();
  });

  applyButton?.addEventListener("mousedown", (event) => {
    preserveSettingsInteractionContext(event);
    controller.debugLog?.("slashItemSettings.applyButton.mouseDown", {
      activeItem,
      panelOpen,
    });
  });

  slashItemSettingsDeleteButton.addEventListener(
    "mousedown",
    preserveSettingsInteractionContext
  );

  slashItemSettingsDeleteButton.addEventListener("click", () => {
    if (!activeItem) {
      return;
    }

    const itemToDelete = activeItem;
    closePanel();
    controller.deleteSlashItem(itemToDelete);
  });

  document.addEventListener("mousedown", (event) => {
    if (!panelOpen) {
      return;
    }

    if (slashItemSettings.contains(event.target)) {
      return;
    }

    closePanel();
  });

  window.addEventListener("resize", updateOverlayPosition);
  window.addEventListener("scroll", updateOverlayPosition, true);

  return {
    render(nextItem) {
      const resolvedNextItem = resolveValidItem(nextItem) ?? null;
      const previousIdentity = getItemIdentity(activeItem);
      const nextIdentity = getItemIdentity(resolvedNextItem);

      controller.debugLog?.("slashItemSettings.render.request", {
        previousActiveItem: activeItem,
        nextItem,
        resolvedNextItem,
        panelOpen,
      });

      if (
        previousIdentity &&
        nextIdentity &&
        previousIdentity === nextIdentity
      ) {
        activeItem = resolvedNextItem;
      } else {
        activeItem = resolvedNextItem;
        panelOpen = false;
        renderedFieldsSignature = null;
      }

      render();
    },
  };
}
