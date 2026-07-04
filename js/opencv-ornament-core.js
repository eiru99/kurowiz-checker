/**

 * OpenCV 意匠検出コア（Worker / メインスレッド共通）。

 * @param {import('@opencvjs/types').OpenCV} cv

 * @param {number} width

 * @param {number} height

 * @param {Uint8ClampedArray} rgba

 */

export function detectOrnamentFromRgba(cv, width, height, rgba) {

    const src = cv.matFromImageData({ data: rgba, width, height });

    const gray = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);



    const raw = buildRawGoldMaskMat(cv, src);

    const frame = buildFrameMaskMat(cv, raw);

    const cleanGray = buildCleanGrayMat(cv, src);

    const cleanMask = buildCleanForegroundMask(cv, cleanGray);

    const scanW = Math.min(width, Math.floor(width * 0.2));

    const yMax = Math.floor(height * 0.38);



    suppressNeutralMarginColumns(raw, gray, scanW);

    suppressNeutralMarginColumns(frame, gray, scanW);

    suppressNeutralMarginColumns(cleanMask, cleanGray, scanW);



    const goldOrnament = findVerticalOrnamentInBand(cv, frame, scanW, width, yMax)

        ?? findVerticalOrnamentInBand(cv, raw, scanW, width, yMax);

    const rectOrnament = findOrnamentByCleanRect(cv, cleanMask, scanW, width, yMax);



    let ornament = pickBestOrnamentCandidate(goldOrnament, rectOrnament, width);



    if (!ornament) {

        src.delete();

        gray.delete();

        raw.delete();

        frame.delete();

        cleanGray.delete();

        cleanMask.delete();

        return null;

    }



    ornament = refineOrnamentTopWidth(raw, ornament);

    let extensionLine = findHorizontalExtensionLine(raw, width, { ...ornament });

    ornament = refineOrnamentTopWidth(cleanMask, ornament);



    if (isInteriorMostlyWhite(cleanGray, ornament)) {

        const relocated = findOrnamentByCleanRect(cv, cleanMask, scanW, width, yMax)

            ?? findVerticalOrnamentInBand(cv, frame, scanW, width, yMax)

            ?? findVerticalOrnamentInBand(cv, raw, scanW, width, yMax);

        if (relocated && scoreOrnamentCandidate(relocated, width) >= scoreOrnamentCandidate(ornament, width) - 40) {

            ornament = relocated;

            ornament = refineOrnamentTopWidth(raw, ornament);

            ornament = refineOrnamentTopWidth(cleanMask, ornament);

            extensionLine = findHorizontalExtensionLine(raw, width, { ...ornament });

        }

    }



    ornament = expandOrnamentToWhiteEdges(cleanGray, ornament, width);

    ornament = clampOrnamentWidth(ornament);



    src.delete();

    gray.delete();

    raw.delete();

    frame.delete();

    cleanGray.delete();

    cleanMask.delete();



    if (extensionLine) {

        ornament.h = Math.max(8, Math.floor(extensionLine.y1) - ornament.y + 1);

    }



    return {

        ...ornament,

        extensionLine

    };

}



function buildRawGoldMaskMat(cv, srcRgba) {

    const rgb = new cv.Mat();

    const hsv = new cv.Mat();

    const goldRange = new cv.Mat();

    const rgbMask = new cv.Mat.zeros(srcRgba.rows, srcRgba.cols, cv.CV_8UC1);

    const raw = new cv.Mat();



    cv.cvtColor(srcRgba, rgb, cv.COLOR_RGBA2RGB);

    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

    const low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [5, 35, 50, 0]);

    const high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [38, 255, 230, 255]);

    cv.inRange(hsv, low, high, goldRange);

    low.delete();

    high.delete();



    const data = rgb.data;

    const maskData = rgbMask.data;

    for (let i = 0, p = 0; i < srcRgba.rows * srcRgba.cols; i += 1, p += 3) {

        const r = data[p];

        const g = data[p + 1];

        const b = data[p + 2];

        maskData[i] = (r > 88 && g > 48 && b < 105 && r > g && g > b) ? 255 : 0;

    }



    cv.bitwise_or(goldRange, rgbMask, raw);



    rgb.delete();

    hsv.delete();

    goldRange.delete();

    rgbMask.delete();

    return raw;

}



/** 背景の網目模様を白に置換したグレースケール。 */

function buildCleanGrayMat(cv, srcRgba) {

    const gray = new cv.Mat();

    const rgb = new cv.Mat();

    const hsv = new cv.Mat();

    cv.cvtColor(srcRgba, gray, cv.COLOR_RGBA2GRAY);

    cv.cvtColor(srcRgba, rgb, cv.COLOR_RGBA2RGB);

    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);



    const rgbData = rgb.data;

    const hsvData = hsv.data;

    const grayData = gray.data;

    const n = srcRgba.rows * srcRgba.cols;



    for (let i = 0, p = 0; i < n; i += 1, p += 3) {

        const r = rgbData[p];

        const g = rgbData[p + 1];

        const b = rgbData[p + 2];

        const s = hsvData[p + 1];

        const lum = grayData[i];

        const isMesh = lum >= 165 && lum <= 248 && s < 45

            && Math.abs(r - g) < 14 && Math.abs(g - b) < 18;

        if (isMesh) {

            grayData[i] = 255;

        }

    }



    rgb.delete();

    hsv.delete();

    return gray;

}



/** 網目除去後の二値化マスク（意匠・文字 = 白）。 */

function buildCleanForegroundMask(cv, cleanGray) {

    const binary = new cv.Mat();

    cv.threshold(cleanGray, binary, 200, 255, cv.THRESH_BINARY_INV);

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));

    cv.morphologyEx(binary, binary, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), 1);

    kernel.delete();

    return binary;

}



function buildFrameMaskMat(cv, raw) {

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));

    const closed = new cv.Mat();

    const opened = new cv.Mat();

    cv.morphologyEx(raw, closed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 1);

    cv.morphologyEx(closed, opened, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), 1);

    kernel.delete();

    closed.delete();

    return opened;

}



function suppressNeutralMarginColumns(mask, gray, scanW) {

    const limit = Math.max(1, Math.floor(mask.rows * 0.35));

    for (let x = 0; x < scanW; x += 1) {

        let white = 0;

        let gold = 0;

        for (let y = 0; y < limit; y += 1) {

            if (gray.ucharAt(y, x) > 200) white += 1;

            if (mask.ucharAt(y, x) > 0) gold += 1;

        }

        if (white / limit > 0.75 && gold / limit < 0.08) {

            for (let y = 0; y < limit; y += 1) {

                mask.ucharPtr(y, x)[0] = 0;

            }

        }

    }

}



function scoreOrnamentCandidate(ornament, imageWidth) {

    if (!ornament) return -1;

    const centerX = ornament.x + ornament.w / 2;

    if (ornament.x > imageWidth * 0.09 || centerX > imageWidth * 0.14) return -1;



    let score = Math.min(ornament.w * ornament.h, 1600);

    score -= ornament.x * 3;

    const aspect = ornament.h / Math.max(ornament.w, 1);

    if (aspect >= 0.75 && aspect <= 2.8) score += 120;

    if (ornament.w >= 8 && ornament.w <= 52 && ornament.h >= 14 && ornament.h <= 110) score += 160;

    score -= Math.abs(aspect - 1.75) * 10;

    return score;

}



function pickBestOrnamentCandidate(goldOrnament, rectOrnament, imageWidth) {

    const goldScore = scoreOrnamentCandidate(goldOrnament, imageWidth);

    const rectScore = scoreOrnamentCandidate(rectOrnament, imageWidth);

    if (goldScore < 0 && rectScore < 0) return null;

    if (goldScore < 0) return { ...rectOrnament };

    if (rectScore < 0) return { ...goldOrnament };



    if (rectOrnament.x + 8 < goldOrnament.x && rectScore >= goldScore - 60) {

        return { ...rectOrnament };

    }

    if (goldOrnament.x + 8 < rectOrnament.x && goldScore >= rectScore - 60) {

        return { ...goldOrnament };

    }

    return rectScore >= goldScore ? { ...rectOrnament } : { ...goldOrnament };

}



function columnWhiteRatio(gray, x, y0, y1, threshold = 200) {

    if (x < 0 || x >= gray.cols || y1 < y0) return 1;

    let white = 0;

    for (let y = y0; y <= y1; y += 1) {

        if (gray.ucharAt(y, x) >= threshold) white += 1;

    }

    return white / (y1 - y0 + 1);

}



function isInteriorMostlyWhite(gray, ornament) {

    const marginX = Math.max(2, Math.floor(ornament.w * 0.18));

    const ix0 = ornament.x + marginX;

    const ix1 = ornament.x + ornament.w - marginX - 1;

    const iy0 = ornament.y + Math.floor(ornament.h * 0.12);

    const iy1 = ornament.y + Math.floor(ornament.h * 0.88);

    if (ix1 <= ix0 || iy1 <= iy0) return true;



    let white = 0;

    let total = 0;

    for (let y = iy0; y <= iy1; y += 1) {

        for (let x = ix0; x <= ix1; x += 1) {

            total += 1;

            if (gray.ucharAt(y, x) >= 200) white += 1;

        }

    }

    return white / total > 0.62;

}



/** 左右の列が白になる位置まで横幅を調整（案A）。 */

function expandOrnamentToWhiteEdges(gray, ornament, imageWidth) {

    const y0 = ornament.y;

    const y1 = Math.min(gray.rows - 1, ornament.y + ornament.h - 1);

    const whiteThreshold = 0.72;

    const maxExpand = Math.max(12, Math.floor(ornament.h * 0.6));

    const maxRight = Math.min(gray.cols - 1, Math.floor(imageWidth * 0.16));



    let x0 = ornament.x;

    let x1 = ornament.x + ornament.w - 1;



    while (x0 > 0 && columnWhiteRatio(gray, x0 - 1, y0, y1) < whiteThreshold && ornament.x - x0 < maxExpand) {

        x0 -= 1;

    }

    while (x0 < x1 && columnWhiteRatio(gray, x0, y0, y1) >= whiteThreshold) {

        x0 += 1;

    }



    while (x1 < maxRight && columnWhiteRatio(gray, x1 + 1, y0, y1) < whiteThreshold && x1 - ornament.x < maxExpand + ornament.w) {

        x1 += 1;

    }

    while (x1 > x0 && columnWhiteRatio(gray, x1, y0, y1) >= whiteThreshold) {

        x1 -= 1;

    }



    if (x1 <= x0) return ornament;



    return {

        x: x0,

        y: ornament.y,

        w: x1 - x0 + 1,

        h: ornament.h

    };

}



function clampOrnamentWidth(ornament) {

    const maxW = Math.max(10, Math.min(26, Math.floor((ornament.h || 24) * 0.85) + 4));

    if (ornament.w <= maxW) return ornament;

    return {

        x: ornament.x,

        y: ornament.y,

        w: maxW,

        h: ornament.h

    };

}



function rowSpanAndDensity(mask, y, scanLeft, scanRight) {

    let nzStart = -1;

    let nzEnd = -1;

    let sum = 0;

    for (let x = scanLeft; x < scanRight; x += 1) {

        const v = mask.ucharAt(y, x);

        sum += v;

        if (v > 0) {

            if (nzStart < 0) nzStart = x;

            nzEnd = x;

        }

    }

    if (nzStart < 0) return null;

    return {

        span: nzEnd - nzStart,

        density: sum / ((scanRight - scanLeft) * 255)

    };

}



function expandLineRun(mask, peakY, peakAvg, scanLeft, scanRight, maxRun) {

    let y0 = peakY;

    let y1 = peakY;

    const threshold = Math.max(8, peakAvg * 0.38);



    while (y0 > 0 && y1 - y0 < maxRun - 1) {

        let rowSum = 0;

        for (let x = scanLeft; x < scanRight; x += 1) rowSum += mask.ucharAt(y0 - 1, x);

        if (rowSum / (scanRight - scanLeft) < threshold) break;

        y0 -= 1;

    }

    while (y1 < mask.rows - 1 && y1 - y0 < maxRun - 1) {

        let rowSum = 0;

        for (let x = scanLeft; x < scanRight; x += 1) rowSum += mask.ucharAt(y1 + 1, x);

        if (rowSum / (scanRight - scanLeft) < threshold) break;

        y1 += 1;

    }



    return { y0, y1, centerY: (y0 + y1) / 2 };

}



function refineOrnamentTopWidth(mask, ornament) {

    const topRows = Math.min(6, Math.max(3, Math.floor(ornament.w * 0.25)));

    let minX = ornament.x + ornament.w;

    let maxX = ornament.x;

    let found = false;



    for (let dy = 0; dy < topRows; dy += 1) {

        const row = ornament.y + dy;

        if (row >= mask.rows) break;

        const colEnd = Math.min(mask.cols, ornament.x + Math.max(ornament.w, 32) + 4);

        for (let col = Math.max(0, ornament.x - 2); col < colEnd; col += 1) {

            if (mask.ucharAt(row, col) > 0) {

                found = true;

                minX = Math.min(minX, col);

                maxX = Math.max(maxX, col);

            }

        }

    }



    if (!found) return ornament;



    const maxW = Math.max(10, Math.min(26, Math.floor((ornament.h || 24) * 0.85) + 4));

    const w = Math.min(maxW, maxX - minX + 1);

    return {

        x: minX,

        y: ornament.y,

        w: Math.max(8, w),

        h: ornament.h

    };

}



function findHorizontalExtensionLine(mask, imageWidth, ornament) {

    const scanLeft = Math.max(ornament.x + Math.floor(ornament.w * 0.15), 8);

    const scanRight = Math.floor(imageWidth * 0.97);

    const connectLeft = ornament.x;

    const connectRight = ornament.x + ornament.w + 3;

    const minSpan = Math.max(30, Math.floor((scanRight - scanLeft) * 0.08));

    const maxRun = 8;

    const yStart = ornament.y + Math.max(6, Math.floor(ornament.w * 0.35));

    const yEnd = Math.min(mask.rows - 1, ornament.y + Math.max(80, Math.floor(ornament.w * 3.2)));



    let best = null;



    for (let y = yStart; y <= yEnd; y += 1) {

        let connectSum = 0;

        for (let x = connectLeft; x <= connectRight && x < mask.cols; x += 1) {

            connectSum += mask.ucharAt(y, x);

        }

        if (connectSum / (connectRight - connectLeft + 1) < 12) continue;



        const metrics = rowSpanAndDensity(mask, y, scanLeft, scanRight);

        if (!metrics || metrics.span < minSpan || metrics.density < 0.006) continue;



        const score = metrics.span * (0.35 + metrics.density);

        if (!best || score > best.score) {

            let rowSum = 0;

            for (let x = scanLeft; x < scanRight; x += 1) rowSum += mask.ucharAt(y, x);

            best = {

                score,

                y,

                peakAvg: rowSum / (scanRight - scanLeft)

            };

        }

    }



    if (!best) return null;

    return expandLineRun(mask, best.y, best.peakAvg, scanLeft, scanRight, maxRun);

}



function findVerticalOrnamentInBand(cv, mask, scanW, imageWidth, yMax) {

    const roi = mask.roi(new cv.Rect(0, 0, scanW, yMax));

    const contours = new cv.MatVector();

    const hierarchy = new cv.Mat();

    cv.findContours(roi, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);



    let best = null;

    for (let i = 0; i < contours.size(); i += 1) {

        const rect = cv.boundingRect(contours.get(i));

        const { x, y, width: cw, height: ch } = rect;

        if (cw < 5 || ch < 10) continue;

        if (x > imageWidth * 0.09) continue;

        if (cw > imageWidth * 0.12) continue;

        const aspect = ch / Math.max(cw, 1);

        if (aspect < 0.5 || aspect > 3.5) continue;

        let score = cw * ch - x * 2.5;

        if (aspect >= 0.75 && aspect <= 2.8) score += 100;

        if (!best || score > best.score) {

            best = { score, x, y, w: cw, h: ch };

        }

    }



    roi.delete();

    contours.delete();

    hierarchy.delete();



    if (!best) return null;



    const maxW = Math.max(10, Math.min(26, Math.floor(best.h * 0.85) + 4));

    return {

        x: best.x,

        y: best.y,

        w: Math.min(best.w, maxW),

        h: best.h

    };

}



/** 二値化マスク上の矩形輪郭から意匠を検出（案B）。 */

function findOrnamentByCleanRect(cv, cleanMask, scanW, imageWidth, yMax) {

    const roi = cleanMask.roi(new cv.Rect(0, 0, scanW, yMax));

    const closed = new cv.Mat();

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 5));

    cv.morphologyEx(roi, closed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 1);

    kernel.delete();



    const contours = new cv.MatVector();

    const hierarchy = new cv.Mat();

    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);



    let best = null;

    let bestScore = -1;



    for (let i = 0; i < contours.size(); i += 1) {

        const rect = cv.boundingRect(contours.get(i));

        const { x, y, width: cw, height: ch } = rect;

        if (cw < 6 || ch < 12) continue;

        if (x > imageWidth * 0.09) continue;

        if (cw > imageWidth * 0.14) continue;

        const aspect = ch / Math.max(cw, 1);

        if (aspect < 0.55 || aspect > 3.2) continue;



        const candidate = { x, y, w: cw, h: ch };

        const score = scoreOrnamentCandidate(candidate, imageWidth);

        if (score > bestScore) {

            bestScore = score;

            best = candidate;

        }

    }



    roi.delete();

    closed.delete();

    contours.delete();

    hierarchy.delete();



    if (!best) return null;

    return clampOrnamentWidth(best);

}


