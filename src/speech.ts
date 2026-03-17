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

const ERROR_MAP: Record<string, string> = {
  'no-speech': 'No speech detected. Try again.',
  'audio-capture': 'No microphone found.',
  'not-allowed': 'Microphone permission denied.',
  'network': 'Network error during recognition.',
};

export function createSpeechController(callbacks: SpeechCallbacks): SpeechController {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SR) {
    return {
      start: () => callbacks.onError('Speech recognition is not supported in this browser.'),
      stop: () => {},
      isListening: () => false,
      isSupported: () => false,
    };
  }

  const recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  let listening = false;
  let accumulated = '';

  recognition.onstart = () => {
    listening = true;
    accumulated = '';
    callbacks.onStart();
  };

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let full = '';
    for (let i = 0; i < event.results.length; i++) {
      full += event.results[i][0].transcript;
    }

    // Check if latest result is final
    const latest = event.results[event.results.length - 1];
    if (latest.isFinal) {
      accumulated = full;
      callbacks.onFinalResult(full);
    } else {
      callbacks.onInterimResult(full);
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    listening = false;
    callbacks.onError(ERROR_MAP[event.error] || `Speech error: ${event.error}`);
  };

  recognition.onend = () => {
    listening = false;
    if (accumulated) {
      callbacks.onFinalResult(accumulated);
    }
    callbacks.onEnd();
  };

  return {
    start: () => {
      if (!listening) {
        try { recognition.start(); } catch { /* already started */ }
      }
    },
    stop: () => {
      if (listening) recognition.stop();
    },
    isListening: () => listening,
    isSupported: () => true,
  };
}
