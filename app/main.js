const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const Module = require('module');

// Suporte automático a node_modules em cache local NTFS quando executado a partir do Google Drive (H:\)
if (process.env.LOCALAPPDATA) {
  const localDeps = path.join(process.env.LOCALAPPDATA, 'alim-catalogador-deps', 'node_modules');
  if (fs.existsSync(localDeps) && !Module.globalPaths.includes(localDeps)) {
    process.env.NODE_PATH = process.env.NODE_PATH
      ? `${process.env.NODE_PATH}${path.delimiter}${localDeps}`
      : localDeps;
    Module._initPaths();
  }
}

const { Readable } = require('stream');
const mime = require('mime-types');
const { QueueService } = require('./queueService');
const { exportToDSpaceSAF } = require('./dspaceExportService');

// Registra o protocolo customizado media:// com suporte a streaming e Range requests antes do ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
]);

let mainWindow = null;
let clipperWindow = null;
const queueService = new QueueService();

/**
 * Cria estrutura padrão de metadados Dublin Core (ALIM / Lameta)
 */
function createDefaultMetadata() {
  const today = new Date().toISOString().split('T')[0];
  return {
    'dc.title': '',
    'dc.type': 'MovingImage',
    'dc.contributor.advisor': [''],
    'dc.date.created': today,
    'dc.date.issued': today,
    'dc.date.accessioned': today,
    'dc.date.available': today,
    'dc.identifier.other': '',
    'dc.identifier.uri': '',
    'dc.description.abstract': [
      { category: 'Conteúdo', text: '' },
      { category: 'Participantes', text: '' },
      { category: 'Contexto Linguístico', text: '' }
    ],
    'dc.description.sponsorship': '',
    'dc.language': [''],
    'dc.language.iso': [''],
    'dc.publisher': 'Projeto ALIM',
    'dc.subject': [''],
    'dc.subject.other': [''],
    'dc.coverage.spatial': [''],
    'dc.format.mimetype': []
  };
}

/**
 * Calcula a lista única de mimetypes com base nos arquivos de mídia da sessão
 */
function computeMimeTypes(mediaFiles = []) {
  const mimes = new Set();
  for (const media of mediaFiles) {
    const detected =
      media.mimeType ||
      mime.lookup(media.fileName || media.relativePath || '') ||
      'application/octet-stream';
    mimes.add(detected);
  }
  return Array.from(mimes);
}

/**
 * Cria a janela principal (Catalogador ALIM)
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: 'Catalogador ALIM & Decupador Audiovisual',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (clipperWindow && !clipperWindow.isDestroyed()) {
      clipperWindow.close();
    }
  });
}

/**
 * Cria ou foca na janela secundária (Pop-up de Decupagem)
 */
function openOrFocusClipperWindow(payload) {
  if (clipperWindow && !clipperWindow.isDestroyed()) {
    clipperWindow.focus();
    clipperWindow.webContents.send('clipper:load-media', payload);
    return;
  }

  clipperWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 740,
    minHeight: 580,
    parent: mainWindow || undefined,
    title: 'Decupador de Mídia - Projeto ALIM',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  clipperWindow.loadFile(path.join(__dirname, 'clipper.html'));

  clipperWindow.webContents.once('did-finish-load', () => {
    if (clipperWindow && !clipperWindow.isDestroyed()) {
      clipperWindow.webContents.send('clipper:load-media', payload);
    }
  });

  clipperWindow.on('closed', () => {
    clipperWindow = null;
  });
}

/**
 * Configura o protocolo customizado media:// com suporte completo a HTTP Range (206 Partial Content)
 */
function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    try {
      const parsedUrl = new URL(request.url);
      // Extrai o caminho codificado em query (?path=...) ou no pathname
      let filePath = parsedUrl.searchParams.get('path');
      if (!filePath) {
        let rawPath = decodeURIComponent(parsedUrl.pathname);
        if (process.platform === 'win32' && rawPath.startsWith('/')) {
          rawPath = rawPath.slice(1);
        }
        filePath = rawPath;
      }

      const normalizedPath = path.normalize(filePath);
      if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isFile()) {
        return new Response('Arquivo de mídia não encontrado', { status: 404 });
      }

      const stat = fs.statSync(normalizedPath);
      const fileSize = stat.size;
      const mimeType = mime.lookup(normalizedPath) || 'application/octet-stream';
      const rangeHeader = request.headers.get('range') || request.headers.get('Range');

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (isNaN(start) || isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${fileSize}`
            }
          });
        }

        const chunkSize = end - start + 1;
        const nodeStream = fs.createReadStream(normalizedPath, { start, end });
        const webStream = Readable.toWeb(nodeStream);

        return new Response(webStream, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': mimeType
          }
        });
      }

      const nodeStream = fs.createReadStream(normalizedPath);
      const webStream = Readable.toWeb(nodeStream);

      return new Response(webStream, {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(fileSize),
          'Content-Type': mimeType
        }
      });
    } catch (err) {
      return new Response(`Erro ao carregar mídia: ${err.message}`, { status: 500 });
    }
  });
}

/**
 * Lê todas as sessões (.json) da pasta de trabalho
 */
function listWorkspaceSessions(workspacePath) {
  if (!workspacePath || !fs.existsSync(workspacePath)) {
    return [];
  }

  const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const fullPath = path.join(workspacePath, entry.name);
      try {
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        const sessionId = path.basename(entry.name, '.json');
        sessions.push({
          sessionId,
          fileName: entry.name,
          title: (content.metadata && content.metadata['dc.title']) || 'Sem título',
          mediaCount: Array.isArray(content.mediaFiles) ? content.mediaFiles.length : 0,
          updatedAt: content.updatedAt || null
        });
      } catch (_) {
        // Ignora arquivos JSON que não sejam sessões válidas
      }
    }
  }

  sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId, undefined, { numeric: true }));
  return sessions;
}

/**
 * Gera o próximo ID sequencial de sessão (ex: sessao_01, sessao_02...)
 */
function generateNextSessionId(workspacePath) {
  const existing = listWorkspaceSessions(workspacePath);
  let maxNum = 0;
  for (const s of existing) {
    const match = s.sessionId.match(/^sessao_(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  const nextNum = String(maxNum + 1).padStart(2, '0');
  return `sessao_${nextNum}`;
}

/**
 * Salva os dados da sessão em [sessionId].json e garante a criação de [sessionId]_midias/
 */
function saveSessionToDisk(workspacePath, sessionData) {
  const sessionId = sessionData.sessionId;
  const jsonPath = path.join(workspacePath, `${sessionId}.json`);
  const mediaFolder = path.join(workspacePath, `${sessionId}_midias`);

  if (!fs.existsSync(mediaFolder)) {
    fs.mkdirSync(mediaFolder, { recursive: true });
  }

  if (!Array.isArray(sessionData.mediaFiles)) {
    sessionData.mediaFiles = [];
  }

  if (!sessionData.metadata) {
    sessionData.metadata = createDefaultMetadata();
  }

  // Atualiza dc.format.mimetype automaticamente
  sessionData.metadata['dc.format.mimetype'] = computeMimeTypes(sessionData.mediaFiles);
  sessionData.updatedAt = new Date().toISOString();

  fs.writeFileSync(jsonPath, JSON.stringify(sessionData, null, 2), 'utf-8');
  return sessionData;
}

// Eventos da fila de processamento FFmpeg
queueService.on('queue-updated', (state) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('queue:updated', state);
  }
});

queueService.on('job-completed', (job) => {
  try {
    const jsonPath = path.join(job.workspacePath, `${job.sessionId}.json`);
    if (fs.existsSync(jsonPath)) {
      const sessionData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (!Array.isArray(sessionData.mediaFiles)) {
        sessionData.mediaFiles = [];
      }

      const exists = sessionData.mediaFiles.some(
        (m) => m.relativePath === job.outputRelativePath
      );

      if (!exists) {
        const mimeType = mime.lookup(job.outputFileName) || 'application/octet-stream';
        const stat = fs.existsSync(job.outputPath) ? fs.statSync(job.outputPath) : { size: 0 };

        sessionData.mediaFiles.push({
          fileName: job.outputFileName,
          relativePath: job.outputRelativePath,
          mimeType,
          size: stat.size,
          isCut: true,
          cutRange: `${job.startTime} -> ${job.endTime}`,
          label: job.label || '',
          addedAt: new Date().toISOString()
        });

        saveSessionToDisk(job.workspacePath, sessionData);
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:media-updated', {
          sessionId: job.sessionId,
          sessionData
        });
      }
    }
  } catch (err) {
    console.error('Erro ao registrar recorte na sessão:', err);
  }
});

// Handlers IPC
function setupIpcHandlers() {
  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Pasta de Trabalho (Workspace ALIM)',
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || !result.filePaths.length) {
      return null;
    }

    const workspacePath = result.filePaths[0];
    let sessions = listWorkspaceSessions(workspacePath);

    // Se a pasta estiver vazia (sem sessões), cria automaticamente a sessao_01
    if (sessions.length === 0) {
      const initialSession = {
        sessionId: 'sessao_01',
        metadata: createDefaultMetadata(),
        mediaFiles: [],
        createdAt: new Date().toISOString()
      };
      saveSessionToDisk(workspacePath, initialSession);
      sessions = listWorkspaceSessions(workspacePath);
    }

    return {
      workspacePath,
      sessions
    };
  });

  ipcMain.handle('workspace:list-sessions', async (_event, workspacePath) => {
    return listWorkspaceSessions(workspacePath);
  });

  ipcMain.handle('session:load', async (_event, { workspacePath, sessionId }) => {
    const jsonPath = path.join(workspacePath, `${sessionId}.json`);
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Sessão ${sessionId} não encontrada.`);
    }
    const sessionData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    return sessionData;
  });

  ipcMain.handle(
    'session:create',
    async (_event, { workspacePath, initialMetadata = null, customId = null }) => {
      let sessionId = customId
        ? customId.trim().replace(/[^a-zA-Z0-9_-]/g, '_')
        : generateNextSessionId(workspacePath);

      if (!sessionId) {
        sessionId = generateNextSessionId(workspacePath);
      }

      const jsonPath = path.join(workspacePath, `${sessionId}.json`);
      if (fs.existsSync(jsonPath)) {
        sessionId = generateNextSessionId(workspacePath);
      }

      const metadata = initialMetadata
        ? JSON.parse(JSON.stringify(initialMetadata))
        : createDefaultMetadata();

      // Ao clonar ou criar nova sessão, limpa mimetypes pois a nova sessão começa sem mídias anexadas
      metadata['dc.format.mimetype'] = [];

      const newSession = {
        sessionId,
        metadata,
        mediaFiles: [],
        createdAt: new Date().toISOString()
      };

      return saveSessionToDisk(workspacePath, newSession);
    }
  );

  ipcMain.handle('session:save', async (_event, { workspacePath, sessionData }) => {
    return saveSessionToDisk(workspacePath, sessionData);
  });

  ipcMain.handle('session:delete', async (_event, { workspacePath, sessionId }) => {
    const jsonPath = path.join(workspacePath, `${sessionId}.json`);
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath);
    }
    return listWorkspaceSessions(workspacePath);
  });

  ipcMain.handle('media:attach', async (_event, { workspacePath, sessionId }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Anexar Mídia à Sessão (${sessionId})`,
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Arquivos Audiovisuais e Documentos',
          extensions: [
            'mp4', 'mkv', 'mov', 'avi', 'webm',
            'mp3', 'wav', 'ogg', 'flac', 'm4a',
            'eaf', 'pfsx', 'txt', 'pdf', 'jpg', 'png'
          ]
        },
        { name: 'Todos os Arquivos', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths.length) {
      return null;
    }

    const jsonPath = path.join(workspacePath, `${sessionId}.json`);
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Sessão ${sessionId} não encontrada.`);
    }

    const sessionData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    if (!Array.isArray(sessionData.mediaFiles)) {
      sessionData.mediaFiles = [];
    }

    const mediaFolderName = `${sessionId}_midias`;
    const mediaFolderAbs = path.join(workspacePath, mediaFolderName);
    if (!fs.existsSync(mediaFolderAbs)) {
      fs.mkdirSync(mediaFolderAbs, { recursive: true });
    }

    for (const sourcePath of result.filePaths) {
      const fileName = path.basename(sourcePath);
      const destPath = path.join(mediaFolderAbs, fileName);

      // Copia fisicamente o arquivo para a subpasta da sessão correspondente
      if (path.resolve(sourcePath) !== path.resolve(destPath)) {
        fs.copyFileSync(sourcePath, destPath);
      }

      const relativePath = `./${mediaFolderName}/${fileName}`;
      const mimeType = mime.lookup(fileName) || 'application/octet-stream';
      const stat = fs.statSync(destPath);

      const existingIdx = sessionData.mediaFiles.findIndex(
        (m) => m.relativePath === relativePath
      );

      const mediaItem = {
        fileName,
        relativePath,
        mimeType,
        size: stat.size,
        isCut: false,
        addedAt: new Date().toISOString()
      };

      if (existingIdx >= 0) {
        sessionData.mediaFiles[existingIdx] = mediaItem;
      } else {
        sessionData.mediaFiles.push(mediaItem);
      }
    }

    return saveSessionToDisk(workspacePath, sessionData);
  });

  ipcMain.handle(
    'media:remove',
    async (_event, { workspacePath, sessionId, relativePath }) => {
      const jsonPath = path.join(workspacePath, `${sessionId}.json`);
      if (!fs.existsSync(jsonPath)) {
        throw new Error(`Sessão ${sessionId} não encontrada.`);
      }

      const sessionData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const cleanRel = relativePath.replace(/^\.[\\/]/, '');
      const absPath = path.join(workspacePath, cleanRel);

      if (fs.existsSync(absPath)) {
        try {
          fs.unlinkSync(absPath);
        } catch (_) {
          // Ignora falha caso arquivo esteja em uso
        }
      }

      sessionData.mediaFiles = (sessionData.mediaFiles || []).filter(
        (m) => m.relativePath !== relativePath
      );

      return saveSessionToDisk(workspacePath, sessionData);
    }
  );

  ipcMain.handle('clipper:open', async (_event, payload) => {
    const cleanRel = payload.relativeMediaPath.replace(/^\.[\\/]/, '');
    const absoluteMediaPath = path.join(payload.workspacePath, cleanRel);
    const mediaUrl = `media://local/?path=${encodeURIComponent(absoluteMediaPath)}`;

    openOrFocusClipperWindow({
      ...payload,
      absoluteMediaPath,
      mediaUrl
    });

    return { ok: true };
  });

  // Handlers da Fila FFmpeg
  ipcMain.handle('queue:enqueue', async (_event, cutPayload) => {
    return queueService.enqueue(cutPayload);
  });

  ipcMain.handle('queue:get-state', async () => {
    return queueService.getState();
  });

  ipcMain.handle('queue:toggle-pause', async () => {
    return queueService.togglePause();
  });

  ipcMain.handle('queue:cancel-item', async (_event, jobId) => {
    return queueService.cancelItem(jobId);
  });

  ipcMain.handle('queue:clear-finished', async () => {
    return queueService.clearFinished();
  });

  // Handler de Exportação DSpace SAF
  ipcMain.handle('dspace:export', async (_event, { workspacePath, sessionIds }) => {
    const defaultZipName = `Pacote_DSpace_SAF_ALIM_${new Date()
      .toISOString()
      .slice(0, 10)}.zip`;

    const saveDialog = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar Pacote de Exportação DSpace (SAF .zip)',
      defaultPath: path.join(workspacePath, defaultZipName),
      filters: [{ name: 'Arquivo ZIP (DSpace SAF)', extensions: ['zip'] }]
    });

    if (saveDialog.canceled || !saveDialog.filePath) {
      return { canceled: true };
    }

    const result = await exportToDSpaceSAF({
      workspacePath,
      sessionIds,
      destinationZipPath: saveDialog.filePath
    });

    return {
      canceled: false,
      ...result
    };
  });
}

app.whenReady().then(() => {
  registerMediaProtocol();
  setupIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
