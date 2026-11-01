# Print Compare

A visual proofing app for comparing one print PDF with reference PDFs or JPEGs. Local pixel checks highlight changed regions. Optional OpenAI vision reports describe changes to logos, lettering, colour, imagery, and composition in a reference-versus-print table.

## Run locally

Requires Node.js 22 or newer.

```sh
cd print-compare
npm ci
npm run build
npm run dev
```

Open http://127.0.0.1:4173. Run `npm test` for pixel-engine, server integration, validation, and report-export checks. Local AI review uses `OPENAI_API_KEY` from the shell environment; no key is needed for local pixel checks. For environment-file support, start with `node --env-file=.env scripts/serve.mjs` after creating an ignored `.env` file.

## Workflow

Upload a print PDF (up to 5 GB) and reference PDFs (up to 5 GB each) or JPEGs (up to 25 MB each). PDF references add a pairing for each page, up to the 30-pair batch limit; if more pages exist, a message identifies the subset added. Change the reference-page and print-page selectors to compare any desired pages. Use “+ Page” to add another pairing from an already loaded reference PDF, or remove individual pairings. PDFs over 200 pages use numeric page selectors to avoid generating enormous menus. Compare remaining pages in another batch.

Choose pixel sensitivity and whether to include AI reports, then compare. AI reports include a verdict, summary, comparison table, elements present in both, checks before printing, and limitations. Each pair can be retried separately; a running AI batch can be stopped. Inspect side-by-side previews, opacity overlay, and highlighted difference regions. Download a combined text report with AI observations, reference PDF page identifiers, pixel statistics and region coordinates. Password-protected PDFs are not supported.

Both print and reference PDFs use PDF.js range transport to read requested local file slices rather than eagerly calling `arrayBuffer()` on the entire source file. Rendering complex pages can still require substantial browser memory; the configured 5 GB acceptance limit is not a guarantee that every PDF of that size can be processed.

PDF.js renders print pages in RGB at the reference preview's longest dimension, capped at 1,600 pixels. Reference PDF pages render at 1,600 pixels; JPEGs retain their native resolution up to that limit. The reference is fitted without distortion. A 3×3 smoothing pass reduces raster noise; a small translation search corrects rasterisation offsets. Per-channel differences exceeding the selected threshold are highlighted; connected 16-pixel tiles group discrepancies. Raw flagged-pixel percentages include small isolated differences that may not form a region. Aspect-ratio mismatches and low-resolution JPEG proofs are flagged.

AI receives the original reference composition without letterboxing or stretching. JPEG references are downscaled only if larger than 2,000 pixels on the longest edge; reference PDF pages are rendered at up to 2,000 pixels. The print PDF page is separately rendered at up to 2,000 pixels for AI review, independently of the lower-resolution pixel comparison. Previews are JPEG-encoded and bounded to fit a 4.5 MB request. Image 1 is explicitly labelled the reference input, including source type and reference PDF page; image 2 is the print PDF page. The prompt treats image text and filenames as untrusted data and requests uncertain findings be qualified.

This is visual screening, not a colour-accurate proof or a prepress certification. AI can miss or invent differences. Low-resolution references cannot verify fine details. Bleed, crop marks, spot colours, overprint, separations, font embedding, and print colour accuracy require a separate prepress check.

## Netlify

The root `netlify.toml` builds from the repository root, installs the locked dependencies in `print-compare`, and runs its build script. Its publish directory is `print-compare/dist`; its functions directory is `print-compare/netlify/functions`. These explicit paths avoid base-directory ambiguity in CLI deployments. The nested config also supports running the app as a standalone checkout. PDF.js, its worker, fonts, CMaps, and WASM files are bundled from a pinned dependency during the build.

When Netlify AI Gateway is enabled, it automatically injects `OPENAI_API_KEY` and `OPENAI_BASE_URL` at function runtime. The app honours both so a gateway credential is never sent to OpenAI directly. This route bills AI usage through Netlify. Alternatively, set your own `OPENAI_API_KEY` in Netlify with Functions scope and Production context, then redeploy; without `OPENAI_BASE_URL`, calls go directly to OpenAI and use its billing. Optionally set `OPENAI_VISION_MODEL` (default `gpt-4.1`; must support image inputs, Responses, and strict Structured Outputs). The key never enters browser assets or Git. The endpoint reports configuration status without exposing the key; API errors are sanitised. Netlify applies a 60-request/hour/IP limit. Requests time out after 50 seconds; failed/refused/incomplete reviews remain visibly incomplete rather than passing a file.

## Pass/Fail rules

Each AI report separately assesses logo integrity, lettering integrity, colour, size/layout, and content. The app derives the decision from these structured findings: slight intact rescaling and modest colour shifts consistent with RGB-to-CMYK conversion pass. Filled/closed letter counters (the internal holes in O, P, R, B, A, etc.), merged or damaged glyphs, missing/damaged logos, significant colour changes, material content changes, or material distortion/cropping fail. Readable wording alone does not establish intact lettering. Uncertain lettering cannot pass. Pixel counts and page proportions alone do not fail a proof. These are qualitative visual rules; no numeric size tolerance or colourimetric threshold is implied, and RGB renders cannot verify the source colour space or conversion accuracy.

Before AI review, a worker inspects higher-resolution source renders (up to 9,000 pixels on the long edge, bounded to approximately 10 megapixels) for high-contrast glyph-like runs, including outlined lettering without a text layer. Corresponding nearby runs are grouped into detail regions. All detected regions are reviewed in sequential batches of up to eight; eight is a per-request limit, not a page-level cutoff. Close-ups are rendered directly from the source PDF at up to 1,800 pixels per region; JPEG references use available native pixels rather than inventing detail. Each request includes both overviews plus its labelled reference/print close-up pairs. Detail crops use lossless PNG where the request budget permits, with JPEG fallbacks that preserve the region count.

The client verifies batch indexes, expected region counts, and completed responses before allowing an overall Pass. A confirmed defect in any batch fails the comparison; genuine uncertainty, cancellation, or a missing batch prevents a Pass. The report shows completed/expected batches and regions, and the download includes batch decisions. Legacy requests that explicitly omit detected detail regions still cannot Pass. If a complete batch image set will not fit, the review remains incomplete instead of silently dropping details. These heuristics improve small-text coverage but do not guarantee discovery of every letter or low-contrast text region. Expand “Lettering close-ups” in a completed report to inspect the supplied details. Multi-batch pages use additional AI requests, billed through the configured provider.

Every pair shows PASS or FAIL once assessed, with a reason. A missing, failed, stopped, or inconclusive AI review shows NOT ASSESSED rather than an unearned pass. One failed pair fails the overall job; an overall pass requires every pair to pass. Decisions and acceptance criteria are included in the downloaded report.

## Privacy

Pixel-only checks do not transmit artwork. With AI reports enabled, JPEG previews of the selected reference and print PDF pages pass through the Netlify function to OpenAI. Neither full source PDF is uploaded. The app does not persist artwork or reports on its server or log image payloads. OpenAI requests use `store: false`; this does not promise zero retention, and OpenAI API data policies still apply. Reports live in browser memory until reset/reload unless downloaded. Google Fonts serves font styles only.

API references: [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Netlify Functions](https://docs.netlify.com/build/functions/api/).
