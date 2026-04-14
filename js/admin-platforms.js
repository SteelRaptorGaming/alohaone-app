// =============================================================================
// AlohaOne Admin — Platform Catalog
// -----------------------------------------------------------------------------
// Phase E.1. Drives admin-platforms.html. Lists every child platform, lets
// the admin toggle enable/disable, and CRUDs tier pricing per platform.
//
// Endpoint base: AlohaCommerce API (temporary host until AlohaOneApp.Api
// infra ships). Auth: Cognito IdToken via sharedFetch() (server-side
// RequirePlatformAdmin gate).
// =============================================================================

let _catalogState = {
    platforms: [],
    tiersByPlatform: {},
};

async function initAdminPlatformsView() {
    const loadingEl = document.getElementById('catalog-loading');
    const rootEl = document.getElementById('catalog-root');

    try {
        const platforms = await sharedFetch('/api/admin/catalog/platforms');
        _catalogState.platforms = platforms || [];

        // Fetch tiers for every platform in parallel.
        const tierResults = await Promise.all(
            _catalogState.platforms.map(p =>
                sharedFetch(`/api/admin/catalog/platforms/${p.id}/tiers`)
                    .then(tiers => ({ id: p.id, tiers }))
                    .catch(err => ({ id: p.id, tiers: [], error: err.message }))
            )
        );
        _catalogState.tiersByPlatform = {};
        tierResults.forEach(r => { _catalogState.tiersByPlatform[r.id] = r.tiers || []; });

        renderCatalog();
        loadingEl.style.display = 'none';
        rootEl.style.display = '';
    } catch (err) {
        loadingEl.innerHTML = `
            <div class="alert alert-danger">
                <strong>Could not load platform catalog.</strong><br>
                ${err.message}
                <div class="mt-2">
                    <button class="btn btn-sm btn-outline-danger" onclick="initAdminPlatformsView()">Retry</button>
                </div>
                <div class="small text-muted mt-2">
                    If this says "403 Platform admin access required" you're signed in
                    but not in the <code>PlatformAdmin</code> security group.
                </div>
            </div>`;
    }
}

function renderCatalog() {
    const rootEl = document.getElementById('catalog-root');
    if (!rootEl) return;

    const sections = _catalogState.platforms.map(p => renderPlatformSection(p)).join('');
    rootEl.innerHTML = sections;

    // Wire up enable/disable toggles after the DOM is in place.
    _catalogState.platforms.forEach(p => {
        const toggle = document.getElementById(`platform-toggle-${p.id}`);
        if (toggle) toggle.addEventListener('change', e => togglePlatformEnabled(p.id, e.target.checked));
    });
}

function renderPlatformSection(p) {
    const tiers = _catalogState.tiersByPlatform[p.id] || [];
    const disabledClass = p.enabled ? '' : 'platform-disabled';
    const statusBadge = p.enabled
        ? '<span class="badge bg-success">Enabled</span>'
        : '<span class="badge bg-secondary">Disabled</span>';

    const tierRows = tiers.length === 0
        ? `<tr><td colspan="7" class="text-muted text-center py-3">
             No tiers yet. Click <em>Add tier</em> to create one.
           </td></tr>`
        : tiers.map(t => renderTierRow(p.id, t)).join('');

    return `
    <div class="card platform-card mb-4 ${disabledClass}">
        <div class="card-header d-flex align-items-center">
            <div class="platform-icon me-3">
                <i class="${escapeHtml(p.icon || 'fa-solid fa-cube')}"></i>
            </div>
            <div class="flex-grow-1">
                <div class="d-flex align-items-center gap-2 mb-1">
                    <h5 class="mb-0">${escapeHtml(p.name)}</h5>
                    <code class="small text-muted">${escapeHtml(p.code)}</code>
                    ${statusBadge}
                </div>
                <div class="text-muted small">${escapeHtml(p.description || '')}</div>
                <div class="text-muted small mt-1">
                    ${p.active_tier_count} active tier${p.active_tier_count === 1 ? '' : 's'}
                    · ${p.active_subscription_count} active subscription${p.active_subscription_count === 1 ? '' : 's'}
                </div>
            </div>
            <div class="form-check form-switch ms-3">
                <input class="form-check-input platform-toggle"
                       type="checkbox"
                       id="platform-toggle-${p.id}"
                       ${p.enabled ? 'checked' : ''}>
                <label class="form-check-label small text-muted"
                       for="platform-toggle-${p.id}">Enabled</label>
            </div>
        </div>
        <div class="card-body p-0">
            <table class="table mb-0 tier-row">
                <thead class="table-light">
                    <tr>
                        <th style="padding-left:1rem">Code</th>
                        <th>Name</th>
                        <th class="text-end">Monthly</th>
                        <th class="text-end">Stores</th>
                        <th class="text-center">Active</th>
                        <th>Stripe Price</th>
                        <th class="text-end" style="padding-right:1rem"></th>
                    </tr>
                </thead>
                <tbody>${tierRows}</tbody>
            </table>
        </div>
        <div class="card-footer text-end">
            <button class="btn btn-sm btn-primary" onclick="openTierModal(${p.id}, null)">
                <i class="fa-solid fa-plus me-1"></i> Add tier
            </button>
        </div>
    </div>`;
}

function renderTierRow(platformId, t) {
    const dollars = ((t.monthly_price_cents || 0) / 100).toFixed(2);
    const activeBadge = t.is_active
        ? '<i class="fa-solid fa-check text-success"></i>'
        : '<i class="fa-solid fa-xmark text-muted"></i>';
    const stripeId = t.stripe_price_id
        ? `<code>${escapeHtml(t.stripe_price_id)}</code>`
        : '<span class="text-muted small">—</span>';
    const tierJson = escapeHtml(JSON.stringify(t));
    return `
        <tr>
            <td style="padding-left:1rem"><code>${escapeHtml(t.code)}</code></td>
            <td><strong>${escapeHtml(t.name)}</strong>
                ${t.description ? `<div class="small text-muted">${escapeHtml(t.description)}</div>` : ''}</td>
            <td class="text-end">$${dollars}</td>
            <td class="text-end">${t.store_count || 0}</td>
            <td class="text-center">${activeBadge}</td>
            <td>${stripeId}</td>
            <td class="text-end" style="padding-right:1rem">
                <button class="btn btn-sm btn-outline-secondary me-1"
                        data-tier='${tierJson}'
                        onclick='openTierModal(${platformId}, JSON.parse(this.dataset.tier))'>
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger"
                        onclick="archiveTier(${platformId}, ${t.id})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
}

async function togglePlatformEnabled(platformId, enabled) {
    try {
        await sharedFetch(`/api/admin/catalog/platforms/${platformId}/enabled`, {
            method: 'PUT',
            body: JSON.stringify({ enabled })
        });
        const platform = _catalogState.platforms.find(p => p.id === platformId);
        if (platform) platform.enabled = enabled;
        showSuccess(
            `${platform ? platform.name : 'Platform'} ${enabled ? 'enabled' : 'disabled'}. ` +
            `${enabled ? 'Cart/checkout now accepts new signups.' : 'Existing subscribers stay grandfathered.'}`
        );
        renderCatalog();
    } catch (err) {
        showError('Toggle failed: ' + err.message);
        // Re-sync UI from server to avoid state drift.
        initAdminPlatformsView();
    }
}

function openTierModal(platformId, tier) {
    const form       = document.getElementById('tierForm');
    const titleEl    = document.getElementById('tierModalTitle');
    const idEl       = document.getElementById('tier-id');
    const platformEl = document.getElementById('tier-platform-id');
    const codeEl     = document.getElementById('tier-code');
    const nameEl     = document.getElementById('tier-name');
    const descEl     = document.getElementById('tier-description');
    const priceEl    = document.getElementById('tier-price');
    const orderEl    = document.getElementById('tier-display-order');
    const activeEl   = document.getElementById('tier-is-active');
    const saveBtn    = document.getElementById('tier-save-btn');

    if (tier) {
        titleEl.textContent = `Edit tier: ${tier.name}`;
        idEl.value       = tier.id;
        codeEl.value     = tier.code;
        codeEl.disabled  = true;  // immutable after create
        nameEl.value     = tier.name;
        descEl.value     = tier.description || '';
        priceEl.value    = ((tier.monthly_price_cents || 0) / 100).toFixed(2);
        orderEl.value    = tier.display_order || 0;
        activeEl.checked = !!tier.is_active;
    } else {
        titleEl.textContent = 'New tier';
        form.reset();
        idEl.value       = '';
        codeEl.disabled  = false;
        activeEl.checked = true;
        orderEl.value    = 0;
    }
    platformEl.value = platformId;

    saveBtn.onclick = () => saveTier();

    const modal = new bootstrap.Modal(document.getElementById('tierModal'));
    modal.show();
}

async function saveTier() {
    const platformId = document.getElementById('tier-platform-id').value;
    const tierId     = document.getElementById('tier-id').value;
    const code       = document.getElementById('tier-code').value.trim();
    const name       = document.getElementById('tier-name').value.trim();
    const desc       = document.getElementById('tier-description').value.trim();
    const priceStr   = document.getElementById('tier-price').value;
    const order      = parseInt(document.getElementById('tier-display-order').value, 10) || 0;
    const isActive   = document.getElementById('tier-is-active').checked;

    if (!/^[a-z0-9_-]{2,40}$/.test(code)) {
        showError('Code must be lowercase letters, digits, dash or underscore (2–40 chars).');
        return;
    }
    if (!name) { showError('Name is required.'); return; }
    const cents = Math.round(parseFloat(priceStr || '0') * 100);
    if (isNaN(cents) || cents < 0) { showError('Monthly price must be a non-negative number.'); return; }

    const body = {
        code,
        name,
        description: desc,
        monthlyPriceCents: cents,
        featuresJson: '{}',
        isActive,
        displayOrder: order
    };

    const saveBtn = document.getElementById('tier-save-btn');
    saveBtn.disabled = true;
    const oldLabel = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Saving…';

    try {
        if (tierId) {
            await sharedFetch(
                `/api/admin/catalog/platforms/${platformId}/tiers/${tierId}`,
                { method: 'PUT', body: JSON.stringify(body) });
            showSuccess(`Tier "${name}" updated.`);
        } else {
            await sharedFetch(
                `/api/admin/catalog/platforms/${platformId}/tiers`,
                { method: 'POST', body: JSON.stringify(body) });
            showSuccess(`Tier "${name}" created. Stripe Price auto-provisioned.`);
        }
        bootstrap.Modal.getInstance(document.getElementById('tierModal')).hide();
        await initAdminPlatformsView();
    } catch (err) {
        showError('Save failed: ' + err.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = oldLabel;
    }
}

async function archiveTier(platformId, tierId) {
    if (!confirm('Archive this tier? Any stores or active subscriptions still using it will block the archive.')) return;
    try {
        await sharedFetch(
            `/api/admin/catalog/platforms/${platformId}/tiers/${tierId}`,
            { method: 'DELETE' });
        showSuccess('Tier archived.');
        await initAdminPlatformsView();
    } catch (err) {
        showError('Archive failed: ' + err.message);
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
