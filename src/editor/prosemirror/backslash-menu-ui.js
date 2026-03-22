import {
  backslashMenu,
  backslashMenuList,
  backslashMenuQuery,
} from "../../core/dom.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function bindBackslashMenuUi({ controller }) {
  if (!backslashMenu || !backslashMenuList || !backslashMenuQuery) {
    return {
      render() {},
    };
  }

  let activeMenuState = null;
  let overlayFrame = 0;
  let renderedSignature = null;

  const stopTracking = () => {
    if (!overlayFrame) {
      return;
    }

    cancelAnimationFrame(overlayFrame);
    overlayFrame = 0;
  };

  const updateOverlayPosition = () => {
    if (!activeMenuState) {
      return;
    }

    const rect = controller.getBackslashMenuClientRect(activeMenuState);

    if (!rect) {
      backslashMenu.hidden = true;
      return;
    }

    backslashMenu.hidden = false;
    const width = 224;
    const gutter = 8;
    const top = clamp(rect.bottom + gutter, 6, window.innerHeight - 220);
    const left = clamp(rect.left, 6, window.innerWidth - width - 6);

    backslashMenu.style.setProperty("--backslash-menu-top", `${top}px`);
    backslashMenu.style.setProperty("--backslash-menu-left", `${left}px`);
  };

  const trackPosition = () => {
    overlayFrame = 0;

    if (!activeMenuState) {
      return;
    }

    updateOverlayPosition();
    overlayFrame = requestAnimationFrame(trackPosition);
  };

  const ensureTracking = () => {
    if (!activeMenuState || overlayFrame) {
      return;
    }

    overlayFrame = requestAnimationFrame(trackPosition);
  };

  const getSignature = (menuState) => {
    if (!menuState) {
      return null;
    }

    return JSON.stringify({
      source: menuState.source,
      mathId: menuState.mathId ?? null,
      query: menuState.query ?? "",
      selectedIndex: menuState.selectedIndex ?? 0,
      items: menuState.items?.map((item) => item.name) ?? [],
    });
  };

  const renderItems = () => {
    const nextSignature = getSignature(activeMenuState);

    if (
      nextSignature &&
      nextSignature === renderedSignature &&
      backslashMenuList.childElementCount > 0
    ) {
      return;
    }

    renderedSignature = nextSignature;
    backslashMenuList.replaceChildren();

    if (!activeMenuState) {
      return;
    }

    for (const item of activeMenuState.items ?? []) {
      const itemIndex = backslashMenuList.childElementCount;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "backslash-menu-item";
      button.dataset.commandName = item.name;
      button.dataset.itemIndex = String(itemIndex);
      button.setAttribute("role", "option");
      button.setAttribute("aria-label", `Insert \\${item.name}`);
      button.setAttribute(
        "aria-selected",
        String(itemIndex === activeMenuState.selectedIndex)
      );

      if (itemIndex === activeMenuState.selectedIndex) {
        button.classList.add("is-selected");
      }

      const name = document.createElement("span");
      name.className = "backslash-menu-item-name";
      name.textContent = `\\${item.name}`;

      const meta = document.createElement("span");
      meta.className = "backslash-menu-item-meta";
      meta.textContent = item.title ?? item.description ?? "";

      button.append(name, meta);
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      button.addEventListener("mouseenter", () => {
        controller.setBackslashMenuSelectionIndex(itemIndex);
      });
      button.addEventListener("click", () => {
        controller.applyBackslashMenuCommand(activeMenuState, item.name);
      });
      backslashMenuList.append(button);
    }
  };

  const render = (menuState = activeMenuState) => {
    activeMenuState = menuState?.items?.length ? menuState : null;

    if (!activeMenuState) {
      renderedSignature = null;
      stopTracking();
      backslashMenu.hidden = true;
      backslashMenuList.replaceChildren();
      return;
    }

    backslashMenuQuery.textContent = `\\${activeMenuState.query ?? ""}`;
    renderItems();
    updateOverlayPosition();
    ensureTracking();
  };

  backslashMenu.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  return {
    render,
  };
}
