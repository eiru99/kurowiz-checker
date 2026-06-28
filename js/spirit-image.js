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

function scanToEdge(data, width, height, x, y, dx, dy, maxDist) {
    let lastInside = 0;

    for (let step = 1; step <= maxDist; step += 1) {
        const nx = Math.round(x + dx * step);
        const ny = Math.round(y + dy * step);

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

function findNearestCardPixel(data, width, height, x, y) {
    if (!isSpiritBackground(...getPixel(data, width, x, y))) {
        return { x, y };
    }

    const maxRadius = Math.min(width, height);
    for (let radius = 1; radius < maxRadius; radius += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
            for (let dy = -radius; dy <= radius; dy += 1) {
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                if (!isSpiritBackground(...getPixel(data, width, nx, ny))) {
                    return { x: nx, y: ny };
                }
            }
        }
    }

    return null;
}

/**
 * クリック位置を含む精霊アイコンの正方形切り抜き範囲を推定する。
 * @returns {{ x: number, y: number, size: number } | null}
 */
export function detectSpiritCropRect(imageData, width, height, clickX, clickY) {
    const cx = Math.round(Math.max(0, Math.min(width - 1, clickX)));
    const cy = Math.round(Math.max(0, Math.min(height - 1, clickY)));
    const anchor = findNearestCardPixel(imageData.data, width, height, cx, cy);
    if (!anchor) return null;

    const maxScan = Math.floor(Math.min(width, height) * 0.45);
    const left = scanToEdge(imageData.data, width, height, anchor.x, anchor.y, -1, 0, maxScan);
    const right = scanToEdge(imageData.data, width, height, anchor.x, anchor.y, 1, 0, maxScan);
    const up = scanToEdge(imageData.data, width, height, anchor.x, anchor.y, 0, -1, maxScan);
    const down = scanToEdge(imageData.data, width, height, anchor.x, anchor.y, 0, 1, maxScan);

    const horizontal = left + right;
    const vertical = up + down;
    let size = Math.max(horizontal, vertical);

    const minSize = Math.max(24, Math.floor(Math.min(width, height) * 0.04));
    const maxSize = Math.floor(Math.min(width, height) * 0.92);
    if (size < minSize) return null;
    size = Math.min(size, maxSize);

    const padding = Math.max(2, Math.round(size * 0.03));
    size = Math.min(size + padding * 2, maxSize);

    let x = Math.round(anchor.x - size / 2);
    let y = Math.round(anchor.y - size / 2);

    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + size > width) x = width - size;
    if (y + size > height) y = height - size;
    if (size <= 0 || x < 0 || y < 0) return null;

    return { x, y, size };
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
