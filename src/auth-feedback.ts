export type PendingMail = {
  email: string;
  resendAt: number;
  kind: "otp" | "reset" | "register";
};
const key = "study-auth-mail-v1";
export const cleanEmail = (value: string) => value.trim().toLowerCase();
export function mailWait(
  request: PendingMail | null,
  email: string,
  now = Date.now(),
) {
  return request && cleanEmail(request.email) === cleanEmail(email)
    ? Math.max(0, Math.ceil((request.resendAt - now) / 1000))
    : 0;
}
export function readPendingMail(): PendingMail | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value &&
      typeof value.email === "string" &&
      Number.isFinite(value.resendAt) &&
      ["otp", "reset", "register"].includes(value.kind)
      ? value
      : null;
  } catch {
    return null;
  }
}
// Only email and resend deadline are stored, NEVER passwords, OTPs or link tokens.
export function savePendingMail(value: PendingMail) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
export function clearPendingMail() {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
export function mailRateSeconds(error: unknown): number | null {
  const e = error as { message?: string; code?: string; status?: number };
  const message = e?.message || String(error);
  const match = message.match(/after\s+(\d+)\s+seconds?/i);
  if (match) return Math.max(1, Math.min(86400, Number(match[1])));
  return e?.status === 429 ||
    /rate.limit|over_email_send_rate_limit|over_request_rate_limit/i.test(
      message + " " + e?.code,
    )
    ? 60
    : null;
}
export function friendlyAuthError(error: unknown): string {
  const e = error as { message?: string; code?: string; status?: number };
  const message = e?.message || String(error),
    code = e?.code || "";
  if (/after\s+\d+\s+seconds?/i.test(message))
    return "发送过于频繁，请等待倒计时结束。若已收到邮件，可以直接验证，不必重发。";
  if (mailRateSeconds(e) !== null)
    return "邮件服务暂时限制了发送次数，请稍后再试。倒计时结束也不保证服务额度已恢复，不要连续请求。";
  if (
    /invalid_credentials/.test(code) ||
    /invalid login credentials/i.test(message)
  )
    return "邮箱或密码不正确。首次使用请先通过“邮箱登录”验证，再到设置中设置网站密码。";
  if (
    /otp_expired/.test(code) ||
    /token.*expired|expired.*token|invalid.*otp/i.test(message)
  )
    return "验证码或邮件链接无效或已过期。请使用最新邮件中的验证码，必要时重新发送一次。";
  if (/pkce|code.verifier|flow.state/i.test(message))
    return "邮件链接无法在当前浏览器完成登录。请回到发起请求的浏览器，或输入邮件中的数字验证码。";
  if (/database error saving new user/i.test(message))
    return "数据库未能创建账号。请联系维护者检查共享后台安装，不要反复发送邮件。";
  if (
    /email_address_not_authorized|email.*not.*authorized/i.test(
      code + " " + message,
    )
  )
    return "邮件服务暂不允许向这个邮箱发送邮件，请联系维护者检查发信设置。";
  if (/weak_password/.test(code)) return "密码强度不足，请使用至少 12 个字符。";
  if (/fetch|network|load failed/i.test(message))
    return "暂时无法连接登录服务，请检查网络后再试。";
  if (message.startsWith("请输入邮件中的数字验证码")) return message;
  return "登录服务暂时无法处理请求，请稍后重试或联系维护者。";
}
export function callbackIssue(search: string, hash: string): string {
  const query = new URLSearchParams(search),
    fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const get = (k: string) => query.get(k) || fragment.get(k);
  if (get("error") || get("error_description"))
    return friendlyAuthError({
      message: get("error_description") || get("error") || "",
      code: get("error_code") || "",
    });
  if (query.has("code"))
    return "邮件链接没有完成登录。请用发起请求的同一浏览器打开，或在本页输入邮件中的数字验证码；邮件/微信内置浏览器可能不共享登录状态。";
  return "";
}
export function clearCallbackParams() {
  const url = new URL(location.href);
  for (const k of ["code", "error", "error_code", "error_description"])
    url.searchParams.delete(k);
  if (new URLSearchParams(url.hash.replace(/^#/, "")).has("error"))
    url.hash = "";
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}
