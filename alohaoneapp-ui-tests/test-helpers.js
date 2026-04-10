/**
 * AlohaOneApp Test Helpers
 *
 * Mirrors the AlohaCommerce test pattern (alohacommerce-ui-tests/) — phases,
 * assertions, and a markdown report generator. Use these helpers in every
 * test file so reports stay consistent.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ── Configuration ────────────────────────────────────────────────────────────

const APP_URL = process.env.APP_URL || 'http://localhost:5500';
const REPORT_DIR = path.resolve(__dirname, '..', 'test-results');
const HEADLESS = process.env.HEADLESS !== 'false';
const SLOW_MO = parseInt(process.env.SLOW_MO || '0', 10);

// ── Test state (shared across phases within a single run) ───────────────────

let passed = 0, failed = 0, skipped = 0;
const results = [];           // [{ phase, persona, tests: [{ num, name, result, detail }] }]
let currentPhase = null;
let testNum = 0;
let browser = null;

// ── Phase / persona management ──────────────────────────────────────────────

function startPhase(name, persona) {
    currentPhase = { name, persona, tests: [] };
    results.push(currentPhase);
    console.log(`\n========== ${name} ==========`);
    if (persona) console.log(`  Persona: ${persona}`);
}

// ── Assertions ──────────────────────────────────────────────────────────────

function assert(condition, name, detail = '') {
    testNum++;
    const result = condition ? 'PASS' : 'FAIL';
    if (condition) passed++; else failed++;
    if (!currentPhase) startPhase('Default phase');
    currentPhase.tests.push({ num: testNum, name, result, detail });
    const icon = condition ? '✓' : '✗';
    console.log(`  ${icon} ${result}: ${name}${detail ? ' | ' + detail.substring(0, 100) : ''}`);
    return condition;
}

function skip(name, detail = '') {
    testNum++;
    skipped++;
    if (!currentPhase) startPhase('Default phase');
    currentPhase.tests.push({ num: testNum, name, result: 'SKIP', detail });
    console.log(`  ○ SKIP: ${name}`);
}

// ── Browser lifecycle ───────────────────────────────────────────────────────

async function getBrowser() {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: HEADLESS,
            slowMo: SLOW_MO,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
            defaultViewport: { width: 1440, height: 900 },
        });
    }
    return browser;
}

async function newPage() {
    const b = await getBrowser();
    const page = await b.newPage();
    page.on('pageerror', err => console.log(`  [page error] ${err.message}`));
    return page;
}

async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
    }
}

// ── Auth helpers (localStorage stub for now; will swap to Cognito later) ────

async function loginAs(page, { email = 'kmason@visualdatasoftware.com', displayName = 'Keith Mason', role = 'admin' } = {}) {
    await page.goto(`${APP_URL}/login.html`);
    await page.evaluate(({ email, displayName, role }) => {
        localStorage.setItem('ao_user', JSON.stringify({
            email, displayName, createdAt: new Date().toISOString(), plan: 'free'
        }));
        localStorage.setItem('ao_token', 'test-token');
        localStorage.setItem('ao_role', role);
    }, { email, displayName, role });
}

async function loginAsAdmin(page) {
    return loginAs(page, { email: 'kmason@visualdatasoftware.com', displayName: 'Keith Mason', role: 'admin' });
}

async function loginAsCustomer(page) {
    return loginAs(page, { email: 'jane@example.com', displayName: 'Jane Doe', role: 'customer' });
}

async function gotoShell(page) {
    await page.goto(`${APP_URL}/index.html`);
    // Wait for the shell to mount the title bar and load the default view
    await page.waitForSelector('.app-titlebar', { timeout: 5000 });
    await page.waitForSelector('.native-view-wrap, .app-content-embedded iframe', { timeout: 5000 });
}

// ── Utilities ───────────────────────────────────────────────────────────────

async function waitFor(page, selector, timeout = 5000) {
    try {
        await page.waitForSelector(selector, { timeout });
        return true;
    } catch {
        return false;
    }
}

async function elementText(page, selector) {
    return page.$eval(selector, el => el.textContent.trim()).catch(() => null);
}

async function elementCount(page, selector) {
    return page.$$eval(selector, els => els.length).catch(() => 0);
}

async function clickAndWait(page, selector, waitForSelector) {
    await page.click(selector);
    if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: 5000 });
    }
}

// ── Report generation ──────────────────────────────────────────────────────

function writeReport(suiteName) {
    if (!fs.existsSync(REPORT_DIR)) {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${suiteName}-${timestamp}.md`;
    const filepath = path.join(REPORT_DIR, filename);

    const total = passed + failed + skipped;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const status = failed === 0 ? 'PASSED' : 'FAILED';

    let md = `# AlohaOneApp Integration Test Report — ${suiteName}\n\n`;
    md += `**Generated:** ${new Date().toISOString()}\n`;
    md += `**App URL:** ${APP_URL}\n`;
    md += `**Status:** **${status}**\n`;
    md += `**Pass rate:** ${passed}/${total} (${passRate}%)\n\n`;
    md += `| Result | Count |\n|---|---|\n`;
    md += `| **PASS** | ${passed} |\n`;
    md += `| **FAIL** | ${failed} |\n`;
    md += `| **SKIP** | ${skipped} |\n\n`;

    md += `## Phases\n\n`;
    results.forEach(phase => {
        md += `### ${phase.name}\n`;
        if (phase.persona) md += `_Persona: ${phase.persona}_\n\n`;
        md += `| # | Test | Result | Detail |\n|---|---|---|---|\n`;
        phase.tests.forEach(t => {
            const detail = (t.detail || '').replace(/\|/g, '\\|').substring(0, 200);
            md += `| ${t.num} | ${t.name} | **${t.result}** | ${detail} |\n`;
        });
        md += `\n`;
    });

    fs.writeFileSync(filepath, md);
    console.log(`\n📄 Report written to ${filepath}`);
    return filepath;
}

function printSummary() {
    const total = passed + failed + skipped;
    console.log(`\n========== SUMMARY ==========`);
    console.log(`  Total:   ${total}`);
    console.log(`  Passed:  ${passed}`);
    console.log(`  Failed:  ${failed}`);
    console.log(`  Skipped: ${skipped}`);
    if (failed === 0) {
        console.log(`\n✅ ALL TESTS PASSED`);
    } else {
        console.log(`\n❌ ${failed} TEST${failed === 1 ? '' : 'S'} FAILED`);
    }
}

function resetCounters() {
    passed = 0; failed = 0; skipped = 0;
    results.length = 0;
    currentPhase = null;
    testNum = 0;
}

module.exports = {
    APP_URL,
    startPhase,
    assert,
    skip,
    getBrowser,
    newPage,
    closeBrowser,
    loginAs,
    loginAsAdmin,
    loginAsCustomer,
    gotoShell,
    waitFor,
    elementText,
    elementCount,
    clickAndWait,
    writeReport,
    printSummary,
    resetCounters,
    getCounts: () => ({ passed, failed, skipped }),
};
