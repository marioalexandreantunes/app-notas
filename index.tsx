/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import { GoogleGenAI } from '@google/genai';
import { marked } from 'marked';

declare global {
  interface Window {
    audioContext: AudioContext;
  }
}

const MODEL_NAME = 'gemini-2.5-flash';

// Constantes para evitar strings repetidas
const MESSAGES = {
  READY_TO_RECORD: 'Pronto para gravar',
  REQUESTING_ACCESS: 'A solicitar acesso ao microfone/aba...',
  PROCESSING_AUDIO: 'A processar áudio...',
  CONVERTING_AUDIO: 'A converter áudio...',
  GETTING_TRANSCRIPTION: 'Obter transcrição...',
  IMPROVING_NOTE: 'A melhorar a nota...',
  NO_AUDIO_CAPTURED: 'Nenhum áudio capturado. Por favor, tente novamente.',
  PERMISSION_DENIED: 'Permissão negada. Por favor, verifique as configurações do navegador e recarregue a página.',
  NO_AUDIO_DEVICE: 'Nenhum dispositivo de áudio encontrado.',
  AUDIO_IN_USE: 'Não é possível acessar o áudio. Pode estar a ser utilizado por outra aplicação.',
  NOTE_SAVED: 'Nota salva com sucesso no navegador',
  NO_NOTE_TO_SAVE: 'Nenhuma nota para salvar',
  TRANSCRIPTION_COMPLETE: 'Transcrição completa. A melhorar a nota...',
  NOTE_IMPROVED: 'Nota melhorada. Pronto para a próxima gravação.',
} as const;

const AUDIO_TAGS = {
  MEETING_OPEN: '[REUNIÃO]',
  MEETING_CLOSE: '[/REUNIÃO]',
  USER_OPEN: '[EU]',
  USER_CLOSE: '[/EU]',
} as const;

interface Note {
  id: string;
  rawTranscription: string;
  polishedNote: string;
  timestamp: number;
}

class VoiceNotesApp {
  private genAI: any;
  private mediaRecorder: MediaRecorder | null = null;

  // Elementos DOM
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private rawTranscription: HTMLDivElement;
  private polishedNote: HTMLDivElement;
  private newButton: HTMLButtonElement;
  private saveButton: HTMLButtonElement;
  private themeToggleButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private editorTitle: HTMLDivElement;
  private recordingInterface: HTMLDivElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement | null;
  private liveWaveformCtx: CanvasRenderingContext2D | null = null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private statusIndicatorDiv: HTMLDivElement | null;

  // Estado da aplicação
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private currentNote: Note | null = null;
  private hasAttemptedPermission = false;
  private openingTags: string = '';
  private closingTags: string = '';

  // Streams e contexto de áudio
  private stream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;

  // IDs para animações e timers
  private waveformDrawingId: number | null = null;
  private timerIntervalId: number | null = null;
  private recordingStartTime: number = 0;

  constructor() {
    this.genAI = new GoogleGenAI({
      apiKey: process.env.API_KEY!,
      apiVersion: 'v1beta',
    });

    this.initializeElements();
    this.bindEventListeners();
    this.initTheme();
    this.createNewNote();
    this.saveNewNote();
    this.setStatus(MESSAGES.READY_TO_RECORD);
  }

  // Utilitários para elementos DOM
  private getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id) as T;
    if (!element) {
      console.warn(`Elemento com ID '${id}' não encontrado`);
    }
    return element;
  }

  private querySelector<T extends HTMLElement>(selector: string): T {
    const element = document.querySelector(selector) as T;
    if (!element) {
      console.warn(`Elemento com seletor '${selector}' não encontrado`);
    }
    return element;
  }

  private initializeElements(): void {
    this.recordButton = this.getElement<HTMLButtonElement>('recordButton');
    this.recordingStatus = this.getElement<HTMLDivElement>('recordingStatus');
    this.rawTranscription = this.getElement<HTMLDivElement>('rawTranscription');
    this.polishedNote = this.getElement<HTMLDivElement>('polishedNote');
    this.newButton = this.getElement<HTMLButtonElement>('newButton');
    this.saveButton = this.getElement<HTMLButtonElement>('saveButton');
    this.themeToggleButton = this.getElement<HTMLButtonElement>('themeToggleButton');
    this.themeToggleIcon = this.themeToggleButton?.querySelector('i') as HTMLElement;
    this.editorTitle = this.querySelector<HTMLDivElement>('.editor-title');
    this.recordingInterface = this.querySelector<HTMLDivElement>('.recording-interface');
    this.liveRecordingTitle = this.getElement<HTMLDivElement>('liveRecordingTitle');
    this.liveWaveformCanvas = this.getElement<HTMLCanvasElement>('liveWaveformCanvas');
    this.liveRecordingTimerDisplay = this.getElement<HTMLDivElement>('liveRecordingTimerDisplay');

    if (this.liveWaveformCanvas) {
      this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    }

    if (this.recordingInterface) {
      this.statusIndicatorDiv = this.recordingInterface.querySelector('.status-indicator') as HTMLDivElement;
    }
  }

  private bindEventListeners(): void {
    this.recordButton?.addEventListener('click', () => this.toggleRecording());
    this.newButton?.addEventListener('click', () => this.createNewNote());
    this.saveButton?.addEventListener('click', () => this.saveNewNote());
    this.themeToggleButton?.addEventListener('click', () => this.toggleTheme());
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  // Utilitário para definir status
  private setStatus(message: string): void {
    if (this.recordingStatus) {
      this.recordingStatus.textContent = message;
    }
  }

  // Utilitário para limpeza de streams
  private cleanupStreams(): void {
    const streams = [this.stream, this.screenStream, this.micStream];
    streams.forEach(stream => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    });

    this.stream = null;
    this.screenStream = null;
    this.micStream = null;
  }

  // Utilitário para limpeza de contexto de áudio
  private async cleanupAudioContext(): Promise<void> {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch (e) {
        console.warn('Erro ao fechar o contexto de áudio:', e);
      }
    }
    this.audioContext = null;
    this.analyserNode = null;
    this.waveformDataArray = null;
  }

  // Utilitário para limpeza de animações
  private cleanupAnimations(): void {
    if (this.waveformDrawingId) {
      cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
    }
    if (this.timerIntervalId) {
      clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
  }

  // Utilitário para verificar se elemento tem conteúdo válido
  private hasValidContent(element: HTMLElement): boolean {
    if (!element) return false;
    const content = element.id === 'polishedNote' ? element.innerText : element.textContent;
    const placeholder = element.getAttribute('placeholder') || '';
    return content?.trim() !== '' && content?.trim() !== placeholder && !element.classList.contains('placeholder-active');
  }

  // Utilitário para configurar placeholder
  private setPlaceholder(element: HTMLElement, showPlaceholder: boolean = true): void {
    if (!element) return;

    const placeholder = element.getAttribute('placeholder') || '';

    if (showPlaceholder) {
      if (element.id === 'polishedNote') {
        element.innerHTML = placeholder;
      } else {
        element.textContent = placeholder;
      }
      element.classList.add('placeholder-active');
    } else {
      element.classList.remove('placeholder-active');
    }
  }

  // Configurar tags de áudio baseado nos streams disponíveis
  private setupAudioTags(hasTabAudio: boolean, hasMicAudio: boolean): void {
    if (hasTabAudio && hasMicAudio) {
      this.openingTags = `${AUDIO_TAGS.MEETING_OPEN}${AUDIO_TAGS.USER_OPEN}`;
      this.closingTags = `${AUDIO_TAGS.MEETING_CLOSE}${AUDIO_TAGS.USER_CLOSE}`;
    } else if (hasTabAudio) {
      this.openingTags = AUDIO_TAGS.MEETING_OPEN;
      this.closingTags = AUDIO_TAGS.MEETING_CLOSE;
    } else if (hasMicAudio) {
      this.openingTags = AUDIO_TAGS.USER_OPEN;
      this.closingTags = AUDIO_TAGS.USER_CLOSE;
    } else {
      this.openingTags = '';
      this.closingTags = '';
    }
  }

  private handleResize(): void {
    if (this.isRecording && this.liveWaveformCanvas?.style.display === 'block') {
      requestAnimationFrame(() => this.setupCanvasDimensions());
    }
  }

  private setupCanvasDimensions(): void {
    if (!this.liveWaveformCanvas || !this.liveWaveformCtx) return;

    const canvas = this.liveWaveformCanvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    this.liveWaveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private initTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    const isLight = savedTheme === 'light';

    document.body.classList.toggle('light-mode', isLight);
    this.themeToggleIcon?.classList.toggle('fa-moon', isLight);
    this.themeToggleIcon?.classList.toggle('fa-sun', !isLight);
  }

  private toggleTheme(): void {
    const isLight = !document.body.classList.contains('light-mode');

    document.body.classList.toggle('light-mode', isLight);
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    this.themeToggleIcon?.classList.toggle('fa-moon', isLight);
    this.themeToggleIcon?.classList.toggle('fa-sun', !isLight);
  }

  private async toggleRecording(): Promise<void> {
    if (!this.isRecording) {
      await this.startRecording();
    } else {
      await this.stopRecording();
    }
  }

  private setupAudioVisualizer(): void {
    if (!this.stream || this.audioContext) return;

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyserNode = this.audioContext.createAnalyser();

    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.75;

    const bufferLength = this.analyserNode.frequencyBinCount;
    this.waveformDataArray = new Uint8Array(bufferLength);

    source.connect(this.analyserNode);
  }

  private drawLiveWaveform(): void {
    const canDrawWaveform = this.analyserNode && this.waveformDataArray &&
      this.liveWaveformCtx && this.liveWaveformCanvas && this.isRecording;

    if (!canDrawWaveform) {
      this.cleanupAnimations();
      return;
    }

    this.waveformDrawingId = requestAnimationFrame(() => this.drawLiveWaveform());
    this.analyserNode!.getByteFrequencyData(this.waveformDataArray!);

    const ctx = this.liveWaveformCtx!;
    const canvas = this.liveWaveformCanvas!;
    const logicalWidth = canvas.clientWidth;
    const logicalHeight = canvas.clientHeight;

    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    const bufferLength = this.analyserNode!.frequencyBinCount;
    const numBars = Math.floor(bufferLength * 0.5);

    if (numBars === 0) return;

    const totalBarPlusSpacingWidth = logicalWidth / numBars;
    const barWidth = Math.max(1, Math.floor(totalBarPlusSpacingWidth * 0.7));
    const barSpacing = Math.max(0, Math.floor(totalBarPlusSpacingWidth * 0.3));

    const recordingColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-recording').trim() || '#ff3b30';

    ctx.fillStyle = recordingColor;

    let x = 0;
    for (let i = 0; i < numBars && x < logicalWidth; i++) {
      const dataIndex = Math.floor(i * (bufferLength / numBars));
      const barHeightNormalized = this.waveformDataArray![dataIndex] / 255.0;
      let barHeight = Math.max(1, Math.round(barHeightNormalized * logicalHeight));

      const y = Math.round((logicalHeight - barHeight) / 2);
      ctx.fillRect(Math.floor(x), y, barWidth, barHeight);
      x += barWidth + barSpacing;
    }
  }

  private updateLiveTimer(): void {
    if (!this.isRecording || !this.liveRecordingTimerDisplay) return;

    const elapsedMs = Date.now() - this.recordingStartTime;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hundredths = Math.floor((elapsedMs % 1000) / 10);

    this.liveRecordingTimerDisplay.textContent =
      `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
  }

  private startLiveDisplay(): void {
    const elements = [this.recordingInterface, this.liveRecordingTitle,
    this.liveWaveformCanvas, this.liveRecordingTimerDisplay];

    if (elements.some(el => !el)) {
      console.warn('Elementos de exibição ao vivo em falta.');
      return;
    }

    // Configurar display
    this.recordingInterface!.classList.add('is-live');
    [this.liveRecordingTitle, this.liveWaveformCanvas, this.liveRecordingTimerDisplay]
      .forEach(el => el!.style.display = 'block');

    this.setupCanvasDimensions();

    if (this.statusIndicatorDiv) {
      this.statusIndicatorDiv.style.display = 'none';
    }

    // Configurar botão
    const iconElement = this.recordButton?.querySelector('.record-button-inner i') as HTMLElement;
    if (iconElement) {
      iconElement.classList.replace('fa-microphone', 'fa-stop');
    }

    // Configurar título
    const currentTitle = this.editorTitle?.textContent?.trim();
    const placeholder = this.editorTitle?.getAttribute('placeholder') || 'Untitled Note';
    this.liveRecordingTitle!.textContent =
      (currentTitle && currentTitle !== placeholder) ? currentTitle : 'Nova Gravação';

    // Iniciar visualizador e timer
    this.setupAudioVisualizer();
    this.drawLiveWaveform();

    this.recordingStartTime = Date.now();
    this.updateLiveTimer();
    this.timerIntervalId = window.setInterval(() => this.updateLiveTimer(), 50);
  }

  private stopLiveDisplay(): void {
    const elements = [this.recordingInterface, this.liveRecordingTitle,
    this.liveWaveformCanvas, this.liveRecordingTimerDisplay];

    if (this.recordingInterface) {
      this.recordingInterface.classList.remove('is-live');
    }

    [this.liveRecordingTitle, this.liveWaveformCanvas, this.liveRecordingTimerDisplay]
      .forEach(el => {
        if (el) el.style.display = 'none';
      });

    if (this.statusIndicatorDiv) {
      this.statusIndicatorDiv.style.display = 'block';
    }

    // Restaurar botão
    const iconElement = this.recordButton?.querySelector('.record-button-inner i') as HTMLElement;
    if (iconElement) {
      iconElement.classList.replace('fa-stop', 'fa-microphone');
    }

    // Limpar animações e contexto
    this.cleanupAnimations();

    if (this.liveWaveformCtx && this.liveWaveformCanvas) {
      this.liveWaveformCtx.clearRect(0, 0, this.liveWaveformCanvas.width, this.liveWaveformCanvas.height);
    }

    this.cleanupAudioContext();
  }

  private async mergeAudioStreams(stream1: MediaStream, stream2: MediaStream): Promise<MediaStream> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    window.audioContext = audioContext;

    const dest = audioContext.createMediaStreamDestination();

    [stream1, stream2].forEach(stream => {
      if (stream.getAudioTracks().length > 0) {
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(dest);
      }
    });

    return dest.stream;
  }

  private async startRecording(): Promise<void> {
    try {
      // Reset state
      this.audioChunks = [];
      this.openingTags = '';
      this.closingTags = '';

      // Cleanup previous state
      this.cleanupStreams();
      await this.cleanupAudioContext();

      this.setStatus(MESSAGES.REQUESTING_ACCESS);

      // Capturar streams
      const streams = await this.captureAudioStreams();
      this.screenStream = streams.screen;
      this.micStream = streams.mic;

      const hasTabAudio = !!(this.screenStream?.getAudioTracks().length);
      const hasMicAudio = !!(this.micStream?.getAudioTracks().length);

      this.setupAudioTags(hasTabAudio, hasMicAudio);

      // Configurar stream final
      this.stream = await this.setupFinalStream(hasTabAudio, hasMicAudio);

      // Configurar MediaRecorder
      this.setupMediaRecorder();
      this.mediaRecorder!.start();
      this.isRecording = true;

      this.recordButton?.classList.add('recording');
      this.recordButton?.setAttribute('title', 'Parar Gravação');
      this.startLiveDisplay();

    } catch (error) {
      console.error('Erro ao iniciar a gravação:', error);
      this.handleRecordingError(error);
    }
  }

  private async captureAudioStreams(): Promise<{ screen: MediaStream | null, mic: MediaStream | null }> {
    let screenStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;

    // Capturar áudio da guia
    if (navigator.mediaDevices.getDisplayMedia) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000
          },
        });
      } catch (e) {
        console.warn('Falha ao capturar áudio da aba:', e);
        this.setStatus('Áudio da aba não suportado ou negado. Usando apenas microfone.');
      }
    }

    // Capturar microfone
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000
        }
      });
    } catch (e) {
      console.error('Falha ao capturar microfone:', e);
      throw e;
    }

    return { screen: screenStream, mic: micStream };
  }

  private async setupFinalStream(hasTabAudio: boolean, hasMicAudio: boolean): Promise<MediaStream> {
    if (hasTabAudio && hasMicAudio) {
      return await this.mergeAudioStreams(this.screenStream!, this.micStream!);
    } else if (hasMicAudio) {
      return this.micStream!;
    } else if (hasTabAudio) {
      return await this.mergeAudioStreams(this.screenStream!, this.screenStream!);
    } else {
      throw new Error('Nenhum fluxo de áudio disponível');
    }
  }

  private setupMediaRecorder(): void {
    try {
      this.mediaRecorder = new MediaRecorder(this.stream!, {
        mimeType: 'audio/webm;codecs=opus',
      });
    } catch (e) {
      console.error('audio/webm;codecs=opus não suportado, usando formato padrão:', e);
      this.mediaRecorder = new MediaRecorder(this.stream!);
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      this.stopLiveDisplay();

      if (this.audioChunks.length > 0) {
        const audioBlob = new Blob(this.audioChunks, {
          type: this.mediaRecorder?.mimeType || 'audio/webm',
        });
        this.processAudio(audioBlob).catch(err => {
          console.error('Erro ao processar áudio:', err);
          this.setStatus('Erro ao processar a gravação');
        });
      } else {
        this.setStatus(MESSAGES.NO_AUDIO_CAPTURED);
      }

      this.cleanupStreams();
    };
  }

  private handleRecordingError(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'Unknown';

    let statusMessage = `Erro: ${errorMessage}`;

    if (['NotAllowedError', 'PermissionDeniedError'].includes(errorName)) {
      statusMessage = MESSAGES.PERMISSION_DENIED;
    } else if (errorName === 'NotFoundError' ||
      (errorName === 'DOMException' && errorMessage.includes('Requested device not found'))) {
      statusMessage = MESSAGES.NO_AUDIO_DEVICE;
    } else if (['NotReadableError', 'AbortError'].includes(errorName) ||
      (errorName === 'DOMException' && errorMessage.includes('Failed to allocate audiosource'))) {
      statusMessage = MESSAGES.AUDIO_IN_USE;
    }

    this.setStatus(statusMessage);
    this.isRecording = false;
    this.cleanupStreams();
    this.recordButton?.classList.remove('recording');
    this.recordButton?.setAttribute('title', 'Iniciar Gravação');
    this.stopLiveDisplay();
  }

  private async stopRecording(): Promise<void> {
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.error('Erro ao parar o MediaRecorder:', e);
        this.stopLiveDisplay();
      }

      this.isRecording = false;
      this.recordButton?.classList.remove('recording');
      this.recordButton?.setAttribute('title', 'Iniciar Gravação');
      this.setStatus(MESSAGES.PROCESSING_AUDIO);
    } else if (!this.isRecording) {
      this.stopLiveDisplay();
    }
  }

  private async convertToWav(audioBlob: Blob): Promise<Blob> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const { length, numberOfChannels, sampleRate } = audioBuffer;
    const channelData = Array.from({ length: numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));

    // Interleave channels
    const interleaved = new Float32Array(length * numberOfChannels);
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        interleaved[i * numberOfChannels + channel] = channelData[channel][i];
      }
    }

    // Create WAV buffer
    const buffer = new ArrayBuffer(44 + interleaved.length * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + interleaved.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * 2, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, interleaved.length * 2, true);

    // PCM data
    let offset = 44;
    for (let i = 0; i < interleaved.length; i++, offset += 2) {
      const sample = Math.max(-1, Math.min(1, interleaved[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  private async processAudio(audioBlob: Blob): Promise<void> {
    if (audioBlob.size === 0) {
      this.setStatus(MESSAGES.NO_AUDIO_CAPTURED);
      return;
    }

    try {
      this.setStatus(MESSAGES.CONVERTING_AUDIO);

      const wavBlob = await this.convertToWav(audioBlob);
      const base64Audio = await this.blobToBase64(wavBlob);

      if (!base64Audio) {
        throw new Error('Falha ao converter áudio para base64');
      }

      await this.getTranscription(base64Audio, 'audio/wav');
    } catch (error) {
      console.error('Erro no processamento de áudio:', error);
      this.setStatus('Erro ao processar a gravação. Por favor, tente novamente.');
    }
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        try {
          const base64data = reader.result as string;
          resolve(base64data.split(',')[1]);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  private async getTranscription(base64Audio: string, mimeType: string): Promise<void> {
    try {
      this.setStatus(MESSAGES.GETTING_TRANSCRIPTION);

      const contents = [
        { text: 'Gere uma transcrição completa e detalhada deste áudio.' },
        { inlineData: { mimeType: mimeType, data: base64Audio } },
      ];

      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
      });

      const transcriptionText = response.text;

      if (transcriptionText) {
        const finalRaw = this.addAudioTags(transcriptionText.trim());
        this.updateTranscriptionDisplay(finalRaw);

        if (this.currentNote) {
          this.currentNote.rawTranscription = finalRaw;
        }

        this.setStatus(MESSAGES.TRANSCRIPTION_COMPLETE);
        await this.getPolishedNote();
      } else {
        this.handleTranscriptionError('A transcrição falhou ou retornou vazia.');
      }
    } catch (error) {
      console.error('Erro ao obter a transcrição:', error);
      this.handleTranscriptionError(`Erro durante a transcrição: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private addAudioTags(transcription: string): string {
    if (!this.openingTags && !this.closingTags) {
      return transcription;
    }
    return `${this.openingTags}${transcription} ${this.closingTags}`;
  }

  private updateTranscriptionDisplay(text: string): void {
    if (!this.rawTranscription) return;

    this.rawTranscription.textContent = text;
    this.setPlaceholder(this.rawTranscription, !text.trim());
  }

  private handleTranscriptionError(message: string): void {
    this.setStatus(message);
    this.setPlaceholder(this.rawTranscription);

    if (this.polishedNote) {
      this.polishedNote.innerHTML = `<p><em>Não foi possível transcrever o áudio. Por favor, tente novamente.</em></p>`;
      this.setPlaceholder(this.polishedNote);
    }
  }

  private async getPolishedNote(): Promise<void> {
    try {
      if (!this.hasValidContent(this.rawTranscription)) {
        this.setStatus('Sem transcrição para melhorar');
        this.handlePolishError('Nenhuma transcrição disponível para melhorar.');
        return;
      }

      this.setStatus(MESSAGES.IMPROVING_NOTE);

      const prompt = `Pegue nesta transcrição bruta e crie uma nota bem formatada e melhorada.
                    Remova palavras de preenchimento (hum, ah, tipo), repetições e falsos começos.
                    Formate corretamente quaisquer listas ou marcadores. Use formatação markdown para títulos, listas, etc.
                    Mantenha todo o conteúdo e significado original.

                    Transcrição bruta:
                    ${this.rawTranscription.textContent}`;

      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: [{ text: prompt }],
      });

      const polishedText = response.text;

      if (polishedText) {
        this.updatePolishedDisplay(polishedText);
        this.updateNoteTitle(polishedText);

        if (this.currentNote) {
          this.currentNote.polishedNote = polishedText;
        }

        this.setStatus(MESSAGES.NOTE_IMPROVED);
      } else {
        this.handlePolishError('O melhoramento retornou vazio. A transcrição bruta está disponível.');
      }
    } catch (error) {
      console.error('Erro ao melhorar a nota:', error);
      this.handlePolishError(`Erro durante o melhoramento: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private updatePolishedDisplay(polishedText: string): void {
    if (!this.polishedNote) return;

    const htmlContent = marked.parse(polishedText);
    this.polishedNote.innerHTML = htmlContent;
    this.setPlaceholder(this.polishedNote, !polishedText.trim());
  }

  private updateNoteTitle(polishedText: string): void {
    if (!this.editorTitle) return;

    const lines = polishedText.split('\n').map(l => l.trim());
    let titleSet = false;

    // Procurar por cabeçalho markdown
    for (const line of lines) {
      if (line.startsWith('#')) {
        const title = line.replace(/^#+\s+/, '').trim();
        if (title) {
          this.editorTitle.textContent = title;
          this.setPlaceholder(this.editorTitle, false);
          titleSet = true;
          break;
        }
      }
    }

    // Se não encontrou cabeçalho, usar primeira linha válida
    if (!titleSet) {
      for (const line of lines) {
        if (line.length > 0) {
          let potentialTitle = line.replace(/^[\*_\`#\->\s\[\]\(.\d)]+/, '');
          potentialTitle = potentialTitle.replace(/[\*_\`#]+$/, '').trim();

          if (potentialTitle.length > 3) {
            const maxLength = 60;
            this.editorTitle.textContent = potentialTitle.substring(0, maxLength) +
              (potentialTitle.length > maxLength ? '...' : '');
            this.setPlaceholder(this.editorTitle, false);
            titleSet = true;
            break;
          }
        }
      }
    }

    // Se ainda não definiu título, usar placeholder
    if (!titleSet) {
      this.setPlaceholder(this.editorTitle);
    }
  }

  private handlePolishError(message: string): void {
    this.setStatus('Erro ao melhorar a nota. Por favor, tente novamente.');

    if (this.polishedNote) {
      this.polishedNote.innerHTML = `<p><em>${message}</em></p>`;
      this.setPlaceholder(this.polishedNote);
    }
  }

  private saveNewNote(): void {
    try {
      if (!this.hasValidContent(this.polishedNote)) {
        this.setStatus(MESSAGES.NO_NOTE_TO_SAVE);
        return;
      }

      const noteContent = this.polishedNote.innerHTML;
      const textContent = noteContent.replace(/<[^>]*>/g, '');

      const now = new Date();
      const dateFormatted = now.toLocaleDateString('pt-BR');
      const timeFormatted = now.toLocaleTimeString('pt-BR');
      const title = this.hasValidContent(this.editorTitle)
        ? this.editorTitle.textContent
        : 'Nota sem título';

      const finalContent = `\n\n=== ${title} - ${dateFormatted} às ${timeFormatted} ===\n\n${textContent}\n\n`;

      const notesKey = 'voiceNotesAppNotas';
      const savedNotes = localStorage.getItem(notesKey) || '';
      const updatedNotes = savedNotes + finalContent;
      localStorage.setItem(notesKey, updatedNotes);

      this.setStatus(MESSAGES.NOTE_SAVED);

      if (this.currentNote) {
        this.currentNote.timestamp = Date.now();
      }

      this.createDownloadLink(updatedNotes);
    } catch (error) {
      console.error('Erro ao salvar a nota:', error);
      this.setStatus('Erro ao salvar a nota');
    }
  }

  private createDownloadLink(content: string): void {
    const existingLink = document.getElementById('download-notas');
    if (existingLink) {
      existingLink.remove();
    }

    const downloadLink = document.createElement('a');
    downloadLink.id = 'download-notas';
    downloadLink.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    downloadLink.download = 'minhas_notas.txt';
    downloadLink.textContent = 'Baixar todas as notas';
    downloadLink.className = 'download-link';

    this.recordingStatus.parentNode?.insertBefore(downloadLink, this.recordingStatus.nextSibling);
  }

  private createNewNote(): void {
    this.currentNote = {
      id: `note_${Date.now()}`,
      rawTranscription: '',
      polishedNote: '',
      timestamp: Date.now(),
    };

    // Reset displays
    this.setPlaceholder(this.rawTranscription);
    this.setPlaceholder(this.polishedNote);
    this.setPlaceholder(this.editorTitle);

    this.setStatus(MESSAGES.READY_TO_RECORD);

    // Stop recording if active
    if (this.isRecording) {
      this.mediaRecorder?.stop();
      this.isRecording = false;
      this.recordButton?.classList.remove('recording');
    } else {
      this.stopLiveDisplay();
    }
  }
}

// Initialize app and placeholder handlers
document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();

  // Setup contenteditable placeholder handlers
  document.querySelectorAll<HTMLElement>('[contenteditable][placeholder]').forEach(el => {
    const placeholder = el.getAttribute('placeholder')!;

    const updatePlaceholderState = () => {
      const currentText = (el.id === 'polishedNote' ? el.innerText : el.textContent)?.trim();
      const isEmpty = currentText === '' || currentText === placeholder;

      if (isEmpty) {
        if (el.id === 'polishedNote' && currentText === '') {
          el.innerHTML = placeholder;
        } else if (currentText === '') {
          el.textContent = '';
        }
        el.classList.add('placeholder-active');
      } else {
        el.classList.remove('placeholder-active');
      }
    };

    updatePlaceholderState();

    el.addEventListener('focus', function () {
      const currentText = (this.id === 'polishedNote' ? this.innerText : this.textContent)?.trim();
      if (currentText === placeholder) {
        if (this.id === 'polishedNote') {
          this.innerHTML = '';
        } else {
          this.textContent = '';
        }
        this.classList.remove('placeholder-active');
      }
    });

    el.addEventListener('blur', updatePlaceholderState);
  });
});

export { };