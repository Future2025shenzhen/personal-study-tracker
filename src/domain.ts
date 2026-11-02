import { Temporal } from "@js-temporal/polyfill";
export type Subject = {
  id: string;
  name: string;
  color: string;
  archived?: boolean;
};
export type Segment = { start: string; end: string };
export type Session = {
  id: string;
  subjectId: string;
  start?: string;
  end?: string;
  day?: string;
  segments: Segment[];
  durationMs: number;
  originalDurationMs: number;
  note: string;
  taskId?: string;
  deletedAt?: string;
  updatedAt: string;
};
export type Task = {
  id: string;
  title: string;
  subjectId?: string;
  due?: string;
  repeat: "none" | "daily" | "weekly";
  completedAt?: string;
  deletedAt?: string;
  parentId?: string;
};
export type Timer = {
  id: string;
  subjectId: string;
  startedAt: string;
  runningSince?: string;
  segments: Segment[];
  note: string;
  taskId?: string;
  lastSeenAt: string;
};
export type Goal = {
  id: string;
  period: "day" | "week";
  subjectId?: string;
  minutes: number;
  enabled: boolean;
};
export type Workspace = {
  schema: 1;
  subjects: Subject[];
  sessions: Session[];
  tasks: Task[];
  goals: Goal[];
  timer: Timer | null;
  settings: { theme: "system" | "light" | "dark"; sidebarCollapsed?: boolean };
};
export const uid = () => crypto.randomUUID();
export const iso = () => new Date().toISOString();
export const deviceZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;
export function fresh(): Workspace {
  return {
    schema: 1,
    subjects: [
      ["Mathematics", "#4F86D4"],
      ["Physics", "#249D84"],
      ["Computer Science", "#D7A03B"],
      ["English", "#9875C8"],
      ["Economics", "#D47F78"],
    ].map(([name, color]) => ({ id: uid(), name, color })),
    sessions: [],
    tasks: [],
    goals: [],
    timer: null,
    settings: { theme: "system" },
  };
}
export function localDay(at: string, zone = deviceZone()): string {
  const z = Temporal.Instant.from(at).toZonedDateTimeISO(zone);
  return z
    .toPlainDate()
    .subtract({ days: z.hour < 4 ? 1 : 0 })
    .toString();
}
export function calendarDay(at = iso(), zone = deviceZone()): string {
  return Temporal.Instant.from(at)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}
export function addDays(day: string, n: number) {
  return Temporal.PlainDate.from(day).add({ days: n }).toString();
}
export function weekStart(day: string) {
  const d = Temporal.PlainDate.from(day);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString();
}
export function boundary(day: string, zone: string) {
  return Temporal.PlainDate.from(day).toZonedDateTime({
    timeZone: zone,
    plainTime: "04:00",
  }).epochMilliseconds;
}
export const elapsed = (segments: Segment[]) =>
  segments.reduce((n, s) => n + Date.parse(s.end) - Date.parse(s.start), 0);
export function timerSegments(t: Timer, now = iso()): Segment[] {
  return [
    ...t.segments,
    ...(t.runningSince ? [{ start: t.runningSince, end: now }] : []),
  ];
}
export function timerElapsed(t: Timer, now = iso()) {
  return elapsed(timerSegments(t, now));
}
export function startTimer(
  w: Workspace,
  subjectId: string,
  taskId?: string,
  now = iso(),
): Workspace {
  if (w.timer) throw Error("已有活动计时器，请先结束。");
  if (!w.subjects.some((s) => s.id === subjectId && !s.archived))
    throw Error("请选择可用科目");
  return {
    ...w,
    timer: {
      id: uid(),
      subjectId,
      taskId,
      startedAt: now,
      runningSince: now,
      segments: [],
      note: "",
      lastSeenAt: now,
    },
  };
}
export function toggleTimer(w: Workspace, now = iso()): Workspace {
  if (!w.timer) throw Error("没有活动计时器");
  const t = w.timer;
  return {
    ...w,
    timer: t.runningSince
      ? {
          ...t,
          segments: timerSegments(t, now),
          runningSince: undefined,
          lastSeenAt: now,
        }
      : { ...t, runningSince: now, lastSeenAt: now },
  };
}
export function finishTimer(
  w: Workspace,
  durationMs: number,
  note: string,
  now = iso(),
): Workspace {
  if (!w.timer) throw Error("该计时器已结束");
  const t = w.timer,
    segments = timerSegments(t, now);
  const s: Session = {
    id: t.id,
    subjectId: t.subjectId,
    taskId: t.taskId,
    start: t.startedAt,
    end: now,
    segments,
    durationMs,
    originalDurationMs: elapsed(segments),
    note,
    updatedAt: now,
  };
  const next = { ...w, timer: null, sessions: [...w.sessions, s] };
  validate(next);
  return next;
}
// Adjusted durations are allocated proportionally to actual active segments, rounded by largest remainder.
export function allocate(
  s: Session,
  zone = deviceZone(),
): Record<string, number> {
  if (s.deletedAt) return {};
  if (!s.start || !s.end) {
    return s.day ? { [s.day]: s.durationMs } : {};
  }
  const weights: Record<string, number> = {};
  for (const seg of s.segments) {
    let p = Date.parse(seg.start),
      end = Date.parse(seg.end);
    while (p < end) {
      const day = localDay(new Date(p).toISOString(), zone);
      const stop = Math.min(end, boundary(addDays(day, 1), zone));
      if (stop <= p) throw Error("学习日边界计算失败");
      weights[day] = (weights[day] || 0) + stop - p;
      p = stop;
    }
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (!total) return { [localDay(s.start, zone)]: s.durationMs };
  const rows = Object.entries(weights).map(([day, n]) => ({
    day,
    raw: (n * s.durationMs) / total,
    value: Math.floor((n * s.durationMs) / total),
  }));
  let rest = s.durationMs - rows.reduce((n, r) => n + r.value, 0);
  rows.sort(
    (a, b) => b.raw - b.value - (a.raw - a.value) || a.day.localeCompare(b.day),
  );
  for (let i = 0; i < rest; i++) rows[i % rows.length].value++;
  return Object.fromEntries(rows.map((r) => [r.day, r.value]));
}
export function totals(
  w: Workspace,
  from: string,
  to: string,
  zone = deviceZone(),
) {
  const days: Record<string, number> = {},
    subjects: Record<string, number> = {};
  for (const s of w.sessions) {
    for (const [day, ms] of Object.entries(allocate(s, zone))) {
      if (day < from || day > to) continue;
      days[day] = (days[day] || 0) + ms;
      subjects[s.subjectId] = (subjects[s.subjectId] || 0) + ms;
    }
  }
  const total = Object.values(days).reduce((a, b) => a + b, 0);
  const count =
    Temporal.PlainDate.from(to).since(Temporal.PlainDate.from(from)).days + 1;
  let streak = 0,
    longest = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    streak = days[d] > 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  return {
    days,
    subjects,
    total,
    average: total / count,
    learningDays: Object.values(days).filter((n) => n > 0).length,
    longest,
    count,
  };
}
export function completeTask(w: Workspace, id: string, now = iso()): Workspace {
  const task = w.tasks.find((t) => t.id === id);
  if (!task || task.deletedAt) throw Error("任务不存在");
  if (task.completedAt) return w;
  const next = { ...task, completedAt: now };
  const tasks = w.tasks.map((t) => (t.id === id ? next : t));
  if (task.repeat !== "none" && !tasks.some((t) => t.parentId === id)) {
    tasks.push({
      ...task,
      id: uid(),
      parentId: id,
      due: addDays(
        task.due || calendarDay(now),
        task.repeat === "daily" ? 1 : 7,
      ),
      completedAt: undefined,
    });
  }
  return { ...w, tasks };
}
export function undoTask(w: Workspace, id: string): Workspace {
  const child = w.tasks.find((t) => t.parentId === id);
  if (child?.completedAt)
    throw Error("下一次重复任务已完成；请先撤销后续完成记录。");
  return {
    ...w,
    tasks: w.tasks
      .filter((t) => t.parentId !== id)
      .map((t) => (t.id === id ? { ...t, completedAt: undefined } : t)),
  };
}
export function validate(w: unknown): asserts w is Workspace {
  const x = w as Workspace;
  if (
    !x ||
    x.schema !== 1 ||
    !Array.isArray(x.subjects) ||
    !Array.isArray(x.sessions) ||
    !Array.isArray(x.tasks) ||
    !Array.isArray(x.goals) ||
    !["system", "dark", "light"].includes(x.settings?.theme) ||
    !(x.timer === null || typeof x.timer === "object")
  )
    throw Error("不是有效的版本 1 备份");
  for (const list of [x.subjects, x.sessions, x.tasks, x.goals]) {
    const ids = new Set<string>();
    for (const item of list) {
      if (typeof item.id !== "string" || !item.id || ids.has(item.id))
        throw Error("备份包含缺失或重复 ID");
      ids.add(item.id);
    }
  }
  const hasSubject = (id: string) => x.subjects.some((s) => s.id === id);
  for (const s of x.subjects)
    if (
      typeof s.name !== "string" ||
      !s.name.trim() ||
      !/^#[0-9a-f]{6}$/i.test(s.color)
    )
      throw Error("科目数据无效");
  for (const s of x.sessions) {
    if (
      !hasSubject(s.subjectId) ||
      !Number.isSafeInteger(s.durationMs) ||
      s.durationMs < 0 ||
      !Number.isSafeInteger(s.originalDurationMs) ||
      s.originalDurationMs < 0 ||
      typeof s.note !== "string" ||
      !Array.isArray(s.segments)
    )
      throw Error("学习记录数据无效");
    if (s.start || s.end) {
      if (
        !s.start ||
        !s.end ||
        !Number.isFinite(Date.parse(s.start)) ||
        Date.parse(s.end) < Date.parse(s.start) ||
        !Number.isFinite(Date.parse(s.end)) ||
        s.durationMs > Date.parse(s.end) - Date.parse(s.start)
      )
        throw Error("记录时间或有效时长不合理");
    } else if (!s.day || !/^\d{4}-\d{2}-\d{2}$/.test(s.day))
      throw Error("补录需要日期");
    if (s.day) Temporal.PlainDate.from(s.day);
    let last = s.start ? Date.parse(s.start) : 0;
    for (const a of s.segments) {
      if (
        !s.start ||
        !s.end ||
        !Number.isFinite(Date.parse(a.start)) ||
        !Number.isFinite(Date.parse(a.end)) ||
        Date.parse(a.start) < last ||
        Date.parse(a.end) < Date.parse(a.start) ||
        Date.parse(a.end) > Date.parse(s.end)
      )
        throw Error("计时分段无效");
      last = Date.parse(a.end);
    }
  }
  for (const t of x.tasks)
    if (
      typeof t.title !== "string" ||
      !t.title.trim() ||
      !["none", "daily", "weekly"].includes(t.repeat) ||
      (t.subjectId && !hasSubject(t.subjectId))
    )
      throw Error("任务数据无效");
  for (const g of x.goals)
    if (
      !Number.isFinite(g.minutes) ||
      g.minutes <= 0 ||
      !["day", "week"].includes(g.period) ||
      (g.subjectId && !hasSubject(g.subjectId))
    )
      throw Error("目标无效");
  if (x.timer) {
    const t = x.timer;
    if (
      !hasSubject(t.subjectId) ||
      !Number.isFinite(Date.parse(t.startedAt)) ||
      !Array.isArray(t.segments) ||
      typeof t.note !== "string"
    )
      throw Error("活动计时器无效");
    let last = Date.parse(t.startedAt);
    for (const s of t.segments) {
      if (
        !Number.isFinite(Date.parse(s.start)) ||
        !Number.isFinite(Date.parse(s.end)) ||
        Date.parse(s.start) < last ||
        Date.parse(s.end) < Date.parse(s.start)
      )
        throw Error("活动计时分段无效");
      last = Date.parse(s.end);
    }
    if (
      t.runningSince &&
      (!Number.isFinite(Date.parse(t.runningSince)) ||
        Date.parse(t.runningSince) < last)
    )
      throw Error("运行起点无效");
  }
}
export function importBackup(current: Workspace, input: unknown): Workspace {
  const wrapper = input as { format?: string; workspace?: unknown };
  const data =
    wrapper?.format === "study-tracker-backup" ? wrapper.workspace : input;
  validate(data);
  if (current.timer || data.timer)
    throw Error(
      "请先结束活动计时器再导入；备份中的活动计时器不能作为历史记录导入。",
    );
  const merge = <T extends { id: string }>(a: T[], b: T[]) => [
    ...a,
    ...b.filter((x) => !a.some((y) => y.id === x.id)),
  ];
  const w = {
    ...current,
    subjects: merge(current.subjects, data.subjects),
    sessions: merge(current.sessions, data.sessions),
    tasks: merge(current.tasks, data.tasks),
    goals: merge(current.goals, data.goals),
  };
  validate(w);
  return w;
}
export function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60000),
    seconds = Math.floor(ms / 1000) % 60;
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(
      2,
      "0",
    )}:${(minutes % 60).toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
export function csv(w: Workspace) {
  const cell = (s: unknown) =>
    '"' +
    String(s ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    "\uFEFF" +
    [
      [
        "id",
        "科目",
        "开始 UTC",
        "结束 UTC",
        "补录学习日",
        "有效秒",
        "原始秒",
        "备注",
        "任务",
        "删除时间",
      ],
      ...w.sessions.map((s) => [
        s.id,
        w.subjects.find((t) => t.id === s.subjectId)?.name,
        s.start,
        s.end,
        s.day,
        s.durationMs / 1000,
        s.originalDurationMs / 1000,
        s.note,
        w.tasks.find((t) => t.id === s.taskId)?.title,
        s.deletedAt,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
