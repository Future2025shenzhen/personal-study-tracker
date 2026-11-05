> **当前方案已更新：新注册无需邮箱验证码。** 请先按 [用户名账号设置](USERNAME_ACCOUNTS.md) 升级。下文邮件步骤仅供原有邮箱账号使用；无需为新用户名账号配置 SMTP。

# 邮件只有链接、没有数字验证码：最少配置步骤

Supabase 的 `signInWithOtp` 默认发送 Magic Link。接口叫 OTP 不代表邮件正文自动包含数字；官方要求在 Magic Link 模板里使用 `{{ .Token }}`。之前网站把这一步未配置的模板也描述为“接收验证码”，造成误导，现已修正网站说明。

## 先确认 SMTP 前提（用户当前页面的限制）

2026-11-04 用户截图显示：`Set up custom SMTP to edit templates`、`Emails will be sent using the default templates. Set up custom SMTP to edit their subject and body.`，Source 灰色。这是邮件服务配置限制，不能靠继续找 Source、改前端或重跑 SQL 解锁。

本项目必须先配置可用的自定义 SMTP，才可按下面步骤编辑数字码模板。先不要升级付费或保存空 SMTP 字段。可以检查所有者现有 126 邮箱是否允许 SMTP/客户端授权，若支持，再取得专用授权码并在 Supabase 安全填写；不索要邮箱密码或授权码，不让用户在聊天、截图、GitHub、VITE 配置或前端环境中暴露这些秘密。

Supabase 官方文档确认支持符合 SMTP 协议的服务，并需要 host、port、username、password、From 地址。此执行环境无法访问网易官方帮助（代理 CONNECT 403），因此尚未核实该具体 126 账号能否开通、实际服务端设置、限额、费用及跨境投递。不要把常见参数或“个人邮箱免费”当作该账号已验证结果。先按用户真实邮箱设置界面确认，不创建新付费服务。

## SMTP 成功配置后，项目所有者需要执行一次

1. 确认自定义 SMTP 已成功配置并且模板编辑框已可用，再进入 maths Library 的 Authentication → Emails / Email Templates → Magic Link：
   https://supabase.com/dashboard/project/tftetbicqcnhinnldsln/auth/templates/magic-link-or-otp
2. **保留现有邮件正文和链接**，在正文的段落之间追加：

   ```html
   <p>登录验证码：<strong>{{ .Token }}</strong></p>
   ```

3. 保存。不要更改 Site URL、Confirm email、数据库函数、SMTP 凭据或其他模板。
4. 等网站倒计时结束后，仅发送一封新登录邮件；已收到的旧邮件内容不会改变。新邮件中有数字后，复制数字到原网页，不需要在手机邮件/微信内置浏览器里打开链接。

如果模板页面与上述菜单不同，可以提供不含验证码或登录链接的模板设置界面截图；不要发送完整邮件或任何管理密钥。

## 为何链接打开还是登录页

当前网页采用 Supabase PKCE。发起请求的浏览器保存一个校验状态；微信、手机邮件内置浏览器、Safari、Chrome、另一台设备之间可能不共享它。官方 JS 客户端在 URL 有 code 但本机没有对应 verifier 时，可能只恢复为空会话而不自动报错。因此不能保证在邮件里点击后能换设备直接登录。

网站现对“有回跳 code 但没有会话”显示中文恢复指导，并清理地址里的未使用回跳参数，不记录或回显其内容。推荐直接输入数字验证码，支持从手机收邮件后到电脑原网页输入。

## 重发与额度

- 网站成功请求邮件后默认保留 60 秒重发间隔；服务器返回具体间隔（例如用户截图 25 秒）时，以该间隔显示倒计时。
- 在当前标签页刷新后保留邮箱和截止时间，倒计时使用时间戳，锁屏不靠后台 tick 累加。等待重发不妨碍输入已收到的验证码。
- 只在 sessionStorage 保存邮箱、重发截止时间与请求类型，不保存密码、验证码或邮件链接。完成验证后清理此记录。
- 项目发信额度、IP 限流和后台配置仍由 Supabase 控制。倒计时结束不是承诺额度恢复。若提示达到发送额度，停止连续请求，检查套餐/发信服务后再试。
- `{{ .Token }}` 只改变邮件内容，不会提升免费邮件额度，也不会修复未配置的 SMTP 或项目团队成员收件限制。

## 验证范围

真实邮件已由用户报告收到（内容只有链接）；真实数字验证码投递和首次成功登录仍待模板保存后的新邮件验证。前端使用模拟 Supabase 响应，覆盖成功发送后自动进入验证码步骤、邮箱保留、25 秒限流与刷新恢复、验证码验证期间不被重发倒计时阻止、缺少原浏览器状态的链接提示、拒绝读取未授权数据，以及桌面/手机布局。不把这些模拟响应测试说成已验证托管邮件。

官方资料（2026-11-04 从 Supabase 官方仓库重新核对）：

- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/auth-email-passwordless.mdx

原数学仓库未改动；共享项目模板只有所有者在控制台追加，当前执行环境没有权限代为保存该设置。
