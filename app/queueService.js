const EventEmitter = require('events');
const path = require('path');
const { FFmpegService, formatSecondsToTimestamp, parseTimeToSeconds } = require('./ffmpegService');

class QueueService extends EventEmitter {
  constructor() {
    super();
    this.ffmpegService = new FFmpegService();
    this.queue = [];
    this.isPaused = false;
    this.isProcessing = false;
    this.currentJobId = null;
  }

  /**
   * Adiciona um novo recorte à fila de processamento
   * @param {Object} data
   * @param {string} data.sessionId - ID da sessão (ex: sessao_01)
   * @param {string} data.workspacePath - Pasta raiz de trabalho
   * @param {string} data.relativeMediaPath - Caminho relativo da mídia original (ex: ./sessao_01_midias/video.mp4)
   * @param {string|number} data.startTime - Tempo IN
   * @param {string|number} data.endTime - Tempo OUT
   * @param {string} [data.label] - Rótulo opcional do recorte
   * @returns {Object} Item criado na fila
   */
  enqueue(data) {
    const id = `cut_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const cleanRelPath = data.relativeMediaPath.replace(/^\.[\\/]/, '');
    const inputPath = path.join(data.workspacePath, cleanRelPath);

    const parsedOriginal = path.parse(inputPath);
    const startSec = parseTimeToSeconds(data.startTime);
    const endSec = parseTimeToSeconds(data.endTime);

    const startTag = formatSecondsToTimestamp(startSec).replace(/[:.]/g, '-');
    const endTag = formatSecondsToTimestamp(endSec).replace(/[:.]/g, '-');
    const safeLabel = data.label
      ? `_${data.label.trim().replace(/[^a-zA-Z0-9_-]/g, '_')}`
      : '';

    const outputFileName = `${parsedOriginal.name}_corte_${startTag}_a_${endTag}${safeLabel}${parsedOriginal.ext}`;
    const mediaFolderName = `${data.sessionId}_midias`;
    const outputDir = path.join(data.workspacePath, mediaFolderName);
    const outputPath = path.join(outputDir, outputFileName);
    const outputRelativePath = `./${mediaFolderName}/${outputFileName}`;

    const job = {
      id,
      sessionId: data.sessionId,
      workspacePath: data.workspacePath,
      originalFileName: parsedOriginal.base,
      outputFileName,
      inputPath,
      outputPath,
      outputRelativePath,
      startTime: formatSecondsToTimestamp(startSec),
      endTime: formatSecondsToTimestamp(endSec),
      label: data.label || '',
      status: 'pending', // 'pending' | 'processing' | 'completed' | 'cancelled' | 'error'
      progress: 0,
      errorMessage: null,
      createdAt: new Date().toISOString()
    };

    this.queue.push(job);
    this.emitUpdate();
    this.processNext();
    return job;
  }

  /**
   * Retorna cópia do estado atual da fila
   */
  getState() {
    return {
      isPaused: this.isPaused,
      isProcessing: this.isProcessing,
      currentJobId: this.currentJobId,
      items: this.queue.map((item) => ({ ...item }))
    };
  }

  /**
   * Pausa a fila (não inicia próximos cortes até retomar)
   */
  pauseQueue() {
    this.isPaused = true;
    this.emitUpdate();
    return this.getState();
  }

  /**
   * Retoma o processamento da fila
   */
  resumeQueue() {
    this.isPaused = false;
    this.emitUpdate();
    this.processNext();
    return this.getState();
  }

  /**
   * Alterna entre pausado e ativo
   */
  togglePause() {
    if (this.isPaused) {
      return this.resumeQueue();
    }
    return this.pauseQueue();
  }

  /**
   * Cancela um item específico da fila (pendente ou em execução no FFmpeg)
   * @param {string} jobId
   */
  cancelItem(jobId) {
    const job = this.queue.find((item) => item.id === jobId);
    if (!job) return this.getState();

    if (job.status === 'pending') {
      job.status = 'cancelled';
      job.progress = 0;
      this.emitUpdate();
    } else if (job.status === 'processing') {
      job.status = 'cancelled';
      this.ffmpegService.cancelJob(jobId);
      this.emitUpdate();
    }

    return this.getState();
  }

  /**
   * Limpa os itens concluídos, cancelados ou com erro da lista
   */
  clearFinished() {
    this.queue = this.queue.filter(
      (item) => item.status === 'pending' || item.status === 'processing'
    );
    this.emitUpdate();
    return this.getState();
  }

  /**
   * Processa sequencialmente o próximo item pendente da fila
   */
  async processNext() {
    if (this.isProcessing || this.isPaused) {
      return;
    }

    const nextJob = this.queue.find((item) => item.status === 'pending');
    if (!nextJob) {
      this.isProcessing = false;
      this.currentJobId = null;
      this.emitUpdate();
      return;
    }

    this.isProcessing = true;
    this.currentJobId = nextJob.id;
    nextJob.status = 'processing';
    nextJob.progress = 1;
    this.emitUpdate();

    try {
      await this.ffmpegService.cutMedia(nextJob, (percent) => {
        if (nextJob.status === 'processing') {
          nextJob.progress = percent;
          this.emitUpdate();
        }
      });

      if (nextJob.status !== 'cancelled') {
        nextJob.status = 'completed';
        nextJob.progress = 100;
        this.emit('job-completed', { ...nextJob });
      }
    } catch (err) {
      if (err && err.message === 'CANCELLED') {
        nextJob.status = 'cancelled';
        nextJob.progress = 0;
      } else {
        nextJob.status = 'error';
        nextJob.errorMessage = err ? err.message : 'Erro desconhecido no FFmpeg';
      }
    } finally {
      this.isProcessing = false;
      this.currentJobId = null;
      this.emitUpdate();
      // Continua para o próximo item se a fila não estiver pausada
      if (!this.isPaused) {
        setImmediate(() => this.processNext());
      }
    }
  }

  emitUpdate() {
    this.emit('queue-updated', this.getState());
  }
}

module.exports = { QueueService };
