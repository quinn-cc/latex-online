export function createZoomController({
  paperColumn,
  zoomLevelElement,
  zoomResetButton,
  pageWidth,
  getLayoutWidth,
  defaultPageZoom,
  minPageZoom,
  maxPageZoom,
  pageZoomStep,
  loadStoredPageZoom,
  savePageZoom,
}) {
  let pageZoomLevel = loadStoredPageZoom(defaultPageZoom, clampPageZoom);

  function handleZoomShortcut(event) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      !(event.ctrlKey || event.metaKey)
    ) {
      return false;
    }

    if (event.key === "0") {
      event.preventDefault();
      event.stopPropagation();
      resetPageZoom();
      return true;
    }

    if (
      event.key === "+" ||
      event.key === "=" ||
      event.key === "Add" ||
      event.code === "NumpadAdd"
    ) {
      event.preventDefault();
      event.stopPropagation();
      changePageZoom(pageZoomStep);
      return true;
    }

    if (
      event.key === "-" ||
      event.key === "_" ||
      event.key === "Subtract" ||
      event.code === "NumpadSubtract"
    ) {
      event.preventDefault();
      event.stopPropagation();
      changePageZoom(-pageZoomStep);
      return true;
    }

    return false;
  }

  function updatePaperScale() {
    const bounds = paperColumn.getBoundingClientRect();
    const layoutWidth = Math.max(pageWidth, getLayoutWidth?.() ?? pageWidth);
    const fitScale = Math.min(1, Math.max((bounds.width - 24) / layoutWidth, 0));
    const scale = Math.min(maxPageZoom, Math.max(0.2, fitScale * pageZoomLevel));

    document.documentElement.style.setProperty("--page-scale", scale.toFixed(4));
    updateZoomUi();
  }

  function changePageZoom(delta) {
    setPageZoom(pageZoomLevel + delta);
  }

  function resetPageZoom() {
    setPageZoom(defaultPageZoom);
  }

  function setPageZoom(nextZoom) {
    const normalizedZoom = clampPageZoom(nextZoom);

    if (Math.abs(normalizedZoom - pageZoomLevel) < 0.001) {
      updateZoomUi();
      return;
    }

    pageZoomLevel = normalizedZoom;
    savePageZoom(pageZoomLevel);
    updatePaperScale();
  }

  function clampPageZoom(value) {
    const clamped = Math.min(maxPageZoom, Math.max(minPageZoom, value));
    return Math.round(clamped * 10) / 10;
  }

  function updateZoomUi() {
    zoomLevelElement.textContent = `${Math.round(pageZoomLevel * 100)}%`;
    zoomResetButton.disabled = Math.abs(pageZoomLevel - defaultPageZoom) < 0.001;
  }

  return {
    changePageZoom,
    handleZoomShortcut,
    resetPageZoom,
    updatePaperScale,
    updateZoomUi,
  };
}
