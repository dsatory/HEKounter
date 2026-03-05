# HEKounter

A browser-based fluorescence microscopy cell viability counter. Counts live (green) vs dead (red) fluorescent cells in batch, with adaptive contrast enhancement and clump separation.

## Features

- **Drag-and-drop batch processing** -- load multiple fluorescence microscopy images at once
- **CLAHE contrast enhancement** -- adaptive histogram equalization to improve cell visibility across varying backgrounds
- **HSV color segmentation** -- separate green (live) and red (dead) channels with tunable thresholds
- **Watershed clump separation** -- automatically estimates cell count in clustered regions using distance-transform-based watershed segmentation and area-based estimation
- **Real-time parameter tuning** -- preview the effect of processing parameters on a single image before running the full batch
- **Per-image thresholds** -- set a global baseline then fine-tune thresholds for individual images
- **Manual cell annotation** -- click to add ambiguous cells to green or red populations
- **CSV export** -- download results as `image_name, green, red, total, viability_pct`
- **Runs entirely in the browser** -- no server, no uploads. OpenCV.js (WebAssembly) runs in a Web Worker for responsive UI.

## Live Demo

**[https://dsatory.github.io/HEKounter/](https://dsatory.github.io/HEKounter/)**

## Quick Start

**Option A -- double-click:** Open `start.command` in Finder. It installs dependencies (first time) and launches the app in your browser.

**Option B -- terminal:**

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Processing Pipeline

1. **Background subtraction** via rolling-ball morphological opening (downscale-accelerated)
2. **CLAHE** on the L channel in LAB color space for adaptive contrast enhancement
3. **Gaussian blur** to reduce noise
4. **HSV thresholding** to isolate green and red fluorescent cells
5. **Morphological open/close** to clean up masks
6. **Distance transform + watershed** to separate touching/clumped cells
7. **Connected component analysis** with area-based clump estimation

## Tech Stack

- React 19 + TypeScript + Vite 6
- Tailwind CSS v4 + Radix UI primitives
- OpenCV.js 4.x (WebAssembly, runs in Web Worker)
- Comlink for worker RPC

## Build

```bash
npm run build
```

Production output goes to `dist/`.
