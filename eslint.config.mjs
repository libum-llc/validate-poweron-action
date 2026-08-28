import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: {
    extends: ['eslint:recommended'],
  },
});

const eslintConfig = [
  ...compat.config({
    extends: ['plugin:@typescript-eslint/recommended', 'prettier'],
    plugins: ['@typescript-eslint', 'prettier'],
    parserOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
    },
    rules: {
      'prettier/prettier': [
        'error',
        {
          endOfLine: 'auto',
          printWidth: 80,
          singleQuote: true,
          tabWidth: 2,
          trailingComma: 'all',
          plugins: [],
        },
      ],
      '@typescript-eslint/no-duplicate-enum-values': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
    ignorePatterns: ['node_modules/*', 'dist/*'],
  }),
];

export default eslintConfig;
