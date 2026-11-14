import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type {
  JumpMetrics,
  KeyframeSnapshot,
  Keypoint2D,
  Keypoint3D,
  PoseFrame,
  RoiBox,
} from './types';

// MediaPipe 33-landmark canonical names matching skate-metrics Python conventions
const MP_LANDMARK_NAMES = [
  'nose',
  'left_eye_inner',
  'left_eye',
  'left_eye_outer',
  'right_eye_inner',
  'right_eye',
  'right_eye_outer',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_pinky',
  'right_pinky',
  'left_index',
  'right_index',
  'left_thumb',
  'right_thumb',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
] as const;

let cachedLandmarker: { variant: string; instance: PoseLandmarker } | null = null;

async function getLandmarker(variant: 'lite' | 'full' | 'heavy'): Promise<PoseLandmarker> {
  if (cachedLandmarker && cachedLandmarker.variant === variant) {
    return cachedLandmarker.instance;
  }
  if (cachedLandmarker) {
    cachedLandmarker.instance.close();
    cachedLandmarker = null;
  }
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const instance = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `/api/mediapipe/model/${variant}`,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.3,
    minPosePresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
  cachedLandmarker = { variant, instance };
  return instance;
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.max(0, Math.min(timeSec, Math.max(0, video.duration - 0.001)));
    if (Math.abs(video.currentTime - target) < 0.001) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = target;
  });
}

function mapLandmarks(
  result: PoseLandmarkerResult,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
): { keypoints: Record<string, Keypoint2D>; worldKeypoints: Record<string, Keypoint3D> } {
  const keypoints: Record<string, Keypoint2D> = {};
  const worldKeypoints: Record<string, Keypoint3D> = {};

  const lm2d = result.landmarks?.[0];
  if (lm2d) {
    for (let i = 0; i < lm2d.length && i < MP_LANDMARK_NAMES.length; i++) {
      const pt = lm2d[i];
      keypoints[MP_LANDMARK_NAMES[i]] = {
        x: cropX + pt.x * cropW,
        y: cropY + pt.y * cropH,
        confidence: pt.visibility ?? 0.9,
      };
    }
  }

  const lm3d = result.worldLandmarks?.[0];
  if (lm3d) {
    for (let i = 0; i < lm3d.length && i < MP_LANDMARK_NAMES.length; i++) {
      const pt = lm3d[i];
      worldKeypoints[MP_LANDMARK_NAMES[i]] = {
        x: pt.x,
        y: pt.y,
        z: pt.z,
        confidence: pt.visibility ?? 0.9,
      };
    }
  }

  return { keypoints, worldKeypoints };
}

export interface ExtractPoseOptions {
  videoUrl: string;
  fps: number;
  duration: number;
  timestamps: number[];
  modelVariant: 'lite' | 'full' | 'heavy';
  startSec?: number | null;
  endSec?: number | null;
  roi?: RoiBox | null;
  onProgress?: (pct: number, label: string) => void;
  abortSignal?: AbortSignal;
}

export async function extractPoseFromVideo(options: ExtractPoseOptions): Promise<{
  frames: PoseFrame[];
  width: number;
  height: number;
}> {
  const {
    videoUrl,
    fps,
    duration,
    timestamps,
    modelVariant,
    startSec,
    endSec,
    roi,
    onProgress,
    abortSignal,
  } = options;

  onProgress?.(4, `Loading MediaPipe Pose (${modelVariant})...`);
  const landmarker = await getLandmarker(modelVariant);

  onProgress?.(10, 'Preparing video decoder...');
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => resolve();
    const onErr = () => reject(new Error('Failed to load video stream in browser'));
    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('error', onErr, { once: true });
  });

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const effectiveDuration = video.duration || duration || 5;

  const s = startSec !== undefined && startSec !== null ? Math.max(0, startSec) : 0;
  const e = endSec !== undefined && endSec !== null ? Math.min(effectiveDuration, endSec) : effectiveDuration;

  let sampleTimes: number[];
  if (timestamps.length > 0) {
    sampleTimes = timestamps.filter((t) => t >= s && t <= e);
    if (sampleTimes.length === 0) {
      sampleTimes = timestamps;
    }
  } else {
    const dt = 1 / Math.max(fps || 60, 15);
    sampleTimes = [];
    for (let t = s; t <= e; t += dt) sampleTimes.push(t);
  }

  // Cap overly long scans (> 900 frames / 15s at 60fps) cleanly by warning or subsampling only if huge
  if (sampleTimes.length > 1200) {
    const stride = Math.ceil(sampleTimes.length / 1200);
    sampleTimes = sampleTimes.filter((_, idx) => idx % stride === 0);
  }

  const canvas = document.createElement('canvas');
  let cropX = 0;
  let cropY = 0;
  let cropW = width;
  let cropH = height;

  if (roi && roi.w > 0.05 && roi.h > 0.05) {
    const padX = roi.w * 0.18;
    const padY = roi.h * 0.18;
    const nx = Math.max(0, roi.x - padX);
    const ny = Math.max(0, roi.y - padY);
    const nw = Math.min(1 - nx, roi.w + padX * 2);
    const nh = Math.min(1 - ny, roi.h + padY * 2);
    cropX = Math.round(nx * width);
    cropY = Math.round(ny * height);
    cropW = Math.max(64, Math.round(nw * width));
    cropH = Math.max(64, Math.round(nh * height));
  }

  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('Unable to create 2D canvas context');

  const frames: PoseFrame[] = [];
  let lastMs = -1;

  for (let i = 0; i < sampleTimes.length; i++) {
    if (abortSignal?.aborted) {
      throw new Error('Analysis cancelled');
    }
    const t = sampleTimes[i];
    await seekVideo(video, t);
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const ms = Math.max(Math.round(t * 1000), lastMs + 1);
    lastMs = ms;
    const result = landmarker.detectForVideo(canvas, ms);
    const { keypoints, worldKeypoints } = mapLandmarks(result, cropX, cropY, cropW, cropH);

    frames.push({
      index: i,
      timestamp: Number(t.toFixed(5)),
      keypoints,
      worldKeypoints,
    });

    if (i % 5 === 0 || i === sampleTimes.length - 1) {
      const pct = 12 + Math.round(((i + 1) / sampleTimes.length) * 82);
      onProgress?.(pct, `Detecting pose landmarks (${i + 1}/${sampleTimes.length} frames)...`);
    }
  }

  video.src = '';
  return { frames, width, height };
}

export async function captureJumpKeyframes(
  videoUrl: string,
  frames: PoseFrame[],
  jump: JumpMetrics,
): Promise<KeyframeSnapshot[]> {
  if (frames.length === 0) return [];
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Could not capture keyframes')), { once: true });
  });

  const w = 360;
  const aspect = (video.videoHeight || 720) / Math.max(video.videoWidth || 1280, 1);
  const h = Math.round(w * aspect);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const apexIdx = Math.round((jump.takeoffIndex + jump.landingIndex) / 2);
  let snapIdx = apexIdx;
  if (jump.armRadiusProfile.length > 0) {
    let minVal = Infinity;
    let minTime = frames[apexIdx]?.timestamp ?? jump.takeoffTime;
    for (const [t, r] of jump.armRadiusProfile) {
      if (r < minVal) {
        minVal = r;
        minTime = t;
      }
    }
    const found = frames.findIndex((f) => f.timestamp >= minTime);
    if (found >= 0) snapIdx = found;
  }

  const targets: Array<{ label: KeyframeSnapshot['label']; idx: number }> = [
    { label: 'Takeoff', idx: jump.takeoffIndex },
    { label: 'Tightest Snap', idx: snapIdx },
    { label: 'Apex', idx: apexIdx },
    { label: 'Landing', idx: jump.landingIndex },
  ];

  const snapshots: KeyframeSnapshot[] = [];
  for (const item of targets) {
    const safeIdx = Math.max(0, Math.min(frames.length - 1, item.idx));
    const ts = frames[safeIdx].timestamp;
    await seekVideo(video, ts);
    ctx.drawImage(video, 0, 0, w, h);
    snapshots.push({
      label: item.label,
      timestamp: ts,
      frameIndex: safeIdx,
      dataUrl: canvas.toDataURL('image/jpeg', 0.82),
    });
  }

  video.src = '';
  return snapshots;
}
