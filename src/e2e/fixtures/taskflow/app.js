const STORAGE_KEY = 'taskflow:tasks';

const DEFAULT_TASKS = [
  {
    id: 't1',
    title: 'Design landing page',
    description: 'Create mockups and finalize the visual design for the marketing landing page.',
    status: 'todo',
    priority: 'high',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 't2',
    title: 'Set up CI pipeline',
    description: 'Configure GitHub Actions to run tests on every pull request.',
    status: 'in-progress',
    priority: 'medium',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 't3',
    title: 'Write documentation',
    description: 'Document the API endpoints and authentication flow.',
    status: 'done',
    priority: 'low',
    createdAt: new Date().toISOString(),
  },
];

function generateId() {
  return 't-' + Math.random().toString(36).slice(2, 10);
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function getTasks() {
  let tasks = loadTasks();
  if (!tasks) {
    tasks = DEFAULT_TASKS.map((t) => ({ ...t }));
    saveTasks(tasks);
  }
  return tasks;
}

function getTask(id) {
  return getTasks().find((t) => t.id === id);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.classList.add('hidden'), 200);
  }, 2000);
}

function switchView(viewId) {
  document.querySelectorAll('.view').forEach((el) => el.classList.add('hidden'));
  const view = document.getElementById(viewId);
  if (view) view.classList.remove('hidden');
  window.scrollTo({ top: 0 });
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function priorityClass(priority) {
  return `priority priority-${priority}`;
}

function renderTaskCard(task) {
  return `
    <article class="task-card" id="task-card-${task.id}" data-task-id="${task.id}" tabindex="0">
      <h3>${escapeHtml(task.title)}</h3>
      <p>${escapeHtml(task.description || '').slice(0, 80)}${(task.description || '').length > 80 ? '…' : ''}</p>
      <div class="task-meta">
        <span class="${priorityClass(task.priority)}">${task.priority}</span>
        <span class="status-badge">${task.status.replace('-', ' ')}</span>
      </div>
      <div class="task-actions">
        <a id="edit-task-${task.id}" href="#/task/${task.id}" class="btn btn-small">Edit</a>
      </div>
    </article>
  `;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderBoard() {
  const todoColumn = document.getElementById('column-todo');
  const inProgressColumn = document.getElementById('column-in-progress');
  const doneColumn = document.getElementById('column-done');
  if (!todoColumn || !inProgressColumn || !doneColumn) return;

  const tasks = getTasks();
  const byStatus = {
    todo: tasks.filter((t) => t.status === 'todo'),
    'in-progress': tasks.filter((t) => t.status === 'in-progress'),
    done: tasks.filter((t) => t.status === 'done'),
  };

  todoColumn.innerHTML = byStatus.todo.length
    ? byStatus.todo.map(renderTaskCard).join('')
    : '<div class="empty-state">No tasks</div>';
  inProgressColumn.innerHTML = byStatus['in-progress'].length
    ? byStatus['in-progress'].map(renderTaskCard).join('')
    : '<div class="empty-state">No tasks</div>';
  doneColumn.innerHTML = byStatus.done.length
    ? byStatus.done.map(renderTaskCard).join('')
    : '<div class="empty-state">No tasks</div>';

  document.querySelectorAll('.task-card').forEach((card) => {
    card.addEventListener('click', () => {
      const taskId = card.getAttribute('data-task-id');
      window.location.hash = `#/task/${taskId}`;
    });
  });
}

function renderTaskForm(taskId) {
  const formTitle = document.getElementById('task-form-title');
  const form = document.getElementById('task-form');
  const titleInput = document.getElementById('task-title');
  const descriptionInput = document.getElementById('task-description');
  const statusInput = document.getElementById('task-status');
  const priorityInput = document.getElementById('task-priority');
  const saveBtn = document.getElementById('save-task-btn');

  if (!form || !titleInput) return;

  form.reset();
  form.dataset.taskId = '';

  if (taskId) {
    const task = getTask(taskId);
    if (!task) {
      window.location.hash = '#/board';
      return;
    }
    if (formTitle) formTitle.textContent = 'Edit Task';
    if (saveBtn) saveBtn.textContent = 'Update task';
    titleInput.value = task.title;
    descriptionInput.value = task.description || '';
    document.querySelectorAll('input[name="task-status"]').forEach((radio) => {
      radio.checked = radio.value === task.status;
    });
    priorityInput.value = task.priority;
    form.dataset.taskId = task.id;
  } else {
    if (formTitle) formTitle.textContent = 'Create Task';
    if (saveBtn) saveBtn.textContent = 'Save task';
    statusInput.value = 'todo';
    priorityInput.value = 'medium';
  }
}

function handleTaskFormSubmit(e) {
  e.preventDefault();
  const form = document.getElementById('task-form');
  const titleInput = document.getElementById('task-title');
  const descriptionInput = document.getElementById('task-description');
  const statusInput = document.querySelector('input[name="task-status"]:checked');
  const priorityInput = document.getElementById('task-priority');
  const status = statusInput ? statusInput.value : 'todo';

  const tasks = getTasks();
  const taskId = form?.dataset.taskId;

  if (taskId) {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      task.title = titleInput.value.trim();
      task.description = descriptionInput.value.trim();
      task.status = status;
      task.priority = priorityInput.value;
      saveTasks(tasks);
      showToast('Task updated');
    }
  } else {
    tasks.push({
      id: generateId(),
      title: titleInput.value.trim(),
      description: descriptionInput.value.trim(),
      status,
      priority: priorityInput.value,
      createdAt: new Date().toISOString(),
    });
    saveTasks(tasks);
    showToast('Task created');
  }

  window.location.hash = '#/board';
}

function renderTaskDetail(taskId) {
  const container = document.getElementById('task-detail');
  const task = getTask(taskId);
  if (!container) return;

  if (!task) {
    container.innerHTML = `
      <h1>Task not found</h1>
      <a href="#/board" class="btn">Back to board</a>
    `;
    return;
  }

  container.innerHTML = `
    <article class="task-detail">
      <h1>${escapeHtml(task.title)}</h1>
      <div class="meta">
        <span class="${priorityClass(task.priority)}">${task.priority}</span>
        <span class="status-badge">${task.status.replace('-', ' ')}</span>
        <span>Created ${formatDate(task.createdAt)}</span>
      </div>
      <div class="description">${escapeHtml(task.description || '').replace(/\n/g, '<br>')}</div>
      <div class="actions">
        <a href="#/board" class="btn btn-secondary">Back to board</a>
        <button id="delete-task-btn" class="btn btn-danger" data-task-id="${task.id}">Delete</button>
        <a href="#/task/${task.id}/edit" id="edit-task-btn" class="btn btn-primary">Edit task</a>
      </div>
    </article>
  `;

  const deleteBtn = document.getElementById('delete-task-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      const id = deleteBtn.getAttribute('data-task-id');
      const tasks = getTasks().filter((t) => t.id !== id);
      saveTasks(tasks);
      showToast('Task deleted');
      window.location.hash = '#/board';
    });
  }
}

function route() {
  const hash = window.location.hash || '#/';
  const parts = hash.replace('#/', '').split('/').filter(Boolean);

  if (parts.length === 0) {
    switchView('home-view');
  } else if (parts[0] === 'board') {
    switchView('board-view');
    renderBoard();
  } else if (parts[0] === 'task' && parts[1] === 'new') {
    switchView('task-form-view');
    renderTaskForm(null);
  } else if (parts[0] === 'task' && parts[2] === 'edit' && parts[1]) {
    switchView('task-form-view');
    renderTaskForm(parts[1]);
  } else if (parts[0] === 'task' && parts[1]) {
    switchView('task-detail-view');
    renderTaskDetail(parts[1]);
  } else {
    switchView('home-view');
  }
}

function init() {
  window.addEventListener('hashchange', route);
  document.getElementById('task-form')?.addEventListener('submit', handleTaskFormSubmit);
  route();
}

window.__resetFixtureState = function () {
  localStorage.removeItem(STORAGE_KEY);
  getTasks();
  route();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
