// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { POST } from "@/app/api/stt/route";

function audioFile(
  bytes: number,
  name = "recording.ogg",
  type = "audio/ogg;codecs=opus"
): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function buildRequest(file: File | null): Request {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/stt", {
    method: "POST",
    body: form,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/stt — transcription", () => {
  it("forwards the clip to the local whisper-server and returns a clean transcript", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: "  hello world  " }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(buildRequest(audioFile(2048)));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "hello world" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown[][];
    const [url, init] = calls[0];
    expect(url).toBe("http://127.0.0.1:8080/inference");
    expect((init as { method?: string }).method).toBe("POST");
    const body = (init as { body?: FormData }).body as FormData;
    expect(body.get("file")).toBeInstanceOf(File);
    expect(body.get("response_format")).toBe("json");
    expect(body.get("language")).toBe("en");
    expect(body.get("temperature")).toBe("0.0");
    expect(body.get("no_timestamps")).toBe("true");
  });

  it("reads WHISPER_SERVER_URL from the environment", async () => {
    vi.stubEnv("WHISPER_SERVER_URL", "http://127.0.0.1:9999");
    vi.resetModules();
    const mod = await import("@/app/api/stt/route");
    const fetchMock = vi.fn(async () => jsonResponse({ text: "x" }));
    vi.stubGlobal("fetch", fetchMock);

    await mod.POST(buildRequest(audioFile(1024)));

    const calls = fetchMock.mock.calls as unknown[][];
    expect(calls[0][0]).toBe("http://127.0.0.1:9999/inference");
  });
});

describe("POST /api/stt — invalid uploads", () => {
  it("rejects a missing file field", async () => {
    const res = await POST(buildRequest(null));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Missing audio upload");
  });

  it("rejects an empty file", async () => {
    const res = await POST(buildRequest(audioFile(0)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No speech was detected");
  });

  it("rejects an oversized file", async () => {
    const res = await POST(buildRequest(audioFile(11 * 1024 * 1024)));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain("too large");
  });

  it("does not contact the whisper-server on invalid uploads", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await POST(buildRequest(null));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/stt — whisper-server failures", () => {
  it("returns 503 when the local whisper-server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("ECONNREFUSED");
      })
    );

    const res = await POST(buildRequest(audioFile(2048)));

    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("whisper-server");
  });

  it("returns 502 when the whisper-server reports a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "failed to process audio" }, 500))
    );

    const res = await POST(buildRequest(audioFile(2048)));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Transcription failed");
  });
});