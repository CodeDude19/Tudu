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
  let wsReady = false;
  let pendingChunks: ArrayBuffer[] = [];

  async function startRecording(): Promise<void> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      accumulated = '';
      wsReady = false;
      pendingChunks = [];

      // Start recording IMMEDIATELY — don't wait for WebSocket
      mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });

      mediaRecorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size === 0) return;
        e.data.arrayBuffer().then((buf) => {
          if (wsReady && ws?.readyState === WebSocket.OPEN) {
            // WebSocket ready — send directly
            ws.send(buf);
          } else {
            // Buffer until WebSocket opens
            pendingChunks.push(buf);
          }
        });
      };

      mediaRecorder.start(100);
      listening = true;
      callbacks.onStart();

      // Connect to Deepgram WebSocket IN PARALLEL
      ws = new WebSocket(DG_WS_URL, ['token', apiKey]);

      ws.onopen = () => {
        // Flush all buffered audio chunks
        for (const chunk of pendingChunks) {
          ws!.send(chunk);
        }
        pendingChunks = [];
        wsReady = true;
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
    wsReady = false;
    pendingChunks = [];
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
