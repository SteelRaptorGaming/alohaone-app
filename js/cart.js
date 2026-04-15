// =============================================================================
// AlohaOne — Cart view (Phase E.2)
// -----------------------------------------------------------------------------
// Drives cart.html. The cart itself is just the array of
// {platformId, tierId, quantity} in localStorage. This view fetches
// /api/catalog to resolve human-readable platform + tier names and prices
// for whatever ids are in the cart, then lets the user change quantities,
// remove lines, and click Checkout to POST the cart to
// /api/checkout/create-session and bounce to Stripe.
// =============================================================================

let _cartCatalog = { platforms: [], tiers: [] };

async function initCartView() {
    const loadingEl = document.getElementById('cart-loading');
    const rootEl    = document.getElementById('cart-root');
    const emptyEl   = document.getElementById('cart-empty');

    try {
        const data = await sharedFetch('/api/catalog');
        _cartCatalog.platforms = data.platforms || [];
        _cartCatalog.tiers     = data.tiers || [];
    } catch (err) {
        loadingEl.innerHTML = `
            <div class="alert alert-danger">
                <strong>Could not load catalog.</strong> ${escapeHtml(err.message)}
                <div class="mt-2">
                    <button class="btn btn-sm btn-outline-danger" onclick="initCartView()">Retry</button>
                </div>
            </div>`;
        return;
    }

    loadingEl.style.display = 'none';
    renderCart();

    document.getElementById('cart-checkout-btn').addEventListener('click', handleCheckout);
    window.addEventListener('ao_cart_changed', renderCart);
}

function renderCart() {
    const rootEl  = document.getElementById('cart-root');
    const emptyEl = document.getElementById('cart-empty');
    const linesEl = document.getElementById('cart-lines');

    const raw = getCart();
    // Drop any line whose (platform, tier) pair is no longer in the catalog —
    // e.g. the admin archived the tier while the user had it in their cart.
    const enriched = raw.map(line => {
        const platform = _cartCatalog.platforms.find(p => p.id === line.platformId);
        const tier     = _cartCatalog.tiers.find(t => t.id === line.tierId && t.platform_id === line.platformId);
        return { ...line, platform, tier };
    }).filter(x => x.platform && x.tier);

    // If any lines were dropped, persist the cleaned-up cart.
    if (enriched.length !== raw.length) {
        setCart(enriched.map(x => ({ platformId: x.platformId, tierId: x.tierId, quantity: x.quantity })));
    }

    if (enriched.length === 0) {
        rootEl.style.display  = 'none';
        emptyEl.style.display = '';
        return;
    }

    rootEl.style.display  = '';
    emptyEl.style.display = 'none';

    linesEl.innerHTML = enriched.map(renderCartLine).join('');

    // Wire up quantity + remove
    linesEl.querySelectorAll('.qty').forEach(input => {
        input.addEventListener('change', e => {
            const pid = parseInt(e.target.dataset.platformId, 10);
            const tid = parseInt(e.target.dataset.tierId, 10);
            const q = parseInt(e.target.value, 10) || 1;
            setCartQuantity(pid, tid, q);
        });
    });
    linesEl.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pid = parseInt(btn.dataset.platformId, 10);
            const tid = parseInt(btn.dataset.tierId, 10);
            removeFromCart(pid, tid);
        });
    });

    // Totals
    const items = enriched.reduce((n, x) => n + (x.quantity || 1), 0);
    const totalCents = enriched.reduce((n, x) => n + (x.tier.monthly_price_cents || 0) * (x.quantity || 1), 0);
    document.getElementById('cart-item-count').textContent = String(items);
    document.getElementById('cart-monthly-total').textContent = formatCurrency(totalCents / 100);
}

function renderCartLine(x) {
    const monthly = ((x.tier.monthly_price_cents || 0) / 100).toFixed(2);
    const subtotal = (((x.tier.monthly_price_cents || 0) * (x.quantity || 1)) / 100).toFixed(2);
    return `
    <div class="cart-line">
        <div>
            <div class="name">${escapeHtml(x.platform.name)} — ${escapeHtml(x.tier.name)}</div>
            <div class="sub">$${monthly}/mo${x.tier.description ? ' · ' + escapeHtml(x.tier.description) : ''}</div>
        </div>
        <input type="number" class="form-control form-control-sm qty"
               min="1" max="99" value="${x.quantity || 1}"
               data-platform-id="${x.platformId}"
               data-tier-id="${x.tierId}">
        <div class="price">$${subtotal}<span class="text-muted small">/mo</span></div>
        <button class="btn btn-sm btn-outline-danger remove-btn"
                data-platform-id="${x.platformId}"
                data-tier-id="${x.tierId}"
                title="Remove">
            <i class="fa-solid fa-trash"></i>
        </button>
    </div>`;
}

async function handleCheckout() {
    const btn = document.getElementById('cart-checkout-btn');
    const cart = getCart();
    if (cart.length === 0) {
        showError('Your cart is empty.');
        return;
    }

    btn.disabled = true;
    const oldLabel = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Redirecting to Stripe…';

    try {
        const resp = await sharedFetch('/api/checkout/create-session', {
            method: 'POST',
            body: JSON.stringify({
                items: cart.map(line => ({
                    platformId: line.platformId,
                    tierId: line.tierId,
                    quantity: line.quantity || 1
                }))
            })
        });
        if (!resp || !resp.url) throw new Error('No checkout URL returned');
        // Stripe handles the rest; the webhook persists subscriptions so
        // we don't clear the cart here — the success page does that.
        window.location.href = resp.url;
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = oldLabel;
        showError('Checkout failed: ' + err.message);
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
