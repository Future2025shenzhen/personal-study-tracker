> 2026-11-03 共享后台更新：备份工作流改为仅导出 `study_workspaces`、`study_operations`、`study_verified_emails` 三表数据，避免包含数学题库数据。恢复前必须先建立学习 schema 和 Auth 身份；下文旧 public schema 导出说明只适用于之前的独立后台测试，不是当前共享项目的生产备份。工作流仍未启用。

# 备份与恢复

## 日常个人备份（现在可用）

设置 → 下载 JSON 备份；把文件保存到电脑及另一个独立位置。它包括科目、会话分段、修改历史、软删除记录、任务与目标。不能把浏览器存储或云同步当备份。推荐每周一次；大改历史、换设备或退出未同步账号前也下载一次。

恢复：先结束活动计时器，在目标工作区设置 → 导入 JSON。按稳定 ID 合并，新 ID 添加，已存在 ID 保持当前版本，重复导入不会复制记录。默认保留目标工作区的外观设置。此工具不把有活动计时器的备份自动转为学习记录，避免恢复时产生误计时。

本次已自动演练 JSON 导出→导入→重复导入，并确认会话保留；另外在真实浏览器执行过文件下载和导入。

## Supabase 托管备份

已核对官方文档：Pro 每日备份可访问最近 7 天，Team 为 14 天，Enterprise 可到 30 天；PITR 是另加功能且需相应计算规格。Free 应自行定期导出并异地存放，不应假设拥有可恢复的自动每日备份。具体价格、保留和功能以项目 Dashboard 与当期套餐为准。本项目没有为你开通收费服务。

官方来源（2026-11-02 查询官方仓库文档；主站在本环境返回 403）：

- https://supabase.com/docs/guides/platform/backups
- https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/backups.mdx

## 可选加密定时数据库备份（已提供，未启用）

`.github/workflows/backup.yml` 每周 UTC 周日 19:30（北京时间周一 03:30）可运行一次，另可手动触发。它使用 PostgreSQL 17 `pg_dump` 导出 public 应用 schema，再用 age 公钥加密，仅上传密文，30 天后制品过期。数据库必须为 PostgreSQL 17 或更低版本；若新 Supabase 项目版本更高，要先升级 dump 客户端。GitHub Actions 和制品使用量可能收费，公开仓库的工作流运行可能按平台规则暂停。

启用需要项目所有者：

1. 本地安装 age，运行 `age-keygen -o study-backup.key`。离线保管私钥文件（丢失将无法解密），不要上传至代码、Actions 或聊天。记下打印的公钥 `age1...`。
2. 在 GitHub Actions **Variables** 填 `STUDY_BACKUP_RECIPIENT` 公钥。把专用于备份的数据库连接串存入 Actions **Secret** `STUDY_DATABASE_URL`，应带 `sslmode=verify-full&sslrootcert=system`，优先使用能从 runner 访问的 session pooler。此凭据只供后台备份，绝不能成为 `VITE_` 变量。不要在聊天发给我。
3. 先手动测试备份并完成下面的独立恢复演练；再将 Variable `ENABLE_STUDY_BACKUPS` 设为 `true`，正式启用定期任务。还需把重要密文另存到 GitHub 之外，30 天留存并非永久备份。
4. 每月检查 Actions 成功记录和备份下载、解密是否可用。没有运行记录不能宣称已备份。

恢复演练应在**独立测试数据库**进行，禁止拿生产库试验：

```sh
# 私钥与数据都留在你自己的电脑；不要提交生成文件。
age -d -i study-backup.key -o recovered.dump study-backup.dump.age
pg_restore --list recovered.dump
# RESTORE_DATABASE_URL 指向一次性测试 Postgres，不是生产 Supabase。
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-acl recovered.dump
```

备份包含 public 应用 schema，不包括 Auth 身份、用户密码、Storage 对象及服务配置。测试库需先准备 auth.users 表/身份映射，生产灾备需单独计划完整 Supabase 项目迁移与身份恢复。单独 public dump 不能声称能独立恢复整个 Supabase 服务。对于个人用户，跨账号迁移优先使用 JSON 导入，因为其中的会话不绑定旧 auth.user ID。

代码中 `scripts/test-postgres.mjs` 用临时 PostgreSQL 演练了 public 数据 dump/restore 并逐项比较记录。实际托管库的导出、加密、上传和恢复尚未运行，需配置上述服务后验收。
