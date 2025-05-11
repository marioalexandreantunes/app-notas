/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI} from '@google/genai';
import {marked} from 'marked';
import * as fs from 'fs';
import * as path from 'path';

const MODEL_NAME = 'gemini-2.5-flash-preview-04-17';

interface Note {
  id: string;
  rawTranscription: string;
  polishedNote: string;
  timestamp: number;
}

class VoiceNotesApp {
  private genAI: any;
  private mediaRecorder: MediaRecorder | null = null;
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private rawTranscription: HTMLDivElement;
  private polishedNote: HTMLDivElement;
  private newButton: HTMLButtonElement;
  private saveButton: HTMLButtonElement;
  private themeToggleButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private currentNote: Note | null = null;
  private stream: MediaStream | null = null;
  private editorTitle: HTMLDivElement;
  private hasAttemptedPermission = false;

  private recordingInterface: HTMLDivElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement | null;
  private liveWaveformCtx: CanvasRenderingContext2D | null = null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private statusIndicatorDiv: HTMLDivElement | null;

  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;
  private waveformDrawingId: number | null = null;
  private timerIntervalId: number | null = null;
  private recordingStartTime: number = 0;

  constructor() {
    this.genAI = new GoogleGenAI({
      apiKey: process.env.API_KEY!,
      apiVersion: 'v1alpha',
    });

    this.recordButton = document.getElementById(
      'recordButton',
    ) as HTMLButtonElement;
    this.recordingStatus = document.getElementById(
      'recordingStatus',
    ) as HTMLDivElement;
    this.rawTranscription = document.getElementById(
      'rawTranscription',
    ) as HTMLDivElement;
    this.polishedNote = document.getElementById(
      'polishedNote',
    ) as HTMLDivElement;
    this.newButton = document.getElementById('newButton') as HTMLButtonElement;
    this.saveButton = document.getElementById('saveButton') as HTMLButtonElement;
    this.themeToggleButton = document.getElementById(
      'themeToggleButton',
    ) as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector(
      'i',
    ) as HTMLElement;
    this.editorTitle = document.querySelector(
      '.editor-title',
    ) as HTMLDivElement;

    this.recordingInterface = document.querySelector(
      '.recording-interface',
    ) as HTMLDivElement;
    this.liveRecordingTitle = document.getElementById(
      'liveRecordingTitle',
    ) as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById(
      'liveWaveformCanvas',
    ) as HTMLCanvasElement;
    this.liveRecordingTimerDisplay = document.getElementById(
      'liveRecordingTimerDisplay',
    ) as HTMLDivElement;

    if (this.liveWaveformCanvas) {
      this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    } else {
      console.warn(
        'Elemento de canvas para forma de onda não encontrado. O visualizador não funcionará.',
      );
    }

    if (this.recordingInterface) {
      this.statusIndicatorDiv = this.recordingInterface.querySelector(
        '.status-indicator',
      ) as HTMLDivElement;
    } else {
      console.warn('Elemento de interface de gravação não encontrado.');
      this.statusIndicatorDiv = null;
    }

    this.bindEventListeners();
    this.initTheme();
    this.createNewNote();
    this.saveNewNote();

    this.recordingStatus.textContent = 'Pronto para gravar';
  }

  private bindEventListeners(): void {
    this.recordButton.addEventListener('click', () => this.toggleRecording());
    this.newButton.addEventListener('click', () => this.createNewNote());
    this.saveButton.addEventListener('click', () => this.saveNewNote());
    this.themeToggleButton.addEventListener('click', () => this.toggleTheme());
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  private handleResize(): void {
    if (
      this.isRecording &&
      this.liveWaveformCanvas &&
      this.liveWaveformCanvas.style.display === 'block'
    ) {
      requestAnimationFrame(() => {
        this.setupCanvasDimensions();
      });
    }
  }

  private setupCanvasDimensions(): void {
    if (!this.liveWaveformCanvas || !this.liveWaveformCtx) return;

    const canvas = this.liveWaveformCanvas;
    const dpr = window.devicePixelRatio || 1;

    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width;
    const cssHeight = rect.height;

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    this.liveWaveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private initTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      this.themeToggleIcon.classList.remove('fa-sun');
      this.themeToggleIcon.classList.add('fa-moon');
    } else {
      document.body.classList.remove('light-mode');
      this.themeToggleIcon.classList.remove('fa-moon');
      this.themeToggleIcon.classList.add('fa-sun');
    }
  }

  private toggleTheme(): void {
    document.body.classList.toggle('light-mode');
    if (document.body.classList.contains('light-mode')) {
      localStorage.setItem('theme', 'light');
      this.themeToggleIcon.classList.remove('fa-sun');
      this.themeToggleIcon.classList.add('fa-moon');
    } else {
      localStorage.setItem('theme', 'dark');
      this.themeToggleIcon.classList.remove('fa-moon');
      this.themeToggleIcon.classList.add('fa-sun');
    }
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

    this.audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyserNode = this.audioContext.createAnalyser();

    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.75;

    const bufferLength = this.analyserNode.frequencyBinCount;
    this.waveformDataArray = new Uint8Array(bufferLength);

    source.connect(this.analyserNode);
  }

  private drawLiveWaveform(): void {
    if (
      !this.analyserNode ||
      !this.waveformDataArray ||
      !this.liveWaveformCtx ||
      !this.liveWaveformCanvas ||
      !this.isRecording
    ) {
      if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
      return;
    }

    this.waveformDrawingId = requestAnimationFrame(() =>
      this.drawLiveWaveform(),
    );
    this.analyserNode.getByteFrequencyData(this.waveformDataArray);

    const ctx = this.liveWaveformCtx;
    const canvas = this.liveWaveformCanvas;

    const logicalWidth = canvas.clientWidth;
    const logicalHeight = canvas.clientHeight;

    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    const bufferLength = this.analyserNode.frequencyBinCount;
    const numBars = Math.floor(bufferLength * 0.5);

    if (numBars === 0) return;

    const totalBarPlusSpacingWidth = logicalWidth / numBars;
    const barWidth = Math.max(1, Math.floor(totalBarPlusSpacingWidth * 0.7));
    const barSpacing = Math.max(0, Math.floor(totalBarPlusSpacingWidth * 0.3));

    let x = 0;

    const recordingColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-recording')
        .trim() || '#ff3b30';
    ctx.fillStyle = recordingColor;

    for (let i = 0; i < numBars; i++) {
      if (x >= logicalWidth) break;

      const dataIndex = Math.floor(i * (bufferLength / numBars));
      const barHeightNormalized = this.waveformDataArray[dataIndex] / 255.0;
      let barHeight = barHeightNormalized * logicalHeight;

      if (barHeight < 1 && barHeight > 0) barHeight = 1;
      barHeight = Math.round(barHeight);

      const y = Math.round((logicalHeight - barHeight) / 2);

      ctx.fillRect(Math.floor(x), y, barWidth, barHeight);
      x += barWidth + barSpacing;
    }
  }

  private updateLiveTimer(): void {
    if (!this.isRecording || !this.liveRecordingTimerDisplay) return;
    const now = Date.now();
    const elapsedMs = now - this.recordingStartTime;

    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hundredths = Math.floor((elapsedMs % 1000) / 10);

    this.liveRecordingTimerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
  }

  private startLiveDisplay(): void {
    if (
      !this.recordingInterface ||
      !this.liveRecordingTitle ||
      !this.liveWaveformCanvas ||
      !this.liveRecordingTimerDisplay
    ) {
      console.warn(
        'Um ou mais elementos de exibição ao vivo estão em falta. Não é possível iniciar a exibição ao vivo.',
      );
      return;
    }

    this.recordingInterface.classList.add('is-live');
    this.liveRecordingTitle.style.display = 'block';
    this.liveWaveformCanvas.style.display = 'block';
    this.liveRecordingTimerDisplay.style.display = 'block';

    this.setupCanvasDimensions();

    if (this.statusIndicatorDiv) this.statusIndicatorDiv.style.display = 'none';

    const iconElement = this.recordButton.querySelector(
      '.record-button-inner i',
    ) as HTMLElement;
    if (iconElement) {
      iconElement.classList.remove('fa-microphone');
      iconElement.classList.add('fa-stop');
    }

    const currentTitle = this.editorTitle.textContent?.trim();
    const placeholder =
      this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    this.liveRecordingTitle.textContent =
      currentTitle && currentTitle !== placeholder
        ? currentTitle
        : 'Nova Gravação';

    this.setupAudioVisualizer();
    this.drawLiveWaveform();

    this.recordingStartTime = Date.now();
    this.updateLiveTimer();
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = window.setInterval(() => this.updateLiveTimer(), 50);
  }

  private stopLiveDisplay(): void {
    if (
      !this.recordingInterface ||
      !this.liveRecordingTitle ||
      !this.liveWaveformCanvas ||
      !this.liveRecordingTimerDisplay
    ) {
      if (this.recordingInterface)
        this.recordingInterface.classList.remove('is-live');
      return;
    }
    this.recordingInterface.classList.remove('is-live');
    this.liveRecordingTitle.style.display = 'none';
    this.liveWaveformCanvas.style.display = 'none';
    this.liveRecordingTimerDisplay.style.display = 'none';

    if (this.statusIndicatorDiv)
      this.statusIndicatorDiv.style.display = 'block';

    const iconElement = this.recordButton.querySelector(
      '.record-button-inner i',
    ) as HTMLElement;
    if (iconElement) {
      iconElement.classList.remove('fa-stop');
      iconElement.classList.add('fa-microphone');
    }

    if (this.waveformDrawingId) {
      cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
    }
    if (this.timerIntervalId) {
      clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    if (this.liveWaveformCtx && this.liveWaveformCanvas) {
      this.liveWaveformCtx.clearRect(
        0,
        0,
        this.liveWaveformCanvas.width,
        this.liveWaveformCanvas.height,
      );
    }

    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext
          .close()
          .catch((e) => console.warn('Erro ao fechar o contexto de áudio', e));
      }
      this.audioContext = null;
    }
    this.analyserNode = null;
    this.waveformDataArray = null;
  }

  private async startRecording(): Promise<void> {
    try {
      this.audioChunks = [];
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close();
        this.audioContext = null;
      }

      this.recordingStatus.textContent = 'A solicitar acesso ao microfone...';

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({audio: true});
      } catch (err) {
        console.error('Failed with basic constraints:', err);
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }

      try {
        this.mediaRecorder = new MediaRecorder(this.stream, {
          mimeType: 'audio/webm',
        });
      } catch (e) {
        console.error('audio/webm não suportado, a tentar formato padrão:', e);
        this.mediaRecorder = new MediaRecorder(this.stream);
      }

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0)
          this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        this.stopLiveDisplay();

        if (this.audioChunks.length > 0) {
          const audioBlob = new Blob(this.audioChunks, {
            type: this.mediaRecorder?.mimeType || 'audio/webm',
          });
          this.processAudio(audioBlob).catch((err) => {
            console.error('Erro ao processar áudio:', err);
            this.recordingStatus.textContent = 'Erro ao processar a gravação';
          });
        } else {
          this.recordingStatus.textContent =
            'Nenhum áudio capturado. Por favor, tente novamente.';
        }

        if (this.stream) {
          this.stream.getTracks().forEach((track) => {
            track.stop();
          });
          this.stream = null;
        }
      };

      this.mediaRecorder.start();
      this.isRecording = true;

      this.recordButton.classList.add('recording');
      this.recordButton.setAttribute('title', 'Parar Gravação');

      this.startLiveDisplay();
    } catch (error) {
      console.error('Erro ao iniciar a gravação:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'Unknown';

      if (
        errorName === 'NotAllowedError' ||
        errorName === 'PermissionDeniedError'
      ) {
        this.recordingStatus.textContent =
          'Permissão do microfone negada. Por favor, verifique as configurações do navegador e recarregue a página.';
      } else if (
        errorName === 'NotFoundError' ||
        (errorName === 'DOMException' &&
          errorMessage.includes('Requested device not found'))
      ) {
        this.recordingStatus.textContent =
          'Nenhum microfone encontrado. Por favor, conecte um microfone.';
      } else if (
        errorName === 'NotReadableError' ||
        errorName === 'AbortError' ||
        (errorName === 'DOMException' &&
          errorMessage.includes('Failed to allocate audiosource'))
      ) {
        this.recordingStatus.textContent =
          'Não é possível aceder ao microfone. Pode estar a ser utilizado por outra aplicação.';
      } else {
        this.recordingStatus.textContent = `Erro: ${errorMessage}`;
      }

      this.isRecording = false;
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Iniciar Gravação');
      this.stopLiveDisplay();
    }
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

      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Iniciar Gravação');
      this.recordingStatus.textContent = 'A processar áudio...';
    } else {
      if (!this.isRecording) this.stopLiveDisplay();
    }
  }

  private async processAudio(audioBlob: Blob): Promise<void> {
    if (audioBlob.size === 0) {
      this.recordingStatus.textContent =
        'Nenhum áudio capturado. Por favor, tente novamente.';
      return;
    }

    try {
      URL.createObjectURL(audioBlob);

      this.recordingStatus.textContent = 'A converter áudio...';

      const reader = new FileReader();
      const readResult = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          try {
            const base64data = reader.result as string;
            const base64Audio = base64data.split(',')[1];
            resolve(base64Audio);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(reader.error);
      });
      reader.readAsDataURL(audioBlob);
      const base64Audio = await readResult;

      if (!base64Audio) throw new Error('Falha ao converter áudio para base64');

      const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
      await this.getTranscription(base64Audio, mimeType);
    } catch (error) {
      console.error('Erro no processamento de áudio:', error);
      this.recordingStatus.textContent =
        'Erro ao processar a gravação. Por favor, tente novamente.';
    }
  }

  private async getTranscription(
    base64Audio: string,
    mimeType: string,
  ): Promise<void> {
    try {
      this.recordingStatus.textContent = 'Obter transcrição...';

      const contents = [
        {text: 'Gere uma transcrição completa e detalhada deste áudio.'},
        {inlineData: {mimeType: mimeType, data: base64Audio}},
      ];

      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
      });

      const transcriptionText = response.text;

      if (transcriptionText) {
        this.rawTranscription.textContent = transcriptionText;
        if (transcriptionText.trim() !== '') {
          this.rawTranscription.classList.remove('placeholder-active');
        } else {
          const placeholder =
            this.rawTranscription.getAttribute('placeholder') || '';
          this.rawTranscription.textContent = placeholder;
          this.rawTranscription.classList.add('placeholder-active');
        }

        if (this.currentNote)
          this.currentNote.rawTranscription = transcriptionText;
        this.recordingStatus.textContent =
          'Transcrição completa. A melhorar a nota...';
        this.getPolishedNote().catch((err) => {
          console.error('Erro ao melhorar a nota:', err);
          this.recordingStatus.textContent =
            'Erro ao melhorar a nota após a transcrição.';
        });
      } else {
        this.recordingStatus.textContent =
          'A transcrição falhou ou retornou vazia.';
        this.polishedNote.innerHTML =
          '<p><em>Não foi possível transcrever o áudio. Por favor, tente novamente.</em></p>';
        this.rawTranscription.textContent =
          this.rawTranscription.getAttribute('placeholder');
        this.rawTranscription.classList.add('placeholder-active');
      }
    } catch (error) {
      console.error('Erro ao obter a transcrição:', error);
      this.recordingStatus.textContent =
        'Erro ao obter a transcrição. Por favor, tente novamente.';
      this.polishedNote.innerHTML = `<p><em>Erro durante a transcrição: ${error instanceof Error ? error.message : String(error)}</em></p>`;
      this.rawTranscription.textContent =
        this.rawTranscription.getAttribute('placeholder');
      this.rawTranscription.classList.add('placeholder-active');
    }
  }

  private async getPolishedNote(): Promise<void> {
    try {
      if (
        !this.rawTranscription.textContent ||
        this.rawTranscription.textContent.trim() === '' ||
        this.rawTranscription.classList.contains('placeholder-active')
      ) {
        this.recordingStatus.textContent = 'Sem transcrição para melhorar';
        this.polishedNote.innerHTML =
          '<p><em>Nenhuma transcrição disponível para melhorar.</em></p>';
        const placeholder = this.polishedNote.getAttribute('placeholder') || '';
        this.polishedNote.innerHTML = placeholder;
        this.polishedNote.classList.add('placeholder-active');
        return;
      }

      this.recordingStatus.textContent = 'A melhorar a nota...';

      const prompt = `Pegue nesta transcrição bruta e crie uma nota bem formatada e melhorada.
                    Remova palavras de preenchimento (hum, ah, tipo), repetições e falsos começos.
                    Formate corretamente quaisquer listas ou marcadores. Use formatação markdown para títulos, listas, etc.
                    Mantenha todo o conteúdo e significado original.

                    Transcrição bruta:
                    ${this.rawTranscription.textContent}`;
      const contents = [{text: prompt}];

      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
      });
      const polishedText = response.text;

      if (polishedText) {
        const htmlContent = marked.parse(polishedText);
        this.polishedNote.innerHTML = htmlContent;
        if (polishedText.trim() !== '') {
          this.polishedNote.classList.remove('placeholder-active');
        } else {
          const placeholder =
            this.polishedNote.getAttribute('placeholder') || '';
          this.polishedNote.innerHTML = placeholder;
          this.polishedNote.classList.add('placeholder-active');
        }

        let noteTitleSet = false;
        const lines = polishedText.split('\n').map((l) => l.trim());

        for (const line of lines) {
          if (line.startsWith('#')) {
            const title = line.replace(/^#+\s+/, '').trim();
            if (this.editorTitle && title) {
              this.editorTitle.textContent = title;
              this.editorTitle.classList.remove('placeholder-active');
              noteTitleSet = true;
              break;
            }
          }
        }

        if (!noteTitleSet && this.editorTitle) {
          for (const line of lines) {
            if (line.length > 0) {
              let potentialTitle = line.replace(
                /^[\*_\`#\->\s\[\]\(.\d)]+/,
                '',
              );
              potentialTitle = potentialTitle.replace(/[\*_\`#]+$/, '');
              potentialTitle = potentialTitle.trim();

              if (potentialTitle.length > 3) {
                const maxLength = 60;
                this.editorTitle.textContent =
                  potentialTitle.substring(0, maxLength) +
                  (potentialTitle.length > maxLength ? '...' : '');
                this.editorTitle.classList.remove('placeholder-active');
                noteTitleSet = true;
                break;
              }
            }
          }
        }

        if (!noteTitleSet && this.editorTitle) {
          const currentEditorText = this.editorTitle.textContent?.trim();
          const placeholderText =
            this.editorTitle.getAttribute('placeholder') || 'Nota sem Título';
          if (
            currentEditorText === '' ||
            currentEditorText === placeholderText
          ) {
            this.editorTitle.textContent = placeholderText;
            if (!this.editorTitle.classList.contains('placeholder-active')) {
              this.editorTitle.classList.add('placeholder-active');
            }
          }
        }

        if (this.currentNote) this.currentNote.polishedNote = polishedText;
        this.recordingStatus.textContent =
          'Nota melhorada. Pronto para a próxima gravação.';
      } else {
        this.recordingStatus.textContent =
          'O melhoramento falhou ou retornou vazio.';
        this.polishedNote.innerHTML =
          '<p><em>O melhoramento retornou vazio. A transcrição bruta está disponível.</em></p>';
        if (
          this.polishedNote.textContent?.trim() === '' ||
          this.polishedNote.innerHTML.includes('<em>O melhoramento retornou vazio')
        ) {
          const placeholder =
            this.polishedNote.getAttribute('placeholder') || '';
          this.polishedNote.innerHTML = placeholder;
          this.polishedNote.classList.add('placeholder-active');
        }
      }
    } catch (error) {
      console.error('Erro ao melhorar a nota:', error);
      this.recordingStatus.textContent =
        'Erro ao melhorar a nota. Por favor, tente novamente.';
      this.polishedNote.innerHTML = `<p><em>Erro durante o melhoramento: ${error instanceof Error ? error.message : String(error)}</em></p>`;
      if (
        this.polishedNote.textContent?.trim() === '' ||
        this.polishedNote.innerHTML.includes('<em>Erro durante o melhoramento')
      ) {
        const placeholder = this.polishedNote.getAttribute('placeholder') || '';
        this.polishedNote.innerHTML = placeholder;
        this.polishedNote.classList.add('placeholder-active');
      }
    }
  }

  private saveNewNote(): void {
    try {
      // Verifica se há conteúdo para salvar
      if (!this.polishedNote || this.polishedNote.classList.contains('placeholder-active')) {
        this.recordingStatus.textContent = 'Nenhuma nota para salvar';
        return;
      }

      // Obtém o conteúdo HTML da nota polida
      const noteContent = this.polishedNote.innerHTML;
      
      // Converte HTML para texto simples (opcional, dependendo da necessidade)
      const textContent = noteContent.replace(/<[^>]*>/g, '');
      
      // Cria um cabeçalho com data e hora
      const agora = new Date();
      const dataFormatada = agora.toLocaleDateString('pt-BR');
      const horaFormatada = agora.toLocaleTimeString('pt-BR');
      const titulo = this.editorTitle && !this.editorTitle.classList.contains('placeholder-active') 
        ? this.editorTitle.textContent 
        : 'Nota sem título';
      
      // Formata o conteúdo a ser salvo
      const conteudoFinal = `\n\n=== ${titulo} - ${dataFormatada} às ${horaFormatada} ===\n\n${textContent}\n\n`;
      
      // Salva a nota no localStorage
      const chaveNotas = 'voiceNotesAppNotas';
      let notasSalvas = localStorage.getItem(chaveNotas) || '';
      
      // Anexa a nova nota ao conteúdo existente
      notasSalvas += conteudoFinal;
      
      // Salva no localStorage
      localStorage.setItem(chaveNotas, notasSalvas);
      
      this.recordingStatus.textContent = 'Nota salva com sucesso no navegador';
      
      // Atualiza o timestamp da nota atual
      if (this.currentNote) {
        this.currentNote.timestamp = Date.now();
      }
      
      // Opcional: Cria um link para download das notas
      this.criarLinkDownloadNotas(notasSalvas);
    } catch (error) {
      console.error('Erro ao salvar a nota:', error);
      this.recordingStatus.textContent = 'Erro ao salvar a nota';
    }
  }
  
  private criarLinkDownloadNotas(conteudo: string): void {
    // Verifica se já existe um link de download e o remove
    const linkAnterior = document.getElementById('download-notas');
    if (linkAnterior) {
      linkAnterior.remove();
    }
    
    // Cria um elemento de link para download
    const linkDownload = document.createElement('a');
    linkDownload.id = 'download-notas';
    linkDownload.href = URL.createObjectURL(new Blob([conteudo], {type: 'text/plain'}));
    linkDownload.download = 'minhas_notas.txt';
    linkDownload.textContent = 'Baixar todas as notas';
    linkDownload.className = 'download-link';
    
    // Adiciona o link após o status de gravação
    this.recordingStatus.parentNode?.insertBefore(linkDownload, this.recordingStatus.nextSibling);
  }

  private createNewNote(): void {
    this.currentNote = {
      id: `note_${Date.now()}`,
      rawTranscription: '',
      polishedNote: '',
      timestamp: Date.now(),
    };

    const rawPlaceholder =
      this.rawTranscription.getAttribute('placeholder') || '';
    this.rawTranscription.textContent = rawPlaceholder;
    this.rawTranscription.classList.add('placeholder-active');

    const polishedPlaceholder =
      this.polishedNote.getAttribute('placeholder') || '';
    this.polishedNote.innerHTML = polishedPlaceholder;
    this.polishedNote.classList.add('placeholder-active');

    if (this.editorTitle) {
      const placeholder =
        this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
      this.editorTitle.textContent = placeholder;
      this.editorTitle.classList.add('placeholder-active');
    }
    this.recordingStatus.textContent = 'Pronto para gravar';

    if (this.isRecording) {
      this.mediaRecorder?.stop();
      this.isRecording = false;
      this.recordButton.classList.remove('recording');
    } else {
      this.stopLiveDisplay();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();

  document
    .querySelectorAll<HTMLElement>('[contenteditable][placeholder]')
    .forEach((el) => {
      const placeholder = el.getAttribute('placeholder')!;

      function updatePlaceholderState() {
        const currentText = (
          el.id === 'polishedNote' ? el.innerText : el.textContent
        )?.trim();

        if (currentText === '' || currentText === placeholder) {
          if (el.id === 'polishedNote' && currentText === '') {
            el.innerHTML = placeholder;
          } else if (currentText === '') {
            el.textContent = placeholder;
          }
          el.classList.add('placeholder-active');
        } else {
          el.classList.remove('placeholder-active');
        }
      }

      updatePlaceholderState();

      el.addEventListener('focus', function () {
        const currentText = (
          this.id === 'polishedNote' ? this.innerText : this.textContent
        )?.trim();
        if (currentText === placeholder) {
          if (this.id === 'polishedNote') this.innerHTML = '';
          else this.textContent = '';
          this.classList.remove('placeholder-active');
        }
      });

      el.addEventListener('blur', function () {
        updatePlaceholderState();
      });
    });
});

export {};
