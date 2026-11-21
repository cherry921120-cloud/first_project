'use strict';

(() => {
  const format = 'clustal-layout-project';
  const version = 1;
  const controlIds = [
    'cols', 'font', 'palette', 'showCons', 'showCount', 'showStart', 'showRuler', 'showGap',
    'cornerRadius', 'tmView', 'tmRule', 'tmReference', 'tmMajorityKind', 'tmMajorityValue',
    'tmInput', 'tmAbsent', 'tmConsensusOverride', 'tmStyleTarget', 'tmSource', 'tmNotes', 'tmAcc'
  ];
  const membershipIds = ['tmGenes', 'tmIndividualGenes'];
  const styleModes = ['individual', 'consensus'];
  const undo = [];
  const redo = [];
  const historyLimit = 30;
  let current;
  let batch = null;
  let restoring = false;

  const copy = value => structuredClone(value);
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isString = value => typeof value === 'string';
  const isBoolean = value => typeof value === 'boolean';
  const isColor = value => isString(value) && /^#[0-9a-f]{6}$/i.test(value);
  const isId = value => Number.isSafeInteger(value) && value > 0;
  const listOf = (value, accepts) => Array.isArray(value) && value.every(accepts);
  const pairsOf = (value, accepts) => listOf(value, pair =>
    Array.isArray(pair) && pair.length === 2 && isString(pair[0]) && accepts(pair[1])
  );
  const uniqueIds = items => new Set(items.map(item => item.id)).size === items.length;

  function checkedValues(id) {
    return [...$(id).querySelectorAll('input:checked')].map(input => input.value);
  }

  function capture() {
    return copy({
      controls: Object.fromEntries(controlIds.map(id => {
        const input = $(id);
        return [id, input.type === 'checkbox' ? input.checked : input.value];
      })),
      memberships: Object.fromEntries(membershipIds.map(id => [id, checkedValues(id)])),
      groups,
      styles: tmAppearance,
      geneStyles: [...tmGeneAppearance],
      regionColors: Object.fromEntries(styleModes.map(mode => [mode, [...tmRegionColors[mode]]])),
      evidence: [...tmEvidence],
      uniProtLookups: [...tmUniProtLookups],
      annotationSources: [...tmAnnotationSources],
      lookup: [...$('tmLookupInputs').querySelectorAll('[data-lookup]')].map(card => [
        card.dataset.lookup, {
          gene: card.querySelector('[data-gene]').value,
          species: card.querySelector('[data-species]').value
        }
      ]),
      view: getAlignmentViewState(),
      figure: getFigureExportState()
    });
  }

  function validGroup(group) {
    return isRecord(group) && isId(group.id) && isString(group.name)
      && ['visible', 'expanded', 'showRegionLabels'].every(key => isBoolean(group[key]))
      && isColor(group.labelColor) && Number.isFinite(group.labelSize)
      && listOf(group.genes, isString)
      && listOf(group.regions, region => isRecord(region) && isId(region.id)
        && isString(region.name) && isColor(region.color) && isBoolean(region.visible)
        && ['protein', 'alignment'].includes(region.mode)
        && Number.isFinite(region.start) && Number.isFinite(region.end))
      && uniqueIds(group.regions);
  }

  function validEvidence(record) {
    return isRecord(record) && isString(record.sequenceId) && isString(record.tm)
      && isString(record.source) && record.originalResidues?.length === 2
      && listOf(record.originalResidues, isId) && listOf(record.originalAlignmentColumns, isId)
      && ['accession', 'fileName', 'topologySegment'].every(key => record[key] === undefined || isString(record[key]))
      && (record.feature === undefined || (isRecord(record.feature)
        && (record.feature.evidences == null || listOf(record.feature.evidences, item =>
          isRecord(item) && ['evidenceCode', 'source', 'id'].every(key =>
            item[key] == null || isString(item[key]) || Number.isFinite(item[key]))))));
  }

  function validStyle(style, gene = false) {
    if (!isRecord(style)) return false;
    return Object.entries(style).every(([key, value]) => {
      if (gene) {
        if (key === 'color' || key === 'labelColor') return isColor(value);
        if (key === 'radius') return Number.isFinite(value) && value >= 0 && value <= 20;
        return key === 'labelSize' && Number.isFinite(value) && value >= 6 && value <= 24;
      }
      if (!tmAppearanceControls.includes(key)) return false;
      if (key === 'tmColor' || key === 'tmLabelColor') return isColor(value);
      return ['tmShowLabel', 'tmShowTrackLabel'].includes(key) ? isBoolean(value) : isString(value);
    });
  }

  function validUniProtLookup(record) {
    return isRecord(record)
      && ['sequenceId', 'accession', 'proteinName', 'geneName', 'organism', 'entryType', 'release', 'retrievedAt']
        .every(key => isString(record[key]))
      && isId(record.length) && Number.isSafeInteger(record.tmCount) && record.tmCount >= 0;
  }

  function validControl(id, value) {
    const input = $(id);
    if (input.type === 'checkbox') return isBoolean(value);
    if (!isString(value)) return false;
    if (input.tagName === 'SELECT' && id !== 'tmReference') {
      return [...input.options].some(option => option.value === value);
    }
    return true;
  }

  function validate(project) {
    if (!isRecord(project) || project.format !== format || project.version !== version) {
      throw Error('這不是目前版本支援的 Clustal 排版專案檔。');
    }
    const { alignment, state } = project;
    if (!isRecord(alignment) || !isString(alignment.name) || !isString(alignment.text)
      || !isRecord(state) || !isRecord(state.controls) || !isRecord(state.memberships)
      || !controlIds.every(id => validControl(id, state.controls[id]))
      || !membershipIds.every(id => listOf(state.memberships[id], isString))
      || !listOf(state.groups, validGroup) || !uniqueIds(state.groups)
      || !isRecord(state.styles) || !styleModes.every(mode => validStyle(state.styles[mode]))
      || !pairsOf(state.geneStyles, value => validStyle(value, true))
      || !pairsOf(state.evidence, validEvidence)
      || !pairsOf(state.annotationSources, value => ['manual', 'uniprot', 'deeptmhmm'].includes(value))
      || !pairsOf(state.lookup, value => isRecord(value) && isString(value.gene) && isString(value.species))) {
      throw Error('專案檔的排版或標註資料不完整。');
    }
    if (state.regionColors !== undefined && (!isRecord(state.regionColors)
      || !styleModes.every(mode => pairsOf(state.regionColors[mode], isColor)))) {
      throw Error('專案檔的 TM 區段顏色設定有誤。');
    }
    if (state.uniProtLookups !== undefined && !pairsOf(state.uniProtLookups, validUniProtLookup)) {
      throw Error('專案檔的 UniProt 查閱資料有誤。');
    }
    if (!isRecord(state.view) || !isString(state.view.search)
      || !listOf(state.view.hiddenNames, isString)) {
      throw Error('專案檔的序列顯示設定有誤。');
    }
    if (!isRecord(state.figure)
      || !['scope', 'start', 'end', 'preset', 'background'].every(key => isString(state.figure[key]))
      || (state.figure.uniProtReport !== undefined && !isBoolean(state.figure.uniProtReport))
      || !listOf(state.figure.names, isString)) {
      throw Error('專案檔的匯出設定有誤。');
    }
    return project;
  }

  function replaceMap(target, entries) {
    target.clear();
    for (const [key, value] of entries) target.set(key, value);
  }

  function apply(state) {
    const next = copy(state);
    groups = next.groups;
    for (const group of groups) {
      groupSerial = Math.max(groupSerial, group.id);
      for (const region of group.regions) regionSerial = Math.max(regionSerial, region.id);
    }
    for (const [id, value] of Object.entries(next.controls)) {
      if (!controlIds.includes(id)) continue;
      const input = $(id);
      if (input.type === 'checkbox') input.checked = value;
      else if (id !== 'tmReference' || [...input.options].some(option => option.value === value)) input.value = value;
    }
    for (const id of membershipIds) {
      const values = new Set(next.memberships[id]);
      for (const input of $(id).querySelectorAll('input')) input.checked = values.has(input.value);
    }
    for (const mode of styleModes) {
      tmAppearance[mode] = next.styles[mode];
      replaceMap(tmRegionColors[mode], next.regionColors?.[mode] ?? []);
    }
    replaceMap(tmGeneAppearance, next.geneStyles);
    replaceMap(tmEvidence, next.evidence);
    replaceMap(tmUniProtLookups, next.uniProtLookups ?? []);
    replaceMap(tmAnnotationSources, next.annotationSources);
    const lookup = new Map(next.lookup);
    for (const card of $('tmLookupInputs').querySelectorAll('[data-lookup]')) {
      const value = lookup.get(card.dataset.lookup);
      if (value) {
        card.querySelector('[data-gene]').value = value.gene;
        card.querySelector('[data-species]').value = value.species;
      }
    }
    setAlignmentViewState(next.view);
    setFigureExportState(next.figure);
    $('radiusValue').textContent = $('cornerRadius').value + ' px';
    renderGroups();
    tmFinishAnnotationEdit();
    renderTmAnnotationTable();
    renderTmEvidence();
    updateTmSource();
    updateTmControls();
  }

  function refreshButtons() {
    $('projectSave').disabled = !data;
    $('projectUndo').disabled = !undo.length;
    $('projectRedo').disabled = !redo.length;
  }

  function announce(message, error = false) {
    const status = $('projectStatus');
    status.textContent = message;
    status.className = error ? 'error' : 'hint';
  }

  function resetHistory() {
    undo.length = 0;
    redo.length = 0;
    current = capture();
    batch = null;
    refreshButtons();
  }

  function record(target = null) {
    if (restoring) return;
    const next = capture();
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    if (!target || batch?.target !== target || performance.now() - batch.time > 600) {
      undo.push(current);
      if (undo.length > historyLimit) undo.shift();
    }
    batch = target ? { target, time: performance.now() } : null;
    current = next;
    redo.length = 0;
    refreshButtons();
  }

  function moveHistory(from, to, message) {
    if (!from.length) return;
    batch = null;
    to.push(current);
    current = from.pop();
    restoring = true;
    try {
      apply(current);
      announce(message);
    } finally {
      restoring = false;
      refreshButtons();
    }
  }

  function tracksField(input) {
    return controlIds.includes(input.id) || tmAppearanceControls.includes(input.id)
      || input.matches('#groups [data-act], #tmGenes input, #tmIndividualGenes input, #tmGeneStyles input, #tmLookupInputs input');
  }

  document.addEventListener('alignmentloaded', () => {
    if (!restoring) {
      resetHistory();
      announce('');
    }
  });
  document.addEventListener('projectchange', event => record(event.detail?.target || null));
  document.addEventListener('input', ({ target }) => {
    if (tracksField(target)) record(target);
  });
  document.addEventListener('change', ({ target }) => {
    if (tracksField(target)) {
      record(target);
      batch = null;
    }
  });
  document.addEventListener('click', event => {
    if (event.target.closest('#addGroup, button[data-act], [data-tm-reset]')) record();
  });

  $('projectUndo').onclick = () => moveHistory(undo, redo, '已復原上一項變更。');
  $('projectRedo').onclick = () => moveHistory(redo, undo, '已重做上一項變更。');
  $('projectSave').onclick = () => {
    if (!data) return;
    const project = {
      format, version,
      alignment: { name: alignmentSourceName, text: alignmentSourceText },
      state: capture()
    };
    saveBlob(JSON.stringify(project, null, 2) + '\n', 'application/json;charset=utf-8', 'clustal-project.json');
    announce('已下載專案檔，內含比對資料與目前設定。');
  };
  $('projectOpen').onchange = async event => {
    const input = event.target;
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const revision = ++alignmentImportRequest;
    let installing = false;
    try {
      const source = await file.text();
      if (revision !== alignmentImportRequest) return;
      let project;
      try {
        project = validate(JSON.parse(source.replace(/^\uFEFF/, '')));
      } catch (error) {
        if (error instanceof SyntaxError) throw Error('無法讀取 JSON，請選擇從本工具下載的專案檔。');
        throw error;
      }
      restoring = installing = true;
      try {
        if (!setData(project.alignment.text, project.alignment.name)) {
          throw Error('專案中的比對資料無法讀取。' + $('status').textContent);
        }
        apply(project.state);
        resetHistory();
      } finally {
        restoring = false;
      }
      announce('已開啟專案並還原排版與標註。');
    } catch (error) {
      if (revision === alignmentImportRequest || installing) announce(error.message, true);
    }
  };

  resetHistory();
})();
