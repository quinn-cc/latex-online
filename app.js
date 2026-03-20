import {
  BUILD_SIGNATURE_KEY,
  DEFAULT_LATEX_FILENAME,
  DEFAULT_PAGE_ZOOM,
  LAST_SAVE_TIME_KEY,
  LEGACY_STORAGE_KEYS,
  MAX_PAGE_ZOOM,
  MIN_PAGE_ZOOM,
  PAGE_WIDTH,
  PAGE_ZOOM_STEP,
  PAGE_ZOOM_STORAGE_KEY,
  STORAGE_FORMAT_VERSION,
  STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
} from "./src/core/config.js";
import * as dom from "./src/core/dom.js";
import { downloadTextFile } from "./src/core/file-actions.js";
import {
  createDefaultPageSettings,
  normalizePageSettings,
} from "./src/core/page-settings.js";
import { createStorageController } from "./src/core/storage.js";
import { applyViewMode, DEFAULT_VIEW_MODE, normalizeViewMode } from "./src/core/view-mode.js";
import { createZoomController } from "./src/core/zoom.js";
import {
  parseStoredDocument,
  serializeDocument,
} from "./src/editor/prosemirror/document.js";
import { createPaperEditorController } from "./src/editor/prosemirror/controller.js";
import { createEditorDebugger } from "./src/editor/prosemirror/debug.js";
import {
  bindEditorUi,
  renderViewModeUi,
  renderToolbarState,
} from "./src/editor/prosemirror/ui.js";

const {
  debugClearButton,
  debugCopyButton,
  debugDock,
  debugLog: debugLogElement,
  debugState,
  editor,
  paperColumn,
  saveStatus,
  zoomLevel,
  zoomResetButton,
} = dom;

const buildAssetUrls = [
  new URL("./index.html", import.meta.url).href,
  new URL("./styles.css", import.meta.url).href,
  import.meta.url,
  new URL("./src/core/config.js", import.meta.url).href,
  new URL("./src/core/dom.js", import.meta.url).href,
  new URL("./src/core/file-actions.js", import.meta.url).href,
  new URL("./src/core/page-settings.js", import.meta.url).href,
  new URL("./src/core/storage.js", import.meta.url).href,
  new URL("./src/core/view-mode.js", import.meta.url).href,
  new URL("./src/core/zoom.js", import.meta.url).href,
  new URL("./src/editor/prosemirror/controller.js", import.meta.url).href,
  new URL("./src/editor/prosemirror/debug.js", import.meta.url).href,
  new URL("./src/editor/prosemirror/document.js", import.meta.url).href,
  new URL("./src/editor/prosemirror/latex.js", import.meta.url).href,
  new URL("./src/editor/prosemirror/math-node-view.js", import.meta.url).href,
  new URL("./src/editor/prosemirror/math-trigger-plugin.js", import.meta.url).href,
  new URL("./src/editor/prosemirror/options.js", import.meta.url).href,
  new URL("./src/editor/prosemirror/schema.js", import.meta.url).href,
  new URL("./src/editor/prosemirror/ui.js", import.meta.url).href,
];

const storageController = createStorageController({
  saveStatusElement: saveStatus,
  buildAssetUrls,
  storageKey: STORAGE_KEY,
  buildSignatureKey: BUILD_SIGNATURE_KEY,
  lastSaveTimeKey: LAST_SAVE_TIME_KEY,
  pageZoomStorageKey: PAGE_ZOOM_STORAGE_KEY,
  viewModeStorageKey: VIEW_MODE_STORAGE_KEY,
  storageFormatVersion: STORAGE_FORMAT_VERSION,
  legacyStorageKeys: LEGACY_STORAGE_KEYS,
});

const zoomController = createZoomController({
  paperColumn,
  zoomLevelElement: zoomLevel,
  zoomResetButton,
  pageWidth: PAGE_WIDTH,
  defaultPageZoom: DEFAULT_PAGE_ZOOM,
  minPageZoom: MIN_PAGE_ZOOM,
  maxPageZoom: MAX_PAGE_ZOOM,
  pageZoomStep: PAGE_ZOOM_STEP,
  loadStoredPageZoom: storageController.loadStoredPageZoom,
  savePageZoom: storageController.savePageZoom,
});

const url = new URL(window.location.href);
const debugEnabled = url.searchParams.get("debug") === "1";

const editorDebugger = createEditorDebugger({
  dockElement: debugDock,
  stateElement: debugState,
  logElement: debugLogElement,
  copyButton: debugCopyButton,
  clearButton: debugClearButton,
  enabled: debugEnabled,
});

initializeApp();

async function initializeApp() {
  try {
    const { MathfieldElement } = await import("./vendor/mathlive/mathlive.min.mjs");
    MathfieldElement.fontsDirectory = new URL(
      "./vendor/mathlive/fonts",
      import.meta.url
    ).href;
    MathfieldElement.soundsDirectory = null;

    const draftWasCleared = await storageController.clearSavedDraftIfBuildChanged();
    const initialStoredState = parseStoredDocument(storageController.loadDocument());
    let currentPageSettings = normalizePageSettings(
      initialStoredState.pageSettings ?? createDefaultPageSettings()
    );
    let currentViewMode = storageController.loadStoredViewMode(
      DEFAULT_VIEW_MODE,
      normalizeViewMode
    );

    const controller = createPaperEditorController({
      mount: editor,
      initialDoc: initialStoredState.doc,
      initialPageSettings: currentPageSettings,
      saveDocument: (doc) => {
        storageController.saveDocument(serializeDocument(doc, currentPageSettings));
      },
      MathfieldElementClass: MathfieldElement,
      onUiStateChange: renderToolbarState,
      debug: editorDebugger,
    });

    const persistCurrentState = () => {
      storageController.saveDocument(
        serializeDocument(controller.getDocument(), currentPageSettings)
      );
    };

    const applyWorkspaceViewMode = (nextViewMode) => {
      currentViewMode = applyViewMode(normalizeViewMode(nextViewMode), {
        rootElement: document.documentElement,
      });
      storageController.saveViewMode(currentViewMode);
      renderViewModeUi(currentViewMode);
      zoomController.updatePaperScale();
    };

    const applyCurrentPageSettings = () => {
      controller.setPageSettings(currentPageSettings);
      zoomController.updatePaperScale();
    };

    editorDebugger.attachGlobalListeners(() => controller.view?.dom ?? null);
    editorDebugger.expose(controller);
    editorDebugger.setState("app.ready", controller.getDebugSnapshot());
    applyWorkspaceViewMode(currentViewMode);
    applyCurrentPageSettings();

    bindEditorUi({
      controller,
      zoomController,
      saveLatexFile: () => {
        downloadTextFile({
          filename: DEFAULT_LATEX_FILENAME,
          content: serializeDocument(controller.getDocument(), currentPageSettings),
        });
      },
      printDocument: () => {
        window.print();
      },
      getPageSettings: () => currentPageSettings,
      getViewMode: () => currentViewMode,
      setViewMode: (nextViewMode) => {
        applyWorkspaceViewMode(nextViewMode);
      },
      applyPageSettings: (nextPageSettings) => {
        currentPageSettings = normalizePageSettings(nextPageSettings);
        applyCurrentPageSettings();
        persistCurrentState();
      },
    });

    if (!draftWasCleared) {
      storageController.restoreLastSaveStatus();
    }

    zoomController.updateZoomUi();
    zoomController.updatePaperScale();
    const resizeObserver = new ResizeObserver(() => {
      zoomController.updatePaperScale();
    });
    resizeObserver.observe(paperColumn);
    window.addEventListener("resize", zoomController.updatePaperScale);

    controller.focus();
  } catch (error) {
    editor.replaceChildren(createLoadErrorElement());
    saveStatus.textContent = "MathLive failed to load.";
    editorDebugger.log("app.error", {
      message: String(error),
      stack: error?.stack ?? null,
    });
    console.error(error);
  } finally {
    document.body.classList.add("ready");
  }
}

function createLoadErrorElement() {
  const message = document.createElement("p");
  message.className = "load-error";
  message.textContent =
    "The editor failed to initialize. Refresh once, then check the browser console if it still fails.";
  return message;
}
