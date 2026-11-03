# Personal Study Tracker · 个人学习记录

源码仓库：https://github.com/Future2025shenzhen/personal-study-tracker 。Pages Source 已由项目所有者设置为 GitHub Actions。网站入口为 https://future2025shenzhen.github.io/personal-study-tracker/ （发布状态以最新 Actions 结果为准）。首次构建通过后曾因未启用 Pages 返回 404；后续重跑暴露的临时 Postgres 启动时序问题已修复，完整检查仍为发布前提。

**2026-11-03 更新：用户已授权共用 maths Library 的 Supabase，sixsigma 不动。当前步骤见 [共享后台安装指南](docs/SHARED_SUPABASE.md)。网站已发布，用户已提供新版共享安装核查通过的结果。当前邮件仍只有链接，数字验证码需按 [邮件设置指南](docs/EMAIL_CODE_SETUP.md) 在现有模板追加 Token；真实数字登录和跨设备同步仍待验收。**

独立于 pure-maths-library 的新项目。React + TypeScript + Vite 静态前端，Supabase Auth / Postgres 云端。无广告、排行榜和自动判分。

**当前交付是可实际记录数据的本机版本，附云端实现和部署配置。尚未连接真实 Supabase，也尚未发布公网网址。** 真实邮件和跨设备网络验收完成后，才能将云端版本投入正式使用。

学生用户请先看 [开始使用与上线](docs/START_HERE.md)。完整交付边界见 [验收记录](docs/ACCEPTANCE.md)。

## 开发

需要 Node.js 24；锁文件已提交。

```sh
npm ci
npm run dev
```

未配置 `.env.local` 时，可点“使用本机模式”。没有演示假数据：五个默认科目之外的会话、待办、目标均由实际操作生成，并持久化到浏览器。本站不安装 Service Worker；首次打开及未缓存资源可能需要联网。本机模式只适用于当前浏览器，**每周下载 JSON 备份**，勿用无痕模式记录长期数据。

```sh
npm test                    # 计时、时区、统计、队列、备份与重复任务
npm run test:database       # 内嵌真实 Postgres (PGlite) 的 RLS/RPC 检查
npx playwright install chromium
npm run test:browser        # 自动启动 Vite；桌面与手机 Chromium
npm run build               # TypeScript + 生产构建
npm run preview             # 检查生产文件
```

环境已有 Chromium 时可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium`。测试文件使用独立浏览器存储，不含真实用户数据。iOS Safari / Android 真机与托管 Auth 尚须上线验收。

## 云端配置

**当前使用共享模式：先按 [SHARED_SUPABASE.md](docs/SHARED_SUPABASE.md) 执行只读检查与共享安装；下面的新建专用项目步骤只作为其他部署方式参考，不可用于现有 maths Library。**

在**全新专用 Supabase 项目**执行 `supabase/migrations/001_workspace.sql`，再复制 `.env.example` 为 `.env.local`，填写公开 URL 和 publishable key。私密密钥、数据库密码不进入前端或 Git。当前生产构建已由 `.env.production` 提供所选共享后台的公开配置，无需手填 Actions Variables。该文件不含管理令牌或服务端私钥，详见上线指南。

## 数据与一致性

- `study_workspaces`：以 `auth.uid()` 为主键，每个用户独占一个原子工作区。文档包含 subjects、sessions（含运行 segments、原时长和修改历史）、唯一 timer、tasks（完成记录及下一实例）、goals、settings。
- `study_operations`：按用户和幂等键保存已提交版本收据，避免响应丢失后重试重复写入。收据不重复存储整份学习资料。
- 两表启用 RLS；浏览器只能 SELECT 自己的数据，不能直接 INSERT/UPDATE/DELETE。唯一写入口是 `commit_study_workspace`：从认证身份确定用户，行锁串行化、比较版本后一次提交整个工作区，不接受目标用户 ID。
- 选择原子工作区而非分别写多张实体表，是为了个人规模下让计时结束、记录保存、任务状态及设置保持同一事务边界。代价是不同实体的并发修改也会产生整份工作区冲突；未来多人规模和更长历史应迁移为逐实体事务和增量同步，不能无条件扩容。
- 本机快照和待同步队列按账号 ID 隔离。每次修改先成功持久化再展示“已保存”；写盘失败会明确报错。600ms 合并连续编辑，5s 重试/拉取，在线、聚焦后重试。断网继续已有计时；**云端模式离线不能新建活动计时器**，因为网络分区下无法证明全账号没有另一台设备在计时。
- 发生冲突时停止写入，保留本机修改。下载备份后选云端或明确选择本机整体版本。导入只合并未出现的 ID；同 ID 保留当前版。不会自动“最后写入覆盖”。轮询成功不等于实时推送，通常约 5 秒看到另一设备状态。
- 个人规模设计：每次同步整份工作区，服务器限制为 5 MB；本地 localStorage 也受浏览器容量限制。接近容量时需开发增量/IndexedDB 版本，不能把本实现宣传为无限存储。不要把大文件、图片或试卷塞进备注。

## 时间与统计规则

UTC 时间戳 + 整数毫秒。使用 Temporal 和 IANA 时区，按当前设备当地 **04:00** 划分学习日；周一 04:00 开始一周。跨时区会重新分组有时间戳的历史，无准确时间的手动补录保留所选学习日。

每段运行区间单独跨学习日切分，暂停不入统计。手动改有效时长后，按原始运行时段的实际毫秒占比分配，最大余数法补足整数毫秒；不虚构休息发生在哪一刻。若改起止时间，编辑界面明确说明按整个新区间估算，原值保留在 revisions。历史保留完整会话并按开始学习日分组，日期标题统计实际分配值。日均分母含整个选定范围的零学习日及尚未到达日期；周/月/年周期均完整计算。

软删除会话与待办无限期保留，可恢复。科目用“归档”从新计时选择中移除，所有历史和关联保持，随时可恢复。待办截止日按当地日历日午夜，不使用 04:00 学习边界。每日/每周重复以原截止日为锚，每次完成恰好生成一个后续实例；逾期任务不会默默跳过漏做日期。撤销完成会移除未完成的直接后续实例；若后续已完成，须先从后向前撤销。

## 备份与维护

JSON 导出包括全部记录、修改历史、软删除数据和活动计时状态。导入拒绝有活动计时器的备份，避免恢复时误算正在运行的计时；应先在原设备结束后重新导出。CSV 为可读会话表，不是完整恢复格式，已处理公式注入前缀。同步不是备份。数据库加密定时备份是显式启用的可选工作流，详情见 [备份与恢复](docs/BACKUPS.md)。
