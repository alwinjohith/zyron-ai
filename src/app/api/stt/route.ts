import { NextResponse } from "next/server";

// Local whisper-server (see README). Override with WHISPER_SERVER_URL.
const WHISPER_SERVER_URL = (
  process.env.WHISPER_SERVER_URL || "http://127.0.0.1:8080"
).replace(/\/+$/, "");

// A generous ceiling for a single recorded clip.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Invalid upload. Expected multipart/form-data." },
        { status: 400 }
      );
    }

    const entry = form.get("file");
    const isFile =
      (typeof File !== "undefined" && entry instanceof File) ||
      (typeof entry === "object" && entry !== null && "arrayBuffer" in entry);
    if (!isFile) {
      return NextResponse.json(
        { error: "Missing audio upload. Field 'file' is required." },
        { status: 400 }
      );
    }

    const file = entry as File;
    if (file.size === 0) {
      return NextResponse.json(
        { error: "No speech was detected. Please try again." },
        { status: 400 }
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "The recording is too large. Please record a shorter message." },
        { status: 413 }
      );
    }

    // Forward the clip to the already-running whisper-server. The audio is
    // kept only in memory for the duration of this request.
    const upstreamForm = new FormData();
    upstreamForm.append(
      "file",
      new File([await file.arrayBuffer()], "recording", {
        type: file.type || "application/octet-stream",
      })
    );
    upstreamForm.append("response_format", "json");
    upstreamForm.append("language", "en");
    upstreamForm.append("temperature", "0.0");
    upstreamForm.append("no_timestamps", "true");

    let upstream: Response;
    try {
      upstream = await fetch(`${WHISPER_SERVER_URL}/inference`, {
        method: "POST",
        body: upstreamForm,
      });
    } catch {
      return NextResponse.json(
        {
          error:
            "The local speech-to-text service is unavailable. Make sure whisper-server is running.",
        },
        { status: 503 }
      );
    }

    if (!upstream.ok) {
      let detail = "";
      try {
        const data = await upstream.json();
        if (typeof data?.error === "string") detail = data.error;
      } catch {
        // non-JSON error body
      }
      console.error("Whisper server error:", upstream.status, detail);
      return NextResponse.json(
        { error: "Transcription failed. Please try again." },
        { status: 502 }
      );
    }

    const data = await upstream.json();
    const text = typeof data?.text === "string" ? data.text.trim() : "";

    return NextResponse.json({ text });
  } catch (error) {
    console.error("STT API error:", error);
    return NextResponse.json(
      { error: "Something went wrong while processing your recording." },
      { status: 500 }
    );
  }
}