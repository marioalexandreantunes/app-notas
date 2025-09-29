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
  CONTINUOUS_RECORDING: 'Gravação contínua ativa - processando a cada 2 minutos',
  PROCESSING_SEGMENT: 'Processando segmento em segundo plano...',
  RECORDING_CONTINUOUS: 'Gravando continuamente (sem interrupções)',
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

interface AudioSegment {
  blob: Blob;
  startTime: number;
  endTime: number;
  segmentNumber: number;
}

class VoiceNotesApp {
  private genAI: any;
  private primaryRecorder: MediaRecorder | null = null;
  private secondaryRecorder: MediaRecorder | null = null;
  private activeRecorder: 'primary' | 'secondary' = 'primary';

  // Elementos DOM
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private rawTranscription: HTMLDivElement;
  private polishedNote: HTMLDivElement;
  private newButton: HTMLButtonElement;
  private saveButton: HTMLButtonElement;
  private themeToggleButton: HTMLButtonButton;
  private themeToggleIcon: HTMLElement;
  private editorTitle: HTMLDivElement;
  private recordingInterface: HTMLDivElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement | null;
  private liveWaveformCtx: CanvasRenderingContext2D | null = null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private statusIndicatorDiv: HTMLDivElement | null;

  // Estado da aplicação
  private primaryAudioChunks: Blob[] = [];
  private secondaryAudioChunks: Blob[] = [];
  private isRecording = false;
  private isContinuousMode = false;
  private currentNote: Note | null = null;
  private openingTags: string = '';
  private closingTags: string = '';
  private segmentCount = 0;
  private accumulatedTranscription = '';
  private accumulatedPolishedNote = '';
  private processingQueue: AudioSegment[] = [];
  private isProcessingSegment = false;

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
  private segmentIntervalId: number | null = null;
  private currentSegmentStartTime: number = 0;
  private segmentStartTime: number = 0;

  // Configurações
  private readonly SEGMENT_DURATION_MS = 2 * 60 * 1000; // 2 minutos

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
    if (this.segmentIntervalId) {
      clearInterval(this.segmentIntervalId);
      this.segmentIntervalId = null;
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
      await this.startContinuousRecording();
    } else {
      await this.stopContinuousRecording();
    }
  }

  private async startContinuousRecording(): Promise<void> {
    try {
      this.isContinuousMode = true;
      this.segmentCount = 1;
      this.accumulatedTranscription = '';
      this.accumulatedPolishedNote = '';
      this.processingQueue = [];
      this.isProcessingSegment = false;

      await this.setupStreams();
      await this.startDualRecording();

      if (this.isRecording) {
        this.setStatus(MESSAGES.RECORDING_CONTINUOUS);
        this.setupSegmentTimer();
      }
    } catch (error) {
      console.error('Erro ao iniciar gravação contínua:', error);
      this.isContinuousMode = false;
      this.handleRecordingError(error);
    }
  }

  private async stopContinuousRecording(): Promise<void> {
    this.isContinuousMode = false;
    this.cleanupAnimations();

    // Processar último segmento se necessário
    if (this.isRecording) {
      await this.finalizeContinuousRecording();
    }

    await this.stopDualRecording();
    this.cleanupStreams();
  }

  private async setupStreams(): Promise<void> {
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
    this.stream = await this.setupFinalStream(hasTabAudio, hasMicAudio);
  }

  private async startDualRecording(): Promise<void> {
    // Reset chunks
    this.primaryAudioChunks = [];
    this.secondaryAudioChunks = [];

    // Configurar ambos os recorders
    this.setupDualMediaRecorders();

    // Iniciar gravação primary
    this.activeRecorder = 'primary';
    this.primaryRecorder!.start();
    this.segmentStartTime = Date.now();

    this.isRecording = true;
    this.recordButton?.classList.add('recording');
    this.recordButton?.setAttribute('title', 'Parar Gravação');
    this.startLiveDisplay();
  }

  private async stopDualRecording(): Promise<void> {
    if (this.primaryRecorder && this.primaryRecorder.state === 'recording') {
      this.primaryRecorder.stop();
    }
    if (this.secondaryRecorder && this.secondaryRecorder.state === 'recording') {
      this.secondaryRecorder.stop();
    }

    this.isRecording = false;
    this.recordButton?.classList.remove('recording');
    this.recordButton?.setAttribute('title', 'Iniciar Gravação');
    this.stopLiveDisplay();
  }

  private setupDualMediaRecorders(): void {
    const mimeType = this.getSupportedMimeType();

    // Setup Primary Recorder
    this.primaryRecorder = new MediaRecorder(this.stream!, { mimeType });
    this.setupRecorderEvents(this.primaryRecorder, 'primary');

    // Setup Secondary Recorder  
    this.secondaryRecorder = new MediaRecorder(this.stream!, { mimeType });
    this.setupRecorderEvents(this.secondaryRecorder, 'secondary');
  }

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  private setupRecorderEvents(recorder: MediaRecorder, type: 'primary' | 'secondary'): void {
    recorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        if (type === 'primary') {
          this.primaryAudioChunks.push(event.data);
        } else {
          this.secondaryAudioChunks.push(event.data);
        }
      }
    };

    recorder.onstop = () => {
      const chunks = type === 'primary' ? this.primaryAudioChunks : this.secondaryAudioChunks;

      if (chunks.length > 0) {
        const audioBlob = new Blob(chunks, { type: recorder.mimeType });
        const segment: AudioSegment = {
          blob: audioBlob,
          startTime: this.segmentStartTime,
          endTime: Date.now(),
          segmentNumber: this.segmentCount + 1
        };

        this.processingQueue.push(segment);
        this.processNextSegment();

        // Limpar chunks após criar o blob
        if (type === 'primary') {
          this.primaryAudioChunks = [];
        } else {
          this.secondaryAudioChunks = [];
        }
      }
    };
  }

  private setupSegmentTimer(): void {
    if (this.segmentIntervalId) {
      clearInterval(this.segmentIntervalId);
    }

    this.segmentIntervalId = window.setInterval(() => {
      if (this.isContinuousMode && this.isRecording) {
        this.switchRecorders();
      }
    }, this.SEGMENT_DURATION_MS);
  }

  private switchRecorders(): void {
    if (!this.isContinuousMode || !this.isRecording) return;

    try {
      const currentRecorder = this.activeRecorder === 'primary' ? this.primaryRecorder : this.secondaryRecorder;
      const nextRecorder = this.activeRecorder === 'primary' ? this.secondaryRecorder : this.primaryRecorder;

      if (!currentRecorder || !nextRecorder) return;

      // Parar o recorder atual (isso vai triggerar o onstop e processar o segmento)
      if (currentRecorder.state === 'recording') {
        currentRecorder.stop();
      }

      // Iniciar o próximo recorder imediatamente
      this.activeRecorder = this.activeRecorder === 'primary' ? 'secondary' : 'primary';
      this.segmentStartTime = Date.now();
      nextRecorder.start();

      console.log(`Switched to ${this.activeRecorder} recorder for segment ${this.segmentCount + 1}`);

    } catch (error) {
      console.error('Erro ao alternar recorders:', error);
    }
  }

  private async processNextSegment(): Promise<void> {
    if (this.isProcessingSegment || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessingSegment = true;
    const segment = this.processingQueue.shift()!;

    try {
      this.setStatus(`${MESSAGES.PROCESSING_SEGMENT} (Segmento ${segment.segmentNumber})`);
      await this.processAudioSegment(segment);
    } catch (error) {
      console.error(`Erro ao processar segmento ${segment.segmentNumber}:`, error);
    } finally {
      this.isProcessingSegment = false;

      // Processar próximo segmento se houver
      if (this.processingQueue.length > 0) {
        setTimeout(() => this.processNextSegment(), 100);
      } else if (this.isContinuousMode) {
        this.setStatus(MESSAGES.RECORDING_CONTINUOUS);
      }
    }
  }

  private async finalizeContinuousRecording(): Promise<void> {
    // Parar recorder ativo para capturar último segmento
    const activeRecorderObj = this.activeRecorder === 'primary' ? this.primaryRecorder : this.secondaryRecorder;

    if (activeRecorderObj && activeRecorderObj.state === 'recording') {
      activeRecorderObj.stop();
    }

    // Aguardar processamento de todos os segmentos
    let attempts = 0;
    while ((this.processingQueue.length > 0 || this.isProcessingSegment) && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 200));
      attempts++;
    }
  }

  private async processAudioSegment(segment: AudioSegment): Promise<void> {
    if (segment.blob.size === 0) {
      console.warn(`Segmento ${segment.segmentNumber} vazio`);
      return;
    }

    try {
      const wavBlob = await this.convertToWav(segment.blob);
      const base64Audio = await this.blobToBase64(wavBlob);

      if (!base64Audio) {
        throw new Error('Falha ao converter áudio para base64');
      }

      await this.getSegmentTranscription(base64Audio, segment.segmentNumber);
    } catch (error) {
      console.error(`Erro ao processar segmento ${segment.segmentNumber}:`, error);
      throw error;
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

    let timerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;

    if (this.isContinuousMode) {
      const segmentElapsed = Date.now() - this.segmentStartTime;
      const segmentSeconds = Math.floor(segmentElapsed / 1000);
      const segmentMinutes = Math.floor(segmentSeconds / 60);
      const segmentRemainingSeconds = segmentSeconds % 60;
      timerText += ` | Seg: ${String(segmentMinutes).padStart(2, '0')}:${String(segmentRemainingSeconds).padStart(2, '0')}`;

      if (this.processingQueue.length > 0 || this.isProcessingSegment) {
        timerText += ` | Processando: ${this.segmentCount} Seg`;
      }
    }

    this.liveRecordingTimerDisplay.textContent = timerText;
  }

  private startLiveDisplay(): void {
    const elements = [this.recordingInterface, this.liveRecordingTitle,
    this.liveWaveformCanvas, this.liveRecordingTimerDisplay];

    if (elements.some(el => !el)) {
      console.warn('Elementos de exibição ao vivo em falta.');
      return;
    }

    this.recordingInterface!.classList.add('is-live');
    [this.liveRecordingTitle, this.liveWaveformCanvas, this.liveRecordingTimerDisplay]
      .forEach(el => el!.style.display = 'block');

    this.setupCanvasDimensions();

    if (this.statusIndicatorDiv) {
      this.statusIndicatorDiv.style.display = 'none';
    }

    const iconElement = this.recordButton?.querySelector('.record-button-inner i') as HTMLElement;
    if (iconElement) {
      iconElement.classList.replace('fa-microphone', 'fa-stop');
    }

    const currentTitle = this.editorTitle?.textContent?.trim();
    const placeholder = this.editorTitle?.getAttribute('placeholder') || 'Untitled Note';
    let displayTitle = (currentTitle && currentTitle !== placeholder) ? currentTitle : 'Nova Gravação';

    if (this.isContinuousMode) {
      displayTitle += ' (Gravação Contínua - SEM Interrupções)';
    }

    this.liveRecordingTitle!.textContent = displayTitle;

    this.setupAudioVisualizer();
    this.drawLiveWaveform();

    this.recordingStartTime = Date.now();
    this.updateLiveTimer();
    this.timerIntervalId = window.setInterval(() => this.updateLiveTimer(), 50);
  }

  private stopLiveDisplay(): void {
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

    const iconElement = this.recordButton?.querySelector('.record-button-inner i') as HTMLElement;
    if (iconElement) {
      iconElement.classList.replace('fa-stop', 'fa-microphone');
    }

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

  private async captureAudioStreams(): Promise<{ screen: MediaStream | null, mic: MediaStream | null }> {
    let screenStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;

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
      }
    }

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
    this.isContinuousMode = false;
    this.cleanupStreams();
    this.recordButton?.classList.remove('recording');
    this.recordButton?.setAttribute('title', 'Iniciar Gravação');
    this.stopLiveDisplay();
  }

  private async convertToWav(audioBlob: Blob): Promise<Blob> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const { length, numberOfChannels, sampleRate } = audioBuffer;
    const channelData = Array.from({ length: numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));

    const interleaved = new Float32Array(length * numberOfChannels);
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        interleaved[i * numberOfChannels + channel] = channelData[channel][i];
      }
    }

    const buffer = new ArrayBuffer(44 + interleaved.length * 2);
    const view = new DataView(buffer);

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

    let offset = 44;
    for (let i = 0; i < interleaved.length; i++, offset += 2) {
      const sample = Math.max(-1, Math.min(1, interleaved[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    }

    return new Blob([view], { type: 'audio/wav' });
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

  private async getSegmentTranscription(base64Audio: string, segmentNumber: number): Promise<void> {
    try {
      const contents = [
        { text: 'Gere uma transcrição completa e detalhada deste áudio.' },
        { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
      ];

      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
      });

      const transcriptionText = response.text;

      if (transcriptionText) {
        this.segmentCount = Math.max(this.segmentCount, segmentNumber);
        const segmentHeader = `\n\n=== SEGMENTO ${segmentNumber} ===\n`;
        const finalRaw = this.addAudioTags(transcriptionText.trim());
        const fullTranscription = segmentHeader + finalRaw;

        this.accumulatedTranscription += fullTranscription;
        this.updateTranscriptionDisplay(this.accumulatedTranscription);

        if (this.currentNote) {
          this.currentNote.rawTranscription = this.accumulatedTranscription;
        }

        await this.getPolishedNote();
      } else {
        console.warn(`Transcrição vazia para segmento ${segmentNumber}`);
      }
    } catch (error) {
      console.error(`Erro na transcrição do segmento ${segmentNumber}:`, error);
      throw error;
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

    //this.rawTranscription.textContent = text;
    const htmlText = text.replace(/\n/g, '<br>');
    this.rawTranscription.innerHTML = htmlText;
    this.setPlaceholder(this.rawTranscription, !text.trim());

    // Scroll to bottom para mostrar novo conteúdo
    this.rawTranscription.scrollTop = this.rawTranscription.scrollHeight;
  }

  private async getPolishedNote(): Promise<void> {
    try {
      if (!this.hasValidContent(this.rawTranscription)) {
        return;
      }

      const prompt = `Pegue nesta transcrição bruta e crie uma nota bem formatada e melhorada.
                    Remova palavras de preenchimento (hum, ah, tipo), repetições e falsos começos.
                    Formate corretamente quaisquer listas ou marcadores. Use formatação markdown para títulos, listas, etc.
                    Mantenha todo o conteúdo e significado original.
                    Esta é uma transcrição de múltiplos segmentos de uma reunião contínua.

                    Transcrição bruta:
                    ${this.accumulatedTranscription}`;

      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: [{ text: prompt }],
      });

      const polishedText = response.text;

      if (polishedText) {
        this.accumulatedPolishedNote = polishedText;
        this.updatePolishedDisplay(polishedText);

        if (this.segmentCount === 1) {
          this.updateNoteTitle(polishedText);
        }

        if (this.currentNote) {
          this.currentNote.polishedNote = polishedText;
        }
      }
    } catch (error) {
      console.error('Erro ao melhorar a nota:', error);
    }
  }

  private updatePolishedDisplay(polishedText: string): void {
    if (!this.polishedNote) return;

    const htmlContent = marked.parse(polishedText);
    this.polishedNote.innerHTML = htmlContent;
    this.setPlaceholder(this.polishedNote, !polishedText.trim());

    // Scroll to bottom para mostrar novo conteúdo
    this.polishedNote.scrollTop = this.polishedNote.scrollHeight;
  }

  private updateNoteTitle(polishedText: string): void {
    if (!this.editorTitle) return;

    const lines = polishedText.split('\n').map(l => l.trim());
    let titleSet = false;

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

    if (!titleSet) {
      this.setPlaceholder(this.editorTitle);
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

      const segmentInfo = this.segmentCount > 0 ?
        ` (${this.segmentCount} segmentos)` : '';

      const finalContent = `\n\n=== ${title}${segmentInfo} - ${dateFormatted} às ${timeFormatted} ===\n\n${textContent}\n\n`;

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
    if (this.isContinuousMode) {
      this.isContinuousMode = false;
      this.cleanupAnimations();
    }

    this.currentNote = {
      id: `note_${Date.now()}`,
      rawTranscription: '',
      polishedNote: '',
      timestamp: Date.now(),
    };

    this.segmentCount = 0;
    this.accumulatedTranscription = '';
    this.accumulatedPolishedNote = '';
    this.processingQueue = [];
    this.isProcessingSegment = false;

    this.setPlaceholder(this.rawTranscription);
    this.setPlaceholder(this.polishedNote);
    this.setPlaceholder(this.editorTitle);

    this.setStatus(MESSAGES.READY_TO_RECORD);

    if (this.isRecording) {
      this.stopDualRecording();
    } else {
      this.stopLiveDisplay();
    }
  }
}

// Initialize app and placeholder handlers
document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();

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