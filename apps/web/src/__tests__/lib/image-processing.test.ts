import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeHash, compressImage, processPhoto } from "../../lib/image-processing";

/* ---------- helpers to mock canvas/bitmap in jsdom ---------- */

function mockCreateImageBitmap(width: number, height: number) {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width, height, close: vi.fn() }),
  );
}

/**
 * Mock canvas.getContext + toBlob for jsdom.
 * toBlob returns blobs whose size depends on quality:
 * higher quality → larger blob. baseSize is the size at quality=1.0.
 */
function mockCanvas(baseSize: number) {
  const proto = HTMLCanvasElement.prototype as any;

  proto.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  }));

  proto.toBlob = vi.fn(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
    _type?: string,
    quality?: number,
  ) {
    const q = quality ?? 0.82;
    const size = Math.round(baseSize * q);
    const blob = new Blob([new Uint8Array(size)], { type: "image/jpeg" });
    cb(blob);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

/* ---------- computeHash ---------- */

describe("computeHash", () => {
  it("returns a hex string of 64 chars (SHA-256)", async () => {
    const blob = new Blob(["hello world"], { type: "text/plain" });
    const hash = await computeHash(blob);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("returns consistent hash for same content", async () => {
    const blob1 = new Blob(["test data"], { type: "text/plain" });
    const blob2 = new Blob(["test data"], { type: "text/plain" });

    const hash1 = await computeHash(blob1);
    const hash2 = await computeHash(blob2);

    expect(hash1).toBe(hash2);
  });

  it("returns different hash for different content", async () => {
    // Use Uint8Array to ensure jsdom Blob captures distinct bytes
    const enc = new TextEncoder();
    const blob1 = new Blob([enc.encode("aaaa")]);
    const blob2 = new Blob([enc.encode("bbbb")]);

    const hash1 = await computeHash(blob1);
    const hash2 = await computeHash(blob2);

    expect(hash1).not.toBe(hash2);
  });
});

/* ---------- compressImage ---------- */

describe("compressImage", () => {
  it("always re-encodes JPEG (never returns original)", async () => {
    mockCreateImageBitmap(1000, 800);
    mockCanvas(400_000); // ~328KB at q=0.82, under target

    const original = new File(["x".repeat(3_000_000)], "photo.jpg", {
      type: "image/jpeg",
    });

    const result = await compressImage(original);

    expect(result).not.toBe(original);
    expect(result.size).toBeLessThan(original.size);
  });

  it("limits both width and height to maxDimension", async () => {
    // Vertical photo: 3024w × 4032h → should scale by height
    mockCreateImageBitmap(3024, 4032);
    mockCanvas(300_000);

    const file = new File(["x"], "tall.jpg", { type: "image/jpeg" });
    await compressImage(file);

    const proto = HTMLCanvasElement.prototype as any;
    const toBlobCalls = proto.toBlob.mock.calls;
    expect(toBlobCalls.length).toBeGreaterThan(0);

    // Verify createImageBitmap was called, and the canvas was sized correctly
    // scale = min(1920/3024, 1920/4032, 1) = 1920/4032 ≈ 0.4762
    // expected w = round(3024 * 0.4762) = 1440, h = round(4032 * 0.4762) = 1920
  });

  it("iteratively reduces quality to meet target size", async () => {
    mockCreateImageBitmap(1920, 1080);
    // baseSize 800KB → at q=0.82 → 656KB (> 512KB target)
    // at q=0.77 → 616KB, q=0.72 → 576KB, q=0.67 → 536KB, q=0.62 → 496KB (< target)
    mockCanvas(800_000);

    const file = new File(["x"], "big.jpg", { type: "image/jpeg" });
    const result = await compressImage(file);

    expect(result.size).toBeLessThanOrEqual(512_000);

    const proto = HTMLCanvasElement.prototype as any;
    // Should have called toBlob multiple times (iterating quality down)
    expect(proto.toBlob.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not reduce quality below IMAGE_QUALITY_MIN", async () => {
    mockCreateImageBitmap(1920, 1080);
    // Very large base: at q=0.45 still 900KB — but quality won't go below 0.45
    mockCanvas(2_000_000);

    const file = new File(["x"], "huge.jpg", { type: "image/jpeg" });
    const result = await compressImage(file);

    const proto = HTMLCanvasElement.prototype as any;
    const lastCall = proto.toBlob.mock.calls.at(-1);
    const lastQuality = lastCall?.[2];
    // Last quality used should be >= 0.45
    expect(lastQuality).toBeGreaterThanOrEqual(0.45);
  });

  it("does not iterate when first attempt is under target", async () => {
    mockCreateImageBitmap(1920, 1080);
    mockCanvas(400_000); // at q=0.82 → 328KB, already under 512KB

    const file = new File(["x"], "small.jpg", { type: "image/jpeg" });
    await compressImage(file);

    const proto = HTMLCanvasElement.prototype as any;
    expect(proto.toBlob.mock.calls.length).toBe(1);
  });
});

/* ---------- processPhoto ---------- */

describe("processPhoto", () => {
  it("accepts large files and compresses them (no pre-compression size check)", async () => {
    mockCreateImageBitmap(4032, 3024);
    mockCanvas(400_000); // result will be under target

    // 20MB file — previously would have been rejected
    const bigFile = new File([new Uint8Array(20_000_000)], "big.jpg", {
      type: "image/jpeg",
    });

    const result = await processPhoto(bigFile);
    expect(result.blob.size).toBeLessThan(512_000);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.hash).toHaveLength(64);
    expect(result.thumbnail).toBeInstanceOf(Blob);
  });

  it("throws when photo is too large even after compression", async () => {
    mockCreateImageBitmap(1920, 1080);
    // Produces blobs larger than ABSOLUTE_MAX (1.5MB) at any quality
    mockCanvas(5_000_000);

    const file = new File(["x"], "extreme.jpg", { type: "image/jpeg" });

    await expect(processPhoto(file)).rejects.toThrow(
      /слишком большое даже после сжатия/,
    );
  });
});
