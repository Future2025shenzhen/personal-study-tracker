# 从现在到正式上线

你不需要先学编程。代码和数据库脚本已经准备好，以下涉及服务归属的步骤必须由你在自己账号里完成。不要把密码、数据库连接串或 service_role 密钥发到聊天。

## 现在能做什么

本机模式已经可以记录真实学习：选科目 → 开始 → 暂停/继续 → 结束确认 → 保存；再去历史、统计、日历和待办查看。默认没有假学习数据。数据只在当前浏览器，每周去设置下载 JSON 备份。清空浏览器、换设备、无痕模式都会影响本机数据。

## 第一步：创建自己的云数据库

1. 用自己的邮箱登录 [Supabase](https://supabase.com/dashboard)，创建一个**新项目**，例如 `personal-study-tracker`。不要使用数学题库的旧数据库。选择靠近使用地点的区域；在东莞的家庭和学校网络上仍需实际测访问。
2. 等项目准备好，打开 **SQL Editor**，新建查询，将 `supabase/migrations/001_workspace.sql` 全部复制进去执行一次。这一步建立账号隔离和安全写入接口。
3. 到项目的 **Connect / API Keys** 获取 Project URL 和 **publishable key**（旧版 anon key 亦可）。这是前端公开配置，可以交给我继续配置。不要选 secret / service_role。
4. 开启 Email Provider；设置最小密码长度 12。保留邮箱确认功能。
5. Email Templates 的 **Magic Link** 模板需包含 `{{ .Token }}`，才能使用页面的“输入验证码”。例如 `<p>你的学习记录登录验证码：{{ .Token }}</p>`。注册确认、密码恢复模板保留各自官方链接模板。
6. 正式使用前配置自己的 SMTP 发信服务。Supabase 自带的邮件发送只适合测试，官方目前说明只向项目团队成员邮箱发送，默认每小时 2 封；不能据此承诺所有同学都能注册。SMTP 服务需要你自己的账号及可能的域名验证，费用以服务商为准。请在 Supabase 控制台安全填写凭据。

## 第二步：创建独立网站仓库并发布

1. 在自己的 GitHub 创建新仓库，例如 `personal-study-tracker`，不要覆盖 `pure-maths-library`。
2. 上传本项目源码和 `package-lock.json`；不要上传 `.env.local`、`node_modules`、数据库密码。已提供自动部署工作流。
3. Repository → Settings → Secrets and variables → Actions → **Variables** 添加 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。两项都是公开配置，不是数据库私钥。
4. Settings → Pages → Source 选择 **GitHub Actions**。把源码推到 `main`，等待 “Test and publish Study Tracker” 全部变绿。实际地址由 Pages 面板显示，通常形如 `https://你的用户名.github.io/personal-study-tracker/`；这只是格式示例，不是已部署网址。
5. 将实际网站地址填入 Supabase Authentication → URL Configuration 的 **Site URL**；Redirect URLs 添加实际站点根路径及该路径带 `?reset=1` 的地址。保留尾部 `/`。开发时若需调试，另外添加开发地址，不要随意允许不受控域名。
6. 用网站注册自己的邮箱账号；在设置里从 JSON 导入之前的本机备份。首次云端工作区有自己的默认科目 ID；导入按 ID 合并，不会凭相同科目名猜测合并关系，因此可能出现同名科目。可将空的默认科目归档。

## 第三步：正式使用前一起验收

- 邮箱密码注册、确认、登录，验证码发送和验证，忘记密码 → 邮件 → 新密码，退出后重新登录。
- 电脑开始，手机看到同一个计时器并暂停；两台同时开始/结束不产生两条；刷新与锁屏回来核对时长。
- 暂时断网后修改已有计时备注和待办，重开后保留；恢复网络成功同步。两个设备离线冲突要能看到选择提示，先下载备份。
- 用两个真实账号确认数据互相隔离。代码里自动跑过 RLS 测试，但你的真实项目也须确认迁移已经执行。
- iPhone/iPad Safari、Android、桌面检查表单、弹窗、深浅色、路由刷新；中国大陆的家庭/学校网络都应实际测试。
- 下载 JSON，另一个空测试工作区导入，确认会话、任务、目标和删除恢复一致。随后再决定启用加密定时备份。

**最少的下一步：创建 Supabase 项目与 GitHub 新仓库后，把公开 Project URL、publishable key 和新仓库地址提供给我。** 我可以继续处理接入与发布验证。你不用发送任何私密密码。若当前工具无法取得 GitHub 写权限，我会明确说明需要你上传源码或连接相应账号，不会要求你在聊天贴访问令牌。

## 费用边界

GitHub Pages 对符合其规则的仓库可提供静态托管；Supabase、邮件发送和 GitHub Actions/制品存储都有套餐、配额及规则。当前代码不含付费 SDK，但服务并非无限免费。自动云备份默认未启用，详见 BACKUPS.md；付费前以自己的服务控制台为准。
