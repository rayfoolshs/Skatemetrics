# Building Skate Metrics

This document covers local development, the production server build, and the static
GitHub Pages build for version **0.1.0** (see [VERSION.md](./VERSION.md)).

## 1. Prerequisites

| Requirement | Version | Needed for |
| --- | --- | --- |
| Node.js | 22 LTS or newer (built/tested on 22.23.3) | app, build, tooling |
| npm | 10+ (built/tested on 10.9.9) | dependency install |
| ffmpeg + ffprobe | any recent build | upload remux, frame timestamps |
| yt-dlp | latest (auto-downloaded to `.data/bin` on Linux if missing) | YouTube probe/download |
| Internet access | — | MediaPipe wasm/models, YouTube, Google Fonts |

Install the media tools on macOS:

```bash
brew install ffmpeg yt-dlp
```

> Bun is also present in the repository as `bun.lock`, but the documented build path uses
> npm and the checked-in `package-lock.json`.

## 2. Install

```bash
npm install
```

`esbuild` is pinned to `^0.28.0` to match Vite 8's peer range. If you see an
`ERESOLVE` peer-dependency error on a fresh checkout, confirm that pin before using
`--legacy-peer-deps`.

## 3. Environment

Copy the example file and fill in values as needed:

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Express listen port |
| `NODE_ENV` | unset | `production` serves `dist/`; otherwise Vite middleware mode |
| `GEMINI_API_KEY` | — | Google GenAI features |
| `APP_URL` | — | Public app URL used for self-referential links |
| `BASE_PATH` | `/` | Vite asset base; use `/Skatemetrics/` for project Pages |
| `DISABLE_HMR` | unset | `true` disables Vite HMR/watching |

Runtime data is written to `.data/` (bin, cache, videos, sessions, tmp) and is git-ignored.

## 4. Development server

```bash
npm run dev
```

Runs `tsx server.ts`, mounts Vite in middleware mode, and serves the API on
http://localhost:3000. Useful endpoints:

- `GET /api/health`
- `POST /api/youtube/probe`
- `POST /api/youtube/download`
- `POST /api/upload`
- `GET /api/videos/:videoId/stream` (HTTP range requests)
- `GET|POST /api/sessions`, `GET|DELETE /api/sessions/:id`
- `GET /api/mediapipe/model/:variant` (server-cached fallback; the browser build now uses the CDN)

## 5. Production build (Node server)

```bash
npm run build
NODE_ENV=production npm start
```

`npm run build` runs `vite build` with the default base `/` and writes `dist/`.
`npm start` runs `node server.ts`; in production Express serves `dist/` plus the API and
SPA fallback.

## 6. Static build (GitHub Pages)

```bash
npm run build:pages
```

This is `vite build` with `BASE_PATH=/Skatemetrics/`, producing:

```text
dist/
├── .nojekyll          # keep Vite's asset paths untouched by Jekyll
├── index.html
└── assets/
    ├── index-*.js
    └── index-*.css
```

The static build is client-only:

- **Works:** synthetic demo, local MP4/WebM upload and pose analysis, local video
  persistence during the session, analysis saved to `localStorage`, charts, inspector,
  compare view, report export.
- **Unavailable:** YouTube fetch/download (needs `yt-dlp`), server upload remux (needs
  `ffmpeg`), and cross-device session storage. The UI shows a banner and falls back to
  browser storage automatically.
- MediaPipe wasm is loaded from `cdn.jsdelivr.net` and pose models from
  `storage.googleapis.com`, so no server proxy is required.

### Deployment

`.github/workflows/deploy-pages.yml` builds and deploys on every push to `main` (and on
manual dispatch). Repository setting: **Settings → Pages → Source = GitHub Actions**.

Expected URL: https://rayfoolshs.github.io/Skatemetrics/

If you rename the repository, update `BASE_PATH` in the workflow and the
`build:pages` script so asset URLs keep matching the new sub-path.

## 7. Verification

```bash
npm run lint        # tsc --noEmit
npm run build:pages # production static build
npm run preview     # serve dist/ locally (base path may differ; see below)
```

Serving the Pages bundle locally requires the sub-path. One quick check:

```bash
mkdir -p /tmp/skate-preview
ln -sfn "$PWD/dist" /tmp/skate-preview/Skatemetrics
python3 -m http.server 8080 -d /tmp/skate-preview
# open http://localhost:8080/Skatemetrics/
```

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Blank page on Pages | Assets 404 — `BASE_PATH` must equal `/<repo-name>/` |
| `ERESOLVE` on install | `esbuild` must satisfy Vite 8's peer range (`^0.28.0`) |
| YouTube probe returns bot wall | Supply `cookies.txt` or use the embedded-player clip capture |
| Upload cannot be decoded locally | Browser lacks the codec (e.g. some MOV/HEVC); use H.264 MP4 or WebM |
| MediaPipe model fails to load | Check CDN/network access; models are fetched from `storage.googleapis.com` |
| Pose analysis is slow | Choose the `lite` model, trim the clip, or crop the skater region |
| Uploads exceed limits | Server limit is 512 MB per file |
