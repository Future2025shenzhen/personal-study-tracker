# 免费独立后台评估 · 2026-11-03

> 历史评估记录，当前已由用户后续授权共用 maths Library Supabase 取代。不要按本文件注册 Appwrite 或把其内容当成当前部署步骤；见 SHARED_SUPABASE.md。

用户已明确：优先免费；不得暂停、删除或共用 maths Library、sixsigma。Supabase 的两个现有免费项目保持原状。**旧的 START_HERE.md 中“创建新 Supabase 项目”步骤目前不适用，请勿在两个旧项目执行学习网站的 SQL。**

## 当前建议：评估 Appwrite Cloud Free

其后台独立于现有 Supabase 项目，GitHub 仓库和静态前端也继续独立。官方文档支持邮箱密码、六位邮箱 OTP、密码找回和数据库事务，能作为下一阶段适配候选。不是只因免费而退化为单机保存。

已核实的官方免费计划信息：

- $0 Free；套餐页列出最多 2 个免费项目。
- 2 GB 存储、每月 5 GB API 流量。
- 每项目 1 个数据库、2 个 Functions；数据库每月 50 万次读、25 万次写。
- 免费事务每次最多 100 个操作；提交时若涉及行已在事务外改变，会冲突失败。
- 邮箱 OTP 是六位数字，不是把邮件链接冒充验证码；密码恢复接口也已确认。
- 闲置一周会暂停；超免费资源额度会冻结，不能承诺永久免费、永不暂停或无限使用。
- Free 不包含托管数据库备份，也不支持自定义 SMTP。正式邮件额度、投递与密码找回仍须在新项目上实测。

## 切换前的实际前提

先由用户在实际家庭/学校网络打开 https://cloud.appwrite.io ，确认能进入控制台并选择 Free 创建一个空项目。此云执行环境的 Appwrite 主站请求被代理返回 403；该现象不能证明用户在中国大陆的网络不可达。不要未经实测宣称国内稳定，也不要以此要求用户付费或绕过网络规则。

若注册/创建页面要求升级套餐或绑定付费服务，先停留在页面确认，不诱导开通付费。不要通过创建多个账号规避服务商额度。

## 必须完成的代码适配与验收

**当前源代码仍是 Supabase 版本，尚未迁移到 Appwrite，也未部署 Appwrite。** 现有 22 项逻辑/队列、18 项 Postgres 与 6 项浏览器验收不能算成 Appwrite 权限/事务验收。

1. 加入独立云服务适配层，替换登录、注册、OTP、恢复密码和会话恢复。
2. 建立按用户隔离的数据库及服务器写入入口。将事务版本检查和幂等提交放在可信服务器端，不能只依赖前端先读后写。
3. 不向浏览器公开管理员 API key；前端仅包含公开 endpoint、project ID 和所需资源 ID。
4. 保留设备时区/04:00 学习日、分段计时、软删除、审计和本机待同步队列；已有本机数据不得清除或改 ID。
5. 适配暂停/额度错误提示，限制后台无意义轮询，按实际活跃设备估算免费读写/函数额度。
6. 改写独立备份工作流；原 Supabase pg_dump 工作流不能直接当 Appwrite 备份。先保留可用的 JSON 导出/导入，后续补云端备份与恢复演练。
7. 新后台必须重新验证：两个账号相互隔离、双设备并发开始/结束、断网恢复、冲突、邮箱投递、真实设备访问。通过后才更改正式部署说明。

## 资料依据

官网页面受本云环境代理限制，因此直接读取 Appwrite **官方 GitHub 网站仓库**和官方 Web SDK，不是第三方教程。核对的网站仓库 HEAD 为 `2381902247c76d43ad9e284edb0f2dabf548ae12`，具体配额仍以注册时官方控制台为准。

- 套餐：https://appwrite.io/pricing
- 套餐源码：https://github.com/appwrite/website/blob/2381902247c76d43ad9e284edb0f2dabf548ae12/src/routes/pricing/+page.svelte
- 套餐对照：https://github.com/appwrite/website/blob/2381902247c76d43ad9e284edb0f2dabf548ae12/src/routes/pricing/compare-plans.svelte
- 邮箱 OTP：https://appwrite.io/docs/products/auth/email-otp
- 邮箱密码及密码恢复：https://appwrite.io/docs/products/auth/email-password
- 数据库事务：https://appwrite.io/docs/products/databases/transactions

Firebase 未作为默认替代：其主站在本云环境同样受限，且尚无用户所在地网络验证。Neon + 独立 Auth/服务器等组合会增加初期配置和免费额度管理复杂度，当前未进行完整产品评估，不应宣称已排除所有其他免费服务。
