import { SPIRITS_CATALOG_URL, STORAGE_BUCKET } from './config.js';
import { prepareSpiritImageFile } from './spirit-image.js';

/** 画面上にセクション見出しを出さないカテゴリ */
export const SECTIONS_WITHOUT_DISPLAY_TITLE = new Set(['latest', 'recent', 'charapre']);

const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllTableRows(database, tableName, orderColumn = 'sort_order') {
    const rows = [];
    let from = 0;

    while (true) {
        const to = from + SUPABASE_PAGE_SIZE - 1;
        const { data, error } = await database
            .from(tableName)
            .select('*')
            .order(orderColumn)
            .range(from, to);

        if (error) throw error;
        if (!data?.length) break;

        rows.push(...data);
        if (data.length < SUPABASE_PAGE_SIZE) break;
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
            image: spirit.image_path
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
    try {
        const fromSupabase = await loadCatalogFromSupabase(database);
        if (fromSupabase) return fromSupabase;
    } catch (error) {
        console.warn('Supabase カタログ読み込み失敗、JSON にフォールバック:', error);
    }

    return loadCatalogFromJson();
}

export async function fetchCatalogRows(database) {
    const [sections, events, spirits] = await Promise.all([
        fetchAllTableRows(database, 'catalog_sections'),
        fetchAllTableRows(database, 'catalog_events'),
        fetchAllTableRows(database, 'catalog_spirits')
    ]);

    return { sections, events, spirits };
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

export function createSpiritImagePath(eventId, file) {
    const folder = String(eventId ?? '').trim();
    if (!folder) throw new Error('イベント ID が未設定です');
    const extension = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    return `${folder}/${crypto.randomUUID()}.${extension}`;
}

export async function uploadSpiritImage(database, file, eventId) {
    const prepared = await prepareSpiritImageFile(file);
    const path = createSpiritImagePath(eventId, prepared);

    const { error } = await database.storage
        .from(STORAGE_BUCKET)
        .upload(path, prepared, {
            upsert: true,
            contentType: prepared.type || undefined
        });

    if (error) throw error;
    return path;
}
