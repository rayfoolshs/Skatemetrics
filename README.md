# Skate Metrics

Markerless figure-skating jump analysis from YouTube links or rink video. Skate Metrics
extracts 33 pose landmarks per frame with MediaPipe, then derives flight height, rotation
speed, arm pull-in snap timing, knee bend, and axis tilt for each detected jump.

**Live static demo:** https://rayfoolshs.github.io/Skatemetrics/

> The public GitHub Pages build is client-only. YouTube downloading and server-side session
> storage require the Node backend described in [BUILD.md](./BUILD.md). On Pages you can
> upload an MP4/WebM clip or run the synthetic demo; analyses are stored in your browser.

## What it measures

- **Flight height** from airborne flight time (`h = g·t²/8`), scaled by clip playback speed
- **Rotations** (half-turns) from hip/shoulder orientation tracking
- **Rotation speed** with peak and average revolutions per second
- **Arm snap** timing and minimum arm-radius ratio during the flight window
- **Knee bend** at takeoff and landing, plus knee spread and axis tilt
- **Under-rotation calls** (`q`, `<`, `<<`) from landing-shortage angle
- Takeoff, tightest-snap, apex, and landing keyframe snapshots
- Camera-drift diagnostics and measurement warnings

## Features

| Area | Description |
| --- | --- |
| YouTube input | Metadata probe, timestamp trimming, optional `cookies.txt`, embedded-player clip capture fallback |
| Video upload | MP4, MOV, M4V, WebM, MKV, AVI; server-side remux to browser-safe H.264 |
| Pose engine | MediaPipe PoseLandmarker lite/full/heavy, 2D + metric 3D world landmarks |
| Inspector | Jump metrics, joint telemetry, keyframes, frame-level ±1 nudging |
| Telemetry charts | Rotation profile, arm radius, foot height, seek-to-frame |
| Sessions | Save, reopen, filter, delete analyses |
| Compare | Side-by-side session comparison |
| Demo | Deterministic 60 fps synthetic 1.5-rev Axel, no video needed |

## Quick start

```bash
npm install
cp .env.example .env        # fill in GEMINI_API_KEY if you use Gemini features
npm run dev                 # http://localhost:3000
```

Server prerequisites (`ffmpeg`, `ffprobe`, `yt-dlp`) are covered in [BUILD.md](./BUILD.md).

## Documentation

- [BUILD.md](./BUILD.md) — prerequisites, dev server, production and GitHub Pages builds
- [VERSION.md](./VERSION.md) — current version, dependency matrix, build metadata, changelog

## Tech stack

React 19 · Vite 8 · TypeScript 7 · Tailwind CSS 4 · Express 4 · MediaPipe Tasks Vision ·
yt-dlp · ffmpeg
