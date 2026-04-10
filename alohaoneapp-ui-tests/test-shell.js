/**
 * AlohaOneApp Shell Smoke Test
 *
 * Verifies the title bar, platform dropdown, and content area all render
 * correctly under both customer and admin personas.
 */

const {
    startPhase, assert, skip,
    newPage, closeBrowser,
    loginAsAdmin, loginAsCustomer, gotoShell,
    waitFor, elementText, elementCount, APP_URL,
    writeReport, printSummary, resetCounters,
} = require('./test-helpers');

async function run() {
    resetCounters();

    // ─────────────────────────────────────────────────────────────────────
    startPhase('Shell loads — Customer persona', 'jane@example.com');
    // ─────────────────────────────────────────────────────────────────────
    {
        const page = await newPage();
        await loginAsCustomer(page);
        await gotoShell(page);

        assert(await waitFor(page, '.app-titlebar'), 'Title bar renders');
        assert(await waitFor(page, '.app-brand'), 'AlohaOne brand visible');
        assert(await waitFor(page, '#platformSwitcherBtn'), 'Platform switcher button visible');
        assert(await waitFor(page, '#search-btn'), 'Search button visible');
        assert(await waitFor(page, '#notifications-btn'), 'Notifications button visible');
        assert(await waitFor(page, '#accountBtn'), 'Account button visible');

        // Customer should land on Home, not System Dashboard
        const label = await elementText(page, '#current-platform-label');
        assert(label === 'Home', `Default view is Home (got: "${label}")`);

        assert(await waitFor(page, '.home-view'), 'Home view rendered');
        assert(await waitFor(page, '.home-header h1'), 'Welcome header visible');

        // Customer should NOT see the System Dashboard option in the dropdown
        await page.click('#platformSwitcherBtn');
        await page.waitForSelector('.platform-dropdown-menu', { visible: true, timeout: 3000 }).catch(() => {});
        const hasSystemEntry = await page.$('[data-platform="system-dashboard"]');
        assert(!hasSystemEntry, 'Customer cannot see System Dashboard entry in dropdown');

        await page.close();
    }

    // ─────────────────────────────────────────────────────────────────────
    startPhase('Shell loads — System Admin persona', 'kmason@visualdatasoftware.com');
    // ─────────────────────────────────────────────────────────────────────
    {
        const page = await newPage();
        await loginAsAdmin(page);
        await gotoShell(page);

        assert(await waitFor(page, '.app-titlebar'), 'Title bar renders');

        // Admin should land on System Dashboard, not Home
        const label = await elementText(page, '#current-platform-label');
        assert(label === 'AlohaOne System', `Default view is System Dashboard (got: "${label}")`);

        assert(await waitFor(page, '.system-dashboard'), 'System dashboard rendered');
        assert(await waitFor(page, '.kpi-card'), 'KPI cards visible');
        const kpiCount = await elementCount(page, '.kpi-card');
        assert(kpiCount >= 4, `4 KPI cards rendered (got: ${kpiCount})`);

        // Admin SHOULD see the System Dashboard option in the dropdown
        await page.click('#platformSwitcherBtn');
        await page.waitForSelector('.platform-dropdown-menu', { visible: true, timeout: 3000 }).catch(() => {});
        const hasSystemEntry = await page.$('[data-platform="system-dashboard"]');
        assert(!!hasSystemEntry, 'Admin can see System Dashboard entry in dropdown');

        await page.close();
    }

    // ─────────────────────────────────────────────────────────────────────
    startPhase('Platform dropdown navigation', 'kmason@visualdatasoftware.com');
    // ─────────────────────────────────────────────────────────────────────
    {
        const page = await newPage();
        await loginAsAdmin(page);
        await gotoShell(page);

        // Open dropdown
        await page.click('#platformSwitcherBtn');
        const opened = await waitFor(page, '.platform-dropdown-menu.show', 3000);
        assert(opened, 'Dropdown opens on click');

        // Click "Home" → should switch label and content
        await page.click('[data-platform="home"]');
        await page.waitForSelector('.home-view', { timeout: 3000 });
        const label = await elementText(page, '#current-platform-label');
        assert(label === 'Home', `Label switched to Home (got: "${label}")`);
        assert(await waitFor(page, '.home-view'), 'Home view loaded');

        // Click back to System Dashboard
        await page.click('#platformSwitcherBtn');
        await page.waitForSelector('.platform-dropdown-menu.show', { timeout: 3000 }).catch(() => {});
        await page.click('[data-platform="system-dashboard"]');
        await page.waitForSelector('.system-dashboard', { timeout: 3000 });
        const label2 = await elementText(page, '#current-platform-label');
        assert(label2 === 'AlohaOne System', 'Label switched back to System');

        await page.close();
    }

    // ─────────────────────────────────────────────────────────────────────
    startPhase('Account dropdown views', 'kmason@visualdatasoftware.com');
    // ─────────────────────────────────────────────────────────────────────
    {
        const page = await newPage();
        await loginAsAdmin(page);
        await gotoShell(page);

        // Open account dropdown
        await page.click('#accountBtn');
        await page.waitForSelector('.account-dropdown .dropdown-menu.show', { timeout: 3000 }).catch(() => {});

        // Click "Account Settings"
        await page.click('[data-view="account"]');
        const accountLoaded = await waitFor(page, '.settings-view', 3000);
        assert(accountLoaded, 'Account view loaded');
        const accountTitle = await elementText(page, '.settings-header h1');
        assert(accountTitle && accountTitle.includes('Account Settings'), 'Account header reads "Account Settings"');

        // Switch to Billing
        await page.click('#accountBtn');
        await page.waitForSelector('.account-dropdown .dropdown-menu.show', { timeout: 3000 }).catch(() => {});
        await page.click('[data-view="billing"]');
        const billingLoaded = await waitFor(page, '.billing-amount', 3000);
        assert(billingLoaded, 'Billing view loaded with billing amount widget');

        // Switch to Activity
        await page.click('#accountBtn');
        await page.waitForSelector('.account-dropdown .dropdown-menu.show', { timeout: 3000 }).catch(() => {});
        await page.click('[data-view="activity"]');
        const activityLoaded = await waitFor(page, '#activity-feed-full', 3000);
        assert(activityLoaded, 'Activity view loaded');

        await page.close();
    }

    // ─────────────────────────────────────────────────────────────────────
    startPhase('Role switcher (dev)', 'kmason@visualdatasoftware.com');
    // ─────────────────────────────────────────────────────────────────────
    {
        const page = await newPage();
        await loginAsAdmin(page);
        await gotoShell(page);

        // Default admin should see system dashboard
        assert((await elementText(page, '#current-platform-label')) === 'AlohaOne System',
               'Starts as System Admin');

        // Switch to customer view via account dropdown
        await page.click('#accountBtn');
        await page.waitForSelector('.account-dropdown .dropdown-menu.show', { timeout: 3000 }).catch(() => {});
        await page.click('[data-role="customer"]');

        // Should now be on Home and the dropdown should hide the System entry
        await page.waitForSelector('.home-view', { timeout: 3000 });
        assert((await elementText(page, '#current-platform-label')) === 'Home',
               'Role switch loaded Home view');

        await page.click('#platformSwitcherBtn');
        await page.waitForSelector('.platform-dropdown-menu.show', { timeout: 3000 }).catch(() => {});
        const hasSystemAfterSwitch = await page.$('[data-platform="system-dashboard"]');
        assert(!hasSystemAfterSwitch, 'System Dashboard hidden after role switch to customer');

        // Switch back to admin
        await page.click('#accountBtn');
        await page.waitForSelector('.account-dropdown .dropdown-menu.show', { timeout: 3000 }).catch(() => {});
        await page.click('[data-role="admin"]');
        await page.waitForSelector('.system-dashboard', { timeout: 3000 });
        assert((await elementText(page, '#current-platform-label')) === 'AlohaOne System',
               'Switched back to admin');

        await page.close();
    }

    await closeBrowser();
    printSummary();
    return writeReport('shell-smoke');
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
