'use strict';

(() => {
 const button = $('predictionRun');
 const status = $('predictionStatus');
 const regionPrefix = 'DeepTMHMM_TM';
 const proteinPattern = /^[ACDEFGHIKLMNPQRSTVWYX]+$/;
 const pollInterval = 2000;
 const fallbackWaitMs = 16 * 60 * 1000;
 let availability = null;
 let checking = false;
 let activeJob = null;
 let serviceUrl;

 function announce(message, error = false) {
  status.textContent = message;
  status.className = error ? 'error' : 'hint';
 }

 function refreshButton() {
  button.disabled = !availability || !data || !!activeJob;
 }

 function resolveUrl() {
  if (location.protocol === 'file:' && !window.clustalPredictionServiceUrl) return null;
  const url = new URL(window.clustalPredictionServiceUrl || './api/predictions', location.href);
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) {
   throw Error('預測服務網址必須使用 HTTPS。');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  return url;
 }

 async function requestJson(path, options) {
  const response = await fetch(path, {...options, cache:'no-store'});
  const result = await response.json().catch(() => null);
  if (!response.ok) {
   throw Error(typeof result?.error === 'string' ? result.error : '預測服務回傳 HTTP '+response.status+'。');
  }
  if (!result || typeof result !== 'object') throw Error('預測服務回傳的資料格式有誤。');
  return result;
 }

 function showAvailability() {
  refreshButton();
  if (checking) announce('正在檢查 DeepTMHMM 預測服務…');
  else if (!availability) announce('一鍵預測服務目前未連線。仍可在 TM 比較面板匯入 .3line 結果。');
  else if (data) announce('比對檔已就緒，可以開始預測。');
  else announce('請先匯入 .aln 比對檔。');
 }

 async function checkAvailability() {
  checking = true;
  showAvailability();
  try {
   serviceUrl = resolveUrl();
   if (!serviceUrl) return;
   const service = await requestJson(serviceUrl, {signal:AbortSignal.timeout(8000)});
   if (service.available === true && Number.isSafeInteger(service.maxSequences) && service.maxSequences > 0
    && Number.isSafeInteger(service.maxResidues) && service.maxResidues > 0) {
    availability = service;
   }
  } catch {
   availability = null;
  } finally {
   checking = false;
   showAvailability();
  }
 }

 function prepareRecords(dataset) {
  const identifiers = new Map();
  const records = [];
  let residueCount = 0;
  for (const [name, aligned] of dataset.seqs) {
   const sequence = ungapped(aligned);
   if (!sequence) continue;
   if (!proteinPattern.test(sequence)) {
    throw Error('序列「'+name+'」含有預測服務不接受的胺基酸代碼。');
   }
   const id = 'seq_'+(records.length + 1);
   identifiers.set(id, name);
   records.push({id, sequence});
   residueCount += sequence.length;
  }
  if (!records.length) throw Error('比對資料沒有可預測的胺基酸序列。');
  if (records.length > availability.maxSequences || residueCount > availability.maxResidues) {
   throw Error('這次有 '+records.length+' 條序列、'+residueCount+' 個胺基酸。預測服務每次最多接受 '
    +availability.maxSequences+' 條序列、'+availability.maxResidues+' 個胺基酸。');
  }
  return {identifiers, records};
 }

 document.addEventListener('alignmentloaded', () => {
  activeJob?.abort('alignment-changed');
  activeJob = null;
  showAvailability();
 });

 button.addEventListener('click', async () => {
  if (!data || !availability || activeJob) return;
  const dataset = data;
  const controller = new AbortController();
  const signal = controller.signal;
  activeJob = controller;
  refreshButton();
  const wait = availability.waitSeconds;
  const waitMs = Number.isSafeInteger(wait) && wait > 0 && wait <= 6000 ? wait * 1000 : fallbackWaitMs;
  const timeout = setTimeout(() => controller.abort('deadline'), waitMs);
  try {
   const {identifiers, records} = prepareRecords(dataset);
   announce('正在送出 '+records.length+' 條序列…');
   const {jobId} = await requestJson(serviceUrl, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({records}), signal
   });
   if (typeof jobId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(jobId)) {
    throw Error('預測服務沒有回傳有效的工作編號。');
   }
   const jobUrl = new URL(serviceUrl);
   jobUrl.pathname += '/'+jobId;
   while (!signal.aborted) {
    const job = await requestJson(jobUrl, {signal});
    if (job.status === 'error') throw Error(job.error || 'DeepTMHMM 無法完成這次預測。');
    if (job.status === 'done') {
     if (data !== dataset || activeJob !== controller) return;
     if (typeof job.topology !== 'string') throw Error('預測服務未回傳 .3line 結果。');
     const {results, evidence, matchedCount} = deepTmRows(job.topology, dataset, 'DeepTMHMM 一鍵預測', {identifiers, regionPrefix});
     if (matchedCount !== records.length) throw Error('預測結果與送出的序列不完全相符，請再次預測。');
     const detected = [...results.values()].reduce((sum, ranges) => sum + ranges.length, 0);
     const added = applySourceRows(results, 'deeptmhmm', evidence, regionPrefix);
     const previous = detected - added;
     announce(detected
      ? '預測完成。已標註 '+added+' 個跨膜區段。'+(previous ? ' 已保留 '+previous+' 個同名標註。' : '')
      : '預測完成。這批序列沒有預測到跨膜區段。');
     return;
    }
    if (job.status !== 'queued' && job.status !== 'running') throw Error('預測服務回傳的工作狀態有誤。');
    announce(job.status === 'queued' ? '已送出，正在等待預測。' : 'DeepTMHMM 預測中…');
    await new Promise(resolve => setTimeout(resolve, pollInterval));
   }
   if (signal.reason === 'deadline') throw Error('等待預測逾時。');
  } catch (error) {
   if (data !== dataset || activeJob !== controller) return;
   const message = signal.reason === 'deadline' ? '等待預測逾時。'
    : error instanceof TypeError ? '無法連線到預測服務。' : error.message;
   announce(message, true);
  } finally {
   clearTimeout(timeout);
   if (activeJob === controller) {
    activeJob = null;
    refreshButton();
   }
  }
 });

 checkAvailability();
})();
