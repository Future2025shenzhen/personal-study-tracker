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
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("请求成功");
  expect(calls.some((c) => c.path === "/auth/v1/otp")).toBe(true);
  expect(calls.some((c) => c.path === "/auth/v1/signup")).toBe(false);
  await page.getByRole("button", { name: "输入验证码", exact: true }).click();
  await page.getByLabel("邮件验证码").fill("123456");
  await page.getByRole("button", { name: "继续", exact: true }).click();
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
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(
    page.getByText("无法打开学习账号：", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "个人学习记录", exact: true }),
  ).toBeVisible();
  expect(calls.some((c) => c.path === "/rest/v1/study_workspaces")).toBe(false);
});
