let currentPayload = null;

const clipperMediaTitle = document.getElementById('clipperMediaTitle');
const clipperSessionInfo = document.getElementById('clipperSessionInfo');
const mediaPlayer = document.getElementById('mediaPlayer');
const currentTimeDisplay = document.getElementById('currentTimeDisplay');

const btnPlayPause = document.getElementById('btnPlayPause');
const btnMarkIn = document.getElementById('btnMarkIn');
const btnMarkOut = document.getElementById('btnMarkOut');
const btnClearMarkers = document.getElementById('btnClearMarkers');
const btnAddToQueue = document.getElementById('btnAddToQueue');

const inputStartTime = document.getElementById('inputStartTime');
const inputEndTime = document.getElementById('inputEndTime');
const inputCutLabel = document.getElementById('inputCutLabel');
const clipperFeedback = document.getElementById('clipperFeedback');
const toastContainer = document.getElementById('toastContainer');

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
  }, 3000);
}

/**
 * Formata segundos em HH:MM:SS.mmm
 */
function formatSeconds(sec) {
  const safe = Math.max(0, Number(sec) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = (safe % 60).toFixed(3);
  const pad = (n) => String(n).padStart(2, '0');
  const [secInt, msPart] = seconds.split('.');
  return `${pad(hours)}:${pad(minutes)}:${pad(secInt)}.${msPart}`;
}

/**
 * Converte string HH:MM:SS.mmm ou segundos para float
 */
function parseTimeInput(str) {
  if (!str) return NaN;
  const trimmed = String(str).trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed);
  }
  const parts = trimmed.split(':').map(Number);
  if (parts.some(isNaN)) return NaN;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return NaN;
}

function togglePlayPause() {
  if (!mediaPlayer.src) return;
  if (mediaPlayer.paused) {
    mediaPlayer.play();
  } else {
    mediaPlayer.pause();
  }
}

function markInPoint() {
  const formatted = formatSeconds(mediaPlayer.currentTime || 0);
  inputStartTime.value = formatted;
  clipperFeedback.textContent = `Ponto IN marcado em ${formatted}`;
}

function markOutPoint() {
  const formatted = formatSeconds(mediaPlayer.currentTime || 0);
  inputEndTime.value = formatted;
  clipperFeedback.textContent = `Ponto OUT marcado em ${formatted}`;
}

function clearMarkers() {
  inputStartTime.value = '';
  inputEndTime.value = '';
  inputCutLabel.value = '';
  clipperFeedback.textContent =
    'Marcações limpas. Pronto para definir o próximo recorte.';
}

async function handleAddCutToQueue() {
  if (!currentPayload) {
    showToast('Nenhuma mídia carregada no decupador.', 'error');
    return;
  }

  const startRaw = inputStartTime.value.trim();
  const endRaw = inputEndTime.value.trim();

  const startSec = parseTimeInput(startRaw);
  const endSec = parseTimeInput(endRaw);

  if (isNaN(startSec) || isNaN(endSec)) {
    showToast(
      'Informe tempos válidos para IN e OUT (ex: 00:01:15.000 ou segundos).',
      'error'
    );
    return;
  }

  if (endSec <= startSec) {
    showToast(
      'O tempo final (OUT) deve ser maior que o tempo inicial (IN).',
      'error'
    );
    return;
  }

  try {
    const job = await window.alimAPI.enqueueCut({
      workspacePath: currentPayload.workspacePath,
      sessionId: currentPayload.sessionId,
      relativeMediaPath: currentPayload.relativeMediaPath,
      startTime: startRaw,
      endTime: endRaw,
      label: inputCutLabel.value.trim()
    });

    // Limpa as marcações mas NÃO fecha a janela para permitir múltiplos cortes contínuos
    clearMarkers();
    clipperFeedback.textContent = `Recorte enviado à fila (${job.startTime} -> ${job.endTime}). Continue marcando novos trechos!`;
    showToast('Recorte adicionado à fila de corte FFmpeg!', 'success');
  } catch (err) {
    showToast(`Erro ao adicionar à fila: ${err.message}`, 'error');
  }
}

// Recebe a mídia selecionada na mainWindow via IPC
window.alimAPI.onClipperLoadMedia((payload) => {
  currentPayload = payload;
  clipperMediaTitle.textContent = payload.fileName || 'Mídia Selecionada';
  clipperSessionInfo.textContent = `Sessão: ${payload.sessionId} | Caminho Relativo: ${payload.relativeMediaPath}`;

  mediaPlayer.src = payload.mediaUrl;
  mediaPlayer.load();
  clearMarkers();
});

// Atualiza display do tempo atual do player
mediaPlayer.addEventListener('timeupdate', () => {
  currentTimeDisplay.textContent = formatSeconds(mediaPlayer.currentTime || 0);
});

btnPlayPause.addEventListener('click', togglePlayPause);
btnMarkIn.addEventListener('click', markInPoint);
btnMarkOut.addEventListener('click', markOutPoint);
btnClearMarkers.addEventListener('click', clearMarkers);
btnAddToQueue.addEventListener('click', handleAddCutToQueue);

// Atalhos de teclado: Espaço (Play/Pause), I (Marca In), O (Marca Out)
window.addEventListener('keydown', (event) => {
  const activeTag = document.activeElement
    ? document.activeElement.tagName.toLowerCase()
    : '';
  const isTypingInInput = activeTag === 'input' || activeTag === 'textarea';

  if (isTypingInInput) {
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    togglePlayPause();
  } else if (event.key === 'i' || event.key === 'I') {
    event.preventDefault();
    markInPoint();
  } else if (event.key === 'o' || event.key === 'O') {
    event.preventDefault();
    markOutPoint();
  }
});
