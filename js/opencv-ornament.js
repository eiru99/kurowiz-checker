/**
 * OpenCV.js によるイベントヘッダー意匠検出（Web Worker 経由）。
 */
import { ensureOpenCv, isOpenCvReady, detectOrnamentViaWorker } from './opencv-loader.js';

/**
 * @param {HTMLCanvasElement} canvas ヘッダー走査帯 canvas
 * @returns {Promise<{ x: number, y: number, w: number, h: number, extensionLine: { y0: number, y1: number, centerY: number } } | null>}
 */
export async function detectOrnamentFromCanvasAsync(canvas) {
    await ensureOpenCv();
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    return detectOrnamentViaWorker(width, height, data);
}

/** @deprecated Worker 版では同期 API 非対応。detectOrnamentFromCanvasAsync を使用。 */
export function detectOrnamentFromCanvas(canvas) {
    console.warn('detectOrnamentFromCanvas: sync API unavailable with worker OpenCV');
    return null;
}

export { isOpenCvReady, ensureOpenCv };
