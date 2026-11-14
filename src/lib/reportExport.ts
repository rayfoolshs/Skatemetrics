import type { JumpMetrics, PoseFrame, SessionRecord } from './types';

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadMetricsJson(session: SessionRecord) {
  const payload = {
    title: session.title,
    sourceType: session.sourceType,
    sourceUrl: session.sourceUrl,
    fps: session.fps,
    dimensions: `${session.width}x${session.height}`,
    playbackSpeed: session.playbackSpeed,
    modelVariant: session.modelVariant,
    rotationSource: session.rotationSource,
    cameraStability: {
      driftPx: session.cameraDriftPx,
      driftFraction: session.cameraDriftFraction,
    },
    warnings: session.warnings,
    jumps: session.jumps,
  };
  triggerDownload(
    `skate-metrics-${session.id}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  );
}

export function downloadKeypointsJson(session: SessionRecord, frames: PoseFrame[]) {
  triggerDownload(
    `keypoints-${session.id}.json`,
    JSON.stringify({ frames }, null, 2),
    'application/json',
  );
}

export function downloadRotationCsv(session: SessionRecord) {
  const rows = ['jump_id,timestamp_s,rate_rps'];
  for (const jump of session.jumps) {
    for (const [t, r] of jump.rotationProfile) {
      rows.push(`${jump.id},${t.toFixed(4)},${r.toFixed(4)}`);
    }
  }
  triggerDownload(`rotation-${session.id}.csv`, rows.join('\n'), 'text/csv');
}

function renderSvgChart(jump: JumpMetrics): string {
  const pts = jump.rotationProfile;
  if (pts.length < 2) return '<p>No rotation samples.</p>';
  const w = 640;
  const h = 160;
  const pad = 24;
  const tMin = pts[0][0];
  const tMax = Math.max(pts[pts.length - 1][0], tMin + 0.01);
  const maxR = Math.max(1, ...pts.map((p) => Math.abs(p[1])));
  const coords = pts
    .map(([t, r]) => {
      const x = pad + ((t - tMin) / (tMax - tMin)) * (w - pad * 2);
      const y = h - pad - (Math.abs(r) / maxR) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:640px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
    <polyline fill="none" stroke="#0284c7" stroke-width="2.5" points="${coords}" />
    <text x="${pad}" y="16" font-size="11" fill="#475569">Peak ${jump.peakRotationRps.toFixed(2)} rev/s · Avg ${jump.avgRotationRps.toFixed(2)} rev/s</text>
  </svg>`;
}

export function downloadHtmlReport(session: SessionRecord) {
  const jumpBlocks = session.jumps
    .map(
      (j, idx) => `
      <section style="border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-top:16px;background:#fff;">
        <h2 style="margin:0 0 8px 0;font-size:18px;">Jump #${idx + 1} — ${j.joints.jumpHint}</h2>
        <p style="margin:0 0 16px 0;color:#475569;font-size:13px;">
          ${j.takeoffTime.toFixed(3)}s → ${j.landingTime.toFixed(3)}s · ${j.direction} · method: ${j.method}
        </p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:16px;">
          <div><div style="font-size:11px;color:#64748b;">Height</div><strong style="font-size:20px;">${(j.heightM * 100).toFixed(1)} cm</strong></div>
          <div><div style="font-size:11px;color:#64748b;">Flight Time</div><strong style="font-size:20px;">${j.flightTime.toFixed(3)} s</strong></div>
          <div><div style="font-size:11px;color:#64748b;">Air Rotations</div><strong style="font-size:20px;">${j.rotations.toFixed(2)} rev</strong></div>
          <div><div style="font-size:11px;color:#64748b;">Peak Speed</div><strong style="font-size:20px;">${j.peakRotationRps.toFixed(2)} rev/s</strong></div>
          <div><div style="font-size:11px;color:#64748b;">Snap Speed</div><strong style="font-size:20px;">${j.joints.timeToSnapMs ?? '—'} ms</strong></div>
          <div><div style="font-size:11px;color:#64748b;">Axis Tilt</div><strong style="font-size:20px;">${j.joints.peakAxisTiltDeg ?? '—'}°</strong></div>
        </div>
        ${renderSvgChart(j)}
      </section>
    `,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Skate Metrics Report — ${session.title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:32px; }
    main { max-width: 920px; margin: 0 auto; }
  </style>
</head>
<body>
  <main>
    <h1 style="margin:0 0 6px 0;">Skate Metrics Coach Report</h1>
    <p style="margin:0;color:#475569;font-size:14px;">${session.title} · ${session.width}×${session.height} · ${session.fps} fps · ${session.rotationSource}</p>
    ${jumpBlocks}
  </main>
</body>
</html>`;
  triggerDownload(`report-${session.id}.html`, html, 'text/html');
}
