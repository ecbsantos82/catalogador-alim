const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver');

/**
 * Escapa caracteres especiais para XML válido
 * @param {string} unsafe
 * @returns {string}
 */
function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converte chave Dublin Core (ex: 'dc.contributor.advisor' ou 'dc.title')
 * em { element, qualifier } no padrão DSpace SAF
 * @param {string} dcKey
 * @returns {{ element: string, qualifier: string }}
 */
function parseDcKey(dcKey) {
  const parts = String(dcKey).split('.');
  // Remove prefixo 'dc' se existir
  if (parts[0] === 'dc') {
    parts.shift();
  }
  const element = parts[0] || 'description';
  const qualifier = parts.length > 1 ? parts.slice(1).join('.') : 'none';
  return { element, qualifier };
}

/**
 * Gera o conteúdo de dublin_core.xml no padrão exato do DSpace SAF
 * @param {Object} metadata - Objeto de metadados da sessão
 * @returns {string} XML formatado
 */
function generateDublinCoreXml(metadata = {}) {
  const lines = [
    '<?xml version="1.0" encoding="utf-8" standalone="no"?>',
    '<dublin_core schema="dc">'
  ];

  const addNode = (element, qualifier, value, languageAttr = '') => {
    if (value === null || value === undefined) return;
    const trimmed = String(value).trim();
    if (!trimmed) return;
    const langPart = languageAttr ? ` language="${escapeXml(languageAttr)}"` : '';
    lines.push(
      `  <dcvalue element="${escapeXml(element)}" qualifier="${escapeXml(qualifier || 'none')}"${langPart}>${escapeXml(trimmed)}</dcvalue>`
    );
  };

  // Mapeamento explícito e ordenado de todos os campos Dublin Core da sessão
  const standardFields = [
    'dc.title',
    'dc.type',
    'dc.contributor.advisor',
    'dc.date.created',
    'dc.date.issued',
    'dc.date.accessioned',
    'dc.date.available',
    'dc.identifier.other',
    'dc.identifier.uri',
    'dc.description.sponsorship',
    'dc.publisher',
    'dc.language',
    'dc.language.iso',
    'dc.subject',
    'dc.subject.other',
    'dc.coverage.spatial',
    'dc.format.mimetype'
  ];

  for (const fieldKey of standardFields) {
    const rawValue = metadata[fieldKey];
    if (rawValue === undefined || rawValue === null) continue;
    const { element, qualifier } = parseDcKey(fieldKey);

    if (Array.isArray(rawValue)) {
      rawValue.forEach((val) => addNode(element, qualifier, val));
    } else {
      addNode(element, qualifier, rawValue);
    }
  }

  // Tratamento multi-uso para dc.description.abstract (Conteúdo, Participantes, Línguas/Contexto e entradas extras)
  if (metadata['dc.description.abstract']) {
    const abs = metadata['dc.description.abstract'];
    if (Array.isArray(abs)) {
      abs.forEach((entry) => {
        if (typeof entry === 'object' && entry !== null) {
          const prefix = entry.category ? `[${entry.category}] ` : '';
          addNode('description', 'abstract', `${prefix}${entry.text || ''}`);
        } else {
          addNode('description', 'abstract', entry);
        }
      });
    } else {
      addNode('description', 'abstract', abs);
    }
  }

  if (metadata['dc.description.abstract.participantes']) {
    addNode(
      'description',
      'abstract',
      `Participantes: ${metadata['dc.description.abstract.participantes']}`
    );
  }

  if (metadata['dc.description.abstract.linguas']) {
    addNode(
      'description',
      'abstract',
      `Contexto Linguístico: ${metadata['dc.description.abstract.linguas']}`
    );
  }

  lines.push('</dublin_core>');
  return lines.join('\n') + '\n';
}

/**
 * Compacta um diretório inteiro em um arquivo .zip
 * @param {string} sourceDir
 * @param {string} outZipPath
 * @returns {Promise<void>}
 */
function zipDirectory(sourceDir, outZipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * Exporta sessões selecionadas para o formato DSpace Simple Archive Format (SAF) em arquivo .zip
 * @param {Object} params
 * @param {string} params.workspacePath - Diretório raiz do workspace
 * @param {string[]} params.sessionIds - Lista de IDs de sessão (ex: ['sessao_01', 'sessao_02'])
 * @param {string} params.destinationZipPath - Caminho final do arquivo .zip
 * @returns {Promise<{ zipPath: string, exportedSessions: number, totalMediaFiles: number }>}
 */
async function exportToDSpaceSAF({ workspacePath, sessionIds, destinationZipPath }) {
  if (!workspacePath || !fs.existsSync(workspacePath)) {
    throw new Error('Pasta de trabalho inválida ou não encontrada.');
  }

  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    throw new Error('Selecione ao menos uma sessão para exportar.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alim_dspace_saf_'));
  let exportedSessions = 0;
  let totalMediaFiles = 0;

  try {
    for (let i = 0; i < sessionIds.length; i++) {
      const sessionId = sessionIds[i];
      const sessionJsonPath = path.join(workspacePath, `${sessionId}.json`);
      if (!fs.existsSync(sessionJsonPath)) {
        continue;
      }

      const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));
      const itemFolderName = `item_${String(i + 1).padStart(3, '0')}_${sessionId}`;
      const itemDir = path.join(tempDir, itemFolderName);
      fs.mkdirSync(itemDir, { recursive: true });

      // 1. Coleta arquivos de mídia da sessão (originais e recortes)
      const mediaFolder = path.join(workspacePath, `${sessionId}_midias`);
      const mediaFileNames = new Set();

      // A partir da lista salva no JSON
      if (Array.isArray(sessionData.mediaFiles)) {
        for (const media of sessionData.mediaFiles) {
          const relPath = (media.relativePath || '').replace(/^\.[\\/]/, '');
          const absMediaPath = path.join(workspacePath, relPath);
          if (fs.existsSync(absMediaPath) && fs.statSync(absMediaPath).isFile()) {
            const fileName = path.basename(absMediaPath);
            fs.copyFileSync(absMediaPath, path.join(itemDir, fileName));
            mediaFileNames.add(fileName);
          }
        }
      }

      // Garante que qualquer recorte/mídia presente fisicamente na pasta da sessão também seja incluído
      if (fs.existsSync(mediaFolder) && fs.statSync(mediaFolder).isDirectory()) {
        const filesInDir = fs.readdirSync(mediaFolder);
        for (const fName of filesInDir) {
          const fullPath = path.join(mediaFolder, fName);
          if (fs.statSync(fullPath).isFile() && !mediaFileNames.has(fName)) {
            fs.copyFileSync(fullPath, path.join(itemDir, fName));
            mediaFileNames.add(fName);
          }
        }
      }

      // 2. Gera dublin_core.xml
      const xmlContent = generateDublinCoreXml(sessionData.metadata || {});
      fs.writeFileSync(path.join(itemDir, 'dublin_core.xml'), xmlContent, 'utf-8');

      // 3. Gera arquivo contents (listando os nomes dos arquivos de mídia)
      const contentsLines = Array.from(mediaFileNames).map(
        (fileName) => `${fileName}\tbundle:ORIGINAL`
      );
      fs.writeFileSync(
        path.join(itemDir, 'contents'),
        contentsLines.join('\n') + (contentsLines.length ? '\n' : ''),
        'utf-8'
      );

      totalMediaFiles += mediaFileNames.size;
      exportedSessions++;
    }

    if (exportedSessions === 0) {
      throw new Error('Nenhuma sessão válida encontrada para exportação.');
    }

    // 4. Compacta a estrutura SAF em um arquivo .zip pronto para DSpace
    await zipDirectory(tempDir, destinationZipPath);

    return {
      zipPath: destinationZipPath,
      exportedSessions,
      totalMediaFiles
    };
  } finally {
    // Limpa pasta temporária
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {
      // Ignora erro de limpeza de temp
    }
  }
}

module.exports = {
  exportToDSpaceSAF,
  generateDublinCoreXml
};
