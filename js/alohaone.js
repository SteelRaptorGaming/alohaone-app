// =============================================================================
// AlohaOne App — Shared utilities
// Real auth via the shared Cognito user pool (us-east-1_25nTKMaY4). Login and
// register flows live in login.html / register.html and call Cognito directly;
// this file is just storage + session helpers used by the rest of the shell.
// =============================================================================

const ALOHAONE_VERSION = '0.2.0';

// --- Auth / User state (Cognito IdToken in localStorage) ---
// Token is the raw Cognito IdToken (JWT). The shell passes this into Commerce
// iframes via a URL fragment so cross-origin children can authenticate without
// a second login round-trip.

function getToken() { return localStorage.getItem('ao_token'); }
function setToken(t) { localStorage.setItem('ao_token', t); }

function getUser() {
    const u = localStorage.getItem('ao_user');
    return u ? JSON.parse(u) : null;
}
function setUser(u) { localStorage.setItem('ao_user', JSON.stringify(u)); }

function clearSession() {
    localStorage.removeItem('ao_token');
    localStorage.removeItem('ao_user');
    localStorage.removeItem('ao_role');
    localStorage.removeItem('ao_enabled_platforms');
    localStorage.removeItem('ao_enabled_capabilities');
}

function logout() {
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
