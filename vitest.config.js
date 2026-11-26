import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { rapierWasmPlugin } from './build/rapier-wasm-plugin.js';

export default defineConfig({
  plugins: [rapierWasmPlugin()],
  resolve: {
    alias: {
      'dice-so-nice/api.js': fileURLToPath(new URL('./tests/helpers/dsn-api.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    // The Rapier package is ESM in a non-"type: module" package: let Vite transform it.
    server: { deps: { inline: [/@dimforge\/rapier3d-deterministic/] } },
  },
});
