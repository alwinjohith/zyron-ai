// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { renderHook } from "./renderHook";

type Handler = ((event?: unknown) => void) | null;

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  onresult: Handler = null;
  onerror: Handler = null;
  onend: Handler = null;
  onstart: Handler = null;
  continuous = false;
  interimResults = false;
  lang = "";
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;

  start(): void {
    this.startCalls++;
    MockSpeechRecognition.instances.push(this);
  }
  stop(): void {
    this.stopCalls++;
  }
  abort(): void {
    this.abortCalls++;
  }
}

interface ResultItem {
  transcript: string;
  isFinal: boolean;
}

function buildResults(items: ResultItem[]): unknown {
  return items.map((item) => ({
    0: { transcript: item.transcript },
    isFinal: item.isFinal,
    length: 1,
  }));
}

function fireResult(recognition: MockSpeechRecognition, items: ResultItem[]) {
  act(() => {
    if (recognition.onresult) {
      recognition.onresult({
        results: buildResults(items),
        resultIndex: 0,
      });
    }
  });
}

function fireError(recognition: MockSpeechRecognition, error: string) {
  act(() => {
    if (recognition.onerror) {
      recognition.onerror({ error, message: "" });
    }
  });
}

function fireStart(recognition: MockSpeechRecognition) {
  act(() => {
    if (recognition.onstart) recognition.onstart();
  });
}

function fireEnd(recognition: MockSpeechRecognition) {
  act(() => {
    if (recognition.onend) recognition.onend();
  });
}

let current: { result: { current: ReturnType<typeof useSpeechRecognition> }; unmount: () => void };
let recentInstance: MockSpeechRecognition | null = null;

beforeEach(() => {
  current = null as never;
  recentInstance = null;
  MockSpeechRecognition.instances = [];
});

afterEach(() => {
  current?.unmount();
  current = null as never;
  vi.unstubAllGlobals();
});

function stubSupported() {
  vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);
  vi.stubGlobal("webkitSpeechRecognition", MockSpeechRecognition);
}

function render() {
  current = renderHook(useSpeechRecognition);
}

describe("useSpeechRecognition — browser support", () => {
  it("reports isSupported=false when SpeechRecognition is missing", () => {
    render();
    expect(current.result.current.isSupported).toBe(false);
  });

  it("reports isSupported=true when SpeechRecognition exists", () => {
    stubSupported();
    render();
    expect(current.result.current.isSupported).toBe(true);
  });

  it("start() on an unsupported browser sets an error and creates no instance", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    expect(current.result.current.error).toBe(
      "Speech recognition is not supported in this browser."
    );
    expect(MockSpeechRecognition.instances).toHaveLength(0);
  });
});

describe("useSpeechRecognition — listening lifecycle", () => {
  beforeEach(() => {
    stubSupported();
  });

  it("moves to listening when recognition starts", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    expect(recentInstance).not.toBeNull();

    fireStart(recentInstance!);
    expect(current.result.current.isListening).toBe(true);
    expect(current.result.current.error).toBeNull();
  });

  it("returns to not-listening after recognition ends", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    fireStart(recentInstance!);
    expect(current.result.current.isListening).toBe(true);

    fireEnd(recentInstance!);
    expect(current.result.current.isListening).toBe(false);
  });

  it("stop() stops the active recognition", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    act(() => {
      current.result.current.stop();
    });
    expect(recentInstance!.stopCalls).toBe(1);
  });

  it("does not create a second recognition instance while one is active", () => {
    render();
    act(() => {
      current.result.current.start();
      current.result.current.start();
    });
    expect(MockSpeechRecognition.instances).toHaveLength(1);
  });

  it("can start again after recognition ends", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    fireEnd(MockSpeechRecognition.instances[0]!);
    act(() => {
      current.result.current.start();
    });
    expect(MockSpeechRecognition.instances).toHaveLength(2);
    fireStart(MockSpeechRecognition.instances[1]!);
    expect(current.result.current.isListening).toBe(true);
  });

  it("aborts the active recognition on unmount", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    current.unmount();
    current = null as never;
    expect(recentInstance!.abortCalls).toBe(1);
  });
});

describe("useSpeechRecognition — transcripts", () => {
  beforeEach(() => {
    stubSupported();
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
  });

  it("exposes interim results while listening", () => {
    fireResult(recentInstance!, [{ transcript: "hello", isFinal: false }]);
    expect(current.result.current.interimTranscript).toBe("hello");
    expect(current.result.current.transcript).toBe("");
  });

  it("commits a final result into transcript", () => {
    fireResult(recentInstance!, [{ transcript: "remember blue", isFinal: true }]);
    expect(current.result.current.transcript).toBe("remember blue");
    expect(current.result.current.interimTranscript).toBe("");
  });

  it("appends multiple final results with a space", () => {
    fireResult(recentInstance!, [{ transcript: "remember blue", isFinal: true }]);
    fireResult(recentInstance!, [{ transcript: "is my favorite", isFinal: true }]);
    expect(current.result.current.transcript).toBe(
      "remember blue is my favorite"
    );
  });

  it("clears interim when a final result arrives", () => {
    fireResult(recentInstance!, [{ transcript: "hello", isFinal: false }]);
    fireResult(recentInstance!, [{ transcript: "hello there", isFinal: true }]);
    expect(current.result.current.interimTranscript).toBe("");
    expect(current.result.current.transcript).toBe("hello there");
  });
});

describe("useSpeechRecognition — errors", () => {
  beforeEach(() => {
    stubSupported();
  });

  it("handles no-speech", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    fireError(recentInstance!, "no-speech");
    expect(current.result.current.error).toBe(
      "No speech was detected. Please try again."
    );
    expect(current.result.current.isListening).toBe(false);
  });

  it("handles audio-capture", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    fireError(recentInstance!, "audio-capture");
    expect(current.result.current.error).toBe(
      "No microphone was found. Please check your audio input."
    );
  });

  it("handles not-allowed", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    fireError(recentInstance!, "not-allowed");
    expect(current.result.current.error).toContain("Microphone access was denied");
  });

  it("handles network", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    fireError(recentInstance!, "network");
    expect(current.result.current.error).toContain("internet connection");
  });

  it("handles aborted", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    fireError(recentInstance!, "aborted");
    expect(current.result.current.error).toContain("aborted");
  });

  it("falls back to a generic message for unknown errors", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    fireError(recentInstance!, "some-unknown-error");
    expect(current.result.current.error).toBe(
      "Speech recognition error: some-unknown-error"
    );
  });
});

describe("useSpeechRecognition — reset", () => {
  beforeEach(() => {
    stubSupported();
    render();
    act(() => {
      current.result.current.start();
    });
    recentInstance = MockSpeechRecognition.instances.at(-1) ?? null;
    fireStart(recentInstance!);
    fireResult(recentInstance!, [{ transcript: "remember blue", isFinal: true }]);
  });

  it("clears transcript, interim, and error", () => {
    fireError(recentInstance!, "no-speech");
    expect(current.result.current.error).not.toBeNull();

    act(() => {
      current.result.current.reset();
    });
    expect(current.result.current.transcript).toBe("");
    expect(current.result.current.interimTranscript).toBe("");
    expect(current.result.current.error).toBeNull();
    expect(current.result.current.isListening).toBe(false);
  });

  it("aborts any active recognition on reset", () => {
    act(() => {
      current.result.current.reset();
    });
    expect(recentInstance!.abortCalls).toBe(1);
  });
});