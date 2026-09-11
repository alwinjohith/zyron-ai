// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { useWhisperRecognition } from "@/hooks/useWhisperRecognition";
import { renderHook } from "./renderHook";

type Listener = (event?: unknown) => void;

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported: ReturnType<typeof vi.fn> = vi.fn(() => true);

  mimeType: string;
  state = "recording";
  startCalls = 0;
  stopCalls = 0;
  stream: MediaStream;
  private listeners: Record<string, Listener[]> = {};

  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? "";
    MockMediaRecorder.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }

  start(): void {
    this.startCalls++;
    this.state = "recording";
  }

  stop(): void {
    this.stopCalls++;
    this.state = "inactive";
  }

  fire(type: string, event?: unknown): void {
    (this.listeners[type] ?? []).forEach((listener) => listener(event));
  }
}

function makeStream(): {
  stream: MediaStream;
  stopTrack: ReturnType<typeof vi.fn>;
} {
  const stopTrack = vi.fn();
  const stream = {
    getTracks: () => [{ stop: stopTrack }],
  } as unknown as MediaStream;
  return { stream, stopTrack };
}

let getUserMediaMock: ReturnType<typeof vi.fn>;
let current: {
  result: { current: ReturnType<typeof useWhisperRecognition> };
  unmount: () => void;
};

function setUserMedia(mock: ReturnType<typeof vi.fn>) {
  getUserMediaMock = mock;
  if (navigator.mediaDevices) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator.mediaDevices as any).getUserMedia = mock;
  }
}

function stubWhisperSupport() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {},
  });
  setUserMedia(vi.fn(async () => makeStream().stream));
  MockMediaRecorder.instances = [];
  MockMediaRecorder.isTypeSupported = vi.fn(() => true);
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
}

beforeEach(() => {
  current = null as never;
});

afterEach(() => {
  current?.unmount();
  current = null as never;
  vi.unstubAllGlobals();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
});

function render() {
  current = renderHook(useWhisperRecognition);
}

async function finishRecording(recorder: MockMediaRecorder, chunk: Blob) {
  act(() => {
    recorder.fire("dataavailable", { data: chunk });
    recorder.fire("stop");
  });
  await act(async () => {});
  await act(async () => {});
  await act(async () => {});
}

function sttResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useWhisperRecognition — browser support", () => {
  it("reports isSupported=false when mediaDevices and MediaRecorder are missing", () => {
    render();
    expect(current.result.current.isSupported).toBe(false);
  });

  it("reports isSupported=true when mediaDevices and MediaRecorder exist", () => {
    stubWhisperSupport();
    render();
    expect(current.result.current.isSupported).toBe(true);
  });

  it("start() on an unsupported browser sets an error and requests no mic", () => {
    render();
    act(() => {
      current.result.current.start();
    });
    expect(current.result.current.error).toBe(
      "Voice input is not supported in this browser."
    );
    expect(getUserMediaMock ?? vi.fn()).not.toHaveBeenCalled();
  });
});

describe("useWhisperRecognition — microphone lifecycle", () => {
  beforeEach(() => {
    stubWhisperSupport();
  });

  it("requests microphone permission only when start() is called", () => {
    render();
    expect(getUserMediaMock).not.toHaveBeenCalled();
    act(() => {
      current.result.current.start();
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
  });

  it("moves to listening while recording", async () => {
    render();
    await act(async () => {
      current.result.current.start();
    });
    expect(current.result.current.isListening).toBe(true);
    expect(current.result.current.isProcessing).toBe(false);
    expect(MockMediaRecorder.instances.at(-1)!.startCalls).toBe(1);
  });

  it("prevents duplicate start() while already starting/recording", async () => {
    render();
    await act(async () => {
      current.result.current.start();
      current.result.current.start();
      current.result.current.start();
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(MockMediaRecorder.instances).toHaveLength(1);
  });

  it("stop() ends the recording", async () => {
    render();
    await act(async () => {
      current.result.current.start();
    });
    const recorder = MockMediaRecorder.instances.at(-1)!;
    act(() => {
      current.result.current.stop();
    });
    expect(recorder.stopCalls).toBe(1);
    expect(current.result.current.isListening).toBe(false);
  });

  it("stop() before the mic resolves cancels the pending session", async () => {
    let resolveMic!: (stream: MediaStream) => void;
    setUserMedia(
      vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolveMic = resolve;
          })
      )
    );
    render();
    act(() => {
      current.result.current.start();
    });
    expect(current.result.current.isListening).toBe(true);

    act(() => {
      current.result.current.stop();
    });
    expect(current.result.current.isListening).toBe(false);

    const { stream, stopTrack } = makeStream();
    await act(async () => {
      resolveMic(stream);
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(MockMediaRecorder.instances).toHaveLength(0);
  });

  it("stops the media stream tracks once recording completes", async () => {
    const { stream, stopTrack } = makeStream();
    setUserMedia(vi.fn(async () => stream));
    render();
    await act(async () => {
      current.result.current.start();
    });
    const recorder = MockMediaRecorder.instances.at(-1)!;
    act(() => {
      current.result.current.stop();
    });
    recorder.fire("dataavailable", { data: new Blob(["x"]) });
    recorder.fire("stop");
    await act(async () => {});
    expect(stopTrack).toHaveBeenCalled();
  });

  it("cleans up the microphone on unmount", async () => {
    const { stream, stopTrack } = makeStream();
    setUserMedia(vi.fn(async () => stream));
    render();
    await act(async () => {
      current.result.current.start();
    });
    current.unmount();
    current = null as never;
    expect(stopTrack).toHaveBeenCalled();
  });
});

describe("useWhisperRecognition — MIME type selection", () => {
  beforeEach(() => {
    stubWhisperSupport();
  });

  it("prefers audio/ogg;codecs=opus when the browser supports it", async () => {
    render();
    await act(async () => {
      current.result.current.start();
    });
    expect(MockMediaRecorder.instances.at(-1)!.mimeType).toBe(
      "audio/ogg;codecs=opus"
    );
  });

  it("falls back to the first supported audio MIME type", async () => {
    MockMediaRecorder.isTypeSupported = vi.fn(
      (type: string) => type === "audio/webm"
    ) as unknown as ReturnType<typeof vi.fn>;
    render();
    await act(async () => {
      current.result.current.start();
    });
    expect(MockMediaRecorder.instances.at(-1)!.mimeType).toBe("audio/webm");
  });
});

describe("useWhisperRecognition — transcription", () => {
  beforeEach(() => {
    stubWhisperSupport();
  });

  it("uploads the finished clip to /api/stt and returns the transcript", async () => {
    const fetchMock = vi.fn(async () => sttResponse({ text: "  hello world  " }));
    vi.stubGlobal("fetch", fetchMock);
    render();
    await act(async () => {
      current.result.current.start();
    });
    const recorder = MockMediaRecorder.instances.at(-1)!;

    act(() => {
      current.result.current.stop();
    });
    expect(current.result.current.isProcessing).toBe(true);

    await finishRecording(recorder, new Blob(["x"], { type: "audio/ogg" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown[][];
    const [url, init] = calls[0];
    expect(url).toBe("/api/stt");
    expect((init as { method?: string }).method).toBe("POST");
    const body = (init as { body?: FormData }).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("file")).toBeTruthy();

    expect(current.result.current.transcript).toBe("hello world");
    expect(current.result.current.isProcessing).toBe(false);
    expect(current.result.current.isListening).toBe(false);
  });

  it("keeps interimTranscript empty during recording", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sttResponse({ text: "hi" })));
    render();
    await act(async () => {
      current.result.current.start();
    });
    expect(current.result.current.interimTranscript).toBe("");
  });

  it("treats an empty transcript as no speech", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sttResponse({ text: "   " })));
    render();
    await act(async () => {
      current.result.current.start();
    });
    const recorder = MockMediaRecorder.instances.at(-1)!;
    act(() => {
      current.result.current.stop();
    });
    await finishRecording(recorder, new Blob(["x"]));
    expect(current.result.current.transcript).toBe("");
    expect(current.result.current.error).toBe(
      "No speech was detected. Please try again."
    );
  });

  it("surfaces the server error when transcription fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sttResponse({ error: "Transcription failed. Please try again." }, 502)
      )
    );
    render();
    await act(async () => {
      current.result.current.start();
    });
    const recorder = MockMediaRecorder.instances.at(-1)!;
    act(() => {
      current.result.current.stop();
    });
    await finishRecording(recorder, new Blob(["x"]));
    expect(current.result.current.error).toBe(
      "Transcription failed. Please try again."
    );
    expect(current.result.current.isProcessing).toBe(false);
  });

  it("handles network errors while contacting /api/stt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    render();
    await act(async () => {
      current.result.current.start();
    });
    const recorder = MockMediaRecorder.instances.at(-1)!;
    act(() => {
      current.result.current.stop();
    });
    await finishRecording(recorder, new Blob(["x"]));
    expect(current.result.current.error).toBe(
      "Couldn't reach the local speech-to-text service. Please try again."
    );
  });
});

describe("useWhisperRecognition — errors and reset", () => {
  beforeEach(() => {
    stubWhisperSupport();
  });

  it("shows a friendly message when microphone permission is denied", async () => {
    setUserMedia(
      vi.fn(async () => {
        const error = new Error("denied") as Error & { name: string };
        error.name = "NotAllowedError";
        throw error;
      })
    );
    render();
    await act(async () => {
      current.result.current.start();
    });
    expect(current.result.current.isListening).toBe(false);
    expect(current.result.current.error).toContain("Microphone access was denied");
    expect(MockMediaRecorder.instances).toHaveLength(0);
  });

  it("shows a friendly message when no microphone is found", async () => {
    setUserMedia(
      vi.fn(async () => {
        const error = new Error("missing") as Error & { name: string };
        error.name = "NotFoundError";
        throw error;
      })
    );
    render();
    await act(async () => {
      current.result.current.start();
    });
    expect(current.result.current.error).toContain("No microphone was found");
  });

  it("reset() clears transcript, interim, error, and any active session", async () => {
    render();
    await act(async () => {
      current.result.current.start();
    });
    const recorder = MockMediaRecorder.instances.at(-1)!;
    act(() => {
      current.result.current.reset();
    });
    expect(recorder.stopCalls).toBe(1);
    expect(current.result.current.transcript).toBe("");
    expect(current.result.current.interimTranscript).toBe("");
    expect(current.result.current.error).toBeNull();
    expect(current.result.current.isListening).toBe(false);
    expect(current.result.current.isProcessing).toBe(false);
  });
});