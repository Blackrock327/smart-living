// รายการเดิมอ้างอิง XLSX; เครื่องทำน้ำอุ่นเป็นอุปกรณ์ตัวอย่างที่เพิ่มภายหลัง
const rooms = [
  { id: 'bedroom1', name: 'ห้องนอน 1', kind: 'bedroom', devices: { ac: 1, lights: 1 } },
  { id: 'bedroom2', name: 'ห้องนอน 2', kind: 'bedroom', devices: { ac: 1, lights: 1 } },
  { id: 'bedroom3', name: 'ห้องนอน 3', kind: 'bedroom', devices: { ac: 1, lights: 1 } },
  { id: 'bathroom1', name: 'ห้องน้ำ 1', kind: 'service', devices: { lights: 1, heater: 1 } },
  { id: 'bathroom2', name: 'ห้องน้ำ 2', kind: 'service', devices: { lights: 1, heater: 1 } },
  { id: 'kitchen', name: 'ห้องครัว', kind: 'service', devices: { lights: 2, fridge: 1 } },
  { id: 'living', name: 'ห้องโถง / นั่งเล่น', kind: 'common', devices: { lights: 6, tv: 1 } }
];

const deviceInfo = {
  ac: { name: 'เครื่องปรับอากาศ', short: 'แอร์', icon: 'wind' },
  lights: { name: 'หลอดไฟ', short: 'ไฟ', icon: 'lightbulb' },
  tv: { name: 'โทรทัศน์', short: 'ทีวี', icon: 'tv' },
  fridge: { name: 'ตู้เย็น', short: 'ตู้เย็น', icon: 'refrigerator' },
  heater: { name: 'เครื่องทำน้ำอุ่น', short: 'น้ำอุ่น', icon: 'flame' }
};

const order = ['ac', 'lights', 'tv', 'fridge', 'heater'];
const devicePalette = {
  ac: { chart: '#86b894' },
  lights: { chart: '#e5b65d' },
  tv: { chart: '#83a9d1' },
  fridge: { chart: '#b6a1d2' },
  heater: { chart: '#ff9a66' }
};

// กำลังไฟและเวลาเป็นตัวอย่าง; ปรับตารางได้ใน scheduleWindows ด้านล่าง
const energyModel = {
  ac: { watts: 1200 },
  lights: { watts: 9 },
  tv: { watts: 81 },
  fridge: { watts: 100, dutyCycle: 0.35 },
  heater: { watts: 3500, hoursPerDay: 0.25 } // ตัวอย่างอาบน้ำอุ่นวันละ 15 นาทีต่อเครื่อง
};
const storageKey = 'smartliving-energy-sim-device-status-v2';
const billSettingsStorageKey = 'smartliving-blueprint-bill-settings-v1';
const scenarioStorageKey = 'smartliving-energy-sim-profile-v2';
const rangeStorageKey = 'smartliving-energy-sim-range-v1';
const monthlyHistoryStorageKey = 'smartliving-monthly-simulation-history-v1';
const defaultFtRate = 0.1623;
const monthlyServiceCharges = { lowUse: 8.19, regular: 24.62 };
// Declare storage fallback state before readStatus() runs during script startup.
const warnedStorageKeys = new Set();
const memoryStorageFallback = new Map();
let energyChart = null;
let simulationChart = null;
let selectedRoom = 'all';
let status = readStatus();
let selectedScenario = 'weekday';
let selectedWeather = 'normal';
let simulationRange = 'day';
let simulationDayIndex = 0;
let simulationHour = 0;
let simulationTimer = null;
let saveFeedbackTimer = null;
let toastTimer = null;
let timelineTickSignature = '';
const simulationOverrides = new Set();

function readStoredValue(key) {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) memoryStorageFallback.set(key, value);
    return value ?? memoryStorageFallback.get(key) ?? null;
  } catch (error) {
    warnStorageFallback(key, error);
    return memoryStorageFallback.get(key) ?? null;
  }
}

function writeStoredValue(key, value) {
  const serialized = String(value);
  // เก็บในหน่วยความจำก่อน เพื่อให้การเปลี่ยนค่ายังใช้ได้จนกว่าจะปิดหน้าเว็บ
  memoryStorageFallback.set(key, serialized);
  try {
    localStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    warnStorageFallback(key, error);
    return false;
  }
}

function normalizeSimulationHour(value) {
  // 24:00 is a valid end-of-day marker; array lookups must use simulationHourIndex().
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(24, Math.floor(numeric)));
}

function simulationHourIndex(value = simulationHour) {
  return Math.min(23, normalizeSimulationHour(value));
}

function isSimulationDayEnd(value = simulationHour) {
  return normalizeSimulationHour(value) === 24;
}

function warnStorageFallback(key, error) {
  if (warnedStorageKeys.has(key)) return;
  warnedStorageKeys.add(key);
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[Smart Living] อ่านหรือบันทึก ${key} ไม่ได้; เว็บไซต์จะทำงานต่อ แต่ข้อมูลนี้อาจไม่อยู่หลังปิดหน้าเว็บ`, error);
  }
}

function readStatus() {
  try {
    const saved = JSON.parse(readStoredValue(storageKey) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch (error) {
    warnStorageFallback(storageKey, error);
    return {};
  }
}

function readSimulationRange() {
  const saved = readStoredValue(rangeStorageKey);
  return ['day', 'month', 'year'].includes(saved) ? saved : 'day';
}

function simulationPeriodDays(range = simulationRange) {
  const now = new Date();
  if (range === 'day') return 1;
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return new Date(now.getFullYear(), 1, 29).getMonth() === 1 ? 366 : 365;
}

function simulationPeriodStart(range = simulationRange) {
  const now = new Date();
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (range === 'year') return new Date(now.getFullYear(), 0, 1);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function currentSimulationDate(dayIndex = simulationDayIndex) {
  const date = simulationPeriodStart();
  date.setDate(date.getDate() + dayIndex);
  return date;
}

function formatSimulationDate(date, options = { day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat('th-TH', options).format(date);
}

function simulationOverrideKey(roomId, type, hour, dayIndex = simulationDayIndex) {
  return `${keyFor(roomId, type)}@${dayIndex}:${hour}`;
}

function saveStatus() {
  writeStoredValue(storageKey, JSON.stringify(status));
}

function quantity(room, type) { return Number(room.devices[type] || 0); }
function roomTotal(room) { return order.reduce((sum, type) => sum + quantity(room, type), 0); }
function keyFor(roomId, type) { return `${roomId}:${type}`; }
function isOn(roomId, type) { return status[keyFor(roomId, type)] !== false; }
function roomById(id) { return rooms.find(room => room.id === id); }

const scenarioNames = { weekday: 'วันธรรมดา', weekend: 'วันหยุด', away: 'ไม่อยู่บ้าน' };
const weatherModes = {
  normal: { name: 'ปกติ', temperature: 28 },
  sunny: { name: 'แดดจัด', temperature: 31 },
  rainy: { name: 'ฝนตก', temperature: 25 }
};
const scheduleWindows = {
  weekday: {
    ac: { bedroom1: [[0, 4], [22, 24]], bedroom2: [[0, 3], [21, 24]], bedroom3: [[0, 4], [22, 24]] },
    lights: { bedroom1: [[6, 7], [19, 23]], bedroom2: [[6, 7], [19, 23]], bedroom3: [[6, 7], [19, 23]], bathroom1: [[6, 8], [18, 21]], bathroom2: [[6, 8], [18, 21]], kitchen: [[6, 8], [12, 13], [18, 20]], living: [[6, 7], [18, 23]] },
    heater: { bathroom1: [[6, 7]], bathroom2: [[19, 20]] },
    tv: { living: [[18, 24]] }
  },
  weekend: {
    ac: { bedroom1: [[0, 4], [14, 16], [22, 24]], bedroom2: [[0, 4], [13, 15], [22, 24]], bedroom3: [[0, 4], [22, 24]] },
    lights: { bedroom1: [[7, 9], [20, 23]], bedroom2: [[7, 9], [20, 23]], bedroom3: [[7, 9], [20, 23]], bathroom1: [[8, 10], [19, 22]], bathroom2: [[8, 10], [19, 22]], kitchen: [[8, 10], [13, 14], [18, 20]], living: [[8, 10], [17, 24]] },
    heater: { bathroom1: [[8, 9]], bathroom2: [[20, 21]] },
    tv: { living: [[10, 12], [18, 24]] }
  }
};

function deviceScheduleFraction(room, type, hour, profile = selectedScenario, includeOverrides = true, dayIndex = simulationDayIndex) {
  if (!isOn(room.id, type)) return 0;
  const numericHour = Number(hour);
  if (!Number.isFinite(numericHour) || numericHour < 0 || numericHour >= 24) return 0;
  const safeHour = simulationHourIndex(numericHour);
  if (includeOverrides && simulationOverrides.has(simulationOverrideKey(room.id, type, safeHour, dayIndex))) return 1;
  if (profile === 'away') return type === 'fridge' ? energyModel.fridge.dutyCycle : 0;
  if (type === 'fridge') return energyModel.fridge.dutyCycle;
  if (type === 'heater') {
    const windows = scheduleWindows[profile]?.[type]?.[room.id] || [];
    return windows.some(([start, end]) => safeHour >= start && safeHour < end) ? energyModel.heater.hoursPerDay : 0;
  }
  const windows = scheduleWindows[profile]?.[type]?.[room.id] || [];
  return windows.some(([start, end]) => safeHour >= start && safeHour < end) ? 1 : 0;
}

function weatherAdjustedFraction(room, type, hour, baseFraction, profile, weather = selectedWeather) {
  if (weather === 'sunny' && type === 'ac' && hour >= 12 && hour < 17 && profile !== 'away' && isOn(room.id, type)) {
    return 1.25; // แดดจัด: เพิ่มเวลา/โหลดแอร์ในช่วงบ่าย
  }
  if (weather === 'rainy' && type === 'ac' && hour >= 12 && hour < 18) return baseFraction * 0.85;
  if (weather === 'rainy' && type === 'lights' && hour >= 10 && hour < 18 && profile !== 'away' && isOn(room.id, type)) {
    return Math.max(baseFraction, 0.25) * 1.2; // ฝนตก: เปิดไฟเพิ่มในบ้านช่วงกลางวัน
  }
  return baseFraction;
}

function hourlySimulation(profile = selectedScenario, includeOverrides = true, dayIndex = simulationDayIndex, weather = selectedWeather) {
  return Array.from({ length: 24 }, (_, hour) => {
    const watts = rooms.reduce((sum, room) => sum + order.reduce((roomSum, type) => {
      const scheduledFraction = deviceScheduleFraction(room, type, hour, profile, includeOverrides, dayIndex);
      const weatherFraction = weatherAdjustedFraction(room, type, hour, scheduledFraction, profile, weather);
      return roomSum + energyModel[type].watts * quantity(room, type) * weatherFraction;
    }, 0), 0);
    return { hour, watts, kwh: watts / 1000 };
  });
}

function renderWeatherState() {
  document.querySelectorAll('.weather-button').forEach(button => {
    const selected = button.dataset.weather === selectedWeather;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const weather = weatherModes[selectedWeather] || weatherModes.normal;
  document.querySelector('#weatherTemperature').textContent = `${weather.temperature}°C`;
  document.querySelector('#weatherSummary').textContent = selectedWeather === 'sunny'
    ? 'แดดจัด · เพิ่มเวลา/โหลดแอร์ช่วง 12:00–17:00'
    : selectedWeather === 'rainy' ? 'ฝนตก · ลดโหลดแอร์ เพิ่มไฟช่วง 10:00–18:00' : 'โหลดเป็นไปตามตารางปกติ';
}

function selectWeather(weather) {
  if (!Object.hasOwn(weatherModes, weather)) return;
  selectedWeather = weather;
  renderWeatherState();
  renderEnergy();
  renderSimulationView();
  const messages = {
    normal: 'อากาศปกติ · ใช้ตารางโหลดเดิม',
    sunny: 'แดดจัด · อุณหภูมิจำลอง 31°C · เพิ่มเวลา/โหลดแอร์ช่วงบ่าย',
    rainy: 'ฝนตก · อุณหภูมิจำลอง 25°C · ลดโหลดแอร์และเพิ่มการเปิดไฟช่วงกลางวัน'
  };
  showSimulationEvent(messages[selectedWeather]);
  logSimulationHour(-1, simulationHour);
}

function dailyEnergyKwh(profile = selectedScenario) {
  return hourlySimulation(profile, false, 0).reduce((sum, hour) => sum + hour.kwh, 0);
}

function updatePlanDeviceMarkers() {
  const doc = document.querySelector('#floorPlan')?.contentDocument;
  if (!doc) return;
  doc.querySelectorAll('[data-room-status]').forEach(marker => {
    const room = roomById(marker.getAttribute('data-room-status'));
    if (!room) return;
    const total = roomTotal(room);
    const active = order.reduce((sum, type) => {
      const scheduled = deviceScheduleFraction(room, type, simulationHour);
      return sum + (weatherAdjustedFraction(room, type, simulationHour, scheduled, selectedScenario) > 0 ? quantity(room, type) : 0);
    }, 0);
    marker.classList.toggle('all-off', active === 0);
    marker.querySelector('.state-marker-text').textContent = active ? `ON ${active}/${total}` : 'OFF';
    marker.setAttribute('aria-label', `${room.name}: เปิด ${active} จาก ${total} อุปกรณ์`);
  });
}

const iconPaths = {
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v4m6-4v4m-6 14v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'file-spreadsheet': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-8 4h8m-5-4v7"/>',
  house: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>',
  'layout-dashboard': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  lightbulb: '<path d="M9 18h6m-5 4h4m-2-20a7 7 0 0 0-4 12.7c.6.4 1 1 1 1.8h6c0-.8.4-1.4 1-1.8A7 7 0 0 0 12 2z"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/>',
  'map-pin': '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  'maximize-2': '<path d="M15 3h6v6m-7 1 7-7M9 21H3v-6m7-1-7 7M21 15v6h-6m-1-7 7 7M3 9V3h6m1 7L3 3"/>',
  'panels-top-left': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  plug: '<path d="M12 22v-5m-5-12v5m10-5v5M5 10h14v2a7 7 0 0 1-14 0z"/>',
  'rotate-ccw': '<path d="M3 7v6h6M3 13a9 9 0 1 0 2.6-6.4L3 9"/>',
  'door-open': '<path d="M13 4H6a2 2 0 0 0-2 2v14h11V6a2 2 0 0 0-2-2Z"/><path d="M15 12h6m-3-3 3 3-3 3"/><path d="M10 12h.01"/>',
  moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  'scan-eye': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  thermometer: '<path d="M14 14.8V5a3 3 0 0 0-6 0v9.8a5 5 0 1 0 6 0Z"/><path d="M11 11v7"/>',
  workflow: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v3a3 3 0 0 0 3 3h6m0-9h-3a3 3 0 0 0-3 3v3"/>',
  'chart-no-axes-combined': '<path d="M3 3v18h18M8 15l4-4 4 3 5-7"/>',
  'calendar-days': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  'trash-2': '<path d="M3 6h18m-2 0-.9 14.2A2 2 0 0 1 16.1 22H7.9a2 2 0 0 1-2-1.8L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 4v7m4-7v7"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  play: '<path d="m7 4 13 8-13 8z"/>', pause: '<path d="M8 5h3v14H8zm5 0h3v14h-3z"/>',
  wind: '<path d="M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M4 16h6a3 3 0 1 1-3 3"/>',
  zap: '<path d="m13 2-3 9h7L9 22l2-9H4z"/>',
  bed: '<path d="M3 18v-6h18v6M3 12V6h7v6m0-4h7a4 4 0 0 1 4 4M3 18v3m18-3v3"/>',
  sofa: '<path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M3 18v-5a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5zM5 18v2m14-2v2"/>',
  tv: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="m8 22 4-4 4 4"/>',
  refrigerator: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 10h14m-10-5v2m0 6v4"/>',
  flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-2-1-3-3-3-5-3 3-5 6-5 9a8 8 0 0 0 8 7Z"/><path d="M10 17a3 3 0 0 0 6 0c0-2-2-3-3-5-2 2-3 3-3 5Z"/>',
  'chart-no-axes-column-increasing': '<path d="M3 3v18h18"/><path d="M8 16V9m5 7V5m5 11v-4"/>',
  'plug-zap': '<path d="M12 22v-5m-5-12v5m10-5v5M5 10h14v2a7 7 0 0 1-9 6.7"/><path d="m14 2-2 4h4l-3 4"/>',
  'washing-machine': '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M8 6h.01M12 6h.01M16 6h.01"/>'
};

function renderFallbackIcons(root = document) {
  root.querySelectorAll?.('[data-lucide]').forEach(node => {
    node.classList.add('icon-fallback');
    const paths = iconPaths[node.dataset.lucide] || iconPaths.activity;
    node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  });
}

function renderIcons(root = document) {
  if (window.lucide?.createIcons) {
    root.querySelectorAll?.('[data-lucide].icon-fallback').forEach(node => {
      node.classList.remove('icon-fallback');
      node.textContent = '';
    });
    try {
      window.lucide.createIcons({ root, attrs: { 'stroke-width': 1.8 } });
    } catch (error) {
      console.info('Lucide icons unavailable; using built-in symbols instead.', error);
    }
  }

  // Use built-in symbols for any icon the library could not render.
  renderFallbackIcons(root);
}

function loadOptionalLibrary(url, onLoad) {
  const script = document.createElement('script');
  script.src = url;
  script.async = true;
  script.onload = onLoad;
  script.onerror = () => console.info(`Optional visual library unavailable: ${url}`);
  document.head.append(script);
}

function estimatedKwh(room, type) {
  const model = energyModel[type];
  const dailyUnits = Array.from({ length: 24 }, (_, hour) => {
    const scheduled = deviceScheduleFraction(room, type, hour, selectedScenario, false);
    return weatherAdjustedFraction(room, type, hour, scheduled, selectedScenario);
  })
    .reduce((sum, fraction) => sum + fraction, 0);
  return model.watts * quantity(room, type) * dailyUnits * 30 / 1000;
}

function estimateForScope(scope, type) {
  return scope.reduce((sum, room) => sum + estimatedKwh(room, type), 0);
}

function renderMetrics() {
  const totals = Object.fromEntries(order.map(type => [type, rooms.reduce((sum, room) => sum + quantity(room, type), 0)]));
  document.querySelector('#totalDevices').textContent = Object.values(totals).reduce((a, b) => a + b, 0);
  document.querySelector('#acCount').textContent = totals.ac;
  document.querySelector('#lightCount').textContent = totals.lights;
}

function renderRoom() {
  const room = selectedRoom === 'all' ? null : roomById(selectedRoom);
  document.querySelector('#roomTitle').textContent = room ? room.name : 'ภาพรวมทุกห้อง';
  document.querySelector('#roomNumber').textContent = room ? `พื้นที่ 0${rooms.indexOf(room) + 1}` : 'ทั้งหมด';
  const roomIcon = room ? (room.kind === 'bedroom' ? 'bed' : room.kind === 'service' ? 'house' : 'sofa') : 'house';
  document.querySelector('#roomIcon').innerHTML = `<i data-lucide="${roomIcon}" aria-hidden="true"></i>`;
  const scope = room ? [room] : rooms;
  const total = scope.reduce((sum, item) => sum + roomTotal(item), 0);
  document.querySelector('#roomDeviceTotal').textContent = total;
  const container = document.querySelector('#deviceList');
  container.replaceChildren();
  const shown = order.map(type => ({ type, qty: scope.reduce((sum, item) => sum + quantity(item, type), 0) })).filter(item => item.qty > 0);
  if (!shown.length) {
    container.innerHTML = '<div class="empty-state">ห้องนี้ไม่มีรายการอุปกรณ์ในตาราง</div>';
    renderIcons(document.querySelector('#roomIcon'));
    updatePlanDeviceMarkers();
    return;
  }
  shown.forEach(({ type, qty }) => {
    const info = deviceInfo[type];
    const matchingRooms = scope.filter(item => quantity(item, type) > 0);
    const isGroup = !room;
    const allOn = matchingRooms.every(item => isOn(item.id, type));
    const anyOn = matchingRooms.some(item => isOn(item.id, type));
    const activeQty = matchingRooms.reduce((sum, item) => {
      const scheduled = deviceScheduleFraction(item, type, simulationHour);
      return sum + (weatherAdjustedFraction(item, type, simulationHour, scheduled, selectedScenario) > 0 ? quantity(item, type) : 0);
    }, 0);
    const includedQty = matchingRooms.reduce((sum, item) => sum + (isOn(item.id, type) ? quantity(item, type) : 0), 0);
    const stateText = selectedScenario === 'away' && type !== 'fridge'
      ? 'ปิดตามรูปแบบ'
      : activeQty > 0 ? `ทำงาน ${activeQty}/${qty}` : includedQty > 0 ? 'รอตามตาราง' : 'ไม่รวมในแบบจำลอง';
    const scopeName = room ? room.name : `${matchingRooms.length} พื้นที่`;
    const row = document.createElement('div');
    row.className = 'device-row';
    const ariaState = allOn ? 'true' : anyOn ? 'mixed' : 'false';
    row.innerHTML = `<div class="device-info device-info-${type}"><span class="device-icon device-icon-${type}" aria-hidden="true"><i data-lucide="${info.icon}"></i></span><span><b>${info.name}</b><small>${scopeName} · ${stateText} · ~${estimateForScope(scope, type).toFixed(1)} kWh/เดือน</small></span></div><div class="device-action"><span class="device-qty">${qty}</span><button class="toggle" type="button" role="switch" aria-checked="${ariaState}" aria-label="${allOn ? 'ไม่นำ' : 'นำ'}${info.name} ${isGroup ? 'ทั้งหมด' : ''}เข้าแบบจำลอง" data-toggle-type="${type}" data-toggle-room="${room ? room.id : 'all'}"></button></div>`;
    container.append(row);
  });
  renderIcons(container);
  renderIcons(document.querySelector('#roomIcon'));
  updatePlanDeviceMarkers();
}

function loadSelectedScenario() {
  const saved = readStoredValue(scenarioStorageKey);
  return Object.hasOwn(scenarioNames, saved) ? saved : 'weekday';
}

function saveSelectedScenario() {
  writeStoredValue(scenarioStorageKey, selectedScenario);
}

function renderScenarioState() {
  document.querySelector('#activeScenarioLabel').textContent = scenarioNames[selectedScenario];
  document.querySelector('#simulationProfileLabel').textContent = scenarioNames[selectedScenario];
  document.querySelectorAll('[data-scenario]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === selectedScenario));
  });
}

function showSimulationEvent(message) {
  const log = document.querySelector('#simulationLog');
  if (!log) return;
  const time = `${String(normalizeSimulationHour(simulationHour)).padStart(2, '0')}:00`;
  const datePrefix = simulationRange === 'day' ? '' : `${formatSimulationDate(currentSimulationDate())} · `;
  const entry = document.createElement('li');
  const timestamp = document.createElement('time');
  timestamp.textContent = `${datePrefix}${time}`;
  entry.append(timestamp, document.createTextNode(` · ${message}`));
  log.append(entry);
  while (log.children.length > 10) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}

function logSimulationHour(previousHour, currentHour, previousDayIndex = simulationDayIndex, currentDayIndex = simulationDayIndex) {
  const previousValue = Number(previousHour);
  const currentValue = Number(currentHour);
  const previous = Number.isFinite(previousValue) && previousValue >= 0 && previousValue < 24 ? simulationHourIndex(previousValue) : -1;
  const current = Number.isFinite(currentValue) && currentValue >= 0 && currentValue < 24 ? simulationHourIndex(currentValue) : -1;
  if (previous >= 0 && current >= 0 && (previous !== current || previousDayIndex !== currentDayIndex)) {
    rooms.forEach(room => order.forEach(type => {
      const wasActive = deviceScheduleFraction(room, type, previous, selectedScenario, true, previousDayIndex) > 0;
      const isActive = deviceScheduleFraction(room, type, current, selectedScenario, true, currentDayIndex) > 0;
      if (wasActive !== isActive) {
        showSimulationEvent(`${isActive ? 'เปิดใช้งาน' : 'หยุดทำงาน'}${deviceInfo[type].name} · ${room.name}`);
      }
    }));
  }
  const watts = current >= 0 ? hourlySimulation(selectedScenario, true, currentDayIndex)[current].watts : 0;
  showSimulationEvent(`ระบบคำนวณโหลดไฟรวม ${(watts / 1000).toFixed(2)} kW`);
}

function simulationChartSeries() {
  const baselineDaily = dailyEnergyKwh();
  const currentDay = hourlySimulation().reduce((sum, item) => sum + item.kwh, 0);
  const currentDayAdjustment = currentDay - baselineDaily;

  if (simulationRange === 'day') {
    const hourly = hourlySimulation();
    return {
      labels: hourly.map(item => `${String(item.hour).padStart(2, '0')}:00`),
      values: hourly.map(item => item.watts / 1000),
      activeIndex: isSimulationDayEnd() ? -1 : simulationHourIndex(),
      datasetLabel: 'โหลดไฟรายชั่วโมง',
      axisTitle: 'กำลังไฟ (kW)',
      tooltipUnit: 'kW · kWh ในชั่วโมงนี้'
    };
  }

  if (simulationRange === 'month') {
    const days = simulationPeriodDays('month');
    const values = Array(days).fill(baselineDaily);
    values[simulationDayIndex] += currentDayAdjustment;
    return {
      labels: values.map((_, index) => `วันที่ ${index + 1}`),
      values,
      activeIndex: simulationDayIndex,
      datasetLabel: 'พลังงานรายวัน',
      axisTitle: 'พลังงาน (kWh/วัน)',
      tooltipUnit: 'kWh/วัน'
    };
  }

  const year = simulationPeriodStart('year').getFullYear();
  const labels = Array.from({ length: 12 }, (_, month) => formatSimulationDate(new Date(year, month, 1), { month: 'short' }));
  const values = Array.from({ length: 12 }, (_, month) => baselineDaily * new Date(year, month + 1, 0).getDate());
  values[currentSimulationDate().getMonth()] += currentDayAdjustment;
  return {
    labels,
    values,
    activeIndex: currentSimulationDate().getMonth(),
    datasetLabel: 'พลังงานรายเดือน',
    axisTitle: 'พลังงาน (kWh/เดือน)',
    tooltipUnit: 'kWh/เดือน'
  };
}

function createSimulationChart() {
  const canvas = document.querySelector('#simulationChart');
  const fallback = document.querySelector('#simulationChartFallback');
  if (!canvas || typeof Chart === 'undefined') {
    if (canvas) canvas.hidden = true;
    if (fallback) fallback.hidden = false;
    return;
  }

  const series = simulationChartSeries();
  if (!series.values.some(value => Number.isFinite(value) && value > 0)) {
    if (simulationChart) {
      simulationChart.destroy();
      simulationChart = null;
    }
    canvas.hidden = true;
    if (fallback) {
      fallback.textContent = 'ไม่มีโหลดไฟในช่วงเวลาที่เลือก · ตรวจสอบว่านำอุปกรณ์เข้าแบบจำลองแล้ว';
      fallback.hidden = false;
    }
    return;
  }

  if (fallback) fallback.textContent = 'กราฟโหลดไม่สำเร็จ แต่ค่าพลังงานและตารางอุปกรณ์ยังคำนวณได้';
  const colors = series.values.map((_, index) => index === series.activeIndex ? '#69e697' : 'rgba(105, 230, 151, .34)');
  try {
    if (simulationChart) {
      simulationChart.data.labels = series.labels;
      simulationChart.data.datasets[0].data = series.values;
      simulationChart.data.datasets[0].label = series.datasetLabel;
      simulationChart.data.datasets[0].backgroundColor = colors;
      simulationChart.options.scales.y.title.text = series.axisTitle;
      simulationChart.options.scales.x.ticks.maxTicksLimit = simulationRange === 'day' ? 9 : 12;
      simulationChart.options.plugins.tooltip.callbacks.label = context => ` ${context.parsed.y.toFixed(2)} ${series.tooltipUnit}`;
      simulationChart.update('none');
    } else {
      simulationChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: series.labels,
          datasets: [{ label: series.datasetLabel, data: series.values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 22 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: context => ` ${context.parsed.y.toFixed(2)} ${series.tooltipUnit}` } }
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#b3c4b8', maxTicksLimit: simulationRange === 'day' ? 9 : 12 } },
            y: { beginAtZero: true, title: { display: true, text: series.axisTitle, color: '#b3c4b8' }, grid: { color: 'rgba(163, 184, 169, .12)' }, ticks: { color: '#b3c4b8' } }
          }
        }
      });
    }
    canvas.setAttribute('aria-label', simulationRange === 'day' ? 'กราฟโหลดไฟจำลองแยกตามชั่วโมง' : simulationRange === 'month' ? 'กราฟพลังงานจำลองแยกตามวันในเดือน' : 'กราฟพลังงานจำลองแยกตามเดือนในปี');
    canvas.hidden = false;
    if (fallback) fallback.hidden = true;
  } catch {
    canvas.hidden = true;
    if (fallback) fallback.hidden = false;
  }
}

function applyScenario(scenario) {
  selectedScenario = scenario;
  simulationOverrides.clear();
  pauseSimulation();
  simulationDayIndex = 0;
  simulationHour = 0;
  saveSelectedScenario();
  renderScenarioState();
  renderEnergy();
  renderSimulationView();
  showSimulationEvent(`เปลี่ยนรูปแบบเป็น “${scenarioNames[scenario]}”`);
  logSimulationHour(-1, simulationHour);
}

function simulateSensor(sensor) {
  if (isSimulationDayEnd()) {
    showSimulationEvent('สิ้นสุดวันจำลองแล้ว กดเริ่มใหม่ก่อนทดลองเหตุการณ์');
    return;
  }
  if (selectedScenario === 'away') {
    showSimulationEvent('ตรวจพบเหตุการณ์ แต่รูปแบบไม่อยู่บ้านปิดอุปกรณ์ที่ไม่จำเป็น');
    return;
  }

  const hour = simulationHourIndex();
  if (sensor === 'motion') {
    simulationOverrides.add(simulationOverrideKey('living', 'lights', hour));
    renderSimulationView();
    showSimulationEvent('เซ็นเซอร์พบการเคลื่อนไหว → เพิ่มโหลดไฟห้องโถงในช่วงเวลานี้');
    logSimulationHour(-1, simulationHour);
    return;
  }

  rooms.filter(room => room.kind === 'bedroom').forEach(room => {
    simulationOverrides.add(simulationOverrideKey(room.id, 'ac', hour));
  });
  renderSimulationView();
  showSimulationEvent('อุณหภูมิเกิน 28°C → เพิ่มโหลดแอร์ห้องนอนในช่วงเวลานี้');
  logSimulationHour(-1, simulationHour);
}

function currentDayEnergyKwh() {
  return hourlySimulation().reduce((sum, item) => sum + item.kwh, 0);
}

function currentDayAccumulatedKwh() {
  return hourlySimulation().slice(0, normalizeSimulationHour(simulationHour)).reduce((sum, item) => sum + item.kwh, 0);
}

function projectedPeriodKwh() {
  const baselineDaily = dailyEnergyKwh();
  const oneDayAdjustment = currentDayEnergyKwh() - baselineDaily;
  return baselineDaily * simulationPeriodDays() + oneDayAdjustment;
}

function accumulatedPeriodKwh() {
  return dailyEnergyKwh() * simulationDayIndex + currentDayAccumulatedKwh();
}

function projectedPeriodCost() {
  const baselineDaily = dailyEnergyKwh();
  const oneDayAdjustment = currentDayEnergyKwh() - baselineDaily;
  if (simulationRange === 'day') return billEstimate(baselineDaily * 30 + oneDayAdjustment).total;
  if (simulationRange === 'month') return billEstimate(projectedPeriodKwh()).total;

  const year = simulationPeriodStart('year').getFullYear();
  const selectedMonth = currentSimulationDate().getMonth();
  return Array.from({ length: 12 }, (_, month) => {
    const days = new Date(year, month + 1, 0).getDate();
    const adjustment = month === selectedMonth ? oneDayAdjustment : 0;
    return billEstimate(baselineDaily * days + adjustment).total;
  }).reduce((sum, amount) => sum + amount, 0);
}

function accruedBillCost(units, serviceFraction = 1) {
  const rateType = document.querySelector('#billRateType').value;
  const ftValue = Number(document.querySelector('#billFtRate').value);
  const ftRate = Number.isFinite(ftValue) ? ftValue : defaultFtRate;
  const beforeVat = energyChargeByTiers(units, rateType)
    + units * ftRate
    + monthlyServiceCharges[rateType] * Math.max(0, Math.min(1, serviceFraction));
  return beforeVat * 1.07;
}

function accumulatedPeriodCost() {
  const date = currentSimulationDate();
  const fractionOfDay = simulationHour / 24;
  const dailyKwh = dailyEnergyKwh();

  if (simulationRange === 'day') {
    return accruedBillCost(currentDayAccumulatedKwh(), fractionOfDay / 30);
  }

  if (simulationRange === 'month') {
    const daysInMonth = simulationPeriodDays();
    const elapsedDays = simulationDayIndex + fractionOfDay;
    return accruedBillCost(accumulatedPeriodKwh(), elapsedDays / daysInMonth);
  }

  const year = date.getFullYear();
  let total = 0;
  for (let month = 0; month <= date.getMonth(); month += 1) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthUnits = month < date.getMonth()
      ? dailyKwh * daysInMonth
      : dailyKwh * (date.getDate() - 1) + currentDayAccumulatedKwh();
    const elapsedDays = month < date.getMonth() ? daysInMonth : date.getDate() - 1 + fractionOfDay;
    total += accruedBillCost(monthUnits, elapsedDays / daysInMonth);
  }
  return total;
}

function renderPeriodControls() {
  const days = simulationPeriodDays();
  const date = currentSimulationDate();
  const periodTimeline = document.querySelector('#periodTimeline');
  const periodName = simulationRange === 'month'
    ? formatSimulationDate(date, { month: 'long', year: 'numeric' })
    : simulationRange === 'year' ? formatSimulationDate(date, { year: 'numeric' }) : 'วันนี้';
  const dateText = formatSimulationDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  periodTimeline.hidden = simulationRange === 'day';
  document.querySelector('#simulationPeriodLabel').textContent = periodName;
  document.querySelector('#simulationDayLabel').textContent = simulationRange === 'month'
    ? `วันที่ ${date.getDate()} / ${days}`
    : simulationRange === 'year' ? `วันที่ ${simulationDayIndex + 1} / ${days}` : '';
  document.querySelector('#simulationDayControlLabel').textContent = simulationRange === 'month' ? 'เลือกวันที่ในเดือน' : 'เลือกวันในปี';
  document.querySelector('#simulationDateLabel').textContent = dateText;
  document.querySelector('#simulationClockLabel').textContent = simulationRange === 'day' ? 'เวลาในวันจำลอง' : 'เวลา ณ วันที่เลือก';
  const saveButton = document.querySelector('#saveMonthlyResult');
  saveButton.disabled = simulationRange !== 'month';
  document.querySelector('#historySaveStatus').textContent = simulationRange === 'month'
    ? 'บันทึกยอดสะสมของเดือนที่เลือกได้'
    : 'เลือกช่วงเวลา “รายเดือน” เพื่อบันทึกผล';

  const dayInput = document.querySelector('#simulationDay');
  dayInput.max = String(days - 1);
  dayInput.value = String(Math.min(simulationDayIndex, days - 1));
  dayInput.setAttribute('aria-valuetext', dateText);
  document.querySelector('#simulationTime').setAttribute('aria-label', `${dateText} · เลือกเวลาจำลอง`);
  const tickSignature = `${simulationRange}:${days}`;
  if (tickSignature !== timelineTickSignature) {
    const year = simulationPeriodStart('year').getFullYear();
    const timelineTicks = simulationRange === 'month'
      ? [0, Math.min(9, days - 1), Math.min(19, days - 1), days - 1].map(index => ({ index, label: String(index + 1) }))
      : [0, 3, 6, 11].map(month => ({
        index: Math.round((new Date(year, month, 1) - new Date(year, 0, 1)) / 86400000),
        label: formatSimulationDate(new Date(year, month, 1), { month: 'short' })
      }));
    document.querySelector('#periodTimelineTicks').replaceChildren(...[...new Map(timelineTicks.map(tick => [tick.index, tick])).values()].map(({ label }) => {
      const tick = document.createElement('span');
      tick.textContent = label;
      return tick;
    }));
    timelineTickSignature = tickSignature;
  }

  const metricLabel = simulationRange === 'day' ? 'ทั้งวัน' : simulationRange === 'month' ? 'ทั้งเดือน' : 'ทั้งปี';
  document.querySelector('#simulationAccumulatedLabel').textContent = simulationRange === 'day' ? 'หน่วยสะสมถึงเวลานี้' : 'หน่วยสะสมถึงวันและเวลาที่เลือก';
  document.querySelector('#simulationPeriodEnergyLabel').textContent = `พลังงานคาดการณ์${metricLabel}`;
  document.querySelector('#simulationCostLabel').textContent = simulationRange === 'day'
    ? 'ค่าไฟสะสมถึงเวลานี้'
    : simulationRange === 'month' ? 'ค่าไฟสะสมถึงวันและเวลาที่เลือก' : 'ค่าไฟสะสมตั้งแต่ต้นปี';
  document.querySelector('#simulationFootnote').textContent = simulationRange === 'day'
    ? 'รายวัน: 1 วินาที = 1 ชั่วโมงจำลอง · 24:00 คือสิ้นวัน · ค่าไฟและหน่วยสะสมเพิ่มตามเวลาที่เลือก'
    : 'รายเดือน/รายปี: 1 วินาที = 1 วันจำลอง · ค่าไฟและหน่วยสะสมเพิ่มตามวันที่และเวลาที่เลือก';
}

function renderSimulationView() {
  simulationHour = normalizeSimulationHour(simulationHour);
  renderWeatherState();
  const hourly = hourlySimulation();
  const hour = simulationHourIndex();
  const currentWatts = isSimulationDayEnd() ? 0 : hourly[hour].watts;
  const accumulated = accumulatedPeriodKwh();
  const projectedKwh = projectedPeriodKwh();
  renderPeriodControls();

  document.querySelector('#simulationClock').textContent = `${String(simulationHour).padStart(2, '0')}:00`;
  document.querySelector('#simulationTime').value = simulationHour;
  document.querySelector('#simulationPower').textContent = (currentWatts / 1000).toFixed(2);
  document.querySelector('#simulationAccumulated').textContent = accumulated.toFixed(2);
  document.querySelector('#simulationDailyTotal').textContent = projectedKwh.toFixed(2);
  document.querySelector('#simulationMonthlyCost').textContent = money(accumulatedPeriodCost());

  renderRoom();
  createSimulationChart();
}

function setPlaybackButton(playing) {
  const button = document.querySelector('#playSimulation');
  button.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}" aria-hidden="true"></i><span>${playing ? 'พักจำลอง' : 'เล่นจำลอง'}</span>`;
  renderIcons(button);
}

function pauseSimulation() {
  if (simulationTimer) window.clearTimeout(simulationTimer);
  simulationTimer = null;
  const button = document.querySelector('#playSimulation');
  if (button) setPlaybackButton(false);
}

function playSimulation() {
  if (simulationTimer) {
    pauseSimulation();
    return;
  }
  simulationHour = normalizeSimulationHour(simulationHour);
  if (simulationRange === 'day' && isSimulationDayEnd()) simulationHour = 0;
  if (simulationRange !== 'day' && simulationDayIndex >= simulationPeriodDays() - 1) simulationDayIndex = 0;
  renderSimulationView();
  setPlaybackButton(true);
  const tick = () => {
    simulationTimer = null;
    const previousHour = simulationHour;
    const previousDayIndex = simulationDayIndex;
    if (simulationRange === 'day') {
      simulationHour = normalizeSimulationHour(simulationHour + 1);
    } else if (simulationDayIndex < simulationPeriodDays() - 1) {
      simulationDayIndex += 1;
    }
    renderSimulationView();
    logSimulationHour(previousHour, simulationHour, previousDayIndex, simulationDayIndex);
    const finished = simulationRange === 'day'
      ? isSimulationDayEnd()
      : simulationDayIndex >= simulationPeriodDays() - 1;
    if (finished) {
      pauseSimulation();
      return;
    }
    const speed = Number(document.querySelector('#simulationSpeed').value) || 1;
    simulationTimer = window.setTimeout(tick, 1000 / speed);
  };
  const speed = Number(document.querySelector('#simulationSpeed').value) || 1;
  simulationTimer = window.setTimeout(tick, 1000 / speed);
}

function resetSimulation() {
  pauseSimulation();
  simulationDayIndex = 0;
  simulationHour = 0;
  simulationOverrides.clear();
  renderSimulationView();
  showSimulationEvent('เริ่มช่วงจำลองใหม่จากวันแรก เวลา 00:00');
}

function renderInventory() {
  const totals = Object.fromEntries(order.map(type => [type, rooms.reduce((sum, room) => sum + quantity(room, type), 0)]));
  const body = document.querySelector('#inventoryRows');
  body.innerHTML = order.filter(type => totals[type]).map(type => {
    const locations = rooms.filter(room => quantity(room, type) > 0).map(room => room.name).join(' · ');
    return `<tr><td><span class="energy-category energy-category-${type}"><i class="energy-color-dot" aria-hidden="true"></i>${deviceInfo[type].name}</span></td><td><span class="qty-badge">${totals[type]} รายการ</span></td><td>${locations}</td><td>${energyModel[type].watts.toLocaleString('th-TH')} W</td></tr>`;
  }).join('');
}

function scheduleDescription(type) {
  if (selectedScenario === 'away') return type === 'fridge' ? 'ทำงานเป็นรอบตลอดวัน' : 'ปิดในรูปแบบไม่อยู่บ้าน';
  if (type === 'ac') return selectedScenario === 'weekday' ? 'ช่วงกลางคืน · ประมาณ 6 ชม./เครื่อง' : 'ช่วงกลางคืนและบ่าย · ประมาณ 6–8 ชม./เครื่อง';
  if (type === 'lights') return selectedScenario === 'weekday' ? 'ช่วงเช้าและเย็น · แตกต่างตามห้อง' : 'ช่วงสายและเย็น · แตกต่างตามห้อง';
  if (type === 'tv') return selectedScenario === 'weekday' ? 'ช่วงเย็น · 18:00–24:00' : 'ช่วงสายและเย็น';
  if (type === 'fridge') return `เฉลี่ย ${(energyModel.fridge.dutyCycle * 100).toFixed(0)}% ของกำลังไฟตลอดวัน`;
  return '3,500 W · ใช้ 15 นาที/วัน/เครื่อง';
}

function renderEnergy() {
  const energyTotals = order.map(type => ({
    type,
    quantity: rooms.reduce((sum, room) => sum + (isOn(room.id, type) ? quantity(room, type) : 0), 0),
    kwh: estimateForScope(rooms, type)
  })).filter(item => item.quantity > 0);
  const total = energyTotals.reduce((sum, item) => sum + item.kwh, 0);
  document.querySelector('#energyTotal').textContent = total.toFixed(1);
  document.querySelector('#energyDaily').textContent = (total / 30).toFixed(1);
  renderBillEstimate(total);
  document.querySelector('#energyRows').innerHTML = energyTotals.map(item => {
    const model = energyModel[item.type];
    return `<tr><td><span class="energy-category energy-category-${item.type}"><i class="energy-color-dot" aria-hidden="true"></i>${deviceInfo[item.type].name}</span></td><td>${item.quantity}</td><td>${model.watts.toLocaleString('th-TH')} W</td><td>${scheduleDescription(item.type)}</td><td><strong>${item.kwh.toFixed(1)}</strong></td></tr>`;
  }).join('');
  renderEnergyChart(energyTotals);
}

function energyChargeByTiers(units, rateType) {
  const tiers = rateType === 'lowUse'
    ? [{ limit: 15, rate: 2.3488 }, { limit: 10, rate: 2.9882 }, { limit: 175, rate: 3 }, { limit: 200, rate: 4.1584 }, { limit: Infinity, rate: 4.3583 }]
    : [{ limit: 200, rate: 3 }, { limit: 200, rate: 4.1584 }, { limit: Infinity, rate: 4.3583 }];
  let remaining = Math.max(0, units);
  let charge = 0;
  tiers.forEach(tier => {
    const chargedUnits = Math.min(remaining, tier.limit);
    charge += chargedUnits * tier.rate;
    remaining -= chargedUnits;
  });
  return charge;
}

function money(value) {
  return value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function billEstimate(units) {
  const rateType = document.querySelector('#billRateType').value;
  const ftRate = Number(document.querySelector('#billFtRate').value);
  const safeFtRate = Number.isFinite(ftRate) ? ftRate : defaultFtRate;
  const energyCharge = energyChargeByTiers(units, rateType);
  const ftCharge = units * safeFtRate;
  const serviceCharge = monthlyServiceCharges[rateType];
  const beforeVat = energyCharge + ftCharge + serviceCharge;
  const vat = beforeVat * 0.07;
  const total = beforeVat + vat;
  const rateLabel = rateType === 'lowUse' ? 'PEA 1.1.1 · ใช้ไม่เกิน 150 หน่วย' : 'PEA 1.1.2 · ใช้เกิน 150 หน่วย';

  return { rateType, safeFtRate, energyCharge, ftCharge, serviceCharge, vat, total, rateLabel };
}

function renderBillEstimate(units) {
  const estimate = billEstimate(units);

  document.querySelector('#billEstimatedUnits').textContent = units.toFixed(1);
  document.querySelector('#billRateLabel').textContent = estimate.rateLabel;
  document.querySelector('#billEnergyCharge').textContent = money(estimate.energyCharge);
  document.querySelector('#billFtCharge').textContent = money(estimate.ftCharge);
  document.querySelector('#billServiceCharge').textContent = money(estimate.serviceCharge);
  document.querySelector('#billVatCharge').textContent = money(estimate.vat);
  document.querySelector('#billEstimatedTotal').textContent = money(estimate.total);
  document.querySelector('#billFtPeriod').textContent = `Ft ${estimate.safeFtRate.toFixed(4)} บาท/หน่วย`;
}

function readMonthlyHistory() {
  try {
    const saved = JSON.parse(readStoredValue(monthlyHistoryStorageKey) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(item => item && typeof item.month === 'string'
      && typeof item.scenario === 'string'
      && Number.isFinite(Number(item.kwh))
      && Number.isFinite(Number(item.cost))
      && typeof item.through === 'string')
      .map((item, index) => ({
        ...item,
        id: String(item.id || item.savedAt || `${item.month}-${item.scenario}-${item.through}-${index}`)
      }));
  } catch (error) {
    warnStorageFallback(monthlyHistoryStorageKey, error);
    return [];
  }
}

function renderMonthlyHistory() {
  const records = readMonthlyHistory();
  const rows = document.querySelector('#monthlyHistoryRows');
  document.querySelector('#monthlyHistoryCount').textContent = `${records.length} รายการ`;
  document.querySelector('#clearMonthlyHistory').disabled = records.length === 0;
  if (!records.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'history-empty';
    cell.textContent = 'ยังไม่มีประวัติ เลือกช่วง “รายเดือน” แล้วกดบันทึกผล';
    row.append(cell);
    rows.replaceChildren(row);
    return;
  }

  rows.replaceChildren(...records.map(record => {
    const row = document.createElement('tr');
    [record.month, record.scenario, `${Number(record.kwh).toFixed(2)} kWh`, `${money(Number(record.cost))} บาท`, record.through].forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    const actionCell = document.createElement('td');
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'history-delete-button';
    deleteButton.dataset.deleteHistory = record.id;
    deleteButton.setAttribute('aria-label', `ลบประวัติ ${record.month} โหมด${record.scenario}`);
    deleteButton.title = 'ลบรายการนี้';
    deleteButton.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i><span>ลบ</span>';
    actionCell.append(deleteButton);
    row.append(actionCell);
    return row;
  }));
  renderIcons(rows);
}

function deleteMonthlyHistoryRecord(id) {
  const records = readMonthlyHistory();
  const record = records.find(item => item.id === id);
  if (!record || !window.confirm(`ลบประวัติ ${record.month} โหมด${record.scenario} ใช่ไหม?`)) return;
  const remaining = records.filter(item => item.id !== id);
  const persisted = writeStoredValue(monthlyHistoryStorageKey, JSON.stringify(remaining));
  renderMonthlyHistory();
  showToast(persisted ? 'ลบรายการออกจากประวัติแล้ว' : 'ลบรายการชั่วคราวแล้ว แต่การเปลี่ยนแปลงอาจไม่อยู่หลังปิดเว็บ', !persisted);
}

function clearMonthlyHistory() {
  if (!readMonthlyHistory().length) return;
  if (!window.confirm('ลบประวัติผลจำลองรายเดือนทั้งหมดใช่ไหม? การลบนี้ย้อนกลับไม่ได้')) return;
  const persisted = writeStoredValue(monthlyHistoryStorageKey, '[]');
  renderMonthlyHistory();
  showToast(persisted ? 'ล้างประวัติรายเดือนทั้งหมดแล้ว' : 'ล้างประวัติชั่วคราวแล้ว แต่การเปลี่ยนแปลงอาจไม่อยู่หลังปิดเว็บ', !persisted);
}

function showToast(message, isError = false) {
  const toast = document.querySelector('#appToast');
  toast.textContent = message;
  toast.classList.toggle('toast-error', isError);
  toast.classList.add('toast-visible');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('toast-visible');
    toastTimer = null;
  }, 2600);
}

function setSaveButtonFeedback(persisted) {
  const button = document.querySelector('#saveMonthlyResult');
  button.classList.toggle('is-saved', persisted);
  button.innerHTML = `<i data-lucide="${persisted ? 'check' : 'save'}" aria-hidden="true"></i><span>${persisted ? 'บันทึกเรียบร้อย!' : 'บันทึกชั่วคราวแล้ว'}</span>`;
  renderIcons(button);
  if (saveFeedbackTimer) window.clearTimeout(saveFeedbackTimer);
  saveFeedbackTimer = window.setTimeout(() => {
    button.classList.remove('is-saved');
    button.innerHTML = '<i data-lucide="save" aria-hidden="true"></i><span>บันทึกผลประจำเดือน</span>';
    renderIcons(button);
    saveFeedbackTimer = null;
  }, 2200);
}

function saveMonthlyResult() {
  if (simulationRange !== 'month') return;
  const date = currentSimulationDate();
  const month = formatSimulationDate(date, { month: 'long', year: 'numeric' });
  const through = `${formatSimulationDate(date, { day: 'numeric', month: 'short' })} · ${String(simulationHour).padStart(2, '0')}:00`;
  const record = {
    id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    month,
    scenario: scenarioNames[selectedScenario],
    kwh: Number(accumulatedPeriodKwh().toFixed(2)),
    cost: Number(accumulatedPeriodCost().toFixed(2)),
    through,
    savedAt: new Date().toISOString()
  };
  const records = [record, ...readMonthlyHistory()].slice(0, 36);
  const persisted = writeStoredValue(monthlyHistoryStorageKey, JSON.stringify(records));
  renderMonthlyHistory();
  document.querySelector('#historySaveStatus').textContent = persisted
    ? `บันทึก ${month} แล้ว · สะสมถึง ${through}`
    : 'บันทึกไว้ชั่วคราว แต่เบราว์เซอร์ไม่อนุญาตให้เก็บข้ามการปิดเว็บ';
  setSaveButtonFeedback(persisted);
  showToast(persisted ? `บันทึกผล ${month} ลงในประวัติแล้ว` : 'ข้อมูลบันทึกชั่วคราวเท่านั้น อาจหายเมื่อปิดเว็บ', !persisted);
}

function restoreBillSettings() {
  try {
    const saved = JSON.parse(readStoredValue(billSettingsStorageKey) || '{}');
    if (['lowUse', 'regular'].includes(saved.rateType)) document.querySelector('#billRateType').value = saved.rateType;
    if (Number.isFinite(Number(saved.ftRate))) document.querySelector('#billFtRate').value = saved.ftRate;
  } catch (error) {
    warnStorageFallback(billSettingsStorageKey, error);
    /* ใช้ค่าเริ่มต้นเมื่ออ่านการตั้งค่าที่บันทึกไว้ไม่ได้ */
  }
}

function saveBillSettings() {
  const settings = {
    rateType: document.querySelector('#billRateType').value,
    ftRate: Number(document.querySelector('#billFtRate').value)
  };
  writeStoredValue(billSettingsStorageKey, JSON.stringify(settings));
}

function renderEnergyChart(energyTotals) {
  const canvas = document.querySelector('#energyChart');
  const fallback = document.querySelector('#energyChartFallback');
  if (!canvas || typeof Chart === 'undefined') {
    if (fallback) fallback.hidden = false;
    if (canvas) canvas.hidden = true;
    return;
  }
  const labels = energyTotals.map(item => deviceInfo[item.type].name);
  const values = energyTotals.map(item => Number(item.kwh.toFixed(1)));
  if (energyChart) {
    energyChart.data.labels = labels;
    energyChart.data.datasets[0].data = values;
    energyChart.data.datasets[0].backgroundColor = energyTotals.map(item => devicePalette[item.type].chart);
    energyChart.update('none');
    if (fallback) fallback.hidden = true;
    canvas.hidden = false;
    return;
  }

  try {
    energyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'ประมาณการใช้ไฟ',
        data: values,
        backgroundColor: energyTotals.map(item => devicePalette[item.type].chart),
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 30
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => ` ${context.parsed.x.toLocaleString('th-TH')} kWh/เดือน (ประมาณ)`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          title: { display: true, text: 'พลังงานไฟฟ้า (kWh/เดือน)', color: '#aab7ae' },
          grid: { color: 'rgba(163, 184, 169, .12)' },
          ticks: { color: '#aab7ae' }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#dce6df' }
        }
      }
    }
    });
    canvas.hidden = false;
    if (fallback) fallback.hidden = true;
  } catch {
    canvas.hidden = true;
    if (fallback) fallback.hidden = false;
  }
}

let planZoomFrame = 0;
let isPlanZoomed = false;
const fullPlanViewBox = [0, 0, 1115, 1285];

function setPlanViewBox(roomId) {
  const object = document.querySelector('#floorPlan');
  const svg = object?.contentDocument?.documentElement;
  if (!svg) return;

  let target = fullPlanViewBox;
  if (roomId !== 'all') {
    const zone = svg.querySelector(`[data-room="${roomId}"] .zone`);
    const bounds = zone?.getBBox();
    if (bounds && bounds.width && bounds.height) {
      // Keep the original plan proportions while framing the selected room.
      const aspect = fullPlanViewBox[2] / fullPlanViewBox[3];
      const viewWidth = Math.min(fullPlanViewBox[2], Math.max(bounds.width * 1.65, bounds.height * 1.65 * aspect));
      const viewHeight = viewWidth / aspect;
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      target = [centerX - viewWidth / 2, centerY - viewHeight / 2, viewWidth, viewHeight];
    }
  }

  const current = (svg.getAttribute('viewBox') || fullPlanViewBox.join(' ')).trim().split(/[ ,]+/).map(Number);
  cancelAnimationFrame(planZoomFrame);
  const started = performance.now();
  const duration = 360;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const step = now => {
    const progress = Math.min(1, (now - started) / duration);
    const amount = ease(progress);
    const viewBox = current.map((value, index) => value + (target[index] - value) * amount);
    svg.setAttribute('viewBox', viewBox.join(' '));
    if (progress < 1) planZoomFrame = requestAnimationFrame(step);
  };
  planZoomFrame = requestAnimationFrame(step);
}

function setSelection(roomId) {
  if (roomId !== 'all' && roomId === selectedRoom) {
    isPlanZoomed = !isPlanZoomed;
    setPlanViewBox(isPlanZoomed ? roomId : 'all');
    return;
  }

  selectedRoom = roomId;
  isPlanZoomed = roomId !== 'all';
  renderRoom();
  const object = document.querySelector('#floorPlan');
  const doc = object?.contentDocument;
  doc?.querySelectorAll('[data-room]').forEach(node => {
    const selected = roomId !== 'all' && node.getAttribute('data-room') === roomId;
    node.classList.toggle('selected', selected);
    node.setAttribute('aria-pressed', String(selected));
  });
  setPlanViewBox(isPlanZoomed ? roomId : 'all');
}

function connectPlan() {
  const object = document.querySelector('#floorPlan');
  const doc = object?.contentDocument;
  if (!doc) return;
  doc.querySelectorAll('[data-room]').forEach(node => {
    node.addEventListener('click', () => setSelection(node.getAttribute('data-room')));
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setSelection(node.getAttribute('data-room'));
      }
    });
  });
  setSelection(selectedRoom);
}

function setupSectionNavigation() {
  const links = [...document.querySelectorAll('.main-nav .nav-item')];
  const sections = links.map(link => ({ link, section: document.querySelector(link.getAttribute('href')) })).filter(item => item.section);
  const markActive = link => {
    if (!link) return;
    links.forEach(item => {
      const active = item === link;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'location');
      else item.removeAttribute('aria-current');
    });
  };

  links.forEach(link => link.addEventListener('click', () => markActive(link)));
  if (!('IntersectionObserver' in window)) return;

  const visibleSections = new Map();
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) visibleSections.set(entry.target, entry);
      else visibleSections.delete(entry.target);
    });
    const center = window.innerHeight * 0.35;
    const current = [...visibleSections.values()]
      .sort((a, b) => Math.abs(a.boundingClientRect.top - center) - Math.abs(b.boundingClientRect.top - center))[0];
    if (current) markActive(sections.find(item => item.section === current.target)?.link);
  }, { rootMargin: '-20% 0px -65% 0px' });

  sections.forEach(({ section }) => observer.observe(section));
}

document.addEventListener('click', event => {
  const toggle = event.target.closest('[data-toggle-type]');
  if (toggle) {
    const type = toggle.dataset.toggleType;
    const targets = toggle.dataset.toggleRoom === 'all'
    ? rooms.filter(room => quantity(room, type) > 0)
    : [roomById(toggle.dataset.toggleRoom)].filter(Boolean);
    const turnOn = !targets.every(room => isOn(room.id, type));
    targets.forEach(room => { status[keyFor(room.id, type)] = turnOn; });
    const targetName = targets.length === 1 ? targets[0].name : 'ทุกพื้นที่';
    saveStatus();
    renderEnergy();
    renderSimulationView();
    showSimulationEvent(`${turnOn ? 'นำเข้า' : 'นำออกจาก'}แบบจำลอง · ${deviceInfo[type].name} · ${targetName}`);
    logSimulationHour(-1, simulationHour);
    return;
  }
  const scenarioButton = event.target.closest('[data-scenario]');
  if (scenarioButton) {
    applyScenario(scenarioButton.dataset.scenario);
    return;
  }
  if (event.target.closest('#simulateMotion')) {
    simulateSensor('motion');
    return;
  }
  if (event.target.closest('#simulateHeat')) {
    simulateSensor('heat');
    return;
  }
  if (event.target.closest('#playSimulation')) {
    playSimulation();
    return;
  }
  if (event.target.closest('#resetSimulation')) {
    resetSimulation();
    return;
  }
  if (event.target.closest('#showAllRooms')) setSelection('all');
  if (event.target.closest('#resetDemo')) {
    status = {};
    saveStatus();
    selectedScenario = 'weekday';
    saveSelectedScenario();
    simulationOverrides.clear();
    pauseSimulation();
    simulationDayIndex = 0;
    simulationHour = 0;
    renderEnergy();
    renderScenarioState();
    renderSimulationView();
    showSimulationEvent('คืนค่าสถานะอุปกรณ์เริ่มต้นแล้ว');
    logSimulationHour(-1, simulationHour);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  setupSectionNavigation();
  renderIcons();
  restoreBillSettings();
  renderMetrics();
  selectedScenario = loadSelectedScenario();
  simulationRange = readSimulationRange();
  document.querySelector('#simulationRange').value = simulationRange;
  renderRoom();
  renderInventory();
  renderEnergy();
  renderMonthlyHistory();
  renderScenarioState();
  renderSimulationView();
  document.querySelectorAll('.weather-button').forEach(button => {
    button.addEventListener('click', () => selectWeather(button.dataset.weather));
  });
  document.querySelector('#simulationTime').addEventListener('input', event => {
    pauseSimulation();
    const previousHour = simulationHour;
    simulationHour = normalizeSimulationHour(event.target.value);
    renderSimulationView();
    logSimulationHour(previousHour, simulationHour);
  });
  document.querySelector('#simulationDay').addEventListener('input', event => {
    pauseSimulation();
    const previousDayIndex = simulationDayIndex;
    simulationDayIndex = Number(event.target.value);
    renderSimulationView();
    showSimulationEvent(`เลื่อนไปวันที่ ${simulationDayIndex + 1}`);
    logSimulationHour(simulationHour, simulationHour, previousDayIndex, simulationDayIndex);
  });
  document.querySelector('#simulationRange').addEventListener('change', event => {
    pauseSimulation();
    simulationRange = ['day', 'month', 'year'].includes(event.target.value) ? event.target.value : 'day';
    simulationDayIndex = 0;
    simulationHour = 0;
    simulationOverrides.clear();
    writeStoredValue(rangeStorageKey, simulationRange);
    renderSimulationView();
    showSimulationEvent(`เปลี่ยนช่วงจำลองเป็น${simulationRange === 'day' ? 'รายวัน' : simulationRange === 'month' ? 'รายเดือน' : 'รายปี'}`);
    logSimulationHour(-1, simulationHour);
  });
  document.querySelector('#saveMonthlyResult').addEventListener('click', saveMonthlyResult);
  document.querySelector('#clearMonthlyHistory').addEventListener('click', clearMonthlyHistory);
  document.querySelector('#monthlyHistoryRows').addEventListener('click', event => {
    const deleteButton = event.target.closest('[data-delete-history]');
    if (deleteButton) deleteMonthlyHistoryRecord(deleteButton.dataset.deleteHistory);
  });
  document.querySelector('#simulationSpeed').addEventListener('change', () => {
    if (simulationTimer) {
      pauseSimulation();
      playSimulation();
    }
  });
  loadOptionalLibrary('https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js', () => {
    renderEnergy();
    renderSimulationView();
  });
  loadOptionalLibrary('https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js', () => renderIcons());
  showSimulationEvent('ระบบจำลองพร้อม · เลือกเวลาเพื่อเริ่มบันทึกเหตุการณ์');
  logSimulationHour(-1, simulationHour);
  document.querySelector('#billRateType').addEventListener('change', () => {
    saveBillSettings();
    renderBillEstimate(Number(document.querySelector('#energyTotal').textContent) || 0);
    renderSimulationView();
  });
  document.querySelector('#billFtRate').addEventListener('input', () => {
    saveBillSettings();
    renderBillEstimate(Number(document.querySelector('#energyTotal').textContent) || 0);
    renderSimulationView();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseSimulation();
  });
  const plan = document.querySelector('#floorPlan');
  plan.addEventListener('load', connectPlan);
  if (plan.contentDocument?.readyState === 'complete') connectPlan();
});


