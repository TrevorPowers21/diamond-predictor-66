/**
 * Pulls the two most prominent colors out of an uploaded logo image so the
 * AdminTeams branding form can auto-populate primary + secondary without
 * the superadmin having to hand-pick them. The lookup table in
 * schoolColors.ts is the fallback when no logo is uploaded yet — once a
 * logo lands, extraction wins because it's guaranteed accurate to the
 * actual artwork.
 *
 * Approach: render to a small canvas, quantize each pixel into a 32-step
 * RGB bucket, count frequencies, and pick the top color. Then walk down
 * the frequency list to find a "secondary" that's perceptually distinct
 * from primary (Euclidean RGB distance threshold). Near-white and pure
 * transparent pixels are dropped because they're almost never the team
 * color — they're the negative space around the mark.
 */

type ExtractedColors = { primary: string; secondary: string };

const QUANTIZE = 16;
const MIN_COLOR_DISTANCE = 110;
const MAX_DIM = 200;

// Standard Rec. 709 luminance — used to order primary/secondary so the
// brighter team color always ends up as primary on the dark banner. Black
// or dark navy then falls into secondary, where SchoolBanner's dark-bg
// helper renders it as white. Without this, a logo whose dominant color
// is black trim (Georgia, Iowa) ends up illegible.
const luminance = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const toHex = (r: number, g: number, b: number): string =>
  "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();

const parseKey = (key: string): [number, number, number] => {
  const [r, g, b] = key.split(",").map(Number);
  return [r, g, b];
};

const colorDistance = (a: [number, number, number], b: [number, number, number]): number => {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });

async function extract(src: string): Promise<ExtractedColors | null> {
  const img = await loadImage(src);
  const ratio = Math.min(MAX_DIM / Math.max(img.width || MAX_DIM, 1), MAX_DIM / Math.max(img.height || MAX_DIM, 1), 1);
  const w = Math.max(1, Math.round((img.width || MAX_DIM) * ratio));
  const h = Math.max(1, Math.round((img.height || MAX_DIM) * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // CORS-tainted canvas (e.g. logo loaded from a different origin without
    // CORS headers). Skip extraction silently — user can still pick colors.
    return null;
  }

  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 128) continue;
    const r = Math.round(data[i] / QUANTIZE) * QUANTIZE;
    const g = Math.round(data[i + 1] / QUANTIZE) * QUANTIZE;
    const b = Math.round(data[i + 2] / QUANTIZE) * QUANTIZE;
    // Skip near-white (background of most logos).
    if (r > 224 && g > 224 && b > 224) continue;
    const key = `${r},${g},${b}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const topRgb = parseKey(sorted[0][0]);

  // Find the second-most-frequent color that's visually distinct from the
  // top one (so we don't pick a slightly different shade of the same color).
  let secondRgb: [number, number, number] | null = null;
  for (let i = 1; i < sorted.length; i += 1) {
    const candidate = parseKey(sorted[i][0]);
    if (colorDistance(topRgb, candidate) >= MIN_COLOR_DISTANCE) {
      secondRgb = candidate;
      break;
    }
  }
  // Single-color mark — fall back to black. The banner will render the
  // black line as white via SchoolBanner's dark-bg helper.
  if (!secondRgb) secondRgb = [0, 0, 0];

  // Promote the brighter color to primary so dark colors (black trim, deep
  // navy) always end up as secondary, where the banner's dark-bg helper
  // renders them legibly as white. Order by frequency would put black
  // first for Georgia, then both lines would render unreadable.
  const topLum = luminance(topRgb[0], topRgb[1], topRgb[2]);
  const secondLum = luminance(secondRgb[0], secondRgb[1], secondRgb[2]);
  const [primaryRgb, secondaryRgb] = topLum >= secondLum
    ? [topRgb, secondRgb]
    : [secondRgb, topRgb];

  return {
    primary: toHex(primaryRgb[0], primaryRgb[1], primaryRgb[2]),
    secondary: toHex(secondaryRgb[0], secondaryRgb[1], secondaryRgb[2]),
  };
}

/** Extract colors from a File (e.g. user-selected upload) before it hits the network. */
export async function extractColorsFromFile(file: File): Promise<ExtractedColors | null> {
  try {
    const dataUrl = await fileToDataUrl(file);
    return await extract(dataUrl);
  } catch {
    return null;
  }
}

/** Extract colors from a URL. May fail on CORS-protected images — caller should treat null as "no extraction available." */
export async function extractColorsFromUrl(url: string): Promise<ExtractedColors | null> {
  try {
    return await extract(url);
  } catch {
    return null;
  }
}
