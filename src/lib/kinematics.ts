import {
  FOOT_KEYPOINTS,
  type JointTelemetry,
  type JumpMetrics,
  type JumpWindow,
  type Keypoint2D,
  type Keypoint3D,
  type PoseFrame,
} from './types';

const GRAVITY = 9.80665;
const VISIBILITY_THRESHOLD = 0.2;

export interface SegmentationOptions {
  minFlightS?: number;
  maxFlightS?: number;
  minGapS?: number;
  thresholdPx?: number | null;
  minPeakRatio?: number;
  playbackSpeed?: number;
}

function get2D(frame: PoseFrame, name: string): Keypoint2D | null {
  const pt = frame.keypoints[name];
  if (!pt || pt.confidence < VISIBILITY_THRESHOLD) return null;
  return pt;
}

function get3D(frame: PoseFrame, name: string): Keypoint3D | null {
  const pt = frame.worldKeypoints[name];
  if (!pt || pt.confidence < VISIBILITY_THRESHOLD) return null;
  return pt;
}

export function bodyCenter(frame: PoseFrame): { x: number; y: number } | null {
  const pts = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']
    .map((n) => get2D(frame, n))
    .filter((p): p is Keypoint2D => p !== null);
  if (pts.length === 0) return null;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

function lowestFootY(frame: PoseFrame): number {
  const footPts = FOOT_KEYPOINTS
    .map((n) => get2D(frame, n))
    .filter((p): p is Keypoint2D => p !== null);
  if (footPts.length > 0) {
    // Prefer higher-confidence foot points if an outlier has borderline confidence
    const highConf = footPts.filter((p) => p.confidence >= 0.45);
    const pool = highConf.length > 0 ? highConf : footPts;
    return Math.max(...pool.map((p) => p.y));
  }
  const ankles = ['left_ankle', 'right_ankle']
    .map((n) => get2D(frame, n))
    .filter((p): p is Keypoint2D => p !== null);
  return ankles.length > 0 ? Math.max(...ankles.map((p) => p.y)) : Number.NaN;
}

function interpolateNaN(values: number[]): number[] {
  const out = [...values];
  const validIndices: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (Number.isFinite(out[i])) validIndices.push(i);
  }
  if (validIndices.length === 0) return out.map(() => 0);

  for (let i = 0; i < validIndices[0]; i++) out[i] = out[validIndices[0]];
  for (let i = validIndices[validIndices.length - 1] + 1; i < out.length; i++) {
    out[i] = out[validIndices[validIndices.length - 1]];
  }
  for (let k = 0; k < validIndices.length - 1; k++) {
    const a = validIndices[k];
    const b = validIndices[k + 1];
    if (b - a <= 1) continue;
    const va = out[a];
    const vb = out[b];
    for (let i = a + 1; i < b; i++) {
      const t = (i - a) / (b - a);
      out[i] = va + t * (vb - va);
    }
  }
  return out;
}

function movingAverage(values: number[], windowSize: number): number[] {
  const n = values.length;
  if (n < 3 || windowSize <= 1) return [...values];
  const half = Math.floor(windowSize / 2);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      sum += values[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

function rollingPercentile(values: number[], windowSize: number, q: number): number[] {
  const n = values.length;
  const half = Math.floor(windowSize / 2);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    const slice = values.slice(lo, hi + 1).sort((a, b) => a - b);
    const idx = Math.min(slice.length - 1, Math.max(0, Math.floor((q / 100) * (slice.length - 1))));
    out[i] = slice[idx];
  }
  return out;
}

function percentile(values: number[], q: number): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return 0;
  const pos = (q / 100) * (finite.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return finite[lo];
  return finite[lo] + (finite[hi] - finite[lo]) * (pos - lo);
}

export function footHeightSeries(
  frames: PoseFrame[],
  playbackSpeed = 1.0,
  groundPercentile = 90,
  baselineRealWindowS = 3.0,
): { heights: number[]; medianBaselineY: number; rawFootY: number[] } {
  const raw = frames.map(lowestFootY);
  if (raw.filter(Number.isFinite).length === 0) {
    throw new Error('No foot keypoints found in any frame.');
  }
  const clean = interpolateNaN(raw);
  const realTimes = frames.map((f) => f.timestamp * playbackSpeed);
  const diffs: number[] = [];
  for (let i = 1; i < realTimes.length; i++) diffs.push(realTimes[i] - realTimes[i - 1]);
  const dt = diffs.length > 0 ? percentile(diffs, 50) : 1 / 60;
  let size = dt > 0 ? Math.round(baselineRealWindowS / dt) : 91;
  size = Math.max(5, size | 1);
  const baseline = clean.length >= size
    ? rollingPercentile(clean, size, groundPercentile)
    : clean.map(() => percentile(clean, groundPercentile));
  const heights = clean.map((y, i) => baseline[i] - y);
  return {
    heights,
    medianBaselineY: percentile(baseline, 50),
    rawFootY: clean,
  };
}

export function computeCameraDrift(frames: PoseFrame[], windowS = 1.0): number {
  const raw = frames.map(lowestFootY);
  if (raw.filter(Number.isFinite).length < 2) return 0;
  const clean = interpolateNaN(raw);
  const times = frames.map((f) => f.timestamp);
  if (times.length < 2) return 0;
  const start = times[0];
  const end = times[times.length - 1];
  if (end - start < windowS * 2) return 0;

  const levels: number[] = [];
  for (let t = start; t + windowS <= end; t += windowS / 2) {
    const slice: number[] = [];
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= t && times[i] < t + windowS) slice.push(clean[i]);
    }
    if (slice.length > 0) levels.push(percentile(slice, 90));
  }
  if (levels.length < 2) return 0;
  return Math.max(...levels) - Math.min(...levels);
}

function pairYaw3D(frame: PoseFrame, a: string, b: string): { angle: number; weight: number } {
  const pa = get3D(frame, a);
  const pb = get3D(frame, b);
  if (!pa || !pb) return { angle: Number.NaN, weight: 0 };
  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  const span = Math.hypot(dx, dz);
  if (span < 0.02) return { angle: Number.NaN, weight: 0 };
  return {
    angle: Math.atan2(dz, dx),
    weight: Math.min(pa.confidence, pb.confidence) * Math.min(span / 0.25, 1.5),
  };
}

function pairAngle2D(frame: PoseFrame, a: string, b: string): number {
  const pa = get2D(frame, a);
  const pb = get2D(frame, b);
  if (!pa || !pb) return Number.NaN;
  if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 4) return Number.NaN;
  return Math.atan2(pb.y - pa.y, pb.x - pa.x);
}

function unwrapAngles(angles: number[], maxStep = 2.5): number[] {
  const clean = interpolateNaN(angles);
  if (clean.length === 0) return [];
  const unwrapped = [clean[0]];
  for (let i = 1; i < clean.length; i++) {
    let diff = clean[i] - clean[i - 1];
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    unwrapped.push(unwrapped[i - 1] + diff);
  }
  // Repair impossible single-frame swaps while preserving surrounding velocity trend
  const repaired = [...unwrapped];
  for (let i = 1; i < repaired.length - 1; i++) {
    const step = repaired[i] - repaired[i - 1];
    if (Math.abs(step) > maxStep) {
      const prevStep = i >= 2 ? repaired[i - 1] - repaired[i - 2] : 0;
      const correction = step - prevStep;
      for (let j = i; j < repaired.length; j++) {
        repaired[j] -= correction;
      }
    }
  }
  return repaired;
}

function wrapDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function rotationSignal(frames: PoseFrame[]): {
  angles: number[];
  shoulderAngles: number[];
  hipAngles: number[];
  source: string;
} {
  const s3d = frames.map((f) => pairYaw3D(f, 'left_shoulder', 'right_shoulder'));
  const h3d = frames.map((f) => pairYaw3D(f, 'left_hip', 'right_hip'));
  const s2d = frames.map((f) => pairAngle2D(f, 'left_shoulder', 'right_shoulder'));
  const h2d = frames.map((f) => pairAngle2D(f, 'left_hip', 'right_hip'));

  const cov = (arr: number[]) => arr.filter(Number.isFinite).length / Math.max(arr.length, 1);
  const s3Cov = cov(s3d.map((x) => x.angle));
  const h3Cov = cov(h3d.map((x) => x.angle));
  const s2Cov = cov(s2d);
  const h2Cov = cov(h2d);

  const shoulderAngles = s3Cov >= 0.4
    ? unwrapAngles(s3d.map((x) => x.angle))
    : s2Cov >= 0.4
      ? unwrapAngles(s2d)
      : frames.map(() => 0);
  const hipAngles = h3Cov >= 0.4
    ? unwrapAngles(h3d.map((x) => x.angle))
    : h2Cov >= 0.4
      ? unwrapAngles(h2d)
      : frames.map(() => 0);

  // If both 3D signals have solid coverage, fuse angular steps weighted by visibility/span
  if (s3Cov >= 0.6 && h3Cov >= 0.6) {
    const fused = [shoulderAngles[0]];
    for (let i = 1; i < frames.length; i++) {
      const ws = s3d[i].weight || 0.5;
      const wh = h3d[i].weight || 0.3;
      const ds = shoulderAngles[i] - shoulderAngles[i - 1];
      const dh = hipAngles[i] - hipAngles[i - 1];
      const step = (ds * ws + dh * wh * 0.7) / (ws + wh * 0.7);
      fused.push(fused[i - 1] + step);
    }
    return { angles: fused, shoulderAngles, hipAngles, source: 'shoulders+hips-3d' };
  }

  if (s3Cov >= h3Cov && s3Cov >= 0.3) {
    return { angles: shoulderAngles, shoulderAngles, hipAngles, source: 'shoulders-3d' };
  }
  if (h3Cov >= 0.3) {
    return { angles: hipAngles, shoulderAngles, hipAngles, source: 'hips-3d' };
  }
  if (s2Cov >= h2Cov && s2Cov >= 0.3) {
    return { angles: shoulderAngles, shoulderAngles, hipAngles, source: 'shoulders-2d' };
  }
  if (h2Cov >= 0.3) {
    return { angles: hipAngles, shoulderAngles, hipAngles, source: 'hips-2d' };
  }
  throw new Error('Not enough visible torso keypoints to measure rotation.');
}

function derivative(values: number[], times: number[]): number[] {
  const n = values.length;
  if (n < 2) return values.map(() => 0);
  const raw = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      const dt = Math.max(times[1] - times[0], 1e-4);
      raw[i] = (values[1] - values[0]) / dt;
    } else if (i === n - 1) {
      const dt = Math.max(times[n - 1] - times[n - 2], 1e-4);
      raw[i] = (values[n - 1] - values[n - 2]) / dt;
    } else {
      const dt = Math.max(times[i + 1] - times[i - 1], 1e-4);
      raw[i] = (values[i + 1] - values[i - 1]) / dt;
    }
  }
  return movingAverage(raw, 5);
}

function contiguousRuns(mask: boolean[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && start === -1) start = i;
    if (!mask[i] && start !== -1) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start !== -1) runs.push([start, mask.length - 1]);
  return runs;
}

function zeroCrossingTime(
  times: number[],
  heights: number[],
  index: number,
  threshold: number,
  rising: boolean,
): number {
  const n = heights.length;
  let j = index;
  if (rising) {
    while (j > 0 && heights[j - 1] > threshold) j--;
  } else {
    while (j < n - 1 && heights[j + 1] > threshold) j++;
  }
  const a = rising ? Math.max(0, j - 1) : j;
  const b = rising ? j : Math.min(n - 1, j + 1);
  if (a === b) return times[j];
  const ya = heights[a];
  const yb = heights[b];
  if (!Number.isFinite(ya) || !Number.isFinite(yb) || yb === ya) return times[j];
  const frac = Math.min(1, Math.max(0, (threshold - ya) / (yb - ya)));
  const tCross = times[a] + frac * (times[b] - times[a]);
  const slope = (yb - ya) / Math.max(times[b] - times[a], 1e-6);
  if (!Number.isFinite(slope) || Math.abs(slope) < 1e-6) return tCross;
  const tZero = tCross - threshold / slope;
  const dt = Math.abs(times[b] - times[a]);
  return Math.min(Math.max(tZero, tCross - 2 * dt), tCross + 2 * dt);
}

function fitQuadraticRoots(
  times: number[],
  heights: number[],
  start: number,
  end: number,
  fallbackTakeoff: number,
  fallbackLanding: number,
): [number, number] {
  const len = end - start + 1;
  if (len < 6) return [fallbackTakeoff, fallbackLanding];

  // Solve least-squares quadratic in shifted time u = t - tMid for numerical stability
  const tMid = (times[start] + times[end]) / 2;
  let s0 = 0; let s1 = 0; let s2 = 0; let s3 = 0; let s4 = 0;
  let sy0 = 0; let sy1 = 0; let sy2 = 0;
  const ys: number[] = [];
  for (let i = start; i <= end; i++) {
    const u = times[i] - tMid;
    const y = heights[i];
    if (!Number.isFinite(y)) return [fallbackTakeoff, fallbackLanding];
    ys.push(y);
    const u2 = u * u;
    s0 += 1; s1 += u; s2 += u2; s3 += u2 * u; s4 += u2 * u2;
    sy0 += y; sy1 += y * u; sy2 += y * u2;
  }

  // Gaussian elimination for 3x3 normal equations: [s4 s3 s2; s3 s2 s1; s2 s1 s0] * [a b c]^T = [sy2 sy1 sy0]^T
  const M = [
    [s4, s3, s2, sy2],
    [s3, s2, s1, sy1],
    [s2, s1, s0, sy0],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return [fallbackTakeoff, fallbackLanding];
    for (let r = col + 1; r < 3; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
    }
  }
  const c = M[2][3] / M[2][2];
  const b = (M[1][3] - M[1][2] * c) / M[1][1];
  const a = (M[0][3] - M[0][2] * c - M[0][1] * b) / M[0][0];

  if (a >= 0) return [fallbackTakeoff, fallbackLanding];
  const meanY = sy0 / s0;
  let ssRes = 0; let ssTot = 0;
  for (let i = start; i <= end; i++) {
    const u = times[i] - tMid;
    const fit = a * u * u + b * u + c;
    ssRes += (heights[i] - fit) ** 2;
    ssTot += (heights[i] - meanY) ** 2;
  }
  if (ssTot <= 0 || 1 - ssRes / ssTot < 0.96) return [fallbackTakeoff, fallbackLanding];
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return [fallbackTakeoff, fallbackLanding];
  const sqrtD = Math.sqrt(disc);
  const r1 = (-b - sqrtD) / (2 * a) + tMid;
  const r2 = (-b + sqrtD) / (2 * a) + tMid;
  const takeoff = Math.min(r1, r2);
  const landing = Math.max(r1, r2);
  if (
    Math.abs(takeoff - fallbackTakeoff) <= 0.12 &&
    Math.abs(landing - fallbackLanding) <= 0.12 &&
    landing > takeoff
  ) {
    return [takeoff, landing];
  }
  return [fallbackTakeoff, fallbackLanding];
}

export function detectFootJumps(
  frames: PoseFrame[],
  options: SegmentationOptions = {},
): { windows: JumpWindow[]; heights: number[] } {
  const playbackSpeed = options.playbackSpeed ?? 1.0;
  const minFlightReal = options.minFlightS ?? 0.15;
  const maxFlightReal = options.maxFlightS ?? 1.05;
  const minGapReal = options.minGapS ?? 0.08;
  const minPeakRatio = options.minPeakRatio ?? 1.75;

  if (frames.length < 3) return { windows: [], heights: [] };

  const { heights: rawHeights } = footHeightSeries(frames, playbackSpeed);
  const heights = movingAverage(rawHeights, 3);
  const times = frames.map((f) => f.timestamp);

  const sortedH = [...heights].filter(Number.isFinite).sort((a, b) => a - b);
  const span = sortedH.length > 0
    ? percentile(sortedH, 99) - percentile(sortedH, 5)
    : 0;
  const threshold = options.thresholdPx ?? Math.max(4.0, 0.04 * span);

  // Median + morphological closing on boolean mask
  const rawMask = heights.map((h) => h > threshold);
  const closedMask = [...rawMask];
  for (let i = 1; i < closedMask.length - 1; i++) {
    if (rawMask[i - 1] && rawMask[i + 1]) closedMask[i] = true;
  }

  const runs = contiguousRuns(closedMask);
  if (runs.length === 0) return { windows: [], heights };

  const merged: Array<[number, number]> = [];
  for (const [s, e] of runs) {
    if (merged.length > 0 && (times[s] - times[merged[merged.length - 1][1]]) * playbackSpeed <= minGapReal) {
      merged[merged.length - 1][1] = e;
    } else {
      merged.push([s, e]);
    }
  }

  const windows: JumpWindow[] = [];
  for (const [s, e] of merged) {
    const rawFlightReal = (times[e] - times[s]) * playbackSpeed;
    if (rawFlightReal < minFlightReal || rawFlightReal > maxFlightReal) continue;
    let peak = -Infinity;
    for (let i = s; i <= e; i++) peak = Math.max(peak, heights[i]);
    if (peak < threshold * minPeakRatio) continue;

    const to = zeroCrossingTime(times, heights, s, threshold, true);
    const la = zeroCrossingTime(times, heights, e, threshold, false);
    const [rTo, rLa] = fitQuadraticRoots(times, heights, s, e, to, la);
    if ((rLa - rTo) * playbackSpeed < minFlightReal) continue;
    windows.push({
      takeoffIndex: s,
      landingIndex: e,
      takeoffTime: rTo,
      landingTime: rLa,
    });
  }

  return { windows, heights };
}

export function detectComJumps(
  frames: PoseFrame[],
  options: SegmentationOptions = {},
): JumpWindow[] {
  const playbackSpeed = options.playbackSpeed ?? 1.0;
  const minFlightReal = Math.max(options.minFlightS ?? 0.15, 0.2);
  const maxFlightReal = options.maxFlightS ?? 1.05;
  if (frames.length < 8) return [];

  const ys = interpolateNaN(frames.map((f) => bodyCenter(f)?.y ?? Number.NaN));
  const times = frames.map((f) => f.timestamp);
  const realTimes = times.map((t) => t * playbackSpeed);
  const diffs: number[] = [];
  for (let i = 1; i < realTimes.length; i++) diffs.push(realTimes[i] - realTimes[i - 1]);
  const dt = diffs.length > 0 ? percentile(diffs, 50) : 1 / 60;
  let win = Math.max(7, Math.round(1.5 / Math.max(dt, 1e-4)) | 1);
  win = Math.min(win, ys.length % 2 === 1 ? ys.length : ys.length - 1);
  if (win <= 3) return [];

  const trend = movingAverage(ys, win);
  const residual = trend.map((tr, i) => tr - ys[i]);
  const pos = residual.filter((r) => r > 0);
  if (pos.length === 0) return [];
  const threshold = Math.max(6.0, 0.12 * Math.max(...pos));
  const runs = contiguousRuns(residual.map((r) => r > threshold));

  const windows: JumpWindow[] = [];
  for (const [start, end] of runs) {
    let peak = -Infinity;
    for (let i = start; i <= end; i++) peak = Math.max(peak, residual[i]);
    if (peak < threshold * 1.4) continue;
    let a = start;
    while (a > 0 && residual[a - 1] > 0) a--;
    let b = end;
    while (b < residual.length - 1 && residual[b + 1] > 0) b++;

    let takeoffT = times[a];
    let landingT = times[b];
    if (a > 0) {
      const frac = residual[a - 1] / (residual[a - 1] - residual[a]);
      takeoffT = times[a - 1] + frac * (times[a] - times[a - 1]);
    }
    if (b < residual.length - 1) {
      const frac = residual[b] / (residual[b] - residual[b + 1]);
      landingT = times[b] + frac * (times[b + 1] - times[b]);
    }
    const flightReal = (landingT - takeoffT) * playbackSpeed;
    if (flightReal >= minFlightReal && flightReal <= maxFlightReal) {
      windows.push({
        takeoffIndex: a,
        landingIndex: b,
        takeoffTime: takeoffT,
        landingTime: landingT,
      });
    }
  }
  return windows;
}

function interpAt(times: number[], values: number[], t: number): number {
  if (times.length === 0) return 0;
  if (t <= times[0]) return values[0];
  if (t >= times[times.length - 1]) return values[values.length - 1];
  for (let i = 1; i < times.length; i++) {
    if (times[i] >= t) {
      const frac = (t - times[i - 1]) / Math.max(times[i] - times[i - 1], 1e-6);
      return values[i - 1] + frac * (values[i] - values[i - 1]);
    }
  }
  return values[values.length - 1];
}

function jointAngleDeg(a: Keypoint2D | null, b: Keypoint2D | null, c: Keypoint2D | null): number | null {
  if (!a || !b || !c) return null;
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 2 || m2 < 2) return null;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function torsoHeightPx(frame: PoseFrame): number | null {
  const ls = get2D(frame, 'left_shoulder');
  const rs = get2D(frame, 'right_shoulder');
  const lh = get2D(frame, 'left_hip');
  const rh = get2D(frame, 'right_hip');
  if (!ls || !rs || !lh || !rh) return null;
  const smx = (ls.x + rs.x) / 2;
  const smy = (ls.y + rs.y) / 2;
  const hmx = (lh.x + rh.x) / 2;
  const hmy = (lh.y + rh.y) / 2;
  const h = Math.hypot(smx - hmx, smy - hmy);
  return h > 8 ? h : null;
}

function computeJointTelemetry(
  frames: PoseFrame[],
  win: JumpWindow,
  angles: number[],
  rotations: number,
  halfTurns: number,
  playbackSpeed: number,
): { telemetry: JointTelemetry; armProfile: Array<[number, number]> } {
  const times = frames.map((f) => f.timestamp);
  const realPreWin = 0.25 / Math.max(playbackSpeed, 0.05);
  const preIdx = frames.findIndex((f) => f.timestamp >= win.takeoffTime - realPreWin);
  const startPre = preIdx >= 0 ? preIdx : Math.max(0, win.takeoffIndex - 10);

  // Pre-rotation: rotation between entry start and takeoff
  const preRotRad = Math.abs(angles[win.takeoffIndex] - angles[startPre]);
  const preRotationDeg = Math.min(270, (preRotRad * 180) / Math.PI);
  const airRotationDeg = rotations * 360;

  // Landing shortage relative to rounded skating half-turns
  const targetDeg = halfTurns * 360;
  const deficit = Math.max(0, targetDeg - airRotationDeg);
  let underRotationCall: JointTelemetry['underRotationCall'] = 'Clean';
  if (deficit >= 180) underRotationCall = '<< (Downgraded)';
  else if (deficit > 90) underRotationCall = '< (Under-rotated)';
  else if (deficit >= 75) underRotationCall = 'q (Quarter)';

  // Arm snap speed & tightness (wrists + elbows relative to torso center, normalized by torso height)
  const armProfile: Array<[number, number]> = [];
  const symDeltas: number[] = [];
  const kneeSpreads: number[] = [];
  const axisTilts: number[] = [];
  const headTilts: number[] = [];

  let minArmRatio = Infinity;
  let minArmTime = win.takeoffTime;

  for (let i = win.takeoffIndex; i <= win.landingIndex && i < frames.length; i++) {
    const f = frames[i];
    const th = torsoHeightPx(f);
    const center = bodyCenter(f);
    if (th && center) {
      const lw = get2D(f, 'left_wrist') || get2D(f, 'left_elbow');
      const rw = get2D(f, 'right_wrist') || get2D(f, 'right_elbow');
      if (lw && rw) {
        const dl = Math.hypot(lw.x - center.x, lw.y - center.y) / th;
        const dr = Math.hypot(rw.x - center.x, rw.y - center.y) / th;
        const meanR = (dl + dr) / 2;
        armProfile.push([f.timestamp, Number(meanR.toFixed(3))]);
        symDeltas.push(Math.abs(dl - dr));
        if (meanR < minArmRatio) {
          minArmRatio = meanR;
          minArmTime = f.timestamp;
        }
      }
      const lk = get2D(f, 'left_knee');
      const rk = get2D(f, 'right_knee');
      if (lk && rk) {
        kneeSpreads.push(Math.hypot(lk.x - rk.x, lk.y - rk.y) / th);
      }
    }

    const ls = get2D(f, 'left_shoulder');
    const rs = get2D(f, 'right_shoulder');
    const lh = get2D(f, 'left_hip');
    const rh = get2D(f, 'right_hip');
    if (ls && rs && lh && rh) {
      const smx = (ls.x + rs.x) / 2;
      const smy = (ls.y + rs.y) / 2;
      const hmx = (lh.x + rh.x) / 2;
      const hmy = (lh.y + rh.y) / 2;
      const tilt = Math.abs((Math.atan2(smx - hmx, hmy - smy) * 180) / Math.PI);
      axisTilts.push(tilt);

      const head = get2D(f, 'nose') || get2D(f, 'left_eye') || get2D(f, 'right_eye');
      if (head) {
        const hTilt = Math.abs((Math.atan2(head.x - smx, smy - head.y) * 180) / Math.PI);
        headTilts.push(hTilt);
      }
    }
  }

  // Knee flexion at takeoff & landing
  const takeoffKnees: number[] = [];
  for (let i = Math.max(0, win.takeoffIndex - 6); i <= win.takeoffIndex; i++) {
    const f = frames[i];
    const lk = jointAngleDeg(get2D(f, 'left_hip'), get2D(f, 'left_knee'), get2D(f, 'left_ankle'));
    const rk = jointAngleDeg(get2D(f, 'right_hip'), get2D(f, 'right_knee'), get2D(f, 'right_ankle'));
    if (lk !== null) takeoffKnees.push(lk);
    if (rk !== null) takeoffKnees.push(rk);
  }
  const landingKnees: number[] = [];
  for (let i = win.landingIndex; i <= Math.min(frames.length - 1, win.landingIndex + 8); i++) {
    const f = frames[i];
    const lk = jointAngleDeg(get2D(f, 'left_hip'), get2D(f, 'left_knee'), get2D(f, 'left_ankle'));
    const rk = jointAngleDeg(get2D(f, 'right_hip'), get2D(f, 'right_knee'), get2D(f, 'right_ankle'));
    if (lk !== null) landingKnees.push(lk);
    if (rk !== null) landingKnees.push(rk);
  }

  // Entry facing vs velocity direction for Axel vs backward-entry jump hint
  let entryDirection: JointTelemetry['entryDirection'] = 'Unknown';
  const entryF = frames[Math.max(0, win.takeoffIndex - 2)];
  const prevF = frames[Math.max(0, win.takeoffIndex - 6)];
  const nose3 = get3D(entryF, 'nose');
  const lEar3 = get3D(entryF, 'left_ear');
  const rEar3 = get3D(entryF, 'right_ear');
  const c1 = bodyCenter(prevF);
  const c2 = bodyCenter(entryF);
  if (nose3 && lEar3 && rEar3 && c1 && c2) {
    const earMidX = (lEar3.x + rEar3.x) / 2;
    const faceDx = nose3.x - earMidX;
    const velDx = c2.x - c1.x;
    if (Math.abs(velDx) > 3 && Math.abs(faceDx) > 0.02) {
      entryDirection = faceDx * velDx > 0 ? 'Forward (Axel-type)' : 'Backward';
    }
  } else {
    // Half-turn pattern fallback: .5 turns strongly suggests Axel
    const frac = Math.abs(halfTurns - Math.floor(halfTurns) - 0.5);
    if (frac < 0.1) entryDirection = 'Forward (Axel-type)';
    else if (halfTurns >= 1) entryDirection = 'Backward';
  }

  let jumpHint = `${halfTurns}T Jump`;
  if (entryDirection === 'Forward (Axel-type)' || Math.abs(halfTurns - Math.floor(halfTurns) - 0.5) < 0.1) {
    if (halfTurns === 1.5) jumpHint = '1A (Single Axel)';
    else if (halfTurns === 2.5) jumpHint = '2A (Double Axel)';
    else if (halfTurns === 3.5) jumpHint = '3A (Triple Axel)';
    else if (halfTurns === 4.5) jumpHint = '4A (Quad Axel)';
    else jumpHint = `${halfTurns} rev Axel`;
  } else if (halfTurns === 1) jumpHint = 'Single Jump (1T/1S/1Lo/1F/1Lz)';
  else if (halfTurns === 2) jumpHint = 'Double Jump (2T/2S/2Lo/2F/2Lz)';
  else if (halfTurns === 3) jumpHint = 'Triple Jump (3T/3S/3Lo/3F/3Lz)';
  else if (halfTurns === 4) jumpHint = 'Quad Jump (4T/4S/4Lo/4F/4Lz)';

  const timeToSnapMs = Number.isFinite(minArmRatio)
    ? Math.max(0, Math.round((minArmTime - win.takeoffTime) * playbackSpeed * 1000))
    : null;
  const armSymmetryScore = symDeltas.length > 0
    ? Number(Math.max(0, Math.min(100, 100 - (symDeltas.reduce((a, b) => a + b, 0) / symDeltas.length) * 140)).toFixed(0))
    : null;

  const avgAxisTilt = axisTilts.length > 0
    ? Number(Math.max(...axisTilts).toFixed(1))
    : null;
  const avgHeadTilt = headTilts.length > 0
    ? Number((headTilts.reduce((a, b) => a + b, 0) / headTilts.length).toFixed(1))
    : null;

  void times;
  return {
    telemetry: {
      preRotationDeg: Number(preRotationDeg.toFixed(0)),
      airRotationDeg: Number(airRotationDeg.toFixed(0)),
      landingShortageDeg: Number(deficit.toFixed(0)),
      underRotationCall,
      timeToSnapMs,
      minArmRadiusRatio: Number.isFinite(minArmRatio) ? Number(minArmRatio.toFixed(2)) : null,
      armSymmetryScore,
      takeoffKneeDeg: takeoffKnees.length > 0 ? Number(Math.min(...takeoffKnees).toFixed(0)) : null,
      landingKneeDeg: landingKnees.length > 0 ? Number(Math.min(...landingKnees).toFixed(0)) : null,
      minKneeSpreadRatio: kneeSpreads.length > 0 ? Number(Math.min(...kneeSpreads).toFixed(2)) : null,
      peakAxisTiltDeg: avgAxisTilt,
      headTiltDeg: avgHeadTilt,
      entryDirection,
      jumpHint,
    },
    armProfile,
  };
}

export function buildJumpMetrics(
  frames: PoseFrame[],
  win: JumpWindow,
  angles: number[],
  footHeights: number[],
  playbackSpeed: number,
  method: JumpMetrics['method'],
  id: string,
): JumpMetrics {
  const times = frames.map((f) => f.timestamp);
  const rates = derivative(angles, times).map((r) => r / (2 * Math.PI));
  const angleTo = interpAt(times, angles, win.takeoffTime);
  const angleLa = interpAt(times, angles, win.landingTime);
  const delta = angleLa - angleTo;
  const rotations = Math.abs(delta) / (2 * Math.PI);
  const halfTurns = Math.round(rotations * 2) / 2;
  const flightTime = (win.landingTime - win.takeoffTime) * playbackSpeed;
  const heightM = (GRAVITY * flightTime * flightTime) / 8;
  const avgRotationRps = flightTime > 0 ? rotations / flightTime : 0;

  const inAirIndices: number[] = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= win.takeoffTime && times[i] <= win.landingTime) inAirIndices.push(i);
  }
  let peakSlice = inAirIndices.map((i) => Math.abs(rates[i]) / playbackSpeed);
  if (peakSlice.length > 6) peakSlice = peakSlice.slice(2, -2);
  const peakRotationRps = peakSlice.length > 0 ? Math.max(...peakSlice) : 0;

  const rotationProfile: Array<[number, number]> = inAirIndices.map((i) => [
    Number(times[i].toFixed(4)),
    Number((rates[i] / playbackSpeed).toFixed(3)),
  ]);

  const padLo = Math.max(0, win.takeoffIndex - 8);
  const padHi = Math.min(frames.length - 1, win.landingIndex + 8);
  const footHeightProfile: Array<[number, number]> = [];
  for (let i = padLo; i <= padHi; i++) {
    footHeightProfile.push([Number(times[i].toFixed(4)), Number((footHeights[i] ?? 0).toFixed(2))]);
  }

  const { telemetry, armProfile } = computeJointTelemetry(
    frames,
    win,
    angles,
    rotations,
    halfTurns,
    playbackSpeed,
  );

  return {
    id,
    takeoffIndex: win.takeoffIndex,
    landingIndex: win.landingIndex,
    takeoffTime: Number(win.takeoffTime.toFixed(4)),
    landingTime: Number(win.landingTime.toFixed(4)),
    flightTime: Number(flightTime.toFixed(4)),
    heightM: Number(heightM.toFixed(4)),
    rotations: Number(rotations.toFixed(3)),
    halfTurns: Number(halfTurns.toFixed(1)),
    direction: delta >= 0 ? 'counter-clockwise' : 'clockwise',
    avgRotationRps: Number(avgRotationRps.toFixed(2)),
    peakRotationRps: Number(peakRotationRps.toFixed(2)),
    playbackSpeed,
    method,
    rotationProfile,
    armRadiusProfile: armProfile,
    footHeightProfile,
    joints: telemetry,
  };
}

export interface FullAnalysisOutput {
  jumps: JumpMetrics[];
  rotationSource: string;
  cameraDriftPx: number;
  cameraDriftFraction: number;
  warnings: string[];
  angles: number[];
  footHeights: number[];
}

export function analyzePoseFrames(
  frames: PoseFrame[],
  frameHeight: number,
  options: SegmentationOptions = {},
): FullAnalysisOutput {
  if (frames.length === 0) {
    throw new Error('No frames were extracted for analysis.');
  }
  const playbackSpeed = options.playbackSpeed ?? 1.0;
  const { angles, source: rotationSource } = rotationSignal(frames);
  const { windows: footWindows, heights: footHeights } = detectFootJumps(frames, options);

  let method: JumpMetrics['method'] = 'foot';
  let windows = footWindows;
  if (windows.length === 0) {
    windows = detectComJumps(frames, options);
    if (windows.length > 0) method = 'com';
  }

  const allJumps = windows.map((win, idx) =>
    buildJumpMetrics(frames, win, angles, footHeights, playbackSpeed, method, `jump-${idx + 1}`),
  );
  const jumps = allJumps.filter((j) => j.rotations >= 0.35 && j.heightM <= 1.15);

  const driftPx = computeCameraDrift(frames);
  const driftFraction = frameHeight > 0 ? driftPx / frameHeight : 0;
  const warnings: string[] = [];

  if (driftFraction > 0.03) {
    let msg = `Camera moved during the clip (ice line drifted ${(driftFraction * 100).toFixed(1)}% of frame height); height and rotation may be approximate.`;
    if (method === 'com') {
      msg += ' A jump was detected using the body-centre fallback.';
    }
    warnings.push(msg);
  } else if (method === 'com') {
    warnings.push('Jump detected using the moving-camera body-centre fallback; timing is approximate.');
  }
  if (Math.abs(playbackSpeed - 1.0) > 1e-5) {
    warnings.push(`Playback speed ${playbackSpeed}× applied — ensure the whole clip uses consistent slow-motion speed.`);
  }
  if (rotationSource.endsWith('-2d')) {
    warnings.push('2D-only rotation signal used; 3D world landmarks are preferred for multi-turn counting.');
  }
  if (jumps.length === 0) {
    warnings.push('No jumps passed automatic filters. Try trimming closer to the jump, adjusting playback speed, or nudging takeoff/landing frames.');
  }

  return {
    jumps,
    rotationSource,
    cameraDriftPx: Number(driftPx.toFixed(1)),
    cameraDriftFraction: Number(driftFraction.toFixed(4)),
    warnings,
    angles,
    footHeights,
  };
}

export function nudgeJumpBoundary(
  frames: PoseFrame[],
  jump: JumpMetrics,
  deltaTakeoffFrames: number,
  deltaLandingFrames: number,
  playbackSpeed: number,
): JumpMetrics {
  const newTo = Math.max(0, Math.min(frames.length - 3, jump.takeoffIndex + deltaTakeoffFrames));
  const newLa = Math.max(newTo + 2, Math.min(frames.length - 1, jump.landingIndex + deltaLandingFrames));
  const { angles } = rotationSignal(frames);
  const { heights } = footHeightSeries(frames, playbackSpeed);
  const win: JumpWindow = {
    takeoffIndex: newTo,
    landingIndex: newLa,
    takeoffTime: frames[newTo].timestamp,
    landingTime: frames[newLa].timestamp,
  };
  return buildJumpMetrics(frames, win, angles, heights, playbackSpeed, 'manual', jump.id);
}
