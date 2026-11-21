'use strict';

const tmAnnotationSources = new Map();
const tmRegionColors = {individual: new Map(), consensus: new Map()};
const tmAnnotationSourceLabels = new Map([
 ['manual', '手動標註'], ['uniprot', 'UniProt'], ['deeptmhmm', 'DeepTMHMM']
]);
const tmAnnotationStatusLabels = new Map([
 ['manual', '手動標註'], ['as_imported', '與來源一致'], ['manually_changed', '座標已修改'],
 ['declared', '僅有來源標籤'], ['pending', '待核對'], ['invalid', '有錯誤']
]);
const tmAnnotationColumns = ['sequence_id', 'region', 'start', 'end', 'source'];
const tmAnnotationFields = ['sequenceId', 'region', 'start', 'end', 'source'];
const tmAnnotationSelection = new Set();
let tmAnnotationEditor = null;
let tmAnnotationImportRequest = 0;

function tmAnnotationKey(sequenceId, region) {
 return sequenceId + ' ' + region;
}

function individualTmColor(sequenceId, region, defaultColor) {
 return tmRegionColors.individual.get(tmAnnotationKey(sequenceId, region))
  ?? tmRegionColors.individual.get(region)
  ?? tmGeneAppearance.get(sequenceId)?.color
  ?? defaultColor;
}

function renderTmRegionColors() {
 if (!$('tmRegionAppearance').open) return;
 const choice = $('tmRegionChoice');
 const previous = choice.value;
 const mode = $('tmStyleTarget').value;
 const rows = data ? parseTmAnnotations(data).filter(row => !row.problem) : [];
 const regions = new Set(rows.map(row => row.region));
 if (mode === 'consensus' && data) {
  for (const name of readTmConsensusOverrides(data.total).rangesByRegion.keys()) regions.add(name);
 }
 choice.replaceChildren(new Option(regions.size ? '選擇區段' : '尚無可設定的區段', ''));
 choice.disabled = !regions.size;
 if (mode === 'consensus') {
  for (const region of regions) choice.add(new Option(region, region));
 } else if (regions.size) {
  const shared = document.createElement('optgroup');
  shared.label = '同名 TM（所有序列）';
  for (const region of regions) shared.append(new Option(region, region));
  const individual = document.createElement('optgroup');
  individual.label = '只調整指定序列';
  for (const {sequenceId, region, key} of rows) {
   individual.append(new Option(sequenceId + ' · ' + region, key));
  }
  choice.append(shared, individual);
 }
 if ([...choice.options].some(option => option.value === previous)) choice.value = previous;
 syncTmRegionColorInput();
}

function syncTmRegionColorInput() {
 if (!$('tmRegionAppearance').open) return;
 const mode = $('tmStyleTarget').value;
 const key = $('tmRegionChoice').value;
 const overrides = tmRegionColors[mode];
 const input = $('tmRegionColor');
 input.disabled = !key;
 $('tmRegionColorReset').disabled = !key || !overrides.has(key);
 const defaultColor = tmStyle(mode).color;
 const [first, region] = key.split(' ', 2);
 input.value = mode === 'individual' && region
  ? individualTmColor(first, region, defaultColor)
  : overrides.get(key) ?? defaultColor;
}

function changeTmRegionColor(color) {
 const key = $('tmRegionChoice').value;
 if (!key) return;
 const mode = $('tmStyleTarget').value;
 const overrides = tmRegionColors[mode];
 if (color) overrides.set(key, color);
 else overrides.delete(key);
 syncTmRegionColorInput();
 render();
 document.dispatchEvent(new CustomEvent('projectchange', {detail: {target: color ? mode+':'+key : null}}));
}

function tmAnnotationProblem(dataset, fields, lengths = new Map()) {
 const [sequenceId, region, start, end] = fields;
 if (!dataset.seqs.has(sequenceId)) return '序列 ID 「' + sequenceId + '」不存在。';
 if (!region || /\s/.test(region)) return '區段名稱必填，且不可包含空白。';
 if (![start, end].every(value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)))) {
  return '起點與終點必須為正整數。';
 }
 if (!lengths.has(sequenceId)) lengths.set(sequenceId, ungapped(dataset.seqs.get(sequenceId)).length);
 const length = lengths.get(sequenceId);
 if (Number(start) < 1 || Number(end) < Number(start) || Number(end) > length) {
  return '起點與終點須依序落在 1–' + length + ' 之內。';
 }
 return '';
}

function parseTmAnnotations(dataset, text = $('tmInput').value) {
 const lengths = new Map();
 const rows = [];
 for (const [index, line] of text.split(/\r?\n/).entries()) {
  if (!line.trim()) continue;
  const fields = line.trim().split(/\s+/);
  const [sequenceId = '', region = '', start = '', end = ''] = fields;
  const key = tmAnnotationKey(sequenceId, region);
  const problem = fields.length !== 4 ? '需要序列 ID、區段、起點與終點四個欄位。'
   : tmAnnotationProblem(dataset, fields, lengths);
  rows.push({index, key, sequenceId, region, start, end, problem});
 }
 const keyCounts = new Map();
 for (const {key} of rows) keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
 for (const row of rows) {
  if (!row.problem && keyCounts.get(row.key) > 1) row.problem = '同一序列的區段名稱重複。';
 }
 return rows;
}

function tmAnnotationSource(key) {
 return tmAnnotationSources.get(key) || tmEvidence.get(key)?.source?.toLowerCase() || 'manual';
}

function tmAnnotationState(row) {
 if (row.problem) return 'invalid';
 const source = tmAnnotationSource(row.key);
 const evidence = tmEvidence.get(row.key);
 if (evidence?.source?.toLowerCase() !== source) return source === 'manual' ? 'manual' : 'declared';
 return evidence.originalResidues[0] === Number(row.start) && evidence.originalResidues[1] === Number(row.end)
  ? 'as_imported' : 'manually_changed';
}

function tmAnnotationOption(value, text, current) {
 return '<option value="' + escapeHTML(value) + '"' + (value === current ? ' selected' : '') + '>'
  + escapeHTML(text) + '</option>';
}

function tmAnnotationRowEditor(fields, problem = '') {
 const [sequenceId, region, start, end, source] = fields;
 const names = [...data.seqs.keys()];
 if (!data.seqs.has(sequenceId)) names.unshift(sequenceId);
 return '<tr class="tm-annotation-editor"><td colspan="7"><form id="tmAnnotationForm" novalidate data-index="' + tmAnnotationEditor + '">'
  + '<div class="tm-style-grid">'
  + '<label>序列<select name="sequenceId">' + names.map(name => tmAnnotationOption(name, name, sequenceId)).join('') + '</select></label>'
  + '<label>區段<input name="region" type="text" value="' + escapeHTML(region) + '" required></label>'
  + '<label>起點<input name="start" inputmode="numeric" value="' + escapeHTML(start) + '" required></label>'
  + '<label>終點<input name="end" inputmode="numeric" value="' + escapeHTML(end) + '" required></label>'
  + '<label>來源<select name="source">'
  + [...tmAnnotationSourceLabels].map(([value, text]) => tmAnnotationOption(value, text, source)).join('')
  + '</select></label>'
  + '</div><p id="tmAnnotationRowError" class="error" role="alert">' + escapeHTML(problem) + '</p>'
  + '<div class="buttons"><button type="submit">儲存此列</button>'
  + '<button type="button" class="secondary" data-tm-cancel>取消</button></div></form></td></tr>';
}

function renderTmAnnotationTable() {
 const panel = $('tmAnnotationTable');
 const rows = data ? parseTmAnnotations(data) : [];
 $('tmAddAnnotation').disabled = !data;
 $('tmReadAnnotations').disabled = !data;
 for (const id of ['tmExportCsv', 'tmExportTsv']) $(id).disabled = !rows.length;
 if (!data) {
  panel.textContent = '請先匯入比對檔案。';
  return;
 }
 if (!panel.closest('details').open) return;
 const form = $('tmAnnotationForm');
 const draft = tmAnnotationEditor !== null && form?.dataset.index === String(tmAnnotationEditor)
  ? tmAnnotationFields.map(name => form.elements[name].value) : null;
 const draftProblem = draft ? $('tmAnnotationRowError').textContent : '';
 const filterSource = $('tmAnnotationSource').value;
 const filterStatus = $('tmAnnotationStatus').value;
 const matches = (source, status) => (!filterSource || filterSource === source) && (!filterStatus || filterStatus === status);
 const rowMarkup = rows.map(row => {
  const source = tmAnnotationSource(row.key);
  const status = tmAnnotationState(row);
  if (tmAnnotationEditor === row.index) {
   return tmAnnotationRowEditor(draft || [row.sequenceId,row.region,row.start,row.end,source], draftProblem || row.problem);
  }
  if (!matches(source, status)) return '';
  const cells = [row.sequenceId,row.region,row.start,row.end,tmAnnotationSourceLabels.get(source) || source];
  const problem = row.problem ? '<span class="error">' + escapeHTML(row.problem) + '</span>' : tmAnnotationStatusLabels.get(status);
  return '<tr data-tm-row="' + escapeHTML(row.key) + '">'
   + cells.map(value => '<td>' + escapeHTML(value) + '</td>').join('')
   + '<td>' + problem + '</td><td>'
   + '<div class="buttons"><button type="button" class="secondary" data-tm-show="' + row.index + '"' + (row.problem ? ' disabled' : '') + '>在圖上定位</button>'
   + '<button type="button" class="secondary" data-tm-edit="' + row.index + '">編輯</button>'
   + '<button type="button" class="secondary" data-tm-remove="' + row.index + '">刪除</button></div></td></tr>';
 }).join('');
 const pendingMarkup = pendingTm?.dataset === data && matches(pendingTm.source, 'pending')
  ? [...pendingTm.results].flatMap(([sequenceId, ranges]) => ranges.map(([start, end], i) => {
   const values = [sequenceId,'TM'+(i+1),start,end,tmAnnotationSourceLabels.get(pendingTm.source)];
   return '<tr>' + values.map(value => '<td>' + escapeHTML(value) + '</td>').join('')
    + '<td>待核對</td><td><button type="button" class="secondary" data-tm-review>核對匯入</button></td></tr>';
  })).join('') : '';
 const newMarkup = tmAnnotationEditor === 'new'
  ? tmAnnotationRowEditor(draft || [data.seqs.keys().next().value,'','','','manual'], draftProblem) : '';
 const body = rowMarkup + pendingMarkup + newMarkup;
 panel.innerHTML = body
  ? '<table aria-describedby="tmAnnotationHelp"><thead><tr><th scope="col">序列</th><th scope="col">區段</th><th scope="col">起點</th><th scope="col">終點</th><th scope="col">來源</th><th scope="col">狀態</th><th scope="col">操作</th></tr></thead><tbody>' + body + '</tbody></table>'
  : '<p class="hint">' + (rows.length || pendingTm ? '沒有符合篩選條件的標註。' : '目前沒有標註。') + '</p>';
 syncTmAnnotationHighlights();
}

function tmAnnotationFeedback(message) {
 $('tmAnnotationFeedback').textContent = message;
}

function tmAnnotationsChanged() {
 renderTmEvidence();
 renderTmAnnotationTable();
 renderTmRegionColors();
 render();
 document.dispatchEvent(new Event('projectchange'));
}

function tmAnnotationLines() {
 return $('tmInput').value.split(/\r?\n/);
}

function tmAnnotationsWrite(lines) {
 $('tmInput').value = lines.join('\n').trim();
}

function tmAnnotationTrackKeys(mark) {
 try {
  return JSON.parse(mark.dataset.tmAnnotations);
 } catch {
  return [];
 }
}

function syncTmAnnotationHighlights() {
 for (const mark of $('preview').querySelectorAll('[data-tm-annotations]')) {
  const selected = tmAnnotationTrackKeys(mark).some(key => tmAnnotationSelection.has(key));
  mark.classList.toggle('tm-annotation-selected', selected);
  if (mark.getAttribute('role') === 'button' || mark.tagName === 'BUTTON') mark.setAttribute('aria-pressed', String(selected));
 }
 for (const row of $('tmAnnotationTable').querySelectorAll('[data-tm-row]')) {
  row.classList.toggle('tm-annotation-selected', tmAnnotationSelection.has(row.dataset.tmRow));
 }
}

function tmSelectAnnotations(keys) {
 tmAnnotationSelection.clear();
 for (const key of keys) tmAnnotationSelection.add(key);
 syncTmAnnotationHighlights();
}

function tmRevealAnnotationRows(mark) {
 const keys = tmAnnotationTrackKeys(mark);
 if (!keys.length) return;
 if (tmAnnotationEditor !== null) {
  tmAnnotationFeedback('請先儲存或取消正在編輯的標註。');
  return;
 }
 if ($('toggleMobileSettings')?.getAttribute('aria-expanded') === 'false') $('toggleMobileSettings').click();
 $('tmAnnotationSource').value = '';
 $('tmAnnotationStatus').value = '';
 $('tmAnnotations').open = true;
 renderTmAnnotationTable();
 tmSelectAnnotations(keys);
 const row = $('tmAnnotationTable').querySelector('.tm-annotation-selected');
 row?.scrollIntoView({block:'nearest'});
 row?.querySelector('[data-tm-show]')?.focus({preventScroll:true});
}

function tmShowAnnotation(row) {
 if (!row || row.problem) return;
 if ($('tmView').value === 'off') {
  $('tmView').value = 'individual';
  updateTmControls();
  document.dispatchEvent(new Event('projectchange'));
 }
 const track = tmTracks(data).find(item => item.annotationKeys?.includes(row.key) && item.cols.size);
 if (!track) {
  tmAnnotationFeedback('目前的 TM 顯示設定未顯示此區段。');
  return;
 }
 let firstColumn = Infinity;
 for (const column of track.cols) firstColumn = Math.min(firstColumn, column);
 const jump = typeof showAlignmentPosition === 'function'
  && (showAlignmentPosition(firstColumn, row.sequenceId) || showAlignmentPosition(firstColumn));
 tmSelectAnnotations([row.key]);
 if (jump) $('preview').scrollIntoView({block:'nearest'});
 tmAnnotationFeedback(jump ? '已定位到圖上的區段。' : '目前沒有可定位的序列。');
}

function tmStartAnnotationEdit(index) {
 if (tmAnnotationEditor !== null) {
  tmAnnotationFeedback('請先儲存或取消正在編輯的標註。');
  return;
 }
 tmAnnotationEditor = index;
 for (const id of ['tmAnnotationSource', 'tmAnnotationStatus']) $(id).disabled = true;
 renderTmAnnotationTable();
 $('tmAnnotationForm').elements.region.focus();
}

function tmFinishAnnotationEdit() {
 tmAnnotationEditor = null;
 for (const id of ['tmAnnotationSource', 'tmAnnotationStatus']) $(id).disabled = false;
}

function tmSaveAnnotation(form) {
 const fields = tmAnnotationFields.map(name => form.elements[name].value.trim());
 const [sequenceId, region, start, end, source] = fields;
 const key = tmAnnotationKey(sequenceId, region);
 const rows = parseTmAnnotations(data);
 const problem = tmAnnotationProblem(data, fields)
  || (rows.some(row => row.key === key && row.index !== tmAnnotationEditor) ? '同一序列的區段名稱重複。' : '');
 if (problem) {
  $('tmAnnotationRowError').textContent = problem;
  return;
 }
 const previous = rows.find(row => row.index === tmAnnotationEditor);
 const lines = tmAnnotationLines();
 const line = [sequenceId,region,start,end].join(' ');
 if (previous) {
  lines[previous.index] = line;
  if (previous.key !== key) {
   tmAnnotationSources.delete(previous.key);
   const colors = tmRegionColors.individual;
   if (colors.has(previous.key)) {
    colors.set(key, colors.get(previous.key));
    colors.delete(previous.key);
   }
  }
 } else {
  lines.push(line);
 }
 tmAnnotationSources.set(key, source);
 tmAnnotationsWrite(lines);
 if ($('tmAnnotationSource').value && $('tmAnnotationSource').value !== source) $('tmAnnotationSource').value = '';
 $('tmAnnotationStatus').value = '';
 tmFinishAnnotationEdit();
 tmAnnotationsChanged();
 tmAnnotationFeedback('已儲存標註。');
}

function tmDeleteAnnotation(row) {
 if (!row || tmAnnotationEditor !== null) {
  tmAnnotationFeedback('請先儲存或取消正在編輯的標註。');
  return;
 }
 const lines = tmAnnotationLines();
 lines.splice(row.index, 1);
 tmAnnotationsWrite(lines);
 const remains = parseTmAnnotations(data).some(item => item.key === row.key);
 if (!remains) {
  tmAnnotationSources.delete(row.key);
  tmRegionColors.individual.delete(row.key);
  tmAnnotationSelection.delete(row.key);
 }
 tmAnnotationsChanged();
 tmAnnotationFeedback('已刪除標註。');
}

function tmReadDelimited(text, separator) {
 const records = [];
 let record = [];
 let value = '';
 let quoted = false;
 let endedQuote = false;
 const pushCell = () => {
  record.push(value);
  value = '';
  endedQuote = false;
 };
 const pushRecord = () => {
  pushCell();
  if (record.some(cell => cell.trim())) records.push(record);
  record = [];
 };
 const raw = text.replace(/^\uFEFF/, '');
 for (let index = 0; index < raw.length; index++) {
  const char = raw[index];
  if (quoted) {
   if (char === '"' && raw[index + 1] === '"') {
    value += '"';
    index++;
   } else if (char === '"') {
    quoted = false;
    endedQuote = true;
   } else {
    value += char;
   }
  } else if (char === separator) {
   pushCell();
  } else if (char === '\r' || char === '\n') {
   pushRecord();
   if (char === '\r' && raw[index + 1] === '\n') index++;
  } else if (char === '"' && !value && !endedQuote) {
   quoted = true;
  } else if (char === '"' || endedQuote) {
   throw Error('第 ' + (records.length + 1) + ' 列的引號格式有誤。');
  } else {
   value += char;
  }
 }
 if (quoted) throw Error('有未結束的引號。');
 pushRecord();
 return records;
}

const tmSpreadsheetPrefix = /^[=+@\-'\t\r\n]/;

function tmTableCell(value, separator) {
 const safe = tmSpreadsheetPrefix.test(value) ? "'" + value : value;
 return safe.includes(separator) || /["\r\n]/.test(safe)
  ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

function tmExportAnnotations(separator, extension) {
 if (!data) return;
 const rows = parseTmAnnotations(data);
 if (rows.some(row => row.problem)) {
  tmAnnotationFeedback('請先修正標註錯誤，再匯出表格。');
  return;
 }
 const fields = rows.map(row => [row.sequenceId,row.region,row.start,row.end,tmAnnotationSource(row.key)]);
 const body = [tmAnnotationColumns, ...fields].map(cells => cells.map(value => tmTableCell(value, separator)).join(separator)).join('\r\n');
 saveBlob('\uFEFF' + body + '\r\n', extension === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8',
  'clustal_tm_annotations.' + extension);
 tmAnnotationFeedback('已匯出 ' + rows.length + ' 筆標註。');
}

function tmParseTable(text, separator, dataset) {
 const [header = [], ...rows] = tmReadDelimited(text, separator);
 if (header.length !== tmAnnotationColumns.length || header.some((cell, i) => cell.trim() !== tmAnnotationColumns[i])) {
  throw Error('表頭需依序是 ' + tmAnnotationColumns.join('、') + '。可先匯出一份表格作為範本。');
 }
 const entries = new Map();
 const lengths = new Map();
 for (const [index, row] of rows.entries()) {
  const fields = row.map(cell => {
   const value = cell.trim();
   return value.startsWith("'") && tmSpreadsheetPrefix.test(value.slice(1)) ? value.slice(1) : value;
  });
  const [sequenceId, region, start, end, source] = fields;
  const key = tmAnnotationKey(sequenceId, region);
  const problem = fields.length !== tmAnnotationColumns.length ? '欄位數量不符。'
   : tmAnnotationProblem(dataset, fields, lengths)
    || (!tmAnnotationSourceLabels.has(source) ? '來源須填 manual、uniprot 或 deeptmhmm。' : '')
    || (entries.has(key) ? '表格內有重複的序列與區段。' : '');
  if (problem) throw Error('表格第 ' + (index + 2) + ' 列：' + problem);
  entries.set(key, {line:[sequenceId,region,start,end].join(' '),source});
 }
 if (!entries.size) throw Error('表格沒有可匯入的標註。');
 return entries;
}

function tmImportAnnotationTable(text, separator, dataset) {
 const current = parseTmAnnotations(dataset);
 if (current.some(row => row.problem)) throw Error('請先修正現有標註，再合併表格。');
 const entries = tmParseTable(text, separator, dataset);
 const lines = tmAnnotationLines();
 const indices = new Map(current.map(row => [row.key,row.index]));
 let updated = 0;
 for (const [key, entry] of entries) {
  if (indices.has(key)) {
   lines[indices.get(key)] = entry.line;
   updated++;
  } else {
   lines.push(entry.line);
  }
  tmAnnotationSources.set(key, entry.source);
 }
 tmAnnotationsWrite(lines);
 tmAnnotationsChanged();
 tmAnnotationFeedback('已匯入 ' + entries.size + ' 筆，更新 ' + updated + ' 筆現有標註。');
}

document.getElementById('tmRegionAppearance').addEventListener('toggle', renderTmRegionColors);
document.getElementById('tmRegionChoice').addEventListener('change', syncTmRegionColorInput);
document.getElementById('tmRegionColor').addEventListener('input', event => changeTmRegionColor(event.target.value));
document.getElementById('tmRegionColorReset').addEventListener('click', () => changeTmRegionColor(null));
document.getElementById('tmAnnotations').addEventListener('toggle', () => renderTmAnnotationTable());
for (const id of ['tmAnnotationSource', 'tmAnnotationStatus']) {
 document.getElementById(id).addEventListener('change', renderTmAnnotationTable);
}
document.getElementById('tmAddAnnotation').onclick = () => tmStartAnnotationEdit('new');
document.getElementById('tmReadAnnotations').onclick = () => {
 if (tmAnnotationEditor !== null) {
  tmAnnotationFeedback('請先儲存或取消正在編輯的標註。');
  return;
 }
 $('tmAnnotationFile').click();
};
document.getElementById('tmAnnotationFile').onchange = async event => {
 const file = event.target.files[0];
 event.target.value = '';
 const dataset = data;
 if (!file || !dataset) return;
 const request = ++tmAnnotationImportRequest;
 try {
  if (!/\.(csv|tsv)$/i.test(file.name)) throw Error('請選擇 CSV 或 TSV 檔案。');
  const text = await file.text();
  if (data !== dataset || request !== tmAnnotationImportRequest) return;
  if (tmAnnotationEditor !== null) throw Error('請先儲存或取消正在編輯的標註。');
  tmImportAnnotationTable(text, /\.tsv$/i.test(file.name) ? '\t' : ',', dataset);
 } catch (error) {
  if (data === dataset && request === tmAnnotationImportRequest) tmAnnotationFeedback(error.message);
 }
};
document.getElementById('tmExportCsv').onclick = () => tmExportAnnotations(',', 'csv');
document.getElementById('tmExportTsv').onclick = () => tmExportAnnotations('\t', 'tsv');
document.getElementById('tmAnnotationTable').addEventListener('submit', event => {
 if (!event.target.matches('#tmAnnotationForm')) return;
 event.preventDefault();
 tmSaveAnnotation(event.target);
});
document.getElementById('tmAnnotationTable').addEventListener('click', event => {
 const button = event.target.closest('button');
 if (!button) return;
 if (button.hasAttribute('data-tm-cancel')) {
  tmFinishAnnotationEdit();
  renderTmAnnotationTable();
 } else if (button.hasAttribute('data-tm-review')) {
  $('tmFetchPanel').open = true;
  $('tmPending').scrollIntoView({block:'nearest'});
  $('tmPending').querySelector('input')?.focus({preventScroll:true});
 } else if (button.hasAttribute('data-tm-edit')) {
  tmStartAnnotationEdit(Number(button.dataset.tmEdit));
 } else {
  const rows = parseTmAnnotations(data);
  if (button.hasAttribute('data-tm-show')) tmShowAnnotation(rows.find(row => row.index === Number(button.dataset.tmShow)));
  if (button.hasAttribute('data-tm-remove')) tmDeleteAnnotation(rows.find(row => row.index === Number(button.dataset.tmRemove)));
 }
});
document.getElementById('preview').addEventListener('click', event => {
 const mark = event.target.closest('[data-tm-annotations]');
 if (mark) tmRevealAnnotationRows(mark);
});
document.getElementById('preview').addEventListener('keydown', event => {
 const mark = event.target.closest('[data-tm-annotations]');
 if (!mark || !['Enter',' '].includes(event.key)) return;
 event.preventDefault();
 tmRevealAnnotationRows(mark);
});
document.addEventListener('alignmentloaded', () => {
 tmFinishAnnotationEdit();
 tmSelectAnnotations([]);
 $('tmAnnotationSource').value = '';
 $('tmAnnotationStatus').value = '';
 tmAnnotationFeedback('');
 renderTmAnnotationTable();
});
