const MAX_LOG_ENTRIES = 600;
const NOISY_LOG_PREFIXES = [
  "dom.selectionchange",
  "dom.keydown",
  "dom.beforeinput",
  "dom.input",
  "controller.dispatchTransaction.before",
  "controller.dispatchTransaction",
  "controller.dispatchTransaction.after",
  "controller.handleEditorKeyDown",
  "controller.handleTextInput",
  "controller.handleTextInput.mathTrigger",
  "controller.handleTextInput.routeToMath",
  "controller.routeTextInputToMathTarget",
  "math.beforeinput",
  "math.input",
  "math.input.draftUpdated",
  "math.keydown",
  "math.appendText",
  "math.nodeView.update",
];

function isNoisyLogType(type) {
  return NOISY_LOG_PREFIXES.some((prefix) => type === prefix || type.startsWith(`${prefix}.`));
}

function describeNode(node) {
  if (!node) {
    return null;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return `#text("${text.slice(0, 24)}")`;
  }

  if (!(node instanceof Element)) {
    return node.nodeName;
  }

  const id = node.id ? `#${node.id}` : "";
  const className = node.classList.length
    ? `.${Array.from(node.classList).slice(0, 3).join(".")}`
    : "";

  return `${node.tagName.toLowerCase()}${id}${className}`;
}

function describeSelection(selection) {
  if (!selection) {
    return null;
  }

  return {
    anchorNode: describeNode(selection.anchorNode),
    anchorOffset: selection.anchorOffset,
    focusNode: describeNode(selection.focusNode),
    focusOffset: selection.focusOffset,
    type: selection.type,
    rangeCount: selection.rangeCount,
  };
}

function serializeDetail(detail, depth = 0) {
  if (detail == null || typeof detail === "number" || typeof detail === "boolean") {
    return detail;
  }

  if (typeof detail === "string") {
    return detail.length > 240 ? `${detail.slice(0, 237)}...` : detail;
  }

  if (depth >= 4) {
    return "[depth-limit]";
  }

  if (detail instanceof Node) {
    return describeNode(detail);
  }

  if (Array.isArray(detail)) {
    return detail.slice(0, 20).map((value) => serializeDetail(value, depth + 1));
  }

  const output = {};

  for (const [key, value] of Object.entries(detail)) {
    output[key] = serializeDetail(value, depth + 1);
  }

  return output;
}

function createTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function createEditorDebugger({
  dockElement,
  stateElement,
  logElement,
  copyButton,
  clearButton,
  enabled = false,
}) {
  if (!enabled) {
    dockElement.hidden = true;
    window.__latexOnlineDebug = null;

    return {
      attachGlobalListeners() {},
      clear() {},
      copy() {},
      expose() {},
      exportText() {
        return "";
      },
      log() {},
      setState() {},
      shouldLog() {
        return false;
      },
    };
  }

  const entries = [];
  let sequence = 0;
  let currentState = {
    status: "Debugger initialized.",
  };
  let detachListeners = () => {};
  let lastSelectionSignature = "";

  function render() {
    stateElement.textContent = JSON.stringify(currentState, null, 2);
    logElement.textContent = entries
      .map((entry) => `${entry.seq.toString().padStart(4, "0")} ${entry.time} ${entry.type}\n${entry.payload}`)
      .join("\n\n");
    logElement.scrollTop = logElement.scrollHeight;
    dockElement.hidden = false;
  }

  function exportText() {
    const stateText = JSON.stringify(currentState, null, 2);
    const logText = entries
      .map((entry) => `${entry.seq.toString().padStart(4, "0")} ${entry.time} ${entry.type}\n${entry.payload}`)
      .join("\n\n");

    return [
      "=== Debug State ===",
      stateText,
      "",
      "=== Debug Log ===",
      logText,
    ].join("\n");
  }

  function log(type, detail = {}) {
    if (isNoisyLogType(type)) {
      return;
    }

    const payload = serializeDetail(detail);
    const entry = {
      seq: ++sequence,
      time: createTimestamp(),
      type,
      payload: JSON.stringify(payload, null, 2),
    };

    entries.push(entry);

    if (entries.length > MAX_LOG_ENTRIES) {
      entries.shift();
    }

    console.debug(`[latex-debug] ${type}`, payload);
    render();
  }

  function setState(label, detail = {}) {
    currentState = {
      label,
      ...serializeDetail(detail),
    };
    render();
  }

  function clear() {
    entries.length = 0;
    logElement.textContent = "";
    currentState = {
      status: "Logs cleared.",
    };
    render();
  }

  async function copy() {
    const text = exportText();

    try {
      await navigator.clipboard.writeText(text);
      log("debug.copy", {
        entryCount: entries.length,
        stateLabel: currentState.label ?? currentState.status ?? null,
      });
    } catch (error) {
      log("debug.copy.error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function attachGlobalListeners(getEditorRoot) {
    detachListeners();

    const listeners = [];
    const addListener = (target, eventName, handler, options = false) => {
      target.addEventListener(eventName, handler, options);
      listeners.push(() => target.removeEventListener(eventName, handler, options));
    };

    const shouldTrackEvent = () => {
      const root = getEditorRoot();
      if (!root) {
        return false;
      }

      const selection = document.getSelection();
      const activeElement = document.activeElement;

      return (
        root.contains(activeElement) ||
        activeElement === document.body ||
        root.contains(selection?.anchorNode) ||
        root.contains(selection?.focusNode)
      );
    };

    addListener(document, "focusin", (event) => {
      if (!shouldTrackEvent()) {
        return;
      }

      log("dom.focusin", {
        target: event.target,
        relatedTarget: event.relatedTarget,
        activeElement: document.activeElement,
      });
    }, true);

    addListener(document, "focusout", (event) => {
      if (!shouldTrackEvent()) {
        return;
      }

      log("dom.focusout", {
        target: event.target,
        relatedTarget: event.relatedTarget,
        activeElement: document.activeElement,
      });
    }, true);

    addListener(document, "selectionchange", () => {
      if (!shouldTrackEvent()) {
        return;
      }

      const selection = describeSelection(document.getSelection());
      const signature = JSON.stringify(selection);

      if (signature === lastSelectionSignature) {
        return;
      }

      lastSelectionSignature = signature;
      log("dom.selectionchange", {
        selection,
        activeElement: describeNode(document.activeElement),
      });
    });

    for (const eventName of ["keydown", "beforeinput", "input"]) {
      addListener(document, eventName, (event) => {
        if (!shouldTrackEvent()) {
          return;
        }

        log(`dom.${eventName}`, {
          key: "key" in event ? event.key : undefined,
          inputType: "inputType" in event ? event.inputType : undefined,
          data: "data" in event ? event.data : undefined,
          target: event.target,
          activeElement: document.activeElement,
          defaultPrevented: event.defaultPrevented,
          selection: describeSelection(document.getSelection()),
        });
      }, true);
    }

    detachListeners = () => {
      for (const detach of listeners) {
        detach();
      }
    };
  }

  function expose(controller) {
    window.__latexOnlineDebug = {
      controller,
      clear,
      copy,
      entries,
      exportText,
      log,
      setState,
      snapshotSelection() {
        return describeSelection(document.getSelection());
      },
    };
  }

  copyButton?.addEventListener("click", () => {
    void copy();
  });
  clearButton.addEventListener("click", clear);
  render();

  return {
    attachGlobalListeners,
    clear,
    copy,
    expose,
    exportText,
    log,
    shouldLog(type) {
      return !isNoisyLogType(type);
    },
    setState,
  };
}
