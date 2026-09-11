// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ChatPage from "@/app/page";

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
    // Simulate the browser firing onend after a manual stop.
    this.onend?.();
  }
  abort(): void {
    this.abortCalls++;
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

let speechSynth: MockSpeechSynth;

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

function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
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

function latestRecognition(): MockSpeechRecognition {
  return MockSpeechRecognition.instances.at(-1)!;
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

function clickMicWhileIdle() {
  act(() => {
    micIdle()!.click();
  });
}

function fireStart(recognition: MockSpeechRecognition) {
  act(() => {
    recognition.onstart?.();
  });
}

function fireResult(recognition: MockSpeechRecognition, items: ResultItem[]) {
  act(() => {
    recognition.onresult?.({
      results: buildResults(items),
      resultIndex: 0,
    });
  });
}

function fireError(recognition: MockSpeechRecognition, error: string) {
  act(() => {
    recognition.onerror?.({ error, message: "" });
  });
}

function typeInComposer(text: string) {
  act(() => {
    // Use the native value setter so React's controlled-input tracking
    // accepts the change, then dispatch the event React listens for.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!;
    setter.call(inputEl(), text);
    inputEl().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeAll(() => {
  // jsdom does not implement scrollIntoView; the page calls it on updates.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  MockSpeechRecognition.instances = [];
  vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);
  vi.stubGlobal("webkitSpeechRecognition", MockSpeechRecognition);
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe("ChatPage composer — voice microphone button", () => {
  it("renders the mic button next to the input and Send button when supported", () => {
    renderPage();
    expect(micIdle()).not.toBeNull();
    expect(micStop()).toBeNull();
    expect(inputEl()).not.toBeNull();
    expect(sendBtn()).not.toBeNull();
  });

  it("hides the mic button entirely when speech recognition is unsupported", () => {
    vi.unstubAllGlobals();
    renderPage();
    expect(micIdle()).toBeNull();
    expect(micStop()).toBeNull();
    // The rest of the composer still renders.
    expect(inputEl()).not.toBeNull();
    expect(sendBtn()).not.toBeNull();
  });

  it("starts recognition and shows a clear listening state on click", () => {
    renderPage();
    clickMicWhileIdle();

    expect(MockSpeechRecognition.instances).toHaveLength(1);
    fireStart(latestRecognition());
    expect(micStop()).not.toBeNull();
    expect(micIdle()).toBeNull();
    expect(micStop()!.getAttribute("aria-pressed")).toBe("true");
  });

  it("applies the listening status line below the composer", () => {
    renderPage();
    clickMicWhileIdle();
    fireStart(latestRecognition());
    expect(statusTexts().some((t) => t.includes("Listening"))).toBe(true);
  });

  it("clicking the mic again while listening stops recognition", () => {
    renderPage();
    clickMicWhileIdle();
    const recognition = latestRecognition();
    fireStart(recognition);

    act(() => {
      micStop()!.click();
    });

    expect(recognition.stopCalls).toBe(1);
    expect(micIdle()).not.toBeNull();
    expect(micStop()).toBeNull();
    expect(statusTexts().some((t) => t.includes("Listening"))).toBe(false);
  });
});

describe("ChatPage composer — live voice draft", () => {
  it("shows interim transcript in the input while preserving typed text", () => {
    renderPage();
    typeInComposer("draft:");
    clickMicWhileIdle();
    const recognition = latestRecognition();
    fireStart(recognition);

    fireResult(recognition, [{ transcript: "remember", isFinal: false }]);
    expect(inputEl().value).toBe("draft: remember");

    fireResult(recognition, [{ transcript: "remember blue", isFinal: false }]);
    expect(inputEl().value).toBe("draft: remember blue");
  });

  it("commits the final transcript to the input and keeps it after stopping", () => {
    renderPage();
    clickMicWhileIdle();
    const recognition = latestRecognition();
    fireStart(recognition);

    fireResult(recognition, [{ transcript: "remember that I like Java", isFinal: true }]);
    expect(inputEl().value).toBe("remember that I like Java");

    // Recognition ends on its own — the text stays in the composer to edit.
    act(() => {
      recognition.onend?.();
    });
    expect(inputEl().value).toBe("remember that I like Java");
    expect(micIdle()).not.toBeNull();
  });

  it("does not auto-send the recognized text", () => {
    renderPage();
    clickMicWhileIdle();
    const recognition = latestRecognition();
    fireStart(recognition);
    fireResult(recognition, [{ transcript: "hello zyron", isFinal: true }]);
    act(() => {
      recognition.onend?.();
    });

    // The welcome/suggestion screen is still showing -> nothing was sent.
    expect(container.textContent).toContain("Hello!");
    expect(statusTexts().some((t) => t.includes("hello zyron"))).toBe(false);
  });

  it("appends a second spoken segment to the same session", () => {
    renderPage();
    clickMicWhileIdle();
    const recognition = latestRecognition();
    fireStart(recognition);

    fireResult(recognition, [{ transcript: "remember blue", isFinal: true }]);
    fireResult(recognition, [{ transcript: "is my favorite", isFinal: true }]);
    expect(inputEl().value).toBe("remember blue is my favorite");
  });
});

describe("ChatPage composer — voice errors", () => {
  it("shows a friendly message for no-speech errors", () => {
    renderPage();
    clickMicWhileIdle();
    const recognition = latestRecognition();
    fireStart(recognition);

    fireError(recognition, "no-speech");
    expect(statusTexts().some((t) => t.includes("No speech was detected"))).toBe(
      true
    );
    expect(micIdle()).not.toBeNull();
  });

  it("shows a friendly message for microphone permission errors", () => {
    renderPage();
    clickMicWhileIdle();
    const recognition = latestRecognition();
    fireStart(recognition);

    fireError(recognition, "not-allowed");
    expect(
      statusTexts().some((t) => t.includes("Microphone access was denied"))
    ).toBe(true);
  });

  it("hides the error message once the recognition error clears", () => {
    renderPage();
    clickMicWhileIdle();
    const recognition = latestRecognition();
    fireStart(recognition);
    fireError(recognition, "no-speech");
    expect(statusTexts().some((t) => t.includes("No speech was detected"))).toBe(
      true
    );

    // A fresh session clears the previous error on start.
    clickMicWhileIdle();
    fireStart(latestRecognition());
    expect(statusTexts().some((t) => t.includes("No speech was detected"))).toBe(
      false
    );
  });
});

describe("ChatPage composer — text chat regression", () => {
  it("unsupported browsers still send typed text through the normal flow", async () => {
    vi.unstubAllGlobals();
    const fetchMock = vi.fn(
      async (_url: unknown, init?: { body?: string }) => {
        // Args are asserted directly via fetchMock.mock.calls below.
        void _url;
        void init;
        return ollamaResponse("Hey there!");
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    typeInComposer("hello zyron");
    await act(async () => {
      sendBtn().click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.messages.at(-1).content).toBe("hello zyron");
    await act(async () => {});
    expect(container.textContent).toContain("Hey there!");
  });
});

describe("ChatPage composer — text-to-speech", () => {
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

  async function sendTypedMessage(text: string) {
    typeInComposer(text);
    await act(async () => {
      sendBtn().click();
    });
    // Let the streaming reader and its chunk loop fully resolve.
    await act(async () => {});
    await act(async () => {});
  }

  it("speaks the completed streamed response exactly once", async () => {
    const fetchMock = vi.fn(async () => streamingResponse(["Hello ", "world!"]));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await sendTypedMessage("hello zyron");

    expect(speechSynth.speak).toHaveBeenCalledTimes(1);
    expect(spokenTexts()).toEqual(["Hello world!"]);
  });

  it("does not speak once per stream chunk", async () => {
    const fetchMock = vi.fn(async () => streamingResponse(["ch", "un", "ks"]));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await sendTypedMessage("hello zyron");

    expect(speechSynth.speak).toHaveBeenCalledTimes(1);
    expect(spokenTexts()).toEqual(["chunks"]);
    expect(container.textContent).toContain("chunks");
  });

  it("never speaks the user's message", async () => {
    const fetchMock = vi.fn(async () => ollamaResponse("Hey there!"));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await sendTypedMessage("hello zyron");

    expect(spokenTexts()).toEqual(["Hey there!"]);
    expect(
      speechSynth.speak.mock.calls.every(
        (call) => (call[0] as MockUtterance).text !== "hello zyron"
      )
    ).toBe(true);
  });

  it("does not speak an empty streamed response", async () => {
    const fetchMock = vi.fn(async () => streamingResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await sendTypedMessage("hello zyron");

    expect(speechSynth.speak).not.toHaveBeenCalled();
    expect(MockUtterance.all).toHaveLength(0);
  });

  it("speaks the non-streaming JSON assistant response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Got it, I've saved that." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await sendTypedMessage("remember that I like Java");

    expect(speechSynth.speak).toHaveBeenCalledTimes(1);
    expect(spokenTexts()).toEqual(["Got it, I've saved that."]);
  });

  it("never speaks a catch/error response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "boom" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await sendTypedMessage("hello zyron");

    expect(speechSynth.speak).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Sorry, I couldn't connect");
  });

  it("speaks the response after a voice (mic) submission", async () => {
    const fetchMock = vi.fn(async () => ollamaResponse("Dragoons it is!"));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    clickMicWhileIdle();
    const recognition = latestRecognition();
    fireStart(recognition);
    fireResult(recognition, [{ transcript: "surprise me", isFinal: true }]);

    await act(async () => {
      sendBtn().click();
    });
    await act(async () => {});
    await act(async () => {});

    expect(recognition.stopCalls).toBe(1);
    expect(speechSynth.speak).toHaveBeenCalledTimes(1);
    expect(spokenTexts()).toEqual(["Dragoons it is!"]);
  });

  it("cancels the previous utterance before speaking a new response", async () => {
    const fetchMock = vi.fn(async () => ollamaResponse("dragon fact"));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await sendTypedMessage("first question");
    const cancelsAfterFirst = speechSynth.cancel.mock.calls.length;
    expect(spokenTexts()).toEqual(["dragon fact"]);

    await sendTypedMessage("second question");

    expect(spokenTexts()).toEqual(["dragon fact", "dragon fact"]);
    expect(MockUtterance.all).toHaveLength(2);
    expect(speechSynth.cancel.mock.calls.length).toBeGreaterThan(cancelsAfterFirst);
  });
});

describe("ChatPage composer — Stage 4 speaking UX", () => {
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

  async function sendAndSpeak(content = "dragon fact") {
    const fetchMock = vi.fn(async () => ollamaResponse(content));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    typeInComposer("hello zyron");
    await act(async () => {
      sendBtn().click();
    });
    await act(async () => {});
    await act(async () => {});
    return MockUtterance.all.at(-1)!;
  }

  it("shows a speaking indicator while the utterance is active", async () => {
    const utterance = await sendAndSpeak();
    expect(statusTexts().some((t) => t.includes("Speaking"))).toBe(false);

    act(() => {
      utterance.onstart?.();
    });

    expect(statusTexts().some((t) => t.includes("Speaking"))).toBe(true);
  });

  it("hides the speaking indicator when the utterance ends naturally", async () => {
    const utterance = await sendAndSpeak();
    act(() => {
      utterance.onstart?.();
    });
    expect(statusTexts().some((t) => t.includes("Speaking"))).toBe(true);

    act(() => {
      utterance.onend?.();
    });
    expect(statusTexts().some((t) => t.includes("Speaking"))).toBe(false);
  });

  it("stops speaking when the stop control is clicked", async () => {
    const utterance = await sendAndSpeak();
    act(() => {
      utterance.onstart?.();
    });

    const stopBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="Stop speaking"]'
    );
    expect(stopBtn).not.toBeNull();

    const cancelsBefore = speechSynth.cancel.mock.calls.length;
    act(() => {
      stopBtn!.click();
    });

    expect(speechSynth.cancel.mock.calls.length).toBeGreaterThan(cancelsBefore);
    expect(statusTexts().some((t) => t.includes("Speaking"))).toBe(false);
  });

  it("cancels current speech before starting mic recognition", async () => {
    const utterance = await sendAndSpeak();
    act(() => {
      utterance.onstart?.();
    });

    const cancelsBefore = speechSynth.cancel.mock.calls.length;
    act(() => {
      micIdle()!.click();
    });

    expect(speechSynth.cancel.mock.calls.length).toBeGreaterThan(cancelsBefore);

    fireStart(latestRecognition());
    expect(micStop()).not.toBeNull();
  });

  it("cancels speech when the page becomes hidden", async () => {
    const utterance = await sendAndSpeak();
    act(() => {
      utterance.onstart?.();
    });

    const cancelsBefore = speechSynth.cancel.mock.calls.length;
    const originalHidden = document.hidden;

    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(speechSynth.cancel.mock.calls.length).toBeGreaterThan(cancelsBefore);
    expect(statusTexts().some((t) => t.includes("Speaking"))).toBe(false);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: originalHidden,
    });
  });

  it("shows a friendly message when speech synthesis fails", async () => {
    const utterance = await sendAndSpeak();
    act(() => {
      utterance.onerror?.({ error: "interrupted" });
    });

    expect(
      statusTexts().some((t) =>
        t.includes("Zyron couldn't speak this response")
      )
    ).toBe(true);
  });

  it("degrades gracefully when speech synthesis is unsupported", async () => {
    vi.unstubAllGlobals();
    const fetchMock = vi.fn(async () => ollamaResponse("Still works in text."));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    typeInComposer("hello zyron");
    await act(async () => {
      sendBtn().click();
    });
    await act(async () => {});
    await act(async () => {});

    expect(container.textContent).toContain("Still works in text.");
    expect(
      statusTexts().some((t) => t.includes("Voice output is unavailable"))
    ).toBe(true);
    // No broken speaking control is rendered.
    expect(
      container.querySelector('[aria-label="Stop speaking"]')
    ).toBeNull();
  });

  it("keeps existing microphone start/stop behavior", () => {
    renderPage();
    clickMicWhileIdle();
    const recognition = latestRecognition();
    fireStart(recognition);
    expect(micStop()).not.toBeNull();

    act(() => {
      micStop()!.click();
    });
    expect(recognition.stopCalls).toBe(1);
    expect(micIdle()).not.toBeNull();
  });

  it("keeps existing text-only chat behavior", async () => {
    const fetchMock = vi.fn(async () => ollamaResponse("Text-only reply"));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    typeInComposer("plain text");
    await act(async () => {
      sendBtn().click();
    });
    await act(async () => {});
    await act(async () => {});

    expect(container.textContent).toContain("Text-only reply");
    expect(speechSynth.speak).toHaveBeenCalledTimes(1);
  });

  it("keeps listening indicators visible with reduced-motion in mind", () => {
    renderPage();
    clickMicWhileIdle();
    fireStart(latestRecognition());

    // The animated decorations remain targets for the reduced-motion override,
    // while the static status text keeps the state visible for all users.
    expect(container.querySelector(".animate-ping")).not.toBeNull();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(statusTexts().some((t) => t.includes("Listening"))).toBe(true);
  });
});