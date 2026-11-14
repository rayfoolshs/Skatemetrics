import React from 'react';
import type { JumpMetrics } from '../lib/types';

interface TelemetryChartsProps {
  jump: JumpMetrics;
  currentTime: number;
  onSeek: (t: number) => void;
}

export const TelemetryCharts: React.FC<TelemetryChartsProps> = ({
  jump,
  currentTime,
  onSeek,
}) => {
  const w = 640;
  const h = 168;
  const padL = 44;
  const padR = 16;
  const padT = 18;
  const padB = 26;

  const rotPts = jump.rotationProfile;
  const armPts = jump.armRadiusProfile;
  const footPts = jump.footHeightProfile;

  const tMin = footPts.length > 0 ? footPts[0][0] : jump.takeoffTime;
  const tMax = footPts.length > 0
    ? Math.max(footPts[footPts.length - 1][0], tMin + 0.05)
    : Math.max(jump.landingTime, tMin + 0.05);

  const mapX = (t: number) => padL + ((t - tMin) / (tMax - tMin)) * (w - padL - padR);

  const maxRps = Math.max(2, ...rotPts.map((p) => Math.abs(p[1])));
  const mapRotY = (r: number) => h - padB - (Math.abs(r) / maxRps) * (h - padT - padB);

  const maxArm = Math.max(1.2, ...armPts.map((p) => p[1]));
  const mapArmY = (v: number) => h - padB - (v / maxArm) * (h - padT - padB);

  const minFoot = Math.min(0, ...footPts.map((p) => p[1]));
  const maxFoot = Math.max(12, ...footPts.map((p) => p[1]));
  const mapFootY = (v: number) =>
    h - padB - ((v - minFoot) / Math.max(maxFoot - minFoot, 1)) * (h - padT - padB);

  const buildPolyline = (pts: Array<[number, number]>, yFn: (v: number) => number) =>
    pts.map(([t, v]) => `${mapX(t).toFixed(1)},${yFn(v).toFixed(1)}`).join(' ');

  const cursorVisible = currentTime >= tMin && currentTime <= tMax;
  const cursorX = mapX(currentTime);
  const toX = mapX(jump.takeoffTime);
  const laX = mapX(jump.landingTime);

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * w;
    const frac = Math.max(0, Math.min(1, (relX - padL) / (w - padL - padR)));
    onSeek(tMin + frac * (tMax - tMin));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Rotation Speed + Arm Snap */}
      <div className="border border-slate-200 bg-white rounded-xl p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Rotation Speed &amp; Arm Pull-In
          </h3>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-sky-600 inline-block" />
              rev/s
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-amber-500 inline-block" />
              arm radius
            </span>
          </div>
        </div>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          onClick={handleSvgClick}
          className="w-full h-auto cursor-pointer select-none"
        >
          {/* Airborne window shading */}
          <rect
            x={toX}
            y={padT}
            width={Math.max(2, laX - toX)}
            height={h - padT - padB}
            fill="rgba(2, 132, 199, 0.06)"
          />
          {/* Gridlines */}
          {[0, 0.5, 1].map((frac) => {
            const y = padT + frac * (h - padT - padB);
            const label = ((1 - frac) * maxRps).toFixed(1);
            return (
              <g key={frac}>
                <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#e2e8f0" strokeWidth={1} />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="#64748b"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {armPts.length > 1 && (
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth={1.75}
              strokeDasharray="4 3"
              points={buildPolyline(armPts, mapArmY)}
            />
          )}
          {rotPts.length > 1 && (
            <polyline
              fill="none"
              stroke="#0284c7"
              strokeWidth={2.5}
              points={buildPolyline(rotPts, mapRotY)}
            />
          )}

          {cursorVisible && (
            <line
              x1={cursorX}
              y1={padT}
              x2={cursorX}
              y2={h - padB}
              stroke="#0f172a"
              strokeWidth={1.25}
            />
          )}

          <text
            x={toX}
            y={h - 6}
            textAnchor="middle"
            fontSize="10"
            fill="#0284c7"
            fontFamily="JetBrains Mono, monospace"
          >
            TO {jump.takeoffTime.toFixed(2)}s
          </text>
          <text
            x={laX}
            y={h - 6}
            textAnchor="middle"
            fontSize="10"
            fill="#0284c7"
            fontFamily="JetBrains Mono, monospace"
          >
            LD {jump.landingTime.toFixed(2)}s
          </text>
        </svg>
      </div>

      {/* Foot Height Above Ice */}
      <div className="border border-slate-200 bg-white rounded-xl p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Foot Elevation Above Ice Baseline
          </h3>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            Method: {jump.method}
          </span>
        </div>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          onClick={handleSvgClick}
          className="w-full h-auto cursor-pointer select-none"
        >
          <rect
            x={toX}
            y={padT}
            width={Math.max(2, laX - toX)}
            height={h - padT - padB}
            fill="rgba(22, 163, 74, 0.06)"
          />
          <line
            x1={padL}
            y1={mapFootY(0)}
            x2={w - padR}
            y2={mapFootY(0)}
            stroke="#94a3b8"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          {footPts.length > 1 && (
            <polyline
              fill="none"
              stroke="#0f172a"
              strokeWidth={2.25}
              points={buildPolyline(footPts, mapFootY)}
            />
          )}
          <line x1={toX} y1={padT} x2={toX} y2={h - padB} stroke="#16a34a" strokeWidth={1.25} />
          <line x1={laX} y1={padT} x2={laX} y2={h - padB} stroke="#16a34a" strokeWidth={1.25} />

          {cursorVisible && (
            <line
              x1={cursorX}
              y1={padT}
              x2={cursorX}
              y2={h - padB}
              stroke="#0284c7"
              strokeWidth={1.5}
            />
          )}

          <text
            x={padL - 6}
            y={mapFootY(maxFoot) + 4}
            textAnchor="end"
            fontSize="10"
            fill="#64748b"
            fontFamily="JetBrains Mono, monospace"
          >
            {Math.round(maxFoot)}px
          </text>
          <text
            x={padL - 6}
            y={mapFootY(0) + 4}
            textAnchor="end"
            fontSize="10"
            fill="#64748b"
            fontFamily="JetBrains Mono, monospace"
          >
            ice
          </text>
        </svg>
      </div>
    </div>
  );
};
