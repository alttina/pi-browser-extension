const PRODUCTS = [
  { id: 'p1', name: 'Wireless Headphones', category: 'audio', price: 129.00, stock: 10 },
  { id: 'p2', name: 'Mechanical Keyboard', category: 'office', price: 89.00, stock: 5 },
  { id: 'p3', name: 'USB-C Hub', category: 'accessories', price: 49.00, stock: 20 },
  { id: 'p4', name: 'Webcam 4K', category: 'audio', price: 159.00, stock: 8 },
  { id: 'p5', name: 'Monitor Arm', category: 'office', price: 79.00, stock: 0 },
];

const CART_KEY = 'onestopshop:cart';
const ORDERS_KEY = 'onestopshop:orders';

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}

function loadOrders() {
  try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); }
  catch { return []; }
}

function saveOrders(orders) {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
}

function updateCartCount() {
  const cart = loadCart();
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(count);
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

function renderProducts() {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  const category = document.getElementById('category-filter')?.value || '';
  const sort = document.getElementById('sort-order')?.value || 'default';

  let filtered = PRODUCTS.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search);
    const matchesCategory = !category || p.category === category;
    return matchesSearch && matchesCategory;
  });

  if (sort === 'price-asc') filtered.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') filtered.sort((a, b) => b.price - a.price);

  grid.innerHTML = filtered.map((p) => `
    <div class="product-card" data-product-id="${p.id}">
      <h3>${p.name}</h3>
      <div class="price">$${p.price.toFixed(2)}</div>
      <div class="stock">${p.stock > 0 ? 'In stock' : 'Out of stock'}</div>
      <div class="product-actions">
        <a href="#/product/${p.id}" class="btn">View details</a>
        <button id="add-to-cart-${p.id}" class="btn btn-primary add-to-cart-btn" data-product-id="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
          ${p.stock > 0 ? 'Add to cart' : 'Out of stock'}
        </button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.add-to-cart-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const productId = btn.getAttribute('data-product-id');
      const product = PRODUCTS.find((p) => p.id === productId);
      if (!product || product.stock === 0) return;
      const cart = loadCart();
      const existing = cart.find((item) => item.productId === product.id);
      if (existing) existing.quantity += 1;
      else cart.push({ productId: product.id, quantity: 1 });
      saveCart(cart);
      showToast(`${product.name} added to cart`);
    });
  });
}

function renderProductDetail(productId) {
  const container = document.getElementById('product-detail');
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!container || !product) return;

  container.innerHTML = `
    <h1>${product.name}</h1>
    <div class="price">$${product.price.toFixed(2)}</div>
    <div class="stock">${product.stock > 0 ? 'In stock' : 'Out of stock'}</div>
    <p>Category: ${product.category}</p>
    <button id="add-to-cart-btn" class="btn btn-primary" ${product.stock === 0 ? 'disabled' : ''}>
      ${product.stock > 0 ? 'Add to cart' : 'Out of stock'}
    </button>
    <a href="#/products" class="btn btn-secondary">Back to products</a>
  `;

  const btn = document.getElementById('add-to-cart-btn');
  if (btn && product.stock > 0) {
    btn.addEventListener('click', () => {
      const cart = loadCart();
      const existing = cart.find((item) => item.productId === product.id);
      if (existing) existing.quantity += 1;
      else cart.push({ productId: product.id, quantity: 1 });
      saveCart(cart);
      showToast(`${product.name} added to cart`);
    });
  }
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const empty = document.getElementById('cart-empty');
  const checkoutBtn = document.getElementById('checkout-btn');
  if (!container || !empty) return;

  const cart = loadCart();
  if (cart.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  empty.classList.add('hidden');
  if (checkoutBtn) checkoutBtn.disabled = false;

  container.innerHTML = cart.map((item) => {
    const product = PRODUCTS.find((p) => p.id === item.productId);
    if (!product) return '';
    return `
      <div class="cart-item" data-product-id="${product.id}">
        <div>
          <strong>${product.name}</strong>
          <div>Qty: ${item.quantity}</div>
        </div>
        <div>$${(product.price * item.quantity).toFixed(2)}</div>
      </div>
    `;
  }).join('');
}

function renderOrder(orderId) {
  const container = document.getElementById('order-detail');
  const orders = loadOrders();
  const order = orders.find((o) => o.orderId === orderId);
  if (!container || !order) return;

  container.innerHTML = `
    <p>Thank you, <strong>${order.shipping.name}</strong>!</p>
    <p>Order number: <strong>${order.orderId}</strong></p>
    <p>Total: $${order.total.toFixed(2)}</p>
    <p>Status: ${order.status}</p>
    <a href="#/products" class="btn">Continue shopping</a>
  `;
}

function handleCheckoutSubmit(e) {
  e.preventDefault();
  const cart = loadCart();
  if (cart.length === 0) return;

  const name = document.getElementById('full-name').value;
  const address = document.getElementById('address').value;
  const card = document.getElementById('card').value;

  const total = cart.reduce((sum, item) => {
    const product = PRODUCTS.find((p) => p.id === item.productId);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);

  const orderId = 'ORD-' + Math.random().toString(36).slice(2, 10).toUpperCase();
  const orders = loadOrders();
  orders.push({ orderId, items: cart, shipping: { name, address, card }, total, status: 'confirmed' });
  saveOrders(orders);
  saveCart([]);
  window.location.hash = `#/order/${orderId}`;
}

function route() {
  const hash = window.location.hash || '#/';
  const parts = hash.replace('#/', '').split('/').filter(Boolean);

  if (parts.length === 0) {
    switchView('home-view');
  } else if (parts[0] === 'products') {
    switchView('products-view');
    renderProducts();
  } else if (parts[0] === 'product' && parts[1]) {
    switchView('product-view');
    renderProductDetail(parts[1]);
  } else if (parts[0] === 'cart') {
    switchView('cart-view');
    renderCart();
  } else if (parts[0] === 'checkout') {
    switchView('checkout-view');
  } else if (parts[0] === 'order' && parts[1]) {
    switchView('order-view');
    renderOrder(parts[1]);
  } else {
    switchView('home-view');
  }
}

function init() {
  updateCartCount();
  window.addEventListener('hashchange', route);

  document.getElementById('search-input')?.addEventListener('input', renderProducts);
  document.getElementById('category-filter')?.addEventListener('change', renderProducts);
  document.getElementById('sort-order')?.addEventListener('change', renderProducts);
  document.getElementById('checkout-form')?.addEventListener('submit', handleCheckoutSubmit);
  document.getElementById('checkout-btn')?.addEventListener('click', () => {
    window.location.hash = '#/checkout';
  });

  route();
}

window.__resetFixtureState = function () {
  localStorage.removeItem(CART_KEY);
  localStorage.removeItem(ORDERS_KEY);
  updateCartCount();

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const categoryFilter = document.getElementById('category-filter');
  if (categoryFilter) categoryFilter.value = '';
  const sortOrder = document.getElementById('sort-order');
  if (sortOrder) sortOrder.value = 'default';

  if (window.location.hash.startsWith('#/cart') || window.location.hash.startsWith('#/checkout') || window.location.hash.startsWith('#/order')) {
    window.location.hash = '#/';
  } else {
    route();
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
