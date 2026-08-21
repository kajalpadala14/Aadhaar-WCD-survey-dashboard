const RAW_DATA = [];

let API_BASE_URL = ((window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || '/api/sheet').trim();
localStorage.removeItem('aadhaar_wcd_api_base_url');

let DATA = JSON.parse(JSON.stringify(RAW_DATA));
const LOCAL_CACHE_KEY = 'aadhaar_entries_dantewada_v2';
const OLD_LOCAL_CACHE_KEY = 'aadhaar_entries_dantewada';
const SYNC_VERSION = '2026-08-06-live-sheet';
const RAW_BY_SNO = new Map(RAW_DATA.map(record => [Number(record.sno), record]));
const THEME_KEY = 'aadhaar_wcd_theme_v2';
let REASON_REPORT_ROWS = [];
let currentReasonPreview = null;
let reportFilteredData = [...DATA];
const LOCAL_PROXY_PORTS = [
  3010, 3011, 3012, 3013, 3014, 3015, 3016, 3017, 3018, 3019, 3020,
  3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009
];

function applyTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('light-mode', nextTheme === 'light');
  localStorage.setItem(THEME_KEY, nextTheme);

  const btn = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-toggle-icon');
  const label = nextTheme === 'light' ? 'Dark mode चालू करें' : 'Light mode चालू करें';
  if (icon) icon.textContent = nextTheme === 'light' ? '🌙' : '☀️';
  if (btn) {
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

function initTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');
}

function toggleTheme() {
  const isLight = document.body.classList.contains('light-mode');
  applyTheme(isLight ? 'dark' : 'light');
}

function isBackendConfigured() {
  return typeof API_BASE_URL === 'string' && (
    API_BASE_URL.indexOf('http') === 0 ||
    API_BASE_URL.indexOf('/') === 0
  );
}

function backendConfigHelp() {
  return 'Backend URL missing. .env me API_BASE_URL check karo ya node server se app kholo.';
}

function parseEnvValue(text, key) {
  const line = text
    .split(/\r?\n/)
    .map(item => item.trim())
    .find(item => item && !item.startsWith('#') && item.startsWith(key + '='));
  if (!line) return '';
  let value = line.slice(key.length + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.trim();
}

async function loadBackendConfig() {
  if (isBackendConfigured()) return;
  if (API_BASE_URL.includes('/api/sheet')) return;
  try {
    const res = await fetch(`.env?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const envText = await res.text();
    API_BASE_URL = parseEnvValue(envText, 'API_BASE_URL');
  } catch (e) {}
}

function backendListUrl() {
  return backendUrl(API_BASE_URL, { action: 'list', _: Date.now() });
}

function backendUrl(baseUrl, params) {
  const sep = baseUrl.includes('?') ? '&' : '?';
  const query = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  return `${baseUrl}${sep}${query}`;
}

function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function isRelativeApiBase() {
  return API_BASE_URL.indexOf('/') === 0;
}

function isMissingApiRouteError(message) {
  return /cannot\s+get\s+\/api\/sheet\w*|not\s+found|failed\s+to\s+fetch/i.test(String(message || ''));
}

async function parseBackendResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(extractBackendError(text));
  }
  if (!res.ok) {
    throw new Error(data && data.error ? data.error : 'HTTP ' + res.status);
  }
  return data;
}

async function discoverLocalProxy() {
  const currentHost = window.location.hostname || 'localhost';
  const hosts = currentHost === '127.0.0.1' ? ['127.0.0.1', 'localhost'] : ['localhost', '127.0.0.1'];
  const currentOrigin = window.location.origin;

  for (const port of LOCAL_PROXY_PORTS) {
    for (const host of hosts) {
      const base = `http://${host}:${port}/api/sheet`;
      if (`http://${host}:${port}` === currentOrigin) continue;
      try {
        const res = await fetchWithTimeout(backendUrl(base, { action: 'list', _: Date.now() }), { cache: 'no-store' }, 500);
        const data = await parseBackendResponse(res);
        if (data && data.ok && Array.isArray(data.entries)) {
          API_BASE_URL = base;
          return data;
        }
      } catch (e) {}
    }
  }

  return null;
}

function getRecordProject(r) {
  return (
    r.project ||
    r.projectName ||
    r.Project ||
    r['Project Name'] ||
    r['project name'] ||
    r['PROJECT NAME'] ||
    r.project_name ||
    // Legacy imports may map column B (Project Name) as "district".
    r.district ||
    ''
  ).toString().trim();
}

function canonicalBlock(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('dantewada') || raw.includes('दंतेवाड़ा')) return 'Dantewada';
  if (lower.includes('geedam') || raw.includes('गीदम')) return 'Geedam';
  if (lower.includes('katekalyan') || raw.includes('कटेकल्याण')) return 'Katekalyan';
  if (lower.includes('kuakonda') || raw.includes('कुआकोंडा')) return 'Kuakonda';
  return raw.replace(/\s*\([^)]*\)\s*/g, '').trim();
}

function setSyncStatus(text, cls) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'sync-pill ' + (cls || '');
}

function clearLocalCache() {
  try {
    localStorage.removeItem(LOCAL_CACHE_KEY);
    localStorage.removeItem(OLD_LOCAL_CACHE_KEY);
  } catch (e) {}
}

function resetData() {
  DATA = [];
  filteredData = [];
}

function extractBackendError(text) {
  const cleanText = String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleanText.match(/Error:\s*([^]+?)(?:\s*$)/i);
  return (match ? match[1] : cleanText || 'Invalid backend response').slice(0, 180);
}

function normalizeGender(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  if (lower === 'female' || raw === 'महिला') return 'Female';
  if (lower === 'male' || raw === 'पुरुष') return 'Male';
  return raw || 'Male';
}

function normalizeSheetRecord(e, index) {
  const base = RAW_BY_SNO.get(Number(e.sno)) || {};
  const project = getRecordProject(e);
  const sno = Number(e.sno || e['क्र.'] || e['क्र']) || 0;
  const age = Number(e.age || e.Age || e['आयु'] || base.age) || 0;
  const genderValue = (e.gender || e.Gender || e['लिंग'] || base.gender || '').toString().trim();
  const maritalStatus = (e.maritalStatus || e.marital_status || e['वैवाहिक स्थिति'] || base.maritalStatus || '').toString().trim();
  const hof = (e.hof || e.headOfFamily || e.head_of_family || e['मुखिया का नाम'] || e['परिवार मुखिया'] || base.hof || '').toString().trim();
  const explicitFatherName = (e.father || e.father_name || e.husband || e.husbandName || e.husband_name || e['पिताजी का नाम'] || e['पिता का नाम'] || e['पति का नाम'] || e['पिता/पति का नाम'] || base.fatherName || '').toString().trim();
  const apiFatherName = (e.fatherName || '').toString().trim();
  const fatherIsSameAsHof = apiFatherName && hof && apiFatherName === hof;
  const rawFatherName = e.fatherNameSource === 'hof' || fatherIsSameAsHof ? explicitFatherName : (apiFatherName || explicitFatherName);
  return {
    _uiKey: `${sno || 'row'}-${index}`,
    sno,
    project: project || getRecordProject(base),
    district: e.district || base.district || 'Dantewada',
    block: canonicalBlock(e.block || base.block || ''),
    gp: (e.gp || base.gp || '').toString().trim(),
    village: (e.village || base.village || '').toString().trim(),
    hof,
    member: (e.member || base.member || '').toString().trim(),
    mobile: (e.mobile || base.mobile || '').toString().trim(),
    gender: normalizeGender(genderValue),
    maritalStatus,
    fatherName: rawFatherName,
    fatherNameSource: e.fatherNameSource || (rawFatherName ? 'father' : (hof ? 'hof' : '')),
    age,
    aadhaar: (e.aadhaar || '').toString().trim(),
    enrollment: (e.enrollment || '').toString().trim(),
    remark: (e.remark || '').toString().trim(),
    entryValue: (e.entryValue || base.entryValue || '').toString().trim(),
    entryTime: normalizeEntryTime(e.entryTime || e.entry_time || e.savedAt || e.saved_at || e.time || e.Time || e.timestamp || e.Timestamp || e['समय'] || e['टाइम'] || base.entryTime || ''),
    deleted: e.deleted === true || e.deleted === 'TRUE'
  };
}

function guardianLabel(record) {
  return 'पिता/पति/मुखिया';
}

function guardianParts(record) {
  const fatherName = String(record.fatherName || '').trim();
  const hof = String(record.hof || '').trim();
  const fatherOrHusbandName = fatherName || hof;

  return [
    { label: 'मुखिया', name: hof || '-' },
    { label: 'पिता/पति का नाम', name: fatherOrHusbandName || '-' }
  ];
}

function guardianDisplay(record) {
  return guardianParts(record).map(part => `${part.label}: ${part.name}`).join(' / ');
}

function guardianDisplayHtml(record) {
  return guardianParts(record)
    .map(part => `<div><span class="guardian-label">${escapeHtml(part.label)}:</span> ${escapeHtml(part.name)}</div>`)
    .join('');
}

function recordTimeKey(record) {
  const sno = Number(record && record.sno);
  if (sno) return `sno:${sno}`;
  return [
    'row',
    getRecordProject(record),
    record && record.block,
    record && record.gp,
    record && record.village,
    record && record.hof,
    record && record.member,
    record && record.mobile
  ]
    .map(value => String(value || '').trim().toLowerCase())
    .join('|');
}

function applySyncedEntries(entries) {
  const existingTimes = new Map(
    DATA
      .filter(record => normalizeEntryTime(record.entryTime))
      .map(record => [recordTimeKey(record), record.entryTime])
  );

  DATA = entries
    .map((entry, index) => normalizeSheetRecord(entry, index))
    .map(entry => {
      if (!normalizeEntryTime(entry.entryTime)) {
        entry.entryTime = existingTimes.get(recordTimeKey(entry)) || '';
      }
      return entry;
    })
    .filter(entry => !entry.deleted && (entry.project || entry.member || entry.hof || entry.block || entry.gp || entry.village));
  filteredData = [...DATA];
}

function hasEntryDetail(record) {
  return getEntryKind(record) !== 'empty' && getEntryKind(record) !== 'remark';
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

const ENROLLMENT_REQUIRED_REMARK = 'एनरोलमेंट करवाया गया है, परंतु आधार कार्ड नहीं मिला है';

function createEntryTimestamp() {
  return new Date().toISOString();
}

function normalizeEntryTime(value) {
  return String(value || '').trim();
}

function formatEntryTime(value) {
  const raw = normalizeEntryTime(value);
  if (!raw) return '-';

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('hi-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  return raw;
}

function getEntryKind(record) {
  const aadhaarDigits = digitsOnly(record.aadhaar);
  const enrollmentDigits = digitsOnly(record.enrollment);
  const entryDigits = digitsOnly(record.entryValue);
  const entryValue = String(record.entryValue || '').trim();
  const remark = String(record.remark || '').trim();
  const isPrefixedEnrollment = /^s\d{27}$/i.test(entryValue);

  if (remark === ENROLLMENT_REQUIRED_REMARK) return 'remark';
  if (aadhaarDigits.length === 12 || entryDigits.length === 12 || entryDigits.length === 4) return 'aadhaar';
  if (enrollmentDigits.length === 28 || entryDigits.length === 28 || isPrefixedEnrollment) return 'enrollment';
  if (entryValue) return 'detail';
  if (remark) return 'remark';
  return 'empty';
}

// à¤²à¥‹à¤•à¤² à¤•à¥ˆà¤¶ backend unavailable à¤¹à¥‹à¤¨à¥‡ à¤ªà¤° fallback à¤¹à¥ˆ.
function loadLocalCache() {
  try {
    const saved = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!saved) return false;
    const payload = JSON.parse(saved);
    if (payload && payload.version === SYNC_VERSION && Array.isArray(payload.entries)) {
      applySyncedEntries(payload.entries);
      return true;
    }
  } catch(e) {}
  return false;
}

function saveLocalCache() {
  try {
    localStorage.removeItem(OLD_LOCAL_CACHE_KEY);
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({
      version: SYNC_VERSION,
      savedAt: new Date().toISOString(),
      entries: DATA
    }));
  } catch(e) {}
}

// Backend à¤¸à¥‡ à¤¸à¤­à¥€ à¤­à¤°à¥‡ à¤¹à¥à¤ à¤°à¤¿à¤•à¥‰à¤°à¥à¤¡ à¤¡à¤¾à¤‰à¤¨à¤²à¥‹à¤¡ à¤•à¤°à¥‡à¤‚ (à¤•à¤ˆ à¤²à¥‹à¤—à¥‹à¤‚ à¤•à¤¾ à¤¡à¥‡à¤Ÿà¤¾ à¤®à¤¿à¤²à¤¾à¤•à¤°)
async function fetchFromSheet() {
  if (!isBackendConfigured()) {
    setSyncStatus(backendConfigHelp(), 'err');
    return;
  }
  setSyncStatus('सिंक हो रहा है...', 'busy');
  try {
    const res = await fetch(backendListUrl(), { cache: 'no-store' });
    const data = await parseBackendResponse(res);
    if (data && data.ok && Array.isArray(data.entries)) {
      applySyncedEntries(data.entries);
      clearLocalCache();
      renderDashboard();
      applyFilters();
      populateReportFilterOptions();
      reportFilteredData = getReportFilteredData();
      updateReportFilterSummary();
      setSyncStatus(`सिंक हो गया (${DATA.length.toLocaleString()} रिकॉर्ड)`, 'ok');
    } else {
      throw new Error(data && data.error ? data.error : 'invalid response');
    }
  } catch(e) {
    if (isRelativeApiBase() && isMissingApiRouteError(e.message)) {
      setSyncStatus('Local backend ढूंढ रहे हैं...', 'busy');
      const data = await discoverLocalProxy();
      if (data) {
        applySyncedEntries(data.entries);
        clearLocalCache();
        renderDashboard();
        applyFilters();
        populateReportFilterOptions();
        reportFilteredData = getReportFilteredData();
        updateReportFilterSummary();
        setSyncStatus(`सिंक हो गया (${DATA.length.toLocaleString()} रिकॉर्ड)`, 'ok');
        return;
      }
    }
    clearLocalCache();
    resetData();
    renderDashboard();
    populateGPOptions();
    populateVillageOptions();
    populateReportFilterOptions();
    applyFilters();
    reportFilteredData = getReportFilteredData();
    updateReportFilterSummary();
    setSyncStatus(`Backend error: ${e.message || 'sync failed'}`, 'err');
  }
}

// à¤à¤• à¤°à¤¿à¤•à¥‰à¤°à¥à¤¡ backend à¤ªà¤° à¤…à¤ªà¤²à¥‹à¤¡ à¤•à¤°à¥‡à¤‚
async function pushToSheet(rec) {
  if (!isBackendConfigured()) return false;
  setSyncStatus('अपलोड हो रहा है...', 'busy');
  try {
    const res = await fetch(API_BASE_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({
        action: 'save',
        sno: rec.sno, project: getRecordProject(rec), district: rec.district, block: rec.block, gp: rec.gp,
        village: rec.village, hof: rec.hof, member: rec.member, mobile: rec.mobile,
        gender: rec.gender, maritalStatus: rec.maritalStatus || '', age: rec.age,
        fatherName: rec.fatherName || '',
        entryValue: rec.aadhaar || rec.enrollment || '',
        aadhaar: rec.aadhaar, enrollment: rec.enrollment, remark: rec.remark,
        entryTime: rec.entryTime || '',
        time: rec.entryTime || '',
        Time: rec.entryTime || '',
        'Entry Time': rec.entryTime || '',
        'समय': rec.entryTime || ''
      })
    });
    await parseBackendResponse(res);
    await fetchFromSheet();
    return true;
  } catch(e) {
    if (isRelativeApiBase() && isMissingApiRouteError(e.message)) {
      await discoverLocalProxy();
      if (!isRelativeApiBase()) return pushToSheet(rec);
    }
    setSyncStatus('अपलोड विफल', 'err');
    return false;
  }
}

const INITIAL_LOAD_DELAY_MS = 500;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function initApp() {
  initTheme();
  setSyncStatus('Backend से डेटा आ रहा है...', 'busy');
  const progressEl = document.getElementById('nav-progress');
  if (progressEl) progressEl.textContent = 'लोड हो रहा है...';

  clearLocalCache();
  await loadBackendConfig();
  await wait(INITIAL_LOAD_DELAY_MS);

  renderDashboard();
  populateGPOptions();
  populateVillageOptions();
  populateReportFilterOptions();
  applyFilters();
  await fetchFromSheet(); // à¤«à¤¿à¤° backend à¤¸à¥‡ à¤¤à¤¾à¤œà¤¼à¤¾/à¤¸à¤¾à¤à¤¾ à¤¡à¥‡à¤Ÿà¤¾ à¤²à¤¾à¤à¤‚
  populateGPOptions();
  populateVillageOptions();
  populateReportFilterOptions();
}

// STATE
let filteredData = [...DATA];
let currentPage = 1;
const PAGE_SIZE = 50;
let editingIdx = null;
let selectedType = null;

// VIEWS
function switchView(v) {
  document.getElementById('view-dashboard').style.display = v==='dashboard' ? 'block' : 'none';
  document.getElementById('view-entry').style.display = v==='entry' ? 'block' : 'none';
  document.getElementById('view-report').style.display = v==='report' ? 'block' : 'none';
  document.querySelectorAll('.nav-tab').forEach((t,i) => {
    const views = ['dashboard','entry','report'];
    t.classList.toggle('active', views[i]===v);
  });
  if(v==='entry') renderTable();
  if(v==='report') applyReportFilters();
}

// STATS
function getStats(records = DATA) {
  const total = records.length;
  const aadhaarFilled = records.filter(r => getEntryKind(r) === 'aadhaar').length;
  const enrollmentFilled = records.filter(r => getEntryKind(r) === 'enrollment').length;
  const detailFilled = records.filter(r => getEntryKind(r) === 'detail').length;
  const remarkOnly = records.filter(r => getEntryKind(r) === 'remark').length;
  const anyFilled = aadhaarFilled + enrollmentFilled + detailFilled + remarkOnly;
  const pending = total - anyFilled;
  return {total, aadhaarFilled, enrollmentFilled, detailFilled, remarkOnly, anyFilled, pending};
}

function getProjectStats() {
  const stats = {};
  DATA.forEach(r => {
    const project = getRecordProject(r);
    if (!project) return;
    if (!stats[project]) {
      stats[project] = {
        project,
        total: 0,
        aadhaar: 0,
        enrollment: 0,
        detail: 0,
        remarkOnly: 0,
        filled: 0,
        pending: 0,
        blocks: new Set(),
        gps: new Set(),
        villages: new Set()
      };
    }
    const p = stats[project];
    p.total++;
    if (r.block) p.blocks.add(r.block);
    if (r.gp) p.gps.add(r.gp);
    if (r.village) p.villages.add(r.village);
    const kind = getEntryKind(r);
    if (kind === 'aadhaar') {
      p.aadhaar++;
      p.filled++;
    } else if (kind === 'enrollment') {
      p.enrollment++;
      p.filled++;
    } else if (kind === 'detail') {
      p.detail++;
      p.filled++;
    } else if (kind === 'remark') {
      p.remarkOnly++;
      p.filled++;
    } else {
      p.pending++;
    }
  });

  return Object.values(stats).map(p => ({
    ...p,
    blockCount: p.blocks.size,
    gpCount: p.gps.size,
    villageCount: p.villages.size,
    completion: p.total > 0 ? (p.filled / p.total) * 100 : 0,
    pendingShare: p.total > 0 ? (p.pending / p.total) * 100 : 0
  })).sort((a,b) => b.total - a.total);
}

function updateNavProgress() {
  const s = getStats();
  const pct = s.total > 0 ? ((s.anyFilled / s.total) * 100).toFixed(1) : '0.0';
  document.getElementById('nav-progress').textContent = `${s.anyFilled.toLocaleString()} / ${s.total.toLocaleString()} (${pct}%)`;
}

// DASHBOARD
function renderDashboard() {
  const s = getStats();
  const pct = s.total > 0 ? (s.anyFilled / s.total * 100).toFixed(1) : '0.0';
  document.getElementById('s-total').textContent = s.total.toLocaleString();
  document.getElementById('s-filled').textContent = s.anyFilled.toLocaleString();
  document.getElementById('s-filled-pct').textContent = pct + '% पूर्ण';
  document.getElementById('s-pending').textContent = s.pending.toLocaleString();
  document.getElementById('s-pending-pct').textContent = (100 - Number(pct)).toFixed(1) + '% बाकी';
  document.getElementById('s-remark').textContent = s.remarkOnly.toLocaleString();

  // Block bars
  const blocks = ['Dantewada','Geedam','Katekalyan','Kuakonda'];
  const colors = ['#79c0ff','#56d364','#e3b341','#f78166'];
  const blockCounts = {};
  const blockFilled = {};
  const blockVillages = {};
  blocks.forEach(b => { blockCounts[b]=0; blockFilled[b]=0; blockVillages[b]=new Set(); });
  DATA.forEach(r => {
    if(blockCounts[r.block]!==undefined) {
      blockCounts[r.block]++;
      blockVillages[r.block].add(r.village);
      if(hasEntryDetail(r)||r.remark) blockFilled[r.block]++;
    }
  });
  const maxCount = Math.max(1, ...blocks.map(b=>blockCounts[b]));

  let barsHtml = '';
  blocks.forEach((b,i) => {
    const w = Math.round(blockCounts[b]/maxCount*100);
    barsHtml += `<div class="bar-row">
      <div class="bar-label">${b}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${colors[i]}">${blockCounts[b].toLocaleString()}</div></div>
      <div class="bar-count">${blockCounts[b].toLocaleString()}</div>
    </div>`;
  });
  document.getElementById('block-bars').innerHTML = barsHtml;

  let progHtml = '';
  blocks.forEach((b,i) => {
    const pct2 = blockCounts[b]>0 ? (blockFilled[b]/blockCounts[b]*100).toFixed(1) : 0;
    progHtml += `<div class="progress-section">
      <div class="progress-label"><span>${b}</span><span style="color:${colors[i]}">${pct2}% (${blockFilled[b]}/${blockCounts[b]})</span></div>
      <div class="prog-track"><div class="prog-fill" style="width:${pct2}%;background:${colors[i]}"></div></div>
    </div>`;
  });
  document.getElementById('block-progress').innerHTML = progHtml;

  // Gender bars
  const male = DATA.filter(r=>r.gender==='Male').length;
  const female = DATA.filter(r=>r.gender==='Female').length;
  const total2 = male+female;
  document.getElementById('gender-bars').innerHTML = `
    <div class="bar-row">
      <div class="bar-label">पुरुष</div>
      <div class="bar-track"><div class="bar-fill" style="width:${total2 ? Math.round(male/total2*100) : 0}%;background:#79c0ff">${male.toLocaleString()}</div></div>
      <div class="bar-count">${total2 ? (male/total2*100).toFixed(1) : '0.0'}%</div>
    </div>
    <div class="bar-row">
      <div class="bar-label">महिला</div>
      <div class="bar-track"><div class="bar-fill" style="width:${total2 ? Math.round(female/total2*100) : 0}%;background:#f78166">${female.toLocaleString()}</div></div>
      <div class="bar-count">${total2 ? (female/total2*100).toFixed(1) : '0.0'}%</div>
    </div>`;

  // Block table
  let tableHtml = '';
  const badgeClasses = ['badge-blue','badge-green','badge-yellow','badge-orange'];
  blocks.forEach((b,i) => {
    const filledPct = blockCounts[b]>0 ? (blockFilled[b]/blockCounts[b]*100).toFixed(1) : '0.0';
    tableHtml += `<tr>
      <td><span class="badge ${badgeClasses[i]}">${b}</span></td>
      <td>${blockCounts[b].toLocaleString()}</td>
      <td>${blockVillages[b].size}</td>
      <td style="color:var(--accent3)">${blockFilled[b]}</td>
      <td style="font-weight:700">${filledPct}%</td>
    </tr>`;
  });
  document.getElementById('block-table-body').innerHTML = tableHtml;

  // Type bars
  const maxTypeCount = Math.max(1, s.aadhaarFilled, s.enrollmentFilled, s.remarkOnly);
  document.getElementById('type-bars').innerHTML = `
    <div class="bar-row">
      <div class="bar-label">आधार नंबर</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(1, Math.round(s.aadhaarFilled / maxTypeCount * 100))}%;background:#79c0ff">${s.aadhaarFilled.toLocaleString()}</div></div>
      <div class="bar-count">${s.aadhaarFilled}</div>
    </div>
    <div class="bar-row">
      <div class="bar-label">एनरोलमेंट</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(1, Math.round(s.enrollmentFilled / maxTypeCount * 100))}%;background:#e3b341">${s.enrollmentFilled.toLocaleString()}</div></div>
      <div class="bar-count">${s.enrollmentFilled}</div>
    </div>
    <div class="bar-row">
      <div class="bar-label">रिमार्क मात्र</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(1, Math.round(s.remarkOnly / maxTypeCount * 100))}%;background:#f78166">${s.remarkOnly.toLocaleString()}</div></div>
      <div class="bar-count">${s.remarkOnly}</div>
    </div>`;

  updateNavProgress();
}

// ENTRY TABLE
function applyFilters() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const block = document.getElementById('filter-block').value;
  const gp = document.getElementById('filter-gp').value;
  const village = document.getElementById('filter-village').value;
  const status = document.getElementById('filter-status').value;
  const gender = document.getElementById('filter-gender').value;

  filteredData = DATA.filter(r => {
    if(block && r.block !== block) return false;
    if(gp && r.gp !== gp) return false;
    if(village && r.village !== village) return false;
    if(gender && r.gender !== gender) return false;
    const entryKind = getEntryKind(r);
    if(status === 'filled' && entryKind === 'empty') return false;
    if(status === 'empty' && entryKind !== 'empty') return false;
    if(search) {
      const hay = `${r.member} ${r.fatherName} ${r.hof} ${r.village} ${r.mobile}`.toLowerCase();
      if(!hay.includes(search)) return false;
    }
    return true;
  });
  currentPage = 1;
  renderTable();
}

// à¤¬à¥à¤²à¥‰à¤• à¤«à¤¼à¤¿à¤²à¥à¤Ÿà¤° à¤¬à¤¦à¤²à¤¨à¥‡ à¤ªà¤° à¤—à¥à¤°à¤¾à¤® à¤ªà¤‚à¤šà¤¾à¤¯à¤¤ à¤µ à¤—à¤¾à¤à¤µ à¤•à¥‡ à¤¡à¥à¤°à¥‰à¤ªà¤¡à¤¾à¤‰à¤¨ à¤•à¥‹ à¤«à¤¿à¤° à¤¸à¥‡ à¤­à¤°à¥‡à¤‚
function onBlockFilterChange() {
  populateGPOptions();
  populateVillageOptions();
  applyFilters();
}

// à¤—à¥à¤°à¤¾à¤® à¤ªà¤‚à¤šà¤¾à¤¯à¤¤ à¤«à¤¼à¤¿à¤²à¥à¤Ÿà¤° à¤¬à¤¦à¤²à¤¨à¥‡ à¤ªà¤° à¤—à¤¾à¤à¤µ à¤•à¥‡ à¤¡à¥à¤°à¥‰à¤ªà¤¡à¤¾à¤‰à¤¨ à¤•à¥‹ à¤«à¤¿à¤° à¤¸à¥‡ à¤­à¤°à¥‡à¤‚
function onGPFilterChange() {
  populateVillageOptions();
  applyFilters();
}

// à¤šà¤¯à¤¨à¤¿à¤¤ à¤¬à¥à¤²à¥‰à¤• à¤•à¥‡ à¤…à¤¨à¥à¤¸à¤¾à¤° à¤—à¥à¤°à¤¾à¤® à¤ªà¤‚à¤šà¤¾à¤¯à¤¤ à¤•à¥€ à¤¸à¥‚à¤šà¥€ à¤­à¤°à¥‡à¤‚
function populateGPOptions() {
  const block = document.getElementById('filter-block').value;
  const gpSelect = document.getElementById('filter-gp');
  const currentValue = gpSelect.value;

  const gpSet = new Set();
  DATA.forEach(r => {
    if(block && r.block !== block) return;
    if(r.gp) gpSet.add(r.gp);
  });
  const gpList = Array.from(gpSet).sort((a,b) => a.localeCompare(b));

  gpSelect.innerHTML = '<option value="">सभी ग्राम पंचायत</option>' +
    gpList.map(gp => `<option value="${gp}">${gp}</option>`).join('');

  // à¤ªà¤¿à¤›à¤²à¤¾ à¤šà¤¯à¤¨ à¤…à¤­à¥€ à¤­à¥€ à¤®à¤¾à¤¨à¥à¤¯ à¤¹à¥‹ à¤¤à¥‹ à¤‰à¤¸à¥‡ à¤¬à¤¨à¤¾à¤ à¤°à¤–à¥‡à¤‚
  if(gpList.includes(currentValue)) gpSelect.value = currentValue;
}

// à¤šà¤¯à¤¨à¤¿à¤¤ à¤¬à¥à¤²à¥‰à¤• + à¤—à¥à¤°à¤¾à¤® à¤ªà¤‚à¤šà¤¾à¤¯à¤¤ à¤•à¥‡ à¤…à¤¨à¥à¤¸à¤¾à¤° à¤—à¤¾à¤à¤µ à¤•à¥€ à¤¸à¥‚à¤šà¥€ à¤­à¤°à¥‡à¤‚
function populateVillageOptions() {
  const block = document.getElementById('filter-block').value;
  const gp = document.getElementById('filter-gp').value;
  const villageSelect = document.getElementById('filter-village');
  const currentValue = villageSelect.value;

  const villageSet = new Set();
  DATA.forEach(r => {
    if(block && r.block !== block) return;
    if(gp && r.gp !== gp) return;
    if(r.village) villageSet.add(r.village);
  });
  const villageList = Array.from(villageSet).sort((a,b) => a.localeCompare(b));

  villageSelect.innerHTML = '<option value="">सभी गाँव</option>' +
    villageList.map(v => `<option value="${v}">${v}</option>`).join('');

  if(villageList.includes(currentValue)) villageSelect.value = currentValue;
}

function getReportFilterElements() {
  return {
    block: document.getElementById('report-filter-block'),
    gp: document.getElementById('report-filter-gp'),
    village: document.getElementById('report-filter-village'),
    reason: document.getElementById('report-filter-reason')
  };
}

function setSelectOptions(select, placeholder, values, currentValue) {
  if (!select) return;
  const list = Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'hi'));
  select.innerHTML = `<option value="">${placeholder}</option>` +
    list.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  if (list.includes(currentValue)) select.value = currentValue;
}

function populateReportFilterOptions() {
  const els = getReportFilterElements();
  if (!els.block || !els.gp || !els.village || !els.reason) return;

  const selectedBlock = els.block.value;
  const selectedGP = els.gp.value;
  const selectedVillage = els.village.value;
  const selectedReason = els.reason.value;

  const gpValues = DATA
    .filter(r => !selectedBlock || r.block === selectedBlock)
    .map(r => r.gp);
  setSelectOptions(els.gp, 'सभी ग्राम पंचायत', gpValues, selectedGP);

  const effectiveGP = els.gp.value;
  const villageValues = DATA
    .filter(r => !selectedBlock || r.block === selectedBlock)
    .filter(r => !effectiveGP || r.gp === effectiveGP)
    .map(r => r.village);
  setSelectOptions(els.village, 'सभी गाँव', villageValues, selectedVillage);

  const effectiveVillage = els.village.value;
  const reasonValues = DATA
    .filter(r => !selectedBlock || r.block === selectedBlock)
    .filter(r => !effectiveGP || r.gp === effectiveGP)
    .filter(r => !effectiveVillage || r.village === effectiveVillage)
    .map(r => String(r.remark || '').trim());
  setSelectOptions(els.reason, 'सभी Issue / Reason', reasonValues, selectedReason);
}

function getReportFilteredData() {
  const els = getReportFilterElements();
  if (!els.block) return [...DATA];
  const block = els.block.value;
  const gp = els.gp.value;
  const village = els.village.value;
  const reason = els.reason.value;

  return DATA.filter(r => {
    if (block && r.block !== block) return false;
    if (gp && r.gp !== gp) return false;
    if (village && r.village !== village) return false;
    if (reason && String(r.remark || '').trim() !== reason) return false;
    return true;
  });
}

function updateReportFilterSummary() {
  const el = document.getElementById('report-filter-summary');
  if (!el) return;
  const total = DATA.length;
  const shown = reportFilteredData.length;
  const parts = [];
  const els = getReportFilterElements();
  if (els.block && els.block.value) parts.push(`Block: ${els.block.value}`);
  if (els.gp && els.gp.value) parts.push(`GP: ${els.gp.value}`);
  if (els.village && els.village.value) parts.push(`Village: ${els.village.value}`);
  if (els.reason && els.reason.value) parts.push(`Issue: ${els.reason.value}`);
  el.textContent = `${shown.toLocaleString()} / ${total.toLocaleString()} रिकॉर्ड` + (parts.length ? ` | ${parts.join(' | ')}` : ' | सभी रिकॉर्ड');
}

function applyReportFilters() {
  populateReportFilterOptions();
  reportFilteredData = getReportFilteredData();
  updateReportFilterSummary();
  renderReport();
}

function onReportBlockFilterChange() {
  const els = getReportFilterElements();
  if (els.gp) els.gp.value = '';
  if (els.village) els.village.value = '';
  if (els.reason) els.reason.value = '';
  applyReportFilters();
}

function onReportGPFilterChange() {
  const els = getReportFilterElements();
  if (els.village) els.village.value = '';
  if (els.reason) els.reason.value = '';
  applyReportFilters();
}

function resetReportFilters() {
  const els = getReportFilterElements();
  Object.values(els).forEach(el => {
    if (el) el.value = '';
  });
  populateReportFilterOptions();
  Object.values(els).forEach(el => {
    if (el) el.value = '';
  });
  reportFilteredData = [...DATA];
  updateReportFilterSummary();
  renderReport();
}

function renderTable() {
  const start = (currentPage-1)*PAGE_SIZE;
  const pageData = filteredData.slice(start, start+PAGE_SIZE);
  const tbody = document.getElementById('records-tbody');

  if(filteredData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="es-icon">🔍</div><p>कोई रिकॉर्ड नहीं मिला</p></div></td></tr>`;
    document.getElementById('table-info').textContent = '0 रिकॉर्ड';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  let html = '';
  pageData.forEach(r => {
    const entryKind = getEntryKind(r);
    let statusHtml;
    if(entryKind === 'aadhaar') statusHtml = `<span class="status-dot dot-filled"></span><span style="color:var(--accent3);font-size:12px">आधार ✓</span>`;
    else if(entryKind === 'enrollment') statusHtml = `<span class="status-dot" style="background:var(--accent4)"></span><span style="color:var(--accent4);font-size:12px">एनरोलमेंट ✓</span>`;
    else if(entryKind === 'detail') statusHtml = `<span class="status-dot" style="background:var(--accent3)"></span><span style="color:var(--accent3);font-size:12px">दर्ज विवरण ✓</span>`;
    else if(entryKind === 'remark') statusHtml = `<span class="status-dot" style="background:var(--accent2)"></span><span style="color:var(--accent2);font-size:12px">रिमार्क ✓</span>`;
    else statusHtml = `<span class="status-dot dot-empty"></span><span style="color:var(--text3);font-size:12px">खाली</span>`;

    const validMobile = /^\d{10}$/.test(r.mobile || '');
    const callCellHtml = validMobile
      ? `<a class="call-btn" href="tel:${r.mobile}" title="${r.mobile} पर कॉल करें">📞 ${r.mobile}</a>`
      : `<span class="call-btn disabled">📞 -</span>`;

    html += `<tr>
      <td style="color:var(--text3)">${r.sno}</td>
      <td><span style="font-size:12px;color:var(--text2)">${r.block}</span></td>
      <td style="font-size:12px">${r.gp}</td>
      <td style="font-size:12px">${r.village}</td>
      <td class="guardian-cell">${guardianDisplayHtml(r)}</td>
      <td><strong>${r.member}</strong></td>
      <td style="font-size:12px;color:var(--text2)">${r.gender==='Male'?'पुरुष':'महिला'} / ${r.age|0} वर्ष</td>
      <td>${statusHtml}</td>
      <td class="time-cell">${escapeHtml(formatEntryTime(r.entryTime))}</td>
      <td>${callCellHtml}</td>
      <td><button class="edit-btn" onclick="openModal('${r._uiKey || String(r.sno)}')">संपादित</button></td>
    </tr>`;
  });
  tbody.innerHTML = html;

  document.getElementById('table-info').textContent = `${filteredData.length.toLocaleString()} रिकॉर्ड (पृष्ठ ${currentPage}/${Math.ceil(filteredData.length/PAGE_SIZE)})`;
  renderPagination();
}

function renderPagination() {
  const total = Math.ceil(filteredData.length / PAGE_SIZE);
  if(total <= 1) { document.getElementById('pagination').innerHTML = ''; return; }
  let html = '';
  const pages = [];
  if(total <= 7) { for(let i=1;i<=total;i++) pages.push(i); }
  else {
    pages.push(1);
    if(currentPage > 3) pages.push('...');
    for(let i=Math.max(2,currentPage-1);i<=Math.min(total-1,currentPage+1);i++) pages.push(i);
    if(currentPage < total-2) pages.push('...');
    pages.push(total);
  }

  if(currentPage > 1) html += `<button class="page-btn" onclick="goPage(${currentPage-1})">‹</button>`;
  pages.forEach(p => {
    if(p==='...') html += `<span class="page-info">...</span>`;
    else html += `<button class="page-btn ${p===currentPage?'active':''}" onclick="goPage(${p})">${p}</button>`;
  });
  if(currentPage < total) html += `<button class="page-btn" onclick="goPage(${currentPage+1})">›</button>`;
  document.getElementById('pagination').innerHTML = html;
}

function goPage(p) {
  currentPage = p;
  renderTable();
  document.querySelector('.table-wrap').scrollIntoView({behavior:'smooth', block:'start'});
}

// MODAL
function openModal(rowKey) {
  const rec = DATA.find(r => (r._uiKey || String(r.sno)) === String(rowKey)) || DATA.find(r => r.sno === Number(rowKey));
  if (!rec) return;
  editingIdx = rec._uiKey || String(rec.sno);
  selectedType = null;

  document.getElementById('modal-title').textContent = 'आधार जानकारी भरें';
  document.getElementById('modal-person').textContent = `${rec.member} - ${guardianDisplay(rec)} - ${rec.village}, ${rec.block}`;
  const guardianInfoHtml = guardianParts(rec)
    .map(part => `<div class="info-item"><div class="info-key">${escapeHtml(part.label)}</div><div class="info-val">${escapeHtml(part.name)}</div></div>`)
    .join('');
  document.getElementById('modal-info').innerHTML = `
    <div class="info-item"><div class="info-key">ब्लॉक</div><div class="info-val">${rec.block}</div></div>
    <div class="info-item"><div class="info-key">ग्राम पंचायत</div><div class="info-val">${rec.gp}</div></div>
    <div class="info-item"><div class="info-key">गाँव</div><div class="info-val">${rec.village}</div></div>
    ${guardianInfoHtml}
    <div class="info-item"><div class="info-key">मोबाइल</div><div class="info-val">${rec.mobile||'-'}${/^\d{10}$/.test(rec.mobile||'') ? `<a class="modal-call-btn" href="tel:${rec.mobile}">📞 कॉल करें</a>` : ''}</div></div>
    <div class="info-item"><div class="info-key">लिंग</div><div class="info-val">${rec.gender==='Male'?'पुरुष':'महिला'}</div></div>
    <div class="info-item"><div class="info-key">आयु</div><div class="info-val">${rec.age|0} वर्ष</div></div>`;

  // Pre-fill
  document.getElementById('inp-aadhaar').value = rec.aadhaar || '';
  document.getElementById('inp-enrollment').value = rec.enrollment || '';
  document.getElementById('inp-remark').value = rec.remark || '';
  prefillRemarkPresets(rec.remark || '');

  ['input-aadhaar','input-enrollment','input-remark'].forEach(id => document.getElementById(id).style.display='none');
  ['opt-aadhaar','opt-enrollment','opt-remark'].forEach(id => {
    document.getElementById(id).className = 'radio-opt';
  });

  if(rec.aadhaar) selectType('aadhaar');
  else if(rec.enrollment) selectType('enrollment');
  else if(rec.remark) selectType('remark');

  document.getElementById('btn-save').disabled = !selectedType;
  document.getElementById('modal').style.display = 'flex';
}

// à¤°à¤¿à¤®à¤¾à¤°à¥à¤• à¤•à¥‡ à¤²à¤¿à¤ à¤ªà¤¹à¤²à¥‡ à¤¸à¥‡ à¤¤à¤¯ à¤‰à¤ª-à¤µà¤¿à¤•à¤²à¥à¤ª
const REMARK_PRESETS = [
  'जन्म प्रमाण पत्र नहीं बनाया गया',
  'जन्म प्रमाण पत्र ऑफलाइन',
  'माता-पिता का नाम आधार मे और बच्चे के जन्म प्रमाण पत्र में नाम मेल नहीं खा रहे थे',
  ENROLLMENT_REQUIRED_REMARK,
  'एनरोलमेंट करवाया गया है, परंतु रिजेक्ट हो गया है',
  'माता-पिता के पास आधार कार्ड नहीं है',
  'मृत्यु',
  'बच्चा अनाथ है',
  'व्यक्ति नहीं मिला',
  'पलायन',
  'ऑनलाइन सही जन्म प्रमाण पत्र उपलब्ध है, परंतु एनरोलमेंट नहीं हुआ है।',
  'नया वोटर आईडी कार्ड उपलब्ध नहीं है',
  'नया वोटर आईडी कार्ड उपलब्ध है परंतु एनरोलमेंट नहीं हुआ है।'
];

function renderRemarkPresets() {
  const group = document.getElementById('remark-preset-group');
  let html = '';
  REMARK_PRESETS.forEach((text, i) => {
    html += `<label class="remark-radio-item">
      <input type="radio" name="remarkPreset" value="${i}" onclick="selectRemarkPreset('${i}')">
      <span>${text}</span>
    </label>`;
  });
  group.innerHTML = html;
}

function selectRemarkPreset(value) {
  const otherWrap = document.getElementById('remark-other-wrap');
  const otherInput = document.getElementById('inp-remark-other');
  const remarkField = document.getElementById('inp-remark');
  if (value === 'other') {
    otherWrap.style.display = 'block';
    remarkField.value = otherInput.value.trim();
    document.getElementById('btn-save').disabled = remarkField.value.length === 0;
  } else {
    otherWrap.style.display = 'none';
    const selectedRemark = REMARK_PRESETS[Number(value)];
    remarkField.value = selectedRemark;
    if (selectedRemark === ENROLLMENT_REQUIRED_REMARK) {
      selectType('enrollment');
      setTimeout(() => document.getElementById('inp-enrollment').focus(), 0);
    } else {
      document.getElementById('btn-save').disabled = false;
    }
  }
}

function onRemarkOtherInput() {
  const v = document.getElementById('inp-remark-other').value.trim();
  document.getElementById('inp-remark').value = v;
  document.getElementById('btn-save').disabled = v.length === 0;
}

// à¤ªà¤¿à¤›à¤²à¥‡ à¤¸à¤¹à¥‡à¤œà¥‡ à¤—à¤ à¤°à¤¿à¤®à¤¾à¤°à¥à¤• à¤•à¥‡ à¤†à¤§à¤¾à¤° à¤ªà¤° à¤¸à¤¹à¥€ à¤µà¤¿à¤•à¤²à¥à¤ª à¤šà¥à¤¨à¥‡à¤‚ (à¤à¤¡à¤¿à¤Ÿ à¤•à¤°à¤¤à¥‡ à¤¸à¤®à¤¯)
function prefillRemarkPresets(existingRemark) {
  renderRemarkPresets();
  const radios = document.getElementsByName('remarkPreset');
  radios.forEach(r => r.checked = false);
  document.getElementById('remark-other-wrap').style.display = 'none';
  document.getElementById('inp-remark-other').value = '';

  if (!existingRemark) return;
  const presetIdx = REMARK_PRESETS.indexOf(existingRemark);
  if (presetIdx !== -1) {
    radios[presetIdx].checked = true;
  } else {
    const otherRadio = document.querySelector('input[name="remarkPreset"][value="other"]');
    if (otherRadio) otherRadio.checked = true;
    document.getElementById('remark-other-wrap').style.display = 'block';
    document.getElementById('inp-remark-other').value = existingRemark;
  }
}
function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

function closeModalOverlay(e) { if(e.target===document.getElementById('modal')) closeModal(); }

function selectType(type) {
  selectedType = type;
  ['aadhaar','enrollment','remark'].forEach(t => {
    document.getElementById('opt-'+t).className = 'radio-opt' + (t===type ? ` selected-${t}` : '');
    document.getElementById('input-'+t).style.display = t===type ? 'block' : 'none';
  });
  document.getElementById('btn-save').disabled = false;
  if(type==='aadhaar') validateAadhaar();
  if(type==='enrollment') validateEnrollment();
}

function validateAadhaar() {
  const v = document.getElementById('inp-aadhaar').value.replace(/\D/g,'');
  document.getElementById('inp-aadhaar').value = v;
  const el = document.getElementById('cc-aadhaar');
  const inp = document.getElementById('inp-aadhaar');
  if(v.length===12) { el.innerHTML=`<span class="char-ok">✓ 12/12 - सही</span>`; inp.className='form-input valid'; }
  else if(v.length>0) { el.innerHTML=`<span class="char-err">${v.length}/12 - अधूरा</span>`; inp.className='form-input invalid'; }
  else { el.innerHTML=`<span class="char-no">0/12</span>`; inp.className='form-input'; }
  document.getElementById('btn-save').disabled = v.length !== 12;
}

function validateEnrollment() {
  const v = document.getElementById('inp-enrollment').value.replace(/\D/g,'');
  document.getElementById('inp-enrollment').value = v;
  const el = document.getElementById('cc-enrollment');
  const inp = document.getElementById('inp-enrollment');
  if(v.length===28) { el.innerHTML=`<span class="char-ok">✓ 28/28 - सही</span>`; inp.className='form-input valid'; }
  else if(v.length>0) { el.innerHTML=`<span class="char-err">${v.length}/28 - अधूरा</span>`; inp.className='form-input invalid'; }
  else { el.innerHTML=`<span class="char-no">0/28</span>`; inp.className='form-input'; }
  document.getElementById('btn-save').disabled = v.length !== 28;
}

async function saveEntry() {
  const rec = DATA.find(r => (r._uiKey || String(r.sno)) === String(editingIdx)) || DATA.find(r => r.sno === Number(editingIdx));
  if(!rec || !selectedType) return;
  if (!isBackendConfigured()) {
    showToast(backendConfigHelp());
    setSyncStatus(backendConfigHelp(), 'err');
    return;
  }
  const previous = { ...rec };

  if(selectedType==='aadhaar') {
    const v = document.getElementById('inp-aadhaar').value;
    if(v.length!==12) return;
    rec.aadhaar = v; rec.enrollment = ''; rec.remark = '';
  } else if(selectedType==='enrollment') {
    const v = document.getElementById('inp-enrollment').value;
    if(v.length!==28) return;
    const enrollmentRemark = document.getElementById('inp-remark').value.trim();
    rec.enrollment = v; rec.aadhaar = '';
    rec.remark = enrollmentRemark === ENROLLMENT_REQUIRED_REMARK ? enrollmentRemark : '';
  } else {
    const v = document.getElementById('inp-remark').value.trim();
    rec.remark = v; rec.aadhaar = ''; rec.enrollment = '';
  }
  rec.entryTime = createEntryTimestamp();

  closeModal();
  renderTable();
  renderDashboard();
  const saved = await pushToSheet(rec);
  if (saved) {
    showToast('जानकारी सहेजी गई!');
  } else {
    Object.assign(rec, previous);
    renderTable();
    renderDashboard();
    showToast('Backend में save नहीं हुआ');
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// REPORT
function getBlockReportData(records = DATA) {
  const blocks = ['Dantewada', 'Geedam', 'Katekalyan', 'Kuakonda'];
  const blockStats = {};
  blocks.forEach(b => blockStats[b] = { total: 0, aadhaar: 0, enrollment: 0, detail: 0, remarkOnly: 0, empty: 0 });
  records.forEach(r => {
    if (!blockStats[r.block]) return;
    blockStats[r.block].total++;
    const kind = getEntryKind(r);
    if (kind === 'aadhaar') blockStats[r.block].aadhaar++;
    else if (kind === 'enrollment') blockStats[r.block].enrollment++;
    else if (kind === 'detail') blockStats[r.block].detail++;
    else if (kind === 'remark') blockStats[r.block].remarkOnly++;
    else blockStats[r.block].empty++;
  });

  const totals = { total: 0, aadhaar: 0, enrollment: 0, detail: 0, remarkOnly: 0, empty: 0 };
  const rows = blocks.map(block => {
    const stats = blockStats[block];
    Object.keys(totals).forEach(key => totals[key] += stats[key]);
    const filled = stats.aadhaar + stats.enrollment + stats.detail + stats.remarkOnly;
    return {
      block,
      ...stats,
      filled,
      pct: stats.total > 0 ? (filled / stats.total * 100).toFixed(1) : '0.0'
    };
  });
  const totalFilled = totals.aadhaar + totals.enrollment + totals.detail + totals.remarkOnly;
  return {
    rows,
    totals: {
      ...totals,
      filled: totalFilled,
      pct: totals.total > 0 ? (totalFilled / totals.total * 100).toFixed(1) : '0.0'
    }
  };
}

function getGPReportData(records = DATA) {
  const gpStats = new Map();
  records.forEach(r => {
    const gp = String(r.gp || '').trim();
    const block = String(r.block || '').trim();
    const key = gp ? normalizeReportKey(gp) : `__blank__${normalizeReportKey(block)}`;
    if (!gpStats.has(key)) {
      gpStats.set(key, { block, blocks: new Set(), gp, total: 0, filled: 0 });
    }
    const stats = gpStats.get(key);
    if (block) stats.blocks.add(block);
    if (!stats.gp && gp) stats.gp = gp;
    stats.total++;
    if (hasEntryDetail(r) || r.remark) stats.filled++;
  });

  const rows = Array.from(gpStats.values())
    .map(g => ({
      ...g,
      block: Array.from(g.blocks).join(', ') || g.block,
      blocks: undefined,
      empty: g.total - g.filled,
      pct: g.total > 0 ? (g.filled / g.total * 100).toFixed(0) : '0'
    }));
  const totals = rows.reduce((sum, row) => {
    sum.total += row.total;
    sum.filled += row.filled;
    sum.empty += row.empty;
    return sum;
  }, { total: 0, filled: 0, empty: 0 });
  return {
    rows,
    totals: {
      ...totals,
      gpCount: rows.length,
      pct: totals.total > 0 ? (totals.filled / totals.total * 100).toFixed(0) : '0'
    }
  };
}

function normalizeReportKey(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .trim()
    .toLowerCase();
}

function getReasonReportData(records = DATA) {
  const reasonStats = {};
  records.forEach(r => {
    const reason = String(r.remark || '').trim();
    if (!reason) return;
    if (!reasonStats[reason]) reasonStats[reason] = { reason, total: 0 };
    reasonStats[reason].total++;
  });

  const total = Object.values(reasonStats).reduce((sum, row) => sum + row.total, 0);
  const rows = Object.values(reasonStats)
    .sort((a, b) => b.total - a.total || a.reason.localeCompare(b.reason, 'hi'))
    .map(row => ({
      ...row,
      pct: total > 0 ? (row.total / total * 100).toFixed(1) : '0.0'
    }));

  return {
    rows,
    totals: {
      total,
      pct: total > 0 ? '100.0' : '0.0'
    }
  };
}

function renderReport() {
  document.getElementById('report-date').textContent = new Date().toLocaleDateString('hi-IN');
  reportFilteredData = getReportFilteredData();
  updateReportFilterSummary();
  const s = getStats(reportFilteredData);
  const pct = s.total > 0 ? (s.anyFilled/s.total*100).toFixed(1) : '0.0';
  document.getElementById('rm-total').textContent = s.total.toLocaleString();
  document.getElementById('rm-filled').textContent = s.anyFilled.toLocaleString();
  document.getElementById('rm-pending').textContent = s.pending.toLocaleString();
  document.getElementById('rm-pct').textContent = pct + '%';

  let bHtml = '';
  const blockReport = getBlockReportData(reportFilteredData);
  blockReport.rows.forEach(bs => {
    bHtml += `<tr><td><strong>${bs.block}</strong></td><td>${bs.total.toLocaleString()}</td><td style="color:var(--accent2)">${bs.aadhaar.toLocaleString()}</td><td style="color:var(--accent4)">${bs.enrollment.toLocaleString()}</td><td style="color:var(--accent3)">${bs.remarkOnly.toLocaleString()}</td><td style="color:var(--accent)">${bs.empty.toLocaleString()}</td><td><strong>${bs.pct}%</strong></td></tr>`;
  });
  const bt = blockReport.totals;
  bHtml += `<tr class="total-row"><td><strong>कुल</strong></td><td><strong>${bt.total.toLocaleString()}</strong></td><td>${bt.aadhaar.toLocaleString()}</td><td>${bt.enrollment.toLocaleString()}</td><td>${bt.remarkOnly.toLocaleString()}</td><td>${bt.empty.toLocaleString()}</td><td><strong>${bt.pct}%</strong></td></tr>`;
  document.getElementById('rpt-block').innerHTML = bHtml || '<tr><td colspan="7" style="text-align:center;color:var(--text3)">कोई डेटा नहीं</td></tr>';

  // GP stats
  let gpHtml = '';
  const gpReport = getGPReportData(reportFilteredData);
  gpReport.rows.forEach(g => {
    gpHtml += `<tr><td style="font-size:12px;color:var(--text2)">${g.block}</td><td>${g.gp}</td><td>${g.total.toLocaleString()}</td><td style="color:var(--accent3)">${g.filled.toLocaleString()}</td><td style="color:var(--accent)">${g.empty.toLocaleString()}</td><td><strong>${g.pct}%</strong></td></tr>`;
  });
  const gt = gpReport.totals;
  gpHtml += `<tr class="total-row"><td colspan="2"><strong>कुल ग्राम पंचायत: ${gt.gpCount.toLocaleString()}</strong></td><td><strong>${gt.total.toLocaleString()}</strong></td><td>${gt.filled.toLocaleString()}</td><td>${gt.empty.toLocaleString()}</td><td><strong>${gt.pct}%</strong></td></tr>`;
  document.getElementById('rpt-gp').innerHTML = gpHtml || '<tr><td colspan="6" style="text-align:center;color:var(--text3)">कोई डेटा नहीं</td></tr>';

  // Reason stats
  const reasonReport = getReasonReportData(reportFilteredData);
  REASON_REPORT_ROWS = reasonReport.rows;
  let reasonHtml = '';
  reasonReport.rows.forEach((r, i) => {
    reasonHtml += `<tr><td>${i + 1}</td><td>${escapeHtml(r.reason)}</td><td>${r.total.toLocaleString()}</td><td><button class="btn-mini-action" onclick="openReasonPreview(${i})">देखें</button></td></tr>`;
  });
  if (reasonReport.rows.length) {
    reasonHtml += `<tr class="total-row"><td colspan="2"><strong>कुल</strong></td><td><strong>${reasonReport.totals.total.toLocaleString()}</strong></td><td></td></tr>`;
  }
  document.getElementById('rpt-reason').innerHTML = reasonHtml || '<tr><td colspan="4" style="text-align:center;color:var(--text3)">कोई कारण नहीं</td></tr>';

  // Filled records
  const filled = reportFilteredData.filter(r => hasEntryDetail(r)||r.remark);
  if(filled.length===0) {
    document.getElementById('rpt-filled').innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="es-icon">📭</div><p>अभी कोई रिकॉर्ड भरा नहीं गया है।<br>डेटा एंट्री टैब पर जाएं और शुरू करें।</p></div></td></tr>';
  } else {
    let fHtml = '';
    filled.forEach((r,i) => {
      const kind = getEntryKind(r);
      const type = kind === 'aadhaar' ? 'आधार' : kind === 'enrollment' ? 'एनरोलमेंट' : kind === 'detail' ? 'अन्य' : 'रिमार्क';
      const val = r.aadhaar || r.enrollment || r.entryValue || r.remark;
      fHtml += `<tr><td>${i+1}</td><td style="font-size:12px">${r.block}</td><td style="font-size:12px">${r.village}</td><td><strong>${r.member}</strong><br><span style="font-size:11px;color:var(--text3)">${guardianDisplay(r)}</span></td><td>${type}</td><td style="font-family:monospace;font-size:13px;letter-spacing:1px">${val}</td><td class="time-cell">${escapeHtml(formatEntryTime(r.entryTime))}</td></tr>`;
    });
    fHtml += `<tr class="total-row"><td colspan="7"><strong>कुल भरे हुए रिकॉर्ड: ${filled.length.toLocaleString()}</strong></td></tr>`;
    document.getElementById('rpt-filled').innerHTML = fHtml;
  }
}

// EXPORT
function exportCSV() {
  const records = getReportFilteredData();
  if(!records.length) { showToast('फिल्टर में कोई रिकॉर्ड नहीं!'); return; }
  const headers = ['S.No.','District','Block','Gram Panchayat','Village','Father/Husband Name','Head of Family','Member','Mobile','Gender','Age','Status','Aadhaar (12 digit)','Enrollment (28 digit)','Entry Detail','Issue / Remark','Entry Time'];
  const rows = records.map(r => [r.sno,r.district,r.block,r.gp,r.village,r.fatherName,r.hof,r.member,r.mobile,r.gender,r.age,getEntryKind(r),r.aadhaar,r.enrollment,r.entryValue,r.remark,formatEntryTime(r.entryTime)]);
  const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `aadhaar_dantewada_filtered_${reportFileDate()}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast('CSV डाउनलोड हो रही है!');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function reportFileDate() {
  return new Date().toISOString().slice(0, 10);
}

function getReportSectionData(section) {
  const source = getReportFilteredData();
  if (section === 'block') {
    const report = getBlockReportData(source);
    const rows = report.rows.map(bs => [bs.block, bs.total, bs.aadhaar, bs.enrollment, bs.remarkOnly, bs.empty, bs.pct + '%']);
    rows.push(['कुल', report.totals.total, report.totals.aadhaar, report.totals.enrollment, report.totals.remarkOnly, report.totals.empty, report.totals.pct + '%']);
    return {
      title: 'Block-wise summary',
      filename: 'block_wise_summary',
      headers: ['ब्लॉक', 'कुल सदस्य', 'आधार भरे', 'एनरोलमेंट भरे', 'रिमार्क मात्र', 'खाली', 'पूर्णता %'],
      rows
    };
  }

  if (section === 'gp') {
    const report = getGPReportData(source);
    const rows = report.rows.map(g => [g.block, g.gp, g.total, g.filled, g.empty, g.pct + '%']);
    rows.push([`कुल ग्राम पंचायत: ${report.totals.gpCount}`, '', report.totals.total, report.totals.filled, report.totals.empty, report.totals.pct + '%']);
    return {
      title: 'Gram Panchayat-wise summary',
      filename: 'gp_wise_summary',
      headers: ['ब्लॉक', 'ग्राम पंचायत', 'कुल', 'भरे', 'खाली', '%'],
      rows
    };
  }

  if (section === 'reason') {
    const report = getReasonReportData(source);
    const rows = report.rows.map((r, i) => [i + 1, r.reason, r.total]);
    rows.push(['कुल', '', report.totals.total]);
    return {
      title: 'Reason-wise report',
      filename: 'reason_wise_report',
      headers: ['क्र.', 'कारण', 'कुल'],
      rows
    };
  }

  if (section === 'filled') {
    const filled = source.filter(r => hasEntryDetail(r) || r.remark);
    const rows = filled.map((r, i) => {
      const kind = getEntryKind(r);
      const type = kind === 'aadhaar' ? 'आधार' : kind === 'enrollment' ? 'एनरोलमेंट' : kind === 'detail' ? 'अन्य' : 'रिमार्क';
      const value = r.aadhaar || r.enrollment || r.entryValue || r.remark;
      return [
        i + 1,
        r.block,
        r.gp,
        r.village,
        guardianDisplay(r),
        r.member,
        type,
        value,
        formatEntryTime(r.entryTime),
        r.mobile,
        r.gender,
        r.age
      ];
    });
    rows.push(['कुल', '', '', '', '', filled.length, '', '', '', '', '', '']);
    return {
      title: 'Filled records',
      filename: 'filled_records',
      headers: ['क्र.', 'ब्लॉक', 'ग्राम पंचायत', 'गाँव', 'पिता/पति/मुखिया', 'सदस्य', 'प्रकार', 'नंबर / रिमार्क', 'समय', 'मोबाइल', 'लिंग', 'आयु'],
      rows
    };
  }

  return null;
}

function getFilteredReportData() {
  const source = getReportFilteredData();
  const rows = source.map((r, i) => {
    const kind = getEntryKind(r);
    const type = kind === 'aadhaar' ? 'आधार' : kind === 'enrollment' ? 'एनरोलमेंट' : kind === 'detail' ? 'अन्य' : kind === 'remark' ? 'रिमार्क / Issue' : 'खाली';
    return [
      i + 1,
      r.sno,
      r.district,
      r.block,
      r.gp,
      r.village,
      guardianDisplay(r),
      r.member,
      r.mobile,
      r.gender === 'Male' ? 'पुरुष' : 'महिला',
      r.age,
      type,
      r.aadhaar,
      r.enrollment,
      r.entryValue,
      r.remark,
      formatEntryTime(r.entryTime)
    ];
  });
  rows.push(['कुल', source.length, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  return {
    title: 'Filtered Aadhaar WCD records',
    filename: 'filtered_aadhaar_records',
    headers: ['क्र.', 'S.No.', 'District', 'ब्लॉक', 'ग्राम पंचायत', 'गाँव', 'पिता/पति/मुखिया', 'सदस्य', 'मोबाइल', 'लिंग', 'आयु', 'स्थिति', 'आधार', 'एनरोलमेंट', 'Entry Detail', 'Issue / Remark', 'समय'],
    rows
  };
}

function buildExportTableHtml(report) {
  const head = report.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const body = report.rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function getReasonDetailRows(reason) {
  const selectedReason = String(reason || '').trim();
  return getReportFilteredData()
    .filter(r => String(r.remark || '').trim() === selectedReason)
    .sort((a, b) => {
      const blockCompare = String(a.block || '').localeCompare(String(b.block || ''), 'hi');
      if (blockCompare) return blockCompare;
      const gpCompare = String(a.gp || '').localeCompare(String(b.gp || ''), 'hi');
      if (gpCompare) return gpCompare;
      return String(a.village || '').localeCompare(String(b.village || ''), 'hi');
    });
}

function getReasonDetailReportData(reason) {
  const rows = getReasonDetailRows(reason);
  const exportRows = rows.map((r, i) => [
    i + 1,
    r.block,
    r.gp,
    r.village,
    r.member,
    guardianDisplay(r),
    r.mobile,
    r.gender === 'Male' ? 'पुरुष' : 'महिला',
    r.age,
    r.remark,
    formatEntryTime(r.entryTime)
  ]);
  exportRows.push(['कुल', '', '', '', rows.length, '', '', '', '', String(reason || '').trim(), '']);
  return {
    title: `Reason detail report - ${String(reason || '').trim()}`,
    filename: `reason_detail_${safeFilePart(reason)}`,
    headers: ['क्र.', 'ब्लॉक', 'ग्राम पंचायत', 'गाँव', 'सदस्य', 'पिता/पति/मुखिया', 'मोबाइल', 'लिंग', 'आयु', 'कारण', 'समय'],
    rows: exportRows,
    recordCount: rows.length
  };
}

function safeFilePart(value) {
  return String(value || 'reason')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\u0900-\u097f-]/gi, '')
    .slice(0, 80) || 'reason';
}

function buildExcelHtml(report) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      body{font-family:Noto Sans Devanagari,Arial,sans-serif}
      h2{margin:0 0 6px}
      p{margin:0 0 14px;color:#555}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #999;padding:8px;text-align:left;mso-number-format:"\\@"}
      th{background:#e9eef5;font-weight:700}
    </style></head><body>
    <h2>${escapeHtml(report.title)}</h2>
    <p>Aadhaar WCD survey | ${new Date().toLocaleDateString('hi-IN')}</p>
    ${buildExportTableHtml(report)}
    </body></html>`;
}

function downloadExcelReport(report) {
  const html = buildExcelHtml(report);
  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.filename}_${reportFileDate()}.xls`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Excel डाउनलोड हो रही है!');
}

function openReasonPreview(index) {
  const item = REASON_REPORT_ROWS[index];
  if (!item) {
    showToast('कारण डेटा नहीं मिला!');
    return;
  }
  const rows = getReasonDetailRows(item.reason);
  if (!rows.length) {
    showToast('इस कारण में रिकॉर्ड नहीं है!');
    return;
  }

  currentReasonPreview = { reason: item.reason, rows };
  document.getElementById('reason-preview-title').textContent = item.reason;
  document.getElementById('reason-preview-count').textContent = `${rows.length.toLocaleString()} रिकॉर्ड देखें, फिर Excel डाउनलोड करें`;
  document.getElementById('reason-preview-rows').innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.block)}</td>
      <td>${escapeHtml(r.gp)}</td>
      <td>${escapeHtml(r.village)}</td>
      <td><strong>${escapeHtml(r.member)}</strong></td>
      <td>${escapeHtml(guardianDisplay(r))}</td>
      <td>${escapeHtml(r.mobile || '-')}</td>
      <td>${r.gender === 'Male' ? 'पुरुष' : 'महिला'}</td>
      <td>${escapeHtml(r.age || '-')}</td>
      <td>${escapeHtml(formatEntryTime(r.entryTime))}</td>
    </tr>
  `).join('');
  document.getElementById('reason-preview-download').disabled = false;
  document.getElementById('reason-preview-modal').style.display = 'flex';
}

function closeReasonPreview() {
  document.getElementById('reason-preview-modal').style.display = 'none';
}

function closeReasonPreviewOverlay(e) {
  if (e.target === document.getElementById('reason-preview-modal')) closeReasonPreview();
}

function downloadCurrentReasonExcel() {
  if (!currentReasonPreview || !currentReasonPreview.rows.length) {
    showToast('पहले कोई कारण देखें।');
    return;
  }
  downloadExcelReport(getReasonDetailReportData(currentReasonPreview.reason));
}

function downloadFilteredReportExcel() {
  const report = getFilteredReportData();
  if (!report.rows.length || getReportFilteredData().length === 0) {
    showToast('फिल्टर में कोई रिकॉर्ड नहीं!');
    return;
  }
  downloadExcelReport(report);
}

function downloadSectionExcel(section) {
  const report = getReportSectionData(section);
  if (!report || !report.rows.length) {
    showToast('इस रिपोर्ट में डेटा नहीं है!');
    return;
  }
  downloadExcelReport(report);
}

function downloadSectionPDF(section) {
  const report = getReportSectionData(section);
  if (!report || !report.rows.length) {
    showToast('इस रिपोर्ट में डेटा नहीं है!');
    return;
  }
  const win = window.open('', '_blank');
  if (!win) {
    showToast('Popup blocked है, browser में popups allow करें।');
    return;
  }
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>${escapeHtml(report.title)}</title>
    <style>
      @page{size:A4 landscape;margin:12mm}
      *{box-sizing:border-box}
      body{font-family:Noto Sans Devanagari,Arial,sans-serif;color:#111;margin:0}
      h1{font-size:20px;margin:0 0 4px}
      .meta{font-size:12px;color:#555;margin-bottom:14px}
      table{border-collapse:collapse;width:100%;font-size:11px}
      th,td{border:1px solid #999;padding:6px;text-align:left;vertical-align:top}
      th{background:#e9eef5;font-weight:700}
      tr:nth-child(even) td{background:#f7f9fc}
    </style></head><body>
    <h1>${escapeHtml(report.title)}</h1>
    <div class="meta">Aadhaar WCD survey | ${new Date().toLocaleDateString('hi-IN')}</div>
    ${buildExportTableHtml(report)}
    <script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script>
    </body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
  showToast('PDF print window खुल रही है!');
}

// INIT
initApp();

// ==================== ADD NEW ENTRY MODAL ====================

function openAddModal() {
  // à¤«à¥‰à¤°à¥à¤® à¤–à¤¾à¤²à¥€ à¤•à¤°à¥‡à¤‚
  ['add-project','add-gp','add-village','add-hof','add-member','add-mobile','add-age','add-aadhaar','add-enrollment'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('add-block').value = '';
  document.getElementById('add-gender').value = 'Male';
  document.getElementById('add-remark').value = '';
  document.getElementById('add-error').style.display = 'none';
  document.getElementById('cc-add-aadhaar').innerHTML = '<span class="char-no">0/12</span>';
  document.getElementById('cc-add-enrollment').innerHTML = '<span class="char-no">0/28</span>';
  document.getElementById('add-modal').style.display = 'flex';
}

function closeAddModal() {
  document.getElementById('add-modal').style.display = 'none';
}

function closeAddModalOverlay(e) {
  if (e.target === document.getElementById('add-modal')) closeAddModal();
}

// à¤²à¤¾à¤‡à¤µ à¤•à¥ˆà¤°à¥‡à¤•à¥à¤Ÿà¤° à¤•à¤¾à¤‰à¤‚à¤Ÿ / à¤µà¥ˆà¤²à¤¿à¤¡à¥‡à¤¶à¤¨ (à¤†à¤§à¤¾à¤° à¤µ à¤à¤¨à¤°à¥‹à¤²à¤®à¥‡à¤‚à¤Ÿ à¤•à¥‡ à¤²à¤¿à¤, à¤¦à¥‹à¤¨à¥‹à¤‚ à¤µà¥ˆà¤•à¤²à¥à¤ªà¤¿à¤• à¤¹à¥ˆà¤‚)
document.getElementById('add-aadhaar').addEventListener('input', function() {
  this.value = this.value.replace(/\D/g,'');
  const v = this.value;
  const el = document.getElementById('cc-add-aadhaar');
  if (v.length === 12) { el.innerHTML = '<span class="char-ok">✓ 12/12 - सही</span>'; this.className = 'form-input valid'; }
  else if (v.length > 0) { el.innerHTML = `<span class="char-err">${v.length}/12 - अधूरा</span>`; this.className = 'form-input invalid'; }
  else { el.innerHTML = '<span class="char-no">0/12</span>'; this.className = 'form-input'; }
});

document.getElementById('add-enrollment').addEventListener('input', function() {
  this.value = this.value.replace(/\D/g,'');
  const v = this.value;
  const el = document.getElementById('cc-add-enrollment');
  if (v.length === 28) { el.innerHTML = '<span class="char-ok">✓ 28/28 - सही</span>'; this.className = 'form-input valid'; }
  else if (v.length > 0) { el.innerHTML = `<span class="char-err">${v.length}/28 - अधूरा</span>`; this.className = 'form-input invalid'; }
  else { el.innerHTML = '<span class="char-no">0/28</span>'; this.className = 'form-input'; }
});

async function saveNewEntry() {
  const errEl = document.getElementById('add-error');
  errEl.style.display = 'none';

  const project = document.getElementById('add-project').value.trim();
  const block = document.getElementById('add-block').value.trim();
  const gp = document.getElementById('add-gp').value.trim();
  const village = document.getElementById('add-village').value.trim();
  const hof = document.getElementById('add-hof').value.trim();
  const fatherName = document.getElementById('add-father').value.trim();
  const member = document.getElementById('add-member').value.trim();
  const mobile = document.getElementById('add-mobile').value.trim();
  const gender = document.getElementById('add-gender').value;
  const age = document.getElementById('add-age').value.trim();
  const aadhaar = document.getElementById('add-aadhaar').value.trim();
  const enrollment = document.getElementById('add-enrollment').value.trim();
  const remark = document.getElementById('add-remark').value.trim();

  // à¤œà¤¼à¤°à¥‚à¤°à¥€ à¤«à¤¼à¥€à¤²à¥à¤¡ à¤œà¤¾à¤à¤š
  if (!project || !block || !gp || !village || !hof || !member) {
    errEl.textContent = 'कृपया Project Name, ब्लॉक, ग्राम पंचायत, गाँव, परिवार मुखिया और सदस्य का नाम भरें।';
    errEl.style.display = 'block';
    return;
  }
  if (mobile && !/^\d{10}$/.test(mobile)) {
    errEl.textContent = 'मोबाइल नंबर 10 अंकों का होना चाहिए।';
    errEl.style.display = 'block';
    return;
  }
  if (aadhaar && aadhaar.length !== 12) {
    errEl.textContent = 'आधार नंबर 12 अंकों का होना चाहिए (या इसे खाली छोड़ दें)।';
    errEl.style.display = 'block';
    return;
  }
  if (enrollment && enrollment.length !== 28) {
    errEl.textContent = 'एनरोलमेंट नंबर 28 अंकों का होना चाहिए (या इसे खाली छोड़ दें)।';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('btn-add-save');
  btn.disabled = true;
  btn.textContent = 'सहेजा जा रहा है...';

  const payload = {
    action: 'save',
    sno: '',
    project,
    projectName: project,
    'Project Name': project,
    district: 'Dantewada',
    block, gp, village, hof, member, mobile,
    fatherName,
    gender, age: age || 0,
    entryValue: aadhaar || enrollment,
    aadhaar, enrollment, remark,
    entryTime: createEntryTimestamp()
  };
  payload.time = payload.entryTime;
  payload.Time = payload.entryTime;
  payload['Entry Time'] = payload.entryTime;
  payload['समय'] = payload.entryTime;

  if (!isBackendConfigured()) {
    errEl.textContent = backendConfigHelp();
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'सहेजें';
    return;
  }

  try {
    const res = await fetch(API_BASE_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json && json.ok) {
      closeAddModal();
      showToast('नया सदस्य सफलतापूर्वक जोड़ा गया!');
      await fetchFromSheet();
    } else {
      errEl.textContent = 'सहेजने में त्रुटि: ' + (json && json.error ? json.error : 'अज्ञात त्रुटि');
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = 'सर्वर error - कृपया दोबारा कोशिश करें।';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'सहेजें';
  }
}
