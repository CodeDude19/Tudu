export interface Task {
  id: string;
  text: string;
  done: boolean;
  deleted: boolean;
}

const TASKS_KEY = 'tudu_tasks';
const API_KEY_KEY = 'tudu_api_key';
const DEEPGRAM_KEY = 'tudu_deepgram_key';
const HISTORY_KEY = 'tudu_history';

export function getTasks(): Task[] {
  const raw = localStorage.getItem(TASKS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_KEY);
}

export function saveApiKey(key: string): void {
  localStorage.setItem(API_KEY_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_KEY);
}

export function getDeepgramKey(): string | null {
  return localStorage.getItem(DEEPGRAM_KEY);
}

export function saveDeepgramKey(key: string): void {
  localStorage.setItem(DEEPGRAM_KEY, key);
}

export function getHistory(): string[] {
  const raw = localStorage.getItem(HISTORY_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function addToHistory(input: string): void {
  const history = getHistory();
  history.unshift(input);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}
