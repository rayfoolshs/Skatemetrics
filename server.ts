import express from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { execFile, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve('.data');
const BIN_DIR = path.join(DATA_DIR, 'bin');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const VIDEOS_DIR = path.join(DATA_DIR, 'videos');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const UPLOADS_TMP = path.join(DATA_DIR, 'tmp');

for (const dir of [DATA_DIR, BIN_DIR, CACHE_DIR, VIDEOS_DIR, SESSIONS_DIR, UPLOADS_TMP]) {
  mkdirSync(dir, { recursive: true });
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
]);

const MODEL_URLS: Record<string, string> = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);

function normalizeYouTubeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new Error('YouTube URL is empty');
  return trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? trimmed
    : `https://${trimmed}`;
}

function isValidYouTubeUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(normalizeYouTubeUrl(rawUrl));
    const host = parsed.hostname.toLowerCase();
    return YOUTUBE_HOSTS.has(host) || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

async function ensureYtDlp(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('which', ['yt-dlp']);
    const bin = stdout.trim();
    if (bin) return bin;
  } catch {
    // Fall through to local cached yt-dlp binary
  }

  const localBin = path.join(BIN_DIR, 'yt-dlp');
  if (existsSync(localBin)) {
    return localBin;
  }

  const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  const resp = await fetch(downloadUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch yt-dlp binary (${resp.status})`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  writeFileSync(localBin, buffer);
  chmodSync(localBin, 0o755);
  return localBin;
}

interface ProbeSummary {
  width: number;
  height: number;
  fps: number;
  duration: number;
  frameCount: number;
  codec: string;
  timestamps: number[];
}

async function probeVideo(videoPath: string): Promise<ProbeSummary> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,codec_name',
    '-show_entries', 'format=duration',
    '-of', 'json',
    videoPath,
  ]);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] ?? {};
  const rateStr: string = stream.avg_frame_rate || stream.r_frame_rate || '60/1';
  let fps = 60;
  if (rateStr.includes('/')) {
    const [num, den] = rateStr.split('/').map(Number);
    if (den > 0 && Number.isFinite(num / den)) fps = num / den;
  } else {
    const v = Number(rateStr);
    if (v > 0) fps = v;
  }

  let timestamps: number[] = [];
  try {
    const tsOut = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'frame=best_effort_timestamp_time',
      '-of', 'csv=p=0',
      videoPath,
    ], { maxBuffer: 16 * 1024 * 1024 });
    timestamps = tsOut.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/,+$/, ''))
      .filter((line) => line.length > 0 && line !== 'N/A')
      .map(Number)
      .filter((n) => Number.isFinite(n));
  } catch {
    timestamps = [];
  }

  const rawCount = Number(stream.nb_frames || 0);
  const frameCount = Math.max(rawCount, timestamps.length);
  const duration = Number(stream.duration || parsed.format?.duration || (frameCount > 0 ? frameCount / fps : 0));

  return {
    width: Number(stream.width || 1280),
    height: Number(stream.height || 720),
    fps: Number(fps.toFixed(4)),
    duration: Number(duration.toFixed(4)),
    frameCount,
    codec: String(stream.codec_name || 'unknown'),
    timestamps,
  };
}

async function ensurePlayableMp4(inputPath: string, outputPath: string, probe: ProbeSummary): Promise<string> {
  const isBrowserH264 = inputPath.toLowerCase().endsWith('.mp4') && probe.codec === 'h264';
  if (isBrowserH264) {
    return inputPath;
  }
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    outputPath,
  ], { maxBuffer: 16 * 1024 * 1024 });
  return outputPath;
}

function runYtDlp(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '');
}

const upload = multer({
  dest: UPLOADS_TMP,
  limits: { fileSize: 512 * 1024 * 1024 },
});

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  const mediapipeWasmDir = path.resolve('node_modules/@mediapipe/tasks-vision/wasm');
  if (existsSync(mediapipeWasmDir)) {
    app.use('/mediapipe/wasm', express.static(mediapipeWasmDir));
  }

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get('/api/mediapipe/model/:variant', async (req: Request, res: Response) => {
    const variant = String(req.params.variant || 'lite');
    const url = MODEL_URLS[variant];
    if (!url) {
      res.status(400).json({ error: 'Invalid model variant' });
      return;
    }
    const localModel = path.join(CACHE_DIR, `pose_landmarker_${variant}.task`);
    try {
      if (!existsSync(localModel)) {
        const resp = await fetch(url);
        if (!resp.ok) {
          res.status(502).json({ error: `Failed to fetch MediaPipe ${variant} model` });
          return;
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        writeFileSync(localModel, buf);
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      createReadStream(localModel).pipe(res);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Model load error' });
    }
  });

  function extractYouTubeInfoFromUrl(rawUrl: string): {
    videoId: string | null;
    clipId: string | null;
    startSec: number | null;
  } {
    const parsed = new URL(normalizeYouTubeUrl(rawUrl));
    const host = parsed.hostname.toLowerCase();
    const rawT = parsed.searchParams.get('t') || parsed.searchParams.get('start') || '';
    let startSec: number | null = null;
    if (/^\d+(\.\d+)?s?$/i.test(rawT)) {
      startSec = Number(rawT.replace(/s$/i, ''));
    }
    let videoId: string | null = null;
    let clipId: string | null = null;
    if (host === 'youtu.be') {
      videoId = parsed.pathname.split('/').filter(Boolean)[0] || null;
    } else {
      const segs = parsed.pathname.split('/').filter(Boolean);
      if (segs[0] === 'watch') videoId = parsed.searchParams.get('v');
      else if (segs[0] === 'shorts' || segs[0] === 'embed' || segs[0] === 'live') videoId = segs[1] || null;
      else if (segs[0] === 'clip') clipId = segs[1] || null;
      else videoId = parsed.searchParams.get('v');
    }
    return { videoId, clipId, startSec };
  }

  async function resolveYouTubeOEmbed(url: string): Promise<{
    title: string;
    uploader: string;
    thumbnail: string | null;
    embedUrl: string | null;
    videoId: string | null;
  } | null> {
    try {
      const oembedResp = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      );
      if (!oembedResp.ok) return null;
      const data = await oembedResp.json();
      const htmlStr = String(data.html || '');
      const srcMatch = htmlStr.match(/src="([^"]+)"/);
      const embedSrc = srcMatch ? srcMatch[1] : null;
      const idMatch = embedSrc?.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
      return {
        title: String(data.title || 'YouTube Figure Skating Video'),
        uploader: String(data.author_name || 'YouTube'),
        thumbnail: data.thumbnail_url ? String(data.thumbnail_url) : null,
        embedUrl: embedSrc,
        videoId: idMatch ? idMatch[1] : null,
      };
    } catch {
      return null;
    }
  }

  app.post('/api/youtube/probe', async (req: Request, res: Response) => {
    try {
      const rawUrl = String(req.body?.url || '');
      const cookiesTxt = typeof req.body?.cookiesTxt === 'string' ? req.body.cookiesTxt.trim() : '';
      if (!isValidYouTubeUrl(rawUrl)) {
        res.status(400).json({ error: 'Please provide a valid YouTube video URL (youtube.com or youtu.be).' });
        return;
      }
      const url = normalizeYouTubeUrl(rawUrl);
      const parsedIds = extractYouTubeInfoFromUrl(url);
      const bin = await ensureYtDlp();
      const args = [
        '--dump-single-json',
        '--no-playlist',
        '--no-warnings',
        '--js-runtimes', 'node',
      ];
      let cookieFile: string | null = null;
      if (cookiesTxt) {
        cookieFile = path.join(UPLOADS_TMP, `cookies-${crypto.randomUUID()}.txt`);
        writeFileSync(cookieFile, cookiesTxt, 'utf-8');
        args.push('--cookies', cookieFile);
      }
      args.push(url);

      try {
        const { stdout } = await runYtDlp(bin, args);
        const info = JSON.parse(stdout);
        const formats = Array.isArray(info.formats) ? info.formats : [];
        const has60fps = formats.some((f: Record<string, unknown>) => Number(f.fps || 0) >= 50);
        const vidId = String(info.id || parsedIds.videoId || '');
        res.json({
          title: info.title || 'YouTube Figure Skating Video',
          duration: Number(info.duration || 0),
          uploader: info.uploader || info.channel || 'YouTube',
          fps: Number(info.fps || (has60fps ? 60 : 30)),
          width: Number(info.width || 1280),
          height: Number(info.height || 720),
          thumbnail: info.thumbnail || null,
          has60fps,
          webpageUrl: info.webpage_url || url,
          videoId: vidId || null,
          embedUrl: vidId
            ? `https://www.youtube.com/embed/${vidId}?enablejsapi=1&rel=0${parsedIds.startSec ? `&start=${Math.floor(parsedIds.startSec)}` : ''}`
            : null,
          suggestedStartSec: info.section_start ?? parsedIds.startSec ?? null,
          suggestedEndSec: info.section_end ?? null,
          directDownloadAvailable: true,
        });
      } catch (ytErr) {
        const msg = ytErr instanceof Error ? ytErr.message : '';
        const isBotWall =
          msg.toLowerCase().includes('sign in') ||
          msg.toLowerCase().includes('bot');

        // Fall back to YouTube oEmbed so video info & embedded player capture still work seamlessly
        const oembed = await resolveYouTubeOEmbed(url);
        const vidId = oembed?.videoId || parsedIds.videoId;
        if (oembed || vidId) {
          res.json({
            title: oembed?.title || 'YouTube Figure Skating Clip',
            duration: 0,
            uploader: oembed?.uploader || 'YouTube',
            fps: 60,
            width: 1280,
            height: 720,
            thumbnail: oembed?.thumbnail || (vidId ? `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg` : null),
            has60fps: true,
            webpageUrl: url,
            videoId: vidId,
            embedUrl: vidId
              ? `https://www.youtube.com/embed/${vidId}?enablejsapi=1&rel=0${parsedIds.startSec ? `&start=${Math.floor(parsedIds.startSec)}` : ''}`
              : oembed?.embedUrl || null,
            suggestedStartSec: parsedIds.startSec,
            suggestedEndSec: null,
            directDownloadAvailable: false,
            botCheckNotice: isBotWall
              ? 'YouTube asked the cloud server for bot verification. Use "Record Clip from Player" below (no cookies needed) or provide cookies.txt.'
              : msg,
          });
          return;
        }
        throw ytErr;
      } finally {
        if (cookieFile && existsSync(cookieFile)) {
          rmSync(cookieFile, { force: true });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to read YouTube metadata';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/youtube/download', async (req: Request, res: Response) => {
    const videoId = crypto.randomUUID().slice(0, 12);
    const videoDir = path.join(VIDEOS_DIR, videoId);
    mkdirSync(videoDir, { recursive: true });
    let cookieFile: string | null = null;

    try {
      const rawUrl = String(req.body?.url || '');
      const start = req.body?.start !== undefined && req.body?.start !== null && req.body?.start !== ''
        ? Number(req.body.start)
        : null;
      const end = req.body?.end !== undefined && req.body?.end !== null && req.body?.end !== ''
        ? Number(req.body.end)
        : null;
      const cookiesTxt = typeof req.body?.cookiesTxt === 'string' ? req.body.cookiesTxt.trim() : '';

      if (!isValidYouTubeUrl(rawUrl)) {
        res.status(400).json({ error: 'Please provide a valid YouTube video URL.' });
        return;
      }
      if (start !== null && end !== null && (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)) {
        res.status(400).json({ error: 'End time must be greater than start time.' });
        return;
      }

      const url = normalizeYouTubeUrl(rawUrl);
      const bin = await ensureYtDlp();
      const outTemplate = path.join(videoDir, 'raw.%(ext)s');
      const formatSelector =
        'bv*[ext=mp4][height<=1080][fps>=50]/b[ext=mp4][height<=1080][fps>=50]/' +
        'bv*[ext=mp4][height<=1080]/b[ext=mp4][height<=1080]/bv*[height<=1080]/b[height<=1080]/b';

      const args = [
        '--no-playlist',
        '--no-warnings',
        '--js-runtimes', 'node',
        '-f', formatSelector,
        '--merge-output-format', 'mp4',
        '-o', outTemplate,
        '--print', 'after_move:filepath',
      ];

      if (start !== null || end !== null) {
        const s = start !== null && start >= 0 ? start : 0;
        const e = end !== null && end > s ? end : s + 15;
        args.push('--download-sections', `*${s}-${e}`, '--force-keyframes-at-cuts');
      }

      if (cookiesTxt) {
        cookieFile = path.join(UPLOADS_TMP, `cookies-${crypto.randomUUID()}.txt`);
        writeFileSync(cookieFile, cookiesTxt, 'utf-8');
        args.push('--cookies', cookieFile);
      }

      args.push(url);

      const { stdout } = await runYtDlp(bin, args);
      const reportedPath = stdout.trim().split(/\r?\n/).pop() || '';
      let downloadedPath = reportedPath && existsSync(reportedPath) ? reportedPath : '';
      if (!downloadedPath) {
        const files = readdirSync(videoDir).filter((f) => f.startsWith('raw.'));
        if (files.length > 0) {
          const mp4 = files.find((f) => f.endsWith('.mp4')) || files[0];
          downloadedPath = path.join(videoDir, mp4);
        }
      }

      if (!downloadedPath || !existsSync(downloadedPath)) {
        throw new Error('YouTube download finished without producing a video file.');
      }

      const initialProbe = await probeVideo(downloadedPath);
      const playablePath = await ensurePlayableMp4(
        downloadedPath,
        path.join(videoDir, 'playable.mp4'),
        initialProbe,
      );
      if (playablePath !== path.join(videoDir, 'playable.mp4')) {
        writeFileSync(path.join(videoDir, 'playable.txt'), playablePath, 'utf-8');
      }
      const finalProbe = playablePath === downloadedPath ? initialProbe : await probeVideo(playablePath);
      const meta = {
        videoId,
        source: 'youtube',
        url,
        ...finalProbe,
        filePath: playablePath,
      };
      writeFileSync(path.join(videoDir, 'meta.json'), JSON.stringify(meta, null, 2));

      res.json({
        videoId,
        streamUrl: `/api/videos/${videoId}/stream`,
        width: finalProbe.width,
        height: finalProbe.height,
        fps: finalProbe.fps,
        duration: finalProbe.duration,
        frameCount: finalProbe.frameCount,
        timestamps: finalProbe.timestamps,
        trimmedRange: start !== null || end !== null ? { start: start ?? 0, end: end ?? finalProbe.duration } : null,
      });
    } catch (err) {
      rmSync(videoDir, { recursive: true, force: true });
      const msg = err instanceof Error ? err.message : 'YouTube download failed';
      const isBotWall = msg.toLowerCase().includes('sign in') || msg.toLowerCase().includes('bot');
      const friendly = isBotWall
        ? 'YouTube asked the cloud server for verification. Capture the clip directly from the embedded YouTube player below, or provide cookies.txt.'
        : msg;
      res.status(isBotWall ? 422 : 400).json({ error: friendly, botBlocked: isBotWall });
    } finally {
      if (cookieFile && existsSync(cookieFile)) {
        rmSync(cookieFile, { force: true });
      }
    }
  });

  app.post('/api/upload', upload.single('video'), async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No video file uploaded' });
      return;
    }
    const ext = path.extname(req.file.originalname || 'video.mp4').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      rmSync(req.file.path, { force: true });
      res.status(400).json({ error: `Unsupported file type: ${ext || 'unknown'}` });
      return;
    }

    const videoId = crypto.randomUUID().slice(0, 12);
    const videoDir = path.join(VIDEOS_DIR, videoId);
    mkdirSync(videoDir, { recursive: true });
    const rawPath = path.join(videoDir, `raw${ext}`);

    try {
      const buf = readFileSync(req.file.path);
      writeFileSync(rawPath, buf);
      rmSync(req.file.path, { force: true });

      const initialProbe = await probeVideo(rawPath);
      const playablePath = await ensurePlayableMp4(
        rawPath,
        path.join(videoDir, 'playable.mp4'),
        initialProbe,
      );
      const finalProbe = playablePath === rawPath ? initialProbe : await probeVideo(playablePath);
      const meta = {
        videoId,
        source: 'upload',
        filename: req.file.originalname,
        ...finalProbe,
        filePath: playablePath,
      };
      writeFileSync(path.join(videoDir, 'meta.json'), JSON.stringify(meta, null, 2));

      res.json({
        videoId,
        filename: req.file.originalname,
        streamUrl: `/api/videos/${videoId}/stream`,
        width: finalProbe.width,
        height: finalProbe.height,
        fps: finalProbe.fps,
        duration: finalProbe.duration,
        frameCount: finalProbe.frameCount,
        timestamps: finalProbe.timestamps,
      });
    } catch (err) {
      rmSync(videoDir, { recursive: true, force: true });
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to process uploaded video' });
    }
  });

  app.get('/api/videos/:videoId/stream', (req: Request, res: Response) => {
    const videoId = sanitizeId(String(req.params.videoId));
    const metaPath = path.join(VIDEOS_DIR, videoId, 'meta.json');
    if (!existsSync(metaPath)) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    const filePath = String(meta.filePath || '');
    if (!filePath || !existsSync(filePath)) {
      res.status(404).json({ error: 'Video file missing' });
      return;
    }

    const stat = statSync(filePath);
    const total = stat.size;
    const range = req.headers.range;
    const contentType = filePath.endsWith('.webm') ? 'video/webm' : 'video/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Number(parts[0]);
      const end = parts[1] ? Number(parts[1]) : total - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      createReadStream(filePath).pipe(res);
    }
  });

  app.get('/api/sessions', (_req: Request, res: Response) => {
    const items: unknown[] = [];
    for (const entry of readdirSync(SESSIONS_DIR)) {
      const metaFile = path.join(SESSIONS_DIR, entry, 'session.json');
      if (existsSync(metaFile)) {
        try {
          const parsed = JSON.parse(readFileSync(metaFile, 'utf-8'));
          items.push({
            id: parsed.id,
            title: parsed.title,
            sourceType: parsed.sourceType,
            sourceUrl: parsed.sourceUrl || null,
            createdAt: parsed.createdAt,
            fps: parsed.fps,
            width: parsed.width,
            height: parsed.height,
            playbackSpeed: parsed.playbackSpeed,
            modelVariant: parsed.modelVariant,
            rotationSource: parsed.rotationSource,
            jumpCount: Array.isArray(parsed.jumps) ? parsed.jumps.length : 0,
            bestHeightM: Array.isArray(parsed.jumps) && parsed.jumps.length > 0
              ? Math.max(...parsed.jumps.map((j: { heightM: number }) => j.heightM))
              : 0,
            maxRotations: Array.isArray(parsed.jumps) && parsed.jumps.length > 0
              ? Math.max(...parsed.jumps.map((j: { rotations: number }) => j.rotations))
              : 0,
            jumps: parsed.jumps || [],
            videoId: parsed.videoId || null,
          });
        } catch {
          // Ignore corrupt session metadata
        }
      }
    }
    items.sort((a: unknown, b: unknown) => {
      const da = String((a as { createdAt?: string }).createdAt || '');
      const db = String((b as { createdAt?: string }).createdAt || '');
      return db.localeCompare(da);
    });
    res.json(items.slice(0, 100));
  });

  app.post('/api/sessions', (req: Request, res: Response) => {
    const id = sanitizeId(String(req.body?.id || crypto.randomUUID().slice(0, 12)));
    const sessionDir = path.join(SESSIONS_DIR, id);
    mkdirSync(sessionDir, { recursive: true });
    const payload = {
      ...req.body,
      id,
      createdAt: req.body?.createdAt || new Date().toISOString(),
    };
    writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(payload));
    res.json({ id, saved: true });
  });

  app.get('/api/sessions/:id', (req: Request, res: Response) => {
    const id = sanitizeId(String(req.params.id));
    const file = path.join(SESSIONS_DIR, id, 'session.json');
    if (!existsSync(file)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.type('application/json').send(readFileSync(file, 'utf-8'));
  });

  app.delete('/api/sessions/:id', (req: Request, res: Response) => {
    const id = sanitizeId(String(req.params.id));
    const sessionDir = path.join(SESSIONS_DIR, id);
    if (!existsSync(sessionDir)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    rmSync(sessionDir, { recursive: true, force: true });
    res.json({ deleted: id });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve('dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Skate Metrics server running on http://0.0.0.0:${PORT}`);
  });
}

createApp().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
