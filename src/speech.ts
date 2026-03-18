import { pipeline } from '@huggingface/transformers';

export interface SpeechCallbacks {
  onStart: () => void;
  onTranscribing: () => void;
  onFinalResult: (transcript: string) => void;
  onError: (error: string) => void;
  onEnd: () => void;
  onModelLoading: (progress: number) => void;
}

export interface SpeechController {
  start: () => void;
  stop: () => void;
  isListening: () => boolean;
  isSupported: () => boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;
let modelLoading = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTranscriber(onProgress: (p: number) => void): Promise<any> {
  if (transcriber) return transcriber;
  if (modelLoading) throw new Error('Model is still loading');
  modelLoading = true;
  try {
    transcriber = await pipeline(
      'automatic-speech-recognition',
      'onnx-community/whisper-tiny.en',
      {
        dtype: 'q8' as const,
        device: 'wasm' as const,
        progress_callback: (p: Record<string, unknown>) => {
          if (typeof p.progress === 'number') onProgress(p.progress);
        },
      } as Parameters<typeof pipeline>[2],
    );
    return transcriber;
  } finally {
    modelLoading = false;
  }
}

export function createSpeechController(callbacks: SpeechCallbacks): SpeechController {
  const supported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  if (!supported) {
    return {
      start: () => callbacks.onError('Audio recording is not supported in this browser.'),
      stop: () => {},
      isListening: () => false,
      isSupported: () => false,
    };
  }

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let listening = false;
  let stream: MediaStream | null = null;

  async function startRecording(): Promise<void> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Release mic
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;

        if (audioChunks.length === 0) {
          callbacks.onError('No audio recorded.');
          callbacks.onEnd();
          return;
        }

        const audioBlob = new Blob(audioChunks, { type: mediaRecorder!.mimeType });
        const audioUrl = URL.createObjectURL(audioBlob);
        callbacks.onTranscribing();

        try {
          const model = await getTranscriber(callbacks.onModelLoading);
          const result = await model(audioUrl);
          URL.revokeObjectURL(audioUrl);
          const text = (result as { text: string }).text?.trim() || '';
          if (text) {
            callbacks.onFinalResult(text);
          } else {
            callbacks.onError('No speech detected. Try again.');
          }
        } catch (err) {
          callbacks.onError(err instanceof Error ? err.message : 'Transcription failed.');
        }
        callbacks.onEnd();
      };

      mediaRecorder.start(250); // collect chunks every 250ms
      listening = true;
      callbacks.onStart();
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone permission denied.'
        : 'Failed to access microphone.';
      callbacks.onError(msg);
    }
  }

  return {
    start: () => { startRecording(); },
    stop: () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        listening = false;
        mediaRecorder.stop();
      }
    },
    isListening: () => listening,
    isSupported: () => true,
  };
}
