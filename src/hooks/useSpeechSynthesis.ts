"use client";

import { useState, useEffect, useCallback, useRef } from "react";

function getSpeechSynthesis(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

export interface UseSpeechSynthesisReturn {
  isSupported: boolean;
  isSpeaking: boolean;
  error: string | null;
  speak: (text: string) => void;
  cancel: () => void;
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const resumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSupported = getSpeechSynthesis() !== null;

  const cleanup = useCallback(() => {
    if (resumeIntervalRef.current) {
      clearInterval(resumeIntervalRef.current);
      resumeIntervalRef.current = null;
    }
    const synth = getSpeechSynthesis();
    if (synth) {
      try {
        synth.cancel();
      } catch {
        // swallow
      }
    }
    utteranceRef.current = null;
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const speak = useCallback(
    (text: string) => {
      const synth = getSpeechSynthesis();
      if (!synth) {
        setError("Speech synthesis is not supported in this browser.");
        return;
      }

      if (!text.trim()) return;

      // Cancel any ongoing speech before starting a new utterance.
      synth.cancel();

      if (resumeIntervalRef.current) {
        clearInterval(resumeIntervalRef.current);
        resumeIntervalRef.current = null;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";

      const finish = () => {
        if (resumeIntervalRef.current) {
          clearInterval(resumeIntervalRef.current);
          resumeIntervalRef.current = null;
        }
        setIsSpeaking(false);
        utteranceRef.current = null;
      };

      utterance.onstart = () => {
        setIsSpeaking(true);
        setError(null);
      };

      utterance.onend = finish;

      utterance.onerror = (event) => {
        // "canceled" is expected when cancel() is called — not a real error.
        if (event.error === "canceled") {
          finish();
          return;
        }

        finish();

        const messages: Record<string, string> = {
          network:
            "Speech synthesis requires an internet connection.",
        };

        setError(
          messages[event.error] ||
            `Speech synthesis error: ${event.error}`
        );
      };

      utteranceRef.current = utterance;
      synth.speak(utterance);

      // Safari workaround: speechSynthesis may pause after the first
      // utterance. Resume periodically while speaking.
      resumeIntervalRef.current = setInterval(() => {
        if (synth.speaking && !synth.paused) {
          synth.resume();
        } else {
          clearInterval(resumeIntervalRef.current!);
          resumeIntervalRef.current = null;
        }
      }, 10000);
    },
    []
  );

  const cancel = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return {
    isSupported,
    isSpeaking,
    error,
    speak,
    cancel,
  };
}
