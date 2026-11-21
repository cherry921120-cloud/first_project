const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = pathToFileURL(resolve(__dirname, '../..') + '/');
const localIndex = new URL('index.html', root);
const base = new URL(process.argv[2] || localIndex);
const waitForDeploy = process.argv.includes('--wait-for-deploy');

async function revisionFiles(page) {
  const index = await readFile(localIndex);
  const references = await page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return [...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
      .map((element) => element.getAttribute('src') || element.getAttribute('href'));
  }, index.toString('utf8'));
  const files = [{ url: base, expected: index }];
  for (const reference of new Set(references)) {
    const url = new URL(reference, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) continue;
    const relative = url.pathname.slice(base.pathname.length);
    files.push({ url, expected: await readFile(new URL(relative, root)) });
  }
  return files;
}

async function verifyDeployment(page) {
  assert.equal(base.protocol, 'https:', 'Deployment verification requires an HTTPS Pages URL');
  assert.ok(base.pathname.endsWith('/'), 'Use the Pages site root with a trailing slash');
  const files = await revisionFiles(page);
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastProblem = '';
  let lastLogged = 0;
  do {
    try {
      await Promise.all(files.map(async ({ url, expected }) => {
        const request = new URL(url);
        request.searchParams.set('deployment-check', process.env.GITHUB_SHA || 'manual');
        const response = await fetch(request, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}`);
        if (!expected.equals(Buffer.from(await response.arrayBuffer()))) {
          throw new Error(`${url.pathname} still serves a different revision`);
        }
      }));
      console.log(`Confirmed ${files.length} deployed file(s) match this revision.`);
      return;
    } catch (error) {
      lastProblem = error.message;
      if (Date.now() - lastLogged >= 60000) {
        console.log(`Waiting for GitHub Pages: ${lastProblem}`);
        lastLogged = Date.now();
      }
      await delay(10000);
    }
  } while (Date.now() < deadline);
  throw new Error(`GitHub Pages did not serve this revision at ${base.href}: ${lastProblem}. Check the Pages deployment in Actions.`);
}

async function smoke(page) {
  const pageErrors = [];
  page.on('pageerror', (error) => {
    console.error(error);
    pageErrors.push(error.message);
  });
  const response = await page.goto(base.href, { waitUntil: 'load' });
  if (base.protocol !== 'file:') assert.ok(response?.ok(), `Cannot open ${base.href}: HTTP ${response?.status()}`);
  await page.locator('#demo').click();
  const preview = page.locator('#preview');
  await preview.locator('.aln-line').filter({ hasText: 'avpr1aa' }).first().waitFor();
  const consensus = preview.locator('.aln-cons').first();
  await consensus.waitFor();
  await page.locator('#showCons').uncheck();
  await consensus.waitFor({ state: 'detached' });
  await page.locator('#cols').fill('40');
  await page.waitForFunction(() => document.querySelector('#meta')?.textContent.includes('每排 40 欄'));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportSvg').click(),
  ]);
  assert.match(download.suggestedFilename(), /\.svg$/);
  const svg = await readFile(await download.path(), 'utf8');
  const validSvg = await page.evaluate((markup) => {
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = parsed.documentElement;
    return root.namespaceURI === 'http://www.w3.org/2000/svg'
      && root.localName === 'svg'
      && root.hasAttribute('viewBox')
      && [...root.querySelectorAll('text')].some((node) => node.textContent === 'avpr1aa');
  }, svg);
  assert.ok(validSvg, 'SVG must contain the exported example alignment');

  await page.locator('#file').setInputFiles({
    name: 'invalid.aln',
    mimeType: 'text/plain',
    buffer: Buffer.from('CLUSTAL W\n\nsample_a  A-CG\nsample_b  ATCGAAAA\n'),
  });
  await page.locator('#status.error').waitFor();
  assert.ok(await preview.locator('.aln-line').filter({ hasText: 'avpr1aa' }).first().isVisible(),
    'A failed import must preserve the active alignment');

  await page.locator('#file').setInputFiles({
    name: 'smoke.aln',
    mimeType: 'text/plain',
    buffer: Buffer.from('CLUSTAL W\n\nsample_a  A-CG\nsample_b  ATCG\n          * **\n'),
  });
  await preview.locator('.aln-line').filter({ hasText: 'sample_b' }).first().waitFor();
  await page.locator('#tmFetchPanel > summary').click();
  await page.locator('#tmDeepFile').setInputFiles({
    name: 'predicted_topologies.3line',
    mimeType: 'text/plain',
    buffer: Buffer.from('>sample_a | TM\nACG\nMMO\n>sample_b | BETA\nATCG\nIBBO\n'),
  });
  await page.locator('#tmPending [data-confirm-tm]').click();
  const helix = preview.locator('[data-alignment-name="sample_a"] + .aln-track .track-run');
  const beta = preview.locator('[data-alignment-name="sample_b"] + .aln-track .track-run');
  assert.equal(await helix.count(), 2, 'An alignment gap separates the two visible parts of the helix');
  assert.match(await helix.first().getAttribute('aria-label'), /DeepTMHMM 預測.*跨膜螺旋/);
  assert.match(await beta.getAttribute('aria-label'), /DeepTMHMM 預測.*跨膜 β 股/);
  const betaColor = await beta.evaluate(mark => getComputedStyle(mark).backgroundColor);
  await page.locator('#tmView').selectOption('both');
  await page.getByText('TM 色條外觀', {exact:true}).click();
  await page.locator('#tmRegionAppearance > summary').click();
  await page.locator('#tmRegionChoice').selectOption('sample_a TM1');
  await page.locator('#tmRegionColor').fill('#137e8b');
  assert.equal(await helix.first().evaluate(mark => getComputedStyle(mark).backgroundColor), 'rgb(19, 126, 139)');
  assert.equal(await beta.evaluate(mark => getComputedStyle(mark).backgroundColor), betaColor,
    'A color for one sequence must preserve another sequence’s color for the same TM name');
  await page.locator('#tmStyleTarget').selectOption('consensus');
  await page.locator('#tmShowLabel').check();
  await page.locator('#tmShowTrackLabel').uncheck();
  const consensusTrack = preview.locator('.aln-track').last();
  assert.equal(await consensusTrack.locator('.track-label').textContent(), '');
  assert.equal(await consensusTrack.locator('.track-run-label').textContent(), 'TM1');
  assert.deepEqual(pageErrors, [], 'Browser JavaScript errors');
  console.log(`Browser smoke passed for ${base.href}: demo, display settings, SVG, imports and TM appearance.`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(10000);
    if (waitForDeploy) await verifyDeployment(page);
    await smoke(page);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
