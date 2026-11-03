import { useRef, useState, useEffect, type FormEvent } from "react";
import { configured, sharedBackend, supabase } from "./storage";
import {
  cleanEmail,
  readPendingMail,
  savePendingMail,
  clearPendingMail,
  mailWait,
  mailRateSeconds,
  friendlyAuthError,
  type PendingMail,
} from "./auth-feedback";
export default function Auth({ local }: { local: () => void }) {
  const initial = useRef(readPendingMail()).current;
  const [mode, setMode] = useState(
    initial?.kind === "otp" ? "verify" : sharedBackend ? "otp" : "password",
  );
  const [email, setEmail] = useState(initial?.email || ""),
    [request, setRequest] = useState<PendingMail | null>(initial),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  const emailInput = useRef<HTMLInputElement>(null),
    inFlight = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const wait = mailWait(request, email, now);
  const isMailMode = mode === "otp" || mode === "reset" || mode === "register";
  function remember(kind: PendingMail["kind"], seconds: number) {
    const value = {
      email: cleanEmail(email),
      kind,
      resendAt: Date.now() + seconds * 1000,
    };
    savePendingMail(value);
    setRequest(value);
    setNow(Date.now());
  }
  async function send(kind: PendingMail["kind"], password?: string) {
    if (!supabase || inFlight.current) return;
    if (!emailInput.current?.reportValidity()) return;
    if (mailWait(request, email) > 0) {
      setMessage("请等待倒计时结束再发送；已收到邮件可直接输入验证码。");
      return;
    }
    const address = cleanEmail(email);
    setEmail(address);
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const redirect = location.origin + location.pathname;
      const result =
        kind === "reset"
          ? await supabase.auth.resetPasswordForEmail(address, {
              redirectTo: redirect + "?reset=1",
            })
          : kind === "register" && !sharedBackend
            ? await supabase.auth.signUp({
                email: address,
                password: password || "",
                options: { emailRedirectTo: redirect },
              })
            : await supabase.auth.signInWithOtp({
                email: address,
                options: { emailRedirectTo: redirect, shouldCreateUser: true },
              });
      if (result.error) throw result.error;
      remember(kind === "register" && sharedBackend ? "otp" : kind, 60);
      if (kind === "otp" || (kind === "register" && sharedBackend)) {
        setMode("verify");
        setMessage(
          "登录邮件已请求发送。请查看收件箱和垃圾邮件；有数字验证码可在下方输入。若只有链接，请查看下方帮助。",
        );
      } else
        setMessage(
          kind === "reset"
            ? "重置密码邮件已请求发送。请在发起请求的同一浏览器打开邮件链接。"
            : "注册请求已提交，请查看邮箱完成验证。",
        );
    } catch (e) {
      const seconds = mailRateSeconds(e);
      if (seconds) {
        remember(kind === "register" && sharedBackend ? "otp" : kind, seconds);
        if (kind === "otp" || (kind === "register" && sharedBackend))
          setMode("verify");
      }
      setMessage(friendlyAuthError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase || inFlight.current) return;
    const data = new FormData(e.currentTarget);
    if (isMailMode) {
      await send(
        mode === "reset" ? "reset" : mode === "register" ? "register" : "otp",
        String(data.get("password") || ""),
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const address = cleanEmail(email),
        token = String(data.get("token") || "").replace(/\s/g, "");
      if (mode === "verify" && !/^\d+$/.test(token))
        throw Error("请输入邮件中的数字验证码，不是登录链接。");
      const result =
        mode === "verify"
          ? await supabase.auth.verifyOtp({
              email: address,
              token,
              type: "email",
            })
          : await supabase.auth.signInWithPassword({
              email: address,
              password: String(data.get("password") || ""),
            });
      if (result.error) throw result.error;
      clearPendingMail();
      setRequest(null);
      setMessage("验证成功，正在打开学习记录…");
    } catch (e) {
      setMessage(friendlyAuthError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const label =
    mode === "password"
      ? "登录"
      : mode === "verify"
        ? "验证并登录"
        : mode === "reset"
          ? "发送重置邮件"
          : mode === "register" && !sharedBackend
            ? "创建账号"
            : "发送登录邮件";
  return (
    <div className="auth">
      <div className="brand">
        ◷ <span>学习记录</span>
      </div>
      <h1>个人学习记录</h1>
      <p className="muted">计时、待办与学习回顾</p>
      {configured ? (
        <>
          <div className="tabs">
            {[
              ["password", "密码登录"],
              ["otp", "邮箱登录"],
              ["verify", "输入验证码"],
              ["register", "注册"],
              ["reset", "找回密码"],
            ].map(([id, title]) => (
              <button
                key={id}
                className={mode === id ? "selected" : ""}
                disabled={busy}
                onClick={() => {
                  setMode(id);
                  setMessage("");
                }}
              >
                {title}
              </button>
            ))}
          </div>
          {sharedBackend && (
            <p className="small muted">
              首次使用请选择“邮箱登录”。验证后可在设置中设置网站密码；数学题库昵称账号保持独立。
            </p>
          )}
          <form onSubmit={submit}>
            <label>
              邮箱
              <input
                ref={emailInput}
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setMessage("");
                }}
              />
            </label>
            {(mode === "password" ||
              (mode === "register" && !sharedBackend)) && (
              <label>
                密码
                <input
                  name="password"
                  type="password"
                  required
                  minLength={mode === "register" ? 12 : 1}
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                />
              </label>
            )}
            {mode === "verify" && (
              <label>
                邮件验证码
                <input
                  name="token"
                  inputMode="numeric"
                  required
                  autoComplete="one-time-code"
                  placeholder="输入邮件中的数字，不要粘贴链接"
                />
              </label>
            )}
            <button
              className="primary"
              disabled={busy || (isMailMode && wait > 0)}
            >
              {busy
                ? "处理中…"
                : isMailMode && wait > 0
                  ? `等待 ${wait} 秒后重发`
                  : label}
            </button>
            {mode === "verify" && (
              <button
                type="button"
                disabled={busy || wait > 0}
                onClick={() => void send("otp")}
              >
                {wait > 0 ? `等待 ${wait} 秒后重发` : "重新发送登录邮件"}
              </button>
            )}
          </form>
          <p role="status">{message}</p>
          {["otp", "verify", "register"].includes(mode) && (
            <details className="auth-help">
              <summary>邮件里只有链接，或链接打不开？</summary>
              <p>
                数字验证码需要邮件模板启用。只有链接时，请在发起请求的同一浏览器打开；微信/邮箱内置浏览器与
                Safari、Chrome
                可能不共享登录状态。仍不能登录时，请联系维护者启用数字验证码。
              </p>
              <p>
                数字验证码可复制到原网页输入，不需要在手机里打开登录链接。反复发送可能触发邮件额度限制。
              </p>
            </details>
          )}
        </>
      ) : (
        <div className="notice">
          云端账号尚未配置。现在可以使用本机模式：记录真实保存于此浏览器，不会自动跨设备同步。清除浏览器数据前请导出备份。
        </div>
      )}
      <button className="text-button" onClick={local}>
        使用本机模式 →
      </button>
    </div>
  );
}
