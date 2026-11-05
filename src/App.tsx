import Auth, { InitialPassword } from "./UsernameAuth";
import Admin from "./Admin";
import type { Identity } from "./accounts";
import {
  callbackIssue,
  clearCallbackParams,
  friendlyAuthError,
  clearPendingMail,
} from "./auth-feedback";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  addDays,
  allocate,
  calendarDay,
  completeTask,
  csv,
  deviceZone,
  finishTimer,
  formatDuration,
  fresh,
  importBackup,
  iso,
  localDay,
  startTimer,
  timerElapsed,
  toggleTimer,
  totals,
  uid,
  undoTask,
  weekStart,
  type Session,
  type Task,
  type Workspace,
} from "./domain";
import {
  backup,
  configured,
  download,
  Store,
  supabase,
  authorizeStudyAccount,
  signOutStudyAccount,
} from "./storage";
const pages = [
  ["home", "首页", "Home"],
  ["timer", "计时器", "Timer"],
  ["statistics", "统计与日历", "Statistics"],
  ["history", "学习历史", "Study History"],
  ["tasks", "待办任务", "To-dos"],
  ["settings", "设置", "Settings"],
];
const value = (f: FormData, k: string) => String(f.get(k) || "");
const minute = (ms: number) => Math.round((ms / 60000) * 100) / 100;
const hours = (ms: number) => (ms / 3600000).toFixed(1) + " h";
function useNow() {
  const [now, set] = useState(iso());
  useEffect(() => {
    const id = setInterval(() => set(iso()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} aria-label={title}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button onClick={close} aria-label="关闭">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [store, setStore] = useState<Store | null>(null),
    [ready, setReady] = useState(!configured),
    [authError, setAuthError] = useState(""),
    [recovery, setRecovery] = useState(
      new URLSearchParams(location.search).get("reset") === "1",
    ),
    [tick, setTick] = useState(0);
  const [route, setRoute] = useState(location.hash.slice(1) || "home"),
    [menu, setMenu] = useState(false),
    [modal, setModal] = useState<ReactNode>(null),
    [error, setError] = useState("");
  const now = useNow();
  const bind = async (id: string, cloud: boolean) => {
    try {
      if (cloud) {
        const account = await authorizeStudyAccount();
        setIdentity(account);
        if (account?.must_change_password) {
          setStore((current) => {
            current?.dispose();
            return null;
          });
          return;
        }
        clearPendingMail();
      } else setIdentity(null);
      setAuthError("");
      setStore((current) => {
        if (current?.userId === id && current.cloud === cloud) return current;
        const next = new Store(id, cloud);
        next.onchange = () => setTick((x) => x + 1);
        if (cloud) void next.sync();
        return next;
      });
    } catch (e) {
      setStore((current) => {
        current?.dispose();
        return null;
      });
      setIdentity(null);
      setAuthError("无法打开学习账号：" + (e as Error).message);
    }
  };
  useEffect(() => {
    if (!supabase) {
      if (localStorage.getItem("study-local-mode") === "1")
        void bind("local", false);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) setAuthError(friendlyAuthError(error));
      const callbackProblem = !data.session
        ? callbackIssue(location.search, location.hash)
        : "";
      if (!data.session) {
        const issue = callbackProblem;
        if (issue) {
          setAuthError(issue);
          clearCallbackParams();
          setRoute(location.hash.slice(1) || "home");
        }
      }
      if (data.session) await bind(data.session.user.id, true);
      else if (
        !callbackProblem &&
        localStorage.getItem("study-local-mode") === "1"
      )
        await bind("local", false);
      if (active) setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (session && ["SIGNED_IN", "PASSWORD_RECOVERY"].includes(event)) {
        setTimeout(() => {
          if (active) void bind(session.user.id, true);
        }, 0);
      } else if (event === "SIGNED_OUT") {
        setStore((current) => {
          current?.dispose();
          return null;
        });
        setIdentity(null);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    const fn = () => {
      setRoute(location.hash.slice(1) || "home");
      setMenu(false);
    };
    addEventListener("hashchange", fn);
    return () => removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    if (!store) return;
    let checking = false;
    const fn = async () => {
      if (checking) return;
      checking = true;
      try {
        if (store.cloud && navigator.onLine) {
          const result = await supabase!.rpc("study_account_identity");
          if (
            result.error?.code === "42501" ||
            result.data?.must_change_password ||
            (identity && !result.error && !result.data?.username)
          ) {
            store.dispose();
            setStore(null);
            setIdentity(result.data?.username ? result.data : null);
            setAuthError(result.error?.message || "请更换初始密码。");
            return;
          }
        }
        await store.sync();
      } finally {
        checking = false;
      }
    };
    const id = setInterval(() => void fn(), 5000);
    const storage = (e: StorageEvent) => {
      if (e.key === store.key && e.newValue) {
        try {
          const next = JSON.parse(e.newValue);
          store.cache = next;
          store.onchange();
        } catch {
          setError("另一个标签页的数据无法读取");
        }
      }
    };
    addEventListener("online", fn);
    addEventListener("focus", fn);
    addEventListener("storage", storage);
    return () => {
      clearInterval(id);
      store.dispose();
      removeEventListener("online", fn);
      removeEventListener("focus", fn);
      removeEventListener("storage", storage);
    };
  }, [store]);
  useEffect(() => {
    const theme = store?.workspace.settings.theme || "system";
    document.documentElement.dataset.theme = theme;
  }, [store, tick]);
  function update(fn: (w: Workspace) => Workspace) {
    try {
      store?.update(fn);
      setError("");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  function close() {
    setModal(null);
  }
  const w = store?.workspace;
  if (!ready) return <main className="auth">正在恢复账号…</main>;
  if (identity?.must_change_password)
    return (
      <InitialPassword
        done={() => {
          void supabase!.auth.getSession().then(({ data }) => {
            if (data.session) void bind(data.session.user.id, true);
          });
        }}
      />
    );
  if (!store || !w)
    return (
      <>
        {authError && <p role="alert">{authError}</p>}
        <Auth
          local={() => {
            localStorage.setItem("study-local-mode", "1");
            bind("local", false);
          }}
        />
      </>
    );
  const subject = (id?: string) => w.subjects.find((s) => s.id === id),
    active = w.subjects.filter((s) => !s.archived),
    today = localDay(now),
    dateToday = calendarDay(now),
    dayStats = totals(w, today, today),
    weekStats = totals(w, weekStart(today), addDays(weekStart(today), 6));
  function subjectSelect(defaultValue = "", optional = false) {
    return (
      <select
        aria-label="科目"
        name="subject"
        defaultValue={defaultValue}
        required={!optional}
      >
        {optional && <option value="">不指定科目</option>}
        {w!.subjects
          .filter((s) => !s.archived || s.id === defaultValue)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.archived ? "（已归档）" : ""}
            </option>
          ))}
      </select>
    );
  }
  function taskSelect(defaultValue = "") {
    return (
      <select name="task" defaultValue={defaultValue}>
        <option value="">不关联任务</option>
        {w!.tasks
          .filter((t) => !t.deletedAt || t.id === defaultValue)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
              {t.completedAt ? "（已完成）" : ""}
            </option>
          ))}
      </select>
    );
  }
  function begin(id: string, taskId?: string) {
    if (
      store!.cloud &&
      (!store!.initialised ||
        !navigator.onLine ||
        store!.cache.pending ||
        store!.conflict)
    ) {
      setError(
        "开始新计时前请先联网并完成同步。已有计时器断网后仍可继续计时。",
      );
      return;
    }
    if (update((s) => startTimer(s, id, taskId))) {
      location.hash = "timer";
    }
  }
  function editSession(session?: Session) {
    const localInput = (s?: string) => {
      if (!s) return "";
      const d = new Date(s);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 19);
    };
    setModal(
      <Modal title={session ? "编辑学习记录" : "手动补录"} close={close}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              start = value(f, "start"),
              end = value(f, "end"),
              durationMs = Math.round(Number(value(f, "minutes")) * 60000);
            if (!!start !== !!end) {
              setError("请同时填写开始和结束时间，或都留空");
              return;
            }
            const at = iso();
            const same =
              start === localInput(session?.start) &&
              end === localInput(session?.end);
            const next: Session = {
              id: session?.id || uid(),
              subjectId: value(f, "subject"),
              note: value(f, "note"),
              taskId: value(f, "task") || undefined,
              durationMs,
              originalDurationMs: session?.originalDurationMs ?? durationMs,
              updatedAt: at,
              ...(start && end
                ? {
                    start: new Date(start).toISOString(),
                    end: new Date(end).toISOString(),
                    segments: same
                      ? session!.segments
                      : [
                          {
                            start: new Date(start).toISOString(),
                            end: new Date(end).toISOString(),
                          },
                        ],
                  }
                : { day: value(f, "day"), segments: [] }),
            };
            if (
              update((s) => {
                if (
                  session &&
                  JSON.stringify(
                    s.sessions.find((a) => a.id === session.id),
                  ) !== JSON.stringify(session)
                )
                  throw Error("此记录已在其他位置修改，请关闭窗口重新打开");
                return {
                  ...s,
                  sessions: session
                    ? s.sessions.map((a) =>
                        a.id === session.id
                          ? {
                              ...next,
                              revisions: [
                                ...((a as Session & { revisions?: unknown[] })
                                  .revisions || []),
                                { at, before: { ...a, revisions: undefined } },
                              ],
                            }
                          : a,
                      )
                    : [...s.sessions, next],
                };
              })
            )
              close();
          }}
        >
          <label>
            科目{subjectSelect(session?.subjectId || active[0]?.id)}
          </label>
          <label>
            学习日（无准确时间时使用）
            <input
              name="day"
              type="date"
              required
              defaultValue={session?.day || localDay(session?.start || iso())}
            />
          </label>
          <div className="two">
            <label>
              开始（可选）
              <input
                name="start"
                type="datetime-local"
                step="1"
                defaultValue={localInput(session?.start)}
              />
            </label>
            <label>
              结束（可选）
              <input
                name="end"
                type="datetime-local"
                step="1"
                defaultValue={localInput(session?.end)}
              />
            </label>
          </div>
          <label>
            有效学习时长（分钟）
            <input
              name="minutes"
              type="number"
              min="0.01"
              step="any"
              required
              defaultValue={session ? session.durationMs / 60000 : 30}
            />
          </label>
          <label>关联待办{taskSelect(session?.taskId)}</label>
          <label>
            备注
            <textarea name="note" defaultValue={session?.note} />
          </label>
          <p className="muted small">
            无准确时间时只保存学习日。调整时长按原运行时段比例分配；修改起止时间会按整个新区间分配，原记录保存在修改历史中。
          </p>
          <button className="primary">保存记录</button>
        </form>
      </Modal>,
    );
  }
  function stop() {
    const t = store!.workspace.timer;
    if (!t) return;
    const end = iso(),
      amount = timerElapsed(t, end);
    setModal(
      <Modal title="结束并保存" close={close}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              update((s) => {
                if (JSON.stringify(s.timer) !== JSON.stringify(t))
                  throw Error("计时器已变化，请重新打开确认");
                return finishTimer(
                  s,
                  Math.round(Number(value(f, "minutes")) * 60000),
                  value(f, "note"),
                  end,
                );
              })
            )
              close();
          }}
        >
          <p>
            <Dot color={subject(t.subjectId)?.color} />
            {subject(t.subjectId)?.name}
          </p>
          <p className="muted">
            {new Date(t.startedAt).toLocaleString()} →{" "}
            {new Date(end).toLocaleString()}
          </p>
          <label>
            有效时长（分钟）
            <input
              name="minutes"
              type="number"
              step="any"
              min="0"
              required
              defaultValue={amount / 60000}
            />
          </label>
          <label>
            备注
            <textarea name="note" defaultValue={t.note} />
          </label>
          <p className="small muted">
            关联任务：{w!.tasks.find((a) => a.id === t.taskId)?.title || "无"}
            。保存不会自动完成任务。确认前新经过的时间不计入此记录。
          </p>
          <button className="primary">确认保存</button>
        </form>
      </Modal>,
    );
  }
  function editTask(task?: Task) {
    setModal(
      <Modal title={task ? "编辑待办" : "添加待办"} close={close}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              next: Task = {
                ...task,
                id: task?.id || uid(),
                title: value(f, "title").trim(),
                subjectId: value(f, "subject") || undefined,
                due: value(f, "due") || undefined,
                repeat: value(f, "repeat") as Task["repeat"],
              };
            if (
              update((s) => {
                if (
                  task &&
                  JSON.stringify(s.tasks.find((t) => t.id === task.id)) !==
                    JSON.stringify(task)
                )
                  throw Error("此任务已变化，请重新打开编辑");
                return {
                  ...s,
                  tasks: task
                    ? s.tasks.map((t) => (t.id === task.id ? next : t))
                    : [...s.tasks, next],
                };
              })
            )
              close();
          }}
        >
          <label>
            要做什么
            <input
              name="title"
              required
              maxLength={300}
              defaultValue={task?.title}
              autoFocus
            />
          </label>
          <details open={!!task}>
            <summary>科目、日期与重复</summary>
            <label>科目{subjectSelect(task?.subjectId, true)}</label>
            <label>
              截止日期
              <input name="due" type="date" defaultValue={task?.due} />
            </label>
            <label>
              重复
              <select
                aria-label="重复"
                name="repeat"
                defaultValue={task?.repeat || "none"}
              >
                <option value="none">不重复</option>
                <option value="daily">每日</option>
                <option value="weekly">每周</option>
              </select>
            </label>
            <p className="muted small">
              截止日期按当地日历日 24:00；完成后生成下一次实例。学习统计的 04:00
              分界不影响任务截止日。
            </p>
          </details>
          <button className="primary">保存待办</button>
        </form>
      </Modal>,
    );
  }
  function goals() {
    return w!.goals
      .filter((g) => g.enabled)
      .map((g) => {
        const stats = g.period === "day" ? dayStats : weekStats;
        const ms = g.subjectId ? stats.subjects[g.subjectId] || 0 : stats.total;
        return (
          <div className="goal" key={g.id}>
            <div className="row">
              <span>
                {g.period === "day" ? "每日" : "每周"} ·{" "}
                {subject(g.subjectId)?.name || "全部科目"}
              </span>
              <span className="muted">
                {minute(ms)} / {g.minutes} 分
              </span>
            </div>
            <progress value={ms} max={g.minutes * 60000} />
          </div>
        );
      });
  }
  const visiblePages =
    identity?.role === "admin"
      ? [...pages, ["admin", "管理后台", "Administration"]]
      : pages;
  const title = visiblePages.find((p) => p[0] === route) || pages[0];
  return (
    <div className={"shell" + (w.settings.sidebarCollapsed ? " compact" : "")}>
      <aside className={menu ? "open" : ""}>
        <a className="brand" href="#home">
          ◷ <span>学习记录</span>
        </a>
        <nav>
          {visiblePages.map(([id, label, en], i) => (
            <a
              key={id}
              href={"#" + id}
              className={route === id ? "active" : ""}
            >
              <span className="nav-symbol">
                {["⌂", "◷", "▥", "≡", "✓", "⊙", "⚙"][i]}
              </span>
              <span>
                {label}
                <small>{en}</small>
              </span>
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          {store.cloud ? "云端账号" : "本机工作区"}
        </div>
      </aside>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <div className="body">
        <header>
          <button
            className="menu-button"
            onClick={() => {
              if (innerWidth < 700) setMenu(!menu);
              else
                update((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    sidebarCollapsed: !s.settings.sidebarCollapsed,
                  },
                }));
            }}
            aria-label={
              innerWidth < 700
                ? "展开导航"
                : w.settings.sidebarCollapsed
                  ? "展开侧栏"
                  : "收起侧栏"
            }
          >
            ☰
          </button>
          <span>{title[1]}</span>
          <button className="sync" onClick={() => void store.sync()}>
            {store.status}
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {new Date(now).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
              </div>
              <h1>{title[1]}</h1>
            </div>
            {["home", "history"].includes(route) && (
              <button onClick={() => editSession()}>＋ 补录学习</button>
            )}
          </div>
          {!store.cloud && (
            <div className="local-banner">
              本机模式 · 数据保存在当前浏览器，请定期到设置导出备份。
              {configured && (
                <button
                  onClick={() => {
                    localStorage.removeItem("study-local-mode");
                    setStore(null);
                  }}
                >
                  登录云端
                </button>
              )}
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button onClick={() => setError("")}>关闭</button>
            </div>
          )}
          {store.conflict && (
            <section className="notice">
              <h3>两个设备的记录发生冲突</h3>
              <p>
                本机修改仍完整保留，未覆盖云端。请先下载本机备份，再选择保留哪一版。可以稍后导入备份中的独有记录。
              </p>
              <button onClick={() => backup(w)}>下载本机备份</button>
              <button onClick={() => store.resolve("cloud")}>
                使用云端版本
              </button>
              <button
                onClick={() => {
                  if (
                    confirm(
                      "将用当前本机完整版本替换云端。请确认已导出备份并了解其他设备的新修改将被覆盖。",
                    )
                  )
                    store.resolve("local");
                }}
              >
                明确使用本机版本
              </button>
            </section>
          )}
          {route === "home" && (
            <>
              <section className="home-overview">
                <div>
                  <p className="muted">今日有效学习</p>
                  <div className="big-number">{hours(dayStats.total)}</div>
                  <p className="muted small">
                    学习日 {today} · 凌晨 04:00 更新
                  </p>
                </div>
                <div className="distribution">
                  {active.map((s) => (
                    <div className="distribution-row" key={s.id}>
                      <span>
                        <Dot color={s.color} />
                        {s.name}
                      </span>
                      <strong>{hours(dayStats.subjects[s.id] || 0)}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <div className="section-title">
                  <h2>开始一段学习</h2>
                  <a href="#timer">打开计时器 ↗</a>
                </div>
                <div className="subject-grid">
                  {active.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => begin(s.id)}
                      disabled={!!w.timer}
                    >
                      <Dot color={s.color} />
                      {s.name}
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              </section>
              <div className="two sections">
                <section>
                  <div className="section-title">
                    <h2>今日待办</h2>
                    <button onClick={() => editTask()}>＋</button>
                  </div>
                  {w.tasks
                    .filter(
                      (t) =>
                        !t.deletedAt &&
                        !t.completedAt &&
                        (!t.due || t.due <= dateToday),
                    )
                    .slice(0, 5)
                    .map((t) => (
                      <div className="task-line" key={t.id}>
                        <button
                          aria-label={"完成 " + t.title}
                          onClick={() => update((s) => completeTask(s, t.id))}
                        >
                          ○
                        </button>
                        <span>{t.title}</span>
                        {t.subjectId && (
                          <button
                            aria-label={"计时 " + t.title}
                            onClick={() => begin(t.subjectId!, t.id)}
                          >
                            ◷
                          </button>
                        )}
                      </div>
                    ))}
                  {!w.tasks.some(
                    (t) =>
                      !t.deletedAt &&
                      !t.completedAt &&
                      (!t.due || t.due <= dateToday),
                  ) && (
                    <p className="empty">今天没有待办，留一点空间给自己。</p>
                  )}
                  <a className="subtle-link" href="#tasks">
                    查看全部待办 →
                  </a>
                </section>
                <section>
                  <h2>近 7 日</h2>
                  <Trend
                    days={totals(w, addDays(today, -6), today).days}
                    from={addDays(today, -6)}
                    count={7}
                  />
                </section>
              </div>
              {w.goals.some((g) => g.enabled) && (
                <section>
                  <h2>学习目标</h2>
                  {goals()}
                </section>
              )}
            </>
          )}
          {route === "timer" && (
            <section className="timer-page">
              {w.timer ? (
                <>
                  <p>
                    <Dot color={subject(w.timer.subjectId)?.color} />
                    {subject(w.timer.subjectId)?.name}
                  </p>
                  <div className="timer-number" aria-live="off">
                    {formatDuration(timerElapsed(w.timer, now))}
                  </div>
                  <p className="muted">
                    {w.timer.runningSince
                      ? "正在计时"
                      : "已暂停 · 休息时间不计入"}{" "}
                    · {new Date(w.timer.startedAt).toLocaleTimeString()}
                  </p>
                  <div className="timer-buttons">
                    <button onClick={() => update((s) => toggleTimer(s))}>
                      {w.timer.runningSince ? "暂停" : "继续"}
                    </button>
                    <button className="primary" onClick={stop}>
                      结束并保存
                    </button>
                  </div>
                  <label className="timer-note">
                    关联待办
                    <select
                      aria-label="活动计时关联待办"
                      value={w.timer.taskId || ""}
                      onChange={(e) => {
                        const id = e.target.value,
                          task = w.tasks.find((t) => t.id === id);
                        update((s) => {
                          if (s.timer?.id !== w.timer?.id)
                            throw Error("计时器已变化");
                          return {
                            ...s,
                            timer: s.timer
                              ? {
                                  ...s.timer,
                                  taskId: id || undefined,
                                  subjectId:
                                    task?.subjectId || s.timer.subjectId,
                                }
                              : null,
                          };
                        });
                      }}
                    >
                      <option value="">不关联任务</option>
                      {w.tasks
                        .filter((t) => !t.deletedAt && !t.completedAt)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="timer-note">
                    学习备注（自动保存）
                    <textarea
                      key={w.timer.id + ":note"}
                      value={w.timer.note}
                      placeholder="记下学了什么，或一个待解决的问题…"
                      onChange={(e) => {
                        const note = e.target.value;
                        update((s) =>
                          s.timer?.id === w.timer?.id && s.timer
                            ? { ...s, timer: { ...s.timer, note } }
                            : s,
                        );
                      }}
                    />
                  </label>
                  <p className="small muted">
                    计时按时间戳恢复，锁屏后仍会继续。系统无法判断你是否真的在学习。
                  </p>
                  <button
                    onClick={() => {
                      stop();
                    }}
                  >
                    核对离开时间 / 扣除休息
                  </button>
                </>
              ) : (
                <>
                  <p className="muted">专注于眼前这一段</p>
                  <div className="timer-number">00:00:00</div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget),
                        taskId = value(f, "task"),
                        task = w.tasks.find((t) => t.id === taskId);
                      begin(
                        task?.subjectId || value(f, "subject"),
                        taskId || undefined,
                      );
                      const note = value(f, "note");
                      if (note)
                        update((s) =>
                          s.timer ? { ...s, timer: { ...s.timer, note } } : s,
                        );
                    }}
                  >
                    <label>选择科目{subjectSelect(active[0]?.id)}</label>
                    <label>关联待办（可选）{taskSelect()}</label>
                    <label>
                      学习前备注（可选）
                      <textarea name="note" placeholder="准备学习什么？" />
                    </label>
                    <button className="primary">开始学习</button>
                  </form>
                </>
              )}
            </section>
          )}
          {route === "history" && (
            <History w={w} edit={editSession} update={update} />
          )}
          {route === "statistics" && <Statistics w={w} />}
          {route === "tasks" && (
            <Tasks w={w} edit={editTask} update={update} begin={begin} />
          )}
          {route === "admin" && identity?.role === "admin" && store.cloud && (
            <Admin />
          )}
          {route === "settings" && (
            <>
              <section>
                <h2>外观与时间</h2>
                <label>
                  显示模式
                  <select
                    value={w.settings.theme}
                    onChange={(e) => {
                      const theme = e.target
                        .value as Workspace["settings"]["theme"];
                      update((s) => ({
                        ...s,
                        settings: { ...s.settings, theme },
                      }));
                    }}
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </label>
                <p className="muted">
                  当前时区：{deviceZone()}。学习日于当地 04:00
                  开始，每周从星期一 04:00
                  开始。旅行切换设备时区后，历史记录可能重新归入不同学习日。无准确时间的补录始终保留指定日期。
                </p>
              </section>
              <section>
                <div className="section-title">
                  <h2>科目</h2>
                  <button
                    onClick={() => {
                      setModal(
                        <SubjectForm
                          save={(name, color) => {
                            if (
                              update((s) => ({
                                ...s,
                                subjects: [
                                  ...s.subjects,
                                  { id: uid(), name, color },
                                ],
                              }))
                            )
                              close();
                          }}
                          close={close}
                        />,
                      );
                    }}
                  >
                    ＋ 添加
                  </button>
                </div>
                {w.subjects.map((s) => (
                  <div className="setting-row" key={s.id}>
                    <span>
                      <Dot color={s.color} />
                      {s.name} {s.archived && <small>已归档</small>}
                    </span>
                    <div>
                      <button
                        onClick={() =>
                          setModal(
                            <SubjectForm
                              name={s.name}
                              color={s.color}
                              close={close}
                              save={(name, color) => {
                                if (
                                  update((x) => ({
                                    ...x,
                                    subjects: x.subjects.map((y) =>
                                      y.id === s.id ? { ...y, name, color } : y,
                                    ),
                                  }))
                                )
                                  close();
                              }}
                            />,
                          )
                        }
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => {
                          if (w.timer?.subjectId === s.id)
                            return setError("请先结束此科目的活动计时器");
                          if (
                            confirm(
                              s.archived
                                ? "恢复此科目？"
                                : "归档此科目？历史、任务与目标都会保留，随时可恢复。",
                            )
                          )
                            update((x) => ({
                              ...x,
                              subjects: x.subjects.map((y) =>
                                y.id === s.id
                                  ? { ...y, archived: !s.archived }
                                  : y,
                              ),
                            }));
                        }}
                      >
                        {s.archived ? "恢复" : "归档"}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
              <section>
                <div className="section-title">
                  <h2>每日 / 每周目标</h2>
                  <button
                    onClick={() =>
                      setModal(
                        <Modal title="添加目标" close={close}>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              if (
                                update((s) => ({
                                  ...s,
                                  goals: [
                                    ...s.goals,
                                    {
                                      id: uid(),
                                      period: value(f, "period") as
                                        | "day"
                                        | "week",
                                      subjectId:
                                        value(f, "subject") || undefined,
                                      minutes: Number(value(f, "minutes")),
                                      enabled: true,
                                    },
                                  ],
                                }))
                              )
                                close();
                            }}
                          >
                            <label>
                              周期
                              <select name="period">
                                <option value="day">每日</option>
                                <option value="week">每周</option>
                              </select>
                            </label>
                            <label>范围{subjectSelect("", true)}</label>
                            <label>
                              分钟
                              <input
                                type="number"
                                name="minutes"
                                min="1"
                                required
                              />
                            </label>
                            <button>添加目标</button>
                          </form>
                        </Modal>,
                      )
                    }
                  >
                    ＋ 添加
                  </button>
                </div>
                {w.goals.map((g) => (
                  <div className="setting-row" key={g.id}>
                    <span>
                      {g.period === "day" ? "每日" : "每周"} ·{" "}
                      {subject(g.subjectId)?.name || "全部科目"}
                    </span>
                    <input
                      aria-label="目标分钟"
                      type="number"
                      min="1"
                      defaultValue={g.minutes}
                      onBlur={(e) => {
                        const minutes = Number(e.target.value);
                        update((s) => ({
                          ...s,
                          goals: s.goals.map((a) =>
                            a.id === g.id ? { ...a, minutes } : a,
                          ),
                        }));
                      }}
                    />
                    <button
                      onClick={() =>
                        update((s) => ({
                          ...s,
                          goals: s.goals.map((a) =>
                            a.id === g.id ? { ...a, enabled: !a.enabled } : a,
                          ),
                        }))
                      }
                    >
                      {g.enabled ? "关闭" : "启用"}
                    </button>
                  </div>
                ))}
              </section>
              <section>
                <h2>备份与导出</h2>
                <p className="muted">
                  同步不等于备份。建议每周下载一份
                  JSON，保存在独立位置。本机数据不会自动上传。删除的数据无限期保留在回收站，主动清理功能暂不开放。
                </p>
                <div className="button-row">
                  <button onClick={() => backup(w)}>下载 JSON 备份</button>
                  <button
                    onClick={() =>
                      download(
                        "study-sessions.csv",
                        csv(w),
                        "text/csv;charset=utf-8",
                      )
                    }
                  >
                    导出 CSV
                  </button>
                  <label className="file-button">
                    导入 JSON
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          if (f.size > 5000000)
                            throw Error("备份超过 5 MB，请联系维护者分批导入");
                          const input = JSON.parse(await f.text());
                          if (
                            confirm(
                              "导入新增 ID 的数据；相同 ID 保留当前版本，避免重复。请先下载当前备份。",
                            )
                          )
                            update((s) => importBackup(s, input));
                        } catch (e) {
                          setError((e as Error).message);
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </section>
              <section>
                <h2>账号与数据</h2>
                <p className="muted">
                  {store.cloud
                    ? "已连接专用 Supabase 工作区。待同步修改保存在当前账号的本机队列中。"
                    : "当前为本机模式，没有云端账号。"}{" "}
                  云端备份需要项目所有者额外配置，当前未启用自动备份。
                </p>
                {store.cloud && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const { error } = await supabase!.auth.updateUser({
                        password: value(f, "password"),
                      });
                      if (error) setError(error.message);
                      else {
                        setRecovery(false);
                        alert("密码已更新");
                      }
                    }}
                  >
                    <label>
                      新密码
                      <input
                        name="password"
                        type="password"
                        required
                        minLength={12}
                        autoComplete="new-password"
                      />
                    </label>
                    <button>更新密码</button>
                  </form>
                )}
                <button
                  onClick={async () => {
                    if (store.cache.pending || store.conflict) {
                      setError(
                        "还有未同步数据，请先同步或下载备份；退出前须明确放弃待同步修改。",
                      );
                      if (
                        !confirm(
                          "仍要退出并清除此账号的本机待同步数据吗？请确认已经导出备份。",
                        )
                      )
                        return;
                    }
                    if (store.cloud) {
                      try {
                        await signOutStudyAccount();
                      } catch (error) {
                        return setError((error as Error).message);
                      }
                      store.dispose();
                      localStorage.removeItem(store.key);
                    } else localStorage.removeItem("study-local-mode");
                    setStore(null);
                  }}
                >
                  退出
                  {store.cloud ? "并清除本机账号缓存" : "本机模式（保留数据）"}
                </button>
              </section>
            </>
          )}
          <footer>
            学习日从 04:00 开始 · {deviceZone()} ·{" "}
            <a href="#settings">管理与备份数据</a>
          </footer>
        </main>
        {w.timer && (
          <div className="mini">
            <a href="#timer">
              <Dot color={subject(w.timer.subjectId)?.color} />
              {subject(w.timer.subjectId)?.name}
              <strong>{formatDuration(timerElapsed(w.timer, now))}</strong>
            </a>
            <button onClick={() => update((s) => toggleTimer(s))}>
              {w.timer.runningSince ? "暂停" : "继续"}
            </button>
            <button onClick={stop}>结束</button>
          </div>
        )}
      </div>
      {modal}
      {recovery && store.cloud && (
        <Modal title="设置新密码" close={() => setRecovery(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const { error } = await supabase!.auth.updateUser({
                password: value(new FormData(e.currentTarget), "password"),
              });
              if (error) setError(error.message);
              else {
                setRecovery(false);
                history.replaceState(null, "", location.pathname + "#settings");
              }
            }}
          >
            <label>
              新密码
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>
            <button>保存新密码</button>
          </form>
        </Modal>
      )}
      <AwayPrompt
        timerId={w.timer?.id}
        lastSeen={w.timer?.lastSeenAt}
        onReview={() => {
          location.hash = "timer";
          setError(
            "请核对离开期间是否全程学习；结束时可调整有效时长扣除休息。",
          );
        }}
      />
    </div>
  );
}
function Dot({ color }: { color?: string }) {
  return <i className="dot" style={{ background: color || "#999" }} />;
}
function SubjectForm({
  name = "",
  color = "#4F86D4",
  save,
  close,
}: {
  name?: string;
  color?: string;
  save: (name: string, color: string) => void;
  close: () => void;
}) {
  return (
    <Modal title={name ? "编辑科目" : "添加科目"} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save(value(f, "name").trim(), value(f, "color"));
        }}
      >
        <label>
          名称
          <input name="name" defaultValue={name} maxLength={80} required />
        </label>
        <label>
          颜色
          <input type="color" name="color" defaultValue={color} />
        </label>
        <button className="primary">保存科目</button>
      </form>
    </Modal>
  );
}
function Trend({
  days,
  from,
  count,
}: {
  days: Record<string, number>;
  from: string;
  count: number;
}) {
  const all = Array.from({ length: count }, (_, i) => addDays(from, i)),
    max = Math.max(...all.map((d) => days[d] || 0), 3600000);
  return (
    <div
      className="trend"
      role="img"
      aria-label={all
        .map((d) => d + ": " + minute(days[d] || 0) + "分钟")
        .join("；")}
    >
      {all.map((d) => (
        <div className="bar-column" key={d}>
          <span className="bar-value">{minute(days[d] || 0)}m</span>
          <div className="bar-track">
            <div
              className="bar"
              style={{
                height: Math.max(1, ((days[d] || 0) / max) * 100) + "%",
              }}
            />
          </div>
          <small>{d.slice(5)}</small>
        </div>
      ))}
    </div>
  );
}
function History({
  w,
  edit,
  update,
}: {
  w: Workspace;
  edit: (s: Session) => void;
  update: (fn: (w: Workspace) => Workspace) => boolean;
}) {
  const [query, Q] = useState(""),
    [subject, S] = useState(""),
    [from, F] = useState(""),
    [to, T] = useState(""),
    [trash, D] = useState(false);
  const sessions = w.sessions
    .filter(
      (s) =>
        !!s.deletedAt === trash &&
        (!subject || s.subjectId === subject) &&
        (!from ||
          Object.keys(allocate({ ...s, deletedAt: undefined })).some(
            (d) => d >= from,
          )) &&
        (!to ||
          Object.keys(allocate({ ...s, deletedAt: undefined })).some(
            (d) => d <= to,
          )) &&
        (
          s.note +
          " " +
          w.subjects.find((x) => x.id === s.subjectId)?.name +
          " " +
          w.tasks.find((t) => t.id === s.taskId)?.title
        )
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      (b.start || b.day || "").localeCompare(a.start || a.day || ""),
    );
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const day = session.start ? localDay(session.start) : session.day!;
    groups.set(day, [...(groups.get(day) || []), session]);
  }
  return (
    <>
      <div className="filters">
        <input
          aria-label="搜索记录"
          placeholder="搜索科目、备注、任务…"
          value={query}
          onChange={(e) => Q(e.target.value)}
        />
        <select
          aria-label="筛选科目"
          value={subject}
          onChange={(e) => S(e.target.value)}
        >
          <option value="">所有科目</option>
          {w.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          aria-label="开始日期"
          type="date"
          value={from}
          onChange={(e) => F(e.target.value)}
        />
        <input
          aria-label="结束日期"
          type="date"
          value={to}
          onChange={(e) => T(e.target.value)}
        />
        <button onClick={() => D(!trash)}>
          {trash ? "返回历史" : "回收站"}
        </button>
      </div>
      {!sessions.length && (
        <div className="empty">
          {trash
            ? "回收站是空的。"
            : "还没有符合条件的学习记录。开始计时，或补录一次学习。"}
        </div>
      )}
      {[...groups].map(([day, records]) => (
        <section key={day}>
          <div className="section-title">
            <h2>{day}</h2>
            <span className="muted">
              当日分配 {hours(totals(w, day, day).total)}
            </span>
          </div>
          {records.map((s) => (
            <article className="session" key={s.id}>
              <Dot
                color={w.subjects.find((a) => a.id === s.subjectId)?.color}
              />
              <div className="session-content">
                <div className="row">
                  <strong>
                    {w.subjects.find((a) => a.id === s.subjectId)?.name}
                  </strong>
                  <strong>{formatDuration(s.durationMs)}</strong>
                </div>
                <p className="muted small">
                  {s.start
                    ? `${new Date(s.start).toLocaleString()} → ${new Date(s.end!).toLocaleString()}`
                    : "灵活补录 · 无准确起止时间"}
                </p>
                {s.note && <p className="note">{s.note}</p>}
                {s.taskId && (
                  <p className="small muted">
                    关联：
                    {w.tasks.find((t) => t.id === s.taskId)?.title ||
                      "已移除任务"}
                  </p>
                )}
                <details>
                  <summary>分配与修改信息</summary>
                  <p className="small">
                    原始有效 {formatDuration(s.originalDurationMs)} · 当前{" "}
                    {formatDuration(s.durationMs)} · 最后修改{" "}
                    {new Date(s.updatedAt).toLocaleString()}
                  </p>
                  <p className="small">
                    {Object.entries(allocate({ ...s, deletedAt: undefined }))
                      .map(([d, m]) => `${d}: ${formatDuration(m)}`)
                      .join("；")}
                  </p>
                  <p className="small muted">
                    跨日时按实际运行分段拆分；调整有效时长按各分段原始占比分配，毫秒余数统一补足。
                  </p>
                  {(
                    s as Session & {
                      revisions?: { at: string; before: Session }[];
                    }
                  ).revisions?.map((r, i) => (
                    <p className="small" key={i}>
                      {new Date(r.at).toLocaleString()} 修改前：
                      {formatDuration(r.before.durationMs)} · {r.before.note}
                    </p>
                  ))}
                </details>
                <div className="inline-actions">
                  {!trash && <button onClick={() => edit(s)}>编辑</button>}
                  <button
                    onClick={() => {
                      if (
                        !trash &&
                        !confirm("移入回收站？可随时恢复，统计会自动重算。")
                      )
                        return;
                      update((x) => ({
                        ...x,
                        sessions: x.sessions.map((a) =>
                          a.id === s.id
                            ? { ...a, deletedAt: trash ? undefined : iso() }
                            : a,
                        ),
                      }));
                    }}
                  >
                    {trash ? "恢复记录" : "删除"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      ))}
      <p className="muted small">
        历史按会话开始的学习日分组，完整会话保留为一条。日期标题为当天实际分配时长，跨日会话可能同时影响其他日的统计。
      </p>
    </>
  );
}
function Statistics({ w }: { w: Workspace }) {
  const today = localDay(iso()),
    [period, P] = useState("week"),
    [anchor, A] = useState(today),
    [customFrom, CF] = useState(today),
    [customTo, CT] = useState(today),
    [month, M] = useState(today.slice(0, 7)),
    [chosen, C] = useState(today);
  let from = anchor,
    to = anchor;
  if (period === "week") {
    from = weekStart(anchor);
    to = addDays(from, 6);
  }
  if (period === "month") {
    from = anchor.slice(0, 7) + "-01";
    to = addDays(from, 32).slice(0, 7) + "-01";
    to = addDays(to, -1);
  }
  if (period === "year") {
    from = anchor.slice(0, 4) + "-01-01";
    to = anchor.slice(0, 4) + "-12-31";
  }
  if (period === "custom") {
    from = customFrom;
    to = customTo;
  }
  const valid =
    from &&
    to &&
    from <= to &&
    Math.abs(Date.parse(to) - Date.parse(from)) <= 3660 * 86400000;
  const stats = valid ? totals(w, from, to) : null;
  const prev = stats
    ? totals(w, addDays(from, -stats.count), addDays(from, -1))
    : null;
  const monthStart = month + "-01",
    monthEnd = addDays(addDays(monthStart, 32).slice(0, 7) + "-01", -1),
    monthStats = totals(w, monthStart, monthEnd),
    dayStats = totals(w, chosen, chosen);
  const count =
      Math.round((Date.parse(monthEnd) - Date.parse(monthStart)) / 86400000) +
      1,
    offset = (new Date(monthStart + "T12:00:00").getDay() + 6) % 7;
  return (
    <>
      <div className="filters">
        <select
          aria-label="统计周期"
          value={period}
          onChange={(e) => P(e.target.value)}
        >
          <option value="day">日</option>
          <option value="week">周</option>
          <option value="month">月</option>
          <option value="year">年</option>
          <option value="custom">自定义</option>
        </select>
        {period !== "custom" ? (
          <input
            aria-label="统计日期"
            type="date"
            value={anchor}
            onChange={(e) => A(e.target.value || today)}
          />
        ) : (
          <>
            <input
              aria-label="统计开始"
              type="date"
              value={customFrom}
              onChange={(e) => CF(e.target.value)}
            />
            <input
              aria-label="统计结束"
              type="date"
              value={customTo}
              onChange={(e) => CT(e.target.value)}
            />
          </>
        )}
      </div>
      {stats && prev ? (
        <>
          <p className="muted">
            {from} — {to}
          </p>
          <div className="metrics">
            {[
              ["有效学习", hours(stats.total)],
              ["日均", hours(stats.average)],
              ["学习天数", stats.learningDays + " 天"],
              ["最长连续", stats.longest + " 天"],
            ].map(([label, v]) => (
              <div key={label}>
                <span className="muted">{label}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <p className="small muted">
            日均分母为所选完整范围的全部 {stats.count}{" "}
            个学习日（含零学习日及本周期未到日期）。相较前一等长周期{" "}
            {prev.total
              ? (((stats.total - prev.total) / prev.total) * 100).toFixed(1) +
                "%"
              : stats.total
                ? "前期为零，暂无比例"
                : "均为零"}
            。
          </p>
          <section>
            <h2>科目分布</h2>
            {w.subjects.map((s) => {
              const n = stats.subjects[s.id] || 0;
              return (
                n > 0 && (
                  <div className="goal" key={s.id}>
                    <div className="row">
                      <span>
                        <Dot color={s.color} />
                        {s.name}
                      </span>
                      <span>
                        {hours(n)} ·{" "}
                        {stats.total ? Math.round((n / stats.total) * 100) : 0}%
                      </span>
                    </div>
                    <progress
                      style={{ accentColor: s.color }}
                      value={n}
                      max={stats.total}
                    />
                  </div>
                )
              );
            })}
            {!stats.total && <p className="empty">这个时段还没有学习记录。</p>}
          </section>
          <section>
            <h2>学习趋势</h2>
            {stats.count <= 31 ? (
              <Trend days={stats.days} from={from} count={stats.count} />
            ) : (
              <div className="trend-summary">
                {Object.entries(stats.days)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([d, n]) => (
                    <div className="row" key={d}>
                      <span>{d}</span>
                      <span>{hours(n)}</span>
                    </div>
                  ))}
              </div>
            )}
          </section>
          <section>
            <h2>目标达成</h2>
            {w.goals
              .filter((g) => g.enabled)
              .map((g) => {
                const periods: string[] = [];
                for (let d = from; d <= to; d = addDays(d, 1)) {
                  const p = g.period === "day" ? d : weekStart(d);
                  if (!periods.includes(p)) periods.push(p);
                }
                let achieved = 0;
                for (const p of periods) {
                  const r = totals(
                    w,
                    p,
                    g.period === "day" ? p : addDays(p, 6),
                  );
                  if (
                    (g.subjectId ? r.subjects[g.subjectId] || 0 : r.total) >=
                    g.minutes * 60000
                  )
                    achieved++;
                }
                return (
                  <p key={g.id}>
                    {g.period === "day" ? "每日" : "每周"} ·{" "}
                    {w.subjects.find((s) => s.id === g.subjectId)?.name ||
                      "全部科目"}
                    ：{achieved} / {periods.length} 个周期达成
                  </p>
                );
              })}
            <p className="small muted">
              使用当前目标回顾所选日期涉及的完整周期，不代表当时设置的历史目标。
            </p>
          </section>
        </>
      ) : (
        <p role="alert">请选择有效范围（最多十年）。</p>
      )}
      <section>
        <div className="section-title">
          <h2>学习日历</h2>
          <input
            aria-label="日历月份"
            type="month"
            value={month}
            onChange={(e) => M(e.target.value || today.slice(0, 7))}
          />
        </div>
        <div className="calendar">
          {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
            <span className="weekday" key={d}>
              {d}
            </span>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <span key={"blank" + i} />
          ))}
          {Array.from({ length: count }, (_, i) => {
            const day = addDays(monthStart, i),
              ms = monthStats.days[day] || 0;
            return (
              <button
                key={day}
                className={chosen === day ? "chosen" : ""}
                style={{
                  background: ms
                    ? `color-mix(in srgb, var(--ink) ${Math.min(65, 12 + (ms / 3600000) * 10)}%, var(--panel))`
                    : undefined,
                  color: ms > 14400000 ? "var(--bg)" : undefined,
                }}
                onClick={() => C(day)}
                aria-label={day + " " + minute(ms) + "分钟"}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <p className="small muted">
          颜色越深，学习越久。点击日期查看当天分配。
        </p>
        <h3>
          {chosen} · {hours(dayStats.total)}
        </h3>
        {w.sessions
          .filter((s) => !s.deletedAt && (allocate(s)[chosen] || 0) > 0)
          .map((s) => (
            <div key={s.id} className="calendar-detail">
              <Dot
                color={w.subjects.find((a) => a.id === s.subjectId)?.color}
              />
              <span>
                {w.subjects.find((a) => a.id === s.subjectId)?.name} ·{" "}
                {formatDuration(allocate(s)[chosen])}
                <small>
                  {s.note || "无备注"} · 完整会话 {formatDuration(s.durationMs)}
                </small>
              </span>
            </div>
          ))}
      </section>
    </>
  );
}
function Tasks({
  w,
  edit,
  update,
  begin,
}: {
  w: Workspace;
  edit: (t?: Task) => void;
  update: (fn: (s: Workspace) => Workspace) => boolean;
  begin: (id: string, task?: string) => void;
}) {
  const [query, Q] = useState(""),
    [sub, S] = useState(""),
    [trash, D] = useState(false);
  const today = calendarDay();
  const tasks = w.tasks
    .filter(
      (t) =>
        !!t.deletedAt === trash &&
        t.title.toLowerCase().includes(query.toLowerCase()) &&
        (!sub || t.subjectId === sub),
    )
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const groups = [
    ["已逾期", tasks.filter((t) => !t.completedAt && t.due && t.due < today)],
    [
      "今天",
      tasks.filter((t) => !t.completedAt && (!t.due || t.due === today)),
    ],
    ["即将到期", tasks.filter((t) => !t.completedAt && t.due && t.due > today)],
    [
      "已完成",
      tasks
        .filter((t) => t.completedAt)
        .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!)),
    ],
  ] as [string, Task[]][];
  return (
    <>
      <div className="filters">
        <input
          aria-label="搜索待办"
          value={query}
          onChange={(e) => Q(e.target.value)}
          placeholder="搜索任务…"
        />
        <select
          aria-label="任务科目"
          value={sub}
          onChange={(e) => S(e.target.value)}
        >
          <option value="">所有科目</option>
          {w.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button onClick={() => D(!trash)}>
          {trash ? "返回待办" : "回收站"}
        </button>
        <button className="primary" onClick={() => edit()}>
          ＋ 添加待办
        </button>
      </div>
      {groups.map(([name, list]) => (
        <details className="task-group" key={name} open={name !== "已完成"}>
          <summary>
            {name} <small>{list.length}</small>
          </summary>
          {!list.length && <p className="muted small">暂无任务</p>}
          {list.map((t) => (
            <div className="task-item" key={t.id}>
              {!trash && (
                <button
                  aria-label={
                    t.completedAt ? "撤销完成 " + t.title : "完成 " + t.title
                  }
                  onClick={() =>
                    update((s) =>
                      t.completedAt ? undoTask(s, t.id) : completeTask(s, t.id),
                    )
                  }
                >
                  {t.completedAt ? "☑" : "□"}
                </button>
              )}
              <div className="task-title">
                <span className={t.completedAt ? "done" : ""}>{t.title}</span>
                <small>
                  <Dot
                    color={w.subjects.find((s) => s.id === t.subjectId)?.color}
                  />
                  {w.subjects.find((s) => s.id === t.subjectId)?.name ||
                    "未指定科目"}
                  {t.due ? " · " + t.due : ""}
                  {t.repeat !== "none"
                    ? " · " + (t.repeat === "daily" ? "每日" : "每周")
                    : ""}
                  {t.completedAt
                    ? " · 完成于 " + new Date(t.completedAt).toLocaleString()
                    : ""}
                </small>
              </div>
              <div className="task-actions">
                {!trash && !t.completedAt && t.subjectId && (
                  <button onClick={() => begin(t.subjectId!, t.id)}>
                    计时
                  </button>
                )}
                {!trash && <button onClick={() => edit(t)}>编辑</button>}
                <button
                  onClick={() => {
                    if (
                      !trash &&
                      !confirm("将任务移入回收站？关联的学习历史会保留。")
                    )
                      return;
                    update((s) => ({
                      ...s,
                      tasks: s.tasks.map((a) =>
                        a.id === t.id
                          ? { ...a, deletedAt: trash ? undefined : iso() }
                          : a,
                      ),
                    }));
                  }}
                >
                  {trash ? "恢复" : "删除"}
                </button>
              </div>
            </div>
          ))}
        </details>
      ))}
    </>
  );
}
function AwayPrompt({
  timerId,
  lastSeen,
  onReview,
}: {
  timerId?: string;
  lastSeen?: string;
  onReview: () => void;
}) {
  const reviewed = useRef("");
  useEffect(() => {
    if (!timerId) return;
    const key = "study-away:" + timerId;
    const old = Number(
      localStorage.getItem(key) || Date.parse(lastSeen || iso()),
    );
    if (Date.now() - old > 15 * 60000 && reviewed.current !== timerId) {
      reviewed.current = timerId;
      onReview();
    }
    localStorage.setItem(key, String(Date.now()));
    const fn = () => {
      if (document.visibilityState === "visible") {
        const stamp = Number(localStorage.getItem(key) || Date.now());
        if (Date.now() - stamp > 15 * 60000) onReview();
      }
      localStorage.setItem(key, String(Date.now()));
    };
    const id = setInterval(() => {
      if (document.visibilityState === "visible")
        localStorage.setItem(key, String(Date.now()));
    }, 10000);
    document.addEventListener("visibilitychange", fn);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", fn);
    };
  }, [timerId]);
  return null;
}
