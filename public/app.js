import { buildReport } from "./report.mjs";

const state = {
  authed: null, // null = unknown yet
  tasks: [],
  logs: [],
  memo: "",
};

let currentTab = "today";
let editingLogId = null;
let reportOpen = false;
let taskListCollapsed = false;
let tickHandle = null;
let toastTimer = null;

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
  const [tasksRes, logsRes, memoRes] = await Promise.all([
    api("/tasks"),
    api(`/logs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    api("/memo"),
  ]);
  state.tasks = tasksRes.tasks;
  state.logs = logsRes.logs;
  state.memo = memoRes.content;
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
async function addTask(project, category, name) {
  if (!project.trim() || !name.trim()) return;
  try {
    await api("/tasks", { method: "POST", body: JSON.stringify({ project: project.trim(), category, name: name.trim() }) });
    await loadAll();
    render();
  } catch (e) {
    showToast("タスクの追加に失敗しました");
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

  const visibleTasks = state.tasks.filter((t) => !t.hidden);
  const projects = [];
  visibleTasks.forEach((t) => { if (!projects.includes(t.project)) projects.push(t.project); });

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
    if (projects.length === 0) {
      block.appendChild(el('<div class="empty">登録済みのタスクがありません</div>'));
    }
    projects.forEach((proj) => {
      const group = document.createElement("div");
      group.className = "proj-group";
      group.innerHTML = `<div class="proj-title"><span class="badge">${esc(proj)}</span></div>`;
      visibleTasks.filter((t) => t.project === proj).forEach((t) => {
        const row = document.createElement("div");
        row.className = "task-row";
        const isActive = act && act.taskId === t.id;
        row.innerHTML =
          `<span class="cat-badge${t.category === "MTG" ? " mtg" : ""}">${esc(t.category)}</span>` +
          `<span class="task-name">${esc(t.name)}</span>` +
          `<button class="start-btn" ${isActive ? "disabled" : ""} data-id="${t.id}">${isActive ? "稼働中" : "開始"}</button>`;
        group.appendChild(row);
      });
      block.appendChild(group);
    });
    const addLink = el('<button class="add-task-link">＋ 新しいタスクを登録（タスク管理タブ）</button>');
    addLink.addEventListener("click", () => { currentTab = "tasks"; render(); });
    block.appendChild(addLink);
  }
  container.appendChild(block);
  block.querySelectorAll(".start-btn:not([disabled])").forEach((b) => {
    b.addEventListener("click", () => startTask(Number(b.getAttribute("data-id"))));
  });

  renderMemoBlock(container);

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
    '<button class="btn primary" id="addTaskBtn">タスクを追加</button>' +
    "</div>"
  );
  block.appendChild(form);
  container.appendChild(block);
  form.querySelector("#addTaskBtn").addEventListener("click", () => {
    const proj = form.querySelector("#newProj").value;
    const cat = form.querySelector("#newCat").value;
    const name = form.querySelector("#newName").value;
    addTask(proj, cat, name);
  });

  const listBlock = document.createElement("div");
  listBlock.className = "block";
  listBlock.innerHTML = `<h2>登録済みタスク <span class="n">(${state.tasks.length}件)</span></h2>`;
  state.tasks.forEach((t) => {
    const row = document.createElement("div");
    row.className = "task-mgmt-row" + (t.hidden ? " hidden-task" : "");
    row.innerHTML =
      `<span class="cat-badge${t.category === "MTG" ? " mtg" : ""}">${esc(t.category)}</span>` +
      `<span class="task-name" style="flex:1">【${esc(t.project)}】${esc(t.name)}</span>` +
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
  const report = buildReport(state.tasks, state.logs, now);
  const backdrop = el('<div class="modal-backdrop"></div>');
  const modal = el(
    '<div class="modal">' +
    '<div class="modal-head"><h2>今日の日報</h2><button class="modal-close">✕</button></div>' +
    '<div class="modal-body">' +
    '<div class="field-block"><div class="field-head"><span class="label">宛先</span><button class="copy-btn" data-copy="to">コピー</button></div><div class="field-body" id="fieldTo"></div></div>' +
    '<div class="field-block"><div class="field-head"><span class="label">件名</span><button class="copy-btn" data-copy="subject">コピー</button></div><div class="field-body" id="fieldSubject"></div></div>' +
    '<div class="field-block"><div class="field-head"><span class="label">本文</span><button class="copy-btn" data-copy="body">コピー</button></div><div class="field-body mono" id="fieldBody"></div></div>' +
    '<button class="copy-all" id="copyAllBtn">宛先・件名・本文をまとめてコピー</button>' +
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
