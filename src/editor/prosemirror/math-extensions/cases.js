import { buildMathArrayTemplate, createMathArrayExtension } from "./array-structures.js";

export const CASES_TEMPLATE = buildMathArrayTemplate("cases");

export function createCasesMathExtension() {
  return createMathArrayExtension("cases");
}
