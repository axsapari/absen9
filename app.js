/**
 * RekapAbsen — Aplikasi Rekap Absensi Sekolah
 * Developed by: Agus Sugiharto Sapari, S.Pd.
 * Repository: https://github.com/axsapari/absen9
 * Hosting: GitHub Pages | Database: Supabase
 *
 * CHANGELOG FIXES v1.1:
 * - FIX: parseDetailAbsensi — hapus query DB per-record di dalam loop (sangat lambat)
 *        diganti dengan preload class_id dari students sekali saja
 * - FIX: loadKelas — hapus dead-code db.rpc ? {} : {} yang selalu kosong
 * - FIX: confirmRestore — tombol inline onclick tidak bisa pass JSON besar; pakai window._restoreData
 * - FIX: saveAbsenHarian — empty string check_in/check_out dikirim null ke DB bukan ""
 * - FIX: exportAbsenHarian — headerRow ditambahkan agar styling terpasang
 * - FIX: buildAndExportRekap — siswa tanpa data absensi tetap muncul di rekap
 * - FIX: parseDetailAbsensi — tambah fallback name match pakai nama tanpa tab
 * - FIX: handleImportFile — XLS TIMMY/BioFinger XML perlu dibaca sbg string dulu
 * - FIX: isWeekend — new Date(dateStr) bisa off-by-one karena timezone; pakai split
 * - FIX: fmtDateISO — new Date() bisa menghasilkan waktu lokal berbeda; pakai UTC
 * - FIX: countEffectiveDays — gunakan fmtDateISO yg aman timezone
 * - ADD: seedNasionalHolidays — sekarang benar-benar insert dari daftar hardcoded
 * - ADD: `global-class-filter` & `global-period-year` onChange trigger reload dashboard
 */

'use strict';

// ============================================================
// GLOBAL STATE
// ============================================================
let db = null;
let appState = {
  classes: [],
  students: [],
  holidays: [],
  currentPage: 'dashboard',
  siswaPage: 0,
  siswaPageSize: 30,
  siswaFiltered: [],
  trendChart: null,
  donutChart: null,
  importSiswaData: null,
  lateThreshold: '07:00',
  earlyLeaveThreshold: '14:00',
};

const CONFIG_KEY = 'absen9_config';

// ============================================================
// CONFIG & SUPABASE INIT
// ============================================================
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); }
  catch { return {}; }
}

function saveLocalConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function initSupabase() {
  const cfg = loadConfig();
  if (!cfg.url || !cfg.key) return false;
  try {
    db = supabase.createClient(cfg.url, cfg.key);
    return true;
  } catch (e) {
    console.error('Supabase init error:', e);
    return false;
  }
}

async function saveConfig() {
  const url = document.getElementById('cfg-supabase-url').value.trim();
  const key = document.getElementById('cfg-supabase-key').value.trim();
  if (!url || !key) { toast('Isi URL dan Key Supabase terlebih dahulu', 'error'); return; }
  try {
    db = supabase.createClient(url, key);
    const { error } = await db.from('schools').select('id').limit(1);
    if (error) throw error;
    saveLocalConfig({ ...loadConfig(), url, key });
    const statusEl = document.getElementById('cfg-status');
    statusEl.textContent = '✅ Koneksi berhasil!';
    statusEl.style.color = 'var(--green)';
    toast('Konfigurasi tersimpan', 'success');
    document.getElementById('setup-banner').classList.add('hidden');
    bootstrap();
  } catch (e) {
    const statusEl = document.getElementById('cfg-status');
    statusEl.textContent = '❌ Gagal: ' + e.message;
    statusEl.style.color = 'var(--red)';
    toast('Koneksi gagal: ' + e.message, 'error');
  }
}

// ============================================================
// BOOTSTRAP
// ============================================================
async function bootstrap() {
  const cfg = loadConfig();
  setTheme(cfg.theme || 'light', true);

  if (cfg.url) document.getElementById('cfg-supabase-url').value = cfg.url;
  if (cfg.key) document.getElementById('cfg-supabase-key').value = cfg.key;
  if (cfg.year) document.getElementById('cfg-year').value = cfg.year;
  if (cfg.semester) document.getElementById('cfg-semester').value = cfg.semester;
  if (cfg.lateTime) { document.getElementById('cfg-late-time').value = cfg.lateTime; appState.lateThreshold = cfg.lateTime; }
  if (cfg.outTime) { document.getElementById('cfg-out-time').value = cfg.outTime; appState.earlyLeaveThreshold = cfg.outTime; }
  if (cfg.schoolName) { document.getElementById('cfg-school-name').value = cfg.schoolName; document.getElementById('school-name-sidebar').textContent = cfg.schoolName; }
  if (cfg.schoolAddr) document.getElementById('cfg-school-addr').value = cfg.schoolAddr;

  // Set year dropdown to current year
  const curYear = new Date().getFullYear();
  const yearEl = document.getElementById('global-period-year');
  if (yearEl) {
    yearEl.innerHTML = [curYear+1, curYear, curYear-1].map(y => `<option value="${y}" ${y===curYear?'selected':''}>${y}</option>`).join('');
  }

  const ok = initSupabase();
  if (!ok) {
    document.getElementById('setup-banner').classList.remove('hidden');
    navigate('pengaturan');
    return;
  }

  initMonthDropdowns();
  await Promise.all([loadClasses(), loadHolidays()]);
  populateClassDropdowns();
  await loadDashboard();
}

// ============================================================
// NAVIGATION
// ============================================================
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('active');

  appState.currentPage = page;

  const titles = {
    'dashboard':    ['Dashboard', 'Ringkasan kehadiran siswa'],
    'absen-harian': ['Absen Harian', 'Input dan pantau kehadiran hari ini'],
    'rekap':        ['Rekap Absensi', 'Laporan kehadiran per periode'],
    'siswa':        ['Data Siswa', 'Kelola data siswa dan peserta didik'],
    'import-absen': ['Import Mesin Absen', 'Upload file XLS dari mesin fingerprint'],
    'kelas':        ['Data Kelas', 'Kelola kelas dan tahun ajaran'],
    'libur':        ['Hari Libur', 'Kelola hari libur dan kalender'],
    'laporan':      ['Cetak / Export', 'Export laporan ke Excel'],
    'backup':       ['Backup & Restore', 'Cadangkan dan pulihkan data'],
    'pengaturan':   ['Pengaturan', 'Konfigurasi aplikasi'],
  };
  const info = titles[page] || [page, ''];
  document.getElementById('topbar-title').textContent = info[0];
  document.getElementById('topbar-subtitle').textContent = info[1];

  if (page === 'dashboard')    loadDashboard();
  else if (page === 'siswa')        loadSiswa();
  else if (page === 'kelas')        loadKelas();
  else if (page === 'libur')        loadLibur();
  else if (page === 'import-absen') loadImportHistory();
  else if (page === 'absen-harian') initAbsenHarian();
  else if (page === 'laporan')      initLaporan();
}

// ============================================================
// THEME
// ============================================================
function setTheme(theme, silent) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-toggle').classList.toggle('active', theme === 'dark');
  if (!silent) saveLocalConfig({ ...loadConfig(), theme });
  if (!silent && (appState.trendChart || appState.donutChart)) {
    setTimeout(() => loadDashboard(), 100);
  }
}

document.getElementById('theme-toggle').addEventListener('click', function () {
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(cur === 'dark' ? 'light' : 'dark');
});

// ============================================================
// UTILITIES
// ============================================================
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// FIX: Gunakan UTC untuk menghindari bug timezone pada fmtDateISO
function fmtDateISO(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  const y   = dt.getFullYear();
  const m   = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  const names = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
  return `${day} ${names[parseInt(m)-1]} ${y}`;
}

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-');
  const names = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
  return `${names[parseInt(m)-1]} ${y}`;
}

function getMonthRange(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    start: `${y}-${String(m).padStart(2,'0')}-01`,
    end:   `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`,
  };
}

function getSemesterRange(year, sem) {
  const y = parseInt(year);
  if (sem == 1) return { start: `${y}-07-01`,   end: `${y}-12-31` };
  return           { start: `${y+1}-01-01`, end: `${y+1}-06-30` };
}

// FIX: Pakai split string, bukan new Date(), agar tidak ada bug timezone
function isWeekend(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

function isHoliday(dateStr) {
  return appState.holidays.some(h => h.holiday_date === dateStr);
}

function isEffectiveDay(dateStr) {
  return !isWeekend(dateStr) && !isHoliday(dateStr);
}

// FIX: Pakai metode tanggal lokal bukan UTC untuk loop hari
function countEffectiveDays(start, end) {
  let count = 0;
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const cur  = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  while (cur <= last) {
    const ds = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    if (isEffectiveDay(ds)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function initMonthDropdowns() {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    months.push({ val, label: monthLabel(val) });
  }
  ['dash-month', 'rek-month', 'lap-month'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = months.map(m =>
      `<option value="${m.val}" ${m.val === months[months.length-1].val ? 'selected' : ''}>${m.label}</option>`
    ).join('');
  });
}

// ============================================================
// CLASSES
// ============================================================
async function loadClasses() {
  if (!db) return;
  const { data, error } = await db.from('classes').select('*').order('name');
  if (!error) appState.classes = data || [];
}

function populateClassDropdowns() {
  const opts    = appState.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const allOpts = `<option value="">Semua Kelas</option>` + opts;

  ['global-class-filter','siswa-class-filter','rek-class','lap-class'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = allOpts;
  });
  const ahEl = document.getElementById('ah-class');
  if (ahEl) ahEl.innerHTML = `<option value="">Pilih Kelas</option>` + opts;
  const scEl = document.getElementById('siswa-class');
  if (scEl) scEl.innerHTML = `<option value="">—</option>` + opts;
}

// ============================================================
// HOLIDAYS
// ============================================================
async function loadHolidays() {
  if (!db) return;
  const { data } = await db.from('holidays').select('*').order('holiday_date');
  appState.holidays = data || [];
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
  if (!db) return;

  const today       = todayISO();
  const selMonth    = document.getElementById('dash-month')?.value || today.slice(0, 7);
  const classFilter = document.getElementById('global-class-filter')?.value || '';
  const { start: mStart, end: mEnd } = getMonthRange(selMonth);

  // Hari efektif
  const effDays = countEffectiveDays(mStart, mEnd);
  document.getElementById('stat-hari-efektif').textContent = effDays;
  document.getElementById('stat-hari-sub').textContent = `${mStart} s/d ${mEnd}`;

  // Total siswa
  let stuQ = db.from('students').select('id', { count: 'exact', head: true }).eq('is_active', true);
  if (classFilter) stuQ = stuQ.eq('class_id', classFilter);
  const { count: totalStu } = await stuQ;
  document.getElementById('stat-total-siswa').textContent = totalStu ?? '—';

  // Kehadiran hari ini
  let todayQ = db.from('attendance').select('status').eq('attendance_date', today);
  if (classFilter) todayQ = todayQ.eq('class_id', classFilter);
  const { data: todayData } = await todayQ;
  const hadirToday = (todayData || []).filter(r => r.status === 'H' || r.status === 'T').length;
  const absenToday = (todayData || []).filter(r => r.status !== 'H' && r.status !== 'T').length;
  document.getElementById('stat-hadir-hari-ini').textContent = hadirToday;
  document.getElementById('stat-alpha').textContent = absenToday;
  const pct = totalStu ? Math.round(hadirToday / totalStu * 100) : 0;
  document.getElementById('stat-pct-hadir').textContent = `${pct}% dari total siswa`;

  // Data bulan ini untuk ranking & chart
  let monthQ = db.from('attendance').select('student_id, status, class_id')
    .gte('attendance_date', mStart).lte('attendance_date', mEnd);
  if (classFilter) monthQ = monthQ.eq('class_id', classFilter);
  const { data: monthData } = await monthQ;

  // Agregat per siswa
  const byStudent = {};
  (monthData || []).forEach(r => {
    if (!byStudent[r.student_id]) byStudent[r.student_id] = { H:0, S:0, I:0, A:0, T:0 };
    byStudent[r.student_id][r.status]++;
  });

  // Ambil nama siswa
  const stuIds = Object.keys(byStudent);
  const stuNameMap = {};
  if (stuIds.length > 0) {
    const { data: stuData } = await db.from('students').select('id, name, class_name').in('id', stuIds);
    (stuData || []).forEach(s => { stuNameMap[s.id] = s; });
  }

  renderRankList('rank-alpha', Object.entries(byStudent).sort((a,b) => (b[1].A||0)-(a[1].A||0)).slice(0,5), stuNameMap, 'A', 'hari alpha');
  renderRankList('rank-sakit', Object.entries(byStudent).sort((a,b) => (b[1].S||0)-(a[1].S||0)).slice(0,5), stuNameMap, 'S', 'hari sakit');
  renderRankList('rank-rajin', Object.entries(byStudent).sort((a,b) => (b[1].H||0)-(a[1].H||0)).slice(0,5), stuNameMap, 'H', 'hari hadir');

  await loadClassSummary(mStart, mEnd, classFilter);
  await loadTrendChart(selMonth, classFilter);
  loadDonutChart(monthData || []);
}

function renderRankList(elId, rank, nameMap, statKey, label) {
  const el = document.getElementById(elId);
  if (!el) return;
  const numColors = ['gold', 'silver', 'bronze', '', ''];
  const items = rank
    .map(([id, stat], i) => {
      const s = nameMap[id];
      const val = stat[statKey] || 0;
      if (val === 0) return '';
      return `<div class="rank-item">
        <div class="rank-num ${numColors[i]}">${i+1}</div>
        <div class="rank-info">
          <div class="rank-name truncate">${s ? s.name : 'Siswa'}</div>
          <div class="rank-meta">${s?.class_name || '—'}</div>
        </div>
        <div class="rank-value">${val} <span class="text-xs text-muted">${label}</span></div>
      </div>`;
    }).filter(Boolean);
  el.innerHTML = items.length
    ? items.join('')
    : '<div class="text-sm text-muted text-center">Belum ada data</div>';
}

async function loadClassSummary(start, end, classFilter) {
  let q = db.from('attendance').select('class_id, status')
    .gte('attendance_date', start).lte('attendance_date', end);
  if (classFilter) q = q.eq('class_id', classFilter);
  const { data } = await q;

  const byClass = {};
  (data || []).forEach(r => {
    if (!byClass[r.class_id]) byClass[r.class_id] = { H:0, S:0, I:0, A:0, T:0 };
    byClass[r.class_id][r.status]++;
  });

  const classMap = {};
  appState.classes.forEach(c => { classMap[c.id] = c.name; });

  const tbody = document.getElementById('class-summary-body');
  const rows = Object.entries(byClass).map(([cid, stat]) => {
    const total = stat.H + stat.S + stat.I + stat.A + stat.T;
    const hadir = stat.H + stat.T;
    const pct   = total ? Math.round(hadir / total * 100) : 0;
    const col   = pct >= 85 ? 'var(--green)' : pct >= 70 ? 'var(--yellow)' : 'var(--red)';
    return `<tr>
      <td><strong>${classMap[cid] || '—'}</strong></td>
      <td>${total}</td>
      <td style="color:var(--green)">${stat.H}</td>
      <td style="color:var(--yellow)">${stat.S}</td>
      <td style="color:var(--accent)">${stat.I}</td>
      <td style="color:var(--red)">${stat.A}</td>
      <td style="color:var(--purple)">${stat.T}</td>
      <td style="color:${col};font-weight:600">${pct}%</td>
    </tr>`;
  });
  tbody.innerHTML = rows.length
    ? rows.join('')
    : '<tr><td colspan="8" class="text-center text-muted">Belum ada data absensi bulan ini</td></tr>';
}

async function loadTrendChart(selMonth, classFilter) {
  const [sy, sm] = selMonth.split('-').map(Number);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(sy, sm - 1 - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  const labels = months.map(m => monthLabel(m));
  const hadirData = [], alphaData = [];

  for (const m of months) {
    const { start, end } = getMonthRange(m);
    let q = db.from('attendance').select('status').gte('attendance_date', start).lte('attendance_date', end);
    if (classFilter) q = q.eq('class_id', classFilter);
    const { data } = await q;
    const arr = data || [];
    hadirData.push(arr.filter(r => r.status === 'H' || r.status === 'T').length);
    alphaData.push(arr.filter(r => r.status === 'A').length);
  }

  const ctx = document.getElementById('trend-chart');
  if (appState.trendChart) { appState.trendChart.destroy(); appState.trendChart = null; }
  const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? '#2E3347' : '#E4E7EC';
  const textColor = isDark ? '#9CA3AF' : '#6B7280';

  appState.trendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Hadir',  data: hadirData, backgroundColor: '#10B981', borderRadius: 4 },
        { label: 'Alpha',  data: alphaData, backgroundColor: '#EF4444', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor }, grid: { color: gridColor }, beginAtZero: true },
      },
    },
  });
}

function loadDonutChart(monthData) {
  const counts = { H:0, S:0, I:0, A:0, T:0 };
  (monthData || []).forEach(r => { counts[r.status] = (counts[r.status]||0) + 1; });
  const labels = ['Hadir','Sakit','Izin','Alpha','Terlambat'];
  const values = [counts.H, counts.S, counts.I, counts.A, counts.T];
  const colors = ['#10B981','#F59E0B','#3B82F6','#EF4444','#8B5CF6'];

  const ctx = document.getElementById('donut-chart');
  if (appState.donutChart) { appState.donutChart.destroy(); appState.donutChart = null; }
  appState.donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false } } },
  });

  document.getElementById('donut-legend').innerHTML = labels.map((l, i) => `
    <div class="flex gap-2" style="align-items:center">
      <div style="width:10px;height:10px;border-radius:2px;background:${colors[i]};flex-shrink:0"></div>
      <span class="text-xs">${l} <strong>${values[i]}</strong></span>
    </div>`).join('');
}

function switchTrend(mode, btn) {
  document.querySelectorAll('[data-period]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadDashboard();
}

// Listener global filter
document.getElementById('global-class-filter')?.addEventListener('change', loadDashboard);
document.getElementById('global-period-year')?.addEventListener('change', () => { initMonthDropdowns(); loadDashboard(); });
document.getElementById('dash-month')?.addEventListener('change', loadDashboard);

// ============================================================
// ABSEN HARIAN
// ============================================================
function initAbsenHarian() {
  const ahDate = document.getElementById('ah-date');
  if (ahDate && !ahDate.value) ahDate.value = todayISO();
}

async function loadAbsenHarian() {
  const classId = document.getElementById('ah-class').value;
  const date    = document.getElementById('ah-date').value;
  if (!classId || !date) { toast('Pilih kelas dan tanggal', 'error'); return; }
  if (isWeekend(date))   { toast('Hari Sabtu/Minggu — bukan hari efektif', 'info'); return; }
  if (isHoliday(date)) {
    const h = appState.holidays.find(h => h.holiday_date === date);
    toast(`Hari libur: ${h?.name || date}`, 'info'); return;
  }

  const tbody = document.getElementById('absen-harian-body');
  tbody.innerHTML = '<tr><td colspan="8" class="text-center"><div class="loading"><div class="spinner"></div> Memuat…</div></td></tr>';

  const { data: students } = await db.from('students').select('*').eq('class_id', classId).eq('is_active', true).order('name');
  const { data: existing } = await db.from('attendance').select('*').eq('class_id', classId).eq('attendance_date', date);

  const attMap = {};
  (existing || []).forEach(a => { attMap[a.student_id] = a; });
  const lateTime = loadConfig().lateTime || '07:00';

  tbody.innerHTML = (students || []).map((s, i) => {
    const att    = attMap[s.id] || {};
    const status = att.status || 'A';
    const statusOpts = ['H','S','I','A','T'].map(st =>
      `<option value="${st}" ${status===st?'selected':''}>${{H:'Hadir',S:'Sakit',I:'Izin',A:'Alpha',T:'Terlambat'}[st]}</option>`
    ).join('');
    return `<tr>
      <td>${i+1}</td>
      <td class="font-mono text-sm">${s.nis || '—'}</td>
      <td><strong>${s.name}</strong></td>
      <td><span class="chip">${s.class_name || '—'}</span></td>
      <td>
        <select class="form-control" style="width:110px" data-sid="${s.id}" data-field="status"
          onchange="checkLate(this,'${lateTime}')">${statusOpts}</select>
      </td>
      <td><input type="time" class="form-control" style="width:100px" data-sid="${s.id}" data-field="check_in"  value="${att.check_in  || ''}"/></td>
      <td><input type="time" class="form-control" style="width:100px" data-sid="${s.id}" data-field="check_out" value="${att.check_out || ''}"/></td>
      <td><input type="text" class="form-control" data-sid="${s.id}" data-field="notes" value="${att.notes || ''}" placeholder="Catatan…" style="width:160px"/></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="text-center text-muted">Tidak ada siswa di kelas ini</td></tr>';
}

function checkLate(selectEl, lateTime) {
  if (selectEl.value !== 'H') return;
  const row = selectEl.closest('tr');
  const ci  = row.querySelector('[data-field="check_in"]');
  if (ci && ci.value && ci.value > lateTime) {
    selectEl.value = 'T';
    toast('Status otomatis diubah ke Terlambat', 'info');
  }
}

async function saveAbsenHarian() {
  const classId = document.getElementById('ah-class').value;
  const date    = document.getElementById('ah-date').value;
  if (!classId || !date) { toast('Pilih kelas dan tanggal', 'error'); return; }

  const lateTime = loadConfig().lateTime || '07:00';
  const outTime  = loadConfig().outTime  || '14:00';
  const records  = [];

  document.querySelectorAll('#absen-harian-body tr').forEach(row => {
    const statusEl = row.querySelector('[data-field="status"]');
    if (!statusEl) return;
    const sid      = statusEl.dataset.sid;
    const status   = statusEl.value;
    // FIX: kirim null jika kosong, bukan string ""
    const checkIn  = row.querySelector('[data-field="check_in"]')?.value  || null;
    const checkOut = row.querySelector('[data-field="check_out"]')?.value || null;
    const notes    = row.querySelector('[data-field="notes"]')?.value     || null;

    const lateMins  = (status === 'T' && checkIn  && checkIn  > lateTime) ? timeToMin(checkIn)  - timeToMin(lateTime) : 0;
    const earlyMins = (status !== 'A' && checkOut && checkOut < outTime)  ? timeToMin(outTime)  - timeToMin(checkOut) : 0;

    records.push({
      student_id: sid, class_id: classId, attendance_date: date,
      status, check_in: checkIn, check_out: checkOut,
      late_minutes: lateMins, early_leave_minutes: earlyMins,
      notes, source: 'manual', day_of_week: new Date(date).getDay(),
    });
  });

  if (!records.length) { toast('Tidak ada data untuk disimpan', 'error'); return; }

  const { error } = await db.from('attendance').upsert(records, { onConflict: 'student_id,attendance_date' });
  if (error) { toast('Gagal menyimpan: ' + error.message, 'error'); return; }
  toast(`${records.length} data absensi tersimpan ✅`, 'success');
}

async function exportAbsenHarian() {
  const classId = document.getElementById('ah-class').value;
  const date    = document.getElementById('ah-date').value;
  if (!classId || !date) { toast('Pilih kelas dan tanggal', 'error'); return; }

  const { data: students } = await db.from('students').select('*').eq('class_id', classId).eq('is_active', true).order('name');
  const { data: atts }     = await db.from('attendance').select('*').eq('class_id', classId).eq('attendance_date', date);

  const attMap = {};
  (atts||[]).forEach(a => { attMap[a.student_id] = a; });

  const cls   = appState.classes.find(c => c.id === classId);
  const sName = loadConfig().schoolName || 'Sekolah';

  const data = [
    [`DAFTAR HADIR SISWA`],
    [`${sName}   |   Kelas: ${cls?.name || '—'}   |   Tanggal: ${fmtDate(date)}`],
    [],
    ['No','NIS','Nama Siswa','Status','Jam Masuk','Jam Pulang','Terlambat (mnt)','Keterangan'],
  ];
  (students||[]).forEach((s, i) => {
    const a = attMap[s.id] || {};
    const stLabel = { H:'Hadir', S:'Sakit', I:'Izin', A:'Alpha', T:'Terlambat' }[a.status || 'A'] || '—';
    data.push([i+1, s.nis||'', s.name, stLabel, a.check_in||'', a.check_out||'', a.late_minutes||0, a.notes||'']);
  });

  // FIX: headerRow = 4 agar styling terpasang
  exportToXlsx([{ name: 'Absen Harian', data, headerRow: 4 }],
    `Absen_${date}_${cls?.name || 'Kelas'}.xlsx`);
}

// ============================================================
// REKAP ABSENSI
// ============================================================
let rekapMode = 'bulan';

function switchRekap(mode, btn) {
  rekapMode = mode;
  document.querySelectorAll('#page-rekap .period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('rek-month').style.display = mode === 'bulan' ? '' : 'none';
  document.getElementById('rek-custom-range').classList.toggle('hidden', mode !== 'custom');
}

async function loadRekap() {
  const classId  = document.getElementById('rek-class').value;
  const year     = document.getElementById('global-period-year').value;
  const semester = loadConfig().semester || 2;

  let start, end;
  if (rekapMode === 'bulan') {
    const r = getMonthRange(document.getElementById('rek-month').value);
    start = r.start; end = r.end;
  } else if (rekapMode === 'semester') {
    const r = getSemesterRange(year, semester); start = r.start; end = r.end;
  } else if (rekapMode === 'tahun') {
    start = `${year}-01-01`; end = `${year}-12-31`;
  } else {
    start = document.getElementById('rek-start').value;
    end   = document.getElementById('rek-end').value;
    if (!start || !end) { toast('Pilih tanggal awal dan akhir', 'error'); return; }
  }

  const effDays = countEffectiveDays(start, end);
  const tbody   = document.getElementById('rekap-body');
  tbody.innerHTML = '<tr><td colspan="12" class="text-center"><div class="loading"><div class="spinner"></div></div></td></tr>';

  let attQ = db.from('attendance').select('student_id, status, late_minutes')
    .gte('attendance_date', start).lte('attendance_date', end);
  if (classId) attQ = attQ.eq('class_id', classId);
  const { data: attData } = await attQ;

  let stuQ = db.from('students').select('id, name, nis, class_name').eq('is_active', true).order('name');
  if (classId) stuQ = stuQ.eq('class_id', classId);
  const { data: stuData } = await stuQ;

  const byStu = {};
  (attData||[]).forEach(r => {
    if (!byStu[r.student_id]) byStu[r.student_id] = { H:0, S:0, I:0, A:0, T:0, lateMins:0 };
    byStu[r.student_id][r.status]++;
    byStu[r.student_id].lateMins += (r.late_minutes||0);
  });

  // FIX: Semua siswa tampil, bukan hanya yang punya data absensi
  const rows = (stuData||[]).map((s, i) => {
    const st = byStu[s.id] || { H:0, S:0, I:0, A:0, T:0, lateMins:0 };
    const hadir = st.H + st.T;
    const pct   = effDays ? Math.round(hadir / effDays * 100) : 0;
    const col   = pct >= 85 ? 'var(--green)' : pct >= 70 ? 'var(--yellow)' : 'var(--red)';
    return `<tr>
      <td>${i+1}</td>
      <td class="font-mono">${s.nis||'—'}</td>
      <td><strong>${s.name}</strong></td>
      <td>${s.class_name||'—'}</td>
      <td>${effDays}</td>
      <td style="color:var(--green)">${st.H}</td>
      <td style="color:var(--yellow)">${st.S}</td>
      <td style="color:var(--accent)">${st.I}</td>
      <td style="color:var(--red)">${st.A}</td>
      <td style="color:var(--purple)">${st.T}</td>
      <td style="color:${col};font-weight:600">${pct}%</td>
      <td>
        <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px"
          onclick="showStudentDetail('${s.id}')">👤</button>
      </td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('') || '<tr><td colspan="12" class="text-center text-muted">Tidak ada data</td></tr>';
}

async function exportRekap() {
  const classId  = document.getElementById('rek-class').value;
  const year     = document.getElementById('global-period-year').value;
  const semester = loadConfig().semester || 2;
  let start, end, periodLabel;

  if (rekapMode === 'bulan') {
    const m = document.getElementById('rek-month').value;
    const r = getMonthRange(m); start = r.start; end = r.end; periodLabel = monthLabel(m);
  } else if (rekapMode === 'semester') {
    const r = getSemesterRange(year, semester); start = r.start; end = r.end;
    periodLabel = `Semester ${semester} ${year}`;
  } else if (rekapMode === 'tahun') {
    start = `${year}-01-01`; end = `${year}-12-31`; periodLabel = `Tahun ${year}`;
  } else {
    start = document.getElementById('rek-start').value;
    end   = document.getElementById('rek-end').value;
    periodLabel = `${start} s/d ${end}`;
  }
  await buildAndExportRekap(classId, start, end, periodLabel);
}

async function buildAndExportRekap(classId, start, end, periodLabel) {
  const effDays   = countEffectiveDays(start, end);
  const schoolName = loadConfig().schoolName || 'Sekolah';

  let stuQ = db.from('students').select('id, name, nis, class_name').eq('is_active', true).order('name');
  if (classId) stuQ = stuQ.eq('class_id', classId);
  const { data: students } = await stuQ;

  let attQ = db.from('attendance').select('student_id, status, late_minutes')
    .gte('attendance_date', start).lte('attendance_date', end);
  if (classId) attQ = attQ.eq('class_id', classId);
  const { data: atts } = await attQ;

  const byStu = {};
  (atts||[]).forEach(r => {
    if (!byStu[r.student_id]) byStu[r.student_id] = { H:0, S:0, I:0, A:0, T:0, lateMins:0 };
    byStu[r.student_id][r.status]++;
    byStu[r.student_id].lateMins += (r.late_minutes||0);
  });

  const header = [
    [`REKAP ABSENSI SISWA`],
    [`${schoolName}`],
    [`Periode: ${periodLabel}   |   Hari Efektif: ${effDays} hari`],
    [],
    ['No','NIS','Nama Siswa','Kelas','Hari Efektif','Hadir','Sakit','Izin','Alpha','Terlambat','% Hadir','Terlambat (mnt)'],
  ];
  const dataRows = (students||[]).map((s, i) => {
    const st    = byStu[s.id] || { H:0, S:0, I:0, A:0, T:0, lateMins:0 };
    const hadir = st.H + st.T;
    const pct   = effDays ? Math.round(hadir / effDays * 100) : 0;
    return [i+1, s.nis||'', s.name, s.class_name||'', effDays, st.H, st.S, st.I, st.A, st.T, `${pct}%`, st.lateMins];
  });

  exportToXlsx(
    [{ name: 'Rekap Absensi', data: [...header, ...dataRows], headerRow: 5 }],
    `Rekap_Absensi_${periodLabel.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`
  );
}

// ============================================================
// SISWA
// ============================================================
async function loadSiswa() {
  if (!db) return;
  const { data, error } = await db.from('students').select('*').order('name');
  if (error) { toast('Gagal memuat siswa', 'error'); return; }
  appState.students = data || [];
  filterSiswa();
}

function filterSiswa() {
  const search  = document.getElementById('siswa-search')?.value?.toLowerCase() || '';
  const classId = document.getElementById('siswa-class-filter')?.value || '';
  appState.siswaFiltered = appState.students.filter(s =>
    (!search  || s.name.toLowerCase().includes(search) || (s.nis||'').includes(search)) &&
    (!classId || s.class_id === classId)
  );
  appState.siswaPage = 0;
  renderSiswaTable();
}

function renderSiswaTable() {
  const { siswaFiltered, siswaPage, siswaPageSize } = appState;
  const total  = siswaFiltered.length;
  const offset = siswaPage * siswaPageSize;
  const page   = siswaFiltered.slice(offset, offset + siswaPageSize);

  document.getElementById('siswa-count').textContent = `${total} siswa`;

  document.getElementById('siswa-body').innerHTML = page.map((s, i) => `<tr>
    <td>${offset + i + 1}</td>
    <td class="font-mono">${s.fingerprint_id ?? '—'}</td>
    <td class="font-mono text-sm">${s.nis || '—'}</td>
    <td><strong>${s.name}</strong></td>
    <td><span class="chip">${s.class_name || '—'}</span></td>
    <td>${s.gender === 'L' ? '♂' : s.gender === 'P' ? '♀' : '—'}</td>
    <td><span class="chip ${s.is_active ? 'tag-green' : 'tag-red'}">${s.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
    <td>
      <div class="flex gap-2">
        <button class="btn btn-secondary btn-icon" onclick="showStudentDetail('${s.id}')">👤</button>
        <button class="btn btn-secondary btn-icon" onclick="editSiswa('${s.id}')">✏️</button>
        <button class="btn btn-danger btn-icon"    onclick="deleteSiswa('${s.id}','${s.name.replace(/'/g,"\\'")}')">🗑</button>
      </div>
    </td>
  </tr>`).join('') || '<tr><td colspan="8" class="text-center text-muted">Tidak ada data</td></tr>';

  const pages = Math.ceil(total / siswaPageSize);
  document.getElementById('siswa-pagination').innerHTML = Array.from({ length: pages }, (_, i) =>
    `<button class="btn ${i===siswaPage?'btn-primary':'btn-secondary'}" style="padding:5px 10px;min-width:32px"
      onclick="goSiswaPage(${i})">${i+1}</button>`
  ).join('');
}

function goSiswaPage(p) { appState.siswaPage = p; renderSiswaTable(); }

function editSiswa(id) {
  const s = appState.students.find(x => x.id === id);
  if (!s) return;
  document.getElementById('edit-siswa-id').value  = s.id;
  document.getElementById('siswa-fp-id').value    = s.fingerprint_id || '';
  document.getElementById('siswa-nis').value       = s.nis || '';
  document.getElementById('siswa-name').value      = s.name;
  document.getElementById('siswa-gender').value    = s.gender || '';
  document.getElementById('siswa-class').value     = s.class_id || '';
  document.getElementById('modal-siswa-title').textContent = 'Edit Siswa';
  openModal('modal-tambah-siswa');
}

async function saveSiswa() {
  const id      = document.getElementById('edit-siswa-id').value;
  const name    = document.getElementById('siswa-name').value.trim();
  if (!name) { toast('Nama wajib diisi', 'error'); return; }

  const classId   = document.getElementById('siswa-class').value;
  const className = appState.classes.find(c => c.id === classId)?.name || '';

  const payload = {
    fingerprint_id: document.getElementById('siswa-fp-id').value ? parseInt(document.getElementById('siswa-fp-id').value) : null,
    nis:       document.getElementById('siswa-nis').value.trim() || null,
    name,
    class_id:  classId || null,
    class_name: className,
    gender:    document.getElementById('siswa-gender').value || null,
  };

  const { error } = id
    ? await db.from('students').update(payload).eq('id', id)
    : await db.from('students').insert(payload);

  if (error) { toast('Gagal menyimpan: ' + error.message, 'error'); return; }
  toast(id ? 'Siswa diperbarui ✅' : 'Siswa ditambahkan ✅', 'success');
  closeModal('modal-tambah-siswa');
  document.getElementById('edit-siswa-id').value = '';
  document.getElementById('modal-siswa-title').textContent = 'Tambah Siswa';
  await loadSiswa();
}

async function deleteSiswa(id, name) {
  if (!confirm(`Hapus siswa "${name}"?\nData absensinya juga akan terhapus.`)) return;
  const { error } = await db.from('students').delete().eq('id', id);
  if (error) { toast('Gagal hapus: ' + error.message, 'error'); return; }
  toast('Siswa dihapus', 'success');
  await loadSiswa();
}

async function showStudentDetail(id) {
  openModal('modal-detail-siswa');
  const s = appState.students.find(x => x.id === id) || {};
  document.getElementById('detail-siswa-name').textContent = s.name || 'Detail Siswa';
  document.getElementById('detail-siswa-body').innerHTML = '<div class="loading"><div class="spinner"></div> Memuat…</div>';

  const today = new Date();
  const start = `${today.getFullYear()}-${String(today.getMonth()-1 < 0 ? 12 : today.getMonth()).padStart(2,'0')}-01`;
  const end   = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${new Date(today.getFullYear(), today.getMonth()+1, 0).getDate()}`;

  const { data: atts } = await db.from('attendance').select('*')
    .eq('student_id', id).gte('attendance_date', start).lte('attendance_date', end).order('attendance_date');

  const counts = { H:0, S:0, I:0, A:0, T:0 };
  (atts||[]).forEach(a => { counts[a.status] = (counts[a.status]||0)+1; });
  const total = Object.values(counts).reduce((a,b)=>a+b, 0);
  const hadir = counts.H + counts.T;

  document.getElementById('detail-siswa-body').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px" class="mb-3">
      ${[['Hadir','H','var(--green)'],['Sakit','S','var(--yellow)'],['Izin','I','var(--accent)'],['Alpha','A','var(--red)']].map(([l,k,c]) => `
        <div class="stat-card" style="padding:12px">
          <div class="stat-label">${l}</div>
          <div class="stat-value" style="font-size:22px;color:${c}">${counts[k]||0}</div>
        </div>`).join('')}
    </div>
    <div class="text-sm text-muted mb-3">
      Kehadiran: <strong>${total ? Math.round(hadir/total*100) : 0}%</strong> &nbsp;|&nbsp; 3 bulan terakhir
    </div>
    <div style="overflow-x:auto">
      <table style="font-size:12px">
        <thead><tr><th>Tanggal</th><th>Hari</th><th>Status</th><th>Masuk</th><th>Pulang</th><th>Terlambat</th><th>Catatan</th></tr></thead>
        <tbody>
          ${(atts||[]).map(a => `<tr>
            <td>${fmtDate(a.attendance_date)}</td>
            <td>${['Min','Sen','Sel','Rab','Kam','Jum','Sab'][new Date(a.attendance_date).getDay()]}</td>
            <td><span class="status status-${a.status}">${{H:'Hadir',S:'Sakit',I:'Izin',A:'Alpha',T:'Terlambat'}[a.status]}</span></td>
            <td>${a.check_in||'—'}</td>
            <td>${a.check_out||'—'}</td>
            <td>${a.late_minutes ? a.late_minutes+' mnt' : '—'}</td>
            <td class="text-xs">${a.notes||'—'}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="text-center text-muted">Belum ada data</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

// ============================================================
// IMPORT SISWA
// ============================================================
function downloadTemplateImportSiswa() {
  const data = [
    ['ID Mesin Fingerprint','NIS','Nama Siswa','Kelas','Jenis Kelamin (L/P)'],
    [1,'2024001','Budi Santoso','9A','L'],
    [2,'2024002','Siti Rahayu','9B','P'],
    ['','','Nama Tanpa NIS','9A','L'],
  ];
  exportToXlsx([{ name: 'Template Siswa', data, headerRow: 1 }], 'Template_Import_Siswa.xlsx');
  toast('Template berhasil diunduh', 'success');
}

async function handleImportSiswa(input) {
  const file = input.files[0];
  if (!file) return;
  const wb   = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const data = rows.slice(1).filter(r => String(r[2]||'').trim());
  appState.importSiswaData = data;

  const previewEl = document.getElementById('siswa-import-preview');
  previewEl.className = '';
  previewEl.innerHTML = `
    <div class="text-sm font-bold mb-2">Preview: ${data.length} siswa ditemukan</div>
    <div class="table-wrap" style="max-height:200px;overflow-y:auto">
      <table style="font-size:12px">
        <thead><tr><th>ID Mesin</th><th>NIS</th><th>Nama</th><th>Kelas</th><th>JK</th></tr></thead>
        <tbody>${data.slice(0,10).map(r => `<tr>
          <td>${r[0]||'—'}</td><td>${r[1]||'—'}</td><td>${r[2]}</td><td>${r[3]||'—'}</td><td>${r[4]||'—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    ${data.length > 10 ? `<div class="text-xs text-muted mt-2">…dan ${data.length-10} lainnya</div>` : ''}`;

  document.getElementById('btn-confirm-import-siswa').classList.remove('hidden');
}

async function confirmImportSiswa() {
  const data = appState.importSiswaData;
  if (!data?.length) return;

  const classMap = {};
  appState.classes.forEach(c => { classMap[c.name?.toLowerCase()] = c; });

  const records = data.map(r => {
    const className = String(r[3] || '').trim();
    const cls       = classMap[className.toLowerCase()];
    const gender    = String(r[4]||'').toUpperCase().trim();
    return {
      fingerprint_id: r[0] ? parseInt(r[0]) : null,
      nis:       String(r[1]).trim() || null,
      name:      String(r[2]).trim(),
      class_name: className || null,
      class_id:  cls?.id || null,
      gender:    ['L','P'].includes(gender) ? gender : null,
      is_active: true,
    };
  });

  // FIX: siswa tanpa NIS tidak bisa di-upsert by NIS — insert dulu, update kalau NIS ada
  const withNIS    = records.filter(r => r.nis);
  const withoutNIS = records.filter(r => !r.nis);

  let errCount = 0;
  if (withNIS.length) {
    const { error } = await db.from('students').upsert(withNIS, { onConflict: 'nis' });
    if (error) { errCount++; toast('Sebagian gagal (duplikat NIS?): ' + error.message, 'error'); }
  }
  if (withoutNIS.length) {
    const { error } = await db.from('students').insert(withoutNIS);
    if (error) { errCount++; toast('Gagal insert tanpa NIS: ' + error.message, 'error'); }
  }

  if (!errCount) toast(`${records.length} siswa berhasil diimport ✅`, 'success');
  closeModal('modal-import-siswa');
  document.getElementById('btn-confirm-import-siswa').classList.add('hidden');
  document.getElementById('siswa-import-preview').className = 'hidden';
  appState.importSiswaData = null;
  await loadSiswa();
}

// ============================================================
// IMPORT MESIN ABSEN
// ============================================================
(function initDropZone() {
  const dz = document.getElementById('import-drop-zone');
  if (!dz) return;
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('dragover');
    handleImportFile(e.dataTransfer.files);
  });
})();

async function handleImportFile(files) {
  if (!files?.length) return;
  if (!db) { toast('Supabase belum terkoneksi', 'error'); return; }

  const progressWrap = document.getElementById('import-progress-wrap');
  const progressBar  = document.getElementById('import-progress');
  const statusText   = document.getElementById('import-status-text');
  const pctEl        = document.getElementById('import-pct');
  const logEl        = document.getElementById('import-log');

  progressWrap.classList.remove('hidden');
  logEl.classList.remove('hidden');
  logEl.innerHTML = '';

  const addLog = (msg, color = '') => {
    logEl.innerHTML += `<div style="color:${color||'inherit'}">${new Date().toLocaleTimeString('id-ID')} — ${msg}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
  };

  let totalImported = 0;

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    addLog(`📂 Membaca: <strong>${file.name}</strong>`);
    statusText.textContent = `Memproses ${file.name}…`;

    try {
      // Baca file sebagai teks UTF-8 — file TIMMY/BioFinger adalah XML SpreadsheetML
      const buffer = await file.arrayBuffer();
      const xmlText = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, ''); // strip BOM

      // Cek format
      if (!xmlText.includes('<Workbook') && !xmlText.includes('<?xml')) {
        addLog('⚠️ Format file tidak dikenal — harus XLS dari mesin TIMMY/BioFinger', 'var(--red)');
        continue;
      }

      // Cek sheet yang tersedia
      const sheetNames = [...xmlText.matchAll(/ss:Name="([^"]+)"/g)].map(m => m[1]);
      addLog(`📊 Sheet: ${sheetNames.join(', ')}`);

      if (!sheetNames.includes('Detail Absensi')) {
        addLog('⚠️ Sheet "Detail Absensi" tidak ditemukan', 'var(--red)');
        continue;
      }

      const batchId = crypto.randomUUID();
      const result  = await parseXmlDetailAbsensi(xmlText, file.name, batchId, addLog,
        p => { progressBar.style.width = p + '%'; pctEl.textContent = p + '%'; });

      totalImported += result.attCount;

      await db.from('import_batches').insert({
        id: batchId, filename: file.name, import_type: 'attendance',
        total_records: result.attCount, success_records: result.attCount, status: 'completed',
        notes: `Siswa: ${result.stuCount} | Absensi: ${result.attCount}`,
      });

      addLog(`✅ Selesai — ${result.stuCount} siswa, ${result.attCount} record absensi`, 'var(--green)');

    } catch (e) {
      addLog(`❌ Error: ${e.message}`, 'var(--red)');
      console.error(e);
    }
  }

  statusText.textContent = 'Import selesai!';
  progressBar.style.width = '100%'; pctEl.textContent = '100%';
  toast(`Import selesai — total ${totalImported} record ✅`, 'success');

  // Reload kelas & siswa karena mungkin baru dibuat
  await loadClasses();
  populateClassDropdowns();
  loadImportHistory();
}

// ============================================================
// CORE: Parser XML SpreadsheetML (TIMMY BioFinger)
// Membaca langsung dari string XML, tidak pakai SheetJS sheet_to_json
// karena merged cells menyebabkan SheetJS salah baca struktur baris
// ============================================================
async function parseXmlDetailAbsensi(xmlText, filename, batchId, addLog, setProgress) {
  // ── 1. Ekstrak konten sheet "Detail Absensi" ──────────────────────────
  const wsMatch = xmlText.match(/ss:Name="Detail Absensi"[^>]*>([\s\S]*?)(?=<Worksheet |$)/);
  if (!wsMatch) { addLog('❌ Tidak bisa menemukan sheet Detail Absensi', 'var(--red)'); return { stuCount:0, attCount:0 }; }
  const wsXml = wsMatch[1];

  // ── 2. Ekstrak semua baris (Row) ─────────────────────────────────────
  const rowsXml = [...wsXml.matchAll(/<Row[^>]*>([\s\S]*?)<\/Row>/g)].map(m => m[1]);
  addLog(`📋 Total baris ditemukan: ${rowsXml.length}`);

  // Helper: ambil semua nilai <Data> dalam satu baris XML
  function getRowValues(rowXml) {
    return [...rowXml.matchAll(/<Data[^>]*>([\s\S]*?)<\/Data>/g)]
      .map(m => m[1].trim().replace(/\t/g, ' '));
  }

  // ── 3. Baca info tanggal dari baris ke-2 (index 1) ───────────────────
  const dateVals = getRowValues(rowsXml[1] || '');
  const dateLine = dateVals[0] || '';
  // Format: "Tanggal:2026-4-1~2026-4-30"
  const dm = dateLine.match(/Tanggal:(\d+)-(\d+)-(\d+)~(\d+)-(\d+)-(\d+)/);
  if (!dm) {
    addLog(`❌ Baris tanggal tidak terbaca: "${dateLine}"`, 'var(--red)');
    return { stuCount:0, attCount:0 };
  }
  const year        = parseInt(dm[1]);
  const month       = parseInt(dm[2]);
  const daysInMonth = parseInt(dm[6]);
  addLog(`📅 Periode: ${year}-${String(month).padStart(2,'0')} (${daysInMonth} hari)`);

  // ── 4. Ekstrak data siswa dari baris-baris ───────────────────────────
  // Struktur per siswa: [header_row, day_numbers_row, time_data_row]
  const studentsFromFile = [];    // {fpId, name, dept}
  const timeDataByFp    = {};    // fpId -> [30 string values]

  let curFpId = null, curName = '', curDept = '';

  for (let i = 2; i < rowsXml.length; i++) {
    const vals = getRowValues(rowsXml[i]);
    const first = vals[0] || '';

    // Baris header siswa: "ID:N\tNama:XXX Dept.:YYY Shift:ZZZ"
    if (/^ID:\d+/.test(first)) {
      const idM    = first.match(/ID:(\d+)/);
      const nameM  = first.match(/Nama:\s*(.+?)\s+Dept\./);
      const deptM  = first.match(/Dept\.:(\S+)/);
      curFpId = idM   ? parseInt(idM[1])       : null;
      curName = nameM ? nameM[1].trim()         : first;
      curDept = deptM ? deptM[1].trim()         : '';
      studentsFromFile.push({ fpId: curFpId, name: curName, dept: curDept });
      continue;
    }

    // Baris angka hari (1,2,3,...) — lewati
    if (curFpId !== null && vals.length >= daysInMonth && vals.every(v => /^\d+$/.test(v.trim()))) {
      continue;
    }

    // Baris data waktu (paling tidak ada 1 sel berformat HH:MM)
    if (curFpId !== null && vals.some(v => /\d{2}:\d{2}/.test(v))) {
      timeDataByFp[curFpId] = vals;
    }
  }

  addLog(`👥 ${studentsFromFile.length} siswa ditemukan di file`);

  // ── 5. Auto-upsert kelas yang belum ada ──────────────────────────────
  const depts     = [...new Set(studentsFromFile.map(s => s.dept).filter(Boolean))];
  const classMap  = {};  // dept name -> {id, name}

  // Ambil kelas yang sudah ada
  const { data: existingClasses } = await db.from('classes').select('id, name');
  (existingClasses||[]).forEach(c => { classMap[c.name] = c; });

  // Buat kelas yang belum ada
  const newDepts = depts.filter(d => !classMap[d]);
  if (newDepts.length) {
    addLog(`🏫 Membuat kelas baru: ${newDepts.join(', ')}`);
    const { data: created } = await db.from('classes')
      .insert(newDepts.map(d => ({ name: d })))
      .select();
    (created||[]).forEach(c => { classMap[c.name] = c; });
    // Reload global
    await loadClasses();
    populateClassDropdowns();
  }

  // ── 6. Auto-upsert siswa yang belum ada ──────────────────────────────
  const stuRecords = studentsFromFile.map(s => ({
    fingerprint_id: s.fpId,
    name:           s.name,
    class_name:     s.dept || null,
    class_id:       classMap[s.dept]?.id || null,
    is_active:      true,
  }));

  // Upsert by fingerprint_id
  const CHUNK = 50;
  for (let i = 0; i < stuRecords.length; i += CHUNK) {
    const { error } = await db.from('students')
      .upsert(stuRecords.slice(i, i+CHUNK), { onConflict: 'fingerprint_id', ignoreDuplicates: false });
    if (error) addLog(`⚠️ Upsert siswa batch ${i}: ${error.message}`, 'var(--yellow)');
  }
  addLog(`✅ Data siswa disinkronkan (${stuRecords.length} siswa)`);

  // Ambil ulang siswa dari DB (sekarang sudah ada)
  const { data: stuDb } = await db.from('students').select('id, fingerprint_id, name, class_id');
  const stuByFP = {};
  (stuDb||[]).forEach(s => { if (s.fingerprint_id != null) stuByFP[s.fingerprint_id] = s; });

  // ── 7. Buat record absensi ────────────────────────────────────────────
  const lateThreshold = loadConfig().lateTime || '07:00';
  const attRecords    = [];
  const rawRecords    = [];

  for (const s of studentsFromFile) {
    const stu      = stuByFP[s.fpId];
    if (!stu) { addLog(`⚠️ Siswa fp_id=${s.fpId} tidak ditemukan di DB`, 'var(--yellow)'); continue; }
    const timeVals = timeDataByFp[s.fpId] || [];

    for (let d = 0; d < daysInMonth; d++) {
      const dayNum  = d + 1;
      const mm      = String(month).padStart(2, '0');
      const dd      = String(dayNum).padStart(2, '0');
      const dateStr = `${year}-${mm}-${dd}`;

      // Skip hari Sabtu/Minggu
      const [sy, sm, sdd] = [year, month-1, dayNum];
      const dow = new Date(sy, sm, sdd).getDay();
      if (dow === 0 || dow === 6) continue;

      // Skip hari libur
      if (isHoliday(dateStr)) continue;

      const cellVal = String(timeVals[d] || '').trim();
      // Hari tidak ada tap = Alpha (A)
      const times   = cellVal.match(/\d{2}:\d{2}/g) || [];

      if (!times.length) {
        // Catat sebagai Alpha
        attRecords.push({
          student_id: stu.id, class_id: stu.class_id,
          attendance_date: dateStr, status: 'A',
          check_in: null, check_out: null,
          late_minutes: 0, early_leave_minutes: 0,
          source: 'fingerprint', day_of_week: dow,
        });
        continue;
      }

      const checkIn  = times[0];
      const checkOut = times.length > 1 ? times[times.length - 1] : null;
      const isLate   = checkIn > lateThreshold;

      attRecords.push({
        student_id:          stu.id,
        class_id:            stu.class_id,
        attendance_date:     dateStr,
        status:              isLate ? 'T' : 'H',
        check_in:            checkIn,
        check_out:           checkOut,
        late_minutes:        isLate ? timeToMin(checkIn) - timeToMin(lateThreshold) : 0,
        early_leave_minutes: 0,
        source:              'fingerprint',
        day_of_week:         dow,
      });
      rawRecords.push({
        student_id: stu.id, attendance_date: dateStr,
        check_in: checkIn, check_out: checkOut,
        all_punches: cellVal, source_file: filename, import_batch: batchId,
      });
    }
    setProgress(Math.min(92, Math.round(
      (studentsFromFile.indexOf(s)+1) / studentsFromFile.length * 100
    )));
  }

  addLog(`📝 Menyimpan ${attRecords.length} record absensi…`);

  // Upsert absensi per chunk
  for (let i = 0; i < attRecords.length; i += CHUNK) {
    const { error } = await db.from('attendance')
      .upsert(attRecords.slice(i, i+CHUNK), { onConflict: 'student_id,attendance_date' });
    if (error) addLog(`⚠️ Batch att ${i}: ${error.message}`, 'var(--yellow)');
  }

  for (let i = 0; i < rawRecords.length; i += CHUNK) {
    await db.from('attendance_raw')
      .upsert(rawRecords.slice(i, i+CHUNK), { onConflict: 'student_id,attendance_date' });
  }

  return { stuCount: studentsFromFile.length, attCount: attRecords.length };
}

async function loadImportHistory() {
  if (!db) return;
  const { data } = await db.from('import_batches').select('*').order('created_at', { ascending: false }).limit(20);
  document.getElementById('import-history-body').innerHTML =
    (data||[]).map(b => `<tr>
      <td class="text-xs">${new Date(b.created_at).toLocaleString('id-ID')}</td>
      <td class="text-xs truncate" style="max-width:160px" title="${b.filename}">${b.filename}</td>
      <td>${b.success_records}</td>
      <td><span class="chip ${b.status==='completed'?'tag-green':'tag-red'}">${b.status}</span></td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-muted">Belum ada riwayat</td></tr>';
}

// ============================================================
// KELAS
// ============================================================
async function loadKelas() {
  if (!db) return;
  const { data: classes } = await db.from('classes').select('*').order('name');
  const activeYear = loadConfig().year || '2025/2026';

  // FIX: Hapus dead-code, query count langsung per kelas
  const countMap = {};
  if (classes?.length) {
    // Ambil semua siswa aktif sekaligus
    const { data: allStu } = await db.from('students').select('class_id').eq('is_active', true);
    (allStu||[]).forEach(s => {
      if (s.class_id) countMap[s.class_id] = (countMap[s.class_id]||0) + 1;
    });
  }

  document.getElementById('kelas-body').innerHTML =
    (classes||[]).map((c, i) => `<tr>
      <td>${i+1}</td>
      <td><strong>${c.name}</strong></td>
      <td>${c.homeroom_teacher || '—'}</td>
      <td>${activeYear}</td>
      <td>${countMap[c.id] ?? 0}</td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-icon" onclick="editKelas('${c.id}')">✏️</button>
          <button class="btn btn-danger btn-icon"    onclick="deleteKelas('${c.id}','${c.name}')">🗑</button>
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-center text-muted">Belum ada kelas</td></tr>';
}

async function saveKelas() {
  const id   = document.getElementById('edit-kelas-id').value;
  const name = document.getElementById('kelas-name').value.trim();
  if (!name) { toast('Nama kelas wajib diisi', 'error'); return; }

  const payload = { name, homeroom_teacher: document.getElementById('kelas-teacher').value.trim() || null };
  const { error } = id
    ? await db.from('classes').update(payload).eq('id', id)
    : await db.from('classes').insert(payload);

  if (error) { toast('Gagal menyimpan: ' + error.message, 'error'); return; }
  toast(id ? 'Kelas diperbarui ✅' : 'Kelas ditambahkan ✅', 'success');
  closeModal('modal-tambah-kelas');
  document.getElementById('edit-kelas-id').value = '';
  document.getElementById('kelas-name').value    = '';
  document.getElementById('kelas-teacher').value = '';
  document.getElementById('modal-kelas-title').textContent = 'Tambah Kelas';
  await loadClasses();
  populateClassDropdowns();
  loadKelas();
}

function editKelas(id) {
  const c = appState.classes.find(x => x.id === id);
  if (!c) return;
  document.getElementById('edit-kelas-id').value          = c.id;
  document.getElementById('kelas-name').value             = c.name;
  document.getElementById('kelas-teacher').value          = c.homeroom_teacher || '';
  document.getElementById('modal-kelas-title').textContent = 'Edit Kelas';
  openModal('modal-tambah-kelas');
}

async function deleteKelas(id, name) {
  if (!confirm(`Hapus kelas "${name}"?`)) return;
  const { error } = await db.from('classes').delete().eq('id', id);
  if (error) { toast('Gagal hapus', 'error'); return; }
  toast('Kelas dihapus', 'success');
  await loadClasses(); populateClassDropdowns(); loadKelas();
}

// ============================================================
// HARI LIBUR
// ============================================================
async function loadLibur() {
  if (!db) return;
  const year = document.getElementById('libur-year-filter')?.value || new Date().getFullYear();
  const { data } = await db.from('holidays').select('*')
    .gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`)
    .order('holiday_date');
  appState.holidays = data || [];

  const typeLabel = { national: '🇮🇩 Nasional', school: '🏫 Sekolah', custom: '📌 Custom' };
  document.getElementById('libur-body').innerHTML =
    (data||[]).map(h => `<tr>
      <td>${fmtDate(h.holiday_date)}</td>
      <td>${h.name}</td>
      <td><span class="chip">${typeLabel[h.holiday_type]||h.holiday_type}</span></td>
      <td>${h.holiday_type !== 'national'
        ? `<button class="btn btn-danger btn-icon" onclick="deleteLibur('${h.id}')">🗑</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-muted">Tidak ada hari libur</td></tr>';

  renderLiburCalendar(new Date(), data||[]);
}

function renderLiburCalendar(dateObj, holidays) {
  const year   = dateObj.getFullYear();
  const month  = dateObj.getMonth();
  const mNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  document.getElementById('libur-cal-month').textContent = `${mNames[month]} ${year}`;

  const holSet = new Set(holidays.map(h => h.holiday_date));
  const first  = new Date(year, month, 1).getDay();
  const total  = new Date(year, month + 1, 0).getDate();
  const days   = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];

  let html = days.map(d => `<div class="cal-day-header">${d}</div>`).join('');
  for (let i = 0; i < first; i++) html += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= total; d++) {
    const ds  = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(year, month, d).getDay();
    const cls = holSet.has(ds) ? 'holiday' : (dow===0||dow===6) ? 'weekend' : '';
    const tip = holSet.has(ds) ? holidays.find(h => h.holiday_date===ds)?.name : '';
    html += `<div class="cal-day ${cls}" title="${tip}">${d}</div>`;
  }
  document.getElementById('libur-calendar').innerHTML = html;
}

async function saveLibur() {
  const date = document.getElementById('libur-date').value;
  const name = document.getElementById('libur-name').value.trim();
  const type = document.getElementById('libur-type').value;
  if (!date || !name) { toast('Tanggal dan nama wajib diisi', 'error'); return; }

  const { error } = await db.from('holidays')
    .upsert({ holiday_date: date, name, holiday_type: type }, { onConflict: 'holiday_date' });
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  toast('Hari libur ditambahkan ✅', 'success');
  closeModal('modal-tambah-libur');
  document.getElementById('libur-date').value = '';
  document.getElementById('libur-name').value = '';
  await loadHolidays(); loadLibur();
}

async function deleteLibur(id) {
  if (!confirm('Hapus hari libur ini?')) return;
  const { error } = await db.from('holidays').delete().eq('id', id);
  if (error) { toast('Gagal hapus', 'error'); return; }
  toast('Hari libur dihapus', 'success');
  await loadHolidays(); loadLibur();
}

// Hari libur nasional Indonesia lengkap 2024–2027
const NATIONAL_HOLIDAYS = [
  // 2024
  ['2024-01-01','Tahun Baru Masehi 2024'],
  ['2024-02-08','Isra Miraj Nabi Muhammad SAW'],
  ['2024-02-10','Tahun Baru Imlek 2575'],
  ['2024-03-11','Hari Raya Nyepi (Tahun Baru Saka 1946)'],
  ['2024-03-29','Wafat Isa Al Masih'],
  ['2024-04-10','Hari Raya Idul Fitri 1445 H'],
  ['2024-04-11','Hari Raya Idul Fitri 1445 H (2)'],
  ['2024-05-01','Hari Buruh Internasional'],
  ['2024-05-09','Kenaikan Isa Al Masih'],
  ['2024-05-23','Hari Raya Waisak 2568'],
  ['2024-06-01','Hari Lahir Pancasila'],
  ['2024-06-17','Hari Raya Idul Adha 1445 H'],
  ['2024-07-07','Tahun Baru Islam 1446 H'],
  ['2024-08-17','Hari Kemerdekaan Republik Indonesia'],
  ['2024-09-16','Maulid Nabi Muhammad SAW'],
  ['2024-12-25','Hari Raya Natal'],
  ['2024-12-26','Cuti Bersama Natal'],
  // 2025
  ['2025-01-01','Tahun Baru Masehi 2025'],
  ['2025-01-27','Isra Miraj Nabi Muhammad SAW 1446 H'],
  ['2025-01-28','Cuti Bersama Isra Miraj'],
  ['2025-01-29','Tahun Baru Imlek 2576'],
  ['2025-03-29','Hari Raya Nyepi (Tahun Baru Saka 1947)'],
  ['2025-03-30','Wafat Isa Al Masih'],
  ['2025-03-31','Hari Raya Idul Fitri 1446 H'],
  ['2025-04-01','Hari Raya Idul Fitri 1446 H (2)'],
  ['2025-04-02','Cuti Bersama Idul Fitri'],
  ['2025-04-03','Cuti Bersama Idul Fitri'],
  ['2025-04-04','Cuti Bersama Idul Fitri'],
  ['2025-05-01','Hari Buruh Internasional'],
  ['2025-05-12','Hari Raya Waisak 2569'],
  ['2025-05-29','Kenaikan Isa Al Masih'],
  ['2025-06-01','Hari Lahir Pancasila'],
  ['2025-06-06','Hari Raya Idul Adha 1446 H'],
  ['2025-06-26','Tahun Baru Islam 1447 H'],
  ['2025-08-17','Hari Kemerdekaan Republik Indonesia'],
  ['2025-09-04','Maulid Nabi Muhammad SAW 1447 H'],
  ['2025-12-25','Hari Raya Natal'],
  ['2025-12-26','Cuti Bersama Natal'],
  // 2026
  ['2026-01-01','Tahun Baru Masehi 2026'],
  ['2026-01-16','Isra Miraj Nabi Muhammad SAW 1447 H'],
  ['2026-01-17','Cuti Bersama Isra Miraj'],
  ['2026-02-17','Tahun Baru Imlek 2577'],
  ['2026-03-19','Hari Raya Nyepi (Tahun Baru Saka 1948)'],
  ['2026-03-20','Hari Raya Idul Fitri 1447 H'],
  ['2026-03-21','Hari Raya Idul Fitri 1447 H (2)'],
  ['2026-03-23','Cuti Bersama Idul Fitri'],
  ['2026-03-24','Cuti Bersama Idul Fitri'],
  ['2026-04-03','Wafat Isa Al Masih'],
  ['2026-05-01','Hari Buruh Internasional'],
  ['2026-05-14','Kenaikan Isa Al Masih'],
  ['2026-05-21','Hari Raya Waisak 2570'],
  ['2026-06-01','Hari Lahir Pancasila'],
  ['2026-06-10','Hari Raya Idul Adha 1447 H'],  // estimasi
  ['2026-06-16','Tahun Baru Islam 1448 H'],      // estimasi
  ['2026-08-17','Hari Kemerdekaan Republik Indonesia'],
  ['2026-08-25','Maulid Nabi Muhammad SAW 1448 H'], // estimasi
  ['2026-12-25','Hari Raya Natal'],
  // 2027
  ['2027-01-01','Tahun Baru Masehi 2027'],
  ['2027-01-06','Isra Miraj Nabi Muhammad SAW 1448 H'], // estimasi
  ['2027-02-06','Tahun Baru Imlek 2578'],
  ['2027-03-09','Hari Raya Nyepi (Tahun Baru Saka 1949)'],
  ['2027-03-10','Hari Raya Idul Fitri 1448 H'], // estimasi
  ['2027-03-11','Hari Raya Idul Fitri 1448 H (2)'],
  ['2027-03-26','Wafat Isa Al Masih'],
  ['2027-05-01','Hari Buruh Internasional'],
  ['2027-05-06','Kenaikan Isa Al Masih'],
  ['2027-05-20','Hari Raya Idul Adha 1448 H'], // estimasi
  ['2027-06-01','Hari Lahir Pancasila'],
  ['2027-08-17','Hari Kemerdekaan Republik Indonesia'],
  ['2027-12-25','Hari Raya Natal'],
];

async function seedNasionalHolidays() {
  if (!confirm('Tambahkan/perbarui hari libur nasional Indonesia 2024–2027?')) return;
  toast('Menyegarkan hari libur nasional…', 'info');

  const records = NATIONAL_HOLIDAYS.map(([d, n]) => ({ holiday_date: d, name: n, holiday_type: 'national' }));
  const { error } = await db.from('holidays').upsert(records, { onConflict: 'holiday_date' });
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  toast(`${records.length} hari libur nasional 2024–2027 diperbarui ✅`, 'success');
  await loadHolidays(); loadLibur();
}

// ============================================================
// LAPORAN / EXPORT
// ============================================================
let lapPeriodMode = 'bulan';

function initLaporan() {
  const opts = appState.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const el   = document.getElementById('lap-class');
  if (el) el.innerHTML = `<option value="">Semua Kelas</option>` + opts;
}

function switchLapPeriod(mode, btn) {
  lapPeriodMode = mode;
  document.querySelectorAll('#page-laporan .period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('lap-month').style.display = mode === 'bulan' ? '' : 'none';
  document.getElementById('lap-custom-range').classList.toggle('hidden', mode !== 'custom');
}

async function doExportLaporan() {
  const classId  = document.getElementById('lap-class').value;
  const format   = document.getElementById('lap-format').value;
  const year     = document.getElementById('global-period-year').value;
  const semester = loadConfig().semester || 2;
  let start, end, periodLabel;

  if (lapPeriodMode === 'bulan') {
    const m = document.getElementById('lap-month').value;
    const r = getMonthRange(m); start = r.start; end = r.end; periodLabel = monthLabel(m);
  } else if (lapPeriodMode === 'semester') {
    const r = getSemesterRange(year, semester); start = r.start; end = r.end;
    periodLabel = `Semester ${semester} TA ${year}/${parseInt(year)+1}`;
  } else if (lapPeriodMode === 'tahun') {
    start = `${year}-01-01`; end = `${year}-12-31`;
    periodLabel = `Tahun Pelajaran ${year}/${parseInt(year)+1}`;
  } else {
    start = document.getElementById('lap-start').value;
    end   = document.getElementById('lap-end').value;
    if (!start || !end) { toast('Pilih tanggal awal dan akhir', 'error'); return; }
    periodLabel = `${start} s/d ${end}`;
  }

  toast('Menyiapkan export…', 'info');
  if (format === 'rekap')  await buildAndExportRekap(classId, start, end, periodLabel);
  if (format === 'detail') await exportDetailPerHari(classId, start, end, periodLabel);
  if (format === 'kelas')  await exportRekapPerKelas(classId, start, end, periodLabel);
}

async function exportDetailPerHari(classId, start, end, periodLabel) {
  let q = db.from('attendance').select('*, students(name, nis, class_name)')
    .gte('attendance_date', start).lte('attendance_date', end).order('attendance_date');
  if (classId) q = q.eq('class_id', classId);
  const { data } = await q;

  const sName     = loadConfig().schoolName || 'Sekolah';
  const stLbl     = { H:'Hadir', S:'Sakit', I:'Izin', A:'Alpha', T:'Terlambat' };
  const daysName  = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const header    = [
    ['DETAIL ABSENSI HARIAN'],
    [sName],
    [`Periode: ${periodLabel}`],
    [],
    ['No','Tanggal','Hari','NIS','Nama Siswa','Kelas','Status','Masuk','Pulang','Terlambat (mnt)','Keterangan'],
  ];
  const rows = (data||[]).map((a,i) => [
    i+1, a.attendance_date, daysName[new Date(a.attendance_date+'T00:00:00').getDay()],
    a.students?.nis||'', a.students?.name||'', a.students?.class_name||'',
    stLbl[a.status]||a.status, a.check_in||'', a.check_out||'', a.late_minutes||0, a.notes||'',
  ]);
  exportToXlsx([{ name: 'Detail Harian', data: [...header, ...rows], headerRow: 5 }],
    `Detail_Harian_${periodLabel.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`);
}

async function exportRekapPerKelas(classId, start, end, periodLabel) {
  const clsList  = classId ? appState.classes.filter(c => c.id === classId) : appState.classes;
  const effDays  = countEffectiveDays(start, end);
  const sName    = loadConfig().schoolName || 'Sekolah';
  const sheets   = [];

  for (const cls of clsList) {
    const { data: students } = await db.from('students').select('*').eq('class_id', cls.id).eq('is_active', true).order('name');
    const { data: atts }     = await db.from('attendance').select('*').eq('class_id', cls.id)
      .gte('attendance_date', start).lte('attendance_date', end);

    const byStu = {};
    (atts||[]).forEach(r => {
      if (!byStu[r.student_id]) byStu[r.student_id] = { H:0,S:0,I:0,A:0,T:0,lateMins:0 };
      byStu[r.student_id][r.status]++;
      byStu[r.student_id].lateMins += (r.late_minutes||0);
    });

    const header = [
      [`REKAP ABSENSI KELAS ${cls.name}`],
      [`${sName}   |   Periode: ${periodLabel}   |   Hari Efektif: ${effDays}`],
      [`Wali Kelas: ${cls.homeroom_teacher || '—'}`],
      [],
      ['No','NIS','Nama Siswa','Hadir','Sakit','Izin','Alpha','Terlambat','% Hadir','Terlambat (mnt)'],
    ];
    const rows = (students||[]).map((s,i) => {
      const st    = byStu[s.id] || { H:0,S:0,I:0,A:0,T:0,lateMins:0 };
      const hadir = st.H + st.T;
      return [i+1, s.nis||'', s.name, st.H, st.S, st.I, st.A, st.T,
        `${effDays ? Math.round(hadir/effDays*100) : 0}%`, st.lateMins];
    });
    sheets.push({ name: cls.name.slice(0,31), data: [...header, ...rows], headerRow: 5 });
  }
  exportToXlsx(sheets, `Rekap_Kelas_${periodLabel.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`);
}

// ============================================================
// EXCEL EXPORT ENGINE (SheetJS + styling)
// ============================================================
function exportToXlsx(sheets, filename) {
  const wb = XLSX.utils.book_new();

  sheets.forEach(({ name, data, headerRow }) => {
    const ws = XLSX.utils.aoa_to_sheet(data);

    if (headerRow) {
      const hRow = headerRow - 1; // 0-based
      const cols = (data[hRow] || []).length;

      // Header row: biru tua, teks putih
      for (let c = 0; c < cols; c++) {
        const ref = XLSX.utils.encode_cell({ r: hRow, c });
        if (!ws[ref]) ws[ref] = { v: '', t: 's' };
        ws[ref].s = {
          fill: { fgColor: { rgb: '1E3A8A' } },
          font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 11, name: 'Arial' },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: { bottom: { style: 'thin', color: { rgb: 'FFFFFF' } } },
        };
      }

      // Data rows: alternating shading
      for (let r = headerRow; r < data.length; r++) {
        for (let c = 0; c < cols; c++) {
          const ref = XLSX.utils.encode_cell({ r, c });
          if (!ws[ref]) ws[ref] = { v: '', t: 's' };
          ws[ref].s = {
            fill: r % 2 === 0
              ? { fgColor: { rgb: 'EFF6FF' } }  // biru muda
              : { fgColor: { rgb: 'FFFFFF' } },
            font: { sz: 10, name: 'Arial' },
            alignment: { vertical: 'center' },
          };
        }
      }
    }

    // Judul / header bebas: bold
    for (let r = 0; r < (headerRow||1) - 1; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: 0 });
      if (ws[ref]) ws[ref].s = { font: { bold: true, sz: r === 0 ? 13 : 11, name: 'Arial' } };
    }

    // Auto column width
    const colW = [];
    data.forEach(row => (row||[]).forEach((v, c) => {
      colW[c] = Math.max(colW[c]||0, Math.min(String(v||'').length + 3, 45));
    }));
    ws['!cols'] = colW.map(w => ({ wch: Math.max(w, 8) }));
    if (headerRow) ws['!rows'] = Array.from({ length: headerRow }, (_, i) => i === headerRow-1 ? { hpt: 20 } : {});

    XLSX.utils.book_append_sheet(wb, ws, String(name).slice(0, 31));
  });

  XLSX.writeFile(wb, filename, { bookSST: false, cellStyles: true });
  toast(`📥 ${filename} berhasil diunduh`, 'success');
}

// ============================================================
// BACKUP & RESTORE
// ============================================================
async function doBackup() {
  const type = document.getElementById('backup-type').value;
  if (!db) { toast('Supabase belum terkoneksi', 'error'); return; }
  toast('Menyiapkan backup…', 'info');

  const backup = { version: 2, type, timestamp: new Date().toISOString(), school: loadConfig().schoolName || '' };

  if (type === 'full' || type === 'students') {
    const { data: students } = await db.from('students').select('*');
    const { data: classes  } = await db.from('classes').select('*');
    backup.students = students || [];
    backup.classes  = classes  || [];
  }
  if (type === 'full' || type === 'attendance') {
    const { data: att } = await db.from('attendance').select('*').order('attendance_date');
    const { data: hol } = await db.from('holidays').select('*');
    backup.attendance = att || [];
    backup.holidays   = hol || [];
  }

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `backup_absen9_${type}_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  await db.from('backup_logs').insert({
    backup_type: type,
    record_count: (backup.attendance||[]).length + (backup.students||[]).length,
  });
  document.getElementById('backup-history').innerHTML =
    `<div class="chip tag-green">✅ Terakhir backup: ${new Date().toLocaleString('id-ID')} (${type})</div>`;
  toast('Backup berhasil diunduh ✅', 'success');
}

async function handleRestore(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    window._restoreData = data; // FIX: simpan di window, bukan inline onclick

    document.getElementById('restore-preview').classList.remove('hidden');
    document.getElementById('restore-preview').innerHTML = `
      <div class="card" style="padding:16px">
        <div class="text-sm font-bold mb-2">📦 Info File Backup</div>
        <div class="text-sm">Sekolah: <strong>${data.school||'—'}</strong></div>
        <div class="text-sm">Tipe: <strong>${data.type||'—'}</strong></div>
        <div class="text-sm">Waktu: <strong>${data.timestamp ? new Date(data.timestamp).toLocaleString('id-ID') : '—'}</strong></div>
        <div class="text-sm">Siswa: <strong>${data.students?.length || 0}</strong> &nbsp; Absensi: <strong>${data.attendance?.length || 0}</strong></div>
        <div class="divider"></div>
        <p class="text-sm" style="color:var(--red)">⚠️ Restore akan menimpa data yang ada!</p>
        <button class="btn btn-danger mt-2" onclick="confirmRestore()">⚠️ Restore Sekarang</button>
      </div>`;
  } catch (e) {
    toast('File backup tidak valid: ' + e.message, 'error');
  }
}

async function confirmRestore() {
  // FIX: Ambil dari window, bukan parameter inline
  const data = window._restoreData;
  if (!data) return;
  if (!confirm('Yakin restore? Data saat ini akan ditimpa!')) return;

  toast('Memulai restore…', 'info');
  const chunk = 100;

  if (data.classes?.length)
    await db.from('classes').upsert(data.classes, { onConflict: 'id' });

  if (data.students?.length)
    for (let i = 0; i < data.students.length; i += chunk)
      await db.from('students').upsert(data.students.slice(i, i+chunk), { onConflict: 'id' });

  if (data.attendance?.length)
    for (let i = 0; i < data.attendance.length; i += chunk)
      await db.from('attendance').upsert(data.attendance.slice(i, i+chunk), { onConflict: 'id' });

  if (data.holidays?.length)
    await db.from('holidays').upsert(data.holidays, { onConflict: 'holiday_date' });

  toast('Restore berhasil ✅', 'success');
  window._restoreData = null;
  await bootstrap();
}

// ============================================================
// SETTINGS
// ============================================================
async function saveSchoolInfo() {
  const name = document.getElementById('cfg-school-name').value.trim();
  const addr = document.getElementById('cfg-school-addr').value.trim();
  saveLocalConfig({ ...loadConfig(), schoolName: name, schoolAddr: addr });
  document.getElementById('school-name-sidebar').textContent = name || 'RekapAbsen';
  if (db) {
    await db.from('schools').update({ name, address: addr })
      .neq('id', '00000000-0000-0000-0000-000000000000');
  }
  toast('Info sekolah tersimpan ✅', 'success');
}

async function saveTimeConfig() {
  const year     = document.getElementById('cfg-year').value;
  const semester = document.getElementById('cfg-semester').value;
  const lateTime = document.getElementById('cfg-late-time').value;
  const outTime  = document.getElementById('cfg-out-time').value;
  saveLocalConfig({ ...loadConfig(), year, semester, lateTime, outTime });
  appState.lateThreshold         = lateTime;
  appState.earlyLeaveThreshold   = outTime;
  toast('Pengaturan waktu tersimpan ✅', 'success');
}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navigate(item.dataset.page));
});

document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });
});

// Escape key menutup modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
  }
});

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const ahDate = document.getElementById('ah-date');
  if (ahDate) ahDate.value = todayISO();
  bootstrap();
});
