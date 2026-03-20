export function downloadTextFile({
  filename,
  content,
  mimeType = "application/x-tex;charset=utf-8",
}) {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = filename;
  link.hidden = true;

  document.body.append(link);
  link.click();
  link.remove();

  requestAnimationFrame(() => {
    URL.revokeObjectURL(objectUrl);
  });
}
