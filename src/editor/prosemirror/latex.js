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
  normalizeOrderedListStyle,
  normalizeParagraphSpacing,
  normalizeTextAlignment,
  normalizeTextFontFamily,
  normalizeTextFontSize,
} from "./options.js";
import { editorSchema } from "./schema.js";
import { normalizeTableStyle } from "./table-styles.js";

const LATEX_FORMAT_VERSION = 1;
let parsedMathIdCounter = 0;

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
\newcommand{\LOlist}[2]{#2}
\newcommand{\LOitem}[1]{#1}
\newcommand{\LOalign}[2]{\begin{align*}#2\end{align*}}
\newcommand{\LOalignRow}[1]{#1 \\}
\newcommand{\LOalignCell}[4]{#1}
\newcommand{\LOgather}[2]{\begin{gather*}#2\end{gather*}}
\newcommand{\LOgatherRow}[1]{#1 \\}
\newcommand{\LOgatherCell}[4]{#1}
\newcommand{\LOtable}[2]{#2}
\newcommand{\LOtableRow}[1]{#1}
\newcommand{\LOtableCell}[1]{#1}

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

function createParsedMathId(prefix = "math") {
  parsedMathIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${parsedMathIdCounter.toString(36)}`;
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

function serializeListItem(node) {
  const blocks = [];

  node.forEach((child) => {
    const serialized = serializeBlockNode(child);

    if (serialized) {
      blocks.push(serialized);
    }
  });

  return String.raw`\LOitem{` +
    (blocks.length > 0 ? `\n${blocks.join("\n\n")}\n` : `\n${serializeParagraph(editorSchema.nodes.paragraph.createAndFill())}\n`) +
    "}";
}

function serializeList(node) {
  const listType = node.type === editorSchema.nodes.bullet_list
    ? "bullet"
    : normalizeOrderedListStyle(node.attrs.listStyle);
  const items = [];

  node.forEach((child) => {
    if (child.type === editorSchema.nodes.list_item) {
      items.push(serializeListItem(child));
    }
  });

  return String.raw`\LOlist{${listType}}{` +
    (items.length > 0 ? `\n${items.join("\n")}\n` : "\n") +
    "}";
}

function serializeAlignCell(node) {
  return String.raw`\LOalignCell{${escapeMathArg(node.attrs.latex)}}{${normalizeMathFontFamily(node.attrs.fontFamily)}}{${normalizeMathFontSize(node.attrs.fontSize)}}{${normalizeTextFontSize(node.attrs.baseTextFontSize)}}`;
}

function serializeAlignRow(node) {
  const cells = [];

  node.forEach((child) => {
    if (child.type === editorSchema.nodes.align_math) {
      cells.push(serializeAlignCell(child));
    }
  });

  while (cells.length < 2) {
    cells.push(
      serializeAlignCell(
        editorSchema.nodes.align_math.create({
          id: createParsedMathId("align-math"),
        })
      )
    );
  }

  return String.raw`\LOalignRow{${cells.join(" & ")}}`;
}

function serializeAlignBlock(node) {
  const rows = [];
  const groupCount = Math.max(
    1,
    Number.parseInt(String(node.attrs.groupCount ?? 1), 10) || 1
  );

  node.forEach((child) => {
    if (child.type === editorSchema.nodes.align_row) {
      rows.push(serializeAlignRow(child));
    }
  });

  return String.raw`\LOalign{${groupCount}}{` +
    (rows.length > 0 ? `\n${rows.join("\n")}\n` : "\n") +
    "}";
}

function serializeGatherCell(node) {
  return String.raw`\LOgatherCell{${escapeMathArg(node.attrs.latex)}}{${normalizeMathFontFamily(node.attrs.fontFamily)}}{${normalizeMathFontSize(node.attrs.fontSize)}}{${normalizeTextFontSize(node.attrs.baseTextFontSize)}}`;
}

function serializeGatherRow(node) {
  const cells = [];

  node.forEach((child) => {
    if (child.type === editorSchema.nodes.gather_math) {
      cells.push(serializeGatherCell(child));
    }
  });

  while (cells.length < 1) {
    cells.push(
      serializeGatherCell(
        editorSchema.nodes.gather_math.create({
          id: createParsedMathId("gather-math"),
        })
      )
    );
  }

  return String.raw`\LOgatherRow{${cells.join(" \\qquad ")}}`;
}

function serializeGatherBlock(node) {
  const rows = [];
  const columnCount = Math.max(
    1,
    Number.parseInt(String(node.attrs.columnCount ?? 1), 10) || 1
  );

  node.forEach((child) => {
    if (child.type === editorSchema.nodes.gather_row) {
      rows.push(serializeGatherRow(child));
    }
  });

  return String.raw`\LOgather{${columnCount}}{` +
    (rows.length > 0 ? `\n${rows.join("\n")}\n` : "\n") +
    "}";
}

function serializeTableCell(node) {
  const blocks = [];

  node.forEach((child) => {
    const serialized = serializeBlockNode(child);

    if (serialized) {
      blocks.push(serialized);
    }
  });

  return String.raw`\LOtableCell{` +
    (blocks.length > 0 ? `\n${blocks.join("\n\n")}\n` : `\n${serializeParagraph(editorSchema.nodes.paragraph.createAndFill())}\n`) +
    "}";
}

function serializeTableRow(node) {
  const cells = [];

  node.forEach((child) => {
    if (child.type === editorSchema.nodes.table_cell) {
      cells.push(serializeTableCell(child));
    }
  });

  return String.raw`\LOtableRow{` +
    (cells.length > 0 ? `\n${cells.join("\n")}\n` : "\n") +
    "}";
}

function serializeTable(node) {
  const rows = [];

  node.forEach((child) => {
    if (child.type === editorSchema.nodes.table_row) {
      rows.push(serializeTableRow(child));
    }
  });

  return String.raw`\LOtable{${normalizeTableStyle(node.attrs.tableStyle)}}{` +
    (rows.length > 0 ? `\n${rows.join("\n")}\n` : "\n") +
    "}";
}

function serializeBlockNode(node) {
  if (node.type === editorSchema.nodes.paragraph) {
    return serializeParagraph(node);
  }

  if (node.type === editorSchema.nodes.align_block) {
    return serializeAlignBlock(node);
  }

  if (node.type === editorSchema.nodes.gather_block) {
    return serializeGatherBlock(node);
  }

  if (node.type === editorSchema.nodes.table) {
    return serializeTable(node);
  }

  if (
    node.type === editorSchema.nodes.bullet_list ||
    node.type === editorSchema.nodes.ordered_list
  ) {
    return serializeList(node);
  }

  return "";
}

function serializePageSettings(pageSettings) {
  const normalized = normalizePageSettings(pageSettings);

  return String.raw`\LOpageSettings{${escapeTextArg(normalized.headerText)}}{${escapeTextArg(normalized.footerText)}}{${normalized.pageNumbering}}{${normalized.columnCount}}{${normalized.columnGap}}{${normalized.marginTop}}{${normalized.marginRight}}{${normalized.marginBottom}}{${normalized.marginLeft}}`;
}

export function serializeDocumentToLatex(
  doc,
  pageSettings = createDefaultPageSettings()
) {
  const blocks = [];

  doc.forEach((node) => {
    if (node.type !== editorSchema.nodes.page) {
      return;
    }

    node.forEach((child) => {
      const serialized = serializeBlockNode(child);

      if (serialized) {
        blocks.push(serialized);
      }
    });
  });

  const documentBody = blocks.length > 0
    ? blocks.join("\n\n")
    : serializeParagraph(editorSchema.nodes.paragraph.createAndFill());

  return `${DOCUMENT_HEADER}${serializePageSettings(pageSettings)}\n\n${documentBody}\n${DOCUMENT_FOOTER}`;
}

function createPagedDocument(blocks) {
  const safeBlocks = blocks.length > 0
    ? blocks
    : [editorSchema.nodes.paragraph.createAndFill()];

  return editorSchema.nodes.doc.create(null, [
    editorSchema.nodes.page.create(
      { pageNumber: 1 },
      safeBlocks
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
          id: createParsedMathId("math"),
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

function createEmptyParagraph() {
  return editorSchema.nodes.paragraph.createAndFill();
}

function parseBlockSequence(source) {
  const cursor = source instanceof LatexCursor ? source : new LatexCursor(source);
  const blocks = [];

  while (!cursor.done) {
    if (cursor.consumeCommand("LOparagraph")) {
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
        break;
      }

      blocks.push(
        editorSchema.nodes.paragraph.create(
          {
            alignment: normalizeTextAlignment(alignment),
            lineSpacing: normalizeLineSpacing(lineSpacing),
            paragraphSpacing: normalizeParagraphSpacing(paragraphSpacing),
          },
          parseParagraphBody(body)
        )
      );
      continue;
    }

    if (cursor.consumeCommand("LOalign")) {
      const firstArg = cursor.readArgument();

      if (firstArg == null) {
        break;
      }

      let groupCount = Math.max(1, Number.parseInt(String(firstArg), 10) || 1);
      let body = cursor.readArgument();

      if (body == null) {
        body = firstArg;
        groupCount = 1;
      }

      const rowCursor = new LatexCursor(body);
      const rows = [];

      while (!rowCursor.done) {
        if (!rowCursor.consumeCommand("LOalignRow")) {
          rowCursor.index += 1;
          continue;
        }

        const rowBody = rowCursor.readArgument();

        if (rowBody == null) {
          break;
        }

        const cellCursor = new LatexCursor(rowBody);
        const cells = [];

        while (!cellCursor.done) {
          if (!cellCursor.consumeCommand("LOalignCell")) {
            cellCursor.index += 1;
            continue;
          }

          const latex = cellCursor.readArgument();
          const fontFamily = cellCursor.readArgument();
          const fontSize = cellCursor.readArgument();
          const baseTextFontSize = cellCursor.readArgument();

          if (
            latex == null ||
            fontFamily == null ||
            fontSize == null ||
            baseTextFontSize == null
          ) {
            break;
          }

          cells.push(
            editorSchema.nodes.align_math.create({
              id: createParsedMathId("align-math"),
              latex: decodeMathArg(latex),
              fontFamily: normalizeMathFontFamily(fontFamily),
              fontSize: normalizeMathFontSize(fontSize),
              baseTextFontSize: normalizeTextFontSize(baseTextFontSize),
            })
          );
        }

        const expectedCellCount = Math.max(2, groupCount * 2);

        while (cells.length < expectedCellCount) {
          cells.push(
            editorSchema.nodes.align_math.create({
              id: createParsedMathId("align-math"),
            })
          );
        }

        rows.push(
          editorSchema.nodes.align_row.create(
            null,
            cells.slice(0, expectedCellCount)
          )
        );
      }

      blocks.push(
        editorSchema.nodes.align_block.create(
          { groupCount },
          rows.length > 0
            ? rows
            : [
                editorSchema.nodes.align_row.create(
                  null,
                  Array.from({ length: groupCount * 2 }, () =>
                    editorSchema.nodes.align_math.create({
                      id: createParsedMathId("align-math"),
                    })
                  )
                ),
              ]
        )
      );
      continue;
    }

    if (cursor.consumeCommand("LOgather")) {
      const rawColumnCount = cursor.readArgument();
      const body = cursor.readArgument();

      if (rawColumnCount == null || body == null) {
        break;
      }

      const columnCount = Math.max(
        1,
        Number.parseInt(String(rawColumnCount), 10) || 1
      );
      const rowCursor = createLatexCursor(body);
      const rows = [];

      while (!rowCursor.done) {
        if (!rowCursor.consumeCommand("LOgatherRow")) {
          rowCursor.index += 1;
          continue;
        }

        const rowBody = rowCursor.readArgument();

        if (rowBody == null) {
          break;
        }

        const cellCursor = createLatexCursor(rowBody);
        const cells = [];

        while (!cellCursor.done) {
          if (!cellCursor.consumeCommand("LOgatherCell")) {
            cellCursor.index += 1;
            continue;
          }

          const latex = cellCursor.readArgument();
          const fontFamily = cellCursor.readArgument();
          const fontSize = cellCursor.readArgument();
          const baseTextFontSize = cellCursor.readArgument();

          if (
            latex == null ||
            fontFamily == null ||
            fontSize == null ||
            baseTextFontSize == null
          ) {
            break;
          }

          cells.push(
            editorSchema.nodes.gather_math.create({
              id: createParsedMathId("gather-math"),
              latex: decodeMathArg(latex),
              fontFamily: normalizeMathFontFamily(fontFamily),
              fontSize: normalizeMathFontSize(fontSize),
              baseTextFontSize: normalizeTextFontSize(baseTextFontSize),
            })
          );
        }

        const expectedCellCount = Math.max(1, columnCount);

        while (cells.length < expectedCellCount) {
          cells.push(
            editorSchema.nodes.gather_math.create({
              id: createParsedMathId("gather-math"),
            })
          );
        }

        rows.push(
          editorSchema.nodes.gather_row.create(
            null,
            cells.slice(0, expectedCellCount)
          )
        );
      }

      blocks.push(
        editorSchema.nodes.gather_block.create(
          { columnCount },
          rows.length > 0
            ? rows
            : [
                editorSchema.nodes.gather_row.create(
                  null,
                  Array.from({ length: columnCount }, () =>
                    editorSchema.nodes.gather_math.create({
                      id: createParsedMathId("gather-math"),
                    })
                  )
                ),
              ]
        )
      );
      continue;
    }

    if (cursor.consumeCommand("LOtable")) {
      const firstArg = cursor.readArgument();

      if (firstArg == null) {
        break;
      }

      let tableStyle = normalizeTableStyle(firstArg);
      let body = cursor.readArgument();

      if (body == null) {
        body = firstArg;
        tableStyle = normalizeTableStyle(null);
      }

      const rowCursor = new LatexCursor(body);
      const rows = [];

      while (!rowCursor.done) {
        if (!rowCursor.consumeCommand("LOtableRow")) {
          rowCursor.index += 1;
          continue;
        }

        const rowBody = rowCursor.readArgument();

        if (rowBody == null) {
          break;
        }

        const cellCursor = new LatexCursor(rowBody);
        const cells = [];

        while (!cellCursor.done) {
          if (!cellCursor.consumeCommand("LOtableCell")) {
            cellCursor.index += 1;
            continue;
          }

          const cellBody = cellCursor.readArgument();

          if (cellBody == null) {
            break;
          }

          const cellBlocks = parseBlockSequence(cellBody);
          cells.push(
            editorSchema.nodes.table_cell.create(
              null,
              cellBlocks.length > 0 ? cellBlocks : [createEmptyParagraph()]
            )
          );
        }

        rows.push(
          editorSchema.nodes.table_row.create(
            null,
            cells.length > 0
              ? cells
              : [
                  editorSchema.nodes.table_cell.create(
                    null,
                    [createEmptyParagraph()]
                  ),
                ]
          )
        );
      }

      blocks.push(
        editorSchema.nodes.table.create(
          { tableStyle },
          rows.length > 0
            ? rows
            : [
                editorSchema.nodes.table_row.create(
                  null,
                  [
                    editorSchema.nodes.table_cell.create(
                      null,
                      [createEmptyParagraph()]
                    ),
                  ]
                ),
              ]
        )
      );
      continue;
    }

    if (cursor.consumeCommand("LOlist")) {
      const listType = cursor.readArgument();
      const body = cursor.readArgument();

      if (listType == null || body == null) {
        break;
      }

      const itemCursor = new LatexCursor(body);
      const items = [];

      while (!itemCursor.done) {
        if (!itemCursor.consumeCommand("LOitem")) {
          itemCursor.index += 1;
          continue;
        }

        const itemBody = itemCursor.readArgument();

        if (itemBody == null) {
          break;
        }

        const itemBlocks = parseBlockSequence(itemBody);
        items.push(
          editorSchema.nodes.list_item.create(
            null,
            itemBlocks.length > 0 ? itemBlocks : [createEmptyParagraph()]
          )
        );
      }

      const normalizedListType = listType === "bullet"
        ? "bullet"
        : normalizeOrderedListStyle(listType);
      const listNodeType = normalizedListType === "bullet"
        ? editorSchema.nodes.bullet_list
        : editorSchema.nodes.ordered_list;
      const listAttrs = listNodeType === editorSchema.nodes.ordered_list
        ? {
            order: 1,
            listStyle: normalizedListType,
          }
        : null;

      blocks.push(
        listNodeType.create(
          listAttrs,
          items.length > 0 ? items : [editorSchema.nodes.list_item.create(null, [createEmptyParagraph()])]
        )
      );
      continue;
    }

    cursor.index += 1;
  }

  return blocks;
}

export function parseLatexDocument(source) {
  if (!source || !source.trim()) {
    return {
      doc: createPagedDocument([]),
      pageSettings: createDefaultPageSettings(),
    };
  }

  const cursor = new LatexCursor(extractDocumentBody(source));
  const blocks = [];
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

    const nextBlocks = parseBlockSequence(cursor);

    if (nextBlocks.length === 0) {
      cursor.index += 1;
      continue;
    }

    blocks.push(...nextBlocks);
  }

  if (blocks.length === 0) {
    return {
      doc: createPagedDocument([]),
      pageSettings,
    };
  }

  return {
    doc: createPagedDocument(blocks),
    pageSettings,
  };
}
