import { SPIRITS_CATALOG_URL, STORAGE_BUCKET, SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';
import { prepareSpiritImageFile } from './spirit-image.js';

/** 画面上にセクション見出しを出さないカテゴリ */
export const SECTIONS_WITHOUT_DISPLAY_TITLE = new Set(['latest', 'recent', 'charapre', 'other']);

/** イベント編集時に選べる表示カテゴリ（セクション見出しのグループ） */
export const EVENT_CATEGORIES = ['通常', 'コラボ', 'DL記念', 'ウィズセレ'];

const NORMAL_SECTION_IDS = new Set(['latest', 'recent', 'charapre', 'other']);

const CATEGORY_TO_SECTION_ID = {
    '通常': 'latest',
    'コラボ': 'kollabo',
    'DL記念': 'download',
    'ウィズセレ': 'wizselection'
};

/** section_id から表示カテゴリを推定 */
export function sectionIdToCategory(sectionId) {
    if (sectionId === 'kollabo') return 'コラボ';
    if (sectionId === 'download') return 'DL記念';
    if (sectionId === 'wizselection') return 'ウィズセレ';
    return '通常';
}

/** カテゴリ変更時の section_id を決定（通常は既存の通常セクションを維持） */
export function resolveSectionIdForCategory(category, currentSectionId = null) {
    if (category === '通常') {
        if (currentSectionId && NORMAL_SECTION_IDS.has(currentSectionId)) {
            return currentSectionId;
        }
        return CATEGORY_TO_SECTION_ID['通常'];
    }
    return CATEGORY_TO_SECTION_ID[category] ?? CATEGORY_TO_SECTION_ID['通常'];
}

const KATAKANA_TO_HIRAGANA = 0x3041 - 0x30a1;

function getWanakana() {
    return globalThis.wanakana ?? globalThis.Wanakana ?? null;
}

/** 検索用に文字列をひらがな・小文字に正規化（ひらがな/カタカナを区別しない） */
export function normalizeJapaneseForSearch(text) {
    const value = String(text ?? '').normalize('NFKC').trim().toLowerCase();
    if (!value) return '';

    const wk = getWanakana();
    const converted = wk?.toHiragana
        ? wk.toHiragana(value, { passRomaji: true })
        : value;

    return converted
        .replace(/\u30f4/g, '\u3094')
        .replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) + KATAKANA_TO_HIRAGANA));
}

export function matchesJapaneseSearch(query, target) {
    const normalizedQuery = normalizeJapaneseForSearch(query);
    if (!normalizedQuery) return true;
    return normalizeJapaneseForSearch(target).includes(normalizedQuery);
}

const DOWNLOAD_DL_CHARAPRE_EVENT_ID = 'charapre-e97';
const WIZSELECTION_EVENT_ID = 'charapre-wizsele';
const WIZSELECTION_SECTION = {
    id: 'wizselection',
    title: 'プラチナ/ウィズセレクション'
};
const CATALOG_SECTION_ORDER = [
    'latest',
    'recent',
    'charapre',
    'other',
    'kollabo',
    'download',
    'wizselection'
];

function reorderSections(sections) {
    const byId = new Map(sections.map(section => [section.id, section]));
    const ordered = [];
    const used = new Set();

    for (const id of CATALOG_SECTION_ORDER) {
        const section = byId.get(id);
        if (section) {
            ordered.push(section);
            used.add(id);
        }
    }

    for (const section of sections) {
        if (!used.has(section.id)) {
            ordered.push(section);
        }
    }

    return ordered;
}

function popEventFromSections(sections, eventId) {
    for (const section of sections) {
        const index = (section.events ?? []).findIndex(event => event.id === eventId);
        if (index >= 0) {
            return section.events.splice(index, 1)[0];
        }
    }
    return null;
}

/** カタログのセクション・イベント配置を画面表示用に正規化 */
export function normalizeCatalogLayout(catalog) {
    if (!catalog?.sections) return catalog;

    const sections = catalog.sections.map(section => ({
        ...section,
        events: [...(section.events ?? [])]
    }));

    const dlCharapreEvent = popEventFromSections(sections, DOWNLOAD_DL_CHARAPRE_EVENT_ID);
    const wizseleEvent = popEventFromSections(sections, WIZSELECTION_EVENT_ID);

    if (dlCharapreEvent) {
        const downloadSection = sections.find(section => section.id === 'download');
        if (downloadSection) {
            downloadSection.events.unshift(dlCharapreEvent);
        }
    }

    if (wizseleEvent) {
        let wizSection = sections.find(section => section.id === WIZSELECTION_SECTION.id);
        if (!wizSection) {
            wizSection = { ...WIZSELECTION_SECTION, events: [] };
            sections.push(wizSection);
        }
        wizSection.events.push(wizseleEvent);
    }

    return { ...catalog, sections: reorderSections(sections) };
}

const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllTableRows(_database, tableName, orderColumn = 'sort_order') {
    const rows = [];
    let from = 0;

    while (true) {
        const to = from + SUPABASE_PAGE_SIZE - 1;
        const url = new URL(`${SUPABASE_URL}/rest/v1/${tableName}`);
        url.searchParams.set('select', '*');
        url.searchParams.set('order', `${orderColumn},id`);

        const response = await fetch(url, {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                Range: `${from}-${to}`
            }
        });

        if (!response.ok) {
            throw new Error(`${tableName} の取得に失敗しました (${response.status})`);
        }

        const batch = await response.json();
        if (!Array.isArray(batch) || batch.length === 0) break;

        rows.push(...batch);
        if (batch.length < SUPABASE_PAGE_SIZE) break;
        from += SUPABASE_PAGE_SIZE;
    }

    return rows;
}

export function flattenCatalog(catalogData) {
    const byId = new Map();
    const ids = [];

    for (const section of catalogData.sections ?? []) {
        for (const event of section.events ?? []) {
            for (const spirit of event.spirits ?? []) {
                byId.set(spirit.id, { ...spirit, event, section });
                ids.push(spirit.id);
            }
        }
    }

    return { byId, ids };
}

export function getSpiritImageUrl(database, spirit) {
    const image = spirit.image ?? spirit.image_path;
    if (!image) return null;
    if (image.startsWith('http://') || image.startsWith('https://')) return image;
    if (image.startsWith('images/')) return image;

    const { data } = database.storage.from(STORAGE_BUCKET).getPublicUrl(image);
    return data.publicUrl;
}

function buildCatalogFromRows(sections, events, spirits) {
    const eventsBySection = new Map();
    for (const event of events) {
        if (!eventsBySection.has(event.section_id)) {
            eventsBySection.set(event.section_id, []);
        }
        eventsBySection.get(event.section_id).push(event);
    }

    const spiritsByEvent = new Map();
    for (const spirit of spirits) {
        if (!spiritsByEvent.has(spirit.event_id)) {
            spiritsByEvent.set(spirit.event_id, []);
        }
        spiritsByEvent.get(spirit.event_id).push({
            id: spirit.id,
            name: spirit.name,
            main: spirit.main,
            sub: spirit.sub,
            image: spirit.image_path,
            infoUrl: spirit.info_url ?? null
        });
    }

    return {
        version: 1,
        sections: sections.map(section => ({
            id: section.id,
            title: section.title,
            events: (eventsBySection.get(section.id) ?? []).map(event => ({
                id: event.id,
                abbr: event.abbr,
                title: event.title,
                category: event.category ?? sectionIdToCategory(event.section_id),
                heldYear: event.held_year ?? null,
                heldMonth: event.held_month ?? null,
                storageFolder: event.storage_folder ?? null,
                spirits: spiritsByEvent.get(event.id) ?? []
            }))
        }))
    };
}

async function loadCatalogFromSupabase(database) {
    const [sections, events, spirits] = await Promise.all([
        fetchAllTableRows(database, 'catalog_sections'),
        fetchAllTableRows(database, 'catalog_events'),
        fetchAllTableRows(database, 'catalog_spirits')
    ]);

    if (sections.length === 0) return null;

    return buildCatalogFromRows(sections, events, spirits);
}

async function loadCatalogFromJson() {
    const response = await fetch(SPIRITS_CATALOG_URL);
    if (!response.ok) {
        throw new Error('精霊データの読み込みに失敗しました');
    }
    return response.json();
}

export async function loadCatalog(database) {
    let catalog;
    try {
        catalog = await loadCatalogFromSupabase(database);
    } catch (error) {
        console.warn('Supabase カタログ読み込み失敗、JSON にフォールバック:', error);
    }

    if (!catalog) {
        catalog = await loadCatalogFromJson();
    }

    return normalizeCatalogLayout(catalog);
}

export async function fetchCatalogRows(database) {
    const [sections, events, spirits] = await Promise.all([
        fetchAllTableRows(database, 'catalog_sections'),
        fetchAllTableRows(database, 'catalog_events'),
        fetchAllTableRows(database, 'catalog_spirits')
    ]);

    return { sections, events, spirits };
}

const STORAGE_FOLDER_OVERRIDES = {
    kamisanpo3: 'kamisanpo3',
    'charapre-wizsele': 'wizselection'
};

export function abbrToStorageFolder(abbr, eventId = null) {
    const trimmed = String(abbr ?? '').trim();
    if (!trimmed) throw new Error('略称が未設定です');
    if (eventId && STORAGE_FOLDER_OVERRIDES[eventId]) {
        return STORAGE_FOLDER_OVERRIDES[eventId];
    }

    let romaji = trimmed;
    if (typeof globalThis.wanakana !== 'undefined') {
        romaji = globalThis.wanakana.toRomaji(trimmed);
    }

    return String(romaji)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'event';
}

export function resolveStorageFolder(event) {
    if (event?.storage_folder) return event.storage_folder;
    if (event?.storageFolder) return event.storageFolder;
    return abbrToStorageFolder(event?.abbr, event?.id);
}

export function slugify(value) {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'item';
}

export function createEventId(abbr) {
    return `${slugify(abbr)}-${Date.now().toString(36)}`;
}

export function createSpiritId(eventId, name) {
    return `${slugify(eventId)}-${slugify(name)}-${Date.now().toString(36)}`;
}

export function createSpiritImagePath(storageFolder, file) {
    const folder = String(storageFolder ?? '').trim();
    if (!folder) throw new Error('Storage フォルダが未設定です');
    const extension = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    return `${folder}/${crypto.randomUUID()}.${extension}`;
}

export async function uploadSpiritImage(database, file, storageFolder) {
    const prepared = await prepareSpiritImageFile(file);
    const path = createSpiritImagePath(storageFolder, prepared);

    const { error } = await database.storage
        .from(STORAGE_BUCKET)
        .upload(path, prepared, {
            upsert: true,
            contentType: prepared.type || undefined
        });

    if (error) throw error;
    return path;
}
