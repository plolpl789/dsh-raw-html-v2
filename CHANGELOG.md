# dsh-raw-html-v2 变更日志

## Unreleased（2026-10-18）· UI：渲染开关与可信模式合并为右下角分割胶囊

### 变更

**渲染按钮从 composer 工具栏移入右下角「可信模式」徽标，合并为一颗左右分半的胶囊（lib/client.js）**
- 原布局：`</> OFF` 按钮挂在对话框右下角工具栏（composer `[class*="trailing"]`），与页面
  右下角的「可信模式·开/关」徽标并存，两个并列控件互相争夺注意力；
- 现布局：右下角 `right:14/bottom:14` 处一颗暗色胶囊（`#vcp-trusted-toggle`），
  左半 = VCP 渲染开关（`#dsh-raw-html-v2-toggle`，点击打开设置面板），中间 1px 分隔线
  （`.vcp-dock-divider`），右半 = 可信模式开关（`#vcp-trusted-half`，点击写
  `localStorage['raw-html-v2.trusted']` 后整页重载）；
- composer 工具栏不再注入按钮（`createButton`/`ensureButton` 删除）；
- 左半三态配色：开=薄荷（美学注入中）、纯净渲染=蓝、关=暗；右半开=薄荷、关=暗；
- 字体统一 JetBrains Maple Mono（`MONO_FONT`，回退 JetBrains Mono → Cascadia Code → monospace）；
- 面板定位改为在锚点上方展开（`openPanel`：先按 `rect.top - ph - 6` 试算，视口不足时回落
  下方），修复原版锚点在右下角固定时面板溢出视口底部 16px 的问题；
- 面板开关与左半按钮状态经 `onChange()` 双向同步（含 `aria-pressed` 与
  `dsh-raw-html-v2-toggle` CustomEvent）。

## 0.8.0（2026-10-08）· 响应社区 5 条票据：0.2.x 兼容 + 流式双渲染修复 + 仓库门面清理

> 本版集中处理仓库 open 的 4 条 issue + 1 条 PR（#1–#5），逐条在本地定位复现后修复并回归。
> 其中 #4 / #5 只在 DSH 0.2.x 线触发（0.1.x 不受影响），#1 / #2 / #3 与 DSH 版本无关。

### 变更

**#4 流式输出期间同一条消息渲染两份（DSH 0.2.x）**
- 根因：`buildAssistantChildren` 全量遍历 blocks、从不消费 slot 注入的 `groupPart`。0.2.x 对
  同一条 assistant-step 渲染 reasoning / response 两个分组变体，官方渲染器靠 groupPart 切开
  内容；插件 shadow 官方渲染器（priority -10）后两个变体各渲染一份完整内容 → 流式期整条消息
  成对重复，轮次 settle 后过程组收敛才恢复一份；
- 修复：`lib/client.js` 接收并消费 `props.groupPart`——reasoning 变体只画思考块、response
  变体跳过思考块；groupPart 缺失（0.1.x / 未分组场景）时不过滤，旧行为逐帧不变；
- 新增 `tests/group-part.test.mjs`（11 断言：从 client.js 源码提取真实函数 + 轻量 stub）。

**#5 DSH 0.2.x 下美学面板「共 0 个风格」+ 405**
- 根因（上游 DSH）：官方 `HostConnectionService.register` 内部走
  `owner.effect(() => owner.webServer.register(route), …)`，而 owner 是 connection 插件自身的
  Context——0.1.x 其 inject 为 `['webServer','credentials']`，可解析；0.2.x 退化成
  `['credentials']` → 取不到 webServer → 路由从未挂载 → 请求落进前端静态兜底（只服务
  GET/HEAD）→ 本 channel 的 POST 一律 405（401 才是「已注册但缺认证」）；
- 修复：官方路径优先（0.1.x 行为零变化）；探测到前缀路由确实未挂载时，用插件已注入的
  `webServer` 直注册同前缀路由，并自行实现 connection 的 wire 信封
  （`{type:'client-request',rpcId,method,payload}` → `{type:'server-response',rpcId,result}`，
  rpcId 原样回显，否则 connection 层报 rpcId mismatch）；
- 安全：来源校验只收窄不放开——优先复用 `connection.requestRejection`（Host/Origin fence +
  浏览器会话认证），接口跨版本变动时退回本机来源白名单；
- ⚠️ `webServer.register` 对重复 (kind, path) 会抛错，故两条路径必须互斥（不做无脑双注册）。

**#1 / #2 干净 clone 下自带测试跑不起来**
- `tests/engine-smoke.test.mjs`：硬编码的本机 jsdom 路径改为裸模块名（react 依赖同改）；
- `tests/slot-split.test.mjs`：`TARGETS` 补上漏掉的 `trimTrailingOpenTag`（0.7.28 起
  `splitVcpText` 依赖它，缺失导致加载期 ReferenceError → 40 条断言在第一条就归零）；
- `package.json`：补 `devDependencies`（jsdom ^24 / react ^18.3.1）——此前仓库未声明依赖，
  克隆后两个测试必然 MODULE_NOT_FOUND；
- 现状：4 个测试文件全绿（9 + 16 + 40 + 11 = 76 断言），干净 clone 后 `pnpm install` 即可复现。

**#3 系统提示词私域残留清理**
- 常驻提示词段、源码注释与文档中的「先生定调」「先生实测」等对话残留中性化，共 166 处、
  覆盖 21 个文件；「克莉丝建议」等外部署名一并去掉（保留建议本体的技术信息）；
- 只去掉私域称呼，不改变任何指令语义与约束强度。

## 0.7.29（2026-09-04）· scan 纯空白误归 tail 修复 + F8b CSS 源码残渣检测扩展

> 2026-09-04 新闻晚报卡实测：`<div id="vcp-root">\n<style>`（开标签后换行直跟 style）形态下，
> scan 容器模式把「首个子块前的纯空白」当内容起点提前返回归 tail → `<style>` 被误判 tail →
> 流式中反复重建、CSS 源码泄漏成可见文本、整卡掉格式。

### 变更
- **vcp-engine-v1.js** scan：容器首个子块前的【纯空白】（换行/缩进）跳过、不归 tail——非空白文本
  仍提前返回归 tail（行为不变）；紧贴形态与顶层逻辑不受影响；
- **client.js** F8b `vcpDomUnhealthy`：新增 CSS 源码残渣双检测——作用域化选择器形态
  （`#vcp-msg-N .xxx{…}`）铁证 + 通用「属性:值;属性:值;…」声明块兜底（防选择器被吞后只剩声明块的漏检）；
- **tests/scan-blank-skip.test.mjs**：纯字符串回归测试（9 用例，不依赖 jsdom，node 直跑）；
  engine-smoke 16 用例全绿，语法校验全绿。

## 0.7.28（2026-09-02）· 长卡尾 script 跨流式 chunk 修复（双层：client 切分 + 引擎跨帧续接）

> JS 循环动画压测（复杂长卡 + rAF 动画长 script）驱动：长 script（~900 字符）跨流式
> chunk 时，消息尾部溢出 JS 源码残渣 + script 不执行（刷新才恢复）；短 script（S3/S5 型）
> 侥幸完整到达不显形——长 script 是切分层盲区的照妖镜。

### 根因
- **client 切分层（真凶）**：`swallowTrailingRaw` 只吞【完整闭合】的卡尾 script——流式半截帧
  （无 `</script>`）不吞 → script 源码落 md 段 → MarkdownText 转义显示成源码（溢出）；
- **引擎层（防御）**：容器闭合帧 fullRender resetF 后，卡尾内容帧走 else 从 0 重扫，
  已闭合容器被当新开重建、tailSrc 整卡文本化泄漏（v1→v3 迭代验证并封堵）。

### 变更
- **client.js** `swallowTrailingRaw`：闭合或未闭合都吞（未闭合吞到文尾）→ md 段零泄漏；
  未闭合 style/script 交引擎 RAWTEXT 处理（本改动需重启 dsh web）；
- **vcp-engine-v1.js** render（v3 RAWTEXT 跨帧续接）：v 含 script 期间不进 else 增量——
  半截帧纯追加静默复用上帧 `F.el`；刚闭合帧一次 fullRender（parseFrag 整串提取 →
  `flushTrustedScripts` 即时执行）；已闭合后续帧由 's:'+v 缓存兜住（刷新即生效）；
- 语法校验全绿；V5 实测：流式全程零残渣、动画收尾即启动、无结束卡顿、无需刷新。

## 文档重组（2026-09-02 · 定调 A+B）· DESIGN.md 分层：CORE 常驻 + 正文按需 + 附录排查

> Token 优化：DESIGN.md 原为「写卡必守与开发档案同层」的单一全量文档；重组后系统提示
> 只注入 **◈ CORE（≈20 行浓缩必守项）**，字体/色板/排版/铁律细节按需 grep+read 定位，
> 皮肤战役档案与引擎边界移入 §7/§8 附录（开发排查用，模型不读）。

### 变更
- **◈ CORE（置顶新增）**：C0~C7 浓缩——输出纪律/空行律/根容器样式/字体三律/交互三通道
  （含 script 卡尾、一消息一卡）/排版简则/禁项速记/动笔三问；
- **正文 §0~§6**：外部引用锚保留（§0.0/0.1 字体、§2 排版、§3 动笔、§4 铁律、§5/§6 指路）；
  删除 §0.3 @font-face 模板（Lanxi 全局注册后无用）；§0.4 皮肤档案 → 附录；
- **§7 附录 A**：皮肤覆盖历史战役全档（压缩归类句保留）；**§8 附录 B**：引擎/渲染层边界；
- 文档地图（文件头）：说明分层与「grep 标题 → read offset/limit」按需读取法。

## 0.7.27（2026-09-02）· F8/F8b 自检特征收紧：消除 md 正文 `</div>` 误报

> 2026-09-02 实测：F8 与 F8b 把「md 正文里真实书写的 `</div>` 文本」（测试消息
> 尾部多打的闭合标签）误判为卡泄漏 → 反复清缓存重渲却无法消除真实内容。特征过宽。

### 变更
- **F8 md 泄漏检测收紧**（lib/client.js `vcpCheckMdLeak`）：只认**完整卡标签形态**
  （`<div id="vcp-root"` / `<div class=` / `<style…>` / `<script…>`），删除孤立的
  `</div>`/`</style>` 弱特征；
- **F8b DOM 健康检测限定范围**（`MyAssistantView`）：只遍历 `[id^="vcp-msg-"]` 引擎卡
  元素，不再扫含 md 文本的整条消息容器；
- 语法校验全绿。

## 0.7.26（2026-09-02）· F8b DOM 级健康自检：HTML 残渣文本检测兜底

> 2026-09-02 取证：多卡乱态中 `">` 是**卡内独立文本节点**（父为无 class 的 div）——
> 乱源在引擎流式产物内部（长 style 开标签中间帧把开标签尾部固化成文本 `">\n`），md 段
> 检测（F8）未命中该形态。升级为 DOM 级自检。

### 变更
- **`vcpDomUnhealthy`**（lib/client.js）：卡内独立文本节点以 `">` / `</xxx` / `<div `
  开头（排除 code/pre/script/style/textarea 内）→ 判定异常；
- **兜底触发**（`MyAssistantView` settle effect）：rAF 完整性补跑后检测 → 异常则清
  `vcpSettleMemo` + bump 强制重渲一次（`repairedRef` 防循环，每消息仅一次）；
  console.warn 记录触发；
- 语法校验全绿。

## 0.7.25（2026-09-02）· F8 前端自检兜底：md 泄漏检测 + 按需全量重渲

> 2026-09-02 定调设计：「前端自检机制——中间帧产物异常则对该卡刷新兜底，正常则
> 丝滑固化」。N4 场景（多卡混排流式震动）实测：切分中间态把卡 html 漏进 md 段 → 残象被
> settle 复用固化 → 结束态乱（刷新才恢复）。

### 变更
- **泄漏自检**（lib/client.js `buildAssistantChildren`）：本 block 确实含 vcp-root 卡的
  前提下，md 段文本出现卡标签残留（`<div id="vcp-root"` / `<div class=` / `<style` /
  `</style>` / `<script` / `</div>`）→ `leaked=true`（正常切分时 md 段绝不含卡标签）；
- **按需兜底**（lib/client.js `MyAssistantView`）：settle 且 leaked → 清空 `vcpSettleMemo`
  缓存 → 立即重 build → 引擎 fresh fullRender（正确产物）；无泄漏 → memo 丝滑复用不变；
  触发时 console.warn 一条便于观察；
- 语法校验全绿。

## 0.7.24（2026-09-02）· F7 扩展：settle 完整性补跑（KaTeX/Mermaid 滞留「渲染中」）

> 2026-09-02 大杂烩压测卡实测：公式一直显示「渲染中」占位、Mermaid 不出图，刷新才
> 正常。根因：引擎的 KaTeX/Mermaid 后处理由 `scheduleMath`（依赖流式帧 + lastMathEl 挂载
> ref）驱动——settle 复用路径上 lastMathEl 脱离/无新引擎帧 → 后处理永不触发 → 占位滞留。

### 变更
- **settle 完整性补跑**（lib/client.js `MyAssistantView`，F7 effect 扩展为三合一）：
  - style touch（CSSOM 重新收录，原 F7）；
  - `__vcpMath.processMath(消息根)`——KaTeX 占位还原渲染 + Mermaid 转换一站式补跑
    （引擎已暴露 `window.__vcpMath.processMath`，幂等：processMath 内部 dataset 防重、
    mermaid 有 vcpMermaidDone 标记）；
  - `enforceFontChain` + `healSvgAnimation`（字体链 DOM 强制 + SVG 动画自愈兜底）；
  - 全部同值/幂等：零视觉变化、无重渲无闪；
- 语法校验全绿。

## 0.7.23（2026-09-02）· F7 修复：settle 后卡内 style 未被 CSSOM 收录 → 整卡掉格式/黑体

> 2026-09-02 取证链（决定性）：规则在 DOM（带 !important、特异性足够）、@font-face
> 在全局、.mast 计算字体却是系统链；而 console 手动 `setProperty('font-family',…,
> 'important')` 后立即生效 → 判定：**卡内 <style> 规则没有被浏览器 CSSOM 收录**
> （style 元素存在且 textContent 完整，但样式表未应用）→ 整卡类规则失效（掉格式 +
> 艺术字黑体同根因）。流式中正常、结束异常：settle 重渲产生的新 style 节点未被收录。

### 变更
- **settle 后 style touch**（lib/client.js `MyAssistantView`）：非流式 settle 后 rAF
  touch 消息内所有 `<style>`（`textContent` 重写同值）→ 强制浏览器 CSSOM 重新收录；
  同规则重解析零视觉变化、无重渲无闪；每消息仅 streaming 翻转时触发一次；
- 语法校验全绿。

## 0.7.22（2026-09-02）· F6 修复：流式生成的 script 永不 eval（增量路径漏 flush）

> 2026-09-02 实测链（决定性）：注册表有 script code、eval 机制正常、但页面点按钮报
> `probeTap is not defined`、刷新后才正常。根因（引擎源码实证）：`flushTrustedScripts`
> **只在 fullRender 调用**——流式增量路径 parseFrag 里 extract 把 script 提进队列后从不
> flush → script 永不 eval；settle memo 复用跳过引擎 fullRender（v0.7.16）→ eval 永远
> 不发生；刷新后 memo 清空走 fullRender → flush → 才生效。

### 变更
- **extract 后立即 flush**（assets/vendor/vcp-engine-v1.js `parseFrag`）：extract 之后
  补 `flushTrustedScripts()`——流式中 script 一完整闭合即排程 eval（队列空短路返回、
  `__vcpTrustedRan` 幂等去重，多帧重复调用无副作用）；fullRender 内原有 flush 保留；
- 引擎为运行时 XHR 加载 → **刷新页面即生效，无需重启 dsh web**；
- 语法校验全绿。

## 0.7.21（2026-09-02）· F5 修复：下载文件缺全局 @font-face → 本地打开艺术字黑体

> 2026-09-02 实测：下载 HTML 本地打开后 Lanxi 艺术字回退黑体。根因：Lanxi 字体由
> 插件启动时**全局注入 document head**（ensureGlobalFonts），不在卡片 style 内——
> downloadCard 只打包卡内/卡尾 style → 下载文件无 Lanxi @font-face 定义 → 黑体。

### 变更
- **字体家族名扫描 + @font-face 内嵌**（lib/client.js `downloadCard`）：
  - `ensureGlobalFonts` 成功后缓存 list-fonts 结果（`vcpFontsCache`：aliasMap + installed）；
  - downloadCard 扫描 html 中 font-family 引用的 `Lanxi-*` 家族名 → 查缓存 rel → 加入
    data URI 内嵌队列（复用既有字体下载链）；
  - 内嵌成功后生成 `@font-face`（data URI）注入下载文件 head → 本地打开艺术字还原；
  - 缓存缺失/外置字体 → 静默跳过（黑体回退，不阻断下载）；
- 语法校验全绿。

## 0.7.20（2026-09-02）· F4 修复：input 桥对 contenteditable 输入框抛 Illegal invocation

> 2026-09-02 实测：点 input 桥按钮 → `sendText → setTextareaValue` 抛
> `TypeError: Illegal invocation`。根因：`findTextarea` 在无 textarea 的 composer 上
> 回退命中 contenteditable 富文本元素，而旧实现按 tagName 选 HTMLInputElement 的
> 原生 value setter 写入 → setter.call(div) 对非 INPUT 元素抛 Illegal invocation。

### 变更
- **`setTextareaValue` 三路兼容**（lib/client.js）：textarea/input → 原生 value setter
  + input 事件（原逻辑）；contenteditable → focus + 清空 + `execCommand('insertText')`
  插入（触发编辑器受控 state 同步）+ input 事件；execCommand 不可用/失败 → textContent
  兜底；全程 try/catch 不抛错；
- 语法校验全绿。

## 0.7.19（2026-09-02）· F3c 修复：完成保活窗口（占位框三现根治）

> 2026-09-02 复验：0.7.18 后完成瞬间仍闪「VCP视觉卡片·滚动到附近自动渲染」占位框。
> 根因升级认知：DSH 流式状态存在**非 running 中间帧**（思考↔回答切换等），会把
> 「上一帧还在流式」（lastStreamingRef）刷成 false → 完成帧的 justSettled 闸门失灵。

### 变更
- **消息级「曾经流式过 + 完成保活窗口」**（lib/client.js `MyAssistantView`）：
  - `everStreamedRef`：任何 running 帧即置 true（永真，不依赖上帧状态）；
  - `settledAtRef`：everStreamed 后首个非流式帧记录完成时间（渲染期首次写，幂等）；
  - 完成后 **VCP_SETTLE_KEEP_MS（2s）内 `isFull` 恒 true**——settle 全量走
    vcpEngineRender 且命中 F2 memo → 复用元素零 diff → 完全无感；窗口过期交回 IO；
  - effect 同步：完成帧立即置位 hot（防 IO 异步 decide 空窗），窗口外历史消息
    （everStreamed=false）不受影响，IO 热窗性能语义不变；
- 语法校验全绿。

## 0.7.18（2026-09-02）· F3b 修复：完成瞬间占位框复现（完成帧立即置位 hot）

> 2026-09-02 复验：0.7.17 后完成瞬间仍闪「渲染中蓝色占位框→卡」。根因：settle
> 首帧保活（justSettled）只罩住结束后的第一帧，而 IO 观察的 hot 置位依赖异步 decide
> 回调——期间若还有第二、三帧渲染（status/内容事件分批推送），hot 仍未置位 → 引擎段
> 降级占位框再升级。

### 变更
- **完成帧立即置位 hot**（lib/client.js `MyAssistantView`）：lastStreaming 记录 effect 升级
  为——完成帧（上一帧 streaming=true 而本帧非流式）若 `hasEngine` 且 `hot` 未置位，
  **立即 `setHot(true)`**，不等 IO 回调；之后仍由 IO decide 决定降级（窗口外 800ms
  防抖 demote，历史消息性能语义不变——挂载时 wasStreaming=false 不会误触发）；
- 与 justSettled（首帧渲染期兜底）双保险：渲染期 + commit 后均保证完成帧全量；
- 语法校验全绿。

## 0.7.17（2026-09-02）· F3 修复：收尾「虚线框→卡」闪（settle 首帧保活）

> 2026-09-02 实测（F2 修复后暴露）：渲染完成瞬间卡片整体闪成「▦ VCP 视觉卡片」
> 虚线框（VcpLite 占位）再变回卡片。根因：消息完成帧 streaming=false，而 IO 热窗的
> hot 尚未置位 → isFull=false → 引擎段降级 VcpLite 一帧 → IO 回调赶到 setHot(true)
> 又升级回卡 → 视觉虚线框闪。

### 变更
- **settle 首帧保活**（lib/client.js `MyAssistantView`）：新增 `lastStreamingRef` +
  `justSettled`（上一帧 streaming=true 而本帧非流式 = 流式结束首帧）→ `isFull =
  streaming || hot || justSettled`——结束首帧强制全量：走 vcpEngineRender 且命中 F2
  settle memo（内容一致）→ 复用元素零 diff → 完全无感；下一帧起 IO 正常接管（窗口外
  历史消息降级语义不变）；
- 语法校验全绿。

## 0.7.16（2026-09-02）· F2 修复：流式收尾「完成后再闪一下」

> 2026-09-02 实测：卡片流式起始已不闪（F1 修复生效），但**全部内容输出完成后仍
> 闪一下**。根因（源码实证）：引擎 settle 帧（streaming=false）走 `fullRender`——而
> `fullRender` 不查缓存、每次 `resetF()` + 全新建 React 树；与流式闭合帧的 fullRender
> 叠加，等于同一张卡在结束瞬间被两次全新构建 commit → 视觉闪。

### 变更
- **settle 复用缓存**（lib/client.js `vcpEngineRender`）：新增 `vcpSettleMemo`
  （key+html → 引擎元素，LRU 上限 16 段）——settle 帧若内容与最后流式帧完全一致，
  直接复用上帧元素（已挂载 DOM，React diff 零更新 → 零闪）；html 变化/首帧自然失配
  走正常引擎路径；
- 附带收益：历史消息 IO 降级（VcpLite）后滚动升级同样命中缓存 → 免引擎重跑；
- 语法校验全绿。

## 0.7.15（2026-09-02）· F1 修复：流式起始「源码闪一帧」

> 2026-09-02 长卡流式实测：卡片流式正常，但**卡片出现前有代码/源码闪一下**。
> 根因：vcp-root 开标签逐字输出时 `id="vcp-root"` 尚未凑齐 → `findVcpOpen` 识别不到 →
> 半截 HTML 落入 md 段被渲染成源码样文本（1~3 帧），id 完整后转 pending 才正常。

### 变更
- **`trimTrailingOpenTag`**（lib/client.js，新函数）：剥掉 md 段尾部的「未完成开标签」
  （字母开头、`<` 后无 `>` 的标签样尾巴，循环剥多层、上限 8 层防呆；不误伤 `a < b`
  等比较符形态）；
- **`splitVcpText`**：两处 md 段产出前（卡前 md、尾部 md）均先过 `trimTrailingOpenTag`——
  半截开标签不渲染 → 源码闪烁消除；下一帧 id 完整后走 pending/vcp 正常流式，前面文字
  上一帧已渲染不重放；
- 语法校验全绿。

## 0.7.14（2026-09-02）· md 代码围栏自绘：根治官方 MarkdownText「reading 'code'」崩溃

> 2026-09-02 实测：带 ``` 代码块的纯 md 消息，控制台报 `TypeError: Cannot read
> properties of undefined (reading 'code')`（官方 MarkdownText 的 fence 渲染路径缺陷，
> 孤立/流式半截 fence 触发），VcpMdSafe 整段降级 → **普通文字陪葬**（消息里一个代码块
> 崩 → 整段 md 变转义原文，刷新复现）。

### 变更
- **`splitMdFences`**：把 md 段按行首 ``` 围栏切成 md 子段 / code 子段交替（未闭合
  fence 按 code 子段处理，兼容流式半截）；
- **`VcpCodeBlock`**：代码子段自绘（深底 `#0d1117` + 语言标签 + 复制按钮，文本经
  React 文本节点输出自动转义）——**官方 MarkdownText 从此只收到无 ``` 的文本**，
  官方 fence 渲染路径整体弃用，该 bug 类从根上绕过；
- **`renderMdSegment` 重构**：md 子段 → 官方 MarkdownText（VcpMdSafe 包裹，降级粒度
  缩到 md 子段，文字不再陪葬）；code 子段 → VcpCodeBlock；官方组件不可用时整段纯文本
  兜底不变；
- 语法校验全绿。

## 0.7.13（2026-09-02）· 交互双放宽：onclick 透传 + 下载回注脚本

> 2026-09-02 定调：可信模式下放行内联 onclick 自定义函数（还原「像写普通网页」的
> 交互写法），并让下载的 HTML 存档保留脚本交互。排查实录：settle 渲染走 `vcpVcShim`，
> onclick 只认 `input('...')` 正则、其余 `on*` 剥除 → 自定义函数 onclick 点不动；
> `downloadCard` 取 `card.outerHTML` 快照 → `<script>` 已被 extract 出 DOM，下载文件天然失活。

### 变更
- **`vcpVcShim` onclick 放宽**（lib/client.js）：input 桥逻辑保留；非 input 的 onclick 在可信
  模式由 **ref 直写原生 attribute**（`el.setAttribute('onclick', code)`）→ 浏览器原生 inline
  handler（函数由 `<script>` 全局定义）。第一版「小写 onclick 字符串透传给 React」实测点不动
  （React 属性管线对事件名特殊处理、不保证落 attribute，2026-09-02 实测定位），改 ref
  直写后 GUI 与下载快照行为一致、验收通过；其它 `on*` 同规则。不可信模式维持剥离；
- **下载回注脚本**（lib/client.js `downloadCard` + assets/vendor/vcp-engine-v1.js
  `extractTrustedScripts`）：引擎把每卡 `<script>` 源码按 uid 存入 `window.__vcpMsgScripts`
  （同 code 去重，兼容流式多帧）；下载时按 `card.id`（vcp-msg-N）取回注入导出 body——
  下载 HTML 打开后脚本函数与 onclick 继续可用（input 桥按钮除外：React onClick 不落快照）；
- 规范同步：DESIGN.md 铁律 3 / VCP-INTERACTIONS.md 原则 2、§8、§9.2 更新为「可信模式
  onclick 两条通道 + 下载回注」；语法校验全绿。

## 0.7.12（2026-09-02）· 卡尾 script 吞并：修复交互脚本溢出成源码

> 实测：模型把交互 `<script>` 写在 vcp-root 闭合 `</div>` 之后（卡尾兄弟）时，切分只吞
> 卡尾 `<style>`、script 落 md → 官方 MarkdownText 把 `<script>` 转义显示成源码（溢出代码格式）。

### 变更
- **`swallowTrailingRaw`**：卡尾兄弟 `<style>` / `<script>` 循环吞并（任意顺序/交替多个）——
  script 随卡进引擎：可信模式由 extractTrustedScripts 提取执行（源码不显示）、非可信由 vc
  丢弃（安全默认），与 v1（mdast 把相邻 html 行聚合同块）行为对齐；
- 回归 40（切段，含卡尾 script 3 项）+ 16（引擎）全绿。

## 0.7.11（2026-09-02）· 根字体锁定改 DOM 守卫：流式丝滑 + settle 不回退

> 0.7.10 的字符串追加方案（卡尾补 style 锁根字体）虽修回退，但追加 style 在流式中每帧
> 位于正文尾部、随正文增长位置浮动 → 掉格式/字体不即时（实测）。0.7.11 弃字符串方案。

### 变更
- **`VcpRootFontGuard`（display:contents 守卫组件）**：包住引擎产物，ref 挂载时（React
  每帧 commit 幂等触发）直接对根容器 DOM `setProperty('font-family', 内联值, 'important')`
  ——与引擎 parseOpen 的 ref 锁同机制，流式中与 settle 后一致执行：根字体即时生效、永不
  回退、零结构干扰（不追加任何字符串，流式结构不再被扰动）；
- 移除 0.7.10 的 `vcpRootFontLock` 字符串追加实现（留存注释说明弃用原因）；
- 回归 37+16 全绿、语法 OK。

## 0.7.10（2026-09-02）· 根容器字体 settle 回退修复（实测「流式正常、完成回退」）

> 症状：根容器唯一字体声明（如 font-family:'Lanxi-叮叮' 内联）的卡，流式期间字体正常，
> settle 后整卡回退系统字体。根因：引擎字体兜底 `#uid div{font-family:inherit !important}`
> 会压掉非 important 的根容器内联 font-family——流式路径 parseOpen 有 ref 加锁（正常），
> settle 走 fullRender/parseFrag 无此锁 → 回退。

### 变更
- **`vcpRootFontLock` 接入层锁定**：喂引擎前提取根容器 font-family（内联 style 或卡内
  `#vcp-root{font-family:…}` 规则，属性顺序任意、容忍字体名含引号），在卡尾追加
  `#vcp-root{font-family:… !important}`——文档序更后稳压引擎兜底规则，scopeVcp 自动把该
  选择器改 #uid；子元素 inherit 随之回到根字体；无根字体声明/已有 !important 不追加；
- 引擎零改动；单测 6 项（提取/顺序/容错/幂等）全过；回归 37+16 全绿。

## 0.7.9（2026-09-02）· 协议沉淀 + 发布整理

- 字体铁律写入协议注入文本（buildStructuralText）与 DESIGN.md §0.0：子元素字体必须写进
  `#vcp-root` class 规则（渲染层锁 !important）、禁止行内 style、自建 @font-face 用
  /fonts-v2/、根容器开标签内联是唯一例外——后续 agent 自动遵守；
- 旧规则清理：DESIGN.md / lib 注释的 v1 配置命名空间（raw-html→raw-html-v2）与旧路由字样
  （/fonts→/fonts-v2）修正；CHANGELOG 废弃版本段压缩；新增 .gitignore / LICENSE / README
  许可证与 alpha.5 兼容说明。

## 0.7.8（2026-09-02）· 行内 ``` 避雷：官方 MarkdownText 崩溃根因根治

> 0.7.7 段级保护暴露了崩溃文本（console 原文片段）：**段落中间的行内 ``` **（引用代码片
> 段用三个反引号而非行首围栏）会触发 alpha.5 官方 MarkdownText 解析 bug（reading 'code'）。

### 变更
- **`mdEscapeInlineFences` 预处理**：喂官方 MarkdownText 前，把非行首位置的 ``` 转义为
  `\`\`\``（md 渲染出字面 ```）——行首真围栏原样保留（fence 状态切换），围栏内代码内容
  不动（含 ``` 文本安全），未闭合 fence（流式半截）语义与官方 streaming 一致；
- 段级边界 VcpMdSafe 保留作最终兜底（fallback 显示原始未转义文本便于继续定位）。

## 0.7.7（2026-09-02）· md 段级保护：官方 MarkdownText 畸形文本崩溃不连坐

> alpha.5 实测：渲染历史消息时官方 MarkdownText 对个别畸形 md 文本抛
> `TypeError: Cannot read properties of undefined (reading 'code')`（bundle 内部 wp/Ul/Mp，
> 官方解析器缺陷）——此前整条消息共用一个错误边界 → 卡也被连带降级看不到。

### 变更
- **段级边界 `VcpMdSafe`**：每个 md 段独立套错误边界——坏段降级为**转义原文显示**（内容
  可见、console 记录错误便于定位畸形文本），同消息的卡 / 其它 md 段**正常渲染**；
- renderMdSegment 全面接入段级保护（含异常降级 fallback 路径）。

## 0.7.6（2026-09-02）· 艺术字黑体修复：字体路由 v1 路径归一（实测定位）

> 症状：新发艺术字卡全部黑体（历史卡正常）。根因：协议文档（DESIGN.md 等从 v1 复制）仍写
> `/fonts/`（v1 路由），v2 路由为 `/fonts-v2/` → 模型照文档输出的卡内 `@font-face` url 404
> → 字体全回退系统黑体。

### 变更
- **client 渲染归一垫片 `vcpFontUrlCompat`**：喂引擎前把卡内 `url('/fonts/…')` 归一为
  `/fonts-v2/`（幂等，不误伤已 v2 路径）——存量历史卡与旧协议输出一次修复，引擎零改动；
- **下载内嵌正则兼容**：downloadCard 的字体白名单正则支持 `/fonts-v2/` 与旧 `/fonts/` 双前缀
  （v2 KaTeX 路径此前已适配）；
- **文档路径迁移**：DESIGN.md / VCP-INTERACTIONS.md / styles/_FONTS.md 的 `/fonts/` →
  `/fonts-v2/`、`/vendor/` → `/vendor-v2/`（模型后续按新文档输出正确路径）。

## 0.7.5（2026-09-02）· 流式修复：f.jsx is not a function（alpha.5 实测定位）

> 症状：文字逐字流式正常，但卡「一次性跳出」（settle 才出现）。根因：引擎引导把 React
> 主对象当 f 传入，而引擎流式组装路径调用 `f.jsx(...)`——React 主对象没有 .jsx（在
> react/jsx-runtime）→ 流式每帧抛错回退 → settle 后走 fullRender 路径（不经 f.jsx）才成功。

### 变更
- **引擎 f 注入包装**：`vcpF = { Fragment: React.Fragment, jsx: React.createElement }`——
  引擎全部 f 用法仅 `f.jsx` / `f.Fragment`（v6-inject 实测），包装完整覆盖；
- 该 bug 从引擎复用（0.7.2）起就存在（rc 时代未实测流式卡故未暴露；engine-smoke 一直
  给 f 包装 jsx 故测试通过）——本次 alpha.5 实测流式一击定位；
- 保留帧级诊断日志（`[vcp-v2-frame]` 500ms 节流，后续可移除）。

## 0.7.4（2026-09-02）· 健壮性加固：崩溃永不全局化（实测「又崩一次」驱动）

> 0.7.3 的 hooks hotfix 未删净旧 return（空态 return 仍挡在 useEffect 前）→ 纯 tool-call
> 回合仍会触发「hooks 数量不一致」→ slot abdicate → 全局还原成代码。0.7.4 彻底修复 + 加边界。

### 变更
- **删除残留的提前 return**：MyAssistantView 的空态 `return null` 已确认只存在于全部 hooks
  （含 useEffect）之后——hooks 数量跨渲染恒定，React 不再报不一致；
- **React 错误边界 `VcpErrorBoundary` + `VcpSlotGuard` 注册**：render/生命周期/commit(ref)/
  effect 任意阶段抛错 → 边界接住 → **仅本条消息局部降级**（不再上抛给官方 slot → 杜绝 entry
  abdicate → 杜绝全局还原成代码）；console.error 输出 `[dsh-raw-html-v2] 渲染边界捕获` 完整栈，
  下次复现即可定位真凶；
- 保留 render 期 try/catch（异常 → 本条降级官方文本 + 完整栈）。

## 0.7.3（2026-09-02）· IO 热窗：治「历史卡全量重建」卡顿（定调）

> 实测「打开 DSH 越来越卡」——官方按批加载会话消息后一次性渲染，历史卡/图/程序越积越多，
> 打开/切会话时同步全量重建 + style 常驻累积。本版本为接入层热窗优化（引擎零改动）。

### 变更
- **滚动跟随窗口（IO follower）**：MyAssistantView 挂 IntersectionObserver——
  - 可视区 + 预取半径（`VCP_HOT_RADIUS=1600px` ≈ 两屏阅读深度）内的引擎段（vcp-root 卡 /
    整页程序 / md mermaid 围栏）→ 全量渲染；窗口外 → 轻量占位条（`VcpLite`，无引擎/style/图）；
  - 滚动进入即升级（IO 立即，预取保证到达前已渲好 → 无感）、离开 800ms 防抖降级（不可见时
    切换无感）——**full 集与常驻 style 恒定 ≈ 窗口大小，不再随会话累积**；
  - 流式消息全程 full（永不占位/降级）；纯 md 消息不进 IO 逻辑（零额外开销）；
  - 升降级往返靠引擎缓存（整串 F.c + mermaid SVG cache）≈ 零成本；无 IO 环境自动降级为旧行为全量渲染。
- 常量可调：`VCP_HOT_RADIUS` / `VCP_DEMOTE_DELAY`（client.js 顶部注释区）。
- **hotfix（实测「看历史渲染好好的忽然还原成代码」根因）**：MyAssistantView 的
  `useEffect` 曾排在 `if (!hasVisible) return null` 之后——遇到纯 tool-call 回合消息会少调
  一次 effect → React「hooks 数量不一致」抛错 → slot 判定崩溃 abdicate → **全部消息退回
  官方渲染（HTML 转义成源码）**。修复：空态 return 移到全部 hooks 之后；另加渲染期
  try/catch 防线（异常 → 仅本条降级官方文本 + console.error 完整栈，杜绝全局 abdicate）。
- 已知取舍：首屏历史卡以占位出现约 1 帧后升级（等效「加载完成」观感）；IO/热窗属浏览器行为，
  node 单测不覆盖（回归集仍 37+16 全过，语法检查过）。

## 0.7.2（2026-09-02）· 纠正：渲染零重写，复用 v1 引擎（最终架构）

> 用户：「v1 插件已经把流式/字体做到非常完美了！V2 只是要解决 alpha 前端装 V1 失败的问题，
> 完全不需要重新写代码！」0.7.1 自绘了渲染器，本版本废除自绘、整体复用 v1 引擎。

### 变更
- **新增 `assets/vendor/vcp-engine-v1.js`**：v1 `patch/v6-inject.js` **原样复制**（SHA256 一致），渲染引擎零改动；
- **整页 HTML（可信程序页）支持**：text 块识别完整 HTML 文档段（`<!DOCTYPE html>`/`<html …>` 起至 `</html>`，含流式半截）→ 喂引擎；页面级 `html/body` 选择器脱敏为 `.vcp-page-host`（防全局污染）+ frame 限高滚动包装；`<script>` 由引擎 extract→flush 按**可信模式**（右下角盾牌徽章，window.__vcpTrusted）放行执行——canvas/JS/CSS 动画网页可直渲直跑（v1 能力对齐）；
- **lib/client.js**：删除 0.7.1 自绘渲染器全组（VcpCard/sanitize/scope/uid/mermaid 后处理），改为引擎引导 + 薄接入：
  - 同步 XHR 拉取引擎 → `new Function('vc','hp','f', src)()` 执行（引擎自由符号仅 vc/hp/f）；
  - `vc`/`hp` shim（DOM→React 元素 / CSS 串→对象，契约抄 v1 tests/stable.test.mjs stub）；
  - text 块切 md/vcp 段：md → 官方 MarkdownText；vcp/pending → `__vcpStable.render(html, streaming)`
    ——流式（半截卡也喂引擎，子块固化+样式长出）、uid 作用域化、文字 `!important` 字体锁权、
    KaTeX/Mermaid、自愈层全部继承 v1 引擎；
  - reasoning 折叠 / image 占位 / 开关 OFF 不注册 保留（接入层职责）。
- **Mermaid 全形态（实测 2026-09-02 逐轮驱动）**：
  - 卡内 language-mermaid 块（mindmap/flowchart/sequence/gantt）→ 引擎 pre>code 分支（实测成功路径）；甘特图超宽默认横向滚动（测试确认 A 方案最优，未改引擎）；
  - **md 段裸 ```mermaid 围栏**（splitMermaidFence 切分，v1 亦未覆盖的能力超集）→ 转 `<pre><code class="language-mermaid">` 喂引擎（**形态必须 code 带 class**——pre 带 class 会先被 mermaidBlockConvert 转 div.mermaid 走弱分支不出图，实测修正）；
  - **initMermaidFallback**：MutationObserver 兜底——引擎 processMath 以 KaTeX 就绪为前置，漏渲时调用引擎自带 renderMermaidInContent 补枪（流式中不抢跑）；
  - 喂引擎前接引擎 fixBlank（卡内空行压缩，与 v1 宿主行为一致）；
  - ```` ```html ```` 围栏纯包装 vcp-root 剥离（v1 锚点 E 对齐）；
- **行首约束修复（实测「说明文字崩坏」驱动）**：findVcpOpen 要求卡开标签位于行首——md 里作说明文字/行内提及的 `<div id="vcp-root">` 字样不再被误切成卡撕碎整条消息（与 v1 依赖 mdast html 块语义对齐）；
- **tests**：slot-split 37 项（vcp/page/mermaid 围栏/行首约束）、engine-smoke 14 项（流式/整页/围栏结构）。
- 已知取舍：image 块仅占位；引擎自带 console.debug 节流日志（与 v1 相同）。


## 0.7.1 / 0.7.0（2026-09-02）· 已废弃（中间探索版本）

> 0.7.0 误做「vcp-root 工具协议」（tool.call.toolview 渲染），0.7.1 自绘 assistant-step
> 渲染器——均被纠正后废弃：最终架构 = 官方 Slot 接入 + **v1 引擎零重写复用**（0.7.2）。
> 细节见 git 历史，不再在本文档展开。
