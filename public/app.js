import { buildReport } from "./report.mjs";

const state = {
  authed: null, // null = unknown yet
  tasks: [],
  logs: [],
  memo: "",
  weeklyTasks: "",
};

let currentTab = "today";
let editingLogId = null;
let reportOpen = false;
let taskListCollapsed = false;
let tickHandle = null;
let toastTimer = null;
let taskSearchQuery = "";
let frequencyFilter = null;

const FREQUENCY_ORDER = ["日次", "週次", "月次", "年次", "随時", "その他"];
function normalizeFrequency(freq) {
  if (!freq) return null;
  if (freq.includes("日次")) return "日次";
  if (freq.includes("週次")) return "週次";
  if (freq.includes("月次")) return "月次";
  if (freq.includes("年次")) return "年次";
  if (freq.includes("随時") || freq.includes("不定期")) return "随時";
  return "その他";
}
function loadCollapsedSubgroups() {
  try {
    const raw = localStorage.getItem("nippo-collapsed-subgroups");
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (e) {
    return new Set();
  }
}
function saveCollapsedSubgroups(set) {
  try {
    localStorage.setItem("nippo-collapsed-subgroups", JSON.stringify([...set]));
  } catch (e) {
    /* localStorageが使えない環境では折りたたみ状態を保存しないだけで動作は継続する */
  }
}
let collapsedSubgroups = loadCollapsedSubgroups();

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstChild;
}
function showToast(message) {
  clearTimeout(toastTimer);
  let t = document.querySelector(".toast");
  if (!t) {
    t = el(`<div class="toast"></div>`);
    document.body.appendChild(t);
  }
  t.textContent = message;
  toastTimer = setTimeout(() => t.remove(), 2200);
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (res.status === 401) {
    state.authed = false;
    render();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request_failed_${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}

async function loadAll() {
  const { from, to } = todayRange();
  const [tasksRes, logsRes, memoRes, weeklyTasksRes] = await Promise.all([
    api("/tasks"),
    api(`/logs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    api("/memo"),
    api("/weekly-tasks"),
  ]);
  state.tasks = tasksRes.tasks;
  state.logs = logsRes.logs;
  state.memo = memoRes.content;
  state.weeklyTasks = weeklyTasksRes.content;
}

function activeLog() {
  return state.logs.find((l) => !l.endAt) || null;
}
function taskById(id) {
  return state.tasks.find((t) => t.id === id) || null;
}
function fmtHM(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtElapsed(startIso) {
  const ms = Math.max(0, Date.now() - new Date(startIso).getTime());
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// ---- actions ----

async function doLogin(password) {
  await api("/login", { method: "POST", body: JSON.stringify({ password }) }).catch((e) => {
    throw e;
  });
}
async function doLock() {
  await api("/logout", { method: "POST" }).catch(() => {});
  state.authed = false;
  render();
}
async function startTask(taskId) {
  try {
    await api("/logs/start", { method: "POST", body: JSON.stringify({ taskId }) });
    await loadAll();
    render();
  } catch (e) {
    showToast("記録の開始に失敗しました");
  }
}
async function stopActive() {
  try {
    await api("/logs/stop", { method: "POST" });
    await loadAll();
    render();
  } catch (e) {
    showToast("記録の終了に失敗しました");
  }
}
async function deleteLog(id) {
  try {
    await api(`/logs/${id}`, { method: "DELETE" });
    await loadAll();
    render();
  } catch (e) {
    showToast("削除に失敗しました");
  }
}
async function updateLog(id, taskId, startHM, endHM) {
  const log = state.logs.find((l) => l.id === id);
  if (!log) return;
  const base = new Date(log.startAt);
  function toIso(hm) {
    const [h, m] = hm.split(":").map(Number);
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }
  try {
    await api(`/logs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        taskId: Number(taskId),
        startAt: toIso(startHM),
        endAt: log.endAt ? toIso(endHM) : null,
      }),
    });
    await loadAll();
    render();
  } catch (e) {
    showToast("更新に失敗しました（開始時刻は終了時刻より前にしてください）");
  }
}
async function addTask(project, category, name, frequency) {
  if (!project.trim() || !name.trim()) return;
  try {
    await api("/tasks", {
      method: "POST",
      body: JSON.stringify({ project: project.trim(), category, name: name.trim(), frequency: frequency?.trim() || undefined }),
    });
    await loadAll();
    render();
  } catch (e) {
    showToast("タスクの追加に失敗しました");
  }
}

function parseImportText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split("\t").map((c) => c.trim()))
    .map((cols) => ({ frequency: cols[0] || "", project: cols[1] || "", name: (cols[2] || "").trim() }))
    .filter((r) => r.project && r.name && r.name !== "-");
}

async function importTasks(rows) {
  if (rows.length === 0) {
    showToast("インポートできる行がありません");
    return false;
  }
  try {
    const items = rows.map((r) => ({ project: r.project, category: "作業", name: r.name, frequency: r.frequency || undefined }));
    const res = await api("/tasks/import", { method: "POST", body: JSON.stringify({ items }) });
    await loadAll();
    render();
    showToast(`${res.inserted}件登録しました（重複・空欄など${res.skipped}件はスキップ）`);
    return true;
  } catch (e) {
    showToast("インポートに失敗しました");
    return false;
  }
}
async function toggleTaskHidden(id, hidden) {
  try {
    await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ hidden }) });
    await loadAll();
    render();
  } catch (e) {
    showToast("更新に失敗しました");
  }
}

let memoSaveTimer = null;
function saveMemoDebounced(content, hintEl) {
  state.memo = content;
  clearTimeout(memoSaveTimer);
  memoSaveTimer = setTimeout(async () => {
    try {
      await api("/memo", { method: "PUT", body: JSON.stringify({ content }) });
      if (hintEl) {
        hintEl.textContent = "保存しました";
        setTimeout(() => { hintEl.textContent = ""; }, 1500);
      }
    } catch (e) {
      if (hintEl) hintEl.textContent = "保存に失敗しました";
    }
  }, 500);
}

let weeklyTasksSaveTimer = null;
function saveWeeklyTasksDebounced(content, hintEl) {
  state.weeklyTasks = content;
  clearTimeout(weeklyTasksSaveTimer);
  weeklyTasksSaveTimer = setTimeout(async () => {
    try {
      await api("/weekly-tasks", { method: "PUT", body: JSON.stringify({ content }) });
      if (hintEl) {
        hintEl.textContent = "保存しました";
        setTimeout(() => { hintEl.textContent = ""; }, 1500);
      }
    } catch (e) {
      if (hintEl) hintEl.textContent = "保存に失敗しました";
    }
  }, 500);
}

function copyText(text, flashEl) {
  function flash(msg) {
    if (!flashEl) return;
    flashEl.textContent = msg;
    setTimeout(() => { if (flashEl) flashEl.textContent = ""; }, 1600);
  }
  navigator.clipboard
    ?.writeText(text)
    .then(() => flash("コピーしました"))
    .catch(() => flash("コピーできませんでした。手動で選択してください"));
}

// ---- render ----

function renderLogin() {
  const app = document.getElementById("app");
  app.innerHTML =
    '<div class="login-wrap"><div class="login-card">' +
    "<h1>⏱️ 日報アシスト</h1>" +
    "<p>合言葉を入力してください</p>" +
    '<input id="pw" type="password" autocomplete="current-password" placeholder="合言葉">' +
    '<div class="login-err" id="pwErr"></div>' +
    '<button id="pwBtn">開く</button>' +
    "</div></div>";
  const pw = document.getElementById("pw");
  const btn = document.getElementById("pwBtn");
  const err = document.getElementById("pwErr");
  async function tryLogin() {
    err.textContent = "";
    try {
      await doLogin(pw.value);
      state.authed = true;
      await loadAll();
      render();
    } catch (e) {
      err.textContent = "合言葉が正しくありません";
    }
  }
  btn.addEventListener("click", tryLogin);
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
  pw.focus();
}

function buildRecentTasksRow(act) {
  const recent = state.tasks
    .filter((t) => !t.hidden && t.useCount30d > 0 && !(act && act.taskId === t.id))
    .sort((a, b) => b.useCount30d - a.useCount30d || new Date(b.lastUsedAt) - new Date(a.lastUsedAt))
    .slice(0, 6);
  if (recent.length === 0) return null;
  const row = document.createElement("div");
  row.className = "recent-row";
  row.innerHTML = '<div class="recent-label">よく使う・最近使ったタスク</div><div class="recent-chips"></div>';
  const chipWrap = row.querySelector(".recent-chips");
  recent.forEach((t) => {
    const idx = t.name.indexOf("-");
    const itemName = idx > 0 ? t.name.slice(idx + 1) : t.name;
    chipWrap.appendChild(
      el(
        `<button class="recent-chip" data-id="${t.id}"><span class="badge-mini">${esc(t.project)}</span>${esc(itemName)}</button>`
      )
    );
  });
  return row;
}

function buildFrequencyChips() {
  const counts = new Map();
  state.tasks
    .filter((t) => !t.hidden)
    .forEach((t) => {
      const b = normalizeFrequency(t.frequency);
      if (!b) return;
      counts.set(b, (counts.get(b) || 0) + 1);
    });
  if (counts.size === 0) return null;
  const wrap = document.createElement("div");
  wrap.className = "freq-chips";
  wrap.appendChild(el(`<button class="freq-chip${frequencyFilter === null ? " on" : ""}" data-freq="">すべて</button>`));
  FREQUENCY_ORDER.forEach((b) => {
    if (!counts.has(b)) return;
    wrap.appendChild(
      el(
        `<button class="freq-chip${frequencyFilter === b ? " on" : ""}" data-freq="${esc(b)}">${esc(b)}<span class="n">${counts.get(b)}</span></button>`
      )
    );
  });
  return wrap;
}

function buildTaskListEl(act) {
  const visibleTasks = state.tasks.filter((t) => !t.hidden);
  const query = taskSearchQuery.trim().toLowerCase();
  const searching = query.length > 0;
  const matches = (t) => {
    if (query && !(t.name.toLowerCase().includes(query) || t.project.toLowerCase().includes(query))) return false;
    if (frequencyFilter && normalizeFrequency(t.frequency) !== frequencyFilter) return false;
    return true;
  };
  const filteredTasks = visibleTasks.filter(matches);

  const projects = [];
  visibleTasks.forEach((t) => { if (!projects.includes(t.project)) projects.push(t.project); });

  const wrap = document.createElement("div");
  if (projects.length === 0) {
    wrap.appendChild(el('<div class="empty">登録済みのタスクがありません</div>'));
    return wrap;
  }

  const columnsWrap = document.createElement("div");
  columnsWrap.className = "proj-columns";
  let anyVisible = false;
  projects.forEach((proj) => {
    const projTasks = filteredTasks.filter((t) => t.project === proj);
    if (projTasks.length === 0) return;
    anyVisible = true;
    const column = document.createElement("div");
    column.className = "proj-group";
    column.innerHTML = `<div class="proj-title"><span class="badge">${esc(proj)}</span></div>`;
    ["作業", "MTG"].forEach((category) => {
      const catTasks = projTasks.filter((t) => t.category === category);
      if (catTasks.length === 0) return;
      const catSection = document.createElement("div");
      catSection.className = "cat-group";
      catSection.innerHTML = `<div class="cat-group-head"><span class="cat-badge${category === "MTG" ? " mtg" : ""}">${esc(category)}</span></div>`;
      const subgroups = [];
      const subgroupByLabel = new Map();
      catTasks.forEach((t) => {
        const idx = t.name.indexOf("-");
        const label = idx > 0 ? t.name.slice(0, idx) : null;
        const itemName = idx > 0 ? t.name.slice(idx + 1) : t.name;
        let sub = label !== null ? subgroupByLabel.get(label) : null;
        if (!sub) {
          sub = { label, items: [] };
          subgroups.push(sub);
          if (label !== null) subgroupByLabel.set(label, sub);
        }
        sub.items.push({ task: t, itemName });
      });
      subgroups.forEach((sub) => {
        const key = `${proj}::${category}::${sub.label ?? ""}`;
        const isCollapsed = !searching && sub.label && collapsedSubgroups.has(key);
        if (sub.label) {
          catSection.appendChild(
            el(
              `<button class="task-subgroup-label" data-key="${esc(key)}">${isCollapsed ? "▸" : "▾"} ${esc(sub.label)}<span class="subgroup-count">${sub.items.length}</span></button>`
            )
          );
        }
        if (!isCollapsed) {
          sub.items.forEach(({ task: t, itemName }) => {
            const row = document.createElement("div");
            row.className = "task-row";
            const isActive = act && act.taskId === t.id;
            row.innerHTML =
              `<span class="task-name">${esc(itemName)}</span>` +
              `<button class="start-btn" ${isActive ? "disabled" : ""} data-id="${t.id}">${isActive ? "稼働中" : "開始"}</button>`;
            catSection.appendChild(row);
          });
        }
      });
      column.appendChild(catSection);
    });
    columnsWrap.appendChild(column);
  });
  if (!anyVisible) {
    wrap.appendChild(el('<div class="empty">条件に一致するタスクがありません</div>'));
  } else {
    wrap.appendChild(columnsWrap);
  }
  return wrap;
}

function renderTodayTab(container) {
  const act = activeLog();
  const card = document.createElement("div");
  card.className = "status-card" + (act ? " active" : "");
  if (act) {
    const t = taskById(act.taskId);
    card.innerHTML =
      '<div class="status-left"><span class="pulse-dot"></span><div class="status-text">' +
      `<div class="name">${esc(t ? t.name : "(不明なタスク)")}</div>` +
      `<div class="meta">${esc(t ? `【${t.project}】${t.category}` : "")}・稼働中</div>` +
      "</div></div>" +
      `<div class="status-time" id="elapsedDisplay">${fmtElapsed(act.startAt)}</div>` +
      '<button class="stop-btn" id="stopBtn">終了</button>';
  } else {
    card.innerHTML =
      '<div class="status-left"><span class="pulse-dot"></span><div class="status-text">' +
      '<div class="name">作業中のタスクはありません</div>' +
      '<div class="meta">下のタスクから「開始」を押してください</div></div></div>';
  }
  container.appendChild(card);

  if (act) {
    card.querySelector("#stopBtn").addEventListener("click", stopActive);
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(() => {
      const disp = document.getElementById("elapsedDisplay");
      const current = activeLog();
      if (disp && current) disp.textContent = fmtElapsed(current.startAt);
    }, 1000);
  } else if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }

  const block = document.createElement("div");
  block.className = "block";
  const head = el(
    '<div class="block-head-row"><h2>タスクを選んで記録開始</h2>' +
    `<button class="collapse-btn" id="taskCollapseToggle">${taskListCollapsed ? "展開する ▾" : "折りたたむ ▴"}</button></div>`
  );
  block.appendChild(head);
  head.querySelector("#taskCollapseToggle").addEventListener("click", () => {
    taskListCollapsed = !taskListCollapsed;
    render();
  });

  if (!taskListCollapsed) {
    const recentRow = buildRecentTasksRow(act);
    if (recentRow) block.appendChild(recentRow);

    const controls = document.createElement("div");
    controls.className = "task-picker-controls";
    const searchInput = el(
      `<input type="search" class="task-search" id="taskSearchInput" placeholder="タスク名で検索" value="${esc(taskSearchQuery)}">`
    );
    controls.appendChild(searchInput);
    const freqChips = buildFrequencyChips();
    if (freqChips) controls.appendChild(freqChips);
    block.appendChild(controls);

    const listContainer = document.createElement("div");
    listContainer.className = "task-list-container";
    block.appendChild(listContainer);

    function attachListHandlers() {
      listContainer.querySelectorAll(".start-btn:not([disabled])").forEach((b) => {
        b.addEventListener("click", () => startTask(Number(b.getAttribute("data-id"))));
      });
      listContainer.querySelectorAll(".task-subgroup-label").forEach((b) => {
        b.addEventListener("click", () => {
          const key = b.getAttribute("data-key");
          if (collapsedSubgroups.has(key)) collapsedSubgroups.delete(key);
          else collapsedSubgroups.add(key);
          saveCollapsedSubgroups(collapsedSubgroups);
          refreshList();
        });
      });
    }
    function refreshList() {
      listContainer.innerHTML = "";
      listContainer.appendChild(buildTaskListEl(act));
      attachListHandlers();
    }
    refreshList();

    searchInput.addEventListener("input", () => {
      taskSearchQuery = searchInput.value;
      refreshList();
    });
    if (freqChips) {
      freqChips.querySelectorAll(".freq-chip").forEach((b) => {
        b.addEventListener("click", () => {
          frequencyFilter = b.getAttribute("data-freq") || null;
          freqChips.querySelectorAll(".freq-chip").forEach((c) => c.classList.remove("on"));
          b.classList.add("on");
          refreshList();
        });
      });
    }
    if (recentRow) {
      recentRow.querySelectorAll(".recent-chip").forEach((b) => {
        b.addEventListener("click", () => startTask(Number(b.getAttribute("data-id"))));
      });
    }

    const addLink = el('<button class="add-task-link">＋ 新しいタスクを登録（タスク管理タブ）</button>');
    addLink.addEventListener("click", () => { currentTab = "tasks"; render(); });
    block.appendChild(addLink);
  }
  container.appendChild(block);

  renderMemoBlock(container);
  renderWeeklyTasksBlock(container);

  const logs = [...state.logs].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const tBlock = document.createElement("div");
  tBlock.className = "block";
  tBlock.innerHTML = `<h2>本日のタイムライン <span class="n">(${logs.length}件)</span></h2>`;
  if (logs.length === 0) {
    tBlock.appendChild(el('<div class="empty">まだ記録がありません</div>'));
  }
  logs.forEach((l) => {
    const t = taskById(l.taskId);
    const row = document.createElement("div");
    row.className = "log-row";
    const timeStr = `${fmtHM(l.startAt)}${l.endAt ? `〜${fmtHM(l.endAt)}` : "〜稼働中"}`;
    row.innerHTML =
      '<div class="log-summary">' +
      `<div class="log-time"><b>${timeStr}</b></div>` +
      `<div class="log-mid"><span class="cat-badge${t && t.category === "MTG" ? " mtg" : ""}">${esc(t ? t.category : "?")}</span><span class="task-name">${esc(t ? t.name : "(削除済み)")}</span></div>` +
      `<button class="log-edit-btn" data-id="${l.id}">編集</button>` +
      "</div>";
    if (editingLogId === l.id) {
      const form = document.createElement("div");
      form.className = "edit-form";
      const options = state.tasks
        .map((tk) => `<option value="${tk.id}"${tk.id === l.taskId ? " selected" : ""}>【${esc(tk.project)}】${esc(tk.category)} ${esc(tk.name)}</option>`)
        .join("");
      form.innerHTML =
        `<div><label>タスク</label><select id="editTask">${options}</select></div>` +
        '<div class="row2">' +
        `<div><label>開始</label><input type="time" id="editStart" value="${fmtHM(l.startAt)}"></div>` +
        `<div><label>終了</label><input type="time" id="editEnd" value="${l.endAt ? fmtHM(l.endAt) : ""}" ${l.endAt ? "" : 'disabled placeholder="稼働中"'}></div>` +
        "</div>" +
        '<div class="edit-actions">' +
        '<button class="btn danger" id="editDelete">削除</button>' +
        '<button class="btn" id="editCancel">キャンセル</button>' +
        '<button class="btn primary" id="editSave">保存</button>' +
        "</div>";
      row.appendChild(form);
      setTimeout(() => {
        form.querySelector("#editCancel").addEventListener("click", () => { editingLogId = null; render(); });
        form.querySelector("#editDelete").addEventListener("click", () => { editingLogId = null; deleteLog(l.id); });
        form.querySelector("#editSave").addEventListener("click", () => {
          const newTask = form.querySelector("#editTask").value;
          const newStart = form.querySelector("#editStart").value;
          const newEnd = form.querySelector("#editEnd").value || (l.endAt ? fmtHM(l.endAt) : "");
          editingLogId = null;
          updateLog(l.id, newTask, newStart, newEnd);
        });
      }, 0);
    }
    tBlock.appendChild(row);
  });
  container.appendChild(tBlock);
  tBlock.querySelectorAll(".log-edit-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const id = Number(b.getAttribute("data-id"));
      editingLogId = editingLogId === id ? null : id;
      render();
    });
  });

  const reportBtn = el('<button class="cta-report">📋 今日の日報を作成</button>');
  reportBtn.addEventListener("click", () => { reportOpen = true; render(); });
  container.appendChild(reportBtn);
}

function renderMemoBlock(container) {
  const block = document.createElement("div");
  block.className = "block";
  block.innerHTML = "<h2>自由メモ帳</h2>";
  const ta = el(`<textarea class="memo" placeholder="気づいたこと、数日後にやること、備忘録などを自由に書き留めておけます">${esc(state.memo)}</textarea>`);
  const hint = el('<div class="save-hint"></div>');
  block.appendChild(ta);
  block.appendChild(hint);
  container.appendChild(block);
  ta.addEventListener("input", () => saveMemoDebounced(ta.value, hint));
}

function renderWeeklyTasksBlock(container) {
  const block = document.createElement("div");
  block.className = "block";
  block.innerHTML = "<h2>週間タスク一覧表</h2>";
  const ta = el(
    `<textarea class="weekly-tasks" placeholder="日報の「週間タスク一覧表」欄に毎回引き継がれる内容です。進捗やステータスが変わったらここを更新してください">${esc(state.weeklyTasks)}</textarea>`
  );
  const hint = el('<div class="save-hint"></div>');
  block.appendChild(ta);
  block.appendChild(hint);
  container.appendChild(block);
  ta.addEventListener("input", () => saveWeeklyTasksDebounced(ta.value, hint));
}

function renderTasksTab(container) {
  const block = document.createElement("div");
  block.className = "block";
  block.innerHTML = "<h2>新しいタスクを登録</h2>";
  const existingProjects = [...new Set(state.tasks.map((t) => t.project))];
  const form = el(
    '<div class="new-task-form">' +
    '<div class="row2">' +
    `<input id="newProj" list="projectOptions" placeholder="プロジェクトコード（例：TD）" style="flex:1">` +
    '<select id="newCat" style="flex:1"><option value="作業">作業</option><option value="MTG">MTG</option></select>' +
    "</div>" +
    `<datalist id="projectOptions">${existingProjects.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>` +
    '<input id="newName" placeholder="タスク名（例：経理-支払経費対応）">' +
    '<input id="newFreq" placeholder="頻度（任意・例：月次）">' +
    '<button class="btn primary" id="addTaskBtn">タスクを追加</button>' +
    "</div>"
  );
  block.appendChild(form);
  container.appendChild(block);
  form.querySelector("#addTaskBtn").addEventListener("click", () => {
    const proj = form.querySelector("#newProj").value;
    const cat = form.querySelector("#newCat").value;
    const name = form.querySelector("#newName").value;
    const freq = form.querySelector("#newFreq").value;
    addTask(proj, cat, name, freq);
  });

  const importBlock = document.createElement("div");
  importBlock.className = "block";
  importBlock.innerHTML =
    "<h2>タスクの一括インポート</h2>" +
    '<div class="import-hint">スプレッドシートの「頻度」「プロジェクト」「タスク名」の3列を選択してコピーし、そのまま下に貼り付けてください（区分はすべて「作業」として登録され、既に同じ内容のタスクがあれば自動でスキップされます）。</div>';
  const importTa = el('<textarea class="import-textarea" placeholder="頻度[タブ]プロジェクト[タブ]タスク名"></textarea>');
  const importBtn = el('<button class="btn primary" id="importBtn">貼り付けた内容をインポート</button>');
  importBlock.appendChild(importTa);
  importBlock.appendChild(importBtn);
  container.appendChild(importBlock);
  importBtn.addEventListener("click", async () => {
    const rows = parseImportText(importTa.value);
    importBtn.disabled = true;
    importBtn.textContent = "インポート中…";
    const ok = await importTasks(rows);
    if (!ok) {
      importBtn.disabled = false;
      importBtn.textContent = "貼り付けた内容をインポート";
    }
  });

  const listBlock = document.createElement("div");
  listBlock.className = "block";
  listBlock.innerHTML = `<h2>登録済みタスク <span class="n">(${state.tasks.length}件)</span></h2>`;
  state.tasks.forEach((t) => {
    const row = document.createElement("div");
    row.className = "task-mgmt-row" + (t.hidden ? " hidden-task" : "");
    row.innerHTML =
      `<span class="cat-badge${t.category === "MTG" ? " mtg" : ""}">${esc(t.category)}</span>` +
      `<span class="task-name" style="flex:1">【${esc(t.project)}】${esc(t.name)}${t.frequency ? ` <span class="freq-badge">${esc(t.frequency)}</span>` : ""}</span>` +
      `<button class="toggle-btn" data-id="${t.id}" data-hidden="${t.hidden ? "0" : "1"}">${t.hidden ? "再表示" : "非表示"}</button>`;
    listBlock.appendChild(row);
  });
  container.appendChild(listBlock);
  listBlock.querySelectorAll(".toggle-btn").forEach((b) => {
    b.addEventListener("click", () => {
      toggleTaskHidden(Number(b.getAttribute("data-id")), b.getAttribute("data-hidden") === "1");
    });
  });
}

function renderReportModal() {
  const now = new Date();
  const report = buildReport(state.tasks, state.logs, now, state.weeklyTasks);
  const backdrop = el('<div class="modal-backdrop"></div>');
  const modal = el(
    '<div class="modal">' +
    '<div class="modal-head"><h2>今日の日報</h2><button class="modal-close">✕</button></div>' +
    '<div class="modal-body">' +
    '<div class="field-block"><div class="field-head"><span class="label">宛先</span><button class="copy-btn" data-copy="to">コピー</button></div><div class="field-body" id="fieldTo"></div></div>' +
    '<div class="field-block"><div class="field-head"><span class="label">件名</span><button class="copy-btn" data-copy="subject">コピー</button></div><div class="field-body" id="fieldSubject"></div></div>' +
    '<div class="field-block"><div class="field-head"><span class="label">本文</span><button class="copy-btn" data-copy="body">コピー</button></div><div class="field-body mono" id="fieldBody"></div></div>' +
    '<button class="copy-all" id="copyAllBtn">宛先・件名・本文をまとめてコピー</button>' +
    '<button class="gmail-draft-btn" id="gmailDraftBtn">📧 Gmail下書きを作成</button>' +
    '<a class="gmail-draft-link" id="gmailDraftLink" href="#" target="_blank" rel="noopener"></a>' +
    '<div class="copied-flash" id="flash"></div>' +
    "</div></div>"
  );
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  modal.querySelector("#fieldTo").textContent = report.to;
  modal.querySelector("#fieldSubject").textContent = report.subject;
  modal.querySelector("#fieldBody").textContent = report.body;
  const flash = modal.querySelector("#flash");
  modal.querySelectorAll(".copy-btn").forEach((b) => {
    b.addEventListener("click", () => copyText(report[b.getAttribute("data-copy")], flash));
  });
  modal.querySelector("#copyAllBtn").addEventListener("click", () => {
    copyText(`宛先：${report.to}\n件名：${report.subject}\n\n${report.body}`, flash);
  });
  const gmailBtn = modal.querySelector("#gmailDraftBtn");
  const gmailLink = modal.querySelector("#gmailDraftLink");
  gmailBtn.addEventListener("click", async () => {
    gmailBtn.disabled = true;
    gmailBtn.textContent = "作成中…";
    gmailLink.textContent = "";
    gmailLink.removeAttribute("href");
    try {
      const res = await api("/report/gmail-draft", {
        method: "POST",
        body: JSON.stringify({ to: report.to, subject: report.subject, body: report.body }),
      });
      flash.textContent = "Gmail下書きを作成しました";
      gmailLink.href = res.url;
      gmailLink.target = "_blank";
      gmailLink.rel = "noopener";
      gmailLink.textContent = "作成した下書きをGmailで開く →";
      setTimeout(() => { if (flash) flash.textContent = ""; }, 2400);
    } catch (err) {
      flash.textContent = "Gmail下書きの作成に失敗しました";
      setTimeout(() => { if (flash) flash.textContent = ""; }, 2400);
    } finally {
      gmailBtn.disabled = false;
      gmailBtn.textContent = "📧 Gmail下書きを作成";
    }
  });
  function close() { reportOpen = false; backdrop.remove(); }
  modal.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
}

function render() {
  const app = document.getElementById("app");
  if (state.authed === false) {
    renderLogin();
    return;
  }
  if (state.authed === null) {
    app.innerHTML = "";
    return;
  }
  app.innerHTML = "";
  const header = el(
    '<header class="top"><div class="row">' +
    "<h1>⏱️ 日報<span>アシスト</span></h1>" +
    '<button class="lock-btn" id="lockBtn">ロック</button>' +
    "</div></header>"
  );
  app.appendChild(header);
  header.querySelector("#lockBtn").addEventListener("click", doLock);

  const tabs = el(
    '<nav class="tabs">' +
    `<button data-tab="today" class="${currentTab === "today" ? "on" : ""}">今日の作業</button>` +
    `<button data-tab="tasks" class="${currentTab === "tasks" ? "on" : ""}">タスク管理</button>` +
    "</nav>"
  );
  app.appendChild(tabs);
  tabs.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => { currentTab = b.getAttribute("data-tab"); editingLogId = null; render(); });
  });

  const panel = el('<section class="panel"></section>');
  app.appendChild(panel);
  if (currentTab === "today") renderTodayTab(panel);
  else renderTasksTab(panel);

  if (reportOpen) renderReportModal();
}

async function boot() {
  try {
    await loadAll();
    state.authed = true;
  } catch (e) {
    state.authed = false;
  }
  render();
}

boot();
