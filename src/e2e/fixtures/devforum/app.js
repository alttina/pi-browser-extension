const POSTS_KEY = 'devforum:posts';
const USER_KEY = 'devforum:user';

const DEFAULT_POSTS = [
  {
    id: 'post-1',
    title: 'How do I center a div?',
    category: 'css',
    author: 'newbie_dev',
    body: 'I have been struggling with CSS centering. What is the best way to horizontally and vertically center a div?',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    comments: [
      { author: 'css_wizard', body: 'Use flexbox: display: flex; justify-content: center; align-items: center; on the parent.' },
      { author: 'grid_fan', body: 'Or CSS Grid: place-items: center; on the parent.' }
    ]
  },
  {
    id: 'post-2',
    title: 'Understanding async/await',
    category: 'javascript',
    author: 'js_learner',
    body: 'Can someone explain when to use async/await versus plain promises?',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    comments: [
      { author: 'senior_dev', body: 'Async/await makes sequential asynchronous code much easier to read.' }
    ]
  },
  {
    id: 'post-3',
    title: 'Welcome to DevForum',
    category: 'general',
    author: 'admin',
    body: 'This is a place to ask questions, share knowledge, and discuss all things development.',
    createdAt: new Date().toISOString(),
    comments: []
  }
];

function loadPosts() {
  try {
    const raw = localStorage.getItem(POSTS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePosts(posts) {
  localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
}

function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  updateAuthUI();
}

function clearUser() {
  localStorage.removeItem(USER_KEY);
  updateAuthUI();
}

function updateAuthUI() {
  const user = getUser();
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  if (loginBtn) loginBtn.classList.toggle('hidden', !!user);
  if (logoutBtn) logoutBtn.classList.toggle('hidden', !user);
}

function requireAuth() {
  if (!getUser()) {
    window.location.hash = '#/login';
    return false;
  }
  return true;
}

function getPosts() {
  let posts = loadPosts();
  if (!posts) {
    posts = DEFAULT_POSTS.map((p) => ({ ...p }));
    savePosts(posts);
  }
  return posts;
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleString(); }
  catch { return iso; }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

function makePostCard(post) {
  const excerpt = post.body.length > 140 ? post.body.slice(0, 140) + '...' : post.body;
  return `
    <article class="post-card" data-post-id="${post.id}">
      <span class="category-badge">${escapeHtml(post.category)}</span>
      <h3><a id="post-link-${post.id}" href="#/post/${post.id}">${escapeHtml(post.title)}</a></h3>
      <div class="meta">By ${escapeHtml(post.author)} · ${formatDate(post.createdAt)} · ${post.comments.length} comment${post.comments.length === 1 ? '' : 's'}</div>
      <p class="excerpt">${escapeHtml(excerpt)}</p>
    </article>
  `;
}

function renderPostList(containerId, filterFn) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const posts = getPosts()
    .filter(filterFn)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (posts.length === 0) {
    container.innerHTML = '<p class="empty">No posts found.</p>';
    return;
  }

  container.innerHTML = posts.map(makePostCard).join('');
}

function renderHome() {
  const searchInput = document.getElementById('search-input');
  const categoryFilter = document.getElementById('category-filter');
  const search = (searchInput?.value || '').toLowerCase();
  const category = categoryFilter?.value || '';

  renderPostList('post-list', (post) => {
    const matchesSearch = post.title.toLowerCase().includes(search) || post.body.toLowerCase().includes(search);
    const matchesCategory = !category || post.category === category;
    return matchesSearch && matchesCategory;
  });
}

function renderCategory(category) {
  const title = document.getElementById('category-title');
  if (title) title.textContent = `${category} posts`;
  renderPostList('category-post-list', (post) => post.category === category);
}

function renderPost(postId) {
  const container = document.getElementById('post-detail');
  const commentsList = document.getElementById('comments-list');
  const posts = getPosts();
  const post = posts.find((p) => p.id === postId);

  if (!container || !post) {
    if (container) container.innerHTML = '<p>Post not found.</p><a href="#/" class="btn btn-secondary">Back to latest</a>';
    if (commentsList) commentsList.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <article class="post-detail" data-post-id="${post.id}">
      <span class="category-badge">${escapeHtml(post.category)}</span>
      <h1>${escapeHtml(post.title)}</h1>
      <div class="meta">By ${escapeHtml(post.author)} · ${formatDate(post.createdAt)}</div>
      <div class="body">${escapeHtml(post.body)}</div>
      <a href="#/" class="btn btn-secondary">Back to latest</a>
    </article>
  `;

  if (commentsList) {
    commentsList.innerHTML = post.comments.length
      ? post.comments.map((c) => `
          <div class="comment">
            <div class="author">${escapeHtml(c.author)}</div>
            <div class="body">${escapeHtml(c.body)}</div>
          </div>
        `).join('')
      : '<p class="empty">No comments yet.</p>';
  }

  const form = document.getElementById('comment-form');
  if (form) {
    form.onsubmit = (e) => handleCommentSubmit(e, postId);
  }
}

function handleCommentSubmit(e, postId) {
  e.preventDefault();
  const authorInput = document.getElementById('comment-author');
  const bodyInput = document.getElementById('comment-body');
  const author = authorInput?.value.trim();
  const body = bodyInput?.value.trim();
  if (!author || !body) return;

  const posts = getPosts();
  const post = posts.find((p) => p.id === postId);
  if (!post) return;

  post.comments.push({ author, body });
  savePosts(posts);
  renderPost(postId);
  showToast('Comment added');
}

function handleNewPostSubmit(e) {
  e.preventDefault();
  const user = getUser();
  if (!user) {
    window.location.hash = '#/login';
    return;
  }

  const titleInput = document.getElementById('post-title');
  const categoryInput = document.getElementById('post-category');
  const bodyInput = document.getElementById('post-body');

  const title = titleInput?.value.trim();
  const category = categoryInput?.value;
  const body = bodyInput?.value.trim();

  if (!title || !category || !body) return;

  const posts = getPosts();
  const id = 'post-' + Date.now();
  posts.push({
    id,
    title,
    category,
    author: user.username,
    body,
    createdAt: new Date().toISOString(),
    comments: []
  });
  savePosts(posts);

  window.location.hash = `#/post/${id}`;
  showToast('Post created');
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const username = usernameInput?.value.trim();
  const password = passwordInput?.value.trim();

  if (!username || !password) {
    showToast('Please enter username and password');
    return;
  }

  setUser({ username });
  showToast(`Welcome, ${username}!`);
  window.location.hash = '#/new';
}

function route() {
  const hash = window.location.hash || '#/';  
  const parts = hash.replace('#/', '').split('/').filter(Boolean);

  if (parts.length === 0) {
    switchView('home-view');
    renderHome();
  } else if (parts[0] === 'category' && parts[1]) {
    switchView('category-view');
    renderCategory(parts[1]);
  } else if (parts[0] === 'post' && parts[1]) {
    switchView('post-view');
    renderPost(parts[1]);
  } else if (parts[0] === 'new') {
    if (!requireAuth()) return;
    switchView('new-post-view');
    const user = getUser();
    const authorInput = document.getElementById('post-author');
    if (user && authorInput) authorInput.value = user.username;
  } else if (parts[0] === 'login') {
    switchView('login-view');
  } else {
    switchView('home-view');
    renderHome();
  }
}

function init() {
  window.addEventListener('hashchange', route);

  document.getElementById('search-input')?.addEventListener('input', renderHome);
  document.getElementById('category-filter')?.addEventListener('change', renderHome);
  document.getElementById('new-post-form')?.addEventListener('submit', handleNewPostSubmit);
  document.getElementById('login-form')?.addEventListener('submit', handleLoginSubmit);
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    clearUser();
    window.location.hash = '#/';
  });

  updateAuthUI();
  route();
}

window.__resetFixtureState = function () {
  localStorage.removeItem(POSTS_KEY);
  clearUser();

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const categoryFilter = document.getElementById('category-filter');
  if (categoryFilter) categoryFilter.value = '';

  route();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
