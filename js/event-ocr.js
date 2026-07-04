const TESSERACT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';
const TESSERACT_WORKER_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js';
const TESSERACT_CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js';
const TESSERACT_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

/** 1行目（略称）の切り出し範囲 */
const ABBR_BAND = { top: 0, height: 0.17, left: 0.03, right: 0.99 };
/** 2行目（正式名）の切り出し範囲 */
const TITLE_BAND = { top: 0.13, height: 0.18, left: 0.03, right: 0.99 };
/** フォールバック用のヘッダー全体 */
const HEADER_BAND = { top: 0, height: 0.34, left: 0.03, right: 0.99 };
const MIN_OCR_WIDTH = 640;
const SINGLE_LINE_PSM = '7';
const LINE_GROUP_Y_TOLERANCE = 14;

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

            return Tesseract.createWorker('jpn', 1, {
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

function normalizeEventOcrText(text) {
    return text
        .replace(/[\r\n\t]+/g, '')
        .replace(/\s+/g, '')
        .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/[！-～]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/[　]/g, '')
        .trim();
}

function cropImageBand(image, band) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    const sx = Math.floor(width * band.left);
    const sy = Math.floor(height * band.top);
    const sw = Math.max(1, Math.floor(width * (band.right - band.left)));
    const sh = Math.max(1, Math.floor(height * band.height));
    const scale = Math.max(1, MIN_OCR_WIDTH / sw);

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(sw * scale);
    canvas.height = Math.ceil(sh * scale);

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = scale > 1;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    return canvas;
}

function enhanceHeaderCanvasForOcr(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;

    for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const value = lum < 150 ? 0 : 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
    return canvas;
}

function parseEventHeaderLines(lines) {
    const candidates = lines
        .map(line => ({
            text: normalizeEventOcrText(typeof line === 'string' ? line : (line.text ?? '')),
            y0: line.bbox?.y0 ?? 0
        }))
        .filter(line => line.text.length >= 2)
        .sort((left, right) => left.y0 - right.y0);

    return {
        abbr: candidates[0]?.text ?? '',
        title: candidates[1]?.text ?? ''
    };
}

function parseEventHeaderText(rawText) {
    const lines = rawText
        .split(/\r?\n/)
        .map(line => normalizeEventOcrText(line))
        .filter(line => line.length >= 2);

    return {
        abbr: lines[0] ?? '',
        title: lines[1] ?? ''
    };
}

function parseEventHeaderWords(words) {
    const candidates = (words ?? [])
        .map(word => ({
            text: normalizeEventOcrText(word.text ?? ''),
            y0: word.bbox?.y0 ?? 0
        }))
        .filter(word => word.text.length >= 1)
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
            lines.push(normalizeEventOcrText(currentLine.parts.join('')));
            currentLine = { y0: word.y0, parts: [word.text] };
        }
    }
    lines.push(normalizeEventOcrText(currentLine.parts.join('')));

    const filtered = lines.filter(line => line.length >= 2);
    return {
        abbr: filtered[0] ?? '',
        title: filtered[1] ?? ''
    };
}

function mergeEventHeaderResults(...results) {
    let abbr = '';
    let title = '';

    for (const result of results) {
        if (!abbr && result.abbr) abbr = result.abbr;
        if (!title && result.title) title = result.title;
    }

    return { abbr, title };
}

function parseEventHeaderResult(data) {
    return mergeEventHeaderResults(
        parseEventHeaderLines(data.lines ?? []),
        parseEventHeaderWords(data.words ?? []),
        parseEventHeaderText(data.text ?? '')
    );
}

function isBetterTitleCandidate(nextTitle, abbr) {
    if (!nextTitle) return false;
    if (!abbr) return true;
    if (nextTitle === abbr) return false;
    return nextTitle.length >= abbr.length;
}

function finalizeEventHeaderResult(result) {
    const abbr = result.abbr ?? '';
    let title = result.title ?? '';

    if (title && abbr && title === abbr) {
        title = '';
    }

    if (title && abbr && title.startsWith(abbr) && title.length > abbr.length + 2) {
        const remainder = title.slice(abbr.length);
        if (remainder.length >= 2) {
            title = remainder;
        }
    }

    if (!isBetterTitleCandidate(title, abbr)) {
        title = '';
    }

    return { abbr, title };
}

async function recognizeBandText(worker, image, band) {
    const canvas = enhanceHeaderCanvasForOcr(cropImageBand(image, band));
    await worker.setParameters({ tessedit_pageseg_mode: SINGLE_LINE_PSM });
    const { data } = await worker.recognize(canvas);
    return normalizeEventOcrText(data.text ?? '');
}

async function recognizeHeaderBlock(worker, image) {
    const canvas = enhanceHeaderCanvasForOcr(cropImageBand(image, HEADER_BAND));
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const { data } = await worker.recognize(canvas);
    return parseEventHeaderResult(data);
}

function cropImageRect(image, rect) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    const sx = Math.max(0, Math.min(width - 1, Math.floor(rect.x)));
    const sy = Math.max(0, Math.min(height - 1, Math.floor(rect.y)));
    const sw = Math.max(1, Math.min(width - sx, Math.floor(rect.w)));
    const sh = Math.max(1, Math.min(height - sy, Math.floor(rect.h)));
    const scale = Math.max(1, MIN_OCR_WIDTH / sw);

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(sw * scale);
    canvas.height = Math.ceil(sh * scale);

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = scale > 1;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    return canvas;
}

async function recognizeCanvasText(worker, canvas) {
    const aspect = canvas.height / Math.max(1, canvas.width);
    const psm = aspect > 0.45 ? '6' : SINGLE_LINE_PSM;
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(canvas);
    return normalizeEventOcrText(data.text ?? '');
}

/**
 * 画像上の任意矩形から文字を OCR する。
 * @param {HTMLImageElement} image
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @returns {Promise<string>}
 */
export async function recognizeTextFromImageRect(image, rect) {
    const worker = await getOcrWorker();
    const canvas = enhanceHeaderCanvasForOcr(cropImageRect(image, rect));
    const text = await recognizeCanvasText(worker, canvas);

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

    const abbrText = await recognizeBandText(worker, image, ABBR_BAND);
    const titleText = await recognizeBandText(worker, image, TITLE_BAND);
    const blockResult = await recognizeHeaderBlock(worker, image);

    const merged = mergeEventHeaderResults(
        { abbr: abbrText, title: '' },
        { abbr: '', title: titleText },
        blockResult
    );

    const result = finalizeEventHeaderResult(merged);

    if (!result.abbr) {
        throw new Error('イベント略称を読み取れませんでした。');
    }

    return result;
}
