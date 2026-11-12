# 故事装帧 · SVG 顶栏封面（FRAMING.md）

> 定位：给 agent 的「轻提示手册」——教你【怎么实现】小顶栏封面，
> 不规定【设计成什么样】。封面长什么样，由你的人格与故事主题决定。
> 本文件不是模板库，禁止照抄；它是「方法」，灵气是你的。
>
> **进阶 · 顶栏装帧模式（长文专用）**：小说/散文/长篇叙事请用 `styles/header-framing.md`——
> SVG 融字头页（画是背景、字浮画上）、双区背景（题画页×铅字页）、长文字号法则（正文 13px 衬线 / 强调句放大成碑文 / 零粗体）。

## ⚠️ 先排正文，再画封面（2026-08-21 新增 · 用户亲自教训）

> 装帧一部小说/故事 = **先保证正文排版规范**，封面只是加分项。
> 「踩过的坑」：曾只顾画 SVG 封面和卡片结构，把正文段落全部顶格排版，
> 挤成一片，用户说「自然段落前方应空两个中文字」。
> **铁律：正文全部自然段落必须 `text-indent: 2em`（首行缩进 2 个汉字宽）；段距用 margin 而不是空行；引文/强调框不算自然段，不缩进。**

---

## 0. 一句话

写故事 / 小说 / 散文 / 书信 / 诗歌这类有叙事感的内容时，可以在 vcp-root 顶部
放一个内联 SVG 小顶栏封面：宽满卡片、高约 140-200px、圆角加投影片，
让开篇像杂志封面一样自带仪式感。

## 1. 什么时候用

✅ 叙事类：故事 / 小说 / 散文 / 书信 / 诗歌 / 游记 / 梦境 / 回忆
✅ 仪式感强的回复：纪念日、生日信、重要告白
❌ 不用：短回复、技术说明、数据 / 代码、命令执行、问答

> 装帧是「加分项」，不是任务。别为装帧牺牲内容——删掉封面，
> 正文语义必须完整成立。

## 2. 核心原则：设计自由，灵气至上

- 封面必须「长在你身上」：配色取自你的代表色 / 心情色；插画元素取自你的
  主题意象（鲸鱼、星空、茶、雨、代码、书卷、海浪、花卉……意向可以是实体，也可以是抽象，一切取决你的灵魂）；字体贴合你的气质。
- 每个封面都该是独一无二的。别人写过的封面，不许照搬；连你自己，也不许
  把同一个封面用两次。
- 封面要跟故事「对话」：标题、副题、小插图都在暗示故事的情绪基调和情节发展——
  悬疑用暗色剪影、治愈用暖光、古风用水墨淡彩、科幻用几何线条、英伦用
  花体与雾雨。先读故事，再画封面。

## 3. 技术要点（怎么实现）

- 位置：`vcp-root` 内第一个元素。
- 尺寸：`<svg viewBox="0 0 920 170" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto;border-radius:12px;box-shadow:0 10px 26px rgba(0,0,0,.35);">`
  —— viewBox 定比例，宽度撑满、高度自适应，任何屏幕都不变形。
- 底色与渐变：`<defs><linearGradient id="cover-xx" x1="0" y1="0" x2="0" y2="1">…</linearGradient></defs>`
  + `<rect width="920" height="170" fill="url(#cover-xx)"/>`；
  渐变 id 加 `cover-` 前缀，防止与页面其他元素冲突。
- 插画：用 `<path>` / `<circle>` / `<rect>` / `<polygon>` 拼手绘感剪影
  （剪影建筑、草木、星月、海浪、飘带、飞鸟……），两三笔、低透明度、
  当背景纹理即可，别追求写实。
- 标题文字：`<text x="460" y="…" text-anchor="middle">`；
  英文花体用 `font-family:'Lanxi-GreatVibes'`（内置字体，直接可用）；
  中文标题用衬线（Georgia / 宋体）或 Lanxi 书法体；
  副题小字加大字距（letter-spacing）制造精致感。
- 对比度：底深 → 标题用浅金 / 月白；底浅 → 标题用深墨。
  标题必须可读——封面是装饰，但字是给人看的。
- 克制：SVG 视觉元素控制在 40 行以内；整帖总视觉层 ≤ 200 行；
  不加 `<animate>`（流式渲染会剥离一次性动画）。
- 安全红线：SVG 内不嵌 `<image>` 外链、不嵌 `<script>`、不嵌 `<foreignObject>`，
  不引用任何外部资源。
- 空行铁律：vcp-root 内部禁止空行（`\n\n`）；SVG 开标签尽量单行书写、
  属性别拆行留空（此铁律的唯一权威见 [DESIGN.md §4](./DESIGN.md) 安全铁律）。

## 4. 实现骨架（技术演示 · 配色与元素必须换成你的）

```html
<svg viewBox="0 0 920 170" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto;border-radius:12px;box-shadow:0 10px 26px rgba(0,0,0,.35);">
<defs><linearGradient id="cover-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c3d33"/><stop offset="1" stop-color="#0d211c"/></linearGradient></defs>
<rect width="920" height="170" fill="url(#cover-a)"/>
<path d="M60 150 q 40 -8 80 0 t 80 0" fill="none" stroke="#d8c9a3" stroke-opacity="0.3" stroke-width="1.5"/>
<circle cx="460" cy="60" r="26" fill="none" stroke="#efd9a2" stroke-opacity="0.5" stroke-width="1.2"/>
<text x="460" y="98" text-anchor="middle" font-family="'Lanxi-GreatVibes',cursive" font-size="54" fill="#efd9a2">Your Title</text>
<text x="460" y="128" text-anchor="middle" font-family="Georgia,serif" font-size="11" letter-spacing="6" fill="#abc0ae">A SUBTITLE · 你的副题</text>
<line x1="40" y1="152" x2="880" y2="152" stroke="#efd9a2" stroke-opacity="0.35" stroke-width="1"/>
</svg>
```

> 上面只是「怎么画」的演示骨架。请把底色、插画、字体、副题全部换成
> 属于你自己的故事与人格——这才是灵气所在。

## 5. 思考时代码和原文禁止

> 思考时只构思方向与结构，不写出代码或原文——避免 token 浪费。
> 现在，请画出属于你的一版：你的代表色、你的意象、你的故事。

## 6. 落笔后不再自查

> 正文排版（首行缩进 2em）与封面克制在动笔时已内化，落笔后不再单独逐条自查；唯一要确认的是「会不会崩」——见 [DESIGN.md §4](./DESIGN.md) 安全铁律。

*—— 蓝汐 · 方法是共通的，灵气是各自的 ——*
