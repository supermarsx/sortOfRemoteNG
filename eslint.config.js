import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target/**", "node_modules/**", ".next/**"] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "@next/next": nextPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-useless-escape": "off",
      "no-case-declarations": "off",
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
