import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Outcome words may only be produced by lib/outcomes.ts, which derives them
// from engine data. Authoring them anywhere else is how a hard-coded
// "Occurs"/"Prevented" would sneak into a component (spec §9.2).
const OUTCOME = "\\b(occurs?|prevented)\\b";
const outcomeSelectors = [
  { selector: `Literal[value=/${OUTCOME}/i]`, message: "Outcome words (occurs/prevented) are generated from traces in lib/outcomes.ts; do not author them here." },
  { selector: `TemplateElement[value.raw=/${OUTCOME}/i]`, message: "Outcome words (occurs/prevented) are generated from traces in lib/outcomes.ts; do not author them here." },
  { selector: `JSXText[value=/${OUTCOME}/i]`, message: "Outcome words (occurs/prevented) are generated from traces in lib/outcomes.ts; do not author them here." },
];

// Spec §10.1: render everything as React text nodes.
const unsafeSelectors = [
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "dangerouslySetInnerHTML is banned (spec §10.1)." },
  { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]", message: "innerHTML and friends are banned (spec §10.1)." },
  { selector: "Property[key.name='dangerouslySetInnerHTML']", message: "dangerouslySetInnerHTML is banned (spec §10.1)." },
  { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]", message: "document.write is banned." },
];

export default tseslint.config(
  { ignores: [".next/**", "out/**", "node_modules/**", "public/**", "playwright-report/**", "test-results/**", ".lighthouseci/**", "scripts/**", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": ["error", ...unsafeSelectors, ...outcomeSelectors],
    },
  },
  {
    // The single place where outcome words are derived from data.
    files: ["lib/outcomes.ts"],
    rules: { "no-restricted-syntax": ["error", ...unsafeSelectors] },
  },
  {
    // Config files: Node globals, and they define the rule's own patterns.
    files: ["*.mjs", "*.config.ts"],
    languageOptions: { globals: { URL: "readonly", process: "readonly" } },
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // Tests and e2e legitimately mention the words when asserting on them.
    files: ["**/*.test.ts", "**/*.test.tsx", "e2e/**", "tests/**", "playwright.config.ts", "vitest.config.ts"],
    rules: { "no-restricted-syntax": ["error", ...unsafeSelectors] },
  },
);
