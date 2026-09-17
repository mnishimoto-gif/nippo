export const RECIPIENTS =
  "管理部用グループ <tdmng@tcdigital.jp>, 東園直樹 <n.higashizono@tcdigital.jp>, 伊藤敬介 <keisuke.ito@tcdigital.jp>";

export const NEXT_DAY_PLAN_DEFAULT =
  "■翌営業日の作業予定・目標\n" +
  "【TD】\n" +
  " [作業]\n" +
  " ・\n\n" +
  " [MTG]\n" +
  " ・朝会\n\n" +
  "【SC】\n" +
  " ・\n\n" +
  "【KBF】\n" +
  " ・\n";

export function weekdayKanji(date) {
  return ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
}

export function fmtHM(iso) {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function hoursOf(minutes) {
  return Math.round((minutes / 60) * 100) / 100;
}

const FOOTER =
  "■遅延タスク\n・\n\n" +
  "■各予定タスク\n・\n\n" +
  "------------------------------------------------------------\n" +
  "タスク名　完了予定日　進捗率　ステータス\n" +
  "------------------------------------------------------------\n";

/**
 * @param {{id:number, project:string, category:'作業'|'MTG', name:string}[]} tasks
 * @param {{id:number, taskId:number, startAt:string, endAt:string|null}[]} logs
 * @param {Date} now
 */
export function buildReport(tasks, logs, now = new Date()) {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const subject =
    "【日報】" +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "_西本";
  const greeting =
    "各位\n\n" +
    "お疲れ様です、西本です。\n" +
    `${now.getMonth() + 1}月${now.getDate()}日（${weekdayKanji(now)}）の日報をお送りいたします。\n\n`;

  if (logs.length === 0) {
    const body =
      greeting +
      "■本日の開始/終了時間：\n\n" +
      "■報告事項・コメント\n\n\n" +
      "■本日の作業内容　本日記録された作業はありません\n\n\n" +
      NEXT_DAY_PLAN_DEFAULT +
      "\n\n" +
      FOOTER;
    return { to: RECIPIENTS, subject, body };
  }

  const sorted = [...logs].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const projectOrder = [];
  const minutesMap = new Map();
  const firstSeen = new Map();
  let order = 0;

  for (const log of sorted) {
    const task = taskById.get(log.taskId);
    if (!task) continue;
    const end = log.endAt ? new Date(log.endAt) : now;
    const mins = Math.max(0, (end.getTime() - new Date(log.startAt).getTime()) / 60000);
    if (!projectOrder.includes(task.project)) projectOrder.push(task.project);
    const key = `${task.project}||${task.category}||${task.name}`;
    minutesMap.set(key, (minutesMap.get(key) ?? 0) + mins);
    if (!firstSeen.has(key)) firstSeen.set(key, order++);
  }

  let totalMinutes = 0;
  const projSections = projectOrder.map((proj) => {
    const keysForProj = [...minutesMap.keys()].filter((k) => k.startsWith(`${proj}||`));
    const projMinutes = keysForProj.reduce((sum, k) => sum + minutesMap.get(k), 0);
    totalMinutes += projMinutes;
    const lines = [];
    for (const cat of ["作業", "MTG"]) {
      const catKeys = keysForProj
        .filter((k) => k.split("||")[1] === cat)
        .sort((a, b) => firstSeen.get(a) - firstSeen.get(b));
      if (catKeys.length === 0) continue;
      lines.push(` [${cat}]`);
      for (const k of catKeys) {
        const name = k.split("||")[2];
        lines.push(`  ・${name}（${hoursOf(minutesMap.get(k)).toFixed(2)}h）`);
      }
    }
    return `【${proj}】（${hoursOf(projMinutes).toFixed(2)}h）\n${lines.join("\n")}`;
  });

  const firstStart = sorted[0].startAt;
  const lastLog = sorted[sorted.length - 1];
  const lastEnd = lastLog.endAt || now.toISOString();

  const body =
    greeting +
    `■本日の開始/終了時間：${fmtHM(firstStart)}-${fmtHM(lastEnd)}\n\n` +
    "■報告事項・コメント\n\n\n" +
    `■本日の作業内容（${hoursOf(totalMinutes).toFixed(2)}h）\n\n` +
    projSections.join("\n\n\n") +
    "\n\n\n" +
    NEXT_DAY_PLAN_DEFAULT +
    "\n\n" +
    FOOTER;

  return { to: RECIPIENTS, subject, body };
}
