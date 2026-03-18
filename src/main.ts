import { getApiKey, saveApiKey, addToHistory, getHistory } from './storage';
import { initClient, generateTasks } from './bedrock';
import { createSpeechController } from './speech';
import { renderTasks, renderArchive, addTask, replaceTask, showError, setLoading, setVoiceRedoHandler } from './ui';
import './style.css';

const credOverlay = document.getElementById('cred-overlay')!;
const app = document.getElementById('app')!;
const saveCredsBtn = document.getElementById('save-creds')!;
const settingsBtn = document.getElementById('settings-btn')!;
const taskForm = document.getElementById('task-form') as HTMLFormElement;
const taskInput = document.getElementById('task-input') as HTMLInputElement;
const island = document.getElementById('island')!;
const textToggleBtn = document.getElementById('text-toggle-btn')!;
const voiceBtn = document.getElementById('voice-btn')!;
const voiceLabel = document.querySelector('.island-voice-label')!;
const transcriptPreview = document.getElementById('transcript-preview')!;
const transcriptText = document.getElementById('transcript-text')!;
const transcriptStatus = transcriptPreview.querySelector('.transcript-status')!;
const waveform = document.getElementById('waveform')!;

// ── Waveform ──
const BAR_COUNT = 24;
let waveformFrame = 0;
const bars: HTMLDivElement[] = [];

function initWaveform(): void {
  waveform.innerHTML = '';
  bars.length = 0;
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement('div');
    bar.className = 'waveform-bar';
    bar.style.height = '3px';
    waveform.appendChild(bar);
    bars.push(bar);
  }
}

function animateWaveform(): void {
  bars.forEach((bar, i) => {
    const base = Math.sin(Date.now() * 0.003 + i * 0.5) * 0.5 + 0.5;
    const jitter = Math.sin(Date.now() * 0.007 + i * 1.3) * 0.3;
    const h = 3 + (base + jitter) * 22;
    bar.style.height = `${Math.max(3, h)}px`;
    bar.style.opacity = `${0.4 + (h / 25) * 0.5}`;
  });
  waveformFrame = requestAnimationFrame(animateWaveform);
}

function startWaveform(): void {
  waveformStopping = false;
  initWaveform();
  waveform.classList.remove('hidden');
  waveform.classList.remove('dock-fade-out');
  waveformFrame = requestAnimationFrame(animateWaveform);
}

let waveformStopping = false;

function stopWaveform(): void {
  cancelAnimationFrame(waveformFrame);
  if (waveform.classList.contains('hidden') || waveformStopping) return;
  waveformStopping = true;
  // Collapse bars to flat
  bars.forEach((bar) => {
    bar.style.transition = 'height 0.25s ease, opacity 0.25s ease';
    bar.style.height = '3px';
    bar.style.opacity = '0.3';
  });
  // Then fade out the container
  setTimeout(() => {
    waveform.classList.add('dock-fade-out');
    waveform.addEventListener('animationend', () => {
      waveform.classList.add('hidden');
      waveform.classList.remove('dock-fade-out');
      bars.forEach((bar) => { bar.style.transition = ''; });
      waveformStopping = false;
    }, { once: true });
  }, 250);
}

// History panel
const historyBtn = document.getElementById('history-btn')!;
const historyPanel = document.getElementById('history-panel')!;
const historyClose = document.getElementById('history-close')!;
const historyList = document.getElementById('history-list')!;
const historyEmpty = document.getElementById('history-empty')!;

// Archive panel
const archiveBtn = document.getElementById('archive-btn')!;
const archivePanel = document.getElementById('archive-panel')!;
const archiveClose = document.getElementById('archive-close')!;

// ── App state ──
type AppState = 'idle' | 'recording' | 'transcribing' | 'generating';
let appState: AppState = 'idle';
let redoTaskId: string | null = null;

function setAppState(state: AppState): void {
  appState = state;
  island.classList.remove('recording', 'generating', 'transcribing', 'typing');

  switch (state) {
    case 'idle':
      voiceLabel.textContent = 'Speak';
      (voiceBtn as HTMLButtonElement).disabled = false;
      stopWaveform();
      if (!transcriptPreview.classList.contains('hidden')) {
        transcriptPreview.classList.add('dock-fade-out');
        transcriptPreview.addEventListener('animationend', () => {
          transcriptPreview.classList.add('hidden');
          transcriptPreview.classList.remove('dock-fade-out');
        }, { once: true });
      }
      break;
    case 'recording':
      island.classList.add('recording');
      voiceLabel.textContent = 'Tap to stop';
      transcriptPreview.classList.remove('hidden');
      transcriptPreview.classList.remove('dock-fade-out');
      transcriptStatus.textContent = redoTaskId ? 'Re-recording...' : 'Listening...';
      transcriptText.textContent = '';
      startWaveform();
      break;
    case 'transcribing':
      island.classList.add('transcribing');
      voiceLabel.textContent = 'Transcribing...';
      (voiceBtn as HTMLButtonElement).disabled = true;
      stopWaveform();
      transcriptPreview.classList.remove('hidden');
      transcriptPreview.classList.remove('dock-fade-out');
      transcriptStatus.textContent = 'Transcribing...';
      transcriptText.textContent = '';
      break;
    case 'generating':
      island.classList.add('generating');
      voiceLabel.textContent = redoTaskId ? 'Updating...' : 'Generating...';
      (voiceBtn as HTMLButtonElement).disabled = true;
      transcriptStatus.textContent = redoTaskId ? 'Updating task...' : 'Generating tasks...';
      break;
  }
}

// ── Speech controller ──
let finalTranscript = '';

const speech = createSpeechController({
  onStart: () => setAppState('recording'),
  onTranscribing: () => setAppState('transcribing'),
  onFinalResult: (transcript) => {
    finalTranscript = transcript;
    transcriptText.textContent = transcript;
  },
  onError: (error) => {
    showError(error);
    redoTaskId = null;
    setAppState('idle');
  },
  onEnd: () => {
    if (finalTranscript.trim()) {
      if (redoTaskId) {
        submitVoiceRedo(redoTaskId, finalTranscript.trim());
      } else {
        submitVoiceInput(finalTranscript.trim());
      }
    } else {
      redoTaskId = null;
      setAppState('idle');
    }
  },
  onModelLoading: (progress) => {
    transcriptText.textContent = `Loading speech model... ${Math.round(progress)}%`;
  },
});

async function submitVoiceInput(input: string): Promise<void> {
  setAppState('generating');
  setLoading(true);
  try {
    addToHistory(input);
    const tasks = await generateTasks(input);
    for (const t of tasks) addTask(t);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Failed to generate tasks');
  } finally {
    finalTranscript = '';
    redoTaskId = null;
    setLoading(false);
    setAppState('idle');
  }
}

async function submitVoiceRedo(taskId: string, input: string): Promise<void> {
  setAppState('generating');
  setLoading(true);
  try {
    addToHistory(input);
    const tasks = await generateTasks(input);
    if (tasks.length > 0) {
      replaceTask(taskId, tasks[0]);
      for (let i = 1; i < tasks.length; i++) addTask(tasks[i]);
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Failed to update task');
  } finally {
    finalTranscript = '';
    redoTaskId = null;
    setLoading(false);
    setAppState('idle');
  }
}

// Fallback: if voice unsupported, show typing by default
if (!speech.isSupported()) {
  voiceBtn.classList.add('hidden');
  voiceLabel.classList.add('hidden');
  island.classList.add('typing');
}

// ── Voice button: tap to start/stop ──
voiceBtn.addEventListener('click', () => {
  if (appState === 'idle') {
    // If typing, dismiss it first
    island.classList.remove('typing');
    taskInput.blur();
    finalTranscript = '';
    speech.start();
  } else if (appState === 'recording') {
    speech.stop();
  }
});

// Voice redo handler
setVoiceRedoHandler((taskId) => {
  if (appState !== 'idle') return;
  island.classList.remove('typing');
  redoTaskId = taskId;
  finalTranscript = '';
  speech.start();
});

// ── Type toggle: morph island into input ──
textToggleBtn.addEventListener('click', () => {
  if (appState !== 'idle') return;
  island.classList.add('typing');
  setTimeout(() => taskInput.focus(), 350);
});

// Collapse typing when input blurs and is empty
taskInput.addEventListener('blur', () => {
  setTimeout(() => {
    if (!taskInput.value.trim() && !document.activeElement?.closest('.island')) {
      island.classList.remove('typing');
    }
  }, 150);
});

// ── Screens ──
function showApp(): void {
  credOverlay.classList.add('hidden');
  app.classList.remove('hidden');
  renderTasks();
}

function showSetup(): void {
  credOverlay.classList.remove('hidden');
  app.classList.add('hidden');
  const key = getApiKey();
  if (key) {
    (document.getElementById('api-key') as HTMLInputElement).value = key;
  }
}

saveCredsBtn.addEventListener('click', () => {
  const key = (document.getElementById('api-key') as HTMLInputElement).value.trim();
  if (!key) return;
  saveApiKey(key);
  initClient(key);
  showApp();
});

settingsBtn.addEventListener('click', showSetup);

// Close creds modal (dismiss without saving)
document.getElementById('close-creds')!.addEventListener('click', () => {
  // Only allow closing if we already have a key (not first-time setup)
  if (getApiKey()) {
    credOverlay.classList.add('hidden');
    app.classList.remove('hidden');
  }
});

// ── Text form submit ──
taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = taskInput.value.trim();
  if (!input) return;

  setAppState('generating');
  setLoading(true);
  try {
    addToHistory(input);
    const tasks = await generateTasks(input);
    for (const t of tasks) addTask(t);
    taskInput.value = '';
    island.classList.remove('typing');
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Failed to generate task');
  } finally {
    setLoading(false);
    setAppState('idle');
  }
});

// ── History panel ──
function renderHistory(): void {
  const history = getHistory();
  historyList.innerHTML = '';
  if (history.length === 0) {
    historyEmpty.classList.remove('hidden');
    return;
  }
  historyEmpty.classList.add('hidden');
  [...history].reverse().forEach((text) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.textContent = text;
    historyList.appendChild(li);
  });
}

const taskArea = document.getElementById('task-area')!;

function openHistory(): void {
  renderHistory();
  taskArea.classList.add('view-exit');
  taskArea.addEventListener('animationend', () => {
    taskArea.classList.add('hidden');
    taskArea.classList.remove('view-exit');
    historyPanel.classList.remove('hidden');
    // Scroll history to bottom
    requestAnimationFrame(() => {
      historyPanel.scrollTop = historyPanel.scrollHeight;
    });
  }, { once: true });
}

function closeHistory(): void {
  historyPanel.classList.add('view-exit');
  historyPanel.addEventListener('animationend', () => {
    historyPanel.classList.add('hidden');
    historyPanel.classList.remove('view-exit');
    taskArea.classList.remove('hidden');
  }, { once: true });
}

historyBtn.addEventListener('click', () => {
  const isOpen = !historyPanel.classList.contains('hidden');
  if (isOpen) closeHistory();
  else openHistory();
});

historyClose.addEventListener('click', closeHistory);

// ── Archive panel ──
function openArchive(): void {
  renderArchive();
  taskArea.classList.add('view-exit');
  taskArea.addEventListener('animationend', () => {
    taskArea.classList.add('hidden');
    taskArea.classList.remove('view-exit');
    archivePanel.classList.remove('hidden');
    requestAnimationFrame(() => {
      archivePanel.scrollTop = archivePanel.scrollHeight;
    });
  }, { once: true });
}

function closeArchive(): void {
  archivePanel.classList.add('view-exit');
  archivePanel.addEventListener('animationend', () => {
    archivePanel.classList.add('hidden');
    archivePanel.classList.remove('view-exit');
    taskArea.classList.remove('hidden');
  }, { once: true });
}

archiveBtn.addEventListener('click', () => {
  const isOpen = !archivePanel.classList.contains('hidden');
  if (isOpen) closeArchive();
  else openArchive();
});

archiveClose.addEventListener('click', closeArchive);

// ── Service Worker ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/Tudu/sw.js');
}

// ── Init ──
const key = getApiKey();
if (key) {
  initClient(key);
  showApp();
} else {
  showSetup();
}
