// Perceptual comparison of two thumbnails. YouTube re-encodes every uploaded
// thumbnail and serves it in several sizes (some letterboxed to 4:3), so a
// byte or SHA-256 comparison calls an unchanged image "changed" — and
// re-uploading costs ~50 quota units each. This compares what the images
// look like instead: tolerant of re-encoding and resizing, but fine-grained
// enough (160x90) to notice a real edit such as one changed digit in the
// thumbnail's text. Missing an edit is the worse failure (the user's change
// would silently not be uploaded), so the thresholds lean towards "changed".

const SAMPLE_WIDTH = 640;
const SAMPLE_HEIGHT = 360;
const BLOCK = 4;
const WIDTH = SAMPLE_WIDTH / BLOCK;
const HEIGHT = SAMPLE_HEIGHT / BLOCK;

// Draw the image cover-fitted to 16:9 — which crops the letterbox bars of the
// 4:3 sizes, so every size of one thumbnail lines up — then average 4x4 blocks
// down to 160x90 in JS. Averaging by hand keeps the result consistent across
// browsers, whose canvas downscaling quality differs at large factors.
async function fingerprint(image: Blob): Promise<Float32Array> {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Canvas 2D is unavailable');
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const scale = Math.max(SAMPLE_WIDTH / bitmap.width, SAMPLE_HEIGHT / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (SAMPLE_WIDTH - width) / 2, (SAMPLE_HEIGHT - height) / 2, width, height);
    const pixels = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;

    const result = new Float32Array(WIDTH * HEIGHT * 3);
    for (let y = 0; y < SAMPLE_HEIGHT; y++) {
      for (let x = 0; x < SAMPLE_WIDTH; x++) {
        const source = (y * SAMPLE_WIDTH + x) * 4;
        const target = (Math.floor(y / BLOCK) * WIDTH + Math.floor(x / BLOCK)) * 3;
        result[target] += pixels[source];
        result[target + 1] += pixels[source + 1];
        result[target + 2] += pixels[source + 2];
      }
    }
    for (let i = 0; i < result.length; i++) {
      result[i] /= BLOCK * BLOCK;
    }
    return result;
  } finally {
    bitmap.close();
  }
}

interface ThumbnailDifference {
  // Mean absolute channel difference (0-255) over the whole image.
  mean: number;
  // Number of 160x90 cells whose largest channel difference exceeds CELL_LIMIT.
  changedCells: number;
}

// Calibrated on real and synthetic thumbnails, comparing the full-size
// original with re-encoded copies (JPEG q0.35-0.92, 640-1920 px wide, 4:3
// letterboxed) vs. genuine edits: identical images peaked at 24 per cell and a
// mean of 1.3 against a reference at least 640 px wide; the smallest edit (a
// 24 px digit on a 1920x1080 image) reached 56 in one cell, and an 8 %
// brightness change kept every cell under 21 but moved the mean to 7.3.
const CELL_LIMIT = 32;
const MAX_MEAN = 3;
const MAX_CHANGED_CELLS = 0;

async function thumbnailDifference(a: Blob, b: Blob): Promise<ThumbnailDifference> {
  const [first, second] = await Promise.all([fingerprint(a), fingerprint(b)]);
  let total = 0;
  let changedCells = 0;
  for (let cell = 0; cell < WIDTH * HEIGHT; cell++) {
    let largest = 0;
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(first[cell * 3 + channel] - second[cell * 3 + channel]);
      total += difference;
      largest = Math.max(largest, difference);
    }
    if (largest > CELL_LIMIT) {
      changedCells++;
    }
  }
  return { mean: total / (WIDTH * HEIGHT * 3), changedCells };
}

// Whether two images show the same thumbnail. The reference should be at least
// 640 px wide: YouTube's smaller sizes are too blurry to rule out a small edit.
// Undecodable input counts as different, so the caller falls back to uploading.
export async function looksLikeSameThumbnail(a: Blob, b: Blob): Promise<boolean> {
  try {
    const { mean, changedCells } = await thumbnailDifference(a, b);
    return mean <= MAX_MEAN && changedCells <= MAX_CHANGED_CELLS;
  } catch {
    return false;
  }
}
