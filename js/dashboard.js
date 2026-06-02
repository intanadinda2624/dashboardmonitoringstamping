// ========================================
// DASHBOARD - Firebase Data
// Revisi: web hanya kirim command, ESP32 jadi sumber data mesin
// ========================================

let cycleChart = null;
let cycleData = [];
let cycleLabels = [];
let pollInterval = null;
let eventLogLoadedDate = null;

// Smooth display timer: data asli tetap dari ESP32/Firebase, web hanya menghaluskan tampilan.
// Versi monotonic: tampilan tidak boleh mundur karena Firebase/REST kadang telat mengirim nilai lama.
let smoothRuntimeBaseSec = 0;
let smoothDowntimeBaseSec = 0;
let smoothMachineStatus = 'STOP';
let smoothBaseMs = Date.now();
let smoothTimerStarted = false;
let smoothDateKey = '';
let smoothLastTotalCount = 0;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth()) return;
  updateNavUser();
  setupRolePermissions();
  initCycleChart();
  startRealtimeListener();
  startSmoothRuntimeDowntimeTimer();
});

function getDateKey(date = new Date()) {
  return date.toLocaleDateString('id-ID', { day:'2-digit', month:'2-digit', year:'numeric' }).replace(/\//g, '-');
}

function getTimeText(date = new Date()) {
  return date.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
}

function getTimestamp(date = new Date()) {
  return `${getDateKey(date)} ${getTimeText(date)}`;
}

function sanitizeFirebaseKey(key) {
  return String(key || getDateKey()).replace(/[.#$\[\]/]/g, '-');
}

function getField(obj, names, fallback = '-') {
  if (!obj) return fallback;
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== '') return obj[name];
  }
  return fallback;
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr || timeStr === '-' || timeStr === '00:00:00') return 0;
  const parts = String(timeStr).split(':').map(v => parseInt(v, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}


function formatSeconds(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function getSmoothRuntimeDowntimeDisplay() {
  const elapsed = Math.max(0, Math.floor((Date.now() - smoothBaseMs) / 1000));
  return {
    runtime: smoothRuntimeBaseSec + (smoothMachineStatus === 'RUN' ? elapsed : 0),
    downtime: smoothDowntimeBaseSec + (smoothMachineStatus === 'RUN' ? 0 : elapsed)
  };
}

function renderSmoothRuntimeDowntime() {
  const display = getSmoothRuntimeDowntimeDisplay();
  const runtimeEl = document.getElementById('runtimeVal');
  const downtimeEl = document.getElementById('downtimeVal');
  if (runtimeEl) runtimeEl.innerText = formatSeconds(display.runtime);
  if (downtimeEl) downtimeEl.innerText = formatSeconds(display.downtime);
}

function syncSmoothRuntimeDowntime(runtime, downtime, machineStatus, dateKey, totalCount) {
  const parsedRuntime = parseTimeToSeconds(runtime);
  const parsedDowntime = parseTimeToSeconds(downtime);
  const nextStatus = String(machineStatus || 'STOP').toUpperCase();
  const nextDateKey = String(dateKey || getDateKey()).replace(/\//g, '-');
  const nextTotal = parseInt(totalCount, 10) || 0;
  const current = getSmoothRuntimeDowntimeDisplay();

  // Kalau hari berganti atau counter di-reset, nilai boleh turun ke 0.
  const allowReset = (smoothDateKey && nextDateKey !== smoothDateKey) || (nextTotal < smoothLastTotalCount);

  if (allowReset) {
    smoothRuntimeBaseSec = parsedRuntime;
    smoothDowntimeBaseSec = parsedDowntime;
  } else {
    // Jika Firebase mengirim nilai lama/terlambat, jangan biarkan tampilan mundur.
    smoothRuntimeBaseSec = Math.max(parsedRuntime, current.runtime);
    smoothDowntimeBaseSec = Math.max(parsedDowntime, current.downtime);
  }

  smoothMachineStatus = nextStatus;
  smoothDateKey = nextDateKey;
  smoothLastTotalCount = nextTotal;
  smoothBaseMs = Date.now();
  renderSmoothRuntimeDowntime();
}

function startSmoothRuntimeDowntimeTimer() {
  if (smoothTimerStarted) return;
  smoothTimerStarted = true;
  setInterval(renderSmoothRuntimeDowntime, 1000);
}

function parseCycleTimeSeconds(value, runtime, total) {
  if (value !== undefined && value !== null && value !== '') {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    const match = String(value).replace(',', '.').match(/[\d.]+/);
    if (match) return parseFloat(match[0]) || 0;
  }
  const runtimeSec = parseTimeToSeconds(runtime);
  const totalCount = parseInt(total, 10) || 0;
  if (runtimeSec > 0 && totalCount > 0) return runtimeSec / totalCount;
  return 0;
}

function getRowDate(row) {
  if (!row) return '';
  const date = getField(row, ['production_date', 'tanggal_produksi'], '');
  if (date) return String(date).replace(/\//g, '-');
  const ts = getField(row, ['timestamp', 'last_update'], '');
  const match = String(ts).match(/(\d{2}[-/]\d{2}[-/]\d{4})/);
  return match ? match[1].replace(/\//g, '-') : '';
}

function getRowTime(row) {
  if (!row) return '';
  const time = getField(row, ['production_time', 'jam_produksi'], '');
  if (time) return String(time).slice(0, 8);
  const ts = getField(row, ['timestamp', 'last_update'], '');
  const match = String(ts).match(/(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : '';
}

function setupRolePermissions() {
  const user = getCurrentUser();

  if (!canChangeThreshold()) {
    const form = document.getElementById('thresholdForm');
    const readonly = document.getElementById('thresholdReadonly');
    if (form) form.style.display = 'none';
    if (readonly) {
      readonly.style.display = 'block';
      const roleText = document.getElementById('thresholdRoleText');
      if (roleText) roleText.textContent = user.role;
    }
  }

  if (!canControlMachine()) {
    const buttons = document.getElementById('controlButtons');
    const readonly = document.getElementById('controlReadonly');
    if (buttons) buttons.style.display = 'none';
    if (readonly) readonly.style.display = 'block';
  }
}

function initCycleChart() {
  const canvas = document.getElementById('speedChartDashboard');
  if (!canvas) return;

  cycleChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: cycleLabels,
      datasets: [{
        label: 'Production Time (sec/unit)',
        data: cycleData,
        borderColor: '#1479ff',
        backgroundColor: 'rgba(20, 121, 255, 0.12)',
        tension: 0.3,
        fill: true,
        pointRadius: 2,
        pointBackgroundColor: '#1479ff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#4d6383', font: { family: 'Inter', size: 11 } } },
        tooltip: { callbacks: { label: ctx => `Waktu proses: ${Number(ctx.parsed.y || 0).toFixed(1)} sec/unit` } }
      },
      scales: {
        x: {
          ticks: { color: '#7890ad', maxTicksLimit: 8, font: { size: 10 } },
          grid: { color: 'rgba(183, 212, 248, 0.45)' }
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#7890ad', font: { size: 10 } },
          title: { display: true, text: 'sec/unit', color: '#4d6383' },
          grid: { color: 'rgba(183, 212, 248, 0.45)' }
        }
      }
    }
  });
}

function startRealtimeListener() {
  fetchDashboardData().then(() => updateConnectionStatus(true)).catch(() => updateConnectionStatus(false));
  pollInterval = setInterval(() => fetchDashboardData().catch(() => {}), 2000);
}

async function fetchDashboardData() {
  const [latest, settings] = await Promise.all([
    FirebaseDB.get('stamping_box/latest').catch(() => null),
    FirebaseDB.get('stamping_box/settings').catch(() => null)
  ]);

  updateDashboardUI(latest || {}, settings || {});
  updateConnectionStatus(true);
  fetchDailyProductionLog(getDateKey()).catch(() => {});
}

function updateConnectionStatus(connected) {
  const connBar = document.getElementById('connectionBar');
  const connText = document.getElementById('connectionText');
  if (connected) {
    if (connBar) { connBar.classList.remove('error'); connBar.classList.add('connected'); }
    if (connText) connText.textContent = 'Terhubung ke Firebase — Data real-time aktif';
  } else {
    if (connBar) { connBar.classList.remove('connected'); connBar.classList.add('error'); }
    if (connText) connText.textContent = 'Koneksi terputus — Mencoba menghubungkan kembali...';
  }
}

function updateDashboardUI(data, settings) {
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val !== undefined && val !== null && val !== '' ? val : '-';
  };

  const good = getField(data, ['good_count', 'jumlah_good'], 0);
  const ng = getField(data, ['ng_count', 'jumlah_not_good'], 0);
  const total = getField(data, ['total_count', 'total_produksi'], 0);
  const goodPct = getField(data, ['good_percentage', 'percent_good', 'persentase_good'], '0.0');
  const ngPct = getField(data, ['ng_percentage', 'percent_ng', 'persentase_ng'], '0.0');
  const runtime = getField(data, ['runtime'], '00:00:00');
  const downtime = getField(data, ['downtime'], '00:00:00');
  const machineStatus = getField(data, ['machine_status', 'status_machine'], 'STOP');
  const systemStatus = getField(data, ['system_status', 'status_system'], 'NORMAL');

  setText('goodVal', good);
  setText('ngVal', ng);
  setText('totalVal', total);
  setText('percentGoodVal', goodPct);
  setText('percentNGVal', ngPct);
  syncSmoothRuntimeDowntime(runtime, downtime, machineStatus, getField(data, ['production_date', 'tanggal_produksi'], getDateKey()), total);
  setText('lastUpdateVal', getField(data, ['last_update', 'timestamp_update_terakhir'], '-'));
  setText('warningThresholdVal', getField(settings, ['warning_threshold'], getField(data, ['warning_threshold', 'threshold_warning'], '10.0')));
  setText('criticalThresholdVal', getField(settings, ['critical_threshold'], getField(data, ['critical_threshold', 'threshold_critical'], '20.0')));
  setText('minimumSampleVal', getField(settings, ['minimum_sample'], getField(data, ['minimum_sample'], '20')));

  const machineEl = document.getElementById('machineVal');
  if (machineEl) {
    machineEl.innerText = machineStatus;
    machineEl.style.color = machineStatus === 'RUN' ? '#08a66c' : '#ff3b4f';
  }

  const sysEl = document.getElementById('systemVal');
  if (sysEl) {
    sysEl.innerText = systemStatus;
    sysEl.classList.remove('normal', 'warning', 'critical');
    if (systemStatus === 'WARNING') sysEl.classList.add('warning');
    else if (systemStatus === 'CRITICAL') sysEl.classList.add('critical');
    else sysEl.classList.add('normal');
  }

  const cardSystem = document.getElementById('cardSystem');
  if (cardSystem) {
    if (systemStatus === 'WARNING') {
      cardSystem.style.boxShadow = '0 8px 24px rgba(18,60,113,0.10), 0 0 0 3px rgba(245,164,0,0.20)';
      cardSystem.style.borderColor = 'rgba(245,164,0,0.45)';
    } else if (systemStatus === 'CRITICAL') {
      cardSystem.style.boxShadow = '0 8px 24px rgba(18,60,113,0.10), 0 0 0 3px rgba(255,59,79,0.20)';
      cardSystem.style.borderColor = 'rgba(255,59,79,0.45)';
    } else {
      cardSystem.style.boxShadow = '';
      cardSystem.style.borderColor = '';
    }
  }

  const banner = document.getElementById('warningBanner');
  if (banner) {
    banner.style.display = 'none';
    banner.className = 'banner';
    if (systemStatus === 'WARNING') {
      banner.classList.add('banner-warning');
      banner.style.display = 'block';
      banner.innerText = '⚠ WARNING: JUMLAH NOT GOOD MELEBIHI AMBANG BATAS.';
    } else if (systemStatus === 'CRITICAL') {
      banner.classList.add('banner-critical');
      banner.style.display = 'block';
      banner.innerText = '🚨 CRITICAL: PERSENTASE NOT GOOD SANGAT TINGGI. SEGERA CEK SISTEM.';
    }
  }

  const startBtn = document.getElementById('startBtn');
  if (startBtn) {
    if (systemStatus === 'CRITICAL') {
      startBtn.classList.add('disabled');
      startBtn.disabled = true;
    } else {
      startBtn.classList.remove('disabled');
      startBtn.disabled = false;
    }
  }

  const wInput = document.getElementById('thresholdWarning');
  const cInput = document.getElementById('thresholdCritical');
  const mInput = document.getElementById('thresholdMinSample');
  if (wInput && !wInput.matches(':focus')) wInput.value = getField(settings, ['warning_threshold'], getField(data, ['warning_threshold', 'threshold_warning'], 10));
  if (cInput && !cInput.matches(':focus')) cInput.value = getField(settings, ['critical_threshold'], getField(data, ['critical_threshold', 'threshold_critical'], 20));
  if (mInput && !mInput.matches(':focus')) mInput.value = getField(settings, ['minimum_sample'], getField(data, ['minimum_sample'], 20));

  const cycle = parseCycleTimeSeconds(getField(data, ['cycle_time_sec', 'cycle_time_seconds', 'cycle_time'], 0), runtime, total);
  updateCycleChart(cycle);
}

function updateCycleChart(cycle) {
  const value = Number(cycle || 0);
  cycleData.push(Number(value.toFixed(1)));
  cycleLabels.push(getTimeText());

  if (cycleData.length > 20) {
    cycleData.shift();
    cycleLabels.shift();
  }

  if (cycleChart) {
    cycleChart.data.labels = cycleLabels;
    cycleChart.data.datasets[0].data = cycleData;
    cycleChart.update('none');
  }
}

function flattenHistoryData(historyData) {
  if (!historyData) return [];
  const out = [];
  Object.entries(historyData).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') return;
    if ('result' in value || 'total_count' in value || 'total_produksi' in value) {
      out.push({ ...value, firebase_key: key });
    } else {
      Object.entries(value).forEach(([childKey, child]) => {
        if (child && typeof child === 'object') out.push({ ...child, firebase_key: childKey });
      });
    }
  });
  return out;
}

async function fetchDailyProductionLog(dateKey) {
  const todayKey = sanitizeFirebaseKey(dateKey || getDateKey());
  let entries = [];

  const dailyData = await FirebaseDB.get('stamping_box/history/' + todayKey).catch(() => null);
  entries = flattenHistoryData(dailyData);

  // Fallback untuk data lama yang masih tersimpan di path /history datar.
  if (entries.length === 0) {
    const flatData = await FirebaseDB.get('stamping_box/history').catch(() => null);
    entries = flattenHistoryData(flatData).filter(row => getRowDate(row) === todayKey);
  }

  entries.sort((a, b) => String(getField(b, ['timestamp', 'production_time', 'jam_produksi'], '')).localeCompare(String(getField(a, ['timestamp', 'production_time', 'jam_produksi'], ''))));
  renderEventLog(entries.slice(0, 8));
  eventLogLoadedDate = todayKey;
}

function renderEventLog(entries) {
  const box = document.getElementById('eventLog');
  if (!box) return;

  if (!entries || entries.length === 0) {
    box.innerHTML = '<div class="event-item event-empty">Belum ada log produksi terbaru untuk hari ini.</div>';
    return;
  }

  box.innerHTML = entries.map(row => {
    const result = getField(row, ['result'], '-');
    const resultClass = result === 'GOOD' ? 'value-good' : ((result === 'NOT GOOD' || result === 'NOT_GOOD') ? 'value-bad' : '');
    const good = getField(row, ['good_count', 'jumlah_good'], 0);
    const ng = getField(row, ['ng_count', 'jumlah_not_good'], 0);
    const total = getField(row, ['total_count', 'total_produksi'], 0);
    const pct = getField(row, ['ng_percentage', 'percent_ng', 'persentase_ng'], 0);
    const status = getField(row, ['system_status', 'status_system'], 'NORMAL');
    const product = getField(row, ['product_id', 'firebase_key'], '');
    const time = getField(row, ['timestamp'], '') || `${getField(row, ['production_date', 'tanggal_produksi'], '')} ${getRowTime(row)}`;
    const cycle = parseCycleTimeSeconds(getField(row, ['cycle_time_sec', 'cycle_time_seconds', 'cycle_time'], 0), getField(row, ['runtime'], ''), total).toFixed(1) + ' sec/unit';
    return `<div class="event-item">
      <strong>${time || '-'}</strong> &nbsp; ${product ? `<span>${product}</span> &nbsp;` : ''}<span class="${resultClass}"><strong>${result}</strong></span>
      &nbsp; Good: ${good} | NG: ${ng} | Total: ${total} | NG%: ${pct} | Cycle: ${cycle}
      <span style="float:right" class="${status === 'CRITICAL' ? 'value-bad' : status === 'WARNING' ? 'value-warn' : 'value-good'}">${status}</span>
    </div>`;
  }).join('');
}

// ========================================
// SEND COMMAND
// ========================================
async function sendCommand(cmd) {
  if (!canControlMachine()) {
    alert('Role ini tidak memiliki akses kontrol mesin.');
    return;
  }

  const user = getCurrentUser();
  const now = new Date();
  const commandPayload = {
    command: cmd,
    command_id: `CMD-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`,
    command_status: 'PENDING',
    issued_by: user.username,
    issued_role: user.role,
    issued_at: getTimestamp(now)
  };

  try {
    await FirebaseDB.put('stamping_box/control', commandPayload);

    const actionLabel = cmd === 'MASTER_ON' ? 'MASTER ON' : cmd;
    await writeNumberedFirebaseLog(getDateKey(now), 'command', {
      timestamp: getTimestamp(now),
      production_date: getDateKey(now),
      production_time: getTimeText(now),
      username: user.username,
      role: user.role,
      action: cmd,
      detail: 'Command ' + actionLabel + ' dikirim dari dashboard online',
      machine_name: MACHINE_NAME
    }).catch(() => {});
  } catch (error) {
    console.error('Command error:', error);
    alert('Gagal mengirim perintah: ' + error.message);
  }
}

// ========================================
// SET THRESHOLD
// ========================================
async function setThresholdAjax(event) {
  event.preventDefault();

  if (!canChangeThreshold()) {
    alert('Hanya Admin yang bisa mengubah threshold.');
    return false;
  }

  const warning = parseFloat(document.getElementById('thresholdWarning').value) || 10;
  const critical = parseFloat(document.getElementById('thresholdCritical').value) || 20;
  const minSample = parseInt(document.getElementById('thresholdMinSample').value, 10) || 20;

  if (critical < warning) {
    alert('Threshold Critical harus lebih besar dari Warning!');
    return false;
  }

  const user = getCurrentUser();
  const now = new Date();
  const payload = {
    warning_threshold: warning,
    critical_threshold: critical,
    minimum_sample: minSample,
    updated_by: user.username,
    updated_role: user.role,
    updated_at: getTimestamp(now)
  };

  try {
    await FirebaseDB.put('stamping_box/settings', payload);
    await writeNumberedFirebaseLog(getDateKey(now), 'settings', {
      timestamp: getTimestamp(now),
      production_date: getDateKey(now),
      production_time: getTimeText(now),
      username: user.username,
      role: user.role,
      action: 'UPDATE_SETTINGS',
      detail: `Warning ${warning}%, Critical ${critical}%, Minimum Sample ${minSample}`,
      machine_name: MACHINE_NAME
    }).catch(() => {});
    alert('Threshold berhasil diubah!');
  } catch (error) {
    console.error('Threshold error:', error);
    alert('Gagal mengubah threshold: ' + error.message);
  }

  return false;
}

window.addEventListener('beforeunload', () => {
  if (pollInterval) clearInterval(pollInterval);
});
