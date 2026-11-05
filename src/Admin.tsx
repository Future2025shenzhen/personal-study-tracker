import { useEffect, useRef, useState } from "react";
import { supabase } from "./storage";
import { accountError } from "./accounts";
type User = {
  user_id: string;
  username: string;
  role: string;
  status: string;
  created_at: string;
  last_login: string | null;
  last_logout: string | null;
};
type Event = { username: string; event: string; happened_at: string };
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "暂无服务端记录";
export default function Admin() {
  const [users, setUsers] = useState<User[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [eventPage, setEventPage] = useState(0),
    [target, setTarget] = useState<User | null>(null),
    [action, setAction] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (action) dialog.current?.showModal();
  }, [action]);
  useEffect(() => {
    let active = true;
    setError("");
    void Promise.all([
      supabase!.rpc("study_admin_users", { search: query, page }),
      supabase!.rpc("study_admin_events", {
        target: target?.user_id || null,
        page: eventPage,
      }),
    ]).then(([u, e]) => {
      if (!active) return;
      if (u.error || e.error) {
        setError(accountError(u.error || e.error));
        setUsers([]);
        setEvents([]);
      } else {
        setUsers(u.data || []);
        setEvents(e.data || []);
      }
    });
    return () => {
      active = false;
    };
  }, [query, page, eventPage, target, revision]);
  async function manage(confirmation: string) {
    if (!target || busy) return;
    setBusy(true);
    setError("");
    const { error } = await supabase!.rpc("study_admin_manage", {
      target: target.user_id,
      action,
      confirmation,
    });
    setBusy(false);
    if (error) {
      setError(accountError(error));
      return;
    }
    dialog.current?.close();
    setAction("");
    setRevision((v) => v + 1);
  }
  return (
    <section>
      <h2>账号管理</h2>
      <p>
        仅管理学习记录网站的用户名账号。数学题库账号与原有邮箱账号不在此列表中。
      </p>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setQuery(search);
          setRevision((v) => v + 1);
        }}
      >
        <label>
          搜索用户名
          <input
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button>搜索 / 刷新</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <div className="admin-users">
        {users.map((u) => (
          <article className="card" key={u.user_id}>
            <h3>
              {u.username} · {u.role === "admin" ? "管理员" : "用户"}
            </h3>
            <p>
              状态：
              {
                { active: "正常", disabled: "已停用", deleted: "回收站" }[
                  u.status
                ]
              }
            </p>
            <p>
              注册：{date(u.created_at)}
              <br />
              最近登录：{date(u.last_login)}
              <br />
              最近退出：{date(u.last_logout)}
            </p>
            <div className="actions">
              <button
                onClick={() => {
                  setTarget(u);
                  setEventPage(0);
                }}
              >
                查看登录与退出记录
              </button>
              {u.role !== "admin" &&
                (u.status === "deleted" ? (
                  <>
                    <button
                      onClick={() => {
                        setTarget(u);
                        setAction("restore");
                      }}
                    >
                      恢复账号
                    </button>
                    <button
                      onClick={() => {
                        setTarget(u);
                        setAction("purge");
                      }}
                    >
                      永久删除
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setTarget(u);
                        setAction(u.status === "active" ? "disable" : "enable");
                      }}
                    >
                      {u.status === "active" ? "停用账号" : "启用账号"}
                    </button>
                    <button
                      onClick={() => {
                        setTarget(u);
                        setAction("delete");
                      }}
                    >
                      移入回收站
                    </button>
                  </>
                ))}
            </div>
          </article>
        ))}
      </div>
      <div className="actions">
        <button disabled={page === 0} onClick={() => setPage((v) => v - 1)}>
          上一页账号
        </button>
        <span>第 {page + 1} 页</span>
        <button
          disabled={users.length < 25}
          onClick={() => setPage((v) => v + 1)}
        >
          下一页账号
        </button>
      </div>
      <h2>登录与退出记录{target ? " · " + target.username : ""}</h2>
      <p>
        显示最近 180
        天的服务端记录。关闭网页不等于退出；同一账号可有多个登录设备。Auth
        未保存审计时，退出时间可能为空。
      </p>
      {target && (
        <button
          onClick={() => {
            setTarget(null);
            setEventPage(0);
          }}
        >
          查看所有用户记录
        </button>
      )}
      {events.map((e, i) => (
        <p key={i}>
          {date(e.happened_at)}　{e.username}　
          {{
            login: "登录",
            logout: "退出",
            user_signedup: "注册",
            logout_requested: "请求退出",
          }[e.event] || e.event}
        </p>
      ))}
      {!events.length && <p>暂无记录。</p>}
      <div className="actions">
        <button
          disabled={eventPage === 0}
          onClick={() => setEventPage((v) => v - 1)}
        >
          上一页记录
        </button>
        <button
          disabled={events.length < 50}
          onClick={() => setEventPage((v) => v + 1)}
        >
          下一页记录
        </button>
      </div>
      {action && (
        <dialog
          ref={dialog}
          onCancel={() => setAction("")}
          aria-label="确认账号操作"
        >
          <h2>确认操作：{target?.username}</h2>
          <p>
            {action === "purge"
              ? "将永久删除该账号及其云端学习记录，无法恢复。请输入完整用户名确认。"
              : action === "delete"
                ? "账号将移入回收站并失去访问权限，学习记录保留，可恢复。"
                : action === "disable"
                  ? "停用后，该账号现有会话也无法访问云端学习记录。"
                  : "确认恢复该账号的访问权限。"}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void manage(
                String(new FormData(e.currentTarget).get("confirmation") || ""),
              );
            }}
          >
            {action === "purge" && (
              <label>
                完整用户名
                <input name="confirmation" required autoComplete="off" />
              </label>
            )}
            <button disabled={busy}>确认{busy ? "处理中…" : ""}</button>
            <button type="button" disabled={busy} onClick={() => setAction("")}>
              取消
            </button>
          </form>
        </dialog>
      )}
    </section>
  );
}
