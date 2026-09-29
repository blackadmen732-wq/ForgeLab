/**
 * Client-side image preparation: images are resized and re-encoded before upload so the
 * storage buckets' size limits are met and no EXIF metadata (GPS...) leaves the browser.
 */
export async function resizeImage(
  source: Blob | HTMLCanvasElement,
  maxWidth: number,
  maxHeight: number,
  { square = false, quality = 0.85 }: { square?: boolean; quality?: number } = {},
): Promise<Blob> {
  const bitmap = source instanceof HTMLCanvasElement ? source : await createImageBitmap(source);
  const sw = bitmap.width;
  const sh = bitmap.height;
  let sx = 0;
  let sy = 0;
  let cw = sw;
  let ch = sh;
  if (square) {
    const side = Math.min(sw, sh);
    sx = (sw - side) / 2;
    sy = (sh - side) / 2;
    cw = side;
    ch = side;
  }
  const scale = Math.min(1, maxWidth / cw, maxHeight / ch);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cw * scale));
  canvas.height = Math.max(1, Math.round(ch * scale));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("This browser cannot process images.");
  context.drawImage(bitmap, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
  if ("close" in bitmap) bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality),
  );
  if (blob !== null && blob.type === "image/webp") return blob;
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (jpeg === null) throw new Error("This browser could not encode the image.");
  return jpeg;
}
