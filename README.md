# Print Compare

A visual proofing app for comparing one print PDF with multiple JPEG references. Local pixel checks highlight changed regions. Optional OpenAI vision reports describe changes to logos, lettering, colour, imagery, and composition in a reference-versus-print table.

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

Upload a PDF (up to 5 GB) and JPEG references (up to 25 MB each, 30 at a time). Pair each proof with a PDF page, choose pixel sensitivity, choose whether to include AI reports, and compare. AI reports include a verdict, summary, comparison table, elements present in both, checks before printing, and limitations. Each pair can be retried separately; a running AI batch can be stopped. Inspect side-by-side previews, opacity overlay, and highlighted difference regions. Download a combined text report with AI observations, pixel statistics and region coordinates. Password-protected PDFs are not supported.

PDF.js renders each page in RGB at the reference's longest dimension, capped at 1,600 pixels. The JPEG is fitted without distortion. A 3×3 smoothing pass reduces JPEG noise; a small translation search corrects rasterisation offsets. Per-channel differences exceeding the selected threshold are highlighted; connected 16-pixel tiles group discrepancies. Raw flagged-pixel percentages include small isolated differences that may not form a region. Aspect-ratio mismatches and low-resolution proofs are flagged.

AI receives the original reference composition without letterboxing or stretching, downscaled only if larger than 2,000 pixels on its longest edge. The PDF page is separately rendered at up to 2,000 pixels for the AI review, independently of the lower-resolution pixel comparison. Previews are JPEG-encoded and bounded to fit a 4.5 MB request. Image 1 is explicitly labelled the reference and image 2 the print PDF. The prompt treats image text and filenames as untrusted data and requests uncertain findings be qualified.

This is visual screening, not a colour-accurate proof or a prepress certification. AI can miss or invent differences. Low-resolution references cannot verify fine details. Bleed, crop marks, spot colours, overprint, separations, font embedding, and print colour accuracy require a separate prepress check.

## Netlify

The root `netlify.toml` builds from the repository root, installs the locked dependencies in `print-compare`, and runs its build script. Its publish directory is `print-compare/dist`; its functions directory is `print-compare/netlify/functions`. These explicit paths avoid base-directory ambiguity in CLI deployments. The nested config also supports running the app as a standalone checkout. PDF.js, its worker, fonts, CMaps, and WASM files are bundled from a pinned dependency during the build.

When Netlify AI Gateway is enabled, it automatically injects `OPENAI_API_KEY` and `OPENAI_BASE_URL` at function runtime. The app honours both so a gateway credential is never sent to OpenAI directly. This route bills AI usage through Netlify. Alternatively, set your own `OPENAI_API_KEY` in Netlify with Functions scope and Production context, then redeploy; without `OPENAI_BASE_URL`, calls go directly to OpenAI and use its billing. Optionally set `OPENAI_VISION_MODEL` (default `gpt-4.1`; must support image inputs, Responses, and strict Structured Outputs). The key never enters browser assets or Git. The endpoint reports configuration status without exposing the key; API errors are sanitised. Netlify applies a 60-request/hour/IP limit. Requests time out after 50 seconds; failed/refused/incomplete reviews remain visibly incomplete rather than passing a file.

## Pass/Fail rules

Each AI report assesses logo integrity, colour, size/layout, and content. The app derives the decision from these structured findings: slight intact rescaling and modest colour shifts consistent with RGB-to-CMYK conversion pass. Missing/damaged logos, significant colour changes (such as a coloured logo turning grey or losing its fill), material content changes, or material distortion/cropping fail. Pixel counts and page proportions alone do not fail a proof. These are qualitative visual rules; no numeric size tolerance or colourimetric threshold is implied, and RGB renders cannot verify the source colour space or conversion accuracy.

Every pair shows PASS or FAIL once assessed, with a reason. A missing, failed, stopped, or inconclusive AI review shows NOT ASSESSED rather than an unearned pass. One failed pair fails the overall job; an overall pass requires every pair to pass. Decisions and acceptance criteria are included in the downloaded report.

## Privacy

Pixel-only checks do not transmit artwork. With AI reports enabled, JPEG previews of each reference and rendered PDF page pass through the Netlify function to OpenAI. The full PDF is not uploaded. The app does not persist artwork or reports on its server or log image payloads. OpenAI requests use `store: false`; this does not promise zero retention, and OpenAI API data policies still apply. Reports live in browser memory until reset/reload unless downloaded. Google Fonts serves font styles only.

API references: [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Netlify Functions](https://docs.netlify.com/build/functions/api/).
