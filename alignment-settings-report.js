'use strict';

function captureAlignmentReportSettings(options) {
 const value = id => $(id).value;
 const label = id => $(id).selectedOptions[0]?.textContent.trim();
 const checked = id => [...$(id).querySelectorAll('input:checked')].map(input => input.value);
 const layout = settings();
 const figure = getFigureExportState();
 const view = getAlignmentViewState();
 const mode = value('tmView');
 const showConsensus = mode === 'both' || mode === 'consensus';
 const rule = value('tmRule');
 const reference = value('tmReference');
 const selected = checked('tmGenes');
 const comparisonNames = rule === 'reference'
  ? (data.seqs.has(reference) ? [reference] : [])
  : selected;
 const majorityKind = value('tmMajorityKind');
 const majorityValue = value('tmMajorityValue');
 const rows = parseTmAnnotations(data).map(row => ({
  ...row,
  source: tmAnnotationSourceLabels.get(tmAnnotationSource(row.key)) || '未記錄',
  status: tmAnnotationStatusLabels.get(tmAnnotationState(row)) || '未記錄',
 }));
 const {rangesByRegion, errors} = readTmConsensusOverrides(data.total);
 const styles = ['individual', 'consensus'].map(target => {
  const style = tmStyle(target);
  return {
   target,
   ...style,
   aliases: [...style.aliases],
   hidden: [...style.hidden],
   colors: [...tmRegionColors[target]],
  };
 });
 const extent = {
  source: alignmentSourceName,
  sequenceCount: data.seqs.size,
  columnCount: data.total,
  format: options.format,
  scope: label('exportScope'),
  start: options.start + 1,
  end: options.end,
  names: [...options.names],
  configuredRange: [figure.start, figure.end],
  configuredNames: [...figure.names],
  isRange: figure.scope === 'range',
  preset: label('exportPreset'),
  padding: options.padding,
  scale: options.scale,
  background: label('exportPngBackground'),
  appendix: figure.alignmentReport,
 };
 const rawThreshold = Number(majorityValue);
 let appliedMethod = label('tmRule');
 if (!showConsensus) appliedMethod = '未啟用 Consensus TM';
 else if (rows.some(row => row.problem)) appliedMethod = '未運算，請先修正 TM 座標表中的錯誤';
 else if (!comparisonNames.length) appliedMethod = '未運算，沒有適用的比較序列';
 else if (rule === 'majority' && majorityKind !== 'strict' && (
  !Number.isInteger(rawThreshold) || rawThreshold < 1 || (majorityKind === 'percent' && rawThreshold > 100)
 )) appliedMethod = 'Majority 門檻無效，僅能顯示有效的手動修正區段';

 return {
  extent,
  layout,
  exportLayout: {...options.settings},
  layoutInputs: [value('cols'), value('font')],
  palette: label('palette'),
  view: {...view, shown: getAlignmentVisibleNames()},
  groups: groups.map(group => ({
   ...group,
   genes: [...group.genes],
   regions: group.regions.map(region => ({...region})),
  })),
  tm: {
   mode: label('tmView'),
   showConsensus,
   rule,
   ruleLabel: label('tmRule'),
   appliedMethod,
   reference,
   comparisonNames,
   selected,
   individuals: checked('tmIndividualGenes'),
   majorityKind,
   majorityValue,
   absent: value('tmAbsent'),
   overrides: [...rangesByRegion],
   overrideErrors: errors,
   annotationFilter: [label('tmAnnotationSource'), label('tmAnnotationStatus')],
   summary: showConsensus ? $('tmStatus').textContent : '',
  },
  rows,
  styleTarget: label('tmStyleTarget'),
  styles,
  geneStyles: [...tmGeneAppearance].map(([name, style]) => [name, {...style}]),
  source: {
   label: label('tmSource'),
   notes: value('tmNotes'),
   accession: value('tmAcc'),
   lookup: [...$('tmLookupInputs').querySelectorAll('[data-lookup]')].map(card => [
    card.dataset.lookup, card.querySelector('[data-gene]').value, card.querySelector('[data-species]').value,
   ]),
  },
 };
}

function alignmentSettingsReportBody(snapshot, headingTag = 'h2') {
 const {extent, layout, exportLayout, layoutInputs, palette, view, groups, tm, rows, styles, geneStyles, source} = snapshot;
 const titleTag = headingTag === 'h3' ? 'h3' : 'h2';
 const sectionTag = titleTag === 'h2' ? 'h3' : 'h4';
 const detailTag = sectionTag === 'h3' ? 'h4' : 'h5';
 const text = value => {
  const string = value === null || value === undefined ? '' : String(value);
  return escapeHTML(string.trim() || '—').replace(/\r?\n/g, '<br>');
 };
 const onOff = value => value ? '開啟' : '關閉';
 const visible = value => value ? '顯示' : '隱藏';
 const names = values => values.length ? values.join('、') : '無';
 const unit = (number, symbol = 'px') => number === undefined ? '沿用預設' : `${number} ${symbol}`;
 const range = (start, end) => start === end ? String(start) : `${start}–${end}`;
 const coordinate = value => {
  if (value === 'alignment') return 'Alignment 比對欄位（含 gap）';
  if (value === 'peptide' || value === 'protein') return 'Peptide 胺基酸位置（不含 gap）';
  return value;
 };
 const section = (title, html) =>
  `<section class="uniprot-report-entries"><${sectionTag}>${text(title)}</${sectionTag}>${html}</section>`;
 const table = (label, headings, entries, empty = '無資料。') =>
  entries.length ? `<div class="uniprot-report-table-wrap"><table class="uniprot-report-table" aria-label="${escapeHTML(label)}">
   ${headings ? `<thead><tr>${headings.map(heading => `<th scope="col">${text(heading)}</th>`).join('')}</tr></thead>` : ''}
   <tbody>${entries.map(([heading, ...cells]) => `<tr><th scope="row">${text(heading)}</th>${cells.map(cell => `<td>${text(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>` : `<p>${text(empty)}</p>`;

 const formatName = new Map([['html', 'HTML'], ['svg', 'SVG'], ['png', 'PNG'], ['pdf', '列印／PDF']]);
 const figureSettings = [
  ['匯出範圍', extent.scope],
  ['實際匯出比對欄位', range(extent.start, extent.end)],
  ['實際匯出序列', `${extent.names.length} 條：${names(extent.names)}`],
  ['出圖預設', extent.preset],
  ['出圖邊距', unit(extent.padding)],
  ['PNG 倍率與背景', `${extent.scale}× · ${extent.background}${extent.format && extent.format !== 'png' ? '（本次未套用）' : ''}`],
  ['附上查閱報告', onOff(extent.appendix)],
 ];
 if (extent.format) figureSettings.unshift(['圖檔格式', formatName.get(extent.format) ?? extent.format]);
 if (!extent.isRange && extent.configuredRange.every(Boolean)) {
  figureSettings.push(['暫存的自訂匯出欄位（本次未套用）', range(...extent.configuredRange)],
   ['暫存的自訂匯出序列（本次未套用）', names(extent.configuredNames)]);
 }
 const layoutSettings = [
  ['比對來源', extent.source, extent.source],
  ['每排欄位數', layout.cols, exportLayout.cols],
  ['字體大小', unit(layout.font), unit(exportLayout.font)],
  ['胺基酸配色', palette, palette],
  ['顯示原始保守性符號 * : .', onOff(layout.showCons), onOff(exportLayout.showCons)],
  ['顯示各行末端胺基酸位置', onOff(layout.showCount), onOff(exportLayout.showCount)],
  ['顯示各行起始胺基酸位置', onOff(layout.showStart), onOff(exportLayout.showStart)],
  ['顯示比對欄位尺規', onOff(layout.showRuler), onOff(exportLayout.showRuler)],
  ['顯示 gap（-）', onOff(layout.showGap), onOff(exportLayout.showGap)],
  ['自訂區段色條圓角', unit(layout.radius), unit(exportLayout.radius)],
 ];
 const viewSettings = [
  ['序列名稱搜尋', view.search],
  ['目前預覽顯示的序列', names(view.shown)],
  ['目前預覽隱藏的序列', names(view.hiddenNames)],
 ];
 const groupSettings = groups.map((group, index) => {
  const name = group.name || `未命名群組 ${index + 1}`;
  const fields = [
   ['群組可見性', visible(group.visible)],
   ['套用序列', names(group.genes)],
   ['色條內顯示區段名稱', onOff(group.showRegionLabels)],
   ['色條文字', `${group.labelColor} · ${unit(group.labelSize)}`],
  ];
  const regions = group.regions.map(region => [
   region.name, coordinate(region.mode), range(region.start, region.end), region.color,
   group.visible ? visible(region.visible) : `${visible(region.visible)}（群組已隱藏）`,
  ]);
  return `<${detailTag}>${text(name)}</${detailTag}>${table(`${name} 群組設定`, null, fields)}
   ${table(`${name} 的區段`, ['區段名稱','座標類型','座標範圍','色條顏色','可見性'], regions, '此群組沒有設定區段。')}`;
 }).join('');
 const thresholdLabel = tm.majorityKind === 'count' ? `至少 ${tm.majorityValue} 條`
  : tm.majorityKind === 'percent' ? `至少 ${tm.majorityValue}%` : '嚴格過半（超過有效序列的 50%）';
 const tmSettings = [
  ['TM 顯示模式', tm.mode],
  ['Individual TM 勾選的序列', names(tm.individuals)],
  ['已設定的 Consensus 方法', tm.ruleLabel],
  ['實際比較方式', tm.appliedMethod],
  ['Consensus TM 勾選的序列', names(tm.selected)],
  ['依所選方法參與比較的序列', tm.showConsensus ? names(tm.comparisonNames) : '無'],
  ['參考序列', tm.reference],
  ['Majority 門檻', `${thresholdLabel}${tm.showConsensus && tm.rule === 'majority' ? '' : '（本次未套用）'}`],
  ['已確認無該 TM 的序列', tm.absent],
  ['TM 標註表篩選', tm.annotationFilter.join(' · ')],
 ];
 if (tm.summary) tmSettings.push(['目前的比較結果與提示', tm.summary]);
 const overrides = tm.overrides.map(([region, ranges]) => [
  region, ranges.map(bounds => range(...bounds)).join('、'),
 ]);
 const rowEntries = rows.map(row => [
  `${row.sequenceId || '未填序列 ID'} · ${row.region || '未填區段'}`,
  coordinate(row.coordinateType), `${row.start || '—'}–${row.end || '—'}`, row.source, row.problem || row.status,
 ]);
 const styleSettings = styles.map(style => {
  const title = style.target === 'consensus' ? 'Consensus TM' : 'Individual TM';
  const colorEntries = style.colors.map(([target, color]) => {
   const [sequence, region] = target.split(' ', 2);
   if (style.target === 'consensus') return [target, 'Consensus', color];
   return region ? [region, sequence, color] : [target, '所有同名區段', color];
  });
  return `<${detailTag}>${title}</${detailTag}>${table(`${title} 預設樣式`, null, [
   ['色條顏色', style.color],
   ['圓角', unit(style.radius)],
   ['文字顏色', style.labelColor],
   ['文字大小', unit(style.labelSize)],
   ['顯示色條左側名稱', onOff(style.showTrackLabel)],
   ['色條內顯示名稱', onOff(style.showLabel)],
   ['隱藏色條', names(style.hidden)],
  ])}
  ${style.aliases.length ? table(`${title} 顯示名稱`, ['區段或序列與區段', '顯示名稱'], style.aliases) : '<p>無自訂顯示名稱。</p>'}
  ${table(`${title} 區段顏色覆寫`, ['區段','套用範圍','自訂顏色'], colorEntries, '無區段顏色覆寫。')}`;
 }).join('');
 const geneEntries = geneStyles.map(([name, style]) => [
  name, style.color ?? '沿用預設', unit(style.radius), style.labelColor ?? '沿用預設', unit(style.labelSize),
 ]);
 return `<section class="uniprot-report-entries alignment-settings-report">
  <${titleTag}>排版與標註設定</${titleTag}>
  <p class="uniprot-report-meta">匯出當下的設定與資料，共 ${text(extent.sequenceCount)} 條序列、${text(extent.columnCount)} 個比對欄位。</p>
  ${section('匯出範圍與格式', table('匯出範圍與格式', null, figureSettings))}
  ${section('排版與預覽', table('排版設定', ['項目','預覽','匯出'], layoutSettings)
   + (String(layout.cols) === layoutInputs[0] && String(layout.font) === layoutInputs[1] ? '' :
    table('原始排版輸入', null, [['每排欄位輸入值',layoutInputs[0]],['字體大小輸入值',layoutInputs[1]]]))
   + table('預覽序列篩選', null, viewSettings))}
  ${section('自訂標註群組', groupSettings || '<p>無自訂標註群組。</p>')}
  ${section('TM 顯示與比較方式', table('TM 比較設定', null, tmSettings)
   + table('手動修正 Consensus 座標', ['TM 區段','手動修正的比對欄位'], overrides, '無手動修正的 Consensus 座標。')
   + (tm.overrideErrors.length ? `<p>${text(tm.overrideErrors.join('\n'))}</p>` : ''))}
  ${section('TM 座標表', table('TM 座標表', ['序列與區段','座標類型','起訖位置','來源','狀態'], rowEntries, '無 TM 標註。'))}
  ${section('TM 色條外觀', table('TM 色條編輯目標', null, [['目前的外觀編輯目標',snapshot.styleTarget]]) + styleSettings
   + `<${detailTag}>Individual TM 序列外觀覆寫</${detailTag}>`
   + table('Individual TM 序列外觀覆寫', ['序列','色條顏色','圓角','文字顏色','文字大小'], geneEntries, '無序列外觀覆寫。'))}
  ${section('TM 來源與查詢條件', table('TM 來源設定', null, [
   ['整體座標來源', source.label], ['來源備註', source.notes], ['UniProt accession 對照', source.accession],
  ]) + table('UniProt 查詢條件', ['序列','基因名','物種或分類 ID'], source.lookup, '無 UniProt 查詢條件。'))}
 </section>`;
}
