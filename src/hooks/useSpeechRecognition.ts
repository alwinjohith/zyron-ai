"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type SpeechRecognitionErrorEvent = Event & {
  error: string;
  message: string;
};

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as SpeechRecognitionConstructor) ||
    (w.webkitSpeechRecognition as SpeechRecognitionConstructor) ||
    null;
}

export interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isStartingRef = useRef(false);

  const isSupported = getSpeechRecognitionConstructor() !== null;

  const cleanup = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    r.onstart = null;
    try {
      r.abort();
    } catch {
      // already stopped
    }
    recognitionRef.current = null;
    isStartingRef.current = false;
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const start = useCallback(() => {
    if (!isSupported) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    if (isStartingRef.current || recognitionRef.current) return;

    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      isStartingRef.current = false;
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }

      if (final) {
        setTranscript((prev) => (prev ? prev + " " + final : final));
        setInterimTranscript("");
      } else {
        setInterimTranscript(interim);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      isStartingRef.current = false;
      setIsListening(false);

      const errorMessages: Record<string, string> = {
        "no-speech":
          "No speech was detected. Please try again.",
        "audio-capture":
          "No microphone was found. Please check your audio input.",
        "not-allowed":
          "Microphone access was denied. Please allow microphone access in your browser settings.",
        network:
          "Speech recognition requires an internet connection.",
        aborted:
          "Speech recognition was aborted.",
        "service-not-allowed":
          "Speech recognition service is not allowed.",
      };

      setError(
        errorMessages[event.error] ||
          `Speech recognition error: ${event.error}`
      );
    };

    recognition.onend = () => {
      isStartingRef.current = false;
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    isStartingRef.current = true;

    try {
      recognition.start();
    } catch {
      isStartingRef.current = false;
      recognitionRef.current = null;
      setError("Failed to start speech recognition.");
    }
  }, [isSupported]);

  const stop = useCallback(() => {
    const r = recognitionRef.current;
    if (r) {
      isStartingRef.current = false;
      try {
        r.stop();
      } catch {
        // already stopped
      }
    }
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setTranscript("");
    setInterimTranscript("");
    setError(null);
    setIsListening(false);
  }, [cleanup]);

  return {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    error,
    start,
    stop,
    reset,
  };
}
