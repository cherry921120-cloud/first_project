'use strict';

const alignmentContrastGroups = [
 ['AVLIM', '#005c30'], ['FWY', '#874000'], ['STNQ', '#a11634'],
 ['KRH', '#123ebe'], ['DE', '#7b1870'], ['GP', '#6d4200'],
 ['C', '#005b5c'], ['-', '#475569']
];
const alignmentContrast = new Map(alignmentContrastGroups.flatMap(([letters, shade]) =>
 Array.from(letters, letter => [letter, shade])
));
const alignmentGap = character => character === '-' || character === '.';
const alignmentView = {
 dataset: null,
 hiddenNames: new Set(),
 search: '',
 listLimit: 100,
 active: null,
 viewport: null,
 observer: null,
 counterByWidth: null
};

function color(character, palette) {
 if (palette === 'mono') return '#1f2937';
 if (palette === 'highContrast') return alignmentContrast.get(character) || '#1f2937';
 return (palette === 'zappo' ? paletteZappo : paletteClassic)[character] || '#253047';
}

function alignmentNamesWidth(names, font) {
 const longest = names.reduce((length, name) => Math.max(length, name.length), 0);
 return Math.max(115, Math.min(270, longest * font * .64 + 15));
}

function alignmentNumberWidth(dataset) {
 return String(dataset.total).length;
}

function countAlignmentResidues(sequence, start, end) {
 let count = 0;
 for (let index = start; index < end; index++) {
  if (!alignmentGap(sequence[index])) count++;
 }
 return count;
}

function tracksForVisibleNames(tracks, names) {
 const visible = new Set(names);
 return tracks.filter(track => {
  if (track.memberNames?.length) return track.memberNames.some(name => visible.has(name));
  return !data?.seqs.has(track.name) || visible.has(track.name);
 });
}

function alignmentPaletteLegend(palette) {
 const groups = palette === 'mono' ? [] : palette === 'highContrast' ? alignmentContrastGroups : null;
 const byColor = new Map();
 const fallback = palette === 'zappo' ? paletteZappo : paletteClassic;
 if (groups === null) {
  for (const [letter, shade] of Object.entries(fallback)) {
   byColor.set(shade, (byColor.get(shade) || '') + letter);
  }
 }
 const entries = groups || Array.from(byColor, ([shade, letters]) => [letters, shade]);
 const colors = entries.map(([letters, shade]) =>
  `<span style="color:${shade};font-weight:700">${letters === '-' ? '– gap' : letters}</span>`
 ).join('');
 return `<span>配色圖例</span>${colors || '<span>黑白</span>'}<span>＊ 完全保留 · : 強相似 · . 弱相似</span>`;
}

function formatAlignmentBlock(d, s, tracks, options) {
 const { names, begin, end, interactive, counts, includeRuler = true, includeFooter = true } = options;
 const width = end - begin;
 const digits = alignmentNumberWidth(d);
 const startSpacer = s.showStart ? `<span style="display:inline-block;width:calc(${digits}ch + 10px)"></span>` : '';
 const lines = [];
 if (includeRuler && s.showRuler) {
  const ruler = Array.from({ length: width }, (_, index) => {
   const column = begin + index + 1;
   return column % 10 === 0 ? '|' : column % 5 === 0 ? '.' : ' ';
  }).join('');
  lines.push(`<div class="aln-line"><span class="aln-name"></span>${startSpacer}<span class="aln-seq aln-ruler muted">${ruler}</span></div>`);
 }
 function appendTrack(track) {
  const marks = [];
  let hasMark = false;
  let from = begin;
  while (from < end) {
   const marked = track.cols.has(from + 1);
   let to = from + 1;
   while (to < end && track.cols.has(to + 1) === marked) to++;
   const spanWidth = to - from;
   from = to;
   if (!marked) {
    marks.push(`<span class="track-space" style="width:${spanWidth}ch"></span>`);
    continue;
   }
   hasMark = true;
   const description = [track.group, track.region, track.name].join(' · ');
   const annotation = interactive && track.annotationKeys?.length
    ? ` role="button" tabindex="0" aria-label="${escapeHTML(description)}" data-tm-annotations="${escapeHTML(JSON.stringify(track.annotationKeys))}"`
    : '';
   const label = track.showLabel ? `<span class="track-run-label">${escapeHTML(track.region)}</span>` : '';
   marks.push(`<span class="track-run"${annotation} style="width:${spanWidth}ch;--track-color:${track.color};--track-radius:${Math.min(track.radius ?? s.radius, 20)}px;--track-height:${track.showLabel ? Math.max(14, track.labelSize + 5) : 8}px;--label-size:${track.labelSize}px;--label-color:${track.labelColor}" title="${escapeHTML(description)}">${label}</span>`);
  }
  if (!hasMark) return;
  const height = ` style="height:${alignmentTrackHeight(s, track)}px"`;
  const trackLabel = track.showTrackLabel === false ? '' : track.label || '';
  lines.push(`<div class="aln-track"${height}><span class="track-label">${escapeHTML(trackLabel)}</span>${startSpacer}<span class="aln-seq">${marks.join('')}</span></div>`);
 }
 const rowTracks = new Map();
 const footerTracks = [];
 for (const track of tracks) {
  if (!track.sequenceRow) {
   footerTracks.push(track);
   continue;
  }
  if (!rowTracks.has(track.sequenceRow)) rowTracks.set(track.sequenceRow, []);
  rowTracks.get(track.sequenceRow).push(track);
 }
 for (const name of names) {
  const sequence = d.seqs.get(name);
  const segment = sequence.slice(begin, end);
  const rowStart = counts.get(name) + 1;
  counts.set(name, rowStart - 1 + countAlignmentResidues(sequence, begin, end));
  const row = interactive ? ` data-alignment-name="${escapeHTML(name)}"` : '';
  const colored = Array.from(segment, (letter, offset) => {
   const cell = interactive ? ` class="aln-cell" data-alignment-column="${begin + offset + 1}"` : '';
   return `<span${cell} style="color:${color(letter, s.palette)}">${escapeHTML(alignmentGap(letter) && !s.showGap ? ' ' : letter)}</span>`;
  }).join('');
  const startLabel = s.showStart ? `<span class="aln-count" style="margin:0 10px 0 0">${String(rowStart).padStart(digits, ' ')}</span>` : '';
  const endLabel = s.showCount ? `<span class="aln-count">${counts.get(name)}</span>` : '';
  lines.push(`<div class="aln-line"${row}><span class="aln-name" title="${escapeHTML(name)}">${escapeHTML(name)}</span>${startLabel}<span class="aln-seq">${colored}</span>${endLabel}</div>`);
  for (const track of rowTracks.get(name) || []) appendTrack(track);
 }
 if (includeFooter) {
  if (s.showCons) {
   lines.push(`<div class="aln-line"><span class="aln-name"></span>${startSpacer}<span class="aln-seq aln-cons">${escapeHTML(d.cons.slice(begin, end))}</span></div>`);
  }
  for (const track of footerTracks) appendTrack(track);
 }
 return lines.join('');
}

function alignmentTrackHeight(s, track) {
 return Math.max(s.font * 1.52, track.showLabel ? track.labelSize + 9 : 12);
}

function alignmentWrapperStyle(font, nameWidth) {
 return `--aln-font:${font}px;--name-width:${nameWidth}px`;
}

function buildAlignment(d, s, tracks, options = {}) {
 const { names = Array.from(d.seqs.keys()), start = 0, end = d.total, interactive = false } = options;
 const style = alignmentWrapperStyle(s.font, alignmentNamesWidth(names, s.font));
 const counts = new Map(names.map(name => [name, countAlignmentResidues(d.seqs.get(name), 0, start)]));
 const blocks = [];
 for (let begin = start; begin < end; begin += s.cols) {
  const block = formatAlignmentBlock(d, s, tracks, {
   names, begin, end: Math.min(end, begin + s.cols), interactive, counts
  });
  blocks.push(`<section class="aln-block" data-alignment-block="${begin}">${block}</section>`);
 }
 return `<div class="alignment${interactive ? ' interactive-alignment' : ''}" style="${style}">${blocks.join('')}</div>`;
}

function getAlignmentVisibleNames() {
 return Array.from(data?.seqs.keys() || []).filter(name => !alignmentView.hiddenNames.has(name));
}

function getAlignmentViewState() {
 return { search: alignmentView.search, hiddenNames: Array.from(alignmentView.hiddenNames) };
}

function resetAlignmentDataset() {
 alignmentView.dataset = data;
 alignmentView.counterByWidth = null;
 alignmentView.active = null;
 $('preview').scrollTop = 0;
 $('preview').scrollLeft = 0;
 $('alignmentCoordinate').textContent = '點選胺基酸，或將焦點移到預覽後使用方向鍵。';
 $('jumpStatus').textContent = '';
}

function setAlignmentViewState(state) {
 if (alignmentView.dataset !== data) resetAlignmentDataset();
 alignmentView.search = typeof state?.search === 'string' ? state.search : '';
 alignmentView.hiddenNames = new Set(Array.from(state?.hiddenNames || []).filter(name => data?.seqs.has(name)));
 alignmentView.listLimit = 100;
 $('sequenceSearch').value = alignmentView.search;
 updateAlignmentFilters();
}

function searchedAlignmentNames(names = Array.from(data?.seqs.keys() || [])) {
 const query = alignmentView.search.trim().toLocaleLowerCase();
 return names.filter(name => name.toLocaleLowerCase().includes(query));
}

function updateAlignmentFilters({ refreshJump = true } = {}) {
 const matches = searchedAlignmentNames();
 const matched = matches.slice(0, alignmentView.listLimit);
 const visible = getAlignmentVisibleNames();
 const list = $('sequenceVisibility');
 const fragment = document.createDocumentFragment();
 for (const name of matched) {
  const label = document.createElement('label');
  label.className = 'checkrow';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = name;
  input.checked = !alignmentView.hiddenNames.has(name);
  label.append(input, document.createTextNode(name));
  fragment.append(label);
 }
 list.replaceChildren(fragment);
 $('sequenceMore').hidden = matched.length === matches.length;
 $('sequenceShowMatches').disabled = !alignmentView.search.trim() || !matches.length;
 $('sequenceFilterStatus').textContent =
  `顯示 ${visible.length} / ${data?.seqs.size ?? 0} 條序列 · 找到 ${matches.length} 條`;
 if (!refreshJump) return;
 const options = $('jumpSequence');
 const previous = options.value;
 const desired = visible.includes(previous) ? previous : visible[0] || '';
 const selection = document.createDocumentFragment();
 visible.forEach(name => selection.append(new Option(name, name, false, desired === name)));
 options.replaceChildren(selection);
}

function changeAlignmentSequenceVisibility(hidden) {
 alignmentView.hiddenNames = hidden;
 updateAlignmentFilters();
 render();
 document.dispatchEvent(new Event('projectchange'));
}

function getInteractiveCounter(d, blockWidth, name, begin) {
 if (alignmentView.counterByWidth?.width !== blockWidth) {
  alignmentView.counterByWidth = { width: blockWidth, counters: new Map() };
 }
 const counters = alignmentView.counterByWidth.counters;
 if (!counters.has(name)) {
  const sequence = d.seqs.get(name);
  const byBlock = new Uint32Array(Math.ceil(d.total / blockWidth));
  for (let block = 1; block < byBlock.length; block++) {
   byBlock[block] = byBlock[block - 1]
    + countAlignmentResidues(sequence, (block - 1) * blockWidth, block * blockWidth);
  }
  counters.set(name, byBlock);
 }
 return counters.get(name)[Math.floor(begin / blockWidth)];
}

function alignmentTracksByBlock(tracks, columns) {
 const byBlock = new Map();
 for (const track of tracks) {
  const blocks = new Set();
  for (const column of track.cols) blocks.add(Math.floor((column - 1) / columns));
  for (const block of blocks) {
   if (!byBlock.has(block)) byBlock.set(block, []);
   byBlock.get(block).push(track);
  }
 }
 return byBlock;
}

function fillAlignmentWindow(viewport, slot) {
 if (slot.element.hasChildNodes()) return;
 const { dataset, options } = viewport;
 const { begin, end, names, ruler, footer, tracks } = slot;
 const counts = new Map(names.map(name => [name, getInteractiveCounter(dataset, options.cols, name, begin)]));
 slot.element.innerHTML = formatAlignmentBlock(dataset, options, tracks, {
  names, begin, end, interactive: true, counts, includeRuler: ruler, includeFooter: footer
 });
 highlightAlignmentCell();
 if (typeof syncTmAnnotationHighlights === 'function') syncTmAnnotationHighlights();
}

function mountAlignmentWindow(d, s, names, tracks, preview) {
 const frame = document.createElement('div');
 frame.className = 'alignment interactive-alignment virtual-alignment';
 const nameWidth = alignmentNamesWidth(names, s.font);
 frame.style.cssText = alignmentWrapperStyle(s.font, nameWidth);
 const numericWidth = (s.showStart ? alignmentNumberWidth(d) + 2 : 0)
  + (s.showCount ? alignmentNumberWidth(d) + 3 : 0);
 frame.style.minWidth = `calc(${nameWidth + 30}px + ${Math.min(s.cols, d.total) + numericWidth}ch)`;
 const viewport = { dataset: d, options: s, slots: new Map(), rowChunks: [] };
 const byBlock = alignmentTracksByBlock(tracks, s.cols);
 const chunkSize = Math.max(1, Math.floor(4500 / s.cols));
 const chunkIndexByName = new Map(names.map((name, index) => [name, Math.floor(index / chunkSize)]));
 for (let index = 0; index < names.length; index += chunkSize) {
  viewport.rowChunks.push(names.slice(index, index + chunkSize));
 }
 for (let begin = 0; begin < d.total; begin += s.cols) {
  const block = document.createElement('section');
  const blockIndex = begin / s.cols;
  block.className = 'aln-block';
  block.dataset.alignmentBlock = begin;
  const blockTracks = byBlock.get(blockIndex) || [];
  const tracksByChunk = new Map();
  for (const track of blockTracks) {
   const index = track.sequenceRow ? chunkIndexByName.get(track.sequenceRow) : viewport.rowChunks.length - 1;
   if (index === undefined) continue;
   if (!tracksByChunk.has(index)) tracksByChunk.set(index, []);
   tracksByChunk.get(index).push(track);
  }
  viewport.rowChunks.forEach((chunk, index) => {
   const ruler = index === 0;
   const footer = index === viewport.rowChunks.length - 1;
   const lines = chunk.length + Number(ruler && s.showRuler) + Number(footer && s.showCons);
   const chunkTracks = tracksByChunk.get(index) || [];
   const trackHeight = chunkTracks.reduce((height, track) => height + alignmentTrackHeight(s, track), 0);
   const slot = document.createElement('div');
   slot.className = 'alignment-window';
   slot.style.minHeight = `${lines * s.font * 1.52 + trackHeight}px`;
   block.append(slot);
   viewport.slots.set(slot, {
    element: slot, begin, end: Math.min(d.total, begin + s.cols),
    names: chunk, ruler, footer, tracks: chunkTracks
   });
  });
  frame.append(block);
 }
 preview.replaceChildren(frame);
 alignmentView.viewport = viewport;
 alignmentView.observer = new IntersectionObserver(entries => {
  if (alignmentView.viewport !== viewport) return;
  for (const entry of entries) {
   const slot = viewport.slots.get(entry.target);
   if (entry.isIntersecting) fillAlignmentWindow(viewport, slot);
   else if (!entry.target.contains(document.activeElement)) slot.element.replaceChildren();
  }
 }, { root: preview, rootMargin: '450px 0px' });
 for (const slot of viewport.slots.values()) alignmentView.observer.observe(slot.element);
}

function alignmentCell(column, name) {
 const blockStart = Math.floor((column - 1) / settings().cols) * settings().cols;
 const block = $('preview').querySelector(`[data-alignment-block="${blockStart}"]`);
 if (!block) return null;
 const viewport = alignmentView.viewport;
 if (viewport) {
  const index = viewport.rowChunks.findIndex(chunk => chunk.includes(name));
  const slot = viewport.slots.get(block.children[index]);
  if (slot) fillAlignmentWindow(viewport, slot);
 }
 return block.querySelector(`[data-alignment-name="${CSS.escape(name)}"] [data-alignment-column="${column}"]`);
}

function highlightAlignmentCell() {
 const preview = $('preview');
 preview.querySelector('.aln-selected')?.classList.remove('aln-selected');
 if (!alignmentView.active) return;
 const { column, name } = alignmentView.active;
 preview.querySelector(`[data-alignment-name="${CSS.escape(name)}"] [data-alignment-column="${column}"]`)
  ?.classList.add('aln-selected');
}

function updateAlignmentCoordinate(column, name) {
 const sequence = data.seqs.get(name);
 const character = sequence[column - 1];
 alignmentView.active = { column, name };
 const blockWidth = settings().cols;
 const before = Math.floor((column - 1) / blockWidth) * blockWidth;
 const residue = alignmentGap(character) ? '—（gap）' : getInteractiveCounter(data, blockWidth, name, before)
  + countAlignmentResidues(sequence, before, column);
 $('alignmentCoordinate').textContent = `${name} · 比對欄 ${column} · 胺基酸位置 ${residue}${alignmentGap(character) ? '' : `（${character}）`}`;
 highlightAlignmentCell();
}

function showAlignmentPosition(column, sequenceName) {
 if (!data || !Number.isInteger(column) || column < 1 || column > data.total) return false;
 const name = sequenceName ?? getAlignmentVisibleNames()[0];
 if (!data.seqs.has(name) || alignmentView.hiddenNames.has(name)) return false;
 const cell = alignmentCell(column, name);
 if (!cell) return false;
 updateAlignmentCoordinate(column, name);
 const preview = $('preview');
 const frame = preview.getBoundingClientRect();
 const point = cell.getBoundingClientRect();
 const stickyWidth = cell.closest('.aln-line').querySelector('.aln-name').getBoundingClientRect().width;
 preview.scrollTop += point.top - frame.top - preview.clientHeight / 2;
 if (point.left < frame.left + stickyWidth || point.right > frame.right) {
  preview.scrollLeft += point.left - frame.left - (preview.clientWidth + stickyWidth) / 2;
 }
 return true;
}

function alignmentColumnForResidue(sequence, residue) {
 let position = 0;
 for (let index = 0; index < sequence.length; index++) {
  if (!alignmentGap(sequence[index]) && ++position === residue) return index + 1;
 }
 return null;
}

function render() {
 const preview = $('preview');
 alignmentView.observer?.disconnect();
 alignmentView.viewport = null;
 if (!data) {
  $('alignmentTools').hidden = true;
  alignmentView.dataset = null;
  return;
 }
 const changedDataset = data !== alignmentView.dataset;
 if (changedDataset) setAlignmentViewState(null);
 $('alignmentTools').hidden = false;
 const previousTop = changedDataset ? 0 : preview.scrollTop;
 const previousLeft = changedDataset ? 0 : preview.scrollLeft;
 const s = settings();
 const names = getAlignmentVisibleNames();
 const tracks = tracksForVisibleNames(allTracks(data), names);
 if (!names.length) {
  preview.innerHTML = '<div class="empty">請在「篩選序列」中至少勾選一條序列。</div>';
 } else if (names.length * data.total > 40000 && 'IntersectionObserver' in window) {
  mountAlignmentWindow(data, s, names, tracks, preview);
 } else {
  preview.innerHTML = buildAlignment(data, s, tracks, { names, interactive: true });
 }
 preview.scrollTop = previousTop;
 preview.scrollLeft = previousLeft;
 $('meta').textContent = `${names.length} / ${data.seqs.size} 條序列 · ${data.total} 欄 · 每排 ${s.cols} 欄`;
 $('alignmentLegend').innerHTML = alignmentPaletteLegend(s.palette);
 if (alignmentView.active && !names.includes(alignmentView.active.name)) {
  alignmentView.active = null;
  $('alignmentCoordinate').textContent = '請選取要查看座標的位置。';
 }
 highlightAlignmentCell();
 if (typeof syncTmAnnotationHighlights === 'function') syncTmAnnotationHighlights();
}

function initAlignmentViewer() {
 $('toggleMobileSettings').addEventListener('click', event => {
  const button = event.currentTarget;
  const expanded = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!expanded));
  button.textContent = expanded ? '展開匯入與排版設定' : '收合匯入與排版設定';
  $('settingsPanel').classList.toggle('mobile-settings-collapsed', expanded);
 });
 $('sequenceSearch').addEventListener('input', event => {
  alignmentView.search = event.target.value;
  alignmentView.listLimit = 100;
  updateAlignmentFilters({ refreshJump: false });
  document.dispatchEvent(new CustomEvent('projectchange', {detail: {target: event.target}}));
 });
 $('sequenceMore').addEventListener('click', () => {
  alignmentView.listLimit += 100;
  updateAlignmentFilters({ refreshJump: false });
 });
 $('sequenceVisibility').addEventListener('change', event => {
  const input = event.target;
  if (!input.matches('input[type=checkbox]')) return;
  if (input.checked) alignmentView.hiddenNames.delete(input.value);
  else alignmentView.hiddenNames.add(input.value);
  $('sequenceFilterStatus').textContent =
   `顯示 ${getAlignmentVisibleNames().length} / ${data.seqs.size} 條序列 · 找到 ${searchedAlignmentNames().length} 條`;
  const option = Array.from($('jumpSequence').options).find(candidate => candidate.value === input.value);
  if (option && !input.checked) option.remove();
  else if (!option && input.checked) $('jumpSequence').add(new Option(input.value, input.value));
  render();
  document.dispatchEvent(new Event('projectchange'));
 });
 $('sequenceShowAll').addEventListener('click', () => changeAlignmentSequenceVisibility(new Set()));
 $('sequenceShowMatches').addEventListener('click', () => {
  const matches = new Set(searchedAlignmentNames());
  changeAlignmentSequenceVisibility(new Set(Array.from(data.seqs.keys()).filter(name => !matches.has(name))));
 });
 $('jumpUnit').addEventListener('change', () => {
  $('jumpSequenceLabel').hidden = $('jumpUnit').value === 'column';
 });
 $('alignmentJump').addEventListener('submit', event => {
  event.preventDefault();
  if (!data) return;
  const residueMode = $('jumpUnit').value === 'residue';
  const entered = Number($('jumpValue').value);
  const name = residueMode ? $('jumpSequence').value : undefined;
  const sequence = data.seqs.get(name);
  const column = residueMode ? (sequence ? alignmentColumnForResidue(sequence, entered) : null) : entered;
  $('jumpStatus').textContent = showAlignmentPosition(column, name) ? '' : '此位置超出範圍，或目前沒有可顯示的序列。';
 });
 $('preview').addEventListener('click', event => {
  const cell = event.target.closest('[data-alignment-column]');
  if (cell) updateAlignmentCoordinate(Number(cell.dataset.alignmentColumn), cell.closest('[data-alignment-name]').dataset.alignmentName);
 });
 $('preview').addEventListener('focus', () => {
  if (!data || alignmentView.active) return;
  const name = getAlignmentVisibleNames()[0];
  if (name) updateAlignmentCoordinate(1, name);
 });
 $('preview').addEventListener('keydown', event => {
  if (event.target !== $('preview') || !data || event.altKey || event.ctrlKey || event.metaKey) return;
  const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  if (!arrows.includes(event.key)) return;
  const names = getAlignmentVisibleNames();
  if (!names.length) return;
  const active = alignmentView.active || { column: 1, name: names[0] };
  const row = names.indexOf(active.name);
  const nextRow = Math.max(0, Math.min(names.length - 1, row + Number(event.key === 'ArrowDown') - Number(event.key === 'ArrowUp')));
  const column = Math.max(1, Math.min(data.total, active.column + Number(event.key === 'ArrowRight') - Number(event.key === 'ArrowLeft')));
  event.preventDefault();
  showAlignmentPosition(column, names[nextRow]);
 });
}

document.addEventListener('DOMContentLoaded', initAlignmentViewer);
