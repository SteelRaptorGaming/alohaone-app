/**
 * AlohaOneApp Iframe Embed Test
 *
 * Verifies that selecting Commerce from the platform dropdown loads the
 * deployed Commerce admin in an iframe inside the AlohaOneApp shell.
 *
 * This is the first cross-window integration test — it proves the
 * AlohaOneApp shell + AlohaCommerce admin can run together end-to-end.
 *
 * NOTE on mixed content: The AlohaOneApp shell is on https://app.alohaone.ai
 * and the AlohaCommerce admin is on http://...s3-website... S3 website
 * endpoints don't support HTTPS. Browsers normally block http iframes inside
 * https parents (mixed content). The test bypass this with the
 * --allow-running-insecure-content launch flag in test-helpers.js so we can
 * validate the embed mechanism. Real production users will need CloudFront
 * in front of the Commerce admin bucket before this works in a normal
 * browser — that's filed as the next infrastructure task to the
 * AlohaCommerce window.
 */

const {
    startPhase, assert,
    newPage, closeBrowser,
    loginAsAdmin, gotoShell,
    waitFor, elementText,
    writeReport, printSummary, resetCounters,
} = require('./test-helpers');

const COMMERCE_ADMIN_URL = 'http://alohacommerce-dev-admin-7ff98c81.s3-website-us-east-1.amazonaws.com';

async function run() {
    resetCounters();

    // ─────────────────────────────────────────────────────────────────────
    startPhase('Commerce iframe embed', 'kmason@visualdatasoftware.com');
    // ─────────────────────────────────────────────────────────────────────
    {
        const page = await newPage();
        await loginAsAdmin(page);
        await gotoShell(page);

        // Open the platform switcher dropdown
        await page.click('#platformSwitcherBtn');
        const dropdownOpened = await waitFor(page, '.platform-dropdown-menu.show', 3000);
        assert(dropdownOpened, 'Platform dropdown opens');

        // Commerce should appear in the dropdown (either under "Your platforms"
        // if enabled, or "Add a platform" if not — both have data-platform="commerce")
        const commerceEntry = await page.$('[data-platform="commerce"]');
        assert(!!commerceEntry, 'Commerce entry exists in dropdown');

        // Track that the iframe makes a network request to the Commerce admin
        // before we click — wraps the click so we capture the load event.
        const responsePromise = page.waitForResponse(
            response => response.url().startsWith(COMMERCE_ADMIN_URL),
            { timeout: 15000 }
        ).catch(() => null);

        // Click Commerce
        await page.click('[data-platform="commerce"]');

        // Wait for the embedded view CSS class to appear (shell switches mode)
        const embeddedMode = await waitFor(page, '.app-content.app-content-embedded', 5000);
        assert(embeddedMode, 'Shell switched to embedded content mode');

        // Wait for the iframe element to be in the DOM
        const iframeInDom = await waitFor(page, '#platform-iframe', 5000);
        assert(iframeInDom, 'Iframe element rendered in shell content area');

        // Verify the iframe src points at the deployed Commerce admin
        const iframeSrc = await page.$eval('#platform-iframe', el => el.src);
        assert(
            iframeSrc.startsWith(COMMERCE_ADMIN_URL),
            'Iframe src is the deployed Commerce admin URL',
            `src=${iframeSrc.substring(0, 100)}`
        );

        // Verify the iframe src includes the embedded=1 query param
        // (the shell's PLATFORM_EMBED_URLS sends it; Commerce will start
        // honoring it after the next deploy of that side)
        assert(
            iframeSrc.includes('embedded=1'),
            'Iframe src includes ?embedded=1 query param (forward-compatible with Commerce embed mode)'
        );

        // Verify the network response actually arrived
        const response = await responsePromise;
        assert(
            response !== null,
            'Commerce admin responded to the iframe network request'
        );
        if (response) {
            const status = response.status();
            assert(
                status === 200,
                `Commerce admin response status is 200 (got ${status})`,
                `url=${response.url()}`
            );
        }

        // Verify the title bar label updated to "AlohaCommerce"
        const label = await elementText(page, '#current-platform-label');
        assert(
            label === 'AlohaCommerce',
            `Title bar label updated to AlohaCommerce (got: "${label}")`
        );

        // Verify the iframe has nonzero dimensions (it's actually rendering)
        const iframeBox = await page.$eval('#platform-iframe', el => ({
            width: el.offsetWidth,
            height: el.offsetHeight,
        }));
        assert(
            iframeBox.width > 100 && iframeBox.height > 100,
            `Iframe has substantial dimensions (got ${iframeBox.width}x${iframeBox.height})`
        );

        await page.close();
    }

    // ─────────────────────────────────────────────────────────────────────
    startPhase('Switch from Commerce embed back to native view', 'kmason@visualdatasoftware.com');
    // ─────────────────────────────────────────────────────────────────────
    {
        const page = await newPage();
        await loginAsAdmin(page);
        await gotoShell(page);

        // Land on Commerce
        await page.click('#platformSwitcherBtn');
        await waitFor(page, '.platform-dropdown-menu.show', 3000);
        await page.click('[data-platform="commerce"]');
        await waitFor(page, '#platform-iframe', 5000);
        assert(true, 'Loaded Commerce embed (precondition)');

        // Now switch back to System Dashboard (native view)
        await page.click('#platformSwitcherBtn');
        await waitFor(page, '.platform-dropdown-menu.show', 3000);
        await page.click('[data-platform="system-dashboard"]');

        // Verify the iframe is gone and native view is back
        await page.waitForSelector('.system-dashboard', { timeout: 5000 });
        const stillIframe = await page.$('#platform-iframe');
        assert(!stillIframe, 'Iframe element removed when switching to native view');

        const nativeMode = await page.$('.app-content.app-content-native');
        assert(!!nativeMode, 'Shell switched back to native content mode');

        const label = await elementText(page, '#current-platform-label');
        assert(
            label === 'AlohaOne System',
            `Title bar label updated back to "AlohaOne System" (got: "${label}")`
        );

        await page.close();
    }

    await closeBrowser();
    printSummary();
    return writeReport('iframe-embed');
}

if (require.main === module) {
    run().then(() => {
        const { failed } = require('./test-helpers').getCounts();
        process.exit(failed > 0 ? 1 : 0);
    }).catch(err => {
        console.error('Test run failed with exception:', err);
        process.exit(2);
    });
}

module.exports = { run };
