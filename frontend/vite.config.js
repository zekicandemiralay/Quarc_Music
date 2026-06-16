import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function collectAssets(dir, urlBase = '') {
  const urls = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = urlBase + '/' + entry.name;
      if (entry.isDirectory()) {
        urls.push(...collectAssets(join(dir, entry.name), rel));
      } else if (!rel.endsWith('/sw.js') && !rel.endsWith('.html')) {
        urls.push(rel);
      }
    }
  } catch {}
  return urls;
}

export default defineConfig({
  plugins: [
    react(),
    {
      // At build time:
      //   1. Collect every asset Vite emitted (JS, CSS, fonts, icons…)
      //   2. Prepend self.__PRECACHE_MANIFEST__ = [...] to sw.js
      //   3. Stamp __SW_VERSION__ with the build timestamp
      //
      // Result: the service worker pre-caches the full app shell on install
      // so offline works immediately after any deployment — no manual bumping.
      name: 'sw-version',
      closeBundle() {
        const distDir = join(__dirname, 'dist');
        const swPath = join(distDir, 'sw.js');
        try {
          const assets = collectAssets(distDir);
          const manifest = `self.__PRECACHE_MANIFEST__ = ${JSON.stringify(assets)};\n`;
          let sw = readFileSync(swPath, 'utf8');
          sw = manifest + sw.replace('__SW_VERSION__', `quarc-${Date.now()}`);
          writeFileSync(swPath, sw);
        } catch (e) {
          console.error('[sw-version] error:', e);
        }
      },
    },
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
