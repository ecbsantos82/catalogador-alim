const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

// Garante compatibilidade quando empacotado com asarUnpack
const ffmpegPath = ffmpegStatic
  ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
  : null;

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

/**
 * Converte string de tempo (HH:MM:SS.mmm, MM:SS, ou segundos) para segundos (float)
 * @param {string|number} timeInput
 * @returns {number}
 */
function parseTimeToSeconds(timeInput) {
  if (typeof timeInput === 'number') return timeInput;
  if (!timeInput) return 0;
  const str = String(timeInput).trim();
  if (/^\d+(\.\d+)?$/.test(str)) {
    return parseFloat(str);
  }
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

/**
 * Formata segundos em HH:MM:SS.mmm para o FFmpeg
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatSecondsToTimestamp(totalSeconds) {
  const secNum = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(secNum / 3600);
  const minutes = Math.floor((secNum % 3600) / 60);
  const seconds = (secNum % 60).toFixed(3);
  const pad = (n) => String(n).padStart(2, '0');
  const [secInt, msPart] = seconds.split('.');
  return `${pad(hours)}:${pad(minutes)}:${pad(secInt)}.${msPart}`;
}

class FFmpegService {
  constructor() {
    this.activeCommands = new Map();
  }

  /**
   * Executa um corte sem re-encode (-c copy)
   * @param {Object} job
   * @param {string} job.id - ID único do item da fila
   * @param {string} job.inputPath - Caminho absoluto do arquivo de entrada
   * @param {string} job.outputPath - Caminho absoluto do arquivo de saída
   * @param {string|number} job.startTime - Tempo inicial (IN)
   * @param {string|number} job.endTime - Tempo final (OUT)
   * @param {function(number): void} onProgress - Callback de progresso (0 a 100)
   * @returns {Promise<string>} Caminho do arquivo gerado
   */
  cutMedia(job, onProgress) {
    return new Promise((resolve, reject) => {
      const startSec = parseTimeToSeconds(job.startTime);
      const endSec = parseTimeToSeconds(job.endTime);
      const durationSec = endSec - startSec;

      if (durationSec <= 0) {
        return reject(new Error('O tempo final (OUT) deve ser maior que o tempo inicial (IN).'));
      }

      if (!fs.existsSync(job.inputPath)) {
        return reject(new Error(`Arquivo de origem não encontrado: ${job.inputPath}`));
      }

      const outDir = path.dirname(job.outputPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      const startFormatted = formatSecondsToTimestamp(startSec);
      let wasCancelled = false;

      const command = ffmpeg(job.inputPath)
        .setStartTime(startFormatted)
        .setDuration(durationSec)
        .outputOptions([
          '-c copy',
          '-avoid_negative_ts make_zero'
        ])
        .output(job.outputPath)
        .on('start', () => {
          if (onProgress) onProgress(5);
        })
        .on('progress', (progress) => {
          let percent = 0;
          if (progress && progress.timemark) {
            const currentSec = parseTimeToSeconds(progress.timemark);
            percent = Math.min(99, Math.max(5, Math.round((currentSec / durationSec) * 100)));
          } else if (progress && typeof progress.percent === 'number') {
            percent = Math.min(99, Math.max(5, Math.round(progress.percent)));
          }
          if (onProgress) onProgress(percent);
        })
        .on('end', () => {
          this.activeCommands.delete(job.id);
          if (onProgress) onProgress(100);
          resolve(job.outputPath);
        })
        .on('error', (err) => {
          this.activeCommands.delete(job.id);
          // Remove arquivo incompleto em caso de cancelamento ou erro
          if (fs.existsSync(job.outputPath)) {
            try {
              fs.unlinkSync(job.outputPath);
            } catch (_) {
              // Ignora falha ao remover arquivo parcial
            }
          }
          if (wasCancelled || (err && err.message && err.message.includes('SIGKILL'))) {
            reject(new Error('CANCELLED'));
          } else {
            reject(err);
          }
        });

      this.activeCommands.set(job.id, {
        command,
        markCancelled: () => {
          wasCancelled = true;
        }
      });

      command.run();
    });
  }

  /**
   * Cancela um processo FFmpeg em andamento pelo ID do job
   * @param {string} jobId
   * @returns {boolean}
   */
  cancelJob(jobId) {
    const active = this.activeCommands.get(jobId);
    if (active && active.command) {
      active.markCancelled();
      try {
        active.command.kill('SIGKILL');
      } catch (_) {
        // Ignora erro ao matar processo
      }
      this.activeCommands.delete(jobId);
      return true;
    }
    return false;
  }
}

module.exports = {
  FFmpegService,
  parseTimeToSeconds,
  formatSecondsToTimestamp
};
