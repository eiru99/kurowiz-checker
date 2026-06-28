import { ADMIN_PIN } from './config.js';
import {
    createEventId,
    createSpiritId,
    fetchCatalogRows,
    uploadSpiritImage
} from './catalog.js';

const ELEMENTS = ['火', '水', '雷', '光', '闇'];
const ADMIN_SESSION_KEY = 'wiz_admin_unlocked';

let database = null;
let reloadCatalog = null;
let catalogRows = { sections: [], events: [], spirits: [] };
let editingSpiritId = null;

const dialog = document.getElementById('admin-dialog');
const form = document.getElementById('admin-form');
const dialogTitle = document.getElementById('admin-dialog-title');
const sectionSelect = document.getElementById('admin-section');
const eventModeExisting = document.getElementById('event-mode-existing');
const eventModeNew = document.getElementById('event-mode-new');
const existingEventBlock = document.getElementById('existing-event-block');
const newEventBlock = document.getElementById('new-event-block');
const existingEventSelect = document.getElementById('admin-existing-event');
const eventAbbrInput = document.getElementById('admin-event-abbr');
const eventTitleInput = document.getElementById('admin-event-title');
const eventSubtitleInput = document.getElementById('admin-event-subtitle');
const spiritNameInput = document.getElementById('admin-spirit-name');
const spiritMainSelect = document.getElementById('admin-spirit-main');
const spiritSubSelect = document.getElementById('admin-spirit-sub');
const imageInput = document.getElementById('admin-spirit-image');
const imageHint = document.getElementById('admin-image-hint');
const submitButton = document.getElementById('admin-submit-btn');

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

function populateSectionSelect() {
    sectionSelect.innerHTML = '';
    for (const section of catalogRows.sections) {
        const option = document.createElement('option');
        option.value = section.id;
        option.textContent = section.title;
        sectionSelect.appendChild(option);
    }
}

function populateExistingEventSelect() {
    existingEventSelect.innerHTML = '';
    for (const section of catalogRows.sections) {
        const sectionEvents = catalogRows.events.filter(event => event.section_id === section.id);
        if (sectionEvents.length === 0) continue;

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

function setEventMode(mode) {
    const isExisting = mode === 'existing';
    eventModeExisting.checked = isExisting;
    eventModeNew.checked = !isExisting;
    existingEventBlock.hidden = !isExisting;
    newEventBlock.hidden = isExisting;
    existingEventSelect.required = isExisting;
    eventAbbrInput.required = !isExisting;
    eventTitleInput.required = !isExisting;
}

function resetForm() {
    editingSpiritId = null;
    dialogTitle.textContent = '精霊を追加';
    submitButton.textContent = '追加する';
    form.reset();
    setEventMode('existing');
    imageInput.required = true;
    imageHint.textContent = 'PNG / JPG など（必須）';
    populateSectionSelect();
    populateExistingEventSelect();
    fillSelectOptions(spiritMainSelect, ELEMENTS);
    fillSelectOptions(spiritSubSelect, ELEMENTS);
}

async function refreshCatalogRows() {
    catalogRows = await fetchCatalogRows(database);
}

async function resolveEventId() {
    if (eventModeExisting.checked) {
        const eventId = existingEventSelect.value;
        if (!eventId) throw new Error('イベントを選択してください。');
        return eventId;
    }

    const abbr = eventAbbrInput.value.trim();
    const title = eventTitleInput.value.trim();
    const subtitle = eventSubtitleInput.value.trim();
    const sectionId = sectionSelect.value;

    if (!abbr || !title || !sectionId) {
        throw new Error('新規イベントの略称・正式名・掲載カテゴリを入力してください。');
    }

    const eventId = createEventId(abbr);
    const sortOrder = catalogRows.events.filter(event => event.section_id === sectionId).length + 1;
    const { error } = await database.from('catalog_events').insert({
        id: eventId,
        section_id: sectionId,
        abbr,
        title,
        subtitle,
        sort_order: sortOrder
    });

    if (error) throw error;
    return eventId;
}

async function handleSubmit(event) {
    event.preventDefault();
    submitButton.disabled = true;

    try {
        const spiritName = spiritNameInput.value.trim();
        if (!spiritName) {
            throw new Error('精霊名を入力してください。');
        }

        const eventId = await resolveEventId();
        const spiritId = editingSpiritId ?? createSpiritId(eventId, spiritName);
        let imagePath = null;

        if (imageInput.files?.[0]) {
            imagePath = await uploadSpiritImage(database, spiritId, imageInput.files[0]);
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
        populateSectionSelect();
        populateExistingEventSelect();
        fillSelectOptions(spiritMainSelect, ELEMENTS);
        fillSelectOptions(spiritSubSelect, ELEMENTS);
        setEventMode('existing');

        existingEventSelect.value = spirit.event_id;
        spiritNameInput.value = spirit.name;
        spiritMainSelect.value = spirit.main;
        spiritSubSelect.value = spirit.sub;
        imageInput.required = false;
        imageHint.textContent = '変更しない場合は空のままで OK';

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

    document.querySelectorAll('input[name="event-mode"]').forEach(radio => {
        radio.addEventListener('change', () => setEventMode(radio.value));
    });

    if (isAdminUnlocked()) {
        document.body.classList.add('admin-mode');
    }
}
