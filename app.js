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
function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  if (state.supabaseEnabled && state.supabase) {
    void persistSupabaseState(key, value);
  }
}
function createId(prefix = 'id') {
  if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
function getExchangeRate() { return Number(readStore(STORAGE_KEYS.exchangeRate, 36)) || 36; }
function setExchangeRate(value) { writeStore(STORAGE_KEYS.exchangeRate, Number(value) || 36); }
function getUsdPrice(product) { return Number(product.priceUsd ?? product.price ?? 0); }
function getBsPrice(product) { return getUsdPrice(product) * getExchangeRate(); }
function formatUsd(value) { return `USD $${Number(value || 0).toFixed(2)}`; }
function formatBs(value) { return `Bs ${Number(value || 0).toFixed(2)}`; }
function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short', hour12: true });
}
function normalizeTimeValue(value) {
  if (!value) return '09:00';
  const input = String(value).trim().toUpperCase();
  const match = input.match(/^(\d{1,2})(?::(\d{2}))?\s?(AM|PM)?$/i);
  if (!match) return '09:00';
  let hours = Number(match[1]);
  const minutes = Number(match[2] || '00');
  const suffix = match[3];
  if (suffix === 'PM' && hours < 12) hours += 12;
  if (suffix === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
function formatTime12(value) {
  const normalized = normalizeTimeValue(value);
  const [hours, minutes] = normalized.split(':').map(Number);
  const safeHours = Number.isNaN(hours) ? 9 : hours;
  const safeMinutes = Number.isNaN(minutes) ? 0 : minutes;
  const suffix = safeHours >= 12 ? 'PM' : 'AM';
  const normalizedHours = safeHours % 12 || 12;
  return `${normalizedHours}:${String(safeMinutes).padStart(2, '0')} ${suffix}`;
}
function parseTimeToMinutes(value) {
  const [hours, minutes] = String(value || '09:00').split(':').map(Number);
  return (Number.isNaN(hours) ? 9 : hours) * 60 + (Number.isNaN(minutes) ? 0 : minutes);
}
function getAllyAvailability(ally) {
  const workingStart = ally?.workingStart || '09:00';
  const workingEnd = ally?.workingEnd || '22:00';
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTimeToMinutes(workingStart);
  const endMinutes = parseTimeToMinutes(workingEnd);
  const isInWindow = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  const isOpen = ally?.isOpen !== false && isInWindow;
  return {
    isOpen,
    label: isOpen ? 'Abierto' : 'Cerrado',
    schedule: `${formatTime12(workingStart)} - ${formatTime12(workingEnd)}`
  };
}
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
  if (!readStore(STORAGE_KEYS.users, null)) writeStore(STORAGE_KEYS.users, []);
  if (!readStore(STORAGE_KEYS.allies, null)) writeStore(STORAGE_KEYS.allies, []);
  if (!readStore(STORAGE_KEYS.products, null)) writeStore(STORAGE_KEYS.products, []);
  if (!readStore(STORAGE_KEYS.promotions, null)) writeStore(STORAGE_KEYS.promotions, []);
  if (!readStore(STORAGE_KEYS.cart, null)) writeStore(STORAGE_KEYS.cart, []);
  if (!readStore(STORAGE_KEYS.orders, null)) writeStore(STORAGE_KEYS.orders, []);
  if (!readStore(STORAGE_KEYS.deliveries, null)) writeStore(STORAGE_KEYS.deliveries, []);
}

function getCurrentUser() {
  const stored = readStore(STORAGE_KEYS.currentUser, null);
  return stored || null;
}
async function syncUserProfile(user) {
  if (!state.supabaseEnabled || !state.supabase || !user?.email) return;
  const profile = {
    id: user.id,
    auth_id: user.id,
    name: user.name || '',
    email: user.email,
    phone: user.phone || '',
    address: user.address || '',
    role: user.role || 'client',
    created_at: new Date().toISOString()
  };
  const { error } = await state.supabase.from('profiles').upsert(profile, { onConflict: 'id' });
  if (error) console.error('No se pudo sincronizar el perfil', error);
}
function setCurrentUser(user) { writeStore(STORAGE_KEYS.currentUser, user); state.user = user; void syncUserProfile(user); }
function clearCurrentUser() { localStorage.removeItem(STORAGE_KEYS.currentUser); state.user = null; }

function isSupabaseConfigured() {
  return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && !window.SUPABASE_URL.includes('your-project') && !window.SUPABASE_ANON_KEY.includes('your-anon-key'));
}

function normalizeSupabaseRow(key, row) {
  const id = row.id || createId(key);
  switch (key) {
    case STORAGE_KEYS.allies:
      return {
        id,
        name: row.name || '',
        email: row.email || '',
        password: row.password || '',
        role: row.role || 'ally',
        commission: Number(row.commission || 0),
        status: row.status || 'active',
        photo: row.photo || null,
        gps_lat: row.gps?.lat ?? null,
        gps_lon: row.gps?.lon ?? null,
        working_start: row.workingStart || '09:00',
        working_end: row.workingEnd || '22:00',
        is_open: row.isOpen !== false,
        source: row.source || 'local',
        created_at: row.createdAt || new Date().toISOString()
      };
    case STORAGE_KEYS.products:
      return {
        id,
        ally_id: row.allyId || null,
        name: row.name || '',
        price_usd: Number(row.priceUsd ?? row.price ?? 0),
        category: row.category || '',
        image: row.image || null,
        source: row.source || 'local',
        created_at: row.createdAt || new Date().toISOString()
      };
    case STORAGE_KEYS.promotions:
      return {
        id,
        ally_id: row.allyId || null,
        title: row.title || '',
        active: Boolean(row.active),
        source: row.source || 'local',
        created_at: row.createdAt || new Date().toISOString()
      };
    case STORAGE_KEYS.orders:
      return {
        id,
        user_id: row.userId || null,
        user_email: row.userEmail || null,
        user_name: row.userName || null,
        total_usd: Number(row.totalUsd || 0),
        total_bs: Number(row.totalBs || 0),
        shipping_usd: Number(row.shippingUsd || 0),
        shipping_bs: Number(row.shippingBs || 0),
        delivery_distance: Number(row.deliveryDistance || row.deliveryDistance || 0),
        status: row.status || 'pendiente',
        address: row.address || '',
        delivery_location: row.deliveryLocation || null,
        merchant_location: row.merchantLocation || null,
        source: row.source || 'local',
        created_at: row.createdAt || new Date().toISOString()
      };
    case STORAGE_KEYS.deliveries:
      return {
        id,
        order_id: row.orderId || null,
        customer: row.customer || '',
        address: row.address || '',
        status: row.status || 'pendiente',
        merchant_lat: row.merchantLat ?? null,
        merchant_lon: row.merchantLon ?? null,
        delivery_lat: row.deliveryLat ?? null,
        delivery_lon: row.deliveryLon ?? null,
        distance_km: Number(row.distanceKm || 0),
        shipping_usd: Number(row.shippingUsd || 0),
        created_at: row.createdAt || new Date().toISOString()
      };
    case STORAGE_KEYS.exchangeRate:
      return { id: row.id || 'rate-1', value: Number(row.value ?? row ?? 36), created_at: new Date().toISOString() };
    default:
      return { ...row, id };
  }
}

function hydrateSupabaseRow(key, row) {
  switch (key) {
    case STORAGE_KEYS.allies:
      return {
        ...row,
        id: row.id,
        gps: row.gps_lat != null || row.gps_lon != null ? { lat: row.gps_lat, lon: row.gps_lon } : null,
        workingStart: row.working_start || '09:00',
        workingEnd: row.working_end || '22:00',
        isOpen: row.is_open !== false,
        source: row.source || 'local'
      };
    case STORAGE_KEYS.products:
      return { ...row, id: row.id, allyId: row.ally_id, priceUsd: Number(row.price_usd || 0), source: row.source || 'local' };
    case STORAGE_KEYS.promotions:
      return { ...row, id: row.id, allyId: row.ally_id, source: row.source || 'local' };
    case STORAGE_KEYS.orders:
      return { ...row, id: row.id, userId: row.user_id, userEmail: row.user_email, userName: row.user_name, totalUsd: Number(row.total_usd || 0), totalBs: Number(row.total_bs || 0), shippingUsd: Number(row.shipping_usd || 0), shippingBs: Number(row.shipping_bs || 0), deliveryDistance: Number(row.delivery_distance || 0), source: row.source || 'local' };
    case STORAGE_KEYS.deliveries:
      return { ...row, id: row.id, orderId: row.order_id, merchantLat: row.merchant_lat, merchantLon: row.merchant_lon, deliveryLat: row.delivery_lat, deliveryLon: row.delivery_lon, distanceKm: Number(row.distance_km || 0), shippingUsd: Number(row.shipping_usd || 0) };
    case STORAGE_KEYS.exchangeRate:
      return Number(row.value ?? row ?? 36);
    default:
      return row;
  }
}

async function persistSupabaseState(key, value) {
  if (!state.supabaseEnabled || !state.supabase) return;
  const tableMap = {
    [STORAGE_KEYS.allies]: 'allies',
    [STORAGE_KEYS.products]: 'products',
    [STORAGE_KEYS.promotions]: 'promotions',
    [STORAGE_KEYS.orders]: 'orders',
    [STORAGE_KEYS.deliveries]: 'deliveries',
    [STORAGE_KEYS.exchangeRate]: 'exchange_rates'
  };
  const table = tableMap[key];
  if (!table) return;
  const rows = Array.isArray(value) ? value : [value];
  const payload = rows.filter(Boolean).map((row) => normalizeSupabaseRow(key, row));
  const { error } = await state.supabase.from(table).upsert(payload, { onConflict: 'id' });
  if (error) console.error(`No se pudo guardar en Supabase (${table})`, error);
}

async function loadSupabaseState() {
  if (!state.supabaseEnabled || !state.supabase) return false;
  const tasks = [
    { key: STORAGE_KEYS.allies, table: 'allies', fallback: [] },
    { key: STORAGE_KEYS.products, table: 'products', fallback: [] },
    { key: STORAGE_KEYS.promotions, table: 'promotions', fallback: [] },
    { key: STORAGE_KEYS.orders, table: 'orders', fallback: [] },
    { key: STORAGE_KEYS.deliveries, table: 'deliveries', fallback: [] }
  ];
  for (const task of tasks) {
    const { data, error } = await state.supabase.from(task.table).select('*');
    if (!error && Array.isArray(data)) {
      writeStore(task.key, data.map((row) => hydrateSupabaseRow(task.key, row)));
    } else if (readStore(task.key, null) === null) {
      writeStore(task.key, task.fallback);
    }
  }
  const { data: rateData, error: rateError } = await state.supabase.from('exchange_rates').select('*').order('created_at', { ascending: false }).limit(1);
  if (!rateError && Array.isArray(rateData) && rateData[0]) {
    writeStore(STORAGE_KEYS.exchangeRate, Number(rateData[0].value || 36));
  } else if (readStore(STORAGE_KEYS.exchangeRate, null) === null) {
    writeStore(STORAGE_KEYS.exchangeRate, 36);
  }
  return true;
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
  await loadSupabaseState();
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

function addAlly(name, email, password, role, commission, photo, gps, workingStart = '09:00', workingEnd = '22:00', isOpen = true) {
  const allies = readStore(STORAGE_KEYS.allies, []);
  const normalizedStart = normalizeTimeValue(workingStart);
  const normalizedEnd = normalizeTimeValue(workingEnd);
  const ally = { id: createId('ally'), name, email, password, role, commission: Number(commission || 0), status: isOpen ? 'active' : 'paused', products: [], promotions: [], photo, gps, workingStart: normalizedStart, workingEnd: normalizedEnd, isOpen, source: 'local' };
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
  const allies = readStore(STORAGE_KEYS.allies, []).filter((ally) => ally.role === 'ally');
  if (!allies.length) {
    container.innerHTML = '<div class="card empty">Aún no hay aliados disponibles.</div>';
    return;
  }
  const products = readStore(STORAGE_KEYS.products, []);
  container.innerHTML = allies.map((ally) => {
    const availability = getAllyAvailability(ally);
    const allyProducts = products.filter((product) => product.allyId === ally.id);
    return `
      <div class="card restaurant">
        <div class="thumb">${ally.photo ? `<img src="${ally.photo}" alt="${ally.name}" />` : '🏪'}</div>
        <div style="flex:1">
          <h3>${ally.name}</h3>
          <p class="muted">${availability.label} · ${availability.schedule}</p>
          <div class="small" style="margin:8px 0">Horario de atención: ${formatTime12(ally.workingStart || '09:00')} - ${formatTime12(ally.workingEnd || '22:00')}</div>
          ${allyProducts.length ? `<div style="display:grid;gap:6px;margin-top:8px">${allyProducts.map((product) => `
            <div class="card" style="margin:0;padding:10px">
              <strong>${product.name}</strong>
              <div class="muted">${product.category}</div>
              <div class="small" style="margin-top:6px">${renderPrice(product)}</div>
              <button class="btn btn-secondary add-cart" style="margin-top:8px" data-product='${encodeURIComponent(JSON.stringify(product))}'>Agregar</button>
            </div>
          `).join('')}</div>` : '<div class="empty">Sin productos aún.</div>'}
        </div>
      </div>
    `;
  }).join('');
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
      <div><strong>${order.id}</strong><br><span class="muted">${formatDateTime(order.createdAt)}</span></div>
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
        <div><strong>${a.name}</strong><br><span class="muted">${a.email} · ${a.role} · ${getAllyAvailability(a).label} · ${getAllyAvailability(a).schedule}</span></div>
      </div>
      <span class="pill">${a.isOpen === false ? 'Cerrado' : 'Abierto'}</span>
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
      const workingStart = document.getElementById('allyWorkStart').value || '09:00';
      const workingEnd = document.getElementById('allyWorkEnd').value || '22:00';
      const isOpen = document.getElementById('allyIsOpen').checked;
      addAlly(name, email, password, role, commission, photo, gps, workingStart, workingEnd, isOpen);
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
  const allies = readStore(STORAGE_KEYS.allies, []);
  const currentAlly = allies.find((ally) => ally.email === state.user?.email || ally.id === state.user?.id) || null;
  const products = readStore(STORAGE_KEYS.products, []).filter((product) => !currentAlly || product.allyId === currentAlly.id);
  const availability = currentAlly ? getAllyAvailability(currentAlly) : { label: 'Sin estado', schedule: '09:00 - 22:00' };
  list.innerHTML = `
    ${currentAlly ? `
      <div class="card" style="margin-bottom:10px">
        <strong>${currentAlly.name}</strong>
        <p class="muted">${availability.label} · ${availability.schedule}</p>
        <button class="btn btn-primary" id="toggleAllyStatus">${currentAlly.isOpen === false ? 'Abrir negocio' : 'Cerrar negocio'}</button>
      </div>
      <div class="card" style="margin-bottom:10px">
        <h4>Horario de trabajo</h4>
        <form id="scheduleForm">
          <input id="scheduleWorkStart" class="input" type="text" value="${currentAlly.workingStart || '09:00'}" placeholder="09:00" />
          <input id="scheduleWorkEnd" class="input" type="text" value="${currentAlly.workingEnd || '22:00'}" placeholder="22:00" />
          <label class="small muted"><input id="scheduleIsOpen" type="checkbox" ${currentAlly.isOpen === false ? '' : 'checked'} /> Negocio abierto</label>
          <button class="btn btn-primary" type="submit">Guardar horario</button>
        </form>
      </div>
    ` : ''}
    ${products.map(p => `
      <div class="list-item">
        <div style="display:flex;gap:10px;align-items:center">
          <div class="mini-photo">${p.image ? `<img src="${p.image}" alt="${p.name}" />` : '🍽️'}</div>
          <div><strong>${p.name}</strong><br><span class="muted">${p.category}</span></div>
        </div>
        <span class="pill">${formatUsd(getUsdPrice(p))} · ${formatBs(getBsPrice(p))}</span>
      </div>
    `).join('')}
  `;
  const toggleButton = document.getElementById('toggleAllyStatus');
  if (toggleButton && currentAlly) {
    toggleButton.addEventListener('click', () => {
      const updated = allies.map((ally) => ally.id === currentAlly.id ? { ...ally, isOpen: ally.isOpen !== false, status: ally.isOpen === false ? 'active' : 'paused' } : ally);
      writeStore(STORAGE_KEYS.allies, updated);
      renderAllyPage();
      showMessage('Estado actualizado correctamente', 'success');
    });
  }
  const scheduleForm = document.getElementById('scheduleForm');
  if (scheduleForm && currentAlly) {
    scheduleForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const start = document.getElementById('scheduleWorkStart').value;
      const end = document.getElementById('scheduleWorkEnd').value;
      const isOpen = document.getElementById('scheduleIsOpen').checked;
      const updated = allies.map((ally) => ally.id === currentAlly.id ? { ...ally, workingStart: normalizeTimeValue(start), workingEnd: normalizeTimeValue(end), isOpen, status: isOpen ? 'active' : 'paused' } : ally);
      writeStore(STORAGE_KEYS.allies, updated);
      renderAllyPage();
      showMessage('Horario actualizado correctamente', 'success');
    });
  }
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
