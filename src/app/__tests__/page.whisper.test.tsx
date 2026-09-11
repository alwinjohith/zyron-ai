// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ChatPage from "@/app/page";

type Handler = ((event?: unknown) => void) | null;

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];
  onstart: Handler = null;
  onend: Handler = null;
  onerror: Handler = null;
  onresult: Handler = null;
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
    this.onend?.();
  }
  abort(): void {
    this.abortCalls++;
  }
}

type Listener = (event?: unknown) => void;

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);

  mimeType: string;
  state = "recording";
  startCalls = 0;
  stopCalls = 0;
  private listeners: Record<string, Listener[]> = {};

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
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

interface MockSpeechSynth {
  speaking: boolean;
  paused: boolean;
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
}

function makeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sttSuccess(text: string): () => Promise<Response> {
  return async () => jsonResponse({ text });
}

function ollamaResponse(content: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

let root: Root;
let container: HTMLDivElement;
let getUserMediaMock: ReturnType<typeof vi.fn>;
let speechSynth: MockSpeechSynth;

function renderPage() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(ChatPage));
  });
}

function unmount() {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function micIdle(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[aria-label="Speak your message"]');
}

function micStop(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[aria-label="Stop listening"]');
}

function inputEl(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[type="text"]')!;
}

function sendBtn(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
}

function statusTexts(): string[] {
  return Array.from(container.querySelectorAll("[role='status']")).map(
    (el) => el.textContent ?? ""
  );
}

function typeInComposer(text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!;
    setter.call(inputEl(), text);
    inputEl().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function micButtons(): number {
  return container.querySelectorAll<HTMLButtonElement>(
    '[aria-label="Speak your message"], [aria-label="Stop listening"]'
  ).length;
}

async function flushAsync() {
  await act(async () => {});
  await act(async () => {});
  await act(async () => {});
}

async function recordOneClip(): Promise<MockMediaRecorder> {
  await act(async () => {
    micIdle()!.click();
  });
  const recorder = MockMediaRecorder.instances.at(-1)!;
  await act(async () => {
    micStop()!.click();
  });
  recorder.fire("dataavailable", { data: new Blob(["x"]) });
  recorder.fire("stop");
  await flushAsync();
  return recorder;
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  MockSpeechRecognition.instances = [];
  MockMediaRecorder.instances = [];
  MockMediaRecorder.isTypeSupported = vi.fn(() => true);
  getUserMediaMock = vi.fn(async () => makeStream());
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: getUserMediaMock },
  });
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
});

describe("ChatPage — local Whisper fallback (Firefox)", () => {
  it("shows the mic button when Web Speech is unsupported but Whisper is available", async () => {
    renderPage();
    expect(micIdle()).not.toBeNull();
    expect(micButtons()).toBe(1);

    await act(async () => {
      micIdle()!.click();
    });
    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(micStop()).not.toBeNull();
    expect(micIdle()).toBeNull();
    expect(statusTexts().some((t) => t.includes("Listening"))).toBe(true);
  });

  it("still uses the Web Speech API when it is supported (no duplicate mic buttons)", async () => {
    vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockSpeechRecognition);
    renderPage();
    expect(micButtons()).toBe(1);

    await act(async () => {
      micIdle()!.click();
    });
    expect(MockSpeechRecognition.instances).toHaveLength(1);
    expect(getUserMediaMock).not.toHaveBeenCalled();
    expect(MockMediaRecorder.instances).toHaveLength(0);
  });

  it("fills the composer with the recognized text after transcription, without auto-sending", async () => {
    vi.stubGlobal("fetch", vi.fn(sttSuccess("remember that I like Java")));
    renderPage();
    expect(container.textContent).toContain("Hello!");

    await act(async () => {
      micIdle()!.click();
    });
    const recorder = MockMediaRecorder.instances.at(-1)!;
    await act(async () => {
      micStop()!.click();
    });
    // Non-streaming Whisper: transcription runs after recording stops.
    expect(statusTexts().some((t) => t === "Transcribing…")).toBe(true);

    recorder.fire("dataavailable", { data: new Blob(["x"]) });
    recorder.fire("stop");
    await flushAsync();

    expect(inputEl().value).toBe("remember that I like Java");
    // Nothing was sent: the welcome screen is still shown and the transcript
    // lives only in the editable composer.
    expect(container.textContent).toContain("Hello!");
    expect(statusTexts().some((t) => t.includes("remember that I like Java"))).toBe(
      false
    );
  });

  it("preserves typed prefix text when Whisper text arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(sttSuccess("blue")));
    renderPage();
    typeInComposer("draft:");

    await act(async () => {
      micIdle()!.click();
    });
    expect(inputEl().value).toBe("draft:");

    const recorder = MockMediaRecorder.instances.at(-1)!;
    await act(async () => {
      micStop()!.click();
    });
    recorder.fire("dataavailable", { data: new Blob(["x"]) });
    recorder.fire("stop");
    await flushAsync();

    expect(inputEl().value).toBe("draft: blue");
  });

  it("sends the recognized Whisper text through the existing /api/chat path", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/chat") return ollamaResponse("Got it!");
      return jsonResponse({ text: "remember that I like Java" });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await recordOneClip();
    expect(inputEl().value).toBe("remember that I like Java");

    await act(async () => {
      sendBtn().click();
    });
    await flushAsync();

    const chatCalls = fetchMock.mock.calls.filter((c) => c[0] === "/api/chat") as unknown[][];
    expect(chatCalls).toHaveLength(1);
    const body = JSON.parse((chatCalls[0][1] as { body: string }).body);
    expect(body.messages.at(-1).content).toBe("remember that I like Java");
    expect(container.textContent).toContain("Got it!");
  });

  it("shows a friendly voice error and recovers when transcription fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          jsonResponse({ error: "Transcription failed. Please try again." }, 502)
      )
    );
    renderPage();

    await act(async () => {
      micIdle()!.click();
    });
    const recorder = MockMediaRecorder.instances.at(-1)!;
    await act(async () => {
      micStop()!.click();
    });
    recorder.fire("dataavailable", { data: new Blob(["x"]) });
    recorder.fire("stop");
    await flushAsync();

    expect(statusTexts().some((t) => t.includes("Transcription failed"))).toBe(
      true
    );
    expect(inputEl().value).toBe("");
    expect(micIdle()).not.toBeNull();
  });
});

describe("ChatPage — Whisper + text-to-speech", () => {
  beforeEach(() => {
    MockUtterance.all = [];
    speechSynth = {
      speaking: false,
      paused: false,
      speak: vi.fn(),
      cancel: vi.fn(),
      resume: vi.fn(),
    };
    vi.stubGlobal("speechSynthesis", speechSynth);
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
  });

  function spokenTexts(): string[] {
    return speechSynth.speak.mock.calls.map(
      (call) => (call[0] as MockUtterance).text
    );
  }

  it("speaks the reply after a Whisper submission (TTS unchanged)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/chat") return ollamaResponse("Dragoons it is!");
      return jsonResponse({ text: "surprise me" });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await recordOneClip();
    expect(inputEl().value).toBe("surprise me");

    await act(async () => {
      sendBtn().click();
    });
    await flushAsync();

    expect(speechSynth.speak).toHaveBeenCalledTimes(1);
    expect(spokenTexts()).toEqual(["Dragoons it is!"]);
  });

  it("never speaks the user's Whisper transcript", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/chat") return ollamaResponse("Hey there!");
      return jsonResponse({ text: "surprise me" });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await recordOneClip();
    await act(async () => {
      sendBtn().click();
    });
    await flushAsync();

    expect(
      speechSynth.speak.mock.calls.every(
        (call) => (call[0] as MockUtterance).text !== "surprise me"
      )
    ).toBe(true);
  });
});