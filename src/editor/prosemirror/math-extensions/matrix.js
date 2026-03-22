import { buildMathArrayTemplate, createMathArrayExtension } from "./array-structures.js";

export const MATRIX_TEMPLATE = buildMathArrayTemplate("matrix", {
  commandName: "bmatrix",
});

export function createMatrixMathExtension() {
  return createMathArrayExtension("matrix");
}
