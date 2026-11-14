# Version & Build Information

## Current version

| Field | Value |
| --- | --- |
| Product | Skate Metrics |
| Version | **0.1.0** |
| Release date | 2026-11-14 |
| Repository | https://github.com/rayfoolshs/Skatemetrics |
| Baseline commit | `1ab9f4f` — *feat: initialize Skate Metrics project structure* |
| Distribution | Static GitHub Pages build + optional Node server |
| Live demo | https://rayfoolshs.github.io/Skatemetrics/ |

The `0.1.0` version is declared in `package.json`. It is the first documented release of
the project and includes the static-hosting port described below.

## Runtime and toolchain

| Component | Version |
| --- | --- |
| Node.js (build/test) | 22.23.3 |
| npm (build/test) | 10.9.9 |
| TypeScript | 7.0.2 |
| Vite | 8.3.8 |
| React / React DOM | 19.3.1 |
| Tailwind CSS | 4.3.5 |
| MediaPipe Tasks Vision | 1.2.3 |
| Express | 4.22.3 |
| Multer | 2.5.0 |
| Motion | 12.43.0 |
| Lucide React | 0.546.0 |
| dotenv | 17.4.2 |
| tsx | 4.23.15 |
| esbuild | 0.28.2 |

External runtime dependencies for the full server: `ffmpeg`, `ffprobe`, `yt-dlp`, and a
`GEMINI_API_KEY` if Gemini-backed features are enabled.

## Build profiles

| Profile | Command | Output | Base path | Backend |
| --- | --- | --- | --- | --- |
| Development | `npm run dev` | Vite middleware | `/` | Yes (`server.ts`) |
| Production server | `npm run build` + `NODE_ENV=production npm start` | `dist/` served by Express | `/` | Yes |
| GitHub Pages | `npm run build:pages` | `dist/` uploaded as a Pages artifact | `/Skatemetrics/` | No (client-only) |

Static artifact layout:

```text
dist/
├── .nojekyll
├── index.html
└── assets/
    ├── index-<hash>.css
    └── index-<hash>.js
```

## What's in 0.1.0

### Features

- Deterministic 60 fps synthetic 1.5-rev Axel demo that runs with no video and no backend.
- YouTube metadata probe, section trimming (2–6 s jump windows), optional `cookies.txt`,
  and embedded-player clip capture when YouTube blocks server downloads.
- Upload pipeline for MP4/MOV/M4V/WebM/MKV/AVI up to 512 MB with ffprobe timestamps and
  H.264 remux for browser playback.
- MediaPipe PoseLandmarker (lite/full/heavy) with 2D and metric 3D world landmarks, ROI
  cropping, and frame-by-frame sampling capped at 1200 frames per pass.
- Jump segmentation with flight height, half-turn rotation counting, average/peak
  rotation speed, arm-radius snap timing, takeoff/landing knee angles, knee spread, axis
  tilt, and under-rotation calls.
- Keyframe snapshots (takeoff, tightest snap, apex, landing) and ±1-frame boundary nudge.
- Telemetry charts, jump inspector, sessions list, session compare view, and report export.
- Server session persistence under `.data/sessions` with JSON metadata.

### Static-host port (new in 0.1.0)

- Vite `base` is configurable via `BASE_PATH`; Pages uses `/Skatemetrics/`.
- MediaPipe wasm and pose models load from public CDNs instead of server proxies.
- Local video upload fallback: when `/api/upload` is absent, the browser decodes the file
  directly, assumes 30 fps, and runs pose analysis on an object URL.
- Session persistence falls back to `localStorage` (`skate-metrics:sessions:v1`), with a
  compact record when the storage quota is exceeded.
- A banner explains which features need the Node backend.
- `.nojekyll` is emitted so Pages does not rewrite asset paths.

### Build fixes

- `esbuild` raised from `^0.25.0` to `^0.28.0` to satisfy Vite 8's peer dependency range.
- `package.json` renamed from the template value `react-example` to `skate-metrics`.

## Known limitations in 0.1.0

- The Pages build cannot fetch YouTube videos, remux uploads with ffmpeg, or share
  sessions across devices.
- Browser-local uploads cannot report source FPS; the static path labels them as 30 fps.
- Object URLs and uploaded videos are lost on page reload; saved analyses may reopen
  without their video source.
- Session records with full pose frames can exceed the ~5 MB `localStorage` quota; those
  records are saved without `poseFrames`/`keyframes`.
- MediaPipe CDN availability and browser WebGL support are required for pose inference.

## Changelog

### 0.1.0 — 2026-11-14

- Added static GitHub Pages build and deployment workflow.
- Added CDN-based MediaPipe assets, local upload fallback, and browser session storage.
- Added README, BUILD, and VERSION documentation.
- Fixed Vite 8 peer dependency conflict and template package name.

### 0.0.0 — 2026-11-14

- `6a5920e` Initial commit.
- `1ab9f4f` Initialize Skate Metrics project structure: React/Vite frontend, Express API,
  YouTube and upload pipelines, pose engine, kinematics, inspector, charts, sessions.

## Versioning policy

- **MAJOR** — breaking changes to API routes, session schema, or measurement semantics.
- **MINOR** — new analysis features, source types, or deployment targets.
- **PATCH** — bug fixes, dependency bumps, documentation and build-only changes.

To identify the exact source of a deployment, compare the commit recorded by the Pages
workflow run with this file, then run `git describe --tags --always` in the repository.
