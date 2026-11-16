import { parts, exercises, templates } from './catalog.js';
import { artworkFor, cueFor, customWorkoutArt, motionFramesFor, thumbnailFor } from './exercise-art.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const nativeDateMode = matchMedia('(max-width: 640px), (pointer: coarse)');
const bootstrap = window.TRAINTRACE_BOOTSTRAP;
if (!bootstrap?.token || !bootstrap.ownerKey) throw new Error('TRAINTRACE requires an active document session.');
let apiSessionToken = bootstrap.token;
const ownerKey = bootstrap.ownerKey;
const KEYS = {
  draft: `traintrace:${ownerKey}:draft:v1`,
  pending: `traintrace:${ownerKey}:pending:v1`,
  workspace: `traintrace:${ownerKey}:workspace-pending:v1`,
  workspaceFlight: `traintrace:${ownerKey}:workspace-flight:v1`,
  workspaceBranchPrefix: `traintrace:${ownerKey}:workspace-branch:v1:`
};
const sessionSignalKey = `traintrace:${ownerKey}:active-session-signal:v1`;
const activeSessionEpoch = bootstrap.sessionEpoch || '';
const workspaceWriterId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const state = {
  view: 'home',
  part: null,
  exercise: null,
  draft: null,
  lastLocalDraft: null,
  customExercises: [],
  workspaceRevision: 0,
  workspaceAcknowledgedData: null,
  workspaceConflict: null,
  workspaceSaveTimer: 0,
  workspaceSyncPromise: null,
  workspaceForeignEdit: false,
  workspaceAdoptLocal: false,
  workspaceExtraCandidates: [],
  workspaceConflictStorageKey: null,
  sessionCheckTimer: 0,
  sessionCheckInFlight: false,
  sessionLocked: false,
  records: [],
  tab: 'recent',
  activePart: null,
  partTransitionTimer: 0,
  partTransitionToken: 0,
  pendingPartId: null,
  selectedHistoryDate: localDateKey(new Date()),
  toastTimer: 0,
  fatigueTimer: 0,
  pendingResumeAction: null,
  pageHiddenAt: null
};

async function apiFetch(url, options = {}) {
  if (!apiSessionToken || state.sessionLocked) throw new Error('TRAINTRACE session has ended.');
  const headers = new Headers(options.headers || {});
  headers.set('X-Traintrace-Session', apiSessionToken);
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store'
  });
  if (response.status === 401 || response.status === 403) {
    const payload = await response.clone().json().catch(() => ({}));
    const reason = payload?.code === 'SESSION_REPLACED' || payload?.error === 'SESSION_REPLACED'
      ? 'replaced'
      : 'expired';
    window.dispatchEvent(new CustomEvent('traintrace:lock', { detail: { reason } }));
  }
  return response;
}

function workspaceSnapshot() {
  return cloneWorkspaceData({ draft: state.draft, customExercises: state.customExercises });
}

function cloneWorkspaceData(value) {
  return JSON.parse(JSON.stringify({
    draft: value?.draft ?? null,
    customExercises: Array.isArray(value?.customExercises) ? value.customExercises : []
  }));
}

function sameWorkspaceData(left, right) {
  return JSON.stringify(cloneWorkspaceData(left)) === JSON.stringify(cloneWorkspaceData(right));
}

function workspaceBaseRevision(value) {
  if (value?.baseRevision == null && value?.revision == null) return null;
  const revision = Number(value?.baseRevision ?? value?.revision);
  return Number.isInteger(revision) && revision >= 0 ? revision : null;
}

function removeWorkspaceCandidate(storageKey, candidate) {
  if (!storageKey || !candidate) return false;
  const current = safeRead(storageKey, null);
  const sameIdentity = candidate.editId
    ? current?.editId === candidate.editId
    : JSON.stringify(current) === JSON.stringify(candidate);
  if (!sameIdentity || candidate.writerId && current?.writerId !== candidate.writerId) return false;
  localStorage.removeItem(storageKey);
  if (storageKey === KEYS.workspace
    && JSON.stringify(safeRead(KEYS.draft, null)) === JSON.stringify(candidate.draft ?? null)) {
    localStorage.removeItem(KEYS.draft);
  }
  return true;
}

function readWorkspaceBranches() {
  const candidates = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(KEYS.workspaceBranchPrefix)) continue;
      const value = safeRead(key, null);
      if (value) candidates.push({ key, value });
    }
  } catch {
    // Local workspace branches are best-effort recovery copies.
  }
  return candidates;
}

function workspacePendingEnvelope(data, previous = null, activeFlight = null) {
  const snapshot = cloneWorkspaceData(data);
  const predecessorEditId = activeFlight?.writerId === workspaceWriterId
    ? activeFlight.editId
    : previous?.predecessorEditId || previous?.editId || null;
  return {
    ...snapshot,
    revision: state.workspaceRevision,
    baseRevision: state.workspaceRevision,
    editedAt: new Date().toISOString(),
    editId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    predecessorEditId,
    writerId: workspaceWriterId
  };
}

function preserveWorkspaceBranch(data = workspaceSnapshot(), source = null) {
  const localData = cloneWorkspaceData(data);
  const sourceWriter = source?.writerId || workspaceWriterId;
  const sourceEdit = source?.editId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const primaryBranchKey = `${KEYS.workspaceBranchPrefix}${sourceWriter}`;
  const primaryBranch = safeRead(primaryBranchKey, null);
  if (primaryBranch && sameWorkspaceData(primaryBranch, localData)) return;
  const branchKey = primaryBranch ? `${primaryBranchKey}:${sourceEdit}` : primaryBranchKey;
  const existing = safeRead(branchKey, null);
  if (existing && sameWorkspaceData(existing, localData)) return;
  safeWrite(branchKey, {
    ...localData,
    revision: source?.revision ?? state.workspaceRevision,
    baseRevision: workspaceBaseRevision(source) ?? state.workspaceRevision,
    editedAt: source?.editedAt || new Date().toISOString(),
    editId: source?.editId || sourceEdit,
    writerId: sourceWriter
  });
}

function showWorkspaceConflict(localWorkspace, remoteWorkspace) {
  state.workspaceConflict = { localWorkspace, remoteWorkspace };
  const copy = $('#workspace-conflict-copy');
  if (copy) {
    copy.textContent = remoteWorkspace.draft
      ? `“${remoteWorkspace.draft.name || '当前动作'}”在另一处已更新。选择要继续使用的版本。`
      : '此账号的草稿或自定义动作在另一处已更新。选择要继续使用的版本。';
  }
  const dialog = $('#workspace-conflict');
  if (dialog && !dialog.open) dialog.showModal();
}

function showNextWorkspaceConflict(remoteWorkspace) {
  const next = state.workspaceExtraCandidates.shift();
  if (!next) return false;
  state.workspaceConflictStorageKey = next.key;
  showWorkspaceConflict(next.value, remoteWorkspace);
  return true;
}

async function drainWorkspaceQueue() {
  while (navigator.onLine && apiSessionToken && !state.sessionLocked && !state.workspaceConflict) {
    const queued = safeRead(KEYS.workspace, null);
    if (!queued || !queued.editId) return true;
    if (queued.writerId && queued.writerId !== workspaceWriterId) {
      preserveWorkspaceBranch();
      state.workspaceForeignEdit = true;
      return false;
    }

    const snapshot = cloneWorkspaceData(queued);
    const requestRevision = state.workspaceRevision;
    const flight = {
      ...snapshot,
      revision: requestRevision,
      baseRevision: queued.baseRevision ?? requestRevision,
      requestRevision,
      editedAt: queued.editedAt || new Date().toISOString(),
      editId: queued.editId,
      predecessorEditId: queued.predecessorEditId || null,
      writerId: workspaceWriterId
    };
    // Persist the exact request before sending it, so an accepted PUT with a lost
    // response can be recognized against the server workspace on the next entry.
    if (!safeWrite(KEYS.workspaceFlight, flight)) {
      setSyncStatus('本机存储空间不足 · 草稿尚未同步');
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await apiFetch('/api/workspace', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...snapshot, revision: requestRevision }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409 && payload.workspace) {
      if (sameWorkspaceData(payload.workspace, flight)) {
        state.workspaceRevision = Number(payload.workspace.revision) || requestRevision;
        state.workspaceAcknowledgedData = cloneWorkspaceData(payload.workspace);
        if (safeRead(KEYS.workspaceFlight, null)?.editId === flight.editId) {
          localStorage.removeItem(KEYS.workspaceFlight);
        }
        const latestQueue = safeRead(KEYS.workspace, null);
        if (latestQueue?.editId === flight.editId && latestQueue?.writerId === workspaceWriterId) {
          removeWorkspaceCandidate(KEYS.workspace, latestQueue);
          continue;
        }
        if (latestQueue?.writerId === workspaceWriterId && latestQueue?.predecessorEditId === flight.editId) {
          safeWrite(KEYS.workspace, { ...latestQueue, revision: state.workspaceRevision, baseRevision: state.workspaceRevision });
          continue;
        }
        setSyncStatus('草稿已同步到站点');
        return true;
      }
      if (safeRead(KEYS.workspaceFlight, null)?.editId === flight.editId) {
        localStorage.removeItem(KEYS.workspaceFlight);
      }
      state.workspaceConflictStorageKey = KEYS.workspace;
      showWorkspaceConflict(queued, payload.workspace);
      setSyncStatus('需要处理另一处的草稿');
      return false;
    }
    if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);

    state.workspaceRevision = Number(payload.revision) || requestRevision;
    state.workspaceAcknowledgedData = snapshot;
    const latestFlight = safeRead(KEYS.workspaceFlight, null);
    if (latestFlight?.editId === flight.editId && latestFlight?.writerId === workspaceWriterId) {
      localStorage.removeItem(KEYS.workspaceFlight);
    }
    const latestQueue = safeRead(KEYS.workspace, null);
    if (latestQueue?.editId === flight.editId && latestQueue?.writerId === workspaceWriterId) {
      // Re-read before clearing: an edit from this page or another active tab
      // must remain queued even if the response belongs to an older snapshot.
      const confirmQueue = safeRead(KEYS.workspace, null);
      if (confirmQueue?.editId === flight.editId && confirmQueue?.writerId === workspaceWriterId) {
        removeWorkspaceCandidate(KEYS.workspace, confirmQueue);
      }
    } else if (latestQueue?.writerId === workspaceWriterId && latestQueue?.predecessorEditId === flight.editId) {
      const nextQueue = { ...latestQueue, revision: state.workspaceRevision, baseRevision: state.workspaceRevision };
      safeWrite(KEYS.workspace, nextQueue);
      continue;
    } else if (latestQueue?.writerId && latestQueue.writerId !== workspaceWriterId) {
      // A newer tab owns the shared queue. Never clear or drain it from this tab.
      state.workspaceForeignEdit = true;
    }
    setSyncStatus('草稿已同步到站点');
    return true;
  }
  return false;
}

function syncWorkspace() {
  if (state.workspaceSyncPromise) return state.workspaceSyncPromise;
  const running = drainWorkspaceQueue();
  state.workspaceSyncPromise = running;
  return running.finally(() => {
    if (state.workspaceSyncPromise === running) state.workspaceSyncPromise = null;
  });
}

function queueWorkspaceSave({ immediate = false, persistOnly = false } = {}) {
  const snapshot = workspaceSnapshot();
  if (state.workspaceConflict) return false;
  if (state.sessionLocked) {
    if (!state.workspaceAcknowledgedData || !sameWorkspaceData(snapshot, state.workspaceAcknowledgedData)) {
      preserveWorkspaceBranch(snapshot);
    }
    return false;
  }
  const existing = safeRead(KEYS.workspace, null);
  const dirty = !state.workspaceAcknowledgedData || !sameWorkspaceData(snapshot, state.workspaceAcknowledgedData);
  if (!dirty) {
    if (existing?.writerId === workspaceWriterId && sameWorkspaceData(existing, snapshot)) {
      removeWorkspaceCandidate(KEYS.workspace, existing);
    }
    return true;
  }
  if (existing?.writerId && existing.writerId !== workspaceWriterId && !state.workspaceAdoptLocal) {
    preserveWorkspaceBranch(existing, existing);
    preserveWorkspaceBranch(snapshot);
    state.workspaceForeignEdit = true;
    setSyncStatus('另一处正在使用 · 本机草稿已保留');
    return false;
  }
  const activeFlight = safeRead(KEYS.workspaceFlight, null);
  const queued = workspacePendingEnvelope(snapshot, existing, activeFlight);
  if (!safeWrite(KEYS.workspace, queued)) {
    setSyncStatus('本机存储空间不足 · 草稿尚未同步');
    return false;
  }
  state.workspaceAdoptLocal = false;
  if (persistOnly || !navigator.onLine) {
    setSyncStatus('离线 · 本机草稿待同步');
    return true;
  }
  clearTimeout(state.workspaceSaveTimer);
  state.workspaceSaveTimer = setTimeout(() => {
    syncWorkspace().catch(error => {
      setSyncStatus('草稿待同步');
      console.warn('Workspace sync pending:', error);
    });
  }, immediate ? 0 : 600);
  return true;
}

function resolveWorkspaceConflict(useLocal) {
  const conflict = state.workspaceConflict;
  if (!conflict) return;
  const candidateKey = state.workspaceConflictStorageKey;
  const dialog = $('#workspace-conflict');
  if (dialog?.open) dialog.close();
  state.workspaceConflict = null;
  const remote = conflict.remoteWorkspace;
  state.workspaceRevision = remote.revision;
  if (useLocal) {
    state.draft = migrateDraftTimeInput(conflict.localWorkspace.draft);
    state.customExercises = conflict.localWorkspace.customExercises;
    if (candidateKey) {
      state.workspaceAdoptLocal = true;
      const current = safeRead(KEYS.workspace, null);
      if (current?.writerId && current.writerId !== workspaceWriterId
        && !sameWorkspaceData(current, { draft: state.draft, customExercises: state.customExercises })) {
        preserveWorkspaceBranch(current, current);
      }
    }
    const queued = queueWorkspaceSave();
    if (queued && candidateKey && candidateKey !== KEYS.workspace) {
      removeWorkspaceCandidate(candidateKey, conflict.localWorkspace);
    }
  } else {
    state.draft = migrateDraftTimeInput(remote.draft);
    state.customExercises = remote.customExercises || [];
    if (state.draft !== remote.draft) {
      queueWorkspaceSave();
    } else {
      removeWorkspaceCandidate(state.workspaceConflictStorageKey || KEYS.workspace, conflict.localWorkspace);
      if (conflict.localWorkspace.editId && safeRead(KEYS.workspaceFlight, null)?.editId === conflict.localWorkspace.editId) {
        localStorage.removeItem(KEYS.workspaceFlight);
      }
    }
  }
  state.workspaceConflictStorageKey = null;
  renderDraftFloat();
  if (state.view === 'record' && state.draft) renderRecord();
  if (state.activePart) renderExerciseSheet();
  if (showNextWorkspaceConflict(remote)) return;
  resumeFatigueIfDue();
}

const viewElements = Object.fromEntries(['home', 'picker', 'record', 'fatigue', 'history']
  .map(name => [name, $(`#view-${name}`)]));

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateEnglish(date) {
  const weekday = new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date).toUpperCase();
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}   ${weekday}`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function safeRead(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function saveDraft({ persistOnly = false } = {}) {
  const queuedWorkspace = safeRead(KEYS.workspace, null);
  const ownsQueue = !queuedWorkspace?.writerId || queuedWorkspace.writerId === workspaceWriterId || state.workspaceAdoptLocal;
  if (state.draft && !navigator.onLine && !state.sessionLocked && ownsQueue) {
    if (safeWrite(KEYS.draft, state.draft)) {
      state.lastLocalDraft = cloneWorkspaceData({ draft: state.draft }).draft;
    }
  } else if (!state.sessionLocked && state.lastLocalDraft) {
    const storedDraft = safeRead(KEYS.draft, null);
    if (JSON.stringify(storedDraft) === JSON.stringify(state.lastLocalDraft)) {
      localStorage.removeItem(KEYS.draft);
    }
    state.lastLocalDraft = null;
  }
  queueWorkspaceSave({ persistOnly });
  renderDraftFloat();
}

function readCustomExercises() {
  return state.customExercises;
}

function allExercises() {
  return [...exercises, ...readCustomExercises()];
}

function getPart(id) {
  return parts.find(part => part.id === id);
}

function getExercise(id) {
  return allExercises().find(exercise => exercise.id === id);
}

function fieldsForTemplate(key) {
  return templates[key] || [];
}

function visibleTemplateFields(key) {
  return fieldsForTemplate(key).filter(field => ['weight', 'reps', 'assistanceKg', 'seconds', 'km'].includes(field));
}

function renderIcon(symbol, className = '') {
  const safeSymbol = /^[a-z0-9-]+$/i.test(symbol || '') ? symbol : 'bench';
  return `<svg class="${className}" aria-hidden="true"><use href="/assets/icons.svg#${safeSymbol}"></use></svg>`;
}

function exerciseArt(exerciseId, lazy = false) {
  const path = thumbnailFor(exerciseId);
  if (!path) return '';
  return `<img class="exercise-art" src="${escapeHtml(path)}" alt="" decoding="async"${lazy ? ' loading="lazy"' : ''}>`;
}

function renderRecordArtwork(exerciseId) {
  const area = $('#record-art');
  if (area.dataset.exerciseId === exerciseId) return;
  area.dataset.exerciseId = exerciseId;
  delete area.dataset.motionReady;
  delete area.dataset.motionFrameCount;
  const paths = motionFramesFor(exerciseId);
  const first = paths[0] || artworkFor(exerciseId) || customWorkoutArt;
  const images = (paths.length ? paths : [first]).map((path, index) => {
    const image = new Image();
    image.className = index === 0 ? 'exercise-art' : 'exercise-art exercise-motion-secondary';
    image.alt = '';
    image.decoding = 'async';
    image.src = path;
    return image;
  });
  area.replaceChildren(...images);
  if (paths.length > 1) {
    area.dataset.motionFrameCount = String(paths.length);
    Promise.all(images.map((image) => image.decode())).then(() => {
      if (area.firstElementChild === images[0]) area.dataset.motionReady = 'true';
    }).catch(() => {
      // Keep the first frame visible if a motion frame cannot load.
    });
  }
}

function clearPartSelection() {
  $('.body-silhouette').removeAttribute('data-active-part');
  $$('.part-button').forEach(button => {
    button.setAttribute('aria-pressed', 'false');
    button.classList.remove('active');
  });
}

function cancelPartTransition() {
  clearTimeout(state.partTransitionTimer);
  state.partTransitionTimer = 0;
  state.pendingPartId = null;
  state.partTransitionToken += 1;
  clearPartSelection();
}

function closeExerciseSheet() {
  const modal = $('#exercise-modal');
  if (!modal.open || modal.dataset.closing) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    modal.close();
    return;
  }
  modal.dataset.closing = 'true';
  window.setTimeout(() => {
    if (modal.dataset.closing && modal.open) modal.close();
  }, 180);
}

function setView(name) {
  if (name !== 'picker') cancelPartTransition();
  state.view = name;
  for (const [key, element] of Object.entries(viewElements)) {
    element.hidden = key !== name;
  }
  document.body.dataset.view = name;
  $('#app').focus({ preventScroll: true });
  if (name !== 'record' && name !== 'fatigue') {
    $('#draft-float').hidden = !state.draft;
  } else {
    $('#draft-float').hidden = true;
  }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function refreshClock() {
  const now = new Date();
  $('#clock-time').textContent = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(now);
  $('#clock-date').textContent = formatDateEnglish(now);
}

function renderPartList() {
  $('#part-list').innerHTML = parts.map(part => `
    <button class="part-button" type="button" data-part="${escapeHtml(part.id)}" aria-pressed="false">
      ${renderIcon(part.icon || part.id)}
      <span>${escapeHtml(part.name)}</span>
      <b aria-hidden="true">›</b>
    </button>`).join('');
}

function openPart(partId) {
  if (state.draft) {
    cancelPartTransition();
    requestResume(() => setView('record'));
    return;
  }
  const part = getPart(partId);
  if (!part) return;
  if (state.pendingPartId === partId) return;
  cancelPartTransition();
  state.activePart = part;
  state.tab = 'recent';
  state.pendingPartId = partId;
  $('.body-silhouette').dataset.activePart = partId;
  const button = $$('.part-button').find(item => item.dataset.part === partId);
  if (button) {
    button.setAttribute('aria-pressed', 'true');
    button.classList.add('active');
  }
  const token = ++state.partTransitionToken;
  const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
  state.partTransitionTimer = setTimeout(() => {
    state.partTransitionTimer = 0;
    state.pendingPartId = null;
    if (token !== state.partTransitionToken || state.view !== 'picker'
      || state.activePart?.id !== partId || state.draft) return;
    renderExerciseSheet();
    const modal = $('#exercise-modal');
    modal.setAttribute('aria-label', `${part.name}动作选择`);
    if (!modal.open) modal.showModal();
  }, delay);
}

function renderExerciseSheet() {
  const part = state.activePart;
  if (!part) return;
  $('#exercise-modal-title').textContent = `${part.name}动作`;
  $('#exercise-modal-en').textContent = `${(part.en || part.name).toUpperCase()} EXERCISES`;
  $$('.tab-button').forEach(button => button.classList.toggle('active', button.dataset.exerciseTab === state.tab));
  const customForm = $('#custom-form');
  const list = $('#exercise-list');
  customForm.hidden = state.tab !== 'custom';
  list.hidden = state.tab === 'custom';
  if (state.tab === 'custom') {
    const select = $('#custom-template');
    if (!select.options.length) {
      select.innerHTML = Object.keys(templates).map(key =>
        `<option value="${escapeHtml(key)}">${escapeHtml(templateLabel(key))}</option>`).join('');
    }
    $('#custom-name').focus();
    return;
  }

  let items = allExercises().filter(exercise => exercise.part === part.id);
  if (state.tab === 'recent') {
    const recentIds = [...state.records]
      .filter(record => record.part === part.id)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
      .map(record => record.exerciseId);
    const seen = new Set();
    items = recentIds.map(id => items.find(item => item.id === id)).filter(item => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    if (!items.length) items = allExercises().filter(exercise => exercise.part === part.id);
  }
  if (!items.length) {
    list.innerHTML = '<p class="exercise-empty">这里还没有动作预设<br><small>可以添加一个自定义动作</small></p>';
    return;
  }
  list.innerHTML = items.map((exercise, index) => `
    <button class="exercise-row ${index === 0 && state.tab === 'recent' ? 'featured' : ''}" type="button" data-exercise="${escapeHtml(exercise.id)}">
      <span class="exercise-art-slot" aria-hidden="true">${exerciseArt(exercise.id, true)}</span>
      <span>${escapeHtml(exercise.name)}<small>${escapeHtml(exercise.en || templateLabel(exercise.template))}</small></span>
      <b aria-hidden="true">›</b>
    </button>`).join('');
}

function templateLabel(key) {
  return ({
    weight: '重量 + 次数',
    body: '自重 + 次数',
    assisted: '辅助重量 + 次数',
    time: '持续时间',
    distance: '运动距离',
    cardio: '时间 / 距离'
  })[key] || key;
}

function startExercise(exercise) {
  if (!exercise) return;
  if (state.draft) {
    requestResume(() => setView('record'));
    return;
  }
  const now = new Date();
  const part = getPart(exercise.part);
  state.part = part;
  state.exercise = exercise;
  state.draft = {
    id: crypto.randomUUID(),
    part: exercise.part,
    exerciseId: exercise.id,
    name: exercise.name,
    template: exercise.template,
    date: localDateKey(now),
    startedAt: now.toISOString(),
    ...(visibleTemplateFields(exercise.template).includes('seconds') ? { timeInputUnit: 'minutes' } : {}),
    stage: 'recording',
    groups: [emptyGroup(exercise.template)],
    fatigue: 0
  };
  saveDraft();
  $('#exercise-modal').close();
  renderRecord();
  setView('record');
}

function emptyGroup(template) {
  return Object.fromEntries(visibleTemplateFields(template).map(field => [field, '']));
}

function renderRecord() {
  const draft = state.draft;
  if (!draft) return;
  state.part = getPart(draft.part);
  state.exercise = getExercise(draft.exerciseId) || {
    id: draft.exerciseId,
    part: draft.part,
    name: draft.name,
    template: draft.template,
    en: ''
  };
  $('#record-part-label').textContent = (state.part?.en || state.part?.name || draft.part).toUpperCase();
  $('#record-title').textContent = draft.name;
  $('#record-en').textContent = state.exercise.en || templateLabel(draft.template).toUpperCase();
  renderRecordArtwork(draft.exerciseId);
  const cue = cueFor(draft.exerciseId);
  $('#record-cue').textContent = cue || '';
  $('#record-cue').hidden = !cue;
  const fields = visibleTemplateFields(draft.template);
  const labels = { weight: '重量 kg', reps: '次数', assistanceKg: '辅助 kg', seconds: '时长（分钟）', km: '距离 km' };
  $('#set-head').innerHTML = `<span>组</span>${fields.map(field => `<span>${labels[field]}</span>`).join('')}<span aria-hidden="true"></span>`;
  $('#set-list').innerHTML = draft.groups.map((group, index) => `
    <div class="set-row" data-group-index="${index}">
      <span class="set-row-number">${String(index + 1).padStart(2, '0')}</span>
      ${fields.map(field => {
        const inputMode = field === 'reps' ? 'numeric' : 'decimal';
        const step = field === 'reps' ? '1' : 'any';
        const placeholder = field === 'seconds' ? '0' : '—';
        return `<input class="set-value" type="text" inputmode="${inputMode}" data-field="${field}" data-index="${index}" aria-label="第${index + 1}组${labels[field]}" value="${escapeHtml(group[field] ?? '')}" placeholder="${placeholder}" autocomplete="off" spellcheck="false" data-step="${step}">`;
      }).join('')}
      <div class="set-row-actions">
        <button class="edit-set" type="button" aria-label="编辑第${index + 1}组"><svg viewBox="0 0 24 24"><path d="m14 5 5 5M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z"/></svg></button>
        <button class="remove-set" type="button" data-remove-group="${index}" aria-label="删除第${index + 1}组"><svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v7m4-7v7M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button>
      </div>
    </div>`).join('');
  $('#copy-set').disabled = draft.groups.length === 0;
  $('#add-set').disabled = draft.groups.length >= 100;
  $('#copy-set').disabled = draft.groups.length >= 100 || draft.groups.length === 0;
  $('#group-limit').hidden = draft.groups.length < 100;
  $('.autosave-hint span').textContent = navigator.onLine ? '草稿仅保存在此设备' : '离线 · 草稿保存在此设备';
}

function normalizeField(value, field) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (field === 'seconds' && text.includes(':')) {
    const [minutesText, secondsText, ...extra] = text.split(':');
    if (extra.length || !/^\d+$/.test(minutesText) || !/^\d+(?:[.,]\d+)?$/.test(secondsText)) return NaN;
    const minutes = Number(minutesText);
    const seconds = Number(secondsText.replace(',', '.'));
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60 || seconds < 0) return NaN;
    const totalSeconds = minutes * 60 + seconds;
    return totalSeconds > 0 ? totalSeconds : NaN;
  }
  const normalized = Number(text.replace(',', '.'));
  if (!Number.isFinite(normalized) || normalized < 0) return NaN;
  if (field === 'reps' && (!Number.isSafeInteger(normalized) || normalized <= 0)) return NaN;
  if ((field === 'seconds' || field === 'km') && normalized <= 0) return NaN;
  return normalized;
}

function migrateDraftTimeInput(draft) {
  if (!draft || draft.timeInputUnit || !Array.isArray(draft.groups)
    || !visibleTemplateFields(draft.template).includes('seconds')) return draft;
  return {
    ...draft,
    timeInputUnit: 'minutes',
    groups: draft.groups.map(group => {
      if (!group || typeof group !== 'object' || !Object.hasOwn(group, 'seconds')) return group;
      const raw = group.seconds;
      if (String(raw ?? '').trim() === '') return group;
      const legacySeconds = normalizeField(raw, 'seconds');
      if (!Number.isFinite(legacySeconds)) return group;
      return { ...group, seconds: String(legacySeconds / 60) };
    })
  };
}

function writeGroupValue(index, field, rawValue) {
  const group = state.draft?.groups[index];
  if (!group) return;
  group[field] = rawValue;
  saveDraft();
}

function readGroupValue(group, field, timeInputUnit) {
  const value = normalizeField(group[field], field);
  if (field !== 'seconds' || timeInputUnit !== 'minutes' || String(group[field] ?? '').includes(':')) return value;
  return Number.isFinite(value) ? value * 60 : value;
}

function isGroupBlank(group, fields) {
  return fields.every(field => String(group[field] ?? '').trim() === '');
}

function validateGroups() {
  const draft = state.draft;
  const fields = visibleTemplateFields(draft.template);
  const errors = [];
  draft.groups.forEach((group, index) => {
    if (isGroupBlank(group, fields)) {
      errors.push({ index, message: `第 ${index + 1} 组还是空白` });
      return;
    }
    const optional = draft.template === 'weight' ? ['assistanceKg'] : [];
    const required = fields.filter(field => {
      if (draft.template === 'cardio') return String(group[field] ?? '').trim();
      if (optional.includes(field)) return String(group[field] ?? '').trim();
      return true;
    });
    if (draft.template === 'cardio' && required.length === 0) {
      errors.push({ index, message: `第 ${index + 1} 组至少填写时长或距离` });
      return;
    }
    for (const field of required) {
      const value = readGroupValue(group, field, draft.timeInputUnit);
      if (!Number.isFinite(value)) {
        errors.push({ index, field, message: `第 ${index + 1} 组有字段尚未填写完整` });
        return;
      }
    }
  });
  const hasComplete = draft.groups.some(group => {
    if (isGroupBlank(group, fields)) return false;
    const optional = draft.template === 'weight' ? ['assistanceKg'] : [];
    const required = fields.filter(field => {
      if (draft.template === 'cardio') return String(group[field] ?? '').trim();
      if (optional.includes(field)) return String(group[field] ?? '').trim();
      return true;
    });
    return required.length > 0 && required.every(field => Number.isFinite(readGroupValue(group, field, draft.timeInputUnit)));
  });
  if (!hasComplete && !errors.length) errors.push({ index: 0, message: '至少完成一组记录后再结束动作' });
  if (!hasComplete && errors.length) errors.unshift({ index: 0, message: '至少完成一组有效数据' });
  return errors;
}

function showValidation(errors) {
  $$('.set-value').forEach(input => input.classList.remove('invalid'));
  const first = errors[0];
  if (first?.field) {
    const input = $(`.set-value[data-index="${first.index}"][data-field="${first.field}"]`);
    input?.classList.add('invalid');
    input?.focus();
  } else {
    const input = $(`.set-row[data-group-index="${first?.index ?? 0}"] .set-value`);
    input?.focus();
  }
  showToast(first?.message || '请检查训练组数据');
}

function requestFinish() {
  const errors = validateGroups();
  if (errors.length) {
    showValidation(errors);
    return;
  }
  $('#confirm-title').textContent = '确认结束动作？';
  $('#confirm-copy').textContent = `${state.draft.groups.length} 组 · 确认后不可修改`;
  $('#confirm-yes').textContent = '确认结束 →';
  $('#confirm-modal').showModal();
}

function beginFatigue() {
  if (!state.draft || state.draft.stage !== 'recording') return;
  state.draft.stage = 'fatigue';
  state.draft.fatigue = 0;
  state.draft.fatigueOpenedAt = Date.now();
  state.draft.fatigueLastTapAt = null;
  saveDraft();
  $('#confirm-modal').close();
  renderFatigue();
  setView('fatigue');
  startFatigueTimer();
}

function renderFatigue() {
  if (!state.draft) return;
  $('#fatigue-count').textContent = String(state.draft.fatigue || 0);
  $('#fatigue-hint').textContent = state.draft.fatigue
    ? '停止点击后 2 秒自动记录'
    : '3 秒内没有点击，将记录为 0 次';
  $('#fatigue-clock').textContent = state.draft.fatigueLastTapAt ? 'TAP REGISTERED' : 'READY';
  $('#fatigue-progress').style.transform = 'scaleX(1)';
}

function fatigueDeadline() {
  if (!state.draft || state.draft.stage !== 'fatigue') return 0;
  const base = state.draft.fatigueLastTapAt || state.draft.fatigueOpenedAt;
  return base + (state.draft.fatigueLastTapAt ? 2000 : 3000);
}

function startFatigueTimer() {
  clearTimeout(state.fatigueTimer);
  if (!state.draft || state.draft.stage !== 'fatigue' || state.workspaceConflict || state.sessionLocked) return;
  const remaining = fatigueDeadline() - Date.now();
  if (remaining <= 0) {
    finishFatigue();
    return;
  }
  const total = state.draft.fatigueLastTapAt ? 2000 : 3000;
  $('#fatigue-progress').style.transition = 'none';
  $('#fatigue-progress').style.transform = `scaleX(${Math.min(1, remaining / total)})`;
  requestAnimationFrame(() => {
    $('#fatigue-progress').style.transition = `transform ${remaining}ms linear`;
    $('#fatigue-progress').style.transform = 'scaleX(0)';
  });
  state.fatigueTimer = setTimeout(finishFatigue, remaining);
}

function resumeFatigueIfDue() {
  if (!state.draft || state.draft.stage !== 'fatigue' || state.workspaceConflict || state.sessionLocked) return;
  startFatigueTimer();
}

function tapFatigue() {
  if (!state.draft || state.draft.stage !== 'fatigue') return;
  if (fatigueDeadline() <= Date.now()) {
    finishFatigue();
    return;
  }
  state.draft.fatigue = Number(state.draft.fatigue || 0) + 1;
  state.draft.fatigueLastTapAt = Date.now();
  saveDraft();
  renderFatigue();
  $('#fatigue-tap').classList.remove('tap-pop');
  void $('#fatigue-tap').offsetWidth;
  $('#fatigue-tap').classList.add('tap-pop');
  startFatigueTimer();
}

function completeGroup(group, template, timeInputUnit) {
  const fields = visibleTemplateFields(template);
  const completed = {};
  for (const field of fields) {
    const raw = String(group[field] ?? '').trim();
    if (raw === '' && (template === 'cardio' || template === 'weight' && field === 'assistanceKg')) continue;
    completed[field] = readGroupValue(group, field, timeInputUnit);
  }
  return completed;
}

async function finishFatigue() {
  if (!state.draft || state.draft.stage !== 'fatigue' || state.workspaceConflict || state.sessionLocked) return;
  clearTimeout(state.fatigueTimer);
  const draft = state.draft;
  const pending = safeRead(KEYS.pending, []);
  const queued = pending.find(item => item.id === draft.id);
  const record = queued || {
    id: draft.id,
    part: draft.part,
    exerciseId: draft.exerciseId,
    name: draft.name,
    template: draft.template,
    date: draft.date,
    startedAt: draft.startedAt,
    completedAt: new Date().toISOString(),
    groups: draft.groups.map(group => completeGroup(group, draft.template, draft.timeInputUnit)),
    fatigue: Number(draft.fatigue || 0)
  };
  if (!queued && !safeWrite(KEYS.pending, [...pending, record])) {
    $('#fatigue-hint').textContent = '暂存空间不足，请释放空间后点按重试';
    showToast('记录仍在当前页面，暂未保存');
    return;
  }
  mergeRecords([record]);
  state.draft = null;
  saveDraft();
  setView('picker');
  renderHistoryDate(state.selectedHistoryDate);
  await syncRecord(record);
  renderDraftFloat();
}

async function syncRecord(record) {
  if (!navigator.onLine) {
    setSyncStatus('离线 · 已暂存');
    showNetworkToast('动作已保存在此设备，联网后会自动同步');
    return;
  }
  setSyncStatus('正在同步');
  try {
    const response = await apiFetch('/api/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    removePending(record.id);
    mergeRecords([payload.record || record]);
    setSyncStatus('服务端已保存');
    showToast('动作记录已保存');
  } catch (error) {
    setSyncStatus('待同步');
    showNetworkToast('已保存在此设备，联网后会自动同步');
    console.warn('Record sync pending:', error);
  }
}

function removePending(id) {
  safeWrite(KEYS.pending, safeRead(KEYS.pending, []).filter(item => item.id !== id));
}

function mergeRecords(records) {
  const byId = new Map(state.records.map(record => [record.id, record]));
  records.forEach(record => byId.set(record.id, record));
  state.records = [...byId.values()].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}

function setSyncStatus(message) {
  $('#sync-status').textContent = message;
  $('.sync-indicator').classList.toggle('offline', !navigator.onLine || message.includes('待同步'));
}

function showNetworkToast(message) {
  const toast = $('#network-toast');
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 300);
  }, 3500);
}

function checkActiveSession() {
  if (!apiSessionToken || state.sessionLocked || state.sessionCheckInFlight || !navigator.onLine || document.hidden) return;
  state.sessionCheckInFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  apiFetch('/api/session', { method: 'GET', signal: controller.signal })
    .then(response => {
      if (!response.ok && response.status !== 204 && response.status >= 500) {
        console.info('TRAINTRACE session check unavailable:', response.status);
      }
    })
    .catch(error => {
      if (error?.name !== 'AbortError') console.info('TRAINTRACE session check deferred:', error);
    })
    .finally(() => {
      clearTimeout(timeout);
      state.sessionCheckInFlight = false;
    });
}

function preserveAndLockSession(reason = 'replaced', notifyGate = false) {
  if (state.sessionLocked) return;
  saveDraft({ persistOnly: true });
  state.sessionLocked = true;
  apiSessionToken = '';
  clearTimeout(state.workspaceSaveTimer);
  clearInterval(state.sessionCheckTimer);
  if (notifyGate) window.dispatchEvent(new CustomEvent('traintrace:lock', { detail: { reason } }));
}

async function syncPendingRecords() {
  if (!navigator.onLine) return;
  const pending = safeRead(KEYS.pending, []);
  for (const record of pending) {
    try {
      const response = await apiFetch('/api/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      removePending(record.id);
      mergeRecords([payload.record || record]);
    } catch (error) {
      setSyncStatus('待同步');
      console.warn('Pending record remains queued:', error);
      return;
    }
  }
  setSyncStatus('服务端已同步');
}

async function refreshServerRecords(date = state.selectedHistoryDate) {
  if (!navigator.onLine) {
    setSyncStatus('离线 · 记录待载入');
    return;
  }
  setSyncStatus('正在读取记录');
  try {
    const response = await apiFetch(`/api/records?date=${encodeURIComponent(date)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    mergeRecords(Array.isArray(payload.records) ? payload.records : []);
    setSyncStatus('服务端已同步');
  } catch (error) {
    setSyncStatus('暂时无法读取站点记录');
    console.warn('Could not read server records:', error);
  }
}

function renderDraftFloat() {
  const element = $('#draft-float');
  const draft = state.draft;
  element.hidden = !draft || ['record', 'fatigue'].includes(state.view);
  if (!draft) return;
  $('#draft-name').textContent = draft.name;
  $('#draft-groups').textContent = `已记录 ${draft.groups.length} 组 · 点击继续`;
}

function requestResume(action) {
  if (!state.draft) {
    action();
    return;
  }
  state.pendingResumeAction = action;
  $('#resume-copy').textContent = `“${state.draft.name}”的记录还在暂存，是否继续？`;
  $('#resume-modal').showModal();
}

function resumeDraft() {
  if (!state.draft) return;
  $('#resume-modal').close();
  state.pendingResumeAction = null;
  if (state.draft.stage === 'fatigue') {
    renderFatigue();
    setView('fatigue');
    startFatigueTimer();
  } else {
    renderRecord();
    setView('record');
  }
}

function navigateHome() {
  if (state.view === 'record' || state.view === 'fatigue') {
    if (state.draft) {
      saveDraft();
      setView('home');
      showToast('当前动作已暂存');
      return;
    }
  }
  setView('home');
}

function renderDateLabels(date) {
  const dateText = `${date.getMonth() + 1}月${date.getDate()}日`;
  $('#today-label').textContent = dateText;
  $('#today-date-en').textContent = formatDateEnglish(date);
}

function setDateInputs(date) {
  $('#date-year').value = date.getFullYear();
  $('#date-month').value = date.getMonth() + 1;
  $('#date-day').value = date.getDate();
  $('#date-mobile').value = localDateKey(date);
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  if (year < 2000 || year > 2200 || date.getFullYear() !== year
    || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return localDateKey(date);
}

function selectedDateFromInputs() {
  if (nativeDateMode.matches) {
    const dateKey = validDateKey($('#date-mobile').value);
    if (!dateKey) showToast('请选择有效日期');
    return dateKey;
  }
  const year = Number($('#date-year').value);
  const month = Number($('#date-month').value);
  const day = Number($('#date-day').value);
  const date = new Date(year, month - 1, day, 12);
  if (!Number.isInteger(year) || year < 2000 || year > 2200
    || !Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(day) || date.getFullYear() !== year
    || date.getMonth() !== month - 1 || date.getDate() !== day) {
    showToast('请填写有效的年月日');
    return null;
  }
  return localDateKey(date);
}

function renderHistoryDate(dateKey) {
  state.selectedHistoryDate = dateKey;
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  renderDateLabels(new Date());
  setDateInputs(date);
  const isToday = dateKey === localDateKey(new Date());
  $('#history-date-title').textContent = isToday ? `今天 · ${month}月${day}日` : `${year}年${month}月${day}日`;
  $('#history-iso-date').textContent = `${dateKey.replaceAll('-', '.')}   ${new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date).toUpperCase()}`;
  const records = state.records.filter(record => record.date === dateKey)
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  $('#history-empty').hidden = records.length > 0;
  $('#history-list').hidden = records.length === 0;
  $('#history-list').innerHTML = records.map(renderHistoryCard).join('');
}

async function queryHistory(dateKey) {
  if (!dateKey) return;
  closeDatePicker();
  state.selectedHistoryDate = dateKey;
  renderHistoryDate(dateKey);
  await refreshServerRecords(dateKey);
  if (state.view === 'history' && state.selectedHistoryDate === dateKey) {
    renderHistoryDate(dateKey);
  }
}

function formattedTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function fieldSummary(group, field) {
  const labels = {
    weight: [group.weight, 'kg'],
    reps: [group.reps, '次'],
    assistanceKg: [group.assistanceKg, 'kg 辅助'],
    seconds: [formatDurationMinutes(group.seconds), ''],
    km: [group.km, 'km']
  };
  const [value, unit] = labels[field] || ['', ''];
  return value === undefined || value === '' ? '' : `${value} ${unit}`.trim();
}

function formatDurationMinutes(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return '';
  const minutes = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(seconds / 60);
  return `${minutes} 分钟`;
}

function renderHistoryCard(record) {
  const part = getPart(record.part);
  const exercise = getExercise(record.exerciseId);
  const artwork = exerciseArt(record.exerciseId, true);
  const fatigue = Number(record.fatigue);
  const fields = visibleTemplateFields(record.template);
  const hasLiftRows = record.groups.some(group => group.weight !== undefined || group.reps !== undefined || group.assistanceKg !== undefined);
  const headings = { weight: '重量 kg', reps: '次数', assistanceKg: '辅助 kg' };
  const groupContent = hasLiftRows
    ? `<table class="history-table"><thead><tr><th>组</th>${fields.map(field => `<th>${headings[field]}</th>`).join('')}</tr></thead><tbody>${record.groups.map((group, index) => `<tr><td>${index + 1}</td>${fields.map(field => `<td>${escapeHtml(group[field] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : `<div class="history-values">${record.groups.flatMap((group, index) => fields.map(field => {
      const value = fieldSummary(group, field);
      return value ? `<div class="history-value"><small>第 ${index + 1} 组 · ${escapeHtml(fieldLabel(field))}</small><strong>${escapeHtml(value)}</strong></div>` : '';
    })).join('')}</div>`;
  return `
    <article class="history-card">
      <header class="history-card-head">
        <time class="history-time">${escapeHtml(formattedTime(record.completedAt))}</time>
        <div class="history-exercise">${artwork}<div><h3>${escapeHtml(record.name)}</h3><p>${escapeHtml(exercise?.en || part?.name || record.part)}</p></div></div>
        <span class="fatigue-badge">疲劳&nbsp; ${fatigue} 次</span>
      </header>
      <div class="history-breakdown">
        <div class="history-diagram" aria-hidden="true">${artwork}<span>${escapeHtml(part?.name || record.part)}</span></div>
        ${groupContent}
        <div class="history-dial"><img src="/assets/fists.svg" alt=""><small>疲劳</small><strong>${fatigue} 次</strong></div>
      </div>
    </article>`;
}

function fieldLabel(field) {
  return ({ weight: '重量', reps: '次数', assistanceKg: '辅助', seconds: '时长（分钟）', km: '距离' })[field] || field;
}

function openHistory() {
  state.selectedHistoryDate = localDateKey(new Date());
  renderHistoryDate(state.selectedHistoryDate);
  setView('history');
  refreshServerRecords(state.selectedHistoryDate).then(() => renderHistoryDate(state.selectedHistoryDate));
}

function openDatePicker() {
  renderDateLabels(new Date());
  document.body.dataset.datePicker = 'open';
  setDateInputs(new Date(`${state.selectedHistoryDate}T12:00:00`));
  if (nativeDateMode.matches) {
    const input = $('#date-mobile');
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch {
        // Fall through to the native input's focus/click behavior.
      }
    }
    input.focus({ preventScroll: true });
    input.click();
    return;
  }
  $('#date-year').focus();
}

function closeDatePicker() {
  delete document.body.dataset.datePicker;
}

function createDownload(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportRecords(format) {
  const date = state.selectedHistoryDate;
  const records = state.records.filter(record => record.date === date);
  if (format === 'json') {
    createDownload(`运动记录_${date}.json`, JSON.stringify(records, null, 2), 'application/json;charset=utf-8');
    return;
  }
  const headers = ['date', 'time', 'part', 'exercise', 'set', 'weight_kg', 'reps', 'assistance_kg', 'seconds', 'km', 'fatigue'];
  const csv = [headers, ...records.flatMap(record => record.groups.map((group, index) => [
    record.date, formattedTime(record.completedAt), getPart(record.part)?.name || record.part,
    record.name, index + 1, group.weight ?? '', group.reps ?? '', group.assistanceKg ?? '',
    group.seconds ?? '', group.km ?? '', index === 0 ? record.fatigue : ''
  ]))].map(row => row.map(csvCell).join(',')).join('\r\n');
  createDownload(`运动记录_${date}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function addCustomExercise(event) {
  event.preventDefault();
  const name = $('#custom-name').value.trim();
  const template = $('#custom-template').value;
  if (!name || !state.activePart || !templates[template]) return;
  const custom = readCustomExercises();
  const duplicate = custom.find(item => item.part === state.activePart.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (duplicate) {
    startExercise(duplicate);
    return;
  }
  const item = {
    id: `custom-${crypto.randomUUID()}`,
    part: state.activePart.id,
    name,
    en: 'CUSTOM EXERCISE',
    template,
    icon: state.activePart.icon || state.activePart.id,
    custom: true
  };
  state.customExercises = [item, ...custom];
  queueWorkspaceSave();
  startExercise(item);
}

function addBlankGroup() {
  if (!state.draft || state.draft.stage !== 'recording') return;
  if (state.draft.groups.length >= 100) {
    $('#group-limit').hidden = false;
    return;
  }
  state.draft.groups.push(emptyGroup(state.draft.template));
  saveDraft();
  renderRecord();
  const lastInput = $('#set-list .set-row:last-child .set-value');
  lastInput?.focus();
}

function copyLastGroup() {
  if (!state.draft || state.draft.stage !== 'recording') return;
  if (state.draft.groups.length >= 100) {
    $('#group-limit').hidden = false;
    return;
  }
  const previous = state.draft.groups.at(-1);
  if (!previous) return;
  state.draft.groups.push({ ...previous });
  saveDraft();
  renderRecord();
  const lastInput = $('#set-list .set-row:last-child .set-value');
  lastInput?.focus();
}

function requestCancelRecord() {
  if (!state.draft) return;
  $('#confirm-title').textContent = '取消这条动作记录？';
  $('#confirm-copy').textContent = '当前尚未完成的组和疲劳记录都会清空。';
  $('#confirm-yes').textContent = '确认取消';
  $('#confirm-modal').showModal();
  state.cancelAfterConfirm = true;
}

function requestRemoveGroup(index) {
  if (!state.draft || state.draft.stage !== 'recording') return;
  if (state.draft.groups.length <= 1) {
    showToast('至少保留一组空白记录');
    return;
  }
  $('#confirm-title').textContent = `删除第 ${index + 1} 组？`;
  $('#confirm-copy').textContent = '这组未完成的数据将被移除。';
  $('#confirm-yes').textContent = '确认删除';
  state.removeGroupIndex = index;
  $('#confirm-modal').showModal();
}

function confirmModal() {
  if (Number.isInteger(state.removeGroupIndex)) {
    const index = state.removeGroupIndex;
    state.removeGroupIndex = null;
    $('#confirm-modal').close();
    state.draft.groups.splice(index, 1);
    saveDraft();
    renderRecord();
    return;
  }
  if (state.cancelAfterConfirm) {
    state.cancelAfterConfirm = false;
    $('#confirm-modal').close();
    state.draft = null;
    saveDraft();
    $('#exercise-modal').close();
    setView('picker');
    showToast('已取消这条动作记录');
    return;
  }
  beginFatigue();
}

function closeConfirm() {
  state.cancelAfterConfirm = false;
  state.removeGroupIndex = null;
  $('#confirm-modal').close();
}

function handleVisibilityChange() {
  if (document.hidden) {
    state.pageHiddenAt = Date.now();
    saveDraft({ persistOnly: true });
    return;
  }
  if (state.draft?.stage === 'fatigue') startFatigueTimer();
  checkActiveSession();
  syncWorkspace().catch(error => console.warn('Workspace sync pending:', error));
  syncPendingRecords();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { type: 'module' }).catch(error => {
      console.info('Offline app cache unavailable:', error);
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

function bindEvents() {
  $('#top-home').addEventListener('click', navigateHome);
  $$('[data-home]').forEach(button => button.addEventListener('click', navigateHome));
  $('#start-record').addEventListener('click', () => requestResume(() => setView('picker')));
  $('#history-start').addEventListener('click', () => requestResume(() => setView('picker')));
  $('#open-history').addEventListener('click', openHistory);
  $('#picker-back').addEventListener('click', navigateHome);
  $('#part-list').addEventListener('click', event => {
    const button = event.target.closest('[data-part]');
    if (button) openPart(button.dataset.part);
  });
  $('#exercise-list').addEventListener('click', event => {
    const button = event.target.closest('[data-exercise]');
    if (button) startExercise(getExercise(button.dataset.exercise));
  });
  $$('.tab-button').forEach(button => button.addEventListener('click', () => {
    state.tab = button.dataset.exerciseTab;
    renderExerciseSheet();
  }));
  $('#exercise-modal').addEventListener('close', () => {
    delete $('#exercise-modal').dataset.closing;
    cancelPartTransition();
    state.activePart = null;
  });
  $$('[data-close-exercises]').forEach(button => button.addEventListener('click', closeExerciseSheet));
  $('#custom-form').addEventListener('submit', addCustomExercise);
  $('#record-back').addEventListener('click', () => {
    saveDraft();
    setView('picker');
  });
  $('#set-list').addEventListener('input', event => {
    const input = event.target.closest('.set-value');
    if (!input) return;
    writeGroupValue(Number(input.dataset.index), input.dataset.field, input.value);
    input.classList.remove('invalid');
  });
  $('#set-list').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-group]');
    if (remove) {
      requestRemoveGroup(Number(remove.dataset.removeGroup));
      return;
    }
    const edit = event.target.closest('.edit-set');
    if (edit) edit.closest('.set-row')?.querySelector('.set-value')?.focus();
  });
  $('#add-set').addEventListener('click', addBlankGroup);
  $('#copy-set').addEventListener('click', copyLastGroup);
  $('#finish-action').addEventListener('click', requestFinish);
  $('#cancel-record').addEventListener('click', requestCancelRecord);
  $('#confirm-yes').addEventListener('click', confirmModal);
  $$('[data-modal-cancel]').forEach(button => button.addEventListener('click', closeConfirm));
  $('#confirm-modal').addEventListener('click', event => {
    if (event.target.classList.contains('modal-scrim')) closeConfirm();
  });
  $('#confirm-modal').addEventListener('cancel', () => {
    state.cancelAfterConfirm = false;
    state.removeGroupIndex = null;
  });
  $('#fatigue-tap').addEventListener('click', tapFatigue);
  $('#fatigue-back').addEventListener('click', () => {
    if (!state.draft) return;
    clearTimeout(state.fatigueTimer);
    saveDraft();
    setView('picker');
  });
  $('#resume-draft').addEventListener('click', resumeDraft);
  $('#resume-yes').addEventListener('click', resumeDraft);
  $$('[data-resume-dismiss]').forEach(button => button.addEventListener('click', () => $('#resume-modal').close()));
  $('#resume-modal').addEventListener('click', event => {
    if (event.target.classList.contains('modal-scrim')) $('#resume-modal').close();
  });
  $('#query-history').addEventListener('click', () => queryHistory(selectedDateFromInputs()));
  $('#open-date-picker').addEventListener('click', openDatePicker);
  $('#date-mobile').addEventListener('change', () => {
    const dateKey = validDateKey($('#date-mobile').value);
    if (!dateKey) return;
    setDateInputs(new Date(`${dateKey}T12:00:00`));
    queryHistory(dateKey);
  });
  $('#date-mobile').addEventListener('cancel', closeDatePicker);
  $('#cancel-date-picker').addEventListener('click', closeDatePicker);
  $('.history-view').addEventListener('click', event => {
    if (document.body.dataset.datePicker === 'open' && event.target === $('.history-view')) {
      closeDatePicker();
    }
  });
  $('#history-empty-home').addEventListener('click', navigateHome);
  $('#export-json').addEventListener('click', () => exportRecords('json'));
  $('#export-csv').addEventListener('click', () => exportRecords('csv'));
  $('#workspace-use-server').addEventListener('click', () => resolveWorkspaceConflict(false));
  $('#workspace-use-local').addEventListener('click', () => resolveWorkspaceConflict(true));
  $('#exit-training').addEventListener('click', () => { void window.TRAINTRACE_EXIT?.(); });
  window.TRAINTRACE_EXIT = async () => {
    const token = apiSessionToken;
    const signOutHref = window.TRAINTRACE_SIGNOUT_HREF || '/';
    apiSessionToken = '';
    if (bootstrap) bootstrap.token = '';
    clearTimeout(state.workspaceSaveTimer);
    if (token) {
      try {
        await fetch('/api/session', {
          method: 'DELETE',
          headers: { 'X-Traintrace-Session': token },
          credentials: 'same-origin',
          cache: 'no-store',
          keepalive: true
        });
      } catch {
        // The session also expires server-side if the browser is offline.
      }
    }
    window.TRAINTRACE_BOOTSTRAP = undefined;
    window.location.assign(signOutHref);
  };
  window.addEventListener('traintrace:lock-memory', () => preserveAndLockSession('replaced'));
  window.addEventListener('storage', event => {
    if (event.key === sessionSignalKey && event.newValue && event.newValue !== activeSessionEpoch) {
      preserveAndLockSession('replaced', true);
      return;
    }
    if (event.key === KEYS.workspace && event.newValue) {
      const external = (() => { try { return JSON.parse(event.newValue); } catch { return null; } })();
      if (external?.writerId && external.writerId !== workspaceWriterId) {
        if (!state.workspaceAcknowledgedData || !sameWorkspaceData(workspaceSnapshot(), state.workspaceAcknowledgedData)) {
          preserveWorkspaceBranch(workspaceSnapshot());
        }
        preserveAndLockSession('replaced', true);
      }
    }
  });
  if ('BroadcastChannel' in window) {
    try {
      const channel = new BroadcastChannel('traintrace-session-v1');
      channel.addEventListener('message', event => {
        if (event.data?.type === 'takeover' && event.data?.ownerKey === ownerKey
          && event.data?.sessionEpoch !== activeSessionEpoch) {
          preserveAndLockSession('replaced', true);
        }
      });
    } catch {
      // The localStorage session signal remains the fallback for same-browser tabs.
    }
  }
  window.addEventListener('online', () => {
    setSyncStatus('联网 · 正在同步');
    checkActiveSession();
    syncWorkspace().catch(error => console.warn('Workspace sync pending:', error));
    syncPendingRecords();
    refreshServerRecords(state.selectedHistoryDate).then(() => {
      if (state.view === 'history') renderHistoryDate(state.selectedHistoryDate);
    });
  });
  window.addEventListener('offline', () => {
    setSyncStatus('离线 · 本机记录');
    if (state.draft) saveDraft();
  });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', checkActiveSession);
  window.addEventListener('pageshow', checkActiveSession);
  state.sessionCheckTimer = setInterval(checkActiveSession, 20000);
  window.addEventListener('pagehide', () => saveDraft({ persistOnly: true }));
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.draft?.stage === 'fatigue') {
      event.preventDefault();
      // Keep the mandatory fatigue step open and preserve its count.
    }
    if (event.key === 'Escape' && document.body.dataset.datePicker === 'open') {
      closeDatePicker();
    }
  }, true);
}

function restoreWorkspace() {
  const server = bootstrap.workspace;
  const serverData = cloneWorkspaceData(server);
  state.workspaceRevision = Number(server.revision) || 0;
  state.workspaceAcknowledgedData = serverData;
  state.customExercises = serverData.customExercises;
  state.draft = serverData.draft;

  let queue = safeRead(KEYS.workspace, null);
  let flight = safeRead(KEYS.workspaceFlight, null);
  const flightIsQueueAncestor = Boolean(queue && flight && (
    queue.editId === flight.editId || queue.predecessorEditId === flight.editId
  ));

  if (flight && sameWorkspaceData(flight, serverData)) {
    removeWorkspaceCandidate(KEYS.workspaceFlight, flight);
    flight = null;
    if (queue && sameWorkspaceData(queue, serverData)) {
      removeWorkspaceCandidate(KEYS.workspace, queue);
      queue = null;
    } else if (queue && flightIsQueueAncestor) {
      const current = safeRead(KEYS.workspace, null);
      if (current?.editId === queue.editId) {
        queue = { ...current, revision: state.workspaceRevision, baseRevision: state.workspaceRevision };
        safeWrite(KEYS.workspace, queue);
      }
    }
  } else if (queue && sameWorkspaceData(queue, serverData)) {
    removeWorkspaceCandidate(KEYS.workspace, queue);
    if (flightIsQueueAncestor && flight) removeWorkspaceCandidate(KEYS.workspaceFlight, flight);
    queue = null;
    if (flightIsQueueAncestor) flight = null;
  }

  const candidates = [];
  const addCandidate = (key, value) => {
    if (!value || sameWorkspaceData(value, serverData)) {
      if (value && key !== KEYS.workspace && key !== KEYS.workspaceFlight) removeWorkspaceCandidate(key, value);
      return;
    }
    if (candidates.some(item => item.value.editId && item.value.editId === value.editId
      || sameWorkspaceData(item.value, value))) return;
    candidates.push({ key, value });
  };

  if (queue) addCandidate(KEYS.workspace, queue);
  if (flight && !flightIsQueueAncestor) addCandidate(KEYS.workspaceFlight, flight);
  readWorkspaceBranches().forEach(item => addCandidate(item.key, item.value));
  if (!candidates.length) {
    const legacyDraft = safeRead(KEYS.draft, null);
    if (legacyDraft && JSON.stringify(legacyDraft) !== JSON.stringify(serverData.draft)) {
      addCandidate(KEYS.draft, {
        draft: legacyDraft,
        customExercises: serverData.customExercises,
        revision: null,
        baseRevision: null,
        editedAt: null,
        editId: null
      });
    } else if (legacyDraft) {
      localStorage.removeItem(KEYS.draft);
    }
  }

  if (!candidates.length) return;
  const [candidate, ...extras] = candidates;
  if (candidates.length === 1 && workspaceBaseRevision(candidate.value) === state.workspaceRevision) {
    state.draft = migrateDraftTimeInput(candidate.value.draft);
    state.customExercises = Array.isArray(candidate.value.customExercises) ? candidate.value.customExercises : [];
    state.workspaceAdoptLocal = true;
    if (candidate.key !== KEYS.workspace || candidate.value.writerId !== workspaceWriterId || !candidate.value.editId) {
      const queued = queueWorkspaceSave({ immediate: true });
      if (queued) removeWorkspaceCandidate(candidate.key, candidate.value);
    } else {
      setTimeout(() => syncWorkspace().catch(error => console.warn('Workspace sync pending:', error)), 0);
    }
    return;
  }

  state.workspaceExtraCandidates = extras;
  state.workspaceConflictStorageKey = candidate.key;
  showWorkspaceConflict(candidate.value, server);
}

function init() {
  restoreWorkspace();
  state.lastLocalDraft = state.draft ? cloneWorkspaceData({ draft: state.draft }).draft : null;
  state.records = bootstrap.records || [];
  mergeRecords(safeRead(KEYS.pending, []));
  const restoredDraft = state.draft;
  state.draft = migrateDraftTimeInput(state.draft);
  if (state.draft !== restoredDraft && !state.workspaceConflict) queueWorkspaceSave();
  refreshClock();
  setInterval(refreshClock, 15000);
  renderPartList();
  renderDraftFloat();
  bindEvents();
  setView('home');
  setDateInputs(new Date());
  registerServiceWorker();

  resumeFatigueIfDue();
  checkActiveSession();
  syncPendingRecords();
  refreshServerRecords(state.selectedHistoryDate).catch(() => {});
}

init();
