/**
 * Phase E.2 — Cart → Stripe Checkout → Success (Puppeteer E2E)
 *
 * Drives the full happy-path cart flow with a real Stripe test-mode
 * checkout submission using test card 4242 4242 4242 4242:
 *
 *   1. Login to Cognito as kmason, stash the IdToken.
 *   2. Load /catalog.html, click "Add" on the Commerce Standard tier.
 *   3. Navigate to /cart.html, verify one line + monthly total, click
 *      "Checkout" and follow the redirect to checkout.stripe.com.
 *   4. Fill out the Stripe hosted checkout page: email (pre-filled), card
 *      4242 4242 4242 4242, exp 12/34, CVC 123, name, ZIP 12345.
 *   5. Submit and wait for the bounce back to
 *      https://app.alohaone.ai/checkout-success.html?session_id=cs_test_...
 *   6. Assert cart was cleared (localStorage ao_cart empty).
 *   7. Call GET /api/me/subscriptions and assert kmason's Commerce row
 *      now carries a real `stripe_subscription_id` starting with `sub_`.
 *
 * This test takes ~60-90 seconds because Stripe's hosted page takes a
 * while to hydrate, and the webhook has to process asynchronously
 * before the DB row picks up the real subscription id. The test retries
 * the subscription-id assertion a few times with backoff to absorb
 * webhook propagation latency.
 *
 * Usage: node test-phase-e2-cart-to-card.js
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
const COGNITO_URL    = 'https://cognito-idp.us-east-1.amazonaws.com/';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail = '') {
    if (cond) { console.log(`  PASS: ${name}`); passed++; }
    else { console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); failed++; failures.push(`${name} — ${detail}`); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
            if (urlPath === '/' || urlPath === '') urlPath = '/catalog.html';
            const filePath = path.join(APP_ROOT, urlPath);
            if (!filePath.startsWith(APP_ROOT)) { res.writeHead(403); return res.end('forbidden'); }
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
        headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        body: JSON.stringify({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: COGNITO_CLIENT,
            AuthParameters: { USERNAME: ADMIN_EMAIL, PASSWORD: ADMIN_PASSWORD }
        })
    });
    if (!r.ok) throw new Error(`Cognito login failed: ${r.status} ${await r.text()}`);
    return (await r.json()).AuthenticationResult.IdToken;
}

async function apiGet(token, path) {
    const r = await fetch(SHARED_API + path, { headers: { Authorization: 'Bearer ' + token } });
    return { status: r.status, ok: r.ok, body: await r.json().catch(() => null) };
}

async function run() {
    console.log('\n=== Phase E.2 — Cart → Stripe → Success (Puppeteer E2E) ===\n');
    console.log('Static server…');
    const { server, url: baseUrl } = await startStaticServer();
    console.log('  listening at', baseUrl);

    console.log('Cognito login…');
    let token;
    try {
        token = await cognitoLogin();
        assert(!!token, 'Cognito login succeeded');
    } catch (err) {
        assert(false, 'Cognito login', err.message);
        server.close();
        process.exit(1);
    }

    console.log('Launching Puppeteer…');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        page.on('pageerror', err => console.log('  [page error]', err.message));
        page.on('console', msg => {
            if (msg.type() === 'error' || msg.type() === 'warning')
                console.log('  [browser ' + msg.type() + ']', msg.text());
        });
        page.on('requestfailed', req => console.log('  [req failed]', req.url(), req.failure()?.errorText));

        await page.evaluateOnNewDocument((idToken, sharedApi, commerceApi) => {
            // This hook fires on EVERY navigation in the page, so it must
            // stay idempotent — no state wipes that would clobber
            // localStorage written by the page between navigations.
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
        }, token, SHARED_API, COMMERCE_API);

        // ── Step 1: Load catalog, add Commerce Standard to cart ──────────
        console.log('\n--- catalog.html: add Commerce Standard to cart ---');
        await page.goto(`${baseUrl}/catalog.html`, { waitUntil: 'networkidle0', timeout: 30000 });
        await page.waitForSelector('.catalog-card', { timeout: 15000 });
        const cardCount = await page.$$eval('.catalog-card', els => els.length);
        assert(cardCount > 0, 'catalog cards rendered', `got ${cardCount}`);

        // Click the first Add button under the Commerce card (platform code "commerce")
        await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('.catalog-card'));
            const commerce = cards.find(c => /AlohaCommerce/i.test(c.querySelector('h5')?.textContent || ''));
            if (!commerce) throw new Error('Commerce card not found');
            const addBtn = commerce.querySelector('.tier-row button');
            if (!addBtn) throw new Error('Add button not found');
            addBtn.click();
        });

        // Wait for cart badge to update (at least 1 item)
        await page.waitForFunction(
            () => JSON.parse(localStorage.getItem('ao_cart') || '[]').length > 0,
            { timeout: 5000 }
        );
        const cartAfterAdd = await page.evaluate(() => JSON.parse(localStorage.getItem('ao_cart') || '[]'));
        assert(cartAfterAdd.length === 1, 'one item in cart after Add', `got ${cartAfterAdd.length}`);

        // ── Step 2: Cart page → Checkout → Stripe ─────────────────────────
        console.log('\n--- cart.html: verify line + click Checkout ---');
        await page.goto(`${baseUrl}/cart.html`, { waitUntil: 'networkidle0', timeout: 30000 });
        try {
            await page.waitForSelector('#cart-root', { visible: true, timeout: 15000 });
        } catch (err) {
            const dbg = await page.evaluate(() => ({
                loading: document.getElementById('cart-loading')?.innerHTML,
                root: document.getElementById('cart-root')?.style.display,
                empty: document.getElementById('cart-empty')?.style.display,
                cart: localStorage.getItem('ao_cart'),
                tok: !!localStorage.getItem('ao_token'),
                alert: document.getElementById('alert-area')?.innerHTML,
            }));
            console.log('  [cart debug]', JSON.stringify(dbg, null, 2));
            throw err;
        }
        const lineCount = await page.$$eval('.cart-line', els => els.length);
        assert(lineCount === 1, 'one cart line rendered', `got ${lineCount}`);
        const totalText = await page.$eval('#cart-monthly-total', el => el.textContent.trim());
        assert(totalText === '$9.99', 'monthly total = $9.99', `got "${totalText}"`);

        // Clicking Checkout triggers an async POST → window.location redirect to Stripe.
        // Stripe's hosted page never goes networkidle (it keeps live connections
        // open), so wait for `load` and then poll the URL for the transition.
        console.log('\n--- navigating to Stripe hosted checkout ---');
        const navPromise = page.waitForNavigation({ waitUntil: 'load', timeout: 60000 });
        await page.click('#cart-checkout-btn');
        try {
            await navPromise;
        } catch (err) {
            console.log('  [nav wait timed out — current url:', page.url(), ']');
            throw err;
        }

        const currentUrl = page.url();
        assert(
            /^https:\/\/checkout\.stripe\.com\//.test(currentUrl),
            'landed on checkout.stripe.com',
            `url=${currentUrl}`
        );

        // ── Step 3: Fill out the Stripe form ─────────────────────────────
        console.log('\n--- filling Stripe hosted checkout form ---');
        // Give Stripe's hosted page time to fully hydrate.
        await sleep(5000);

        // Stripe's modern Checkout page uses a payment-method accordion;
        // the card section has to be expanded before the card inputs
        // appear in the DOM. Click the card radio to make that happen.
        const cardRadio = await page.$('#payment-method-accordion-item-title-card');
        if (cardRadio) {
            await cardRadio.click();
            await sleep(1500);
        }

        // Debug: dump all input selectors + screenshot so we know exactly
        // what the DOM looks like if the assertion below fails.
        const screenshotDir = path.resolve(__dirname, '..', 'test-results');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({
            path: path.join(screenshotDir, 'phase-e2-stripe-landing.png'),
            fullPage: true
        });

        await page.waitForSelector('#cardNumber', { timeout: 30000 });
        await sleep(1500);

        await page.type('#cardNumber', '4242424242424242', { delay: 20 });
        await page.type('#cardExpiry', '1234', { delay: 20 });
        await page.type('#cardCvc', '123', { delay: 20 });

        // Billing name + postal code may or may not be required depending
        // on Stripe account settings — try to fill them if present.
        const nameEl = await page.$('#billingName');
        if (nameEl) await nameEl.type('Keith Mason', { delay: 20 });
        const postalEl = await page.$('#billingPostalCode');
        if (postalEl) await postalEl.type('12345', { delay: 20 });

        // Email: Stripe usually pre-fills it from the customer record, but
        // Link-first Checkout may prompt. Fill if empty.
        const emailEl = await page.$('#email');
        if (emailEl) {
            const cur = await page.$eval('#email', el => el.value);
            if (!cur) await emailEl.type(ADMIN_EMAIL, { delay: 20 });
        }

        // Uncheck Stripe Link's "save my info for faster checkout" — if
        // left checked, submitting triggers a phone-verification modal
        // that stalls the test. We want a plain card-only charge.
        await page.evaluate(() => {
            const box = document.getElementById('enableStripePass');
            if (box && box.checked) box.click();
        });
        await sleep(500);

        // Screenshot the filled form before submitting, for debugging
        await page.screenshot({
            path: path.join(screenshotDir, 'phase-e2-stripe-filled.png'),
            fullPage: true
        });

        console.log('\n--- submitting Stripe checkout ---');
        const afterSubmit = page.waitForNavigation({ waitUntil: 'load', timeout: 120000 });
        // Stripe's Subscribe button doesn't have a stable id. Find it by
        // text via XPath; fall back to type=submit.
        const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const subscribe = buttons.find(b => {
                const txt = (b.textContent || '').trim().toLowerCase();
                return txt === 'subscribe' || txt.startsWith('subscribe');
            });
            if (subscribe) { subscribe.click(); return 'by-text'; }
            const typed = document.querySelector('button[type="submit"]');
            if (typed) { typed.click(); return 'by-type'; }
            return null;
        });
        console.log('  [subscribe click]', clicked);
        if (!clicked) throw new Error('Could not find Subscribe / submit button');
        await afterSubmit;

        const finalUrl = page.url();
        assert(
            /checkout-success\.html/.test(finalUrl),
            'redirected back to checkout-success.html',
            `url=${finalUrl}`
        );
        assert(
            /session_id=cs_test_/.test(finalUrl),
            'success URL carries a cs_test_ session_id',
            `url=${finalUrl}`
        );

        // ── Step 4: Success page cleared the cart ────────────────────────
        // Give the success page's inline JS a moment to run.
        await sleep(500);
        const cartAfterSuccess = await page.evaluate(() => JSON.parse(localStorage.getItem('ao_cart') || '[]'));
        assert(cartAfterSuccess.length === 0, 'cart cleared after success', `got ${cartAfterSuccess.length}`);

        await page.screenshot({
            path: path.join(screenshotDir, 'phase-e2-success.png'),
            fullPage: true
        });

        // ── Step 5: Subscription row now has a real Stripe id ───────────
        // Webhook runs async — poll for up to 60 seconds. Stripe's own
        // retry cadence is sub-second initially, so this is plenty.
        console.log('\n--- polling /api/me/subscriptions for real stripe_subscription_id ---');
        let stripeSubId = null;
        for (let attempt = 0; attempt < 30; attempt++) {
            const r = await apiGet(token, '/api/me/subscriptions');
            const subs = (r.body && r.body.subscriptions) || [];
            const commerce = subs.find(s => s.platform_code === 'commerce');
            if (commerce && commerce.stripe_subscription_id && String(commerce.stripe_subscription_id).startsWith('sub_')) {
                stripeSubId = commerce.stripe_subscription_id;
                break;
            }
            await sleep(2000);
        }
        if (stripeSubId !== null) {
            assert(true, 'kmason Commerce row now has a real stripe_subscription_id');
        } else {
            // The cart→Stripe→success UI flow worked (previous assertions
            // prove Stripe actually created the subscription). If the DB
            // row never picked up the real id, the webhook endpoint
            // registered in the Stripe dashboard is almost certainly not
            // pointed at https://shared.api.alohaone.ai/api/billing/webhook.
            // Surface this as a failure with a diagnostic hint so whoever
            // is running the test knows exactly what to check.
            assert(
                false,
                'kmason Commerce row now has a real stripe_subscription_id',
                'webhook did not propagate within 60s. Verify the Stripe dashboard webhook endpoint URL matches https://shared.api.alohaone.ai/api/billing/webhook and CloudWatch /aws/lambda/alohaoneapp-dev-api shows incoming POSTs.'
            );
        }
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

run().catch(err => { console.error('Test crashed:', err); process.exit(1); });
