const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alimAPI', {
  // Workspace e Sessões
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  listSessions: (workspacePath) => ipcRenderer.invoke('workspace:list-sessions', workspacePath),
  loadSession: (workspacePath, sessionId) =>
    ipcRenderer.invoke('session:load', { workspacePath, sessionId }),
  createSession: (workspacePath, initialMetadata = null, customId = null) =>
    ipcRenderer.invoke('session:create', { workspacePath, initialMetadata, customId }),
  saveSession: (workspacePath, sessionData) =>
    ipcRenderer.invoke('session:save', { workspacePath, sessionData }),
  deleteSession: (workspacePath, sessionId) =>
    ipcRenderer.invoke('session:delete', { workspacePath, sessionId }),

  // Mídias da Sessão
  attachMediaFiles: (workspacePath, sessionId) =>
    ipcRenderer.invoke('media:attach', { workspacePath, sessionId }),
  removeMediaFile: (workspacePath, sessionId, relativePath) =>
    ipcRenderer.invoke('media:remove', { workspacePath, sessionId, relativePath }),

  // Janela Secundária de Decupagem (Clipper)
  openClipperWindow: (payload) => ipcRenderer.invoke('clipper:open', payload),
  onClipperLoadMedia: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('clipper:load-media', listener);
    return () => ipcRenderer.removeListener('clipper:load-media', listener);
  },

  // Fila de Processamento FFmpeg
  enqueueCut: (cutPayload) => ipcRenderer.invoke('queue:enqueue', cutPayload),
  getQueueState: () => ipcRenderer.invoke('queue:get-state'),
  togglePauseQueue: () => ipcRenderer.invoke('queue:toggle-pause'),
  cancelQueueItem: (jobId) => ipcRenderer.invoke('queue:cancel-item', jobId),
  clearFinishedQueue: () => ipcRenderer.invoke('queue:clear-finished'),
  onQueueUpdated: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('queue:updated', listener);
    return () => ipcRenderer.removeListener('queue:updated', listener);
  },
  onSessionMediaUpdated: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('session:media-updated', listener);
    return () => ipcRenderer.removeListener('session:media-updated', listener);
  },

  // Exportação DSpace SAF
  exportDSpaceSAF: (workspacePath, sessionIds) =>
    ipcRenderer.invoke('dspace:export', { workspacePath, sessionIds })
});
