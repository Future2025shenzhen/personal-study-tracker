import { useEffect, useState, type FormEvent } from "react";
import EmailAuth from "./Auth";
import {
  accountMode,
  cleanUsername,
  usernameAddress,
  accountError,
  type AccountMode,
} from "./accounts";
import {
  supabase,
  signOutStudyAccount,
  registerStudyUsername,
} from "./storage";
export default function UsernameAuth({ local }: { local: () => void }) {
  const [mode, setMode] = useState<AccountMode | null>(null),
    [ready, setReady] = useState(false),
    [legacy, setLegacy] = useState(false);
  const [register, setRegister] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void accountMode().then((m) => {
      setMode(m);
      setReady(true);
    });
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase || !mode || busy) return;
    const form = e.currentTarget,
      f = new FormData(form),
      password = String(f.get("password") || "");
    setBusy(true);
    setError("");
    try {
      const username = cleanUsername(name),
        email = await usernameAddress(username, mode.namespace);
      if (register && password !== f.get("confirm"))
        throw Error("两次输入的密码不一致。");
      const result = register
        ? await registerStudyUsername(email, password, {
            study_username: username,
            ...(f.get("invite")
              ? { study_invite: String(f.get("invite")) }
              : {}),
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (!result.data.session)
        throw Error(
          "账号未能直接登录，请项目所有者检查共享项目的邮箱确认设置。",
        );
      form.reset();
    } catch (err) {
      setError(accountError(err));
    } finally {
      setBusy(false);
    }
  }
  if (!ready) return <main className="auth">正在连接账号服务…</main>;
  if (!mode || legacy)
    return (
      <>
        <EmailAuth local={local} />
        {mode && (
          <button onClick={() => setLegacy(false)}>返回用户名登录</button>
        )}
      </>
    );
  const admin = ["kevinwang", "jackwang"].includes(
    name.normalize("NFKC").trim().toLowerCase(),
  );
  return (
    <main className="auth">
      <a className="brand" href="#home">
        ◷ 学习记录
      </a>
      <h1>个人学习记录</h1>
      <p className="muted">计时、待办与学习回顾</p>
      <div className="tabs">
        <button
          aria-pressed={!register}
          onClick={() => {
            setRegister(false);
            setError("");
          }}
        >
          用户名登录
        </button>
        <button
          aria-pressed={register}
          onClick={() => {
            setRegister(true);
            setError("");
          }}
        >
          注册账号
        </button>
      </div>
      <form onSubmit={submit}>
        <label>
          用户名
          <input
            name="username"
            autoComplete="username"
            required
            maxLength={48}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {register && (
          <p className="muted">
            2–24
            个中文、英文字母、数字或下划线；英文字母不区分大小写。无需邮箱验证码。
          </p>
        )}
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            minLength={register ? (admin ? 8 : 6) : 1}
            maxLength={128}
          />
        </label>
        {register && (
          <>
            <label>
              确认密码
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={admin ? 8 : 6}
                maxLength={128}
              />
            </label>
            <p>
              {admin
                ? "管理员初始密码至少 8 位，首次登录后须改为至少 12 位的新密码。"
                : "密码至少 6 位。"}
              用户名账号没有邮箱找回功能，请妥善保管密码。
            </p>
          </>
        )}
        {register && admin && (
          <label>
            管理员邀请码
            <input name="invite" type="password" autoComplete="off" required />
            <small>
              仅项目所有者可在 Supabase 生成；每个邀请码只能使用一次。
            </small>
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "处理中…" : register ? "注册并登录" : "登录"}
        </button>
      </form>
      <p className="muted">
        此浏览器会保持登录。共用设备使用后请在设置中退出；清除浏览器数据或会话失效后需重新登录。
      </p>
      <button onClick={() => setLegacy(true)}>已有邮箱账号登录</button>
      <button onClick={local}>使用本机模式 →</button>
    </main>
  );
}
export function InitialPassword({ done }: { done: () => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="auth">
      <h1>设置新的管理员密码</h1>
      <p>首次使用请更换初始密码，完成后即可进入后台。</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!supabase || busy) return;
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const password = String(f.get("password"));
            if (password !== f.get("confirm"))
              throw Error("两次输入的密码不一致。");
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            done();
          } catch (err) {
            setError(accountError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          新密码
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <label>
          确认新密码
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          保存新密码
        </button>
      </form>
      <button
        onClick={() =>
          void signOutStudyAccount().catch((err) => setError(accountError(err)))
        }
      >
        退出登录
      </button>
    </main>
  );
}
