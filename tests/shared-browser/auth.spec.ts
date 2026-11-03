// UI/API contract tests with simulated Supabase responses. Real shared SQL is
// independently tested in test-shared.mjs. This is NOT hosted Auth verification.
import { test, expect, type Page } from "@playwright/test";
const id = "00000000-0000-4000-8000-000000000002";
const email = "owner@example.net";
const workspace = {
  schema: 1,
  subjects: [],
  sessions: [],
  tasks: [],
  goals: [],
  timer: null,
  settings: { theme: "system" },
};
const jwt = () =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: id,
        role: "authenticated",
        aud: "authenticated",
        email,
        exp: Math.floor(Date.now() / 1000) + 3600,
        amr: [{ method: "otp" }],
      }),
    ).toString("base64url"),
    "simulation-only",
  ].join(".");
async function backend(page: Page, deny = false) {
  const calls: { path: string; body: any }[] = [];
  await page.route("https://shared-study.test/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let body;
    try {
      body = req.postDataJSON();
    } catch {}
    calls.push({ path, body });
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "content-type": "application/json",
    };
    let status = 200,
      data: any = {};
    if (path === "/auth/v1/verify") {
      data = {
        access_token: jwt(),
        refresh_token: "test-refresh",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id,
          email,
          aud: "authenticated",
          role: "authenticated",
          created_at: new Date().toISOString(),
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
        },
      };
    } else if (path === "/rest/v1/rpc/study_authorize_email") {
      status = deny ? 403 : 200;
      data = deny
        ? {
            code: "42501",
            message: "首次使用请先通过邮箱验证码或邮件登录链接验证",
          }
        : true;
    } else if (path === "/rest/v1/study_workspaces")
      data = { version: 1, document: workspace };
    await route.fulfill({ status, headers, body: JSON.stringify(data) });
  });
  return calls;
}
test("shared registration sends OTP, stores auth separately, authorizes before opening cloud workspace", async ({
  page,
}) => {
  const calls = await backend(page);
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByLabel("密码", { exact: true })).toHaveCount(0);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "发送登录邮件", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("登录邮件已请求发送");
  expect(calls.some((c) => c.path === "/auth/v1/otp")).toBe(true);
  expect(calls.some((c) => c.path === "/auth/v1/signup")).toBe(false);
  await expect(page.getByLabel("邮件验证码")).toBeVisible();
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(email);
  await expect(
    page.getByRole("button", { name: "验证并登录", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("邮件验证码").fill("123456");
  await page.getByRole("button", { name: "验证并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "首页", exact: true }),
  ).toBeVisible();
  expect(
    calls.findIndex((c) => c.path === "/rest/v1/rpc/study_authorize_email"),
  ).toBeLessThan(
    calls.findIndex((c) => c.path === "/rest/v1/study_workspaces"),
  );
  expect(
    await page.evaluate(() => !!localStorage.getItem("study-tracker-auth-v1")),
  ).toBe(true);
  expect(
    await page.evaluate(() => localStorage.getItem("pure-account-session-v1")),
  ).toBeNull();
});
test("server verification refusal leaves login visible and does not load cloud records", async ({
  page,
}) => {
  const calls = await backend(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "输入验证码", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("邮件验证码").fill("123456");
  await page.getByRole("button", { name: "验证并登录", exact: true }).click();
  await expect(
    page.getByText("无法打开学习账号：", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "个人学习记录", exact: true }),
  ).toBeVisible();
  expect(calls.some((c) => c.path === "/rest/v1/study_workspaces")).toBe(false);
});

test("25-second server cooldown is Chinese, blocks duplicate mail requests, survives reload and keeps email", async ({
  page,
}) => {
  await page.clock.install();
  const calls = await backend(page);
  await page.route("https://shared-study.test/auth/v1/otp**", async (route) => {
    calls.push({ path: "/auth/v1/otp", body: route.request().postDataJSON() });
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        code: "over_email_send_rate_limit",
        msg: "For security purposes, you can only request this after 25 seconds.",
      }),
    });
  });
  await page.goto("/");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "发送登录邮件", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("倒计时");
  await expect(
    page.getByRole("button", { name: /等待 \d+ 秒后重发/ }),
  ).toBeDisabled();
  await expect(page.getByLabel("邮件验证码")).toBeVisible();
  expect(calls.filter((c) => c.path === "/auth/v1/otp")).toHaveLength(1);
  await page.reload();
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("邮件验证码")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /等待 \d+ 秒后重发/ }),
  ).toBeDisabled();
  expect(calls.filter((c) => c.path === "/auth/v1/otp")).toHaveLength(1);
  // Advance browser time past the persisted deadline; this does not mock away the server guard.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.clock.fastForward(26000);
  await expect(
    page.getByRole("button", { name: "重新发送登录邮件", exact: true }),
  ).toBeEnabled();
});
test("a callback opened without its originating browser shows recovery guidance instead of silently returning to login", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("study-local-mode", "1"));
  await backend(page);
  await page.goto("/?code=simulation-callback-never-share");
  await expect(page.getByRole("alert")).toContainText("同");
  await expect(
    page.getByRole("heading", { name: "个人学习记录", exact: true }),
  ).toBeVisible();
  expect(page.url()).not.toContain("simulation-callback-never-share");
  await page.getByText("邮件里只有链接，或链接打不开？").click();
  await expect(
    page.getByText("数字验证码需要邮件模板启用。", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "使用本机模式" }).click();
  await expect(
    page.getByRole("heading", { name: "首页", exact: true }),
  ).toBeVisible();
});
