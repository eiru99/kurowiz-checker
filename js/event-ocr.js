const TESSERACT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';
const TESSERACT_WORKER_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js';
const TESSERACT_CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js';
const TESSERACT_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

const HEADER_SCAN_BAND = { top: 0, height: 0.5, left: 0, right: 1 };
/** 略称左端 = 意匠右端 + この余白（px） */
const ABBR_ORNAMENT_GAP_PX = 6;
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
const PROJECTION_LUM_THRESHOLD = 140;
const PROJECTION_MIN_TEXT_RUN = 6;
const PROJECTION_MAX_SEPARATOR_RUN = 8;
const PROJECTION_TEXT_DENSITY_FLOOR = 0.028;
const PROJECTION_SEPARATOR_DENSITY_FLOOR = 0.10;
const PROJECTION_MERGE_GAP = 3;
const PROJECTION_SMOOTH_RADIUS = 1;

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

/** 囲み付き数字1文字を半角アラビア数字へ（未対応は null） */
function circledDigitToAscii(char) {
    const code = char.charCodeAt(0);

    if (code >= 0x2460 && code <= 0x2473) return String(code - 0x2460 + 1);
    if (code >= 0x2474 && code <= 0x2487) return String(code - 0x2474 + 1);
    if (code >= 0x2488 && code <= 0x249B) return String(code - 0x2488 + 1);
    if (code === 0x24EA || code === 0x24FF) return '0';
    if (code >= 0x24EB && code <= 0x24F4) return String(code - 0x24EB + 11);
    if (code >= 0x24F5 && code <= 0x24FE) return String(code - 0x24F5 + 1);
    if (code >= 0x2776 && code <= 0x277F) return String(code - 0x2776 + 1);
    if (code >= 0x2780 && code <= 0x2789) return String(code - 0x2780 + 1);
    if (code >= 0x278A && code <= 0x2793) return String(code - 0x278A + 1);
    if (code >= 0x3220 && code <= 0x3229) return String(code - 0x3220 + 1);
    if (code >= 0x3280 && code <= 0x3289) return String(code - 0x3280 + 1);

    return null;
}

/** 丸囲み・括弧付きなどの数字表記を半角アラビア数字へ */
function normalizeCircledDigits(text) {
    let result = '';
    for (const char of text) {
        result += circledDigitToAscii(char) ?? char;
    }

    return result
        .replace(/([0-9])\u20DD/g, '$1')
        .replace(/[○◯◎〇]\s*(?=[0-9])/g, '')
        .replace(/(?<=[0-9])\s*[○◯◎〇]/g, '')
        .replace(/[（(]\s*([0-9]+)\s*[）)]/g, '$1');
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

    return normalizeCircledDigits(result
        .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/[！-～]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, char => {
            const map = { 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V', 'Ⅵ': 'VI', 'Ⅶ': 'VII', 'Ⅷ': 'VIII', 'Ⅸ': 'IX', 'Ⅹ': 'X' };
            return map[char] ?? char;
        })
        .replace(/[　]/g, preserveSpaces ? ' ' : ''))
        .trim();
}

function sanitizeOcrOutput(text, { preserveSpaces = false, stripNoisyPrefix = false } = {}) {
    let result = normalizeEventOcrText(text, { preserveSpaces });
    if (!result) return '';

    result = result
        .replace(/[|｜—―‐─－_]{2,}/g, '')
        .replace(/[|｜—―‐─－]+/g, '')
        .replace(/(.)\1{4,}/g, '$1')
        .replace(/[Xx×](?=$)/g, '')
        .trim();

    if (stripNoisyPrefix && !preserveSpaces && result.length >= 5) {
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

function isGoldHorizontalLinePixel(r, g, b) {
    return (r > 115 && g > 72 && b < 110 && r > g && g > b)
        || (r > 100 && g > 65 && b < 85 && r > g + 4 && g > b * 1.02);
}

function isBrownSeparatorPixel(r, g, b, lum, sat) {
    return (lum >= 30 && lum <= 100 && r > 45 && r > g && g >= b && sat < 0.42)
        || (lum >= 25 && lum <= 80 && r > 70 && g < 70 && b < 60);
}

function isDecorativeLinePixel(data, width, x, y) {
    const { r, g, b, lum, sat } = getPixelLuminance(data, width, x, y);
    return isGoldHorizontalLinePixel(r, g, b) || isBrownSeparatorPixel(r, g, b, lum, sat);
}

function isSeparatorPixel(data, width, x, y) {
    return isDecorativeLinePixel(data, width, x, y);
}

function isRegionTextPixel(data, width, x, y) {
    const { r, g, b, lum, sat } = getPixelLuminance(data, width, x, y);

    if (isDecorativePillarPixel(r, g, b)) return false;
    if (isDecorativeLinePixel(data, width, x, y)) return false;
    if (lum > 168 && sat < 0.14) return false;
    if (lum > 148 && sat < 0.09) return false;
    if (lum < 98) return true;
    if (lum < 118 && sat < 0.22) return true;
    return false;
}

function buildRegionTextMask(data, width, height) {
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (isRegionTextPixel(data, width, x, y)) {
                mask[y * width + x] = 1;
            }
        }
    }
    return mask;
}

function rowDecorativeLineDensity(data, width, y, scanLeft, scanRight) {
    const span = Math.max(1, scanRight - scanLeft);
    let count = 0;
    for (let x = scanLeft; x < scanRight; x += 1) {
        if (isDecorativeLinePixel(data, width, x, y)) count += 1;
    }
    return count / span;
}

function scoreGoldLineRun(data, width, y0, y1, scanLeft, scanRight) {
    const heightPx = y1 - y0 + 1;
    if (heightPx > 10) return null;

    let avgDensity = 0;
    for (let y = y0; y <= y1; y += 1) {
        avgDensity += rowDecorativeLineDensity(data, width, y, scanLeft, scanRight);
    }
    avgDensity /= heightPx;
    if (avgDensity < 0.03) return null;

    return {
        y0,
        y1,
        centerY: (y0 + y1) / 2,
        score: avgDensity * Math.min(heightPx, 4)
    };
}

function rowMaskTextDensity(mask, width, y, scanLeft, scanRight) {
    let count = 0;
    const span = Math.max(1, scanRight - scanLeft);
    for (let x = scanLeft; x < scanRight; x += 1) {
        if (mask[y * width + x]) count += 1;
    }
    return count / span;
}

function findMaskTextRuns(mask, width, height, scanLeft, scanRight, minHeight = 8) {
    const threshold = 0.035;
    const runs = [];
    let start = null;

    for (let y = 0; y < height; y += 1) {
        const density = rowMaskTextDensity(mask, width, y, scanLeft, scanRight);
        if (density >= threshold) {
            if (start === null) start = y;
        } else if (start !== null) {
            if (y - start >= minHeight) runs.push({ y0: start, y1: y - 1 });
            start = null;
        }
    }

    if (start !== null && height - start >= minHeight) {
        runs.push({ y0: start, y1: height - 1 });
    }

    return runs;
}

function rowProjectionDarkDensity(data, width, y, scanLeft, scanRight) {
    let count = 0;
    const span = Math.max(1, scanRight - scanLeft);

    for (let x = scanLeft; x < scanRight; x += 1) {
        const { r, g, b, lum } = getPixelLuminance(data, width, x, y);
        if (isDecorativePillarPixel(r, g, b)) continue;
        if (isDecorativeLinePixel(data, width, x, y)) continue;
        if (lum < PROJECTION_LUM_THRESHOLD) count += 1;
    }

    return count / span;
}

function rowSeparatorDensityInBand(data, width, y, scanLeft, scanRight) {
    let count = 0;
    const span = Math.max(1, scanRight - scanLeft);

    for (let x = scanLeft; x < scanRight; x += 1) {
        if (isSeparatorPixel(data, width, x, y)) count += 1;
    }

    return count / span;
}

function buildHorizontalProjection(data, width, height, scanLeft, scanRight) {
    const dark = new Float64Array(height);
    const separator = new Float64Array(height);

    for (let y = 0; y < height; y += 1) {
        dark[y] = rowProjectionDarkDensity(data, width, y, scanLeft, scanRight);
        separator[y] = rowSeparatorDensityInBand(data, width, y, scanLeft, scanRight);
    }

    return { dark, separator };
}

function smoothProjection(projection, radius = PROJECTION_SMOOTH_RADIUS) {
    const smoothed = new Float64Array(projection.length);

    for (let y = 0; y < projection.length; y += 1) {
        let sum = 0;
        let count = 0;

        for (let dy = -radius; dy <= radius; dy += 1) {
            const index = y + dy;
            if (index < 0 || index >= projection.length) continue;
            sum += projection[index];
            count += 1;
        }

        smoothed[y] = count > 0 ? sum / count : projection[y];
    }

    return smoothed;
}

function computeAdaptiveProjectionThreshold(projection, yStart, yEnd) {
    const samples = [];

    for (let y = yStart; y <= yEnd; y += 1) {
        samples.push(projection[y]);
    }

    if (samples.length === 0) return PROJECTION_TEXT_DENSITY_FLOOR;

    samples.sort((left, right) => left - right);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    const p75 = samples[Math.floor(samples.length * 0.75)] ?? 0;

    return Math.max(
        PROJECTION_TEXT_DENSITY_FLOOR,
        median * 2.4,
        p75 * 0.6
    );
}

function findProjectionRuns(projection, yStart, yEnd, threshold, minHeight, maxHeight = Infinity) {
    const runs = [];
    let start = null;

    for (let y = yStart; y <= yEnd; y += 1) {
        if (projection[y] >= threshold) {
            if (start === null) start = y;
        } else if (start !== null) {
            const heightPx = y - start;
            if (heightPx >= minHeight && heightPx <= maxHeight) {
                runs.push({
                    y0: start,
                    y1: y - 1,
                    height: heightPx,
                    centerY: (start + y - 1) / 2
                });
            }
            start = null;
        }
    }

    if (start !== null) {
        const heightPx = yEnd - start + 1;
        if (heightPx >= minHeight && heightPx <= maxHeight) {
            runs.push({
                y0: start,
                y1: yEnd,
                height: heightPx,
                centerY: (start + yEnd) / 2
            });
        }
    }

    return runs;
}

function mergeNearbyProjectionRuns(runs, maxGap = PROJECTION_MERGE_GAP) {
    if (runs.length === 0) return [];

    const sorted = [...runs].sort((left, right) => left.y0 - right.y0);
    const merged = [{ ...sorted[0] }];

    for (let index = 1; index < sorted.length; index += 1) {
        const current = sorted[index];
        const previous = merged[merged.length - 1];

        if (current.y0 - previous.y1 <= maxGap) {
            previous.y1 = current.y1;
            previous.height = previous.y1 - previous.y0 + 1;
            previous.centerY = (previous.y0 + previous.y1) / 2;
            continue;
        }

        merged.push({ ...current });
    }

    return merged;
}

function averageProjectionInRun(projection, run) {
    let total = 0;

    for (let y = run.y0; y <= run.y1; y += 1) {
        total += projection[y] ?? 0;
    }

    return total / Math.max(1, run.y1 - run.y0 + 1);
}

function isProjectionSeparatorLikeRun(run, darkProjection, separatorProjection) {
    const heightPx = run.y1 - run.y0 + 1;
    if (heightPx > PROJECTION_MAX_SEPARATOR_RUN) return false;

    const separatorAvg = averageProjectionInRun(separatorProjection, run);
    if (separatorAvg >= PROJECTION_SEPARATOR_DENSITY_FLOOR) return true;

    const darkAvg = averageProjectionInRun(darkProjection, run);
    return heightPx <= 4 && darkAvg >= 0.16;
}

function pickBestSeparatorRun(separatorRuns, textRuns, separatorProjection, darkProjection) {
    let candidates = [...separatorRuns];

    if (candidates.length === 0) {
        const searchEnd = darkProjection.length - 1;
        const thinDarkRuns = findProjectionRuns(
            darkProjection,
            0,
            searchEnd,
            0.14,
            1,
            PROJECTION_MAX_SEPARATOR_RUN
        );
        candidates = thinDarkRuns.filter(run => isProjectionSeparatorLikeRun(run, darkProjection, separatorProjection));
    }

    if (candidates.length === 0) return null;

    if (textRuns.length >= 2) {
        const sortedText = [...textRuns].sort((left, right) => left.y0 - right.y0);
        const gapStart = sortedText[0].y1;
        const gapEnd = sortedText[1].y0;
        const inGap = candidates.filter(run => run.centerY >= gapStart && run.centerY <= gapEnd);

        if (inGap.length > 0) {
            inGap.sort((left, right) => (
                averageProjectionInRun(separatorProjection, right)
                - averageProjectionInRun(separatorProjection, left)
            ));
            return inGap[0];
        }
    }

    if (textRuns.length >= 1) {
        const firstText = [...textRuns].sort((left, right) => left.y0 - right.y0)[0];
        const belowFirst = candidates.filter(run => run.y0 > firstText.y1 && run.y0 < firstText.y1 + 40);

        if (belowFirst.length > 0) {
            belowFirst.sort((left, right) => left.y0 - right.y0);
            return belowFirst[0];
        }
    }

    candidates.sort((left, right) => (
        averageProjectionInRun(separatorProjection, right)
        - averageProjectionInRun(separatorProjection, left)
    ));
    return candidates[0];
}

function inferTextRunInBand(darkProjection, separatorProjection, yStart, yEnd, threshold) {
    if (yEnd <= yStart) return null;

    const runs = findProjectionRuns(
        darkProjection,
        yStart,
        yEnd,
        threshold,
        PROJECTION_MIN_TEXT_RUN
    ).filter(run => !isProjectionSeparatorLikeRun(run, darkProjection, separatorProjection));

    if (runs.length === 0) return null;

    runs.sort((left, right) => right.height - left.height);
    return runs[0];
}

function findHorizontalBoundsByProjection(data, width, y0, y1, scanLeft, scanRight) {
    const span = Math.max(1, scanRight - scanLeft);
    const colCounts = new Array(span).fill(0);
    const rowSpan = y1 - y0 + 1;

    for (let y = y0; y <= y1; y += 1) {
        for (let x = scanLeft; x < scanRight; x += 1) {
            const { r, g, b, lum } = getPixelLuminance(data, width, x, y);
            if (isDecorativePillarPixel(r, g, b)) continue;
            if (isDecorativeLinePixel(data, width, x, y)) continue;
            if (lum < PROJECTION_LUM_THRESHOLD) {
                colCounts[x - scanLeft] += 1;
            }
        }
    }

    const colThreshold = Math.max(2, Math.floor(rowSpan * 0.12));
    let minX = scanRight;
    let maxX = scanLeft;

    for (let offset = 0; offset < span; offset += 1) {
        if (colCounts[offset] < colThreshold) continue;
        const x = scanLeft + offset;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
    }

    if (minX >= maxX) return null;

    const paddingX = Math.max(4, Math.floor(rowSpan * 0.15));
    return {
        x0: Math.max(scanLeft, minX - paddingX),
        x1: Math.min(scanRight - 1, maxX + paddingX)
    };
}

function projectionRunToImageRect(canvas, offsetX, offsetY, canvasWidth, run, data, textLeft, textRight) {
    const lineHeight = run.y1 - run.y0 + 1;
    const xBounds = findHorizontalBoundsByProjection(data, canvasWidth, run.y0, run.y1, textLeft, textRight);
    const paddingY = Math.max(3, Math.floor(lineHeight * 0.14));
    let y0 = Math.max(0, run.y0 - paddingY);
    let y1 = Math.min(canvas.height - 1, run.y1 + paddingY);

    const minCropHeight = Math.max(24, Math.floor(lineHeight * 1.12));
    if (y1 - y0 + 1 < minCropHeight) {
        const extra = minCropHeight - (y1 - y0 + 1);
        y0 = Math.max(0, y0 - Math.floor(extra / 2));
        y1 = Math.min(canvas.height - 1, y1 + Math.ceil(extra / 2));
    }

    const localX = xBounds?.x0 ?? textLeft;
    const localRight = (xBounds?.x1 ?? textRight - 1) + 1;

    return {
        x: offsetX + localX,
        y: offsetY + y0,
        w: Math.max(1, localRight - localX),
        h: Math.max(1, y1 - y0 + 1)
    };
}

function detectTextLinesByHorizontalProjection(layout) {
    const {
        data,
        width,
        height,
        offsetX,
        offsetY,
        textLeft,
        textRight,
        iconRowTopY,
        goldLine,
        canvas
    } = layout;

    const scanLeft = textLeft;
    const scanRight = textRight;
    const searchEndY = iconRowTopY !== null
        ? Math.max(Math.floor(height * 0.12), iconRowTopY - 6)
        : Math.floor(height * 0.48);

    const { dark, separator } = buildHorizontalProjection(data, width, height, scanLeft, scanRight);
    const smoothedDark = smoothProjection(dark, PROJECTION_SMOOTH_RADIUS);
    const textThreshold = computeAdaptiveProjectionThreshold(smoothedDark, 0, searchEndY);

    let textRuns = findProjectionRuns(
        smoothedDark,
        0,
        searchEndY,
        textThreshold,
        PROJECTION_MIN_TEXT_RUN
    );
    textRuns = mergeNearbyProjectionRuns(textRuns, PROJECTION_MERGE_GAP);
    textRuns = textRuns.filter(run => !isProjectionSeparatorLikeRun(run, smoothedDark, separator));

    const separatorRuns = findProjectionRuns(
        separator,
        0,
        searchEndY,
        PROJECTION_SEPARATOR_DENSITY_FLOOR,
        1,
        PROJECTION_MAX_SEPARATOR_RUN
    );

    let separatorRun = pickBestSeparatorRun(separatorRuns, textRuns, separator, smoothedDark);

    if (!separatorRun && goldLine) {
        separatorRun = {
            y0: goldLine.y0,
            y1: goldLine.y1,
            height: goldLine.y1 - goldLine.y0 + 1,
            centerY: goldLine.centerY
        };
    }

    let abbrRun = null;
    let titleRun = null;

    if (separatorRun) {
        const above = textRuns.filter(run => run.y1 < separatorRun.y0 - 1).sort((left, right) => left.y0 - right.y0);
        const below = textRuns.filter(run => run.y0 > separatorRun.y1 + 1).sort((left, right) => left.y0 - right.y0);
        abbrRun = above[0] ?? null;
        titleRun = below[0] ?? null;

        if (!abbrRun) {
            abbrRun = inferTextRunInBand(smoothedDark, separator, 0, Math.max(0, separatorRun.y0 - 2), textThreshold);
        }
        if (!titleRun) {
            titleRun = inferTextRunInBand(
                smoothedDark,
                separator,
                Math.min(height - 1, separatorRun.y1 + 2),
                searchEndY,
                textThreshold
            );
        }
    } else if (textRuns.length >= 2) {
        const sorted = [...textRuns].sort((left, right) => left.y0 - right.y0);
        [abbrRun, titleRun] = sorted;
    } else if (textRuns.length === 1) {
        abbrRun = textRuns[0];
        const looseThreshold = Math.max(
            PROJECTION_TEXT_DENSITY_FLOOR * 0.7,
            textThreshold * 0.75
        );
        titleRun = inferTextRunInBand(
            smoothedDark,
            separator,
            textRuns[0].y1 + 2,
            searchEndY,
            looseThreshold
        );
    }

    return {
        abbr: abbrRun ? projectionRunToImageRect(canvas, offsetX, offsetY, width, abbrRun, data, textLeft, textRight) : null,
        title: titleRun ? projectionRunToImageRect(canvas, offsetX, offsetY, width, titleRun, data, textLeft, textRight) : null,
        separatorRun,
        textRuns,
        projection: {
            dark: smoothedDark,
            separator,
            textThreshold
        }
    };
}

function findPeakDecorativeLineInRange(data, width, yStart, yEnd, scanLeft, scanRight) {
    if (yEnd <= yStart) return null;

    let peakY = null;
    let peakDensity = 0;
    for (let y = yStart; y <= yEnd; y += 1) {
        const density = rowDecorativeLineDensity(data, width, y, scanLeft, scanRight);
        if (density > peakDensity) {
            peakDensity = density;
            peakY = y;
        }
    }

    if (peakY === null || peakDensity < 0.012) return null;

    let y0 = peakY;
    let y1 = peakY;
    while (y0 > yStart && rowDecorativeLineDensity(data, width, y0 - 1, scanLeft, scanRight) >= peakDensity * 0.4) {
        y0 -= 1;
    }
    while (y1 < yEnd && rowDecorativeLineDensity(data, width, y1 + 1, scanLeft, scanRight) >= peakDensity * 0.4) {
        y1 += 1;
    }

    return { y0, y1, centerY: (y0 + y1) / 2, score: peakDensity };
}

function findGoldSeparatorLine(data, width, height, minLeft, mask) {
    const scanLeft = Math.max(minLeft + 8, Math.floor(width * 0.08));
    const scanRight = Math.floor(width * 0.97);
    const textRuns = findMaskTextRuns(mask, width, height, scanLeft, scanRight)
        .filter(run => run.y0 < height * 0.45);

    if (textRuns.length >= 2) {
        const betweenLine = findPeakDecorativeLineInRange(
            data,
            width,
            textRuns[0].y1 + 1,
            textRuns[1].y0 - 1,
            scanLeft,
            scanRight
        );
        if (betweenLine) return betweenLine;
    }

    if (textRuns.length >= 1) {
        const belowLine = findPeakDecorativeLineInRange(
            data,
            width,
            textRuns[0].y1 + 2,
            Math.min(height - 1, textRuns[0].y1 + 40),
            scanLeft,
            scanRight
        );
        if (belowLine) return belowLine;
    }

    const yStart = Math.floor(height * 0.12);
    const yEnd = Math.floor(height * 0.52);
    let bestRun = null;
    let runStart = null;

    for (let y = yStart; y <= yEnd; y += 1) {
        const density = rowDecorativeLineDensity(data, width, y, scanLeft, scanRight);
        if (density >= 0.025) {
            if (runStart === null) runStart = y;
        } else if (runStart !== null) {
            const run = scoreGoldLineRun(data, width, runStart, y - 1, scanLeft, scanRight);
            if (run && (!bestRun || run.score > bestRun.score)) bestRun = run;
            runStart = null;
        }
    }

    if (runStart !== null) {
        const run = scoreGoldLineRun(data, width, runStart, yEnd, scanLeft, scanRight);
        if (run && (!bestRun || run.score > bestRun.score)) bestRun = run;
    }

    return bestRun ?? findPeakDecorativeLineInRange(data, width, yStart, yEnd, scanLeft, scanRight);
}

function findTextBoundsInBand(mask, width, yStart, yEnd, minLeft) {
    let minY = yEnd + 1;
    let maxY = yStart - 1;
    let minX = width;
    let maxX = 0;

    for (let y = yStart; y <= yEnd; y += 1) {
        for (let x = minLeft; x < width; x += 1) {
            if (!mask[y * width + x]) continue;
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
        }
    }

    if (minY > maxY || minX > maxX) return null;
    return { y0: minY, y1: maxY, x0: minX, x1: maxX };
}

function boundsToImageRect(offsetX, offsetY, bounds, fallbackLeft, fallbackRight, bandY0, bandY1) {
    const padY = 8;
    let y0 = bandY0;
    let y1 = bandY1;
    const x0 = fallbackLeft;
    const x1 = fallbackRight;

    if (bounds) {
        y0 = Math.max(bandY0, bounds.y0 - padY);
        y1 = Math.min(bandY1, bounds.y1 + padY);
    }

    const minHeight = 28;
    if (y1 - y0 + 1 < minHeight) {
        const extra = minHeight - (y1 - y0 + 1);
        y0 = Math.max(bandY0, y0 - Math.floor(extra / 2));
        y1 = Math.min(bandY1, y1 + Math.ceil(extra / 2));
    }

    return {
        x: offsetX + x0,
        y: offsetY + y0,
        w: Math.max(1, x1 - x0),
        h: Math.max(1, y1 - y0 + 1)
    };
}

function analyzeHeaderLayout(image) {
    const { canvas, offsetX, offsetY } = cropImageBand(image, HEADER_SCAN_BAND);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const { data } = context.getImageData(0, 0, width, height);

    const minLeft = findDecorativePillarRightX(data, width, height);
    const textLeft = minLeft > 0 ? minLeft : Math.floor(width * 0.02);
    const textRight = Math.floor(width * 0.98);
    const mask = buildRegionTextMask(data, width, height);
    const goldLine = findGoldSeparatorLine(data, width, height, minLeft, mask);
    const textRuns = findMaskTextRuns(mask, width, height, textLeft, textRight)
        .filter(run => run.y0 < height * 0.45);
    const iconRowTopY = findSpiritIconRowTopY(data, width, height);

    return {
        canvas,
        offsetX,
        offsetY,
        width,
        height,
        data,
        mask,
        minLeft,
        goldLine,
        iconRowTopY,
        textLeft,
        textRight,
        separatorY: goldLine ? Math.round(goldLine.centerY) : null,
        textRuns
    };
}

let openCvOrnamentModule = null;
let openCvLoadFailed = false;
/** @type {string | null} */
let openCvLoadErrorMessage = null;

async function tryLoadOpenCv(timeoutMs = 90_000) {
    if (openCvLoadFailed) {
        return false;
    }
    try {
        if (!openCvOrnamentModule) {
            openCvOrnamentModule = await import('./opencv-ornament.js');
        }
        if (openCvOrnamentModule.isOpenCvReady()) {
            return true;
        }
        return await openCvOrnamentModule.ensureOpenCv({ initTimeoutMs: timeoutMs });
    } catch (error) {
        openCvLoadFailed = true;
        openCvLoadErrorMessage = error?.message ?? String(error);
        console.warn('OpenCV disabled for this session:', error);
        return false;
    }
}

/**
 * OpenCV.js を読み込み、layout に意匠検出結果を付与する。
 * @param {ReturnType<typeof analyzeHeaderLayout>} layout
 */
async function enrichLayoutWithOpenCvOrnament(layout) {
    if (layout.openCvEnriched) return layout;
    layout.openCvEnriched = true;
    layout.openCvOrnament = null;
    layout.openCvExtensionLine = null;

    if (openCvLoadFailed) return layout;

    try {
        const ready = await tryLoadOpenCv(90_000);
        if (!ready || !openCvOrnamentModule) return layout;

        const result = await openCvOrnamentModule.detectOrnamentFromCanvasAsync(layout.canvas);
        if (result) {
            layout.openCvOrnament = {
                x: result.x,
                y: result.y,
                w: result.w,
                h: result.h
            };
            layout.openCvExtensionLine = result.extensionLine ?? null;
            const separatorLine = resolveLayoutSeparatorLine(layout, layout.openCvOrnament);
            layout.openCvOrnament = applySeparatorLineToOrnamentBottom(
                layout.openCvOrnament,
                separatorLine
            );
        }
    } catch (error) {
        openCvLoadFailed = true;
        console.warn('OpenCV ornament detection skipped:', error);
    }

    return layout;
}

/**
 * @param {HTMLImageElement} image
 */
export async function prepareEventOcrLayout(image) {
    const layout = analyzeHeaderLayout(image);
    await enrichLayoutWithOpenCvOrnament(layout);
    return layout;
}

/** OpenCV.js を事前読み込み（管理画面の貼り付け前など）。失敗時は false。 */
export async function ensureEventOcrOpenCv(options = {}) {
    return tryLoadOpenCv(options.timeoutMs ?? options.initTimeoutMs ?? 90_000);
}

/** 直近の OpenCV 読込失敗メッセージ（ensureEventOcrOpenCv が false のとき）。 */
export function getEventOcrOpenCvLoadError() {
    return openCvLoadErrorMessage;
}

/** OpenCV + Tesseract を事前読み込み。 */
export async function warmupEventOcr(options = {}) {
    await ensureEventOcrOpenCv(options);
    await getOcrWorker();
}

function detectHeaderTextLineRects(image, layout = null) {
    const resolvedLayout = layout ?? analyzeHeaderLayout(image);
    const ornamentRects = detectOrnamentBasedHeaderTextRects(image, resolvedLayout);
    if (ornamentRects?.abbr && ornamentRects?.title) {
        return ornamentRects;
    }

    const projectionResult = detectTextLinesByHorizontalProjection(resolvedLayout);
    const bandRects = buildHeaderBandRects(resolvedLayout, image);

    return {
        abbr: projectionResult.abbr ?? bandRects.abbr,
        title: projectionResult.title ?? bandRects.title
    };
}

function isDecorativePillarPixel(r, g, b) {
    return r > 145 && g > 95 && b < 95 && r > g && g > b * 1.1;
}

function isGoldFramePixel(r, g, b, lum) {
    if (isDecorativePillarPixel(r, g, b)) return true;
    if (r > 120 && g > 70 && b < 100 && r > g && lum >= 55 && lum <= 185) return true;
    return r > 90 && g > 50 && b < 65 && r > g && lum >= 40 && lum <= 130;
}

function isOrnamentInteriorPixel(r, g, b, lum, sat) {
    return lum >= 172 && lum <= 255 && sat < 0.24 && r >= 165 && g >= 165 && b >= 155;
}

function isNeutralMarginPixel(r, g, b, lum, sat) {
    return lum >= 95 && lum <= 142 && sat < 0.14
        && Math.abs(r - g) < 10 && Math.abs(g - b) < 10
        && !isGoldFramePixel(r, g, b, lum);
}

function groupContiguousFrameColumns(columns, maxGap = 8) {
    if (columns.length === 0) return [];

    const clusters = [[columns[0]]];
    for (let index = 1; index < columns.length; index += 1) {
        const x = columns[index];
        const current = clusters[clusters.length - 1];
        if (x <= current[current.length - 1] + maxGap) {
            current.push(x);
        } else {
            clusters.push([x]);
        }
    }

    return clusters;
}

function isNeutralMarginColumn(data, width, x, yStart, yEnd, isFramePixel) {
    const span = Math.max(1, yEnd - yStart + 1);
    const neutralRun = maxColumnRun(
        (pixelData, imageWidth, columnX, y) => {
            const { r, g, b, lum, sat } = getPixelLuminance(pixelData, imageWidth, columnX, y);
            return isNeutralMarginPixel(r, g, b, lum, sat);
        },
        data,
        width,
        x,
        yStart,
        yEnd
    );
    const frameRun = maxColumnRun(isFramePixel, data, width, x, yStart, yEnd);
    return neutralRun >= span * 0.68 && frameRun < span * 0.22;
}

function measureOrnamentClusterRect(cluster, data, width, scanWidth, yStart, yEnd, isStrictGoldPixel, isFramePixel, isInteriorPixel) {
    const frameLeftX = cluster[0];
    let y0 = yEnd + 1;
    let y1 = yStart;

    for (const x of cluster) {
        for (let y = yStart; y <= yEnd; y += 1) {
            if (isStrictGoldPixel(data, width, x, y)) {
                y0 = Math.min(y0, y);
            }
        }
    }

    if (y0 > yEnd) {
        for (const x of cluster) {
            for (let y = yStart; y <= yEnd; y += 1) {
                if (isFramePixel(data, width, x, y)) {
                    y0 = Math.min(y0, y);
                }
            }
        }
    }

    if (y0 > yEnd) return null;

    for (const x of cluster) {
        for (let y = yStart; y <= yEnd; y += 1) {
            if (isStrictGoldPixel(data, width, x, y)) {
                y1 = Math.max(y1, y);
            }
        }
    }

    if (y1 < y0) {
        for (const x of cluster) {
            for (let y = yStart; y <= yEnd; y += 1) {
                if (isFramePixel(data, width, x, y)) {
                    y1 = Math.max(y1, y);
                }
            }
        }
    }

    if (y1 < y0) return null;

    const bandHeight = Math.max(1, y1 - y0 + 1);
    const maxRightScan = Math.min(scanWidth, frameLeftX + 24);
    let frameRightX = frameLeftX;

    for (let x = frameLeftX; x < maxRightScan; x += 1) {
        const strictCount = countPredicateInBand(isStrictGoldPixel, data, width, x, x, y0, y1);
        if (strictCount >= 3) {
            frameRightX = x;
        }
    }

    let x0 = frameLeftX;
    const maxExpandLeft = Math.max(0, frameLeftX - Math.ceil(bandHeight * 1.1));
    while (x0 > maxExpandLeft) {
        const interiorCount = countPredicateInBand(isInteriorPixel, data, width, x0 - 1, x0 - 1, y0, y1);
        if (interiorCount >= bandHeight * 0.55) {
            x0 -= 1;
            continue;
        }
        break;
    }

    let ornamentWidth = frameRightX - x0 + 1;
    let ornamentHeight = y1 - y0 + 1;
    const maxWidth = Math.max(
        10,
        Math.min(22, Math.floor(ornamentHeight * 0.85) + 4)
    );

    if (ornamentWidth > maxWidth) {
        frameRightX = x0 + maxWidth - 1;
        ornamentWidth = maxWidth;
    }

    if (ornamentHeight > ornamentWidth * 2.2) {
        y1 = Math.min(yEnd, y0 + Math.floor(ornamentWidth * 2.15));
        ornamentHeight = y1 - y0 + 1;
    }

    if (ornamentWidth < 2 || ornamentHeight < 8) return null;

    return {
        x: x0,
        y: y0,
        w: ornamentWidth,
        h: ornamentHeight
    };
}

function scoreOrnamentClusterRect(rect, width) {
    if (!rect) return -1;

    const centerX = rect.x + rect.w / 2;
    if (rect.x > width * 0.055 || centerX > width * 0.12) return -1;

    let score = Math.min(rect.w * rect.h, 1600);
    score -= rect.x * 1.5;

    const aspect = rect.h / rect.w;
    if (aspect >= 0.75 && aspect <= 2.8) score += 140;
    if (rect.w >= 8 && rect.w <= 52 && rect.h >= 14 && rect.h <= 110) score += 180;
    score -= Math.abs(aspect - 1.75) * 12;

    return score;
}

function maxColumnRun(predicate, data, width, x, yStart, yEnd) {
    let best = 0;
    let current = 0;

    for (let y = yStart; y <= yEnd; y += 1) {
        if (predicate(data, width, x, y)) {
            current += 1;
            best = Math.max(best, current);
        } else {
            current = 0;
        }
    }

    return best;
}

function countPredicateInBand(predicate, data, width, x0, x1, y0, y1) {
    let count = 0;
    for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
            if (predicate(data, width, x, y)) count += 1;
        }
    }
    return count;
}

/**
 * 意匠矩形の候補を算出する（検証前。デバッグ表示用にも使う）。
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
function probeDecorativeOrnamentRect(data, width, height, separatorY = null) {
    const scanWidth = Math.min(width, Math.floor(width * 0.2));
    const scanHeight = Math.min(height, Math.floor(height * 0.35));
    const yStart = 0;
    const yEnd = scanHeight - 1;
    const spanHeight = Math.max(1, yEnd - yStart + 1);
    const minFrameRun = Math.max(8, Math.floor(scanHeight * 0.12));

    const isStrictGoldPixel = (pixelData, imageWidth, x, y) => {
        const { r, g, b } = getPixelLuminance(pixelData, imageWidth, x, y);
        return isDecorativePillarPixel(r, g, b);
    };
    const isFramePixel = (pixelData, imageWidth, x, y) => {
        const { r, g, b, lum } = getPixelLuminance(pixelData, imageWidth, x, y);
        return isGoldFramePixel(r, g, b, lum);
    };
    const isInteriorPixel = (pixelData, imageWidth, x, y) => {
        const { r, g, b, lum, sat } = getPixelLuminance(pixelData, imageWidth, x, y);
        return isOrnamentInteriorPixel(r, g, b, lum, sat);
    };

    const frameColumns = [];
    for (let x = 0; x < scanWidth; x += 1) {
        if (isNeutralMarginColumn(data, width, x, yStart, yEnd, isFramePixel)) {
            continue;
        }

        const maxRun = maxColumnRun(isFramePixel, data, width, x, yStart, yEnd);
        if (maxRun >= minFrameRun) {
            frameColumns.push(x);
        }
    }

    if (frameColumns.length === 0) return null;

    const clusters = groupContiguousFrameColumns(frameColumns);
    let bestRect = null;
    let bestScore = -1;

    for (const cluster of clusters) {
        const rect = measureOrnamentClusterRect(
            cluster,
            data,
            width,
            scanWidth,
            yStart,
            yEnd,
            isStrictGoldPixel,
            isFramePixel,
            isInteriorPixel
        );
        const score = scoreOrnamentClusterRect(rect, width);
        if (score > bestScore) {
            bestScore = score;
            bestRect = rect;
        }
    }

    if (!bestRect) return null;

    if (separatorY !== null) {
        bestRect = {
            ...bestRect,
            h: Math.max(bestRect.h, Math.min(yEnd, separatorY - 2) - bestRect.y + 1)
        };
    }

    if (bestRect.w < 2 || bestRect.h < 1 || bestRect.y >= scanHeight) return null;

    return bestRect;
}

const ORNAMENT_MAX_ASPECT_RATIO = 4;

function evaluateDecorativeOrnamentRect(rect, bandWidth, bandHeight, imageHeight = null) {
    if (!rect) {
        return {
            valid: false,
            failures: [{ id: 'missing', message: '矩形がありません' }]
        };
    }

    const failures = [];
    const area = rect.w * rect.h;
    const aspectRatio = rect.w > 0 ? rect.h / rect.w : 0;
    const maxX = bandWidth * 0.055;
    const maxRight = bandWidth * 0.18;
    const maxWidth = bandWidth * 0.15;
    const resolvedImageHeight = imageHeight ?? (bandHeight / HEADER_SCAN_BAND.height);
    const maxHeight = Math.floor(resolvedImageHeight * 0.5);

    if (rect.w < 8) {
        failures.push({ id: 'min-width', message: `幅が 8px 未満（${rect.w}px）` });
    }
    if (rect.h < 12) {
        failures.push({ id: 'min-height', message: `高さが 12px 未満（${rect.h}px）` });
    }
    if (area < 96) {
        failures.push({ id: 'min-area', message: `面積が 96px² 未満（${area}px²）` });
    }
    if (rect.x > maxX) {
        failures.push({
            id: 'x-too-right',
            message: `左端が右に寄りすぎ（x=${rect.x}px、上限 ${Math.floor(maxX)}px）`
        });
    }
    if (rect.x + rect.w > maxRight) {
        failures.push({
            id: 'extends-too-right',
            message: `右端が左エリアをはみ出し（x+w=${rect.x + rect.w}px、上限 ${Math.floor(maxRight)}px）`
        });
    }
    if (rect.w > maxWidth) {
        failures.push({
            id: 'max-width',
            message: `幅が広すぎ（${rect.w}px、上限 ${Math.floor(maxWidth)}px）`
        });
    }
    if (rect.h > maxHeight) {
        failures.push({
            id: 'max-height',
            message: `高さが大きすぎ（${rect.h}px、上限 ${maxHeight}px＝画像高さの半分）`
        });
    }
    if (aspectRatio > ORNAMENT_MAX_ASPECT_RATIO) {
        failures.push({
            id: 'aspect-too-tall',
            message: `縦横比 h/w=${aspectRatio.toFixed(2)} が細長すぎ（上限 ${ORNAMENT_MAX_ASPECT_RATIO}）`
        });
    }
    if (aspectRatio < 0.45) {
        failures.push({
            id: 'aspect-too-wide',
            message: `縦横比 h/w=${aspectRatio.toFixed(2)} が横長すぎ（下限 0.45）`
        });
    }

    return {
        valid: failures.length === 0,
        failures,
        metrics: {
            area,
            aspectRatio,
            imageHeight: Math.floor(resolvedImageHeight),
            maxX: Math.floor(maxX),
            maxRight: Math.floor(maxRight),
            maxWidth: Math.floor(maxWidth),
            maxHeight
        }
    };
}

function isValidDecorativeOrnamentRect(rect, bandWidth, bandHeight, imageHeight = null) {
    return evaluateDecorativeOrnamentRect(rect, bandWidth, bandHeight, imageHeight).valid;
}

/** 意匠矩形が validation を通らない理由（デバッグ用） */
export function explainDecorativeOrnamentValidation(rect, bandWidth, bandHeight, imageHeight = null) {
    return evaluateDecorativeOrnamentRect(rect, bandWidth, bandHeight, imageHeight);
}

function resolveDecorativeOrnamentRect(layout, separatorY = null) {
    let ornament = null;
    if (layout?.openCvOrnament
        && isValidDecorativeOrnamentRect(layout.openCvOrnament, layout.width, layout.height)) {
        ornament = { ...layout.openCvOrnament };
    } else {
        const candidate = probeDecorativeOrnamentRect(
            layout.data,
            layout.width,
            layout.height,
            separatorY
        );
        if (isValidDecorativeOrnamentRect(candidate, layout.width, layout.height)) {
            ornament = candidate;
        }
    }
    if (!ornament) return null;

    const separatorLine = resolveLayoutSeparatorLine(layout, ornament);
    return applySeparatorLineToOrnamentBottom(ornament, separatorLine);
}

/**
 * レイアウトから区切り線（略称/正式名境界）を解決する。
 * goldLine → 意匠付近ピクセル走査 → OpenCV 水平線 の順（意匠横幅のみ OpenCV 新方式）。
 */
function resolveLayoutSeparatorLine(layout, ornament = null) {
    if (layout?.goldLine) {
        return layout.goldLine;
    }
    if (ornament) {
        const ornamentLine = findOrnamentBottomExtensionLine(
            layout.data,
            layout.width,
            layout.height,
            ornament,
            layout.textRight
        );
        if (ornamentLine) return ornamentLine;
    }
    if (layout?.openCvExtensionLine) {
        return layout.openCvExtensionLine;
    }
    return null;
}

/** 区切り線 y1 を意匠矩形の下辺として適用（横幅は維持）。 */
function applySeparatorLineToOrnamentBottom(ornament, separatorLine) {
    if (!ornament || !separatorLine) return ornament;
    const bottomY = Math.floor(separatorLine.y1);
    if (bottomY <= ornament.y + 4) return ornament;
    return {
        x: ornament.x,
        y: ornament.y,
        w: ornament.w,
        h: Math.max(8, bottomY - ornament.y + 1)
    };
}

/** OpenCV / probe の意匠候補と区切り線を解決（検証前の tentative も含む）。 */
function resolveOrnamentCandidate(layout) {
    const baseOrnament = layout.openCvOrnament
        ?? probeDecorativeOrnamentRect(
            layout.data,
            layout.width,
            layout.height,
            layout.separatorY
        );
    if (!baseOrnament) {
        return { ornamentCandidate: null, separatorLine: null };
    }

    const separatorLine = resolveLayoutSeparatorLine(layout, baseOrnament);
    const ornamentCandidate = applySeparatorLineToOrnamentBottom(baseOrnament, separatorLine);
    return { ornamentCandidate, separatorLine };
}

function buildOrnamentBasedHeaderTextRects(image, layout, ornament, separatorLine) {
    if (!ornament || ornament.w < 8 || ornament.h < 10) return null;

    const imageWidth = image.naturalWidth || image.width;
    return buildOrnamentBasedTitleRects(ornament, imageWidth, layout.offsetX, layout.offsetY, {
        separatorLine,
        iconRowTopY: layout.iconRowTopY,
        bandHeight: layout.height
    });
}

/**
 * 意匠下端付近で右方向へ伸びる装飾水平線を検出する（略称と正式名の境界）。
 * @param {{ x: number, y: number, w: number, h: number }} ornament
 * @returns {{ y0: number, y1: number, centerY: number } | null}
 */
function findOrnamentBottomExtensionLine(data, width, height, ornament, textRight) {
    const ornamentBottom = ornament.y + ornament.h - 1;
    const scanLeft = Math.max(
        ornament.x + Math.floor(ornament.w * 0.3),
        ornament.x + 2
    );
    const scanRight = textRight ?? Math.floor(width * 0.98);
    if (scanRight <= scanLeft + 12) return null;

    const yStart = Math.max(0, ornament.y + Math.floor(ornament.h * 0.42));
    const yEnd = Math.min(
        height - 1,
        ornamentBottom + Math.max(10, Math.floor(ornament.h * 0.4))
    );
    if (yEnd <= yStart) return null;

    let peakY = null;
    let peakScore = 0;
    let peakRowDensity = 0;

    for (let y = yStart; y <= yEnd; y += 1) {
        const density = rowDecorativeLineDensity(data, width, y, scanLeft, scanRight);
        if (density < 0.012) continue;

        const distance = Math.abs(y - ornamentBottom);
        const proximity = Math.max(0, 1 - distance / Math.max(8, ornament.h * 0.55));
        const score = density * (0.65 + proximity * 0.35);

        if (score > peakScore) {
            peakScore = score;
            peakY = y;
            peakRowDensity = density;
        }
    }

    if (peakY === null) return null;

    let y0 = peakY;
    let y1 = peakY;
    const threshold = peakRowDensity * 0.35;
    const maxRunHeight = Math.max(4, Math.min(10, Math.floor(ornament.h * 0.22)));

    while (y0 > yStart && y1 - y0 < maxRunHeight - 1
        && rowDecorativeLineDensity(data, width, y0 - 1, scanLeft, scanRight) >= threshold) {
        y0 -= 1;
    }
    while (y1 < yEnd && y1 - y0 < maxRunHeight - 1
        && rowDecorativeLineDensity(data, width, y1 + 1, scanLeft, scanRight) >= threshold) {
        y1 += 1;
    }

    return { y0, y1, centerY: (y0 + y1) / 2 };
}

/**
 * 意匠矩形を基準に略称・正式名の OCR 領域を算出する。
 * 下端の水平装飾線（右へ伸びる区切り）があれば、略称/正式名の境界に使う。
 * @param {{ x: number, y: number, w: number, h: number }} ornament
 * @param {{ separatorLine?: { y0: number, y1: number } | null, iconRowTopY?: number | null, bandHeight?: number }} [options]
 */
function buildOrnamentBasedTitleRects(ornament, imageWidth, offsetX = 0, offsetY = 0, options = {}) {
    const { x, y, w, h } = ornament;
    const { separatorLine, bandHeight = null } = options;
    // 略称左端 = 意匠右端 + 小さな余白（案A: 4〜8px）
    const abbrLeft = offsetX + x + w + ABBR_ORNAMENT_GAP_PX;
    // 正式名左端 = 意匠左端
    const titleLeft = offsetX + x;

    let abbrTop = y;
    let abbrBottom;
    let titleTop;

    if (separatorLine) {
        abbrBottom = Math.max(abbrTop + 6, separatorLine.y0 - 2);
        titleTop = Math.min(
            bandHeight !== null ? bandHeight - 8 : separatorLine.y1 + 20,
            separatorLine.y1 + 3
        );
    } else {
        abbrBottom = y + h - 1;
        titleTop = y + h;
    }

    const abbrH = Math.max(8, abbrBottom - abbrTop + 1);

    // 正式名行は略称行と同じ字高想定のため、意匠矩形と同じ縦幅を使う
    const titleH = Math.max(8, h);

    return {
        abbr: {
            x: abbrLeft,
            y: offsetY + abbrTop,
            w: Math.max(1, imageWidth - abbrLeft),
            h: abbrH
        },
        title: {
            x: titleLeft,
            y: offsetY + titleTop,
            w: Math.max(1, imageWidth - titleLeft),
            h: titleH
        }
    };
}

function detectOrnamentBasedHeaderTextRects(image, layout) {
    const { ornamentCandidate, separatorLine } = resolveOrnamentCandidate(layout);
    return buildOrnamentBasedHeaderTextRects(image, layout, ornamentCandidate, separatorLine);
}

function findDecorativePillarRightX(data, width, height, separatorY = null) {
    const candidate = probeDecorativeOrnamentRect(data, width, height, separatorY);
    if (isValidDecorativeOrnamentRect(candidate, width, height)) {
        return candidate.x + candidate.w;
    }

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
    const grayscale = scaleCanvasForOcr(grayscaleCanvasForOcr(sourceCanvas));
    const raw = scaleCanvasForOcr(sourceCanvas);
    return [grayscale, raw];
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

function dedupeProjectionRuns(runs) {
    if (runs.length === 0) return [];

    const sorted = [...runs].sort((left, right) => left.y0 - right.y0);
    const merged = [{ ...sorted[0] }];

    for (let index = 1; index < sorted.length; index += 1) {
        const current = sorted[index];
        const previous = merged[merged.length - 1];

        if (current.y0 <= previous.y1 + 6) {
            previous.y1 = Math.max(previous.y1, current.y1);
            previous.height = previous.y1 - previous.y0 + 1;
            previous.centerY = (previous.y0 + previous.y1) / 2;
            continue;
        }

        merged.push({ ...current });
    }

    return merged;
}

function collectHeaderTextRuns(layout) {
    const {
        data,
        width,
        height,
        textLeft,
        textRight,
        iconRowTopY
    } = layout;

    const searchEndY = iconRowTopY !== null
        ? Math.max(Math.floor(height * 0.12), iconRowTopY - 6)
        : Math.floor(height * 0.48);

    const { dark, separator } = buildHorizontalProjection(data, width, height, textLeft, textRight);
    const smoothedDark = smoothProjection(dark);
    const textThreshold = computeAdaptiveProjectionThreshold(smoothedDark, 0, searchEndY);
    const looseThreshold = Math.max(PROJECTION_TEXT_DENSITY_FLOOR * 0.65, textThreshold * 0.72);

    let runs = findProjectionRuns(
        smoothedDark,
        0,
        searchEndY,
        textThreshold,
        PROJECTION_MIN_TEXT_RUN
    );
    const looseRuns = findProjectionRuns(
        smoothedDark,
        0,
        searchEndY,
        looseThreshold,
        4
    );

    runs = dedupeProjectionRuns([
        ...runs,
        ...looseRuns.filter(run => !isProjectionSeparatorLikeRun(run, smoothedDark, separator))
    ]).filter(run => !isProjectionSeparatorLikeRun(run, smoothedDark, separator));

    return { runs, searchEndY, smoothedDark, separator, looseThreshold };
}

function buildHeaderBandRects(layout, image) {
    const {
        offsetX,
        offsetY,
        height,
        width,
        data,
        canvas,
        goldLine,
        textLeft,
        textRight,
        iconRowTopY,
        minLeft
    } = layout;

    const bandWidth = Math.max(1, textRight - textLeft);
    const { runs, searchEndY, smoothedDark, separator, looseThreshold } = collectHeaderTextRuns(layout);

    if (goldLine) {
        const abbrBandY0 = Math.floor(height * 0.02);
        const abbrBandY1 = Math.max(abbrBandY0 + 8, goldLine.y0 - 4);
        const titleBandY0 = Math.min(height - 1, goldLine.y1 + 4);
        const titleBandY1 = iconRowTopY !== null
            ? Math.max(titleBandY0 + 8, iconRowTopY - 6)
            : Math.min(height - 1, Math.floor(height * 0.42));

        return {
            abbr: {
                x: offsetX + textLeft,
                y: offsetY + abbrBandY0,
                w: bandWidth,
                h: Math.max(24, abbrBandY1 - abbrBandY0)
            },
            title: {
                x: offsetX + textLeft,
                y: offsetY + titleBandY0,
                w: bandWidth,
                h: Math.max(28, titleBandY1 - titleBandY0)
            }
        };
    }

    if (runs.length >= 2) {
        return {
            abbr: projectionRunToImageRect(canvas, offsetX, offsetY, width, runs[0], data, textLeft, textRight),
            title: projectionRunToImageRect(canvas, offsetX, offsetY, width, runs[1], data, textLeft, textRight)
        };
    }

    if (runs.length === 1) {
        const abbrRun = runs[0];
        let titleRun = inferTextRunInBand(
            smoothedDark,
            separator,
            abbrRun.y1 + 2,
            searchEndY,
            looseThreshold
        );

        if (!titleRun) {
            const titleY0 = Math.min(searchEndY - 8, abbrRun.y1 + 4);
            const titleY1 = Math.min(searchEndY, titleY0 + Math.max(20, Math.floor((searchEndY - titleY0) * 0.85)));
            titleRun = {
                y0: titleY0,
                y1: titleY1,
                height: titleY1 - titleY0 + 1,
                centerY: (titleY0 + titleY1) / 2
            };
        }

        return {
            abbr: projectionRunToImageRect(canvas, offsetX, offsetY, width, abbrRun, data, textLeft, textRight),
            title: projectionRunToImageRect(canvas, offsetX, offsetY, width, titleRun, data, textLeft, textRight)
        };
    }

    const splitY = Math.max(24, Math.floor(searchEndY * 0.38));
    return {
        abbr: {
            x: offsetX + textLeft,
            y: offsetY,
            w: bandWidth,
            h: splitY
        },
        title: {
            x: offsetX + textLeft,
            y: offsetY + splitY,
            w: bandWidth,
            h: Math.max(24, searchEndY - splitY)
        }
    };
}

function pickBestOcrText(candidates) {
    const unique = [...new Set(candidates.filter(text => typeof text === 'string' && text.trim()))];
    if (unique.length === 0) return '';

    unique.sort((left, right) => {
        const lengthDiff = right.length - left.length;
        if (lengthDiff !== 0) return lengthDiff;
        return right.replace(/\s+/g, '').length - left.replace(/\s+/g, '').length;
    });

    return unique[0];
}

async function readLineFromRectLenient(worker, image, rect, preserveSpaces) {
    if (!rect) return '';

    const primary = await recognizeLineRectLenient(worker, image, rect, { preserveSpaces });
    if (primary.text) return primary.text;

    const alternate = await recognizeLineRectLenient(worker, image, rect, { preserveSpaces: !preserveSpaces });
    return alternate.text || '';
}

async function recognizeTitleRectLenient(worker, image, rect) {
    if (!rect) return '';

    const singleLineCandidates = [
        await readLineFromRectLenient(worker, image, rect, true),
        await readLineFromRectLenient(worker, image, rect, false)
    ];

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
    const blockCandidates = [];

    for (const canvas of variants) {
        await worker.setParameters({ tessedit_pageseg_mode: AUTO_PSM });
        const { data } = await worker.recognize(canvas);
        const text = lightSanitizeForFill(data.text ?? '', { preserveSpaces: true });
        if (text) blockCandidates.push(text);

        if (Array.isArray(data.lines)) {
            for (const line of data.lines) {
                const lineText = lightSanitizeForFill(line.text ?? '', { preserveSpaces: true });
                if (lineText) blockCandidates.push(lineText);
            }
        }
    }

    return pickBestOcrText([...singleLineCandidates, ...blockCandidates]);
}

async function recognizePreparedCanvas(worker, canvas, { preserveSpaces = false, psm = SINGLE_LINE_PSM, stripNoisyPrefix = false } = {}) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(canvas);
    const text = sanitizeOcrOutput(data.text ?? '', { preserveSpaces, stripNoisyPrefix });
    const confidence = data.confidence ?? 0;
    return { text, confidence };
}

async function recognizeLineRect(worker, image, rect, { preserveSpaces = false, stripNoisyPrefix = false } = {}) {
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
        const result = await recognizePreparedCanvas(worker, canvas, { preserveSpaces, psm: SINGLE_LINE_PSM, stripNoisyPrefix });
        if (!result.text) continue;
        const adjustedConfidence = result.confidence - gibberishPenalty(result.text) * 0.4;
        if (adjustedConfidence > best.confidence) {
            best = { ...result, confidence: adjustedConfidence };
        }
    }

    if (best.text && best.confidence < MIN_CONFIDENCE) {
        const secondPass = await recognizePreparedCanvas(worker, variants[1], { preserveSpaces, psm: AUTO_PSM, stripNoisyPrefix });
        const adjustedConfidence = secondPass.confidence - gibberishPenalty(secondPass.text) * 0.4;
        if (secondPass.text && adjustedConfidence > best.confidence) {
            best = { ...secondPass, confidence: adjustedConfidence };
        }
    }

    return best;
}

function lightSanitizeForFill(text, { preserveSpaces = false } = {}) {
    let result = normalizeEventOcrText(text, { preserveSpaces });
    if (!result) return '';

    return result
        .replace(/^[|｜—―‐─－_=\s]+/, '')
        .replace(/[|｜—―‐─－_=\s]+$/, '')
        .trim();
}

async function recognizeLineRectLenient(worker, image, rect, { preserveSpaces = false } = {}) {
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
        await worker.setParameters({ tessedit_pageseg_mode: SINGLE_LINE_PSM });
        const { data } = await worker.recognize(canvas);
        const text = lightSanitizeForFill(data.text ?? '', { preserveSpaces });
        if (!text) continue;

        const confidence = data.confidence ?? 0;
        if (confidence > best.confidence) {
            best = { text, confidence };
        }
    }

    if (!best.text) {
        for (const canvas of variants) {
            await worker.setParameters({ tessedit_pageseg_mode: AUTO_PSM });
            const { data } = await worker.recognize(canvas);
            const text = lightSanitizeForFill(data.text ?? '', { preserveSpaces });
            if (!text) continue;

            const confidence = data.confidence ?? 0;
            if (confidence > best.confidence) {
                best = { text, confidence };
            }
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

export function debugEventOcrAnalysis(image, layout = null) {
    const resolvedLayout = layout ?? analyzeHeaderLayout(image);
    const ornament = resolveDecorativeOrnamentRect(resolvedLayout, resolvedLayout.separatorY);
    const ornamentCandidate = resolvedLayout.openCvOrnament
        ?? probeDecorativeOrnamentRect(
            resolvedLayout.data,
            resolvedLayout.width,
            resolvedLayout.height,
            resolvedLayout.separatorY
        );
    const projection = detectTextLinesByHorizontalProjection(resolvedLayout);
    const roles = detectHeaderTextLineRects(image, resolvedLayout);
    const ornamentSeparatorLine = ornament
        ? resolveLayoutSeparatorLine(resolvedLayout, ornament)
        : null;

    return {
        ornament,
        openCvOrnament: resolvedLayout.openCvOrnament ?? null,
        openCvExtensionLine: resolvedLayout.openCvExtensionLine ?? null,
        ornamentCandidate,
        ornamentAccepted: isValidDecorativeOrnamentRect(
            ornamentCandidate,
            resolvedLayout.width,
            resolvedLayout.height,
            image.naturalHeight || image.height
        ),
        ornamentValidation: evaluateDecorativeOrnamentRect(
            ornamentCandidate,
            resolvedLayout.width,
            resolvedLayout.height,
            image.naturalHeight || image.height
        ),
        ornamentExtensionLine: ornamentSeparatorLine,
        ornamentRects: ornament
            ? buildOrnamentBasedTitleRects(
                ornament,
                image.naturalWidth || image.width,
                resolvedLayout.offsetX,
                resolvedLayout.offsetY,
                {
                    separatorLine: ornamentSeparatorLine,
                    iconRowTopY: resolvedLayout.iconRowTopY,
                    bandHeight: resolvedLayout.height
                }
            )
            : null,
        goldLine: resolvedLayout.goldLine,
        separatorY: resolvedLayout.separatorY,
        minLeft: resolvedLayout.minLeft,
        iconRowTopY: resolvedLayout.iconRowTopY,
        bandHeight: resolvedLayout.height,
        projectionTextRuns: projection.textRuns,
        projectionSeparator: projection.separatorRun,
        projectionThreshold: projection.projection.textThreshold,
        roles
    };
}

function resolveEventNameLineRects(image, layout) {
    const lineRects = detectHeaderTextLineRects(image, layout);
    const bandRects = buildHeaderBandRects(layout, image);
    const { ornamentCandidate, separatorLine } = resolveOrnamentCandidate(layout);
    const ornamentRects = buildOrnamentBasedHeaderTextRects(
        image,
        layout,
        ornamentCandidate,
        separatorLine
    );

    let abbr = lineRects.abbr ?? bandRects.abbr;
    let title = lineRects.title ?? bandRects.title;
    if (ornamentRects?.abbr) abbr = ornamentRects.abbr;
    if (ornamentRects?.title) title = ornamentRects.title;

    return { abbr, title, bandRects, lineRects, ornamentRects, ornamentCandidate, separatorLine };
}

function buildEventNameOcrRegions(image, layout) {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const {
        abbr: abbrRect,
        title: titleRect,
        ornamentCandidate
    } = resolveEventNameLineRects(image, layout);
    const ornamentAccepted = isValidDecorativeOrnamentRect(
        ornamentCandidate,
        layout.width,
        layout.height,
        imageHeight
    );
    const ornamentValidation = evaluateDecorativeOrnamentRect(
        ornamentCandidate,
        layout.width,
        layout.height,
        imageHeight
    );
    const separatorLine = resolveLayoutSeparatorLine(layout, ornamentCandidate);

    return {
        headerScan: {
            x: 0,
            y: 0,
            w: imageWidth,
            h: Math.max(1, Math.floor(imageHeight * HEADER_SCAN_BAND.height)),
            label: '走査範囲'
        },
        ornament: ornamentCandidate && ornamentCandidate.w >= 8 && ornamentCandidate.h >= 10 ? {
            x: layout.offsetX + ornamentCandidate.x,
            y: layout.offsetY + ornamentCandidate.y,
            w: ornamentCandidate.w,
            h: ornamentCandidate.h,
            label: ornamentAccepted
                ? (layout.openCvOrnament ? '意匠(OpenCV)' : '意匠')
                : '意匠?',
            tentative: !ornamentAccepted,
            openCv: Boolean(layout.openCvOrnament),
            validation: ornamentValidation
        } : null,
        separator: separatorLine ? {
            x: layout.offsetX + layout.textLeft,
            y: layout.offsetY + separatorLine.y0,
            w: layout.textRight - layout.textLeft,
            h: Math.max(2, separatorLine.y1 - separatorLine.y0 + 1),
            label: layout.goldLine ? '区切り線' : (layout.openCvExtensionLine ? '区切り線(OpenCV)' : '区切り線')
        } : null,
        abbr: abbrRect ? { ...abbrRect, label: '略称' } : null,
        title: titleRect ? { ...titleRect, label: '正式名' } : null
    };
}

/**
 * 自動 OCR が参照する領域（デバッグ表示用）
 * @param {HTMLImageElement} image
 */
export function getEventNameOcrRegions(image) {
    const layout = analyzeHeaderLayout(image);
    return buildEventNameOcrRegions(image, layout);
}

/**
 * OpenCV 意匠検出を含む領域（非同期）
 * @param {HTMLImageElement} image
 */
export async function getEventNameOcrRegionsAsync(image, existingLayout = null) {
    const layout = existingLayout ?? await prepareEventOcrLayout(image);
    return buildEventNameOcrRegions(image, layout);
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
export async function extractEventNamesFromImage(image, existingLayout = null) {
    const worker = await getOcrWorker();
    const layout = existingLayout ?? await prepareEventOcrLayout(image);
    const { abbr: abbrRect, title: titleRect } = resolveEventNameLineRects(image, layout);

    let abbr = '';
    let title = '';

    if (abbrRect) {
        abbr = (await recognizeLineRect(worker, image, abbrRect, { preserveSpaces: true })).text;
        if (!abbr) {
            abbr = (await recognizeLineRect(worker, image, abbrRect, { preserveSpaces: false })).text;
        }
    }

    if (titleRect) {
        title = (await recognizeLineRect(worker, image, titleRect, { preserveSpaces: true })).text;
        if (!title) {
            title = (await recognizeLineRect(worker, image, titleRect, { preserveSpaces: false })).text;
        }
    }

    ({ abbr, title } = maybeSwapAbbrAndTitle(abbr, title));

    const result = finalizeEventHeaderResult({ abbr, title });

    if (!result.abbr && !result.title) {
        throw new Error('イベント名を読み取れませんでした。');
    }

    return result;
}

/**
 * 管理画面向け: 認識できた文字列をできるだけ捨てずに返す。
 * @param {HTMLImageElement} image
 * @returns {Promise<{ abbr: string, title: string }>}
 */
export async function extractEventNamesLenient(image, existingLayout = null) {
    try {
        return await extractEventNamesFromImage(image, existingLayout);
    } catch {
        // strict path failed — fall through to lenient reads below
    }

    const worker = await getOcrWorker();
    const layout = existingLayout ?? await prepareEventOcrLayout(image);
    const { abbr: abbrRect, title: titleRect, bandRects } = resolveEventNameLineRects(image, layout);

    let abbr = '';
    let title = '';

    if (abbrRect) {
        abbr = (await readLineFromRectLenient(worker, image, abbrRect, false)).text;
    }
    if (!abbr && bandRects.abbr && bandRects.abbr !== abbrRect) {
        abbr = (await readLineFromRectLenient(worker, image, bandRects.abbr, false)).text;
    }

    if (titleRect) {
        title = await recognizeTitleRectLenient(worker, image, titleRect);
    }
    if (!title && bandRects.title && bandRects.title !== titleRect) {
        title = await recognizeTitleRectLenient(worker, image, bandRects.title);
    }

    ({ abbr, title } = maybeSwapAbbrAndTitle(abbr, title));

    if (title && abbr && title === abbr) {
        title = '';
    }

    return { abbr, title };
}

/**
 * 区切り線〜精霊アイコン行の帯域から正式名だけ OCR する。
 * @param {HTMLImageElement} image
 * @returns {Promise<string>}
 */
export async function recognizeHeaderTitleBand(image) {
    const worker = await getOcrWorker();
    const layout = await prepareEventOcrLayout(image);
    const bandRects = buildHeaderBandRects(layout, image);
    const lineRects = detectHeaderTextLineRects(image, layout);

    return pickBestOcrText([
        await recognizeTitleRectLenient(worker, image, lineRects.title),
        await recognizeTitleRectLenient(worker, image, bandRects.title)
    ]);
}

/**
 * 任意矩形から文字を OCR する（失敗時は空文字、管理画面向けに緩いサニタイズ）。
 * @param {HTMLImageElement} image
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {{ preserveSpaces?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function recognizeTextFromImageRectLenient(image, rect, { preserveSpaces = true } = {}) {
    const worker = await getOcrWorker();
    const result = await recognizeLineRectLenient(worker, image, rect, { preserveSpaces });
    return result.text ?? '';
}

/**
 * 可視化領域と同じ矩形で、先頭ノイズ除去 ON/OFF の OCR 結果を比較する（デバッグ用）。
 * preserveSpaces=false 時のみ先頭 1〜2 文字除去の差が出る。
 * @param {HTMLImageElement} image
 * @param {object | null} existingLayout
 * @param {{ abbr?: object | null, title?: object | null } | null} regionRects
 */
export async function compareEventNameOcrSanitization(image, existingLayout = null, regionRects = null) {
    const worker = await getOcrWorker();
    const layout = existingLayout ?? await prepareEventOcrLayout(image);

    let abbrRect = regionRects?.abbr ?? null;
    let titleRect = regionRects?.title ?? null;
    if (!abbrRect || !titleRect) {
        const lineRects = resolveEventNameLineRects(image, layout);
        abbrRect = abbrRect ?? lineRects.abbr;
        titleRect = titleRect ?? lineRects.title;
    }

    async function readLine(rect, stripNoisyPrefix) {
        if (!rect) return '';
        const { text } = await recognizeLineRect(worker, image, rect, {
            preserveSpaces: false,
            stripNoisyPrefix
        });
        return text ?? '';
    }

    return {
        abbr: {
            noisyPrefixOn: await readLine(abbrRect, true),
            noisyPrefixOff: await readLine(abbrRect, false)
        },
        title: {
            noisyPrefixOn: await readLine(titleRect, true),
            noisyPrefixOff: await readLine(titleRect, false)
        }
    };
}
