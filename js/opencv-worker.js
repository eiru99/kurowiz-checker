/**
 * OpenCV.js Web Worker — WASM 初期化をメインスレッドから切り離す。
 * キャッシュ無効化: import 先の ?v= を opencv-loader の OPENCV_BUILD_ID と揃えて更新する。
 */
import { detectOrnamentFromRgba } from './opencv-ornament-core.js?v=20250705e';
const OPENCV_MODULE_URLS = [
    '/vendor/opencv-worker/index.js',
    'https://cdn.jsdelivr.net/npm/@opencvjs/worker@4.13.0-release.1/lib/index.js'
];

/** @type {Promise<import('@opencvjs/types').OpenCV> | null} */
let cvPromise = null;

async function loadOpenCvRuntime() {
    if (!cvPromise) {
        cvPromise = (async () => {
            const errors = [];
            for (const url of OPENCV_MODULE_URLS) {
                try {
                    const mod = await import(url);
                    if (typeof mod.loadOpenCV !== 'function') {
                        throw new Error('loadOpenCV missing');
                    }
                    return await mod.loadOpenCV();
                } catch (error) {
                    errors.push(`${url}: ${error.message}`);
                }
            }
            throw new Error(`OpenCV worker module failed — ${errors.join(' | ')}`);
        })();
    }
    return cvPromise;
}

self.onmessage = async (event) => {
    const { id, type, width, height, rgbaBuffer } = event.data;

    try {
        if (type === 'init') {
            await loadOpenCvRuntime();
            self.postMessage({ id, ok: true, ready: true });
            return;
        }

        if (type === 'detect') {
            const cv = await loadOpenCvRuntime();
            const rgba = new Uint8ClampedArray(rgbaBuffer);
            const result = detectOrnamentFromRgba(cv, width, height, rgba);
            self.postMessage({ id, ok: true, result });
            return;
        }

        throw new Error(`Unknown worker message type: ${type}`);
    } catch (error) {
        self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
    }
};
