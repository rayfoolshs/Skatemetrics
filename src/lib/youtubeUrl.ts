export interface ParsedYouTubeLink {
  videoId: string | null;
  clipId: string | null;
  startSec: number | null;
  embedUrl: string | null;
  canonicalUrl: string;
}

function parseTimeParam(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (/^\d+(\.\d+)?s?$/.test(trimmed)) {
    return Number(trimmed.replace(/s$/, ''));
  }
  const match = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!match) return null;
  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

export function parseYouTubeLink(rawUrl: string): ParsedYouTubeLink | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isYt =
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com';
  if (!isYt) return null;

  const startSec = parseTimeParam(parsed.searchParams.get('t') || parsed.searchParams.get('start'));
  let videoId: string | null = null;
  let clipId: string | null = null;

  if (host === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0] || null;
  } else {
    const segs = parsed.pathname.split('/').filter(Boolean);
    if (segs[0] === 'watch') {
      videoId = parsed.searchParams.get('v');
    } else if (segs[0] === 'shorts' || segs[0] === 'embed' || segs[0] === 'live') {
      videoId = segs[1] || null;
    } else if (segs[0] === 'clip') {
      clipId = segs[1] || null;
    } else {
      videoId = parsed.searchParams.get('v');
    }
  }

  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0${startSec ? `&start=${Math.floor(startSec)}` : ''}`
    : null;

  return {
    videoId,
    clipId,
    startSec,
    embedUrl,
    canonicalUrl: normalized,
  };
}
