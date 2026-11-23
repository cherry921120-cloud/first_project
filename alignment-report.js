'use strict';

const alignmentReportStyles = `
.uniprot-source-report{color:#1e293b;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}
.uniprot-source-report :is(h1,h2,h3,h4,h5){line-height:1.25}
.uniprot-source-report .uniprot-report-meta{margin:8px 0 24px;color:#475569}
.uniprot-source-report .uniprot-report-entries{margin-top:24px}
.uniprot-source-report .uniprot-report-table-wrap{overflow-x:auto}
.uniprot-source-report .uniprot-report-table{border-collapse:collapse;width:100%;text-align:left}
.uniprot-source-report .uniprot-report-table th,.uniprot-source-report .uniprot-report-table td{border:1px solid #cbd5e1;padding:8px;vertical-align:top}
.uniprot-source-report .uniprot-report-table thead th{background:#eff4fa}
.uniprot-source-report .uniprot-report-detail{font-size:.9em;color:#475569}
.uniprot-source-report .uniprot-report-topology{display:block;margin-top:6px;padding:8px;border:1px solid #cbd5e1;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.uniprot-source-report a{color:#1d4ed8}
@media print{
 .uniprot-source-report .uniprot-report-table-wrap{overflow:visible}
 .uniprot-source-report .uniprot-report-table thead{display:table-header-group}
 .uniprot-source-report .uniprot-report-table tr{break-inside:avoid}
 .uniprot-source-report .uniprot-report-entries>:is(h2,h3,h4,h5){break-after:avoid}
}
`;

function uniProtReportText(value) {
 if (typeof value === 'string') return value.trim();
 if (typeof value === 'number' && Number.isFinite(value)) return String(value);
 return '';
}

function escapeUniProtReportText(value) {
 const entities = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
 return (uniProtReportText(value) || '—').replace(/[&<>"']/g, character => entities[character]);
}

function uniProtReportAccession(value) {
 const label = escapeUniProtReportText(value);
 const accession = typeof value === 'string' ? value.trim().toUpperCase() : '';
 if (!/^(?:[OPQ]\d[A-Z0-9]{3}\d|[A-NR-Z]\d(?:[A-Z][A-Z0-9]{2}\d){1,2})(?:-\d+)?$/.test(accession)) return label;
 return `<a href="https://www.uniprot.org/uniprotkb/${accession}/entry">${label}</a>`;
}

const uniProtReportTimeFormat = new Intl.DateTimeFormat('zh-TW', {
 dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Taipei'
});

function uniProtReportTime(value) {
 if (!Number.isFinite(value) && (typeof value !== 'string' || !value.trim())) return '—';
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return '—';
 return `<time datetime="${date.toISOString()}">${escapeUniProtReportText(uniProtReportTimeFormat.format(date))}</time>`;
}

function uniProtReportRange(start, end) {
 if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) return '—';
 return start === end ? String(start) : `${start}–${end}`;
}

function uniProtReportColumns(columns) {
 if (!Array.isArray(columns)) return '—';
 const sorted = [...new Set(columns.filter(column => Number.isSafeInteger(column) && column > 0))].sort((a, b) => a - b);
 const ranges = [];
 for (let index = 0; index < sorted.length; index++) {
  const start = sorted[index];
  while (sorted[index + 1] === sorted[index] + 1) index++;
  ranges.push(uniProtReportRange(start, sorted[index]));
 }
 return ranges.join(', ') || '—';
}

function uniProtReportEntryRows(entries) {
 return entries.map(entry => {
  const length = Number.isSafeInteger(entry.length) && entry.length > 0 ? `${entry.length} aa` : '—';
  const tmCount = Number.isSafeInteger(entry.tmCount) && entry.tmCount >= 0 ? entry.tmCount : '—';
  return `<tr>
   <th scope="row">${escapeUniProtReportText(entry.sequenceId)}</th>
   <td>${uniProtReportAccession(entry.accession)}<div class="uniprot-report-detail">${escapeUniProtReportText(entry.entryType)}</div></td>
   <td>${escapeUniProtReportText(entry.proteinName)}<div class="uniprot-report-detail">基因 ${escapeUniProtReportText(entry.geneName)}</div></td>
   <td>${escapeUniProtReportText(entry.organism)}<div class="uniprot-report-detail">${length}</div></td>
   <td>${tmCount}</td>
   <td>${uniProtReportTime(entry.retrievedAt)}<div class="uniprot-report-detail">版本 ${escapeUniProtReportText(entry.release)}</div></td>
  </tr>`;
 }).join('');
}

const alignmentReportStatuses = new Map([
 ['as_imported','座標與來源相同'], ['manually_changed','座標已修改'],
 ['removed','已移除'], ['ambiguous','座標有歧義'],
 ['pending','待確認'], ['pending_confirmation','待確認'],
]);

function alignmentReportCoordinateCells(record, rangeStart, rangeEnd) {
 const hasRange = Number.isSafeInteger(rangeStart) && Number.isSafeInteger(rangeEnd);
 const originalResidues = Array.isArray(record.originalResidues) ? record.originalResidues : [];
 const currentResidues = Array.isArray(record.currentResidues) ? record.currentResidues : [];
 const current = record.currentCoordinates;
 const isAlignment = current?.type === 'alignment';
 const isPeptide = current?.type === 'peptide';
 const currentResidueRange = uniProtReportRange(...currentResidues.slice(0, 2));
 const currentRange = isAlignment || isPeptide ? uniProtReportRange(current.start, current.end) : currentResidueRange;
 const hasCurrentColumns = Array.isArray(record.currentAlignmentColumns);
 const currentColumns = hasCurrentColumns ? record.currentAlignmentColumns : [];
 const originalColumns = Array.isArray(record.originalAlignmentColumns) ? record.originalAlignmentColumns : [];
 const intersecting = (hasCurrentColumns ? currentColumns : originalColumns).filter(column =>
  hasRange && Number.isSafeInteger(column) && column >= rangeStart && column <= rangeEnd
 );
 return `<td>胺基酸 ${uniProtReportRange(...originalResidues.slice(0, 2))}<div class="uniprot-report-detail">比對欄位 ${uniProtReportColumns(originalColumns)}</div></td>
  <td>${currentRange === '—' ? '—' : `${isAlignment ? '比對欄位' : '胺基酸'} ${currentRange}`}
   ${isAlignment && currentResidueRange !== '—' ? `<div class="uniprot-report-detail">胺基酸 ${currentResidueRange}</div>` : ''}
   <div class="uniprot-report-detail">目前比對欄位 ${uniProtReportColumns(currentColumns)}<br>與匯出範圍重疊的${hasCurrentColumns ? '目前' : '原始'}欄位 ${uniProtReportColumns(intersecting)}</div></td>`;
}

function uniProtReportEvidenceRows(records, rangeStart, rangeEnd) {
 return records.map(record => {
  const evidence = Array.isArray(record.feature?.evidences) ? record.feature.evidences : [];
  const citations = evidence.map(item =>
   [item?.evidenceCode, item?.source, item?.id].map(uniProtReportText).filter(Boolean).join(' ')
  ).filter(Boolean);
  const description = uniProtReportText(record.feature?.description);
  return `<tr>
   <th scope="row">${escapeUniProtReportText(record.sequenceId)}<div class="uniprot-report-detail">${escapeUniProtReportText(record.tm)}</div></th>
   <td>${uniProtReportAccession(record.accession)}<div class="uniprot-report-detail">${uniProtReportTime(record.retrievedAt)}<br>版本 ${escapeUniProtReportText(record.release)}</div></td>
   ${alignmentReportCoordinateCells(record, rangeStart, rangeEnd)}
   <td>${citations.length ? citations.map(escapeUniProtReportText).join('<br>') : '未記錄'}${description ? `<div class="uniprot-report-detail">${escapeUniProtReportText(description)}</div>` : ''}</td>
   <td>${alignmentReportStatuses.get(record.status) ?? '未記錄'}</td>
  </tr>`;
 }).join('');
}

function deepTmReportTopology(value) {
 const topology = uniProtReportText(value);
 return /^[MBSIOP]+$/.test(topology) ? topology : '';
}

function deepTmReportPredictionClass(header) {
 const code = header.split('|').slice(1).map(part => part.trim().toUpperCase())
  .find(part => ['GLOB', 'SP', 'TM', 'SP+TM', 'BETA'].includes(part));
 return code ?? '未記錄';
}

function deepTmReportKind(kind) {
 if (kind === 'imported_prediction') return '匯入的預測結果';
 return uniProtReportText(kind) || '預測結果';
}

function deepTmReportBody(lookups, records, rangeStart, rangeEnd, sectionTag) {
 const heading = `<${sectionTag}>DeepTMHMM 預測證據</${sectionTag}>`;
 if (!lookups.length && !records.length) {
  return `<section class="uniprot-report-entries">${heading}<p>這次匯出的序列沒有已保存的 DeepTMHMM 預測結果。</p></section>`;
 }
 const runs = new Map();
 function findRun(record) {
  const sequenceId = uniProtReportText(record.sequenceId);
  const fileName = uniProtReportText(record.fileName);
  const header = uniProtReportText(record.header);
  const topology = deepTmReportTopology(record.topology);
  const importedAt = record.importedAt;
  const kind = deepTmReportKind(record.kind ?? 'imported_prediction');
  const runKey = JSON.stringify([sequenceId, fileName, uniProtReportText(importedAt), header, topology]);
  if (!runs.has(runKey)) {
   runs.set(runKey, {number: runs.size + 1, sequenceId, fileName, header, topology, importedAt, kind});
  }
  return runs.get(runKey);
 }
 for (const lookup of lookups) {
  const run = findRun(lookup);
  if (Number.isSafeInteger(lookup.tmCount) && lookup.tmCount >= 0) run.tmCount = lookup.tmCount;
 }
 const evidenceRows = records.map(record => {
  const run = findRun(record);
  const segment = deepTmReportTopology(record.topologySegment);
  const markClass = /^M+$/.test(segment) ? '跨膜螺旋' : /^B+$/.test(segment) ? '跨膜 β 股' : '未記錄';
  return `<tr>
   <th scope="row">${escapeUniProtReportText(run.sequenceId)}<div class="uniprot-report-detail">${escapeUniProtReportText(record.tm)}</div></th>
   <td><a href="#deeptmhmm-report-run-${run.number}">預測紀錄 ${run.number}</a><div class="uniprot-report-detail">${escapeUniProtReportText(run.fileName)}</div></td>
   <td>${markClass}${segment ? `<div class="uniprot-report-detail"><code>${segment}</code></div>` : ''}</td>
   ${alignmentReportCoordinateCells(record, rangeStart, rangeEnd)}
   <td>${alignmentReportStatuses.get(record.status) ?? '未記錄'}</td>
  </tr>`;
 }).join('');
 const topologyReports = [...runs.values()].map(run => `<li id="deeptmhmm-report-run-${run.number}">
  <strong>${escapeUniProtReportText(run.sequenceId)}</strong>
  <div class="uniprot-report-detail">${escapeUniProtReportText(run.kind)} · 分類 ${deepTmReportPredictionClass(run.header)} · 預測 TM 數 ${run.tmCount ?? '—'}<br>
   檔案 ${escapeUniProtReportText(run.fileName)} · 匯入時間 ${uniProtReportTime(run.importedAt)}<br>
   標頭 ${escapeUniProtReportText(run.header)}</div>
  ${run.topology ? `<code class="uniprot-report-topology">${run.topology}</code>` : '<div class="uniprot-report-detail">未記錄完整拓樸。</div>'}
 </li>`).join('');
 return `<section class="uniprot-report-entries">${heading}
  ${records.length ? `<div class="uniprot-report-table-wrap"><table class="uniprot-report-table" aria-label="匯出範圍內的 DeepTMHMM 預測區段">
   <thead><tr><th scope="col">序列與區段</th><th scope="col">來源</th><th scope="col">預測區段類型</th><th scope="col">原始座標</th><th scope="col">目前座標</th><th scope="col">標註狀態</th></tr></thead>
   <tbody>${evidenceRows}</tbody>
  </table></div>` : '<p>這個匯出範圍內沒有已保存的 DeepTMHMM 區段證據。</p>'}
  <p>每筆紀錄的完整預測拓樸以代碼表示。M 為跨膜螺旋，B 為跨膜 β 股，S 為訊號胜肽，I 為膜內，O 為膜外，P 為周質。</p>
  <ol>${topologyReports}</ol>
 </section>`;
}

function renderAlignmentReport(report, titleTag, sectionTag) {
 const objects = values => Array.isArray(values)
  ? values.filter(value => value && typeof value === 'object' && !Array.isArray(value))
  : [];
 const entries = objects(report.lookups);
 const records = objects(report.records);
 const deepTmLookups = objects(report.deepTmLookups);
 const deepTmRecords = objects(report.deepTmRecords);
 const range = uniProtReportRange(report.rangeStart, report.rangeEnd);
 return `<section class="uniprot-source-report">
  <${titleTag}>比對設定與來源報告</${titleTag}>
  <div class="uniprot-report-meta">比對檔 ${escapeUniProtReportText(report.alignment)}<br>匯出比對欄位 ${range}<br>查詢與匯入時間以台北時間顯示</div>
  ${report.settings ? alignmentSettingsReportBody(report.settings, sectionTag) : ''}
  <section class="uniprot-report-entries">
   <${sectionTag}>序列完全相符的 UniProt 條目</${sectionTag}>
   ${entries.length ? `<div class="uniprot-report-table-wrap"><table class="uniprot-report-table" aria-label="序列完全相符的 UniProt 條目">
    <thead><tr><th scope="col">序列</th><th scope="col">UniProt accession</th><th scope="col">蛋白質與基因</th><th scope="col">物種與序列長度</th><th scope="col">具精確座標的 TM 數</th><th scope="col">查詢時間與版本</th></tr></thead>
    <tbody>${uniProtReportEntryRows(entries)}</tbody>
   </table></div>` : '<p>這次匯出的序列沒有已保存的完整相符查詢紀錄。</p>'}
  </section>
  <section class="uniprot-report-entries">
   <${sectionTag}>匯出範圍內的 UniProt TM 證據</${sectionTag}>
   ${records.length ? `<div class="uniprot-report-table-wrap"><table class="uniprot-report-table" aria-label="匯出範圍內的 UniProt TM 證據">
    <thead><tr><th scope="col">序列與區段</th><th scope="col">來源</th><th scope="col">原始座標</th><th scope="col">目前座標</th><th scope="col">證據</th><th scope="col">標註狀態</th></tr></thead>
    <tbody>${uniProtReportEvidenceRows(records, report.rangeStart, report.rangeEnd)}</tbody>
   </table></div>` : '<p>這個範圍內沒有已保存的 UniProt TM 證據。</p>'}
  </section>
  ${deepTmReportBody(deepTmLookups, deepTmRecords, report.rangeStart, report.rangeEnd, sectionTag)}
 </section>`;
}

function alignmentReportBody(report) {
 return renderAlignmentReport(report, 'h2', 'h3');
}

function alignmentReportDocument(report) {
 return `<!doctype html><html lang="zh-Hant"><head>
 <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>比對設定與來源報告</title>
 <style>body{margin:24px auto;padding:0 16px;max-width:1100px;background:#fff}${alignmentReportStyles}</style>
 </head><body><main>${renderAlignmentReport(report, 'h1', 'h2')}</main></body></html>`;
}

const uniProtZipCrcTable = Uint32Array.from({length: 256}, (_, i) => {
 let value = i;
 for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
 return value;
});

function uniProtZipCrc32(bytes) {
 let crc = 0xffffffff;
 for (const byte of bytes) crc = (crc >>> 8) ^ uniProtZipCrcTable[(crc ^ byte) & 0xff];
 return (crc ^ 0xffffffff) >>> 0;
}

function writeUniProtZipEntryFields(view, offset, size, checksum, nameLength) {
 view.setUint16(offset, 20, true); // Minimum version required to extract.
 view.setUint16(offset + 2, 0x0800, true); // UTF-8 filename.
 view.setUint16(offset + 8, 0x0021, true); // DOS date 1980-01-01.
 view.setUint32(offset + 10, checksum, true);
 view.setUint32(offset + 14, size, true);
 view.setUint32(offset + 18, size, true);
 view.setUint16(offset + 22, nameLength, true);
}

async function createAlignmentReportZip(files) {
 const zipSizeLimit = 0xffffffff;
 if (files.length >= 0xffff) throw Error('ZIP 內的檔案太多。');
 const encoder = new TextEncoder();
 const usedNames = new Set();
 const localFiles = [];
 const centralFiles = [];
 let centralOffset = 0;
 let centralLength = 0;
 for (const file of files) {
  const {name, content} = file;
  if (typeof name !== 'string' || !name || /[\\/\u0000-\u001f]/.test(name) || name === '.' || name === '..' || usedNames.has(name)) {
   throw Error('ZIP 檔名無效或重複。');
  }
  usedNames.add(name);
  const encodedName = encoder.encode(name);
  if (encodedName.length > 0xffff) throw Error('ZIP 檔名太長。');
  const payload = content instanceof Blob ? content : new Blob([content]);
  const lastOffset = centralOffset + 30 + encodedName.length + payload.size;
  if (lastOffset >= zipSizeLimit) throw Error('ZIP 檔案太大。請縮小匯出範圍。');
  const checksum = uniProtZipCrc32(new Uint8Array(await payload.arrayBuffer()));
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  writeUniProtZipEntryFields(local, 4, payload.size, checksum, encodedName.length);
  localFiles.push(local.buffer, encodedName, payload);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);
  writeUniProtZipEntryFields(central, 6, payload.size, checksum, encodedName.length);
  central.setUint32(42, centralOffset, true);
  centralFiles.push(central.buffer, encodedName);
  centralLength += central.byteLength + encodedName.length;
  centralOffset = lastOffset;
 }
 const end = new DataView(new ArrayBuffer(22));
 if (centralOffset + centralLength + end.byteLength >= zipSizeLimit) throw Error('ZIP 檔案太大。請縮小匯出範圍。');
 end.setUint32(0, 0x06054b50, true);
 end.setUint16(8, files.length, true);
 end.setUint16(10, files.length, true);
 end.setUint32(12, centralLength, true);
 end.setUint32(16, centralOffset, true);
 return new Blob([...localFiles, ...centralFiles, end.buffer], {type: 'application/zip'});
}
