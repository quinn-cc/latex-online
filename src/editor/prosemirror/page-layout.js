import { TextSelection } from "prosemirror-state";
import { editorSchema } from "./schema.js";

export function createEmptySelectionState(doc) {
  return TextSelection.atStart(doc);
}

export function createPageNode(blocks, pageNumber) {
  return editorSchema.nodes.page.create(
    { pageNumber },
    blocks.length > 0 ? blocks : [editorSchema.nodes.paragraph.createAndFill()]
  );
}

export function flattenPageBlocks(doc) {
  const blocks = [];

  doc.forEach((pageNode) => {
    if (pageNode.type !== editorSchema.nodes.page) {
      return;
    }

    pageNode.forEach((blockNode) => {
      blocks.push(blockNode);
    });
  });

  return blocks;
}

export function getCurrentPageBlockCounts(doc) {
  const counts = [];

  doc.forEach((pageNode) => {
    if (pageNode.type === editorSchema.nodes.page) {
      counts.push(pageNode.childCount);
    }
  });

  return counts.length > 0 ? counts : [1];
}

export function arePageCountsEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((count, index) => count === right[index]);
}

export function createBlockPositionList(doc) {
  const positions = [];

  doc.forEach((pageNode, pagePos) => {
    if (pageNode.type !== editorSchema.nodes.page) {
      return;
    }

    pageNode.forEach((blockNode, blockOffset) => {
      positions.push({
        node: blockNode,
        pos: pagePos + 1 + blockOffset,
      });
    });
  });

  return positions;
}

export function measureBlockHeight(element) {
  if (!(element instanceof HTMLElement)) {
    return 0;
  }

  const styles = getComputedStyle(element);
  const marginTop = Number.parseFloat(styles.marginTop || "0") || 0;
  const marginBottom = Number.parseFloat(styles.marginBottom || "0") || 0;

  return element.offsetHeight + marginTop + marginBottom;
}

export function createSelectionAnchor(doc, pos, assoc = 1) {
  const positions = createBlockPositionList(doc);
  const clampedPos = Math.max(0, Math.min(pos, doc.content.size));

  for (let index = 0; index < positions.length; index += 1) {
    const entry = positions[index];
    const start = entry.pos + 1;
    const end = entry.pos + entry.node.nodeSize - 1;

    if (clampedPos < start) {
      return {
        blockIndex: index,
        innerOffset: 0,
        assoc: -1,
      };
    }

    if (clampedPos <= end) {
      return {
        blockIndex: index,
        innerOffset: Math.max(0, Math.min(clampedPos - start, entry.node.content.size)),
        assoc,
      };
    }
  }

  const lastEntry = positions.at(-1);

  if (!lastEntry) {
    return {
      blockIndex: 0,
      innerOffset: 0,
      assoc: 1,
    };
  }

  return {
    blockIndex: positions.length - 1,
    innerOffset: lastEntry.node.content.size,
    assoc: 1,
  };
}

export function resolveSelectionAnchor(doc, anchor) {
  const positions = createBlockPositionList(doc);
  const entry = positions[Math.max(0, Math.min(anchor.blockIndex, positions.length - 1))];

  if (!entry) {
    return 1;
  }

  const pos = entry.pos + 1 + Math.max(0, Math.min(anchor.innerOffset, entry.node.content.size));
  return Math.max(1, Math.min(pos, doc.content.size));
}
