const STORAGE_KEYS = {
  users: 'tumesa_users',
  currentUser: 'tumesa_current_user',
  allies: 'tumesa_allies',
  products: 'tumesa_products',
  promotions: 'tumesa_promotions',
  cart: 'tumesa_cart',
  orders: 'tumesa_orders',
  deliveries: 'tumesa_deliveries',
  exchangeRate: 'tumesa_exchange_rate'
};

const GEOAPIFY_API_KEY = '9321dbbcdd214531ab0bdc8d636a0352';
const GEOAPIFY_ROUTING_URL = 'https://api.geoapify.com/v1/routing';
const DELIVERY_RATE_PER_KM = 0.45;
const DEFAULT_MERCHANT_COORDS = { lat: 10.4806, lon: -66.9036 };
const DEFAULT_DELIVERY_COORDS = { lat: 10.1629, lon: -68.0074 };
const SUPABASE_URL = 'https://qepnwylzeyyxkbttkxvr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlcG53eWx6ZXl5eGtidHRreHZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNTcwNDMsImV4cCI6MjA5ODczMzA0M30.HJYijN8ibiPVgMyLREkoFlUly6Y_TcMQa8T42tcOyOY';
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

const ROLE_LABELS = {
  client: 'Cliente',
  support: 'Soporte',
  ally: 'Aliado comercial',
  rider: 'Motorizado',
  admin: 'Admin'
};

const state = {
  user: null,
  supabase: null,
  supabaseEnabled: false,
  page: document.body.dataset.page || 'home',
  deliveryMap: null,
  deliveryMapMarker: null
};

let deferredInstallPrompt = null;

function initSecurityMeasures() {
  if (window.__securityBound) return;
  window.__securityBound = true;
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('selectstart', (event) => event.preventDefault());
  document.addEventListener('dragstart', (event) => event.preventDefault());
  document.addEventListener('keydown', (event) => {
    const key = event.key?.toLowerCase();
    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    if (event.key === 'F12' || (ctrlOrMeta && key === 'shift+i') || (ctrlOrMeta && key === 'u') || (ctrlOrMeta && key === 'shift+c') || (ctrlOrMeta && key === 'shift+j') || (ctrlOrMeta && key === 's')) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  });
}

function ensureInstallButton() {
  if (document.getElementById('installAppButton')) return;
  const button = document.createElement('button');
  button.id = 'installAppButton';
  button.type = 'button';
  button.textContent = '⬇ Instalar app';
  button.style.position = 'fixed';
  button.style.right = '16px';
  button.style.bottom = '148px';
  button.style.zIndex = '999';
  button.style.border = 'none';
  button.style.borderRadius = '999px';
  button.style.background = '#0f8a5f';
  button.style.color = '#fff';
  button.style.padding = '10px 14px';
  button.style.fontWeight = '700';
  button.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.18)';
  button.addEventListener('click', handleInstallClick);
  document.body.appendChild(button);
}

function handleInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    return;
  }
  showMessage('Instala la app desde el menú del navegador si no aparece la opción automática.', 'success');
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((registration) => {
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing;
      installingWorker?.addEventListener('statechange', () => {
        if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showMessage('TuMesa se actualizó. Recarga la app para aplicar los cambios.', 'success');
        }
      });
    });
    setInterval(() => registration.update(), 60 * 60 * 1000);
  }).catch(console.error);

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

function requestDeliveryLocation() {
  if (!navigator.geolocation) {
    return Promise.resolve(readStore('tumesa_delivery_location', DEFAULT_DELIVERY_COORDS));
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition((position) => {
      const location = { lat: position.coords.latitude, lon: position.coords.longitude };
      writeStore('tumesa_delivery_location', location);
      resolve(location);
    }, () => {
      resolve(readStore('tumesa_delivery_location', DEFAULT_DELIVERY_COORDS));
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

function updateDeliveryLocation(location) {
  writeStore('tumesa_delivery_location', location);
  const latInput = document.getElementById('deliveryLat');
  const lonInput = document.getElementById('deliveryLon');
  if (latInput) latInput.value = location.lat.toFixed(6);
  if (lonInput) lonInput.value = location.lon.toFixed(6);
  if (state.deliveryMapMarker) state.deliveryMapMarker.setLatLng([location.lat, location.lon]);
  if (state.deliveryMap) state.deliveryMap.panTo([location.lat, location.lon]);
}

function initDeliveryMap(initialLocation = null) {
  const mapNode = document.getElementById('deliveryMap');
  if (!mapNode || !window.L) return;
  if (state.deliveryMap) {
    state.deliveryMap.remove();
    state.deliveryMap = null;
    state.deliveryMapMarker = null;
  }
  const location = initialLocation || readStore('tumesa_delivery_location', DEFAULT_DELIVERY_COORDS);
  const map = window.L.map('deliveryMap', { zoomControl: true }).setView([location.lat, location.lon], 13);
  const tileUrl = `https://maps.geoapify.com/v1/tile/positron/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_API_KEY}`;
  window.L.tileLayer(tileUrl, { attribution: '&copy; Geoapify & OpenStreetMap contributors' }).addTo(map);
  const marker = window.L.marker([location.lat, location.lon], { draggable: true }).addTo(map);
  marker.on('dragend', () => {
    const latlng = marker.getLatLng();
    updateDeliveryLocation({ lat: latlng.lat, lon: latlng.lng });
  });
  map.on('click', (event) => {
    marker.setLatLng(event.latlng);
    updateDeliveryLocation({ lat: event.latlng.lat, lon: event.latlng.lng });
  });
  state.deliveryMap = map;
  state.deliveryMapMarker = marker;
  updateDeliveryLocation(location);
}

function readStore(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function writeStore(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function createId(prefix = 'id') { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }
function getExchangeRate() { return Number(readStore(STORAGE_KEYS.exchangeRate, 36)) || 36; }
function setExchangeRate(value) { writeStore(STORAGE_KEYS.exchangeRate, Number(value) || 36); }
function getUsdPrice(product) { return Number(product.priceUsd ?? product.price ?? 0); }
function getBsPrice(product) { return getUsdPrice(product) * getExchangeRate(); }
function formatUsd(value) { return `USD $${Number(value || 0).toFixed(2)}`; }
function formatBs(value) { return `Bs ${Number(value || 0).toFixed(2)}`; }
function renderPrice(product) { const usd = getUsdPrice(product); const bs = usd * getExchangeRate(); return `${formatUsd(usd)} · ${formatBs(bs)}`; }
function getRoleLabel(role) { return ROLE_LABELS[role] || 'Usuario'; }
function getProfileSummary(user) { return { phone: user?.phone || '', address: user?.address || '' }; }

function buildRouteUrl(start, end) {
  return `${GEOAPIFY_ROUTING_URL}?waypoints=${start.lat}%2C${start.lon}%7C${end.lat}%2C${end.lon}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`;
}

async function calculateRoute(start, end) {
  const response = await fetch(buildRouteUrl(start, end), { method: 'GET' });
  if (!response.ok) throw new Error('No se pudo calcular la ruta');
  const data = await response.json();
  const distanceMeters = data?.features?.[0]?.properties?.distance || 0;
  const distanceKm = distanceMeters / 1000;
  const shippingUsd = Number((distanceKm * DELIVERY_RATE_PER_KM).toFixed(2));
  return { distanceKm, shippingUsd, raw: data };
}

function getDeliveryRouteSummary(delivery) {
  if (!delivery?.distanceKm) return 'Ruta pendiente';
  return `Ruta ${Number(delivery.distanceKm).toFixed(1)} km · Envío ${formatUsd(delivery.shippingUsd || 0)}`;
}

function seedDemoData() {
  if (!readStore(STORAGE_KEYS.exchangeRate, null)) setExchangeRate(36);
  if (!readStore(STORAGE_KEYS.users, null)) {
    writeStore(STORAGE_KEYS.users, [
      { id: 'user-admin', name: 'Admin', email: 'admin@tumesa.com', password: 'Admin2026!', role: 'admin', phone: '+58 412 0000000', address: 'Caracas, Venezuela' },
      { id: 'user-support', name: 'Soporte', email: 'soporte@tumesa.com', password: 'Soporte2026!', role: 'support', phone: '+58 414 0000000', address: 'Caracas, Venezuela' },
      { id: 'user-ally', name: 'Aliado Pizza', email: 'aliado@tumesa.com', password: 'Tm2026!', role: 'ally' },
      { id: 'user-rider', name: 'Luis', email: 'rider@tumesa.com', password: 'rider123', role: 'rider' },
      { id: 'user-client', name: 'Cliente Demo', email: 'cliente@tumesa.com', password: 'cliente123', role: 'client' }
    ]);
  }
  if (!readStore(STORAGE_KEYS.allies, null)) {
    writeStore(STORAGE_KEYS.allies, [{ id: 'ally-1', name: 'Pizza Express', email: 'pizza@tumesa.com', password: 'ally123', role: 'ally', status: 'active', commission: 10, products: ['p1', 'p2'], promotions: ['promo-1'], photo: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=300&q=80' }]);
  }
  if (!readStore(STORAGE_KEYS.products, null)) {
    writeStore(STORAGE_KEYS.products, [
      { id: 'p1', allyId: 'ally-1', name: 'Pizza Pepperoni', priceUsd: 12.5, category: 'Pizzas', image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=300&q=80' },
      { id: 'p2', allyId: 'ally-1', name: 'Burrito Especial', priceUsd: 10, category: 'Mexicana', image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=300&q=80' }
    ]);
  }
  if (!readStore(STORAGE_KEYS.promotions, null)) {
    writeStore(STORAGE_KEYS.promotions, [{ id: 'promo-1', allyId: 'ally-1', title: '2x1 en pizzas', active: true }]);
  }
  if (!readStore(STORAGE_KEYS.cart, null)) writeStore(STORAGE_KEYS.cart, []);
  if (!readStore(STORAGE_KEYS.orders, null)) writeStore(STORAGE_KEYS.orders, []);
  if (!readStore(STORAGE_KEYS.deliveries, null)) {
    writeStore(STORAGE_KEYS.deliveries, [
      { id: 'delivery-1', orderId: 'order-1', customer: 'Ana', address: 'Av. Central, Caracas', status: 'en camino', merchantLat: DEFAULT_MERCHANT_COORDS.lat, merchantLon: DEFAULT_MERCHANT_COORDS.lon, deliveryLat: DEFAULT_DELIVERY_COORDS.lat, deliveryLon: DEFAULT_DELIVERY_COORDS.lon },
      { id: 'delivery-2', orderId: 'order-2', customer: 'Carlos', address: 'San Martín, Valencia', status: 'pendiente', merchantLat: DEFAULT_MERCHANT_COORDS.lat, merchantLon: DEFAULT_MERCHANT_COORDS.lon, deliveryLat: DEFAULT_DELIVERY_COORDS.lat, deliveryLon: DEFAULT_DELIVERY_COORDS.lon }
    ]);
  }
}

function getCurrentUser() {
  const stored = readStore(STORAGE_KEYS.currentUser, null);
  return stored || null;
}
function setCurrentUser(user) { writeStore(STORAGE_KEYS.currentUser, user); state.user = user; }
function clearCurrentUser() { localStorage.removeItem(STORAGE_KEYS.currentUser); state.user = null; }

function isSupabaseConfigured() {
  return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && !window.SUPABASE_URL.includes('your-project') && !window.SUPABASE_ANON_KEY.includes('your-anon-key'));
}

async function initSupabaseIfPossible() {
  if (!window.supabase || !isSupabaseConfigured()) return false;
  state.supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  const { data: { session } } = await state.supabase.auth.getSession();
  if (session?.user) {
    const role = session.user.user_metadata?.role || 'client';
    setCurrentUser({ id: session.user.id, name: session.user.user_metadata?.name || session.user.email, email: session.user.email, role });
  }
  state.supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      const role = session.user.user_metadata?.role || 'client';
      setCurrentUser({ id: session.user.id, name: session.user.user_metadata?.name || session.user.email, email: session.user.email, role });
    } else {
      clearCurrentUser();
    }
  });
  state.supabaseEnabled = true;
  return true;
}

function localRegister(email, password, role, name, extra = {}) {
  const users = readStore(STORAGE_KEYS.users, []);
  const exists = users.some(u => u.email.toLowerCase() === email.toLowerCase());
  if (exists) throw new Error('Este correo ya está registrado');
  const user = { id: createId('user'), name, email, password, role, phone: extra.phone || '', address: extra.address || '', createdAt: new Date().toISOString(), source: 'local', supabaseReady: true };
  users.push(user);
  writeStore(STORAGE_KEYS.users, users);
  setCurrentUser(user);
  return user;
}

function localLogin(email, password) {
  const users = readStore(STORAGE_KEYS.users, []);
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
  if (!user) throw new Error('Credenciales inválidas');
  setCurrentUser(user);
  return user;
}

async function loginUser(email, password, role = 'client', name = '', extra = {}) {
  if (state.supabaseEnabled) {
    const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const meta = data.user?.user_metadata || {};
    const user = { ...data.user, role: meta.role || role || 'client', name: meta.name || name || data.user.email, phone: meta.phone || extra.phone || '', address: meta.address || extra.address || '' };
    setCurrentUser(user);
    return user;
  }
  return localLogin(email, password);
}

async function registerUser(email, password, role = 'client', name = '', extra = {}) {
  if (state.supabaseEnabled) {
    const { data, error } = await state.supabase.auth.signUp({ email, password, options: { data: { role, name, phone: extra.phone || '', address: extra.address || '' } } });
    if (error) throw error;
    const user = { ...data.user, role, name, phone: extra.phone || '', address: extra.address || '' };
    setCurrentUser(user);
    return user;
  }
  return localRegister(email, password, role, name, extra);
}

function logout() {
  if (state.supabaseEnabled && state.supabase) state.supabase.auth.signOut();
  clearCurrentUser();
  window.location.href = 'index.html.html';
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
}

function notifyNewOrder(message = 'Tienes un nuevo pedido en TuMesa') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(message);
}

function getCartItems() { return readStore(STORAGE_KEYS.cart, []); }
function saveCart(items) { writeStore(STORAGE_KEYS.cart, items); }
function addToCart(product) {
  const cart = getCartItems();
  const existing = cart.find(item => item.id === product.id);
  if (existing) existing.quantity += 1; else cart.push({ ...product, quantity: 1 });
  saveCart(cart);
  renderCartBadge();
}
function updateCartQuantity(productId, delta) {
  const cart = getCartItems();
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) cart.splice(cart.indexOf(item), 1);
  saveCart(cart);
  renderCartBadge();
}
function getCartCount() { return getCartItems().reduce((sum, i) => sum + i.quantity, 0); }
function renderCartBadge() {
  const badge = document.getElementById('cartCount');
  const fabBadge = document.getElementById('fabCartCount');
  if (badge) badge.textContent = getCartCount();
  if (fabBadge) fabBadge.textContent = getCartCount();
}
function getTotals() {
  const cart = getCartItems();
  const subtotalUsd = cart.reduce((sum, item) => sum + getUsdPrice(item) * item.quantity, 0);
  const subtotalBs = subtotalUsd * getExchangeRate();
  const shippingUsd = getCurrentDeliveryPricing().shippingUsd;
  const shippingBs = shippingUsd * getExchangeRate();
  const totalUsd = subtotalUsd + shippingUsd;
  const totalBs = totalUsd * getExchangeRate();
  return { subtotalUsd, subtotalBs, shippingUsd, shippingBs, totalUsd, totalBs };
}

function getCurrentDeliveryPricing() {
  const userLocation = readStore('tumesa_delivery_location', null);
  const merchantLocation = readStore('tumesa_merchant_location', null);
  if (!userLocation || !merchantLocation) {
    return { shippingUsd: 2, distanceKm: 0, merchantLocation, userLocation };
  }
  const distanceKm = Math.max(0.5, Math.abs(userLocation.lat - merchantLocation.lat) * 111 + Math.abs(userLocation.lon - merchantLocation.lon) * 111);
  const shippingUsd = Number((distanceKm * DELIVERY_RATE_PER_KM).toFixed(2));
  return { shippingUsd, distanceKm, merchantLocation, userLocation };
}

async function createOrder() {
  const cart = getCartItems();
  if (!cart.length) return;
  const deliveryInfo = getCurrentDeliveryPricing();
  const shippingUsd = deliveryInfo.shippingUsd;
  const deliveryDistance = deliveryInfo.distanceKm;
  const totals = getTotals();
  const order = { id: createId('order'), items: cart, totalUsd: totals.subtotalUsd + shippingUsd, totalBs: (totals.subtotalUsd + shippingUsd) * getExchangeRate(), shippingUsd, shippingBs: shippingUsd * getExchangeRate(), deliveryDistance, createdAt: new Date().toISOString(), status: 'pendiente', userId: state.user?.id || null, userEmail: state.user?.email || null, userName: state.user?.name || 'Cliente', address: state.user?.address || 'Dirección registrada', deliveryLocation: deliveryInfo.userLocation, merchantLocation: deliveryInfo.merchantLocation, source: 'local', supabaseReady: true };
  const orders = readStore(STORAGE_KEYS.orders, []);
  orders.unshift(order);
  writeStore(STORAGE_KEYS.orders, orders);
  saveCart([]);
  writeStore(STORAGE_KEYS.deliveries, [
    ...readStore(STORAGE_KEYS.deliveries, []),
    { id: createId('delivery'), orderId: order.id, customer: state.user?.name || 'Cliente', address: order.address, status: 'pendiente', merchantLat: DEFAULT_MERCHANT_COORDS.lat, merchantLon: DEFAULT_MERCHANT_COORDS.lon, deliveryLat: DEFAULT_DELIVERY_COORDS.lat, deliveryLon: DEFAULT_DELIVERY_COORDS.lon, distanceKm: deliveryDistance, shippingUsd }
  ]);
  notifyNewOrder('Nuevo pedido recibido en TuMesa');
  alert('Pedido confirmado. El aliado y el motorizado lo verán en sus paneles.');
  window.location.href = 'index.html.html';
}

function addAlly(name, email, password, role, commission, photo, gps) {
  const allies = readStore(STORAGE_KEYS.allies, []);
  const ally = { id: createId('ally'), name, email, password, role, commission: Number(commission || 0), status: 'active', products: [], promotions: [], photo, gps, source: 'local' };
  allies.push(ally);
  writeStore(STORAGE_KEYS.allies, allies);
  return ally;
}
function addProduct(name, priceUsd, category, image) {
  const products = readStore(STORAGE_KEYS.products, []);
  const product = { id: createId('product'), allyId: state.user?.id || 'demo-ally', name, priceUsd: Number(priceUsd), category, image, source: 'local' };
  products.push(product);
  writeStore(STORAGE_KEYS.products, products);
  return product;
}
function addPromotion(title) {
  const promotions = readStore(STORAGE_KEYS.promotions, []);
  const promo = { id: createId('promo'), allyId: state.user?.id || 'demo-ally', title, active: true, source: 'local' };
  promotions.push(promo);
  writeStore(STORAGE_KEYS.promotions, promotions);
  return promo;
}
function markDeliveryDelivered(id) {
  const deliveries = readStore(STORAGE_KEYS.deliveries, []);
  const delivery = deliveries.find(item => item.id === id);
  if (delivery) delivery.status = 'entregado';
  writeStore(STORAGE_KEYS.deliveries, deliveries);
}

function readImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderRestaurants() {
  const container = document.getElementById('restaurants');
  if (!container) return;
  const products = readStore(STORAGE_KEYS.products, []);
  container.innerHTML = products.map((product) => `
    <div class="card restaurant">
      <div class="thumb">${product.image ? `<img src="${product.image}" alt="${product.name}" />` : '🍽️'}</div>
      <div style="flex:1">
        <h3>${product.name}</h3>
        <p class="muted">${product.category}</p>
        <div class="small" style="margin:8px 0">${renderPrice(product)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn btn-primary" href="restaurant.html?id=${product.id}">Ver menú</a>
          <button class="btn btn-secondary add-cart" data-product='${encodeURIComponent(JSON.stringify(product))}'>Agregar</button>
        </div>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('.add-cart').forEach(btn => btn.addEventListener('click', () => {
    addToCart(JSON.parse(decodeURIComponent(btn.dataset.product)));
    showMessage('Producto agregado al carrito', 'success');
  }));
}

function showMessage(message, type = 'success') {
  const target = document.getElementById('message');
  if (!target) return;
  target.className = type === 'success' ? 'success' : 'error';
  target.textContent = message;
}

function renderRolePanel() {
  const rolePanel = document.getElementById('rolePanel');
  if (!rolePanel) return;
  const user = state.user;
  if (!user) { rolePanel.innerHTML = '<div class=\'empty\'>Inicia sesión para ver tus herramientas.</div>'; return; }
  const roleText = getRoleLabel(user.role);
  rolePanel.innerHTML = `
    <div class="card">
      <h3>Bienvenido, ${user.name || user.email}</h3>
      <p class="muted">Rol: ${roleText}</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${(user.role === 'client' || user.role === 'support') ? '<a class="btn btn-primary" href="index.html.html">Ver catálogo</a><a class="btn btn-secondary" href="cart.html">Ver carrito</a>' : ''}
        ${user.role === 'ally' ? '<a class="btn btn-primary" href="aliado-panel.html">Gestionar productos</a>' : ''}
        ${user.role === 'admin' ? '<a class="btn btn-primary" href="admin.html">Panel admin</a>' : ''}
        ${user.role === 'rider' ? '<a class="btn btn-primary" href="motorizado.html">Ver entregas</a>' : ''}
        ${user.role === 'support' ? '<a class="btn btn-secondary" href="index.html.html">Atención y soporte</a>' : ''}
      </div>
    </div>
  `;
}

function bindAuthForms() {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const registerToggle = document.getElementById('showRegister');
  const loginToggle = document.getElementById('showLogin');
  const authSection = document.getElementById('authSection');
  const dashboardSection = document.getElementById('dashboardSection');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      try {
        await loginUser(email, password);
        if (authSection) authSection.classList.add('hidden');
        if (dashboardSection) dashboardSection.classList.remove('hidden');
        renderApp();
      } catch (error) {
        showMessage(error.message || 'No se pudo iniciar sesión', 'error');
      }
    });
  }
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('registerName').value;
      const email = document.getElementById('registerEmail').value;
      const password = document.getElementById('registerPassword').value;
      const role = document.getElementById('registerRole').value;
      const phone = document.getElementById('registerPhone')?.value || '';
      const address = document.getElementById('registerAddress')?.value || '';
      try {
        await registerUser(email, password, role, name, { phone, address });
        if (authSection) authSection.classList.add('hidden');
        if (dashboardSection) dashboardSection.classList.remove('hidden');
        renderApp();
      } catch (error) {
        showMessage(error.message || 'No se pudo crear la cuenta', 'error');
      }
    });
  }
  if (registerToggle) registerToggle.addEventListener('click', () => { document.getElementById('loginCard').classList.add('hidden'); document.getElementById('registerCard').classList.remove('hidden'); });
  if (loginToggle) loginToggle.addEventListener('click', () => { document.getElementById('registerCard').classList.add('hidden'); document.getElementById('loginCard').classList.remove('hidden'); });
}

function renderApp() {
  const user = state.user || getCurrentUser();
  if (user) setCurrentUser(user);
  renderCartBadge();
  renderRolePanel();
  renderRestaurants();
  renderCartPage();
  renderCheckoutPage();
  renderAdminPage();
  renderAllyPage();
  renderMotorizadoPage();
  renderRestaurantPage();
  renderProfilePanel();
  updateAuthView();
  bindBottomNav();
}

function updateAuthView() {
  const authSection = document.getElementById('authSection');
  const dashboardSection = document.getElementById('dashboardSection');
  const user = state.user || getCurrentUser();
  if (authSection) {
    if (!user) {
      authSection.classList.remove('hidden');
      if (dashboardSection) dashboardSection.classList.add('hidden');
    } else {
      authSection.classList.add('hidden');
      if (dashboardSection) dashboardSection.classList.remove('hidden');
      const welcome = document.getElementById('welcomeName');
      if (welcome) welcome.textContent = user.name || user.email;
    }
  }
}

function toggleProfilePanel() {
  const panel = document.getElementById('profilePanel');
  if (!panel) return;
  panel.classList.toggle('hidden');
}

function renderProfilePanel() {
  const panel = document.getElementById('profilePanel');
  const summary = document.getElementById('profileSummary');
  const ordersBox = document.getElementById('profileOrders');
  if (!panel || !summary || !ordersBox) return;
  const user = state.user || getCurrentUser();
  if (!user) {
    panel.classList.add('hidden');
    summary.innerHTML = '<div class="empty">Inicia sesión para ver tu perfil.</div>';
    ordersBox.innerHTML = '';
    return;
  }
  const profile = getProfileSummary(user);
  const orders = readStore(STORAGE_KEYS.orders, []).filter(order => order.userEmail === user.email || order.userId === user.id);
  summary.innerHTML = `
    <div class="list-item"><span>Nombre</span><strong>${user.name || user.email}</strong></div>
    <div class="list-item"><span>Correo</span><strong>${user.email}</strong></div>
    <div class="list-item"><span>Rol</span><strong>${getRoleLabel(user.role)}</strong></div>
    <div class="list-item"><span>Teléfono</span><strong>${profile.phone || 'No registrado'}</strong></div>
    <div class="list-item"><span>Dirección</span><strong>${profile.address || 'No registrada'}</strong></div>
  `;
  if (!orders.length) {
    ordersBox.innerHTML = '<div class="empty">Aún no tienes pedidos.</div>';
    return;
  }
  ordersBox.innerHTML = orders.map(order => `
    <div class="list-item">
      <div><strong>${order.id}</strong><br><span class="muted">${new Date(order.createdAt).toLocaleString()}</span></div>
      <div class="pill">${formatUsd(order.totalUsd || 0)}</div>
    </div>
  `).join('');
}

function bindBottomNav() {
  const navButtons = document.querySelectorAll('.bottom-nav button[data-action]');
  if (navButtons.length && navButtons[0].dataset.bound === 'true') return;
  navButtons.forEach(btn => {
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'profile') {
        toggleProfilePanel();
      } else if (action === 'orders') {
        window.location.href = 'cart.html';
      } else if (action === 'home') {
        document.querySelector('.hero')?.scrollIntoView({ behavior: 'smooth' });
      } else if (action === 'chat') {
        showMessage('El canal de soporte estará disponible pronto', 'success');
      }
    });
  });
}

function renderCartPage() {
  const container = document.getElementById('cartItems');
  if (!container) return;
  const items = getCartItems();
  if (!items.length) {
    container.innerHTML = '<div class="empty">Tu carrito está vacío.</div>';
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="list-item">
      <div>
        <strong>${item.name}</strong><br><span class="muted">${renderPrice(item)} · x${item.quantity}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-secondary" data-action="minus" data-id="${item.id}">-</button>
        <button class="btn btn-primary" data-action="plus" data-id="${item.id}">+</button>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => {
    updateCartQuantity(btn.dataset.id, btn.dataset.action === 'plus' ? 1 : -1);
    renderCartPage();
    renderCheckoutPage();
  }));
}

function renderCheckoutPage() {
  const container = document.getElementById('checkoutSummary');
  if (!container) return;
  const totals = getTotals();
  const currentLocation = readStore('tumesa_delivery_location', DEFAULT_DELIVERY_COORDS);
  container.innerHTML = `
    <div class="list-item"><span>Subtotal</span><strong>${formatUsd(totals.subtotalUsd)} · ${formatBs(totals.subtotalBs)}</strong></div>
    <div class="list-item"><span>Envío</span><strong>${formatUsd(totals.shippingUsd)} · ${formatBs(totals.shippingBs)}</strong></div>
    <div class="list-item"><span>Total</span><strong>${formatUsd(totals.totalUsd)} · ${formatBs(totals.totalBs)}</strong></div>
    <div style="margin-top:10px">
      <label class="small muted">Arrastra el pin para confirmar tu ubicación de entrega</label>
      <div id="deliveryMap" style="height:220px;border-radius:14px;margin:8px 0;overflow:hidden;background:#e5e7eb"></div>
      <div style="display:grid;gap:8px;margin-top:8px">
        <input id="deliveryLat" class="input" type="number" step="0.000001" placeholder="Latitud" value="${currentLocation.lat}" />
        <input id="deliveryLon" class="input" type="number" step="0.000001" placeholder="Longitud" value="${currentLocation.lon}" />
      </div>
      <div class="small muted" style="margin:6px 0">La app solicitará tu ubicación para ubicar el punto de entrega más rápido.</div>
      <button class="btn btn-primary" id="confirmOrderBtn">Confirmar pedido</button>
    </div>
  `;
  const btn = document.getElementById('confirmOrderBtn');
  const latInput = document.getElementById('deliveryLat');
  const lonInput = document.getElementById('deliveryLon');

  const syncManualLocation = () => {
    const lat = Number(latInput?.value);
    const lon = Number(lonInput?.value);
    if (!lat || !lon) return;
    updateDeliveryLocation({ lat, lon });
  };
  latInput?.addEventListener('change', syncManualLocation);
  lonInput?.addEventListener('change', syncManualLocation);

  if (btn) btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const lat = Number(document.getElementById('deliveryLat').value);
    const lon = Number(document.getElementById('deliveryLon').value);
    if (!lat || !lon) {
      showMessage('Ingresa la ubicación GPS de entrega para calcular el precio', 'error');
      return;
    }
    updateDeliveryLocation({ lat, lon });
    const merchant = readStore('tumesa_merchant_location', null) || DEFAULT_MERCHANT_COORDS;
    writeStore('tumesa_merchant_location', merchant);
    await createOrder();
  });

  requestDeliveryLocation().then((location) => {
    if (document.getElementById('deliveryMap')) initDeliveryMap(location);
  });
}

function renderAdminPage() {
  const container = document.getElementById('adminList');
  const rateBox = document.getElementById('adminRate');
  if (rateBox) rateBox.textContent = `Tasa BCV actual: ${getExchangeRate()} Bs/USD`;
  if (!container) return;
  const allies = readStore(STORAGE_KEYS.allies, []);
  container.innerHTML = allies.map(a => `
    <div class="list-item">
      <div style="display:flex;gap:10px;align-items:center">
        <div class="mini-photo">${a.photo ? `<img src="${a.photo}" alt="${a.name}" />` : '🏪'}</div>
        <div><strong>${a.name}</strong><br><span class="muted">${a.email} · ${a.role}</span></div>
      </div>
      <span class="pill">${a.status}</span>
    </div>
  `).join('');
  const form = document.getElementById('allyForm');
  if (form && form.dataset.bound !== 'true') {
    form.dataset.bound = 'true';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('allyName').value;
      const email = document.getElementById('allyEmail').value;
      const password = document.getElementById('allyPassword').value;
      const role = document.getElementById('allyRole').value;
      const commission = document.getElementById('allyCommission').value;
      const photoUrl = document.getElementById('allyPhotoUrl').value;
      const photoFile = document.getElementById('allyPhotoFile').files[0];
      let photo = photoUrl || '';
      if (photoFile) photo = await readImageFromFile(photoFile);
      const gps = {
        lat: document.getElementById('allyGpsLat').value,
        lon: document.getElementById('allyGpsLon').value
      };
      addAlly(name, email, password, role, commission, photo, gps);
      form.reset();
      renderAdminPage();
      showMessage('Aliado o motorizado creado correctamente', 'success');
    });
  }
  const rateForm = document.getElementById('rateForm');
  if (rateForm && rateForm.dataset.bound !== 'true') {
    rateForm.dataset.bound = 'true';
    rateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = document.getElementById('rateInput').value;
      setExchangeRate(value);
      renderAdminPage();
      showMessage('Tasa referencial actualizada', 'success');
    });
  }
}

function renderAllyPage() {
  const list = document.getElementById('allyProducts');
  if (!list) return;
  const products = readStore(STORAGE_KEYS.products, []);
  list.innerHTML = products.map(p => `
    <div class="list-item">
      <div style="display:flex;gap:10px;align-items:center">
        <div class="mini-photo">${p.image ? `<img src="${p.image}" alt="${p.name}" />` : '🍽️'}</div>
        <div><strong>${p.name}</strong><br><span class="muted">${p.category}</span></div>
      </div>
      <span class="pill">${formatUsd(getUsdPrice(p))} · ${formatBs(getBsPrice(p))}</span>
    </div>
  `).join('');
  const form = document.getElementById('productForm');
  if (form && form.dataset.bound !== 'true') {
    form.dataset.bound = 'true';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('productName').value;
      const priceUsd = document.getElementById('productPriceUsd').value;
      const category = document.getElementById('productCategory').value;
      const imageUrl = document.getElementById('productImageUrl').value;
      const imageFile = document.getElementById('productImageFile').files[0];
      let image = imageUrl || '';
      if (imageFile) image = await readImageFromFile(imageFile);
      addProduct(name, priceUsd, category, image);
      form.reset();
      renderAllyPage();
      showMessage('Producto agregado correctamente', 'success');
    });
  }
  const promoForm = document.getElementById('promoForm');
  if (promoForm && promoForm.dataset.bound !== 'true') {
    promoForm.dataset.bound = 'true';
    promoForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addPromotion(document.getElementById('promoTitle').value);
      promoForm.reset();
      renderAllyPage();
      showMessage('Promoción creada correctamente', 'success');
    });
  }
}

function updateDeliveryStatus(id, status) {
  const deliveries = readStore(STORAGE_KEYS.deliveries, []);
  const delivery = deliveries.find(item => item.id === id);
  if (!delivery) return;
  delivery.status = status;
  writeStore(STORAGE_KEYS.deliveries, deliveries);
}

async function renderMotorizadoPage() {
  const container = document.getElementById('deliveryList');
  if (!container) return;
  const deliveries = readStore(STORAGE_KEYS.deliveries, []);
  container.innerHTML = deliveries.map(item => `
    <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:8px">
      <div style="width:100%"><strong>${item.customer}</strong> · ${item.address} · <strong>${item.status}</strong></div>
      <div class="small muted" data-route-info="${item.id}">Calculando ruta...</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${item.status === 'pendiente' ? `<button class="btn btn-primary accept-delivery" data-id="${item.id}">Aceptar</button><button class="btn btn-secondary reject-delivery" data-id="${item.id}">Rechazar</button>` : ''}
        ${item.status === 'aceptado' ? `<button class="btn btn-primary start-delivery" data-id="${item.id}">Retirado del comercio</button>` : ''}
        ${item.status === 'en camino' ? `<button class="btn btn-primary mark-delivered" data-id="${item.id}">Entregado</button>` : ''}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.accept-delivery').forEach(btn => btn.addEventListener('click', () => {
    updateDeliveryStatus(btn.dataset.id, 'aceptado');
    renderMotorizadoPage();
  }));
  container.querySelectorAll('.reject-delivery').forEach(btn => btn.addEventListener('click', () => {
    updateDeliveryStatus(btn.dataset.id, 'rechazado');
    renderMotorizadoPage();
  }));
  container.querySelectorAll('.start-delivery').forEach(btn => btn.addEventListener('click', () => {
    updateDeliveryStatus(btn.dataset.id, 'en camino');
    renderMotorizadoPage();
  }));
  container.querySelectorAll('.mark-delivered').forEach(btn => btn.addEventListener('click', () => {
    updateDeliveryStatus(btn.dataset.id, 'entregado');
    renderMotorizadoPage();
  }));

  for (const item of deliveries) {
    const routeNode = container.querySelector(`[data-route-info="${item.id}"]`);
    if (!routeNode) continue;
    try {
      const route = await calculateRoute(
        { lat: item.merchantLat || DEFAULT_MERCHANT_COORDS.lat, lon: item.merchantLon || DEFAULT_MERCHANT_COORDS.lon },
        { lat: item.deliveryLat || DEFAULT_DELIVERY_COORDS.lat, lon: item.deliveryLon || DEFAULT_DELIVERY_COORDS.lon }
      );
      item.distanceKm = Number(route.distanceKm.toFixed(1));
      item.shippingUsd = Number(route.shippingUsd.toFixed(2));
      writeStore(STORAGE_KEYS.deliveries, deliveries);
      routeNode.textContent = getDeliveryRouteSummary(item);
    } catch (error) {
      routeNode.textContent = 'Ruta no disponible';
    }
  }
}

function renderRestaurantPage() {
  const container = document.getElementById('restaurantDetail');
  if (!container) return;
  const params = new URLSearchParams(window.location.search);
  const productId = params.get('id');
  const product = readStore(STORAGE_KEYS.products, []).find(item => item.id === productId);
  if (!product) { container.innerHTML = '<div class="empty">Producto no encontrado.</div>'; return; }
  container.innerHTML = `
    <div class="card">
      <div class="product-photo-large">${product.image ? `<img src="${product.image}" alt="${product.name}" />` : '🍽️'}</div>
      <h2>${product.name}</h2>
      <p class="muted">${product.category}</p>
      <div style="font-size:1.3rem;font-weight:700;margin:10px 0">${renderPrice(product)}</div>
      <p>Plato disponible para delivery con preparación rápida y ingredientes frescos.</p>
      <button class="btn btn-primary add-to-cart" data-product='${encodeURIComponent(JSON.stringify(product))}'>Agregar al carrito</button>
    </div>
  `;
  container.querySelector('.add-to-cart')?.addEventListener('click', () => { addToCart(product); showMessage('Producto agregado al carrito', 'success'); });
}

function initPage() {
  seedDemoData();
  initSecurityMeasures();
  ensureInstallButton();
  registerServiceWorker();
  const storedUser = getCurrentUser();
  if (storedUser) state.user = storedUser;
  requestNotificationPermission();
  initSupabaseIfPossible().then(() => {
    renderApp();
  });
  bindAuthForms();
}

document.addEventListener('DOMContentLoaded', () => {
  initPage();
});
