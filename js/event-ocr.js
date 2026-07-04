const TESSERACT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';
const TESSERACT_WORKER_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js';
const TESSERACT_CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js';
const TESSERACT_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

const HEADER_SCAN_BAND = { top: 0, height: 0.5, left: 0, right: 1 };
const TEXT_LEFT_RATIO = 0.02;
const TEXT_RIGHT_RATIO = 0.99;
const MIN_TEXT_RUN_HEIGHT = 6;
const REFERENCE_MIN_RUN_HEIGHT = 10;
const BANNER_TITLE_ZONE_TOP = 0.22;
const BANNER_TITLE_ZONE_BOTTOM = 0.38;
const MAX_SEPARATOR_RUN_HEIGHT = 7;
const MIN_OCR_WIDTH = 1600;
const MIN_OCR_HEIGHT = 56;
const SINGLE_LINE_PSM = '7';
const AUTO_PSM = '6';
const MIN_CONFIDENCE = 42;
const MAX_OCR_CANDIDATES = 5;
const ICON_ROW_SAT_THRESHOLD = 0.32;
const ICON_ROW_MIN_DENSITY = 0.08;
const ICON_ROW_MIN_HEIGHT = 14;

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
        .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, char => {
            const map = { 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V', 'Ⅵ': 'VI', 'Ⅶ': 'VII', 'Ⅷ': 'VIII', 'Ⅸ': 'IX', 'Ⅹ': 'X' };
            return map[char] ?? char;
        })
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
        .replace(/[Xx×](?=$)/g, '')
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

    if (isDecorativePillarPixel(r, g, b)) return false;
    if (lum > 152) return false;
    if (lum < 112) return true;
    if (lum > 120 && sat < 0.16) return false;
    return lum < 125 && sat > 0.24;
}

function isSeparatorPixel(data, width, x, y) {
    const { lum, sat } = getPixelLuminance(data, width, x, y);
    return lum >= 40 && lum <= 115 && sat < 0.22;
}

function isDecorativePillarPixel(r, g, b) {
    return r > 145 && g > 95 && b < 95 && r > g && g > b * 1.1;
}

function findDecorativePillarRightX(data, width, height) {
    const scanWidth = Math.min(width, Math.floor(width * 0.12));
    let inPillar = false;
    let rightEdge = 0;

    for (let x = 0; x < scanWidth; x += 1) {
        let pillarRows = 0;
        for (let y = 0; y < height; y += 1) {
            const { r, g, b } = getPixelLuminance(data, width, x, y);
            if (isDecorativePillarPixel(r, g, b)) pillarRows += 1;
        }
        const isPillarCol = pillarRows >= Math.max(3, Math.floor(height * 0.12));
        if (isPillarCol) {
            inPillar = true;
            rightEdge = x + 1;
            continue;
        }
        if (inPillar) break;
    }

    return rightEdge;
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

function computeOtsuThreshold(histogram, totalPixels) {
    let sum = 0;
    for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

    let sumB = 0;
    let weightB = 0;
    let maxVariance = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t += 1) {
        weightB += histogram[t];
        if (weightB === 0) continue;

        const weightF = totalPixels - weightB;
        if (weightF === 0) break;

        sumB += t * histogram[t];
        const meanB = sumB / weightB;
        const meanF = (sum - sumB) / weightF;
        const variance = weightB * weightF * (meanB - meanF) ** 2;

        if (variance > maxVariance) {
            maxVariance = variance;
            threshold = t;
        }
    }

    return threshold;
}

function binarizeCanvasForOcr(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;
    const histogram = new Array(256).fill(0);

    for (let i = 0; i < data.length; i += 4) {
        const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        histogram[lum] += 1;
    }

    const threshold = computeOtsuThreshold(histogram, width * height);

    for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const value = lum < threshold ? 0 : 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
    return canvas;
}

function buildOcrVariants(sourceCanvas) {
    const binarized = scaleCanvasForOcr(binarizeCanvasForOcr(sourceCanvas));
    const masked = scaleCanvasForOcr(maskTextPixelsForOcr(sourceCanvas));
    return [binarized, masked];
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

function findTextRuns(rowDensities, width, minHeight = MIN_TEXT_RUN_HEIGHT) {
    const threshold = Math.max(0.015, width > 0 ? 0.015 : 0.02);
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

function averageRunDensity(run, rowDensities) {
    let total = 0;
    for (let y = run.y0; y <= run.y1; y += 1) {
        total += rowDensities[y] ?? 0;
    }
    return total / Math.max(1, run.y1 - run.y0 + 1);
}

function isSeparatorLikeRun(run, rowDensities) {
    const height = run.y1 - run.y0 + 1;
    if (height > MAX_SEPARATOR_RUN_HEIGHT) return false;
    return averageRunDensity(run, rowDensities) >= 0.22;
}

function runHeight(run) {
    return run.y1 - run.y0 + 1;
}

function filterMeaningfulTextRuns(runs, rowDensities, minHeight = MIN_TEXT_RUN_HEIGHT) {
    return runs.filter(run => {
        const height = runHeight(run);
        if (height < minHeight) return false;
        if (isSeparatorLikeRun(run, rowDensities)) return false;
        return averageRunDensity(run, rowDensities) >= 0.02;
    });
}

function estimateReferenceLineHeight(runs, bandHeight) {
    const candidates = runs
        .filter(run => {
            const height = runHeight(run);
            return height >= REFERENCE_MIN_RUN_HEIGHT
                && height <= Math.floor(bandHeight * 0.25)
                && run.y0 < bandHeight * 0.5;
        })
        .map(run => runHeight(run))
        .sort((left, right) => left - right);

    if (candidates.length === 0) return null;
    return candidates[Math.floor(candidates.length / 2)];
}

function computeMinimumRunHeight(referenceHeight) {
    if (referenceHeight === null) return MIN_TEXT_RUN_HEIGHT;
    return Math.max(
        MIN_TEXT_RUN_HEIGHT,
        Math.ceil(referenceHeight * 0.55)
    );
}

function resolveHeaderRunHeightThresholds(data, width, height, separatorY, minLeft = 0) {
    let referenceRun = null;

    if (separatorY !== null) {
        referenceRun = findTopmostTextRun(
            data,
            width,
            Math.min(height - 1, separatorY + 2),
            height - 1,
            REFERENCE_MIN_RUN_HEIGHT
        );
    } else {
        const titleSearchStart = Math.floor(height * BANNER_TITLE_ZONE_TOP);
        const titleSearchEnd = Math.min(height - 1, Math.floor(height * BANNER_TITLE_ZONE_BOTTOM));
        referenceRun = findTopmostTextRun(
            data,
            width,
            titleSearchStart,
            titleSearchEnd,
            REFERENCE_MIN_RUN_HEIGHT
        );
    }

    let referenceHeight = referenceRun ? runHeight(referenceRun) : null;
    if (referenceHeight === null) {
        const rowDensities = buildRowDensities(data, width, 0, height - 1);
        const rawRuns = filterMeaningfulTextRuns(
            findTextRuns(rowDensities, width),
            rowDensities
        );
        referenceHeight = estimateReferenceLineHeight(rawRuns, height);
    }

    const minRunHeight = computeMinimumRunHeight(referenceHeight);
    const minAbbrRunHeight = Math.max(
        MIN_TEXT_RUN_HEIGHT,
        Math.floor(minRunHeight * 0.55)
    );

    return { minRunHeight, minAbbrRunHeight };
}

function findTextRunInBand(data, width, yStart, yEnd, minHeight, strategy = 'primary') {
    const rowDensities = buildRowDensities(data, width, yStart, yEnd);
    const runs = filterMeaningfulTextRuns(
        findTextRuns(rowDensities, width, minHeight),
        rowDensities,
        minHeight
    );
    if (runs.length === 0) return null;

    if (strategy === 'topmost') {
        runs.sort((left, right) => left.y0 - right.y0);
    } else {
        runs.sort((left, right) => {
            const heightDiff = runHeight(right) - runHeight(left);
            if (heightDiff !== 0) return heightDiff;
            return left.y0 - right.y0;
        });
    }

    const run = runs[0];
    return {
        y0: yStart + run.y0,
        y1: yStart + run.y1
    };
}

function buildRowDensities(data, width, yStart, yEnd) {
    const rowDensities = [];
    for (let y = yStart; y <= yEnd; y += 1) {
        rowDensities.push(rowTextDensity(data, width, y));
    }
    return rowDensities;
}

function findPrimaryTextRun(data, width, yStart, yEnd, minHeight = MIN_TEXT_RUN_HEIGHT) {
    return findTextRunInBand(data, width, yStart, yEnd, minHeight, 'primary');
}

function findTopmostTextRun(data, width, yStart, yEnd, minHeight = MIN_TEXT_RUN_HEIGHT) {
    return findTextRunInBand(data, width, yStart, yEnd, minHeight, 'topmost');
}

function findHorizontalSeparatorY(data, width, height) {
    let bestY = null;
    let bestScore = 0;

    for (let y = Math.floor(height * 0.06); y < Math.floor(height * 0.55); y += 1) {
        const separatorDensity = rowSeparatorDensity(data, width, y);
        const textDensity = rowTextDensity(data, width, y);

        if (separatorDensity >= 0.24 && textDensity <= 0.1) {
            const score = separatorDensity - textDensity * 0.5;
            if (score > bestScore) {
                bestScore = score;
                bestY = y;
            }
            continue;
        }

        if (separatorDensity >= 0.13 && textDensity <= 0.22) {
            const score = separatorDensity - textDensity * 0.35;
            if (score > bestScore) {
                bestScore = score;
                bestY = y;
            }
        }
    }

    return bestY;
}

function detectTextBoundsInCanvas(canvas, minLeft = 0) {
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

    const colThreshold = Math.max(2, Math.floor(height * 0.08));
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

    const paddingX = Math.max(4, Math.floor(height * 0.18));
    return {
        x: Math.max(0, minX - paddingX),
        w: Math.min(width, maxX - minX + 1 + paddingX * 2)
    };
}

function toImageRect(offsetX, offsetY, canvasWidth, bounds, y0, y1, minLeft = 0) {
    const fallbackLeft = Math.max(minLeft, Math.floor(canvasWidth * TEXT_LEFT_RATIO));
    const right = Math.floor(canvasWidth * TEXT_RIGHT_RATIO);

    let localX;
    let w;
    if (bounds) {
        localX = bounds.x;
        w = bounds.w;
    } else {
        localX = fallbackLeft;
        w = right - fallbackLeft;
    }

    w = Math.min(w, right - localX);

    return {
        x: offsetX + localX,
        y: offsetY + y0,
        w: Math.max(1, w),
        h: y1 - y0 + 1
    };
}

function runToImageRect(canvas, offsetX, offsetY, canvasWidth, run, minLeft = 0) {
    const lineHeight = run.y1 - run.y0 + 1;
    const lineCanvas = document.createElement('canvas');
    lineCanvas.width = canvas.width;
    lineCanvas.height = lineHeight;
    lineCanvas.getContext('2d').drawImage(
        canvas,
        0,
        run.y0,
        canvas.width,
        lineHeight,
        0,
        0,
        canvas.width,
        lineHeight
    );

    const lineLeft = minLeft > 0 ? Math.min(minLeft + 2, Math.max(0, canvas.width - 2)) : 0;
    const ocrBounds = {
        x: lineLeft,
        w: canvas.width - lineLeft
    };
    const paddingY = Math.max(2, Math.floor(lineHeight * 0.16));
    let y0 = Math.max(0, run.y0 - paddingY);
    let y1 = Math.min(canvas.height - 1, run.y1 + paddingY);
    const minCropHeight = Math.max(24, Math.floor(lineHeight * 1.15));
    if (y1 - y0 + 1 < minCropHeight) {
        const extra = minCropHeight - (y1 - y0 + 1);
        y0 = Math.max(0, y0 - Math.floor(extra / 2));
        y1 = Math.min(canvas.height - 1, y1 + Math.ceil(extra / 2));
    }
    return toImageRect(
        offsetX,
        offsetY,
        canvasWidth,
        ocrBounds,
        y0,
        y1,
        minLeft
    );
}

function rowColorfulPixelDensity(data, width, y) {
    let count = 0;
    for (let x = 0; x < width; x += 1) {
        const { lum, sat } = getPixelLuminance(data, width, x, y);
        if (sat >= ICON_ROW_SAT_THRESHOLD && lum >= 45 && lum <= 230) count += 1;
    }
    return count / width;
}

function findSpiritIconRowTopY(data, width, height) {
    const searchStart = Math.floor(height * 0.28);
    const searchEnd = Math.floor(height * 0.92);
    let runStart = null;
    let bestTop = null;
    let bestScore = 0;

    for (let y = searchStart; y <= searchEnd; y += 1) {
        const density = rowColorfulPixelDensity(data, width, y);
        if (density >= ICON_ROW_MIN_DENSITY) {
            if (runStart === null) runStart = y;
        } else if (runStart !== null) {
            const runHeightPx = y - runStart;
            if (runHeightPx >= ICON_ROW_MIN_HEIGHT) {
                let avgDensity = 0;
                for (let row = runStart; row < y; row += 1) {
                    avgDensity += rowColorfulPixelDensity(data, width, row);
                }
                avgDensity /= runHeightPx;
                const score = avgDensity * runHeightPx;
                if (score > bestScore) {
                    bestScore = score;
                    bestTop = runStart;
                }
            }
            runStart = null;
        }
    }

    if (runStart !== null) {
        const runHeightPx = searchEnd - runStart + 1;
        if (runHeightPx >= ICON_ROW_MIN_HEIGHT) {
            let avgDensity = 0;
            for (let row = runStart; row <= searchEnd; row += 1) {
                avgDensity += rowColorfulPixelDensity(data, width, row);
            }
            avgDensity /= runHeightPx;
            const score = avgDensity * runHeightPx;
            if (score > bestScore) {
                bestTop = runStart;
            }
        }
    }

    return bestTop;
}

function measureRunReadability(data, width, run, minLeft) {
    let satSum = 0;
    let lumSum = 0;
    let count = 0;

    for (let y = run.y0; y <= run.y1; y += 1) {
        for (let x = minLeft; x < width; x += 1) {
            if (!isHeaderTextPixel(data, width, x, y)) continue;
            const { lum, sat } = getPixelLuminance(data, width, x, y);
            satSum += sat;
            lumSum += lum;
            count += 1;
        }
    }

    if (count === 0) {
        return { avgSat: 1, avgLum: 255, readability: 0, decorative: true };
    }

    const avgSat = satSum / count;
    const avgLum = lumSum / count;
    const readability = Math.max(0, 1 - avgSat * 1.8) * Math.max(0, (130 - avgLum) / 130);
    const decorative = avgSat > 0.42 && avgLum > 55;

    return { avgSat, avgLum, readability, decorative };
}

function findAllMeaningfulTextRuns(data, width, yStart, yEnd, minHeight) {
    const rowDensities = buildRowDensities(data, width, yStart, yEnd);
    return filterMeaningfulTextRuns(
        findTextRuns(rowDensities, width, minHeight),
        rowDensities,
        minHeight
    ).map(run => ({
        y0: yStart + run.y0,
        y1: yStart + run.y1
    }));
}

function candidatePreferPreserveSpaces({ aboveSeparator, readability, avgSat, decorative }) {
    if (aboveSeparator) return false;
    if (decorative) return false;
    return readability > 0.45 && avgSat < 0.24;
}

function expandRunsWithSeparatorSplit(runs, separatorY) {
    if (separatorY === null) return runs;

    const expanded = [];
    for (const run of runs) {
        if (run.y0 + 8 < separatorY && run.y1 - 8 > separatorY) {
            expanded.push({ y0: run.y0, y1: Math.max(run.y0, separatorY - 6) });
            expanded.push({ y0: Math.min(run.y1, separatorY + 6), y1: run.y1 });
            continue;
        }
        expanded.push(run);
    }

    return expanded;
}

function analyzeHeaderBand(image) {
    const { canvas, offsetX, offsetY } = cropImageBand(image, HEADER_SCAN_BAND);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;

    const separatorY = findHorizontalSeparatorY(data, width, height);
    const minLeft = findDecorativePillarRightX(data, width, height);
    const iconRowTopY = findSpiritIconRowTopY(data, width, height);
    const searchEndY = iconRowTopY === null
        ? height - 1
        : Math.max(Math.floor(height * 0.2), iconRowTopY - Math.max(6, Math.floor(height * 0.03)));

    const { minRunHeight, minAbbrRunHeight } = resolveHeaderRunHeightThresholds(
        data,
        width,
        height,
        separatorY,
        minLeft
    );

    const minHeight = Math.min(minAbbrRunHeight, minRunHeight);
    const rawRuns = findAllMeaningfulTextRuns(data, width, 0, searchEndY, minHeight);
    const runs = expandRunsWithSeparatorSplit(rawRuns, separatorY);

    return {
        canvas,
        offsetX,
        offsetY,
        width,
        height,
        data,
        separatorY,
        minLeft,
        iconRowTopY,
        minRunHeight,
        minAbbrRunHeight,
        runs
    };
}

function collectHeaderTextLineCandidates(image) {
    const band = analyzeHeaderBand(image);
    const {
        canvas,
        offsetX,
        offsetY,
        width,
        data,
        separatorY,
        minLeft,
        runs
    } = band;

    const candidates = runs.map((run, index) => {
        const metrics = measureRunReadability(data, width, run, minLeft);
        const centerY = (run.y0 + run.y1) / 2;
        const aboveSeparator = separatorY !== null && centerY < separatorY - 1;
        const belowSeparator = separatorY !== null && centerY > separatorY + 1;
        const rect = runToImageRect(canvas, offsetX, offsetY, width, run, minLeft);

        return {
            index,
            run,
            rect,
            aboveSeparator,
            belowSeparator,
            lineHeight: runHeight(run),
            centerY,
            preferPreserveSpaces: candidatePreferPreserveSpaces({
                aboveSeparator,
                readability: metrics.readability,
                avgSat: metrics.avgSat
            }),
            ...metrics
        };
    });

    candidates.sort((left, right) => left.centerY - right.centerY);
    return candidates
        .filter(candidate => candidate.lineHeight >= 8)
        .filter(candidate => band.iconRowTopY === null || candidate.centerY < band.iconRowTopY - 4)
        .slice(0, MAX_OCR_CANDIDATES);
}

function syncRoleScore(candidate, role) {
    let score = candidate.readability * 100;

    if (role === 'abbr') {
        if (candidate.aboveSeparator) score += 35;
        if (candidate.belowSeparator) score -= 25;
        if (candidate.decorative) score -= 40;
        score += Math.max(0, 24 - candidate.centerY * 0.15);
        score += Math.max(0, 18 - candidate.lineHeight * 0.35);
    } else {
        if (candidate.belowSeparator) score += 35;
        if (candidate.aboveSeparator) score -= 10;
        if (candidate.decorative) score -= 50;
        score += candidate.readability * 40;
        score += Math.min(20, candidate.lineHeight * 0.25);
    }

    return score;
}

function selectSyncLineRoles(candidates, bandHeight = 240) {
    if (candidates.length === 0) {
        return { abbr: null, title: null };
    }

    const substantial = candidates
        .filter(candidate => candidate.lineHeight >= 10)
        .filter(candidate => !candidate.decorative || candidate.readability > 0.2)
        .filter(candidate => candidate.centerY < bandHeight * 0.65)
        .sort((left, right) => left.centerY - right.centerY);

    if (substantial.length >= 2) {
        return {
            abbr: substantial[0].rect,
            title: substantial[1].rect
        };
    }

    const sorted = [...candidates].sort((left, right) => left.centerY - right.centerY);
    let abbrCandidate = null;
    let titleCandidate = null;

    for (const candidate of sorted) {
        const abbrScore = syncRoleScore(candidate, 'abbr');
        if (!abbrCandidate || abbrScore > abbrCandidate.score) {
            abbrCandidate = { candidate, score: abbrScore };
        }
    }

    for (const candidate of sorted) {
        if (candidate.index === abbrCandidate?.candidate.index) continue;
        const titleScore = syncRoleScore(candidate, 'title');
        if (!titleCandidate || titleScore > titleCandidate.score) {
            titleCandidate = { candidate, score: titleScore };
        }
    }

    if (!titleCandidate && sorted.length >= 2) {
        titleCandidate = {
            candidate: sorted.find(item => item.index !== abbrCandidate?.candidate.index) ?? sorted[1],
            score: 0
        };
    }

    return {
        abbr: abbrCandidate?.candidate.rect ?? null,
        title: titleCandidate?.candidate.rect ?? null
    };
}

function japaneseCharRatio(text) {
    if (!text) return 0;
    const matches = text.match(/[\u3040-\u9fff\u30a0-\u30ff]/gu) ?? [];
    return matches.length / text.length;
}

function latinCharRatio(text) {
    if (!text) return 0;
    const matches = text.match(/[A-Za-z]/g) ?? [];
    return matches.length / Math.max(1, text.length);
}

function gibberishPenalty(text) {
    if (!text) return 100;
    let penalty = 0;

    if (/[^\u3040-\u9fff\u30a0-\u30ffA-Za-z0-9・ \-_.:;!?()（）「」『』\u2160-\u217FⅠ-Ⅻ]/u.test(text)) {
        penalty += 28;
    }
    if (/(.)\1{3,}/u.test(text)) penalty += 18;
    if (/^[)\]}>（『「].+[(\[{<（『「]/u.test(text)) penalty += 20;
    if (text.length >= 4 && japaneseCharRatio(text) < 0.08 && latinCharRatio(text) < 0.2) {
        penalty += 25;
    }
    if ((text.match(/ [\u3040-\u9fff\u30a0-\u30ff]/gu) ?? []).length >= 2) {
        penalty += 35;
    }

    return penalty;
}

function scoreOcrCandidate(candidate, role, text, confidence) {
    if (!text) return -1000;

    let score = confidence;
    const jpRatio = japaneseCharRatio(text);
    const enRatio = latinCharRatio(text);

    score -= gibberishPenalty(text);
    score += candidate.readability * 35;
    score += syncRoleScore(candidate, role) * 0.45;

    if (role === 'abbr') {
        score += jpRatio * 40;
        if (enRatio > 0.55 && jpRatio < 0.15) score -= 35;
        if (text.length > 24) score -= 25;
        if (text.length <= 16) score += 8;
    } else {
        score += Math.min(20, text.length * 0.8);
        if (/EPISODE|Memorial|Blood|Vanishing|Zero|Magna|Glorious/i.test(text)) score += 22;
        if (jpRatio > 0.15 && enRatio > 0.08) score += 18;
        if (candidate.decorative && jpRatio < 0.2) score -= 30;
    }

    return score;
}

function sortCandidatesForRole(candidates, role) {
    return [...candidates]
        .map(candidate => ({ candidate, score: syncRoleScore(candidate, role) }))
        .sort((left, right) => right.score - left.score);
}

function buildFallbackLineRects(image, minLeft = 0) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const x = Math.max(Math.floor(width * 0.02), minLeft + 4);
    const widthSpan = Math.max(1, Math.floor(width * 0.96) - (x - Math.floor(width * 0.02)));

    return {
        abbr: {
            x,
            y: Math.floor(height * 0.08),
            w: widthSpan,
            h: Math.max(28, Math.floor(height * 0.14))
        },
        title: {
            x,
            y: Math.floor(height * 0.20),
            w: widthSpan,
            h: Math.max(24, Math.floor(height * 0.11))
        }
    };
}

function detectHeaderTextLineRects(image) {
    const band = analyzeHeaderBand(image);
    const candidates = collectHeaderTextLineCandidates(image);
    return selectSyncLineRoles(candidates, band.height);
}

async function recognizePreparedCanvas(worker, canvas, { preserveSpaces = false, psm = SINGLE_LINE_PSM } = {}) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(canvas);
    const text = sanitizeOcrOutput(data.text ?? '', { preserveSpaces });
    const confidence = data.confidence ?? 0;
    return { text, confidence };
}

async function recognizeLineRect(worker, image, rect, { preserveSpaces = false } = {}) {
    const imageWidth = image.naturalWidth || image.width;
    const padX = Math.max(6, Math.floor(rect.w * 0.015));
    const expandedRect = {
        x: Math.max(0, rect.x - padX),
        y: rect.y,
        w: Math.min(imageWidth - Math.max(0, rect.x - padX), rect.w + padX * 2),
        h: rect.h
    };
    const sourceCanvas = cropImageRect(image, expandedRect);
    const variants = buildOcrVariants(sourceCanvas);

    let best = { text: '', confidence: -1 };
    for (const canvas of variants) {
        const result = await recognizePreparedCanvas(worker, canvas, { preserveSpaces, psm: SINGLE_LINE_PSM });
        if (!result.text) continue;
        const adjustedConfidence = result.confidence - gibberishPenalty(result.text) * 0.4;
        if (adjustedConfidence > best.confidence) {
            best = { ...result, confidence: adjustedConfidence };
        }
    }

    if (best.text && best.confidence < MIN_CONFIDENCE) {
        const secondPass = await recognizePreparedCanvas(worker, variants[1], { preserveSpaces, psm: AUTO_PSM });
        const adjustedConfidence = secondPass.confidence - gibberishPenalty(secondPass.text) * 0.4;
        if (secondPass.text && adjustedConfidence > best.confidence) {
            best = { ...secondPass, confidence: adjustedConfidence };
        }
    }

    return best;
}

function looksLikeJapaneseLine(text) {
    return /[\u3040-\u9fff\u30a0-\u30ff]/.test(text);
}

function looksLikeEnglishLine(text) {
    return /[A-Za-z]{3,}/.test(text);
}

function maybeSwapAbbrAndTitle(abbr, title) {
    if (!abbr || !title) return { abbr, title };

    const abbrIsJp = looksLikeJapaneseLine(abbr);
    const titleIsJp = looksLikeJapaneseLine(title);
    const abbrIsEn = looksLikeEnglishLine(abbr);
    const titleIsEn = looksLikeEnglishLine(title);

    if (abbrIsEn && titleIsJp && !titleIsEn) {
        return { abbr: title, title: abbr };
    }

    if (abbr.length <= 3 && titleIsJp && title.length >= 4) {
        return { abbr: title, title: abbr };
    }

    return { abbr, title };
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

export function debugEventOcrAnalysis(image) {
    const band = analyzeHeaderBand(image);
    const candidates = collectHeaderTextLineCandidates(image);
    const roles = selectSyncLineRoles(candidates, band.height);

    return {
        separatorY: band.separatorY,
        minLeft: band.minLeft,
        iconRowTopY: band.iconRowTopY,
        bandHeight: band.height,
        runCount: band.runs.length,
        candidates: candidates.map(candidate => ({
            centerY: candidate.centerY,
            aboveSeparator: candidate.aboveSeparator,
            belowSeparator: candidate.belowSeparator,
            readability: Number(candidate.readability.toFixed(3)),
            decorative: candidate.decorative,
            rect: candidate.rect
        })),
        roles
    };
}

/**
 * 自動 OCR が参照する領域（デバッグ表示用）
 * @param {HTMLImageElement} image
 */
export function getEventNameOcrRegions(image) {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const band = analyzeHeaderBand(image);
    const candidates = collectHeaderTextLineCandidates(image);
    const lineRects = selectSyncLineRoles(candidates, band.height);

    return {
        headerScan: {
            x: 0,
            y: 0,
            w: imageWidth,
            h: Math.max(1, Math.floor(imageHeight * HEADER_SCAN_BAND.height)),
            label: '走査範囲'
        },
        separator: band.separatorY === null ? null : {
            x: band.offsetX,
            y: band.offsetY + band.separatorY,
            w: band.width,
            h: Math.max(2, Math.floor(imageHeight * 0.004)),
            label: '区切り線'
        },
        abbr: lineRects.abbr ? { ...lineRects.abbr, label: '略称' } : null,
        title: lineRects.title ? { ...lineRects.title, label: '正式名' } : null
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
function scorePlainOcrText(text, role) {
    if (!text) return -1000;
    let score = 100 - gibberishPenalty(text);
    const jpRatio = japaneseCharRatio(text);
    const enRatio = latinCharRatio(text);

    if (role === 'abbr') {
        score += jpRatio * 40;
        if (text.length <= 18) score += 10;
        if (enRatio > 0.5 && jpRatio < 0.2) score -= 30;
    } else {
        score += Math.min(24, text.length * 0.7);
        if (/EPISODE|Memorial|Blood|Vanishing|Magna|Glorious/i.test(text)) score += 20;
        if (jpRatio > 0.1 && enRatio > 0.08) score += 15;
    }

    return score;
}

function pickBestOcrAttempt(attempts, role) {
    let best = { text: '', score: -Infinity, preserveSpaces: role === 'title' };

    for (const attempt of attempts) {
        const text = sanitizeOcrOutput(attempt.text ?? '', { preserveSpaces: attempt.preserveSpaces });
        if (!text) continue;
        const score = scorePlainOcrText(text, role) + (attempt.confidence ?? 0) * 0.15;
        if (score > best.score) {
            best = { text, score, preserveSpaces: attempt.preserveSpaces };
        }
    }

    return best.text;
}

export async function extractEventNamesFromImage(image) {
    const worker = await getOcrWorker();
    const band = analyzeHeaderBand(image);
    const candidates = collectHeaderTextLineCandidates(image);
    const fallbackRects = buildFallbackLineRects(image, band.minLeft);
    const syncRoles = selectSyncLineRoles(candidates, band.height);

    const abbrAttempts = [];
    const titleAttempts = [];

    abbrAttempts.push({
        ...(await recognizeLineRect(worker, image, fallbackRects.abbr, { preserveSpaces: false })),
        preserveSpaces: false
    });

    titleAttempts.push({
        ...(await recognizeLineRect(worker, image, fallbackRects.title, { preserveSpaces: true })),
        preserveSpaces: true
    });
    titleAttempts.push({
        ...(await recognizeLineRect(worker, image, fallbackRects.title, { preserveSpaces: false })),
        preserveSpaces: false
    });

    if (syncRoles.abbr) {
        abbrAttempts.push({
            ...(await recognizeLineRect(worker, image, syncRoles.abbr, { preserveSpaces: false })),
            preserveSpaces: false
        });
    }

    if (syncRoles.title) {
        titleAttempts.push({
            ...(await recognizeLineRect(worker, image, syncRoles.title, { preserveSpaces: false })),
            preserveSpaces: false
        });
    }

    let abbr = pickBestOcrAttempt(abbrAttempts, 'abbr');
    let title = pickBestOcrAttempt(titleAttempts, 'title');

    ({ abbr, title } = maybeSwapAbbrAndTitle(abbr, title));

    const result = finalizeEventHeaderResult({ abbr, title });

    if (!result.abbr && !result.title) {
        throw new Error('イベント名を読み取れませんでした。');
    }

    return result;
}
