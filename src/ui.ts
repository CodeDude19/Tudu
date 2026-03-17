import { type Task, getTasks, saveTasks } from './storage';

const taskList = document.getElementById('task-list') as HTMLUListElement;
const archiveList = document.getElementById('archive-list') as HTMLUListElement;
const archiveEmpty = document.getElementById('archive-empty')!;
const emptyState = document.getElementById('empty-state') as HTMLParagraphElement;
const taskArea = document.getElementById('task-area')!;

const SWIPE_THRESHOLD = 80;

// Callback for voice redo — set by main.ts
let onVoiceRedo: ((taskId: string) => void) | null = null;

export function setVoiceRedoHandler(handler: (taskId: string) => void): void {
  onVoiceRedo = handler;
}

export function renderTasks(animateIds?: Set<string>): void {
  const tasks = getTasks();
  const pending = tasks.filter((t) => !t.done && !t.deleted);

  taskList.innerHTML = '';

  if (pending.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  // Render pending tasks in reverse (oldest first, newest at bottom)
  const reversed = [...pending].reverse();
  reversed.forEach((task) => {
    const li = createTaskElement(task, animateIds?.has(task.id));
    taskList.appendChild(li);
  });

  // Always scroll task area to bottom (newest tasks)
  requestAnimationFrame(() => {
    taskArea.scrollTop = taskArea.scrollHeight;
  });
}

export function renderArchive(): void {
  const tasks = getTasks();
  const archived = tasks.filter((t) => t.done || t.deleted);

  archiveList.innerHTML = '';

  if (archived.length === 0) {
    archiveEmpty.classList.remove('hidden');
    return;
  }

  archiveEmpty.classList.add('hidden');

  // Newest archived at bottom
  const reversed = [...archived].reverse();
  reversed.forEach((task) => {
    const li = createTaskElement(task, false);
    archiveList.appendChild(li);
  });

  // Scroll to bottom
  const archivePanel = document.getElementById('archive-panel')!;
  requestAnimationFrame(() => {
    archivePanel.scrollTop = archivePanel.scrollHeight;
  });
}

function createTaskElement(task: Task, animate?: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `task-item glass${task.done ? ' done' : ''}${task.deleted ? ' deleted' : ''}`;
  li.dataset.id = task.id;

  if (animate) {
    li.classList.add('task-enter');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => li.classList.add('task-enter-active'));
    });
  }

  const inner = document.createElement('div');
  inner.className = 'task-inner';

  const isActive = !task.done && !task.deleted;

  const tag = task.deleted
    ? '<span class="task-tag tag-deleted">deleted</span>'
    : task.done
      ? '<span class="task-tag tag-done">done</span>'
      : '';

  const voiceRedoBtn = isActive
    ? `<button class="task-voice-redo" aria-label="Redo with voice">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        </svg>
      </button>`
    : '';

  const restoreBtn = task.deleted
    ? `<button class="task-restore" aria-label="Restore task">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
      </button>`
    : '';

  inner.innerHTML = `
    <button class="task-check" aria-label="Toggle done">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        ${task.done ? '<polyline points="20 6 9 17 4 12"/>' : '<circle cx="12" cy="12" r="10"/>'}
      </svg>
    </button>
    <span class="task-text">${escapeHtml(task.text)}</span>
    ${tag}
    ${voiceRedoBtn}
    ${restoreBtn}
    <button class="task-delete" aria-label="Delete task">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;

  if (isActive) {
    const swipeLeft = document.createElement('div');
    swipeLeft.className = 'swipe-action swipe-action-delete';
    swipeLeft.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

    const swipeRight = document.createElement('div');
    swipeRight.className = 'swipe-action swipe-action-done';
    swipeRight.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    li.appendChild(swipeLeft);
    li.appendChild(swipeRight);
    li.appendChild(inner);

    // Swipe gestures
    let startX = 0;
    let currentX = 0;
    let swiping = false;

    inner.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      currentX = 0;
      swiping = true;
      inner.style.transition = 'none';
    }, { passive: true });

    inner.addEventListener('touchmove', (e) => {
      if (!swiping) return;
      currentX = e.touches[0].clientX - startX;
      inner.style.transform = `translateX(${currentX}px)`;
      const progress = Math.min(Math.abs(currentX) / SWIPE_THRESHOLD, 1);
      if (currentX < 0) swipeLeft.style.opacity = String(progress);
      else swipeRight.style.opacity = String(progress);
    }, { passive: true });

    inner.addEventListener('touchend', () => {
      if (!swiping) return;
      swiping = false;
      inner.style.transition = '';
      if (currentX < -SWIPE_THRESHOLD) {
        li.classList.add('task-exit-left');
        li.addEventListener('animationend', () => deleteTask(task.id), { once: true });
      } else if (currentX > SWIPE_THRESHOLD) {
        li.classList.add('task-exit-done');
        li.addEventListener('animationend', () => toggleTask(task.id), { once: true });
      } else {
        inner.style.transform = '';
        swipeLeft.style.opacity = '0';
        swipeRight.style.opacity = '0';
      }
    });

    // Desktop click handlers
    inner.querySelector('.task-check')!.addEventListener('click', () => {
      li.classList.add('task-exit-done');
      li.addEventListener('animationend', () => toggleTask(task.id), { once: true });
    });
    inner.querySelector('.task-delete')!.addEventListener('click', () => {
      li.classList.add('task-exit-left');
      li.addEventListener('animationend', () => deleteTask(task.id), { once: true });
    });

    // Voice redo
    const redoBtn = inner.querySelector('.task-voice-redo');
    if (redoBtn) {
      redoBtn.addEventListener('click', () => {
        if (onVoiceRedo) onVoiceRedo(task.id);
      });
    }
  } else {
    // Completed/deleted: left swipe to permanently remove
    const swipeLeft = document.createElement('div');
    swipeLeft.className = 'swipe-action swipe-action-delete';
    swipeLeft.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

    li.appendChild(swipeLeft);
    li.appendChild(inner);

    let startX = 0;
    let currentX = 0;
    let swiping = false;

    inner.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      currentX = 0;
      swiping = true;
      inner.style.transition = 'none';
    }, { passive: true });

    inner.addEventListener('touchmove', (e) => {
      if (!swiping) return;
      const dx = e.touches[0].clientX - startX;
      // Only allow left swipe
      currentX = Math.min(0, dx);
      inner.style.transform = `translateX(${currentX}px)`;
      swipeLeft.style.opacity = String(Math.min(Math.abs(currentX) / SWIPE_THRESHOLD, 1));
    }, { passive: true });

    inner.addEventListener('touchend', () => {
      if (!swiping) return;
      swiping = false;
      inner.style.transition = '';
      if (currentX < -SWIPE_THRESHOLD) {
        li.classList.add('task-exit-left');
        li.addEventListener('animationend', () => permanentlyDeleteTask(task.id), { once: true });
      } else {
        inner.style.transform = '';
        swipeLeft.style.opacity = '0';
      }
    });

    const restoreBtnEl = inner.querySelector('.task-restore');
    if (restoreBtnEl) {
      restoreBtnEl.addEventListener('click', () => {
        li.classList.add('task-exit-done');
        li.addEventListener('animationend', () => restoreTask(task.id), { once: true });
      });
    }
  }

  return li;
}

export function addTask(text: string): void {
  const tasks = getTasks();
  const id = crypto.randomUUID();
  tasks.unshift({ id, text, done: false, deleted: false });
  saveTasks(tasks);
  renderTasks(new Set([id]));
}

export function replaceTask(id: string, newText: string): void {
  const tasks = getTasks();
  const task = tasks.find((t: Task) => t.id === id);
  if (task) {
    task.text = newText;
    saveTasks(tasks);
    renderTasks(new Set([id]));
  }
}

function toggleTask(id: string): void {
  const tasks = getTasks();
  const task = tasks.find((t: Task) => t.id === id);
  if (task) {
    task.done = !task.done;
    saveTasks(tasks);
    renderTasks();
  }
}

function restoreTask(id: string): void {
  const tasks = getTasks();
  const task = tasks.find((t: Task) => t.id === id);
  if (task) {
    task.deleted = false;
    task.done = false;
    saveTasks(tasks);
    renderTasks(new Set([id]));
  }
}

function permanentlyDeleteTask(id: string): void {
  const tasks = getTasks().filter((t: Task) => t.id !== id);
  saveTasks(tasks);
  renderTasks();
}

function deleteTask(id: string): void {
  const tasks = getTasks();
  const task = tasks.find((t: Task) => t.id === id);
  if (task) {
    task.deleted = true;
    task.done = false;
    saveTasks(tasks);
    renderTasks();
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function showError(msg: string): void {
  const el = document.getElementById('error-msg')!;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

export function setLoading(loading: boolean): void {
  const btn = document.getElementById('submit-btn')!;
  const input = document.getElementById('task-input') as HTMLInputElement;
  btn.querySelector('.btn-text')!.classList.toggle('hidden', loading);
  btn.querySelector('.btn-loading')!.classList.toggle('hidden', !loading);
  (btn as HTMLButtonElement).disabled = loading;
  input.disabled = loading;
}
