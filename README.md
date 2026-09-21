# DKU AI Club — 社团官网

昆山杜克大学 AI Club 的官方网站。结构参照姊妹社团 [DKU Computer Science Club](https://www.dkucs.com)，并带一套可供社团管理员直接在浏览器里使用的事件管理后台。

站点跑在 Cloudflare 上：网页、接口、数据库、图片存储都是同一套平台的服务，整个站点（含后台）只有一个域名。

## 站点包含什么

**公开页面**

| 路径 | 内容 |
|---|---|
| `/` | 首页：首屏、社团介绍、旗舰活动、近期活动、社团沿革、加入方式 |
| `/events` | 事件总览：分类筛选 + 关键词搜索 |
| `/events/<slug>` | 事件详情：封面、正文、图集、来源署名、前后一篇导航 |
| `/about` | 关于社团：介绍、活动形态、沿革、联系方式 |

**管理后台** `/admin`

- 进入：一把站点密钥
- 事件库列表：按状态筛选、搜索、编辑、发布 / 下架、删除
- 事件编辑：标题、slug、摘要、Markdown 正文（带预览）、日期、地点、分类、角色、精选、封面图、图集、来源署名
- 站点设置：首页首屏、社团介绍、社团沿革、联系方式、外链、事件分类，以及更换站点密钥

## 站点是怎么搭起来的

一个 Cloudflare Worker 同时做两件事：

- **送网页。** `npm run build` 产出的静态文件由 Cloudflare 的边缘节点直接送出，这一类请求不会执行 Worker 里的代码。
- **答接口。** 页面真正用到的接口都在 `/api/*`：公开读事件与站点文案，凭密钥做增删改；上传的图片走 `/media/*`，从对象存储取。

数据放在 **D1**（Cloudflare 的 SQLite 数据库）的三张表里，图片放在 **R2**（对象存储）里。三者的绑定见 `wrangler.jsonc`。

**图片不进数据库。** 通过后台上传的照片会在浏览器里先缩到合适的大小，然后存进 R2，数据库里只留一条链接。这样做有两个好处：事件表的一行始终是一行，不会因为图集变多而膨胀；图片由对象存储与边缘缓存服务，访问更快也不计入数据库用量。`public/images/events/` 下那 46 张随站点打包的图仍然照旧由静态资源提供。

## 站点密钥怎么运作

后台没有任何账号、邮箱或密码，只有一把密钥。

数据库里存的是这把密钥的 SHA-256，不是密钥本身。网页把输入或留存的字符串交给服务器比对，比对通过就把它留在浏览器里，此后一直用它调用那些需要密钥的接口。这样安排有两个原因：社团里需要改网站的人不必每人记一套账号、也不必经过任何一个邮箱；以及任何由网页自己校验的口令，打开网页源码的人都能读到，而这里网页从头到尾不知道密钥对不对。

三条约束：

- **密钥是共享的。** 拿到它的都能改动网站上的任何内容，改动不会记在某个人名下。
- **密钥可以自己换。** 进后台后在 **Settings** 页底部填入当前密钥和新密钥即可，不需要邮箱。换完之后，其它浏览器里那份旧密钥立刻失效，执行这次更换的浏览器自动切到新密钥。
- **丢了就进不去了，没有找回入口。** 数据库里只有哈希，读不回来。唯一的恢复办法是直接往数据库里写一条新哈希 —— 这需要有人能访问这个 Cloudflare 账号。所以拿到密钥后要存到密码管理器一类的地方。

密码形式的密钥（而不是登录口令）还有一个实际好处：它足够长，可以随手生成，不需要人来设计。后台的 Settings 页有一个「Suggest one」按钮，按一下就会填进一串随机密钥。

## 数据放在哪里

**事件只有数据库一个来源。** `public/content/events.json` 是一份随站点打包的归档，它只在两种情况下出现：

1. **给空库做一次性导入。** 事件库页会在发现归档里有数据库没有的记录时提示导入（「Import them」）。导入按 slug 补齐，已存在的不动，所以重复执行不会覆盖改过的正文。
2. **数据库一条记录都没有时**，公开页面显示这份归档，避免一个全新的环境白屏。

除此之外公开页面只显示数据库里状态为 `published` 的事件：草稿和已归档的记录都不可见，后台可以看到全部。删掉一条事件，它就真的不在了 —— 归档版本不会顶上来，除非整个事件库被清空。

站点文案同理：`site_settings` 表为空时用代码里 `src/lib/data.ts` 的 `DEFAULT_SETTINGS`，后台保存过一次之后以数据库里那一行为准。

社团联系邮箱也来自 `DEFAULT_SETTINGS.contact_email`（当前是 `dkuaiclub@outlook.com`），首页 Join 段、`/about` 的 Get in touch 和页脚三处都读它。

## 技术栈

- Vite 7 + React 19 + TypeScript
- Tailwind CSS 3.4 + shadcn/ui
- Cloudflare Workers（网页与接口）、D1（数据库）、R2（图片）
- react-router（HashRouter，静态托管下刷新任意页面都不会 404）
- react-markdown + remark-gfm 渲染事件正文

品牌色取自社团 logo：深蓝 `#083978`、绿 `#006C3E`、近黑 `#231815`。

## 目录

```
wrangler.jsonc             Cloudflare 配置：Worker、静态资源、D1、R2
index.html                 入口 HTML
src/
  lib/
    api.ts                 站点自有接口的客户端（同源 fetch）
    data.ts                事件与站点文案的读写，以及密钥的校验与更换
    siteKey.ts             浏览器里那把密钥的读写与订阅
    store.tsx              页面级数据状态
    image.ts               上传前的等比压缩
    format.ts              日期、slug、摘要等格式化
    types.ts               事件与文案的数据结构
  components/              页头页脚、事件卡片、Markdown 渲染
  pages/                   公开页面
  pages/admin/             管理后台
cloudflare/
  worker.ts                服务端：静态资源 + /api/* + /media/*
  schema.sql               D1 的三张表
  seed.mjs                 从归档生成种子 SQL，并生成站点密钥
  seed.sql                 生成物，可重复执行（不入版本库）
  verify.mjs               逐条比对归档与迁移前数据库的内容
  migration-receipt.json   迁移前数据库里每篇正文的 SHA-256
  check.mjs                端到端自检
public/
  content/events.json      内置事件归档（给空库导入 + 空库兜底）
  images/events/           随站点打包的事件配图
参考资料/                   外部参考资料（不参与构建）
```

## 本地运行

```bash
npm install
npm run build          # 类型检查 + 生产构建，输出到 dist/
npm run cf:api         # 用 Cloudflare 自己的运行环境跑整个站点：http://127.0.0.1:8787
```

`cf:api` 跑的是真实的 Worker、真实的 D1、真实的 R2，全部在本机，不需要登录 Cloudflare 账号，也不会碰到线上的数据。

第一次运行前先建库并写入事件：

```bash
npm run cf:seed        # 从 public/content/events.json 生成 cloudflare/seed.sql，并生成一把站点密钥
npm run cf:db          # 建表 + 写入种子
```

`cf:seed` 生成的密钥写在 `cloudflare/.site-key.txt`（不入版本库）。要沿用已有的密钥，用 `SITE_KEY=... npm run cf:seed`。

只做界面改动时可以用热更新更快地迭代，接口由旁边跑着的 Worker 提供：

```bash
npm run cf:api         # 一个终端
PORT=5200 npm run dev  # 另一个终端；Vite 会把 /api 与 /media 转发给 8787
```

### 自检

```bash
npm run cf:verify      # 归档与迁移前数据库逐条比对（SHA-256）
npm run cf:check       # 端到端自检：26 项
```

`cf:check` 会另起一整套干净的数据库与对象存储，逐项验证公开读、密钥校验、草稿与归档的可见性、增改删、文案保存、换密钥、图片上传，以及没有密钥时一切写操作都被拒。它不依赖线上的任何东西。

## 部署

需要先有 Cloudflare 账号，以及一个已经托管在 Cloudflare 的域名。

```bash
npx wrangler login                                   # 或配置 CLOUDFLARE_API_TOKEN
npx wrangler d1 create dku-ai-club                   # 把输出的 database_id 填进 wrangler.jsonc
npx wrangler r2 bucket create dku-ai-club-images
npm run build
npx wrangler d1 execute dku-ai-club --remote --file cloudflare/schema.sql
npx wrangler d1 execute dku-ai-club --remote --file cloudflare/seed.sql
npx wrangler deploy
```

部署完成后在 Cloudflare 控制台的 Worker → Settings → Domains & Routes 里绑定自有域名，证书由 Cloudflare 自动签发。

## 素材与版权

`参考资料/dkucs-blog/` 是姊妹社团 DKU CS Club 公开博客的完整归档，著作权属 DKU CS Club。站点内置的 12 篇事件因此都带有 `source_credit` 与 `source_url` 字段，在详情页底部以「Source」区块署名并链接原文。

若要把这些内容替换为社团自己的叙述，在后台逐条编辑即可；保存后正文改以数据库为准，归档版本不再参与展示。
