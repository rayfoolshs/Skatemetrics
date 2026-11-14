import React from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { JumpMetrics, KeyframeSnapshot, PoseFrame, SessionRecord } from '../lib/types';
import {
  downloadHtmlReport,
  downloadKeypointsJson,
  downloadMetricsJson,
  downloadRotationCsv,
} from '../lib/reportExport';

interface JumpInspectorProps {
  session: SessionRecord;
  jump: JumpMetrics;
  frames: PoseFrame[];
  keyframes: KeyframeSnapshot[];
  onNudge: (deltaTakeoff: number, deltaLanding: number) => void;
  onSeek: (t: number) => void;
}

export const JumpInspector: React.FC<JumpInspectorProps> = ({
  session,
  jump,
  frames,
  keyframes,
  onNudge,
  onSeek,
}) => {
  const j = jump.joints;
  const underRotColor =
    j.underRotationCall === 'Clean'
      ? 'text-emerald-700'
      : j.underRotationCall.startsWith('q')
        ? 'text-amber-700'
        : 'text-rose-700';

  return (
    <div className="space-y-5">
      {/* Primary Jump Header & Frame Nudger */}
      <div className="border border-slate-200 bg-white rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <span>{j.entryDirection}</span>
              <span aria-hidden="true">·</span>
              <span>{jump.direction}</span>
              <span aria-hidden="true">·</span>
              <span>
                {jump.takeoffTime.toFixed(3)}s – {jump.landingTime.toFixed(3)}s
              </span>
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mt-1">
              {j.jumpHint}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 border border-slate-200 rounded-lg px-2 py-1 bg-slate-50">
              <span className="text-xs text-slate-600 pr-1">Takeoff</span>
              <button
                type="button"
                onClick={() => onNudge(-1, 0)}
                className="p-1 rounded hover:bg-white text-slate-700"
                title="Move takeoff 1 frame earlier"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono tabular-nums text-slate-800 px-1">
                f{jump.takeoffIndex}
              </span>
              <button
                type="button"
                onClick={() => onNudge(1, 0)}
                className="p-1 rounded hover:bg-white text-slate-700"
                title="Move takeoff 1 frame later"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1 border border-slate-200 rounded-lg px-2 py-1 bg-slate-50">
              <span className="text-xs text-slate-600 pr-1">Landing</span>
              <button
                type="button"
                onClick={() => onNudge(0, -1)}
                className="p-1 rounded hover:bg-white text-slate-700"
                title="Move landing 1 frame earlier"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono tabular-nums text-slate-800 px-1">
                f{jump.landingIndex}
              </span>
              <button
                type="button"
                onClick={() => onNudge(0, 1)}
                className="p-1 rounded hover:bg-white text-slate-700"
                title="Move landing 1 frame later"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Core Ballistic & Rotation KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-4">
          <div>
            <div className="text-xs text-slate-500">Jump Height</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
              {(jump.heightM * 100).toFixed(1)} <span className="text-sm font-normal text-slate-500">cm</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Flight Time</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
              {jump.flightTime.toFixed(3)} <span className="text-sm font-normal text-slate-500">s</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Air Rotations</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
              {jump.rotations.toFixed(2)} <span className="text-sm font-normal text-slate-500">rev</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Peak Spin</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
              {jump.peakRotationRps.toFixed(2)} <span className="text-sm font-normal text-slate-500">rev/s</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Average Spin</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
              {jump.avgRotationRps.toFixed(2)} <span className="text-sm font-normal text-slate-500">rev/s</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Rotation Check</div>
            <div className={`text-base font-semibold mt-1.5 ${underRotColor}`}>
              {j.underRotationCall}
            </div>
          </div>
        </div>
      </div>

      {/* Joint Biomechanics Table (Elbows, Wrists, Knees, Hips, Head/Eyes) */}
      <div className="border border-slate-200 bg-white rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Joint Biomechanics Breakdown
          </h3>
          <span className="text-xs text-slate-500">
            Derived from 33 2D + 3D landmarks (shoulders, hips, elbows, wrists, knees, head)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <div className="text-xs text-slate-500">Pre-Rotation / Air / Deficit</div>
            <div className="text-sm font-mono tabular-nums font-medium text-slate-900 mt-1">
              {j.preRotationDeg}° / {j.airRotationDeg}° / -{j.landingShortageDeg}°
            </div>
            <div className="text-xs text-slate-500 mt-1">
              On-ice pivot before takeoff vs. true air degrees
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <div className="text-xs text-slate-500">Arm Snap Speed &amp; Tightness</div>
            <div className="text-sm font-mono tabular-nums font-medium text-slate-900 mt-1">
              {j.timeToSnapMs !== null ? `${j.timeToSnapMs} ms` : '—'}
              <span className="text-slate-400 mx-1.5">·</span>
              {j.minArmRadiusRatio !== null ? `${j.minArmRadiusRatio}× torso` : '—'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {j.armSymmetryScore !== null ? `Arm symmetry: ${j.armSymmetryScore}%` : 'Wrist/elbow pull-in'}
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <div className="text-xs text-slate-500">Knee Load &amp; Landing Bend</div>
            <div className="text-sm font-mono tabular-nums font-medium text-slate-900 mt-1">
              {j.takeoffKneeDeg !== null ? `${j.takeoffKneeDeg}°` : '—'} TO
              <span className="text-slate-400 mx-1.5">/</span>
              {j.landingKneeDeg !== null ? `${j.landingKneeDeg}°` : '—'} LD
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Min air knee spread: {j.minKneeSpreadRatio !== null ? `${j.minKneeSpreadRatio}×` : '—'}
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <div className="text-xs text-slate-500">Air Axis &amp; Head Alignment</div>
            <div className="text-sm font-mono tabular-nums font-medium text-slate-900 mt-1">
              {j.peakAxisTiltDeg !== null ? `${j.peakAxisTiltDeg}°` : '—'} lean
              <span className="text-slate-400 mx-1.5">·</span>
              {j.headTiltDeg !== null ? `${j.headTiltDeg}°` : '—'} head
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Torso verticality &amp; ear/eye head tilt
            </div>
          </div>
        </div>
      </div>

      {/* 4-Phase Keyframe Strip */}
      {keyframes.length > 0 && (
        <div className="border border-slate-200 bg-white rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Jump Phase Keyframes
            </h3>
            <span className="text-xs text-slate-500">
              Click any frame to jump video cursor
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {keyframes.map((kf) => (
              <button
                key={kf.label}
                type="button"
                onClick={() => onSeek(kf.timestamp)}
                className="group text-left border border-slate-200 rounded-lg overflow-hidden hover:border-sky-500 transition-colors bg-slate-50"
              >
                <div className="aspect-video bg-slate-900 overflow-hidden">
                  <img
                    src={kf.dataUrl}
                    alt={`${kf.label} frame`}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                  />
                </div>
                <div className="px-2.5 py-2 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-900">{kf.label}</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {kf.timestamp.toFixed(3)}s
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Exports Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-white rounded-xl px-5 py-3.5">
        <span className="text-xs text-slate-600">
          Export telemetry and coach reports
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => downloadHtmlReport(session)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Coach Report (.html)
          </button>
          <button
            type="button"
            onClick={() => downloadMetricsJson(session)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            metrics.json
          </button>
          <button
            type="button"
            onClick={() => downloadRotationCsv(session)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            rotation.csv
          </button>
          {frames.length > 0 && (
            <button
              type="button"
              onClick={() => downloadKeypointsJson(session, frames)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              keypoints.json
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
