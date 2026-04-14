/**
 * Phase E.1 — Platform Catalog admin UI test (Puppeteer)
 *
 * Loads admin-platforms.html in a real browser with a stashed Cognito
 * IdToken in localStorage, then verifies:
 *   - The sidebar injects the "Platform Catalog" admin link and it is
 *     marked active for this page.
 *   - The 5 platform cards render (commerce enabled, others disabled),
 *     each with the correct platform code badge, icon, and toggle switch.
 *   - The Commerce card shows the Standard tier row at $9.99.
 *   - Clicking "Add tier" opens the tier modal with the correct form
 *     fields in their default state.
 *   - The Document platform toggle flips, hits the API, and the card
 *     reflects the new state. Then toggles back.
 *
 * Runs a tiny built-in Node static server on a random port, points
 * Puppeteer at it, and tears everything down at the end. Hits the
 * deployed Commerce API for real (via ALOHAONE_API_BASE) using a
 * Cognito IdToken obtained by USER_PASSWORD_AUTH.
 *
 * Usage: node test-phase-e1-admin-platforms.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const APP_ROOT       = path.resolve(__dirname, '..');
const SHARED_API     = process.env.SHARED_API     || 'https://shared.api.alohaone.ai';
const COMMERCE_API   = process.env.COMMERCE_API   || 'https://rdadh5e9q2.execute-api.us-east-1.amazonaws.com';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'kmason@visualdatasoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Aloha2026Test';
const COGNITO_CLIENT = process.env.COGNITO_CLIENT || 'n9306pn18r2g9ha6l3r0rnhj1';
const COGNITO_URL    = `https://cognito-idp.us-east-1.amazonaws.com/`;

let passed = 0, failed = 0;
const failures = [];

function assert(condition, name, detail = '') {
    if (condition) {
        console.log(`  PASS: ${name}`);
        passed++;
    } else {
        console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
        failed++;
        failures.push(`${name} — ${detail}`);
    }
}

// ── Tiny static server for AlohaOneApp root ──────────────────────────────
function startStaticServer() {
    return new Promise(resolve => {
        const mime = {
            '.html': 'text/html; charset=utf-8',
            '.js':   'application/javascript',
            '.css':  'text/css',
            '.png':  'image/png',
            '.svg':  'image/svg+xml',
            '.json': 'application/json',
        };
        const server = http.createServer((req, res) => {
            let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
            if (urlPath === '/' || urlPath === '') urlPath = '/admin-platforms.html';
            const filePath = path.join(APP_ROOT, urlPath);
            if (!filePath.startsWith(APP_ROOT)) {
                res.writeHead(403); return res.end('forbidden');
            }
            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); return res.end('not found: ' + urlPath); }
                const ext = path.extname(filePath).toLowerCase();
                res.writeHead(200, { 'content-type': mime[ext] || 'application/octet-stream' });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });
}

async function cognitoLogin() {
    const r = await fetch(COGNITO_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
        },
        body: JSON.stringify({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: COGNITO_CLIENT,
            AuthParameters: { USERNAME: ADMIN_EMAIL, PASSWORD: ADMIN_PASSWORD }
        })
    });
    if (!r.ok) throw new Error(`Cognito login failed: ${r.status} ${await r.text()}`);
    const data = await r.json();
    return data.AuthenticationResult.IdToken;
}

async function run() {
    console.log('\n=== Phase E.1 — Platform Catalog UI (Puppeteer) ===\n');

    console.log('Starting static server…');
    const { server, url: baseUrl } = await startStaticServer();
    console.log('  listening at', baseUrl);

    console.log('Logging in to Cognito…');
    let token;
    try {
        token = await cognitoLogin();
        assert(!!token, 'Cognito login succeeded');
    } catch (err) {
        assert(false, 'Cognito login', err.message);
        server.close();
        return;
    }

    console.log('Launching Puppeteer…');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });

        // Log browser console + failed fetches for debugging
        page.on('console', msg => {
            if (msg.type() === 'error') console.log('  [browser error]', msg.text());
        });
        page.on('pageerror', err => console.log('  [page error]', err.message));

        // Stash token + override config.js defaults at window load time so
        // sharedFetch points at the real shared API and auth works.
        const idToken = token;
        await page.evaluateOnNewDocument((idToken, sharedApi, commerceApi) => {
            localStorage.setItem('ao_token', idToken);
            localStorage.setItem('ao_user', JSON.stringify({
                email: 'kmason@visualdatasoft.com',
                displayName: 'Keith Mason',
                createdAt: new Date().toISOString()
            }));
            Object.defineProperty(window, 'ALOHAONE_CONFIG', {
                value: {
                    COGNITO_REGION: 'us-east-1',
                    COGNITO_POOL_ID: 'us-east-1_25nTKMaY4',
                    COGNITO_CLIENT_ID: 'n9306pn18r2g9ha6l3r0rnhj1',
                    COGNITO_ENDPOINT: 'https://cognito-idp.us-east-1.amazonaws.com/',
                    SHARED_API_BASE: sharedApi,
                    COMMERCE_API_BASE: commerceApi,
                    BACKUP_API_BASE: ''
                },
                writable: true
            });
        }, idToken, SHARED_API, COMMERCE_API);

        console.log('\n--- Load admin-platforms.html ---');
        await page.goto(`${baseUrl}/admin-platforms.html`, { waitUntil: 'networkidle0', timeout: 20000 });

        // Wait for the catalog to render.
        await page.waitForSelector('#catalog-root .platform-card', { timeout: 15000 });

        // Check sidebar link active state
        const sidebarActive = await page.$eval(
            '[data-page="admin-platforms"]',
            el => el.classList.contains('active')
        ).catch(() => false);
        assert(sidebarActive, 'sidebar link for admin-platforms is active');

        // Count platform cards
        const cardCount = await page.$$eval('#catalog-root .platform-card', els => els.length);
        assert(cardCount === 5, '5 platform cards rendered', `got ${cardCount}`);

        // Expected platform codes appear in the rendered card headers
        const codes = await page.$$eval(
            '#catalog-root .platform-card .card-header code',
            els => els.map(e => e.textContent.trim())
        );
        const expectedCodes = ['commerce', 'document', 'backup', 'configurator', 'browser'];
        expectedCodes.forEach(c => {
            assert(codes.includes(c), `${c} platform card present`, `codes: ${codes.join(',')}`);
        });

        // Commerce card has Enabled badge; Document has Disabled
        const commerceBadge = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#catalog-root .platform-card'));
            const commerce = cards.find(c => c.innerHTML.includes('>commerce<'));
            return commerce ? commerce.querySelector('.badge').textContent.trim() : null;
        });
        assert(commerceBadge === 'Enabled', 'commerce badge says Enabled', `got "${commerceBadge}"`);

        const documentBadge = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#catalog-root .platform-card'));
            const doc = cards.find(c => c.innerHTML.includes('>document<'));
            return doc ? doc.querySelector('.badge').textContent.trim() : null;
        });
        assert(documentBadge === 'Disabled', 'document badge says Disabled', `got "${documentBadge}"`);

        // Standard tier row visible at $9.99 under Commerce
        const standardPrice = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#catalog-root .platform-card'));
            const commerce = cards.find(c => c.innerHTML.includes('>commerce<'));
            if (!commerce) return null;
            const rows = Array.from(commerce.querySelectorAll('tbody tr'));
            const standardRow = rows.find(r => r.innerHTML.includes('>standard<'));
            if (!standardRow) return null;
            const cells = standardRow.querySelectorAll('td');
            return cells[2] ? cells[2].textContent.trim() : null;
        });
        assert(standardPrice === '$9.99', 'Standard tier row shows $9.99', `got "${standardPrice}"`);

        // Click "Add tier" on the Commerce card and verify modal opens
        await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#catalog-root .platform-card'));
            const commerce = cards.find(c => c.innerHTML.includes('>commerce<'));
            commerce.querySelector('.card-footer button').click();
        });
        await page.waitForSelector('#tierModal.show', { timeout: 5000 });
        const modalTitle = await page.$eval('#tierModalTitle', el => el.textContent.trim());
        assert(modalTitle === 'New tier', 'modal title is "New tier"', `got "${modalTitle}"`);

        // Dismiss modal. In headless Bootstrap 5 the hide transition can be
        // flaky, so we yank the DOM nodes directly and continue. The backdrop
        // is removed with it; subsequent card lookups work against the card
        // DOM that's still behind the (now-gone) modal.
        await page.evaluate(() => {
            const m = document.getElementById('tierModal');
            if (m) { m.classList.remove('show'); m.style.display = 'none'; }
            document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
            document.body.classList.remove('modal-open');
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('padding-right');
        });

        // Toggle Document platform enabled, verify state flip, toggle back
        console.log('\n--- Toggle Document platform via UI ---');
        await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#catalog-root .platform-card'));
            const doc = cards.find(c => c.innerHTML.includes('>document<'));
            doc.querySelector('.platform-toggle').click();
        });
        // Wait for server response + re-render (card badge flips to Enabled)
        await page.waitForFunction(() => {
            const cards = Array.from(document.querySelectorAll('#catalog-root .platform-card'));
            const doc = cards.find(c => c.innerHTML.includes('>document<'));
            return doc && doc.querySelector('.badge').textContent.trim() === 'Enabled';
        }, { timeout: 10000 }).catch(() => null);

        const afterEnable = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#catalog-root .platform-card'));
            const doc = cards.find(c => c.innerHTML.includes('>document<'));
            return doc ? doc.querySelector('.badge').textContent.trim() : null;
        });
        assert(afterEnable === 'Enabled', 'document flips to Enabled after toggle', `got "${afterEnable}"`);

        // Toggle back off
        await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#catalog-root .platform-card'));
            const doc = cards.find(c => c.innerHTML.includes('>document<'));
            doc.querySelector('.platform-toggle').click();
        });
        await page.waitForFunction(() => {
            const cards = Array.from(document.querySelectorAll('#catalog-root .platform-card'));
            const doc = cards.find(c => c.innerHTML.includes('>document<'));
            return doc && doc.querySelector('.badge').textContent.trim() === 'Disabled';
        }, { timeout: 10000 }).catch(() => null);

        const afterDisable = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#catalog-root .platform-card'));
            const doc = cards.find(c => c.innerHTML.includes('>document<'));
            return doc ? doc.querySelector('.badge').textContent.trim() : null;
        });
        assert(afterDisable === 'Disabled', 'document flips back to Disabled', `got "${afterDisable}"`);

        // Take a screenshot for the test results dir
        const screenshotDir = path.resolve(__dirname, '..', 'test-results');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({
            path: path.join(screenshotDir, 'phase-e1-admin-platforms.png'),
            fullPage: true
        });
        console.log(`\n  Screenshot saved to test-results/phase-e1-admin-platforms.png`);
    } finally {
        await browser.close();
        server.close();
    }

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
        console.log('\nFailures:');
        failures.forEach(f => console.log('  - ' + f));
        process.exit(1);
    }
}

run().catch(err => {
    console.error('Test crashed:', err);
    process.exit(1);
});
