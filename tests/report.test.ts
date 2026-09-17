import { describe, expect, it } from "vitest";
import { buildReport, NEXT_DAY_PLAN_DEFAULT, RECIPIENTS } from "../public/report.mjs";

const D = "2026-09-17";

const tasks = [
  { id: 1, project: "TD", category: "作業", name: "労務-助成金要件確認" },
  { id: 2, project: "TD", category: "作業", name: "経理-支払経費対応" },
  { id: 3, project: "TD", category: "作業", name: "総務-従業員代表選出" },
  { id: 4, project: "TD", category: "MTG", name: "朝会" },
  { id: 5, project: "TD", category: "作業", name: "給与-勤怠集計" },
  { id: 6, project: "TD", category: "作業", name: "経理-売上集計" },
  { id: 7, project: "SC", category: "作業", name: "給与-月額変更確認" },
  { id: 8, project: "TD", category: "MTG", name: "スマートワーク推進・AIコンサル定例" },
  { id: 9, project: "TD", category: "作業", name: "経理-銀行借入返済予定" },
  { id: 10, project: "TD", category: "作業", name: "経理-社会保険料起票" },
  { id: 11, project: "TD", category: "作業", name: "ナイカツ作業" },
  { id: 12, project: "SC", category: "作業", name: "経理-会計処理" },
  { id: 13, project: "TD", category: "作業", name: "タスク管理" },
];

// 実際の記録例（08:30〜18:00、途中12:56〜13:56は昼休憩で記録なし）
const spec = [
  [1, "08:30", "08:53"],
  [2, "08:53", "08:56"],
  [3, "08:56", "09:30"],
  [4, "09:30", "09:40"],
  [3, "09:40", "09:51"],
  [5, "09:51", "10:30"],
  [6, "10:30", "10:35"],
  [7, "10:35", "11:00"],
  [8, "11:00", "11:40"],
  [7, "11:40", "12:56"],
  [2, "13:56", "15:05"],
  [9, "15:05", "15:20"],
  [10, "15:20", "15:45"],
  [11, "15:45", "16:10"],
  [11, "16:10", "16:30"],
  [12, "16:30", "16:48"],
  [9, "16:48", "17:11"],
  [13, "17:11", "17:17"],
  [13, "17:17", "18:00"],
];

const logs = spec.map(([taskId, start, end], i) => ({
  id: i + 1,
  taskId,
  startAt: `${D}T${start}:00`,
  endAt: `${D}T${end}:00`,
}));

describe("buildReport", () => {
  it("実際の記録例と完全に一致する集計になる", () => {
    const now = new Date(`${D}T18:00:00`);
    const report = buildReport(tasks, logs, now);

    expect(report.to).toBe(RECIPIENTS);
    expect(report.subject).toBe("【日報】0917_西本");
    expect(report.body).toContain("■本日の開始/終了時間：08:30-18:00");
    expect(report.body).toContain("■本日の作業内容（8.50h）");
    expect(report.body).toContain("【TD】（6.52h）");
    expect(report.body).toContain("・経理-支払経費対応（1.20h）");
    expect(report.body).toContain("・総務-従業員代表選出（0.75h）");
    expect(report.body).toContain("・タスク管理（0.82h）");
    expect(report.body).toContain("・朝会（0.17h）");
    expect(report.body).toContain("・スマートワーク推進・AIコンサル定例（0.67h）");
    expect(report.body).toContain("【SC】（1.98h）");
    expect(report.body).toContain("・給与-月額変更確認（1.68h）");
    expect(report.body).toContain("・経理-会計処理（0.30h）");
    expect(report.body).toContain(NEXT_DAY_PLAN_DEFAULT);
  });

  it("自由メモの内容は本文に一切含まれない（メモは独立機能）", () => {
    const now = new Date(`${D}T18:00:00`);
    const report = buildReport(tasks, logs, now);
    expect(report.body).not.toContain("メモ");
    expect(report.body).not.toContain("気づき");
  });

  it("記録が0件のときはエラーにならず案内文になる", () => {
    const now = new Date(`${D}T09:00:00`);
    const report = buildReport(tasks, [], now);
    expect(report.body).toContain("本日記録された作業はありません");
    expect(report.body).toContain(NEXT_DAY_PLAN_DEFAULT);
  });

  it("稼働中（終了未確定）のログは現在時刻までの時間として計算される", () => {
    const now = new Date(`${D}T09:15:00`);
    const runningLog = [{ id: 1, taskId: 1, startAt: `${D}T09:00:00`, endAt: null }];
    const report = buildReport(tasks, runningLog, now);
    expect(report.body).toContain("・労務-助成金要件確認（0.25h）");
    expect(report.body).toContain("■本日の開始/終了時間：09:00-09:15");
  });

  it("同じタスク名の複数回の記録は合算される", () => {
    const now = new Date(`${D}T12:00:00`);
    const twice = [
      { id: 1, taskId: 13, startAt: `${D}T10:00:00`, endAt: `${D}T10:10:00` },
      { id: 2, taskId: 13, startAt: `${D}T11:00:00`, endAt: `${D}T11:20:00` },
    ];
    const report = buildReport(tasks, twice, now);
    expect(report.body).toContain("・タスク管理（0.50h）");
  });
});
