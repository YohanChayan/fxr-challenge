# Performance review

## Core Web Vitals

Budget (p75, mobile; a target, not yet a field measurement): **LCP < 2.5s, CLS < 0.1,
INP < 200ms.**

Lab only, landing page (localhost production build, Chrome for Testing, no throttling,
375×812, 2026-11-21): CLS 0, LCP 56 ms with the h1 text as the LCP element. Not representative of
real mobile networks.

Lighthouse 12, mobile preset (simulated slow 4G and 4× CPU throttling), local production build
(`npm run build && npm start`), Playwright's Chromium, three runs each, 2026-11-21:

| Build                 | LCP       | LCP element             | CLS | Performance score |
| --------------------- | --------- | ----------------------- | --- | ----------------- |
| Before the hero image | 2.7–2.8 s | the h1                  | 0   | 95                |
| With the hero image   | 2.8–2.9 s | the hero `<img>` (AVIF) | 0   | 94–95             |

The image adds about 0.05–0.1 s, which is within run-to-run noise. The image itself is not the
bottleneck: the 1024w AVIF (23 KB file, 24 KB transferred) is fetched at High priority with no load delay, and 85% of LCP
is render delay. The page was **already over the 2.5 s budget** in this lab profile before the
image went in. The render-blocking CSS and the three font files are the likely cause; that is not
measured yet (see "With more time" below).

## Performance decisions

### Loading strategy

- The landing page is one prerendered HTML file with one CSS file and the SVG logo.
- Only the h1 font (Lato 700, latin, woff2) is preloaded. Nunito Sans (400 and 700) is not
  preloaded, so it doesn't compete with the LCP text.

### Rendering strategy

Static: `src/pages/index.astro` is prerendered at build time (`output: 'static'`), so the HTML
needs no server render. Only `src/pages/api/**` renders on demand.

### Asset optimization

- **Fonts** are self-hosted through Astro's Fonts API (`astro.config.mjs`): woff2 only, the
  latin subset, normal style, and only the weights used (3 files). `font-display: swap`, with
  generated fallback faces (`size-adjust`, ascent/descent/line-gap overrides) that minimise the layout shift on
  swap. Lab check (localhost, Chrome for Testing, no throttling, 375×812): CLS 0. Bold Nunito text may fall back to synthesised bold on
  the 400 fallback face, because Astro orders that face first.
- **Logo**: `<img>` with explicit `width`/`height` and `aspect-ratio`, so its box is reserved
  before it loads.
- **Hero image** (`src/components/Hero.astro`): one decorative image, source
  `src/assets/hero/hero-bg.webp` (1672×941, 103 KB). Astro's `<Picture>` emits AVIF and WebP at
  640, 1024 and 1672 px wide with `sizes="100vw"`, plus a WebP `<img>` fallback (no PNG). Build
  sizes: AVIF 12 / 23 / 49 KB, WebP 20 / 40 / 83 KB. It is the LCP element, so it loads with
  `loading="eager"` and `fetchpriority="high"`. It is decorative: `alt=""` and
  `aria-hidden="true"`. The whole image is shown at every width, never cropped. Below 1024px it
  is a full-width band under the CTA, in flow; the `<img>` `width`/`height` reserve its box. From
  1024px it is the hero's background: absolutely positioned, `object-fit: contain`, anchored
  right and bottom, in a hero at least as tall as the image at full width (capped at 720px).
  CLS is 0 in both layouts (table above; QA at 375 and 1440).

### JavaScript execution

The only JavaScript is the signup island, `src/components/signup/SignupIsland.vue` (the CTA
button and the signup `<dialog>`), hydrated with `client:visible`. Everything else ships no
client script (the JSON-LD block is data, not code). The island is server-rendered as the CTA
button and a closed dialog, so the button's space is reserved before it hydrates.

Build output (`npm run build`, 2026-11-21), gzip sizes measured with `gzip -c`: the island chunk
is 28,626 bytes (mostly zod), the Vue runtime 30,084 bytes, and Astro's island client 645 bytes.
The earlier inline form measured about 27.5 KB and 29.7 KB, so the move into the dialog and the
split into three components, a composable and an API client cost roughly 1 KB gzipped or less.

**With more time:** find what makes up the ~2.5 s render delay on the Lighthouse mobile
profile (render-blocking CSS, three font files) and decide whether to inline the critical CSS or
drop a font preload. Swap the island's zod import for `zod/mini` (or validate the email with a
lighter check and keep full zod on the server only) to cut most of the island chunk. Measure INP
on a throttled mobile profile before and after.

### Third-party scripts

None.

## SEO

### Metadata

`src/layouts/BaseLayout.astro`: `<title>`, meta description, canonical (built from `site` in
`astro.config.mjs`), and Open Graph `og:type`, `og:title`, `og:description` and `og:url`. **No `og:image` yet** (see `DECISIONS.md`). `meta robots noindex`: this is a challenge
demo, not the product site.

### Semantic structure

One `h1` (hero), then `h2` "How it works" and `h2` "FAQ". Landmarks: `header`, `main`, and
`footer`. The steps are an `<ol>`. The FAQ uses native `<details>`/`<summary>`.

### Technical SEO

`lang="en"`, `color-scheme: dark`, a canonical URL, and `noindex`. The page is crawlable HTML
with no client rendering.

### Structured data

JSON-LD `SoftwareApplication` (`name`, `description`, `url`) with an `Offer` at `price: 0`,
`priceCurrency: USD` (an assumption; see `DECISIONS.md`).

## Accessibility

- **Hero text and the image:** below 1024px the copy sits on plain `--bg-primary`, above the
  image, so its contrast is unchanged (eyebrow 5.26:1). From 1024px the copy overlaps the image,
  so a gradient overlay in `--bg-primary` (`.hero::after`) stays at 94% or more up to where the
  copy ends, measured from the centred container, then fades out across the chart. Lab check
  (dev server, Chromium, DPR 1, 2026-11-21): each element's text colour against the
  **brightest** background pixel in its box, with the text hidden, at 1024, 1440 and 1920px.
  Lowest ratios: eyebrow 5.24:1 and subhead 11.1:1, both needing 4.5:1; h1 7.08:1 at 1024px,
  needing 3:1. All pass AA.
- A skip link to `#main`, shown when it is focused.
- A visible `:focus-visible` outline (`--border-brand`, about 4:1 against the background,
  above the 3:1 non-text minimum).
- Body text uses `--text-primary`/`--text-secondary`. Small blue text uses
  `--text-brand-small` (about 5.3:1).
- The FAQ is keyboard-operable through native `<details>`.
- `prefers-reduced-motion: reduce` disables transitions and smooth scroll.

## Rendering strategy

See "Rendering strategy" above.

## Caching / CDN strategy

## Important production risks
