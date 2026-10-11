/**
 * Records the 3D view as a short video clip (WebM) in the browser, for sharing a failure.
 * The clip is made on the player's machine and downloaded; nothing is uploaded. Only the
 * canvas is recorded — never the microphone, the page or other tabs.
 */
export interface ClipRecorder {
  /** Stops recording and resolves with the clip (null if the browser produced nothing). */
  stop(): Promise<Blob | null>;
}

export function clipRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "captureStream" in HTMLCanvasElement.prototype
  );
}

function pickMimeType(): string {
  for (const type of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"])
    if (MediaRecorder.isTypeSupported(type)) return type;
  return "";
}

/** Starts recording `canvas` at up to 30 frames/s; stops itself after `maxSec`. */
export function recordCanvas(canvas: HTMLCanvasElement, maxSec = 30): ClipRecorder {
  const stream = canvas.captureStream(30);
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType === "" ? {} : { mimeType }),
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const done = new Promise<Blob | null>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(chunks.length > 0 ? new Blob(chunks, { type: mimeType || "video/webm" }) : null);
    };
  });
  recorder.start(250);
  const timer = window.setTimeout(
    () => recorder.state !== "inactive" && recorder.stop(),
    maxSec * 1000,
  );
  return {
    stop() {
      window.clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
      return done;
    },
  };
}
