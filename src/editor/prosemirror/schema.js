import { Schema } from "prosemirror-model";
import OrderedMap from "orderedmap";
import {
  DEFAULT_MATH_STYLE,
  DEFAULT_TEXT_TOOLBAR_STATE,
} from "../../core/config.js";
import { addListNodes } from "../../../vendor/prosemirror-schema-list/dist/index.js";
import {
  getTextFontFamilyCssValue,
  getTextFontSizePx,
  normalizeLineSpacing,
  normalizeMathFontFamily,
  normalizeMathFontSize,
  normalizeOrderedListStyle,
  normalizeParagraphSpacing,
  normalizeTextAlignment,
  normalizeTextFontFamily,
  normalizeTextFontSize,
} from "./options.js";
import { DEFAULT_TABLE_STYLE, normalizeTableStyle } from "./table-styles.js";

const PAGE_HINT_TEXT =
  "Type normal text directly on the page. Press $ for inline math or [ for display math. Inside math, Tab moves through groups, and $ or Esc returns to text.";

function createMathNodeAttrs() {
  return {
    id: { default: "" },
    latex: { default: "" },
    fontFamily: { default: DEFAULT_MATH_STYLE.fontFamily },
    fontSize: { default: DEFAULT_MATH_STYLE.fontSize },
    baseTextFontSize: { default: DEFAULT_TEXT_TOOLBAR_STATE.fontSize },
  };
}

function getMathDomAttrs(node, variant) {
  const baseTextFontSize = normalizeTextFontSize(node.attrs.baseTextFontSize);
  const className = variant === "display"
    ? "pm-display-math"
    : variant === "align"
      ? "pm-align-math"
      : variant === "gather"
        ? "pm-gather-math"
      : "pm-inline-math";
  const dataAttributeName = variant === "display"
    ? "data-block-math"
    : variant === "align"
      ? "data-align-math"
      : variant === "gather"
        ? "data-gather-math"
      : "data-inline-math";

  return {
    class: className,
    [dataAttributeName]: "true",
    ...(variant === "inline" ? { "data-widget-root": "inline_math" } : {}),
    "data-math-id": node.attrs.id,
    "data-latex": node.attrs.latex,
    "data-math-font-family": normalizeMathFontFamily(node.attrs.fontFamily),
    "data-math-font-size": normalizeMathFontSize(node.attrs.fontSize),
    "data-base-text-font-size": baseTextFontSize,
    style: `font-size: ${getTextFontSizePx(baseTextFontSize)}px`,
  };
}

function createPageDomSpec(pageNumber) {
  return [
    "section",
    {
      class: "pm-page-shell",
      "data-page-node": "true",
      "data-page-number": String(pageNumber),
    },
    [
      "article",
      {
        class: "pm-page",
        "data-page-surface": "true",
        "data-page-number": String(pageNumber),
      },
      [
        "div",
        {
          class: "page-chrome page-header",
          "data-page-header": "true",
          hidden: "hidden",
        },
        ["span", { class: "page-chrome-text", "data-page-header-text": "true" }],
        [
          "span",
          {
            class: "page-chrome-number page-chrome-number-right",
            "data-page-header-right-number": "true",
          },
        ],
      ],
      [
        "div",
        { class: "page-content" },
        [
          "div",
          { class: "pm-page-body" },
          ["div", { class: "page-guide-frame", "aria-hidden": "true" }],
          [
            "div",
            { class: "page-column-guides", "aria-hidden": "true" },
            ["span", { class: "page-column-guide" }],
            ["span", { class: "page-column-guide" }],
            ["span", { class: "page-column-guide" }],
          ],
          [
            "p",
            {
              class: "page-hint",
              "data-page-hint": "true",
              hidden: "hidden",
            },
            PAGE_HINT_TEXT,
          ],
          ["div", { class: "pm-page-content", "data-page-content": "true" }, 0],
        ],
      ],
      [
        "div",
        {
          class: "page-chrome page-footer",
          "data-page-footer": "true",
          hidden: "hidden",
        },
        ["span", { class: "page-chrome-text", "data-page-footer-text": "true" }],
        [
          "span",
          {
            class: "page-chrome-number page-chrome-number-center",
            "data-page-footer-center-number": "true",
          },
        ],
        [
          "span",
          {
            class: "page-chrome-number page-chrome-number-right",
            "data-page-footer-right-number": "true",
          },
        ],
      ],
    ],
  ];
}

function paragraphDomAttrs(node) {
  const alignment = normalizeTextAlignment(node.attrs.alignment);
  const lineSpacing = normalizeLineSpacing(node.attrs.lineSpacing);
  const paragraphSpacing = normalizeParagraphSpacing(node.attrs.paragraphSpacing);

  return [
    "p",
    {
      class: "pm-paragraph",
      "data-align": alignment,
      "data-line-spacing": lineSpacing,
      "data-paragraph-spacing": paragraphSpacing,
      style: [
        `text-align: ${alignment}`,
        `--line-spacing: ${lineSpacing}`,
        `--paragraph-spacing: ${paragraphSpacing}em`,
      ].join("; "),
    },
    0,
  ];
}

function orderedListDomAttrs(node) {
  const order = Number.isFinite(node.attrs.order) ? Math.max(1, node.attrs.order) : 1;
  const listStyle = normalizeOrderedListStyle(node.attrs.listStyle);
  const attrs = {
    class: "pm-ordered-list",
    "data-list-style": listStyle,
    style: `--list-start: ${order};`,
  };

  if (order !== 1) {
    attrs.start = String(order);
  }

  return ["ol", attrs, 0];
}

const bulletListDom = ["ul", { class: "pm-bullet-list" }, 0];
const listItemDom = ["li", { class: "pm-list-item" }, 0];
function tableDomAttrs(node) {
  return [
    "table",
    {
      class: "pm-table",
      "data-widget-root": "table",
      "data-table-style": normalizeTableStyle(node.attrs.tableStyle),
    },
    ["tbody", 0],
  ];
}

const tableRowDom = ["tr", { class: "pm-table-row" }, 0];
const tableCellDom = ["td", { class: "pm-table-cell" }, 0];
const alignRowDom = ["tr", { class: "pm-align-row" }, 0];
const gatherRowDom = ["tr", { class: "pm-gather-row" }, 0];

function alignBlockDomAttrs(node) {
  const groupCount = Math.max(
    1,
    Number.parseInt(String(node.attrs.groupCount ?? 1), 10) || 1
  );

  return [
    "table",
    {
      class: "pm-align-block",
      "data-widget-root": "align",
      "data-align-block": "true",
      "data-align-group-count": String(groupCount),
      style: `--align-column-count: ${groupCount * 2};`,
    },
    ["tbody", 0],
  ];
}

function gatherBlockDomAttrs(node) {
  const columnCount = Math.max(
    1,
    Number.parseInt(String(node.attrs.columnCount ?? 1), 10) || 1
  );

  return [
    "table",
    {
      class: "pm-gather-block",
      "data-widget-root": "gather",
      "data-gather-block": "true",
      "data-gather-column-count": String(columnCount),
      style: `--gather-column-count: ${columnCount};`,
    },
    ["tbody", 0],
  ];
}

const baseNodes = {
  doc: {
    content: "page+",
  },
  page: {
    content: "block+",
    attrs: {
      pageNumber: { default: 1 },
    },
    parseDOM: [
      {
        tag: "section[data-page-node]",
        getAttrs(dom) {
          const element = dom instanceof HTMLElement ? dom : null;
          const parsedNumber = Number.parseInt(
            element?.getAttribute("data-page-number") ?? "1",
            10
          );

          return {
            pageNumber: Number.isFinite(parsedNumber) && parsedNumber > 0
              ? parsedNumber
              : 1,
          };
        },
      },
    ],
    toDOM(node) {
      const pageNumber = Number.isFinite(node.attrs.pageNumber)
        ? Math.max(1, Math.floor(node.attrs.pageNumber))
        : 1;

      return createPageDomSpec(pageNumber);
    },
  },
  paragraph: {
    group: "block",
    content: "inline*",
    attrs: {
      alignment: { default: DEFAULT_TEXT_TOOLBAR_STATE.alignment },
      lineSpacing: { default: DEFAULT_TEXT_TOOLBAR_STATE.lineSpacing },
      paragraphSpacing: { default: DEFAULT_TEXT_TOOLBAR_STATE.paragraphSpacing },
    },
    parseDOM: [
      {
        tag: "p",
        getAttrs(dom) {
          const element = dom instanceof HTMLElement ? dom : null;

          return {
            alignment: normalizeTextAlignment(
              element?.getAttribute("data-align") ?? element?.style.textAlign
            ),
            lineSpacing: normalizeLineSpacing(
              element?.getAttribute("data-line-spacing")
            ),
            paragraphSpacing: normalizeParagraphSpacing(
              element?.getAttribute("data-paragraph-spacing")
            ),
          };
        },
      },
    ],
    toDOM(node) {
      return paragraphDomAttrs(node);
    },
  },
  text: {
    group: "inline",
  },
  inline_math: {
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    marks: "",
    attrs: createMathNodeAttrs(),
    parseDOM: [
      {
        tag: "span[data-inline-math]",
        getAttrs(dom) {
          const element = dom instanceof HTMLElement ? dom : null;

          return {
            id: element?.getAttribute("data-math-id") ?? "",
            latex: element?.getAttribute("data-latex") ?? "",
            fontFamily: normalizeMathFontFamily(
              element?.getAttribute("data-math-font-family")
            ),
            fontSize: normalizeMathFontSize(
              element?.getAttribute("data-math-font-size")
            ),
            baseTextFontSize: normalizeTextFontSize(
              element?.getAttribute("data-base-text-font-size")
            ),
          };
        },
      },
    ],
    toDOM(node) {
      return ["span", getMathDomAttrs(node, "inline")];
    },
  },
  align_block: {
    group: "block",
    content: "align_row+",
    isolating: true,
    attrs: {
      groupCount: { default: 1 },
    },
    parseDOM: [
      {
        tag: "table.pm-align-block",
        getAttrs(dom) {
          const element = dom instanceof HTMLElement ? dom : null;
          const parsedGroupCount = Number.parseInt(
            element?.getAttribute("data-align-group-count") ?? "1",
            10
          );

          return {
            groupCount:
              Number.isFinite(parsedGroupCount) && parsedGroupCount > 0
                ? parsedGroupCount
                : 1,
          };
        },
      },
    ],
    toDOM(node) {
      return alignBlockDomAttrs(node);
    },
  },
  align_row: {
    content: "align_math+",
    isolating: true,
    parseDOM: [
      {
        tag: "tr.pm-align-row",
      },
    ],
    toDOM() {
      return alignRowDom;
    },
  },
  align_math: {
    atom: true,
    selectable: true,
    marks: "",
    attrs: createMathNodeAttrs(),
    parseDOM: [
      {
        tag: "td[data-align-math]",
        getAttrs(dom) {
          const element = dom instanceof HTMLElement ? dom : null;

          return {
            id: element?.getAttribute("data-math-id") ?? "",
            latex: element?.getAttribute("data-latex") ?? "",
            fontFamily: normalizeMathFontFamily(
              element?.getAttribute("data-math-font-family")
            ),
            fontSize: normalizeMathFontSize(
              element?.getAttribute("data-math-font-size")
            ),
            baseTextFontSize: normalizeTextFontSize(
              element?.getAttribute("data-base-text-font-size")
            ),
          };
        },
      },
    ],
    toDOM(node) {
      return ["td", getMathDomAttrs(node, "align")];
    },
  },
  gather_block: {
    group: "block",
    content: "gather_row+",
    isolating: true,
    attrs: {
      columnCount: { default: 1 },
    },
    parseDOM: [
      {
        tag: "table.pm-gather-block",
        getAttrs(dom) {
          const element = dom instanceof HTMLElement ? dom : null;
          const parsedColumnCount = Number.parseInt(
            element?.getAttribute("data-gather-column-count") ?? "1",
            10
          );

          return {
            columnCount:
              Number.isFinite(parsedColumnCount) && parsedColumnCount > 0
                ? parsedColumnCount
                : 1,
          };
        },
      },
    ],
    toDOM(node) {
      return gatherBlockDomAttrs(node);
    },
  },
  gather_row: {
    content: "gather_math+",
    isolating: true,
    parseDOM: [
      {
        tag: "tr.pm-gather-row",
      },
    ],
    toDOM() {
      return gatherRowDom;
    },
  },
  gather_math: {
    atom: true,
    selectable: true,
    marks: "",
    attrs: createMathNodeAttrs(),
    parseDOM: [
      {
        tag: "td[data-gather-math]",
        getAttrs(dom) {
          const element = dom instanceof HTMLElement ? dom : null;

          return {
            id: element?.getAttribute("data-math-id") ?? "",
            latex: element?.getAttribute("data-latex") ?? "",
            fontFamily: normalizeMathFontFamily(
              element?.getAttribute("data-math-font-family")
            ),
            fontSize: normalizeMathFontSize(
              element?.getAttribute("data-math-font-size")
            ),
            baseTextFontSize: normalizeTextFontSize(
              element?.getAttribute("data-base-text-font-size")
            ),
          };
        },
      },
    ],
    toDOM(node) {
      return ["td", getMathDomAttrs(node, "gather")];
    },
  },
  table: {
    group: "block",
    content: "table_row+",
    tableRole: "table",
    isolating: true,
    attrs: {
      tableStyle: { default: DEFAULT_TABLE_STYLE },
    },
    parseDOM: [
      {
        tag: "table.pm-table",
        getAttrs(dom) {
          const element = dom instanceof HTMLElement ? dom : null;

          return {
            tableStyle: normalizeTableStyle(
              element?.getAttribute("data-table-style")
            ),
          };
        },
      },
    ],
    toDOM(node) {
      return tableDomAttrs(node);
    },
  },
  table_row: {
    content: "table_cell+",
    tableRole: "row",
    parseDOM: [
      {
        tag: "tr.pm-table-row",
      },
    ],
    toDOM() {
      return tableRowDom;
    },
  },
  table_cell: {
    content: "paragraph block*",
    isolating: true,
    tableRole: "cell",
    parseDOM: [
      {
        tag: "td.pm-table-cell",
      },
      {
        tag: "th.pm-table-cell",
      },
    ],
    toDOM() {
      return tableCellDom;
    },
  },
};

let schemaNodes = addListNodes(OrderedMap.from(baseNodes), "paragraph block*", "block");

schemaNodes = schemaNodes.update("ordered_list", {
  ...schemaNodes.get("ordered_list"),
  attrs: {
    ...schemaNodes.get("ordered_list").attrs,
    listStyle: { default: "decimal-period" },
  },
  parseDOM: [
    {
      tag: "ol",
      getAttrs(dom) {
        const element = dom instanceof HTMLOListElement ? dom : null;
        const styleValue = element?.getAttribute("data-list-style")
          ?? element?.style.listStyleType
          ?? "decimal";

        return {
          order: element?.hasAttribute("start") ? Number(element.getAttribute("start")) : 1,
          listStyle: normalizeOrderedListStyle(styleValue),
        };
      },
    },
  ],
  toDOM(node) {
    return orderedListDomAttrs(node);
  },
});

schemaNodes = schemaNodes.update("bullet_list", {
  ...schemaNodes.get("bullet_list"),
  toDOM() {
    return bulletListDom;
  },
});

schemaNodes = schemaNodes.update("list_item", {
  ...schemaNodes.get("list_item"),
  toDOM() {
    return listItemDom;
  },
});

export const editorSchema = new Schema({
  nodes: schemaNodes,
  marks: {
    bold: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM() {
        return ["strong", 0];
      },
    },
    italic: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM() {
        return ["em", 0];
      },
    },
    underline: {
      parseDOM: [
        { tag: "u" },
        {
          style: "text-decoration",
          getAttrs(value) {
            return String(value ?? "").includes("underline") ? {} : false;
          },
        },
      ],
      toDOM() {
        return ["u", 0];
      },
    },
    text_font_family: {
      attrs: {
        value: { default: DEFAULT_TEXT_TOOLBAR_STATE.fontFamily },
      },
      excludes: "text_font_family",
      parseDOM: [
        {
          tag: "span[data-text-font-family]",
          getAttrs(dom) {
            const element = dom instanceof HTMLElement ? dom : null;
            return {
              value: normalizeTextFontFamily(
                element?.getAttribute("data-text-font-family")
              ),
            };
          },
        },
      ],
      toDOM(mark) {
        const value = normalizeTextFontFamily(mark.attrs.value);
        const cssValue = getTextFontFamilyCssValue(value);

        return [
          "span",
          {
            "data-text-font-family": value,
            style: cssValue ? `font-family: ${cssValue}` : null,
          },
          0,
        ];
      },
    },
    text_font_size: {
      attrs: {
        value: { default: DEFAULT_TEXT_TOOLBAR_STATE.fontSize },
      },
      excludes: "text_font_size",
      parseDOM: [
        {
          tag: "span[data-text-font-size]",
          getAttrs(dom) {
            const element = dom instanceof HTMLElement ? dom : null;
            return {
              value: normalizeTextFontSize(
                element?.getAttribute("data-text-font-size")
              ),
            };
          },
        },
      ],
      toDOM(mark) {
        const value = normalizeTextFontSize(mark.attrs.value);

        return [
          "span",
          {
            "data-text-font-size": value,
            style: `font-size: ${getTextFontSizePx(value)}px`,
          },
          0,
        ];
      },
    },
  },
});
