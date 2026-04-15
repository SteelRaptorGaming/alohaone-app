// =============================================================================
// AlohaOne — Catalog view (Phase E.2)
// -----------------------------------------------------------------------------
// Drives catalog.html. Reads GET /api/catalog from shared.api.alohaone.ai
// (public, but the page still requires a logged-in session per the shell),
// renders one card per enabled platform with its active tiers, and pushes
// selected tiers into the localStorage cart used by cart.html.
// =============================================================================

let _catalogData = { platforms: [], tiers: [] };

async function initCatalogView() {
    const loadingEl = document.getElementById('catalog-loading');
    const rootEl = document.getElementById('catalog-root');

    try {
        const data = await sharedFetch('/api/catalog');
        _catalogData.platforms = data.platforms || [];
        _catalogData.tiers = data.tiers || [];
        renderCatalog();
    } catch (err) {
        loadingEl.innerHTML = `
            <div class="alert alert-danger">
                <strong>Could not load catalog.</strong><br>
                ${escapeHtml(err.message)}
                <div class="mt-2">
                    <button class="btn btn-sm btn-outline-danger" onclick="initCatalogView()">Retry</button>
                </div>
            </div>`;
        return;
    }

    loadingEl.style.display = 'none';
    rootEl.style.display = '';
    refreshCartBadge();
    window.addEventListener('ao_cart_changed', refreshCartBadge);
}

function renderCatalog() {
    const rootEl = document.getElementById('catalog-root');
    if (!rootEl) return;

    if (_catalogData.platforms.length === 0) {
        rootEl.innerHTML = `
            <div class="col-12">
                <div class="catalog-empty">
                    <i class="fa-solid fa-box-open fs-1 mb-3"></i>
                    <h5>No platforms are available yet.</h5>
                    <p class="text-muted">Check back soon — new platforms are coming.</p>
                </div>
            </div>`;
        return;
    }

    rootEl.innerHTML = _catalogData.platforms.map(renderPlatformCard).join('');
}

function renderPlatformCard(p) {
    const tiers = _catalogData.tiers.filter(t => t.platform_id === p.id);
    const tierRows = tiers.length === 0
        ? `<div class="text-muted small text-center py-2">No plans available for this platform yet.</div>`
        : tiers.map(t => renderTierRow(p, t)).join('');

    return `
    <div class="col-md-6 col-lg-4">
        <div class="catalog-card">
            <div class="platform-icon">
                <i class="${escapeHtml(p.icon || 'fa-solid fa-cube')}"></i>
            </div>
            <h5>${escapeHtml(p.name)}</h5>
            <div class="platform-desc">${escapeHtml(p.description || '')}</div>
            <div class="tier-list">
                ${tierRows}
            </div>
        </div>
    </div>`;
}

function renderTierRow(platform, tier) {
    const dollars = ((tier.monthly_price_cents || 0) / 100).toFixed(2);
    const cents = tier.monthly_price_cents || 0;
    return `
        <div class="tier-row">
            <div>
                <div class="tier-name">${escapeHtml(tier.name)}</div>
                ${tier.description ? `<div class="small text-muted">${escapeHtml(tier.description)}</div>` : ''}
            </div>
            <div class="text-end">
                <div class="tier-price">$${dollars}<span class="per"> /mo</span></div>
                <button class="btn btn-sm btn-primary mt-1"
                        data-platform-id="${platform.id}"
                        data-tier-id="${tier.id}"
                        data-tier-name="${escapeHtml(tier.name)}"
                        data-platform-name="${escapeHtml(platform.name)}"
                        data-cents="${cents}"
                        onclick="handleAddToCart(this)">
                    <i class="fa-solid fa-plus me-1"></i> Add
                </button>
            </div>
        </div>`;
}

function handleAddToCart(btn) {
    const platformId = parseInt(btn.dataset.platformId, 10);
    const tierId = parseInt(btn.dataset.tierId, 10);
    const platformName = btn.dataset.platformName;
    const tierName = btn.dataset.tierName;
    addToCart(platformId, tierId, 1);
    showSuccess(`Added ${platformName} — ${tierName} to your cart.`);
    refreshCartBadge();
}

function refreshCartBadge() {
    const badge = document.getElementById('cart-count-badge');
    if (!badge) return;
    const n = cartCount();
    if (n > 0) {
        badge.textContent = String(n);
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
