import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import { bodyCenter } from '../lib/kinematics';
import { SKELETON_CONNECTIONS, type JumpMetrics, type PoseFrame, type RoiBox } from '../lib/types';

interface VideoSkeletonPlayerProps {
  videoUrl?: string;
  isSynthetic?: boolean;
  width: number;
  height: number;
  fps: number;
  duration: number;
  frames: PoseFrame[];
  jumps: JumpMetrics[];
  activeJumpId?: string;
  currentTime: number;
  onTimeChange: (t: number) => void;
  roi: RoiBox | null;
  onRoiChange?: (roi: RoiBox | null) => void;
  allowRoiEdit?: boolean;
}

export const VideoSkeletonPlayer: React.FC<VideoSkeletonPlayerProps> = ({
  videoUrl,
  isSynthetic = false,
  width,
  height,
  fps,
  duration,
  frames,
  jumps,
  activeJumpId,
  currentTime,
  onTimeChange,
  roi,
  onRoiChange,
  allowRoiEdit = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<'overlay' | 'skeleton'>('overlay');
  const [playing, setPlaying] = useState(false);
  const [playRate, setPlayRate] = useState<number>(1);
  const [selectingRoi, setSelectingRoi] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [draftRoi, setDraftRoi] = useState<RoiBox | null>(null);

  const activeJump = jumps.find((j) => j.id === activeJumpId) || jumps[0] || null;

  // Find closest pose frame for a timestamp
  const findPose = (t: number): PoseFrame | null => {
    if (frames.length === 0) return null;
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].timestamp < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(frames[lo - 1].timestamp - t) < Math.abs(frames[lo].timestamp - t)) {
      return frames[lo - 1];
    }
    return frames[lo];
  };

  // Sync video element rate
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playRate;
    }
  }, [playRate]);

  // Playback loop for synthetic or video element
  useEffect(() => {
    if (!playing) return;
    if (videoRef.current && videoUrl && !isSynthetic) {
      const v = videoRef.current;
      v.playbackRate = playRate;
      v.play().catch(() => setPlaying(false));
      let raf = 0;
      const tick = () => {
        onTimeChange(v.currentTime);
        if (!v.paused && !v.ended) {
          raf = requestAnimationFrame(tick);
        } else if (v.ended) {
          setPlaying(false);
        }
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(raf);
        v.pause();
      };
    } else {
      let last = performance.now();
      let t = currentTime;
      let raf = 0;
      const maxD = duration || (frames.length > 0 ? frames[frames.length - 1].timestamp : 2.4);
      const tick = (now: number) => {
        const dt = ((now - last) / 1000) * playRate;
        last = now;
        t += dt;
        if (t > maxD) t = 0;
        onTimeChange(t);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, playRate, videoUrl, isSynthetic]);

  // Sync seek when paused
  useEffect(() => {
    if (!playing && videoRef.current && videoUrl && !isSynthetic) {
      if (Math.abs(videoRef.current.currentTime - currentTime) > 0.012) {
        videoRef.current.currentTime = currentTime;
      }
    }
  }, [currentTime, playing, videoUrl, isSynthetic]);

  // Draw skeleton & overlays onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    if (viewMode === 'skeleton' || isSynthetic) {
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, cw, ch);
      // Draw subtle rink horizon grid in skeleton mode
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.lineWidth = 1;
      const horizonY = ch * 0.82;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(cw, horizonY);
      ctx.stroke();
    }

    const sx = cw / Math.max(width, 1);
    const sy = ch / Math.max(height, 1);
    const pose = findPose(currentTime);

    // Draw CoM trajectory trail near current frame
    if (frames.length > 0 && pose) {
      const startIdx = Math.max(0, pose.index - 40);
      const trailPts: Array<{ x: number; y: number }> = [];
      for (let i = startIdx; i <= pose.index; i++) {
        const c = bodyCenter(frames[i]);
        if (c) trailPts.push({ x: c.x * sx, y: c.y * sy });
      }
      if (trailPts.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.moveTo(trailPts[0].x, trailPts[0].y);
        for (let i = 1; i < trailPts.length; i++) {
          ctx.lineTo(trailPts[i].x, trailPts[i].y);
        }
        ctx.stroke();
      }
    }

    // Draw active skeleton
    if (pose) {
      const kp = pose.keypoints;
      const getPt = (name: string) => {
        const p = kp[name];
        if (!p || p.confidence < 0.2) return null;
        return { x: p.x * sx, y: p.y * sy };
      };

      const inAir =
        activeJump !== null &&
        currentTime >= activeJump.takeoffTime &&
        currentTime <= activeJump.landingTime;

      ctx.lineCap = 'round';
      ctx.strokeStyle = inAir ? '#38bdf8' : '#22d3ee';
      ctx.lineWidth = 3;

      for (const [a, b] of SKELETON_CONNECTIONS) {
        const pa = getPt(a);
        const pb = getPt(b);
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      // Draw torso axis line (hip_mid -> shoulder_mid)
      const ls = getPt('left_shoulder');
      const rs = getPt('right_shoulder');
      const lh = getPt('left_hip');
      const rh = getPt('right_hip');
      if (ls && rs && lh && rh) {
        const sm = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
        const hm = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hm.x, hm.y);
        ctx.lineTo(sm.x, sm.y);
        ctx.stroke();

        // Head & nose alignment
        const nose = getPt('nose') || getPt('left_eye') || getPt('right_eye');
        if (nose) {
          const shoulderW = Math.hypot(rs.x - ls.x, rs.y - ls.y);
          const radius = Math.max(8, shoulderW * 0.34);
          ctx.beginPath();
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 2;
          ctx.moveTo(sm.x, sm.y);
          ctx.lineTo(nose.x, nose.y);
          ctx.stroke();

          ctx.beginPath();
          ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.arc(nose.x, nose.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Draw key joint dots (knees, elbows, wrists, hips, ankles)
      const jointNames = [
        'left_shoulder', 'right_shoulder',
        'left_elbow', 'right_elbow',
        'left_wrist', 'right_wrist',
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle',
      ];
      for (const name of jointNames) {
        const pt = getPt(name);
        if (!pt) continue;
        ctx.beginPath();
        ctx.fillStyle = name.includes('wrist') ? '#f59e0b' : '#ffffff';
        ctx.arc(pt.x, pt.y, name.includes('wrist') ? 4.2 : 3.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Airborne indicator in top-left of video
      if (inAir && activeJump) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
        ctx.fillRect(14, 14, 186, 32);
        ctx.fillStyle = '#38bdf8';
        ctx.font = '600 12px "JetBrains Mono", monospace';
        ctx.fillText(`AIRBORNE · ${(activeJump.heightM * 100).toFixed(1)} cm`, 24, 34);
      }
    }

    // Draw Target Skater ROI crop box if defined
    const box = draftRoi || roi;
    if (box) {
      ctx.save();
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(box.x * cw, box.y * ch, box.w * cw, box.h * ch);
      ctx.fillStyle = 'rgba(2, 132, 199, 0.12)';
      ctx.fillRect(box.x * cw, box.y * ch, box.w * cw, box.h * ch);
      ctx.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, viewMode, frames, activeJump, roi, draftRoi, isSynthetic, width, height]);

  const stepFrames = (delta: number) => {
    setPlaying(false);
    const dt = 1 / Math.max(fps || 60, 15);
    const maxD = duration || (frames.length > 0 ? frames[frames.length - 1].timestamp : 2.4);
    onTimeChange(Math.max(0, Math.min(maxD, currentTime + delta * dt)));
  };

  const getRelPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectingRoi || !allowRoiEdit) return;
    const p = getRelPos(e);
    setDragStart(p);
    setDraftRoi({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectingRoi || !dragStart) return;
    const p = getRelPos(e);
    setDraftRoi({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    });
  };

  const handlePointerUp = () => {
    if (!selectingRoi || !dragStart) return;
    setDragStart(null);
    setSelectingRoi(false);
    if (draftRoi && draftRoi.w > 0.05 && draftRoi.h > 0.05) {
      onRoiChange?.(draftRoi);
    }
    setDraftRoi(null);
  };

  const maxDuration = duration || (frames.length > 0 ? frames[frames.length - 1].timestamp : 2.4);

  return (
    <div className="border border-slate-200 bg-white rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setViewMode('overlay')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'overlay'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Video Overlay
          </button>
          <button
            type="button"
            onClick={() => setViewMode('skeleton')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'skeleton'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Skeleton Only
          </button>
        </div>

        <div className="flex items-center gap-2">
          {allowRoiEdit && !isSynthetic && (
            <>
              <button
                type="button"
                onClick={() => setSelectingRoi((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  selectingRoi
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
                title="Draw a box around the target skater for wide broadcast clips"
              >
                <Crop className="w-3.5 h-3.5" />
                {selectingRoi ? 'Drag over skater...' : roi ? 'Redraw Skater Box' : 'Crop Target Skater'}
              </button>
              {roi && (
                <button
                  type="button"
                  onClick={() => onRoiChange?.(null)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset Crop
                </button>
              )}
            </>
          )}

          <div className="flex items-center gap-1 text-xs text-slate-600">
            <span>Playback</span>
            <select
              value={playRate}
              onChange={(e) => setPlayRate(Number(e.target.value))}
              className="bg-white border border-slate-300 rounded-md px-2 py-1 text-xs font-mono tabular-nums text-slate-800"
            >
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.50×</option>
              <option value={1}>1.00×</option>
            </select>
          </div>
        </div>
      </div>

      {/* Viewport */}
      <div className="relative bg-slate-950 w-full aspect-video flex items-center justify-center overflow-hidden">
        {videoUrl && !isSynthetic && (
          <video
            ref={videoRef}
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            className={`absolute inset-0 w-full h-full object-contain ${
              viewMode === 'skeleton' ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          />
        )}
        <canvas
          ref={canvasRef}
          width={960}
          height={540}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          className={`relative z-10 w-full h-full object-contain ${
            selectingRoi ? 'cursor-crosshair' : 'cursor-default'
          }`}
        />
      </div>

      {/* Scrubber & Frame Step Controls */}
      <div className="px-4 py-3 border-t border-slate-200 bg-white space-y-2.5">
        <div className="relative flex items-center">
          <input
            type="range"
            min={0}
            max={Math.max(maxDuration, 0.1)}
            step={1 / Math.max(fps || 60, 60)}
            value={Math.min(currentTime, maxDuration)}
            onChange={(e) => {
              setPlaying(false);
              onTimeChange(Number(e.target.value));
            }}
            className="w-full accent-sky-600 cursor-pointer"
            aria-label="Timeline scrubber"
          />
        </div>

        {/* Jump window markers bar */}
        {jumps.length > 0 && maxDuration > 0 && (
          <div className="relative h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            {jumps.map((j) => {
              const leftPct = (j.takeoffTime / maxDuration) * 100;
              const widthPct = Math.max(1.5, ((j.landingTime - j.takeoffTime) / maxDuration) * 100);
              return (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    onTimeChange(j.takeoffTime);
                  }}
                  title={`Jump to ${j.takeoffTime.toFixed(2)}s`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  className="absolute top-0 h-full bg-sky-500 hover:bg-sky-600 transition-colors"
                />
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => stepFrames(-1)}
              className="inline-flex items-center gap-0.5 px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              title="Step back 1 frame"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              1f
            </button>
            <button
              type="button"
              onClick={() => stepFrames(1)}
              className="inline-flex items-center gap-0.5 px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              title="Step forward 1 frame"
            >
              1f
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="text-xs font-mono tabular-nums text-slate-600">
            {currentTime.toFixed(3)}s / {maxDuration.toFixed(3)}s
            <span className="text-slate-400 mx-1.5">·</span>
            {fps.toFixed(1)} fps
          </div>
        </div>
      </div>
    </div>
  );
};
