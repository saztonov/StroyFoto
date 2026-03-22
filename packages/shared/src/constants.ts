/** Maximum number of photos allowed per single report */
export const MAX_PHOTOS_PER_REPORT = 20;

/** Maximum file size in bytes before compression (15 MB) */
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

/** Reference data (dictionaries) cache TTL in milliseconds (24 hours) */
export const REFERENCE_DATA_TTL_MS = 24 * 60 * 60 * 1000;

/** Target compressed photo size in bytes (500 KB) */
export const TARGET_PHOTO_SIZE_BYTES = 512_000;

/** Absolute max photo size after all compression attempts (1.5 MB) */
export const ABSOLUTE_MAX_PHOTO_BYTES = 1_572_864;

/** Max dimension (width or height) for compressed photos */
export const IMAGE_MAX_DIMENSION = 1920;

/** Initial JPEG quality for compression */
export const IMAGE_QUALITY_MAX = 0.82;

/** Minimum JPEG quality floor — lower causes visible artifacts */
export const IMAGE_QUALITY_MIN = 0.45;

/** Quality decrement step per compression iteration */
export const IMAGE_QUALITY_STEP = 0.05;
