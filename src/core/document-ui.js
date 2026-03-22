import {
  accountCloseButton,
  accountDialog,
  accountForm,
  accountPasswordInput,
  accountRegisterButton,
  accountSignInButton,
  accountSignOutButton,
  accountStatus,
  accountUsernameInput,
  cloudStatus,
  createDocumentButton,
  documentHome,
  documentHomeAccountButton,
  documentHomeCreateDocumentButton,
  documentHomeDocumentList,
  documentHomeDocumentsStatus,
  documentHomeNewDocumentTitleInput,
  documentHomeRefreshButton,
  documentHomeStatus,
  documentList,
  documentStatus,
  documentsCloseButton,
  documentsDialog,
  documentsRefreshButton,
  documentsStatus,
  editMenu,
  fileAccountButton,
  fileMenu,
  fileNewDocumentButton,
  fileOpenDocumentButton,
  fileSaveDocumentButton,
  newDocumentTitleInput,
} from "./dom.js";

function closeMenus() {
  if (fileMenu) {
    fileMenu.open = false;
  }

  if (editMenu) {
    editMenu.open = false;
  }
}

function formatDocumentStatus(state) {
  if (!state?.currentDocument?.title) {
    return "Document: local draft";
  }

  if (state.saveState === "saving") {
    return `Document: ${state.currentDocument.title} · saving…`;
  }

  return `Document: ${state.currentDocument.title}`;
}

function formatCloudStatus(state) {
  if (!state.user) {
    return "Cloud: signed out";
  }

  if (state.currentDocument?.title) {
    return `Cloud: ${state.user.username} · ${state.currentDocument.title}`;
  }

  return `Cloud: ${state.user.username}`;
}

function formatHomeStatus(state) {
  if (!state.user) {
    return "Sign in or create an account to access your cloud documents.";
  }

  if (state.currentDocument?.title) {
    return `Signed in as ${state.user.username}. Current cloud document: ${state.currentDocument.title}.`;
  }

  return `Signed in as ${state.user.username}. Open an existing cloud document or create a new one.`;
}

function formatUpdatedAt(updatedAt) {
  if (!updatedAt) {
    return "Saved";
  }

  return `Updated ${new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(updatedAt))}`;
}

function renderDocumentListInto(
  container,
  {
    documents,
    currentDocumentId,
    selectedDocumentId,
    onSelectDocument,
    onOpenDocument,
    emptyText,
  }
) {
  if (!container) {
    return;
  }

  container.replaceChildren();

  if (!documents.length) {
    const empty = document.createElement("p");
    empty.className = "document-empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }

  for (const documentMeta of documents) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "document-item";
    if (documentMeta.id === currentDocumentId) {
      button.classList.add("is-current");
    }
    if (documentMeta.id === selectedDocumentId) {
      button.classList.add("is-selected");
    }

    const title = document.createElement("span");
    title.className = "document-item-title";
    title.textContent = documentMeta.title;

    const meta = document.createElement("span");
    meta.className = "document-item-meta";
    meta.textContent = formatUpdatedAt(documentMeta.updatedAt);

    button.append(title, meta);
    button.addEventListener("click", (event) => {
      for (const sibling of container.querySelectorAll(".document-item.is-selected")) {
        sibling.classList.remove("is-selected");
      }
      button.classList.add("is-selected");
      onSelectDocument?.(documentMeta.id);
      if (event.detail >= 2) {
        onOpenDocument?.(documentMeta.id);
      }
    });
    container.append(button);
  }
}

export function bindDocumentUi({
  controller,
  documentController,
  getCurrentDocumentPayload,
  createBlankDocumentPayload,
  loadSavedDocument,
  onNewLocalDocument,
}) {
  let latestDocuments = [];
  let latestState = documentController.getState();
  let selectedDocumentId = latestState.currentDocument?.id ?? null;

  function setDocumentStatuses(message) {
    documentsStatus.textContent = message;
    documentHomeDocumentsStatus.textContent = message;
  }

  function setAuthStatuses(message) {
    accountStatus.textContent = message;
  }

  function selectDocument(documentId) {
    selectedDocumentId = documentId;
    setDocumentStatuses("Double-click a document to open it.");
  }

  function renderDocumentLists() {
    const emptyText = latestState.user
      ? "No cloud documents yet."
      : "Sign in to see your cloud documents.";
    const currentDocumentId = latestState.currentDocument?.id ?? null;

    renderDocumentListInto(documentList, {
      documents: latestDocuments,
      currentDocumentId,
      selectedDocumentId,
      onSelectDocument: selectDocument,
      onOpenDocument: openDocument,
      emptyText,
    });
    renderDocumentListInto(documentHomeDocumentList, {
      documents: latestDocuments,
      currentDocumentId,
      selectedDocumentId,
      onSelectDocument: selectDocument,
      onOpenDocument: openDocument,
      emptyText,
    });
  }

  function clearCredentialInputs() {
    accountPasswordInput.value = "";
  }

  function renderDocumentState(nextState) {
    latestState = nextState;
    documentStatus.textContent = formatDocumentStatus(nextState);
    cloudStatus.textContent = formatCloudStatus(nextState);
    documentHomeStatus.textContent = formatHomeStatus(nextState);
    setAuthStatuses(nextState.error ?? nextState.status);

    accountSignOutButton.disabled = !nextState.user;
    documentHomeRefreshButton.disabled = !nextState.user;
    documentHomeCreateDocumentButton.disabled = !nextState.user;
    documentHomeNewDocumentTitleInput.disabled = !nextState.user;

    renderDocumentLists();
    if (!nextState.user) {
      setDocumentStatuses("Sign in to see your cloud documents.");
    } else if (latestDocuments.length) {
      setDocumentStatuses("Double-click a document to open it.");
    } else {
      setDocumentStatuses("No cloud documents yet.");
    }
  }

  async function refreshDocuments() {
    setDocumentStatuses("Loading documents…");

    if (!latestState.user) {
      latestDocuments = [];
      setDocumentStatuses("Sign in to see your cloud documents.");
      renderDocumentLists();
      return;
    }

    try {
      latestDocuments = await documentController.listDocuments();
      if (!latestDocuments.some((documentMeta) => documentMeta.id === selectedDocumentId)) {
        selectedDocumentId = latestState.currentDocument?.id ?? latestDocuments[0]?.id ?? null;
      }
      setDocumentStatuses(
        latestDocuments.length
          ? "Double-click a document to open it."
          : "No cloud documents yet."
      );
    } catch (error) {
      latestDocuments = [];
      setDocumentStatuses(error.message);
    }

    renderDocumentLists();
  }

  async function signInWithCredentials(username, password) {
    setAuthStatuses("Signing in…");

    try {
      await documentController.signInWithPassword({ username, password });
      clearCredentialInputs();
      renderDocumentState(documentController.getState());
      await refreshDocuments();
    } catch (error) {
      setAuthStatuses(error.message);
    }
  }

  async function registerWithCredentials(username, password) {
    setAuthStatuses("Creating account…");

    try {
      await documentController.registerWithPassword({ username, password });
      clearCredentialInputs();
      renderDocumentState(documentController.getState());
      await refreshDocuments();
    } catch (error) {
      setAuthStatuses(error.message);
    }
  }

  async function saveCurrentDocument() {
    closeMenus();

    if (!latestState.user) {
      return;
    }

    try {
      await documentController.saveDocument(getCurrentDocumentPayload());
      renderDocumentState(documentController.getState());
      await refreshDocuments();
    } catch (error) {
      setDocumentStatuses(error.message);
      setAuthStatuses(error.message);
    } finally {
      requestAnimationFrame(() => controller.focus());
    }
  }

  async function openDocument(documentId) {
    try {
      setDocumentStatuses("Opening document…");
      const result = await documentController.loadDocument(documentId);
      selectedDocumentId = documentId;
      loadSavedDocument(result);
      documentsDialog.close();
      renderDocumentState(documentController.getState());
      await refreshDocuments();
    } catch (error) {
      setDocumentStatuses(error.message);
    } finally {
      requestAnimationFrame(() => controller.focus());
    }
  }

  async function createDocumentFromTitle(titleValue) {
    if (!latestState.user) {
      return;
    }

    const payload = createBlankDocumentPayload(String(titleValue ?? "").trim());

    try {
      setDocumentStatuses("Creating document…");
      const meta = await documentController.createDocument(payload);
      loadSavedDocument({
        meta,
        serializedValue: payload.serializedValue,
        pageSettings: payload.pageSettings,
      });
      newDocumentTitleInput.value = "";
      documentHomeNewDocumentTitleInput.value = "";
      await refreshDocuments();
      documentsDialog.close();
      renderDocumentState(documentController.getState());
    } catch (error) {
      setDocumentStatuses(error.message);
    } finally {
      requestAnimationFrame(() => controller.focus());
    }
  }

  function openAccountDialog() {
    closeMenus();
    renderDocumentState(documentController.getState());
    accountDialog.showModal();
  }

  async function openDocumentsDialog() {
    closeMenus();

    await refreshDocuments();
    documentHomeDocumentList?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }

  async function handleSignOut() {
    try {
      await documentController.signOut();
      latestDocuments = [];
      clearCredentialInputs();
      renderDocumentState(documentController.getState());
      setDocumentStatuses("Sign in to see your cloud documents.");
    } catch (error) {
      setAuthStatuses(error.message);
    }
  }

  fileNewDocumentButton?.addEventListener("click", () => {
    closeMenus();
    onNewLocalDocument?.();
    renderDocumentState(documentController.getState());
    requestAnimationFrame(() => controller.focus());
  });

  fileOpenDocumentButton?.addEventListener("click", () => {
    openDocumentsDialog();
  });

  fileSaveDocumentButton?.addEventListener("click", () => {
    saveCurrentDocument();
  });

  fileAccountButton?.addEventListener("click", () => {
    openAccountDialog();
  });

  documentHomeAccountButton?.addEventListener("click", () => {
    openAccountDialog();
  });

  accountCloseButton?.addEventListener("click", () => {
    accountDialog.close();
  });

  documentsCloseButton?.addEventListener("click", () => {
    documentsDialog.close();
  });

  accountDialog?.addEventListener("close", () => {
    requestAnimationFrame(() => controller.focus());
  });

  documentsDialog?.addEventListener("close", () => {
    requestAnimationFrame(() => controller.focus());
  });

  accountForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signInWithCredentials(
      accountUsernameInput.value,
      accountPasswordInput.value
    );
  });

  accountRegisterButton?.addEventListener("click", async () => {
    await registerWithCredentials(
      accountUsernameInput.value,
      accountPasswordInput.value
    );
  });

  accountSignOutButton?.addEventListener("click", handleSignOut);

  documentsRefreshButton?.addEventListener("click", () => {
    refreshDocuments();
  });

  documentHomeRefreshButton?.addEventListener("click", () => {
    refreshDocuments();
  });

  createDocumentButton?.addEventListener("click", () => {
    createDocumentFromTitle(newDocumentTitleInput.value);
  });

  documentHomeCreateDocumentButton?.addEventListener("click", () => {
    createDocumentFromTitle(documentHomeNewDocumentTitleInput.value);
  });

  newDocumentTitleInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    createDocumentFromTitle(newDocumentTitleInput.value);
  });

  documentHomeNewDocumentTitleInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    createDocumentFromTitle(documentHomeNewDocumentTitleInput.value);
  });

  accountPasswordInput?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    await signInWithCredentials(accountUsernameInput.value, accountPasswordInput.value);
  });

  renderDocumentState(latestState);

  if (latestState.user) {
    refreshDocuments();
  }

  return {
    refreshDocuments,
    renderDocumentState,
    saveCurrentDocument,
  };
}
