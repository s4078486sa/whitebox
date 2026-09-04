// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://whitebox.judy2006969.me',
  output: 'static',
  build: { format: 'directory' },
  compressHTML: true,
  devToolbar: { enabled: false },
  vite: {
    build: {
      target: 'es2022',
      cssCodeSplit: false,
    },
  },
});
