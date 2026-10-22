import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.pnpm-store/**',
      '**/*.d.ts',
      'apps/backend/prisma/migrations/**',
      'infra/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['apps/frontend/**/*.ts', 'apps/frontend/**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    // UI contract (docs/ui/STYLE_SOURCES.md): visuals come from tokens and shared components.
    files: ['apps/frontend/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Используйте Select / SelectField из shared/ui/searchable-select вместо нативного <select>.',
        },
        {
          selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value=/^(date|datetime-local|month)$/]",
          message: 'Используйте DatePicker из shared/ui/date-picker вместо нативного поля даты.',
        },
        {
          selector: "JSXAttribute[name.name='style'] Literal[value=/#[0-9a-fA-F]{3,8}\\b|rgba?\\(/]",
          message: 'Цвета берутся из токенов --ui-* (design-tokens.css), не из inline-стилей.',
        },
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)(status-pill|inline-notice|button-link|button-secondary|button-danger)(\\s|$)/]",
          message: 'Устаревший класс: используйте StatusBadge, Alert, ButtonLink или Button из shared/ui/foundation.',
        },
        {
          selector: "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(^|\\s)(status-pill|inline-notice|button-link|button-secondary|button-danger)(\\s|$)/]",
          message: 'Устаревший класс: используйте StatusBadge, Alert, ButtonLink или Button из shared/ui/foundation.',
        },
      ],
    },
  },
  {
    files: ['apps/backend/**/*.ts', 'packages/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
