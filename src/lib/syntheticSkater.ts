import type { Keypoint2D, Keypoint3D, PoseFrame } from './types';

/**
 * Generates a deterministic 60 fps synthetic figure skater performing a 1.5-rev Axel-style
 * jump (0.60s flight time, ~0.44m height) with realistic knee load, arm snap, and head facing.
 */
export function generateSyntheticDemoFrames(fps = 60): {
  frames: PoseFrame[];
  width: number;
  height: number;
  duration: number;
} {
  const width = 960;
  const height = 540;
  const duration = 2.4;
  const total = Math.round(duration * fps);
  const takeoffT = 0.72;
  const flightT = 0.60;
  const landingT = takeoffT + flightT;
  const gPx = 980; // visual pixel scale for parabolic arc

  const frames: PoseFrame[] = [];

  for (let i = 0; i < total; i++) {
    const t = i / fps;
    const xBase = 210 + (t / duration) * 540;
    const iceY = 445;

    let footLift = 0;
    let airFrac = 0;
    if (t >= takeoffT && t <= landingT) {
      const u = t - takeoffT;
      footLift = Math.max(0, 0.5 * gPx * u * (flightT - u));
      airFrac = u / flightT;
    }

    // Knee bend during entry (0.50..0.72) and landing absorption (1.32..1.65)
    let kneeDrop = 0;
    if (t > takeoffT - 0.24 && t < takeoffT) {
      kneeDrop = 24 * Math.sin(((t - (takeoffT - 0.24)) / 0.24) * Math.PI);
    } else if (t > landingT && t < landingT + 0.30) {
      kneeDrop = 28 * Math.sin(((t - landingT) / 0.30) * Math.PI);
    }

    // Yaw: entry slight pre-rotation, 1.5 rev in air, check out on landing
    let yaw = 0.15;
    if (t >= takeoffT - 0.12 && t < takeoffT) {
      yaw = 0.15 + 0.35 * ((t - (takeoffT - 0.12)) / 0.12);
    } else if (t >= takeoffT && t <= landingT) {
      const sCurve = 0.5 - 0.5 * Math.cos(Math.PI * airFrac);
      yaw = 0.50 + 1.5 * 2 * Math.PI * (0.85 * airFrac + 0.15 * sCurve);
    } else if (t > landingT) {
      yaw = 0.50 + 1.5 * 2 * Math.PI + 0.18 * Math.min(1, (t - landingT) / 0.25);
    }

    // Arm radius snaps tight quickly after takeoff (~130ms)
    let armRadius = 46;
    if (t >= takeoffT && t <= landingT) {
      const snap = Math.min(1, (t - takeoffT) / 0.13);
      const openOut = t > landingT - 0.08 ? (t - (landingT - 0.08)) / 0.08 : 0;
      armRadius = 46 - 30 * snap + 26 * Math.max(0, openOut);
    } else if (t > landingT && t < landingT + 0.35) {
      armRadius = 62;
    }

    const hipY = iceY - 120 + kneeDrop - footLift;
    const shoulderY = hipY - 92;
    const headY = shoulderY - 38;
    const kneeY = iceY - 62 + kneeDrop * 0.55 - footLift;
    const ankleY = iceY - 12 - footLift;
    const footY = iceY - footLift;

    const sw = 28 * Math.cos(yaw);
    const sz = 0.18 * Math.sin(yaw);
    const sx = 0.18 * Math.cos(yaw);
    const hw = 18 * Math.cos(yaw - 0.08);
    const kw = t >= takeoffT && t <= landingT ? 7 * Math.cos(yaw) : 16 * Math.cos(yaw);

    const kp = (x: number, y: number, c = 0.96): Keypoint2D => ({ x, y, confidence: c });
    const w3 = (x: number, y: number, z: number, c = 0.96): Keypoint3D => ({ x, y, z, confidence: c });

    const keypoints: Record<string, Keypoint2D> = {
      nose: kp(xBase + 8 * Math.cos(yaw), headY + 2),
      left_eye: kp(xBase + 5 * Math.cos(yaw - 0.3), headY - 4),
      right_eye: kp(xBase + 5 * Math.cos(yaw + 0.3), headY - 4),
      left_ear: kp(xBase - 9 * Math.cos(yaw), headY - 2),
      right_ear: kp(xBase + 9 * Math.cos(yaw), headY - 2),
      left_shoulder: kp(xBase - sw, shoulderY),
      right_shoulder: kp(xBase + sw, shoulderY),
      left_elbow: kp(xBase - armRadius * Math.cos(yaw) - 8, shoulderY + 34),
      right_elbow: kp(xBase + armRadius * Math.cos(yaw) + 8, shoulderY + 34),
      left_wrist: kp(xBase - armRadius * 0.55 * Math.cos(yaw), shoulderY + 18),
      right_wrist: kp(xBase + armRadius * 0.55 * Math.cos(yaw), shoulderY + 18),
      left_hip: kp(xBase - hw, hipY),
      right_hip: kp(xBase + hw, hipY),
      left_knee: kp(xBase - kw, kneeY),
      right_knee: kp(xBase + kw, kneeY),
      left_ankle: kp(xBase - kw * 0.7, ankleY),
      right_ankle: kp(xBase + kw * 0.7, ankleY),
      left_heel: kp(xBase - kw * 0.7 - 6, footY),
      right_heel: kp(xBase + kw * 0.7 - 6, footY),
      left_foot_index: kp(xBase - kw * 0.7 + 10, footY),
      right_foot_index: kp(xBase + kw * 0.7 + 10, footY),
    };

    const worldKeypoints: Record<string, Keypoint3D> = {
      nose: w3(0.06 * Math.cos(yaw), -0.68, 0.06 * Math.sin(yaw)),
      left_ear: w3(-0.08 * Math.cos(yaw), -0.68, -0.08 * Math.sin(yaw)),
      right_ear: w3(0.08 * Math.cos(yaw), -0.68, 0.08 * Math.sin(yaw)),
      left_shoulder: w3(-sx, -0.45, -sz),
      right_shoulder: w3(sx, -0.45, sz),
      left_hip: w3(-0.12 * Math.cos(yaw - 0.08), 0.0, -0.12 * Math.sin(yaw - 0.08)),
      right_hip: w3(0.12 * Math.cos(yaw - 0.08), 0.0, 0.12 * Math.sin(yaw - 0.08)),
    };

    frames.push({
      index: i,
      timestamp: Number(t.toFixed(5)),
      keypoints,
      worldKeypoints,
    });
  }

  return { frames, width, height, duration };
}
