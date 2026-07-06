import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
    flattenCatalog,
    getSpiritImageUrl,
    loadCatalog,
    matchesJapaneseSearch,
    SECTIONS_WITHOUT_DISPLAY_TITLE
} from './catalog.js?v=20250707g';
import { initAdmin, openEventEditDialog } from './admin.js?v=20250707b';

const database = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const catalogEl = document.getElementById('catalog');
const statsEl = document.getElementById('stats');
const searchInput = document.getElementById('search');
const searchClearBtn = document.getElementById('search-clear-btn');
const controlsMenuBtn = document.getElementById('controls-menu-btn');
const controlsMenu = document.getElementById('controls-menu');
const scrollTopBtn = document.getElementById('scroll-top-btn');
const elementFilter = document.getElementById('filter-element');
const syncKeyInput = document.getElementById('sync-key-input');

let catalog = null;
let spiritById = new Map();
let allSpiritIds = [];
let ownedSpiritIds = [];
let mySyncKey = localStorage.getItem('wiz_sync_key');
let realtimeChannel = null;
let isSaving = false;
let pendingScrollToEventId = null;
let pendingScrollToSectionId = null;
const expandedSearchEventIds = new Set();

const SCROLL_TOP_THRESHOLD = 240;

function createSyncKey() {
    const suffix = Math.floor(100000 + Math.random() * 900000);
    return `wiz-${suffix}`;
}

function normalizeOwnedSpiritIds(value) {
    if (!Array.isArray(value)) return [];
    const validIds = new Set(allSpiritIds);
    return [...new Set(value.filter(id => typeof id === 'string' && validIds.has(id)))];
}

function showMessage(className, message) {
    catalogEl.innerHTML = `<div class="${className}">${message}</div>`;
}

async function reloadCatalog(scrollToEventId = null) {
    if (scrollToEventId) {
        pendingScrollToEventId = scrollToEventId;
    }
    showMessage('loading-message', '精霊データを読み込み中...');
    catalog = await loadCatalog(database);
    const flattened = flattenCatalog(catalog);
    spiritById = flattened.byId;
    allSpiritIds = flattened.ids;
    ownedSpiritIds = normalizeOwnedSpiritIds(ownedSpiritIds);
    renderCatalog();
}

async function loadCloudData() {
    const { data, error } = await database
        .from('spirits')
        .select('owned_ids')
        .eq('sync_key', mySyncKey)
        .maybeSingle();

    if (error) {
        console.error('読み込みエラー:', error);
        alert('データの読み込みに失敗しました。Supabase の RLS 設定を確認してください。');
        return;
    }

    ownedSpiritIds = normalizeOwnedSpiritIds(data?.owned_ids);
    renderCatalog();
}

async function saveCloudData() {
    if (isSaving) return;
    isSaving = true;

    try {
        const { error } = await database
            .from('spirits')
            .upsert(
                { sync_key: mySyncKey, owned_ids: ownedSpiritIds },
                { onConflict: 'sync_key' }
            );

        if (error) {
            console.error('保存失敗:', error);
            alert('保存に失敗しました。Supabase の RLS 設定を確認してください。');
        }
    } catch (error) {
        console.error('通信エラー:', error);
    } finally {
        isSaving = false;
    }
}

function matchesSearchFilter(spirit, searchText) {
    if (!searchText) return true;
    return [
        spirit.name,
        spirit.event.abbr,
        spirit.event.title,
        spirit.section.title
    ].some(text => matchesJapaneseSearch(searchText, text));
}

function matchesElementFilter(spirit) {
    const selectedElement = elementFilter.value;
    return !selectedElement
        || spirit.main === selectedElement
        || spirit.sub === selectedElement;
}

function matchesFilters(spirit, searchText) {
    return matchesSearchFilter(spirit, searchText) && matchesElementFilter(spirit);
}

function updateStats() {
    const ownedCount = ownedSpiritIds.length;
    const totalCount = allSpiritIds.length;
    const rate = totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100);
    statsEl.textContent = `所持率: ${ownedCount} / ${totalCount} (${rate}%)`;
}

function setSpiritTileOwnedState(button, isOwned, spiritName) {
    const tile = button.closest('.spirit-tile-wrap');
    button.classList.toggle('owned', isOwned);
    tile?.classList.toggle('owned', isOwned);
    button.setAttribute('aria-pressed', String(isOwned));
    button.setAttribute('aria-label', `${spiritName} ${isOwned ? '所持' : '未所持'}`);
}

function updateSpiritTileOwnedState(spiritId) {
    const spirit = spiritById.get(spiritId);
    const button = catalogEl.querySelector(`button.spirit-tile[data-spirit-id="${spiritId}"]`);
    if (!spirit || !button) return false;

    setSpiritTileOwnedState(button, ownedSpiritIds.includes(spiritId), spirit.name);
    return true;
}

function applyOwnedSpiritIdChanges(previousOwnedIds) {
    const previous = new Set(previousOwnedIds);
    const current = new Set(ownedSpiritIds);
    let updatedDom = false;

    for (const spiritId of new Set([...previous, ...current])) {
        if (previous.has(spiritId) === current.has(spiritId)) continue;
        updatedDom = updateSpiritTileOwnedState(spiritId) || updatedDom;
    }

    updateStats();
    return updatedDom;
}

function createSpiritTile(spirit) {
    const isOwned = ownedSpiritIds.includes(spirit.id);
    const tile = document.createElement('div');
    tile.className = `spirit-tile-wrap${isOwned ? ' owned' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `spirit-tile${isOwned ? ' owned' : ''}`;
    button.dataset.spiritId = spirit.id;
    button.setAttribute('aria-pressed', String(isOwned));
    button.setAttribute('aria-label', `${spirit.name} ${isOwned ? '所持' : '未所持'}`);

    const thumb = document.createElement('div');
    thumb.className = 'spirit-thumb';

    const imageUrl = getSpiritImageUrl(database, spirit);
    if (imageUrl) {
        const image = document.createElement('img');
        image.src = imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.addEventListener('error', () => {
            image.remove();
            const placeholder = document.createElement('div');
            placeholder.className = 'spirit-placeholder';
            placeholder.textContent = '画像未設定';
            thumb.appendChild(placeholder);
        });
        thumb.appendChild(image);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'spirit-placeholder';
        placeholder.textContent = '画像未設定';
        thumb.appendChild(placeholder);
    }

    button.appendChild(thumb);
    button.addEventListener('click', () => toggleOwned(spirit.id));

    tile.appendChild(button);

    return tile;
}

function scrollToEventBlock(eventId) {
    const block = catalogEl.querySelector(`.event-block[data-event-id="${CSS.escape(eventId)}"]`);
    if (block) {
        block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function scrollToSection(sectionId) {
    const block = document.getElementById(`section-${sectionId}`);
    if (block) {
        block.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
    }
    return false;
}

function jumpToSection(sectionId) {
    if (scrollToSection(sectionId)) return;

    searchInput.value = '';
    updateSearchClearButton();
    elementFilter.value = '';
    pendingScrollToSectionId = sectionId;
    renderCatalog();
}

function updateScrollTopButton() {
    scrollTopBtn.hidden = window.scrollY < SCROLL_TOP_THRESHOLD;
}

function renderCatalog() {
    if (!catalog) return;

    const scrollY = window.scrollY;
    catalogEl.innerHTML = '';
    const searchText = searchInput.value.trim();
    let visibleCount = 0;

    for (const section of catalog.sections) {
        const visibleEvents = [];

        for (const event of section.events) {
            const eventSpirits = event.spirits
                .map(spirit => spiritById.get(spirit.id))
                .filter(spirit => spirit);

            const matchingSpirits = eventSpirits.filter(spirit => matchesFilters(spirit, searchText));
            if (matchingSpirits.length === 0) continue;

            const isExpanded = searchText && expandedSearchEventIds.has(event.id);
            const displaySpirits = isExpanded
                ? eventSpirits.filter(spirit => matchesElementFilter(spirit))
                : matchingSpirits;

            const hasHiddenBySearch = searchText && eventSpirits.some(spirit =>
                matchesElementFilter(spirit) && !matchesSearchFilter(spirit, searchText)
            );

            visibleEvents.push({ event, displaySpirits, hasHiddenBySearch });
            visibleCount += displaySpirits.length;
        }

        if (visibleEvents.length === 0) continue;

        const hideSectionTitle = SECTIONS_WITHOUT_DISPLAY_TITLE.has(section.id);
        const sectionBlock = hideSectionTitle ? null : document.createElement('section');
        if (sectionBlock) {
            sectionBlock.className = 'section-block';
            sectionBlock.id = `section-${section.id}`;

            const sectionTitle = document.createElement('h2');
            sectionTitle.className = 'section-title';
            sectionTitle.textContent = section.title;
            sectionBlock.appendChild(sectionTitle);
        }

        const container = sectionBlock ?? catalogEl;

        for (const { event, displaySpirits, hasHiddenBySearch } of visibleEvents) {
            const eventBlock = document.createElement('article');
            eventBlock.className = 'event-block';
            eventBlock.dataset.eventId = event.id;

            const header = document.createElement('div');
            header.className = 'event-header';

            const headerText = document.createElement('div');
            headerText.className = 'event-header-text';
            headerText.innerHTML = `
                <h3 class="event-abbr">${event.abbr}</h3>
                <p class="event-title">${event.title}</p>
            `;

            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.className = 'event-edit-btn';
            editButton.textContent = '編集';
            editButton.addEventListener('click', () => openEventEditDialog(event.id));

            const actions = document.createElement('div');
            actions.className = 'event-header-actions';

            if (event.heldYear && event.heldMonth) {
                const held = document.createElement('span');
                held.className = 'event-held-month';
                held.textContent = `${event.heldYear}年${event.heldMonth}月`;
                actions.appendChild(held);
            }

            actions.appendChild(editButton);

            header.appendChild(headerText);

            if (hasHiddenBySearch) {
                const isExpanded = expandedSearchEventIds.has(event.id);
                const toggleLabel = document.createElement('label');
                toggleLabel.className = 'event-show-all-toggle';

                const toggleText = document.createElement('span');
                toggleText.className = 'event-show-all-toggle-label';
                toggleText.textContent = '他精霊も表示';

                const toggleSwitch = document.createElement('span');
                toggleSwitch.className = 'admin-toggle';

                const toggleInput = document.createElement('input');
                toggleInput.type = 'checkbox';
                toggleInput.checked = isExpanded;
                toggleInput.addEventListener('change', () => {
                    if (toggleInput.checked) {
                        expandedSearchEventIds.add(event.id);
                    } else {
                        expandedSearchEventIds.delete(event.id);
                    }
                    renderCatalog();
                });

                const toggleSlider = document.createElement('span');
                toggleSlider.className = 'admin-toggle-slider';
                toggleSlider.setAttribute('aria-hidden', 'true');

                toggleSwitch.append(toggleInput, toggleSlider);
                toggleLabel.append(toggleText, toggleSwitch);
                header.appendChild(toggleLabel);
            }

            header.appendChild(actions);

            const row = document.createElement('div');
            row.className = 'spirit-row';
            displaySpirits.forEach(spirit => row.appendChild(createSpiritTile(spirit)));

            eventBlock.appendChild(header);
            eventBlock.appendChild(row);
            container.appendChild(eventBlock);
        }

        if (sectionBlock) {
            catalogEl.appendChild(sectionBlock);
        }
    }

    if (visibleCount === 0) {
        showMessage(
            'empty-message',
            searchText ? '検索条件に一致する精霊がありません。' : '表示できる精霊がありません。'
        );
    }

    updateStats();

    const scrollTargetEventId = pendingScrollToEventId;
    const scrollTargetSectionId = pendingScrollToSectionId;
    pendingScrollToEventId = null;
    pendingScrollToSectionId = null;

    if (scrollTargetEventId) {
        scrollToEventBlock(scrollTargetEventId);
    } else if (scrollTargetSectionId) {
        scrollToSection(scrollTargetSectionId);
    } else {
        window.scrollTo(0, scrollY);
    }
}

function ownedSpiritIdsEqual(left, right) {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every(id => rightSet.has(id));
}

async function toggleOwned(spiritId) {
    const previousOwnedIds = ownedSpiritIds;
    ownedSpiritIds = ownedSpiritIds.includes(spiritId)
        ? ownedSpiritIds.filter(id => id !== spiritId)
        : [...ownedSpiritIds, spiritId];

    if (!applyOwnedSpiritIdChanges(previousOwnedIds)) {
        renderCatalog();
    }

    await saveCloudData();
}

function applyRemoteOwnedIds(nextOwnedIds) {
    const normalized = normalizeOwnedSpiritIds(nextOwnedIds);
    if (ownedSpiritIdsEqual(normalized, ownedSpiritIds)) return;

    const previousOwnedIds = ownedSpiritIds;
    ownedSpiritIds = normalized;

    if (!applyOwnedSpiritIdChanges(previousOwnedIds)) {
        renderCatalog();
    }
}

function setupRealtimeListener() {
    if (realtimeChannel) {
        database.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    realtimeChannel = database
        .channel(`spirits-sync-${mySyncKey}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'spirits',
                filter: `sync_key=eq.${mySyncKey}`
            },
            payload => {
                const nextOwnedIds = payload.new?.owned_ids;
                if (nextOwnedIds) {
                    applyRemoteOwnedIds(nextOwnedIds);
                }
            }
        )
        .subscribe();
}

document.getElementById('sync-connect-btn').addEventListener('click', async () => {
    const inputKey = syncKeyInput.value.trim();
    if (!inputKey) return;

    if (inputKey.length < 6) {
        alert('同期コードは6文字以上で入力してください。');
        return;
    }

    if (confirm('指定された同期コードのデータとリアルタイム同期を開始しますか？')) {
        mySyncKey = inputKey;
        localStorage.setItem('wiz_sync_key', mySyncKey);
        await loadCloudData();
        setupRealtimeListener();
    }
});

function setControlsMenuOpen(open) {
    controlsMenu.hidden = !open;
    controlsMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

controlsMenuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    setControlsMenuOpen(controlsMenu.hidden);
});

controlsMenu.addEventListener('click', (event) => {
    event.stopPropagation();
});

document.addEventListener('click', () => {
    if (!controlsMenu.hidden) {
        setControlsMenuOpen(false);
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !controlsMenu.hidden) {
        setControlsMenuOpen(false);
        controlsMenuBtn.focus();
    }
});

document.getElementById('reset-btn').addEventListener('click', async () => {
    setControlsMenuOpen(false);
    if (confirm('クラウド上のデータもすべてリセットされます。よろしいですか？')) {
        const previousOwnedIds = ownedSpiritIds;
        ownedSpiritIds = [];
        if (!applyOwnedSpiritIdChanges(previousOwnedIds)) {
            renderCatalog();
        }
        await saveCloudData();
    }
});

function updateSearchClearButton() {
    searchClearBtn.hidden = !searchInput.value;
}

searchInput.addEventListener('input', () => {
    if (!searchInput.value.trim()) {
        expandedSearchEventIds.clear();
    }
    updateSearchClearButton();
    renderCatalog();
});

searchClearBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    searchInput.value = '';
    expandedSearchEventIds.clear();
    updateSearchClearButton();
    searchInput.focus();
    renderCatalog();
});

document.querySelectorAll('.section-jump-btn').forEach(button => {
    button.addEventListener('click', () => {
        jumpToSection(button.dataset.sectionId);
    });
});

scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('scroll', updateScrollTopButton, { passive: true });
updateScrollTopButton();
elementFilter.addEventListener('change', renderCatalog);

async function init() {
    if (!mySyncKey) {
        mySyncKey = createSyncKey();
        localStorage.setItem('wiz_sync_key', mySyncKey);
    }
    syncKeyInput.value = mySyncKey;

    initAdmin(database, reloadCatalog);

    try {
        await reloadCatalog();
        await loadCloudData();
        setupRealtimeListener();
    } catch (error) {
        console.error(error);
        showMessage('error-message', error.message);
    }
}

init();
