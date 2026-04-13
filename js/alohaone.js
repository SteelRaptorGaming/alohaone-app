// =============================================================================
// AlohaOne App — Shared utilities
// Real auth via the shared Cognito user pool (us-east-1_25nTKMaY4). Login and
// register flows live in login.html / register.html and call Cognito directly;
// this file is just storage + session helpers used by the rest of the shell.
// =============================================================================

const ALOHAONE_VERSION = '0.2.0';

// --- Auth / User state ---
// Two tokens are stashed per session:
//
//   ao_token         — Cognito IdToken (JWT). Used as Authorization: Bearer
//                      for Aloha APIs (Commerce, Backup, future). The shell
//                      passes it to iframe children via #token= handoff.
//
//   ao_access_token  — Cognito AccessToken. Required by Cognito self-service
//                      APIs that operate on the logged-in user's own identity:
//                      ChangePassword, GlobalSignOut, UpdateUserAttributes,
//                      GetUser, DeleteUser. Never used for API auth — our APIs
//                      validate the IdToken's claims (email, sub, name),
//                      which the AccessToken doesn't expose.

function getToken() { return localStorage.getItem('ao_token'); }
function setToken(t) { localStorage.setItem('ao_token', t); }

function getAccessToken() { return localStorage.getItem('ao_access_token'); }
function setAccessToken(t) { localStorage.setItem('ao_access_token', t); }

/**
 * Stash both tokens from a Cognito InitiateAuth / RespondToAuthChallenge
 * response in one call. Used by login.html + register.html so neither has
 * to know about the two-key layout.
 */
function setAuthTokens(authenticationResult) {
    if (!authenticationResult) return;
    if (authenticationResult.IdToken)     setToken(authenticationResult.IdToken);
    if (authenticationResult.AccessToken) setAccessToken(authenticationResult.AccessToken);
}

function getUser() {
    const u = localStorage.getItem('ao_user');
    return u ? JSON.parse(u) : null;
}
function setUser(u) { localStorage.setItem('ao_user', JSON.stringify(u)); }

function clearSession() {
    localStorage.removeItem('ao_token');
    localStorage.removeItem('ao_access_token');
    localStorage.removeItem('ao_user');
    localStorage.removeItem('ao_role');
    localStorage.removeItem('ao_enabled_platforms');
    localStorage.removeItem('ao_enabled_capabilities');
    localStorage.removeItem('ao_intended_tier');
}

/**
 * Sign out. Revokes the Cognito refresh token across all the user's active
 * sessions via GlobalSignOut — any other device the user is signed in on
 * stops being able to refresh. Non-fatal: even if Cognito is unreachable we
 * still clear local state and bounce to login.
 */
async function logout() {
    const cfg = window.ALOHAONE_CONFIG;
    const accessToken = getAccessToken();
    if (cfg && accessToken) {
        try {
            await fetch(cfg.COGNITO_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-amz-json-1.1',
                    'X-Amz-Target': 'AWSCognitoIdentityProviderService.GlobalSignOut'
                },
                body: JSON.stringify({ AccessToken: accessToken })
            });
        } catch (err) {
            console.warn('[logout] GlobalSignOut failed:', err);
        }
    }
    clearSession();
    window.location.href = 'login.html';
}

/**
 * Redirect to login if not authenticated.
 * Preserves the intended destination in ?next= so user lands back where they wanted after login.
 */
function requireAuth() {
    if (!getToken()) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `login.html?next=${next}`;
        return false;
    }
    return true;
}

/**
 * Post-auth dispatch. Called by login.html and register.html after a
 * successful authentication. Handles every meaningful query parameter:
 *
 *   ?next=<url>      — Highest priority. If next is a full URL (http/https),
 *                      hand off cross-origin with #token=<IdToken> so the
 *                      target page can stash it. Same-origin next is a simple
 *                      path redirect.
 *
 *   ?platform=<slug> — Land directly in that platform view in the shell
 *                      instead of the default home. Passed through as
 *                      index.html?platform=<slug> and consumed by shell.js.
 *
 *   ?tier=<code>     — Stashed in localStorage (`ao_intended_tier`) for any
 *                      downstream pricing flow that wants to pre-select.
 *
 *   ?intent=<word>   — Purely informational; ignored at dispatch time. The
 *                      marketing site uses it to tell login/register apart
 *                      but once you're past auth it doesn't matter.
 *
 * Anything else is dropped. If no meaningful params are present, land at
 * the shell home.
 */
function redirectPostAuth() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const platform = params.get('platform');
    const tier = params.get('tier');
    const token = getToken();

    if (tier) {
        localStorage.setItem('ao_intended_tier', tier);
    }

    // 1. Cross-origin next takes precedence — hand off the IdToken via
    // URL fragment (same trick the shell uses for iframe embeds). The
    // target origin's page-load JS is responsible for reading the fragment
    // and stashing it as its own session token.
    if (next && /^https?:\/\//i.test(next)) {
        try {
            const u = new URL(next);
            // Preserve platform/tier in the hand-off URL too, in case the
            // target page wants them.
            if (platform) u.searchParams.set('platform', platform);
            if (tier) u.searchParams.set('tier', tier);
            u.hash = 'token=' + encodeURIComponent(token || '');
            window.location.href = u.toString();
            return;
        } catch (e) {
            console.warn('[redirectPostAuth] bad next URL:', next, e);
        }
    }

    // 2. Same-origin next — relative path, just redirect to it.
    if (next && next.startsWith('/')) {
        window.location.href = next + (platform ? '?platform=' + encodeURIComponent(platform) : '');
        return;
    }

    // 3. Platform specified but no next — land in the shell with the
    // platform as a query so shell.js auto-opens that iframe.
    if (platform) {
        window.location.href = 'index.html?platform=' + encodeURIComponent(platform);
        return;
    }

    // 4. Nothing special — default home.
    window.location.href = 'index.html';
}

/**
 * Post-login provisioning: calls AlohaCommerce's /api/auth/sync cross-origin
 * so a brand-new user gets their organization + default store + StoreAdmin
 * role created in the commerce.* schema. Idempotent server-side (returning
 * users get last_login_at bumped and nothing else).
 *
 * If the response shape says `existing=false`, treat this as a first-ever
 * login and seed the shell's enabled platforms with both Commerce and
 * Backup. Backup auto-provisions its own `backup.accounts` row on the
 * backup API's sync; we just need the shell to *show* the tile.
 *
 * Non-fatal. A failure here shouldn't block the user from entering the shell;
 * worst case they re-hit sync the first time they open the Commerce iframe.
 */
async function provisionCommerce() {
    const cfg = window.ALOHAONE_CONFIG;
    const token = getToken();
    if (!cfg || !token) return;
    try {
        const r = await fetch(cfg.COMMERCE_API_BASE + '/api/auth/sync', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            }
        });
        if (!r.ok) {
            console.warn('[provisionCommerce] non-200:', r.status, await r.text());
            return;
        }
        const body = await r.json().catch(() => null);
        // Brand-new user: pre-seed the shell's platform tiles so they see
        // Commerce AND Backup lit up on first landing, not an empty grid.
        // Both platforms auto-provision their own DB rows, so this is
        // purely a UX affordance — no server-side effect.
        if (body && body.existing === false) {
            enablePlatform('commerce');
            enablePlatform('backup');
        }
    } catch (err) {
        console.warn('[provisionCommerce] failed:', err);
    }
}

// --- Enabled platforms (per-account feature toggles) ---

function getEnabledPlatforms() {
    return JSON.parse(localStorage.getItem('ao_enabled_platforms') || '[]');
}

function isPlatformEnabled(slug) {
    return getEnabledPlatforms().includes(slug);
}

function enablePlatform(slug) {
    const list = getEnabledPlatforms();
    if (!list.includes(slug)) {
        list.push(slug);
        localStorage.setItem('ao_enabled_platforms', JSON.stringify(list));
        logActivity('platform.enabled', { slug });
    }
}

function disablePlatform(slug) {
    const list = getEnabledPlatforms().filter(s => s !== slug);
    localStorage.setItem('ao_enabled_platforms', JSON.stringify(list));
    logActivity('platform.disabled', { slug });
}

// --- Capability toggles (per-platform feature flags) ---

function getEnabledCapabilities(platformSlug) {
    const all = JSON.parse(localStorage.getItem('ao_enabled_capabilities') || '{}');
    return all[platformSlug] || [];
}

function setEnabledCapabilities(platformSlug, caps) {
    const all = JSON.parse(localStorage.getItem('ao_enabled_capabilities') || '{}');
    all[platformSlug] = caps;
    localStorage.setItem('ao_enabled_capabilities', JSON.stringify(all));
}

// --- Activity log (local for now) ---

function logActivity(type, payload = {}) {
    const log = JSON.parse(localStorage.getItem('ao_activity_log') || '[]');
    log.unshift({
        type,
        payload,
        at: new Date().toISOString(),
    });
    // Cap at 200 entries
    if (log.length > 200) log.length = 200;
    localStorage.setItem('ao_activity_log', JSON.stringify(log));
}

function getActivityLog() {
    return JSON.parse(localStorage.getItem('ao_activity_log') || '[]');
}

// --- UI helpers ---

function $(sel)  { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function showAlert(msg, type = 'danger') {
    const el = $('#alert-area');
    if (!el) return;
    el.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
        ${msg}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>`;
}
function showSuccess(msg) { showAlert(msg, 'success'); }
function showError(msg)   { showAlert(msg, 'danger'); }

function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}
function formatDateTime(d) {
    if (!d) return '';
    return new Date(d).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

// --- Query string helpers ---

function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
}

// --- Sidebar / nav init ---

function initAppShell(activePage) {
    // Load sidebar partial into #sidebar-container
    const container = document.getElementById('sidebar-container');
    if (!container) return Promise.resolve();

    return fetch('partials/sidebar.html')
        .then(r => r.text())
        .then(html => {
            container.innerHTML = html;

            // Highlight active nav item
            document.querySelectorAll('.nav-link[data-page]').forEach(el => {
                if (el.dataset.page === activePage) el.classList.add('active');
            });

            // Populate user block
            const user = getUser();
            if (user) {
                const nameEl = document.getElementById('sb-user-name');
                if (nameEl) nameEl.textContent = user.displayName || user.email;
                const emailEl = document.getElementById('sb-user-email');
                if (emailEl) emailEl.textContent = user.email;
            }

            // Wire up logout button
            const logoutBtn = document.getElementById('sb-logout');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', e => {
                    e.preventDefault();
                    logout();
                });
            }
        });
}

// --- Commerce API helper ---
// Cross-origin fetch to AlohaCommerce with the Cognito IdToken attached as
// a bearer. AlohaOneApp lives on a different origin than the Commerce API
// (app.alohaone.ai vs rdadh5e9q2.execute-api...) so we need Authorization
// explicit on every call. AlohaCommerce's CORS is already AllowAnyOrigin
// (see alohacommerce-api Program.cs), so no preflight surprises.
async function commerceFetch(path, init = {}) {
    const cfg = window.ALOHAONE_CONFIG;
    const token = getToken();
    if (!cfg) throw new Error('ALOHAONE_CONFIG not loaded');
    if (!token) throw new Error('Not authenticated');

    const headers = Object.assign({
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
    }, init.headers || {});

    const r = await fetch(cfg.COMMERCE_API_BASE + path, { ...init, headers });
    if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`${r.status} ${r.statusText}: ${text}`);
    }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : r.text();
}

// --- Billing view ---
// Called by the shell after mounting partials/billing.html (via the
// init{View}View naming convention in js/shell.js loadNativeView), and
// also called explicitly from the standalone billing.html page.
//
// Fetches the user's platform subscription from AlohaCommerce's
// /api/billing/status (which returns the Phase D.1 tier breakdown:
// per-tier quantity, totalMonthlyCents, currentPeriodEnd, etc.) and
// populates the DOM elements that partials/billing.html declares.
//
// Handles three states:
//   - No session / fetch error → alert banner with a retry button
//   - status === 'none' (user has never subscribed) → friendly
//     "You're on the free tier" empty state + CTA to enable a paid
//     capability
//   - status present → plan summary, launched-site count, per-tier
//     breakdown, next-invoice date, amount due, and a live Manage
//     button wired to the Stripe Customer Portal session endpoint.
async function initBillingView() {
    const totalEl    = document.getElementById('billing-monthly-total');
    const nextEl     = document.getElementById('billing-next-charge');
    const planEl     = document.getElementById('billing-plan-badge');
    const breakdownEl = document.getElementById('billing-breakdown');
    const manageBtn  = document.getElementById('billing-manage-btn');
    const emptyEl    = document.getElementById('billing-empty-state');
    const errorEl    = document.getElementById('billing-error');

    // Everything is best-effort — the page uses data-* ids on AlohaOneApp's
    // side, so if the partial DOM isn't present we just return. This lets
    // the same function serve both partials/billing.html and the standalone
    // page even if they diverge slightly.
    const set = (el, txt) => { if (el) el.textContent = txt; };
    const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

    try {
        const status = await commerceFetch('/api/billing/status');

        // New user / no subscription yet
        if (!status || status.status === 'none') {
            show(emptyEl, true);
            show(errorEl, false);
            if (breakdownEl) breakdownEl.innerHTML = '';
            set(totalEl, '$0.00');
            set(nextEl, '');
            if (planEl) {
                planEl.textContent = 'Free';
                planEl.className = 'badge bg-secondary fs-6';
            }
            if (manageBtn) {
                manageBtn.disabled = true;
                manageBtn.title = 'Subscribe to a paid plan first.';
            }
            return;
        }

        show(emptyEl, false);
        show(errorEl, false);

        // Plan summary
        const totalDollars = (status.totalMonthlyCents || 0) / 100;
        set(totalEl, formatCurrency(totalDollars));

        // Next invoice
        if (status.currentPeriodEnd) {
            set(nextEl, 'Next charge: ' + formatDate(status.currentPeriodEnd));
        } else {
            set(nextEl, '');
        }

        // Plan badge — show the dominant tier name or the first tier
        if (planEl) {
            const tiers = status.tierBreakdown || [];
            if (tiers.length === 1) {
                planEl.textContent = tiers[0].tierName || tiers[0].TierName || 'Standard';
            } else if (tiers.length > 1) {
                planEl.textContent = `${tiers.length} tiers`;
            } else {
                planEl.textContent = 'Active';
            }
            planEl.className = 'badge bg-success fs-6';
        }

        // Per-tier breakdown table
        if (breakdownEl) {
            const tiers = status.tierBreakdown || [];
            const launched = status.launchedStores || 0;
            if (tiers.length === 0) {
                breakdownEl.innerHTML = `
                    <div class="text-muted small">
                        Subscription is active but no launched stores are on it yet.
                        Publish a store in AlohaCommerce to start being billed.
                    </div>`;
            } else {
                breakdownEl.innerHTML = `
                    <div class="text-muted small mb-2">${launched} launched store${launched === 1 ? '' : 's'}</div>
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th>Tier</th>
                                <th class="text-end">Stores</th>
                                <th class="text-end">Per store</th>
                                <th class="text-end">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tiers.map(t => {
                                const name  = t.tierName || t.TierName || t.tierCode || t.TierCode || '—';
                                const qty   = t.quantity ?? t.Quantity ?? 0;
                                const cents = t.monthlyPriceCents ?? t.MonthlyPriceCents ?? 0;
                                const sub   = (qty * cents) / 100;
                                return `<tr>
                                    <td><strong>${name}</strong></td>
                                    <td class="text-end">${qty}</td>
                                    <td class="text-end">${formatCurrency(cents / 100)}</td>
                                    <td class="text-end"><strong>${formatCurrency(sub)}</strong></td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>`;
            }
        }

        // Invoice history (best-effort — invoices render after status,
        // and a failure here doesn't blow up the rest of the page).
        loadBillingInvoices();

        // Manage button → Stripe Customer Portal via /api/billing/manage
        if (manageBtn) {
            manageBtn.disabled = false;
            manageBtn.onclick = async () => {
                manageBtn.disabled = true;
                const oldLabel = manageBtn.innerHTML;
                manageBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Opening…';
                try {
                    const resp = await commerceFetch('/api/billing/manage', {
                        method: 'POST',
                        body: JSON.stringify({ returnUrl: window.location.href })
                    });
                    if (resp && resp.url) {
                        window.location.href = resp.url;
                    } else {
                        throw new Error('No portal URL returned');
                    }
                } catch (err) {
                    manageBtn.disabled = false;
                    manageBtn.innerHTML = oldLabel;
                    showError('Could not open billing portal: ' + err.message);
                }
            };
        }
    } catch (err) {
        show(emptyEl, false);
        if (errorEl) {
            errorEl.style.display = '';
            errorEl.innerHTML = `
                <strong>Could not load billing.</strong> ${err.message}
                <button class="btn btn-sm btn-outline-danger ms-2" onclick="initBillingView()">Retry</button>`;
        } else {
            showError('Could not load billing: ' + err.message);
        }
    }
}
// Alias so the standalone billing.html's historical name still works.
window.loadBilling = initBillingView;

/**
 * Render the Stripe invoice history into #billing-invoices. Called by
 * initBillingView after the status payload succeeds. Safe to call on its
 * own — bails out silently if the DOM container isn't present, and degrades
 * to a friendly empty state when no invoices exist or when the backend
 * returns an error.
 */
async function loadBillingInvoices() {
    const container = document.getElementById('billing-invoices');
    if (!container) return;

    const statusBadge = (s, paid) => {
        if (paid) return '<span class="badge bg-success">Paid</span>';
        switch (s) {
            case 'open':          return '<span class="badge bg-warning text-dark">Open</span>';
            case 'draft':         return '<span class="badge bg-secondary">Draft</span>';
            case 'uncollectible': return '<span class="badge bg-danger">Uncollectible</span>';
            case 'void':          return '<span class="badge bg-dark">Void</span>';
            case 'paid':          return '<span class="badge bg-success">Paid</span>';
            default:              return `<span class="badge bg-secondary">${s || '—'}</span>`;
        }
    };

    try {
        const invoices = await commerceFetch('/api/billing/invoices?limit=24');
        if (!invoices || invoices.length === 0) {
            container.innerHTML = `
                <div class="empty-state-small text-muted text-center py-4">
                    <i class="fas fa-file-invoice me-2"></i>
                    No invoices yet. Your first one will appear after the next billing cycle.
                </div>`;
            return;
        }

        container.innerHTML = `
            <table class="table table-hover mb-0">
                <thead>
                    <tr>
                        <th style="padding-left:1rem">Date</th>
                        <th>Invoice</th>
                        <th class="text-end">Amount</th>
                        <th>Status</th>
                        <th class="text-end" style="padding-right:1rem">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${invoices.map(inv => {
                        const total    = (inv.amountPaidCents || inv.amountDueCents || 0) / 100;
                        const number   = inv.number || inv.id;
                        const created  = inv.created;
                        const hosted   = inv.hostedInvoiceUrl;
                        const pdf      = inv.invoicePdf;
                        const links    = [];
                        if (hosted) links.push(`<a href="${hosted}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary me-1"><i class="fa-solid fa-eye"></i> View</a>`);
                        if (pdf)    links.push(`<a href="${pdf}"    target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary"><i class="fa-solid fa-file-pdf"></i> PDF</a>`);
                        return `
                            <tr>
                                <td style="padding-left:1rem">${formatDate(created)}</td>
                                <td><code class="small">${number}</code></td>
                                <td class="text-end"><strong>${formatCurrency(total)}</strong></td>
                                <td>${statusBadge(inv.status, inv.paid)}</td>
                                <td class="text-end" style="padding-right:1rem">${links.join('') || '<span class="text-muted small">—</span>'}</td>
                            </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
    } catch (err) {
        container.innerHTML = `
            <div class="empty-state-small text-muted text-center py-4">
                <i class="fas fa-circle-exclamation me-2"></i>
                Could not load invoices: ${err.message}
                <button class="btn btn-sm btn-outline-secondary ms-2" onclick="loadBillingInvoices()">Retry</button>
            </div>`;
    }
}
