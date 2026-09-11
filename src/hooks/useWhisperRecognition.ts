"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface UseWhisperRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  isProcessing: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

// Firefox's MediaRecorder produces Opus in an Ogg container. Prefer that MIME
// type and fall back to whatever else the browser can record.
const PREFERRED_AUDIO_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

function getMediaDevices(): MediaDevices | null {
  if (typeof navigator === "undefined") return null;
  return navigator.mediaDevices ?? null;
}

function isMediaRecorderSupported(): boolean {
  return typeof MediaRecorder !== "undefined";
}

function detectSupported(): boolean {
  if (typeof window === "undefined") return false;
  const devices = getMediaDevices();
  if (!devices || typeof devices.getUserMedia !== "function") return false;
  return isMediaRecorderSupported();
}

// Pick the first MIME type the browser claims to support. Firefox supports
// audio/ogg;codecs=opus, so it is tried before WebM/MP4.
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return PREFERRED_AUDIO_TYPES[0];
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return PREFERRED_AUDIO_TYPES[0];
  }
  for (const type of PREFERRED_AUDIO_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // A malformed MIME type is not a valid choice — keep looking.
    }
  }
  return "";
}

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  });
}

function friendlyMicError(err: unknown): string {
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: unknown }).name)
      : "";
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError"
  ) {
    return "Microphone access was denied. Please allow microphone access in your browser settings.";
  }
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return "No microphone was found. Please check your audio input.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The microphone is in use by another application. Please try again.";
  }
  return "Couldn't access the microphone. Please try again.";
}

// Record with MediaRecorder, then upload the finished clip to the local
// Whisper server through /api/stt. Whisper is not streaming: interim stays
// empty and the final transcript arrives after recording stops and the
// clip has been transcribed.
export function useWhisperRecognition(): UseWhisperRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startedRef = useRef(false);
  const processingRef = useRef(false);
  const completingRef = useRef(false);
  const sessionRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const isSupported = detectSupported();

  useEffect(() => {
    return () => {
      // Invalidate the session so late callbacks are ignored, then stop any
      // active recording and release the microphone.
      sessionRef.current += 1;
      startedRef.current = false;
      completingRef.current = false;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // already stopped
        }
      }
      recorderRef.current = null;
      stopTracks(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  async function transcribe(blob: Blob, session: number): Promise<void> {
    processingRef.current = true;
    setIsProcessing(true);
    try {
      const form = new FormData();
      form.append("file", blob, "recording");
      const response = await fetch("/api/stt", {
        method: "POST",
        body: form,
      });

      if (sessionRef.current !== session) return;

      if (!response.ok) {
        let message = "Speech-to-text failed. Please try again.";
        try {
          const data = await response.json();
          if (
            data &&
            typeof data === "object" &&
            typeof (data as { error?: unknown }).error === "string" &&
            (data as { error?: string }).error
          ) {
            message = (data as { error: string }).error;
          }
        } catch {
          // keep the default message
        }
        setError(message);
        return;
      }

      const data = await response.json();
      if (sessionRef.current !== session) return;
      const text =
        data && typeof data === "object" && typeof data.text === "string"
          ? data.text.trim()
          : "";
      if (!text) {
        setError("No speech was detected. Please try again.");
        return;
      }
      setTranscript(text);
    } catch {
      if (sessionRef.current !== session) return;
      setError(
        "Couldn't reach the local speech-to-text service. Please try again."
      );
    } finally {
      if (sessionRef.current === session) {
        processingRef.current = false;
        setIsProcessing(false);
      }
    }
  }

  const start = useCallback(() => {
    if (!isSupported) {
      setError("Voice input is not supported in this browser.");
      return;
    }
    if (startedRef.current || recorderRef.current || processingRef.current) {
      return;
    }

    const session = ++sessionRef.current;
    const devices = getMediaDevices();
    if (!devices) {
      setError("Voice input is not supported in this browser.");
      return;
    }

    startedRef.current = true;
    completingRef.current = false;
    setError(null);
    setTranscript("");
    setInterimTranscript("");
    setIsListening(true);

    const mimeType = pickMimeType();

    devices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (!startedRef.current || sessionRef.current !== session) {
          stopTracks(stream);
          return;
        }
        streamRef.current = stream;

        let recorder: MediaRecorder;
        try {
          recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);
        } catch {
          // A MIME type can be declared supported but still fail at
          // construction — retry with the browser default.
          try {
            recorder = new MediaRecorder(stream);
          } catch {
            stopTracks(stream);
            streamRef.current = null;
            startedRef.current = false;
            setIsListening(false);
            setError("Couldn't start recording. Please try again.");
            return;
          }
        }

        chunksRef.current = [];

        const handleData = (e: Event) => {
          const data = (e as BlobEvent).data;
          if (data && data.size > 0) chunksRef.current.push(data);
        };

        const handleStop = () => {
          const shouldTranscribe = completingRef.current;
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || mimeType || undefined,
          });
          chunksRef.current = [];
          stopTracks(stream);
          streamRef.current = null;
          recorderRef.current = null;
          startedRef.current = false;
          if (sessionRef.current !== session) return;
          setIsListening(false);
          if (shouldTranscribe) {
            void transcribe(blob, session);
          } else {
            setError("Recording was interrupted. Please try again.");
          }
        };

        const handleError = () => {
          if (sessionRef.current !== session) return;
          stopTracks(stream);
          streamRef.current = null;
          recorderRef.current = null;
          startedRef.current = false;
          setIsListening(false);
          setError("Recording failed. Please try again.");
        };

        recorder.addEventListener("dataavailable", handleData);
        recorder.addEventListener("stop", handleStop);
        recorder.addEventListener("error", handleError);
        recorderRef.current = recorder;

        try {
          recorder.start();
        } catch {
          stopTracks(stream);
          streamRef.current = null;
          recorderRef.current = null;
          startedRef.current = false;
          setIsListening(false);
          setError("Couldn't start recording. Please try again.");
        }
      })
      .catch((err: unknown) => {
        if (sessionRef.current !== session) return;
        startedRef.current = false;
        setIsListening(false);
        setError(friendlyMicError(err));
      });
  }, [isSupported]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      completingRef.current = true;
      processingRef.current = true;
      setIsListening(false);
      setIsProcessing(true);
      try {
        recorder.stop();
      } catch {
        // If stop is called while already inactive the stop event never
        // fires — undo the pending transcription state.
        completingRef.current = false;
        processingRef.current = false;
        setIsProcessing(false);
        setIsListening(false);
      }
      return;
    }

    // Not recording yet (still waiting on the permission prompt): cancel
    // the pending setup so the mic never starts after the user tapped stop.
    if (startedRef.current && !recorderRef.current) {
      startedRef.current = false;
      completingRef.current = false;
      setIsListening(false);
    }
  }, []);

  const reset = useCallback(() => {
    sessionRef.current += 1;
    startedRef.current = false;
    processingRef.current = false;
    completingRef.current = false;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // already stopped
      }
    }
    recorderRef.current = null;
    stopTracks(streamRef.current);
    streamRef.current = null;
    setIsListening(false);
    setIsProcessing(false);
    setTranscript("");
    setInterimTranscript("");
    setError(null);
  }, []);

  return {
    isSupported,
    isListening,
    isProcessing,
    transcript,
    interimTranscript,
    error,
    start,
    stop,
    reset,
  };
}