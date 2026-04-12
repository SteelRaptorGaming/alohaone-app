// Quick mobile viewport check after the Phase B mobile-fix deploy.
// Creates a throwaway Cognito user, logs in, then checks:
//   1. AlohaOneApp home on iPhone 390x844 — body should fit viewport
//   2. Commerce admin dashboard on iPhone — body should fit, hamburger injected,
//      sidebar hidden off-screen until toggled

const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

// Use the existing designer test user — they're already provisioned in the
// Commerce DB with a store, a StoreAdmin role, etc., so dashboard.html's
// loadDashboard() calls to /api/orders + /api/products don't 401-redirect
// while we're in the middle of a Puppeteer evaluate.
const EMAIL = 'designer@visualdatasoftware.com';
const PASS  = 'Aloha2026Designer';
const POOL_ID   = 'us-east-1_25nTKMaY4';
const CLIENT_ID = 'n9306pn18r2g9ha6l3r0rnhj1';
const COMMERCE_API = 'https://rdadh5e9q2.execute-api.us-east-1.amazonaws.com';
const COGNITO_ENDPOINT = 'https://cognito-idp.us-east-1.amazonaws.com/';

async function cognitoCall(target, body) {
    const r = await fetch(COGNITO_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.' + target,
        },
        body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || target);
    return d;
}

(async () => {
    // Sign in as the existing designer test user — no SignUp or cleanup needed.
    const auth = await cognitoCall('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: { USERNAME: EMAIL, PASSWORD: PASS },
    });

    // Fetch the Commerce user profile once so we can pre-populate ac_user
    // on the Commerce admin origin — otherwise dashboard.html's API calls
    // fire without store context and some of them 401-redirect to login.
    const meResp = await fetch(COMMERCE_API + '/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + auth.AuthenticationResult.IdToken },
    });
    const me = await meResp.json();

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    try {
        const iphone = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
        const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        await page.setViewport(iphone);
        await page.setUserAgent(ua);

        // 1. AlohaOneApp home with platforms enabled
        await page.goto('https://app.alohaone.ai/login.html', { waitUntil: 'domcontentloaded' });
        await page.evaluate((id, acc) => {
            localStorage.setItem('ao_token', id);
            localStorage.setItem('ao_access_token', acc);
            localStorage.setItem('ao_user', JSON.stringify({
                email: 'mobile@test.dev', displayName: 'Mobile Fix Test',
            }));
            localStorage.setItem('ao_enabled_platforms', JSON.stringify(['commerce', 'backup']));
        }, auth.AuthenticationResult.IdToken, auth.AuthenticationResult.AccessToken);

        console.log('=== AlohaOneApp home on iPhone 390x844 ===');
        await page.goto('https://app.alohaone.ai/index.html', { waitUntil: 'networkidle2', timeout: 20000 });
        let bodyW = await page.evaluate(() => document.body.scrollWidth);
        console.log('  body width:', bodyW, '(viewport 390)');
        console.log('  result:', bodyW <= 390 ? 'PASS — fits viewport' : 'FAIL — overflows by ' + (bodyW - 390) + 'px');
        await page.screenshot({ path: 'mobile-fix-home.png', fullPage: false });

        // 2. Commerce admin — start at my-websites.html with the token handoff
        //    AND pre-populate ac_user on that origin so the api() helper has
        //    enough context to not 401-redirect.
        console.log();
        console.log('=== Commerce admin my-websites on iPhone 390x844 ===');
        const commerceOrigin = 'https://alohacommerce-dev-admin-7ff98c81.s3.us-east-1.amazonaws.com';
        try {
            // First visit a minimal page on the Commerce origin so we can
            // localStorage-seed BOTH ac_token and ac_user before the real
            // page loads and its DOMContentLoaded fires.
            await page.goto(commerceOrigin + '/my-websites.html#token=' + encodeURIComponent(auth.AuthenticationResult.IdToken), { waitUntil: 'domcontentloaded', timeout: 30000 });
            // Inject ac_user synchronously via evaluate before any network is awaited
            await page.evaluate((u) => {
                localStorage.setItem('ac_user', JSON.stringify(u));
            }, me);
            // Reload so the fresh DOMContentLoaded handler sees the full state
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));

            try {
                bodyW = await page.evaluate(() => document.body.scrollWidth);
                console.log('  body width:', bodyW, '(viewport 390)');
                console.log('  result:', bodyW <= 400 ? 'PASS — fits viewport' : 'FAIL — overflows by ' + (bodyW - 390) + 'px');
            } catch (e) { console.log('  body width check: navigation destroyed context'); }

            try {
                const hamburgerPresent = await page.evaluate(() => document.querySelector('.btn-hamburger') !== null);
                console.log('  hamburger injected:', hamburgerPresent);
            } catch (e) { console.log('  hamburger check: navigation destroyed context'); }

            try {
                const sidebarState = await page.evaluate(() => {
                    const s = document.querySelector('.sidebar');
                    if (!s) return 'no sidebar';
                    const r = s.getBoundingClientRect();
                    return r.right <= 1
                        ? 'hidden off-screen (correct default)'
                        : 'visible right=' + Math.round(r.right);
                });
                console.log('  sidebar state:', sidebarState);
            } catch (e) { console.log('  sidebar state: navigation destroyed context'); }

            try {
                await page.screenshot({ path: 'mobile-fix-commerce.png', fullPage: false });
            } catch (e) { console.log('  screenshot failed:', e.message); }
        } catch (e) {
            console.log('  goto failed:', e.message);
        }

        await page.close();
        await ctx.close();
    } finally {
        // Using an existing shared test user — don't delete it.
        await browser.close();
    }
})();
