import { it, expect, vi, beforeEach } from "vitest";
import {
  mailRateSeconds,
  friendlyAuthError,
  mailWait,
  savePendingMail,
  readPendingMail,
  clearPendingMail,
  callbackIssue,
} from "../src/auth-feedback";
const map = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => map.set(key, value),
  removeItem: (key: string) => map.delete(key),
});
beforeEach(() => map.clear());
it("uses the exact remaining interval returned by Supabase, including the reported 25 seconds", () => {
  const error = {
    message:
      "For security purposes, you can only request this after 25 seconds.",
    status: 429,
    code: "over_email_send_rate_limit",
  };
  expect(mailRateSeconds(error)).toBe(25);
  expect(friendlyAuthError(error)).toContain("倒计时");
  expect(friendlyAuthError(error)).not.toContain("For security");
  expect(
    mailRateSeconds({ status: 429, message: "email rate limit exceeded" }),
  ).toBe(60);
  expect(
    friendlyAuthError({ status: 429, message: "email rate limit exceeded" }),
  ).toContain("不保证服务额度已恢复");
});
it("persists email and deadline across reload without counting background ticks or storing OTP/passwords", () => {
  savePendingMail({ email: "owner@example.net", resendAt: 26000, kind: "otp" });
  const restored = readPendingMail();
  expect(mailWait(restored, " OWNER@example.net ", 1000)).toBe(25);
  expect(mailWait(restored, "owner@example.net", 25999)).toBe(1);
  expect(mailWait(restored, "owner@example.net", 26000)).toBe(0);
  expect(mailWait(restored, "another@example.net", 1000)).toBe(0);
  expect(Object.keys(restored!)).toEqual(["email", "resendAt", "kind"]);
  clearPendingMail();
  expect(readPendingMail()).toBeNull();
});
it("handles broken local state and explains expired/cross-browser callbacks without exposing callback secrets", () => {
  map.set("study-auth-mail-v1", "bad-json");
  expect(readPendingMail()).toBeNull();
  const code = "SENSITIVE-EXAMPLE-CALLBACK";
  const issue = callbackIssue("?code=" + code, "");
  expect(issue).toContain("同");
  expect(issue).not.toContain(code);
  expect(
    callbackIssue(
      "",
      "#error=access_denied&error_code=otp_expired&error_description=Expired",
    ),
  ).toContain("过期");
  expect(
    callbackIssue("?error=access_denied&error_description=" + code, ""),
  ).not.toContain(code);
  expect(callbackIssue("", "#timer")).toBe("");
});
