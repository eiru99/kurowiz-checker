/**
 * OpenCV.js による輪郭検出ベースの精霊切り抜き（テスト用）。
 * spirit-image.js と同じ背景判定で前景マスクを作り、クリック点を含む輪郭から正方形を求める。
 */

/** ローカル配置用（test/vendor/opencv.js に置けばオフラインでも可） */
const OPENCV_JS_URLS = [
    'vendor/opencv.js',
    'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.1/dist/opencv.js',
    'https://docs.opencv.org/4.9.0/opencv.js'
];

let cvReadyPromise = null;

function waitForCvRuntime() {
    const cv = globalThis.cv;
    if (!cv) {
        return Promise.reject(new Error('OpenCV.js は読み込まれましたが cv オブジェクトが見つかりません'));
    }
    if (cv.Mat) {
        return Promise.resolve(cv);
    }
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('OpenCV.js の初期化がタイムアウトしました'));
        }, 120_000);

        cv.onRuntimeInitialized = () => {
            clearTimeout(timeout);
            resolve(cv);
        };
    });
}

function loadOpenCvScript(url) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-opencv-src="${url}"]`);
        if (existing) {
            waitForCvRuntime().then(resolve).catch(reject);
            return;
        }

        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.dataset.opencvSrc = url;
        script.onload = () => {
            waitForCvRuntime().then(resolve).catch(reject);
        };
        script.onerror = () => {
            script.remove();
            reject(new Error(`読み込み失敗: ${url}`));
        };
        document.head.appendChild(script);
    });
}

async function loadOpenCvFromUrls(urls) {
    const errors = [];
    for (const url of urls) {
        try {
            return await loadOpenCvScript(url);
        } catch (error) {
            errors.push(error.message);
        }
    }
    throw new Error(
        'OpenCV.js の読み込みに失敗しました。\n'
        + errors.map(message => `・${message}`).join('\n')
        + '\n\n対処: test/vendor/opencv.js に手動配置するか、ネット接続を確認してください。'
    );
}

export function ensureOpenCv() {
    if (globalThis.cv?.Mat) {
        return Promise.resolve(globalThis.cv);
    }
    if (!cvReadyPromise) {
        cvReadyPromise = loadOpenCvFromUrls(OPENCV_JS_URLS).catch((error) => {
            cvReadyPromise = null;
            throw error;
        });
    }
    return cvReadyPromise;
}

function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function saturation(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
}

function isWhiteGutter(r, g, b) {
    const sat = saturation(r, g, b);
    return r >= 235 && g >= 235 && b >= 235 && sat < 0.08;
}

function isGrayScreenshotBackground(r, g, b) {
    return luminance(r, g, b) > 158 && saturation(r, g, b) < 0.14;
}

function isSpiritBackground(r, g, b) {
    return isWhiteGutter(r, g, b) || isGrayScreenshotBackground(r, g, b);
}

function findNearestForegroundPixel(mask, width, height, x, y) {
    const cx = Math.round(Math.max(0, Math.min(width - 1, x)));
    const cy = Math.round(Math.max(0, Math.min(height - 1, y)));
    if (mask.ucharPtr(cy, cx)[0] > 0) {
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
                if (mask.ucharPtr(ny, nx)[0] > 0) {
                    return { x: nx, y: ny };
                }
            }
        }
    }

    return null;
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
    if (clampedSize <= 0 || x + clampedSize > width || y + clampedSize > height) {
        return null;
    }
    return { x, y, size: clampedSize };
}

function rectToSquare(x, y, w, h, width, height) {
    const size = Math.max(w, h);
    const cx = x + w / 2;
    const cy = y + h / 2;
    return clampSquare(Math.round(cx - size / 2), Math.round(cy - size / 2), size, width, height);
}

function createForegroundMask(cv, imageData, width, height) {
    const mask = new cv.Mat(height, width, cv.CV_8UC1);
    const data = imageData.data;

    for (let py = 0; py < height; py += 1) {
        for (let px = 0; px < width; px += 1) {
            const i = (py * width + px) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            mask.ucharPtr(py, px)[0] = isSpiritBackground(r, g, b) ? 0 : 255;
        }
    }

    return mask;
}

function findContourAtClick(cv, mask, width, height, clickX, clickY) {
    const anchor = findNearestForegroundPixel(mask, width, height, clickX, clickY);
    if (!anchor) return null;

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let best = null;

    for (let i = 0; i < contours.size(); i += 1) {
        const contour = contours.get(i);
        const inside = cv.pointPolygonTest(contour, new cv.Point(anchor.x, anchor.y), false);
        if (inside < 0) continue;

        const area = cv.contourArea(contour);
        const rect = cv.boundingRect(contour);
        if (rect.width < 16 || rect.height < 16) continue;

        if (!best || area < best.area) {
            best = { area, rect };
        }
    }

    contours.delete();
    hierarchy.delete();

    return best?.rect ?? null;
}

/**
 * @param {ImageData} imageData
 * @param {number} width
 * @param {number} height
 * @param {number} clickX
 * @param {number} clickY
 * @returns {Promise<{ x: number, y: number, size: number } | null>}
 */
export async function detectSpiritCropRectAtClickOpenCv(imageData, width, height, clickX, clickY) {
    const cv = await ensureOpenCv();

    let rawMask = null;
    let closedMask = null;
    let kernel = null;

    try {
        rawMask = createForegroundMask(cv, imageData, width, height);
        kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
        closedMask = new cv.Mat();
        cv.morphologyEx(rawMask, closedMask, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);

        const rect = findContourAtClick(cv, closedMask, width, height, clickX, clickY);
        if (!rect) return null;

        return rectToSquare(rect.x, rect.y, rect.width, rect.height, width, height);
    } finally {
        rawMask?.delete();
        closedMask?.delete();
        kernel?.delete();
    }
}

/**
 * デバッグ用: 前景マスクを可視化した ImageData を返す。
 */
export async function createDebugMaskImageData(imageData, width, height) {
    const cv = await ensureOpenCv();

    let rawMask = null;
    let closedMask = null;
    let kernel = null;
    let rgba = null;

    try {
        rawMask = createForegroundMask(cv, imageData, width, height);
        kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
        closedMask = new cv.Mat();
        cv.morphologyEx(rawMask, closedMask, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);

        rgba = new cv.Mat();
        cv.cvtColor(closedMask, rgba, cv.COLOR_GRAY2RGBA);
        const out = new ImageData(new Uint8ClampedArray(rgba.data), width, height);
        return out;
    } finally {
        rawMask?.delete();
        closedMask?.delete();
        kernel?.delete();
        rgba?.delete();
    }
}
