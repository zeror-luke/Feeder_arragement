// State for the modal
let selectedCard = null;

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
        // Move the actual DOM element
        targetGrid.appendChild(selectedCard);
        
        // Visual Feedback
        const trName = selectedCard.querySelector('.tr-name')?.textContent?.split('(')[0].trim() || 'Transformer';
        showToast(`Moved <b>${trName}</b> to ${targetId.replace('feeder-', '')}`);
        
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

        // Clear existing grids
        const grids = document.querySelectorAll('.transformer-grid');
        grids.forEach(g => g.innerHTML = '<!-- Feeder data will be populated -->');

        data.forEach(rec => {
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
