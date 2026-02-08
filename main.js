// State for the modals
let selectedCard = null;
let transformerStore = [];
const transformerIndex = new Map();
const bulkSelection = new Set();
const AUTH_STORAGE_KEY = 'kseb-auth-token';
const AUTH_USER_KEY = 'kseb-auth-user';
const LOG_ENDPOINT = '/api/logs';
let authSetupComplete = false;
const authQueue = [];

function isAuthenticated() {
    try {
        return Boolean(localStorage.getItem(AUTH_STORAGE_KEY));
    } catch (e) {
        return false;
    }
}

function requireAuth(callback) {
    if (typeof callback === 'function') {
        if (isAuthenticated()) {
            callback();
            return;
        }
        authQueue.push(callback);
    } else if (isAuthenticated()) {
        return;
    }
    showAuthOverlay();
}

function showAuthOverlay() {
    const overlay = document.getElementById('authOverlay');
    if (!overlay) {
        flushAuthQueue();
        return;
    }
    overlay.classList.add('active');
    document.body.classList.add('auth-locked');
    if (!authSetupComplete) {
        const form = document.getElementById('authForm');
        const userInput = document.getElementById('authUser');
        const passInput = document.getElementById('authPass');
        const errorBox = document.getElementById('authError');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = userInput?.value?.trim() || '';
                const password = passInput?.value || '';
                if (!username || !password) {
                    if (errorBox) errorBox.textContent = 'Username and password are required.';
                    return;
                }
                try {
                    const result = await requestLogin(username, password);
                    try {
                        localStorage.setItem(AUTH_STORAGE_KEY, result.token || 'granted');
                        if (result.user?.username) {
                            localStorage.setItem(AUTH_USER_KEY, result.user.username);
                        } else {
                            localStorage.setItem(AUTH_USER_KEY, username);
                        }
                    } catch (storageErr) { console.warn('Could not persist auth token', storageErr); }
                    logActivity({
                        action: 'login',
                        title: 'User login',
                        description: `${result.user?.name || username} signed in`,
                        user: result.user?.username || username
                    });
                    hideAuthOverlay();
                    flushAuthQueue();
                } catch (loginErr) {
                    if (errorBox) {
                        errorBox.textContent = loginErr.message || 'Invalid credentials. Please try again.';
                    }
                    passInput?.focus();
                    passInput?.select();
                }
            });
        }
        authSetupComplete = true;
    }
    const userInput = document.getElementById('authUser');
    if (userInput && !userInput.value) userInput.focus();
}

function hideAuthOverlay() {
    const overlay = document.getElementById('authOverlay');
    overlay?.classList.remove('active');
    document.body.classList.remove('auth-locked');
    const errorBox = document.getElementById('authError');
    if (errorBox) errorBox.textContent = '';
}

function flushAuthQueue() {
    while (authQueue.length) {
        const cb = authQueue.shift();
        try { cb?.(); } catch (e) { console.error(e); }
    }
}

function setupSearchClear(inputId, buttonId, onClear) {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    if (!input || !button) return;
    button.addEventListener('click', () => {
        input.value = '';
        if (typeof onClear === 'function') onClear();
        input.focus();
    });
}

const autoRefreshCallbacks = new Set();
let autoRefreshBound = false;

function registerAutoRefresh(callback) {
    if (typeof callback !== 'function') return;
    autoRefreshCallbacks.add(callback);
    if (autoRefreshBound) return;
    autoRefreshBound = true;

    const triggerRefresh = () => {
        autoRefreshCallbacks.forEach(cb => {
            try {
                cb();
            } catch (err) {
                console.error('Auto refresh failed', err);
            }
        });
    };

    window.addEventListener('pageshow', (event) => {
        if (event.persisted || navigationCameFromHistory()) {
            triggerRefresh();
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            triggerRefresh();
        }
    });
}

function navigationCameFromHistory() {
    try {
        const navEntry = performance.getEntriesByType('navigation')[0];
        return Boolean(navEntry && navEntry.type === 'back_forward');
    } catch (err) {
        return false;
    }
}

function getCurrentUser() {
    try {
        const stored = localStorage.getItem(AUTH_USER_KEY);
        if (stored) return stored;
        if (localStorage.getItem(AUTH_STORAGE_KEY)) {
            const fallback = 'Unknown';
            localStorage.setItem(AUTH_USER_KEY, fallback);
            return fallback;
        }
    } catch (err) {
        // ignore
    }
    return 'Unknown';
}

function logActivity(entry = {}) {
    const payload = {
        timestamp: new Date().toISOString(),
        user: entry.user || getCurrentUser(),
        action: entry.action || 'update',
        title: entry.title || entry.action || 'Update',
        description: entry.description || '',
        metadata: entry.metadata ?? null
    };
    try {
        fetch(LOG_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(err => {
            console.error('Unable to log activity', err);
        });
    } catch (err) {
        console.error('Unable to log activity', err);
    }
}

async function requestLogin(username, password) {
    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (!response.ok) {
        let message = 'Login failed';
        try {
            const error = await response.json();
            if (error?.error) message = error.error;
        } catch (_) {}
        throw new Error(message);
    }
    return response.json();
}

// 1. Search Functionality
function filterGrid() {
    const input = document.getElementById('searchInput');
    const filter = input.value.toLowerCase();
    const cards = document.getElementsByClassName('transformer-card');

    for (let i = 0; i < cards.length; i++) {
        const name = cards[i].querySelector('.tr-name')?.textContent || cards[i].querySelector('.tr-name')?.innerText || '';
        if (name.toLowerCase().indexOf(filter) > -1) {
            cards[i].style.display = "";
        } else {
            cards[i].style.display = "none";
        }
    }
}

// 2. Capacity Filter
function filterCapacity(kva, btn) {
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const cards = document.getElementsByClassName('transformer-card');
    for (let i = 0; i < cards.length; i++) {
        if (kva === 'all') {
            cards[i].style.display = "";
        } else {
            if (cards[i].classList.contains('kv-' + kva)) {
                cards[i].style.display = "";
            } else {
                cards[i].style.display = "none";
            }
        }
    }
}

// 3. Modal Functions
function openMoveModal(btn) {
    // Find the closest parent card element
    selectedCard = btn.closest('.transformer-card');
    document.getElementById('moveModal').classList.add('active');
}

function closeModal() {
    document.getElementById('moveModal').classList.remove('active');
    selectedCard = null;
}

// Close modal if clicking outside box
document.getElementById('moveModal')?.addEventListener('click', function(e) {
    if (e.target === this) closeModal();
});

// 4. Move Logic
function confirmMove() {
    if (!selectedCard) return;

    const targetId = document.getElementById('feederSelect').value;
    const targetGrid = document.getElementById(targetId);

    if (targetGrid) {
        const previousFeeder = selectedCard.dataset.feeder || '';
        // Move the actual DOM element
        targetGrid.appendChild(selectedCard);
        selectedCard.dataset.feeder = targetId;
        const transformerId = selectedCard.dataset.transformerId;
        if (transformerId) updateTransformerFeeder(transformerId, targetId);
        
        // Visual Feedback
        const trName = selectedCard.querySelector('.tr-name')?.textContent?.split('(')[0].trim() || 'Transformer';
        showToast(`Moved <b>${trName}</b> to ${targetId.replace('feeder-', '')}`);
        logActivity({
            action: 'move_transformer',
            title: 'Transformer moved',
            description: `${trName} moved ${previousFeeder ? `from ${formatFeederLabel(previousFeeder)} ` : ''}to ${formatFeederLabel(targetId)}`
        });
        
        // Clear search/filter to ensure the moved item is visible
        document.getElementById('searchInput').value = '';
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        const firstFilter = document.querySelector('.filter-btn');
        if (firstFilter) firstFilter.classList.add('active'); // Reset to All
        const cards = document.getElementsByClassName('transformer-card');
        for(let c of cards) c.style.display = "";
    }

    closeModal();
}

// 5. Toast Notification Logic
function showToast(message) {
    const toast = document.getElementById('toast');
    const msgSpan = document.getElementById('toastMsg');
    if (msgSpan) msgSpan.innerHTML = message;
    
    if (!toast) return;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 6. Dynamic load of transformers from API
async function fetchAndRender() {
    try {
        const res = await fetch('/api/transformers');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        transformerStore = Array.isArray(data) ? data : [];
        transformerIndex.clear();

        // Clear existing grids
        const grids = document.querySelectorAll('.transformer-grid');
        grids.forEach(g => g.innerHTML = '<!-- Feeder data will be populated -->');

        transformerStore.forEach(rec => {
            const feederId = rec.feeder || 'feeder-kanchiyar';
            const grid = document.getElementById(feederId) || document.querySelector('.transformer-grid');
            if (!grid) return;

            const card = document.createElement('div');
            // Map capacity to kv class
            const cap = (rec.capacity || '').toLowerCase();
            let kvClass = 'kv-100';
            if (cap.indexOf('25') > -1) kvClass = 'kv-25';
            else if (cap.indexOf('160') > -1) kvClass = 'kv-160';
            else if (cap.indexOf('250') > -1) kvClass = 'kv-250';
            card.className = `transformer-card ${kvClass}`;
            const key = getTransformerKey(rec);
            if (key) {
                card.dataset.transformerId = key;
                card.dataset.feeder = feederId;
                transformerIndex.set(key, { record: rec, card });
            }

            const moveContainer = document.createElement('div'); moveContainer.className = 'move-btn-container';
            moveContainer.innerHTML = `<button class="move-btn" onclick="openMoveModal(this)">&#8635;</button><span class="move-tooltip">Move Feeder</span>`;

            const nameEl = document.createElement('div'); nameEl.className = 'tr-name'; nameEl.textContent = rec.name || rec.code || 'Unnamed';
            const idEl = document.createElement('div'); idEl.className = 'tr-id'; idEl.textContent = rec.code || '';
            const kvEl = document.createElement('div'); kvEl.className = 'kva-badge'; kvEl.textContent = rec.capacity || '';

            card.appendChild(moveContainer);
            card.appendChild(nameEl);
            card.appendChild(idEl);
            card.appendChild(kvEl);

            grid.appendChild(card);
        });

    } catch (e) {
        console.error('Could not load transformers', e);
    }
}

// --- Bulk move helpers ---
function openBulkMoveModal() {
    const modal = document.getElementById('bulkMoveModal');
    if (!modal) return;
    bulkSelection.clear();
    const search = document.getElementById('bulkSearch');
    if (search) {
        search.value = '';
        handleBulkSearchInput({ target: search });
    } else {
        renderBulkSearchResults([], '');
    }
    renderBulkSelectedList();
    const feederSelect = document.getElementById('bulkTargetFeeder');
    if (feederSelect) feederSelect.selectedIndex = 0;
    modal.classList.add('active');
}

function closeBulkModal() {
    const modal = document.getElementById('bulkMoveModal');
    if (modal) modal.classList.remove('active');
}

document.getElementById('bulkMoveModal')?.addEventListener('click', function(e) {
    if (e.target === this) closeBulkModal();
});

function handleBulkSearchInput(event) {
    const query = event?.target?.value || '';
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
        renderBulkSearchResults([], '');
        return;
    }
    const matches = transformerStore
        .filter(rec => {
            const name = (rec.name || '').toLowerCase();
            const code = (rec.code || '').toLowerCase();
            return name.includes(trimmed) || code.includes(trimmed);
        })
        .slice(0, 8);
    renderBulkSearchResults(matches, trimmed);
}

function renderBulkSearchResults(matches, query) {
    const box = document.getElementById('bulkSearchResults');
    if (!box) return;
    if (!query) {
        box.innerHTML = '<div class="bulk-search-note">Type a name or code to find transformers.</div>';
        return;
    }
    if (!matches.length) {
        box.innerHTML = '<div class="bulk-search-note">No matches found.</div>';
        return;
    }
    box.innerHTML = '';
    matches.forEach(rec => {
        const key = getTransformerKey(rec);
        if (!key) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bulk-search-item';
        const label = rec.name || rec.code || 'Unnamed';
        const code = rec.code ? rec.code : '';
        btn.innerHTML = `<span>${label}</span><span style="color:var(--text-muted);font-size:0.8rem;">${code}</span>`;
        btn.addEventListener('click', () => addBulkSelection(key));
        box.appendChild(btn);
    });
}

function addBulkSelection(key) {
    if (!key) return;
    if (!transformerIndex.has(key)) {
        showToast('Transformer not available for move');
        return;
    }
    if (bulkSelection.has(key)) {
        showToast('Already added to bulk move');
        return;
    }
    bulkSelection.add(key);
    renderBulkSelectedList();
    const search = document.getElementById('bulkSearch');
    if (search) {
        search.focus();
        search.select();
    }
}

function removeBulkSelection(key) {
    bulkSelection.delete(key);
    renderBulkSelectedList();
}

function renderBulkSelectedList() {
    const container = document.getElementById('bulkSelectedList');
    if (!container) return;
    if (!bulkSelection.size) {
        container.innerHTML = '<span class="bulk-search-note">No transformers selected yet.</span>';
        return;
    }
    container.innerHTML = '';
    bulkSelection.forEach(key => {
        const entry = transformerIndex.get(key);
        const label = entry?.record?.name || entry?.record?.code || 'Unnamed';
        const chip = document.createElement('span');
        chip.className = 'bulk-chip';
        chip.innerHTML = `${label}<button type="button" aria-label="Remove">&times;</button>`;
        chip.querySelector('button').addEventListener('click', () => removeBulkSelection(key));
        container.appendChild(chip);
    });
}

function confirmBulkMove() {
    const ids = Array.from(bulkSelection);
    if (!ids.length) {
        showToast('Select at least one transformer');
        return;
    }
    const target = document.getElementById('bulkTargetFeeder')?.value;
    const targetGrid = target ? document.getElementById(target) : null;
    if (!target || !targetGrid) {
        showToast('Choose a valid target feeder');
        return;
    }
    let moved = 0;
    ids.forEach(key => {
        const entry = transformerIndex.get(key);
        const card = entry?.card || document.querySelector(`.transformer-card[data-transformer-id="${key}"]`);
        if (card) {
            const previousFeeder = card.dataset.feeder || entry?.record?.feeder || '';
            targetGrid.appendChild(card);
            card.dataset.feeder = target;
            moved += 1;
            logActivity({
                action: 'bulk_move_item',
                title: 'Transformer moved',
                description: `${entry?.record?.name || entry?.record?.code || key} moved ${previousFeeder ? `from ${formatFeederLabel(previousFeeder)} ` : ''}to ${formatFeederLabel(target)}`
            });
        }
        updateTransformerFeeder(key, target);
    });
    bulkSelection.clear();
    renderBulkSelectedList();
    closeBulkModal();
    const feederLabel = formatFeederLabel(target);
    showToast(`Moved ${moved} transformer${moved === 1 ? '' : 's'} to ${feederLabel}`);
    if (moved) {
        logActivity({
            action: 'bulk_move',
            title: 'Bulk move completed',
            description: `Moved ${moved} transformer${moved === 1 ? '' : 's'} to ${feederLabel}`
        });
    }
}

function updateTransformerFeeder(key, feederId) {
    if (!key) return;
    const entry = transformerIndex.get(key);
    if (entry && entry.record) {
        entry.record.feeder = feederId;
    }
}

function getTransformerKey(record) {
    if (!record) return null;
    if (record.id !== undefined && record.id !== null) return String(record.id);
    if (record.code) return record.code;
    return null;
}

function formatFeederLabel(feederId) {
    return (feederId || '').replace('feeder-', '').replace(/-/g, ' ');
}

document.addEventListener('DOMContentLoaded', () => {
    const bulkSearch = document.getElementById('bulkSearch');
    if (bulkSearch) bulkSearch.addEventListener('input', handleBulkSearchInput);
    setupSearchClear('searchInput', 'searchClearBtn', filterGrid);
    setupSearchClear('bulkSearch', 'bulkSearchClearBtn', () => {
        if (bulkSearch) {
            handleBulkSearchInput({ target: bulkSearch });
        }
    });
});

// Initialize dynamic loading on DOM ready
// Expose start function to be called after user chooses view
window.startApp = fetchAndRender;

// Helper when user chooses AB or Transformer from startup prompt
window.chooseView = function(view) {
    const startup = document.getElementById('startupModal');
    if (view === 'ab') {
        window.location.href = 'ab.html';
        return;
    }
    if (startup) startup.classList.remove('active');
    // start loading transformer cards
    fetchAndRender();
};
