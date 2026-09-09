// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { renderHook } from "./renderHook";

interface MockSynth {
  speaking: boolean;
  paused: boolean;
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
}

class MockUtterance {
  static all: MockUtterance[] = [];

  lang = "";
  text: string;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
    MockUtterance.all.push(this);
  }
}

let synth: MockSynth;
let current: {
  result: { current: ReturnType<typeof useSpeechSynthesis> };
  unmount: () => void;
};

beforeEach(() => {
  MockUtterance.all = [];

  synth = {
    speaking: false,
    paused: false,
    speak: vi.fn(() => {
      synth.speaking = true;
      return undefined;
    }),
    cancel: vi.fn(() => {
      synth.speaking = false;
      synth.paused = false;
    }),
    resume: vi.fn(),
  };

  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

  current = null as never;
});

afterEach(() => {
  current?.unmount();
  current = null as never;
  vi.unstubAllGlobals();
});

function render() {
  current = renderHook(useSpeechSynthesis);
}

function startUtterance() {
  act(() => {
    MockUtterance.all.at(-1)!.onstart?.();
  });
}

function endUtterance() {
  act(() => {
    MockUtterance.all.at(-1)!.onend?.();
  });
}

describe("useSpeechSynthesis — browser support", () => {
  it("reports isSupported=true when speechSynthesis exists", () => {
    render();
    expect(current.result.current.isSupported).toBe(true);
  });

  it("reports isSupported=false when speechSynthesis is missing", () => {
    vi.unstubAllGlobals();
    globalThis.speechSynthesis = undefined as never;
    render();
    expect(current.result.current.isSupported).toBe(false);
  });

  it("speak() on an unsupported browser sets an error and queues nothing", () => {
    vi.unstubAllGlobals();
    globalThis.speechSynthesis = undefined as never;
    render();
    act(() => {
      current.result.current.speak("hello");
    });
    expect(current.result.current.error).toBe(
      "Speech synthesis is not supported in this browser."
    );
    expect(MockUtterance.all).toHaveLength(0);
  });
});

describe("useSpeechSynthesis — speak lifecycle", () => {
  it("speaks text and marks the hook as speaking on start", () => {
    render();
    act(() => {
      current.result.current.speak("Hello Zyron");
    });

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(MockUtterance.all).toHaveLength(1);
    expect(MockUtterance.all[0]!.text).toBe("Hello Zyron");
    expect(MockUtterance.all[0]!.lang).toBe("en-US");
    expect(current.result.current.isSpeaking).toBe(false);

    startUtterance();
    expect(current.result.current.isSpeaking).toBe(true);
  });

  it("reports isSpeaking then flips back to false after onend", () => {
    render();
    act(() => {
      current.result.current.speak("Hello");
    });
    startUtterance();
    expect(current.result.current.isSpeaking).toBe(true);

    endUtterance();
    expect(current.result.current.isSpeaking).toBe(false);
    expect(current.result.current.error).toBeNull();
  });

  it("creates a new utterance for each speak call", () => {
    render();
    act(() => {
      current.result.current.speak("first");
    });
    endUtterance();
    act(() => {
      current.result.current.speak("second");
    });
    expect(MockUtterance.all).toHaveLength(2);
    expect(MockUtterance.all[1]!.text).toBe("second");
  });

  it("ignores empty or whitespace-only text", () => {
    render();
    act(() => {
      current.result.current.speak("   ");
    });
    expect(synth.speak).not.toHaveBeenCalled();
    expect(MockUtterance.all).toHaveLength(0);
  });

  it("cancels any ongoing speech before speaking something new", () => {
    render();
    act(() => {
      current.result.current.speak("first");
    });
    startUtterance();
    const cancelsBeforeSecond = synth.cancel.mock.calls.length;

    act(() => {
      current.result.current.speak("second");
    });
    expect(synth.cancel.mock.calls.length).toBeGreaterThan(cancelsBeforeSecond);
  });
});

describe("useSpeechSynthesis — cancel", () => {
  it("cancel() stops speaking immediately", () => {
    render();
    act(() => {
      current.result.current.speak("Hello");
    });
    startUtterance();
    expect(current.result.current.isSpeaking).toBe(true);

    act(() => {
      current.result.current.cancel();
    });
    expect(synth.cancel).toHaveBeenCalled();
    expect(current.result.current.isSpeaking).toBe(false);
  });

  it("cancel() when not speaking does not error", () => {
    render();
    act(() => {
      current.result.current.cancel();
    });
    expect(current.result.current.error).toBeNull();
  });

  it("cancel() on unmount stops any active speech", () => {
    render();
    act(() => {
      current.result.current.speak("Hello");
    });
    startUtterance();
    const cancelCount = synth.cancel.mock.calls.length;
    current.unmount();
    current = null as never;
    expect(synth.cancel.mock.calls.length).toBeGreaterThan(cancelCount);
  });
});

describe("useSpeechSynthesis — errors", () => {
  it("surfaces a non-canceled error and stops speaking", () => {
    render();
    act(() => {
      current.result.current.speak("Hello");
    });
    startUtterance();

    act(() => {
      MockUtterance.all.at(-1)!.onerror?.({ error: "network" });
    });
    expect(current.result.current.isSpeaking).toBe(false);
    expect(current.result.current.error).toContain("internet connection");
  });

  it("shows a generic message for unknown errors", () => {
    render();
    act(() => {
      current.result.current.speak("Hello");
    });
    startUtterance();

    act(() => {
      MockUtterance.all.at(-1)!.onerror?.({ error: "synthesis-failed" });
    });
    expect(current.result.current.error).toBe(
      "Speech synthesis error: synthesis-failed"
    );
  });

  it("does not treat a canceled utterance as an error", () => {
    render();
    act(() => {
      current.result.current.speak("Hello");
    });
    startUtterance();

    act(() => {
      MockUtterance.all.at(-1)!.onerror?.({ error: "canceled" });
    });
    expect(current.result.current.error).toBeNull();
    expect(current.result.current.isSpeaking).toBe(false);
  });
});