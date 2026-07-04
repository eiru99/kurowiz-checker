const TESSERACT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';
const TESSERACT_WORKER_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js';
const TESSERACT_CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js';
const TESSERACT_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

const HEADER_SCAN_BAND = { top: 0, height: 0.4, left: 0, right: 1 };
const MIN_OCR_WIDTH = 900;
const MIN_OCR_HEIGHT = 48;
const SINGLE_LINE_PSM = '7';
const LINE_GROUP_Y_TOLERANCE = 14;
const ROW_DARK_RATIO = 0.018;
const MIN_LINE_HEIGHT = 5;

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

            return Tesseract.createWorker(['jpn', 'eng'], 1, {
                workerPath: TESSERACT_WORKER_PATH,
                corePath: TESSERACT_CORE_PATH,
                langPath: TESSERACT_LANG_PATH
            });
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

function pixelIndex(width, x, y) {
    return (y * width + x) * 4;
}

function isHeaderTextPixel(data, width, x, y) {
    const i = pixelIndex(width, x, y);
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;

    if (r > 145 && g > 95 && b < 95 && r > g && g > b * 1.1) return false;
    if (lum > 150) return false;
    if (lum > 118 && sat < 0.18) return false;
    return lum < 118 || sat > 0.22;
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

function prepareCanvasForOcr(sourceCanvas) {
    return scaleCanvasForOcr(maskTextPixelsForOcr(sourceCanvas));
}

function findTextLineRuns(rowDarkCounts, width) {
    const threshold = Math.max(3, Math.floor(width * ROW_DARK_RATIO));
    const runs = [];
    let start = null;

    for (let y = 0; y < rowDarkCounts.length; y += 1) {
        if (rowDarkCounts[y] >= threshold) {
            if (start === null) start = y;
        } else if (start !== null) {
            if (y - start >= MIN_LINE_HEIGHT) {
                runs.push({ y0: start, y1: y - 1 });
            }
            start = null;
        }
    }

    if (start !== null && rowDarkCounts.length - start >= MIN_LINE_HEIGHT) {
        runs.push({ y0: start, y1: rowDarkCounts.length - 1 });
    }

    return runs;
}

function mergeNearbyRuns(runs, gap = 4) {
    if (runs.length === 0) return [];

    const merged = [{ ...runs[0] }];
    for (let i = 1; i < runs.length; i += 1) {
        const prev = merged[merged.length - 1];
        const current = runs[i];
        if (current.y0 - prev.y1 <= gap) {
            prev.y1 = current.y1;
        } else {
            merged.push({ ...current });
        }
    }
    return merged;
}

function detectTextBounds(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;

    const colCounts = new Array(width).fill(0);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (isHeaderTextPixel(data, width, x, y)) {
                colCounts[x] += 1;
            }
        }
    }

    const colThreshold = Math.max(2, Math.floor(height * 0.22));
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

    const paddingX = Math.max(2, Math.floor((maxX - minX) * 0.02));
    return {
        x: Math.max(0, minX - paddingX),
        w: Math.min(width, maxX - minX + 1 + paddingX * 2)
    };
}

function detectHeaderTextLineRects(image) {
    const { canvas, offsetX, offsetY } = cropImageBand(image, HEADER_SCAN_BAND);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;

    const rowDarkCounts = new Array(height).fill(0);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (isHeaderTextPixel(data, width, x, y)) {
                rowDarkCounts[y] += 1;
            }
        }
    }

    const mergedRuns = mergeNearbyRuns(findTextLineRuns(rowDarkCounts, width))
        .filter(run => run.y1 - run.y0 + 1 >= MIN_LINE_HEIGHT)
        .slice(0, 2);

    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const rects = [];

    for (const run of mergedRuns) {
        const lineCanvas = document.createElement('canvas');
        const lineHeight = run.y1 - run.y0 + 1;
        lineCanvas.width = width;
        lineCanvas.height = lineHeight;
        const lineContext = lineCanvas.getContext('2d', { willReadFrequently: true });
        lineContext.drawImage(canvas, 0, run.y0, width, lineHeight, 0, 0, width, lineHeight);

        const bounds = detectTextBounds(lineCanvas);
        if (!bounds) continue;

        const paddingY = Math.max(2, Math.floor(lineHeight * 0.2));
        const y0 = Math.max(0, run.y0 - paddingY);
        const y1 = Math.min(height - 1, run.y1 + paddingY);

        rects.push({
            x: offsetX + bounds.x,
            y: offsetY + y0,
            w: bounds.w,
            h: y1 - y0 + 1
        });
    }

    rects.sort((left, right) => left.y - right.y);

    if (rects.length >= 2) {
        return rects.slice(0, 2);
    }

    return rects;
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

function joinWordParts(parts) {
    return parts
        .map(part => part.trim())
        .filter(Boolean)
        .join(hasLatinText(parts.join(' ')) ? ' ' : '');
}

function parseEventHeaderLines(lines, { preserveSpaces = false } = {}) {
    const candidates = lines
        .map(line => ({
            text: normalizeEventOcrText(typeof line === 'string' ? line : (line.text ?? ''), { preserveSpaces }),
            y0: line.bbox?.y0 ?? 0
        }))
        .filter(line => line.text.length >= 2)
        .sort((left, right) => left.y0 - right.y0);

    return {
        abbr: candidates[0]?.text ?? '',
        title: candidates[1]?.text ?? ''
    };
}

function parseEventHeaderText(rawText, { preserveSpaces = false } = {}) {
    const lines = rawText
        .split(/\r?\n/)
        .map(line => normalizeEventOcrText(line, { preserveSpaces }))
        .filter(line => line.length >= 2);

    return {
        abbr: lines[0] ?? '',
        title: lines[1] ?? ''
    };
}

function parseEventHeaderWords(words, { preserveSpaces = false } = {}) {
    const candidates = (words ?? [])
        .map(word => ({
            text: word.text ?? '',
            y0: word.bbox?.y0 ?? 0
        }))
        .filter(word => word.text.trim().length >= 1)
        .sort((left, right) => left.y0 - right.y0);

    if (candidates.length === 0) {
        return { abbr: '', title: '' };
    }

    const lines = [];
    let currentLine = { y0: candidates[0].y0, parts: [candidates[0].text] };

    for (let i = 1; i < candidates.length; i += 1) {
        const word = candidates[i];
        if (Math.abs(word.y0 - currentLine.y0) <= LINE_GROUP_Y_TOLERANCE) {
            currentLine.parts.push(word.text);
        } else {
            lines.push(normalizeEventOcrText(joinWordParts(currentLine.parts), { preserveSpaces }));
            currentLine = { y0: word.y0, parts: [word.text] };
        }
    }
    lines.push(normalizeEventOcrText(joinWordParts(currentLine.parts), { preserveSpaces }));

    const filtered = lines.filter(line => line.length >= 2);
    return {
        abbr: filtered[0] ?? '',
        title: filtered[1] ?? ''
    };
}

function parseEventHeaderResult(data, { preserveSpaces = false } = {}) {
    const options = { preserveSpaces };
    const fromLines = parseEventHeaderLines(data.lines ?? [], options);
    const fromWords = parseEventHeaderWords(data.words ?? [], options);
    const fromText = parseEventHeaderText(data.text ?? '', options);

    return {
        abbr: fromLines.abbr || fromWords.abbr || fromText.abbr,
        title: fromLines.title || fromWords.title || fromText.title
    };
}

function isBetterTitleCandidate(nextTitle, abbr) {
    if (!nextTitle) return false;
    if (!abbr) return true;
    if (nextTitle === abbr) return false;
    if (nextTitle.startsWith(abbr) && nextTitle.length <= abbr.length + 2) return false;
    return true;
}

function finalizeEventHeaderResult(result) {
    const abbr = result.abbr ?? '';
    let title = result.title ?? '';

    if (title && abbr && title === abbr) {
        title = '';
    }

    if (!isBetterTitleCandidate(title, abbr)) {
        title = '';
    }

    return { abbr, title };
}

async function recognizePreparedCanvas(worker, canvas, { preserveSpaces = false } = {}) {
    await worker.setParameters({ tessedit_pageseg_mode: SINGLE_LINE_PSM });
    const { data } = await worker.recognize(canvas);
    const text = normalizeEventOcrText(data.text ?? '', { preserveSpaces });
    const confidence = data.confidence ?? 0;
    return { text, confidence };
}

async function recognizeLineRect(worker, image, rect, { preserveSpaces = false } = {}) {
    const canvas = prepareCanvasForOcr(cropImageRect(image, rect));
    return recognizePreparedCanvas(worker, canvas, { preserveSpaces });
}

async function recognizeHeaderBlock(worker, image) {
    const { canvas } = cropImageBand(image, HEADER_SCAN_BAND);
    const prepared = prepareCanvasForOcr(canvas);
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const { data } = await worker.recognize(prepared);
    return {
        abbr: parseEventHeaderResult(data, { preserveSpaces: false }),
        title: parseEventHeaderResult(data, { preserveSpaces: true })
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
    const canvas = prepareCanvasForOcr(cropImageRect(image, rect));
    const { text } = await recognizePreparedCanvas(worker, canvas, { preserveSpaces: true });

    if (!text) {
        throw new Error('文字を読み取れませんでした。領域を大きくして再試行してください。');
    }

    return text;
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

    if (!abbr || !title) {
        const block = await recognizeHeaderBlock(worker, image);
        if (!abbr) abbr = block.abbr.abbr;
        if (!title) title = block.title.title;
    }

    const result = finalizeEventHeaderResult({ abbr, title });

    if (!result.abbr) {
        throw new Error('イベント略称を読み取れませんでした。');
    }

    return result;
}
