(function () {
  'use strict';

  const WORKERS_URL = 'workers.json';
  const CACHE_KEY_WORKERS = 'workersCache_v1';
  const CACHE_KEY_REGISTERED = 'registeredWorkers_v1';
  const CACHE_KEY_WORKERS_CUSTOM = 'workersCustom_v1';

  const state = {
    workersMap: new Map(),
    workersLoaded: false,
    workersLoadError: null,
    audioCtx: null,
    audioUnlocked: false
  };

  function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  }

  function buildDisplayName(worker) {
    if (!worker) return '';

    const name = String(worker.name || '').trim();
    return name;
  }

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function collectScannerCandidates(rawValue) {
    const text = String(rawValue || '').trim();
    const candidates = [];

    if (text) {
      candidates.push(text);
    }

    const empMatch = text.match(/EMP\d{1,6}/i);
    if (empMatch) {
      candidates.push(empMatch[0]);
    }

    try {
      const url = new URL(text);
      ['id', 'empId', 'employeeId', 'code', 'name', 'fullName', 'employeeName', 'employee'].forEach(function (key) {
        const v = String(url.searchParams.get(key) || '').trim();
        if (v) candidates.push(v);
      });
    } catch (e) {
      // Not URL format.
    }

    try {
      const parsed = JSON.parse(text);
      ['id', 'empId', 'employeeId', 'code', 'name', 'fullName', 'employeeName', 'employee'].forEach(function (key) {
        const v = String((parsed && parsed[key]) || '').trim();
        if (v) candidates.push(v);
      });
    } catch (e) {
      // Not JSON format.
    }

    return Array.from(new Set(candidates.filter(Boolean)));
  }

  function findWorkerFromScanValue(rawValue) {
    const candidates = collectScannerCandidates(rawValue);
    if (!candidates.length) return null;

    for (let i = 0; i < candidates.length; i += 1) {
      const byCode = state.workersMap.get(normalizeCode(candidates[i]));
      if (byCode) return byCode;
    }

    const workers = getWorkersArrayFromMap();
    for (let i = 0; i < candidates.length; i += 1) {
      const candidateName = normalizeName(candidates[i]);
      if (!candidateName) continue;

      const exact = workers.find(function (w) {
        return normalizeName(w.name) === candidateName || normalizeName(buildDisplayName(w)) === candidateName;
      });
      if (exact) return exact;
    }

    for (let i = 0; i < candidates.length; i += 1) {
      const candidateName = normalizeName(candidates[i]);
      if (!candidateName) continue;

      const fuzzy = workers.find(function (w) {
        const workerName = normalizeName(w.name);
        const workerDisplay = normalizeName(buildDisplayName(w));
        return workerName.includes(candidateName)
          || candidateName.includes(workerName)
          || workerDisplay.includes(candidateName)
          || candidateName.includes(workerDisplay);
      });
      if (fuzzy) return fuzzy;
    }

    return null;
  }

  function toast(message, kind) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, kind || 'ok');
      return;
    }

    const stack = document.getElementById('toastStack') || createFallbackToastStack();
    const el = document.createElement('div');
    el.className = 'rail-toast ' + (kind || 'ok');
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 2500);
  }

  function createFallbackToastStack() {
    let stack = document.getElementById('toastStack');
    if (stack) return stack;

    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.style.position = 'fixed';
    stack.style.right = '16px';
    stack.style.bottom = '16px';
    stack.style.zIndex = '9999';
    document.body.appendChild(stack);
    return stack;
  }

  function unlockAudio() {
    if (state.audioUnlocked) return;
    state.audioUnlocked = true;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      state.audioCtx = state.audioCtx || new Ctx();
      if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume().catch(function () {});
      }
    } catch (e) {
      // Ignore audio initialization failures.
    }
  }

  function beep(ok) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;

      if (!state.audioCtx) {
        state.audioCtx = new Ctx();
      }

      const ctx = state.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(function () {});
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = ok ? 980 : 280;

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.11);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
      // Ignore audio playback failures.
    }
  }

  function parseWorkers(raw) {
    if (!Array.isArray(raw)) return [];

    const cleaned = [];
    for (let i = 0; i < raw.length; i += 1) {
      const item = raw[i] || {};
      const id = normalizeCode(item.id);
      const name = String(item.name || '').trim();

      if (!id || !name) continue;

      cleaned.push({
        id: id,
        name: name,
        section: String(item.section || '').trim(),
        position: String(item.position || '').trim(),
        phone: String(item.phone || '').trim()
      });
    }

    return cleaned;
  }

  function getWorkersArrayFromMap() {
    return Array.from(state.workersMap.values())
      .sort(function (a, b) {
        const ai = parseEmpNumeric(a.id);
        const bi = parseEmpNumeric(b.id);
        return ai - bi;
      });
  }

  function parseEmpNumeric(id) {
    const match = String(id || '').trim().toUpperCase().match(/^EMP(\d{1,})$/);
    if (!match) return 0;
    return parseInt(match[1], 10);
  }

  function formatEmpCode(num) {
    return 'EMP' + String(num).padStart(4, '0');
  }

  function getNextEmpCode() {
    const workers = getWorkersArrayFromMap();
    let max = 0;
    for (let i = 0; i < workers.length; i += 1) {
      max = Math.max(max, parseEmpNumeric(workers[i].id));
    }
    return formatEmpCode(max + 1);
  }

  function persistCustomWorkers() {
    try {
      const workers = getWorkersArrayFromMap();
      localStorage.setItem(CACHE_KEY_WORKERS_CUSTOM, JSON.stringify(workers));
    } catch (e) {
      // Ignore localStorage write errors.
    }
  }

  function setWorkersMap(workers) {
    const map = new Map();

    for (let i = 0; i < workers.length; i += 1) {
      const w = workers[i];
      if (!map.has(w.id)) {
        map.set(w.id, w);
      }
    }

    state.workersMap = map;
    state.workersLoaded = true;
    state.workersLoadError = null;

    try {
      localStorage.setItem(CACHE_KEY_WORKERS, JSON.stringify(workers));
    } catch (e) {
      // Ignore cache write errors.
    }
  }

  function loadWorkersFromCache() {
    try {
      const cached = localStorage.getItem(CACHE_KEY_WORKERS);
      if (!cached) return false;

      const parsed = parseWorkers(JSON.parse(cached));
      if (!parsed.length) return false;

      setWorkersMap(parsed);
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadWorkersFromCustomStore() {
    try {
      const custom = localStorage.getItem(CACHE_KEY_WORKERS_CUSTOM);
      if (!custom) return false;

      const parsed = parseWorkers(JSON.parse(custom));
      if (!parsed.length) return false;

      setWorkersMap(parsed);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function loadWorkers() {
    const hasCustomWorkers = loadWorkersFromCustomStore();
    if (!hasCustomWorkers) {
      loadWorkersFromCache();
    }

    if (state.workersLoaded) {
      syncRegisteredWorkersFromCurrentSession();
      renderRegisteredWorkersTab();
    }

    if (hasCustomWorkers) {
      return;
    }

    try {
      const res = await fetch(WORKERS_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const parsed = parseWorkers(await res.json());
      setWorkersMap(parsed);
      syncRegisteredWorkersFromCurrentSession();
      renderRegisteredWorkersTab();
    } catch (err) {
      state.workersLoadError = err;
      if (!state.workersLoaded) {
        toast('workers.json уншиж чадсангүй.', 'warn');
      }
    }
  }

  function readCurrentSessionEntries() {
    try {
      const rows = JSON.parse(localStorage.getItem('currentSessionEntries') || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }

  function getRegisteredWorkers() {
    try {
      const list = JSON.parse(localStorage.getItem(CACHE_KEY_REGISTERED) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveRegisteredWorkers(list) {
    localStorage.setItem(CACHE_KEY_REGISTERED, JSON.stringify(list));
  }

  function upsertRegisteredWorker(worker) {
    const list = getRegisteredWorkers();
    const idx = list.findIndex(function (x) {
      return normalizeCode(x.id) === worker.id;
    });

    const item = {
      id: worker.id,
      name: worker.name,
      section: worker.section,
      position: worker.position,
      phone: worker.phone,
      registeredAt: new Date().toISOString()
    };

    if (idx >= 0) {
      list[idx] = Object.assign({}, list[idx], item);
    } else {
      list.push(item);
    }

    saveRegisteredWorkers(list);
  }

  function syncRegisteredWorkersFromCurrentSession() {
    const entries = readCurrentSessionEntries();
    if (!entries.length || !state.workersLoaded) return;

    const names = new Set(entries.map(function (e) { return String(e.name || '').trim(); }));
    if (!names.size) return;

    state.workersMap.forEach(function (worker) {
      if (names.has(worker.name) || names.has(buildDisplayName(worker))) {
        upsertRegisteredWorker(worker);
      }
    });
  }

  function findExistingEntryNameForWorker(worker) {
    const entries = readCurrentSessionEntries();
    if (!entries.length) return '';

    const baseName = String(worker.name || '').trim().toLowerCase();
    const displayName = buildDisplayName(worker).toLowerCase();

    for (let i = 0; i < entries.length; i += 1) {
      const entryName = String((entries[i] && entries[i].name) || '').trim();
      if (!entryName) continue;

      const entryNameLower = entryName.toLowerCase();
      if (entryNameLower === baseName || entryNameLower === displayName) {
        return entryName;
      }
    }

    return '';
  }

  function createEmployeeTabIfMissing() {
    const tabsHost = document.querySelector('.rail-tabs');
    if (!tabsHost) return;

    const exists = tabsHost.querySelector('[data-tab="employees"]');
    if (!exists) {
      const btn = document.createElement('button');
      btn.className = 'rail-tab-btn';
      btn.dataset.tab = 'employees';
      btn.type = 'button';
      btn.innerHTML = '<i class="bi bi-people"></i>Бүртгэлтэй ажилтан <span class="count-pill" id="tabCountEmployees">0</span>';
      btn.addEventListener('click', function () {
        if (typeof window.switchTab === 'function') {
          window.switchTab('employees');
        }
      });
      tabsHost.appendChild(btn);
    }

    const paneExists = document.getElementById('pane-employees');
    if (!paneExists) {
      const container = document.querySelector('.container-app');
      if (!container) return;

      const pane = document.createElement('div');
      pane.className = 'tab-pane';
      pane.id = 'pane-employees';
      pane.innerHTML = [
        '<div class="panel">',
        '  <div class="panel-title"><i class="bi bi-people"></i>Бүртгэлтэй ажилтны жагсаалт</div>',
        '  <div class="d-flex justify-content-end mb-2">',
        '    <button type="button" class="btn btn-add-soft btn-sm" onclick="employeeAddWorker()"><i class="bi bi-plus-lg me-1"></i>Шинэ мөр нэмэх</button>',
        '  </div>',
        '  <div class="table-responsive" style="max-height:380px; overflow-y:auto;">',
        '    <table class="table rail-table table-bordered mb-0">',
        '      <thead>',
        '        <tr>',
        '          <th style="width:50px; text-align:center;">№</th>',
        '          <th style="text-align:center;">Ажилтны нэр</th>',
        '          <th style="text-align:center;">Албан тушаал</th>',
        '          <th style="text-align:center;">Код</th>',
        '          <th style="width:120px; text-align:center;">QR код</th>',
        '          <th style="width:120px; text-align:center;">Үйлдэл</th>',
        '        </tr>',
        '      </thead>',
        '      <tbody id="employeeListBody"></tbody>',
        '    </table>',
        '  </div>',
        '</div>'
      ].join('');

      container.appendChild(pane);
    }
  }

  function renderRegisteredWorkersTab() {
    createEmployeeTabIfMissing();

    const body = document.getElementById('employeeListBody');
    if (!body) return;

    const sorted = getWorkersArrayFromMap();

    if (!sorted.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="6">Ажилтны жагсаалт ачаалагдаж байна...</td></tr>';
    } else {
      body.innerHTML = sorted
        .map(function (w, idx) {
          const qrData = encodeURIComponent(String(w.id || ''));
          const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=' + qrData;
          return [
            '<tr>',
            '  <td style="text-align:center;">' + (idx + 1) + '</td>',
            '  <td class="fw-semibold">' + escapeHtml(w.name) + '</td>',
            '  <td>' + escapeHtml(w.position || '-') + '</td>',
            '  <td class="fw-semibold">' + escapeHtml(w.id || '-') + '</td>',
            '  <td style="text-align:center;"><img src="' + qrUrl + '" alt="QR ' + escapeHtml(w.id || '') + '" width="96" height="96" loading="lazy"></td>',
            '  <td style="text-align:center;">',
            '    <button type="button" class="btn btn-sm btn-outline-secondary me-1" onclick="employeeEditWorker(\'' + escapeHtml(w.id) + '\')"><i class="bi bi-pencil"></i></button>',
            '    <button type="button" class="btn btn-sm btn-outline-danger" onclick="employeeDeleteWorker(\'' + escapeHtml(w.id) + '\')"><i class="bi bi-trash"></i></button>',
            '  </td>',
            '</tr>'
          ].join('');
        })
        .join('');
    }

    const count = document.getElementById('tabCountEmployees');
    if (count) {
      count.textContent = String(sorted.length);
    }
  }

  function addWorkerInteractive() {
    const name = String(window.prompt('Ажилтны нэр оруулна уу (ж: пр-4 Б. ОргилЭрдэнэ):', '') || '').trim();
    if (!name) {
      toast('Ажилтны нэр хоосон байна.', 'warn');
      return;
    }

    const position = String(window.prompt('Албан тушаал оруулна уу (ж: Замчин):', '') || '').trim();
    if (!position) {
      toast('Албан тушаал хоосон байна.', 'warn');
      return;
    }

    const id = getNextEmpCode();
    state.workersMap.set(id, {
      id: id,
      name: name,
      section: '',
      position: position,
      phone: ''
    });

    persistCustomWorkers();
    renderRegisteredWorkersTab();
    toast('Шинэ ажилтан нэмэгдлээ: ' + name + ' [' + id + ']', 'ok');
  }

  function editWorkerInteractive(id) {
    const code = normalizeCode(id);
    const worker = state.workersMap.get(code);
    if (!worker) {
      toast('Засах ажилтан олдсонгүй.', 'warn');
      return;
    }

    const name = String(window.prompt('Ажилтны нэр засах:', worker.name || '') || '').trim();
    if (!name) {
      toast('Ажилтны нэр хоосон байж болохгүй.', 'warn');
      return;
    }

    const position = String(window.prompt('Албан тушаал засах:', worker.position || '') || '').trim();
    if (!position) {
      toast('Албан тушаал хоосон байж болохгүй.', 'warn');
      return;
    }

    state.workersMap.set(code, {
      ...worker,
      name: name,
      position: position
    });

    persistCustomWorkers();
    renderRegisteredWorkersTab();
    toast('Мэдээлэл шинэчлэгдлээ: ' + name, 'ok');
  }

  function deleteWorkerInteractive(id) {
    const code = normalizeCode(id);
    const worker = state.workersMap.get(code);
    if (!worker) {
      toast('Устгах ажилтан олдсонгүй.', 'warn');
      return;
    }

    if (!window.confirm('"' + worker.name + '" ажилтныг устгах уу?')) {
      return;
    }

    state.workersMap.delete(code);
    persistCustomWorkers();
    renderRegisteredWorkersTab();
    toast('Ажилтан устгагдлаа: ' + worker.name, 'warn');
  }

  function patchUpdateTabCounts() {
    if (typeof window.updateTabCounts !== 'function') return;

    const original = window.updateTabCounts;
    window.updateTabCounts = function () {
      original();
      renderRegisteredWorkersTab();
    };
  }

  function patchRenderTable() {
    if (typeof window.renderTable !== 'function') return;

    const original = window.renderTable;
    window.renderTable = function () {
      original();
      syncRegisteredWorkersFromCurrentSession();
      renderRegisteredWorkersTab();
    };
  }

  function patchAddEmployeeEntry() {
    if (typeof window.addEmployeeEntry !== 'function') {
      return;
    }

    const original = window.addEmployeeEntry;

    window.addEmployeeEntry = function (nameOrCode, source) {
      if (source !== 'scanner') {
        return original(nameOrCode, source);
      }

      const scannedValue = String(nameOrCode || '').trim();
      if (!scannedValue) {
        beep(false);
        toast('QR код хоосон байна.', 'warn');
        return false;
      }

      if (!state.workersLoaded && state.workersMap.size === 0) {
        beep(false);
        toast('Ажилтны сан ачаалагдаж байна. Дахин уншуулна уу.', 'warn');
        return false;
      }

      const worker = findWorkerFromScanValue(scannedValue);
      if (!worker) {
        beep(false);
        toast('Ажилтан бүртгэлгүй', 'warn');
        return false;
      }

      const existingName = findExistingEntryNameForWorker(worker);
      const displayName = buildDisplayName(worker);
      const nameForEntry = existingName || displayName || worker.name;
      const added = original(nameForEntry, 'scanner');

      if (added) {
        beep(true);
        upsertRegisteredWorker(worker);
        renderRegisteredWorkersTab();
        toast('Амжилттай: ' + nameForEntry, 'ok');
      } else {
        beep(false);
      }

      return added;
    };
  }

  function init() {
    createEmployeeTabIfMissing();
    renderRegisteredWorkersTab();
    patchUpdateTabCounts();
    patchRenderTable();
    patchAddEmployeeEntry();

    window.employeeAddWorker = addWorkerInteractive;
    window.employeeEditWorker = editWorkerInteractive;
    window.employeeDeleteWorker = deleteWorkerInteractive;

    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });

    loadWorkers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
