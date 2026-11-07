const state = {
  workspacePath: null,
  sessions: [],
  selectedSessionIdsForExport: new Set(),
  currentSession: null,
  queueState: {
    isPaused: false,
    isProcessing: false,
    items: []
  }
};

// Elementos da Interface
const workspacePathDisplay = document.getElementById('workspacePathDisplay');
const btnOpenWorkspace = document.getElementById('btnOpenWorkspace');
const btnExportDSpace = document.getElementById('btnExportDSpace');
const chkSelectAllSessions = document.getElementById('chkSelectAllSessions');
const btnNewSession = document.getElementById('btnNewSession');
const btnCloneSession = document.getElementById('btnCloneSession');
const sessionListContainer = document.getElementById('sessionListContainer');

const currentSessionHeader = document.getElementById('currentSessionHeader');
const currentSessionSubheader = document.getElementById('currentSessionSubheader');
const btnDeleteSession = document.getElementById('btnDeleteSession');
const btnSaveSession = document.getElementById('btnSaveSession');
const btnAddAbstract = document.getElementById('btnAddAbstract');

const btnAttachMedia = document.getElementById('btnAttachMedia');
const mediaListContainer = document.getElementById('mediaListContainer');
const mimeTypesContainer = document.getElementById('mimeTypesContainer');

const btnTogglePauseQueue = document.getElementById('btnTogglePauseQueue');
const btnClearFinishedQueue = document.getElementById('btnClearFinishedQueue');
const queueListContainer = document.getElementById('queueListContainer');
const toastContainer = document.getElementById('toastContainer');

// Mapeamento dos campos simples do formulário Dublin Core
const singleFieldMap = {
  'dc.title': document.getElementById('dc_title'),
  'dc.type': document.getElementById('dc_type'),
  'dc.identifier.other': document.getElementById('dc_identifier_other'),
  'dc.identifier.uri': document.getElementById('dc_identifier_uri'),
  'dc.date.created': document.getElementById('dc_date_created'),
  'dc.date.issued': document.getElementById('dc_date_issued'),
  'dc.date.accessioned': document.getElementById('dc_date_accessioned'),
  'dc.date.available': document.getElementById('dc_date_available'),
  'dc.publisher': document.getElementById('dc_publisher'),
  'dc.description.sponsorship': document.getElementById('dc_description_sponsorship')
};

// Mapeamento dos campos de múltiplos valores
const multiFieldContainers = {
  'dc.contributor.advisor': document.getElementById('list_dc_contributor_advisor'),
  'dc.language': document.getElementById('list_dc_language'),
  'dc.language.iso': document.getElementById('list_dc_language_iso'),
  'dc.coverage.spatial': document.getElementById('list_dc_coverage_spatial'),
  'dc.subject': document.getElementById('list_dc_subject'),
  'dc.subject.other': document.getElementById('list_dc_subject_other')
};

const abstractContainer = document.getElementById('list_dc_description_abstract');

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'success') toast.style.borderLeftColor = '#10b981';
  if (type === 'error') toast.style.borderLeftColor = '#ef4444';
  if (type === 'warning') toast.style.borderLeftColor = '#f59e0b';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3600);
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function setFormEnabled(enabled) {
  Object.values(singleFieldMap).forEach((el) => {
    if (el) el.disabled = !enabled;
  });
  document.querySelectorAll('.btn-add-multi').forEach((btn) => {
    btn.disabled = !enabled;
  });
  btnAddAbstract.disabled = !enabled;
  btnSaveSession.disabled = !enabled;
  btnDeleteSession.disabled = !enabled;
  btnCloneSession.disabled = !enabled;
  btnAttachMedia.disabled = !enabled;
}

/**
 * Renderiza uma lista dinâmica de inputs para campos multi-valor
 */
function renderMultiValueField(fieldKey, values = [''], enabled = true) {
  const container = multiFieldContainers[fieldKey];
  if (!container) return;
  container.innerHTML = '';

  const safeValues = Array.isArray(values) && values.length > 0 ? values : [''];

  safeValues.forEach((val, idx) => {
    const row = document.createElement('div');
    row.className = 'dynamic-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.value = val || '';
    input.disabled = !enabled;
    input.placeholder = getPlaceholderForField(fieldKey);

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn btn-outline btn-xs';
    btnRemove.textContent = '✕';
    btnRemove.disabled = !enabled || safeValues.length <= 1;
    btnRemove.onclick = () => {
      const currentVals = collectMultiValueFromDOM(fieldKey);
      currentVals.splice(idx, 1);
      renderMultiValueField(fieldKey, currentVals, enabled);
    };

    row.appendChild(input);
    row.appendChild(btnRemove);
    container.appendChild(row);
  });
}

function getPlaceholderForField(fieldKey) {
  const placeholders = {
    'dc.contributor.advisor': 'Nome do orientador / pesquisador (Sobrenome, Nome)',
    'dc.language': 'Ex: Português, Guarani, Yanomami...',
    'dc.language.iso': 'Ex: por, gug, guu...',
    'dc.coverage.spatial': 'Ex: Aldeia X, Município Y, Estado Z (Coordenadas)',
    'dc.subject': 'Ex: Fonologia, Narrativa Mítica, Etnobotânica...',
    'dc.subject.other': 'Ex: Tronco Tupi, Família Arawak...'
  };
  return placeholders[fieldKey] || '';
}

function collectMultiValueFromDOM(fieldKey) {
  const container = multiFieldContainers[fieldKey];
  if (!container) return [];
  const inputs = container.querySelectorAll('input');
  return Array.from(inputs).map((inp) => inp.value);
}

/**
 * Renderiza os blocos multi-uso de dc.description.abstract
 */
function renderAbstractBlocks(blocks = [], enabled = true) {
  abstractContainer.innerHTML = '';
  const defaultBlocks = [
    { category: 'Conteúdo', text: '' },
    { category: 'Participantes', text: '' },
    { category: 'Contexto Linguístico', text: '' }
  ];

  const normalizedBlocks =
    Array.isArray(blocks) && blocks.length > 0
      ? blocks.map((b) =>
          typeof b === 'object' && b !== null
            ? { category: b.category || 'Geral', text: b.text || '' }
            : { category: 'Resumo', text: String(b) }
        )
      : defaultBlocks;

  normalizedBlocks.forEach((block, idx) => {
    const row = document.createElement('div');
    row.className = 'abstract-row';

    const selectCat = document.createElement('select');
    selectCat.className = 'form-control abstract-category';
    selectCat.disabled = !enabled;
    const categories = [
      'Conteúdo',
      'Participantes',
      'Contexto Linguístico',
      'Equipamentos / Gravação',
      'Observações Gerais'
    ];
    if (!categories.includes(block.category)) {
      categories.push(block.category);
    }
    categories.forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (cat === block.category) opt.selected = true;
      selectCat.appendChild(opt);
    });

    const textarea = document.createElement('textarea');
    textarea.className = 'form-control abstract-text';
    textarea.value = block.text || '';
    textarea.disabled = !enabled;
    textarea.placeholder = `Descreva ${block.category.toLowerCase()} da sessão...`;

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn btn-outline btn-xs';
    btnRemove.textContent = '✕';
    btnRemove.disabled = !enabled || normalizedBlocks.length <= 1;
    btnRemove.onclick = () => {
      const current = collectAbstractBlocksFromDOM();
      current.splice(idx, 1);
      renderAbstractBlocks(current, enabled);
    };

    row.appendChild(selectCat);
    row.appendChild(textarea);
    row.appendChild(btnRemove);
    abstractContainer.appendChild(row);
  });
}

function collectAbstractBlocksFromDOM() {
  const rows = abstractContainer.querySelectorAll('.abstract-row');
  return Array.from(rows).map((row) => ({
    category: row.querySelector('.abstract-category').value,
    text: row.querySelector('.abstract-text').value
  }));
}

/**
 * Coleta todos os metadados preenchidos no formulário
 */
function collectFormMetadata() {
  const metadata = {};

  Object.entries(singleFieldMap).forEach(([key, el]) => {
    metadata[key] = el ? el.value : '';
  });

  Object.keys(multiFieldContainers).forEach((key) => {
    metadata[key] = collectMultiValueFromDOM(key);
  });

  metadata['dc.description.abstract'] = collectAbstractBlocksFromDOM();

  if (state.currentSession && state.currentSession.metadata) {
    metadata['dc.format.mimetype'] =
      state.currentSession.metadata['dc.format.mimetype'] || [];
  } else {
    metadata['dc.format.mimetype'] = [];
  }

  return metadata;
}

/**
 * Preenche o formulário com os dados da sessão carregada
 */
function populateFormWithSession(sessionData) {
  if (!sessionData) {
    setFormEnabled(false);
    currentSessionHeader.textContent = 'Nenhuma Sessão Selecionada';
    currentSessionSubheader.textContent = 'Selecione ou crie uma sessão na barra lateral';
    Object.values(singleFieldMap).forEach((el) => {
      if (el) el.value = '';
    });
    Object.keys(multiFieldContainers).forEach((k) =>
      renderMultiValueField(k, [''], false)
    );
    renderAbstractBlocks([], false);
    renderMimeTypes([]);
    renderMediaList([]);
    return;
  }

  setFormEnabled(true);
  const meta = sessionData.metadata || {};

  currentSessionHeader.textContent = `Sessão: ${sessionData.sessionId}`;
  currentSessionSubheader.textContent = `Arquivo: ${sessionData.sessionId}.json | Pasta de Mídias: ./${sessionData.sessionId}_midias/`;

  Object.entries(singleFieldMap).forEach(([key, el]) => {
    if (el) {
      el.value = meta[key] !== undefined && meta[key] !== null ? meta[key] : '';
    }
  });

  Object.keys(multiFieldContainers).forEach((key) => {
    const val = meta[key];
    const arr = Array.isArray(val) ? val : val ? [val] : [''];
    renderMultiValueField(key, arr, true);
  });

  renderAbstractBlocks(meta['dc.description.abstract'], true);
  renderMimeTypes(meta['dc.format.mimetype'] || []);
  renderMediaList(sessionData.mediaFiles || []);
}

function renderMimeTypes(mimeList = []) {
  mimeTypesContainer.innerHTML = '';
  if (!Array.isArray(mimeList) || mimeList.length === 0) {
    const empty = document.createElement('span');
    empty.style.color = 'var(--text-secondary)';
    empty.style.fontSize = '12px';
    empty.textContent =
      'Anexe arquivos de mídia à sessão para preencher automaticamente o MIME Type.';
    mimeTypesContainer.appendChild(empty);
    return;
  }

  mimeList.forEach((mimeStr) => {
    const chip = document.createElement('span');
    chip.className = 'mime-chip';
    chip.textContent = mimeStr;
    mimeTypesContainer.appendChild(chip);
  });
}

/**
 * Renderiza a barra lateral de sessões
 */
function renderSidebarSessions() {
  sessionListContainer.innerHTML = '';
  if (!state.workspacePath) {
    sessionListContainer.innerHTML =
      '<div class="empty-placeholder">Abra uma Pasta de Trabalho para listar ou criar sessões.</div>';
    btnExportDSpace.disabled = true;
    return;
  }

  if (state.sessions.length === 0) {
    sessionListContainer.innerHTML =
      '<div class="empty-placeholder">Nenhuma sessão encontrada nesta pasta.</div>';
    btnExportDSpace.disabled = true;
    return;
  }

  btnExportDSpace.disabled = state.selectedSessionIdsForExport.size === 0;

  state.sessions.forEach((sess) => {
    const item = document.createElement('div');
    const isActive =
      state.currentSession && state.currentSession.sessionId === sess.sessionId;
    item.className = `session-item${isActive ? ' active' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedSessionIdsForExport.has(sess.sessionId);
    checkbox.title = 'Selecionar para exportação DSpace SAF';
    checkbox.onclick = (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        state.selectedSessionIdsForExport.add(sess.sessionId);
      } else {
        state.selectedSessionIdsForExport.delete(sess.sessionId);
      }
      chkSelectAllSessions.checked =
        state.selectedSessionIdsForExport.size === state.sessions.length;
      btnExportDSpace.disabled = state.selectedSessionIdsForExport.size === 0;
    };

    const info = document.createElement('div');
    info.className = 'session-item-info';

    const topRow = document.createElement('div');
    topRow.className = 'session-item-id';

    const idSpan = document.createElement('span');
    idSpan.textContent = sess.sessionId;

    const countBadge = document.createElement('span');
    countBadge.className = 'badge-count';
    countBadge.textContent = `${sess.mediaCount} mídia(s)`;

    topRow.appendChild(idSpan);
    topRow.appendChild(countBadge);

    const titleRow = document.createElement('div');
    titleRow.className = 'session-item-title';
    titleRow.textContent = sess.title || 'Sem título';

    info.appendChild(topRow);
    info.appendChild(titleRow);

    item.appendChild(checkbox);
    item.appendChild(info);

    item.onclick = () => selectSession(sess.sessionId);

    sessionListContainer.appendChild(item);
  });
}

/**
 * Renderiza a lista de mídias anexadas à sessão atual
 */
function renderMediaList(mediaFiles = []) {
  mediaListContainer.innerHTML = '';

  if (!Array.isArray(mediaFiles) || mediaFiles.length === 0) {
    mediaListContainer.innerHTML =
      '<div class="empty-placeholder">Nenhuma mídia anexada.<br />Clique em "+ Anexar Mídia" para copiar arquivos para a pasta da sessão.</div>';
    return;
  }

  mediaFiles.forEach((media) => {
    const card = document.createElement('div');
    card.className = 'media-card';

    const top = document.createElement('div');
    top.className = 'media-card-top';

    const nameEl = document.createElement('div');
    nameEl.className = 'media-name';
    nameEl.textContent = media.fileName;
    nameEl.title = 'Clique para abrir na Janela de Decupagem';
    nameEl.onclick = () => openMediaInClipper(media);

    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '4px';

    const btnClip = document.createElement('button');
    btnClip.type = 'button';
    btnClip.className = 'btn btn-primary btn-xs';
    btnClip.textContent = '✂ Decupar';
    btnClip.onclick = () => openMediaInClipper(media);

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn btn-outline btn-xs';
    btnRemove.textContent = '✕';
    btnRemove.title = 'Remover mídia da sessão';
    btnRemove.onclick = () => handleRemoveMedia(media.relativePath);

    actionsDiv.appendChild(btnClip);
    actionsDiv.appendChild(btnRemove);

    top.appendChild(nameEl);
    top.appendChild(actionsDiv);

    const metaRow = document.createElement('div');
    metaRow.className = 'media-meta';

    const relSpan = document.createElement('span');
    relSpan.textContent = `${media.relativePath} (${formatBytes(media.size)})`;

    metaRow.appendChild(relSpan);

    if (media.isCut) {
      const cutBadge = document.createElement('span');
      cutBadge.className = 'cut-badge';
      cutBadge.textContent = `Recorte ${media.cutRange || ''}`;
      metaRow.appendChild(cutBadge);
    }

    card.appendChild(top);
    card.appendChild(metaRow);
    mediaListContainer.appendChild(card);
  });
}

/**
 * Renderiza a fila de processamento FFmpeg
 */
function renderQueue() {
  const { isPaused, items } = state.queueState;

  btnTogglePauseQueue.textContent = isPaused ? '▶ Retomar Fila' : '⏸ Pausar Fila';
  btnTogglePauseQueue.className = isPaused
    ? 'btn btn-success btn-xs'
    : 'btn btn-warning btn-xs';

  queueListContainer.innerHTML = '';

  if (!Array.isArray(items) || items.length === 0) {
    queueListContainer.innerHTML =
      '<div class="empty-placeholder">A fila de recortes está vazia.</div>';
    return;
  }

  items.forEach((job) => {
    const card = document.createElement('div');
    card.className = 'queue-card';

    const header = document.createElement('div');
    header.className = 'queue-card-header';

    const title = document.createElement('div');
    title.className = 'queue-title';
    title.title = job.outputFileName;
    title.textContent = job.outputFileName;

    const statusBadge = document.createElement('span');
    statusBadge.className = `status-pill status-${job.status}`;
    const statusLabels = {
      pending: 'Na Fila',
      processing: `${job.progress}%`,
      completed: 'Concluído',
      cancelled: 'Cancelado',
      error: 'Erro'
    };
    statusBadge.textContent = statusLabels[job.status] || job.status;

    header.appendChild(title);
    header.appendChild(statusBadge);

    const details = document.createElement('div');
    details.className = 'media-meta';
    details.innerHTML = `<span>Sessão: <strong>${job.sessionId}</strong> | ${job.startTime} &rarr; ${job.endTime}</span>`;

    if (job.status === 'pending' || job.status === 'processing') {
      const btnCancel = document.createElement('button');
      btnCancel.type = 'button';
      btnCancel.className = 'btn btn-danger btn-xs';
      btnCancel.textContent = 'Cancelar';
      btnCancel.onclick = async () => {
        await window.alimAPI.cancelQueueItem(job.id);
        showToast('Corte cancelado.', 'warning');
      };
      details.appendChild(btnCancel);
    }

    const progressTrack = document.createElement('div');
    progressTrack.className = 'progress-bar-track';

    const progressFill = document.createElement('div');
    progressFill.className = 'progress-bar-fill';
    progressFill.style.width = `${job.progress || 0}%`;

    progressTrack.appendChild(progressFill);

    card.appendChild(header);
    card.appendChild(details);
    card.appendChild(progressTrack);

    if (job.errorMessage) {
      const errEl = document.createElement('div');
      errEl.style.color = '#fca5a5';
      errEl.style.fontSize = '11px';
      errEl.textContent = job.errorMessage;
      card.appendChild(errEl);
    }

    queueListContainer.appendChild(card);
  });
}

/**
 * Abre a janela secundária de decupagem para a mídia clicada
 */
async function openMediaInClipper(media) {
  if (!state.workspacePath || !state.currentSession) return;
  await window.alimAPI.openClipperWindow({
    workspacePath: state.workspacePath,
    sessionId: state.currentSession.sessionId,
    relativeMediaPath: media.relativePath,
    fileName: media.fileName,
    mimeType: media.mimeType
  });
}

async function refreshSessionsList() {
  if (!state.workspacePath) return;
  state.sessions = await window.alimAPI.listSessions(state.workspacePath);
  renderSidebarSessions();
}

async function selectSession(sessionId) {
  if (!state.workspacePath) return;
  try {
    const sessionData = await window.alimAPI.loadSession(state.workspacePath, sessionId);
    state.currentSession = sessionData;
    populateFormWithSession(sessionData);
    renderSidebarSessions();
  } catch (err) {
    showToast(`Erro ao carregar sessão: ${err.message}`, 'error');
  }
}

async function handleSaveCurrentSession(silent = false) {
  if (!state.workspacePath || !state.currentSession) return;
  try {
    state.currentSession.metadata = collectFormMetadata();
    const saved = await window.alimAPI.saveSession(
      state.workspacePath,
      state.currentSession
    );
    state.currentSession = saved;
    renderMimeTypes(saved.metadata['dc.format.mimetype']);
    await refreshSessionsList();
    if (!silent) {
      showToast(`Sessão ${saved.sessionId} salva com sucesso!`, 'success');
    }
  } catch (err) {
    showToast(`Erro ao salvar sessão: ${err.message}`, 'error');
  }
}

async function handleRemoveMedia(relativePath) {
  if (!state.workspacePath || !state.currentSession) return;
  try {
    await handleSaveCurrentSession(true);
    const updated = await window.alimAPI.removeMediaFile(
      state.workspacePath,
      state.currentSession.sessionId,
      relativePath
    );
    state.currentSession = updated;
    populateFormWithSession(updated);
    await refreshSessionsList();
    showToast('Arquivo de mídia removido da sessão.', 'info');
  } catch (err) {
    showToast(`Erro ao remover mídia: ${err.message}`, 'error');
  }
}

// Eventos de Botões Principais
btnOpenWorkspace.addEventListener('click', async () => {
  const result = await window.alimAPI.selectWorkspace();
  if (!result) return;

  state.workspacePath = result.workspacePath;
  state.sessions = result.sessions || [];
  state.selectedSessionIdsForExport = new Set(
    state.sessions.map((s) => s.sessionId)
  );
  chkSelectAllSessions.checked = true;

  workspacePathDisplay.textContent = state.workspacePath;
  workspacePathDisplay.title = state.workspacePath;
  btnNewSession.disabled = false;

  renderSidebarSessions();

  if (state.sessions.length > 0) {
    await selectSession(state.sessions[0].sessionId);
  } else {
    populateFormWithSession(null);
  }

  showToast('Pasta de trabalho carregada com sucesso!', 'success');
});

chkSelectAllSessions.addEventListener('change', () => {
  if (chkSelectAllSessions.checked) {
    state.sessions.forEach((s) => state.selectedSessionIdsForExport.add(s.sessionId));
  } else {
    state.selectedSessionIdsForExport.clear();
  }
  renderSidebarSessions();
});

btnNewSession.addEventListener('click', async () => {
  if (!state.workspacePath) return;
  try {
    if (state.currentSession) {
      await handleSaveCurrentSession(true);
    }
    const created = await window.alimAPI.createSession(state.workspacePath, null);
    state.selectedSessionIdsForExport.add(created.sessionId);
    await refreshSessionsList();
    await selectSession(created.sessionId);
    showToast(`Nova sessão ${created.sessionId} criada!`, 'success');
  } catch (err) {
    showToast(`Erro ao criar sessão: ${err.message}`, 'error');
  }
});

btnCloneSession.addEventListener('click', async () => {
  if (!state.workspacePath || !state.currentSession) return;
  try {
    const metadataToClone = collectFormMetadata();
    await handleSaveCurrentSession(true);

    const cloned = await window.alimAPI.createSession(
      state.workspacePath,
      metadataToClone
    );
    state.selectedSessionIdsForExport.add(cloned.sessionId);
    await refreshSessionsList();
    await selectSession(cloned.sessionId);
    showToast(
      `Sessão clonada para ${cloned.sessionId} (metadados mantidos)!`,
      'success'
    );
  } catch (err) {
    showToast(`Erro ao clonar sessão: ${err.message}`, 'error');
  }
});

btnSaveSession.addEventListener('click', () => handleSaveCurrentSession(false));

btnDeleteSession.addEventListener('click', async () => {
  if (!state.workspacePath || !state.currentSession) return;
  const sessionId = state.currentSession.sessionId;
  const confirmDel = window.confirm(
    `Deseja excluir o arquivo de metadados ${sessionId}.json?`
  );
  if (!confirmDel) return;

  try {
    state.sessions = await window.alimAPI.deleteSession(
      state.workspacePath,
      sessionId
    );
    state.selectedSessionIdsForExport.delete(sessionId);
    state.currentSession = null;
    renderSidebarSessions();

    if (state.sessions.length > 0) {
      await selectSession(state.sessions[0].sessionId);
    } else {
      populateFormWithSession(null);
    }
    showToast(`Sessão ${sessionId} removida.`, 'warning');
  } catch (err) {
    showToast(`Erro ao excluir sessão: ${err.message}`, 'error');
  }
});

// Botões "+ Adicionar" dos campos multi-valor
document.querySelectorAll('.btn-add-multi').forEach((btn) => {
  btn.addEventListener('click', () => {
    const fieldKey = btn.getAttribute('data-field');
    const currentVals = collectMultiValueFromDOM(fieldKey);
    currentVals.push('');
    renderMultiValueField(fieldKey, currentVals, true);
  });
});

btnAddAbstract.addEventListener('click', () => {
  const current = collectAbstractBlocksFromDOM();
  current.push({ category: 'Conteúdo', text: '' });
  renderAbstractBlocks(current, true);
});

// Anexar Mídia
btnAttachMedia.addEventListener('click', async () => {
  if (!state.workspacePath || !state.currentSession) return;
  try {
    await handleSaveCurrentSession(true);
    const updatedSession = await window.alimAPI.attachMediaFiles(
      state.workspacePath,
      state.currentSession.sessionId
    );
    if (!updatedSession) return;

    state.currentSession = updatedSession;
    populateFormWithSession(updatedSession);
    await refreshSessionsList();
    showToast('Mídia(s) copiada(s) e vinculada(s) à sessão!', 'success');
  } catch (err) {
    showToast(`Erro ao anexar mídia: ${err.message}`, 'error');
  }
});

// Controles da Fila FFmpeg
btnTogglePauseQueue.addEventListener('click', async () => {
  state.queueState = await window.alimAPI.togglePauseQueue();
  renderQueue();
});

btnClearFinishedQueue.addEventListener('click', async () => {
  state.queueState = await window.alimAPI.clearFinishedQueue();
  renderQueue();
});

// Exportar para DSpace (SAF)
btnExportDSpace.addEventListener('click', async () => {
  if (!state.workspacePath) return;
  const selectedIds = Array.from(state.selectedSessionIdsForExport);
  if (selectedIds.length === 0) {
    showToast('Selecione ao menos uma sessão na barra lateral para exportar.', 'warning');
    return;
  }

  try {
    if (state.currentSession) {
      await handleSaveCurrentSession(true);
    }
    const res = await window.alimAPI.exportDSpaceSAF(
      state.workspacePath,
      selectedIds
    );
    if (res && !res.canceled) {
      showToast(
        `Pacote DSpace SAF gerado (${res.exportedSessions} sessões, ${res.totalMediaFiles} mídias)!`,
        'success'
      );
    }
  } catch (err) {
    showToast(`Falha na exportação DSpace SAF: ${err.message}`, 'error');
  }
});

// Listeners IPC da Fila e Mídias Geradas
window.alimAPI.onQueueUpdated((newState) => {
  state.queueState = newState;
  renderQueue();
});

window.alimAPI.onSessionMediaUpdated(async ({ sessionId, sessionData }) => {
  await refreshSessionsList();
  if (state.currentSession && state.currentSession.sessionId === sessionId) {
    // Preserva metadados em edição no formulário e atualiza mídias e mimetypes
    const editedMeta = collectFormMetadata();
    editedMeta['dc.format.mimetype'] =
      sessionData.metadata['dc.format.mimetype'] || [];
    state.currentSession.mediaFiles = sessionData.mediaFiles;
    state.currentSession.metadata = editedMeta;
    renderMimeTypes(editedMeta['dc.format.mimetype']);
    renderMediaList(sessionData.mediaFiles);
    showToast('Novo recorte concluído e adicionado à sessão!', 'success');
  }
});

// Inicialização
(async function init() {
  populateFormWithSession(null);
  state.queueState = await window.alimAPI.getQueueState();
  renderQueue();
})();
