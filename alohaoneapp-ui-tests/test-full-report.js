/**
 * AlohaOneApp Full Integration Test Run
 *
 * Runs every test suite in sequence and produces one combined Markdown report.
 * This is the canonical "did it all work" entry point — same role as
 * AlohaCommerce's test-full-report.js.
 *
 * Usage:
 *   node test-full-report.js                  # run against http://localhost:5500
 *   APP_URL=https://app.alohaone.ai node test-full-report.js  # run against deployed
 *   HEADLESS=false node test-full-report.js   # show the browser as it runs
 */

const path = require('path');
const fs = require('fs');
const helpers = require('./test-helpers');

// Suites to run, in order. Each module exports a `run()` function.
const SUITES = [
    { name: 'Shell',           module: './test-shell' },
    { name: 'Iframe embed',    module: './test-iframe-embed' },
    // Add more suites here as they're written:
    // { name: 'Home view',       module: './test-home-view' },
    // { name: 'System dashboard',module: './test-system-dashboard' },
    // { name: 'Account / billing/activity', module: './test-account-billing-activity' },
];

async function runAll() {
    console.log('━'.repeat(60));
    console.log(`AlohaOneApp Full Integration Test`);
    console.log(`URL: ${helpers.APP_URL}`);
    console.log('━'.repeat(60));

    helpers.resetCounters();

    let totalPassed = 0, totalFailed = 0, totalSkipped = 0;
    const allResults = [];

    for (const suite of SUITES) {
        console.log(`\n>> Running suite: ${suite.name}`);
        helpers.resetCounters();
        const mod = require(suite.module);
        try {
            await mod.run();
        } catch (err) {
            console.error(`Suite "${suite.name}" threw:`, err);
        }
        const counts = helpers.getCounts();
        totalPassed += counts.passed;
        totalFailed += counts.failed;
        totalSkipped += counts.skipped;
        allResults.push({ name: suite.name, ...counts });
    }

    await helpers.closeBrowser();

    // Combined summary
    console.log('\n━'.repeat(60));
    console.log('FULL RUN SUMMARY');
    console.log('━'.repeat(60));
    allResults.forEach(r => {
        const pct = (r.passed + r.failed) > 0 ? Math.round((r.passed / (r.passed + r.failed)) * 100) : 0;
        const icon = r.failed === 0 ? '✅' : '❌';
        console.log(`  ${icon} ${r.name.padEnd(20)} ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped (${pct}%)`);
    });
    console.log(`\n  Total: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);

    // Combined report
    const reportDir = path.resolve(__dirname, '..', 'test-results');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filepath = path.join(reportDir, `full-run-${ts}.md`);
    let md = `# AlohaOneApp Full Integration Test Run\n\n`;
    md += `**Generated:** ${new Date().toISOString()}\n`;
    md += `**App URL:** ${helpers.APP_URL}\n`;
    md += `**Status:** **${totalFailed === 0 ? 'PASSED' : 'FAILED'}**\n\n`;
    md += `## Suite results\n\n`;
    md += `| Suite | Passed | Failed | Skipped |\n|---|---|---|---|\n`;
    allResults.forEach(r => {
        md += `| ${r.name} | ${r.passed} | ${r.failed} | ${r.skipped} |\n`;
    });
    md += `\n**Total:** ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped\n`;
    fs.writeFileSync(filepath, md);
    console.log(`\n📄 Full run report: ${filepath}`);

    process.exit(totalFailed === 0 ? 0 : 1);
}

runAll();
