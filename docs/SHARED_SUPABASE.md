# 共用 maths Library 后台 · 2026-11-03

用户反馈的首次只读检查为 `false / true / false / 0`。随后提供了线上 `pp_new_user()` 完整导出；已核对其 SQL token（保留字符串内容）与仓库版完全相同，差别仅排版。脚本现仅精确接受这两个已审查函数体；不会删除全部空白后接受任意变体。原函数仍不改写。该导出副本为 `tests/fixtures/math-pp-new-user-export.sql`。

当前方案已由用户授权：学习网站使用独立源码、GitHub 仓库与网址，后台共用 maths Library 的 Supabase。sixsigma 不使用、不修改。此前的新建第三个项目和 Appwrite 候选方案暂不执行。

**用户已通过截图反馈共享安装脚本返回 Success。云环境对该 Supabase 主机和 GitHub API 的请求仍被网络规则拦截，因此尚未独立复查真实数据库权限、尚未测试邮件投递，也尚未上线新网站。** 不需要新的管理令牌，不要在聊天发送数据库密码或 service_role 密钥。

## 安装前只读检查（已完成）

1. Supabase Dashboard 打开 **maths Library**。
2. 左侧打开 **SQL Editor**，点 **New query / 新建查询**。
3. 打开 `supabase/shared/00_check_math_library.sql`，复制全部内容到查询框，点 **Run**。
4. 把底部结果截图发给维护者。检查不返回邮箱、昵称或用户记录，也不修改任何数据。

正常预期是一行：`math_validator_matches=true`、`math_trigger_matches=true`、`study_already_installed=false`、`other_insert_triggers=0`。不符合就停在这里，不能靠关闭触发器、删除原表或修改检查条件来强行通过。严格源码匹配可能因无害的格式差异拒绝；应先检查实际定义，不可直接绕过。

## 检查后才执行安装

确认真实项目检查与预期一致，先保存现有数学题库的重要数据备份（数学网站有个人记录导出；全项目备份由项目所有者控制）。确认现有 Auth 仅使用 Email provider；本方案按数学网站当前的邮箱/昵称实现测试，不把手机 OTP/OAuth 当作已验证的兼容路径。若已启用其他认证方式，先告知维护者进行额外审查。

之后在 SQL Editor 新查询执行 **`supabase/shared/01_install_shared.sql` 整份**，不要拆段。该脚本在一个事务内完成：

- 再次验证原昵称注册函数的完整源码和触发器，发现未知 INSERT 触发器或同名学习对象即停止。
- 保存原触发器定义；不改写 `pp_new_user()`。保留该原校验器处理 `@accounts.example.com` 身份和携带 nickname 字段的注册；普通邮箱不再被数学专用校验拦截。
- 新增 `study_workspaces`、`study_operations`、`study_verified_emails`，以及仅管理员可见的 `study_shared_installation` 回退记录。
- 不更新或删除任何 `pp_*` 题库资料、收藏、已做、管理员或历史用户数据。数学题库的昵称和密码规则继续使用。
- 学习数据仍逐用户 RLS 隔离；共享 Auth 不等于允许彼此读数据。未通过学习网站首次邮箱验证的数学昵称账号不能访问学习表。

安装不是可随意重复运行的脚本：再次执行会在修改前停止，避免覆盖学习数据。若已经安装，请索取升级或诊断脚本。

## 登录如何兼容

数学题库依赖全局 **Confirm email 关闭**。**不要打开它，不要更改旧网站的 Site URL、密码规则、SMTP 凭据或其他现有设置。**

学习网站首次注册改为发送邮箱 OTP / 邮件登录链接。登录后服务端根据 Supabase 签名 JWT 的 `amr: otp`、实际账号邮箱匹配建立独立的邮箱验证登记，之后允许同一账号通过密码登录。可在学习网站设置页设置密码。单纯绕过前端直接调用 password signup，或修改可编辑的 `user_metadata.email_verified`，均不能得到学习数据权限。

源码核对：Supabase Auth 官方 `internal/api/verify.go` 在邮箱验证码/魔法链接验证后调用 `issueRefreshToken(..., models.OTP, ...)`。本方案没有把全局自动确认的 email_confirmed_at 当作实际收件箱验证。此签名 AMR 规则按 Email provider 验证；上线仍须真实邮箱验证并复查 JWT 行为，不能用测试里手工生成的 claims 冒充真实投递。

浏览器会话分别保存：数学题库为 `pure-account-session-v1`，学习网站为 `study-tracker-auth-v1`。不自动登录到另一个网站，不合并两站用户 ID。Supabase 管理员仍可管理整个共享 Auth；两站共享发信、数据库和存储配额。

## 配置前端与邮件

新前端使用 `.env.maths-library.example`（其中只有现有公开数学网站的 URL/public key），以及 `VITE_SUPABASE_SHARED_BACKEND=true`。只有安装后才启用。不要把公开 key 误换成服务端私钥。

生产配置已放入可提交的 `.env.production`，只有公开 Project URL、公开 publishable key 与 shared 模式开关，普通 `npm run build` 和 GitHub Actions 自动构建均会读取。无需再让用户找安全凭据或手动填三个变量。本机开发仍可不配置云端，使用本机模式；需开发联调时复制公开配置到被忽略的 `.env.local`。当前独立 GitHub 远程仓库尚未创建。

邮件设置是共享的：保留原 Site URL，只在 Redirect URLs **追加**新网站根地址和密码恢复地址（带 `?reset=1`），不替换或删除旧地址。若默认 Magic Link 模板只含链接，可保留原模板并在学习网站用邮件链接验证；要输入式数字 OTP，则在保留原链接的基础上增加 `{{ .Token }}`。邮件模板可能被两个网站共用，不能任意覆盖。

Supabase 自带发信仅适合测试，官方说明存在项目团队成员收件限制与默认邮件额度。先使用项目所有者自己的真实邮箱测试，再决定是否配置 SMTP；不要承诺无需 SMTP 就能对所有同学免费开放。真实发信、OTP、密码找回和两站回跳尚未验收。

## 真实上线验收

安装前后各验证数学网站：旧账号登录、收藏/已做读取、修改一次并复原、管理员列表、新昵称注册。学习网站：真实邮箱收到 OTP 后登录、设置密码后再次登录、计时保存/跨设备暂停、两学习账号隔离；验证昵称用户与学习用户均不能读取另一人的表数据。iOS/Android 和东莞家庭/学校网络还需实际测试。

本次本地测试加载的是数学网站原始 SQL 整体，不是伪造的空数学库。原始文件的只读副本在 `tests/fixtures/math-001-accounts.sql`；用户提供的线上函数副本也单独加载测试。每个版本各执行 26 项共享兼容检查，包含异常函数拒绝、数据保留、注册隔离、旧数学 API 和精确回退；原数学仓库保持未修改。

## 回退

`supabase/shared/02_disable_shared.sql` 在确认没有其他人改写该触发器时，恢复保存的原始定义、撤销学习 API 与表访问，**保留学习数据**。普通邮箱新注册将恢复为数学项目原来的限制。已有邮箱身份仍留在共享 Auth，不能为回退而删除用户。SQL 回退不恢复控制台的邮件模板或回跳设置，因此所有控制台改动应先另存原值。

这不是正常安装步骤；只有出现需要暂停新学习服务时，按维护者指导执行。不要手工删除学习表、原题库表或 Auth 用户。

## 自动备份限制

共享后台不应把整个 `public` 题库数据上传到学习网站仓库的备份制品。新备份工作流仅导出三个学习业务表的数据（不含旧题库、不含管理员保存的触发器定义）；恢复前需要先建好学习 schema 和相应 Auth 身份。回退前及项目级恢复依然由原项目所有者控制。该工作流默认关闭，真实共享数据库备份与恢复未经执行，不能宣称已自动备份。

## 安装后的只读核查

`supabase/shared/03_verify_install.sql` 是安装后专用检查，预期八个值均为 `true`，检查表是否齐全、RLS、旧函数和已记录触发器、学习访问策略、客户端写入限制、私有元数据和匿名调用限制。不返回任何用户资料。不要把安装前的 `00_check_math_library.sql` 当作安装后验收：旧触发器会有意加入分流条件，因此其安装前检查值会变化。

此检查已在两个隔离测试库中通过；真实库仍需由项目所有者在 SQL Editor 执行或恢复云环境访问后验证。
