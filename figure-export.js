'use strict';

const figurePresets = {
 current: {padding: 14, scale: 1},
 presentation: {cols: 48, font: 18, padding: 24, scale: 2},
 report: {cols: 66, font: 12, padding: 20, scale: 3},
};

function getFigureExportState() {
 return {
  scope: $('exportScope').value,
  start: $('exportStart').value,
  end: $('exportEnd').value,
  preset: $('exportPreset').value,
  background: $('exportPngBackground').value,
  names: [...$('exportNames').querySelectorAll('input:checked')].map(input => input.value),
 };
}

function setFigureExportState(state) {
 if (!state || typeof state !== 'object') return;
 $('exportScope').value = state.scope === 'range' ? 'range' : 'all';
 $('exportPreset').value = Object.hasOwn(figurePresets, state.preset) ? state.preset : 'current';
 $('exportPngBackground').value = state.background === 'transparent' ? 'transparent' : 'white';
 for (const [id, value] of [['exportStart', state.start], ['exportEnd', state.end]]) {
  if (['number', 'string'].includes(typeof value) && /^\d*$/.test(String(value))) {
   $(id).value = String(value);
  }
 }
 if (Array.isArray(state.names)) {
  const selected = new Set(state.names);
  for (const input of $('exportNames').querySelectorAll('input')) {
   input.checked = selected.has(input.value);
  }
 }
 updateFigureExport();
}

function getFigureOptions() {
 const state = getFigureExportState();
 const isRange = state.scope === 'range';
 const rangeStart = isRange ? Number(state.start) : 1;
 const rangeEnd = isRange ? Number(state.end) : data.total;
 if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) ||
     rangeStart < 1 || rangeEnd < rangeStart || rangeEnd > data.total) {
  throw Error(`請輸入 1 到 ${data.total} 之間的起訖欄位，並確認起點不大於終點。`);
 }
 const names = isRange ? state.names : [...data.seqs.keys()];
 if (!names.length) throw Error('請至少選擇一條要匯出的序列。');
 const {padding, scale, ...layout} = figurePresets[state.preset];
 return {
  settings: {...settings(), ...layout},
  start: rangeStart - 1,
  end: rangeEnd,
  names,
  padding,
  scale,
  background: state.background,
 };
}

function updateFigureExport() {
 $('exportRange').hidden = $('exportScope').value !== 'range';
 let status = '';
 let invalid = false;
 if (data) {
  try {
   const options = getFigureOptions();
   status = `${options.names.length} 條序列 · 欄位 ${options.start + 1}–${options.end}`;
  } catch (error) {
   status = error.message;
   invalid = true;
  }
 }
 $('exportStatus').textContent = status;
 $('exportStatus').className = invalid ? 'error' : 'hint';
}

function resetFigureExport() {
 const sequenceList = $('exportNames');
 sequenceList.replaceChildren();
 $('exportPng').disabled = !data;
 if (!data) {
  updateFigureExport();
  return;
 }
 $('exportStart').max = data.total;
 $('exportEnd').max = data.total;
 $('exportStart').value = '1';
 $('exportEnd').value = data.total;
 for (const name of data.seqs.keys()) {
  const label = document.createElement('label');
  label.className = 'checkrow';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = true;
  input.value = name;
  label.append(input, document.createTextNode(name));
  sequenceList.append(label);
 }
 updateFigureExport();
}

function getFigureMarkup(options) {
 const tracks = typeof tracksForVisibleNames === 'function'
  ? tracksForVisibleNames(allTracks(data), options.names)
  : allTracks(data);
 return buildAlignment(data, options.settings, tracks, {...options, interactive: false});
}

function getFigureEvidence(tag, options) {
 const report = evidenceReport();
 const selected = new Set(options.names);
 report.records = report.records.filter(record => {
  if (!selected.has(record.sequenceId)) return false;
  const columns = record.currentResidues
   ? residueColumns(data.seqs.get(record.sequenceId), ...record.currentResidues)
   : record.originalAlignmentColumns || [];
  return columns.some(column => column > options.start && column <= options.end);
 });
 return report.records.length
  ? `<${tag} id="tm-source-evidence">${escapeHTML(JSON.stringify(report))}</${tag}>`
  : '';
}

function getFigureTitle(options) {
 return `蛋白質序列比對 · 欄位 ${options.start + 1}–${options.end}`;
}

function makeFigureContainer(options) {
 const container = document.createElement('div');
 container.className = 'figure-output';
 container.style.setProperty('--figure-padding', `${options.padding}px`);
 container.innerHTML = getFigureMarkup(options);
 return container;
}

function htmlFigure(options) {
 const styles = [...document.querySelectorAll('style')].map(style => style.textContent).join('\n');
 const figure = makeFigureContainer(options);
 const title = getFigureTitle(options);
 return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${styles}</style></head><body class="figure-document"><h1>${title}</h1>${figure.outerHTML}${getFigureEvidence('template', options)}</body></html>`;
}

// Read the shared, non-interactive alignment layout and emit editable SVG text and shapes.
function svgFigure(options, transparent = false) {
 const holder = makeFigureContainer(options);
 holder.classList.add('figure-measure');
 holder.setAttribute('aria-hidden', 'true');
 document.body.append(holder);
 try {
  const alignment = holder.querySelector('.alignment');
  const bounds = alignment.getBoundingClientRect();
  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  const context = document.createElement('canvas').getContext('2d');
  const fonts = new Map();
  const clipPaths = [];
  const shapes = [];
  const decimal = value => Number(value.toFixed(3));
  function svgText(node, {clip = false, center = false} = {}) {
   const value = node.textContent;
   if (!value.trim()) return '';
   const style = getComputedStyle(node);
   const box = node.getBoundingClientRect();
   const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
   if (!fonts.has(font)) {
    context.font = font;
    const {fontBoundingBoxAscent, fontBoundingBoxDescent} = context.measureText('Mg');
    fonts.set(font, (fontBoundingBoxAscent - fontBoundingBoxDescent) / 2 || parseFloat(style.fontSize) * .3);
   }
   const x = decimal(box.left - bounds.left + (center ? box.width / 2 : 0));
   const y = decimal(box.top - bounds.top + box.height / 2 + fonts.get(font));
   const attrs = [];
   if (clip && node.scrollWidth > node.clientWidth) {
    const id = `figure-clip-${clipPaths.length + 1}`;
    clipPaths.push(`<clipPath id="${id}"><rect x="${decimal(box.left - bounds.left)}" y="${decimal(box.top - bounds.top)}" width="${decimal(box.width)}" height="${decimal(box.height)}"/></clipPath>`);
    attrs.push(`clip-path="url(#${id})"`);
   }
   if (center) attrs.push('text-anchor="middle"');
   return `<text x="${x}" y="${y}" fill="${style.color}" font-family="${escapeHTML(style.fontFamily)}" font-size="${parseFloat(style.fontSize)}" font-weight="${style.fontWeight}" xml:space="preserve" ${attrs.join(' ')}>${escapeHTML(value)}</text>`;
  }
  for (const line of alignment.querySelectorAll('.aln-line, .aln-track')) {
   for (const item of line.children) {
    if (item.matches('.aln-name, .aln-count, .track-label')) {
     shapes.push(svgText(item, {clip: true}));
    } else if (item.matches('.aln-seq')) {
     if (!item.children.length) {
      shapes.push(svgText(item));
      continue;
     }
     for (const segment of item.children) {
      if (segment.matches('.track-space')) continue;
      if (!segment.matches('.track-run')) {
       shapes.push(svgText(segment));
       continue;
      }
      const box = segment.getBoundingClientRect();
      const style = getComputedStyle(segment);
      shapes.push(`<rect x="${decimal(box.left - bounds.left)}" y="${decimal(box.top - bounds.top)}" width="${decimal(box.width)}" height="${decimal(box.height)}" rx="${parseFloat(style.borderTopLeftRadius) || 0}" fill="${style.backgroundColor}"><title>${escapeHTML(segment.title)}</title></rect>`);
      const label = segment.querySelector('.track-run-label');
      if (label) shapes.push(svgText(label, {clip: true, center: true}));
     }
    }
   }
  }
  const background = transparent ? '' : '<rect width="100%" height="100%" fill="white"/>';
  const metadata = getFigureEvidence('metadata', options);
  const definitions = clipPaths.length ? `<defs>${clipPaths.join('')}</defs>` : '';
  return {
   width,
   height,
   markup: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${getFigureTitle(options)}</title>${metadata}${definitions}${background}${shapes.join('')}</svg>`,
  };
 } finally {
  holder.remove();
 }
}

async function pngFigure(options) {
 const {width, height, markup} = svgFigure(options, options.background === 'transparent');
 const pngWidth = Math.ceil(width * options.scale);
 const pngHeight = Math.ceil(height * options.scale);
 if (pngWidth > 8192 || pngHeight > 8192 || pngWidth * pngHeight > 32_000_000) {
  throw Error('PNG 尺寸過大，請縮小匯出範圍、選擇目前預覽尺寸，或改用 SVG。');
 }
 const url = URL.createObjectURL(new Blob([markup], {type: 'image/svg+xml;charset=utf-8'}));
 try {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = pngWidth;
  canvas.height = pngHeight;
  canvas.getContext('2d').drawImage(image, 0, 0, pngWidth, pngHeight);
  return await new Promise((resolve, reject) => {
   canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('無法建立 PNG 圖檔。')), 'image/png');
  });
 } finally {
  URL.revokeObjectURL(url);
 }
}

function prepareFigurePrint(options) {
 if ($('alignmentPrint')) return;
 const figure = makeFigureContainer(options);
 figure.id = 'alignmentPrint';
 const title = document.createElement('h1');
 title.textContent = getFigureTitle(options);
 figure.prepend(title);
 document.body.append(figure);
 figure.classList.add('figure-measure');
 const width = figure.querySelector('.alignment').getBoundingClientRect().width;
 figure.classList.remove('figure-measure');
 figure.style.setProperty('--figure-print-scale', Math.min(1, 930 / width));
 document.body.classList.add('figure-print-active');
}

function clearFigurePrint() {
 $('alignmentPrint')?.remove();
 document.body.classList.remove('figure-print-active');
}

function figureError(error) {
 $('exportStatus').className = 'error';
 $('exportStatus').textContent = error.message || '無法匯出圖檔。';
}

async function downloadFigure(format) {
 if (!data) return;
 try {
  updateFigureExport();
  const options = getFigureOptions();
  if (format === 'html') {
   saveBlob(htmlFigure(options), 'text/html;charset=utf-8', 'protein_alignment_colored.html');
  } else if (format === 'svg') {
   saveBlob(svgFigure(options).markup, 'image/svg+xml;charset=utf-8', 'protein_alignment_colored.svg');
  } else {
   saveBlob(await pngFigure(options), 'image/png', 'protein_alignment_colored.png');
  }
 } catch (error) {
  figureError(error);
 }
}

document.addEventListener('alignmentloaded', resetFigureExport);
$('figureExport').addEventListener('input', event => {
 updateFigureExport();
 document.dispatchEvent(new CustomEvent('projectchange', {detail: {target: event.target}}));
});
$('exportHtml').onclick = () => downloadFigure('html');
$('exportSvg').onclick = () => downloadFigure('svg');
$('exportPng').onclick = () => downloadFigure('png');
$('print').onclick = () => {
 if (!data) return;
 try {
  prepareFigurePrint(getFigureOptions());
  window.print();
 } catch (error) {
  clearFigurePrint();
  figureError(error);
 }
};
window.addEventListener('beforeprint', () => {
 if (!data) return;
 try {
  prepareFigurePrint(getFigureOptions());
 } catch (error) {
  clearFigurePrint();
  figureError(error);
 }
});
window.addEventListener('afterprint', clearFigurePrint);
