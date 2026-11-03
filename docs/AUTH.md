# Auth 官方核对与上线验收

2026-11-02 通过 Supabase 官方仓库阅读了 passwords、auth-email-passwordless、auth-smtp、rate-limits 文档。本环境访问文档主站返回 403，因此使用同一官方项目的 Markdown 源码，不把无法访问主站误判为功能不可用。

- `signInWithPassword`：邮箱 + 密码；`signUp`：邮箱确认策略由 Dashboard 控制。
- `signInWithOtp` 名称虽然含 OTP，默认发送 Magic Link。需要在 Magic Link 模板加入 `{{ .Token }}` 才有可输入的验证码；验证使用 `verifyOtp({email,token,type:'email'})`。此实现用这两个 API，不臆造验证码服务。
- 密码恢复调用 `resetPasswordForEmail`；回跳 URL 与 PKCE 会话恢复后，提交 `updateUser({password})`。PKCE 邮件链接应在发起请求的同一浏览器打开；跨设备优先用输入式验证码。密码字段至少 12 字符，并应在 Supabase 服务端设置同样限制。
- session 由官方 JS 客户端持久化并自动续期。浏览器只使用 publishable / anon 公开配置，RLS 才是权限边界。
- 自带 SMTP 为测试用途，官方文档当前限制发送到项目团队成员邮箱，默认 2 封/小时。公开注册需配置自己的 SMTP，实际额度、冷却期、OTP 过期以项目 Dashboard 为准。
- 真实邮件投递、注册确认、密码登录、OTP 验证、找回密码、令牌续期和退出都尚未经过真实项目验收，不把本地 Postgres 测试写成已验证托管 Auth。

来源：

- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/rate-limits
- https://github.com/supabase/supabase/tree/master/apps/docs/content/guides/auth

用户已实测收到 Magic Link，数字验证码缺失的配置步骤和新 UI 行为见 [EMAIL_CODE_SETUP.md](EMAIL_CODE_SETUP.md)。实际数字投递仍待验收。

2026-11-04 当前控制台截图进一步确认：未配置 custom SMTP 时，模板正文和 Source 编辑被锁定。须先配置可用的 SMTP，再按 EMAIL_CODE_SETUP.md 追加 Token。此前直接切换 Source 的指导不适用于该页面；不能声称模板已保存或数字码已投递。
