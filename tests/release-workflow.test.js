const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('release upload is gated by the production build and browser checks', () => {
  const workflow = read('.github/workflows/deploy.yml');
  const build = workflow.indexOf('run: npm run build');
  const install = workflow.indexOf('run: npx playwright install --with-deps chromium');
  const browser = workflow.indexOf('run: npm run test:browser');
  const upload = workflow.indexOf('uses: actions/upload-pages-artifact@');
  assert.ok(build >= 0 && build < install && install < browser && browser < upload,
    'build, browser installation and browser tests must succeed before the Pages upload');
  assert.match(workflow, /deploy:\s*\n\s+needs: build/);
  assert.doesNotMatch(workflow, /continue-on-error|always\(\)|if:\s*success\(\)\s*\|\|/);
  assert.equal((workflow.match(/run: npm run build/g) || []).length, 1,
    'upload the tested dist without rebuilding');
});

test('release verifies that browser tests did not replace the uploaded dist', () => {
  const workflow = read('.github/workflows/deploy.yml');
  const snapshot = workflow.indexOf('name: Record tested distribution');
  const browser = workflow.indexOf('run: npm run test:browser');
  const verify = workflow.indexOf('name: Verify tested distribution is unchanged');
  const upload = workflow.indexOf('uses: actions/upload-pages-artifact@');
  assert.ok(snapshot >= 0 && snapshot < browser && browser < verify && verify < upload);
  assert.match(workflow, /diff -u "\$RUNNER_TEMP\/dist-before.sha256" "\$RUNNER_TEMP\/dist-after.sha256"/);
});

test('only the release workflow publishes, with a valid deployment output reference', () => {
  const release = read('.github/workflows/deploy.yml');
  const checks = read('.github/workflows/search-checks.yml');
  assert.match(release, /push:\s*\n\s+branches: \[main, master\]/);
  assert.match(release, /workflow_dispatch:/);
  assert.match(release, /needs: build\s*\n\s+if: github.ref == 'refs\/heads\/main' \|\| github.ref == 'refs\/heads\/master'/);
  assert.doesNotMatch(release, /pull_request:/);
  assert.match(release, /uses: actions\/deploy-pages@v4\s*\n\s+id: deployment/);
  assert.match(release, /url: \$\{\{ steps.deployment.outputs.page_url \}\}/);
  assert.match(checks, /pull_request:\s*\n\s+branches: \[main, master\]/);
  assert.doesNotMatch(checks, /deploy-pages|upload-pages-artifact|pages: write|id-token: write/);
  for (const command of ['npm ci', 'npm audit --audit-level=high', 'npm run build',
    'npx playwright install --with-deps chromium', 'npm run test:browser']) {
    assert.ok(release.includes(`run: ${command}`) && checks.includes(`run: ${command}`), command);
  }
  assert.match(release, /node scripts\/check-release-notes.js/);
  assert.match(release, /Verify no source maps in dist/);
  assert.match(release, /Verify JS is minified/);
});

test('failed or cancelled browser checks retain reports tied to the tested commit', () => {
  for (const file of ['deploy.yml', 'search-checks.yml']) {
    const workflow = read(`.github/workflows/${file}`);
    assert.match(workflow, /uses: actions\/upload-artifact@v4\s*\n\s+if:.*failure\(\).*cancelled\(\)/);
    assert.match(workflow, /name: browser-results-\$\{\{ github.sha \}\}-\$\{\{ github.job \}\}-\$\{\{ github.run_attempt \}\}/);
    assert.match(workflow, /path: \|\s*\n\s+test-results\/\s*\n\s+playwright-report\//);
  }
  const config = read('playwright.config.js');
  assert.match(config, /\['html', \{ open: 'never' \}\]/);
  assert.match(config, /\['json', \{ outputFile: 'test-results\/results.json' \}\]/);
  assert.match(config, /trace: 'retain-on-failure'/);
  assert.match(config, /screenshot: 'only-on-failure'/);
  assert.match(config, /retries: process.env.CI \? 1 : 0/);
});

test('diagnostics also survive failures after the browser checks', () => {
  const workflow = read('.github/workflows/deploy.yml');
  const upload = workflow.indexOf('uses: actions/upload-pages-artifact@');
  const diagnostics = workflow.indexOf('uses: actions/upload-artifact@');
  assert.ok(upload >= 0 && diagnostics > upload,
    'collect diagnostics after all build steps, including distribution verification and upload');
});
