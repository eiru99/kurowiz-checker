import { ADMIN_PIN } from './config.js';
import {
    createEventId,
    createSpiritId,
    fetchCatalogRows,
    SECTIONS_WITHOUT_DISPLAY_TITLE,
    uploadSpiritImage
} from './catalog.js';
import {
    blobToSpiritFile,
    cropAndNormalizeSpiritImage,
    detectSpiritCropRectInRegion,
    imageNeedsCropMode,
    loadImageFromFile,
    normalizeImageElement,
    readImageDataFromElement
} from './spirit-image.js';

const ELEMENTS = ['火', '水', '雷', '光', '闇'];
const ADMIN_SESSION_KEY = 'wiz_admin_unlocked';

let database = null;
let reloadCatalog = null;
let catalogRows = { sections: [], events: [], spirits: [] };
let editingSpiritId = null;

const dialog = document.getElementById('admin-dialog');
const form = document.getElementById('admin-form');
const dialogTitle = document.getElementById('admin-dialog-title');
const eventModeExisting = document.getElementById('event-mode-existing');
const eventModeNew = document.getElementById('event-mode-new');
const existingEventBlock = document.getElementById('existing-event-block');
const newEventBlock = document.getElementById('new-event-block');
const spiritDetailsBlock = document.getElementById('spirit-details-block');
const existingEventSelect = document.getElementById('admin-existing-event');
const eventAbbrInput = document.getElementById('admin-event-abbr');
const eventTitleInput = document.getElementById('admin-event-title');
const spiritNameInput = document.getElementById('admin-spirit-name');
const spiritMainSelect = document.getElementById('admin-spirit-main');
const spiritSubSelect = document.getElementById('admin-spirit-sub');
const imageDropzone = document.getElementById('admin-image-dropzone');
const imageInput = document.getElementById('admin-spirit-image');
const imagePreviewStage = document.getElementById('admin-image-preview-stage');
const imagePreview = document.getElementById('admin-image-preview');
const cropSelection = document.getElementById('admin-crop-selection');
const imageHint = document.getElementById('admin-image-hint');
const submitButton = document.getElementById('admin-submit-btn');

let previewObjectUrl = null;
let pendingCropImage = null;
let pendingCropObjectUrl = null;
let cropDragStart = null;
let cropDragActive = false;

const MIN_SELECTION_IMAGE_PX = 24;

const IMAGE_MIME_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

function extensionFromMime(mime) {
    return IMAGE_MIME_EXTENSIONS[mime] ?? 'png';
}

function clearPendingCrop() {
    pendingCropImage = null;
    cropDragStart = null;
    cropDragActive = false;
    if (pendingCropObjectUrl) {
        URL.revokeObjectURL(pendingCropObjectUrl);
        pendingCropObjectUrl = null;
    }
    imageDropzone.classList.remove('crop-mode');
    imagePreviewStage.removeEventListener('pointerdown', handleCropPointerDown);
    document.removeEventListener('pointermove', handleCropPointerMove);
    document.removeEventListener('pointerup', handleCropPointerUp);
    cropSelection.hidden = true;
    cropSelection.style.width = '';
    cropSelection.style.height = '';
    cropSelection.style.left = '';
    cropSelection.style.top = '';
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

function clientToImagePoint(clientX, clientY) {
    const metrics = getImageFitMetrics();
    if (!metrics) return null;

    const stageRect = imagePreviewStage.getBoundingClientRect();
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
        displayX,
        displayY,
        imageX: displayX / metrics.scale,
        imageY: displayY / metrics.scale
    };
}

function updateCropSelectionBox(start, end) {
    const metrics = getImageFitMetrics();
    if (!metrics || !start || !end) return;

    const left = metrics.offsetLeft + Math.min(start.displayX, end.displayX);
    const top = metrics.offsetTop + Math.min(start.displayY, end.displayY);
    const width = Math.abs(end.displayX - start.displayX);
    const height = Math.abs(end.displayY - start.displayY);

    cropSelection.hidden = false;
    cropSelection.style.left = `${left}px`;
    cropSelection.style.top = `${top}px`;
    cropSelection.style.width = `${width}px`;
    cropSelection.style.height = `${height}px`;
}

function clearImagePreview() {
    clearPendingCrop();
    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
    imageInput.value = '';
    imagePreview.removeAttribute('src');
    imagePreviewStage.hidden = true;
    imageDropzone.classList.remove('has-image');
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
    cropSelection.hidden = true;
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
    imageHint.textContent = '精霊の周りをドラッグして囲んでください（枠の外側の白い余白も少し含める）';
    cropSelection.hidden = true;
    imagePreviewStage.addEventListener('pointerdown', handleCropPointerDown);
}

function handleCropPointerDown(event) {
    if (!pendingCropImage || event.button !== 0) return;
    event.preventDefault();

    const point = clientToImagePoint(event.clientX, event.clientY);
    if (!point) return;

    cropDragActive = true;
    cropDragStart = point;
    imagePreviewStage.setPointerCapture(event.pointerId);
    updateCropSelectionBox(point, point);
    document.addEventListener('pointermove', handleCropPointerMove);
    document.addEventListener('pointerup', handleCropPointerUp);
}

function handleCropPointerMove(event) {
    if (!cropDragActive || !cropDragStart) return;

    const metrics = getImageFitMetrics();
    if (!metrics) return;

    const stageRect = imagePreviewStage.getBoundingClientRect();
    const rawDisplayX = event.clientX - stageRect.left - metrics.offsetLeft;
    const rawDisplayY = event.clientY - stageRect.top - metrics.offsetTop;
    const displayX = Math.max(0, Math.min(metrics.displayWidth, rawDisplayX));
    const displayY = Math.max(0, Math.min(metrics.displayHeight, rawDisplayY));

    updateCropSelectionBox(cropDragStart, {
        displayX,
        displayY,
        imageX: displayX / metrics.scale,
        imageY: displayY / metrics.scale
    });
}

async function handleCropPointerUp(event) {
    if (!cropDragActive || !cropDragStart || !pendingCropImage) return;

    cropDragActive = false;
    document.removeEventListener('pointermove', handleCropPointerMove);
    document.removeEventListener('pointerup', handleCropPointerUp);

    if (imagePreviewStage.hasPointerCapture(event.pointerId)) {
        imagePreviewStage.releasePointerCapture(event.pointerId);
    }

    const metrics = getImageFitMetrics();
    const end = metrics
        ? (() => {
            const stageRect = imagePreviewStage.getBoundingClientRect();
            const rawDisplayX = event.clientX - stageRect.left - metrics.offsetLeft;
            const rawDisplayY = event.clientY - stageRect.top - metrics.offsetTop;
            const displayX = Math.max(0, Math.min(metrics.displayWidth, rawDisplayX));
            const displayY = Math.max(0, Math.min(metrics.displayHeight, rawDisplayY));
            return {
                displayX,
                displayY,
                imageX: displayX / metrics.scale,
                imageY: displayY / metrics.scale
            };
        })()
        : null;

    if (!end) {
        cropDragStart = null;
        cropSelection.hidden = true;
        return;
    }

    const region = {
        x: Math.min(cropDragStart.imageX, end.imageX),
        y: Math.min(cropDragStart.imageY, end.imageY),
        w: Math.abs(end.imageX - cropDragStart.imageX),
        h: Math.abs(end.imageY - cropDragStart.imageY)
    };
    cropDragStart = null;
    cropSelection.hidden = true;

    if (region.w < MIN_SELECTION_IMAGE_PX || region.h < MIN_SELECTION_IMAGE_PX) {
        return;
    }

    const { imageData, width, height } = readImageDataFromElement(pendingCropImage);
    const cropRect = detectSpiritCropRectInRegion(imageData, width, height, region);
    if (!cropRect) {
        alert('精霊アイコンを検出できませんでした。枠全体が入るよう、もう少し大きく囲んでください。');
        return;
    }

    try {
        const blob = await cropAndNormalizeSpiritImage(pendingCropImage, cropRect);
        assignSpiritImageFile(blobToSpiritFile(blob, 'spirit-crop'));
    } catch (error) {
        console.error(error);
        alert(error.message || '切り抜きに失敗しました。');
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
        assignSpiritImageFile(blobToSpiritFile(blob, 'spirit'));
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
    spiritNameInput.required = showDetails;
    imageInput.required = showDetails && !editingSpiritId;
}

function resetForm() {
    editingSpiritId = null;
    dialogTitle.textContent = '精霊を追加';
    submitButton.textContent = '追加する';
    form.reset();
    clearImagePreview();
    eventModeExisting.checked = false;
    eventModeNew.checked = false;
    setEventMode(null);
    imageHint.textContent = 'PNG / JPG など（必須）。スクショは精霊＋周囲の白余白を囲んでドラッグ';
    populateExistingEventSelect();
    fillSelectOptions(spiritMainSelect, ELEMENTS);
    fillSelectOptions(spiritSubSelect, ELEMENTS);
    document.getElementById('event-mode-fieldset').hidden = false;
}

async function refreshCatalogRows() {
    catalogRows = await fetchCatalogRows(database);
}

async function resolveEventId() {
    if (editingSpiritId || eventModeExisting.checked) {
        const eventId = existingEventSelect.value;
        if (!eventId) throw new Error('イベントを選択してください。');
        return eventId;
    }

    const abbr = eventAbbrInput.value.trim();
    const title = eventTitleInput.value.trim();

    if (!abbr || !title) {
        throw new Error('新規イベントの略称・正式名を入力してください。');
    }

    const sectionId = DEFAULT_SECTION_ID;
    const eventId = createEventId(abbr);
    const sortOrder = catalogRows.events.filter(event => event.section_id === sectionId).length + 1;
    const { error } = await database.from('catalog_events').insert({
        id: eventId,
        section_id: sectionId,
        abbr,
        title,
        subtitle: '',
        sort_order: sortOrder
    });

    if (error) throw error;
    return eventId;
}

async function handleSubmit(event) {
    event.preventDefault();

    if (!editingSpiritId && !eventModeExisting.checked && !eventModeNew.checked) {
        alert('イベントを既存か新規か選んでください。');
        return;
    }

    submitButton.disabled = true;

    try {
        const spiritName = spiritNameInput.value.trim();
        if (!spiritName) {
            throw new Error('精霊名を入力してください。');
        }

        if (pendingCropImage) {
            throw new Error('精霊の周りをドラッグして切り抜いてください。');
        }

        const eventId = await resolveEventId();
        const spiritId = editingSpiritId ?? createSpiritId(eventId, spiritName);
        let imagePath = null;

        if (imageInput.files?.[0]) {
            imagePath = await uploadSpiritImage(database, imageInput.files[0]);
        } else if (editingSpiritId) {
            const current = catalogRows.spirits.find(spirit => spirit.id === editingSpiritId);
            imagePath = current?.image_path ?? null;
        } else {
            throw new Error('画像を選択してください。');
        }

        const payload = {
            id: spiritId,
            event_id: eventId,
            name: spiritName,
            main: spiritMainSelect.value,
            sub: spiritSubSelect.value,
            image_path: imagePath,
            sort_order: editingSpiritId
                ? (catalogRows.spirits.find(spirit => spirit.id === editingSpiritId)?.sort_order ?? 1)
                : (catalogRows.spirits.filter(spirit => spirit.event_id === eventId).length + 1)
        };

        const { error } = editingSpiritId
            ? await database.from('catalog_spirits').update(payload).eq('id', editingSpiritId)
            : await database.from('catalog_spirits').insert(payload);

        if (error) throw error;

        dialog.close();
        await reloadCatalog();
        alert(editingSpiritId ? '精霊を更新しました。' : '精霊を追加しました。');
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

export async function openEditDialog(spiritId) {
    if (!ensureAdminAccess()) return;

    try {
        await refreshCatalogRows();
        const spirit = catalogRows.spirits.find(item => item.id === spiritId);
        if (!spirit) {
            alert('精霊が見つかりません。');
            return;
        }

        editingSpiritId = spirit.id;
        dialogTitle.textContent = '精霊を編集';
        submitButton.textContent = '更新する';
        populateExistingEventSelect();
        fillSelectOptions(spiritMainSelect, ELEMENTS);
        fillSelectOptions(spiritSubSelect, ELEMENTS);

        document.getElementById('event-mode-fieldset').hidden = true;
        newEventBlock.hidden = true;
        existingEventBlock.hidden = false;
        spiritDetailsBlock.hidden = false;
        existingEventSelect.required = true;
        eventAbbrInput.required = false;
        eventTitleInput.required = false;

        existingEventSelect.value = spirit.event_id;
        spiritNameInput.value = spirit.name;
        spiritNameInput.required = true;
        spiritMainSelect.value = spirit.main;
        spiritSubSelect.value = spirit.sub;
        imageInput.required = false;
        clearImagePreview();
        imageHint.textContent = '変更しない場合は空のままで OK（貼り付けで差し替え可）';

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
    form.addEventListener('submit', handleSubmit);
    dialog.addEventListener('paste', handleImagePaste);
    imageInput.addEventListener('change', handleImageInputChange);

    document.querySelectorAll('input[name="event-mode"]').forEach(radio => {
        radio.addEventListener('change', () => setEventMode(radio.value));
    });

    if (isAdminUnlocked()) {
        document.body.classList.add('admin-mode');
    }
}
