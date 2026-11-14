export interface Keypoint2D {
  x: number;
  y: number;
  confidence: number;
}

export interface Keypoint3D {
  x: number;
  y: number;
  z: number;
  confidence: number;
}

export interface PoseFrame {
  index: number;
  timestamp: number;
  keypoints: Record<string, Keypoint2D>;
  worldKeypoints: Record<string, Keypoint3D>;
}

export interface RoiBox {
  x: number; // normalized 0..1
  y: number;
  w: number;
  h: number;
}

export interface JumpWindow {
  takeoffIndex: number;
  landingIndex: number;
  takeoffTime: number;
  landingTime: number;
}

export interface JointTelemetry {
  preRotationDeg: number;
  airRotationDeg: number;
  landingShortageDeg: number;
  underRotationCall: 'Clean' | 'q (Quarter)' | '< (Under-rotated)' | '<< (Downgraded)';
  timeToSnapMs: number | null;
  minArmRadiusRatio: number | null;
  armSymmetryScore: number | null;
  takeoffKneeDeg: number | null;
  landingKneeDeg: number | null;
  minKneeSpreadRatio: number | null;
  peakAxisTiltDeg: number | null;
  headTiltDeg: number | null;
  entryDirection: 'Forward (Axel-type)' | 'Backward' | 'Unknown';
  jumpHint: string;
}

export interface JumpMetrics {
  id: string;
  takeoffIndex: number;
  landingIndex: number;
  takeoffTime: number;
  landingTime: number;
  flightTime: number;
  heightM: number;
  rotations: number;
  halfTurns: number;
  direction: 'counter-clockwise' | 'clockwise';
  avgRotationRps: number;
  peakRotationRps: number;
  playbackSpeed: number;
  method: 'foot' | 'com' | 'manual';
  rotationProfile: Array<[number, number]>;
  armRadiusProfile: Array<[number, number]>;
  footHeightProfile: Array<[number, number]>;
  joints: JointTelemetry;
}

export interface KeyframeSnapshot {
  label: 'Takeoff' | 'Apex' | 'Tightest Snap' | 'Landing';
  timestamp: number;
  frameIndex: number;
  dataUrl: string;
}

export interface VideoDescriptor {
  videoId: string;
  title: string;
  sourceType: 'youtube' | 'upload' | 'demo';
  sourceUrl?: string;
  streamUrl?: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  frameCount: number;
  timestamps: number[];
}

export interface SessionRecord {
  id: string;
  title: string;
  sourceType: 'youtube' | 'upload' | 'demo';
  sourceUrl?: string | null;
  videoId?: string | null;
  createdAt: string;
  fps: number;
  width: number;
  height: number;
  playbackSpeed: number;
  modelVariant: 'lite' | 'full' | 'heavy' | 'synthetic';
  rotationSource: string;
  cameraDriftPx: number;
  cameraDriftFraction: number;
  warnings: string[];
  jumps: JumpMetrics[];
  keyframes?: KeyframeSnapshot[];
  poseFrames?: PoseFrame[];
  jumpCount?: number;
  bestHeightM?: number;
  maxRotations?: number;
}

export const SKELETON_CONNECTIONS: Array<[string, string]> = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'],
  ['right_hip', 'right_knee'],
  ['left_knee', 'left_ankle'],
  ['right_knee', 'right_ankle'],
  ['left_ankle', 'left_heel'],
  ['right_ankle', 'right_heel'],
  ['left_heel', 'left_foot_index'],
  ['right_heel', 'right_foot_index'],
];

export const FOOT_KEYPOINTS = [
  'left_ankle',
  'right_ankle',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
];
