export async function compressImage(
  file: File | Blob,
  maxWidth = 1920,
  quality = 0.8,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const isJpeg = file.type === "image/jpeg";
  if (bitmap.width <= maxWidth && isJpeg) {
    bitmap.close();
    return file;
  }

  const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      "image/jpeg",
      quality,
    );
  });
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

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      "image/jpeg",
      0.6,
    );
  });
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

import { MAX_FILE_SIZE_BYTES } from "@stroyfoto/shared";

export async function processPhoto(file: File): Promise<ProcessedPhotoResult> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Файл "${file.name}" слишком большой (${sizeMb} МБ, максимум 15 МБ)`,
    );
  }

  const blob = await compressImage(file);

  if (blob.size > MAX_FILE_SIZE_BYTES) {
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
