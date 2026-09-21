# DKU AI Club 官网 — 项目长期约定

## 视觉与文案（天成明确要求，2026-09-19 一整天迭代得出）

- **less is more，内容与样式都是。** 他连续多轮删的东西：首页三格统计条（原话「这又不是简历」）、四处绿色全大写标签（`The club` / `Flagship` / `Latest` / `Club history`）、hero 左上角小字标签、详情页「Hosted by the DKU AI Club」、logo 旁的 `Duke Kunshan` 副行。
- **默认不加 eyebrow**（标题上方小字标签）。只有它带来标题里没有的信息时才留（如 hero 事件页的「分类 · 年月」）。
- **首屏**：全幅照片轮播，`-mt-16` 钻到透明页头下，高度 74vh / sm:80vh（**不加 max-h**，大屏会被压矮）。顶部只有右上角页码。自动轮换 6s，只在标签页隐藏时暂停。
- **首页 hero 的每张活动图 = 该活动 `gallery[0]`**，不是 `cover_image`（归档封面多为竖版海报，宽画幅裁得难看）。要换首屏图就把图挪到图集第一位。
- **文案要短。** 首页「Who are we」只用 `about_lead`（两句），完整介绍在 `/about` 的 `about_body`。
- **一个页面只用一个栏宽。** 详情页所有块共用 `EventDetail.tsx` 的 `COLUMN`（`max-w-3xl`）。
- **不要灰色填充容器**（`bg-secondary/40` 那类），边框够了。

## 内容事实

- **社团联系邮箱 = `dkuaiclub@outlook.com`**（天成 2026-09-19 纠正）。**唯一来源是 `src/lib/data.ts` 的 `DEFAULT_SETTINGS.contact_email`**，首页 Join 段、`/about` 的 Get in touch、页脚三处都读它。
- `site_settings` 表为空时全站文案来自 `DEFAULT_SETTINGS`，后台保存一次后以数据库那行为准。改默认值就能立刻改全站。

## 架构（2026-09-21 迁到 Cloudflare 全家桶）

天成 2026-09-21 拍板：「自有域名是必须的」，并要求走**全家 Cloudflare**路线。

- **一个 Worker 兼两职**：`cloudflare/worker.ts` 既由边缘送 `dist/` 的静态文件，又答 `/api/*`（公开读 + 凭密钥写）与 `/media/*`（R2 取图）。绑定见 `wrangler.jsonc`。
- **数据在 D1**（`events` / `site_settings` / `site_access` 三表，`cloudflare/schema.sql`），**图片在 R2**。D1 是 SQLite：没有角色、没有 RLS、没有 SECURITY DEFINER，**所有校验都在 Worker 里**——浏览器够不到数据库。
- **图片不进数据库**：上传前在浏览器端缩图（`src/lib/image.ts`），字节存 R2，库里只留 `/media/...` 链接。**D1 的语句长度上限（100 KB）使得 data URL 根本写不进去**，接口会明确拒绝，报错信息指向「先上传」。
- **前端只认 `src/lib/api.ts`**（同源 fetch，密钥走 `x-site-key` 头）。`src/lib/data.ts` 保留全部对外函数签名与界面文案，只换传输层；`writeError()` 按 `code === 'KEY_REJECTED'` 翻译成「The site key was not accepted. It may have been replaced.」。
- **已删除**：`localdev/`（Postgres 镜像 + 51 项断言）、`src/lib/cloud.ts`、`src/lib/localClient.ts`、`@tencent-ai/workbuddy-cloud-sdk`、`pg`。产物因此从 556 kB 掉到 495 kB。
- **本地开发就是真环境**：`npm run cf:api`（= `wrangler dev`，8787）跑真实 Worker + 真实 D1 + 真实 R2，**不需要登录 Cloudflare 账号**。另有 `npm run cf:seed`（生成种子与密钥）、`cf:db`（建表+写入）、`cf:verify`（哈希比对）、`cf:check`（**26 项端到端自检**，自带独立的库与存储，碰不到工作数据）。只改界面时用 `PORT=5200 npm run dev`，Vite 把 `/api` 与 `/media` 转发给 8787。
- **密钥模型未变**：库里只有 `sha256(key)`，比对在服务端，浏览器永远不知道密钥对不对；≥16 字符才比对，换密钥要求 ≥24。「丢了没有找回入口」这条依旧成立。
- **迁移的取数手法**：正文不从我的输出里转录——`cloudflare/seed.mjs` 直接读 `public/content/events.json` 生成种子 SQL，`cloudflare/verify.mjs` 拿 `migration-receipt.json`（迁移前数据库里每篇正文/标题的 SHA-256）逐条比对。**12 条全部逐字节一致。** 以后再遇到「要往库里灌内容」，走这条路，不要手工 SQL。
- **还没有部署**：缺天成的 Cloudflare 账号与域名。步骤写在 README 的「部署」一节。`wrangler.jsonc` 里的 `database_id` 是占位符，`wrangler d1 create` 之后要替换。
- 🔑 **旧平台库仍可直读**：`mcp__genie-baas__workbuddy_cloudservice_db_*`（`applicationId` 取 `.workbuddy/applications.yaml`）以应用 ID 直连数据面，绕开前端凭据。**不要用 `curl` 打 `/.cloud/**` 判断后端生死**——那条路要过 Origin 精确匹配，前端连不上不等于数据没了。

## 验证的粒度（天成 2026-09-19 明确指示）

- **不要每次修改都起浏览器模拟和截图。** 改文案、改字号、改链接这类小且确定的改动，改完直接说结论。
- 只有**结果不确定、或改的是布局与交互**时才上浏览器验证（多栏容器被字号撑坏、点击被遮挡、跨页面一致性）。
- 验证要挑手段：能靠计算或读代码确定的，不要截图。

## 排版基线

- **全站只有一个正文字号 `text-lg`。** 天成原话：「全网站基本字体应当统一，标题字体可以多级。」三级制：
  - **正文 = `text-lg`**（1.125rem，实测 19.125px）。凡是**成句的段落**都用它：首页 `about_lead`、首页 Join 段、Events 页头描述、空状态、卡片摘要（`EventCard` 里 `mt-3 text-lg`）、详情页摘要与 Source 段、`/about` 全部段落、hero 副标题、页脚 blurb、404 文案、`.article-body`。
  - **元信息与控件 = `text-sm`**（14.875px）：导航、按钮、筛选 chip、日期/地点、卡片计数、来源署名、链接列表。
  - **极小大写标注 = `text-xs` / `text-[0.6875rem]`**：eyebrow、分类 chip、hero 页码、版权行。
  - 标题随意分级：h1 `text-4xl sm:text-5xl`、区块 h2 `text-3xl sm:text-4xl`、文章内 h3 `text-xl`。
- **改字号后要复查版式，不能只改 class。** 正文字号一动，多列卡片会被挤成一词一行（`/about` 三栏卡片已改成 `divide-y` 竖排）。以后加多栏正文卡片先量宽度。
- **根字号 `html { font-size: 106.25% }`（17px）**，在 `src/index.css`。Tailwind 的字号、间距、容器宽度全是 rem，整个版式等比放大。用百分比而非 px，保留浏览器字号偏好。
- **字号一律用 rem / Tailwind 档位，不要写 px**（px 不随根字号缩放）。已踩过：`text-[11px]`、`text-[15px]`。
- 装饰性时长写 `[transition-duration:900ms]`，不要写 `duration-[900ms]`（Tailwind 3.4 报 ambiguous，可能不生效）。
- 管理员后台（`/admin/*`）是表单型工具界面，**不套用上面的正文档**，保持 `text-sm` / `text-[13px]` 的紧凑密度。

## 数据与构建

- **事件只有数据库一个来源。** `public/content/events.json` 降级为两件事：**给空库做一次性导入**（后台 Event library 页的「Import them」，`importArchive()` 按 slug 补齐、已存在的不动，可重复执行），以及**数据库一条事件都没有时**给公开页兜底（`fetchPublicEvents`）。后台列表 `fetchAllEvents()` 不兜底，看到的就是真实情况。
- **纯文本展示的字段要先清标记**：`summary` 不经过 Markdown 组件，用 `plainSummary()`（`src/lib/format.ts`）去掉行首 `>` 与 `**`。
- **改 `public/content/events.json` 的手法**：读取原始文本 → `str.replace` → `json.loads()` 校验 → `assert` 断言具体字段（含数组长度、相邻字段未被误改）→ 写回。**不要 `json.load`+`json.dump` 回写**，会在整档产生格式化 diff。
- **仓库已 git 化**（2026-09-21 建的，此前没有版本控制）。迁移前的状态在第一个提交 `69379c6`，要回退就从那里取。`参考资料/`（110 MB，DKU CS Club 归档）已加入 `.gitignore`，不进版本库。
- **长期服务要作为后台任务本体启动**，**不要**写成 `cmd & ... sleep` —— 那条命令一结束子进程一起被收走，端口就没人听了（踩过两次）。
- **判断服务是否在跑要用 `lsof -nP -iTCP:<port> -sTCP:LISTEN`**：进程已死时 `curl` 仍可能返回宿主预览代理的 502。
- **端口**：5173 被 PeptiCraft 的 dev server 占着（两个进程能同时 listen，访问 5173 会看到别的项目），改界面时用 `PORT=5200 npm run dev`。
