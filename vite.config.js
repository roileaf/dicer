import { defineConfig } from 'vite';
import { rapierWasmPlugin } from './build/rapier-wasm-plugin.js';
import { minifyChunksPlugin } from './build/minify-plugin.js';
import { dracoDecoderPlugin } from './build/draco-plugin.js';
import { glslMinifyPlugin } from './build/glsl-minify-plugin.js';

// scripts/bundle-report.mjs sets this: sourcemaps that map minified bytes back to src/ files.
const REPORT = process.env.BUNDLE_REPORT === '1';

// Dicer v2 runs on Dice So Nice: three.js and DsN's API classes come from DsN's own files, never
// a bundled copy (DsN note, section 2). Paths are relative to dist/, where every chunk sits:
// Foundry serves modules/dicer/dist/ next to modules/dice-so-nice/.
export const DSN_PATHS = {
  three: '../../dice-so-nice/libs/three.module.min.js',
  'dice-so-nice/api.js': '../../dice-so-nice/api.js',
};

export default defineConfig({
  root: '.',
  // Relative asset URLs: Foundry serves the module from /modules/dicer/dist/.
  base: './',
  plugins: [
    rapierWasmPlugin(),
    glslMinifyPlugin(),
    minifyChunksPlugin({ sourcemap: REPORT }),
    dracoDecoderPlugin(),
  ],
  worker: {
    format: 'es',
    plugins: () => [rapierWasmPlugin(), minifyChunksPlugin({ sourcemap: REPORT })],
  },
  // Dev: pre-bundling would give the package and sim.js's deep glue import two separate copies
  // of the wasm-bindgen glue (the wasm is bound to one of them), so keep it unbundled.
  optimizeDeps: { exclude: ['@dimforge/rapier3d-deterministic'] },
  server: { open: '/dev/preview.html' },
  build: {
    lib: {
      entry: 'src/v2/main.js',
      formats: ['es'],
      fileName: () => 'dicer.js',
    },
    minify: 'esbuild', // see build/minify-plugin.js for the whitespace pass
    assetsInlineLimit: 0, // never base64 the wasm (lib mode inlines assets by default)
    sourcemap: REPORT,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // dist/dicer.js keeps the code (no facade re-exporting a hashed chunk) and also exports
      // what the lazy model-loader chunk shares with it.
      preserveEntrySignatures: 'allow-extension',
      // three (ours and three/examples/jsm's) and DsN's api.js load from DsN's module folder
      external: Object.keys(DSN_PATHS),
      // The pet chunk (src/pet/chunk/pets.js) is named pet-*.js and the rolling-by-hand chunk
      // (src/hand/hand.js) hand-*.js, which build/world-start.js lists as lazy.
      output: {
        paths: DSN_PATHS,
        chunkFileNames: (c) =>
          c.name === 'pets' ? 'pet-[hash].js' : c.name === 'hand' ? 'hand-[hash].js' : '[name]-[hash].js',
      },
    },
  },
});
