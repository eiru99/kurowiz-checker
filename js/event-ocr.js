const TESSERACT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';
const TESSERACT_WORKER_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js';
const TESSERACT_CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js';
const TESSERACT_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

const HEADER_SCAN_BAND = { top: 0, height: 0.42, left: 0, right: 1 };
const TEXT_LEFT_RATIO = 0.1;
const TEXT_RIGHT_RATIO = 0.99;
const MIN_OCR_WIDTH = 1200;
const MIN_OCR_HEIGHT = 56;
const SINGLE_LINE_PSM = '7';
const MIN_CONFIDENCE = 42;

let workerPromise = null;

async function loadTesseractModule() {
    const module = await import(TESSERACT_MODULE_URL);
    return module.default ?? module;
}

async function getOcrWorker() {
    if (!workerPromise) {
        workerPromise = (async () => {
            const Tesseract = await loadTesseractModule();
            if (typeof Tesseract.createWorker !== 'function') {
                throw new Error('Tesseract.js の読み込みに失敗しました。');
            }

            const worker = await Tesseract.createWorker(['jpn', 'eng'], 1, {
                workerPath: TESSERACT_WORKER_PATH,
                corePath: TESSERACT_CORE_PATH,
                langPath: TESSERACT_LANG_PATH
            });
            await worker.setParameters({ tessedit_ocr_engine_mode: '1' });
            return worker;
        })().catch(error => {
            workerPromise = null;
            throw error;
        });
    }
    return workerPromise;
}

function hasLatinText(text) {
    return /[A-Za-z]/.test(text);
}

function normalizeEventOcrText(text, { preserveSpaces = false } = {}) {
    let result = text
        .replace(/[\r\n\t]+/g, preserveSpaces ? ' ' : '')
        .replace(/\u00a0/g, ' ');

    if (preserveSpaces) {
        result = result.replace(/\s+/g, ' ').trim();
    } else {
        result = result.replace(/\s+/g, '');
    }

    return result
        .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/[！-～]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, char => String(char.charCodeAt(0) - 0x2460 + 1))
        .replace(/[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽]/g, char => String(char.charCodeAt(0) - 0x2473))
        .replace(/[　]/g, preserveSpaces ? ' ' : '')
        .trim();
}

function sanitizeOcrOutput(text, { preserveSpaces = false } = {}) {
    let result = normalizeEventOcrText(text, { preserveSpaces });
    if (!result) return '';

    result = result
        .replace(/[|｜—―‐─－_]{2,}/g, '')
        .replace(/[|｜—―‐─－]+/g, '')
        .replace(/(.)\1{4,}/g, '$1')
        .trim();

    if (!preserveSpaces && result.length >= 5) {
        const noisyPrefix = result.match(/^(.{1,2})([\u3040-\u9fff\u30a0-\u30ffA-Za-z0-9・]{4,})$/u);
        if (noisyPrefix) {
            result = noisyPrefix[2];
        }
    }

    return result.trim();
}

function pixelIndex(width, x, y) {
    return (y * width + x) * 4;
}

function getPixelLuminance(data, width, x, y) {
    const i = pixelIndex(width, x, y);
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return {
        r,
        g,
        b,
        lum: 0.299 * r + 0.587 * g + 0.114 * b,
        sat: (() => {
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            return max === 0 ? 0 : (max - min) / max;
        })()
    };
}

function isHeaderTextPixel(data, width, x, y) {
    const { r, g, b, lum, sat } = getPixelLuminance(data, width, x, y);

    if (r > 145 && g > 95 && b < 95 && r > g && g > b * 1.1) return false;
    if (lum > 152) return false;
    if (lum > 120 && sat < 0.16) return false;
    return lum < 105 || (lum < 125 && sat > 0.24);
}

function isSeparatorPixel(data, width, x, y) {
    const { lum, sat } = getPixelLuminance(data, width, x, y);
    return lum >= 40 && lum <= 115 && sat < 0.22;
}

function cropImageBand(image, band) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    const sx = Math.floor(width * band.left);
    const sy = Math.floor(height * band.top);
    const sw = Math.max(1, Math.floor(width * (band.right - band.left)));
    const sh = Math.max(1, Math.floor(height * band.height));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, sw, sh);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

    return { canvas, offsetX: sx, offsetY: sy };
}

function cropImageRect(image, rect) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    const sx = Math.max(0, Math.min(width - 1, Math.floor(rect.x)));
    const sy = Math.max(0, Math.min(height - 1, Math.floor(rect.y)));
    const sw = Math.max(1, Math.min(width - sx, Math.floor(rect.w)));
    const sh = Math.max(1, Math.min(height - sy, Math.floor(rect.h)));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, sw, sh);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

    return canvas;
}

function scaleCanvasForOcr(canvas) {
    const scale = Math.max(1, MIN_OCR_WIDTH / canvas.width, MIN_OCR_HEIGHT / canvas.height);
    if (scale <= 1) return canvas;

    const scaled = document.createElement('canvas');
    scaled.width = Math.ceil(canvas.width * scale);
    scaled.height = Math.ceil(canvas.height * scale);

    const context = scaled.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, scaled.width, scaled.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    return scaled;
}

function maskTextPixelsForOcr(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = pixelIndex(width, x, y);
            if (isHeaderTextPixel(data, width, x, y)) {
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
            } else {
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
            }
            data[i + 3] = 255;
        }
    }

    context.putImageData(imageData, 0, 0);
    return canvas;
}

function grayscaleCanvasForOcr(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;

    for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const contrast = Math.max(0, Math.min(255, (lum - 110) * 2.2 + 128));
        data[i] = contrast;
        data[i + 1] = contrast;
        data[i + 2] = contrast;
        data[i + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
    return canvas;
}

function buildOcrVariants(sourceCanvas) {
    const masked = scaleCanvasForOcr(maskTextPixelsForOcr(sourceCanvas));
    const grayscale = scaleCanvasForOcr(grayscaleCanvasForOcr(sourceCanvas));
    const raw = scaleCanvasForOcr(sourceCanvas);
    return [masked, grayscale, raw];
}

function rowTextDensity(data, width, y) {
    let count = 0;
    for (let x = 0; x < width; x += 1) {
        if (isHeaderTextPixel(data, width, x, y)) count += 1;
    }
    return count / width;
}

function rowSeparatorDensity(data, width, y) {
    let count = 0;
    for (let x = 0; x < width; x += 1) {
        if (isSeparatorPixel(data, width, x, y)) count += 1;
    }
    return count / width;
}

function findTextRuns(rowDensities, width, minHeight = 4) {
    const threshold = Math.max(0.02, width > 0 ? 0.018 : 0.02);
    const runs = [];
    let start = null;

    for (let y = 0; y < rowDensities.length; y += 1) {
        if (rowDensities[y] >= threshold) {
            if (start === null) start = y;
        } else if (start !== null) {
            if (y - start >= minHeight) runs.push({ y0: start, y1: y - 1 });
            start = null;
        }
    }

    if (start !== null && rowDensities.length - start >= minHeight) {
        runs.push({ y0: start, y1: rowDensities.length - 1 });
    }

    return runs;
}

function findHorizontalSeparatorY(data, width, height) {
    let bestY = null;
    let bestScore = 0;

    for (let y = Math.floor(height * 0.08); y < Math.floor(height * 0.45); y += 1) {
        const separatorDensity = rowSeparatorDensity(data, width, y);
        const textDensity = rowTextDensity(data, width, y);
        if (separatorDensity < 0.28) continue;
        if (textDensity > 0.12) continue;

        const score = separatorDensity - textDensity * 0.5;
        if (score > bestScore) {
            bestScore = score;
            bestY = y;
        }
    }

    return bestY;
}

function detectTextBoundsInCanvas(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;

    const colCounts = new Array(width).fill(0);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (isHeaderTextPixel(data, width, x, y)) colCounts[x] += 1;
        }
    }

    const colThreshold = Math.max(2, Math.floor(height * 0.24));
    let minX = width;
    let maxX = 0;

    for (let x = 0; x < width; x += 1) {
        if (colCounts[x] >= colThreshold) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
        }
    }

    if (minX >= width || maxX <= minX) {
        return null;
    }

    const paddingX = Math.max(1, Math.floor((maxX - minX) * 0.01));
    return {
        x: Math.max(0, minX - paddingX),
        w: Math.min(width, maxX - minX + 1 + paddingX * 2)
    };
}

function toImageRect(offsetX, offsetY, canvasWidth, bounds, y0, y1) {
    const left = Math.floor(canvasWidth * TEXT_LEFT_RATIO);
    const right = Math.floor(canvasWidth * TEXT_RIGHT_RATIO);
    const localX = Math.max(left, bounds?.x ?? left);
    const x = offsetX + localX;
    const maxW = offsetX + right - x;
    const w = Math.min(bounds?.w ?? (right - left), maxW);

    return {
        x,
        y: offsetY + y0,
        w: Math.max(1, w),
        h: y1 - y0 + 1
    };
}

function detectHeaderTextLineRects(image) {
    const { canvas, offsetX, offsetY } = cropImageBand(image, HEADER_SCAN_BAND);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;

    const separatorY = findHorizontalSeparatorY(data, width, height);
    const imageHeight = image.naturalHeight || image.height;
    const imageWidth = image.naturalWidth || image.width;

    if (separatorY !== null) {
        const abbrCanvas = document.createElement('canvas');
        const abbrHeight = Math.max(4, separatorY - 2);
        abbrCanvas.width = width;
        abbrCanvas.height = abbrHeight;
        abbrCanvas.getContext('2d').drawImage(canvas, 0, 0, width, abbrHeight, 0, 0, width, abbrHeight);

        const titleTop = Math.min(height - 4, separatorY + 3);
        const titleBottom = Math.min(height - 1, Math.max(titleTop + 4, Math.floor(imageHeight * 0.33) - offsetY));
        const titleHeight = Math.max(4, titleBottom - titleTop);
        const titleCanvas = document.createElement('canvas');
        titleCanvas.width = width;
        titleCanvas.height = titleHeight;
        titleCanvas.getContext('2d').drawImage(canvas, 0, titleTop, width, titleHeight, 0, 0, width, titleHeight);

        const abbrBounds = detectTextBoundsInCanvas(abbrCanvas);
        const titleBounds = detectTextBoundsInCanvas(titleCanvas);

        return [
            toImageRect(offsetX, offsetY, width, abbrBounds, 0, abbrHeight - 1),
            toImageRect(offsetX, offsetY, width, titleBounds, titleTop, titleTop + titleHeight - 1)
        ];
    }

    const rowDensities = new Array(height).fill(0);
    for (let y = 0; y < height; y += 1) {
        rowDensities[y] = rowTextDensity(data, width, y);
    }

    const runs = findTextRuns(rowDensities, width).slice(0, 2);
    return runs.map(run => {
        const lineCanvas = document.createElement('canvas');
        const lineHeight = run.y1 - run.y0 + 1;
        lineCanvas.width = width;
        lineCanvas.height = lineHeight;
        lineCanvas.getContext('2d').drawImage(canvas, 0, run.y0, width, lineHeight, 0, 0, width, lineHeight);
        const bounds = detectTextBoundsInCanvas(lineCanvas);
        const paddingY = Math.max(1, Math.floor(lineHeight * 0.15));
        return toImageRect(
            offsetX,
            offsetY,
            width,
            bounds,
            Math.max(0, run.y0 - paddingY),
            Math.min(height - 1, run.y1 + paddingY)
        );
    });
}

async function recognizePreparedCanvas(worker, canvas, { preserveSpaces = false } = {}) {
    await worker.setParameters({ tessedit_pageseg_mode: SINGLE_LINE_PSM });
    const { data } = await worker.recognize(canvas);
    const text = sanitizeOcrOutput(data.text ?? '', { preserveSpaces });
    const confidence = data.confidence ?? 0;
    return { text, confidence };
}

async function recognizeLineRect(worker, image, rect, { preserveSpaces = false } = {}) {
    const sourceCanvas = cropImageRect(image, rect);
    const variants = buildOcrVariants(sourceCanvas);

    let best = { text: '', confidence: -1 };
    for (const canvas of variants) {
        const result = await recognizePreparedCanvas(worker, canvas, { preserveSpaces });
        if (!result.text) continue;
        if (result.confidence > best.confidence) {
            best = result;
        }
    }

    if (best.text && best.confidence < MIN_CONFIDENCE) {
        const secondPass = await recognizePreparedCanvas(worker, variants[1], { preserveSpaces });
        if (secondPass.confidence > best.confidence) {
            best = secondPass;
        }
    }

    return best;
}

function isBetterTitleCandidate(nextTitle, abbr) {
    if (!nextTitle) return false;
    if (!abbr) return true;
    if (nextTitle === abbr) return false;
    if (/[|｜—―]{2,}/.test(nextTitle)) return false;
    if (nextTitle.startsWith(abbr) && nextTitle.length <= abbr.length + 2) return false;
    return true;
}

function finalizeEventHeaderResult(result) {
    const abbr = sanitizeOcrOutput(result.abbr ?? '', { preserveSpaces: false });
    let title = sanitizeOcrOutput(result.title ?? '', { preserveSpaces: true });

    if (title && abbr && title === abbr) {
        title = '';
    }

    if (!isBetterTitleCandidate(title, abbr)) {
        title = '';
    }

    return { abbr, title };
}

/**
 * 自動 OCR が参照する領域（デバッグ表示用）
 * @param {HTMLImageElement} image
 */
export function getEventNameOcrRegions(image) {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const { canvas, offsetX, offsetY } = cropImageBand(image, HEADER_SCAN_BAND);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const separatorLocalY = findHorizontalSeparatorY(imageData.data, width, height);
    const lineRects = detectHeaderTextLineRects(image);

    return {
        headerScan: {
            x: 0,
            y: 0,
            w: imageWidth,
            h: Math.max(1, Math.floor(imageHeight * HEADER_SCAN_BAND.height)),
            label: '走査範囲'
        },
        separator: separatorLocalY === null ? null : {
            x: offsetX,
            y: offsetY + separatorLocalY,
            w: width,
            h: Math.max(2, Math.floor(imageHeight * 0.004)),
            label: '区切り線'
        },
        abbr: lineRects[0] ? { ...lineRects[0], label: '略称' } : null,
        title: lineRects[1] ? { ...lineRects[1], label: '正式名' } : null
    };
}

/**
 * 画像上の任意矩形から文字を OCR する。
 * @param {HTMLImageElement} image
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @returns {Promise<string>}
 */
export async function recognizeTextFromImageRect(image, rect) {
    const worker = await getOcrWorker();
    const result = await recognizeLineRect(worker, image, rect, { preserveSpaces: true });

    if (!result.text) {
        throw new Error('文字を読み取れませんでした。領域を大きくして再試行してください。');
    }

    return result.text;
}

/**
 * イベントスクショ上部から略称（1行目）と正式名（2行目）を OCR で取得する。
 * @param {HTMLImageElement} image
 * @returns {Promise<{ abbr: string, title: string }>}
 */
export async function extractEventNamesFromImage(image) {
    const worker = await getOcrWorker();
    const lineRects = detectHeaderTextLineRects(image);

    let abbr = '';
    let title = '';

    if (lineRects.length >= 1) {
        const abbrResult = await recognizeLineRect(worker, image, lineRects[0], { preserveSpaces: false });
        abbr = abbrResult.text;
    }

    if (lineRects.length >= 2) {
        const titleResult = await recognizeLineRect(worker, image, lineRects[1], { preserveSpaces: true });
        title = titleResult.text;
    }

    const result = finalizeEventHeaderResult({ abbr, title });

    if (!result.abbr) {
        throw new Error('イベント略称を読み取れませんでした。');
    }

    return result;
}
