import { test, expect, type Page } from "@playwright/test";
async function local(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "使用本机模式" }).click();
  await expect(
    page.getByRole("heading", { name: "首页", exact: true }),
  ).toBeVisible();
}
async function go(page: Page, route: string) {
  await page.goto("/#" + route);
}
test("real persistent timer, pause/reload/finish, history, recycle and restore", async ({
  page,
}) => {
  await local(page);
  await page.getByRole("button", { name: "Mathematics" }).click();
  await expect(
    page.getByRole("button", { name: "结束并保存", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "暂停", exact: true }).first().click();
  await page.reload();
  await expect(page.getByText("已暂停 · 休息时间不计入")).toBeVisible();
  await page
    .getByRole("textbox", { name: "学习备注" })
    .fill("Integration practice");
  await page.getByRole("button", { name: "继续", exact: true }).first().click();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "结束并保存", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "结束并保存" })).toBeVisible();
  await page.getByRole("button", { name: "确认保存" }).click();
  await go(page, "history");
  await expect(page.getByText("Integration practice")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Integration practice")).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("Integration practice")).not.toBeVisible();
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await page.getByRole("button", { name: "恢复记录" }).click();
  await page.getByRole("button", { name: "返回历史" }).click();
  await expect(page.getByText("Integration practice")).toBeVisible();
});
test("flexible manual entry, edits recalculate statistics, recurring todo and undo", async ({
  page,
}) => {
  await local(page);
  await page.getByRole("button", { name: "补录学习" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("spinbutton", { name: "有效学习时长" }).fill("90");
  await modal.getByLabel("备注").fill("Reading chapter");
  await modal.getByRole("button", { name: "保存记录" }).click();
  await expect(page.locator(".big-number")).toHaveText("1.5 h");
  await go(page, "history");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("spinbutton", { name: "有效学习时长" })
    .fill("60");
  await page.getByRole("button", { name: "保存记录" }).click();
  await go(page, "statistics");
  await expect(
    page.locator(".metrics").getByText("1.0 h").first(),
  ).toBeVisible();
  await go(page, "tasks");
  await page.getByRole("button", { name: "添加待办" }).click();
  const task = page.getByRole("dialog");
  await task.getByLabel("要做什么").fill("Review mechanics");
  await task.getByText("科目、日期与重复").click();
  await task
    .getByLabel("科目", { exact: true })
    .selectOption({ label: "Physics" });
  await task.getByLabel("重复", { exact: true }).selectOption("daily");
  await task.getByRole("button", { name: "保存待办" }).click();
  await page
    .getByRole("button", { name: "完成 Review mechanics", exact: true })
    .click();
  const completed = page
    .locator(".task-group")
    .filter({ has: page.locator("summary", { hasText: "已完成" }) });
  await completed.locator("summary").click();
  await expect(
    page.getByRole("button", { name: "撤销完成 Review mechanics" }),
  ).toBeVisible();
  await expect(
    page.locator(".task-title").getByText("Review mechanics", { exact: true }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "撤销完成 Review mechanics" }).click();
  await expect(
    page.locator(".task-title").getByText("Review mechanics", { exact: true }),
  ).toHaveCount(1);
});
test("responsive navigation, themes, export/restore and direct hash routes", async ({
  page,
}, testInfo) => {
  await local(page);
  for (const route of ["timer", "history", "statistics", "tasks", "settings"]) {
    await go(page, route);
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByLabel("显示模式").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 JSON 备份" }).click();
  const download = await pending;
  await download.saveAs(testInfo.outputPath("backup.json"));
  const confirmed = page.waitForEvent("dialog").then((d) => d.accept());
  await page
    .locator("input[type=file]")
    .setInputFiles(testInfo.outputPath("backup.json"));
  await confirmed;
  await expect(page.locator("input[type=file]")).toHaveValue("");
  await expect(page.locator("[role=alert]")).toHaveCount(0);
  await go(page, "home");
  await page.screenshot({
    path: testInfo.outputPath("home.png"),
    fullPage: true,
  });
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "展开导航" }).click();
    await page.locator("nav").getByRole("link", { name: "计时器" }).click();
    await expect(
      page.getByRole("heading", { name: "计时器", exact: true }),
    ).toBeVisible();
  }
});
