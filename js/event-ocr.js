const TESSERACT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';
const TESSERACT_WORKER_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js';
const TESSERACT_CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js';
const TESSERACT_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

/** スクショ上部のイベント名テキスト領域（精霊アイコンより上） */
const HEADER_TOP_RATIO = 0;
const HEADER_HEIGHT_RATIO = 0.34;
const HEADER_LEFT_RATIO = 0.03;
const HEADER_RIGHT_RATIO = 0.99;
const MIN_OCR_WIDTH = 640;

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

function cropEventHeaderCanvas(image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    const sx = Math.floor(width * HEADER_LEFT_RATIO);
    const sy = Math.floor(height * HEADER_TOP_RATIO);
    const sw = Math.max(1, Math.floor(width * (HEADER_RIGHT_RATIO - HEADER_LEFT_RATIO)));
    const sh = Math.max(1, Math.floor(height * HEADER_HEIGHT_RATIO));
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

    if (candidates.length === 0) {
        return { abbr: '', title: '' };
    }

    if (candidates.length === 1) {
        return { abbr: candidates[0].text, title: '' };
    }

    return {
        abbr: candidates[0].text,
        title: candidates[1].text
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

function parseEventHeaderResult(data) {
    const fromLines = parseEventHeaderLines(data.lines ?? []);
    if (fromLines.abbr) return fromLines;
    return parseEventHeaderText(data.text ?? '');
}

/**
 * イベントスクショ上部から略称（1行目）と正式名（2行目）を OCR で取得する。
 * @param {HTMLImageElement} image
 * @returns {Promise<{ abbr: string, title: string }>}
 */
export async function extractEventNamesFromImage(image) {
    const worker = await getOcrWorker();
    const headerCanvas = enhanceHeaderCanvasForOcr(cropEventHeaderCanvas(image));
    const { data } = await worker.recognize(headerCanvas);
    const result = parseEventHeaderResult(data);

    if (!result.abbr) {
        throw new Error('イベント名を読み取れませんでした。');
    }

    return result;
}
