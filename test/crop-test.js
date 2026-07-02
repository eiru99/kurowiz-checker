/**
 * 精霊クリック切り抜きの精度テスト用ページ。
 * 既存ピクセル走査（spirit-image.js）と OpenCV 輪郭検出を比較できる。
 */
import {
    cropAndNormalizeSpiritImage,
    detectSpiritCropRectAtClickByContour,
    detectSpiritCropRectAtClickByPixelScan,
    createDebugMaskImageData,
    imageNeedsCropMode,
    loadImageFromFile,
    normalizeImageElement,
    readImageDataFromElement,
    SPIRIT_IMAGE_SIZE
} from '../js/spirit-image.js';

const dropzone = document.getElementById('dropzone');
const previewStage = document.getElementById('preview-stage');
const preview = document.getElementById('preview');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const resultImg = document.getElementById('result');
const resultPlaceholder = document.getElementById('result-placeholder');
const detectionInfo = document.getElementById('detection-info');
const infoClick = document.getElementById('info-click');
const infoRect = document.getElementById('info-rect');
const infoOutput = document.getElementById('info-output');
const resultOpenCvImg = document.getElementById('result-opencv');
const resultOpenCvPlaceholder = document.getElementById('result-opencv-placeholder');
const detectionInfoOpenCv = document.getElementById('detection-info-opencv');
const infoRectOpenCv = document.getElementById('info-rect-opencv');
const infoOutputOpenCv = document.getElementById('info-output-opencv');
const fileInput = document.getElementById('file-input');
const loadSampleBtn = document.getElementById('load-sample');
const resetBtn = document.getElementById('reset-btn');
const showMaskBtn = document.getElementById('show-mask-btn');
const stayCropToggle = document.getElementById('stay-crop-toggle');
const historyEl = document.getElementById('history');
const resultsGrid = document.getElementById('results-grid');
const opencvResultPanel = document.getElementById('opencv-result-panel');
const pixelResultTitle = document.getElementById('pixel-result-title');
const maskPanel = document.getElementById('mask-panel');
const maskCanvas = document.getElementById('mask-canvas');
const methodRadios = document.querySelectorAll('input[name="detect-method"]');

let pendingCropImage = null;
let pendingCropObjectUrl = null;
let resultObjectUrl = null;
let resultOpenCvObjectUrl = null;
let stayInCropMode = true;
let historyCount = 0;
let detectMethod = 'pixel';
let lastImageData = null;
let lastImageWidth = 0;
let lastImageHeight = 0;

const IMAGE_MIME_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

function extensionFromMime(mime) {
    return IMAGE_MIME_EXTENSIONS[mime] ?? 'png';
}

function normalizePastedImageFile(file) {
    if (file.name && file.name.includes('.')) return file;
    const extension = extensionFromMime(file.type);
    return new File([file], `screenshot.${extension}`, { type: file.type || 'image/png' });
}

function getDetectMethod() {
    return document.querySelector('input[name="detect-method"]:checked')?.value ?? 'pixel';
}

function usesPixel() {
    return detectMethod === 'pixel' || detectMethod === 'compare';
}

function usesOpenCv() {
    return detectMethod === 'opencv' || detectMethod === 'compare';
}

function updateMethodUi() {
    detectMethod = getDetectMethod();
    const compare = detectMethod === 'compare';
    resultsGrid.classList.toggle('compare-mode', compare);
    opencvResultPanel.hidden = !usesOpenCv();
    pixelResultTitle.textContent = compare
        ? '旧方式 切り抜き結果（128×128）'
        : '切り抜き結果（128×128）';
    showMaskBtn.disabled = !pendingCropImage;
}

function setStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = `status${type ? ` ${type}` : ''}`;
}

function getImageFitMetrics() {
    const rect = preview.getBoundingClientRect();
    const naturalWidth = pendingCropImage?.naturalWidth ?? preview.naturalWidth;
    const naturalHeight = pendingCropImage?.naturalHeight ?? preview.naturalHeight;
    if (!naturalWidth || !naturalHeight || !rect.width || !rect.height) {
        return null;
    }

    const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
    const displayWidth = naturalWidth * scale;
    const displayHeight = naturalHeight * scale;

    return {
        scale,
        offsetLeft: (rect.width - displayWidth) / 2,
        offsetTop: (rect.height - displayHeight) / 2,
        displayWidth,
        displayHeight
    };
}

function clientToImagePoint(clientX, clientY) {
    const metrics = getImageFitMetrics();
    if (!metrics) return null;

    const stageRect = previewStage.getBoundingClientRect();
    const displayX = clientX - stageRect.left - metrics.offsetLeft;
    const displayY = clientY - stageRect.top - metrics.offsetTop;

    if (
        displayX < 0
        || displayY < 0
        || displayX > metrics.displayWidth
        || displayY > metrics.displayHeight
    ) {
        return null;
    }

    return {
        imageX: displayX / metrics.scale,
        imageY: displayY / metrics.scale
    };
}

function clearCropMode() {
    pendingCropImage = null;
    lastImageData = null;
    if (pendingCropObjectUrl) {
        URL.revokeObjectURL(pendingCropObjectUrl);
        pendingCropObjectUrl = null;
    }
    dropzone.classList.remove('crop-mode');
    previewStage.removeEventListener('click', handleCropClick);
    overlay.hidden = true;
    showMaskBtn.disabled = true;
    maskPanel.hidden = true;
}

function clearResultPanels() {
    if (resultObjectUrl) {
        URL.revokeObjectURL(resultObjectUrl);
        resultObjectUrl = null;
    }
    if (resultOpenCvObjectUrl) {
        URL.revokeObjectURL(resultOpenCvObjectUrl);
        resultOpenCvObjectUrl = null;
    }

    resultImg.hidden = true;
    resultImg.removeAttribute('src');
    resultPlaceholder.hidden = false;
    detectionInfo.hidden = true;

    resultOpenCvImg.hidden = true;
    resultOpenCvImg.removeAttribute('src');
    resultOpenCvPlaceholder.hidden = false;
    detectionInfoOpenCv.hidden = true;
}

function clearAll() {
    clearCropMode();
    preview.removeAttribute('src');
    previewStage.hidden = true;
    dropzone.classList.remove('has-image');
    fileInput.value = '';
    resetBtn.disabled = true;
    clearResultPanels();
    setStatus('画像を貼り付けるか選択してください');
}

function enterCropMode(image, objectUrl) {
    clearCropMode();
    pendingCropImage = image;
    pendingCropObjectUrl = objectUrl;
    preview.src = objectUrl;
    previewStage.hidden = false;
    dropzone.classList.add('has-image', 'crop-mode');
    resetBtn.disabled = false;
    showMaskBtn.disabled = !pendingCropImage;
    setStatus('切り抜きモード: 精霊アイコンをクリックしてください', 'ok');
    previewStage.addEventListener('click', handleCropClick);
}

function drawOverlay(cropRects, clickPoint) {
    const metrics = getImageFitMetrics();
    if (!metrics) return;

    overlay.width = metrics.displayWidth;
    overlay.height = metrics.displayHeight;
    overlay.hidden = false;

    const ctx = overlay.getContext('2d');
    const s = metrics.scale;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const styles = [
        { rect: cropRects.pixel, color: '#00e676', label: 'pixel' },
        { rect: cropRects.opencv, color: '#2979ff', label: 'opencv' }
    ];

    for (const { rect, color } of styles) {
        if (!rect) continue;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x * s, rect.y * s, rect.size * s, rect.size * s);
    }

    if (clickPoint) {
        const cx = clickPoint.imageX * s;
        const cy = clickPoint.imageY * s;
        ctx.fillStyle = '#ff1744';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}

function showPixelDetectionInfo(clickPoint, cropRect, blobSize) {
    detectionInfo.hidden = false;
    infoClick.textContent = `(${Math.round(clickPoint.imageX)}, ${Math.round(clickPoint.imageY)})`;
    infoRect.textContent = `x=${cropRect.x}, y=${cropRect.y}, size=${cropRect.size}`;
    infoOutput.textContent = `${SPIRIT_IMAGE_SIZE}×${SPIRIT_IMAGE_SIZE} WebP (${blobSize} bytes)`;
}

function showOpenCvDetectionInfo(cropRect, blobSize) {
    detectionInfoOpenCv.hidden = false;
    infoRectOpenCv.textContent = `x=${cropRect.x}, y=${cropRect.y}, size=${cropRect.size}`;
    infoOutputOpenCv.textContent = `${SPIRIT_IMAGE_SIZE}×${SPIRIT_IMAGE_SIZE} WebP (${blobSize} bytes)`;
}

async function showResult(blob, target = 'pixel') {
    const url = URL.createObjectURL(blob);
    if (target === 'opencv') {
        if (resultOpenCvObjectUrl) URL.revokeObjectURL(resultOpenCvObjectUrl);
        resultOpenCvObjectUrl = url;
        resultOpenCvImg.src = url;
        resultOpenCvImg.hidden = false;
        resultOpenCvPlaceholder.hidden = true;
    } else {
        if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);
        resultObjectUrl = url;
        resultImg.src = url;
        resultImg.hidden = false;
        resultPlaceholder.hidden = true;
    }
    return blob.size;
}

function appendHistory(entry) {
    const empty = historyEl.querySelector('.history-empty');
    if (empty) empty.remove();

    historyCount += 1;
    const li = document.createElement('li');
    li.className = entry.ok ? 'ok' : 'err';
    li.textContent = `#${historyCount} ${entry.text}`;
    historyEl.prepend(li);
}

function formatRect(rect) {
    if (!rect) return 'null';
    return `(${rect.x},${rect.y},${rect.size})`;
}

async function runDetection(point) {
    const { imageData, width, height } = readImageDataFromElement(pendingCropImage);
    lastImageData = imageData;
    lastImageWidth = width;
    lastImageHeight = height;

    const results = {
        pixel: null,
        opencv: null,
        pixelBlobSize: null,
        opencvBlobSize: null
    };

    if (usesPixel()) {
        results.pixel = detectSpiritCropRectAtClickByPixelScan(imageData, width, height, point.imageX, point.imageY);
    }

    if (usesOpenCv()) {
        results.opencv = detectSpiritCropRectAtClickByContour(imageData, width, height, point.imageX, point.imageY);
    }

    return results;
}

async function handleCropClick(event) {
    if (!pendingCropImage) return;
    event.preventDefault();
    event.stopPropagation();

    const point = clientToImagePoint(event.clientX, event.clientY);
    if (!point) return;

    try {
        const results = await runDetection(point);
        const anySuccess = Boolean(results.pixel || results.opencv);

        if (!anySuccess) {
            setStatus('検出失敗 — アイコンの中央付近をクリックしてください', 'err');
            appendHistory({
                ok: false,
                text: `失敗 @ (${Math.round(point.imageX)}, ${Math.round(point.imageY)}) [${detectMethod}]`
            });
            overlay.hidden = true;
            return;
        }

        drawOverlay(results, point);

        if (results.pixel) {
            const blob = await cropAndNormalizeSpiritImage(pendingCropImage, results.pixel);
            const blobSize = await showResult(blob, 'pixel');
            showPixelDetectionInfo(point, results.pixel, blobSize);
        }

        if (results.opencv) {
            const blob = await cropAndNormalizeSpiritImage(pendingCropImage, results.opencv);
            const blobSize = await showResult(blob, 'opencv');
            showOpenCvDetectionInfo(results.opencv, blobSize);
        }

        const statusParts = [];
        if (usesPixel()) statusParts.push(`既存 ${formatRect(results.pixel)}`);
        if (usesOpenCv()) statusParts.push(`輪郭 ${formatRect(results.opencv)}`);
        setStatus(`検出完了: ${statusParts.join(' / ')}`, 'ok');

        appendHistory({
            ok: true,
            text: `${detectMethod} @ click(${Math.round(point.imageX)},${Math.round(point.imageY)}) → pixel${formatRect(results.pixel)} opencv${formatRect(results.opencv)}`
        });

        if (!stayInCropMode) {
            clearCropMode();
            dropzone.classList.remove('crop-mode');
        }
    } catch (error) {
        console.error(error);
        setStatus(error.message || '切り抜きに失敗しました', 'err');
        appendHistory({
            ok: false,
            text: `エラー: ${error.message}`
        });
    }
}

async function processIncomingImage(file) {
    const normalizedFile = normalizePastedImageFile(file);
    const { image, objectUrl } = await loadImageFromFile(normalizedFile);

    if (imageNeedsCropMode(image)) {
        enterCropMode(image, objectUrl);
        return;
    }

    try {
        const blob = await normalizeImageElement(image);
        preview.src = objectUrl;
        previewStage.hidden = false;
        dropzone.classList.add('has-image');
        resetBtn.disabled = false;

        const blobSize = await showResult(blob, 'pixel');
        setStatus('単体アイコン画像 — 自動で 128×128 に正規化しました', 'ok');
        appendHistory({
            ok: true,
            text: `自動正規化 (${normalizedFile.name}, ${blobSize} bytes)`
        });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function showForegroundMask() {
    if (!pendingCropImage) return;

    const { imageData, width, height } = lastImageData
        ? { imageData: lastImageData, width: lastImageWidth, height: lastImageHeight }
        : readImageDataFromElement(pendingCropImage);

    const maskData = createDebugMaskImageData(imageData, width, height);
    maskCanvas.width = width;
    maskCanvas.height = height;
    maskCanvas.getContext('2d').putImageData(maskData, 0, 0);
    maskPanel.hidden = false;
}

function handlePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (!item.type.startsWith('image/')) continue;

        const file = item.getAsFile();
        if (!file) continue;

        event.preventDefault();
        processIncomingImage(file).catch(error => {
            console.error(error);
            setStatus(error.message || '画像の読み込みに失敗しました', 'err');
        });
        return;
    }
}

fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    processIncomingImage(file).catch(error => {
        console.error(error);
        setStatus(error.message || '画像の読み込みに失敗しました', 'err');
    });
});

loadSampleBtn.addEventListener('click', async () => {
    try {
        const response = await fetch('../test-assets/screenshot.png');
        if (!response.ok) throw new Error('サンプル画像の読み込みに失敗しました');
        const blob = await response.blob();
        await processIncomingImage(new File([blob], 'screenshot.png', { type: 'image/png' }));
    } catch (error) {
        console.error(error);
        setStatus(error.message, 'err');
    }
});

resetBtn.addEventListener('click', clearAll);
showMaskBtn.addEventListener('click', () => {
    showForegroundMask().catch(error => {
        console.error(error);
        setStatus(error.message, 'err');
    });
});

stayCropToggle.addEventListener('click', () => {
    stayInCropMode = !stayInCropMode;
    stayCropToggle.classList.toggle('active', stayInCropMode);
    stayCropToggle.setAttribute('aria-pressed', String(stayInCropMode));
    stayCropToggle.textContent = stayInCropMode
        ? '連続テスト（切り抜きモード維持）'
        : '1回クリックで終了';
});

for (const radio of methodRadios) {
    radio.addEventListener('change', () => {
        updateMethodUi();
        clearResultPanels();
    });
}

document.addEventListener('paste', handlePaste);

updateMethodUi();
