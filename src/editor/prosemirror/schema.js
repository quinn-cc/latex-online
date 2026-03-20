import { Schema } from "prosemirror-model";
import {
  DEFAULT_MATH_STYLE,
  DEFAULT_TEXT_TOOLBAR_STATE,
} from "../../core/config.js";
import {
  getTextFontFamilyCssValue,
  getTextFontSizePx,
  normalizeLineSpacing,
  normalizeMathFontFamily,
  normalizeMathFontSize,
  normalizeParagraphSpacing,
  normalizeTextAlignment,
  normalizeTextFontFamily,
  normalizeTextFontSize,
} from "./options.js";

const PAGE_HINT_TEXT =
  "Type normal text directly on the page. Press $ to enter inline math. Inside math, Tab moves through groups, and $ or Esc returns to text.";

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

export const editorSchema = new Schema({
  nodes: {
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
      attrs: {
        id: { default: "" },
        latex: { default: "" },
        fontFamily: { default: DEFAULT_MATH_STYLE.fontFamily },
        fontSize: { default: DEFAULT_MATH_STYLE.fontSize },
        baseTextFontSize: { default: DEFAULT_TEXT_TOOLBAR_STATE.fontSize },
      },
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
        const baseTextFontSize = normalizeTextFontSize(node.attrs.baseTextFontSize);

        return [
          "span",
          {
            class: "pm-inline-math",
            "data-inline-math": "true",
            "data-math-id": node.attrs.id,
            "data-latex": node.attrs.latex,
            "data-math-font-family": normalizeMathFontFamily(node.attrs.fontFamily),
            "data-math-font-size": normalizeMathFontSize(node.attrs.fontSize),
            "data-base-text-font-size": baseTextFontSize,
            style: `font-size: ${getTextFontSizePx(baseTextFontSize)}px`,
          },
        ];
      },
    },
  },
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
