import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

export default [
  // 1. Lintの対象外にするディレクトリ
  {
    ignores: [
      '**/dist/**',
      '**/dist-electron/**',
      '**/node_modules/**',
      '.bun/**',
      '**/coverage/**'
    ]
  },

  // 2. 基本的な推奨ルール（JavaScript, TypeScript, Vue）
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  // 3. Vueファイルに対するTypeScriptパーサーの設定
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        sourceType: 'module'
      }
    }
  },

  // 4. プロジェクト特有のカスタムルール
  {
    rules: {
      // Vueコンポーネント名を複数単語にしなくてもエラーにしない
      'vue/multi-word-component-names': 'off',
      // any型の使用をエラーではなく警告に留める（既存コードにanyがあるため）
      '@typescript-eslint/no-explicit-any': 'warn',
      // 未使用変数はエラーにする
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-useless-assignment': 'off',
      'no-undef': 'off',
    }
  }
];