'use strict';

let recommendedRules = {};
try {
  recommendedRules = require('@eslint/js').configs.recommended.rules;
} catch {
  /* fall back to the explicit rules below */
}

const sharedRules = {
  ...recommendedRules,
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-undef': 'error',
};

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  process: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  structuredClone: 'readonly',
  WebSocket: 'readonly',
  fetch: 'readonly',
  crypto: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  confirm: 'readonly',
  requestAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  structuredClone: 'readonly',
  btoa: 'readonly',
  atob: 'readonly',
  Event: 'readonly',
};

module.exports = [
  {
    files: ['src/main.js', 'src/preload.js', 'test/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: nodeGlobals },
    rules: sharedRules,
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: browserGlobals },
    rules: sharedRules,
  },
];
