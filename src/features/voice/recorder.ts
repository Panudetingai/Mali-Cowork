/**
 * Recording what the user says, for a model to transcribe. The webview's own
 * MediaRecorder (AAC on macOS): no audio library in the app, and the mic is
 * released the moment recording ends. It also tells how loud the voice is,
 * for the animation, and when the user has stopped talking.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Longest recording; a spoken task fits well inside it. */
const MAX_MS = 120_000;
/** Quiet this long after speech, and the recording ends by itself. */
const SILENCE_MS = 1_600;
/** Below this level (0–1) counts as quiet. */
const QUIET = 0.04;

export type Recording = { blob: Blob; mime: string; ms: number };

function bestMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export function recordingSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

const MIC_ERRORS: Record<string, string> = {
  NotAllowedError: "Microphone access was denied — allow Mali in System Settings → Privacy & Security → Microphone.",
  NotFoundError: "No microphone was found.",
  NotReadableError: "The microphone is busy in another app.",
};

/**
 * `start` → speak → the recording ends on `stop`, after a pause in speech
 * (`autoStop`), or at the limit; `onDone` gets it. `cancel` throws it away.
 */
export function useRecorder({ onDone, autoStop = true }: { onDone: (recording: Recording) => void; autoStop?: boolean }) {
  const [recording, setRecording] = useState(false);
  // Read by the waveform each frame; kept out of state so nothing re-renders 60 times a second.
  const level = useRef(0);
  const [error, setError] = useState<string>();
  const session = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    context: AudioContext;
    frame: number;
    started: number;
    keep: boolean;
  } | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback((keep: boolean) => {
    const s = session.current;
    if (!s) return;
    s.keep = keep;
    cancelAnimationFrame(s.frame);
    if (s.recorder.state !== "inactive") s.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (session.current) return;
    setError(undefined);
    if (!recordingSupported()) {
      setError("Recording isn't supported in this version of the app's web view.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      const name = (e as { name?: string })?.name ?? "";
      setError(MIC_ERRORS[name] ?? (e instanceof Error ? e.message : String(e)));
      return;
    }
    const mime = bestMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);

    // How loud it is now, from a small analyser on the same stream.
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let spoke = false;
    let quietSince = 0;

    const started = performance.now();
    const tick = (now: number) => {
      const s = session.current;
      if (!s) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      const rms = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      level.current = rms;
      if (rms > QUIET) {
        spoke = true;
        quietSince = 0;
      } else if (spoke) {
        quietSince ||= now;
      }
      const tooLong = now - started > MAX_MS;
      if (tooLong || (autoStop && spoke && quietSince && now - quietSince > SILENCE_MS)) {
        finish(true);
        return;
      }
      s.frame = requestAnimationFrame(tick);
    };

    recorder.onstop = () => {
      const s = session.current;
      session.current = null;
      // The mic light goes off now, not when the page closes.
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      setRecording(false);
      level.current = 0;
      if (s?.keep && chunks.length) {
        const type = recorder.mimeType || mime || "audio/mp4";
        onDoneRef.current({ blob: new Blob(chunks, { type }), mime: type, ms: performance.now() - started });
      }
    };

    session.current = { recorder, stream, context, frame: 0, started, keep: true };
    recorder.start(250);
    setRecording(true);
    session.current.frame = requestAnimationFrame(tick);
  }, [autoStop, finish]);

  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => finish(false), [finish]);

  useEffect(() => () => finish(false), [finish]);

  return { recording, level, error, clearError: () => setError(undefined), start, stop, cancel };
}

/** A recording as base64, for the backend. */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
