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
export const DEFAULT_RECORD_SILENCE_MS = 1_400;
/** Voice this long before it counts as speech (a click or a cough doesn't). */
const SPEECH_MS = 180;
/** How often the level is read. A timer, not animation frames: those stop
 *  while the window is hidden, and with them the end of the recording. */
const TICK_MS = 50;
/**
 * The level (0–1) that counts as voice: at least this, and well above the
 * room's own noise. A fixed line never ended the recording on a noisy mic (a
 * fan, a laptop's hum) — it never got "quiet" — so the noise is measured as
 * it goes and the line floats above it.
 */
const VOICE = 0.06;

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
export function useRecorder({
  onDone,
  autoStop = true,
  idleMs,
  silenceMs = DEFAULT_RECORD_SILENCE_MS,
}: {
  onDone: (recording: Recording) => void;
  autoStop?: boolean;
  /** Give up (and drop the recording) when nothing is said for this long. */
  idleMs?: number;
  silenceMs?: number;
}) {
  const [recording, setRecording] = useState(false);
  // Read by the waveform each frame; kept out of state so nothing re-renders 60 times a second.
  const level = useRef(0);
  const [error, setError] = useState<string>();
  const session = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    context: AudioContext;
    timer: ReturnType<typeof setInterval> | undefined;
    started: number;
    keep: boolean;
  } | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback((keep: boolean) => {
    const s = session.current;
    if (!s) return;
    s.keep = keep;
    clearInterval(s.timer);
    if (s.recorder.state !== "inactive") s.recorder.stop();
  }, []);

  const start = useCallback(async (options?: { silenceMs?: number }) => {
    if (session.current) return;
    const pauseMs = options?.silenceMs ?? silenceMs;
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
    const vad = voiceDetector(pauseMs);

    const started = performance.now();
    const tick = () => {
      const s = session.current;
      if (!s) return;
      const now = performance.now();
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      const rms = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      level.current = rms;
      const heard = vad(rms, now);
      if (now - started > MAX_MS || (autoStop && heard.done)) {
        finish(true);
      } else if (idleMs && !heard.spoke && now - started > idleMs) {
        finish(false);
      }
    };

    recorder.onstop = () => {
      const s = session.current;
      session.current = null;
      if (s) clearInterval(s.timer);
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

    session.current = { recorder, stream, context, timer: undefined, started, keep: true };
    recorder.start(250);
    setRecording(true);
    session.current.timer = setInterval(tick, TICK_MS);
  }, [autoStop, idleMs, silenceMs, finish]);

  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => finish(false), [finish]);

  useEffect(() => () => finish(false), [finish]);

  return { recording, level, error, clearError: () => setError(undefined), start, stop, cancel };
}

/** The first readings, taken as the room before the user speaks. */
const CALIBRATE_MS = 250;

/**
 * Tells speech from the room's noise, one level reading at a time: `spoke`
 * once the voice has gone on for [`SPEECH_MS`], `done` once it has then been
 * quiet for [`SILENCE_MS`]. The noise floor starts from the first readings
 * (the mic is on before anyone talks), drops at once to a quieter room, and
 * rises slowly — hardly at all on voice, whose pauses between words pull it
 * back down anyway.
 */
export function voiceDetector(silenceMs = DEFAULT_RECORD_SILENCE_MS) {
  let floor = 0;
  let first = 0;
  let voiceSince = 0;
  let quietSince = 0;
  let spoke = false;
  return (rms: number, now: number) => {
    first ||= now;
    if (now - first < CALIBRATE_MS) {
      floor = Math.max(floor, rms);
      return { spoke, done: false };
    }
    const voice = rms > Math.max(VOICE, floor * 2.5);
    if (rms < floor) floor += (rms - floor) * 0.3;
    else floor += (rms - floor) * (voice ? 0.001 : 0.02);
    if (voice) {
      voiceSince ||= now;
      quietSince = 0;
      if (now - voiceSince >= SPEECH_MS) spoke = true;
    } else {
      voiceSince = 0;
      if (spoke) quietSince ||= now;
    }
    return { spoke, done: spoke && quietSince > 0 && now - quietSince >= silenceMs };
  };
}

/** A recording as base64, for the backend. */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
