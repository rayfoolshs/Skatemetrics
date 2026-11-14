import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Circle, Square, Video } from 'lucide-react';

interface YouTubeClipStudioProps {
  title: string;
  embedUrl: string;
  startSec?: number | null;
  onClipCaptured: (file: File) => void;
  disabled?: boolean;
}

interface CropTargetStatic {
  fromElement(element: Element): Promise<unknown>;
}

interface CropCapableTrack extends MediaStreamTrack {
  cropTo?(cropTarget: unknown): Promise<void>;
}

export const YouTubeClipStudio: React.FC<YouTubeClipStudioProps> = ({
  title,
  embedUrl,
  startSec,
  onClipCaptured,
  disabled = false,
}) => {
  const playerBoxRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [ytPlaybackRate, setYtPlaybackRate] = useState<number>(1);
  const [regionCropped, setRegionCropped] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - t0);
    }, 100);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const sendYouTubeCommand = (func: string, args: unknown[] = []) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      '*',
    );
  };

  const handleSpeedChange = (rate: number) => {
    setYtPlaybackRate(rate);
    sendYouTubeCommand('setPlaybackRate', [rate]);
  };

  const handleCueStart = () => {
    if (startSec !== null && startSec !== undefined && Number.isFinite(startSec)) {
      sendYouTubeCommand('seekTo', [Math.max(0, startSec), true]);
      sendYouTubeCommand('playVideo');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  const startRecording = async () => {
    setCaptureError(null);
    setRegionCropped(false);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setCaptureError('Screen/tab capture is not supported in this browser. Try Chrome or Edge, or use cookies.txt / local upload.');
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 60, max: 60 },
        },
        audio: false,
        preferCurrentTab: true,
      } as DisplayMediaStreamOptions);

      streamRef.current = displayStream;
      const track = displayStream.getVideoTracks()[0] as CropCapableTrack | undefined;

      // Use Region Capture (CropTarget) when supported in Chromium so only the YouTube video box is recorded
      const maybeCropTarget = (window as unknown as { CropTarget?: CropTargetStatic }).CropTarget;
      if (track?.cropTo && maybeCropTarget?.fromElement && playerBoxRef.current) {
        try {
          const target = await maybeCropTarget.fromElement(playerBoxRef.current);
          await track.cropTo(target);
          setRegionCropped(true);
        } catch {
          // If user chose another tab/window instead of current tab, continue uncropped
        }
      }

      const mimeCandidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
      const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const recorder = new MediaRecorder(
        displayStream,
        mimeType ? { mimeType, videoBitsPerSecond: 10_000_000 } : undefined,
      );

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        displayStream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
          const safeName = title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'youtube_clip';
          const file = new File([blob], `${safeName}.webm`, { type: blob.type });
          onClipCaptured(file);
        }
      };

      track?.addEventListener('ended', () => {
        if (recorder.state !== 'inactive') recorder.stop();
      });

      recorderRef.current = recorder;
      recorder.start(250);
      setElapsedMs(0);
      setRecording(true);
      sendYouTubeCommand('playVideo');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('disallowed')) {
        setCaptureError(
          'Tab capture was blocked by the preview iframe permissions policy. Open the app directly in its own browser tab, or paste cookies.txt under Advanced Options to download directly.',
        );
      } else if (!msg.toLowerCase().includes('cancel')) {
        setCaptureError(msg);
      }
    }
  };

  return (
    <div className="border border-slate-200 bg-white rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2 text-xs text-slate-700">
          <Video className="w-4 h-4 text-sky-600 shrink-0" />
          <span className="font-semibold text-slate-900">Embedded YouTube Clip Capture</span>
          <span aria-hidden="true">·</span>
          <span className="truncate max-w-[260px] text-slate-500">{title}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {startSec !== null && startSec !== undefined && (
            <button
              type="button"
              onClick={handleCueStart}
              className="px-2.5 py-1 text-xs font-medium border border-slate-300 rounded-md bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              Cue {startSec.toFixed(1)}s
            </button>
          )}

          <div className="flex items-center gap-1 text-xs text-slate-600">
            <span>YouTube Speed</span>
            <select
              value={ytPlaybackRate}
              onChange={(e) => handleSpeedChange(Number(e.target.value))}
              className="bg-white border border-slate-300 rounded-md px-2 py-1 text-xs font-mono tabular-nums text-slate-800"
            >
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.50×</option>
              <option value={1}>1.00×</option>
            </select>
          </div>

          {!recording ? (
            <button
              type="button"
              onClick={startRecording}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Circle className="w-3 h-3 fill-current" />
              Record Clip from Player
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 whitespace-nowrap shrink-0"
            >
              <Square className="w-3 h-3 fill-current" />
              Stop &amp; Analyze ({(elapsedMs / 1000).toFixed(1)}s)
            </button>
          )}
        </div>
      </div>

      {captureError && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>{captureError}</span>
        </div>
      )}

      <div
        ref={playerBoxRef}
        className="relative w-full aspect-video bg-slate-950"
      >
        <iframe
          ref={iframeRef}
          src={embedUrl}
          title={title}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>

      <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
        <span>
          {recording
            ? regionCropped
              ? 'Recording cropped directly to the YouTube player frame — click Stop & Analyze right after the landing.'
              : 'Recording active — play the jump and click Stop & Analyze right after the landing.'
            : 'Cue the video just before the jump, set YouTube Speed (e.g. 0.5× or 1.0× to match Clip Playback Speed), then click Record Clip from Player.'}
        </span>
      </div>
    </div>
  );
};
