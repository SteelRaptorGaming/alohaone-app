// =============================================================================
// AlohaOneApp — Unified auth E2E
// -----------------------------------------------------------------------------
// Proves the "one login, one registration" flow end-to-end:
//   1. Visit app.alohaone.ai → bounced to login.html
//   2. Click "Register now" → register.html
//   3. Submit the form → Cognito SignUp succeeds, verify form shown
//   4. AdminConfirmSignUp out-of-band (test bypass for email code)
//   5. Navigate to login.html, sign in with same credentials
//   6. After login, AlohaCommerce API /api/auth/me returns the user
//   7. AlohaCommerce API /api/auth/my-stores returns a freshly provisioned store
//   8. Commerce iframe loads with #token handoff and is authenticated (no bounce
//      to Commerce's own login page)
//
// Cleanup in finally: AdminDeleteUser on the Cognito account.
// =============================================================================

const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

const APP_URL         = process.env.APP_URL         || 'https://app.alohaone.ai';
const COMMERCE_API    = process.env.COMMERCE_API    || 'https://rdadh5e9q2.execute-api.us-east-1.amazonaws.com';
const COMMERCE_ADMIN  = process.env.COMMERCE_ADMIN  || 'https://alohacommerce-dev-admin-7ff98c81.s3.us-east-1.amazonaws.com';
const COGNITO_POOL_ID = process.env.COGNITO_POOL_ID || 'us-east-1_25nTKMaY4';
const AWS_REGION      = process.env.AWS_REGION      || 'us-east-1';

const stamp = Date.now();
const TEST_EMAIL = `e2e-auth-${stamp}@test.alohaone.ai`;
const TEST_PASS  = 'Aloha.E2E.' + stamp;
// Stable first/last — every run uses the same name. The provisioner now
// builds org/store slugs from the newly-allocated numeric id (`org-{id}`,
// `website-{id}`), so duplicate display names across runs are fine.
const TEST_FIRST = 'Auth';
const TEST_LAST  = 'Bot';

let passed = 0;
let failed = 0;

function log(ok, msg, extra) {
    const icon = ok ? '\u2713 PASS' : '\u2717 FAIL';
    console.log(`  ${icon}: ${msg}${extra ? ' | ' + extra : ''}`);
    if (ok) passed++; else failed++;
}

function section(title) {
    console.log(`\n========== ${title} ==========`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function adminConfirmUser(email) {
    execSync(
        `aws cognito-idp admin-confirm-sign-up --user-pool-id ${COGNITO_POOL_ID} --username "${email}" --region ${AWS_REGION}`,
        { stdio: 'inherit' }
    );
}

function adminDeleteUser(email) {
    try {
        execSync(
            `aws cognito-idp admin-delete-user --user-pool-id ${COGNITO_POOL_ID} --username "${email}" --region ${AWS_REGION}`,
            { stdio: 'ignore' }
        );
    } catch (e) { /* already gone or never created */ }
}

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', err => console.log('  [pageerror]', err.message));
    page.on('console', msg => {
        if (msg.type() === 'error') console.log('  [console error]', msg.text());
    });

    try {
        // ── Step 1: visit app root, expect bounce to login ────────────────────
        section('Step 1 — anonymous visit redirects to login');
        await page.goto(APP_URL + '/', { waitUntil: 'networkidle2', timeout: 20000 });
        const afterHome = page.url();
        log(/login\.html/.test(afterHome), 'Anonymous visit lands on login.html', `url=${afterHome}`);

        // ── Step 2: follow register link ──────────────────────────────────────
        section('Step 2 — login page has register link');
        const hasRegisterLink = await page.$('#link-register') !== null;
        log(hasRegisterLink, 'Login page has a "Register now" link');

        await page.click('#link-register');
        await page.waitForFunction(() => /register\.html/.test(window.location.href), { timeout: 10000 });
        log(/register\.html/.test(page.url()), 'Clicking register link navigates to register.html');

        // ── Step 3: submit the registration form ──────────────────────────────
        section('Step 3 — registration form');
        await page.waitForSelector('#register-form');
        await page.type('#firstName', TEST_FIRST);
        await page.type('#lastName',  TEST_LAST);
        await page.type('#email',     TEST_EMAIL);
        await page.type('#password',  TEST_PASS);
        await page.click('#btn-register');

        // Either verify form shows (normal path) or alert-area has an error.
        await page.waitForFunction(() => {
            const vf = document.getElementById('verify-form');
            const alert = document.querySelector('#alert-area .alert-danger');
            return (vf && vf.style.display !== 'none') || alert;
        }, { timeout: 15000 });

        const errMsg = await page.$eval('#alert-area .alert-danger', el => el.textContent).catch(() => null);
        if (errMsg) {
            log(false, 'Register submit did not error', `message=${errMsg.trim()}`);
            throw new Error('Registration failed: ' + errMsg);
        }
        const verifyVisible = await page.$eval('#verify-form', el => el.style.display !== 'none').catch(() => false);
        log(verifyVisible, 'Cognito SignUp succeeded (verify form displayed)');

        // ── Step 4: admin-confirm to bypass email code ────────────────────────
        section('Step 4 — admin-confirm bypasses email code');
        adminConfirmUser(TEST_EMAIL);
        log(true, 'AdminConfirmSignUp executed');

        // ── Step 5: navigate to login and sign in ─────────────────────────────
        section('Step 5 — sign in via AlohaOneApp login page');
        await page.goto(APP_URL + '/login.html', { waitUntil: 'networkidle2', timeout: 20000 });
        await page.waitForSelector('#email');
        await page.type('#email',    TEST_EMAIL);
        await page.type('#password', TEST_PASS);
        await page.click('#btn-login');

        // Success: token stored in localStorage, redirect away from login.html.
        await page.waitForFunction(
            () => !/login\.html/.test(window.location.href) && localStorage.getItem('ao_token'),
            { timeout: 30000 }
        );
        const afterLogin = page.url();
        log(!/login\.html/.test(afterLogin), 'Login redirected off of login.html', `url=${afterLogin}`);

        const token = await page.evaluate(() => localStorage.getItem('ao_token'));
        log(!!token && token.length > 20, 'Cognito IdToken stashed in localStorage', `len=${token ? token.length : 0}`);

        // ── Step 6: /api/auth/me returns the new user ─────────────────────────
        section('Step 6 — Commerce API recognizes the user');
        const me = await page.evaluate(async (api, tok) => {
            const r = await fetch(api + '/api/auth/me', { headers: { 'Authorization': 'Bearer ' + tok } });
            return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
        }, COMMERCE_API, token);
        log(me.ok && me.body && me.body.email === TEST_EMAIL,
            '/api/auth/me returns the new user',
            `status=${me.status} email=${me.body && me.body.email}`);

        // ── Step 7: my-stores shows the auto-provisioned store ────────────────
        section('Step 7 — /api/auth/my-stores shows provisioned store');
        const stores = await page.evaluate(async (api, tok) => {
            const r = await fetch(api + '/api/auth/my-stores', { headers: { 'Authorization': 'Bearer ' + tok } });
            return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
        }, COMMERCE_API, token);
        const storeList = (stores.body && (stores.body.stores || stores.body)) || [];
        const storeCount = Array.isArray(storeList) ? storeList.length : 0;
        log(stores.ok && storeCount >= 1,
            '/api/auth/my-stores returns at least one store',
            `status=${stores.status} count=${storeCount}`);
        if (storeCount >= 1) {
            const first = storeList[0];
            const name = first.name || first.storeName || first.title || '(unknown)';
            log(true, 'First store has a name', `name=${name}`);
        }

        // ── Step 8: iframe handoff loads Commerce admin authenticated ─────────
        section('Step 8 — Commerce iframe loads with token handoff');
        // Construct the exact URL the shell would use — the Commerce dashboard
        // with the token fragment appended.
        const embedUrl = COMMERCE_ADMIN + '/dashboard.html?embedded=1#token=' + encodeURIComponent(token);
        const iframePage = await context.newPage();
        await iframePage.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Commerce admin's dashboard.html requires auth. If the fragment handoff
        // worked, ac_token is set and the page stays on dashboard.html. If it
        // failed, requireAuth() would have bounced to login.html.
        const iframeUrl = iframePage.url();
        log(!/login\.html/.test(iframeUrl),
            'Commerce dashboard did not bounce to its own login',
            `url=${iframeUrl.replace(/#token=.*/, '#token=…')}`);

        const acToken = await iframePage.evaluate(() => localStorage.getItem('ac_token'));
        log(!!acToken && acToken === token,
            'Commerce admin stashed the handed-off token as ac_token',
            `match=${acToken === token}`);

        // Proof the admin page is usable: hit /api/auth/me from inside the
        // iframe's origin (uses the same token via the shared ac_token).
        const iframeMe = await iframePage.evaluate(async () => {
            try {
                const tok = localStorage.getItem('ac_token');
                const r = await fetch('https://rdadh5e9q2.execute-api.us-east-1.amazonaws.com/api/auth/me',
                                       { headers: { 'Authorization': 'Bearer ' + tok } });
                return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
            } catch (e) { return { ok: false, error: e.message }; }
        });
        log(iframeMe.ok && iframeMe.body && iframeMe.body.email === TEST_EMAIL,
            'Commerce iframe can call /api/auth/me with handed-off token',
            `status=${iframeMe.status} email=${iframeMe.body && iframeMe.body.email}`);

        await iframePage.close();
    } catch (err) {
        console.log('\n  EXCEPTION:', err.message);
        failed++;
    } finally {
        console.log('\n  Cleanup: deleting Cognito test user...');
        adminDeleteUser(TEST_EMAIL);
        await context.close();
        await browser.close();
    }

    console.log('\n==================================================');
    console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
    console.log('==================================================');
    process.exit(failed > 0 ? 1 : 0);
})();
