const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const base = new URL(process.argv[2] || 'http://127.0.0.1:8765/');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a loopback test server');
const endpoint = /\/api\/predictions(?:\/([^/]+))?$/;
const jobId = 'mock-job';
const alignment = 'CLUSTAL W\n\nsample_a  A-CG\nsample_b  ATCG\n          * **\n';
const replacement = 'CLUSTAL W\n\nsample_a  AC-G-\nsample_b  ATCG-\n          *  * \n';
const topology = '>seq_1 | TM\nACG\nMMO\n>seq_2 | BETA\nATCG\nIBBO\n';

function isJobRequest(request) {
  return new URL(request.url()).pathname.endsWith('/api/predictions/' + jobId);
}

async function visit(browser, { available = true, poll }) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const api = { requests: [], errors: [], discoveries: 0, polls: 0 };
  page.on('pageerror', (error) => api.errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base.origin) {
      api.errors.push('Unexpected external request to ' + url.origin);
      await route.abort();
      return;
    }

    const match = endpoint.exec(url.pathname);
    if (!match) {
      await route.continue();
      return;
    }
    const method = request.method();
    if (!match[1] && method === 'GET') {
      api.discoveries++;
      await route.fulfill({ json: { available, maxSequences: 20, maxResidues: 20000 } });
    } else if (!match[1] && method === 'POST' && available) {
      api.requests.push(request.postDataJSON());
      await route.fulfill({ status: 202, json: { jobId } });
    } else if (match[1] === jobId && method === 'GET' && available) {
      try {
        await route.fulfill({ json: await poll(++api.polls) });
      } catch (error) {
        // The browser may abort an outstanding poll when the alignment changes.
        if (!page.isClosed() && !request.failure()) api.errors.push(error.message);
      }
    } else {
      api.errors.push(`Unexpected prediction request ${method} ${url.pathname}`);
      await route.fulfill({ status: 400, json: { error: 'Unexpected test request' } });
    }
  });
  const discovery = page.waitForResponse((response) =>
    response.request().method() === 'GET' && endpoint.exec(new URL(response.url()).pathname)?.[0] === '/api/predictions');
  const response = await page.goto(base.href);
  assert.ok(response?.ok(), 'The local app must open');
  await loadAlignment(page, alignment);
  await page.locator('#tmFetchPanel > summary').click();
  await discovery;
  return { page, api };
}

async function loadAlignment(page, text, name = 'prediction-smoke.aln') {
  await page.locator('#file').setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  await page.locator('#filename').filter({ hasText: name }).waitFor();
  await page.locator('#preview [data-alignment-name="sample_a"]').first().waitFor();
}

async function assertStatus(page, pattern) {
  await page.waitForFunction(({ source, flags }) =>
    new RegExp(source, flags).test(document.querySelector('#predictionStatus')?.textContent || ''),
  { source: pattern.source, flags: pattern.flags });
}

async function successfulJob(browser) {
  const { page, api } = await visit(browser, {
    poll: (number) => number === 1 ? { status: 'running' } : { status: 'done', topology },
  });
  try {
    await page.locator('#predictionRun').click();
    const marks = (name) => page.locator(`#preview [data-alignment-name="${name}"] + .aln-track .track-run`);
    const helix = marks('sample_a');
    const beta = marks('sample_b');
    await helix.first().waitFor();
    await beta.first().waitFor();
    assert.equal(await helix.count(), 2, 'The gap interrupts the first sequence’s rendered helix');
    assert.match(await helix.first().getAttribute('aria-label'), /DeepTMHMM 預測.*跨膜螺旋/);
    assert.match(await beta.first().getAttribute('aria-label'), /DeepTMHMM 預測.*跨膜 β 股/);
    assert.ok(api.discoveries > 0);
    assert.ok(api.polls >= 2, 'The frontend must poll again after a running result');
    assert.deepEqual(api.requests, [{ records: [
      { id: 'seq_1', sequence: 'ACG' },
      { id: 'seq_2', sequence: 'ATCG' },
    ] }], 'Submit only ungapped sequences with temporary IDs');
    assert.deepEqual(api.errors, []);
  } finally {
    await page.close();
  }
}

async function failedJob(browser) {
  const error = '模擬預測工作失敗';
  const { page, api } = await visit(browser, { poll: () => ({ status: 'error', error }) });
  try {
    await page.locator('#predictionRun').click();
    await assertStatus(page, /失敗|無法|錯誤/);
    assert.ok(await page.locator('#predictionRun').isEnabled(), 'The user can retry a failed job');
    assert.equal(await page.locator('#preview .track-run').count(), 0);
    assert.equal(api.requests.length, 1);
    assert.equal(api.polls, 1);
    assert.deepEqual(api.errors, []);
  } finally {
    await page.close();
  }
}

async function resultMismatch(browser) {
  const { page, api } = await visit(browser, {
    poll: () => ({ status: 'done', topology: topology.replace('ATCG', 'ACTG') }),
  });
  try {
    await page.locator('#predictionRun').click();
    await assertStatus(page, /不完全相符/);
    assert.equal(await page.locator('#tmInput').inputValue(), '', 'Reject the whole result if one record does not match');
    assert.equal(await page.locator('#preview .track-run').count(), 0);
    assert.deepEqual(api.errors, []);
  } finally {
    await page.close();
  }
}

async function unavailableService(browser) {
  const { page, api } = await visit(browser, { available: false });
  try {
    await assertStatus(page, /未|無法|不可|不能/);
    assert.ok(api.discoveries > 0);
    assert.ok(await page.locator('#predictionRun').isDisabled());
    assert.ok(await page.locator('#tmDeepFile').isVisible(), 'Manual import remains available');
    assert.deepEqual(api.requests, []);
    assert.deepEqual(api.errors, []);
  } finally {
    await page.close();
  }
}

async function replacedAlignment(browser) {
  let finishPoll;
  const heldPoll = new Promise((resolve) => { finishPoll = resolve; });
  const { page, api } = await visit(browser, { poll: () => heldPoll });
  try {
    const pending = page.waitForRequest(isJobRequest);
    await page.locator('#predictionRun').click();
    await pending;
    const settled = page.waitForEvent('requestfinished', isJobRequest);
    const cancelled = page.waitForEvent('requestfailed', isJobRequest);
    const outcome = Promise.any([settled, cancelled]);
    await loadAlignment(page, replacement, 'replacement.aln');
    finishPoll({ status: 'done', topology });
    await outcome;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#preview .track-run').count(), 0, 'A stale job must not annotate a new alignment');
    assert.equal(await page.locator('#tmInput').inputValue(), '');
    assert.equal(api.requests.length, 1);
    assert.deepEqual(api.errors, []);
  } finally {
    finishPoll({ status: 'done', topology });
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    await successfulJob(browser);
    await failedJob(browser);
    await resultMismatch(browser);
    await unavailableService(browser);
    await replacedAlignment(browser);
    console.log('Prediction browser smoke passed with synthetic results and no remote requests.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
