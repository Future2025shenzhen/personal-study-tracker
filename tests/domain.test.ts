import { describe, it, expect } from "vitest";
import {
  addDays,
  allocate,
  completeTask,
  elapsed,
  finishTimer,
  fresh,
  importBackup,
  localDay,
  startTimer,
  timerElapsed,
  toggleTimer,
  totals,
  undoTask,
  validate,
  weekStart,
  csv,
  type Session,
} from "../src/domain";
const utc = (s: string) => new Date(s).toISOString();
function session(start: string, end: string, amount?: number): Session {
  const segments = [{ start: utc(start), end: utc(end) }];
  return {
    id: "session",
    subjectId: "math",
    start: utc(start),
    end: utc(end),
    segments,
    durationMs: amount ?? elapsed(segments),
    originalDurationMs: elapsed(segments),
    note: "",
    updatedAt: utc(end),
  };
}
describe("accurate timer", () => {
  it("pause/resume, restart timestamps, final save is unique and does not complete task", () => {
    let w = fresh();
    w = startTimer(w, w.subjects[0].id, undefined, "2026-01-01T00:00:00Z");
    w = toggleTimer(w, "2026-01-01T00:10:00Z");
    expect(timerElapsed(w.timer!, "2026-01-01T01:00:00Z")).toBe(600000);
    w = JSON.parse(JSON.stringify(w));
    w = toggleTimer(w, "2026-01-01T01:00:00Z");
    expect(timerElapsed(w.timer!, "2026-01-01T01:05:00Z")).toBe(900000);
    w = finishTimer(w, 900000, "note", "2026-01-01T01:05:00Z");
    expect(w.sessions[0].originalDurationMs).toBe(900000);
    expect(w.timer).toBeNull();
    expect(() => finishTimer(w, 0, "")).toThrow();
    expect(() =>
      startTimer(startTimer(fresh(), fresh().subjects[0].id), ""),
    ).toThrow();
  });
  it("restores a running timer after a closed browser without tick accumulation", () => {
    const w = fresh();
    const t = startTimer(
      w,
      w.subjects[0].id,
      undefined,
      "2026-01-01T00:00:00Z",
    ).timer!;
    expect(
      timerElapsed(JSON.parse(JSON.stringify(t)), "2026-01-01T02:00:00Z"),
    ).toBe(7200000);
  });
});
describe("04:00 IANA timezone splitting", () => {
  it("03:59 belongs to previous day, 04:00 to new day", () => {
    expect(localDay("2026-01-01T19:59:00Z", "Asia/Shanghai")).toBe(
      "2026-01-01",
    );
    expect(localDay("2026-01-01T20:00:00Z", "Asia/Shanghai")).toBe(
      "2026-01-02",
    );
  });
  it("23:30 through 01:00 remains one study day", () => {
    expect(
      allocate(session("2026-01-01T23:30Z", "2026-01-02T01:00Z"), "UTC"),
    ).toEqual({ "2026-01-01": 5400000 });
  });
  it("splits 03:30 through 04:30", () => {
    expect(
      allocate(session("2026-01-02T03:30Z", "2026-01-02T04:30Z"), "UTC"),
    ).toEqual({ "2026-01-01": 1800000, "2026-01-02": 1800000 });
  });
  it("Monday boundary, year and month rollover", () => {
    expect(weekStart("2026-01-04")).toBe("2025-12-29");
    expect(weekStart("2026-01-05")).toBe("2026-01-05");
    expect(
      allocate(session("2026-01-05T03:30Z", "2026-01-05T04:30Z"), "UTC"),
    ).toEqual({ "2026-01-04": 1800000, "2026-01-05": 1800000 });
    expect(
      allocate(session("2026-01-01T03:30Z", "2026-01-01T04:30Z"), "UTC"),
    ).toEqual({ "2025-12-31": 1800000, "2026-01-01": 1800000 });
    expect(
      allocate(session("2026-02-01T03:30Z", "2026-02-01T04:30Z"), "UTC"),
    ).toEqual({ "2026-01-31": 1800000, "2026-02-01": 1800000 });
  });
  it("DST spring and fall use real elapsed duration", () => {
    expect(
      allocate(
        session("2026-03-07T09:00Z", "2026-03-08T08:00Z"),
        "America/New_York",
      ),
    ).toEqual({ "2026-03-07": 23 * 3600000 });
    expect(
      allocate(
        session("2026-10-31T08:00Z", "2026-11-01T09:00Z"),
        "America/New_York",
      ),
    ).toEqual({ "2026-10-31": 25 * 3600000 });
  });
  it("timezone switching regroups exact timestamps", () => {
    const s = session("2026-01-01T05:00Z", "2026-01-01T06:00Z");
    expect(Object.keys(allocate(s, "UTC"))).toEqual(["2026-01-01"]);
    expect(Object.keys(allocate(s, "America/Los_Angeles"))).toEqual([
      "2025-12-31",
    ]);
  });
  it("pause intervals excluded; manual adjustment preserves exact integer total", () => {
    const s = session("2026-01-02T03:00Z", "2026-01-02T05:00Z", 1001);
    s.segments = [
      { start: "2026-01-02T03:00:00Z", end: "2026-01-02T03:30:00Z" },
      { start: "2026-01-02T04:00:00Z", end: "2026-01-02T05:00:00Z" },
    ];
    const a = allocate(s, "UTC");
    expect(a).toEqual({ "2026-01-02": 667, "2026-01-01": 334 });
    expect(Object.values(a).reduce((a, b) => a + b)).toBe(1001);
  });
  it("untimed manual sessions preserve chosen day", () => {
    const s = {
      ...session("2026-01-01T00:00Z", "2026-01-01T01:00Z"),
      start: undefined,
      end: undefined,
      segments: [],
      day: "2026-01-01",
    };
    expect(allocate(s, "Pacific/Honolulu")).toEqual({ "2026-01-01": 3600000 });
  });
});
describe("record edits, recovery and backup", () => {
  it("recalculates total/average/streak after edits, deletion, restore; zeros count", () => {
    const w = fresh();
    const s = {
      ...session("2026-01-02T12:00Z", "2026-01-02T13:00Z"),
      subjectId: w.subjects[0].id,
    };
    w.sessions = [s];
    expect(totals(w, "2026-01-01", "2026-01-03", "UTC")).toMatchObject({
      total: 3600000,
      average: 1200000,
      learningDays: 1,
      longest: 1,
    });
    w.sessions[0].durationMs = 1800000;
    expect(totals(w, "2026-01-02", "2026-01-02", "UTC").total).toBe(1800000);
    w.sessions[0].deletedAt = "2026-01-03T00:00:00Z";
    expect(totals(w, "2026-01-02", "2026-01-02", "UTC").total).toBe(0);
    w.sessions[0].deletedAt = undefined;
    expect(totals(w, "2026-01-02", "2026-01-02", "UTC").total).toBe(1800000);
  });
  it("export/import recovery is idempotent and rejects malformed references", () => {
    const w = fresh();
    w.sessions = [
      {
        ...session("2026-01-02T12:00Z", "2026-01-02T13:00Z"),
        subjectId: w.subjects[0].id,
      },
    ];
    const input = JSON.parse(
      JSON.stringify({ format: "study-tracker-backup", workspace: w }),
    );
    const next = importBackup(fresh(), input);
    expect(importBackup(next, input)).toEqual(next);
    expect(next.sessions).toEqual(w.sessions);
    const bad = structuredClone(w);
    bad.sessions[0].subjectId = "other";
    expect(() => validate(bad)).toThrow();
    const active = startTimer(w, w.subjects[0].id);
    expect(() => importBackup(active, input)).toThrow();
  });
  it("guards CSV formula injection", () => {
    const w = fresh();
    w.sessions = [
      {
        ...session("2026-01-02T12:00Z", "2026-01-02T13:00Z"),
        subjectId: w.subjects[0].id,
        note: '=HYPERLINK("x")',
      },
    ];
    expect(csv(w)).toContain("'=HYPERLINK");
  });
});
describe("recurrence and completion history", () => {
  for (const [repeat, n] of [
    ["daily", 1],
    ["weekly", 7],
  ] as const)
    it(
      repeat +
        " completes once, generates once and undo removes untouched child",
      () => {
        let w = fresh();
        w.tasks = [{ id: "t", title: "Task", repeat, due: "2026-12-31" }];
        w = completeTask(w, "t", "2026-12-31T12:00:00Z");
        w = completeTask(w, "t");
        expect(w.tasks).toHaveLength(2);
        expect(w.tasks[1].due).toBe(addDays("2026-12-31", n));
        w = undoTask(w, "t");
        expect(w.tasks).toHaveLength(1);
        expect(w.tasks[0].completedAt).toBeUndefined();
      },
    );
  it("does not erase completed later occurrence on undo", () => {
    let w = fresh();
    w.tasks = [{ id: "t", title: "Task", repeat: "daily" }];
    w = completeTask(w, "t");
    w = completeTask(w, w.tasks[1].id);
    expect(() => undoTask(w, "t")).toThrow();
  });
});
