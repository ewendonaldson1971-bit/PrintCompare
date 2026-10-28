# Print Compare

A browser-local visual proofing app for comparing one print PDF with multiple JPEG references. Files are processed on-device; no artwork is uploaded to a server.

## Run locally

Requires Node.js 22 or newer.

```sh
cd print-compare
npm ci
npm run build
npm run dev
```

Open http://127.0.0.1:4173. Run `npm test` for the comparison-engine checks.

## Workflow

Upload a PDF (up to 100 MB) and JPEG references (up to 25 MB each, 30 at a time). Pair each proof with a PDF page, choose sensitivity, and compare. Inspect side-by-side previews, opacity overlay, and highlighted difference regions. Download a text report with pixel statistics and region coordinates. Password-protected PDFs are not supported.

PDF.js renders each page in RGB at the reference's longest dimension, capped at 1,600 pixels. The JPEG is fitted without distortion. A 3×3 smoothing pass reduces JPEG noise; a small translation search corrects rasterisation offsets. Per-channel differences exceeding the selected threshold are highlighted; connected 16-pixel tiles group discrepancies. Raw flagged-pixel percentages include small isolated differences that may not form a region. Aspect-ratio mismatches and low-resolution proofs are flagged.

This is visual screening, not semantic/OCR analysis, a colour-accurate proof, or a prepress certification. Low-resolution references cannot verify fine details. Bleed, crop marks, spot colours, overprint, separations, font embedding, and print colour accuracy require a separate prepress check.

## Netlify

Connect this repository in Netlify. The root `netlify.toml` sets base directory `print-compare`, build command `npm run build`, and publish directory `dist`. No secrets or environment variables are needed. PDF.js, its worker, fonts, CMaps, and WASM files are bundled from a pinned dependency during the build. Google Fonts loads only font styles; artwork remains local.
