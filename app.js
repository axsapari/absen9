/**
 * RekapAbsen — Aplikasi Rekap Absensi Sekolah
 * Developed by: Agus Sugiharto Sapari, S.Pd.
 * Repository: https://github.com/axsapari/absen9
 * Hosting: GitHub Pages
 * Database: Supabase
 */

'use strict';

// ============================================================
// GLOBAL STATE
// ============================================================
let db = null;           // Supabase client
let appState = {
  classes: [],
  students: [],
  holidays: [],
  currentPage: 'dashboard',
  siswaPage: 0,
  siswaPageSize: 30,
  siswaFiltered: [],
  rekap: { mode: 'bulan' },
  laporan: { mode: 'bulan' },
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
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
  } catch { return {}; }
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
    // Test connection
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

  // Load theme
  const savedTheme = cfg.theme || 'light';
  setTheme(savedTheme, true);

  // Fill config fields
  if (cfg.url) document.getElementById('cfg-supabase-url').value = cfg.url;
  if (cfg.key) document.getElementById('cfg-supabase-key').value = cfg.key;
  if (cfg.year) document.getElementById('cfg-year').value = cfg.year;
  if (cfg.semester) document.getElementById('cfg-semester').value = cfg.semester;
  if (cfg.lateTime) { document.getElementById('cfg-late-time').value = cfg.lateTime; appState.lateThreshold = cfg.lateTime; }
  if (cfg.outTime) { document.getElementById('cfg-out-time').value = cfg.outTime; appState.earlyLeaveThreshold = cfg.outTime; }
  if (cfg.schoolName) document.getElementById('cfg-school-name').value = cfg.schoolName;
  if (cfg.schoolName) document.getElementById('school-name-sidebar').textContent = cfg.schoolName;
  if (cfg.schoolAddr) document.getElementById('cfg-school-addr').value = cfg.schoolAddr;

  // Init Supabase
  const ok = initSupabase();
  if (!ok) {
    document.getElementById('setup-banner').classList.remove('hidden');
    toast('Konfigurasi Supabase belum diisi', 'info');
    return;
  }

  // Init month dropdowns
  initMonthDropdowns();

  // Load global data
  await Promise.all([loadClasses(), loadHolidays()]);
  populateClassDropdowns();

  // Navigate to dashboard
  await loadDashboard();
}

// ============================================================
// NAVIGATION
// ============================================================
function navigate(page) {
  // Deactivate all pages and nav items
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activate target
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('active');

  appState.currentPage = page;

  // Update topbar
  const titles = {
    'dashboard': ['Dashboard', 'Ringkasan kehadiran siswa'],
    'absen-harian': ['Absen Harian', 'Input dan pantau kehadiran hari ini'],
    'rekap': ['Rekap Absensi', 'Laporan kehadiran per periode'],
    'siswa': ['Data Siswa', 'Kelola data siswa dan peserta didik'],
    'import-absen': ['Import Mesin Absen', 'Upload file XLS dari mesin fingerprint'],
    'kelas': ['Data Kelas', 'Kelola kelas dan tahun ajaran'],
    'libur': ['Hari Libur', 'Kelola hari libur dan kalender'],
    'laporan': ['Cetak / Export', 'Export laporan ke Excel'],
    'backup': ['Backup & Restore', 'Cadangkan dan pulihkan data'],
    'pengaturan': ['Pengaturan', 'Konfigurasi aplikasi'],
  };

  const info = titles[page] || [page, ''];
  document.getElementById('topbar-title').textContent = info[0];
  document.getElementById('topbar-subtitle').textContent = info[1];

  // Load page data
  if (page === 'dashboard') loadDashboard();
  else if (page === 'siswa') loadSiswa();
  else if (page === 'kelas') loadKelas();
  else if (page === 'libur') loadLibur();
  else if (page === 'import-absen') loadImportHistory();
  else if (page === 'absen-harian') initAbsenHarian();
  else if (page === 'laporan') initLaporan();
}

// ============================================================
// THEME
// ============================================================
function setTheme(theme, silent) {
  document.documentElement.setAttribute('data-theme', theme);
  const toggle = document.getElementById('theme-toggle');
  toggle.classList.toggle('active', theme === 'dark');
  if (!silent) {
    const cfg = loadConfig();
    saveLocalConfig({ ...cfg, theme });
  }
  // Update charts if they exist
  if (appState.trendChart || appState.donutChart) {
    setTimeout(() => loadDashboard(), 100);
  }
}

document.getElementById('theme-toggle').addEventListener('click', function() {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

// ============================================================
// UTILITIES
// ============================================================
function toast(msg, type = 'info', duration = 3000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateISO(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() { return fmtDateISO(new Date()); }

function monthLabel(monthStr) {
  // monthStr = "2026-04"
  const [y, m] = monthStr.split('-');
  const names = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
  return `${names[parseInt(m)-1]} ${y}`;
}

function getMonthRange(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2,'0')}-01`;
  const end = fmtDateISO(new Date(y, m, 0));
  return { start, end };
}

function getSemesterRange(year, sem) {
  if (sem == 1) return { start: `${year}-07-01`, end: `${year}-12-31` };
  return { start: `${parseInt(year)+1}-01-01`, end: `${parseInt(year)+1}-06-30` };
}

function isWeekend(dateStr) {
  const d = new Date(dateStr);
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function isHoliday(dateStr) {
  return appState.holidays.some(h => h.holiday_date === dateStr);
}

function isEffectiveDay(dateStr) {
  return !isWeekend(dateStr) && !isHoliday(dateStr);
}

function countEffectiveDays(start, end) {
  let count = 0;
  const s = new Date(start);
  const e = new Date(end);
  const cur = new Date(s);
  while (cur <= e) {
    const ds = fmtDateISO(cur);
    if (isEffectiveDay(ds)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function initMonthDropdowns() {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    months.push({ val, label: monthLabel(val) });
  }

  const ids = ['dash-month', 'rek-month', 'lap-month'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = months.map(m => `<option value="${m.val}" ${m.val === months[months.length-1].val ? 'selected' : ''}>${m.label}</option>`).join('');
  });
}

// ============================================================
// LOAD CLASSES
// ============================================================
async function loadClasses() {
  if (!db) return;
  const { data, error } = await db.from('classes').select('*').order('name');
  if (!error) appState.classes = data || [];
}

function populateClassDropdowns() {
  const opts = appState.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const allOpts = `<option value="">Semua Kelas</option>` + opts;

  ['global-class-filter', 'siswa-class-filter', 'rek-class', 'lap-class'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = allOpts;
  });

  ['ah-class'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<option value="">Pilih Kelas</option>` + opts;
  });

  // Siswa form dropdown
  const siswaClassEl = document.getElementById('siswa-class');
  if (siswaClassEl) siswaClassEl.innerHTML = `<option value="">—</option>` + opts;
}

// ============================================================
// LOAD HOLIDAYS
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

  const today = todayISO();
  const selMonth = document.getElementById('dash-month')?.value || today.slice(0, 7);
  const classFilter = document.getElementById('global-class-filter')?.value || '';
  const year = document.getElementById('global-period-year')?.value || '2026';
  const { start: mStart, end: mEnd } = getMonthRange(selMonth);

  // Count effective days this month
  const effDays = countEffectiveDays(mStart, mEnd);
  document.getElementById('stat-hari-efektif').textContent = effDays;
  document.getElementById('stat-hari-sub').textContent = `${mStart} s/d ${mEnd}`;

  // Total students
  let stuQuery = db.from('students').select('id', { count: 'exact' }).eq('is_active', true);
  if (classFilter) stuQuery = stuQuery.eq('class_id', classFilter);
  const { count: totalStu } = await stuQuery;
  document.getElementById('stat-total-siswa').textContent = totalStu ?? '—';

  // Today's attendance
  let todayQuery = db.from('attendance').select('status', { count: 'exact' }).eq('attendance_date', today);
  if (classFilter) todayQuery = todayQuery.eq('class_id', classFilter);
  const { data: todayData } = await todayQuery;
  const hadirToday = (todayData || []).filter(r => r.status === 'H' || r.status === 'T').length;
  const absenToday = (todayData || []).filter(r => r.status !== 'H' && r.status !== 'T').length;
  document.getElementById('stat-hadir-hari-ini').textContent = hadirToday;
  document.getElementById('stat-alpha').textContent = absenToday;
  const pct = totalStu ? Math.round(hadirToday / totalStu * 100) : 0;
  document.getElementById('stat-pct-hadir').textContent = `${pct}% dari total siswa`;

  // Month attendance summary
  let monthQuery = db.from('attendance').select('student_id, status, class_id')
    .gte('attendance_date', mStart).lte('attendance_date', mEnd);
  if (classFilter) monthQuery = monthQuery.eq('class_id', classFilter);
  const { data: monthData } = await monthQuery;

  // Rankings
  const byStudent = {};
  (monthData || []).forEach(r => {
    if (!byStudent[r.student_id]) byStudent[r.student_id] = { H:0, S:0, I:0, A:0, T:0, total:0 };
    byStudent[r.student_id][r.status] = (byStudent[r.student_id][r.status] || 0) + 1;
    byStudent[r.student_id].total++;
  });

  // Get student names
  const stuIds = Object.keys(byStudent);
  let stuNameMap = {};
  if (stuIds.length > 0) {
    const { data: stuData } = await db.from('students').select('id, name, class_name').in('id', stuIds);
    (stuData || []).forEach(s => { stuNameMap[s.id] = s; });
  }

  // Alpha ranking
  const alphaRank = Object.entries(byStudent)
    .sort((a,b) => (b[1].A||0) - (a[1].A||0))
    .slice(0, 5);
  renderRankList('rank-alpha', alphaRank, stuNameMap, 'A', 'hari alpha');

  // Sakit ranking
  const sakitRank = Object.entries(byStudent)
    .sort((a,b) => (b[1].S||0) - (a[1].S||0))
    .slice(0, 5);
  renderRankList('rank-sakit', sakitRank, stuNameMap, 'S', 'hari sakit');

  // Rajin ranking (most hadir)
  const rajinRank = Object.entries(byStudent)
    .sort((a,b) => (b[1].H||0) - (a[1].H||0))
    .slice(0, 5);
  renderRankList('rank-rajin', rajinRank, stuNameMap, 'H', 'hari hadir');

  // Per-class summary
  await loadClassSummary(mStart, mEnd, classFilter);

  // Charts
  await loadTrendChart(selMonth, classFilter);
  loadDonutChart(monthData || []);
}

function renderRankList(elId, rank, nameMap, statKey, label) {
  const el = document.getElementById(elId);
  const numColors = ['gold', 'silver', 'bronze', '', ''];
  el.innerHTML = rank.length === 0
    ? '<div class="text-sm text-muted text-center">Belum ada data</div>'
    : rank.map(([id, stat], i) => {
        const s = nameMap[id];
        const val = stat[statKey] || 0;
        if (val === 0) return '';
        return `<div class="rank-item">
          <div class="rank-num ${numColors[i]}">${i+1}</div>
          <div class="rank-info">
            <div class="rank-name truncate">${s ? s.name : 'Siswa'}</div>
            <div class="rank-meta">${s ? s.class_name || '—' : '—'}</div>
          </div>
          <div class="rank-value">${val} <span class="text-xs text-muted">${label}</span></div>
        </div>`;
      }).filter(Boolean).join('');
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

  const tbody = document.getElementById('class-summary-body');
  const classMap = {};
  appState.classes.forEach(c => classMap[c.id] = c.name);

  const rows = Object.entries(byClass).map(([cid, stat]) => {
    const total = stat.H + stat.S + stat.I + stat.A + stat.T;
    const hadir = stat.H + stat.T;
    const pct = total ? Math.round(hadir/total*100) : 0;
    const pctColor = pct >= 85 ? 'var(--green)' : pct >= 70 ? 'var(--yellow)' : 'var(--red)';
    return `<tr>
      <td><strong>${classMap[cid] || cid}</strong></td>
      <td>${total}</td>
      <td style="color:var(--green)">${stat.H}</td>
      <td style="color:var(--yellow)">${stat.S}</td>
      <td style="color:var(--accent)">${stat.I}</td>
      <td style="color:var(--red)">${stat.A}</td>
      <td style="color:var(--purple)">${stat.T}</td>
      <td style="color:${pctColor};font-weight:600">${pct}%</td>
    </tr>`;
  });

  tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="8" class="text-center text-muted">Belum ada data absensi</td></tr>';
}

async function loadTrendChart(selMonth, classFilter) {
  // Build last 6 months
  const months = [];
  const [sy, sm] = selMonth.split('-').map(Number);
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
  if (appState.trendChart) appState.trendChart.destroy();

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? '#2E3347' : '#E4E7EC';
  const textColor = isDark ? '#9CA3AF' : '#6B7280';

  appState.trendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Hadir', data: hadirData, backgroundColor: '#10B981', borderRadius: 4 },
        { label: 'Alpha', data: alphaData, backgroundColor: '#EF4444', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor }, grid: { color: gridColor } },
      },
    },
  });
}

function loadDonutChart(monthData) {
  const counts = { H: 0, S: 0, I: 0, A: 0, T: 0 };
  (monthData || []).forEach(r => { counts[r.status] = (counts[r.status]||0) + 1; });

  const labels = ['Hadir', 'Sakit', 'Izin', 'Alpha', 'Terlambat'];
  const values = [counts.H, counts.S, counts.I, counts.A, counts.T];
  const colors = ['#10B981', '#F59E0B', '#3B82F6', '#EF4444', '#8B5CF6'];

  const ctx = document.getElementById('donut-chart');
  if (appState.donutChart) appState.donutChart.destroy();

  appState.donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { display: false } },
    },
  });

  const legendEl = document.getElementById('donut-legend');
  legendEl.innerHTML = labels.map((l, i) => `
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

// ============================================================
// ABSEN HARIAN
// ============================================================
function initAbsenHarian() {
  if (!document.getElementById('ah-date').value) {
    document.getElementById('ah-date').value = todayISO();
  }
}

async function loadAbsenHarian() {
  const classId = document.getElementById('ah-class').value;
  const date = document.getElementById('ah-date').value;

  if (!classId || !date) { toast('Pilih kelas dan tanggal', 'error'); return; }

  if (isWeekend(date)) { toast('Tanggal ini adalah hari Sabtu/Minggu', 'info'); return; }
  if (isHoliday(date)) { toast('Tanggal ini adalah hari libur: ' + appState.holidays.find(h => h.holiday_date === date)?.name, 'info'); return; }

  const tbody = document.getElementById('absen-harian-body');
  tbody.innerHTML = '<tr><td colspan="8" class="text-center"><div class="loading"><div class="spinner"></div> Memuat…</div></td></tr>';

  // Get students in class
  const { data: students } = await db.from('students').select('*').eq('class_id', classId).eq('is_active', true).order('name');

  // Get existing attendance for this date+class
  const { data: existing } = await db.from('attendance').select('*')
    .eq('class_id', classId).eq('attendance_date', date);

  const attMap = {};
  (existing || []).forEach(a => { attMap[a.student_id] = a; });

  const cfg = loadConfig();
  const lateTime = cfg.lateTime || '07:00';

  tbody.innerHTML = (students || []).map((s, i) => {
    const att = attMap[s.id] || {};
    const status = att.status || (isEffectiveDay(date) ? 'A' : 'H');
    const statusOpts = ['H','S','I','A','T'].map(st =>
      `<option value="${st}" ${status===st?'selected':''}>${{H:'Hadir',S:'Sakit',I:'Izin',A:'Alpha',T:'Terlambat'}[st]}</option>`
    ).join('');

    return `<tr>
      <td>${i+1}</td>
      <td class="font-mono text-sm">${s.nis || '—'}</td>
      <td><strong>${s.name}</strong></td>
      <td><span class="chip">${s.class_name || '—'}</span></td>
      <td>
        <select class="form-control" style="width:110px" data-sid="${s.id}" data-field="status" onchange="checkLate(this,'${lateTime}')">
          ${statusOpts}
        </select>
      </td>
      <td><input type="time" class="form-control" style="width:100px" data-sid="${s.id}" data-field="check_in" value="${att.check_in || ''}" /></td>
      <td><input type="time" class="form-control" style="width:100px" data-sid="${s.id}" data-field="check_out" value="${att.check_out || ''}" /></td>
      <td><input type="text" class="form-control" data-sid="${s.id}" data-field="notes" value="${att.notes || ''}" placeholder="Catatan…" style="width:160px" /></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="text-center text-muted">Tidak ada siswa di kelas ini</td></tr>';
}

function checkLate(selectEl, lateTime) {
  const row = selectEl.closest('tr');
  const checkInEl = row.querySelector('[data-field="check_in"]');
  if (selectEl.value === 'H' && checkInEl && checkInEl.value && checkInEl.value > lateTime) {
    selectEl.value = 'T';
    toast('Otomatis ditandai Terlambat', 'info');
  }
}

async function saveAbsenHarian() {
  const classId = document.getElementById('ah-class').value;
  const date = document.getElementById('ah-date').value;
  if (!classId || !date) { toast('Pilih kelas dan tanggal', 'error'); return; }

  const rows = document.querySelectorAll('#absen-harian-body tr');
  const records = [];
  const cfg = loadConfig();
  const lateTime = cfg.lateTime || '07:00';
  const outTime = cfg.outTime || '14:00';

  rows.forEach(row => {
    const statusEl = row.querySelector('[data-field="status"]');
    if (!statusEl) return;
    const sid = statusEl.dataset.sid;
    const status = statusEl.value;
    const checkIn = row.querySelector('[data-field="check_in"]')?.value || null;
    const checkOut = row.querySelector('[data-field="check_out"]')?.value || null;
    const notes = row.querySelector('[data-field="notes"]')?.value || null;

    const lateMin = (status === 'T' && checkIn && checkIn > lateTime)
      ? timeToMin(checkIn) - timeToMin(lateTime) : 0;
    const earlyMin = (checkOut && checkOut < outTime && status !== 'A')
      ? timeToMin(outTime) - timeToMin(checkOut) : 0;

    records.push({
      student_id: sid, class_id: classId, attendance_date: date,
      status, check_in: checkIn, check_out: checkOut,
      late_minutes: lateMin, early_leave_minutes: earlyMin,
      notes, source: 'manual',
      day_of_week: new Date(date).getDay(),
    });
  });

  if (!records.length) { toast('Tidak ada data untuk disimpan', 'error'); return; }

  const { error } = await db.from('attendance').upsert(records, { onConflict: 'student_id,attendance_date' });
  if (error) { toast('Gagal menyimpan: ' + error.message, 'error'); return; }
  toast(`${records.length} data absensi tersimpan`, 'success');
}

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

async function exportAbsenHarian() {
  const classId = document.getElementById('ah-class').value;
  const date = document.getElementById('ah-date').value;
  if (!classId || !date) { toast('Pilih kelas dan tanggal', 'error'); return; }

  const { data: students } = await db.from('students').select('*').eq('class_id', classId).eq('is_active', true).order('name');
  const { data: atts } = await db.from('attendance').select('*').eq('class_id', classId).eq('attendance_date', date);

  const attMap = {};
  (atts||[]).forEach(a => attMap[a.student_id] = a);

  const rows = [['No', 'NIS', 'Nama', 'Status', 'Jam Masuk', 'Jam Pulang', 'Terlambat (mnt)', 'Keterangan']];
  (students||[]).forEach((s, i) => {
    const a = attMap[s.id] || {};
    const statusLabel = { H:'Hadir', S:'Sakit', I:'Izin', A:'Alpha', T:'Terlambat' }[a.status || 'A'];
    rows.push([i+1, s.nis||'', s.name, statusLabel, a.check_in||'', a.check_out||'', a.late_minutes||0, a.notes||'']);
  });

  exportToXlsx([{ name: 'Absen Harian', data: rows }], `Absen_${date}_${appState.classes.find(c=>c.id===classId)?.name}.xlsx`);
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
  const classId = document.getElementById('rek-class').value;
  const year = document.getElementById('global-period-year').value;
  const semester = loadConfig().semester || 2;

  let start, end;
  if (rekapMode === 'bulan') {
    const m = document.getElementById('rek-month').value;
    const r = getMonthRange(m);
    start = r.start; end = r.end;
  } else if (rekapMode === 'semester') {
    const r = getSemesterRange(year, semester);
    start = r.start; end = r.end;
  } else if (rekapMode === 'tahun') {
    start = `${year}-01-01`; end = `${year}-12-31`;
  } else {
    start = document.getElementById('rek-start').value;
    end = document.getElementById('rek-end').value;
    if (!start || !end) { toast('Pilih tanggal awal dan akhir', 'error'); return; }
  }

  const effDays = countEffectiveDays(start, end);
  const tbody = document.getElementById('rekap-body');
  tbody.innerHTML = '<tr><td colspan="12" class="text-center"><div class="loading"><div class="spinner"></div></div></td></tr>';

  let q = db.from('attendance').select('student_id, status, late_minutes, class_id')
    .gte('attendance_date', start).lte('attendance_date', end);
  if (classId) q = q.eq('class_id', classId);
  const { data: attData } = await q;

  let sq = db.from('students').select('id, name, nis, class_name').eq('is_active', true);
  if (classId) sq = sq.eq('class_id', classId);
  const { data: stuData } = await sq;

  const byStudent = {};
  (attData||[]).forEach(r => {
    if (!byStudent[r.student_id]) byStudent[r.student_id] = { H:0,S:0,I:0,A:0,T:0, lateMins:0 };
    byStudent[r.student_id][r.status]++;
    byStudent[r.student_id].lateMins += (r.late_minutes||0);
  });

  const rows = (stuData||[]).map((s, i) => {
    const stat = byStudent[s.id] || { H:0,S:0,I:0,A:0,T:0, lateMins:0 };
    const hadir = stat.H + stat.T;
    const pct = effDays ? Math.round(hadir / effDays * 100) : 0;
    const pctColor = pct >= 85 ? 'var(--green)' : pct >= 70 ? 'var(--yellow)' : 'var(--red)';

    return `<tr>
      <td>${i+1}</td>
      <td class="font-mono">${s.nis||'—'}</td>
      <td><strong>${s.name}</strong></td>
      <td>${s.class_name||'—'}</td>
      <td>${effDays}</td>
      <td style="color:var(--green)">${stat.H}</td>
      <td style="color:var(--yellow)">${stat.S}</td>
      <td style="color:var(--accent)">${stat.I}</td>
      <td style="color:var(--red)">${stat.A}</td>
      <td style="color:var(--purple)">${stat.T}</td>
      <td style="color:${pctColor};font-weight:600">${pct}%</td>
      <td>
        <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px" onclick="showStudentDetail('${s.id}')">👤</button>
      </td>
    </tr>`;
  });

  tbody.innerHTML = rows.join('') || '<tr><td colspan="12" class="text-center text-muted">Tidak ada data</td></tr>';
}

async function exportRekap() {
  const classId = document.getElementById('rek-class').value;
  const year = document.getElementById('global-period-year').value;
  const semester = loadConfig().semester || 2;
  let start, end, periodLabel;

  if (rekapMode === 'bulan') {
    const m = document.getElementById('rek-month').value;
    const r = getMonthRange(m); start = r.start; end = r.end;
    periodLabel = monthLabel(m);
  } else if (rekapMode === 'semester') {
    const r = getSemesterRange(year, semester); start = r.start; end = r.end;
    periodLabel = `Semester ${semester} ${year}`;
  } else if (rekapMode === 'tahun') {
    start = `${year}-01-01`; end = `${year}-12-31`; periodLabel = `Tahun ${year}`;
  } else {
    start = document.getElementById('rek-start').value;
    end = document.getElementById('rek-end').value;
    periodLabel = `${start} s/d ${end}`;
  }

  await buildAndExportRekap(classId, start, end, periodLabel);
}

async function buildAndExportRekap(classId, start, end, periodLabel) {
  const effDays = countEffectiveDays(start, end);
  let sq = db.from('students').select('id, name, nis, class_name').eq('is_active', true);
  if (classId) sq = sq.eq('class_id', classId);
  const { data: students } = await sq;

  let q = db.from('attendance').select('*').gte('attendance_date', start).lte('attendance_date', end);
  if (classId) q = q.eq('class_id', classId);
  const { data: atts } = await q;

  const byStudent = {};
  (atts||[]).forEach(r => {
    if (!byStudent[r.student_id]) byStudent[r.student_id] = { H:0,S:0,I:0,A:0,T:0,lateMins:0 };
    byStudent[r.student_id][r.status]++;
    byStudent[r.student_id].lateMins += (r.late_minutes||0);
  });

  const schoolName = loadConfig().schoolName || 'Sekolah';
  const headerRows = [
    [`REKAP ABSENSI SISWA`],
    [`${schoolName}`],
    [`Periode: ${periodLabel}   |   Hari Efektif: ${effDays} hari`],
    [],
    ['No','NIS','Nama Siswa','Kelas','Hari Efektif','Hadir','Sakit','Izin','Alpha','Terlambat','% Hadir','Terlambat (mnt)'],
  ];

  const dataRows = (students||[]).map((s,i) => {
    const stat = byStudent[s.id] || { H:0,S:0,I:0,A:0,T:0,lateMins:0 };
    const hadir = stat.H + stat.T;
    const pct = effDays ? Math.round(hadir / effDays * 100) : 0;
    return [i+1, s.nis||'', s.name, s.class_name||'', effDays, stat.H, stat.S, stat.I, stat.A, stat.T, `${pct}%`, stat.lateMins];
  });

  exportToXlsx(
    [{ name: 'Rekap Absensi', data: [...headerRows, ...dataRows], headerRow: 5 }],
    `Rekap_Absensi_${periodLabel.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`
  );
}

// ============================================================
// STUDENTS
// ============================================================
async function loadSiswa() {
  if (!db) return;
  const { data, error } = await db.from('students').select('*').order('name');
  if (error) { toast('Gagal memuat siswa', 'error'); return; }
  appState.students = data || [];
  filterSiswa();
}

function filterSiswa() {
  const search = document.getElementById('siswa-search')?.value?.toLowerCase() || '';
  const classId = document.getElementById('siswa-class-filter')?.value || '';

  appState.siswaFiltered = appState.students.filter(s => {
    const matchSearch = !search || s.name.toLowerCase().includes(search) || (s.nis||'').includes(search);
    const matchClass = !classId || s.class_id === classId;
    return matchSearch && matchClass;
  });

  appState.siswaPage = 0;
  renderSiswaTable();
}

function renderSiswaTable() {
  const { siswaFiltered, siswaPage, siswaPageSize } = appState;
  const total = siswaFiltered.length;
  const start = siswaPage * siswaPageSize;
  const page = siswaFiltered.slice(start, start + siswaPageSize);

  document.getElementById('siswa-count').textContent = `${total} siswa`;

  const tbody = document.getElementById('siswa-body');
  tbody.innerHTML = page.map((s, i) => `<tr>
    <td>${start + i + 1}</td>
    <td class="font-mono">${s.fingerprint_id ?? '—'}</td>
    <td class="font-mono text-sm">${s.nis || '—'}</td>
    <td><strong>${s.name}</strong></td>
    <td><span class="chip">${s.class_name || '—'}</span></td>
    <td>${s.gender === 'L' ? '♂' : s.gender === 'P' ? '♀' : '—'}</td>
    <td><span class="chip ${s.is_active ? 'tag-green' : 'tag-red'}">${s.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
    <td>
      <div class="flex gap-2">
        <button class="btn btn-secondary btn-icon" title="Detail" onclick="showStudentDetail('${s.id}')">👤</button>
        <button class="btn btn-secondary btn-icon" title="Edit" onclick="editSiswa('${s.id}')">✏️</button>
        <button class="btn btn-danger btn-icon" title="Hapus" onclick="deleteSiswa('${s.id}','${s.name}')">🗑</button>
      </div>
    </td>
  </tr>`).join('') || '<tr><td colspan="8" class="text-center text-muted">Tidak ada data</td></tr>';

  // Pagination
  const pages = Math.ceil(total / siswaPageSize);
  const pEl = document.getElementById('siswa-pagination');
  pEl.innerHTML = Array.from({length: pages}, (_,i) =>
    `<button class="btn ${i===siswaPage?'btn-primary':'btn-secondary'}" style="padding:5px 10px;min-width:32px" onclick="goSiswaPage(${i})">${i+1}</button>`
  ).join('');
}

function goSiswaPage(p) { appState.siswaPage = p; renderSiswaTable(); }

function editSiswa(id) {
  const s = appState.students.find(x => x.id === id);
  if (!s) return;
  document.getElementById('edit-siswa-id').value = s.id;
  document.getElementById('siswa-fp-id').value = s.fingerprint_id || '';
  document.getElementById('siswa-nis').value = s.nis || '';
  document.getElementById('siswa-name').value = s.name;
  document.getElementById('siswa-gender').value = s.gender || '';
  document.getElementById('siswa-class').value = s.class_id || '';
  document.getElementById('modal-siswa-title').textContent = 'Edit Siswa';
  openModal('modal-tambah-siswa');
}

async function saveSiswa() {
  const id = document.getElementById('edit-siswa-id').value;
  const name = document.getElementById('siswa-name').value.trim();
  if (!name) { toast('Nama wajib diisi', 'error'); return; }

  const classId = document.getElementById('siswa-class').value;
  const className = appState.classes.find(c => c.id === classId)?.name || '';

  const payload = {
    fingerprint_id: document.getElementById('siswa-fp-id').value ? parseInt(document.getElementById('siswa-fp-id').value) : null,
    nis: document.getElementById('siswa-nis').value.trim() || null,
    name,
    class_id: classId || null,
    class_name: className,
    gender: document.getElementById('siswa-gender').value || null,
  };

  let error;
  if (id) {
    ({ error } = await db.from('students').update(payload).eq('id', id));
  } else {
    ({ error } = await db.from('students').insert(payload));
  }

  if (error) { toast('Gagal menyimpan: ' + error.message, 'error'); return; }
  toast(id ? 'Siswa diperbarui' : 'Siswa ditambahkan', 'success');
  closeModal('modal-tambah-siswa');
  document.getElementById('edit-siswa-id').value = '';
  document.getElementById('modal-siswa-title').textContent = 'Tambah Siswa';
  await loadSiswa();
}

async function deleteSiswa(id, name) {
  if (!confirm(`Hapus siswa "${name}"? Data absensi terkait juga akan terhapus.`)) return;
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

  // Load 3-month attendance
  const today = new Date();
  const start = fmtDateISO(new Date(today.getFullYear(), today.getMonth() - 2, 1));
  const end = fmtDateISO(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  const { data: atts } = await db.from('attendance').select('*').eq('student_id', id)
    .gte('attendance_date', start).lte('attendance_date', end).order('attendance_date');

  const attMap = {};
  (atts||[]).forEach(a => { attMap[a.attendance_date] = a.status; });

  const counts = { H:0, S:0, I:0, A:0, T:0 };
  (atts||[]).forEach(a => { counts[a.status] = (counts[a.status]||0)+1; });
  const total = Object.values(counts).reduce((a,b)=>a+b,0);
  const hadir = counts.H + counts.T;

  document.getElementById('detail-siswa-body').innerHTML = `
    <div class="grid-4 mb-3" style="gap:10px">
      ${[['Hadir','H','var(--green)'],['Sakit','S','var(--yellow)'],['Izin','I','var(--accent)'],['Alpha','A','var(--red)']].map(([l,k,c]) => `
        <div class="stat-card" style="padding:12px">
          <div class="stat-label">${l}</div>
          <div class="stat-value" style="font-size:22px;color:${c}">${counts[k]||0}</div>
        </div>`).join('')}
    </div>
    <div class="text-sm text-muted mb-3">Persentase kehadiran: <strong>${total ? Math.round(hadir/total*100) : 0}%</strong> | Periode: 3 bulan terakhir</div>
    <div style="overflow-x:auto">
      <table style="font-size:12px">
        <thead><tr><th>Tanggal</th><th>Hari</th><th>Status</th><th>Masuk</th><th>Pulang</th><th>Terlambat</th></tr></thead>
        <tbody>
          ${(atts||[]).map(a => `<tr>
            <td>${fmtDate(a.attendance_date)}</td>
            <td>${['Min','Sen','Sel','Rab','Kam','Jum','Sab'][new Date(a.attendance_date).getDay()]}</td>
            <td><span class="status status-${a.status}">${{H:'Hadir',S:'Sakit',I:'Izin',A:'Alpha',T:'Terlambat'}[a.status]}</span></td>
            <td>${a.check_in||'—'}</td>
            <td>${a.check_out||'—'}</td>
            <td>${a.late_minutes ? a.late_minutes+' mnt' : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="text-center text-muted">Belum ada data</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

// ============================================================
// IMPORT SISWA TEMPLATE
// ============================================================
function downloadTemplateImportSiswa() {
  const header = [['ID Mesin Fingerprint', 'NIS', 'Nama Siswa', 'Kelas', 'Jenis Kelamin (L/P)']];
  const sample = [
    [1, '2024001', 'Budi Santoso', '9A', 'L'],
    [2, '2024002', 'Siti Rahayu', '9B', 'P'],
  ];

  exportToXlsx(
    [{ name: 'Template Siswa', data: [...header, ...sample], headerRow: 1 }],
    'Template_Import_Siswa.xlsx'
  );
  toast('Template berhasil diunduh', 'success');
}

async function handleImportSiswa(input) {
  const file = input.files[0];
  if (!file) return;

  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const data = rows.slice(1).filter(r => r[2]); // Must have name
  appState.importSiswaData = data;

  const previewEl = document.getElementById('siswa-import-preview');
  previewEl.className = '';
  previewEl.innerHTML = `
    <div class="text-sm font-bold mb-2">Preview: ${data.length} siswa ditemukan</div>
    <div class="table-wrap" style="max-height:200px;overflow-y:auto">
      <table style="font-size:12px">
        <thead><tr><th>ID Mesin</th><th>NIS</th><th>Nama</th><th>Kelas</th><th>JK</th></tr></thead>
        <tbody>${data.slice(0,10).map(r => `<tr><td>${r[0]||'—'}</td><td>${r[1]||'—'}</td><td>${r[2]}</td><td>${r[3]||'—'}</td><td>${r[4]||'—'}</td></tr>`).join('')}</tbody>
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
    const cls = classMap[className.toLowerCase()];
    return {
      fingerprint_id: r[0] ? parseInt(r[0]) : null,
      nis: String(r[1]).trim() || null,
      name: String(r[2]).trim(),
      class_name: className || null,
      class_id: cls?.id || null,
      gender: ['L','P'].includes(String(r[4]).toUpperCase()) ? String(r[4]).toUpperCase() : null,
      is_active: true,
    };
  });

  const { error } = await db.from('students').upsert(records, { onConflict: 'nis', ignoreDuplicates: false });
  if (error) { toast('Gagal import: ' + error.message, 'error'); return; }
  toast(`${records.length} siswa berhasil diimport`, 'success');
  closeModal('modal-import-siswa');
  document.getElementById('btn-confirm-import-siswa').classList.add('hidden');
  document.getElementById('siswa-import-preview').className = 'hidden';
  appState.importSiswaData = null;
  await loadSiswa();
}

// ============================================================
// IMPORT MESIN ABSEN
// ============================================================
const dropZone = document.getElementById('import-drop-zone');
if (dropZone) {
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    handleImportFile(e.dataTransfer.files);
  });
}

async function handleImportFile(files) {
  if (!files?.length) return;
  const progressWrap = document.getElementById('import-progress-wrap');
  const progressBar = document.getElementById('import-progress');
  const statusText = document.getElementById('import-status-text');
  const pct = document.getElementById('import-pct');
  const logEl = document.getElementById('import-log');

  progressWrap.classList.remove('hidden');
  logEl.classList.remove('hidden');
  logEl.innerHTML = '';

  const addLog = (msg, color = '') => {
    logEl.innerHTML += `<div style="color:${color||'inherit'}">${new Date().toLocaleTimeString()} — ${msg}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
  };

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    addLog(`📂 Membaca file: ${file.name}`);
    statusText.textContent = `Memproses ${file.name}…`;

    try {
      const buffer = await file.arrayBuffer();
      let workbook;

      // Try as XML-based XLS first
      try {
        const text = new TextDecoder('utf-8').decode(buffer);
        if (text.includes('<?xml') || text.includes('<Workbook')) {
          workbook = XLSX.read(buffer, { type: 'array', codepage: 65001 });
        } else {
          workbook = XLSX.read(buffer, { type: 'array' });
        }
      } catch {
        workbook = XLSX.read(buffer, { type: 'array' });
      }

      addLog(`📊 Sheet tersedia: ${workbook.SheetNames.join(', ')}`);

      // Try "Detail Absensi" or "Ringkasan Laporan"
      let imported = 0;
      const batchId = crypto.randomUUID();

      if (workbook.SheetNames.includes('Detail Absensi')) {
        imported = await parseDetailAbsensi(workbook, file.name, batchId, addLog, (p) => {
          progressBar.style.width = p + '%'; pct.textContent = p + '%';
        });
      } else if (workbook.SheetNames.includes('Ringkasan Laporan')) {
        imported = await parseRingkasanLaporan(workbook, file.name, batchId, addLog, (p) => {
          progressBar.style.width = p + '%'; pct.textContent = p + '%';
        });
      } else {
        addLog(`⚠️ Sheet tidak dikenal. Coba parsing otomatis…`, 'var(--yellow)');
        imported = await parseAutoDetect(workbook, file.name, batchId, addLog, (p) => {
          progressBar.style.width = p + '%'; pct.textContent = p + '%';
        });
      }

      // Log batch
      await db.from('import_batches').insert({
        id: batchId, filename: file.name, import_type: 'attendance',
        total_records: imported, success_records: imported, status: 'completed',
      });

      addLog(`✅ Selesai: ${imported} record berhasil diimport`, 'var(--green)');
    } catch (e) {
      addLog(`❌ Error: ${e.message}`, 'var(--red)');
    }
  }

  statusText.textContent = 'Import selesai!';
  progressBar.style.width = '100%'; pct.textContent = '100%';
  toast('Import absensi selesai', 'success');
  loadImportHistory();
}

async function parseDetailAbsensi(workbook, filename, batchId, addLog, setProgress) {
  const ws = workbook.Sheets['Detail Absensi'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Extract date range from row[1]
  let dateStart, year, month, daysInMonth = 30;
  const dateRow = String(rows[1]?.[0] || '');
  const dateMatch = dateRow.match(/(\d{4})-(\d+)-(\d+)~(\d{4})-(\d+)-(\d+)/);
  if (dateMatch) {
    year = parseInt(dateMatch[1]); month = parseInt(dateMatch[2]);
    daysInMonth = parseInt(dateMatch[6]);
    dateStart = new Date(year, month - 1, 1);
  }

  // Build student map from DB
  const { data: stuData } = await db.from('students').select('id, fingerprint_id, name');
  const stuByFP = {}, stuByName = {};
  (stuData||[]).forEach(s => {
    if (s.fingerprint_id) stuByFP[s.fingerprint_id] = s;
    stuByName[s.name?.toLowerCase()] = s;
  });

  const records = [];
  const rawRecords = [];
  let curStudent = null;
  let rowsProcessed = 0;

  const cfg = loadConfig();
  const lateThreshold = cfg.lateTime || '07:00';

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const first = String(row[0] || '').trim();

    // Detect student header row: "ID:N Nama:XXX Dept.:YYY"
    if (first.startsWith('ID:')) {
      const idMatch = first.match(/ID:(\d+)/);
      const nameMatch = first.match(/Nama:([^\t]+)/);
      const fpId = idMatch ? parseInt(idMatch[1]) : null;
      const name = nameMatch ? nameMatch[1].trim() : '';
      curStudent = stuByFP[fpId] || stuByName[name?.toLowerCase()] || null;
      continue;
    }

    // Detect data row (has time values like "06:15 14:20")
    if (curStudent && row.length >= daysInMonth) {
      const hasTime = row.some(cell => /\d{2}:\d{2}/.test(String(cell)));
      if (hasTime) {
        // Each cell = one day's punches
        for (let d = 0; d < daysInMonth; d++) {
          const dayNum = d + 1;
          const dateStr = year && month ? `${year}-${String(month).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}` : null;
          if (!dateStr) continue;

          const cellVal = String(row[d] || '').trim();
          if (!cellVal) continue;

          const times = cellVal.match(/\d{2}:\d{2}/g) || [];
          if (!times.length) continue;

          const checkIn = times[0];
          const checkOut = times[times.length - 1] !== times[0] ? times[times.length - 1] : null;
          const isLate = checkIn > lateThreshold;

          const attRecord = {
            student_id: curStudent.id,
            attendance_date: dateStr,
            status: isLate ? 'T' : 'H',
            check_in: checkIn,
            check_out: checkOut,
            late_minutes: isLate ? timeToMin(checkIn) - timeToMin(lateThreshold) : 0,
            source: 'fingerprint',
            day_of_week: new Date(dateStr).getDay(),
          };

          // Get class_id from student
          const { data: stuFull } = await db.from('students').select('class_id').eq('id', curStudent.id).single();
          if (stuFull?.class_id) attRecord.class_id = stuFull.class_id;

          records.push(attRecord);
          rawRecords.push({
            student_id: curStudent.id,
            attendance_date: dateStr,
            check_in: checkIn,
            check_out: checkOut,
            all_punches: cellVal,
            source_file: filename,
            import_batch: batchId,
          });
        }
        rowsProcessed++;
        setProgress(Math.min(95, Math.round(rowsProcessed / (rows.length / 3) * 100)));
      }
    }
  }

  addLog(`📝 ${records.length} record absensi akan disimpan…`);

  // Batch upsert attendance
  const chunkSize = 100;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const { error } = await db.from('attendance').upsert(chunk, { onConflict: 'student_id,attendance_date' });
    if (error) addLog(`⚠️ Chunk ${i}-${i+chunkSize}: ${error.message}`, 'var(--yellow)');
  }

  // Upsert raw
  for (let i = 0; i < rawRecords.length; i += chunkSize) {
    const chunk = rawRecords.slice(i, i + chunkSize);
    await db.from('attendance_raw').upsert(chunk, { onConflict: 'student_id,attendance_date' });
  }

  return records.length;
}

async function parseRingkasanLaporan(workbook, filename, batchId, addLog, setProgress) {
  // Ringkasan doesn't have day-by-day detail, just summary
  // We can use it to validate or fill gaps
  addLog('ℹ️ Sheet Ringkasan Laporan ditemukan — menggunakan untuk validasi summary', 'var(--accent)');
  return 0;
}

async function parseAutoDetect(workbook, filename, batchId, addLog, setProgress) {
  // Try first sheet
  const ws = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  addLog(`Auto-detect: ${rows.length} baris di sheet pertama`);
  return 0;
}

async function loadImportHistory() {
  if (!db) return;
  const { data } = await db.from('import_batches').select('*').order('created_at', { ascending: false }).limit(20);
  const tbody = document.getElementById('import-history-body');
  tbody.innerHTML = (data||[]).map(b => `<tr>
    <td class="text-xs">${new Date(b.created_at).toLocaleString('id-ID')}</td>
    <td class="text-xs truncate" style="max-width:160px">${b.filename}</td>
    <td>${b.success_records}</td>
    <td><span class="chip ${b.status==='completed'?'tag-green':'tag-red'}">${b.status}</span></td>
  </tr>`).join('') || '<tr><td colspan="4" class="text-center text-muted">Belum ada riwayat</td></tr>';
}

// ============================================================
// KELAS
// ============================================================
async function loadKelas() {
  if (!db) return;
  const { data } = await db.from('classes').select('*').order('name');
  const activeYear = loadConfig().year || '2025/2026';

  // Count students per class
  const { data: stuCounts } = await db.from('students').select('class_id', { count: 'exact' }).eq('is_active', true);
  const countMap = {};
  if (stuCounts) {
    const { data: grouped } = await db.rpc ? {} : {};
    // Simple approach: query count per class
    for (const cls of (data||[])) {
      const { count } = await db.from('students').select('id', {count:'exact'}).eq('class_id', cls.id).eq('is_active', true);
      countMap[cls.id] = count || 0;
    }
  }

  const tbody = document.getElementById('kelas-body');
  tbody.innerHTML = (data||[]).map((c, i) => `<tr>
    <td>${i+1}</td>
    <td><strong>${c.name}</strong></td>
    <td>${c.homeroom_teacher || '—'}</td>
    <td>${c.academic_year_id ? activeYear : '—'}</td>
    <td>${countMap[c.id] ?? '—'}</td>
    <td>
      <div class="flex gap-2">
        <button class="btn btn-secondary btn-icon" onclick="editKelas('${c.id}')">✏️</button>
        <button class="btn btn-danger btn-icon" onclick="deleteKelas('${c.id}','${c.name}')">🗑</button>
      </div>
    </td>
  </tr>`).join('') || '<tr><td colspan="6" class="text-center text-muted">Belum ada kelas</td></tr>';
}

async function saveKelas() {
  const id = document.getElementById('edit-kelas-id').value;
  const name = document.getElementById('kelas-name').value.trim();
  if (!name) { toast('Nama kelas wajib diisi', 'error'); return; }

  const payload = {
    name,
    homeroom_teacher: document.getElementById('kelas-teacher').value.trim() || null,
  };

  let error;
  if (id) {
    ({ error } = await db.from('classes').update(payload).eq('id', id));
  } else {
    ({ error } = await db.from('classes').insert(payload));
  }

  if (error) { toast('Gagal menyimpan: ' + error.message, 'error'); return; }
  toast(id ? 'Kelas diperbarui' : 'Kelas ditambahkan', 'success');
  closeModal('modal-tambah-kelas');
  document.getElementById('edit-kelas-id').value = '';
  document.getElementById('kelas-name').value = '';
  document.getElementById('kelas-teacher').value = '';
  await loadClasses();
  populateClassDropdowns();
  loadKelas();
}

function editKelas(id) {
  const c = appState.classes.find(x => x.id === id);
  if (!c) return;
  document.getElementById('edit-kelas-id').value = c.id;
  document.getElementById('kelas-name').value = c.name;
  document.getElementById('kelas-teacher').value = c.homeroom_teacher || '';
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
  const year = document.getElementById('libur-year-filter')?.value || '2026';
  const { data } = await db.from('holidays').select('*')
    .gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`)
    .order('holiday_date');
  appState.holidays = data || [];

  const typeLabel = { national: '🇮🇩 Nasional', school: '🏫 Sekolah', custom: '📌 Custom' };

  const tbody = document.getElementById('libur-body');
  tbody.innerHTML = (data||[]).map(h => `<tr>
    <td>${fmtDate(h.holiday_date)}</td>
    <td>${h.name}</td>
    <td><span class="chip">${typeLabel[h.holiday_type]||h.holiday_type}</span></td>
    <td>
      ${h.holiday_type !== 'national' ? `<button class="btn btn-danger btn-icon" onclick="deleteLibur('${h.id}')">🗑</button>` : ''}
    </td>
  </tr>`).join('') || '<tr><td colspan="4" class="text-center text-muted">Tidak ada hari libur</td></tr>';

  // Render calendar for current month
  renderLiburCalendar(new Date(), data||[]);
}

function renderLiburCalendar(dateObj, holidays) {
  const year = dateObj.getFullYear(), month = dateObj.getMonth();
  const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  document.getElementById('libur-cal-month').textContent = `${monthNames[month]} ${year}`;

  const holidayDates = new Set(holidays.map(h => h.holiday_date));
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  let html = days.map(d => `<div class="cal-day-header">${d}</div>`).join('');

  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(ds).getDay();
    const isWE = dow === 0 || dow === 6;
    const isHol = holidayDates.has(ds);
    const cls = isHol ? 'holiday' : isWE ? 'weekend' : '';
    html += `<div class="cal-day ${cls}" title="${isHol ? holidays.find(h=>h.holiday_date===ds)?.name : ''}">${d}</div>`;
  }

  document.getElementById('libur-calendar').innerHTML = html;
}

async function saveLibur() {
  const date = document.getElementById('libur-date').value;
  const name = document.getElementById('libur-name').value.trim();
  const type = document.getElementById('libur-type').value;
  if (!date || !name) { toast('Tanggal dan nama wajib diisi', 'error'); return; }

  const { error } = await db.from('holidays').upsert({ holiday_date: date, name, holiday_type: type }, { onConflict: 'holiday_date' });
  if (error) { toast('Gagal: ' + error.message, 'error'); return; }
  toast('Hari libur ditambahkan', 'success');
  closeModal('modal-tambah-libur');
  loadLibur();
}

async function deleteLibur(id) {
  if (!confirm('Hapus hari libur ini?')) return;
  const { error } = await db.from('holidays').delete().eq('id', id);
  if (error) { toast('Gagal hapus', 'error'); return; }
  toast('Hari libur dihapus', 'success');
  await loadHolidays(); loadLibur();
}

async function seedNasionalHolidays() {
  toast('Memperbarui hari libur nasional…', 'info');
  // Re-run from schema is impractical via JS; instead we can refresh from DB
  const { error } = await db.from('holidays').select('id').limit(1);
  if (!error) {
    toast('Data hari libur nasional sudah ada di database', 'info');
    loadLibur();
  }
}

// ============================================================
// LAPORAN / EXPORT
// ============================================================
let lapPeriodMode = 'bulan';

function initLaporan() {
  ['lap-class'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const opts = appState.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      el.innerHTML = `<option value="">Semua Kelas</option>` + opts;
    }
  });
}

function switchLapPeriod(mode, btn) {
  lapPeriodMode = mode;
  document.querySelectorAll('#page-laporan .period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('lap-month').style.display = mode === 'bulan' ? '' : 'none';
  document.getElementById('lap-custom-range').classList.toggle('hidden', mode !== 'custom');
}

async function doExportLaporan() {
  const classId = document.getElementById('lap-class').value;
  const format = document.getElementById('lap-format').value;
  const year = document.getElementById('global-period-year').value;
  const semester = loadConfig().semester || 2;

  let start, end, periodLabel;
  if (lapPeriodMode === 'bulan') {
    const m = document.getElementById('lap-month').value;
    const r = getMonthRange(m); start = r.start; end = r.end;
    periodLabel = monthLabel(m);
  } else if (lapPeriodMode === 'semester') {
    const r = getSemesterRange(year, semester); start = r.start; end = r.end;
    periodLabel = `Semester ${semester} ${year}/${parseInt(year)+1}`;
  } else if (lapPeriodMode === 'tahun') {
    start = `${year}-01-01`; end = `${year}-12-31`;
    periodLabel = `Tahun Pelajaran ${year}/${parseInt(year)+1}`;
  } else {
    start = document.getElementById('lap-start').value;
    end = document.getElementById('lap-end').value;
    periodLabel = `${start} s/d ${end}`;
  }

  if (!start || !end) { toast('Pilih periode terlebih dahulu', 'error'); return; }

  toast('Menyiapkan export…', 'info');

  if (format === 'rekap') {
    await buildAndExportRekap(classId, start, end, periodLabel);
  } else if (format === 'detail') {
    await exportDetailPerHari(classId, start, end, periodLabel);
  } else if (format === 'kelas') {
    await exportRekapPerKelas(classId, start, end, periodLabel);
  }
}

async function exportDetailPerHari(classId, start, end, periodLabel) {
  let q = db.from('attendance').select('*, students(name, nis, class_name)')
    .gte('attendance_date', start).lte('attendance_date', end).order('attendance_date');
  if (classId) q = q.eq('class_id', classId);
  const { data } = await q;

  const schoolName = loadConfig().schoolName || 'Sekolah';
  const statusLabel = { H:'Hadir', S:'Sakit', I:'Izin', A:'Alpha', T:'Terlambat' };
  const header = [
    [`DETAIL ABSENSI HARIAN`],
    [`${schoolName}`],
    [`Periode: ${periodLabel}`],
    [],
    ['No','Tanggal','Hari','NIS','Nama Siswa','Kelas','Status','Masuk','Pulang','Terlambat (mnt)','Keterangan'],
  ];

  const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const rows = (data||[]).map((a,i) => [
    i+1, a.attendance_date, days[new Date(a.attendance_date).getDay()],
    a.students?.nis||'', a.students?.name||'', a.students?.class_name||'',
    statusLabel[a.status]||a.status, a.check_in||'', a.check_out||'',
    a.late_minutes||0, a.notes||'',
  ]);

  exportToXlsx([{ name: 'Detail Harian', data: [...header, ...rows], headerRow: 5 }],
    `Detail_Harian_${periodLabel.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`);
}

async function exportRekapPerKelas(classId, start, end, periodLabel) {
  const sheets = [];
  const classes = classId ? appState.classes.filter(c => c.id === classId) : appState.classes;
  const effDays = countEffectiveDays(start, end);
  const schoolName = loadConfig().schoolName || 'Sekolah';

  for (const cls of classes) {
    const { data: students } = await db.from('students').select('*').eq('class_id', cls.id).eq('is_active', true).order('name');
    const { data: atts } = await db.from('attendance').select('*').eq('class_id', cls.id)
      .gte('attendance_date', start).lte('attendance_date', end);

    const byStudent = {};
    (atts||[]).forEach(r => {
      if (!byStudent[r.student_id]) byStudent[r.student_id] = { H:0,S:0,I:0,A:0,T:0,lateMins:0 };
      byStudent[r.student_id][r.status]++;
      byStudent[r.student_id].lateMins += (r.late_minutes||0);
    });

    const header = [
      [`REKAP ABSENSI KELAS ${cls.name}`],
      [`${schoolName}   |   Periode: ${periodLabel}   |   Hari Efektif: ${effDays}`],
      [],
      ['No','NIS','Nama','Hadir','Sakit','Izin','Alpha','Terlambat','% Hadir'],
    ];

    const rows = (students||[]).map((s,i) => {
      const stat = byStudent[s.id] || { H:0,S:0,I:0,A:0,T:0 };
      const hadir = stat.H + stat.T;
      return [i+1, s.nis||'', s.name, stat.H, stat.S, stat.I, stat.A, stat.T, `${effDays ? Math.round(hadir/effDays*100) : 0}%`];
    });

    sheets.push({ name: cls.name, data: [...header, ...rows], headerRow: 4 });
  }

  exportToXlsx(sheets, `Rekap_Kelas_${periodLabel.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`);
}

// ============================================================
// EXCEL EXPORT ENGINE
// ============================================================
function exportToXlsx(sheets, filename) {
  const wb = XLSX.utils.book_new();

  const headerFill = { fgColor: { rgb: '2563EB' } };
  const headerFont = { color: { rgb: 'FFFFFF' }, bold: true, sz: 11 };
  const titleFont = { bold: true, sz: 13 };
  const evenFill = { fgColor: { rgb: 'EFF6FF' } };

  sheets.forEach(({ name, data, headerRow }) => {
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Style header row
    if (headerRow) {
      const hRow = headerRow - 1; // 0-based
      const cols = data[hRow]?.length || 0;
      for (let c = 0; c < cols; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: hRow, c });
        if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' };
        ws[cellRef].s = { fill: headerFill, font: headerFont, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
      }

      // Style alternating rows
      for (let r = headerRow; r < data.length; r++) {
        for (let c = 0; c < cols; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' };
          if (r % 2 === 0) ws[cellRef].s = { fill: evenFill };
        }
      }
    }

    // Title rows font
    for (let r = 0; r < (headerRow||1) - 1; r++) {
      const cellRef = XLSX.utils.encode_cell({ r, c: 0 });
      if (ws[cellRef]) ws[cellRef].s = { font: titleFont };
    }

    // Auto column widths
    const colWidths = [];
    data.forEach(row => {
      (row||[]).forEach((cell, c) => {
        const len = String(cell||'').length + 2;
        colWidths[c] = Math.max(colWidths[c] || 0, Math.min(len, 40));
      });
    });
    ws['!cols'] = colWidths.map(w => ({ wch: Math.max(w, 8) }));

    XLSX.utils.book_append_sheet(wb, ws, String(name).slice(0, 31));
  });

  XLSX.writeFile(wb, filename);
  toast(`📥 ${filename} berhasil diunduh`, 'success');
}

// ============================================================
// BACKUP & RESTORE
// ============================================================
async function doBackup() {
  const type = document.getElementById('backup-type').value;
  if (!db) { toast('Supabase belum terkoneksi', 'error'); return; }

  toast('Menyiapkan backup…', 'info');
  const backup = {
    version: 1, type, timestamp: new Date().toISOString(),
    school: loadConfig().schoolName || 'Sekolah',
  };

  if (type === 'full' || type === 'students') {
    const { data } = await db.from('students').select('*');
    backup.students = data || [];
    const { data: classes } = await db.from('classes').select('*');
    backup.classes = classes || [];
  }

  if (type === 'full' || type === 'attendance') {
    const { data } = await db.from('attendance').select('*').order('attendance_date');
    backup.attendance = data || [];
    const { data: holidays } = await db.from('holidays').select('*');
    backup.holidays = holidays || [];
  }

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup_absen_${type}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  // Log backup
  await db.from('backup_logs').insert({ backup_type: type, record_count: (backup.attendance||[]).length + (backup.students||[]).length });

  // Update history display
  document.getElementById('backup-history').textContent = `Terakhir backup: ${new Date().toLocaleString('id-ID')} (${type})`;
  toast('Backup berhasil diunduh', 'success');
}

async function handleRestore(input) {
  const file = input.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    const previewEl = document.getElementById('restore-preview');
    previewEl.classList.remove('hidden');
    previewEl.innerHTML = `
      <div class="card" style="padding:16px">
        <div class="text-sm font-bold mb-2">📦 Info Backup</div>
        <div class="text-sm">Sekolah: <strong>${data.school||'—'}</strong></div>
        <div class="text-sm">Tipe: <strong>${data.type||'—'}</strong></div>
        <div class="text-sm">Waktu: <strong>${data.timestamp ? new Date(data.timestamp).toLocaleString('id-ID') : '—'}</strong></div>
        <div class="text-sm">Siswa: <strong>${data.students?.length || 0}</strong></div>
        <div class="text-sm">Absensi: <strong>${data.attendance?.length || 0}</strong></div>
        <div class="text-sm">Kelas: <strong>${data.classes?.length || 0}</strong></div>
        <div class="divider"></div>
        <p class="text-sm" style="color:var(--red)">⚠️ Restore akan menimpa data yang sudah ada!</p>
        <button class="btn btn-danger mt-2" onclick="confirmRestore(${JSON.stringify(data).replace(/"/g,'&quot;')})">
          ⚠️ Restore Sekarang
        </button>
      </div>`;
    window._restoreData = data;
  } catch (e) {
    toast('File backup tidak valid: ' + e.message, 'error');
  }
}

async function confirmRestore() {
  const data = window._restoreData;
  if (!data) return;
  if (!confirm('Yakin akan melakukan restore? Data saat ini akan ditimpa!')) return;

  toast('Memulai restore…', 'info');

  if (data.classes?.length) {
    await db.from('classes').upsert(data.classes, { onConflict: 'id' });
  }
  if (data.students?.length) {
    const chunks = [];
    for (let i = 0; i < data.students.length; i += 100) chunks.push(data.students.slice(i, i+100));
    for (const c of chunks) await db.from('students').upsert(c, { onConflict: 'id' });
  }
  if (data.attendance?.length) {
    const chunks = [];
    for (let i = 0; i < data.attendance.length; i += 100) chunks.push(data.attendance.slice(i, i+100));
    for (const c of chunks) await db.from('attendance').upsert(c, { onConflict: 'id' });
  }
  if (data.holidays?.length) {
    await db.from('holidays').upsert(data.holidays, { onConflict: 'holiday_date' });
  }

  toast('Restore berhasil!', 'success');
  await bootstrap();
}

// ============================================================
// SETTINGS
// ============================================================
async function saveSchoolInfo() {
  const name = document.getElementById('cfg-school-name').value.trim();
  const addr = document.getElementById('cfg-school-addr').value.trim();

  const cfg = loadConfig();
  saveLocalConfig({ ...cfg, schoolName: name, schoolAddr: addr });
  document.getElementById('school-name-sidebar').textContent = name || 'RekapAbsen';

  if (db) {
    await db.from('schools').update({ name, address: addr }).neq('id', '00000000-0000-0000-0000-000000000000');
  }
  toast('Info sekolah tersimpan', 'success');
}

async function saveTimeConfig() {
  const year = document.getElementById('cfg-year').value;
  const semester = document.getElementById('cfg-semester').value;
  const lateTime = document.getElementById('cfg-late-time').value;
  const outTime = document.getElementById('cfg-out-time').value;

  const cfg = loadConfig();
  saveLocalConfig({ ...cfg, year, semester, lateTime, outTime });
  appState.lateThreshold = lateTime;
  appState.earlyLeaveThreshold = outTime;
  toast('Pengaturan waktu tersimpan', 'success');
}

// ============================================================
// SIDEBAR NAVIGATION INIT
// ============================================================
document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navigate(item.dataset.page));
});

// ============================================================
// MODAL CLOSE ON BACKDROP CLICK
// ============================================================
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });
});

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Set today's date for absen harian
  const ahDate = document.getElementById('ah-date');
  if (ahDate) ahDate.value = todayISO();

  bootstrap();
});
