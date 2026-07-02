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

const MAX_EDGE_WHITE_RATIO = 0.8;
const MIN_CROP_SIZE = 16;

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

function findNearestCardPixel(data, width, height, x, y) {
    const cx = Math.round(Math.max(0, Math.min(width - 1, x)));
    const cy = Math.round(Math.max(0, Math.min(height - 1, y)));
    if (!isWhiteGutter(...getPixel(data, width, cx, cy))) {
        return { x: cx, y: cy };
    }

    const maxRadius = Math.min(width, height);
    for (let radius = 1; radius < maxRadius; radius += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
            for (let dy = -radius; dy <= radius; dy += 1) {
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                if (!isWhiteGutter(...getPixel(data, width, nx, ny))) {
                    return { x: nx, y: ny };
                }
            }
        }
    }

    return null;
}

const OUTWARD_WHITE_THRESHOLD = 0.45;

/** クリック位置から指定方向へ走査し、白すき間に達する手前までの距離を返す */
function scanOutwardToWhiteGutterEdge(data, width, height, ax, ay, dx, dy, maxDist) {
    let lastInside = 0;

    for (let step = 1; step <= maxDist; step += 1) {
        const px = ax + dx * step;
        const py = ay + dy * step;

        if (px < 0 || py < 0 || px >= width || py >= height) {
            return lastInside;
        }

        const span = Math.min(step * 2 + 10, Math.max(width, height));
        const whiteRatio = dx !== 0
            ? lineWhiteGutterRatio(data, width, px, Math.max(0, ay - span), Math.min(height, ay + span + 1), 'x')
            : lineWhiteGutterRatio(data, width, py, Math.max(0, ax - span), Math.min(width, ax + span + 1), 'y');

        if (whiteRatio >= OUTWARD_WHITE_THRESHOLD) {
            return lastInside;
        }
        lastInside = step;
    }

    return lastInside;
}

function rectToInitialSquare(rect, width, height) {
    const boxWidth = rect.maxX - rect.minX + 1;
    const boxHeight = rect.maxY - rect.minY + 1;
    const size = Math.max(boxWidth, boxHeight);
    const cx = (rect.minX + rect.maxX) / 2;
    const cy = (rect.minY + rect.maxY) / 2;
    return clampSquare(Math.round(cx - size / 2), Math.round(cy - size / 2), size, width, height);
}

function finalizeSquareCrop(data, width, height, initial) {
    if (!initial) return null;
    return tightenSquareToWhiteEdgeRule(data, width, height, initial);
}

/**
 * クリック位置から輪郭検出で精霊アイコンの正方形切り抜き範囲を求める。
 * 失敗時は従来のピクセル走査にフォールバックする。
 * @returns {{ x: number, y: number, size: number } | null}
 */
export function detectSpiritCropRectAtClick(imageData, width, height, clickX, clickY) {
    return detectSpiritCropRectAtClickByContour(imageData, width, height, clickX, clickY)
        ?? detectSpiritCropRectAtClickByPixelScan(imageData, width, height, clickX, clickY);
}

/** @returns {{ x: number, y: number, size: number } | null} */
export function detectSpiritCropRectAtClickByContour(imageData, width, height, clickX, clickY) {
    const rawMask = createForegroundMask(imageData, width, height);
    const mask = morphCloseMask(rawMask, width, height);

    const anchor = findNearestForegroundPixel(mask, width, height, clickX, clickY);
    if (!anchor) return null;

    const component = findConnectedComponentAt(mask, width, height, anchor.x, anchor.y);
    if (!component || component.width < MIN_CROP_SIZE || component.height < MIN_CROP_SIZE) {
        return null;
    }

    return rectToSquareCrop(
        component.x,
        component.y,
        component.width,
        component.height,
        width,
        height
    );
}

/**
 * 従来のピクセル走査による切り抜き（テスト比較・フォールバック用）。
 * @returns {{ x: number, y: number, size: number } | null}
 */
export function detectSpiritCropRectAtClickByPixelScan(imageData, width, height, clickX, clickY) {
    const anchor = findNearestCardPixel(imageData.data, width, height, clickX, clickY);
    if (!anchor) return null;

    const maxScan = Math.floor(Math.min(width, height) * 0.45);
    const left = scanOutwardToWhiteGutterEdge(imageData.data, width, height, anchor.x, anchor.y, -1, 0, maxScan);
    const right = scanOutwardToWhiteGutterEdge(imageData.data, width, height, anchor.x, anchor.y, 1, 0, maxScan);
    const up = scanOutwardToWhiteGutterEdge(imageData.data, width, height, anchor.x, anchor.y, 0, -1, maxScan);
    const down = scanOutwardToWhiteGutterEdge(imageData.data, width, height, anchor.x, anchor.y, 0, 1, maxScan);

    const minScan = Math.max(8, Math.floor(Math.min(width, height) * 0.04));
    if (Math.max(left + right, up + down) < minScan) {
        const estimated = Math.max(48, Math.round(Math.min(width, height) * 0.22));
        const regionSize = estimated + Math.round(estimated * 0.8);
        return detectSpiritCropRectInRegion(imageData, width, height, {
            x: anchor.x - regionSize / 2,
            y: anchor.y - regionSize / 2,
            w: regionSize,
            h: regionSize
        });
    }

    const initial = rectToInitialSquare({
        minX: anchor.x - left,
        minY: anchor.y - up,
        maxX: anchor.x + right,
        maxY: anchor.y + down
    }, width, height);

    return finalizeSquareCrop(imageData.data, width, height, initial);
}

function createForegroundMask(imageData, width, height) {
    const mask = new Uint8Array(width * height);
    const data = imageData.data;

    for (let py = 0; py < height; py += 1) {
        for (let px = 0; px < width; px += 1) {
            const i = (py * width + px) * 4;
            mask[py * width + px] = isSpiritBackground(data[i], data[i + 1], data[i + 2]) ? 0 : 255;
        }
    }

    return mask;
}

function morphCloseMask(mask, width, height, kernelSize = 5, iterations = 2) {
    let current = mask;
    for (let iter = 0; iter < iterations; iter += 1) {
        current = dilateMask(current, width, height, kernelSize);
        current = erodeMask(current, width, height, kernelSize);
    }
    return current;
}

function dilateMask(mask, width, height, kernelSize) {
    const radius = Math.floor(kernelSize / 2);
    const out = new Uint8Array(width * height);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            let value = 0;
            for (let dy = -radius; dy <= radius && value === 0; dy += 1) {
                for (let dx = -radius; dx <= radius; dx += 1) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    if (mask[ny * width + nx] > 0) {
                        value = 255;
                        break;
                    }
                }
            }
            out[y * width + x] = value;
        }
    }

    return out;
}

function erodeMask(mask, width, height, kernelSize) {
    const radius = Math.floor(kernelSize / 2);
    const out = new Uint8Array(width * height);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            let value = 255;
            for (let dy = -radius; dy <= radius && value === 255; dy += 1) {
                for (let dx = -radius; dx <= radius; dx += 1) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                        value = 0;
                        break;
                    }
                    if (mask[ny * width + nx] === 0) {
                        value = 0;
                        break;
                    }
                }
            }
            out[y * width + x] = value;
        }
    }

    return out;
}

function findNearestForegroundPixel(mask, width, height, x, y) {
    const cx = Math.round(Math.max(0, Math.min(width - 1, x)));
    const cy = Math.round(Math.max(0, Math.min(height - 1, y)));
    if (mask[cy * width + cx] > 0) {
        return { x: cx, y: cy };
    }

    const maxRadius = Math.min(width, height);
    for (let radius = 1; radius < maxRadius; radius += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
            for (let dy = -radius; dy <= radius; dy += 1) {
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                if (mask[ny * width + nx] > 0) {
                    return { x: nx, y: ny };
                }
            }
        }
    }

    return null;
}

function findConnectedComponentAt(mask, width, height, startX, startY) {
    const startIdx = startY * width + startX;
    if (mask[startIdx] === 0) return null;

    const visited = new Uint8Array(width * height);
    const stack = [startIdx];
    visited[startIdx] = 1;

    let minX = startX;
    let maxX = startX;
    let minY = startY;
    let maxY = startY;

    while (stack.length > 0) {
        const idx = stack.pop();
        const x = idx % width;
        const y = Math.floor(idx / width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
        for (const nextIdx of neighbors) {
            if (nextIdx < 0 || nextIdx >= width * height) continue;
            const nx = nextIdx % width;
            if (Math.abs(nx - x) > 1) continue;
            if (visited[nextIdx] || mask[nextIdx] === 0) continue;
            visited[nextIdx] = 1;
            stack.push(nextIdx);
        }
    }

    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
}

function rectToSquareCrop(x, y, w, h, width, height) {
    const size = Math.max(w, h);
    const cx = x + w / 2;
    const cy = y + h / 2;
    return clampSquare(Math.round(cx - size / 2), Math.round(cy - size / 2), size, width, height);
}

/** 輪郭検出デバッグ用の前景マスク ImageData */
export function createDebugMaskImageData(imageData, width, height) {
    const rawMask = createForegroundMask(imageData, width, height);
    const mask = morphCloseMask(rawMask, width, height);
    const out = new ImageData(width, height);

    for (let i = 0; i < width * height; i += 1) {
        const value = mask[i];
        const j = i * 4;
        out.data[j] = value;
        out.data[j + 1] = value;
        out.data[j + 2] = value;
        out.data[j + 3] = 255;
    }

    return out;
}

function squareEdgeWhiteRatios(data, width, x, y, size) {
    const right = x + size - 1;
    const bottom = y + size - 1;
    return {
        top: lineWhiteGutterRatio(data, width, y, x, right + 1, 'y'),
        bottom: lineWhiteGutterRatio(data, width, bottom, x, right + 1, 'y'),
        left: lineWhiteGutterRatio(data, width, x, y, bottom + 1, 'x'),
        right: lineWhiteGutterRatio(data, width, right, y, bottom + 1, 'x')
    };
}

/**
 * 各辺の白ピクセルが 80% 以下になるまで、該当辺を 1px ずつ内側へ寄せる。
 */
function tightenSquareToWhiteEdgeRule(data, width, height, square) {
    let { x, y, size } = square;

    for (let guard = 0; guard < size && size >= MIN_CROP_SIZE; guard += 1) {
        const edges = squareEdgeWhiteRatios(data, width, x, y, size);
        const needTop = edges.top > MAX_EDGE_WHITE_RATIO;
        const needBottom = edges.bottom > MAX_EDGE_WHITE_RATIO;
        const needLeft = edges.left > MAX_EDGE_WHITE_RATIO;
        const needRight = edges.right > MAX_EDGE_WHITE_RATIO;

        if (!needTop && !needBottom && !needLeft && !needRight) {
            break;
        }

        if (needTop) y += 1;
        if (needLeft) x += 1;
        size -= (needTop ? 1 : 0) + (needBottom ? 1 : 0) + (needLeft ? 1 : 0) + (needRight ? 1 : 0);

        if (size < MIN_CROP_SIZE) {
            return null;
        }
    }

    return clampSquare(x, y, size, width, height);
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

    const minSize = Math.max(16, Math.floor(Math.min(clipped.w, clipped.h) * 0.25));
    const boxWidth = rect.maxX - rect.minX + 1;
    const boxHeight = rect.maxY - rect.minY + 1;
    if (Math.max(boxWidth, boxHeight) < minSize) return null;

    const initial = rectToInitialSquare(rect, width, height);
    return finalizeSquareCrop(imageData.data, width, height, initial);
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

/** 属性アイコンの金枠・白枠（サンプル対象外） */
function isAttributeFramePixel(r, g, b) {
    const sat = saturation(r, g, b);
    const lum = luminance(r, g, b);
    if (r >= 230 && g >= 230 && b >= 230 && sat < 0.1) return true;
    return lum > 125 && lum < 225 && sat > 0.12 && sat < 0.55 && r > g && r > b * 0.75;
}

function rgbToHue(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    if (d < 0.04) return null;

    let h;
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return h;
}

function classifyElementColor(rgb) {
    if (!rgb) return null;

    const { r, g, b } = rgb;
    const sat = saturation(r, g, b);
    const lum = luminance(r, g, b);

    if (sat < 0.2 && lum > 165) return '光';

    const hue = rgbToHue(r, g, b);
    if (hue === null) return lum > 165 ? '光' : null;

    if (hue < 30 || hue >= 330) return '火';
    if (hue < 75) return '雷';
    if (hue < 155) {
        if (b > r + 20) return '水';
        if (r > b + 20) return '火';
        return '雷';
    }
    if (hue < 255) return '水';
    if (hue < 320) return '闇';
    return '火';
}

function averageAttributeColor(data, width, height, x0, y0, w, h) {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;
    const xStart = Math.max(0, x0);
    const yStart = Math.max(0, y0);
    const xEnd = Math.min(width, x0 + w);
    const yEnd = Math.min(height, y0 + h);

    for (let py = yStart; py < yEnd; py += 1) {
        for (let px = xStart; px < xEnd; px += 1) {
            const [r, g, b] = getPixel(data, width, px, py);
            if (isAttributeFramePixel(r, g, b)) continue;
            rSum += r;
            gSum += g;
            bSum += b;
            count += 1;
        }
    }

    const minSamples = Math.max(2, Math.floor(w * h * 0.12));
    if (count < minSamples) return null;
    return { r: rSum / count, g: gSum / count, b: bSum / count };
}

/**
 * 切り抜き矩形の左上にある属性アイコンの色から main / sub を推定する。
 * @returns {{ main: string | null, sub: string | null }}
 */
export function detectSpiritAttributes(imageData, width, height, cropRect) {
    const { x, y, size } = cropRect;
    const emblemSize = Math.max(6, Math.round(size * 0.18));
    const offset = Math.max(1, Math.round(size * 0.03));
    const emblemX = x + offset;
    const emblemY = y + offset;
    const halfW = Math.floor(emblemSize / 2);

    const mainColor = averageAttributeColor(
        imageData.data,
        width,
        height,
        emblemX,
        emblemY,
        halfW,
        emblemSize
    );
    const subColor = averageAttributeColor(
        imageData.data,
        width,
        height,
        emblemX + halfW,
        emblemY,
        emblemSize - halfW,
        emblemSize
    );

    return {
        main: classifyElementColor(mainColor),
        sub: classifyElementColor(subColor)
    };
}

/** 画像全体を正方形に切り出す際の矩形（normalizeImageElement と同じ基準） */
export function squareCropRectForImage(width, height) {
    const size = Math.min(width, height);
    return {
        x: Math.floor((width - size) / 2),
        y: Math.floor((height - size) / 2),
        size
    };
}
