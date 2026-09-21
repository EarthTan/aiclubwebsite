# DKU AI Club 官网 — 项目长期约定

## 视觉与文案（天成明确要求，2026-09-19 一整天迭代得出）

- **less is more，内容与样式都是。** 他连续多轮删的东西：首页三格统计条（「12 Events in the archive」那类，原话「这又不是简历」）、四处绿色全大写字号标签（`The club` / `Flagship` / `Latest` / `Club history`）、hero 左上角的小字标签、详情页「Hosted by the DKU AI Club」、logo 旁的 `Duke Kunshan` 副行。
- **默认不加 eyebrow（标题上方的小字标签）。** 只有它带来标题里没有的信息时才留（例如 hero 事件页的「分类 · 年月」）。
- **首屏**：全幅照片轮播，`-mt-16` 钻到透明页头下，高度 74vh / sm:80vh（**不要加 max-h**，大屏会被压矮）。顶部只有右上角页码，没有标签文字。自动轮换 6s，只在标签页隐藏时暂停。
- **首页 hero 的每张活动图 = 该活动 `gallery[0]`**，不是 `cover_image`（归档封面多为竖版海报，宽画幅裁得难看）。要换首屏图就把图挪到图集第一位。
- **文案要短。** 首页「Who are we」只用 `about_lead`（两句话），完整介绍在 `/about` 的 `about_body`。两个字段分开，不要截断长文。
- **一个页面只用一个栏宽。** 详情页所有块共用 `EventDetail.tsx` 里的 `COLUMN` 常量（`max-w-3xl`），标题、封面图、正文、图、上下篇导航全部对齐。
- **不要灰色填充容器**（`bg-secondary/40` 那类），边框够了。

## 内容事实

- **社团联系邮箱 = `dkuaiclub@outlook.com`**（2026-09-19 天成纠正：不是 `aiclub@dukekunshan.edu.cn`）。**唯一来源是 `src/lib/data.ts` 的 `DEFAULT_SETTINGS.contact_email`**，首页 Join 段、`/about` 的 Get in touch、页脚三处都读它，改一处即可。
- 云数据库 `site_settings` 目前**是空表**，没有 `site` 键，所以线上文案全部来自 `DEFAULT_SETTINGS`。以后要改站点文案，改 `DEFAULT_SETTINGS` 就能立刻全站生效；后台保存一次之后就以数据库那行为准。
## 管理员入口：一把站点密钥（2026-09-19 晚，天成：彻底去掉账号系统）

天成原话：「不需要账号系统，彻底不需要账号系统，行不行？不需要邮箱了。」现行设计**没有任何账号、邮箱、验证码、会话**。

- **一把长密钥就是全部凭证。** 云库 `site_access` 只存 `sha256(key)`；这张表不授权给任何角色、开了 RLS 且无策略，唯一能读它的是 `SECURITY DEFINER` 的校验函数。网页全程不知道密钥对不对，它只是把字符串交给 `site_key_ok` 比对，通过后留在浏览器（`src/lib/siteKey.ts`，localStorage 键 `dku-ai-club.site-key`）。
- **所有写操作都是数据库函数**：`admin_list_events` / `admin_save_event` / `admin_set_event_status` / `admin_delete_event` / `admin_save_settings` / `admin_replace_site_key`，每个先 `perform require_site_key(p_key)` 再写。`anon` / `authenticated` 对任何表**只有 SELECT**，写权限全部收回。
- **密钥作为函数命名参数传**，不走请求头。理由（实测过）：托管网关**不会**把自定义请求头透传到 SQL 的 `request.headers`，只透传它自己的内部头。
- **换密钥**：Settings 页最后一张卡，当前密钥 + 新密钥（≥24 字符，有「Suggest one」随机生成）→ `admin_replace_site_key`。执行的浏览器自动切到新密钥；其它浏览器里那份旧密钥下一次点击就会被挡。**丢了没有找回入口**（库里只有哈希），只能从外部往数据库写一条新哈希。
- **不要恢复**账号 / 邮箱 / 验证码 / 认领管理员 / Administrators 页签。`AdminTeam.tsx`、`SITE_ACCOUNT_EMAIL`、`cloud.auth.*`、`bind_admin_invite` / `is_site_admin` / `admin_slot_open`、`admins` 表**在两边数据库里都已删除**（`cloud.auth` 一次都不再被调用）。
- 管理员登录表单里的邮箱占位提示已随表单一起消失——现在只有一个密钥框，没有任何邮箱字段。

### 托管数据库的四个坑（2026-09-19 实测，做这类迁移必踩）

1. **`create table` / `create function` 会被平台自动加授权**：新表建好时 `anon` 直接拿到 SELECT、`authenticated` 拿到全部；新函数拿到 EXECUTE。我按 schema 惯例只 `revoke ... from public` 是不够的——**对 anon/authenticated 的直接授权还在**。必须显式 `revoke all on <table> from anon, authenticated` 与 `revoke execute on function <fn> from anon, authenticated, public`。（`site_access` 的 RLS 无策略本来也读不出行，但「不授权给任何角色」是设计声明，得让代码与声明一致。）
2. **函数默认对 `PUBLIC` 开放 EXECUTE**，所以 `require_site_key`（本该只能被别的函数内部调用）一开始是匿名可调的。本地镜像与线上都要 revoke。
3. **网关给 SQLSTATE 加了模块前缀**：拒绝密钥到达浏览器时 `code` 是 **`DATABASE_42501`**，不是 `42501`；参数太短是 `DATABASE_22023`。`code` 的 doc 注释却写着「PostgREST 的 `42501`」，别信注释——**用 SDK 本体跑一次看真实形状**。前端判断因此按 `code.endsWith('42501')` 写（`writeError()`）。
4. **migrate 模式跑在表属主上**（`cloudbase_postgres_pgdb_rpcn7j6h`，`rolbypassrls=true`），所以在这里建的 `SECURITY DEFINER` 函数能绕过 RLS 写库。建函数前先查一次 `current_user` / `relowner` / `rolbypassrls`，别假设。


## 验证的粒度（天成 2026-09-19 明确指示）

- **不要每次修改都起浏览器模拟和截图。** 改文案、改字号、改链接这类小且确定的改动，改完直接说结论。
- 只有**结果不确定、或改的是布局与交互**时才上浏览器验证（多栏容器被字号撑坏、点击被遮挡、跨页面一致性）。
- 验证要挑手段：能靠计算或读代码确定的，不要截图。

## 排版基线

- **全站只有一个正文字号 `text-lg`。** 天成 2026-09-19 的原话：「全网站基本字体应当统一，标题字体可以多级。」三级制：
  - **正文 = `text-lg`**（1.125rem，实测 19.125px）。凡是**成句的段落**都用它：首页 `about_lead`、首页 Join 段、Events 页头描述、空状态、卡片摘要（`EventCard` 里 `mt-3 text-lg`）、详情页摘要与 Source 段、`/about` 的全部段落、hero 副标题、页脚 blurb、404 文案、`.article-body`。
  - **元信息与控件 = `text-sm`**（14.875px）：导航、按钮、筛选 chip、日期/地点、卡片计数、来源署名、链接列表。（About 页原有的一块数字统计卡已在 2026-09-19 深夜删掉，天成不要这类「简历式」数字。）
  - **极小大写标注 = `text-xs` / `text-[0.6875rem]`**：eyebrow、分类 chip、hero 页码、版权行。
  - 标题随意分级：h1 `text-4xl sm:text-5xl`、区块 h2 `text-3xl sm:text-4xl`、文章内 h3 `text-xl`。
- **改字号后要复查版式，不能只改 class。** 正文字号一动，多列卡片会被挤成一词一行：`/about` 原来三栏「What we run」卡片放在 `1.15fr` 栅格列里，19px 时每栏只剩 ~145px，已改成 `divide-y` 竖排列表（图标左、文字右）。以后加多栏正文卡片先量宽度。
- **根字号 `html { font-size: 106.25% }`（17px）**，写在 `src/index.css`。Tailwind 的字号、间距、容器宽度全是 rem，所以整个版式等比放大、不会失衡。用百分比而非 px，保留浏览器的字号偏好。
- **字号一律用 rem / Tailwind 档位，不要写 px**（px 不随根字号缩放）。已经踩过：`text-[11px]`、`text-[15px]`。
- 装饰性时长写 `[transition-duration:900ms]`，不要写 `duration-[900ms]`（Tailwind 3.4 报 ambiguous，可能不生效）。
- 管理员后台（`/admin/*`）是表单型工具界面，**不套用上面的正文档**，保持 `text-sm` / `text-[13px]` 的紧凑表单密度。

## 数据与构建

- **本地开发后端（`localdev/`，2026-09-19 建）**：本地 PostgreSQL 18（Homebrew，127.0.0.1:5432）跑一套镜像线上结构的库，站点通过 `npm run local` 指向它，可以完整测试进后台 / 建改事件 / 改文案 / 换密钥。详见 `localdev/README.md`。要点：
  - `npm run local`（= `localdev/run.mjs`）按序做三件事：查/建库 → 起 API（127.0.0.1:54321）→ 起 Vite（`VITE_LOCAL_BACKEND=1`，端口 5199）。`npm run local:reset` 重建库；`npm run local:check` 用一次性库跑 **51 项**端到端断言。**重跑 `local` 不会重建库**，测试数据会留着。
  - **改完 `localdev/server.mjs` 必须重启 `npm run local`**，Vite 会热更新但 API 进程不会（踩过：改了端点却仍被旧的 401/404 打回）。
  - **切换后端只发生在 `src/lib/cloud.ts`**：`import.meta.env.VITE_LOCAL_BACKEND === '1'` 是构建期常量，所以 `npm run build` 会把 `src/lib/localClient.ts` 整个摇掉（产物 556.15 kB，grep 无 `LOCAL_API_OFFLINE`）。
  - **服务端把每一笔数据库请求都 `set local role anon` 执行**（没有账号系统了，永远只有这一个角色；线上同样如此，数据面是无 token 调用的）。API 自己的角色是表属主、会绕过 RLS，所以必须降级。`runAs()` 里不再有 `request.jwt.claims`。
  - **`schema.sql` 必须逐字段对齐线上类型**（用 `information_schema.columns` / `pg_proc` / `pg_policies` 查，不要凭印象）：`events.event_date` 是 `date`（不是 text）、`tags` 是 `text[]`（不是 jsonb，`gallery` 才是 jsonb）、`status` 默认 `'draft'`。**`auth.uid()` / `auth.email()` 都返回 `text`**（线上如此，仍保留给 `owner_id` 的列默认值用）；写成 uuid 会让所有策略报 `operator does not exist: text = uuid`。
  - 本地 API 要给 `pg` 注册 `date` 类型解析器（OID 1082 原样返回字符串），否则 `date` 列会以本地午夜时间戳序列化，跨时区读出来差一天。
  - 自检脚本 `check.mjs` 在 setup 阶段就可能抛错，**必须用 try/finally 兜住已打开的 pg client**，否则进程挂着不退（踩过）。它另有一个 `asAnon()` 助手，绕过 API 直接以 `anon` 跑 SQL，用来断言「表和函数本身不授权」这类 API 层看不见的事。
  - **开发密钥 = `localdev/config.mjs` 的 `DEV_SITE_KEY`（`dku-ai-club-local-development-key`）**，是它唯一的定义处。`schema.sql` 刻意不种，由 `setup.mjs` **每次运行**都写一遍哈希（包括复用已有库），所以本地改过密钥再重启就恢复成已知值，不会把自己锁在外面。
- **事件数据只有数据库一个来源**（2026-09-19 天成拍板「搬进数据库」）。`public/content/events.json` 降级为两件事：**给空库做一次性导入**（后台 Event library 页的「Import them」，`importArchive()` 按 slug 补齐、已存在的不动，可重复执行），以及**数据库一条事件都没有时**给公开页兜底（`fetchPublicEvents`，避免新环境白屏）。后台列表 `fetchAllEvents()` 不兜底，看到的就是真实情况。
  - ✅ **线上 12 条已导入（2026-09-19 深夜）**。拿到站点密钥后不必再等天成点按钮：用 SDK 直接调 `admin_save_event` 循环写入即可，**正文从 `public/content/events.json` 读**（零转录风险）。实测 12 条全进、状态全 `published`、正文长度与日期逐条比对一致、匿名访客读到 12 行且非 published 为 0 行。以后再遇到「要往库里灌内容」，走这条路而不是手工 SQL。
  - 原先「对从未动过的内置事件点 Delete 没反应」的缺口已随之消失：删的就是库里的行，`deleteEvent()` 删 0 行会抛错而不是静默成功。
- **纯文本展示的字段要先清标记**：`summary` 不经过 Markdown 组件，用 `plainSummary()`（`src/lib/format.ts`）去掉行首 `>` 与 `**`。归档里 `hackdku2026` 曾出现字面 `**` 和 `>`。
- **改 `public/content/events.json` 的手法**：读取原始文本 → `str.replace` → `json.loads()` 校验 → `assert` 断言具体字段（含数组长度、相邻字段未被误改）→ 写回。**不要 `json.load`+`json.dump` 回写**，会在整档产生格式化 diff。
- **预览端口 `PORT=5199 npm run dev`**——5173 被 PeptiCraft 的 dev server 占着（两个进程能同时 listen，访问 5173 会看到别的项目）。
- ⚠️ **站点尚未上线，且对外入口目前是失效状态**（2026-09-21 复查）。`https://dku-ai-club.app.workbuddy.host/` 返回 404 + 平台页「链接已失效」，`/.cloud/**` 一律 `401 invalid_client`（真 key / 假 key / 无 key 响应一致，所以不是密钥问题，是**这个应用当前没有对外入口**）。2026-09-19 那次发布被平台拒绝，理由是发布沙箱只跑单一 HTTP 服务、不提供数据库/缓存/消息队列，而 `package.json` 里声明了**只给本机测试用的 `pg`**；`pg` 现已移到 devDependencies，限制是否解除**未知**，需真发一次才能确认。站点本身不需要沙箱数据库——它连的是云端服务。
- 🔑 **「前端连不上」≠「数据没了」。判断后端生死不要用 `curl` 打 `/.cloud/**`**——那条路要过 Origin 精确匹配。**查数据/查表一律用 `mcp__genie-baas__workbuddy_cloudservice_db_*`（`db_list_tables` / `db_exec_sql`，mode=read 只读，以应用 ID 直连数据面，绕开前端凭据）**，`applicationId` 取 `.workbuddy/applications.yaml`。2026-09-21 用它确认：`events` / `site_access` / `site_settings` 三表俱在，12 条事件全部完好且 `published`（2024-03-25 ~ 2026-07-18）。
- 🧭 **前端可搬、后端不可搬。** SDK 的 `endpoint` 文档原文：「endpoint 是每应用发布域名，承载 `/.cloud/**`」——数据面与发布域名同主机，服务端按 Origin 精确匹配。所以：`dist/`（纯静态、HashRouter、14 MB）放 Cloudflare Pages / Netlify 并绑自有域名技术上零障碍，但换域名后读库被拒、后台全废，公开页退回随包归档 + 一条错误提示（`src/lib/store.tsx` 的 catch）。发布前记得 `npm run build`——用 `find src -newer dist/index.html -name "*.ts*"` 判断产物是否落后。
- 🎯 **天成 2026-09-21 拍板：「自有域名是必须的。」** 这一条排除平台发布通道（平台只给创建时预留的 `<prefix>.app.workbuddy.host`，无换域入口，数据面 Origin 又只认它）→ **站点将独立部署**。但**不必是 Cloudflare**：静态那半层 Cloudflare Pages / Vercel / Netlify / 学校服务器都行；真正要决定的是数据库。**首选 Supabase 免费档**——现有代码的 `Database` 类型与 `cloud.database.from().select()` / `.rpc()` 就是照 Supabase 形状写的，数据层基本等价替换；Cloudflare D1+Workers 是 SQLite、接口形状不同，要重写数据层。**「一把站点密钥 + SECURITY DEFINER 函数」与平台无关，换后端照搬。** 迁移数据用 `db_exec_sql` mode=read 直读三表导出（零转录）。
- **判断服务是否在跑要用 `lsof -nP -iTCP:<port> -sTCP:LISTEN`**：进程已死时 `curl http://localhost:5199/` 仍会返回 502 `upstream connect failed`（那是宿主的预览代理在应答）。
- **后台常驻本地服务的正确姿势**：`npm run local` 本身作为后台任务启动；**不要**写成 `npm run local & ... sleep`（那条命令一结束，子进程一起被收走，端口就没人听了——本轮与上一轮各踩一次）。
