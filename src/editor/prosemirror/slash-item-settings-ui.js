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

  let activeItem = null;
  let panelOpen = false;
  const applyButton = slashItemSettingsForm.querySelector('[type="submit"]');

  const closePanel = () => {
    panelOpen = false;
    render();
  };

  const renderFields = () => {
    const definition = getSlashItemDefinition(activeItem?.type);

    slashItemSettingsFields.replaceChildren();

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

    const rect = controller.getSlashItemClientRect(activeItem);

    if (!rect) {
      slashItemSettings.hidden = true;
      return;
    }

    slashItemSettings.hidden = false;
    const toggleSize = 22;
    const toggleTop = clamp(rect.top + 6, 6, window.innerHeight - toggleSize - 6);
    const toggleLeft = clamp(
      rect.right - toggleSize - 6,
      6,
      window.innerWidth - toggleSize - 6
    );

    slashItemSettings.style.setProperty("--slash-item-toggle-top", `${toggleTop}px`);
    slashItemSettings.style.setProperty("--slash-item-toggle-left", `${toggleLeft}px`);

    if (!panelOpen) {
      return;
    }

    const panelWidth = 220;
    const panelHeight = 180;
    const panelTop = clamp(
      toggleTop + toggleSize + 8,
      6,
      window.innerHeight - panelHeight - 6
    );
    const panelLeft = clamp(
      Math.min(toggleLeft + toggleSize - panelWidth, rect.right - panelWidth),
      6,
      window.innerWidth - panelWidth - 6
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
      panelOpen = false;
      slashItemSettings.hidden = true;
      slashItemSettingsPanel.hidden = true;
      return;
    }

    controller.debugLog?.("slashItemSettings.render", {
      activeItem,
      panelOpen,
    });
    slashItemSettingsTitle.textContent = definition.title;
    slashItemSettingsDeleteButton.textContent = definition.deleteLabel;
    slashItemSettingsPanel.hidden = !panelOpen;
    renderFields();
    updateOverlayPosition();
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
  };

  slashItemSettingsToggleButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  slashItemSettingsToggleButton.addEventListener("click", () => {
    panelOpen = !panelOpen;
    render();
  });

  slashItemSettingsCloseButton?.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  slashItemSettingsCloseButton?.addEventListener("click", closePanel);

  slashItemSettingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applySettings();
  });

  applyButton?.addEventListener("mousedown", (event) => {
    event.preventDefault();
    controller.debugLog?.("slashItemSettings.applyButton.mouseDown", {
      activeItem,
      panelOpen,
    });
  });

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
      controller.debugLog?.("slashItemSettings.render.request", {
        previousActiveItem: activeItem,
        nextItem,
        panelOpen,
      });
      if (
        activeItem &&
        nextItem &&
        activeItem.type === nextItem.type &&
        activeItem.pos === nextItem.pos
      ) {
        activeItem = nextItem;
      } else {
        activeItem = nextItem;
        panelOpen = panelOpen && Boolean(nextItem);
      }

      render();
    },
  };
}
