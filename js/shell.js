// =============================================================================
// AlohaOne App — Shell controller
// -----------------------------------------------------------------------------
// Owns the title bar, the platform switcher dropdown, and the content area.
// Swaps the content area between native HTML fragments (home, system dashboard,
// account, billing, activity) and iframes (embedded platforms like Commerce).
// =============================================================================

const Shell = (function() {

    // ── Configuration ──────────────────────────────────────────────────────────

    // Maps platform slug → embed URL. The other window (AlohaCommerce) is
    // implementing ?embedded=1 mode on the relevant pages. For now, slugs
    // without an embed_url show a "Coming soon" placeholder.
    const PLATFORM_EMBED_URLS = {
        // Use the S3 REST endpoint (https) rather than the website endpoint (http)
        // so the iframe isn't blocked by Chrome's mixed-content policy when
        // AlohaOneApp is served over HTTPS. The REST endpoint serves static files
        // from a public bucket; all Commerce admin pages are explicit .html names
        // so we don't need the website endpoint's directory→index.html redirect.
        commerce: 'https://alohacommerce-dev-admin-7ff98c81.s3.us-east-1.amazonaws.com/dashboard.html?embedded=1',
        // Other platforms get added here as their embed support lands.
    };

    // Native views (rendered as HTML fragments fetched from partials/)
    const NATIVE_VIEWS = {
        home:             { fragment: 'partials/home.html',             title: 'Home' },
        'system-dashboard': { fragment: 'partials/system-dashboard.html', title: 'AlohaOne System' },
        account:          { fragment: 'partials/account.html',          title: 'Account Settings' },
        billing:          { fragment: 'partials/billing.html',          title: 'Billing' },
        activity:         { fragment: 'partials/activity.html',         title: 'Activity Log' },
    };

    // ── State ──────────────────────────────────────────────────────────────────

    let currentView = null;          // current view key (e.g. 'home', 'commerce', 'system-dashboard')
    let role = 'customer';           // 'customer' | 'admin' — controls system-dashboard visibility

    // ── Init ───────────────────────────────────────────────────────────────────

    function init() {
        const user = getUser();
        if (!user) return;

        // Read role from localStorage (dev role-switcher) or detect from email
        role = localStorage.getItem('ao_role') || detectRoleFromUser(user);

        renderAccountWidget(user);
        renderPlatformDropdown();
        wireEventHandlers();

        // Default view: System Dashboard for admins, Home for customers
        const defaultView = role === 'admin' ? 'system-dashboard' : 'home';
        loadView(defaultView);
    }

    function detectRoleFromUser(user) {
        // Stub: kmason@... or anything containing "admin" → System Admin
        const email = (user.email || '').toLowerCase();
        if (email.startsWith('kmason@') || email.includes('admin')) return 'admin';
        return 'customer';
    }

    // ── Title bar: account widget ──────────────────────────────────────────────

    function renderAccountWidget(user) {
        const initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();
        document.getElementById('account-avatar').textContent = initial;
        document.getElementById('account-name').textContent = user.displayName || user.email;
        document.getElementById('account-header').innerHTML = `
            <div style="font-weight:600">${user.displayName || user.email}</div>
            <div style="font-size:0.78rem;color:#6c757d">${user.email}</div>
            <div style="font-size:0.7rem;color:#0891b2;margin-top:0.25rem;text-transform:uppercase;letter-spacing:0.05em">
                ${role === 'admin' ? 'System Admin' : 'Customer'}
            </div>
        `;
    }

    // ── Title bar: platform dropdown ───────────────────────────────────────────

    function renderPlatformDropdown() {
        const menu = document.getElementById('platform-dropdown-menu');
        if (!menu) return;

        const enabledSlugs = getEnabledPlatforms();
        const allPlatforms = (typeof PLATFORMS !== 'undefined') ? PLATFORMS : [];
        const enabled = allPlatforms.filter(p => enabledSlugs.includes(p.slug));
        const available = allPlatforms.filter(p => !enabledSlugs.includes(p.slug) && p.status === 'live');
        const coming = allPlatforms.filter(p => p.status === 'coming');

        let html = '';

        // ── System section (admin only) ───
        if (role === 'admin') {
            html += `<h6 class="dropdown-header">System</h6>`;
            html += platformDropdownItem({
                slug: 'system-dashboard',
                name: 'AlohaOne System',
                shortName: 'System',
                icon: 'fa-chart-network',
                color: '#ec4899',
                gradient: 'linear-gradient(135deg,#ec4899,#f97316)',
            }, { label: 'Mission control', native: true });
            html += `<div class="dropdown-divider"></div>`;
        }

        // ── Home tile-grid landing ───
        html += `<h6 class="dropdown-header">Workspace</h6>`;
        html += platformDropdownItem({
            slug: 'home',
            name: 'Home',
            shortName: 'Home',
            icon: 'fa-house',
            color: '#0891b2',
            gradient: 'linear-gradient(135deg,#0891b2,#0e7490)',
        }, { label: 'Your platforms', native: true });
        html += `<div class="dropdown-divider"></div>`;

        // ── Enabled platforms ───
        if (enabled.length > 0) {
            html += `<h6 class="dropdown-header">Your platforms</h6>`;
            enabled.forEach(p => {
                html += platformDropdownItem(p, { label: 'Active' });
            });
            html += `<div class="dropdown-divider"></div>`;
        }

        // ── Available to add ───
        if (available.length > 0) {
            html += `<h6 class="dropdown-header">Add a platform</h6>`;
            available.slice(0, 5).forEach(p => {
                html += platformDropdownItem(p, { label: 'Enable', dimmed: true });
            });
            if (available.length > 5) {
                html += `<a class="dropdown-item text-center" href="#" data-view="home">
                    <small class="text-muted">See all ${allPlatforms.length} platforms</small>
                </a>`;
            }
        }

        menu.innerHTML = html;
    }

    function platformDropdownItem(p, opts = {}) {
        const dimmed = opts.dimmed ? 'opacity-60' : '';
        const native = opts.native ? 'data-native="1"' : '';
        return `
            <a class="dropdown-item platform-dropdown-item ${dimmed}" href="#"
               data-platform="${p.slug}" ${native}>
                <span class="platform-dropdown-icon" style="background:${p.gradient}">
                    <i class="fas ${p.icon}"></i>
                </span>
                <span class="platform-dropdown-text">
                    <strong>${p.name}</strong>
                    <small class="text-muted">${opts.label || ''}</small>
                </span>
            </a>
        `;
    }

    // ── Content area: load views ───────────────────────────────────────────────

    function loadView(viewKey) {
        currentView = viewKey;

        // Native view (HTML fragment)
        if (NATIVE_VIEWS[viewKey]) {
            loadNativeView(viewKey);
            return;
        }

        // Embedded platform (iframe)
        if (PLATFORM_EMBED_URLS[viewKey]) {
            loadEmbeddedView(viewKey);
            return;
        }

        // Unknown view — show placeholder
        loadPlaceholder(viewKey);
    }

    function loadNativeView(viewKey) {
        const view = NATIVE_VIEWS[viewKey];
        const content = document.getElementById('app-content');
        content.classList.add('app-content-native');
        content.classList.remove('app-content-embedded');

        showSpinner('Loading…');
        updateLabel(view.title);

        fetch(view.fragment)
            .then(r => {
                if (!r.ok) throw new Error('Fragment not found: ' + view.fragment);
                return r.text();
            })
            .then(html => {
                content.innerHTML = `<div class="native-view-wrap">${html}</div>`;
                // Run any view-specific init function exposed on window
                const initFnName = 'init' + viewKey.replace(/(^|-)(\w)/g, (_, _2, c) => c.toUpperCase()) + 'View';
                if (typeof window[initFnName] === 'function') {
                    window[initFnName]();
                }
            })
            .catch(err => {
                content.innerHTML = `
                    <div class="native-view-wrap">
                        <div class="alert alert-warning m-4">
                            <strong>Could not load ${view.title}.</strong> ${err.message}
                        </div>
                    </div>`;
            });
    }

    function loadEmbeddedView(slug) {
        const platform = (typeof PLATFORMS !== 'undefined') ? PLATFORMS.find(p => p.slug === slug) : null;
        const baseUrl = PLATFORM_EMBED_URLS[slug];
        const content = document.getElementById('app-content');
        content.classList.remove('app-content-native');
        content.classList.add('app-content-embedded');

        updateLabel(platform ? platform.name : slug);

        // Cross-origin SSO handoff: append the Cognito IdToken as a URL fragment.
        // Fragments aren't sent to the server and don't appear in Referer headers,
        // so this is safer than a query string. The Commerce admin page reads
        // window.location.hash on load, stashes the token in its own localStorage,
        // then strips the fragment via history.replaceState.
        const token = getToken();
        const src = token ? `${baseUrl}#token=${encodeURIComponent(token)}` : baseUrl;

        content.innerHTML = `
            <iframe id="platform-iframe"
                    src="${src}"
                    title="${platform ? platform.name : slug}"
                    frameborder="0"
                    allow="clipboard-read; clipboard-write; fullscreen"></iframe>
        `;

        // postMessage protocol — receive notifications, navigation, dirty-state from the iframe
        window.addEventListener('message', handleEmbeddedMessage);
    }

    function loadPlaceholder(slug) {
        const platform = (typeof PLATFORMS !== 'undefined') ? PLATFORMS.find(p => p.slug === slug) : null;
        const content = document.getElementById('app-content');
        content.classList.add('app-content-native');
        content.classList.remove('app-content-embedded');

        updateLabel(platform ? platform.name : slug);

        const name = platform ? platform.name : slug;
        const tagline = platform ? platform.tagline : '';
        const gradient = platform ? platform.gradient : 'var(--ao-gradient)';
        const icon = platform ? platform.icon : 'fa-cube';

        content.innerHTML = `
            <div class="native-view-wrap">
                <div class="placeholder-view">
                    <div class="placeholder-icon" style="background:${gradient}">
                        <i class="fas ${icon}"></i>
                    </div>
                    <h2>${name}</h2>
                    <p class="lead">${tagline}</p>
                    <div class="placeholder-status">
                        <i class="fas fa-clock me-2"></i>
                        Embed coming soon
                    </div>
                    <p class="text-muted mt-4">
                        ${name} doesn't have its in-shell embed wired up yet.
                        The other window is working on this.
                    </p>
                </div>
            </div>
        `;
    }

    function handleEmbeddedMessage(event) {
        // Trust messages only from configured embed origins (relax in dev)
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        switch (data.type) {
            case 'navigate':
                // Embedded app changed routes — update browser URL hash for deep linking
                if (data.path) {
                    history.replaceState(null, '', `#/${currentView}${data.path}`);
                }
                break;
            case 'notification':
                bumpNotificationBadge();
                break;
            case 'dirty':
                // Track dirty state to warn before navigating away
                window.__embeddedDirty = !!data.dirty;
                break;
        }
    }

    // ── Title bar utilities ────────────────────────────────────────────────────

    function updateLabel(label) {
        const el = document.getElementById('current-platform-label');
        if (el) el.textContent = label;
    }

    function showSpinner(msg) {
        const content = document.getElementById('app-content');
        content.innerHTML = `
            <div class="app-content-loading">
                <i class="fas fa-circle-notch fa-spin"></i>
                <p>${msg || 'Loading…'}</p>
            </div>
        `;
    }

    function bumpNotificationBadge() {
        const el = document.getElementById('notification-count');
        const n = parseInt(el.textContent || '0', 10) + 1;
        el.textContent = n;
        el.style.display = 'inline-block';
    }

    // ── Event wiring ───────────────────────────────────────────────────────────

    function wireEventHandlers() {
        // Brand click → home
        const brand = document.getElementById('brand-home');
        if (brand) brand.addEventListener('click', e => {
            e.preventDefault();
            loadView('home');
        });

        // Platform dropdown items
        document.addEventListener('click', e => {
            const item = e.target.closest('[data-platform]');
            if (item) {
                e.preventDefault();
                const slug = item.dataset.platform;
                loadView(slug);
                // Close any open Bootstrap dropdown
                const dropdown = item.closest('.dropdown-menu');
                if (dropdown) dropdown.classList.remove('show');
                return;
            }

            // Account dropdown views (account / billing / activity)
            const viewItem = e.target.closest('[data-view]');
            if (viewItem) {
                e.preventDefault();
                loadView(viewItem.dataset.view);
                return;
            }

            // Role switcher (dev only)
            const roleItem = e.target.closest('.role-switch');
            if (roleItem) {
                e.preventDefault();
                role = roleItem.dataset.role;
                localStorage.setItem('ao_role', role);
                renderAccountWidget(getUser());
                renderPlatformDropdown();
                loadView(role === 'admin' ? 'system-dashboard' : 'home');
                return;
            }
        });

        // Logout
        const logoutLink = document.getElementById('logout-link');
        if (logoutLink) logoutLink.addEventListener('click', e => {
            e.preventDefault();
            logout();
        });

        // Search button — placeholder for now
        document.getElementById('search-btn').addEventListener('click', () => {
            alert('Federated search coming soon — will search across every enabled platform.');
        });

        // Notifications button — placeholder for now
        document.getElementById('notifications-btn').addEventListener('click', () => {
            alert('Notification center coming soon — aggregates events from every enabled platform.');
        });
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    return {
        init,
        loadView,        // exposed so partial views can navigate via Shell.loadView('commerce')
        getCurrentView: () => currentView,
        getRole: () => role,
    };
})();
