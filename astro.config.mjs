// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

import vue from '@astrojs/vue';
import node from '@astrojs/node';

// https://astro.build/config
// Output stays 'static' (the default): pages are prerendered for LCP; API routes
// opt into on-demand rendering with `export const prerender = false`.
export default defineConfig({
  // Used for the canonical URL and og:url. The challenge deployment, never fxreplay.com.
  site: 'https://fxr-challenge.yhndevside.com',

  integrations: [vue()],

  // Built-in Fonts API: files are downloaded at build time and served from this origin
  // (self-hosted, no extra dependency). Only the weights the page uses. Optimised fallback
  // metrics are generated from the last generic family, so the swap does not shift layout.
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Lato',
      cssVariable: '--font-lato',
      weights: [700],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'swap',
      fallbacks: ['Helvetica Neue', 'Arial', 'sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Nunito Sans',
      cssVariable: '--font-nunito-sans',
      weights: [400, 700],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'swap',
      fallbacks: ['-apple-system', 'Segoe UI', 'sans-serif'],
    },
  ],

  adapter: node({
    mode: 'standalone',
    // 16 KiB: the largest API body (PATCH) is well under 1 KiB. Default is 1 GiB.
    bodySizeLimit: 16 * 1024,
  }),
});
