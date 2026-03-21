import { describe, it, expect } from "vitest";
import { computeHash } from "../../lib/image-processing";

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
