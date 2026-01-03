import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import nextConfig from '@next/eslint-config-next';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target/**', 'node_modules/**', '.next/**'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...nextConfig.configs.recommended.rules,
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-useless-escape': 'off',
      'no-case-declarations': 'off',
      '@next/next/no-html-link-for-pages': 'off', // Allow custom routing
    },
  }
);
