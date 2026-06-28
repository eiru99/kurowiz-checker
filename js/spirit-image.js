/** Supabase 保存用の精霊アイコン一辺のピクセル数 */
export const SPIRIT_IMAGE_SIZE = 128;

const OUTPUT_MIME = 'image/webp';
const OUTPUT_EXTENSION = 'webp';

function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function saturation(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
}

/** スクリーンショットの背景・アイコン間のすき間 */
function isSpiritBackground(r, g, b) {
    const lum = luminance(r, g, b);
    const sat = saturation(r, g, b);
    if (lum > 238) return true;
    if (lum > 158 && sat < 0.14) return true;
    return false;
}

function getPixel(data, width, x, y) {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
}

/**
 * ユーザーが囲んだ範囲の中から精霊アイコンの正方形切り抜き範囲を推定する。
 * @param {{ x: number, y: number, w: number, h: number }} region
 * @returns {{ x: number, y: number, size: number } | null}
 */
export function detectSpiritCropRectInRegion(imageData, width, height, region) {
    const clipped = clampRegion(region, width, height);
    if (!clipped) return null;

    const bbox = findContentBoundingBox(imageData.data, width, height, clipped);
    if (!bbox) return null;

    const cx = Math.round((bbox.minX + bbox.maxX) / 2);
    const cy = Math.round((bbox.minY + bbox.maxY) / 2);
    const contentSize = Math.max(bbox.maxX - bbox.minX + 1, bbox.maxY - bbox.minY + 1);
    const maxScan = Math.ceil(contentSize * 0.55);

    const left = scanToEdgeInRegion(imageData.data, width, height, cx, cy, -1, 0, maxScan, clipped);
    const right = scanToEdgeInRegion(imageData.data, width, height, cx, cy, 1, 0, maxScan, clipped);
    const up = scanToEdgeInRegion(imageData.data, width, height, cx, cy, 0, -1, maxScan, clipped);
    const down = scanToEdgeInRegion(imageData.data, width, height, cx, cy, 0, 1, maxScan, clipped);

    let size = Math.max(left + right, up + down);
    const minSize = Math.max(16, Math.floor(Math.min(clipped.w, clipped.h) * 0.3));

    if (size < minSize) {
        size = contentSize;
    }

    const padding = Math.max(1, Math.round(size * 0.025));
    const maxAllowed = Math.min(clipped.w, clipped.h, width, height);
    size = Math.min(size + padding * 2, maxAllowed);

    if (size < minSize) return null;

    return clampSquare(Math.round(cx - size / 2), Math.round(cy - size / 2), size, width, height);
}

function clampRegion(region, width, height) {
    const x = Math.max(0, Math.floor(region.x));
    const y = Math.max(0, Math.floor(region.y));
    const w = Math.min(width - x, Math.ceil(region.w));
    const h = Math.min(height - y, Math.ceil(region.h));
    if (w < 12 || h < 12) return null;
    return { x, y, w, h };
}

function clampSquare(x, y, size, width, height) {
    let clampedSize = Math.floor(size);
    if (clampedSize <= 0) return null;

    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + clampedSize > width) x = width - clampedSize;
    if (y + clampedSize > height) y = height - clampedSize;
    if (x < 0 || y < 0) {
        clampedSize = Math.min(clampedSize, width, height);
        x = Math.max(0, Math.floor((width - clampedSize) / 2));
        y = Math.max(0, Math.floor((height - clampedSize) / 2));
    }
    if (clampedSize <= 0 || x + clampedSize > width || y + clampedSize > height) return null;
    return { x, y, size: clampedSize };
}

function findContentBoundingBox(data, width, height, region) {
    const xEnd = region.x + region.w;
    const yEnd = region.y + region.h;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = region.y; y < yEnd; y += 1) {
        for (let x = region.x; x < xEnd; x += 1) {
            const [r, g, b] = getPixel(data, width, x, y);
            if (isSpiritBackground(r, g, b)) continue;
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (!found) return null;
    return { minX, minY, maxX, maxY };
}

function scanToEdgeInRegion(data, width, height, x, y, dx, dy, maxDist, region) {
    let lastInside = 0;
    const xEnd = region.x + region.w;
    const yEnd = region.y + region.h;

    for (let step = 1; step <= maxDist; step += 1) {
        const nx = Math.round(x + dx * step);
        const ny = Math.round(y + dy * step);

        if (nx < region.x || ny < region.y || nx >= xEnd || ny >= yEnd) {
            return lastInside;
        }
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            return lastInside;
        }

        const [r, g, b] = getPixel(data, width, nx, ny);
        if (!isSpiritBackground(r, g, b)) {
            lastInside = step;
            continue;
        }

        let consecutiveBackground = 1;
        for (let ahead = 1; ahead <= 3; ahead += 1) {
            const px = Math.round(x + dx * (step + ahead));
            const py = Math.round(y + dy * (step + ahead));
            if (px < region.x || py < region.y || px >= xEnd || py >= yEnd) break;
            if (px < 0 || py < 0 || px >= width || py >= height) break;
            const [nr, ng, nb] = getPixel(data, width, px, py);
            if (isSpiritBackground(nr, ng, nb)) consecutiveBackground += 1;
            else break;
        }

        if (consecutiveBackground >= 3) {
            return lastInside;
        }
    }

    return lastInside;
}

export function imageNeedsCropMode(image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const maxDim = Math.max(width, height);
    const aspect = width / height;
    return maxDim > SPIRIT_IMAGE_SIZE * 1.25 || aspect < 0.85 || aspect > 1.15;
}

export function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => resolve({ image, objectUrl });
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('画像の読み込みに失敗しました。'));
        };
        image.src = objectUrl;
    });
}

function drawToOutputCanvas(source, sx, sy, sw, sh) {
    const canvas = document.createElement('canvas');
    canvas.width = SPIRIT_IMAGE_SIZE;
    canvas.height = SPIRIT_IMAGE_SIZE;
    const context = canvas.getContext('2d', { alpha: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, sx, sy, sw, sh, 0, 0, SPIRIT_IMAGE_SIZE, SPIRIT_IMAGE_SIZE);
    return canvas;
}

function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('画像の変換に失敗しました。'));
        }, OUTPUT_MIME, 0.88);
    });
}

export async function normalizeImageElement(image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const size = Math.min(width, height);
    const sx = Math.floor((width - size) / 2);
    const sy = Math.floor((height - size) / 2);
    const canvas = drawToOutputCanvas(image, sx, sy, size, size);
    return canvasToBlob(canvas);
}

export async function cropAndNormalizeSpiritImage(image, cropRect) {
    const canvas = drawToOutputCanvas(image, cropRect.x, cropRect.y, cropRect.size, cropRect.size);
    return canvasToBlob(canvas);
}

export function blobToSpiritFile(blob, baseName = 'spirit') {
    return new File([blob], `${baseName}.${OUTPUT_EXTENSION}`, { type: OUTPUT_MIME });
}

export async function prepareSpiritImageFile(file) {
    const { image, objectUrl } = await loadImageFromFile(file);
    try {
        const blob = await normalizeImageElement(image);
        return blobToSpiritFile(blob, 'spirit');
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

export function readImageDataFromElement(image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    return { imageData: context.getImageData(0, 0, width, height), width, height };
}
