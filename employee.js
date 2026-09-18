(function () {
  'use strict';

  const CACHE_KEY_REGISTERED = 'registeredWorkers_v1';

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
  }

  function loadWorkers() {
    const parsed = parseWorkers(Array.isArray(window.HTML_EMPLOYEES) ? window.HTML_EMPLOYEES : []);
    setWorkersMap(parsed);
    syncRegisteredWorkersFromCurrentSession();
    renderRegisteredWorkersTab();
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
        '  <div class="table-responsive" style="max-height:380px; overflow-y:auto;">',
        '    <table class="table rail-table table-bordered mb-0">',
        '      <thead>',
        '        <tr>',
        '          <th style="width:50px; text-align:center;">№</th>',
        '          <th style="text-align:center;">Ажилтны нэр</th>',
        '          <th style="text-align:center;">Албан тушаал</th>',
        '          <th style="text-align:center;">Код</th>',
        '          <th style="width:120px; text-align:center;">QR код</th>',
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
      body.innerHTML = '<tr class="empty-row"><td colspan="5">HTML кодод бүртгэлтэй ажилтан алга.</td></tr>';
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

      const code = normalizeCode(nameOrCode);
      if (!code) {
        beep(false);
        toast('QR код хоосон байна.', 'warn');
        return false;
      }

      if (!state.workersLoaded && state.workersMap.size === 0) {
        beep(false);
        toast('Ажилтны сан ачаалагдаж байна. Дахин уншуулна уу.', 'warn');
        return false;
      }

      const worker = state.workersMap.get(code);
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
