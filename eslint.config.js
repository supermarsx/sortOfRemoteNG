import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

const tsParser = {
  ...tseslint.parser,
  parseForESLint(code, options) {
    const result = tseslint.parser.parseForESLint(code, options);
    if (
      result.scopeManager &&
      typeof result.scopeManager.addGlobals !== "function"
    ) {
      // ESLint 10 calls this hook even when no config globals are declared.
      result.scopeManager.addGlobals = () => {};
    }
    return result;
  },
};

const reactHooksRules = {
  "react-hooks/rules-of-hooks": "error",
  "react-hooks/exhaustive-deps": "warn",
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "target/**",
      "src-tauri/target/**",
      "node_modules/**",
      ".next/**",
      ".next-tauri-dev/**",
      ".claude/**",
      ".copilot/**",
      ".orchestration/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      parser: tsParser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "@next/next": nextPlugin,
      /* Transitional alias for the oxlint migration (t80). oxlint renames these
         three rules, so inline suppressions must name BOTH spellings to satisfy
         either linter. ESLint 10 errors on an unknown rule name in a disable
         directive, so the oxlint names are registered here pointing at the same
         upstream implementations and left switched off — they never
         double-report. Removed together with this file at the cutover. */
      react: {
        rules: {
          "exhaustive-deps": reactHooks.rules["exhaustive-deps"],
          hooks: reactHooks.rules["rules-of-hooks"],
          "only-export-components":
            reactRefresh.rules["only-export-components"],
        },
      },
    },
    /* Paired with the alias above: a dual-named directive is "unused" from
       ESLint's side, which would otherwise report 135 warnings. */
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      ...reactHooksRules,
      ...nextPlugin.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off",
      "no-useless-assignment": "off",
      "no-useless-escape": "off",
      "no-case-declarations": "off",
      "preserve-caught-error": "off",
      "@next/next/no-html-link-for-pages": "off", // Allow custom routing
      "@next/next/no-img-element": "off", // Tauri/Vite app, not Next.js — no Image component available
    },
  },
  {
    files: ["src/hooks/ssh/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "VariableDeclarator[id.type='ArrayPattern'][id.elements.0.type='Identifier'][id.elements.0.name=/^(?!has)[A-Za-z0-9_]*(password|passphrase|secret)[A-Za-z0-9_]*$/i][init.type='CallExpression'][init.callee.name='useState']",
          message:
            "Do not store SSH secrets in React state. Use refs and explicit scrubbing instead.",
        },
      ],
    },
  },
);
