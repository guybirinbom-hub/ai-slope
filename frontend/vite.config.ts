import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

// Electron-targeted build:
//   - No VitePWA: a service worker is leftover from the upstream web build
//     and only causes problems in Electron (intercepts gateway fetches at
//     the wrong time, caches stale bundle chunks). Removing it shrinks
//     dist by ~18 MiB of precache + sw.js + workbox-*.js and saves boot
//     time we used to spend unregistering it on every load.
//   - No babel preset-env for iOS 15: Electron 42 ships Chromium 134+, so
//     downleveling to iOS-15 syntax just bloats the bundle with arrow-fn
//     polyfills and slows parse. esbuild's default modern transform is fine.
//   - Target esnext: Vite's transformer emits modern JS, parses faster in
//     V8, and produces smaller chunks.
//   - manualChunks: split the huge framework libs (Mantine, tiptap, react,
//     etc.) into separate vendor chunks so V8 can parse them in parallel
//     and the dev cache can re-use them across builds.
export default defineConfig({
  base: './',
  // Dev-server-only proxy. The React app fires RELATIVE fetches like
  // `/wg/ready`, `/rest/v1/*`, `/auth/v1/*`, `/functions/v1/*`,
  // `/storage/v1/*` expecting same-origin handling (in the packaged
  // Electron app that's the in-process gateway on :9000). For
  // `npm run dev` (port 5173) we proxy those prefixes to the running
  // Electron gateway so the dev frontend works against the same
  // backend. Has no effect on the production build.
  server: {
    proxy: {
      '/wg':           { target: 'http://localhost:9000', changeOrigin: true },
      '/rest/v1':      { target: 'http://localhost:9000', changeOrigin: true },
      '/auth/v1':      { target: 'http://localhost:9000', changeOrigin: true },
      '/functions/v1': { target: 'http://localhost:9000', changeOrigin: true },
      '/storage/v1':   { target: 'http://localhost:9000', changeOrigin: true },
    },
  },
  resolve: {
    // Force a single copy of React / react-dom / scheduler across the
    // whole bundle. Without this, Rollup can resolve a peer-depended lib
    // through a different node_modules path and end up with two React
    // copies, which manifests at boot as
    //   "Cannot set properties of undefined (setting 'Activity')"
    // — React 19's ReactSharedInternals.Activity assignment crashing
    // because the duplicate copy hasn't initialised its internals yet.
    dedupe: ['react', 'react-dom', 'scheduler'],
    alias: {
      '@assets': path.resolve(__dirname, './src/assets'),
      '@atoms': path.resolve(__dirname, './src/atoms'),
      '@common': path.resolve(__dirname, './src/common'),
      '@drawers': path.resolve(__dirname, './src/drawers'),
      '@nav': path.resolve(__dirname, './src/nav'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@modals': path.resolve(__dirname, './src/modals'),
      '@constants': path.resolve(__dirname, './src/constants'),
      '@contexts': path.resolve(__dirname, './src/contexts'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@auth': path.resolve(__dirname, './src/auth'),
      '@schemas': path.resolve(__dirname, './src/schemas'),
      '@operations': path.resolve(__dirname, './src/process/operations'),
      '@variables': path.resolve(__dirname, './src/process/variables'),
      '@requests': path.resolve(__dirname, './src/request'),
      '@upload': path.resolve(__dirname, './src/process/upload'),
      '@content': path.resolve(__dirname, './src/process/content'),
      '@items': path.resolve(__dirname, './src/process/items'),
      '@specializations': path.resolve(__dirname, './src/process/specializations'),
      '@import': path.resolve(__dirname, './src/process/import'),
      '@export': path.resolve(__dirname, './src/process/export'),
      '@homebrew': path.resolve(__dirname, './src/process/homebrew'),
      '@conditions': path.resolve(__dirname, './src/process/conditions'),
      '@modes': path.resolve(__dirname, './src/process/modes'),
      '@spells': path.resolve(__dirname, './src/process/spells'),
      '@character': path.resolve(__dirname, './src/process/character'),
      '@css': path.resolve(__dirname, './src/css'),
      '@ai': path.resolve(__dirname, './src/ai'),
    },
  },
  plugins: [
    react(),
    visualizer({
      emitFile: true,
      filename: 'stats.html',
    }),
  ],
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // Conservative vendor splitting: only carve out a few heavy libs
        // that we know don't share internals with React. The previous
        // aggressive "catch-all vendor-misc" strategy worked great for
        // bundle size (entry chunk 12× smaller) but broke React's
        // internals dedup, leading to the "Activity setter on undefined"
        // crash. Sticking to safe, isolated libs here.
        //
        // We deliberately do NOT split mantine, tiptap, react, etc. into
        // separate chunks because they share peer-dep internals that
        // Rollup can't always reconcile across chunk boundaries.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          const p = id.replace(/\\/g, '/');
          // Safe to isolate: these libs don't share React internals.
          if (p.includes('/pdfjs-dist/')) return 'vendor-pdf';
          if (p.includes('/lodash')) return 'vendor-lodash';
          if (p.includes('/dayjs/')) return 'vendor-dates';
          if (p.includes('/@tabler/icons')) return 'vendor-icons';
          if (p.includes('/@supabase/')) return 'vendor-supabase';
          // Everything else: let Vite decide. Default behavior puts shared
          // deps in the entry chunk, which is bigger but reliable.
          return undefined;
        },
      },
    },
  },
});
