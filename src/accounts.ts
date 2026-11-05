import { sharedBackend, supabase } from "./storage";
export type AccountMode = {
  mode: "username";
  namespace: string;
  minimum_password_length: number;
};
export type Identity = {
  username: string;
  role: "user" | "admin";
  must_change_password: boolean;
};
export async function accountMode(): Promise<AccountMode | null> {
  if (!supabase || !sharedBackend) return null;
  const { data, error } = await supabase.rpc("study_public_account_mode");
  return !error &&
    data?.mode === "username" &&
    /^study-[a-f0-9]+\.accounts\.example\.com$/.test(data.namespace)
    ? data
    : null;
}
export function cleanUsername(name: string) {
  const result = name.normalize("NFKC").trim();
  if (!/^[A-Za-z0-9_\u4e00-\u9fff]{2,24}$/.test(result))
    throw Error("用户名须为 2–24 个中文、英文字母、数字或下划线。");
  return result;
}
export async function usernameAddress(name: string, namespace: string) {
  const key = cleanUsername(name).toLowerCase();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return (
    Array.from(new Uint8Array(digest), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("") +
    "@" +
    namespace
  );
}
export function accountError(error: unknown) {
  const message = String((error as { message?: string })?.message || error);
  if (/invalid login credentials/i.test(message)) return "用户名或密码不正确。";
  if (/already registered|already exists|unique/i.test(message))
    return "该用户名已被使用，请换一个。";
  if (/same_password|different from the old/i.test(message))
    return "新密码必须与初始密码不同。";
  if (/rate|too many/i.test(message)) return "操作过于频繁，请稍后再试。";
  if (/password/i.test(message))
    return "密码不符合服务器要求，请检查长度或更换密码。";
  if (/database error/i.test(message))
    return "注册未完成。请检查用户名是否已使用；管理员还需填写有效的邀请码。";
  if (/fetch|network/i.test(message)) return "连接失败，请检查网络后重试。";
  return /[\u4e00-\u9fff]/.test(message)
    ? message
    : "操作失败，请稍后再试或联系管理员。";
}
