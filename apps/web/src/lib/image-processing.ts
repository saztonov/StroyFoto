import {
  ABSOLUTE_MAX_PHOTO_BYTES,
  IMAGE_MAX_DIMENSION,
  IMAGE_QUALITY_MAX,
  IMAGE_QUALITY_MIN,
  IMAGE_QUALITY_STEP,
  TARGET_PHOTO_SIZE_BYTES,
} from "@stroyfoto/shared";

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Canvas toBlob failed")),
      "image/jpeg",
      quality,
    );
  });
}

export async function compressImage(
  file: File | Blob,
  maxDimension = IMAGE_MAX_DIMENSION,
  targetSize = TARGET_PHOTO_SIZE_BYTES,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(
    maxDimension / bitmap.width,
    maxDimension / bitmap.height,
    1,
  );
  let w = Math.round(bitmap.width * scale);
  let h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Не удалось создать контекст canvas (недостаточно памяти)");
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let quality = IMAGE_QUALITY_MAX;
  let blob = await canvasToBlob(canvas, quality);

  while (blob.size > targetSize && quality > IMAGE_QUALITY_MIN) {
    quality -= IMAGE_QUALITY_STEP;
    quality = Math.max(quality, IMAGE_QUALITY_MIN);
    blob = await canvasToBlob(canvas, quality);
  }

  if (blob.size > ABSOLUTE_MAX_PHOTO_BYTES) {
    w = Math.round(w * 0.75);
    h = Math.round(h * 0.75);
    canvas.width = w;
    canvas.height = h;
    const bitmap2 = await createImageBitmap(file);
    const ctx2 = canvas.getContext("2d");
    if (!ctx2) {
      bitmap2.close();
      throw new Error("Не удалось создать контекст canvas (недостаточно памяти)");
    }
    ctx2.drawImage(bitmap2, 0, 0, w, h);
    bitmap2.close();
    blob = await canvasToBlob(canvas, IMAGE_QUALITY_MIN);
  }

  return blob;
}

export async function generateThumbnail(
  source: File | Blob,
  maxSize = 200,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);

  const scale = Math.min(maxSize / bitmap.width, maxSize / bitmap.height, 1);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Не удалось создать контекст canvas для превью");
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return canvasToBlob(canvas, 0.6);
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  // jsdom fallback: use FileReader
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export async function computeHash(blob: Blob): Promise<string> {
  const buffer = await blobToArrayBuffer(blob);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ProcessedPhotoResult {
  blob: Blob;
  thumbnail: Blob;
  size: number;
  hash: string;
  mimeType: string;
}

export async function processPhoto(file: File): Promise<ProcessedPhotoResult> {
  const blob = await compressImage(file);

  if (blob.size > ABSOLUTE_MAX_PHOTO_BYTES) {
    throw new Error(
      `Фото "${file.name}" слишком большое даже после сжатия`,
    );
  }

  const thumbnail = await generateThumbnail(blob);
  const hash = await computeHash(blob);

  return {
    blob,
    thumbnail,
    size: blob.size,
    hash,
    mimeType: "image/jpeg",
  };
}
