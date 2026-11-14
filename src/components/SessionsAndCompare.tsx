import React, { useState } from 'react';
import { ArrowRight, Search, Trash2 } from 'lucide-react';
import type { SessionRecord } from '../lib/types';

interface SessionsViewProps {
  sessions: SessionRecord[];
  loading: boolean;
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onStartAnalyze: () => void;
}

export const SessionsView: React.FC<SessionsViewProps> = ({
  sessions,
  loading,
  onOpenSession,
  onDeleteSession,
  onStartAnalyze,
}) => {
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'youtube' | 'upload' | 'demo'>('all');

  const filtered = sessions.filter((s) => {
    const matchesSource = sourceFilter === 'all' || s.sourceType === sourceFilter;
    const matchesQuery =
      !query.trim() || s.title.toLowerCase().includes(query.trim().toLowerCase());
    return matchesSource && matchesQuery;
  });

  if (loading) {
    return (
      <div className="border border-slate-200 bg-white rounded-xl p-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="border border-slate-200 bg-white rounded-xl p-10 text-center">
        <h2 className="text-lg font-semibold text-slate-900">No saved analyses yet</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto mt-1.5">
          Paste a YouTube figure skating link, upload a rink video, or run the synthetic skater demo to save your first session.
        </p>
        <button
          type="button"
          onClick={onStartAnalyze}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors"
        >
          Analyze a Jump
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter sessions by title..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {(['all', 'youtube', 'upload', 'demo'] as const).map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => setSourceFilter(src)}
              className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                sourceFilter === src
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {src}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-slate-200 bg-white rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">Clip</th>
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4 text-right">Jumps</th>
                <th className="py-3 px-4 text-right">Best Height</th>
                <th className="py-3 px-4 text-right">Max Rotations</th>
                <th className="py-3 px-4 text-right">FPS</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.map((s) => {
                const count = s.jumpCount ?? s.jumps?.length ?? 0;
                const bestH =
                  s.bestHeightM ??
                  (s.jumps && s.jumps.length > 0 ? Math.max(...s.jumps.map((j) => j.heightM)) : 0);
                const maxR =
                  s.maxRotations ??
                  (s.jumps && s.jumps.length > 0 ? Math.max(...s.jumps.map((j) => j.rotations)) : 0);
                return (
                  <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => onOpenSession(s.id)}
                        className="font-medium text-slate-900 hover:text-sky-600 text-left"
                      >
                        {s.title}
                      </button>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {new Date(s.createdAt).toLocaleDateString()} · {s.modelVariant}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 capitalize">
                      {s.sourceType}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                      {count}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                      {bestH > 0 ? `${(bestH * 100).toFixed(1)} cm` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                      {maxR > 0 ? `${maxR.toFixed(2)} rev` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                      {s.fps ? s.fps.toFixed(1) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenSession(s.id)}
                          className="text-xs font-medium text-sky-600 hover:text-sky-700 px-2 py-1"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSession(s.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                          title="Delete session"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface CompareViewProps {
  sessions: SessionRecord[];
}

export const CompareView: React.FC<CompareViewProps> = ({ sessions }) => {
  const withJumps = sessions.filter((s) => (s.jumps?.length ?? 0) > 0);
  const [leftId, setLeftId] = useState<string>(withJumps[0]?.id || '');
  const [rightId, setRightId] = useState<string>(withJumps[1]?.id || withJumps[0]?.id || '');

  if (withJumps.length === 0) {
    return (
      <div className="border border-slate-200 bg-white rounded-xl p-10 text-center">
        <h2 className="text-lg font-semibold text-slate-900">Compare Jumps Side-by-Side</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto mt-1.5">
          Analyze at least one YouTube or uploaded clip with a detected jump to compare height, flight time, rotation speed, and arm snap.
        </p>
      </div>
    );
  }

  const leftSession = withJumps.find((s) => s.id === leftId) || withJumps[0];
  const rightSession = withJumps.find((s) => s.id === rightId) || withJumps[0];
  const jA = leftSession.jumps[0];
  const jB = rightSession.jumps[0];

  const rows: Array<{
    label: string;
    a: string;
    b: string;
    delta: string;
  }> = [
    {
      label: 'Jump Height',
      a: `${(jA.heightM * 100).toFixed(1)} cm`,
      b: `${(jB.heightM * 100).toFixed(1)} cm`,
      delta: `${((jB.heightM - jA.heightM) * 100 >= 0 ? '+' : '')}${((jB.heightM - jA.heightM) * 100).toFixed(1)} cm`,
    },
    {
      label: 'Flight Time',
      a: `${jA.flightTime.toFixed(3)} s`,
      b: `${jB.flightTime.toFixed(3)} s`,
      delta: `${(jB.flightTime - jA.flightTime >= 0 ? '+' : '')}${(jB.flightTime - jA.flightTime).toFixed(3)} s`,
    },
    {
      label: 'Air Rotations',
      a: `${jA.rotations.toFixed(2)} rev`,
      b: `${jB.rotations.toFixed(2)} rev`,
      delta: `${(jB.rotations - jA.rotations >= 0 ? '+' : '')}${(jB.rotations - jA.rotations).toFixed(2)} rev`,
    },
    {
      label: 'Peak Rotation Speed',
      a: `${jA.peakRotationRps.toFixed(2)} rev/s`,
      b: `${jB.peakRotationRps.toFixed(2)} rev/s`,
      delta: `${(jB.peakRotationRps - jA.peakRotationRps >= 0 ? '+' : '')}${(jB.peakRotationRps - jA.peakRotationRps).toFixed(2)} rev/s`,
    },
    {
      label: 'Time to Snap',
      a: jA.joints.timeToSnapMs !== null ? `${jA.joints.timeToSnapMs} ms` : '—',
      b: jB.joints.timeToSnapMs !== null ? `${jB.joints.timeToSnapMs} ms` : '—',
      delta:
        jA.joints.timeToSnapMs !== null && jB.joints.timeToSnapMs !== null
          ? `${jB.joints.timeToSnapMs - jA.joints.timeToSnapMs >= 0 ? '+' : ''}${jB.joints.timeToSnapMs - jA.joints.timeToSnapMs} ms`
          : '—',
    },
    {
      label: 'Peak Axis Tilt',
      a: jA.joints.peakAxisTiltDeg !== null ? `${jA.joints.peakAxisTiltDeg}°` : '—',
      b: jB.joints.peakAxisTiltDeg !== null ? `${jB.joints.peakAxisTiltDeg}°` : '—',
      delta:
        jA.joints.peakAxisTiltDeg !== null && jB.joints.peakAxisTiltDeg !== null
          ? `${(jB.joints.peakAxisTiltDeg - jA.joints.peakAxisTiltDeg >= 0 ? '+' : '')}${(jB.joints.peakAxisTiltDeg - jA.joints.peakAxisTiltDeg).toFixed(1)}°`
          : '—',
    },
    {
      label: 'Takeoff Knee Bend',
      a: jA.joints.takeoffKneeDeg !== null ? `${jA.joints.takeoffKneeDeg}°` : '—',
      b: jB.joints.takeoffKneeDeg !== null ? `${jB.joints.takeoffKneeDeg}°` : '—',
      delta:
        jA.joints.takeoffKneeDeg !== null && jB.joints.takeoffKneeDeg !== null
          ? `${jB.joints.takeoffKneeDeg - jA.joints.takeoffKneeDeg >= 0 ? '+' : ''}${jB.joints.takeoffKneeDeg - jA.joints.takeoffKneeDeg}°`
          : '—',
    },
  ];

  // Overlaid normalized rotation speed chart
  const w = 640;
  const h = 180;
  const pad = 32;
  const maxR = Math.max(
    2,
    ...jA.rotationProfile.map((p) => Math.abs(p[1])),
    ...jB.rotationProfile.map((p) => Math.abs(p[1])),
  );
  const toNormPoints = (prof: Array<[number, number]>, t0: number, t1: number) => {
    const dur = Math.max(t1 - t0, 0.05);
    return prof
      .map(([t, r]) => {
        const x = pad + ((t - t0) / dur) * (w - pad * 2);
        const y = h - pad - (Math.abs(r) / maxR) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-slate-200 bg-white rounded-xl p-4">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Baseline Jump (A)
          </label>
          <select
            value={leftSession.id}
            onChange={(e) => setLeftId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
          >
            {withJumps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({(s.jumps[0].heightM * 100).toFixed(1)} cm · {s.jumps[0].rotations.toFixed(2)} rev)
              </option>
            ))}
          </select>
        </div>

        <div className="border border-slate-200 bg-white rounded-xl p-4">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Comparison Jump (B)
          </label>
          <select
            value={rightSession.id}
            onChange={(e) => setRightId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
          >
            {withJumps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({(s.jumps[0].heightM * 100).toFixed(1)} cm · {s.jumps[0].rotations.toFixed(2)} rev)
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border border-slate-200 bg-white rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
              <th className="py-3 px-4">Metric</th>
              <th className="py-3 px-4 text-right">Attempt A</th>
              <th className="py-3 px-4 text-right">Attempt B</th>
              <th className="py-3 px-4 text-right">Delta (B − A)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-sm">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="py-3 px-4 font-medium text-slate-800">{row.label}</td>
                <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">{row.a}</td>
                <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 font-medium">{row.b}</td>
                <td className="py-3 px-4 text-right font-mono tabular-nums text-sky-700">{row.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border border-slate-200 bg-white rounded-xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Normalized Airborne Rotation Speed Overlay (0% – 100% Flight)
          </h3>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-slate-500 inline-block" />
              Attempt A
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-sky-600 inline-block" />
              Attempt B
            </span>
          </div>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
          <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#e2e8f0" />
          <line x1={pad} y1={pad} x2={w - pad} y2={pad} stroke="#e2e8f0" strokeDasharray="3 3" />
          {jA.rotationProfile.length > 1 && (
            <polyline
              fill="none"
              stroke="#64748b"
              strokeWidth={2}
              strokeDasharray="4 3"
              points={toNormPoints(jA.rotationProfile, jA.takeoffTime, jA.landingTime)}
            />
          )}
          {jB.rotationProfile.length > 1 && (
            <polyline
              fill="none"
              stroke="#0284c7"
              strokeWidth={2.5}
              points={toNormPoints(jB.rotationProfile, jB.takeoffTime, jB.landingTime)}
            />
          )}
        </svg>
      </div>
    </div>
  );
};
