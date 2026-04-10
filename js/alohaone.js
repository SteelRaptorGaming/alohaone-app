// =============================================================================
// AlohaOne App — Shared utilities
// Auth is stubbed with localStorage until shared Cognito pool is wired up.
// =============================================================================

const ALOHAONE_VERSION = '0.1.0';

// --- Auth / User state (localStorage stub) ---

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
 * Stubbed "register" — creates a local user and a token.
 * Replace with a real Cognito/API call when the backend is ready.
 */
function stubRegister({ email, displayName, password }) {
    // In a real app we'd POST to an API. For now, simulate success.
    const user = {
        email,
        displayName: displayName || email.split('@')[0],
        createdAt: new Date().toISOString(),
        plan: 'free',
    };
    setUser(user);
    setToken('stub-' + Math.random().toString(36).slice(2));
    // Initialize empty enabled-platforms list for a fresh account
    if (!localStorage.getItem('ao_enabled_platforms')) {
        localStorage.setItem('ao_enabled_platforms', JSON.stringify([]));
    }
    logActivity('account.registered', { email });
    return user;
}

/**
 * Stubbed "login" — accepts any email/password and creates a session.
 */
function stubLogin({ email, password }) {
    // In a real app, we'd validate credentials server-side.
    let user = getUser();
    if (!user || user.email !== email) {
        user = {
            email,
            displayName: email.split('@')[0],
            createdAt: new Date().toISOString(),
            plan: 'free',
        };
    }
    setUser(user);
    setToken('stub-' + Math.random().toString(36).slice(2));
    logActivity('account.login', { email });
    return user;
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
