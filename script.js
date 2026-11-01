// ข้อมูลจำนวนอุปกรณ์ถอดจากตาราง XLSX ที่ผู้ใช้แนบมา ไม่ใช่ข้อมูลวัตต์หรือ kWh
const rooms = [
  { id: 'bedroom1', name: 'ห้องนอน 1', kind: 'bedroom', devices: { ac: 1, lights: 1 } },
  { id: 'bedroom2', name: 'ห้องนอน 2', kind: 'bedroom', devices: { ac: 1, lights: 1 } },
  { id: 'bedroom3', name: 'ห้องนอน 3', kind: 'bedroom', devices: { ac: 1, lights: 1 } },
  { id: 'bathroom1', name: 'ห้องน้ำ 1', kind: 'service', devices: { lights: 1, washer: 1 } },
  { id: 'bathroom2', name: 'ห้องน้ำ 2', kind: 'service', devices: { lights: 1, washer: 1 } },
  { id: 'kitchen', name: 'ห้องครัว', kind: 'service', devices: { lights: 2, fridge: 1 } },
  { id: 'living', name: 'ห้องโถง / นั่งเล่น', kind: 'common', devices: { lights: 6, tv: 1 } }
];

const deviceInfo = {
  ac: { name: 'เครื่องปรับอากาศ', short: 'แอร์', icon: 'wind' },
  lights: { name: 'หลอดไฟ', short: 'ไฟ', icon: 'lightbulb' },
  tv: { name: 'โทรทัศน์', short: 'ทีวี', icon: 'tv' },
  fridge: { name: 'ตู้เย็น', short: 'ตู้เย็น', icon: 'refrigerator' },
  washer: { name: 'เครื่องซักผ้า', short: 'เครื่องซักผ้า', icon: 'washing-machine' }
};

const order = ['ac', 'lights', 'tv', 'fridge', 'washer'];
const devicePalette = {
  ac: { chart: '#86b894' },
  lights: { chart: '#e5b65d' },
  tv: { chart: '#83a9d1' },
  fridge: { chart: '#b6a1d2' },
  washer: { chart: '#6db8b0' }
};

// ค่าตั้งต้นตัวอย่าง ไม่ใช่สเปกของรุ่นจริง (แก้ได้ที่ watts และการใช้งานด้านล่าง)
const energyModel = {
  ac: { watts: 1200, hoursPerDay: 6, usage: '6 ชม./วัน/เครื่อง' },
  lights: { watts: 9, hoursPerDay: 5, usage: '5 ชม./วัน/ดวง' },
  tv: { watts: 81, hoursPerDay: 5.8, usage: '5.8 ชม./วัน' },
  fridge: { watts: 100, hoursPerDay: 24, usage: '24 ชม./วัน (ค่าเฉลี่ยโดยประมาณ)' },
  washer: { watts: 500, hoursPerCycle: 1, cyclesPerMonthPerUnit: 8, usage: '1 ชม./รอบ · 8 รอบ/เดือน/เครื่อง' }
};
const storageKey = 'smartliving-blueprint-device-status-v1';
const liveEnergyStorageKey = 'smartliving-blueprint-live-energy-v1';
const billSettingsStorageKey = 'smartliving-blueprint-bill-settings-v1';
const scenarioStorageKey = 'smartliving-blueprint-scenario-v1';
const defaultFtRate = 0.1623;
const monthlyServiceCharges = { lowUse: 8.19, regular: 24.62 };
let energyChart = null;
let liveEnergyChart = null;
let selectedRoom = 'all';
let status = readStatus();
let liveEnergyState = null;
let lastLiveTick = Date.now();
let lastLiveChartUpdate = 0;
let lastLiveSave = 0;

function readStatus() {
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); }
  catch { return {}; }
}

function saveStatus() {
  try { localStorage.setItem(storageKey, JSON.stringify(status)); } catch { /* ใช้ต่อได้แม้เบราว์เซอร์ปิด local storage */ }
}

function quantity(room, type) { return Number(room.devices[type] || 0); }
function roomTotal(room) { return order.reduce((sum, type) => sum + quantity(room, type), 0); }
function keyFor(roomId, type) { return `${roomId}:${type}`; }
function isOn(roomId, type) { return status[keyFor(roomId, type)] !== false; }
function roomById(id) { return rooms.find(room => room.id === id); }

function updatePlanDeviceMarkers() {
  const doc = document.querySelector('#floorPlan')?.contentDocument;
  if (!doc) return;
  doc.querySelectorAll('[data-room-status]').forEach(marker => {
    const room = roomById(marker.getAttribute('data-room-status'));
    if (!room) return;
    const total = roomTotal(room);
    const active = order.reduce((sum, type) => sum + (isOn(room.id, type) ? quantity(room, type) : 0), 0);
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
    'door-open': '⇥', moon: '☾', 'scan-eye': '◉', thermometer: '♨', workflow: '⌘',
    wind: '≋', zap: 'ϟ', bed: '▰', sofa: '▰', tv: '▣', refrigerator: '▤',
    'washing-machine': '◉'
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
  const count = isOn(room.id, type) ? quantity(room, type) : 0;
  if (type === 'washer') return model.watts * model.hoursPerCycle * model.cyclesPerMonthPerUnit * count / 1000;
  return model.watts * model.hoursPerDay * 30 * count / 1000;
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
    const stateText = allOn ? 'เปิด' : anyOn ? 'เปิดบางส่วน' : 'ปิด';
    const scopeName = room ? room.name : `${matchingRooms.length} พื้นที่`;
    const row = document.createElement('div');
    row.className = 'device-row';
    const ariaState = allOn ? 'true' : anyOn ? 'mixed' : 'false';
    row.innerHTML = `<div class="device-info device-info-${type}"><span class="device-icon device-icon-${type}" aria-hidden="true"><i data-lucide="${info.icon}"></i></span><span><b>${info.name}</b><small>${scopeName} · ${stateText} · ~${estimateForScope(scope, type).toFixed(1)} kWh/เดือน</small></span></div><div class="device-action"><span class="device-qty">${qty}</span><button class="toggle" type="button" role="switch" aria-checked="${ariaState}" aria-label="${allOn ? 'ปิด' : 'เปิด'}${info.name}${isGroup ? 'ทุกพื้นที่' : ''}" data-toggle-type="${type}" data-toggle-room="${room ? room.id : 'all'}"></button></div>`;
    container.append(row);
  });
  renderIcons(container);
  renderIcons(document.querySelector('#roomIcon'));
  updatePlanDeviceMarkers();
}

const scenarioNames = {
  home: 'อยู่บ้าน',
  away: 'ออกจากบ้าน',
  night: 'กลางคืน',
  custom: 'ปรับอุปกรณ์เอง'
};
let selectedScenario = 'custom';

function loadSelectedScenario() {
  try {
    const saved = localStorage.getItem(scenarioStorageKey);
    return Object.hasOwn(scenarioNames, saved) ? saved : 'custom';
  } catch {
    return 'custom';
  }
}

function saveSelectedScenario() {
  try { localStorage.setItem(scenarioStorageKey, selectedScenario); } catch { /* การจำลองยังทำงานได้หากบันทึกไม่ได้ */ }
}

function renderScenarioState() {
  document.querySelector('#activeScenarioLabel').textContent = scenarioNames[selectedScenario];
  document.querySelectorAll('[data-scenario]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === selectedScenario));
  });
}

function showSimulationEvent(message) {
  document.querySelector('#simulationLog').textContent = `${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · ${message}`;
}

function refreshSimulationView() {
  saveStatus();
  renderRoom();
  renderEnergy();
  updateLiveEnergy();
  renderScenarioState();
}

function applyScenario(scenario) {
  selectedScenario = scenario;
  saveSelectedScenario();
  rooms.forEach(room => {
    order.forEach(type => {
      if (!quantity(room, type)) return;
      let isEnabled = true;
      if (scenario === 'away') isEnabled = type === 'fridge';
      if (scenario === 'home') {
        isEnabled = type === 'fridge'
          || type === 'tv'
          || (type === 'ac' && room.id === 'bedroom1')
          || (type === 'lights' && room.id === 'kitchen');
      }
      if (scenario === 'night') {
        isEnabled = type === 'fridge'
          || (type === 'ac' && ['bedroom1', 'bedroom2'].includes(room.id))
          || (type === 'lights' && ['bedroom1', 'bedroom2'].includes(room.id));
      }
      status[keyFor(room.id, type)] = isEnabled;
    });
  });
  refreshSimulationView();
  showSimulationEvent(`ใช้สถานการณ์ “${scenarioNames[scenario]}” แล้ว สถานะอุปกรณ์และพลังงานถูกปรับตามฉาก`);
}

function simulateSensor(sensor) {
  if (selectedScenario === 'away') {
    showSimulationEvent('ตรวจพบเหตุการณ์ แต่เงื่อนไขโหมดออกจากบ้านไม่อนุญาตให้เปิดอุปกรณ์');
    return;
  }

  if (sensor === 'motion') {
    status[keyFor('living', 'lights')] = true;
    refreshSimulationView();
    showSimulationEvent('เซ็นเซอร์พบการเคลื่อนไหว → เปิดไฟพื้นที่ห้องโถง');
    return;
  }

  rooms.filter(room => room.kind === 'bedroom').forEach(room => {
    status[keyFor(room.id, 'ac')] = true;
  });
  refreshSimulationView();
  showSimulationEvent('อุณหภูมิเกิน 28°C → เปิดเครื่องปรับอากาศในห้องนอน');
}

function renderInventory() {
  const totals = Object.fromEntries(order.map(type => [type, rooms.reduce((sum, room) => sum + quantity(room, type), 0)]));
  const body = document.querySelector('#inventoryRows');
  body.innerHTML = order.filter(type => totals[type]).map(type => `<tr><td><span class="energy-category energy-category-${type}"><i class="energy-color-dot" aria-hidden="true"></i>${deviceInfo[type].name}</span></td><td><span class="qty-badge">${totals[type]} รายการ</span></td><td>อยู่ในรายการอุปกรณ์</td><td>ดูค่าประมาณด้านล่าง</td></tr>`).join('');
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
    return `<tr><td><span class="energy-category energy-category-${item.type}"><i class="energy-color-dot" aria-hidden="true"></i>${deviceInfo[item.type].name}</span></td><td>${item.quantity}</td><td>${model.watts.toLocaleString('th-TH')} W</td><td>${model.usage}</td><td><strong>${item.kwh.toFixed(1)}</strong></td></tr>`;
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

function renderBillEstimate(units) {
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

  document.querySelector('#billEstimatedUnits').textContent = units.toFixed(1);
  document.querySelector('#billRateLabel').textContent = rateLabel;
  document.querySelector('#billEnergyCharge').textContent = money(energyCharge);
  document.querySelector('#billFtCharge').textContent = money(ftCharge);
  document.querySelector('#billServiceCharge').textContent = money(serviceCharge);
  document.querySelector('#billVatCharge').textContent = money(vat);
  document.querySelector('#billEstimatedTotal').textContent = money(total);
  document.querySelector('#billFtPeriod').textContent = `Ft ${safeFtRate.toFixed(4)} บาท/หน่วย`;
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

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateAtOffset(offset) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

function referenceDailyKwh() {
  return rooms.reduce((sum, room) => sum + order.reduce((roomSum, type) => {
    const model = energyModel[type];
    const count = quantity(room, type);
    if (type === 'washer') {
      return roomSum + model.watts * model.hoursPerCycle * model.cyclesPerMonthPerUnit * count / 30 / 1000;
    }
    return roomSum + model.watts * model.hoursPerDay * count / 1000;
  }, 0), 0);
}

function dailySampleFactor(dateKey) {
  let hash = 0;
  for (const character of dateKey) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 0.84 + (hash % 33) / 100;
}

function createLiveEnergyState() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(liveEnergyStorageKey) || '{}'); } catch { saved = {}; }
  const today = localDateKey(new Date());
  const dailyAverage = referenceDailyKwh();
  const savedDays = new Map((Array.isArray(saved.history) ? saved.history : []).map(day => [day.date, Number(day.kwh) || 0]));
  if (saved.date && Number.isFinite(Number(saved.todayKwh))) savedDays.set(saved.date, Number(saved.todayKwh));
  const history = [];

  for (let offset = -6; offset <= 0; offset += 1) {
    const date = dateAtOffset(offset);
    const key = localDateKey(date);
    let kwh = savedDays.get(key);
    if (key === today && saved.date === today && Number.isFinite(Number(saved.todayKwh))) {
      kwh = Number(saved.todayKwh);
    } else if (key === today) {
      const now = new Date();
      const elapsedToday = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
      kwh = dailyAverage * elapsedToday * 0.82;
    } else if (!Number.isFinite(kwh)) {
      kwh = dailyAverage * dailySampleFactor(key);
    }
    history.push({ date: key, kwh });
  }

  return { date: today, todayKwh: history[history.length - 1].kwh, history };
}

function saveLiveEnergyState() {
  try { localStorage.setItem(liveEnergyStorageKey, JSON.stringify(liveEnergyState)); } catch { /* หน้าเว็บยังทำงานได้แม้ปิดการบันทึกในเบราว์เซอร์ */ }
}

function activePowerWatts() {
  return rooms.reduce((sum, room) => sum + order.reduce((roomSum, type) => {
    if (!isOn(room.id, type)) return roomSum;
    return roomSum + energyModel[type].watts * quantity(room, type);
  }, 0), 0);
}

function createLiveEnergyChart() {
  const canvas = document.querySelector('#liveEnergyChart');
  const fallback = document.querySelector('#liveEnergyChartFallback');
  if (!canvas || typeof Chart === 'undefined') {
    if (fallback) fallback.hidden = false;
    if (canvas) canvas.hidden = true;
    return;
  }
  try {
    liveEnergyChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: liveEnergyState.history.map(day => new Date(`${day.date}T12:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })),
      datasets: [{
        label: 'พลังงานจำลองต่อวัน',
        data: liveEnergyState.history.map(day => Number(day.kwh.toFixed(3))),
        borderColor: '#8dbb9a',
        backgroundColor: 'rgba(141, 187, 154, .14)',
        fill: true,
        tension: .35,
        pointRadius: 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: context => ` ${context.parsed.y.toFixed(3)} kWh (จำลอง)` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#aab7ae' } },
        y: { beginAtZero: true, title: { display: true, text: 'kWh / วัน', color: '#aab7ae' }, grid: { color: 'rgba(163, 184, 169, .12)' }, ticks: { color: '#aab7ae' } }
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

function updateLiveEnergy() {
  if (!liveEnergyState) return;
  const now = new Date();
  const today = localDateKey(now);
  if (today !== liveEnergyState.date) {
    liveEnergyState = createLiveEnergyState();
    lastLiveTick = now.getTime();
    liveEnergyChart?.destroy();
    createLiveEnergyChart();
    lastLiveChartUpdate = 0;
  }

  const elapsedSeconds = Math.max(0, Math.min((now.getTime() - lastLiveTick) / 1000, 3600));
  lastLiveTick = now.getTime();
  const ratedWatts = activePowerWatts();
  const simulatedWatts = ratedWatts * (0.98 + Math.random() * 0.04);
  liveEnergyState.todayKwh += simulatedWatts * elapsedSeconds / 3600000;
  const todayEntry = liveEnergyState.history[liveEnergyState.history.length - 1];
  todayEntry.kwh = liveEnergyState.todayKwh;

  const totalDevices = rooms.reduce((sum, room) => sum + roomTotal(room), 0);
  const activeDevices = rooms.reduce((sum, room) => sum + order.reduce((roomSum, type) => roomSum + (isOn(room.id, type) ? quantity(room, type) : 0), 0), 0);
  document.querySelector('#liveTodayKwh').textContent = liveEnergyState.todayKwh.toFixed(3);
  document.querySelector('#livePowerNow').textContent = (simulatedWatts / 1000).toFixed(2);
  document.querySelector('#liveActiveDevices').textContent = `${activeDevices} / ${totalDevices}`;
  const updatedAt = document.querySelector('#liveUpdatedAt');
  updatedAt.textContent = now.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  updatedAt.dateTime = now.toISOString();

  if (liveEnergyChart && now.getTime() - lastLiveChartUpdate >= 3600000) {
    liveEnergyChart.data.datasets[0].data = liveEnergyState.history.map(day => Number(day.kwh.toFixed(3)));
    liveEnergyChart.update('none');
    lastLiveChartUpdate = now.getTime();
  }
  if (now.getTime() - lastLiveSave >= 3600000) {
    saveLiveEnergyState();
    lastLiveSave = now.getTime();
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

document.addEventListener('click', event => {
  const toggle = event.target.closest('[data-toggle-type]');
  if (toggle) {
    const type = toggle.dataset.toggleType;
    const targets = toggle.dataset.toggleRoom === 'all'
      ? rooms.filter(room => quantity(room, type) > 0)
      : [roomById(toggle.dataset.toggleRoom)].filter(Boolean);
    const turnOn = !targets.every(room => isOn(room.id, type));
    targets.forEach(room => { status[keyFor(room.id, type)] = turnOn; });
    saveStatus();
    renderRoom();
    renderEnergy();
    updateLiveEnergy();
    selectedScenario = 'custom';
    saveSelectedScenario();
    renderScenarioState();
    showSimulationEvent(`ปรับ${deviceInfo[type].name}เป็น${turnOn ? 'เปิด' : 'ปิด'}ด้วยตนเอง`);
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
  if (event.target.closest('#showAllRooms')) setSelection('all');
  if (event.target.closest('#resetDemo')) {
    status = {};
    saveStatus();
    renderRoom();
    renderEnergy();
    updateLiveEnergy();
    selectedScenario = 'custom';
    saveSelectedScenario();
    renderScenarioState();
    showSimulationEvent('คืนค่าสถานะอุปกรณ์เริ่มต้นแล้ว');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  renderIcons();
  restoreBillSettings();
  renderMetrics();
  renderRoom();
  renderInventory();
  renderEnergy();
  selectedScenario = loadSelectedScenario();
  renderScenarioState();
  liveEnergyState = createLiveEnergyState();
  createLiveEnergyChart();
  updateLiveEnergy();
  window.setInterval(updateLiveEnergy, 3600000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateLiveEnergy();
  });
  window.addEventListener('pagehide', saveLiveEnergyState);
  loadOptionalLibrary('https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js', () => {
    renderEnergy();
    createLiveEnergyChart();
    updateLiveEnergy();
  });
  loadOptionalLibrary('https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js', () => renderIcons());
  document.querySelector('#billRateType').addEventListener('change', () => {
    saveBillSettings();
    renderBillEstimate(Number(document.querySelector('#energyTotal').textContent) || 0);
  });
  document.querySelector('#billFtRate').addEventListener('input', () => {
    saveBillSettings();
    renderBillEstimate(Number(document.querySelector('#energyTotal').textContent) || 0);
  });
  const plan = document.querySelector('#floorPlan');
  plan.addEventListener('load', connectPlan);
  if (plan.contentDocument?.readyState === 'complete') connectPlan();
});


