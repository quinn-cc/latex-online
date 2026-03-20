export function createStorageController({
  saveStatusElement,
  buildAssetUrls,
  storageKey,
  buildSignatureKey,
  lastSaveTimeKey,
  pageZoomStorageKey,
  viewModeStorageKey,
  storageFormatVersion,
  legacyStorageKeys,
}) {
  function loadStoredPageZoom(defaultValue, clampZoom) {
    try {
      const storedValue = localStorage.getItem(pageZoomStorageKey);
      const parsedValue = Number.parseFloat(storedValue ?? "");

      if (!Number.isFinite(parsedValue)) {
        return defaultValue;
      }

      return clampZoom(parsedValue);
    } catch {
      return defaultValue;
    }
  }

  function savePageZoom(value) {
    try {
      localStorage.setItem(pageZoomStorageKey, String(value));
    } catch {
      // Keep working even if local storage is unavailable.
    }
  }

  function loadStoredViewMode(defaultValue, normalizeValue) {
    try {
      const storedValue = localStorage.getItem(viewModeStorageKey);
      return normalizeValue(storedValue ?? defaultValue);
    } catch {
      return defaultValue;
    }
  }

  function saveViewMode(value) {
    try {
      localStorage.setItem(viewModeStorageKey, String(value));
    } catch {
      // Keep working even if local storage is unavailable.
    }
  }

  function loadDocument() {
    try {
      const storedValue = localStorage.getItem(storageKey);

      if (!storedValue) {
        return "";
      }

      let parsed = null;

      try {
        parsed = JSON.parse(storedValue);
      } catch {
        return "";
      }

      if (parsed?.version !== storageFormatVersion || typeof parsed.content !== "string") {
        return "";
      }

      return parsed.content;
    } catch {
      saveStatusElement.textContent = "Local saving is unavailable.";
      return "";
    }
  }

  async function clearSavedDraftIfBuildChanged() {
    try {
      const buildSignature = await computeBuildSignature();
      const previousSignature = localStorage.getItem(buildSignatureKey);

      if (previousSignature && previousSignature !== buildSignature) {
        localStorage.removeItem(storageKey);
        localStorage.removeItem(lastSaveTimeKey);
        legacyStorageKeys.forEach((key) => localStorage.removeItem(key));
        saveStatusElement.textContent = "Draft cleared after update.";
        return true;
      }

      if (previousSignature !== buildSignature) {
        localStorage.setItem(buildSignatureKey, buildSignature);
      }
    } catch {
      // If the signature check fails, keep the user's current draft.
    }

    return false;
  }

  async function computeBuildSignature() {
    const assetContents = await Promise.all(
      buildAssetUrls.map(async (url) => {
        const response = await fetch(url, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Failed to fetch ${url}`);
        }

        return `${url}\n${await response.text()}`;
      })
    );
    const payload = new TextEncoder().encode(assetContents.join("\n\n"));
    const digest = await crypto.subtle.digest("SHA-256", payload);

    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  }

  function saveDocument(value) {
    try {
      const savedAt = new Date();
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: storageFormatVersion,
          content: value,
        })
      );
      localStorage.setItem(lastSaveTimeKey, savedAt.toISOString());
      saveStatusElement.textContent = formatLastSaveStatus(savedAt);
    } catch {
      saveStatusElement.textContent = "Local saving is unavailable.";
    }
  }

  function restoreLastSaveStatus() {
    try {
      const savedAt = localStorage.getItem(lastSaveTimeKey);

      if (!savedAt) {
        saveStatusElement.textContent = "Last saved: not yet";
        return;
      }

      const parsedDate = new Date(savedAt);

      if (Number.isNaN(parsedDate.getTime())) {
        saveStatusElement.textContent = "Last saved: not yet";
        return;
      }

      saveStatusElement.textContent = formatLastSaveStatus(parsedDate);
    } catch {
      saveStatusElement.textContent = "Last saved: unavailable";
    }
  }

  function formatLastSaveStatus(date) {
    return `Last saved ${new Intl.DateTimeFormat([], {
      hour: "numeric",
      minute: "2-digit",
    }).format(date)}`;
  }

  return {
    clearSavedDraftIfBuildChanged,
    loadDocument,
    loadStoredPageZoom,
    loadStoredViewMode,
    restoreLastSaveStatus,
    saveDocument,
    savePageZoom,
    saveViewMode,
  };
}
