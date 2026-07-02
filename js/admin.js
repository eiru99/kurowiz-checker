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
const editNameBlock = document.getElementById('edit-name-block');
const editAttrsBlock = document.getElementById('edit-attrs-block');
const spiritMainSelect = document.getElementById('admin-spirit-main');
const spiritSubSelect = document.getElementById('admin-spirit-sub');
const imageDropzone = document.getElementById('admin-image-dropzone');
const imageInput = document.getElementById('admin-spirit-image');
const imagePreviewStage = document.getElementById('admin-image-preview-stage');
const imagePreview = document.getElementById('admin-image-preview');
const imageHint = document.getElementById('admin-image-hint');
const submitButton = document.getElementById('admin-submit-btn');
const spiritQueueBlock = document.getElementById('spirit-queue-block');
const spiritQueueList = document.getElementById('spirit-queue-list');
const spiritQueueCount = document.getElementById('spirit-queue-count');

let previewObjectUrl = null;
let pendingCropImage = null;
let pendingCropObjectUrl = null;
/** @type {{ id: string, file: File, objectUrl: string, name: string, main: string, sub: string }[]} */
let spiritQueue = [];

const IMAGE_MIME_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

function clearSpiritQueue() {
    for (const item of spiritQueue) {
        URL.revokeObjectURL(item.objectUrl);
    }
    spiritQueue = [];
    spiritQueueList.innerHTML = '';
    spiritQueueBlock.hidden = true;
    spiritQueueCount.textContent = '0';
    updateSubmitButtonLabel();
}

function updateSubmitButtonLabel() {
    if (editingSpiritId) {
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

function renderSpiritQueue() {
    spiritQueueList.innerHTML = '';
    spiritQueueCount.textContent = String(spiritQueue.length);
    spiritQueueBlock.hidden = spiritQueue.length === 0;

    for (const item of spiritQueue) {
        const li = document.createElement('li');
        li.className = 'spirit-queue-item';
        li.dataset.queueId = item.id;

        const thumb = document.createElement('img');
        thumb.className = 'spirit-queue-thumb';
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

        const mainSelect = document.createElement('select');
        const subSelect = document.createElement('select');
        populateAttributeSelect(mainSelect);
        populateAttributeSelect(subSelect);
        mainSelect.value = item.main;
        subSelect.value = item.sub;
        syncAttributeSelectStyle(mainSelect);
        syncAttributeSelectStyle(subSelect);
        mainSelect.addEventListener('change', () => {
            item.main = mainSelect.value;
            syncAttributeSelectStyle(mainSelect);
        });
        subSelect.addEventListener('change', () => {
            item.sub = subSelect.value;
            syncAttributeSelectStyle(subSelect);
        });

        attrs.append(mainSelect, subSelect);
        fields.append(nameInput, attrs);

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

    URL.revokeObjectURL(spiritQueue[index].objectUrl);
    spiritQueue.splice(index, 1);
    renderSpiritQueue();
    updateCropHint();
}

function addToSpiritQueue(file, attributes = null) {
    const objectUrl = URL.createObjectURL(file);
    spiritQueue.push({
        id: crypto.randomUUID(),
        file,
        objectUrl,
        name: '',
        main: toQueueAttribute(attributes?.main),
        sub: toQueueAttribute(attributes?.sub)
    });
    renderSpiritQueue();
    updateCropHint();

    const lastNameInput = spiritQueueList.querySelector('.spirit-queue-item:last-child input');
    lastNameInput?.focus();
}

function updateCropHint() {
    if (!pendingCropImage) return;

    const count = spiritQueue.length;
    if (count === 0) {
        imageHint.textContent = '切り抜きたい精霊をクリックしてください（複数選択可）';
        return;
    }
    imageHint.textContent = `${count}体選択済み。続けてクリックするか「${count}体を追加する」で登録`;
}

function updateImageRequired() {
    if (editingSpiritId) {
        imageInput.required = false;
        spiritNameInput.required = true;
        return;
    }

    const showDetails = eventModeExisting.checked || eventModeNew.checked;
    const hasQueue = spiritQueue.length > 0;
    imageInput.required = showDetails && !hasQueue;
    spiritNameInput.required = Boolean(editingSpiritId);
}

function extensionFromMime(mime) {
    return IMAGE_MIME_EXTENSIONS[mime] ?? 'png';
}

function clearPendingCrop() {
    pendingCropImage = null;
    if (pendingCropObjectUrl) {
        URL.revokeObjectURL(pendingCropObjectUrl);
        pendingCropObjectUrl = null;
    }
    imageDropzone.classList.remove('crop-mode');
    imagePreviewStage.removeEventListener('click', handleCropClick);
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
        imageX: displayX / metrics.scale,
        imageY: displayY / metrics.scale
    };
}

function clearImagePreview() {
    clearPendingCrop();
    clearSpiritQueue();
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
    clearSpiritQueue();
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
    imagePreviewStage.addEventListener('click', handleCropClick);
}

async function handleCropClick(event) {
    if (!pendingCropImage) return;
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
        addToSpiritQueue(
            blobToSpiritFile(blob, `spirit-crop-${spiritQueue.length + 1}`),
            attributes
        );
    } catch (error) {
        console.error(error);
        alert(error.message || '切り抜きに失敗しました。');
    }
}

async function processIncomingImage(file) {
    const normalizedFile = normalizePastedImageFile(file);
    const { image, objectUrl } = await loadImageFromFile(normalizedFile);

    if (editingSpiritId) {
        try {
            const blob = await normalizeImageElement(image);
            assignSpiritImageFile(blobToSpiritFile(blob, 'spirit'));
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
    updateImageRequired();
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
    imageHint.textContent = 'PNG / JPG など。スクショ貼り付け時は精霊をクリックで切り抜き（複数可）。名前は下の欄に入力';
    populateExistingEventSelect();
    fillSelectOptions(spiritMainSelect, ELEMENTS);
    fillSelectOptions(spiritSubSelect, ELEMENTS);
    editNameBlock.hidden = true;
    editAttrsBlock.hidden = true;
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

async function submitSpiritQueue() {
    if (spiritQueue.length === 0) {
        throw new Error('精霊画像を追加してください。');
    }

    const unnamed = spiritQueue.find(item => !item.name.trim());
    if (unnamed) {
        throw new Error('すべての精霊に名前を入力してください。');
    }

    const unsetAttrs = spiritQueue.find(
        item => item.main === UNDETECTED_ELEMENT || item.sub === UNDETECTED_ELEMENT
    );
    if (unsetAttrs) {
        throw new Error('属性が未検出の精霊があります。属性を選択してください。');
    }

    const eventId = await resolveEventId();
    const baseSort = catalogRows.spirits.filter(spirit => spirit.event_id === eventId).length;
    const count = spiritQueue.length;

    for (let i = 0; i < count; i++) {
        const item = spiritQueue[i];
        const spiritName = item.name.trim();
        const idSuffix = count > 1 ? `-${i + 1}` : '';
        const spiritId = `${createSpiritId(eventId, spiritName)}${idSuffix}`;
        const imagePath = await uploadSpiritImage(database, item.file);

        const { error } = await database.from('catalog_spirits').insert({
            id: spiritId,
            event_id: eventId,
            name: spiritName,
            main: item.main,
            sub: item.sub,
            image_path: imagePath,
            sort_order: baseSort + i + 1
        });

        if (error) throw error;
    }

    dialog.close();
    await reloadCatalog();
    alert(`${count}体の精霊を追加しました。`);
}

async function handleSubmit(event) {
    event.preventDefault();

    if (!editingSpiritId && !eventModeExisting.checked && !eventModeNew.checked) {
        alert('イベントを既存か新規か選んでください。');
        return;
    }

    submitButton.disabled = true;

    try {
        if (!editingSpiritId) {
            if (pendingCropImage && spiritQueue.length === 0) {
                throw new Error('切り抜きたい精霊をクリックしてください。');
            }
            await submitSpiritQueue();
            return;
        }

        const spiritName = spiritNameInput.value.trim();
        if (!spiritName) {
            throw new Error('精霊名を入力してください。');
        }

        const eventId = await resolveEventId();
        const spiritId = editingSpiritId;
        let imagePath = null;

        if (imageInput.files?.[0]) {
            imagePath = await uploadSpiritImage(database, imageInput.files[0]);
        } else {
            const current = catalogRows.spirits.find(spirit => spirit.id === editingSpiritId);
            imagePath = current?.image_path ?? null;
        }

        const payload = {
            id: spiritId,
            event_id: eventId,
            name: spiritName,
            main: spiritMainSelect.value,
            sub: spiritSubSelect.value,
            image_path: imagePath,
            sort_order: catalogRows.spirits.find(spirit => spirit.id === editingSpiritId)?.sort_order ?? 1
        };

        const { error } = await database.from('catalog_spirits').update(payload).eq('id', editingSpiritId);

        if (error) throw error;

        dialog.close();
        await reloadCatalog();
        alert('精霊を更新しました。');
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
        editNameBlock.hidden = false;
        editAttrsBlock.hidden = false;

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
        clearSpiritQueue();
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
