import {
  CURRENT_DOCUMENT_STORAGE_KEY,
  DEFAULT_DOCUMENT_TITLE,
} from "./config.js";
import { createDefaultPageSettings, normalizePageSettings } from "./page-settings.js";

const CLOUD_AUTOSAVE_DELAY_MS = 1000;

function loadJson(key, fallbackValue) {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function saveJson(key, value) {
  try {
    if (value == null) {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore localStorage failures.
  }
}

function createDocumentError(message, cause = null) {
  const error = new Error(message);
  error.cause = cause;
  return error;
}

function normalizeUser(record) {
  if (!record?.id) {
    return null;
  }

  const username = String(record.username ?? record.name ?? "").trim();
  return {
    id: String(record.id),
    username,
    name: username,
  };
}

function normalizeDocumentMeta(record) {
  if (!record?.id) {
    return null;
  }

  return {
    id: String(record.id),
    ownerUserId: record.ownerUserId ?? record.owner_user_id ?? null,
    title: String(record.title ?? DEFAULT_DOCUMENT_TITLE),
    createdAt: record.createdAt ?? record.created_at ?? null,
    updatedAt: record.updatedAt ?? record.updated_at ?? null,
  };
}

function normalizeDocuments(records) {
  return (records ?? []).map(normalizeDocumentMeta).filter(Boolean);
}

async function requestJson(path, options = {}) {
  const requestOptions = {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
    credentials: "same-origin",
  };

  if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
    requestOptions.headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, requestOptions);
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw createDocumentError(
      payload?.error ?? `Request failed (${response.status}).`
    );
  }

  return payload;
}

export function createDocumentLibraryController({
  onStateChange,
  currentDocumentStorageKey = CURRENT_DOCUMENT_STORAGE_KEY,
}) {
  let currentDocument = normalizeDocumentMeta(
    loadJson(currentDocumentStorageKey, null)
  );
  let pendingSaveTimer = 0;
  let state = {
    configured: true,
    user: null,
    currentDocument,
    error: null,
    lastSavedAt: null,
    saveState: "idle",
    status: "Sign in to access cloud documents.",
  };

  function getState() {
    return {
      ...state,
      currentDocument,
    };
  }

  function emitState() {
    onStateChange?.(getState());
  }

  function setState(patch) {
    state = {
      ...state,
      ...patch,
    };
    emitState();
  }

  function clearPendingSave() {
    if (!pendingSaveTimer) {
      return;
    }

    window.clearTimeout(pendingSaveTimer);
    pendingSaveTimer = 0;
  }

  function setCurrentDocument(documentMeta) {
    currentDocument = normalizeDocumentMeta(documentMeta);
    saveJson(currentDocumentStorageKey, currentDocument);
    setState({
      currentDocument,
    });
  }

  function applyAuthState(payload) {
    const nextUser = normalizeUser(payload?.user ?? null);

    if (!nextUser) {
      currentDocument = null;
      saveJson(currentDocumentStorageKey, null);
    } else if (
      currentDocument &&
      currentDocument.ownerUserId !== nextUser.id
    ) {
      currentDocument = null;
      saveJson(currentDocumentStorageKey, null);
    }

    setState({
      configured: true,
      user: nextUser,
      currentDocument,
      error: null,
      status:
        payload?.status ??
        (nextUser
          ? `Signed in as ${nextUser.username}.`
          : "Sign in to access cloud documents."),
    });
  }

  function getCurrentDocument() {
    return currentDocument;
  }

  function isAuthenticated() {
    return Boolean(state.user);
  }

  async function initialize() {
    const payload = await requestJson("/api/auth/state");
    applyAuthState(payload);
  }

  async function registerWithPassword({ username, password }) {
    const payload = await requestJson("/api/auth/register", {
      method: "POST",
      body: {
        username: String(username ?? "").trim(),
        password: String(password ?? ""),
      },
    });
    applyAuthState(payload);
    return payload;
  }

  async function signInWithPassword({ username, password }) {
    const payload = await requestJson("/api/auth/login", {
      method: "POST",
      body: {
        username: String(username ?? "").trim(),
        password: String(password ?? ""),
      },
    });
    applyAuthState(payload);
    return payload;
  }

  async function signOut() {
    clearPendingSave();
    const payload = await requestJson("/api/auth/logout", {
      method: "POST",
    });
    applyAuthState(payload);
    setCurrentDocument(null);
  }

  async function listDocuments() {
    const payload = await requestJson("/api/documents");
    return normalizeDocuments(payload.documents);
  }

  async function loadDocument(documentId) {
    const payload = await requestJson(`/api/documents/${encodeURIComponent(documentId)}`);
    const nextMeta = normalizeDocumentMeta(payload.document);
    setCurrentDocument(nextMeta);
    setState({
      error: null,
      status: `Opened ${nextMeta?.title ?? DEFAULT_DOCUMENT_TITLE}.`,
    });

    return {
      meta: nextMeta,
      serializedValue: String(payload.document?.latexSource ?? ""),
      pageSettings: normalizePageSettings(
        payload.document?.pageSettings ?? createDefaultPageSettings()
      ),
    };
  }

  async function createDocument({
    title = DEFAULT_DOCUMENT_TITLE,
    serializedValue = "",
    pageSettings = createDefaultPageSettings(),
  }) {
    const payload = await requestJson("/api/documents", {
      method: "POST",
      body: {
        title,
        latexSource: serializedValue,
        pageSettings,
      },
    });
    const nextMeta = normalizeDocumentMeta(payload.document);
    setCurrentDocument(nextMeta);
    setState({
      error: null,
      lastSavedAt: payload.document?.updatedAt ?? null,
      saveState: "saved",
      status: `Saved ${nextMeta?.title ?? DEFAULT_DOCUMENT_TITLE} to cloud.`,
    });
    return nextMeta;
  }

  async function updateDocument(
    documentId,
    {
      title = DEFAULT_DOCUMENT_TITLE,
      serializedValue = "",
      pageSettings = createDefaultPageSettings(),
    }
  ) {
    const payload = await requestJson(`/api/documents/${encodeURIComponent(documentId)}`, {
      method: "PUT",
      body: {
        title,
        latexSource: serializedValue,
        pageSettings,
      },
    });
    const nextMeta = normalizeDocumentMeta(payload.document);
    setCurrentDocument(nextMeta);
    setState({
      error: null,
      lastSavedAt: payload.document?.updatedAt ?? null,
      saveState: "saved",
      status: `Saved ${nextMeta?.title ?? DEFAULT_DOCUMENT_TITLE} to cloud.`,
    });
    return nextMeta;
  }

  async function saveDocument(payload) {
    setState({
      error: null,
      saveState: "saving",
      status: currentDocument?.id
        ? `Saving ${currentDocument.title}…`
        : "Saving new cloud document…",
    });

    try {
      const title = String(payload?.title ?? currentDocument?.title ?? DEFAULT_DOCUMENT_TITLE);
      const serializedValue = String(payload?.serializedValue ?? "");
      const pageSettings = normalizePageSettings(
        payload?.pageSettings ?? createDefaultPageSettings()
      );

      if (currentDocument?.id) {
        return await updateDocument(currentDocument.id, {
          title,
          serializedValue,
          pageSettings,
        });
      }

      return await createDocument({
        title,
        serializedValue,
        pageSettings,
      });
    } catch (error) {
      setState({
        error: error.message,
        saveState: "error",
        status: error.message,
      });
      throw error;
    }
  }

  function scheduleCurrentDocumentSave(payload) {
    if (!currentDocument?.id || !state.user) {
      return;
    }

    clearPendingSave();
    setState({
      error: null,
      saveState: "saving",
      status: `Saving ${currentDocument.title}…`,
    });
    pendingSaveTimer = window.setTimeout(async () => {
      pendingSaveTimer = 0;

      try {
        await updateDocument(currentDocument.id, {
          title: currentDocument.title,
          ...payload,
        });
      } catch (error) {
        setState({
          error: error.message,
          saveState: "error",
          status: error.message,
        });
      }
    }, CLOUD_AUTOSAVE_DELAY_MS);
  }

  function clearCurrentDocument() {
    clearPendingSave();
    setCurrentDocument(null);
    setState({
      error: null,
      lastSavedAt: null,
      saveState: "idle",
      status: state.user
        ? "Signed in. No cloud document selected."
        : "Sign in to access cloud documents.",
    });
  }

  return {
    clearCurrentDocument,
    createDocument,
    getCurrentDocument,
    getState,
    initialize,
    isAuthenticated,
    listDocuments,
    loadDocument,
    registerWithPassword,
    saveDocument,
    scheduleCurrentDocumentSave,
    signInWithPassword,
    signOut,
  };
}
