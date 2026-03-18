export interface SpeechCallbacks {
  onStart: () => void;
  onInterimResult: (transcript: string) => void;
  onFinalResult: (transcript: string) => void;
  onError: (error: string) => void;
  onEnd: () => void;
}

export interface SpeechController {
  start: () => void;
  stop: () => void;
  isListening: () => boolean;
  isSupported: () => boolean;
}

const DG_WS_URL = 'wss://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&interim_results=true&utterance_end_ms=1000';

export function createSpeechController(apiKey: string, callbacks: SpeechCallbacks): SpeechController {
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
  let stream: MediaStream | null = null;
  let ws: WebSocket | null = null;
  let listening = false;
  let accumulated = '';

  async function startRecording(): Promise<void> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      accumulated = '';

      // Connect to Deepgram WebSocket
      ws = new WebSocket(DG_WS_URL, ['token', apiKey]);

      ws.onopen = () => {
        // Start MediaRecorder and pipe audio chunks to WebSocket
        mediaRecorder = new MediaRecorder(stream!, { mimeType: getSupportedMimeType() });

        mediaRecorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0 && ws?.readyState === WebSocket.OPEN) {
            e.data.arrayBuffer().then((buf) => ws?.send(buf));
          }
        };

        mediaRecorder.start(100);
        listening = true;
        callbacks.onStart();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const transcript = data.channel?.alternatives?.[0]?.transcript;
          if (!transcript) return;

          if (data.is_final) {
            accumulated += (accumulated ? ' ' : '') + transcript;
            callbacks.onFinalResult(accumulated);
          } else {
            callbacks.onInterimResult(accumulated + (accumulated ? ' ' : '') + transcript);
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onerror = () => {
        callbacks.onError('Connection to Deepgram failed. Check your API key.');
        cleanup();
      };

      ws.onclose = () => {
        if (listening) {
          listening = false;
          callbacks.onEnd();
        }
      };
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone permission denied.'
        : 'Failed to access microphone.';
      callbacks.onError(msg);
    }
  }

  function cleanup(): void {
    listening = false;
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    ws = null;
  }

  return {
    start: () => { startRecording(); },
    stop: () => {
      if (!listening) return;
      if (accumulated) {
        callbacks.onFinalResult(accumulated);
      }
      cleanup();
      callbacks.onEnd();
    },
    isListening: () => listening,
    isSupported: () => true,
  };
}

function getSupportedMimeType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'audio/webm';
}
