import { editorSchema } from "./schema.js";
import { parseLatexDocument, serializeDocumentToLatex } from "./latex.js";
import { createDefaultPageSettings } from "../../core/page-settings.js";

export function createEmptyDocument() {
  const paragraph = editorSchema.nodes.paragraph.createAndFill();
  const page = editorSchema.nodes.page.create({ pageNumber: 1 }, paragraph);
  return editorSchema.nodes.doc.create(null, [page]);
}

export function parseStoredDocument(serializedValue) {
  if (!serializedValue) {
    return {
      doc: createEmptyDocument(),
      pageSettings: createDefaultPageSettings(),
    };
  }

  try {
    return parseLatexDocument(serializedValue);
  } catch {
    return {
      doc: createEmptyDocument(),
      pageSettings: createDefaultPageSettings(),
    };
  }
}

export function serializeDocument(doc, pageSettings) {
  return serializeDocumentToLatex(doc, pageSettings);
}
