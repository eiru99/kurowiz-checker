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

/** 精霊アイコン同士の白いすき間（枠の外側） */
function isWhiteGutter(r, g, b) {
    const sat = saturation(r, g, b);
    return r >= 235 && g >= 235 && b >= 235 && sat < 0.08;
}

/** スクショ全体の薄いグレー模様の背景 */
function isGrayScreenshotBackground(r, g, b) {
    const lum = luminance(r, g, b);
    const sat = saturation(r, g, b);
    return lum > 158 && sat < 0.14;
}

function isSpiritBackground(r, g, b) {
    return isWhiteGutter(r, g, b) || isGrayScreenshotBackground(r, g, b);
}

function getPixel(data, width, x, y) {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
}

/** 線上の白すき間ピクセル比率（0=枠側、1=白背景側） */
function lineWhiteGutterRatio(data, width, fixed, start, end, axis) {
    let white = 0;
    let total = 0;

    if (axis === 'x') {
        for (let y = start; y < end; y += 1) {
            total += 1;
            if (isWhiteGutter(...getPixel(data, width, fixed, y))) white += 1;
        }
    } else {
        for (let x = start; x < end; x += 1) {
            total += 1;
            if (isWhiteGutter(...getPixel(data, width, x, fixed))) white += 1;
        }
    }

    return total === 0 ? 1 : white / total;
}

/**
 * ユーザーが囲んだ範囲の外側から内側へ走査し、
 * 白背景 → 枠 の境界で精霊アイコンの矩形を求める。
 */
function findCardRectByWhiteEdges(data, width, height, region) {
    const { x: rx, y: ry, w: rw, h: rh } = region;
    const xEnd = rx + rw;
    const yEnd = ry + rh;
    const edgeThreshold = 0.45;

    let left = null;
    for (let x = rx; x < xEnd; x += 1) {
        if (lineWhiteGutterRatio(data, width, x, ry, yEnd, 'x') < edgeThreshold) {
            left = x;
            break;
        }
    }

    let right = null;
    for (let x = xEnd - 1; x >= rx; x -= 1) {
        if (lineWhiteGutterRatio(data, width, x, ry, yEnd, 'x') < edgeThreshold) {
            right = x;
            break;
        }
    }

    if (left === null || right === null || right <= left) {
        return null;
    }

    let top = null;
    for (let y = ry; y < yEnd; y += 1) {
        if (lineWhiteGutterRatio(data, width, y, left, right + 1, 'y') < edgeThreshold) {
            top = y;
            break;
        }
    }

    let bottom = null;
    for (let y = yEnd - 1; y >= ry; y -= 1) {
        if (lineWhiteGutterRatio(data, width, y, left, right + 1, 'y') < edgeThreshold) {
            bottom = y;
            break;
        }
    }

    if (top === null || bottom === null || bottom <= top) {
        return null;
    }

    return { minX: left, minY: top, maxX: right, maxY: bottom };
}

/** 白すき間判定で取れない場合のフォールバック（行・列の非背景占有率） */
function findCardRectByProjection(data, width, height, region) {
    const { x: rx, y: ry, w: rw, h: rh } = region;
    const xEnd = rx + rw;
    const yEnd = ry + rh;
    const rowThreshold = 0.07;
    const colThreshold = 0.07;

    let top = -1;
    let bottom = -1;
    for (let y = ry; y < yEnd; y += 1) {
        let count = 0;
        for (let x = rx; x < xEnd; x += 1) {
            if (!isSpiritBackground(...getPixel(data, width, x, y))) count += 1;
        }
        if (count / rw >= rowThreshold) {
            if (top < 0) top = y;
            bottom = y;
        }
    }
    if (top < 0) return null;

    const bandHeight = bottom - top + 1;
    let left = -1;
    let right = -1;
    for (let x = rx; x < xEnd; x += 1) {
        let count = 0;
        for (let y = top; y <= bottom; y += 1) {
            if (!isSpiritBackground(...getPixel(data, width, x, y))) count += 1;
        }
        if (count / bandHeight >= colThreshold) {
            if (left < 0) left = x;
            right = x;
        }
    }
    if (left < 0) return null;

    return { minX: left, minY: top, maxX: right, maxY: bottom };
}

/**
 * ユーザーが囲んだ範囲の中から精霊アイコンの正方形切り抜き範囲を推定する。
 * @param {{ x: number, y: number, w: number, h: number }} region
 * @returns {{ x: number, y: number, size: number } | null}
 */
export function detectSpiritCropRectInRegion(imageData, width, height, region) {
    const clipped = clampRegion(region, width, height);
    if (!clipped) return null;

    const rect = findCardRectByWhiteEdges(imageData.data, width, height, clipped)
        ?? findCardRectByProjection(imageData.data, width, height, clipped);
    if (!rect) return null;

    const boxWidth = rect.maxX - rect.minX + 1;
    const boxHeight = rect.maxY - rect.minY + 1;
    const minSize = Math.max(16, Math.floor(Math.min(clipped.w, clipped.h) * 0.25));
    let size = Math.max(boxWidth, boxHeight);

    if (size < minSize) return null;

    const padding = Math.max(1, Math.round(size * 0.01));
    size = Math.min(size + padding * 2, Math.min(clipped.w, clipped.h));

    const cx = (rect.minX + rect.maxX) / 2;
    const cy = (rect.minY + rect.maxY) / 2;

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
