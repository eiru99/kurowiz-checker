import { ADMIN_PIN } from './config.js';
import {
    createEventId,
    createSpiritId,
    fetchCatalogRows,
    getSpiritImageUrl,
    abbrToStorageFolder,
    resolveStorageFolder,
    SECTIONS_WITHOUT_DISPLAY_TITLE,
    uploadSpiritImage
} from './catalog.js?v=20250706g';
import {
    extractEventNamesFromImage,
    ensureEventOcrOpenCv,
    getEventNameOcrRegionsAsync,
    normalizeEventNames,
    prepareEventOcrLayout,
    recognizeHeaderTitleBand,
    recognizeTextFromImageRectLenient
} from './event-ocr.js?v=20250705q';
import {
    blobToSpiritFile,
    cropAndNormalizeSpiritImage,
    detectSpiritAttributes,
    detectSpiritCropRectAtClick,
    imageNeedsCropMode,
    loadImageFromFile,
    normalizeImageElement,
    readImageDataFromElement,
    squareCropRectForImage
} from './spirit-image.js';

const ELEMENTS = ['火', '水', '雷', '光', '闇'];
const UNDETECTED_ELEMENT = '-';
const ADMIN_SESSION_KEY = 'wiz_admin_unlocked';

let database = null;
let reloadCatalog = null;
let catalogRows = { sections: [], events: [], spirits: [] };

const dialog = document.getElementById('admin-dialog');
const form = document.getElementById('admin-form');
const dialogTitle = document.getElementById('admin-dialog-title');
const editTitleBtn = document.getElementById('admin-edit-title-btn');
const editEventTitleBlock = document.getElementById('edit-event-title-block');
const editEventAbbrInput = document.getElementById('admin-edit-event-abbr');
const editEventTitleInput = document.getElementById('admin-edit-event-title');
const editEventYearInput = document.getElementById('admin-edit-event-year');
const editEventMonthInput = document.getElementById('admin-edit-event-month');
const editTitleSaveBtn = document.getElementById('admin-edit-title-save-btn');
const editTitleCancelBtn = document.getElementById('admin-edit-title-cancel-btn');
const eventModeExisting = document.getElementById('event-mode-existing');
const eventModeNew = document.getElementById('event-mode-new');
const existingEventBlock = document.getElementById('existing-event-block');
const newEventBlock = document.getElementById('new-event-block');
const spiritDetailsBlock = document.getElementById('spirit-details-block');
const existingEventSelect = document.getElementById('admin-existing-event');
const eventAbbrInput = document.getElementById('admin-event-abbr');
const eventTitleInput = document.getElementById('admin-event-title');
const eventNameAutoOcrToggle = document.getElementById('admin-event-name-auto-ocr');
const spiritNameInput = document.getElementById('admin-spirit-name');
const editNameBlock = document.getElementById('edit-name-block');
const editAttrsBlock = document.getElementById('edit-attrs-block');
const spiritMainSelect = document.getElementById('admin-spirit-main');
const spiritSubSelect = document.getElementById('admin-spirit-sub');
const imageDropzone = document.getElementById('admin-image-dropzone');
const imageInput = document.getElementById('admin-spirit-image');
const imagePreviewStage = document.getElementById('admin-image-preview-stage');
const imagePreview = document.getElementById('admin-image-preview');
const ocrSelection = document.getElementById('admin-ocr-selection');
const ocrRegionOverlays = document.getElementById('admin-ocr-region-overlays');
const imageHint = document.getElementById('admin-image-hint');
const submitButton = document.getElementById('admin-submit-btn');
const spiritQueueBlock = document.getElementById('spirit-queue-block');
const spiritQueueList = document.getElementById('spirit-queue-list');
const spiritQueueHeading = document.getElementById('spirit-queue-heading');
const adminImageGroup = document.getElementById('admin-image-group');

let previewObjectUrl = null;
let pendingCropImage = null;
let pendingCropObjectUrl = null;
/** @type {{ id: string, spiritId?: string, file: File | null, objectUrl: string, isExternalUrl?: boolean, name: string, main: string, sub: string, hideSub: boolean, imagePath?: string, sortOrder?: number, infoUrl?: string }[]} */
let spiritQueue = [];
let editingEventId = null;
let imageReplaceTargetId = null;
/** @type {'abbr' | 'title' | null} */
let ocrSelectTarget = null;
/** @type {HTMLButtonElement | null} */
let ocrSelectButton = null;
/** @type {{ startX: number, startY: number, currentX: number, currentY: number } | null} */
let ocrDragState = null;
let ocrSelectHint = '';
let blockSpiritCropClick = false;
/** @type {string[]} */
let spiritsToDelete = [];

const IMAGE_MIME_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

const DEFAULT_IMAGE_HINT = 'PNG / JPG など（必須）。「自動読み取り」をオンにするとイベント名を取得。スクショは精霊をクリックで切り抜き（複数可）';

function normalizeInfoUrl(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';

    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('invalid protocol');
        }
        return url.href;
    } catch {
        throw new Error('説明リンクには http:// または https:// で始まるURLを入力してください。');
    }
}

function openInfoUrlFromInput(input) {
    try {
        const url = normalizeInfoUrl(input.value);
        if (!url) {
            alert('URLを入力してください。');
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
        alert(error.message || 'URLを開けませんでした。');
    }
}

function appendInfoUrlField(fields, item) {
    const infoUrlRow = document.createElement('div');
    infoUrlRow.className = 'spirit-queue-info-url-row';

    const infoUrlOpenBtn = document.createElement('button');
    infoUrlOpenBtn.type = 'button';
    infoUrlOpenBtn.className = 'spirit-queue-info-url-btn';
    infoUrlOpenBtn.textContent = 'URL';
    infoUrlOpenBtn.title = '入力したURLを開く';

    const infoUrlInput = document.createElement('input');
    infoUrlInput.type = 'url';
    infoUrlInput.className = 'spirit-queue-info-url';
    infoUrlInput.placeholder = '精霊説明ページのURL';
    infoUrlInput.value = item.infoUrl ?? '';
    infoUrlInput.inputMode = 'url';
    infoUrlInput.addEventListener('input', () => {
        item.infoUrl = infoUrlInput.value;
    });
    infoUrlOpenBtn.addEventListener('click', () => openInfoUrlFromInput(infoUrlInput));

    infoUrlRow.append(infoUrlOpenBtn, infoUrlInput);
    fields.append(infoUrlRow);
}

function validateSpiritQueueInfoUrls() {
    for (const item of spiritQueue) {
        normalizeInfoUrl(item.infoUrl ?? '');
    }
}

function isEventNameAutoOcrEnabled() {
    return Boolean(eventNameAutoOcrToggle?.checked);
}

function canAutoReadEventNames() {
    return !editingEventId && !eventModeExisting.checked;
}

function clearSpiritQueue() {
    for (const item of spiritQueue) {
        if (item.objectUrl && !item.isExternalUrl) {
            URL.revokeObjectURL(item.objectUrl);
        }
    }
    spiritQueue = [];
    spiritQueueList.innerHTML = '';
    spiritQueueBlock.hidden = true;
    updateQueueHeading();
    updateSubmitButtonLabel();
}

function updateQueueHeading() {
    const prefix = editingEventId ? '編集する精霊' : '追加する精霊';
    spiritQueueHeading.textContent = `${prefix} ${spiritQueue.length}体`;
}

function updateSubmitButtonLabel() {
    if (editingEventId) {
        submitButton.textContent = '更新する';
        return;
    }
    submitButton.textContent = spiritQueue.length > 0
        ? `${spiritQueue.length}体を追加する`
        : '追加する';
}

function toQueueAttribute(detected) {
    return detected ?? UNDETECTED_ELEMENT;
}

function populateAttributeSelect(select) {
    select.innerHTML = '';
    const unknownOption = document.createElement('option');
    unknownOption.value = UNDETECTED_ELEMENT;
    unknownOption.textContent = UNDETECTED_ELEMENT;
    select.appendChild(unknownOption);

    for (const element of ELEMENTS) {
        const option = document.createElement('option');
        option.value = element;
        option.textContent = element;
        select.appendChild(option);
    }
}

function syncAttributeSelectStyle(select) {
    select.classList.toggle('attr-undetected', select.value === UNDETECTED_ELEMENT);
    for (const element of ELEMENTS) {
        select.classList.toggle(`attr-${element}`, select.value === element);
    }
}

function shouldHideSub(main, sub) {
    return main !== UNDETECTED_ELEMENT
        && sub !== UNDETECTED_ELEMENT
        && main === sub;
}

function onQueueAttributeChange(item) {
    if (shouldHideSub(item.main, item.sub)) {
        item.sub = item.main;
        if (!item.hideSub) {
            item.hideSub = true;
            renderSpiritQueue();
        }
        return;
    }
    if (item.hideSub) {
        item.hideSub = false;
        renderSpiritQueue();
    }
}

function renderSpiritQueue() {
    spiritQueueList.innerHTML = '';
    updateQueueHeading();
    spiritQueueBlock.hidden = spiritQueue.length === 0;
    spiritQueueBlock.classList.toggle('has-info-url', spiritQueue.length > 0);

    for (const item of spiritQueue) {
        const li = document.createElement('li');
        li.className = 'spirit-queue-item';
        if (editingEventId && item.id === imageReplaceTargetId) {
            li.classList.add('thumb-selected');
        }
        li.dataset.queueId = item.id;

        const thumb = document.createElement('img');
        thumb.className = 'spirit-queue-thumb';
        if (editingEventId) {
            thumb.classList.add('clickable');
            thumb.title = 'クリックして画像を差し替え';
            thumb.addEventListener('click', () => selectImageReplaceTarget(item.id));
        }
        thumb.src = item.objectUrl;
        thumb.alt = '';

        const fields = document.createElement('div');
        fields.className = 'spirit-queue-fields';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = '精霊名';
        nameInput.value = item.name;
        nameInput.required = true;
        nameInput.addEventListener('input', () => {
            item.name = nameInput.value;
        });

        const attrs = document.createElement('div');
        attrs.className = 'spirit-queue-attrs';
        if (item.hideSub) {
            attrs.classList.add('single-attr');
        }

        const mainSelect = document.createElement('select');
        populateAttributeSelect(mainSelect);
        mainSelect.value = item.main;
        syncAttributeSelectStyle(mainSelect);
        mainSelect.addEventListener('change', () => {
            item.main = mainSelect.value;
            syncAttributeSelectStyle(mainSelect);
            onQueueAttributeChange(item);
        });

        attrs.append(mainSelect);

        if (!item.hideSub) {
            const subSelect = document.createElement('select');
            populateAttributeSelect(subSelect);
            subSelect.value = item.sub;
            syncAttributeSelectStyle(subSelect);
            subSelect.addEventListener('change', () => {
                item.sub = subSelect.value;
                syncAttributeSelectStyle(subSelect);
                onQueueAttributeChange(item);
            });
            attrs.append(subSelect);
        }

        fields.append(nameInput, attrs);
        appendInfoUrlField(fields, item);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'spirit-queue-remove';
        removeBtn.textContent = '削除';
        removeBtn.addEventListener('click', () => removeFromSpiritQueue(item.id));

        li.append(thumb, fields, removeBtn);
        spiritQueueList.appendChild(li);
    }

    updateSubmitButtonLabel();
    updateImageRequired();
}

function removeFromSpiritQueue(queueId) {
    const index = spiritQueue.findIndex(item => item.id === queueId);
    if (index === -1) return;

    const item = spiritQueue[index];
    if (item.spiritId) {
        spiritsToDelete.push(item.spiritId);
    }
    if (item.objectUrl && !item.isExternalUrl) {
        URL.revokeObjectURL(item.objectUrl);
    }
    if (imageReplaceTargetId === queueId) {
        imageReplaceTargetId = null;
        adminImageGroup.hidden = true;
        clearImageDropzone();
    }
    spiritQueue.splice(index, 1);
    renderSpiritQueue();
    updateCropHint();
}

function selectImageReplaceTarget(queueId) {
    imageReplaceTargetId = queueId;
    adminImageGroup.hidden = false;
    clearImageDropzone();
    imageHint.textContent = '画像を貼り付けまたは選択して差し替え（スクショは精霊をクリックで切り抜き）';
    renderSpiritQueue();
}

function updateQueueItemImage(queueId, file, attributes = null) {
    const item = spiritQueue.find(entry => entry.id === queueId);
    if (!item) return;

    if (item.objectUrl && !item.isExternalUrl) {
        URL.revokeObjectURL(item.objectUrl);
    }
    item.file = file;
    item.objectUrl = URL.createObjectURL(file);
    item.isExternalUrl = false;
    if (attributes) {
        item.main = toQueueAttribute(attributes.main);
        item.sub = toQueueAttribute(attributes.sub);
        item.hideSub = shouldHideSub(item.main, item.sub);
    }
    renderSpiritQueue();
}

function addToSpiritQueue(file, attributes = null) {
    const objectUrl = URL.createObjectURL(file);
    const main = toQueueAttribute(attributes?.main);
    const sub = toQueueAttribute(attributes?.sub);
    spiritQueue.push({
        id: crypto.randomUUID(),
        file,
        objectUrl,
        isExternalUrl: false,
        name: '',
        main,
        sub,
        hideSub: shouldHideSub(main, sub),
        infoUrl: ''
    });
    renderSpiritQueue();
    updateCropHint();

    const lastNameInput = spiritQueueList.querySelector('.spirit-queue-item:last-child input');
    lastNameInput?.focus();
}

function updateCropHint() {
    if (!pendingCropImage) return;

    if (editingEventId && imageReplaceTargetId) {
        imageHint.textContent = '切り抜きたい精霊をクリックしてください';
        return;
    }

    const count = spiritQueue.length;
    if (count === 0) {
        imageHint.textContent = '切り抜きたい精霊をクリックしてください（複数選択可）';
        return;
    }
    imageHint.textContent = `${count}体選択済み。続けてクリックするか「${count}体を追加する」で登録`;
}

function updateImageRequired() {
    if (editingEventId) {
        imageInput.required = false;
        spiritNameInput.required = false;
        return;
    }

    const showDetails = eventModeExisting.checked || eventModeNew.checked;
    const hasQueue = spiritQueue.length > 0;
    imageInput.required = showDetails && !hasQueue;
    spiritNameInput.required = false;
}

function extensionFromMime(mime) {
    return IMAGE_MIME_EXTENSIONS[mime] ?? 'png';
}

function syncSpiritCropClickListener() {
    imagePreviewStage.removeEventListener('click', handleCropClick);
    if (pendingCropImage && !ocrSelectTarget) {
        imagePreviewStage.addEventListener('click', handleCropClick);
    }
}

function suppressSpiritCropClickBriefly() {
    blockSpiritCropClick = true;
    window.setTimeout(() => {
        blockSpiritCropClick = false;
    }, 400);
}

function clearPendingCrop() {
    clearOcrSelectMode({ restoreCropClick: false });
    pendingCropImage = null;
    if (pendingCropObjectUrl) {
        URL.revokeObjectURL(pendingCropObjectUrl);
        pendingCropObjectUrl = null;
    }
    imageDropzone.classList.remove('crop-mode');
    syncSpiritCropClickListener();
}

function getImageFitMetrics() {
    const rect = imagePreview.getBoundingClientRect();
    const naturalWidth = pendingCropImage?.naturalWidth ?? imagePreview.naturalWidth;
    const naturalHeight = pendingCropImage?.naturalHeight ?? imagePreview.naturalHeight;
    if (!naturalWidth || !naturalHeight || !rect.width || !rect.height) {
        return null;
    }

    const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
    const displayWidth = naturalWidth * scale;
    const displayHeight = naturalHeight * scale;
    const offsetLeft = (rect.width - displayWidth) / 2;
    const offsetTop = (rect.height - displayHeight) / 2;

    return {
        scale,
        offsetLeft,
        offsetTop,
        displayWidth,
        displayHeight,
        rect
    };
}

function clearOcrRegionOverlays() {
    ocrRegionOverlays.innerHTML = '';
    ocrRegionOverlays.hidden = true;
}

function scheduleOcrRegionOverlayRefresh() {
    clearOcrRegionOverlays();
}

function clientToDisplayPoint(clientX, clientY) {
    const metrics = getImageFitMetrics();
    if (!metrics) return null;

    const displayX = clientX - metrics.rect.left - metrics.offsetLeft;
    const displayY = clientY - metrics.rect.top - metrics.offsetTop;

    if (
        displayX < 0
        || displayY < 0
        || displayX > metrics.displayWidth
        || displayY > metrics.displayHeight
    ) {
        return null;
    }

    return { x: displayX, y: displayY };
}

function displayRectToImageRect(displayRect) {
    const metrics = getImageFitMetrics();
    if (!metrics) return null;

    return {
        x: Math.floor(displayRect.x / metrics.scale),
        y: Math.floor(displayRect.y / metrics.scale),
        w: Math.max(1, Math.floor(displayRect.w / metrics.scale)),
        h: Math.max(1, Math.floor(displayRect.h / metrics.scale))
    };
}

function getOcrSourceImage() {
    if (pendingCropImage) return pendingCropImage;
    if (imagePreview.complete && imagePreview.naturalWidth > 0) return imagePreview;
    return null;
}

function getNormalizedDisplayRect(startX, startY, currentX, currentY) {
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);
    return { x, y, w, h };
}

function updateOcrSelectionBox() {
    if (!ocrDragState) {
        ocrSelection.hidden = true;
        return;
    }

    const metrics = getImageFitMetrics();
    if (!metrics) {
        ocrSelection.hidden = true;
        return;
    }

    const rect = getNormalizedDisplayRect(
        ocrDragState.startX,
        ocrDragState.startY,
        ocrDragState.currentX,
        ocrDragState.currentY
    );

    ocrSelection.style.left = `${metrics.offsetLeft + rect.x}px`;
    ocrSelection.style.top = `${metrics.offsetTop + rect.y}px`;
    ocrSelection.style.width = `${rect.w}px`;
    ocrSelection.style.height = `${rect.h}px`;
    ocrSelection.hidden = rect.w < 2 || rect.h < 2;
}

function updateOcrSelectButtons() {
    document.querySelectorAll('.btn-ocr-select').forEach(button => {
        const isActive = button === ocrSelectButton;
        button.classList.toggle('is-active', isActive);
        button.disabled = !getOcrSourceImage();
    });
}

function getOcrSelectHint(target) {
    if (target === 'abbr') {
        return 'イベント略称の文字を画像上でドラッグして囲んでください';
    }
    return 'イベント正式名の文字を画像上でドラッグして囲んでください';
}

function clearOcrSelectMode({ restoreCropClick = true } = {}) {
    ocrSelectTarget = null;
    ocrSelectButton = null;
    ocrDragState = null;
    ocrSelectHint = '';
    imageDropzone.classList.remove('ocr-select-mode');
    ocrSelection.hidden = true;
    updateOcrSelectButtons();
    if (restoreCropClick) {
        window.setTimeout(() => syncSpiritCropClickListener(), 0);
    }
}

function restoreImageHintAfterOcr() {
    if (pendingCropImage) {
        updateCropHint();
        return;
    }
    imageHint.textContent = DEFAULT_IMAGE_HINT;
}

function ensureNewEventModeForScreenshot() {
    if (editingEventId || eventModeExisting.checked) return false;

    if (!eventModeNew.checked) {
        eventModeNew.checked = true;
        setEventMode('new');
    }

    return eventModeNew.checked;
}

function applyRecognizedEventNames(abbr, title) {
    const normalized = normalizeEventNames(abbr, title);
    if (!normalized.abbr) return false;

    eventAbbrInput.value = normalized.abbr;
    eventAbbrInput.dispatchEvent(new Event('input', { bubbles: true }));
    eventTitleInput.value = normalized.title;
    eventTitleInput.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

async function fillEventNamesFromImage(image) {
    if (editingEventId || eventModeExisting.checked) return false;
    ensureNewEventModeForScreenshot();
    scheduleOcrRegionOverlayRefresh(image);

    let abbr = '';
    let title = '';
    let layout = null;

    try {
        layout = await prepareEventOcrLayout(image);
        ({ abbr, title } = await extractEventNamesFromImage(image, layout));
    } catch (error) {
        console.warn('Event name OCR failed:', error);
    }

    if (!abbr) {
        try {
            layout = layout ?? await prepareEventOcrLayout(image);
            const regions = await getEventNameOcrRegionsAsync(image, layout);
            if (regions.abbr) {
                abbr = await recognizeTextFromImageRectLenient(image, regions.abbr, { preserveSpaces: false });
            }
        } catch (error) {
            console.warn('Abbr OCR fallback failed:', error);
        }
    }

    if (!title) {
        try {
            title = await recognizeHeaderTitleBand(image);
        } catch (error) {
            console.warn('Title band OCR failed:', error);
        }
    }

    if (!title) {
        try {
            layout = layout ?? await prepareEventOcrLayout(image);
            const regions = await getEventNameOcrRegionsAsync(image, layout);
            if (regions.title) {
                title = await recognizeTextFromImageRectLenient(image, regions.title, { preserveSpaces: true });
            }
        } catch (error) {
            console.warn('Title OCR fallback failed:', error);
        }
    }

    const filled = applyRecognizedEventNames(abbr, title);
    scheduleOcrRegionOverlayRefresh(image);
    return filled;
}

function runAutoOcrForTarget(target, button) {
    if (!ensureNewEventModeForScreenshot()) return;

    if (!getOcrSourceImage()) {
        alert('先に画像を貼り付けるか選択してください。');
        return;
    }

    startOcrSelectMode(target, button);
}

function startOcrSelectMode(target, button) {
    if (!eventModeNew.checked || editingEventId) return;

    const sourceImage = getOcrSourceImage();
    if (!sourceImage) {
        alert('先に画像を貼り付けるか選択してください。');
        return;
    }

    if (ocrSelectTarget === target) {
        clearOcrSelectMode();
        restoreImageHintAfterOcr();
        return;
    }

    clearOcrSelectMode();
    ocrSelectTarget = target;
    ocrSelectButton = button;
    ocrSelectHint = getOcrSelectHint(target);
    imageDropzone.classList.add('ocr-select-mode');
    imageHint.textContent = ocrSelectHint;
    updateOcrSelectButtons();
    syncSpiritCropClickListener();
}

async function completeOcrSelection(displayRect) {
    const sourceImage = getOcrSourceImage();
    const imageRect = displayRectToImageRect(displayRect);
    const target = ocrSelectTarget;

    if (!sourceImage || !imageRect || !target) return;

    clearOcrSelectMode();
    imageHint.textContent = '文字を読み取り中...';

    try {
        const text = await recognizeTextFromImageRectLenient(
            sourceImage,
            imageRect,
            { preserveSpaces: target !== 'abbr' }
        );
        if (text) {
            if (target === 'abbr') {
                eventAbbrInput.value = text;
            } else {
                eventTitleInput.value = text;
            }
        } else {
            throw new Error('文字を読み取れませんでした。領域を大きくして再試行してください。');
        }
    } catch (error) {
        console.warn('Manual OCR failed:', error);
        alert(error.message || '文字認識に失敗しました。');
    } finally {
        restoreImageHintAfterOcr();
    }
}

function handleOcrPointerDown(event) {
    if (!ocrSelectTarget || event.button !== 0) return;

    const point = clientToDisplayPoint(event.clientX, event.clientY);
    if (!point) return;

    event.preventDefault();
    event.stopPropagation();
    ocrDragState = {
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y
    };
    updateOcrSelectionBox();
    imagePreviewStage.setPointerCapture(event.pointerId);
}

function handleOcrPointerMove(event) {
    if (!ocrDragState) return;

    const point = clientToDisplayPoint(event.clientX, event.clientY);
    if (!point) return;

    event.preventDefault();
    ocrDragState.currentX = point.x;
    ocrDragState.currentY = point.y;
    updateOcrSelectionBox();
}

function handleOcrPointerUp(event) {
    if (!ocrDragState) return;

    event.preventDefault();
    event.stopPropagation();
    suppressSpiritCropClickBriefly();
    if (imagePreviewStage.hasPointerCapture(event.pointerId)) {
        imagePreviewStage.releasePointerCapture(event.pointerId);
    }

    const displayRect = getNormalizedDisplayRect(
        ocrDragState.startX,
        ocrDragState.startY,
        ocrDragState.currentX,
        ocrDragState.currentY
    );
    ocrDragState = null;
    updateOcrSelectionBox();

    if (displayRect.w < 8 || displayRect.h < 8) {
        imageHint.textContent = ocrSelectHint || getOcrSelectHint(ocrSelectTarget ?? 'title');
        return;
    }

    completeOcrSelection(displayRect).catch(error => {
        console.error(error);
        alert(error.message || '文字認識に失敗しました。');
        restoreImageHintAfterOcr();
    });
}

function clientToImagePoint(clientX, clientY) {
    const metrics = getImageFitMetrics();
    if (!metrics) return null;

    const displayX = clientX - metrics.rect.left - metrics.offsetLeft;
    const displayY = clientY - metrics.rect.top - metrics.offsetTop;

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

function clearImageDropzone() {
    clearPendingCrop();
    clearOcrRegionOverlays();
    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
    imageInput.value = '';
    imagePreview.removeAttribute('src');
    imagePreviewStage.hidden = true;
    imageDropzone.classList.remove('has-image');
}

function clearImagePreview() {
    clearImageDropzone();
    if (!editingEventId) {
        clearSpiritQueue();
    }
}

function showImagePreview(file) {
    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
    previewObjectUrl = URL.createObjectURL(file);
    imagePreview.src = previewObjectUrl;
    imagePreviewStage.hidden = false;
    imageDropzone.classList.add('has-image');
    imageDropzone.classList.remove('crop-mode');
    updateOcrSelectButtons();
    scheduleOcrRegionOverlayRefresh();
}

function assignSpiritImageFile(file) {
    clearPendingCrop();
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    imageInput.files = dataTransfer.files;
    showImagePreview(file);
    imageHint.textContent = `画像を設定しました（${file.name}）`;
}

function enterCropMode(image, objectUrl) {
    if (!editingEventId) {
        clearSpiritQueue();
    }
    clearPendingCrop();
    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
    imageInput.value = '';

    pendingCropImage = image;
    pendingCropObjectUrl = objectUrl;
    imagePreview.src = objectUrl;
    imagePreviewStage.hidden = false;
    imageDropzone.classList.add('has-image', 'crop-mode');
    updateCropHint();
    updateOcrSelectButtons();
    syncSpiritCropClickListener();
    scheduleOcrRegionOverlayRefresh();
}

async function handleCropClick(event) {
    if (!pendingCropImage || ocrSelectTarget || blockSpiritCropClick) return;
    event.preventDefault();
    event.stopPropagation();

    const point = clientToImagePoint(event.clientX, event.clientY);
    if (!point) return;

    const { imageData, width, height } = readImageDataFromElement(pendingCropImage);
    const cropRect = detectSpiritCropRectAtClick(imageData, width, height, point.imageX, point.imageY);
    if (!cropRect) {
        alert('精霊アイコンを検出できませんでした。アイコンの中央付近をクリックしてください。');
        return;
    }

    try {
        const attributes = detectSpiritAttributes(imageData, width, height, cropRect);
        const blob = await cropAndNormalizeSpiritImage(pendingCropImage, cropRect);
        const file = blobToSpiritFile(blob, `spirit-crop-${spiritQueue.length + 1}`);

        if (editingEventId && imageReplaceTargetId) {
            updateQueueItemImage(imageReplaceTargetId, file, attributes);
            clearImageDropzone();
            imageHint.textContent = '画像を差し替えました。続けて他の精霊も選択できます';
            return;
        }

        addToSpiritQueue(file, attributes);
    } catch (error) {
        console.error(error);
        alert(error.message || '切り抜きに失敗しました。');
    }
}

async function tryExtractEventNamesFromScreenshot(image) {
    if (!isEventNameAutoOcrEnabled() || !canAutoReadEventNames()) return;

    const previousHint = imageHint.textContent;
    imageHint.textContent = 'イベント名を読み取り中...（初回のみ数十秒かかることがあります）';

    try {
        const filled = await fillEventNamesFromImage(image);

        if (filled) {
            imageHint.textContent = '認識できた文字列を入力欄に反映しました。精霊をクリックして切り抜いてください';
            scheduleOcrRegionOverlayRefresh();
            return;
        }

        imageHint.textContent = 'イベント名を自動取得できませんでした。「自動認識」ボタンまたは手入力で入力してください';
        window.setTimeout(() => {
            if (imageHint.textContent.includes('自動取得できません')) {
                imageHint.textContent = previousHint;
            }
        }, 5000);
    } catch (error) {
        console.warn('Event name OCR failed:', error);
        imageHint.textContent = 'イベント名を自動取得できませんでした。「自動認識」ボタンまたは手入力で入力してください';
        window.setTimeout(() => {
            if (imageHint.textContent.includes('自動取得できません')) {
                imageHint.textContent = previousHint;
            }
        }, 5000);
    }
}

async function processIncomingImage(file) {
    if (editingEventId && !imageReplaceTargetId) {
        alert('画像を差し替える精霊を左のサムネイルから選んでください。');
        return;
    }

    if (!editingEventId && !eventModeExisting.checked) {
        ensureNewEventModeForScreenshot();
        clearOcrRegionOverlays();
        eventAbbrInput.value = '';
        eventTitleInput.value = '';
    }

    const normalizedFile = normalizePastedImageFile(file);
    const { image, objectUrl } = await loadImageFromFile(normalizedFile);

    if (!editingEventId && !eventModeExisting.checked) {
        scheduleOcrRegionOverlayRefresh(image);
    }

    if (isEventNameAutoOcrEnabled()) {
        await tryExtractEventNamesFromScreenshot(image);
    }

    if (editingEventId && imageReplaceTargetId) {
        try {
            if (imageNeedsCropMode(image)) {
                enterCropMode(image, objectUrl);
                return;
            }

            const { imageData, width, height } = readImageDataFromElement(image);
            const cropRect = squareCropRectForImage(width, height);
            const attributes = detectSpiritAttributes(imageData, width, height, cropRect);
            const blob = await normalizeImageElement(image);
            updateQueueItemImage(
                imageReplaceTargetId,
                blobToSpiritFile(blob, 'spirit'),
                attributes
            );
            clearImageDropzone();
            imageHint.textContent = '画像を差し替えました。続けて他の精霊も選択できます';
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
        return;
    }

    if (imageNeedsCropMode(image)) {
        enterCropMode(image, objectUrl);
        return;
    }

    try {
        const { imageData, width, height } = readImageDataFromElement(image);
        const cropRect = squareCropRectForImage(width, height);
        const attributes = detectSpiritAttributes(imageData, width, height, cropRect);
        const blob = await normalizeImageElement(image);
        addToSpiritQueue(blobToSpiritFile(blob, 'spirit'), attributes);
        imageHint.textContent = '下の欄に精霊名を入力してください';
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function normalizePastedImageFile(file) {
    if (file.name && file.name.includes('.')) return file;
    const extension = extensionFromMime(file.type);
    return new File([file], `screenshot.${extension}`, { type: file.type || 'image/png' });
}

function handleImagePaste(event) {
    if (!dialog.open) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (!item.type.startsWith('image/')) continue;

        const file = item.getAsFile();
        if (!file) continue;

        event.preventDefault();
        processIncomingImage(file).catch(error => {
            console.error(error);
            alert(error.message || '画像の読み込みに失敗しました。');
        });
        return;
    }
}

function handleEventNameAutoOcrToggle() {
    if (!isEventNameAutoOcrEnabled() || !canAutoReadEventNames()) return;

    const sourceImage = getOcrSourceImage();
    if (!sourceImage) return;

    tryExtractEventNamesFromScreenshot(sourceImage).catch(error => {
        console.warn('Event name OCR on toggle failed:', error);
    });
}

function handleImageInputChange() {
    const file = imageInput.files?.[0];
    if (!file) {
        clearImagePreview();
        return;
    }

    processIncomingImage(file).catch(error => {
        console.error(error);
        alert(error.message || '画像の読み込みに失敗しました。');
        clearImagePreview();
    });
}

function isAdminUnlocked() {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
}

function unlockAdmin() {
    sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
    document.body.classList.add('admin-mode');
}

export function ensureAdminAccess() {
    if (isAdminUnlocked()) return true;

    const input = prompt('管理用 PIN を入力してください');
    if (input === ADMIN_PIN) {
        unlockAdmin();
        return true;
    }

    if (input !== null) {
        alert('PIN が正しくありません。');
    }
    return false;
}

function fillSelectOptions(select, values) {
    select.innerHTML = '';
    for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    }
}

function populateExistingEventSelect() {
    existingEventSelect.innerHTML = '';
    for (const section of catalogRows.sections) {
        const sectionEvents = catalogRows.events.filter(event => event.section_id === section.id);
        if (sectionEvents.length === 0) continue;

        if (SECTIONS_WITHOUT_DISPLAY_TITLE.has(section.id)) {
            for (const event of sectionEvents) {
                const option = document.createElement('option');
                option.value = event.id;
                option.textContent = `${event.abbr} / ${event.title}`;
                existingEventSelect.appendChild(option);
            }
            continue;
        }

        const group = document.createElement('optgroup');
        group.label = section.title;
        for (const event of sectionEvents) {
            const option = document.createElement('option');
            option.value = event.id;
            option.textContent = `${event.abbr} / ${event.title}`;
            group.appendChild(option);
        }
        existingEventSelect.appendChild(group);
    }
}

const DEFAULT_SECTION_ID = 'latest';

function setEventMode(mode) {
    const isExisting = mode === 'existing';
    const isNew = mode === 'new';
    const showDetails = isExisting || isNew;

    existingEventBlock.hidden = !isExisting;
    newEventBlock.hidden = !isNew;
    spiritDetailsBlock.hidden = !showDetails;

    existingEventSelect.required = isExisting;
    eventAbbrInput.required = isNew;
    eventTitleInput.required = isNew;
    if (!isNew) {
        clearOcrSelectMode();
        clearOcrRegionOverlays();
        restoreImageHintAfterOcr();
    }
    updateImageRequired();
    updateOcrSelectButtons();
}

function hideEditTitleUi() {
    editTitleBtn.hidden = true;
    editEventTitleBlock.hidden = true;
}

function fillEditTitleInputs() {
    if (!editingEventId) return;
    const event = catalogRows.events.find(item => item.id === editingEventId);
    if (!event) return;
    editEventAbbrInput.value = event.abbr;
    editEventTitleInput.value = event.title;
    editEventYearInput.value = event.held_year ? String(event.held_year) : '';
    editEventMonthInput.value = event.held_month ? String(event.held_month) : '';
}

function toggleEditTitlePanel() {
    const willShow = editEventTitleBlock.hidden;
    if (willShow) {
        fillEditTitleInputs();
    }
    editEventTitleBlock.hidden = !willShow;
}

async function saveEventTitleEdit() {
    if (!editingEventId) return;

    const { abbr, title } = normalizeEventNames(
        editEventAbbrInput.value.trim(),
        editEventTitleInput.value.trim()
    );

    const yearValue = editEventYearInput.value.trim();
    const monthValue = editEventMonthInput.value.trim();
    const heldYear = yearValue ? Number(yearValue) : null;
    const heldMonth = monthValue ? Number(monthValue) : null;

    if ((heldYear === null) !== (heldMonth === null)) {
        throw new Error('開催月は「年」と「月」を両方入力してください。');
    }
    if (heldYear !== null && (!Number.isInteger(heldYear) || heldYear < 2010 || heldYear > 2100)) {
        throw new Error('開催月の「年」が不正です。');
    }
    if (heldMonth !== null && (!Number.isInteger(heldMonth) || heldMonth < 1 || heldMonth > 12)) {
        throw new Error('開催月の「月」が不正です。');
    }

    if (!abbr) {
        throw new Error('イベント略称を入力してください。');
    }

    editTitleSaveBtn.disabled = true;

    try {
        const { error } = await database
            .from('catalog_events')
            .update({
                abbr,
                title,
                held_year: heldYear,
                held_month: heldMonth
            })
            .eq('id', editingEventId);

        if (error) throw error;

        const event = catalogRows.events.find(item => item.id === editingEventId);
        if (event) {
            event.abbr = abbr;
            event.title = title;
            event.held_year = heldYear;
            event.held_month = heldMonth;
        }

        dialogTitle.textContent = `${abbr} の精霊を編集`;
        editEventTitleBlock.hidden = true;

        if (reloadCatalog) {
            await reloadCatalog(editingEventId);
        }
    } finally {
        editTitleSaveBtn.disabled = false;
    }
}

async function handleEditTitleSave() {
    try {
        await saveEventTitleEdit();
    } catch (error) {
        console.error(error);
        alert(error.message || 'タイトルの保存に失敗しました。');
    }
}

function resetForm() {
    editingEventId = null;
    imageReplaceTargetId = null;
    spiritsToDelete = [];
    dialogTitle.textContent = '精霊を追加';
    submitButton.textContent = '追加する';
    form.reset();
    clearImagePreview();
    adminImageGroup.hidden = false;
    eventModeExisting.checked = false;
    eventModeNew.checked = false;
    setEventMode(null);
    eventNameAutoOcrToggle.checked = false;
    imageHint.textContent = DEFAULT_IMAGE_HINT;
    populateExistingEventSelect();
    fillSelectOptions(spiritMainSelect, ELEMENTS);
    fillSelectOptions(spiritSubSelect, ELEMENTS);
    editNameBlock.hidden = true;
    editAttrsBlock.hidden = true;
    document.getElementById('event-mode-fieldset').hidden = false;
    clearOcrSelectMode();
    updateOcrSelectButtons();
    hideEditTitleUi();
}

async function refreshCatalogRows() {
    catalogRows = await fetchCatalogRows(database);
}

async function resolveEventId() {
    if (editingEventId) {
        return editingEventId;
    }

    if (eventModeExisting.checked) {
        const eventId = existingEventSelect.value;
        if (!eventId) throw new Error('イベントを選択してください。');
        return eventId;
    }

    const { abbr, title } = normalizeEventNames(
        eventAbbrInput.value.trim(),
        eventTitleInput.value.trim()
    );

    if (!abbr) {
        throw new Error('新規イベントの略称・正式名を入力してください。');
    }

    const sectionId = DEFAULT_SECTION_ID;
    const eventId = createEventId(abbr);
    const storageFolder = abbrToStorageFolder(abbr, eventId);
    const sortOrder = catalogRows.events.filter(event => event.section_id === sectionId).length + 1;
    const { error } = await database.from('catalog_events').insert({
        id: eventId,
        section_id: sectionId,
        abbr,
        title,
        storage_folder: storageFolder,
        sort_order: sortOrder
    });

    if (error) throw error;
    return eventId;
}

async function resolveUploadStorageFolder(eventId) {
    const event = catalogRows.events.find(item => item.id === eventId);
    if (event) return resolveStorageFolder(event);
    return abbrToStorageFolder(eventAbbrInput.value.trim(), eventId);
}

async function submitSpiritQueue() {
    if (spiritQueue.length === 0) {
        throw new Error('精霊画像を追加してください。');
    }

    const unnamed = spiritQueue.find(item => !item.name.trim());
    if (unnamed) {
        throw new Error('すべての精霊に名前を入力してください。');
    }

    const unsetAttrs = spiritQueue.find(item => {
        if (item.main === UNDETECTED_ELEMENT) return true;
        if (item.hideSub) return false;
        return item.sub === UNDETECTED_ELEMENT;
    });
    if (unsetAttrs) {
        throw new Error('属性が未検出の精霊があります。属性を選択してください。');
    }

    validateSpiritQueueInfoUrls();

    const eventId = await resolveEventId();
    const storageFolder = await resolveUploadStorageFolder(eventId);
    const baseSort = catalogRows.spirits.filter(spirit => spirit.event_id === eventId).length;
    const count = spiritQueue.length;

    for (let i = 0; i < count; i++) {
        const item = spiritQueue[i];
        const spiritName = item.name.trim();
        const idSuffix = count > 1 ? `-${i + 1}` : '';
        const spiritId = `${createSpiritId(eventId, spiritName)}${idSuffix}`;
        const imagePath = await uploadSpiritImage(database, item.file, storageFolder);

        const { error } = await database.from('catalog_spirits').insert({
            id: spiritId,
            event_id: eventId,
            name: spiritName,
            main: item.main,
            sub: item.hideSub ? item.main : item.sub,
            image_path: imagePath,
            info_url: normalizeInfoUrl(item.infoUrl ?? ''),
            sort_order: baseSort + i + 1
        });

        if (error) throw error;
    }

    dialog.close();
    await reloadCatalog();
    alert(`${count}体の精霊を追加しました。`);
}

async function submitEventEdit() {
    if (spiritQueue.length === 0 && spiritsToDelete.length === 0) {
        throw new Error('編集する精霊がありません。');
    }

    const unnamed = spiritQueue.find(item => !item.name.trim());
    if (unnamed) {
        throw new Error('すべての精霊に名前を入力してください。');
    }

    const unsetAttrs = spiritQueue.find(item => {
        if (item.main === UNDETECTED_ELEMENT) return true;
        if (item.hideSub) return false;
        return item.sub === UNDETECTED_ELEMENT;
    });
    if (unsetAttrs) {
        throw new Error('属性が未検出の精霊があります。属性を選択してください。');
    }

    validateSpiritQueueInfoUrls();

    for (const spiritId of spiritsToDelete) {
        const { error } = await database.from('catalog_spirits').delete().eq('id', spiritId);
        if (error) throw error;
    }

    const storageFolder = await resolveUploadStorageFolder(editingEventId);

    for (let i = 0; i < spiritQueue.length; i++) {
        const item = spiritQueue[i];
        let imagePath = item.imagePath ?? null;

        if (item.file) {
            imagePath = await uploadSpiritImage(database, item.file, storageFolder);
        }

        const { error } = await database.from('catalog_spirits').update({
            name: item.name.trim(),
            main: item.main,
            sub: item.hideSub ? item.main : item.sub,
            image_path: imagePath,
            info_url: normalizeInfoUrl(item.infoUrl ?? ''),
            sort_order: i + 1
        }).eq('id', item.spiritId);

        if (error) throw error;
    }

    dialog.close();
    await reloadCatalog(editingEventId);
    alert('イベント内の精霊を更新しました。');
}

async function handleSubmit(event) {
    event.preventDefault();

    if (editingEventId) {
        submitButton.disabled = true;
        try {
            await submitEventEdit();
        } catch (error) {
            console.error(error);
            alert(error.message || '保存に失敗しました。');
        } finally {
            submitButton.disabled = false;
        }
        return;
    }

    if (!eventModeExisting.checked && !eventModeNew.checked) {
        alert('イベントを既存か新規か選んでください。');
        return;
    }

    submitButton.disabled = true;

    try {
        if (pendingCropImage && spiritQueue.length === 0) {
            throw new Error('切り抜きたい精霊をクリックしてください。');
        }
        await submitSpiritQueue();
    } catch (error) {
        console.error(error);
        alert(error.message || '保存に失敗しました。');
    } finally {
        submitButton.disabled = false;
    }
}

function formatSupabaseError(error) {
    if (!error) return '不明なエラー';
    return [error.message, error.details, error.hint, error.code]
        .filter(Boolean)
        .join('\n');
}

export async function openAddDialog() {
    if (!ensureAdminAccess()) return;

    try {
        await refreshCatalogRows();
        resetForm();
        dialog.showModal();
    } catch (error) {
        console.error(error);
        alert(
            '管理画面の準備に失敗しました。\n\n'
            + `原因:\n${formatSupabaseError(error)}\n\n`
            + '対処:\n'
            + '1. Supabase → SQL Editor で supabase/catalog_fix.sql を開く\n'
            + '2. 右下の Run（緑ボタン）を押す\n'
            + '3. Results に catalog_sections=3 などと出るか確認\n'
            + '4. サイトを再読み込みして Add を再試行'
        );
    }
}

export async function openEventEditDialog(eventId) {
    if (!ensureAdminAccess()) return;

    try {
        await refreshCatalogRows();
        const event = catalogRows.events.find(item => item.id === eventId);
        if (!event) {
            alert('イベントが見つかりません。');
            return;
        }

        const eventSpirits = catalogRows.spirits
            .filter(spirit => spirit.event_id === eventId)
            .sort((a, b) => a.sort_order - b.sort_order);

        if (eventSpirits.length === 0) {
            alert('このイベントに精霊がありません。');
            return;
        }

        resetForm();
        editingEventId = eventId;
        dialogTitle.textContent = `${event.abbr} の精霊を編集`;
        editTitleBtn.hidden = false;
        submitButton.textContent = '更新する';

        document.getElementById('event-mode-fieldset').hidden = true;
        existingEventBlock.hidden = true;
        newEventBlock.hidden = true;
        spiritDetailsBlock.hidden = false;
        editNameBlock.hidden = true;
        editAttrsBlock.hidden = true;
        adminImageGroup.hidden = true;

        for (const spirit of eventSpirits) {
            const imageUrl = getSpiritImageUrl(database, { image_path: spirit.image_path }) ?? '';
            spiritQueue.push({
                id: crypto.randomUUID(),
                spiritId: spirit.id,
                file: null,
                objectUrl: imageUrl,
                isExternalUrl: true,
                name: spirit.name,
                main: spirit.main,
                sub: spirit.sub,
                hideSub: shouldHideSub(spirit.main, spirit.sub),
                imagePath: spirit.image_path,
                sortOrder: spirit.sort_order,
                infoUrl: spirit.info_url ?? ''
            });
        }

        renderSpiritQueue();
        dialog.showModal();
    } catch (error) {
        console.error(error);
        alert(`編集画面を開けませんでした。\n\n${formatSupabaseError(error)}`);
    }
}

export function initAdmin(db, onReloadCatalog) {
    database = db;
    reloadCatalog = onReloadCatalog;

    document.getElementById('add-btn').addEventListener('click', openAddDialog);
    document.getElementById('admin-cancel-btn').addEventListener('click', () => dialog.close());
    editTitleBtn.addEventListener('click', toggleEditTitlePanel);
    editTitleSaveBtn.addEventListener('click', handleEditTitleSave);
    editTitleCancelBtn.addEventListener('click', () => {
        editEventTitleBlock.hidden = true;
    });
    form.addEventListener('submit', handleSubmit);
    dialog.addEventListener('paste', handleImagePaste);
    imageInput.addEventListener('change', handleImageInputChange);

    document.querySelectorAll('input[name="event-mode"]').forEach(radio => {
        radio.addEventListener('change', () => setEventMode(radio.value));
    });

    document.querySelectorAll('.btn-ocr-select').forEach(button => {
        button.addEventListener('click', () => {
            runAutoOcrForTarget(button.dataset.ocrTarget, button);
        });
    });

    eventNameAutoOcrToggle.addEventListener('change', handleEventNameAutoOcrToggle);

    imagePreviewStage.addEventListener('pointerdown', handleOcrPointerDown);
    imagePreviewStage.addEventListener('pointermove', handleOcrPointerMove);
    imagePreviewStage.addEventListener('pointerup', handleOcrPointerUp);
    imagePreviewStage.addEventListener('pointercancel', handleOcrPointerUp);
    imagePreview.addEventListener('load', scheduleOcrRegionOverlayRefresh);
    window.addEventListener('resize', scheduleOcrRegionOverlayRefresh);

    ensureEventOcrOpenCv().catch(() => {});

    dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape' && ocrSelectTarget) {
            event.preventDefault();
            clearOcrSelectMode();
            restoreImageHintAfterOcr();
        }
    });

    if (isAdminUnlocked()) {
        document.body.classList.add('admin-mode');
    }
}
