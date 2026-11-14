import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Film,
  Link as LinkIcon,
  Play,
  Scissors,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import { JumpInspector } from './components/JumpInspector';
import { CompareView, SessionsView } from './components/SessionsAndCompare';
import { TelemetryCharts } from './components/TelemetryCharts';
import { VideoSkeletonPlayer } from './components/VideoSkeletonPlayer';
import { YouTubeClipStudio } from './components/YouTubeClipStudio';
import { analyzePoseFrames, nudgeJumpBoundary } from './lib/kinematics';
import { captureJumpKeyframes, extractPoseFromVideo } from './lib/poseEngine';
import { generateSyntheticDemoFrames } from './lib/syntheticSkater';
import { parseYouTubeLink } from './lib/youtubeUrl';
import type {
  JumpMetrics,
  KeyframeSnapshot,
  PoseFrame,
  RoiBox,
  SessionRecord,
  VideoDescriptor,
} from './lib/types';

type NavView = 'analyze' | 'sessions' | 'compare' | 'guide';
type SourceMode = 'youtube' | 'upload';
type ModelVariant = 'lite' | 'full' | 'heavy';

interface YouTubeMeta {
  title: string;
  duration: number;
  uploader: string;
  fps: number;
  width: number;
  height: number;
  thumbnail: string | null;
  has60fps: boolean;
  webpageUrl: string;
  videoId?: string | null;
  embedUrl?: string | null;
  suggestedStartSec?: number | null;
  suggestedEndSec?: number | null;
  directDownloadAvailable?: boolean;
  botCheckNotice?: string;
}

export default function App() {
  const [view, setView] = useState<NavView>('analyze');
  const [sourceMode, setSourceMode] = useState<SourceMode>('youtube');

  // YouTube & Upload Form State
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeMeta, setYoutubeMeta] = useState<YouTubeMeta | null>(null);
  const [probingYoutube, setProbingYoutube] = useState(false);
  const [startSec, setStartSec] = useState('');
  const [endSec, setEndSec] = useState('');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [modelVariant, setModelVariant] = useState<ModelVariant>('full');
  const [cookiesTxt, setCookiesTxt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showEmbedStudio, setShowEmbedStudio] = useState(false);

  // Loaded Video & Analysis State
  const [loadedVideo, setLoadedVideo] = useState<VideoDescriptor | null>(null);
  const [roi, setRoi] = useState<RoiBox | null>(null);
  const [busyPct, setBusyPct] = useState<number | null>(null);
  const [busyLabel, setBusyLabel] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active Session Results
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null);
  const [poseFrames, setPoseFrames] = useState<PoseFrame[]>([]);
  const [selectedJumpIdx, setSelectedJumpIdx] = useState(0);
  const [keyframes, setKeyframes] = useState<KeyframeSnapshot[]>([]);
  const [currentTime, setCurrentTime] = useState(0);

  // Saved Sessions List
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const resp = await fetch('/api/sessions');
      if (resp.ok) {
        const data = await resp.json();
        setSessions(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore transient list failure
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const saveSessionToServer = async (record: SessionRecord) => {
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
      fetchSessions();
    } catch {
      // non-fatal persistence error
    }
  };

  const parsedYt = parseYouTubeLink(youtubeUrl);

  const handleYouTubeUrlChange = (val: string) => {
    setYoutubeUrl(val);
    setYoutubeMeta(null);
    const parsed = parseYouTubeLink(val);
    if (parsed?.startSec && !startSec) {
      setStartSec(String(parsed.startSec));
      if (!endSec) setEndSec(String(parsed.startSec + 6));
    }
    if (parsed?.embedUrl) {
      setShowEmbedStudio(true);
    }
  };

  const handleProbeYouTube = async () => {
    setErrorMsg(null);
    setYoutubeMeta(null);
    if (!youtubeUrl.trim()) {
      setErrorMsg('Paste a YouTube figure skating URL first.');
      return;
    }
    setProbingYoutube(true);
    try {
      const resp = await fetch('/api/youtube/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl, cookiesTxt }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not inspect YouTube video');
      setYoutubeMeta(data);
      if (data.suggestedStartSec !== null && data.suggestedStartSec !== undefined && !startSec) {
        setStartSec(String(data.suggestedStartSec));
      } else if (data.duration > 15 && !startSec && !endSec) {
        setStartSec('0');
        setEndSec(String(Math.min(12, Math.round(data.duration))));
      }
      if (data.embedUrl && !data.directDownloadAvailable) {
        setShowEmbedStudio(true);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'YouTube metadata lookup failed');
    } finally {
      setProbingYoutube(false);
    }
  };

  const downloadYouTubeClip = async (): Promise<VideoDescriptor> => {
    setBusyPct(5);
    setBusyLabel(
      startSec || endSec
        ? 'Downloading trimmed jump range from YouTube...'
        : 'Downloading YouTube clip (up to 1080p60)...',
    );
    const resp = await fetch('/api/youtube/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: youtubeUrl,
        start: startSec.trim() ? Number(startSec) : null,
        end: endSec.trim() ? Number(endSec) : null,
        cookiesTxt,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (data.botBlocked && (youtubeMeta?.embedUrl || parsedYt?.embedUrl)) {
        setShowEmbedStudio(true);
      }
      throw new Error(data.error || 'YouTube download failed');
    }

    const desc: VideoDescriptor = {
      videoId: data.videoId,
      title: youtubeMeta?.title || youtubeUrl.trim(),
      sourceType: 'youtube',
      sourceUrl: youtubeUrl.trim(),
      streamUrl: data.streamUrl,
      width: data.width,
      height: data.height,
      fps: data.fps,
      duration: data.duration,
      frameCount: data.frameCount,
      timestamps: Array.isArray(data.timestamps) ? data.timestamps : [],
    };
    setLoadedVideo(desc);
    setRoi(null);
    setCurrentTime(0);
    return desc;
  };

  const handleLoadYouTubeOnly = async () => {
    setErrorMsg(null);
    if (!youtubeUrl.trim()) {
      setErrorMsg('Paste a YouTube figure skating URL first.');
      return;
    }
    try {
      await downloadYouTubeClip();
      setActiveSession(null);
      setPoseFrames([]);
      setKeyframes([]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusyPct(null);
      setBusyLabel('');
    }
  };

  const runPosePipelineOnVideo = async (video: VideoDescriptor, cropRoi: RoiBox | null) => {
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { frames, width, height } = await extractPoseFromVideo({
        videoUrl: video.streamUrl || '',
        fps: video.fps,
        duration: video.duration,
        timestamps: video.timestamps,
        modelVariant,
        roi: cropRoi,
        abortSignal: controller.signal,
        onProgress: (pct, label) => {
          setBusyPct(pct);
          setBusyLabel(label);
        },
      });

      setBusyPct(95);
      setBusyLabel('Segmenting flight window and computing joint telemetry...');

      const analysis = analyzePoseFrames(frames, height, { playbackSpeed });
      const snaps =
        analysis.jumps.length > 0 && video.streamUrl
          ? await captureJumpKeyframes(video.streamUrl, frames, analysis.jumps[0])
          : [];

      const record: SessionRecord = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        title: video.title,
        sourceType: video.sourceType,
        sourceUrl: video.sourceUrl || null,
        videoId: video.videoId,
        createdAt: new Date().toISOString(),
        fps: video.fps,
        width,
        height,
        playbackSpeed,
        modelVariant,
        rotationSource: analysis.rotationSource,
        cameraDriftPx: analysis.cameraDriftPx,
        cameraDriftFraction: analysis.cameraDriftFraction,
        warnings: analysis.warnings,
        jumps: analysis.jumps,
        keyframes: snaps,
        poseFrames: frames,
      };

      setPoseFrames(frames);
      setActiveSession(record);
      setSelectedJumpIdx(0);
      setKeyframes(snaps);
      if (analysis.jumps.length > 0) {
        setCurrentTime(Math.max(0, analysis.jumps[0].takeoffTime - 0.15));
      }
      await saveSessionToServer(record);
    } finally {
      abortRef.current = null;
      setBusyPct(null);
      setBusyLabel('');
    }
  };

  const handleAnalyzeYouTube = async () => {
    setErrorMsg(null);
    if (!youtubeUrl.trim() && !loadedVideo) {
      setErrorMsg('Paste a YouTube figure skating link to begin.');
      return;
    }
    try {
      const targetVideo =
        loadedVideo && loadedVideo.sourceUrl === youtubeUrl.trim()
          ? loadedVideo
          : await downloadYouTubeClip();
      await runPosePipelineOnVideo(targetVideo, roi);
    } catch (err) {
      if ((err as Error)?.message !== 'Analysis cancelled') {
        setErrorMsg(err instanceof Error ? err.message : 'Analysis failed');
      }
      setBusyPct(null);
      setBusyLabel('');
    }
  };

  const handleUploadFile = async (file: File) => {
    setErrorMsg(null);
    setBusyPct(10);
    setBusyLabel(`Uploading ${file.name} and reading frame timestamps...`);
    try {
      const form = new FormData();
      form.append('video', file);
      const resp = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Upload failed');

      const desc: VideoDescriptor = {
        videoId: data.videoId,
        title: data.filename || file.name,
        sourceType: 'upload',
        streamUrl: data.streamUrl,
        width: data.width,
        height: data.height,
        fps: data.fps,
        duration: data.duration,
        frameCount: data.frameCount,
        timestamps: Array.isArray(data.timestamps) ? data.timestamps : [],
      };
      setLoadedVideo(desc);
      setRoi(null);
      setCurrentTime(0);
      await runPosePipelineOnVideo(desc, null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload processing failed');
      setBusyPct(null);
      setBusyLabel('');
    }
  };

  const handleRunSyntheticDemo = async () => {
    setErrorMsg(null);
    setView('analyze');
    setBusyPct(40);
    setBusyLabel('Building deterministic 60 fps synthetic figure skater...');
    try {
      const demo = generateSyntheticDemoFrames(60);
      const analysis = analyzePoseFrames(demo.frames, demo.height, { playbackSpeed: 1.0 });
      const desc: VideoDescriptor = {
        videoId: 'synthetic-demo',
        title: 'Synthetic 1.5-Rev Axel Demo (60 fps)',
        sourceType: 'demo',
        width: demo.width,
        height: demo.height,
        fps: 60,
        duration: demo.duration,
        frameCount: demo.frames.length,
        timestamps: demo.frames.map((f) => f.timestamp),
      };
      const record: SessionRecord = {
        id: `demo-${Date.now().toString(36)}`,
        title: desc.title,
        sourceType: 'demo',
        createdAt: new Date().toISOString(),
        fps: 60,
        width: demo.width,
        height: demo.height,
        playbackSpeed: 1.0,
        modelVariant: 'synthetic',
        rotationSource: analysis.rotationSource,
        cameraDriftPx: analysis.cameraDriftPx,
        cameraDriftFraction: analysis.cameraDriftFraction,
        warnings: analysis.warnings,
        jumps: analysis.jumps,
        poseFrames: demo.frames,
      };
      setLoadedVideo(desc);
      setRoi(null);
      setPoseFrames(demo.frames);
      setActiveSession(record);
      setSelectedJumpIdx(0);
      setKeyframes([]);
      setCurrentTime(analysis.jumps[0]?.takeoffTime ?? 0.6);
      await saveSessionToServer(record);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Demo failed');
    } finally {
      setBusyPct(null);
      setBusyLabel('');
    }
  };

  const handleRecomputeFromCache = async (newSpeed: number) => {
    setPlaybackSpeed(newSpeed);
    if (!activeSession || poseFrames.length === 0) return;
    try {
      const analysis = analyzePoseFrames(poseFrames, activeSession.height, {
        playbackSpeed: newSpeed,
      });
      const updated: SessionRecord = {
        ...activeSession,
        playbackSpeed: newSpeed,
        jumps: analysis.jumps,
        warnings: analysis.warnings,
      };
      setActiveSession(updated);
      setSelectedJumpIdx(0);
      await saveSessionToServer(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Recalculation failed');
    }
  };

  const handleNudgeJump = async (deltaTo: number, deltaLa: number) => {
    if (!activeSession || poseFrames.length === 0) return;
    const currentJump = activeSession.jumps[selectedJumpIdx];
    if (!currentJump) return;
    const updatedJump = nudgeJumpBoundary(
      poseFrames,
      currentJump,
      deltaTo,
      deltaLa,
      activeSession.playbackSpeed,
    );
    const nextJumps = activeSession.jumps.map((j, idx) =>
      idx === selectedJumpIdx ? updatedJump : j,
    );
    const updated: SessionRecord = { ...activeSession, jumps: nextJumps };
    setActiveSession(updated);
    setCurrentTime(deltaTo !== 0 ? updatedJump.takeoffTime : updatedJump.landingTime);
    if (loadedVideo?.streamUrl) {
      const snaps = await captureJumpKeyframes(loadedVideo.streamUrl, poseFrames, updatedJump);
      setKeyframes(snaps);
      updated.keyframes = snaps;
    }
    await saveSessionToServer(updated);
  };

  const handleOpenSavedSession = async (id: string) => {
    setErrorMsg(null);
    try {
      const resp = await fetch(`/api/sessions/${id}`);
      if (!resp.ok) throw new Error('Could not load saved session');
      const full: SessionRecord = await resp.json();
      setActiveSession(full);
      setPoseFrames(full.poseFrames || []);
      setKeyframes(full.keyframes || []);
      setPlaybackSpeed(full.playbackSpeed || 1.0);
      setSelectedJumpIdx(0);
      setLoadedVideo({
        videoId: full.videoId || full.id,
        title: full.title,
        sourceType: full.sourceType,
        sourceUrl: full.sourceUrl || undefined,
        streamUrl: full.videoId && full.sourceType !== 'demo' ? `/api/videos/${full.videoId}/stream` : undefined,
        width: full.width,
        height: full.height,
        fps: full.fps,
        duration:
          full.poseFrames && full.poseFrames.length > 0
            ? full.poseFrames[full.poseFrames.length - 1].timestamp
            : 2.4,
        frameCount: full.poseFrames?.length || 0,
        timestamps: full.poseFrames?.map((f) => f.timestamp) || [],
      });
      setCurrentTime(full.jumps?.[0]?.takeoffTime ?? 0);
      setView('analyze');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to open session');
    }
  };

  const handleDeleteSavedSession = async (id: string) => {
    try {
      const resp = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (resp.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSession?.id === id) {
          setActiveSession(null);
          setPoseFrames([]);
          setKeyframes([]);
        }
      }
    } catch {
      // ignore
    }
  };

  const activeJump: JumpMetrics | null = activeSession?.jumps?.[selectedJumpIdx] || null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 1-row, 3-zone header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setView('analyze')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Skate Metrics
          </button>

          <nav className="flex items-center gap-6 text-sm font-medium">
            {([
              ['analyze', 'Analyze'],
              ['sessions', 'Sessions'],
              ['compare', 'Compare'],
              ['guide', 'Guide'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  view === key
                    ? 'border-sky-600 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleRunSyntheticDemo}
              disabled={busyPct !== null}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              Run Synthetic Demo
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-7">
        {errorMsg && (
          <div className="mb-5 border border-rose-200 bg-rose-50 text-rose-900 rounded-xl px-4 py-3 flex items-start justify-between gap-3 text-sm">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-rose-600 hover:text-rose-800"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {view === 'analyze' && (
          <div className="space-y-6">
            {/* Input Control Deck */}
            <section className="border border-slate-200 bg-white rounded-xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">
                    Figure-Skating Jump Telemetry
                  </h1>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Paste a YouTube jump link or upload a rink clip to measure flight height, 3D revolutions, snap speed, and joint alignment.
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setSourceMode('youtube')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      sourceMode === 'youtube'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                    YouTube Link
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceMode('upload')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      sourceMode === 'upload'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload Clip
                  </button>
                </div>
              </div>

              {sourceMode === 'youtube' ? (
                <div className="pt-4 space-y-4">
                  <div className="flex flex-col md:flex-row gap-3">
                    <input
                      type="url"
                      value={youtubeUrl}
                      onChange={(e) => handleYouTubeUrlChange(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=... or youtu.be/... or /shorts/..."
                      className="flex-1 px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <button
                      type="button"
                      onClick={handleProbeYouTube}
                      disabled={probingYoutube || busyPct !== null}
                      className="px-4 py-2.5 text-sm font-medium border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {probingYoutube ? 'Checking...' : 'Check Video Info'}
                    </button>
                    <button
                      type="button"
                      onClick={handleLoadYouTubeOnly}
                      disabled={busyPct !== null}
                      className="px-4 py-2.5 text-sm font-medium border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      Load &amp; Crop
                    </button>
                    <button
                      type="button"
                      onClick={handleAnalyzeYouTube}
                      disabled={busyPct !== null}
                      className="px-5 py-2.5 text-sm font-medium bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      Analyze Jump
                    </button>
                  </div>

                  {youtubeMeta && (
                    <div className="flex flex-wrap items-center justify-between gap-4 p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900 text-sm">
                          {youtubeMeta.title}
                        </div>
                        <div className="text-slate-500 flex flex-wrap items-center gap-2">
                          <span>{youtubeMeta.uploader}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {youtubeMeta.width}×{youtubeMeta.height}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {youtubeMeta.fps} fps
                          </span>
                          {youtubeMeta.duration > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {youtubeMeta.duration.toFixed(1)}s total
                              </span>
                            </>
                          )}
                          {!youtubeMeta.has60fps && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-700 font-medium">
                                Under 50 fps (rotation peak may be smoothed)
                              </span>
                            </>
                          )}
                        </div>
                        {youtubeMeta.botCheckNotice && (
                          <div className="text-amber-800 pt-1">
                            {youtubeMeta.botCheckNotice}
                          </div>
                        )}
                      </div>
                      {(youtubeMeta.embedUrl || parsedYt?.embedUrl) && (
                        <button
                          type="button"
                          onClick={() => setShowEmbedStudio((v) => !v)}
                          className="text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap shrink-0"
                        >
                          {showEmbedStudio ? 'Hide Embedded Player' : 'Open Embedded Player'}
                        </button>
                      )}
                    </div>
                  )}

                  {(showEmbedStudio && (youtubeMeta?.embedUrl || parsedYt?.embedUrl)) && (
                    <YouTubeClipStudio
                      title={youtubeMeta?.title || 'YouTube Figure Skating Clip'}
                      embedUrl={(youtubeMeta?.embedUrl || parsedYt?.embedUrl) as string}
                      startSec={startSec.trim() ? Number(startSec) : parsedYt?.startSec ?? null}
                      onClipCaptured={(file) => handleUploadFile(file)}
                      disabled={busyPct !== null}
                    />
                  )}

                  {/* Trimming, Playback Speed & Model Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Trim Start (sec)
                      </label>
                      <div className="relative">
                        <Scissors className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          value={startSec}
                          onChange={(e) => setStartSec(e.target.value)}
                          placeholder="e.g. 14.0"
                          className="w-full pl-8 pr-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Trim End (sec)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={endSec}
                        onChange={(e) => setEndSec(e.target.value)}
                        placeholder="e.g. 18.5"
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Clip Playback Speed
                      </label>
                      <select
                        value={playbackSpeed}
                        onChange={(e) => handleRecomputeFromCache(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900"
                      >
                        <option value={1.0}>1.0× (Real-time)</option>
                        <option value={0.5}>0.5× (50% Slow-Mo)</option>
                        <option value={0.4}>0.4× (40% Slow-Mo)</option>
                        <option value={0.25}>0.25× (Quarter Speed)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        MediaPipe Pose Model
                      </label>
                      <select
                        value={modelVariant}
                        onChange={(e) => setModelVariant(e.target.value as ModelVariant)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900"
                      >
                        <option value="lite">Lite (Fastest)</option>
                        <option value="full">Full (Balanced · Recommended)</option>
                        <option value="heavy">Heavy (Highest Precision)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((v) => !v)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      {showAdvanced ? 'Hide optional cookies.txt' : 'Optional cookies.txt (for gated YouTube videos)'}
                    </button>
                    {showAdvanced && (
                      <div className="mt-2.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                          <span>
                            Hosted cloud servers may be asked by YouTube to verify you&apos;re not a bot. Paste or load a Netscape <code>cookies.txt</code> export.
                          </span>
                          <label className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-slate-300 rounded-md bg-white text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0">
                            <span>Load cookies.txt file</span>
                            <input
                              type="file"
                              accept=".txt"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  setCookiesTxt(await file.text());
                                }
                              }}
                            />
                          </label>
                        </div>
                        <textarea
                          rows={3}
                          value={cookiesTxt}
                          onChange={(e) => setCookiesTxt(e.target.value)}
                          placeholder="# Netscape HTTP Cookie File (optional, used only for this download and immediately deleted)"
                          className="w-full p-2.5 text-xs font-mono border border-slate-300 rounded-lg bg-slate-50"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="pt-4 space-y-4">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleUploadFile(file);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 hover:border-sky-500 rounded-xl p-8 text-center cursor-pointer bg-slate-50/70 transition-colors"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".mp4,.mov,.m4v,.webm,.mkv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadFile(file);
                      }}
                    />
                    <Film className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <div className="text-sm font-medium text-slate-900">
                      Drop a rink clip here or click to browse
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      MP4, MOV, or WebM · Exact presentation timestamps read via ffprobe
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Clip Playback Speed
                      </label>
                      <select
                        value={playbackSpeed}
                        onChange={(e) => handleRecomputeFromCache(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900"
                      >
                        <option value={1.0}>1.0× (Real-time)</option>
                        <option value={0.5}>0.5× (50% Slow-Mo)</option>
                        <option value={0.4}>0.4× (40% Slow-Mo)</option>
                        <option value={0.25}>0.25× (Quarter Speed)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        MediaPipe Pose Model
                      </label>
                      <select
                        value={modelVariant}
                        onChange={(e) => setModelVariant(e.target.value as ModelVariant)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900"
                      >
                        <option value="lite">Lite (Fastest)</option>
                        <option value="full">Full (Balanced)</option>
                        <option value="heavy">Heavy (Highest Precision)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Progress Bar */}
              {busyPct !== null && (
                <div className="mt-4 pt-4 border-t border-slate-200 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800">{busyLabel}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono tabular-nums text-slate-600">{busyPct}%</span>
                      {abortRef.current && (
                        <button
                          type="button"
                          onClick={() => abortRef.current?.abort()}
                          className="text-rose-600 hover:text-rose-800 font-medium"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sky-600 transition-all duration-150"
                      style={{ width: `${busyPct}%` }}
                    />
                  </div>
                </div>
              )}
            </section>

            {/* Video + Pose Viewport (shown once clip is loaded or demo runs) */}
            {loadedVideo && (
              <section className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {loadedVideo.title}
                    </h2>
                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                      <span className="font-mono tabular-nums">
                        {loadedVideo.width}×{loadedVideo.height}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {loadedVideo.fps.toFixed(1)} fps
                      </span>
                      {activeSession && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{activeSession.rotationSource}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            drift {(activeSession.cameraDriftFraction * 100).toFixed(1)}%
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {loadedVideo.streamUrl && busyPct === null && (
                    <button
                      type="button"
                      onClick={() => runPosePipelineOnVideo(loadedVideo, roi)}
                      className="px-4 py-2 text-xs font-medium bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      {roi
                        ? 'Run Analysis on Cropped Skater'
                        : poseFrames.length > 0
                          ? 'Re-run Pose Analysis'
                          : 'Run Pose Analysis'}
                    </button>
                  )}
                </div>

                {/* Measurement Warnings */}
                {activeSession && activeSession.warnings.length > 0 && (
                  <div className="border border-amber-200 bg-amber-50/70 rounded-xl px-4 py-3 space-y-1">
                    {activeSession.warnings.map((w, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs text-amber-900">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                <VideoSkeletonPlayer
                  videoUrl={loadedVideo.streamUrl}
                  isSynthetic={loadedVideo.sourceType === 'demo'}
                  width={loadedVideo.width}
                  height={loadedVideo.height}
                  fps={loadedVideo.fps}
                  duration={loadedVideo.duration}
                  frames={poseFrames}
                  jumps={activeSession?.jumps || []}
                  activeJumpId={activeJump?.id}
                  currentTime={currentTime}
                  onTimeChange={setCurrentTime}
                  roi={roi}
                  onRoiChange={setRoi}
                  allowRoiEdit={loadedVideo.sourceType !== 'demo'}
                />

                {/* Jump Selector Tabs if multiple jumps detected */}
                {activeSession && activeSession.jumps.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
                    {activeSession.jumps.map((j, idx) => (
                      <button
                        key={j.id}
                        type="button"
                        onClick={() => {
                          setSelectedJumpIdx(idx);
                          setCurrentTime(j.takeoffTime);
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          selectedJumpIdx === idx
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Jump #{idx + 1} · {j.joints.jumpHint}
                      </button>
                    ))}
                  </div>
                )}

                {activeSession && activeJump && (
                  <>
                    <JumpInspector
                      session={activeSession}
                      jump={activeJump}
                      frames={poseFrames}
                      keyframes={keyframes}
                      onNudge={handleNudgeJump}
                      onSeek={setCurrentTime}
                    />
                    <TelemetryCharts
                      jump={activeJump}
                      currentTime={currentTime}
                      onSeek={setCurrentTime}
                    />
                  </>
                )}
              </section>
            )}
          </div>
        )}

        {view === 'sessions' && (
          <SessionsView
            sessions={sessions}
            loading={sessionsLoading}
            onOpenSession={handleOpenSavedSession}
            onDeleteSession={handleDeleteSavedSession}
            onStartAnalyze={() => setView('analyze')}
          />
        )}

        {view === 'compare' && <CompareView sessions={sessions} />}

        {view === 'guide' && (
          <div className="max-w-3xl space-y-6">
            <section className="border border-slate-200 bg-white rounded-xl p-6 space-y-3">
              <h1 className="text-xl font-semibold text-slate-900">
                Using YouTube Links &amp; Getting Accurate Jump Numbers
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Skate Metrics extracts 33 2D and metric 3D world landmarks per frame using MediaPipe PoseLandmarker and derives jump height from airborne flight time, plus rotation, arm pull-in snap speed, knee bend, and axis tilt.
              </p>
            </section>

            <section className="border border-slate-200 bg-white rounded-xl p-6 space-y-3">
              <h2 className="text-base font-semibold text-slate-900">
                1. Trim Broadcast Videos Before Downloading
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Long competition broadcasts often cut between cameras. Click <strong>Check Video Info</strong>, enter a 2–6 second <strong>Start / End</strong> range around the jump, and click <strong>Load &amp; Crop</strong> or <strong>Analyze Jump</strong>. The server uses <code>yt-dlp --download-sections</code> so only that window is fetched.
              </p>
            </section>

            <section className="border border-slate-200 bg-white rounded-xl p-6 space-y-3">
              <h2 className="text-base font-semibold text-slate-900">
                2. Use &ldquo;Crop Target Skater&rdquo; on Wide Rink Angles
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                If the skater occupies less than 35% of the frame or other skaters are visible on the ice, click <strong>Load &amp; Crop</strong>, click <strong>Crop Target Skater</strong> above the video, drag a box around the skater, and then run pose analysis.
              </p>
            </section>

            <section className="border border-slate-200 bg-white rounded-xl p-6 space-y-3">
              <h2 className="text-base font-semibold text-slate-900">
                3. Slow-Motion Clips &amp; Frame Nudging
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                For slow-motion replay clips on YouTube (often 0.5× or 0.4× speed), select the matching <strong>Clip Playback Speed</strong> so flight time and ballistic height are scaled accurately. You can adjust takeoff or landing by ±1 frame in the inspector without re-running pose inference.
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
