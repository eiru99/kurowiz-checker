/**
 * OpenCV.js loader — Web Worker 経由で非ブロッキング初期化。
 */
const INIT_TIMEOUT_MS = 90_000;

/** @type {Worker | null} */
let worker = null;
/** @type {Promise<boolean> | null} */
let readyPromise = null;
let ready = false;
let requestSeq = 0;
/** @type {Map<number, { resolve: Function, reject: Function, timer: number }>} */
const pending = new Map();

const OPENCV_BUILD_ID = '20250705e';

function getWorker() {
    if (!worker) {
        worker = new Worker(
            new URL(`./opencv-worker.js?v=${OPENCV_BUILD_ID}`, import.meta.url),
            { type: 'module' }
        );
        worker.onmessage = (event) => {
            const { id, ok, result, error, ready: workerReady } = event.data ?? {};
            const entry = pending.get(id);
            if (!entry) return;
            pending.delete(id);
            clearTimeout(entry.timer);
            if (ok) {
                if (workerReady) ready = true;
                entry.resolve(result ?? true);
            } else {
                entry.reject(new Error(error ?? 'OpenCV worker error'));
            }
        };
        worker.onerror = (event) => {
            const detail = [event.message, event.filename, event.lineno].filter(Boolean).join(' ');
            for (const [, entry] of pending) {
                clearTimeout(entry.timer);
                entry.reject(new Error(detail || 'OpenCV worker crashed'));
            }
            pending.clear();
            worker = null;
            readyPromise = null;
            ready = false;
        };
    }
    return worker;
}

function sendWorkerMessage(payload, transferables = [], timeoutMs = INIT_TIMEOUT_MS) {
    const id = ++requestSeq;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`OpenCV worker timeout (${timeoutMs}ms)`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        getWorker().postMessage({ id, ...payload }, transferables);
    });
}

/**
 * Worker 内 OpenCV ランタイムの準備完了を待つ。
 * @param {{ initTimeoutMs?: number, timeoutMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
export async function ensureOpenCv(options = {}) {
    const timeoutMs = options.initTimeoutMs ?? options.timeoutMs ?? INIT_TIMEOUT_MS;
    if (ready) return true;

    if (!readyPromise) {
        readyPromise = sendWorkerMessage({ type: 'init' }, [], timeoutMs)
            .then(() => true)
            .catch((error) => {
                readyPromise = null;
                throw error;
            });
    }

    return readyPromise;
}

export function isOpenCvReady() {
    return ready;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray} rgba
 * @param {{ initTimeoutMs?: number }} [options]
 */
export async function detectOrnamentViaWorker(width, height, rgba, options = {}) {
    await ensureOpenCv(options);
    const buffer = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
    return sendWorkerMessage(
        { type: 'detect', width, height, rgbaBuffer: buffer },
        [buffer],
        options.initTimeoutMs ?? INIT_TIMEOUT_MS
    );
}
