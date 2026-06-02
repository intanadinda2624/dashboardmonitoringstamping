// ========================================
// HISTORY PAGE - Firebase Data
// Revisi: history harian product_000001 + summary dari daily_report
// ========================================

let historyCycleChart = null;
let historyOriginalData = [];
let historyFilteredData = [];
let historyPollInterval = null;
let activeFilter = null;
let currentHistoryDateKey = null;
let latestSnapshot = null;
let dailyReportSnapshot = null;
let settingsSnapshot = null;

// Smooth display timer untuk runtime/downtime pada halaman histori.
// Versi stabil: setelah halaman menerima nilai awal dari Firebase, tampilan berjalan lokal per detik.
// Update Firebase tidak boleh membuat angka mundur atau meloncat, kecuali tanggal berganti/reset counter.
let historyDisplayRuntimeSec = 0;
let historyDisplayDowntimeSec = 0;
let historyDisplayMachineStatus = 'STOP';
let historyDisplayInitialized = false;
let historyDisplayDateKey = '';
let historyDisplayLastTotalCount = 0;
let historyDisplayLastTickMs = Date.now();
let historyDisplayTimerStarted = false;

function formatSeconds(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function renderHistorySmoothRuntimeDowntime() {
  const runtimeEl = document.getElementById('runtimeHVal');
  const downtimeEl = document.getElementById('downtimeHVal');
  if (runtimeEl) runtimeEl.innerText = formatSeconds(historyDisplayRuntimeSec);
  if (downtimeEl) downtimeEl.innerText = formatSeconds(historyDisplayDowntimeSec);
}

function tickHistorySmoothRuntimeDowntime() {
  const now = Date.now();
  if (!historyDisplayInitialized) {
    historyDisplayLastTickMs = now;
    return;
  }

  const elapsedSec = Math.floor((now - historyDisplayLastTickMs) / 1000);
  if (elapsedSec <= 0) return;

  historyDisplayLastTickMs += elapsedSec * 1000;

  if (historyDisplayMachineStatus === 'RUN') {
    historyDisplayRuntimeSec += elapsedSec;
  } else {
    historyDisplayDowntimeSec += elapsedSec;
  }

  renderHistorySmoothRuntimeDowntime();
}

function syncHistorySmoothRuntimeDowntime(source, dateKey) {
  if (!source) return;
  const parsedRuntime = parseTimeToSeconds(getField(source, ['runtime'], '00:00:00'));
  const parsedDowntime = parseTimeToSeconds(getField(source, ['downtime'], '00:00:00'));
  const nextStatus = String(getField(source, ['machine_status', 'status_machine', 'final_machine_status'], 'STOP')).toUpperCase();
  const nextDateKey = String(dateKey || getField(source, ['production_date'], getDateKey())).replace(/\//g, '-');
  const nextTotal = parseInt(getField(source, ['total_count', 'total_produksi', 'production_total'], 0), 10) || 0;
  const resetDetected = historyDisplayInitialized && ((historyDisplayDateKey && nextDateKey !== historyDisplayDateKey) || (nextTotal < historyDisplayLastTotalCount));

  if (!historyDisplayInitialized || resetDetected) {
    historyDisplayRuntimeSec = parsedRuntime;
    historyDisplayDowntimeSec = parsedDowntime;
    historyDisplayInitialized = true;
    historyDisplayLastTickMs = Date.now();
  } else {
    if (parsedRuntime > historyDisplayRuntimeSec && parsedRuntime - historyDisplayRuntimeSec <= 1) {
      historyDisplayRuntimeSec = parsedRuntime;
    }
    if (parsedDowntime > historyDisplayDowntimeSec && parsedDowntime - historyDisplayDowntimeSec <= 1) {
      historyDisplayDowntimeSec = parsedDowntime;
    }
  }

  historyDisplayMachineStatus = nextStatus;
  historyDisplayDateKey = nextDateKey;
  historyDisplayLastTotalCount = nextTotal;
  renderHistorySmoothRuntimeDowntime();
}

function startHistorySmoothRuntimeDowntimeTimer() {
  if (historyDisplayTimerStarted) return;
  historyDisplayTimerStarted = true;
  historyDisplayLastTickMs = Date.now();
  setInterval(tickHistorySmoothRuntimeDowntime, 250);
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

function initHistoryCycleChart() {
  const canvas = document.getElementById('speedChartHistory');
  if (!canvas) return;

  historyCycleChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Cycle Time (sec/unit)',
        data: [],
        borderColor: '#1479ff',
        backgroundColor: 'rgba(20, 121, 255, 0.12)',
        tension: 0.3,
        fill: true,
        pointRadius: 3,
        pointBackgroundColor: '#1479ff',
        borderWidth: 2.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#4d6383', font: { family: 'Inter', size: 12 } } },
        tooltip: { callbacks: { label: ctx => `Cycle Time: ${Number(ctx.parsed.y || 0).toFixed(1)} sec/unit` } }
      },
      scales: {
        x: {
          ticks: { color: '#7890ad', maxTicksLimit: 12, font: { size: 10 } },
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

function startHistoryListener() {
  const connBar = document.getElementById('connectionBar');
  const connText = document.getElementById('connectionText');

  fetchHistoryData().then(() => {
    if (connBar) { connBar.classList.remove('error'); connBar.classList.add('connected'); }
    if (connText) connText.textContent = 'Terhubung ke Firebase — Data real-time aktif';
  }).catch(() => {
    if (connBar) connBar.classList.add('error');
    if (connText) connText.textContent = 'Gagal menghubungkan ke Firebase';
  });

  historyPollInterval = setInterval(fetchHistoryData, 3000);
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

async function getDailyHistory(dateKey) {
  const safeKey = sanitizeFirebaseKey(dateKey);
  let entries = [];

  const dailyData = await FirebaseDB.get('stamping_box/history/' + safeKey).catch(() => null);
  entries = flattenHistoryData(dailyData);

  // Fallback untuk data lama yang masih berada di /stamping_box/history datar.
  if (entries.length === 0) {
    const allHistory = await FirebaseDB.get('stamping_box/history').catch(() => null);
    entries = flattenHistoryData(allHistory).filter(row => getRowDate(row) === safeKey);
  }

  entries.sort((a, b) => {
    const at = String(getField(a, ['timestamp', 'production_time', 'jam_produksi'], ''));
    const bt = String(getField(b, ['timestamp', 'production_time', 'jam_produksi'], ''));
    return bt.localeCompare(at);
  });
  return entries;
}

async function fetchHistoryData() {
  try {
    const todayKey = getDateKey();
    currentHistoryDateKey = todayKey;

    const [latest, dailyReport, settings, entries] = await Promise.all([
      FirebaseDB.get('stamping_box/latest').catch(() => null),
      FirebaseDB.get('stamping_box/daily_report/' + sanitizeFirebaseKey(todayKey)).catch(() => null),
      FirebaseDB.get('stamping_box/settings').catch(() => null),
      getDailyHistory(todayKey)
    ]);

    latestSnapshot = latest || null;
    dailyReportSnapshot = dailyReport || null;
    settingsSnapshot = settings || null;
    historyOriginalData = entries || [];
    historyFilteredData = activeFilter ? filterEntries(historyOriginalData, activeFilter.start, activeFilter.end) : historyOriginalData;

    updateHistorySummary(latestSnapshot, dailyReportSnapshot, historyFilteredData, currentHistoryDateKey, settingsSnapshot, !!activeFilter);
    renderHistoryTable(historyFilteredData);
    generateSmartReport(historyFilteredData, dailyReportSnapshot, !!activeFilter);
    updateHistoryCycleChart(historyFilteredData, latestSnapshot, dailyReportSnapshot);

    const connBar = document.getElementById('connectionBar');
    const connText = document.getElementById('connectionText');
    if (connBar) { connBar.classList.remove('error'); connBar.classList.add('connected'); }
    if (connText) connText.textContent = 'Terhubung ke Firebase — Data real-time aktif';
  } catch (error) {
    const connBar = document.getElementById('connectionBar');
    const connText = document.getElementById('connectionText');
    if (connBar) { connBar.classList.remove('connected'); connBar.classList.add('error'); }
    if (connText) connText.textContent = 'Koneksi terputus...';
  }
}

function updateHistorySummary(latest, report, entries, dateKey, settings, useFilteredSummary = false) {
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val !== undefined && val !== null && val !== '' ? val : '-';
  };

  const baseSource = report || latest || (entries && entries.length ? entries[0] : {}) || {};
  const source = useFilteredSummary ? buildEntrySummary(entries, baseSource) : baseSource;

  const total = getField(source, ['production_total', 'total_count', 'total_produksi'], 0);
  const good = getField(source, ['good_total', 'good_count', 'jumlah_good'], 0);
  const ng = getField(source, ['ng_total', 'ng_count', 'jumlah_not_good'], 0);
  const pctGood = getField(source, ['good_percentage', 'percent_good', 'persentase_good'], total > 0 ? ((good * 100) / total).toFixed(1) : '0.0');
  const pctNG = getField(source, ['ng_percentage', 'percent_ng', 'persentase_ng'], total > 0 ? ((ng * 100) / total).toFixed(1) : '0.0');

  setText('dateVal', dateKey || getDateKey());
  setText('machineOpVal', getField(source, ['operation_count', 'jumlah_mesin_beroperasi'], 0));
  setText('totalGoodVal', good);
  setText('totalNGVal', ng);
  setText('totalProdVal', total);
  setText('pctGoodVal', pctGood);
  setText('pctNGVal', pctNG);
  // Timer runtime/downtime memakai latest jika tersedia agar tidak tertinggal oleh daily_report yang lebih jarang update.
  syncHistorySmoothRuntimeDowntime(latest || report || source, dateKey || getDateKey());

  const w = getField(settings, ['warning_threshold'], getField(source, ['warning_threshold', 'threshold_warning'], 10));
  const c = getField(settings, ['critical_threshold'], getField(source, ['critical_threshold', 'threshold_critical'], 20));
  const m = getField(settings, ['minimum_sample'], getField(source, ['minimum_sample'], 20));
  setText('thresholdInfoVal', `W:${w}% C:${c}%\nMin:${m}`);
}

function renderHistoryTable(data) {
  const table = document.getElementById('historyTableBody');
  if (!table) return;
  table.innerHTML = '';

  if (!data || data.length === 0) {
    table.innerHTML = "<tr><td colspan='9'>Belum ada data histori harian.</td></tr>";
    return;
  }

  data.forEach((row, i) => {
    const status = getField(row, ['system_status', 'status_system'], 'NORMAL');
    let rowClass = '';
    if (status === 'WARNING') rowClass = 'warning-row';
    if (status === 'CRITICAL') rowClass = 'critical-row';

    const total = getField(row, ['total_count', 'total_produksi'], '-');
    const cycle = parseCycleTimeSeconds(getField(row, ['cycle_time_sec', 'cycle_time_seconds', 'cycle_time'], 0), getField(row, ['runtime'], ''), total).toFixed(1) + ' sec/unit';
    const result = getField(row, ['result'], '-');
    const product = getField(row, ['product_id', 'firebase_key'], `product_${String(i + 1).padStart(6, '0')}`);

    const tr = document.createElement('tr');
    tr.className = rowClass;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${getField(row, ['timestamp'], '') || `${getField(row, ['production_date', 'tanggal_produksi'], '')} ${getField(row, ['production_time', 'jam_produksi'], '')}`}</td>
      <td>${result}${product ? `<br><small>${product}</small>` : ''}</td>
      <td>${status}</td>
      <td>${getField(row, ['good_count', 'jumlah_good'], '-')}</td>
      <td>${getField(row, ['ng_count', 'jumlah_not_good'], '-')}</td>
      <td>${total}</td>
      <td>${getField(row, ['ng_percentage', 'percent_ng', 'persentase_ng'], '-')}</td>
      <td>${cycle}</td>
    `;
    table.appendChild(tr);
  });
}

function generateSmartReport(data, report, useFilteredSummary = false) {
  const el = document.getElementById('autoReport');
  if (!el) return;

  const wEl = document.getElementById('warningCountVal');
  const cEl = document.getElementById('criticalCountVal');

  const computedSummary = buildEntrySummary(data || [], report || {});
  const warningCount = parseInt(getField(report, ['warning_count', 'jumlah_warning'], ''), 10);
  const criticalCount = parseInt(getField(report, ['critical_count', 'jumlah_critical'], ''), 10);

  const finalWarning = useFilteredSummary ? computedSummary.warning_count : (Number.isNaN(warningCount) ? computedSummary.warning_count : warningCount);
  const finalCritical = useFilteredSummary ? computedSummary.critical_count : (Number.isNaN(criticalCount) ? computedSummary.critical_count : criticalCount);

  if (wEl) wEl.innerText = finalWarning;
  if (cEl) cEl.innerText = finalCritical;

  const source = useFilteredSummary ? computedSummary : (report || (data && data.length ? buildEntrySummary(data, data[0]) : null));
  if (!source) {
    el.innerText = 'Belum ada data histori harian untuk dianalisis.';
    return;
  }

  const total = getField(source, ['production_total', 'total_count', 'total_produksi'], 0);
  const good = getField(source, ['good_total', 'good_count', 'jumlah_good'], 0);
  const ng = getField(source, ['ng_total', 'ng_count', 'jumlah_not_good'], 0);
  const avgCycle = getField(source, ['average_cycle_time_sec', 'cycle_time_sec', 'cycle_time_seconds', 'cycle_time'], 0);
  const cycle = parseCycleTimeSeconds(avgCycle, getField(source, ['runtime'], ''), total).toFixed(1) + ' sec/unit';

  let dominant = 'NORMAL';
  if (finalCritical >= finalWarning && finalCritical > 0) dominant = 'CRITICAL';
  else if (finalWarning > 0) dominant = 'WARNING';

  const scopeText = useFilteredSummary && activeFilter ? `Data terfilter pukul ${activeFilter.start} sampai ${activeFilter.end}` : 'Produksi hari ini';
  let reportText = `${scopeText} sebanyak ${total} unit, terdiri dari ${good} GOOD dan ${ng} NG. `;
  reportText += `Cycle time harian adalah ${cycle}, artinya rata-rata waktu proses untuk 1 produk sebesar ${cycle}. `;
  reportText += `Sistem didominasi kondisi ${dominant}. `;
  reportText += `WARNING terjadi sebanyak ${finalWarning} kali dan CRITICAL terjadi sebanyak ${finalCritical} kali.`;

  el.innerText = useFilteredSummary ? reportText : getField(report, ['summary'], reportText);
}

function updateHistoryCycleChart(entries, latest, report) {
  let rows = entries && entries.length ? [...entries] : [];

  if (rows.length === 0 && latest) rows = [latest];
  if (rows.length === 0 && report) rows = [report];

  rows = rows.slice().reverse().slice(-30);
  const labels = rows.map(row => getRowTime(row) || String(getField(row, ['timestamp', 'last_update'], '-')).slice(-8));
  const values = rows.map(row => {
    const total = getField(row, ['total_count', 'total_produksi', 'production_total'], 0);
    return Number(parseCycleTimeSeconds(getField(row, ['cycle_time_sec', 'cycle_time_seconds', 'average_cycle_time_sec', 'cycle_time'], 0), getField(row, ['runtime'], ''), total).toFixed(1));
  });

  if (historyCycleChart) {
    historyCycleChart.data.labels = labels;
    historyCycleChart.data.datasets[0].data = values;
    historyCycleChart.update('none');
  }
}

function filterEntries(entries, start, end) {
  if (!start || !end) return entries;
  const startSec = parseClockToSeconds(start, false);
  const endSec = parseClockToSeconds(end, true);
  if (startSec === null || endSec === null) return entries;

  return entries.filter(row => {
    const t = getRowTime(row);
    const rowSec = parseClockToSeconds(t, false);
    if (rowSec === null) return false;
    return rowSec >= startSec && rowSec <= endSec;
  });
}

function applyFilter() {
  const start = document.getElementById('startTime').value;
  const end = document.getElementById('endTime').value;

  if (!start || !end) {
    alert('Isi jam mulai dan jam akhir terlebih dahulu.');
    return;
  }

  const startSec = parseClockToSeconds(start, false);
  const endSec = parseClockToSeconds(end, true);
  if (startSec === null || endSec === null || startSec > endSec) {
    alert('Jam mulai tidak boleh lebih besar dari jam akhir.');
    return;
  }

  activeFilter = { start, end };
  historyFilteredData = filterEntries(historyOriginalData, start, end);
  updateHistorySummary(latestSnapshot, dailyReportSnapshot, historyFilteredData, currentHistoryDateKey, settingsSnapshot, !!activeFilter);
  renderHistoryTable(historyFilteredData);
  generateSmartReport(historyFilteredData, dailyReportSnapshot, !!activeFilter);
  updateHistoryCycleChart(historyFilteredData, latestSnapshot, dailyReportSnapshot);
}

function resetFilter() {
  activeFilter = null;
  const start = document.getElementById('startTime');
  const end = document.getElementById('endTime');
  if (start) start.value = '';
  if (end) end.value = '';

  historyFilteredData = historyOriginalData;
  updateHistorySummary(latestSnapshot, dailyReportSnapshot, historyOriginalData, currentHistoryDateKey, settingsSnapshot, false);
  renderHistoryTable(historyOriginalData);
  generateSmartReport(historyOriginalData, dailyReportSnapshot, false);
  updateHistoryCycleChart(historyOriginalData, latestSnapshot, dailyReportSnapshot);
}

window.addEventListener('beforeunload', () => {
  if (historyPollInterval) clearInterval(historyPollInterval);
});
