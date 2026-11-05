// Simulated hosted responses; real SQL permissions are tested by test:username.
import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
const id = "00000000-0000-4000-8000-000000000050";
const namespace = "study-1234abcd.accounts.example.com";
const workspace = {
  schema: 1,
  subjects: [],
  sessions: [],
  tasks: [],
  goals: [],
  timer: null,
  settings: { theme: "system" },
};
const testPassword = "Example-Temporary-983!";
async function mock(page: Page, admin = false) {
  const state = {
    mustChange: admin,
    disabled: false,
    userStatus: "active",
    calls: [] as { path: string; body: any; authorization: string | null }[],
  };
  const email =
    createHash("sha256")
      .update(admin ? "kevinwang" : "student_01")
      .digest("hex") +
    "@" +
    namespace;
  const token = [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: id,
        email,
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
        session_id: "00000000-0000-4000-8000-000000000060",
      }),
    ).toString("base64url"),
    Buffer.from("contract-only").toString("base64url"),
  ].join(".");
  const user = {
    id,
    email,
    aud: "authenticated",
    role: "authenticated",
    created_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
  };
  await page.context().route("https://shared-study.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    try {
      body = route.request().postDataJSON();
    } catch {}
    state.calls.push({
      path,
      body,
      authorization: route.request().headers()["authorization"] || null,
    });
    let data: any = {},
      status = 200;
    if (path.endsWith("/study_public_account_mode"))
      data = { mode: "username", namespace, minimum_password_length: 12 };
    else if (path.endsWith("/signup") || path.endsWith("/token"))
      data = {
        access_token: token,
        refresh_token: "contract-refresh",
        expires_in: 3600,
        token_type: "bearer",
        // Some hosted Auth versions echo the original signup metadata even
        // when a BEFORE INSERT trigger stripped the invitation in the DB.
        user: path.endsWith("/signup")
          ? { ...user, user_metadata: body?.data || {} }
          : user,
      };
    else if (path === "/auth/v1/user") {
      if (body?.password) state.mustChange = false;
      data = user;
    } else if (path.endsWith("/study_account_identity")) {
      if (state.disabled) {
        status = 403;
        data = { code: "42501", message: "账号已停用或删除，请联系管理员" };
      } else
        data = {
          username: admin ? "Kevinwang" : "Student_01",
          role: admin ? "admin" : "user",
          must_change_password: state.mustChange,
        };
    } else if (path === "/rest/v1/study_workspaces")
      data = { version: 1, document: workspace };
    else if (path.endsWith("/study_admin_users"))
      data = [
        {
          user_id: id,
          username: "Kevinwang",
          role: "admin",
          status: "active",
          created_at: new Date().toISOString(),
          last_login: null,
          last_logout: null,
        },
        {
          user_id: "00000000-0000-4000-8000-000000000070",
          username: "Other_Student",
          role: "user",
          status: state.userStatus,
          created_at: new Date().toISOString(),
          last_login: null,
          last_logout: null,
        },
      ];
    else if (path.endsWith("/study_admin_events")) data = [];
    else if (path.endsWith("/study_admin_manage")) {
      state.userStatus =
        body.action === "delete" ? "deleted" : state.userStatus;
    }
    await route.fulfill({
      status,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    });
  });
  return state;
}
async function login(page: Page, name = "Student_01") {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
}
test("username signup needs no email, persists session across reload and another tab, explicit logout clears it", async ({
  page,
  context,
}) => {
  const state = await mock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill("Student_01");
  await page.getByLabel("密码", { exact: true }).fill(testPassword);
  await page.getByLabel("确认密码", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "注册并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "首页", exact: true }),
  ).toBeVisible();
  const signup = state.calls.find((c) => c.path.endsWith("/signup"))!;
  expect(signup.body.email).toBe(
    createHash("sha256").update("student_01").digest("hex") + "@" + namespace,
  );
  expect(signup.body.data).toEqual({ study_username: "Student_01" });
  expect(state.calls.some((c) => c.path.endsWith("/otp"))).toBe(false);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    testPassword,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "首页", exact: true }),
  ).toBeVisible();
  const tab = await context.newPage();
  await tab.goto("/");
  await expect(
    tab.getByRole("heading", { name: "首页", exact: true }),
  ).toBeVisible();
  await tab.close();
  await page.goto("/#settings");
  await page
    .getByRole("button", { name: "退出并清除本机账号缓存", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "用户名登录", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      state.calls.some((c) => c.path.endsWith("/study_record_logout")),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => localStorage.getItem("study-tracker-auth-v1")),
  ).toBeNull();
  await page.reload();
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
});
test("admin invite, initial password rotation, protected backend and typed deletion confirmation", async ({
  page,
}) => {
  const state = await mock(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill("Kevinwang");
  await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute(
    "minlength",
    "8",
  );
  await expect(page.getByLabel("管理员邀请码")).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill(testPassword);
  await page.getByLabel("确认密码", { exact: true }).fill(testPassword);
  await page.getByLabel("管理员邀请码").fill("private-invitation-example");
  await page.getByRole("button", { name: "注册并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "设置新的管理员密码" }),
  ).toBeVisible();
  expect(state.calls.some((c) => c.path === "/rest/v1/study_workspaces")).toBe(
    false,
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "private-invitation-example",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "设置新的管理员密码" }),
  ).toBeVisible();
  await page
    .getByLabel("新密码", { exact: true })
    .fill("Replacement-Password-239!");
  await page
    .getByLabel("确认新密码", { exact: true })
    .fill("Replacement-Password-239!");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(
    page.getByRole("heading", { name: "首页", exact: true }),
  ).toBeVisible();
  await page.goto("/#admin");
  await expect(
    page.getByRole("heading", { name: "账号管理", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Other_Student · 用户" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "移入回收站", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "移入回收站", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "确认账号操作" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect
    .poll(() =>
      state.calls.some(
        (c) =>
          c.path.endsWith("/study_admin_manage") && c.body.action === "delete",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await page.getByLabel("完整用户名").fill("Other_Student");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect
    .poll(() =>
      state.calls.some(
        (c) =>
          c.path.endsWith("/study_admin_manage") &&
          c.body.action === "purge" &&
          c.body.confirmation === "Other_Student",
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("ordinary account has no admin menu and disabled existing session is locked on focus", async ({
  page,
}) => {
  const state = await mock(page);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "首页", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /管理后台/ })).toHaveCount(0);
  state.disabled = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("账号已停用或删除");
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "首页", exact: true }),
  ).toHaveCount(0);
});
