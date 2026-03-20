import {
  DEFAULT_MATH_STYLE,
  DEFAULT_TEXT_TOOLBAR_STATE,
} from "../../core/config.js";
import {
  createDefaultPageSettings,
  normalizePageSettings,
} from "../../core/page-settings.js";
import {
  normalizeLineSpacing,
  normalizeMathFontFamily,
  normalizeMathFontSize,
  normalizeParagraphSpacing,
  normalizeTextAlignment,
  normalizeTextFontFamily,
  normalizeTextFontSize,
} from "./options.js";
import { editorSchema } from "./schema.js";

const LATEX_FORMAT_VERSION = 1;

const DOCUMENT_HEADER = String.raw`% Latex Online format ${LATEX_FORMAT_VERSION}
\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb}
\usepackage[normalem]{ulem}

\newcommand{\LOTAB}{\hspace*{2em}}
\newcommand{\LOpageSettings}[9]{}
\newcommand{\LOsegment}[6]{#6}
\newcommand{\LOinlineMath}[4]{$#1$}
\newcommand{\LOparagraph}[4]{#4\par\vspace{#3em}}

\begin{document}
`;

const DOCUMENT_FOOTER = String.raw`
\end{document}
`;

function escapeTextArg(value) {
  return Array.from(String(value), (character) => {
    switch (character) {
      case "\\":
        return String.raw`\textbackslash{}`;
      case "\t":
        return String.raw`\LOTAB{}`;
      case "{":
        return String.raw`\{`;
      case "}":
        return String.raw`\}`;
      case "%":
        return String.raw`\%`;
      case "#":
        return String.raw`\#`;
      case "&":
        return String.raw`\&`;
      case "$":
        return String.raw`\$`;
      case "_":
        return String.raw`\_`;
      case "^":
        return String.raw`\textasciicircum{}`;
      case "~":
        return String.raw`\textasciitilde{}`;
      default:
        return character;
    }
  }).join("");
}

function decodeTextArg(value) {
  return String(value)
    .replace(/\\LOTAB\{\}/g, "\t")
    .replace(/\\textbackslash\{\}/g, "\\")
    .replace(/\\textasciicircum\{\}/g, "^")
    .replace(/\\textasciitilde\{\}/g, "~")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\%/g, "%")
    .replace(/\\#/g, "#")
    .replace(/\\&/g, "&")
    .replace(/\\\$/g, "$")
    .replace(/\\_/g, "_");
}

function escapeMathArg(value) {
  return String(value)
    .replace(/%/g, String.raw`\%`)
    .replace(/#/g, String.raw`\#`)
    .replace(/&/g, String.raw`\&`);
}

function decodeMathArg(value) {
  return String(value)
    .replace(/\\%/g, "%")
    .replace(/\\#/g, "#")
    .replace(/\\&/g, "&");
}

function getTextStyleFromMarks(marks) {
  let bold = false;
  let italic = false;
  let underline = false;
  let fontFamily = DEFAULT_TEXT_TOOLBAR_STATE.fontFamily;
  let fontSize = DEFAULT_TEXT_TOOLBAR_STATE.fontSize;

  for (const mark of marks) {
    if (mark.type === editorSchema.marks.bold) {
      bold = true;
    } else if (mark.type === editorSchema.marks.italic) {
      italic = true;
    } else if (mark.type === editorSchema.marks.underline) {
      underline = true;
    } else if (mark.type === editorSchema.marks.text_font_family) {
      fontFamily = normalizeTextFontFamily(mark.attrs.value);
    } else if (mark.type === editorSchema.marks.text_font_size) {
      fontSize = normalizeTextFontSize(mark.attrs.value);
    }
  }

  return {
    bold,
    italic,
    underline,
    fontFamily,
    fontSize,
  };
}

function createTextMarks({
  bold,
  italic,
  underline,
  fontFamily,
  fontSize,
}) {
  const marks = [];

  if (bold) {
    marks.push(editorSchema.marks.bold.create());
  }

  if (italic) {
    marks.push(editorSchema.marks.italic.create());
  }

  if (underline) {
    marks.push(editorSchema.marks.underline.create());
  }

  if (fontFamily !== DEFAULT_TEXT_TOOLBAR_STATE.fontFamily) {
    marks.push(editorSchema.marks.text_font_family.create({ value: fontFamily }));
  }

  if (fontSize !== DEFAULT_TEXT_TOOLBAR_STATE.fontSize) {
    marks.push(editorSchema.marks.text_font_size.create({ value: fontSize }));
  }

  return marks;
}

function serializeInlineNode(node) {
  if (node.isText) {
    const style = getTextStyleFromMarks(node.marks);

    return String.raw`\LOsegment{${style.bold ? "1" : "0"}}{${style.italic ? "1" : "0"}}{${style.underline ? "1" : "0"}}{${style.fontFamily}}{${style.fontSize}}{${escapeTextArg(node.text ?? "")}}`;
  }

  if (node.type === editorSchema.nodes.inline_math) {
    return String.raw`\LOinlineMath{${escapeMathArg(node.attrs.latex)}}{${normalizeMathFontFamily(node.attrs.fontFamily)}}{${normalizeMathFontSize(node.attrs.fontSize)}}{${normalizeTextFontSize(node.attrs.baseTextFontSize)}}`;
  }

  return "";
}

function serializeParagraph(node) {
  const alignment = normalizeTextAlignment(node.attrs.alignment);
  const lineSpacing = normalizeLineSpacing(node.attrs.lineSpacing);
  const paragraphSpacing = normalizeParagraphSpacing(node.attrs.paragraphSpacing);
  const body = [];

  node.forEach((child) => {
    const serialized = serializeInlineNode(child);

    if (serialized) {
      body.push(serialized);
    }
  });

  return String.raw`\LOparagraph{${alignment}}{${lineSpacing}}{${paragraphSpacing}}{` +
    (body.length > 0 ? `\n${body.join("\n")}\n` : "\n") +
    "}";
}

function serializePageSettings(pageSettings) {
  const normalized = normalizePageSettings(pageSettings);

  return String.raw`\LOpageSettings{${escapeTextArg(normalized.headerText)}}{${escapeTextArg(normalized.footerText)}}{${normalized.pageNumbering}}{${normalized.columnCount}}{${normalized.columnGap}}{${normalized.marginTop}}{${normalized.marginRight}}{${normalized.marginBottom}}{${normalized.marginLeft}}`;
}

export function serializeDocumentToLatex(
  doc,
  pageSettings = createDefaultPageSettings()
) {
  const paragraphs = [];

  doc.forEach((node) => {
    if (node.type !== editorSchema.nodes.page) {
      return;
    }

    node.forEach((child) => {
      if (child.type === editorSchema.nodes.paragraph) {
        paragraphs.push(serializeParagraph(child));
      }
    });
  });

  const documentBody = paragraphs.length > 0
    ? paragraphs.join("\n\n")
    : serializeParagraph(editorSchema.nodes.paragraph.createAndFill());

  return `${DOCUMENT_HEADER}${serializePageSettings(pageSettings)}\n\n${documentBody}\n${DOCUMENT_FOOTER}`;
}

function createPagedDocument(paragraphs) {
  const safeParagraphs = paragraphs.length > 0
    ? paragraphs
    : [editorSchema.nodes.paragraph.createAndFill()];

  return editorSchema.nodes.doc.create(null, [
    editorSchema.nodes.page.create(
      { pageNumber: 1 },
      safeParagraphs
    ),
  ]);
}

function extractDocumentBody(source) {
  const startMarker = String.raw`\begin{document}`;
  const endMarker = String.raw`\end{document}`;
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.lastIndexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return source;
  }

  return source.slice(startIndex + startMarker.length, endIndex);
}

class LatexCursor {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  get done() {
    return this.index >= this.source.length;
  }

  skipInsignificant() {
    while (!this.done) {
      const char = this.source[this.index];

      if (/\s/.test(char)) {
        this.index += 1;
        continue;
      }

      if (char === "%") {
        while (!this.done && this.source[this.index] !== "\n") {
          this.index += 1;
        }
        continue;
      }

      break;
    }
  }

  consumeCommand(name) {
    this.skipInsignificant();
    const command = `\\${name}`;

    if (!this.source.startsWith(command, this.index)) {
      return false;
    }

    const nextChar = this.source[this.index + command.length];

    if (/[A-Za-z@]/.test(nextChar ?? "")) {
      return false;
    }

    this.index += command.length;
    return true;
  }

  readArgument() {
    this.skipInsignificant();

    if (this.source[this.index] !== "{") {
      return null;
    }

    this.index += 1;
    let depth = 1;
    let value = "";

    while (!this.done) {
      const char = this.source[this.index];

      if (char === "\\") {
        const nextChar = this.source[this.index + 1];

        value += char;
        this.index += 1;

        if (nextChar != null) {
          value += nextChar;
          this.index += 1;
        }

        continue;
      }

      if (char === "{") {
        depth += 1;
        value += char;
        this.index += 1;
        continue;
      }

      if (char === "}") {
        depth -= 1;

        if (depth === 0) {
          this.index += 1;
          return value;
        }

        value += char;
        this.index += 1;
        continue;
      }

      value += char;
      this.index += 1;
    }

    return null;
  }
}

function parseParagraphBody(body) {
  const cursor = new LatexCursor(body);
  const content = [];

  while (!cursor.done) {
    if (cursor.consumeCommand("LOsegment")) {
      const bold = cursor.readArgument();
      const italic = cursor.readArgument();
      const underline = cursor.readArgument();
      const fontFamily = cursor.readArgument();
      const fontSize = cursor.readArgument();
      const text = cursor.readArgument();

      if (
        bold == null ||
        italic == null ||
        underline == null ||
        fontFamily == null ||
        fontSize == null ||
        text == null
      ) {
        break;
      }

      const decodedText = decodeTextArg(text);

      if (decodedText.length > 0) {
        content.push(
          editorSchema.text(
            decodedText,
            createTextMarks({
              bold: bold === "1",
              italic: italic === "1",
              underline: underline === "1",
              fontFamily: normalizeTextFontFamily(fontFamily),
              fontSize: normalizeTextFontSize(fontSize),
            })
          )
        );
      }

      continue;
    }

    if (cursor.consumeCommand("LOinlineMath")) {
      const latex = cursor.readArgument();
      const fontFamily = cursor.readArgument();
      const fontSize = cursor.readArgument();
      const baseTextFontSize = cursor.readArgument();

      if (
        latex == null ||
        fontFamily == null ||
        fontSize == null ||
        baseTextFontSize == null
      ) {
        break;
      }

      content.push(
        editorSchema.nodes.inline_math.create({
          latex: decodeMathArg(latex),
          fontFamily: normalizeMathFontFamily(fontFamily),
          fontSize: normalizeMathFontSize(fontSize),
          baseTextFontSize: normalizeTextFontSize(baseTextFontSize),
        })
      );
      continue;
    }

    cursor.index += 1;
  }

  return content;
}

export function parseLatexDocument(source) {
  if (!source || !source.trim()) {
    return {
      doc: createPagedDocument([]),
      pageSettings: createDefaultPageSettings(),
    };
  }

  const cursor = new LatexCursor(extractDocumentBody(source));
  const paragraphs = [];
  let pageSettings = createDefaultPageSettings();

  while (!cursor.done) {
    if (cursor.consumeCommand("LOpageSettings")) {
      const headerText = cursor.readArgument();
      const footerText = cursor.readArgument();
      const pageNumbering = cursor.readArgument();
      const columnCount = cursor.readArgument();
      const optionalArgs = [];

      for (let index = 0; index < 5; index += 1) {
        const argument = cursor.readArgument();

        if (argument == null) {
          break;
        }

        optionalArgs.push(argument);
      }

      if (
        headerText == null ||
        footerText == null ||
        pageNumbering == null ||
        columnCount == null
      ) {
        return {
          doc: createPagedDocument([]),
          pageSettings: createDefaultPageSettings(),
        };
      }

      let columnGap = null;
      let marginTop = null;
      let marginRight = null;
      let marginBottom = null;
      let marginLeft = null;

      if (optionalArgs.length >= 5) {
        [columnGap, marginTop, marginRight, marginBottom, marginLeft] = optionalArgs;
      } else if (optionalArgs.length === 4) {
        [marginTop, marginRight, marginBottom, marginLeft] = optionalArgs;
      }

      pageSettings = normalizePageSettings({
        headerText: decodeTextArg(headerText),
        footerText: decodeTextArg(footerText),
        pageNumbering,
        columnCount,
        columnGap,
        marginTop,
        marginRight,
        marginBottom,
        marginLeft,
      });
      continue;
    }

    if (!cursor.consumeCommand("LOparagraph")) {
      cursor.index += 1;
      continue;
    }

    const alignment = cursor.readArgument();
    const lineSpacing = cursor.readArgument();
    const paragraphSpacing = cursor.readArgument();
    const body = cursor.readArgument();

    if (
      alignment == null ||
      lineSpacing == null ||
      paragraphSpacing == null ||
      body == null
    ) {
      return {
        doc: createPagedDocument([]),
        pageSettings: createDefaultPageSettings(),
      };
    }

    const paragraph = editorSchema.nodes.paragraph.create(
      {
        alignment: normalizeTextAlignment(alignment),
        lineSpacing: normalizeLineSpacing(lineSpacing),
        paragraphSpacing: normalizeParagraphSpacing(paragraphSpacing),
      },
      parseParagraphBody(body)
    );

    paragraphs.push(paragraph);
  }

  if (paragraphs.length === 0) {
    return {
      doc: createPagedDocument([]),
      pageSettings,
    };
  }

  return {
    doc: createPagedDocument(paragraphs),
    pageSettings,
  };
}
