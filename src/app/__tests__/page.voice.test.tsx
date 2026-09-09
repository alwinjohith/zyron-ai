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