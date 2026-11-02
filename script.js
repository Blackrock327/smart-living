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
const defaultFtRate = 0.1623;
const monthlyServiceCharges = { lowUse: 8.19, regular: 24.62 };
let energyChart = null;
let simulationChart = null;
let selectedRoom = 'all';
let status = readStatus();
let selectedScenario = 'weekday';
let simulationRange = 'day';
let simulationDayIndex = 0;
let simulationHour = 0;
let simulationTimer = null;
let timelineTickSignature = '';
const simulationOverrides = new Set();

function readStatus() {
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); }
  catch { return {}; }
}

function readSimulationRange() {
  try {
    const saved = localStorage.getItem(rangeStorageKey);
    return ['day', 'month', 'year'].includes(saved) ? saved : 'day';
  } catch {
    return 'day';
  }
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
  try { localStorage.setItem(storageKey, JSON.stringify(status)); } catch { /* ใช้ต่อได้แม้เบราว์เซอร์ปิด local storage */ }
}

function quantity(room, type) { return Number(room.devices[type] || 0); }
function roomTotal(room) { return order.reduce((sum, type) => sum + quantity(room, type), 0); }
function keyFor(roomId, type) { return `${roomId}:${type}`; }
function isOn(roomId, type) { return status[keyFor(roomId, type)] !== false; }
function roomById(id) { return rooms.find(room => room.id === id); }

const scenarioNames = { weekday: 'วันธรรมดา', weekend: 'วันหยุด', away: 'ไม่อยู่บ้าน' };
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
  if (hour < 0 || hour >= 24) return 0;
  const safeHour = Math.max(0, Math.min(23, Math.floor(hour)));
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

function hourlySimulation(profile = selectedScenario, includeOverrides = true, dayIndex = simulationDayIndex) {
  return Array.from({ length: 24 }, (_, hour) => {
    const watts = rooms.reduce((sum, room) => sum + order.reduce((roomSum, type) => {
      return roomSum + energyModel[type].watts * quantity(room, type) * deviceScheduleFraction(room, type, hour, profile, includeOverrides, dayIndex);
    }, 0), 0);
    return { hour, watts, kwh: watts / 1000 };
  });
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
    const active = order.reduce((sum, type) => sum + (deviceScheduleFraction(room, type, simulationHour) > 0 ? quantity(room, type) : 0), 0);
    marker.classList.toggle('all-off', active === 0);
    marker.querySelector('.state-marker-text').textContent = active ? `ON ${active}/${total}` : 'OFF';
    marker.setAttribute('aria-label', `${room.name}: เปิด ${active} จาก ${total} อุปกรณ์`);
  });
}

function renderIcons(root = document) {
  if (window.lucide?.createIcons) {
    root.querySelectorAll?.('[data-lucide].icon-fallback').forEach(node => {
      node.classList.remove('icon-fallback');
      node.textContent = '';
    });
    window.lucide.createIcons({ root, attrs: { 'stroke-width': 1.8 } });
    return;
  }

  const glyphs = {
    activity: '⌁', cpu: '▦', ellipsis: '⋯', 'file-spreadsheet': '▤', house: '⌂',
    info: 'i', 'layout-dashboard': '▦', lightbulb: '◉', map: '⌖', 'map-pin': '⌖',
    'maximize-2': '⛶', 'panels-top-left': '▣', plug: '↯', 'rotate-ccw': '↶',
    'door-open': '⇥', moon: '☾', sun: '☼', 'scan-eye': '◉', thermometer: '♨', workflow: '⌘',
    'chart-no-axes-combined': '▥', 'calendar-days': '▦', play: '▶', pause: 'Ⅱ',
    wind: '≋', zap: 'ϟ', bed: '▰', sofa: '▰', tv: '▣', refrigerator: '▤', flame: '♨'
  };
  root.querySelectorAll?.('[data-lucide]').forEach(node => {
    node.classList.add('icon-fallback');
    node.textContent = glyphs[node.dataset.lucide] || '•';
  });
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
  const dailyUnits = Array.from({ length: 24 }, (_, hour) => deviceScheduleFraction(room, type, hour, selectedScenario, false))
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
  document.querySelector('#roomNumber').textContent = room ? `ZONE 0${rooms.indexOf(room) + 1}` : 'ALL';
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
    const activeQty = matchingRooms.reduce((sum, item) => sum + (deviceScheduleFraction(item, type, simulationHour) > 0 ? quantity(item, type) : 0), 0);
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
  try {
    const saved = localStorage.getItem(scenarioStorageKey);
    return Object.hasOwn(scenarioNames, saved) ? saved : 'weekday';
  } catch {
    return 'weekday';
  }
}

function saveSelectedScenario() {
  try { localStorage.setItem(scenarioStorageKey, selectedScenario); } catch { /* การจำลองยังทำงานได้หากบันทึกไม่ได้ */ }
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
  const time = `${String(simulationHour).padStart(2, '0')}:00`;
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
  const previous = previousHour < 24 ? previousHour : -1;
  const current = currentHour < 24 ? currentHour : -1;
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
      activeIndex: simulationHour < 24 ? simulationHour : -1,
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
  if (simulationHour >= 24) {
    showSimulationEvent('สิ้นสุดวันจำลองแล้ว กดเริ่มใหม่ก่อนทดลองเหตุการณ์');
    return;
  }
  if (selectedScenario === 'away') {
    showSimulationEvent('ตรวจพบเหตุการณ์ แต่รูปแบบไม่อยู่บ้านปิดอุปกรณ์ที่ไม่จำเป็น');
    return;
  }

  const hour = Math.min(simulationHour, 23);
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
  return hourlySimulation().slice(0, Math.min(simulationHour, 24)).reduce((sum, item) => sum + item.kwh, 0);
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
    ? 'ค่าไฟคาดการณ์ 30 วัน'
    : simulationRange === 'month' ? 'ค่าไฟคาดการณ์ทั้งเดือน' : 'ค่าไฟคาดการณ์ทั้งปี';
  document.querySelector('#simulationFootnote').textContent = simulationRange === 'day'
    ? 'รายวัน: 1 วินาที = 1 ชั่วโมงจำลอง · ค่าประมาณยึดตารางของรูปแบบที่เลือก'
    : 'รายเดือน/รายปี: 1 วินาที = 1 วันจำลอง · ใช้รูปแบบการใช้ไฟที่เลือกซ้ำในแต่ละวัน';
}

function renderSimulationView() {
  const hourly = hourlySimulation();
  const hour = Math.min(simulationHour, 23);
  const currentWatts = simulationHour < 24 ? hourly[hour].watts : 0;
  const accumulated = accumulatedPeriodKwh();
  const projectedKwh = projectedPeriodKwh();
  renderPeriodControls();

  document.querySelector('#simulationClock').textContent = `${String(simulationHour).padStart(2, '0')}:00`;
  document.querySelector('#simulationTime').value = simulationHour;
  document.querySelector('#simulationPower').textContent = (currentWatts / 1000).toFixed(2);
  document.querySelector('#simulationAccumulated').textContent = accumulated.toFixed(2);
  document.querySelector('#simulationDailyTotal').textContent = projectedKwh.toFixed(2);
  document.querySelector('#simulationMonthlyCost').textContent = money(projectedPeriodCost());

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
  if (simulationRange === 'day' && simulationHour >= 24) simulationHour = 0;
  if (simulationRange !== 'day' && simulationDayIndex >= simulationPeriodDays() - 1) simulationDayIndex = 0;
  renderSimulationView();
  setPlaybackButton(true);
  const tick = () => {
    simulationTimer = null;
    const previousHour = simulationHour;
    const previousDayIndex = simulationDayIndex;
    if (simulationRange === 'day') {
      simulationHour = Math.min(24, simulationHour + 1);
    } else if (simulationDayIndex < simulationPeriodDays() - 1) {
      simulationDayIndex += 1;
    }
    renderSimulationView();
    logSimulationHour(previousHour, simulationHour, previousDayIndex, simulationDayIndex);
    const finished = simulationRange === 'day'
      ? simulationHour >= 24
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

function restoreBillSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(billSettingsStorageKey) || '{}');
    if (['lowUse', 'regular'].includes(saved.rateType)) document.querySelector('#billRateType').value = saved.rateType;
    if (Number.isFinite(Number(saved.ftRate))) document.querySelector('#billFtRate').value = saved.ftRate;
  } catch { /* ใช้ค่าเริ่มต้นเมื่ออ่านการตั้งค่าที่บันทึกไว้ไม่ได้ */ }
}

function saveBillSettings() {
  const settings = {
    rateType: document.querySelector('#billRateType').value,
    ftRate: Number(document.querySelector('#billFtRate').value)
  };
  try { localStorage.setItem(billSettingsStorageKey, JSON.stringify(settings)); } catch { /* การคำนวณยังทำงานได้หากบันทึกไม่ได้ */ }
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
  renderScenarioState();
  renderSimulationView();
  document.querySelector('#simulationTime').addEventListener('input', event => {
    pauseSimulation();
    const previousHour = simulationHour;
    simulationHour = Number(event.target.value);
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
    try { localStorage.setItem(rangeStorageKey, simulationRange); } catch { /* การจำลองทำงานต่อได้หากบันทึกไม่ได้ */ }
    renderSimulationView();
    showSimulationEvent(`เปลี่ยนช่วงจำลองเป็น${simulationRange === 'day' ? 'รายวัน' : simulationRange === 'month' ? 'รายเดือน' : 'รายปี'}`);
    logSimulationHour(-1, simulationHour);
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


