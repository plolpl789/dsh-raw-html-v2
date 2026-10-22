/**
 * dsh-raw-html —— VCP 视觉通感协议支持（浏览器半侧）。
 *
 * 职责：
 * 1. 在【页面右下角】挂一枚「左右对半」的融合徽标（v7.3 · 定调 2026-10-18）：
 *    左半是「</>」VCP 渲染开关（点击弹出设置面板），右半是可信模式开关，中间
 *    一条分隔线切开、共用一颗胶囊外壳——视觉上是同一个按钮。设置面板内含两个
 *    独立开关：
 *    - 渲染 HTML：驱动 localStorage['dsh.rawHtmlV2']——开启时本插件以官方 Slot
 *      （conversation.chat.node · assistant-step）替换渲染器接管消息渲染，把正文里
 *      裸输出的 <div id="vcp-root"> HTML 渲染成卡片；关闭时不注册渲染器，回退
 *      官方默认（HTML 转义为源码）。切换后自动强制刷新页面让 apply 重新判定。
 *    - 美学注入：驱动 Host 侧美学协议注入（仅渲染开启时可用，置灰即强制关闭）。
 *    切换任一开关后自动强制刷新页面（新状态立即生效、全部消息重渲染）；
 *    面板底部另备「强制刷新页面」按钮，供调试注入代码时手动刷新。
 * 2. 注入 window.__dshInput(text)：VCP 卡片内按钮 onclick="input('...')"
 *    桥接到这里，把文本填入输入框并发送。
 * 3. 渲染机制：官方 Slot API（conversation.chat.node 的 assistant-step 替换渲染器）
 *    遍历 node.data.blocks——text 块切出 vcp-root HTML 段后，直接交给【v1 渲染引擎】
 *    （assets/vcp-engine-v1.js = v1 patch/v6-inject.js 原样复制，经 new Function 注入
 *    vc/hp/f 加载）：流式增量 / 字体链 !important 锁权 / uid 作用域化 / KaTeX·Mermaid /
 *    自愈层全部由 v1 引擎包办（v1 成熟能力零重写）；普通 markdown 交官方 MarkdownText。
 *    不依赖前端 bundle 补丁，压缩器/版本漂移免疫（rc 与 alpha 全版本线可用）。
 * 3. 可信模式（Trusted Mode）v7.2：isTrusted() + 右下角「可信模式」盾锁徽章 +
 *    window.__vcpTrusted 定义——随插件启停；主 bundle 渲染层（vc()/parseOpen）
 *    对 window.__vcpTrusted 均为防御式调用，插件停用时自动回退安全默认。
 *
 * 本文件为手工维护的 __ModuleLoader__.load bundle（与 dsh-maid-emoji
 * 约定一致），不含 JSX；修改后执行 `node --check lib/client.js` 验证语法，
 * 刷新页面即生效。
 */
window.__ModuleLoader__.load({
  id: 'dsh-raw-html-v2',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    // v2 新增：React（官方 Slot 渲染组件用，与 maid-emoji 约定一致的手写 bundle）
    var React = require('react')
    var createElement = React.createElement
    var useEffect = React.useEffect
    var useRef = React.useRef
    var useState = React.useState

    var RENDER_KEY = 'dsh.rawHtmlV2'
    var AESTHETIC_KEY = 'dsh.rawHtmlAestheticV2'
    var SUBAGENT_KEY = 'dsh.rawHtmlSubagentInjectV2'
    var BTN_ID = 'dsh-raw-html-v2-toggle'
    var PANEL_ID = 'dsh-raw-html-v2-panel'
    /** 切换开关后延迟强制刷新页面的等待时间（ms）：先让状态落盘 + 上报 Host，再整页重载。 */
    var RELOAD_DELAY = 250
    /** Host 侧 RPC 调用器（可空）：开关切换时上报渲染/美学/子代理注入状态，驱动系统提示词注入。 */
    var hostRpc = null
    /** 延迟刷新定时器（防连点：后一次切换重置前一次）。 */
    var reloadTimer = null
    /** 面板内开关行的刷新回调（面板打开时挂载，关闭时清空）。 */
    var renderRowRefresh = null
    var aestheticRowRefresh = null
    var subagentRowRefresh = null

    // ---- 状态 ------------------------------------------------------------

    // v6.35 三态化（定调 2026-08-29）：渲染开关与渲染器判定一致——
    // undefined（从未点过「</>」）= 默认开启；"1" = 开；"0" = 显式关闭。
    // 旧实现 === '1' 会把「从未设置」当作关闭，与 v6-inject 启动自检默认开启冲突。
    function isRenderEnabled() {
      try { return window.localStorage.getItem(RENDER_KEY) !== '0' } catch (e) { return true }
    }
    function setRenderEnabled(on) {
      try { window.localStorage.setItem(RENDER_KEY, on ? '1' : '0') } catch (e) {}
    }
    /** 美学开关：无记录默认关闭（渲染/美学已解耦）。旧版单开关迁移见 migrateState。 */
    function isAestheticEnabled() {
      try { return window.localStorage.getItem(AESTHETIC_KEY) === '1' } catch (e) { return false }
    }
    function setAestheticEnabled(on) {
      try { window.localStorage.setItem(AESTHETIC_KEY, on ? '1' : '0') } catch (e) {}
    }
    /** 子代理注入开关：无记录默认开启（保持旧行为）；关闭后子代理的系统提示词不带 VCP 协议段。
     *  仅影响 Host 侧提示词注入（不影响渲染），故切换时不强制刷新页面。 */
    function isSubagentInjectEnabled() {
      try { return window.localStorage.getItem(SUBAGENT_KEY) !== '0' } catch (e) { return true }
    }
    function setSubagentInjectEnabled(on) {
      try { window.localStorage.setItem(SUBAGENT_KEY, on ? '1' : '0') } catch (e) {}
    }
    /** 旧版单开关迁移：曾开启渲染（dsh.rawHtml=1）但无美学键 → 视为美学也开（保持旧体验，仅一次）。 */
    function migrateState() {
      try {
        if (window.localStorage.getItem(RENDER_KEY) === '1' && window.localStorage.getItem(AESTHETIC_KEY) === null) {
          window.localStorage.setItem(AESTHETIC_KEY, '1')
        }
      } catch (e) {}
    }

    // ---- 可信模式（Trusted Mode）v7.2 · 定调 2026-08-29 → v7.2 迁入插件层 ----
    // 双人私密会话内容双方可信 → 正文可放行 script（WebGL/Shader/fetch 由此解锁）。
    // v7.2 起本模块由插件 client 层提供：安装插件 = 可用，停用插件 = 徽章消失、
    // window.__vcpTrusted 未定义 → 主 bundle 渲染层（vc()/parseOpen）防御式调用
    // 自动返回 false（安全默认），可信模式彻底跟随插件生命周期。
    // 开关：localStorage['raw-html-v2.trusted']==='1' 或 window.__DSH_TRUSTED__===true。
    function isTrusted() {
      try {
        if (window.__DSH_TRUSTED__ === true) return true
        if (window.localStorage.getItem('raw-html-v2.trusted') === '1') return true
      } catch (e) {}
      return false
    }
    // 立即暴露给主 bundle 渲染层（v6-inject 的 isTrusted 与 vc() 条件过滤均防御式调用它）。
    window.__vcpTrusted = isTrusted
    // ---- 右下角融合胶囊（v7.3 · 定调 2026-10-18）---------------------------
    // 原来两枚按钮各占一处：composer 尾部工具栏的「</>」渲染开关 + 页面右下角的
    // 「可信模式」徽章。现合并为右下角一颗暗色胶囊：左半 = 「</>」VCP 渲染开关
    // （点击弹出设置面板），右半 = 可信模式开关，中间 1px 分隔线切开——视觉上
    // 是一个按钮的左一半/右一半。composer 不再注入任何按钮。
    // 徽章「加载即挂」：自带 DOM 就绪轮询（400ms×10s），与 v6-inject 语义一致。
    var MONO_FONT = "'JetBrains Maple Mono','JetBrains Mono','JetBrains Mono NL','Cascadia Code',ui-monospace,monospace"
    // 胶囊外壳：暗色 + 半透明描边，压在所有内容之上。
    var DOCK_CSS =
      'position:fixed;right:14px;bottom:14px;z-index:900;display:inline-flex;align-items:stretch;' +
      'border-radius:999px;overflow:hidden;border:1px solid rgba(148,163,184,.28);' +
      'background:rgba(9,14,24,.88);box-shadow:0 4px 18px rgba(0,0,0,.45);user-select:none;'
    // 两半共用基态（等宽、暗底、不高亮）。
    var HALF_BASE =
      'display:inline-flex;align-items:center;gap:5px;height:27px;padding:0 11px;' +
      'font-size:12px;line-height:1;letter-spacing:.03em;font-family:' + MONO_FONT + ';' +
      'cursor:pointer;white-space:nowrap;user-select:none;border:0;background:transparent;' +
      'transition:background .15s ease,color .15s ease;'
    // 左半（VCP 渲染）：开=美学注入（薄荷强调）、纯净渲染（蓝）、关（暗）。
    var HALF_ON =
      HALF_BASE + 'background:rgba(52,211,153,.16);color:#6ee7b7;font-weight:600;'
    var HALF_PURE =
      HALF_BASE + 'background:rgba(96,165,250,.14);color:#bfdbfe;'
    var HALF_OFF =
      HALF_BASE + 'background:rgba(226,232,240,.04);color:rgba(226,232,240,.42);'
    // 右半（可信模式）：开=薄荷、关=暗。
    var TRUST_ON = HALF_BASE + 'background:rgba(52,211,153,.16);color:#6ee7b7;'
    var TRUST_OFF = HALF_BASE + 'background:rgba(226,232,240,.04);color:rgba(226,232,240,.42);'
    function trustedShield(on) {
      return on
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:inline-block;vertical-align:-2px"><path d="M12 2.8 19.4 5.6v5.6c0 5-3.1 8.4-7.4 10.2C7.7 19.6 4.6 16.2 4.6 11.2V5.6Z"/><path d="m8.8 11.2 2.2 2.2 4.2-4.4"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:inline-block;vertical-align:-2px"><path d="M12 2.8 19.4 5.6v5.6c0 5-3.1 8.4-7.4 10.2C7.7 19.6 4.6 16.2 4.6 11.2V5.6Z"/><circle cx="12" cy="10.6" r="2.2"/><path d="M12 12.8V15"/></svg>'
    }
    /** 刷新右半（可信模式）的文案与配色。 */
    function refreshTrustedHalf() {
      var half = document.getElementById('vcp-trusted-half')
      if (!half) return
      var on = isTrusted()
      half.innerHTML = trustedShield(on) + (on ? '可信·开' : '可信·关')
      half.style.cssText = on ? TRUST_ON : TRUST_OFF
      half.setAttribute('aria-pressed', on ? 'true' : 'false')
      half.title = on
        ? '可信模式已开：正文可放行 script（WebGL/Shader/fetch）——点击关闭'
        : '可信模式已关：点击开启，正文可放行 script（WebGL/Shader/fetch）'
    }
    /** 切换可信模式：写 localStorage 后整页重载（主 bundle 渲染层据此放行 script）。 */
    function toggleTrusted() {
      try {
        window.localStorage.setItem('raw-html-v2.trusted', isTrusted() ? '0' : '1')
      } catch (e) {}
      location.reload()
    }
    function mountDock() {
      if (window.__vcpDockMounted) return
      window.__vcpDockMounted = true
      var mount = function () {
        if (typeof document === 'undefined' || !document.body) return false
        var el = document.getElementById('vcp-trusted-toggle')
        if (!el) {
          el = document.createElement('div')
          el.id = 'vcp-trusted-toggle'
          el.style.cssText = DOCK_CSS
          document.body.appendChild(el)
          // 左半：VCP 渲染开关（点开设置面板）
          var left = document.createElement('button')
          left.id = BTN_ID
          left.type = 'button'
          left.setAttribute('aria-haspopup', 'true')
          left.title = 'VCP 渲染设置：点击打开面板，可分别开关「渲染 HTML」与「美学注入」（切换后自动强制刷新）'
          left.addEventListener('click', function (e) {
            e.stopPropagation()
            togglePanel(left)
          })
          el.appendChild(left)
          // 中缝：1px 分隔线（左右两半的视觉切线）
          var divider = document.createElement('span')
          divider.className = 'vcp-dock-divider'
          divider.setAttribute('aria-hidden', 'true')
          divider.style.cssText = 'flex:none;width:1px;height:14px;margin:0;background:rgba(148,163,184,.28);'
          el.appendChild(divider)
          // 右半：可信模式开关
          var right = document.createElement('button')
          right.id = 'vcp-trusted-half'
          right.type = 'button'
          right.addEventListener('click', function (e) {
            e.stopPropagation()
            toggleTrusted()
          })
          el.appendChild(right)
        }
        refreshButton()
        refreshTrustedHalf()
        return true
      }
      if (mount()) return
      if (typeof setInterval === 'undefined') return
      var iv = setInterval(function () { if (mount()) clearInterval(iv) }, 400)
      setTimeout(function () { clearInterval(iv) }, 10000)
    }
    mountDock()

    // ---- DOM 定位（官方 data-* 标记，与 maid-atelier 皮肤同源）-------------

    function findComposer() {
      return document.querySelector('[data-composer-card]')
    }

    /** 尾部工具栏（发送按钮所在容器），找不到时回退到首行 / 卡片本身。 */
    function findTrailing(composer) {
      if (!composer) return null
      var t = composer.querySelector('[class*="trailing"]')
      if (t) return t
      var row = composer.querySelector(':scope > [class*="row"]')
      return row || composer
    }

    // 读取 DSH 原生 UI 当前生效的字体（跟随主人字体插件的设置）。
    // 下载按钮挂在 body 下，font-family:inherit 只继承 body 的默认字体，
    // 而主人用「另一个插件」统一改的是 DSH 面板/设置栏/左侧栏/composer 等
    // 原生 UI 区域的字体、body 未变 → 下载按钮字体不同步。故每次显示下载
    // 按钮时，从 DSH 原生元素（composer）读取计算后的字体同步过去。
    function nativeUIFontFamily() {
      try {
        var composer = findComposer()
        if (!composer) return null
        var ref = findTrailing(composer) || composer
        return window.getComputedStyle(ref).fontFamily || null
      } catch (e) { return null }
    }

    function findTextarea(composer) {
      if (!composer) return null
      return composer.querySelector('textarea') || composer.querySelector('[contenteditable="true"]')
    }

    function findSendButton(composer) {
      if (!composer) return null
      var primary = composer.querySelector('button[class*="primary"]')
      if (primary) return primary
      var btns = composer.querySelectorAll('button')
      for (var i = 0; i < btns.length; i++) {
        var aria = btns[i].getAttribute('aria-label') || ''
        if (/send|发送|submit/i.test(aria)) return btns[i]
      }
      return null
    }

    // ---- window.__dshInput：VCP 按钮 → 真实发送 ---------------------------

    /** 填入输入框：textarea/input 用原生 value setter 绕过 React 受控；contenteditable
     *  富文本用 execCommand('insertText') 触发编辑器同步（2026-09-02 实测：DSH 输入框
     *  为 contenteditable 时原生 setter 抛 Illegal invocation）。 */
    function setTextareaValue(ta, text) {
      var textS = String(text == null ? '' : text)
      try {
        var tag = (ta.tagName || '').toUpperCase()
        if (tag === 'TEXTAREA' || tag === 'INPUT') {
          var proto = tag === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
          var setter = Object.getOwnPropertyDescriptor(proto, 'value').set
          setter.call(ta, textS)
          ta.dispatchEvent(new window.Event('input', { bubbles: true }))
          return
        }
        // contenteditable 富文本：聚焦 → 清空 → execCommand 插入（编辑器受控 state 随 input 同步）
        try { ta.focus() } catch (e0) {}
        var useCmd = typeof document.execCommand === 'function'
        if (useCmd && document.queryCommandSupported && document.queryCommandSupported('insertText')) {
          try {
            ta.textContent = ''
            if (document.execCommand('insertText', false, textS)) {
              ta.dispatchEvent(new window.Event('input', { bubbles: true }))
              return
            }
          } catch (e1) {}
        }
        ta.textContent = textS
        ta.dispatchEvent(new window.Event('input', { bubbles: true }))
      } catch (e) {
        // 最终兜底：不抛错，尝试直接写文本
        try { if (ta && 'textContent' in ta) ta.textContent = textS } catch (e2) {}
      }
    }

    function clickSend(composer) {
      var btn = findSendButton(composer)
      if (btn && !btn.disabled) {
        btn.click()
        return true
      }
      return false
    }

    /** 填入输入框并轮询点击发送（等待 React 状态同步后按钮解除 disabled）。 */
    function sendText(text) {
      var composer = findComposer()
      var ta = findTextarea(composer)
      if (!ta) {
        if (window.alert) window.alert('[dsh-raw-html-v2] 未找到输入框，无法发送')
        return false
      }
      setTextareaValue(ta, String(text))
      var tries = 0
      var timer = window.setInterval(function () {
        tries += 1
        if (clickSend(composer) || tries > 20) window.clearInterval(timer)
      }, 100)
      return true
    }

    // ---- 「</>」左半按钮 ----
    // 左半视觉：开（美学注入）= 薄荷强调；纯净渲染 = 蓝；关 = 暗。
    // 布局/字体/分隔逻辑见 installDock（右下角融合胶囊）；style 常量已并入
    // 三个 HALF_* 字符串（与 STYLE_* 一一对应）。

    function buttonLabel() {
      if (!isRenderEnabled()) return '</> OFF'
      return isAestheticEnabled() ? '</> ON' : '</> 渲染'
    }

    function refreshButton(btn) {
      if (!btn) btn = document.getElementById(BTN_ID)
      if (!btn) return
      var render = isRenderEnabled()
      btn.setAttribute('aria-pressed', render ? 'true' : 'false')
      btn.textContent = buttonLabel()
      btn.style.cssText = render ? (isAestheticEnabled() ? HALF_ON : HALF_PURE) : HALF_OFF
    }

    // ---- DOM 定位（官方 data-* 标记，与 maid-atelier 皮肤同源）-------------
    // 面板内状态变化：刷新左半按钮 + 面板开关行 + 上报 Host。
    function onChange() {
      refreshButton()
      if (renderRowRefresh) renderRowRefresh()
      if (aestheticRowRefresh) aestheticRowRefresh()
      if (subagentRowRefresh) subagentRowRefresh()
      syncHostState(hostRpc, isRenderEnabled(), isAestheticEnabled(), isSubagentInjectEnabled())
      window.dispatchEvent(new window.CustomEvent('dsh-raw-html-v2-toggle', {
        detail: { render: isRenderEnabled(), aesthetic: isAestheticEnabled(), subagentInject: isSubagentInjectEnabled() },
      }))
    }

    /** 强制刷新浏览器：延迟一拍让 localStorage 状态落盘、Host 上报发出，再整页重载。
     *  刷新后渲染补丁以新状态重新加载、全部消息重渲染——方便观察开关效果与调试注入代码。 */
    function scheduleForceReload(sw) {
      if (reloadTimer) window.clearTimeout(reloadTimer)
      if (sw) {
        sw.textContent = '⟳ 刷新中'
        sw.style.opacity = '0.6'
      }
      reloadTimer = window.setTimeout(function () {
        window.location.reload()
      }, RELOAD_DELAY)
    }

    /** 生成一行开关：label + 描述 + ON/OFF 胶囊按钮。opts.noReload=true 时切换后不强制刷新页面（用于仅影响 Host 侧注入、不影响渲染的开关）。 */
    function makeRow(label, desc, getter, setter, disabledGetter, opts) {
      var row = document.createElement('div')
      row.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 2px;'
      var left = document.createElement('div')
      left.style.cssText = 'flex:1;min-width:0;'
      var name = document.createElement('div')
      name.textContent = label
      name.style.cssText = 'font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#111);line-height:1.4;'
      var d = document.createElement('div')
      d.textContent = desc
      d.style.cssText = 'font-size:11px;color:var(--dsw-alias-label-tertiary,#666);line-height:1.45;margin-top:2px;'
      left.appendChild(name)
      left.appendChild(d)
      var sw = document.createElement('button')
      sw.type = 'button'
      function refresh() {
        var on = getter()
        var dis = disabledGetter()
        sw.textContent = on ? 'ON' : 'OFF'
        sw.disabled = dis
        sw.style.cssText =
          'min-width:44px;height:24px;padding:0 10px;border-radius:999px;font-size:11px;font-weight:600;flex:none;' +
          (dis ? 'opacity:.35;cursor:not-allowed;' : 'cursor:pointer;') +
          (on
            ? 'background:var(--dsw-alias-button-primary-fill,#0d1f33);color:var(--dsw-alias-label-primary-inverted,#fff);border:1px solid var(--dsw-alias-brand-primary,transparent);'
            : 'background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#555);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));')
      }
      sw.addEventListener('click', function () {
        if (disabledGetter()) return
        setter(!getter())
        onChange()
        if (!(opts && opts.noReload)) scheduleForceReload(sw) // 切换后自动强制刷新：新状态立即生效，全部消息重渲染（子代理注入等不影响渲染的开关跳过）
      })
      row.appendChild(left)
      row.appendChild(sw)
      refresh()
      return { row: row, refresh: refresh }
    }

    function createPanel() {
      var panel = document.createElement('div')
      panel.id = PANEL_ID
      panel.setAttribute('role', 'menu')
      panel.style.cssText =
        'position:fixed;z-index:99999;width:248px;padding:10px 12px;' +
        'background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));' +
        'border-radius:var(--dsl-web-radius,12px);box-shadow:0 12px 34px rgba(0,0,0,.28);' +
        'font-family:inherit;color:var(--dsw-alias-label-primary,#111);'
      var title = document.createElement('div')
      title.textContent = 'VCP 渲染设置'
      title.style.cssText = 'font-size:11px;letter-spacing:.14em;color:var(--dsw-alias-label-secondary,#555);margin:0 2px 8px;'
      panel.appendChild(title)

      var hint = document.createElement('div')
      hint.textContent = '切换任一开关将自动强制刷新页面，立即以新状态重渲染全部消息'
      hint.style.cssText = 'font-size:10px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#777);margin:0 2px 8px;'
      panel.appendChild(hint)

      var renderRow = makeRow(
        '渲染 HTML',
        '把消息中的 HTML 渲染为真实界面（含公式/Mermaid/SVG）',
        isRenderEnabled,
        function (on) {
          setRenderEnabled(on)
          if (!on) setAestheticEnabled(false) // 渲染关闭 → 美学强制关闭
        },
        function () { return false }
      )
      renderRowRefresh = renderRow.refresh
      panel.appendChild(renderRow.row)

      var aesRow = makeRow(
        '美学注入',
        '注入四色系/明度/字体/SVG 装帧等规范，让输出更好看（仅渲染开启时可用）',
        isAestheticEnabled,
        setAestheticEnabled,
        function () { return !isRenderEnabled() }
      )
      aesRowRefresh = aesRow.refresh
      panel.appendChild(aesRow.row)

      var subRow = makeRow(
        '子代理注入',
        '关闭后，子代理的系统提示词里不带 VCP 协议段（不影响调度者与渲染）',
        isSubagentInjectEnabled,
        setSubagentInjectEnabled,
        function () { return false },
        { noReload: true }
      )
      subagentRowRefresh = subRow.refresh
      panel.appendChild(subRow.row)

      var reloadBtn = document.createElement('button')
      reloadBtn.type = 'button'
      reloadBtn.textContent = '⟳ 强制刷新页面'
      reloadBtn.title = '立即强制刷新浏览器：重新加载渲染补丁并以当前状态重渲染全部消息（调试注入代码用）'
      reloadBtn.style.cssText =
        'width:100%;height:26px;margin-top:8px;border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.2));' +
        'border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);' +
        'font-size:11px;font-family:inherit;cursor:pointer;'
      reloadBtn.addEventListener('click', function () {
        reloadBtn.textContent = '⟳ 正在刷新…'
        reloadBtn.disabled = true
        scheduleForceReload()
      })
      panel.appendChild(reloadBtn)

      var aesBtn = document.createElement('button')
      aesBtn.type = 'button'
      aesBtn.textContent = '美学系统 ▸'
      aesBtn.title = '打开美学系统查看器：风格库色板 / 字体检测绿勾 / 外置字体库挂载'
      aesBtn.style.cssText =
        'width:100%;height:26px;margin-top:6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.2));' +
        'border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);' +
        'font-size:11px;font-family:inherit;cursor:pointer;'
      aesBtn.addEventListener('click', function (e) {
        e.stopPropagation()
        openAestheticsViewer()
      })
      panel.appendChild(aesBtn)
      return panel
    }

    function openPanel(anchor) {
      closePanel()
      var panel = createPanel()
      document.body.appendChild(panel)
      // 锚点是右下角融合胶囊：面板应向上展开，不被视口裁切。
      var rect = anchor.getBoundingClientRect()
      var pw = panel.offsetWidth || 248
      var ph = panel.offsetHeight || 260
      var left = Math.min(Math.max(8, Math.round(rect.right - pw)), Math.max(8, window.innerWidth - pw - 8))
      var top = rect.top - ph - 6
      if (top < 8) top = Math.min(Math.max(8, Math.round(rect.bottom + 6)), Math.max(8, window.innerHeight - ph - 8))
      panel.style.top = Math.round(top) + 'px'
      panel.style.left = Math.round(left) + 'px'

      var outside = function (e) {
        if (panel.contains(e.target)) return
        if (e.target === anchor || anchor.contains(e.target)) return
        closePanel()
      }
      var key = function (e) { if (e.key === 'Escape') closePanel() }
      panel._outside = outside
      panel._key = key
      // 延迟绑定，避免「打开面板的那次点击」立即触发关闭
      window.setTimeout(function () {
        document.addEventListener('click', outside)
      }, 0)
      document.addEventListener('keydown', key)
    }

    function closePanel() {
      renderRowRefresh = null
      aestheticRowRefresh = null
      var p = document.getElementById(PANEL_ID)
      if (!p) return
      if (p._outside) document.removeEventListener('click', p._outside)
      if (p._key) document.removeEventListener('keydown', p._key)
      p.remove()
    }

    function togglePanel(anchor) {
      if (document.getElementById(PANEL_ID)) {
        closePanel()
        return
      }
      openPanel(anchor)
    }

    // ---- Host 状态同步（驱动系统提示词里的 VCP 协议注入）-------------------

    function makeHostRpc(ctx) {
      try {
        var connection = (ctx && (ctx.get ? ctx.get('connection') : undefined)) || (ctx && ctx.connection)
        if (connection && connection.rpc && connection.rpc.call) {
          return connection.rpc.call.bind(connection.rpc)
        }
      } catch (e) {}
      return null
    }

    function syncHostState(rpc, render, aesthetic, subagentInject) {
      if (!rpc) return
      try {
        rpc('/dsh-raw-html-v2', 'set-state', { render: render, aesthetic: aesthetic, subagentInject: subagentInject }).catch(function () {})
      } catch (e) {}
    }

    // ---- KaTeX 数学公式：自备全套（改名 CSS 防与 DSH 冲突）-------------------
    // DSH 前端内置 KaTeX（0.16.x）但为【延迟加载】：消息渲染（终帧挂载）时可能
    // 未就绪——JS 缺失则公式不渲染，或 CSS/字体未注册则公式 fallback 成普通字体
    // （实测「无报错但字体都是普通字体」的根因）。因此自备：
    //   - katex.min.js + auto-render.min.js：保证 window.katex / renderMathInElement 可用
    //   - katex-vd.css：katex.min.css 的【字体名全部加 _VD 后缀】（font-family 改名、
    //     url 文件名保留）→ 与 DSH 自带的 KaTeX_* 字体名【零冲突】，字体匹配唯一确定
    // 实测（puppeteer + 真实 Edge，v14/v15）：改名 CSS + 自备 JS → /vendor 字体 200
    // 加载、document.fonts.check('26px KaTeX_Main_VD')=true，黑板体/花体/哥特体/手写体
    // 全部正常；而注入原版 katex.min.css 会与 DSH 的 @font-face 同名冲突 → 公式
    // fallback 普通字体（v8 诊断证实：移除后 check 变 true）。
    // 生成方式：node 对 katex.min.css 做 (?<![\w/])KaTeX_[A-Za-z0-9]+ → $&_VD。

    function loadScriptOnce(id, src, onLoad) {
      var existing = document.getElementById(id)
      if (existing) {
        if (onLoad) onLoad()
        return
      }
      var s = document.createElement('script')
      s.id = id
      s.src = src
      s.async = true
      s.onload = function () { if (onLoad) onLoad() }
      document.head.appendChild(s)
    }

    function ensureMathAssets() {
      if (document.getElementById('dsh-raw-html-v2-math-css')) return
      var css = document.createElement('link')
      css.id = 'dsh-raw-html-v2-math-css'
      css.rel = 'stylesheet'
      css.href = '/vendor-v2/katex-vd.css'
      document.head.appendChild(css)
      loadScriptOnce('dsh-raw-html-v2-math-katex', '/vendor-v2/katex.min.js', function () {
        loadScriptOnce('dsh-raw-html-v2-math-autorender', '/vendor-v2/auto-render.min.js', null)
      })
    }

    // Mermaid 图表引擎（VCP 卡片内 language-mermaid 代码块 → SVG）
    // 独立加载（不依赖 KaTeX 链）；本地 /vendor 资源秒加载。加载完成后调
    // v1 引擎的 warmupMermaid()（window.__vcpMath）提前 initialize（白底蓝灰主题），
    // 首次图表渲染省去初始化时间（首图更快出现）。
    function ensureMermaidAssets() {
      loadScriptOnce('dsh-raw-html-v2-mermaid', '/vendor-v2/mermaid.min.js', function () {
        try {
          if (window.__vcpMath && typeof window.__vcpMath.warmupMermaid === 'function') {
            window.__vcpMath.warmupMermaid()
          }
        } catch (e) { /* 预热失败不阻断 */ }
      })
    }

    // VCP 色彩引擎（data-vcp-preset → --vcp-* 色板变量 · 自 B 移植 2026-08-24）
    // 模型只写声明（data-vcp-preset / data-vcp-soul / data-vcp-accent），hex 由引擎
    // 确定性生成（流式重建结果恒定、对比度/色域闭环保证）。/vendor 秒加载；引擎未就绪时
    // 渲染层 chromeForProps/applyColorVars 静默跳过，下一帧重试。
    function ensureColorEngine() {
      if (window.VCPColorEngine || window.__vcpColor) return
      loadScriptOnce('dsh-raw-html-v2-color-engine', '/vendor-v2/VCPColorEngine.js', null)
    }

    // ---- 卡片下载：hover 浮出「⤓ 下载 HTML」按钮 ----------------------------
    // 需求：渲染出的 VCP 卡片（装帧小说 / 图表 / 卡片）可下载为【自包含 HTML】存档。
    // 实现要点：
    //  - 全局单例浮动按钮（position:fixed 跟随 hover 的 #vcp-root 卡片右上角），
    //    事件委托定位，不往 React DOM 里插节点 → 对流式重建免疫。
    //  - 下载时取 card.outerHTML，把卡片内 <style> 的 @font-face 字体转 data URI 内嵌：
    //    · 内置精选 /fonts-v2/Lanxi-*.woff2（7 款 OFL 开源）→ 内嵌
    //    · KaTeX /vendor-v2/fonts/*.woff2（OFL 开源）→ 内嵌（只 woff2，删 woff/ttf 声明省体积）
    //    · 外置大库 /fonts-v2/<子目录>/*.ttf（可能商业授权）→ 不内嵌，保留相对路径（本机可看）
    //  - Mermaid 已渲染为内联 SVG，自包含；表情包 <img> 为绝对 URL，本机打开仍可加载。

    var DL_BTN_ID = 'dsh-raw-html-v2-dl'
    var dlBtn = null
    var dlCard = null
    var dlHideTimer = null
    var dlInitDone = false

    function blobToDataUri(blob) {
      return new window.Promise(function (resolve, reject) {
        var fr = new window.FileReader()
        fr.onload = function () { resolve(fr.result) }
        fr.onerror = function () { reject(fr.error) }
        fr.readAsDataURL(blob)
      })
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    function extractCardTitle(card) {
      var h = card.querySelector('h1, h2, h3, .title')
      var t = h ? h.textContent.replace(/\s+/g, ' ').trim() : ''
      if (!t) {
        var m = card.querySelector('.motto, .headline')
        if (m) t = m.textContent.replace(/\s+/g, ' ').trim().slice(0, 20)
      }
      t = t.replace(/[\\/:*?"<>|\n\r]+/g, '').trim().slice(0, 40)
      return t || 'vcp-card-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    }

    // 收集「沉在卡尾」的 <style> 兄弟：VCP 规范要求 <style> 写在 #vcp-root 之后
    // （卡尾），渲染后它是 card 的【兄弟元素】而非子元素——downloadCard 只取
    // card.outerHTML 会漏掉它，导致下载的 HTML 丢失背景/字体等全部样式。
    // 按本消息唯一 id（#vcp-msg-N）过滤，只收属于这张卡、且不在 card 内部的 style。
    var vcpFontsCache = null // list-fonts 结果缓存：downloadCard 下载时按家族名内嵌 @font-face
    function collectSiblingStyles(card) {
      var root = card.parentElement
      if (!root) return ''
      var id = card.getAttribute('id')
      var styles = root.querySelectorAll('style[data-plugin="vcp-message"]')
      var out = []
      for (var i = 0; i < styles.length; i++) {
        var s = styles[i]
        if (card.contains(s)) continue
        if (id && s.textContent.indexOf('#' + id) === -1) continue
        out.push(s.outerHTML)
      }
      return out.join('\n')
    }

    function downloadCard(card) {
      var html = card.outerHTML
      // v6.19 修复：把沉卡尾的兄弟 <style> 拼回下载内容（否则下载丢背景/字体）。
      var siblingStyle = collectSiblingStyles(card)
      if (siblingStyle) html = siblingStyle + '\n' + html
      // 开源字体白名单：内置精选 Lanxi + KaTeX woff2；外置大库字体不在此列，保留相对路径
      // （兼容 /fonts-v2/ 与旧 /fonts/ 两种 url——渲染层已归一 v2，历史卡重渲前保留兜底）
      var urlRe = /url\(\s*(['"]?)(\/(?:fonts-v2|fonts)\/Lanxi-[A-Za-z0-9]+\.woff2|\/(?:vendor-v2|vendor)\/fonts\/[^'"()\s]+\.woff2)\1\s*\)/g
      var urls = {}
      var m
      while ((m = urlRe.exec(html))) urls[m[2]] = true
      // F5 修复（2026-09-02 实测：下载文件缺全局 @font-face → 本地打开黑体）：Lanxi
      // 字体由插件启动时全局注入 document head（ensureGlobalFonts），不在卡片 style 内——
      // downloadCard 只打包卡内 style → 下载文件无字体定义 → 艺术字回退黑体。这里扫描
      // html 里 font-family 引用的 Lanxi 家族名，从 vcpFontsCache（list-fonts）查 rel 并
      // 加入内嵌队列，下载时生成 @font-face + data URI（内置精选 OFL 才内嵌，外置保留跳过）。
      var vcpFamRel = {} // 家族名 → '/fonts-v2/'+rel（新发现需内嵌的字体）
      if (vcpFontsCache && vcpFontsCache.aliasMap) {
        var famHits = String(html).match(/Lanxi-[\u4e00-\u9fa5A-Za-z0-9]+/g) || []
        for (var fh = 0; fh < famHits.length; fh++) {
          var famName = famHits[fh]
          var relUrl = vcpFontsCache.aliasMap[famName]
          if (!relUrl || !vcpFontsCache.installed[famName]) continue
          var famHttp = '/fonts-v2/' + relUrl
          if (!urls[famHttp]) { urls[famHttp] = true; vcpFamRel[famName] = famHttp }
        }
      }

      var katexCss = ''
      var katexPromise = window.Promise.resolve()
      if (card.querySelector('.katex')) {
        katexPromise = window.fetch('/vendor-v2/katex-vd.css')
          .then(function (r) { return r.text() })
          .then(function (kc) {
            kc = kc.replace(/,url\(fonts\/[^)]*\.woff\)\s*format\([^)]*\)/g, '')
            kc = kc.replace(/,url\(fonts\/[^)]*\.ttf\)\s*format\([^)]*\)/g, '')
            var kre = /url\(fonts\/([^)]*\.woff2)\)/g
            var km
            while ((km = kre.exec(kc))) urls['/vendor-v2/fonts/' + km[1]] = true
            katexCss = kc
          })
          .catch(function () {})
      }

      katexPromise.then(function () {
        var map = {}
        var jobs = Object.keys(urls).map(function (u) {
          return window.fetch(u)
            .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.blob() })
            .then(blobToDataUri)
            .then(function (uri) { map[u] = uri })
            .catch(function () {})
        })
        return window.Promise.all(jobs).then(function () { return map })
      }).then(function (map) {
        html = html.replace(urlRe, function (all, q, u) {
          return map[u] ? 'url(' + map[u] + ')' : all
        })
        if (katexCss) {
          katexCss = katexCss.replace(/url\(fonts\/([^)]*\.woff2)\)/g, function (all, name) {
            var u = '/vendor-v2/fonts/' + name
            return map[u] ? 'url(' + map[u] + ')' : all
          })
        }
        // F5：为卡内引用的 Lanxi 家族名生成 @font-face（data URI），随文件自包含
        var famCss = ''
        for (var famKey in vcpFamRel) {
          if (!Object.prototype.hasOwnProperty.call(vcpFamRel, famKey)) continue
          var famUri = vcpFamRel[famKey]
          if (map[famUri]) famCss += "@font-face{font-family:'" + famKey + "';src:url(" + map[famUri] + ");font-display:swap;}"
        }
        var title = extractCardTitle(card)
        var cardId = card.getAttribute('id')
        // 回注卡片脚本（2026-09-02 定调放宽）：引擎 extractTrustedScripts 已把本卡
        // <script> 源码存入 window.__vcpMsgScripts[uid]，此处按 card.id（vcp-msg-N）取回，
        // 让下载的「自包含 HTML」在浏览器打开后脚本交互依然可用（含 onclick 透传的函数）。
        var scriptsHtml = ''
        try {
          var sreg = window.__vcpMsgScripts || {}
          var codes = cardId ? sreg[cardId] : null
          if (codes && codes.length) {
            for (var si = 0; si < codes.length; si++) {
              scriptsHtml += '\n<script>\n' + codes[si] + '\n<\/script>'
            }
          }
        } catch (e) {}
        var doc =
          '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n' +
          '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
          '<title>' + escapeHtml(title) + '</title>\n' +
          (katexCss ? '<style>' + katexCss + '</style>\n' : '') +
          (famCss ? '<style>' + famCss + '</style>\n' : '') +
          '</head>\n<body style="margin:0;">\n' + html + scriptsHtml + '\n</body>\n</html>'

        var blob = new window.Blob([doc], { type: 'text/html;charset=utf-8' })
        var a = document.createElement('a')
        var objUrl = window.URL.createObjectURL(blob)
        a.href = objUrl
        a.download = title + '.html'
        document.body.appendChild(a)
        a.click()
        a.remove()
        window.setTimeout(function () { window.URL.revokeObjectURL(objUrl) }, 10000)
      })
    }

    function buildDlButton() {
      var btn = document.createElement('button')
      btn.id = DL_BTN_ID
      btn.type = 'button'
      btn.textContent = '⤓ 下载 HTML'
      btn.title = '下载此卡片为自包含 HTML（内嵌开源字体，任何地方打开都保持装帧效果）'
      btn.style.cssText =
        'display:none;position:fixed;z-index:2147483000;top:0;right:0;height:28px;padding:0 12px;' +
        'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:999px;' +
        'background:var(--dsw-alias-bg-overlay,#fff);' +
        'color:var(--dsw-alias-label-primary,#111);' +
        'font-size:11px;font-family:inherit;font-weight:600;cursor:pointer;white-space:nowrap;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.14);'
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation()
        ev.preventDefault()
        var c = dlCard
        if (c) downloadCard(c)
      })
      return btn
    }

    function positionDlButton(card) {
      var r = card.getBoundingClientRect()
      dlBtn.style.top = Math.max(6, r.top + 8) + 'px'
      dlBtn.style.right = Math.max(6, window.innerWidth - r.right + 8) + 'px'
    }

    function scheduleDlHide() {
      if (dlHideTimer) window.clearTimeout(dlHideTimer)
      dlHideTimer = window.setTimeout(function () {
        if (dlBtn) dlBtn.style.display = 'none'
        dlCard = null
      }, 260)
    }

    function showDlFor(card) {
      if (!dlBtn || !dlBtn.isConnected) {
        dlBtn = buildDlButton()
        document.body.appendChild(dlBtn)
      }
      dlCard = card
      // 每次显示时同步 DSH 原生 UI 的字体（跟随主人字体插件的实时设置）
      var nf = nativeUIFontFamily()
      if (nf) dlBtn.style.fontFamily = nf
      positionDlButton(card)
      dlBtn.style.display = 'inline-block'
      if (dlHideTimer) window.clearTimeout(dlHideTimer)
    }

    function initDownload() {
      if (dlInitDone) return
      dlInitDone = true
      document.addEventListener('mouseover', function (ev) {
        var t = ev.target
        if (!t || !t.closest) return
        if (dlBtn && (t === dlBtn || dlBtn.contains(t))) {
          if (dlHideTimer) window.clearTimeout(dlHideTimer)
          return
        }
        var card = t.closest('[id="vcp-root"],[id^="vcp-msg-"]')
        if (card) showDlFor(card)
      })
      document.addEventListener('mouseout', function (ev) {
        var t = ev.target
        if (!t || !t.closest) return
        var rt = ev.relatedTarget
        if (rt && rt.closest) {
          if (dlBtn && (rt === dlBtn || dlBtn.contains(rt))) return
          if (rt.closest('[id="vcp-root"],[id^="vcp-msg-"]') === dlCard) return
        }
        if (t.closest('[id="vcp-root"],[id^="vcp-msg-"]')) scheduleDlHide()
      })
    }

    // ---- 美学系统查看器 v3（两列网格 · 紧凑控件 · Lanxi 前缀剥离 · 点卡锁定 + 打开源文档）---

    var AES_VIEWER_ID = 'dsh-raw-html-v2-aes-viewer'

    // 全局当前打开的取色器（含关闭句柄）——模态/查看器关闭时统一清理，
    // 防止取色器面板残留 body 导致 panel 变量不同步、下次点不开。
    var aesOpenPicker = null
    /** 关闭所有取色器（清理残留 DOM + 事件监听 + 变量）。 */
    function aesCloseAllPickers() {
      if (aesOpenPicker && typeof aesOpenPicker.closePanel === 'function') {
        try { aesOpenPicker.closePanel() } catch (e) {}
      }
      var ps = document.querySelectorAll('.aes-picker')
      for (var pi = 0; pi < ps.length; pi++) ps[pi].remove()
      aesOpenPicker = null
    }

    function aesRpc(endpoint, payload) {
      return new window.Promise(function (resolve) {
        if (!hostRpc) { resolve(null); return }
        hostRpc('/dsh-raw-html-v2', endpoint, payload || {})
          .then(function (r) { resolve(r && r.value !== undefined ? r.value : r) })
          .catch(function (err) {
            // RPC reject：尝试从 err 里读 Host 返回的 failResult 错误
            resolve(err && err.error ? err : null)
          })
      })
    }

    /** 全局注册已安装字体的 @font-face（apply 时一次性；只声明不下载，元素用到才按需加载）。
     *  根因（2026-08-27 实测）：Lanxi-* 字体此前只在美学面板打开时才由 aesEnsureFontFace
     *  注册——聊天消息渲染时浏览器根本不认识「Lanxi-自由浪漫」等字体名 → font-family 全部
     *  回退系统黑体。这里启动即把 aliasMap 中「已安装」的字体声明注入全局容器
     *  （与 aesEnsureFontFace 同一容器、规则去重幂等），此后模型输出 font-family:'Lanxi-XXX'
     *  直接命中真实字体文件。
     *  重试 v2（2026-08-27 · puppeteer 实测铁证）：apply 瞬间 connection RPC 未就绪
     *  → hostRpc 为 null → 0 条注入（诊断：fontHostExists=true 但 fontRuleCount=0）；
     *  v1 重试 5 次仍失败——因为 aesRpc 用的是 apply 时固定的 hostRpc 变量，重试的是
     *  同一把坏钥匙。v2：每次尝试都【重新 makeHostRpc(ctx)】，connection 一就绪即成功；
     *  并输出 console.debug 日志（注入条数/失败原因），便于 puppeteer 抓取验证。 */
    function ensureGlobalFonts(ctx, attempts) {
      attempts = attempts || 0
      function retry(reason) {
        if (attempts >= 5) {
          console.debug('[dsh-raw-html-v2] ensureGlobalFonts 放弃：' + reason + '（已重试 ' + attempts + ' 次）')
          return 0
        }
        return new window.Promise(function (res) {
          window.setTimeout(function () { res(ensureGlobalFonts(ctx, attempts + 1)) }, 800 * (attempts + 1))
        })
      }
      // 关键：每次尝试都重新获取 RPC——apply 瞬间 connection 可能尚未就绪，
      // 模块级 hostRpc 是 apply 时固定的（可能是 null），重试必须重新取。
      var rpc = makeHostRpc(ctx)
      if (!rpc) return retry('connection 未就绪')
      return rpc('/dsh-raw-html-v2', 'list-fonts', {}).then(function (r) {
        var d = r && r.value !== undefined ? r.value : r
        if (!d || d.error || !d.aliasMap || !d.installed) return retry('list-fonts 无数据' + (d && d.error ? ':' + d.error.message : ''))
        var host = document.getElementById('dsh-raw-html-v2-aes-fontfaces')
        if (!host) {
          host = document.createElement('style')
          host.id = 'dsh-raw-html-v2-aes-fontfaces'
          document.head.appendChild(host)
        }
        var added = 0
        for (var ak in d.aliasMap) {
          if (!Object.prototype.hasOwnProperty.call(d.aliasMap, ak)) continue
          var rel = d.aliasMap[ak]
          if (!rel || !d.installed[ak]) continue
          var rule = "@font-face{font-family:'" + ak + "';src:url('/fonts-v2/" + rel + "');font-display:swap;}"
          if (host.textContent.indexOf(rule) === -1) { host.textContent += rule; added++ }
        }
        console.debug('[dsh-raw-html-v2] ensureGlobalFonts 注入 @font-face ' + added + ' 条（已装 ' + Object.keys(d.installed).filter(function (k) { return d.installed[k] }).length + '/' + Object.keys(d.aliasMap).length + '）')
        try { vcpFontsCache = { aliasMap: d.aliasMap, installed: d.installed } } catch (e) {}
        return added
      }).catch(function (e) { return retry('RPC 异常:' + (e && e.message)) })
    }

    function aesBaseName(name) { return String(name).replace(/\.[^.]+$/, '') }
    /** 剥离 Lanxi- 前缀（显示用）：「Lanxi-超粗黑」→「超粗黑」。 */
    function aesDispFont(fam) { return String(fam).replace(/^Lanxi-/, '') }

    /** 从风格文档「字体」元信息行提取 Lanxi-* 字体名（去重）。 */
    function aesExtractFontNames(fontsStr) {
      if (!fontsStr) return []
      var m = String(fontsStr).match(/Lanxi-[\w\u4e00-\u9fa5-]+/g) || []
      var out = []
      for (var i = 0; i < m.length; i++) { var n = m[i].trim(); if (out.indexOf(n) === -1) out.push(n) }
      return out
    }

    function aesSwatches(colors) {
      if (!colors || !colors.length) return '<span class="aes-muted">（无色板）</span>'
      var html = ''
      for (var i = 0; i < colors.length; i++) html += '<span class="aes-swatch" style="background:' + colors[i] + ';" title="' + colors[i] + '"></span>'
      return html
    }

    /** 取色器独立样式表：选择器无 #AES_VIEWER_ID 前缀——面板挂 document.body（不在查看器内），
     *  必须用全局选择器才能命中。打开取色器时注入。 */
    function aesPickerSheet() {
      if (document.getElementById('dsh-raw-html-v2-aes-picker-style')) return
      var css = [
        '.aes-picker{position:fixed;z-index:2147483006;width:280px;background:var(--dsw-alias-bg-overlay,#ffffff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.14));border-radius:14px;box-shadow:0 16px 42px rgba(0,0,0,.35);padding:12px;color-scheme:light dark;box-sizing:border-box;}',
        '.aes-picker-top{display:flex;align-items:center;gap:6px;margin-bottom:8px;}',
        '.aes-picker-hex{flex:1;font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--dsw-alias-label-primary,#111);font-family:inherit;}',
        '.aes-picker-tool{flex:none;height:24px;padding:0 9px;font-size:10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));border-radius:7px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#111);font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:3px;}',
        '.aes-picker-tool:hover{background:var(--dsw-alias-button-primary-fill,#0d1f33);color:#fff;}',
        '.aes-picker-sv{position:relative;width:100%;height:110px;border-radius:10px;margin-bottom:8px;cursor:crosshair;border:1px solid rgba(0,0,0,.14);}',
        '.aes-picker-sv-dot{position:absolute;width:13px;height:13px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.45);transform:translate(-50%,-50%);pointer-events:none;}',
        '.aes-picker-hue{position:relative;width:100%;height:20px;border-radius:10px;margin-bottom:8px;cursor:pointer;border:1px solid rgba(0,0,0,.14);background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);}',
        '.aes-picker-hue-dot{position:absolute;top:50%;width:7px;height:24px;border-radius:4px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.45);transform:translate(-50%,-50%);pointer-events:none;}',
        '.aes-picker-swatches{display:grid;grid-template-columns:repeat(9,1fr);gap:4px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));}',
        '.aes-picker-swatch{width:100%;aspect-ratio:1;border-radius:5px;border:1px solid rgba(0,0,0,.12);cursor:pointer;padding:0;box-shadow:inset 0 1px 2px rgba(0,0,0,.15),inset 0 0 0 1px rgba(255,255,255,.2);transition:transform .1s ease;}',
        '.aes-picker-swatch:hover{transform:scale(1.12);}',
        '.aes-picker-swatch.on{outline:2px solid var(--dsw-alias-brand-primary,#0d1f33);outline-offset:1px;}',
        '.aes-picker-row{display:flex;gap:6px;align-items:center;}',
        '.aes-picker-input{flex:1;min-width:0;height:24px;font-size:11px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#111);font-family:inherit;}',
        '.aes-picker-ok{flex:none;height:24px;padding:0 12px;font-size:11px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111);font-family:inherit;cursor:pointer;}',
        '.aes-picker-ok:hover{background:var(--dsw-alias-button-primary-fill,#0d1f33);color:#fff;}',
      ].join('\n')
      var st = document.createElement('style')
      st.id = 'dsh-raw-html-v2-aes-picker-style'
      st.textContent = css
      document.head.appendChild(st)
    }

    function aesSheet() {
      var css = [
        '#' + AES_VIEWER_ID + '{position:fixed;z-index:2147483001;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28);color-scheme:light dark;font-family:inherit;}',
        '#' + AES_VIEWER_ID + ' .aes-panel{width:min(780px,calc(100vw - 32px));height:min(720px,calc(100vh - 48px));display:flex;flex-direction:column;border-radius:16px;overflow:hidden;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));box-shadow:0 24px 60px rgba(0,0,0,.32);}',
        '#' + AES_VIEWER_ID + ' .aes-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));}',
        '#' + AES_VIEWER_ID + ' .aes-title{font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary,#111);}',
        '#' + AES_VIEWER_ID + ' .aes-subtitle{font-size:11px;color:var(--dsw-alias-label-tertiary,#777);margin:2px 0 10px;}',
        '#' + AES_VIEWER_ID + ' .aes-body{flex:1;overflow:auto;padding:12px 16px;}',
        '#' + AES_VIEWER_ID + ' .aes-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',
        '#' + AES_VIEWER_ID + ' .aes-style{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:12px;padding:9px 11px;cursor:pointer;transition:box-shadow .15s ease,border-color .15s ease;position:relative;}',
        '#' + AES_VIEWER_ID + ' .aes-style:hover{border-color:var(--dsw-alias-brand-primary,rgba(0,0,0,.25));box-shadow:0 2px 10px rgba(0,0,0,.06);}',
        '#' + AES_VIEWER_ID + ' .aes-style.aes-locked{border-color:var(--dsw-alias-brand-primary,#0d1f33);box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,rgba(13,31,51,.35));}',
        '#' + AES_VIEWER_ID + ' .aes-locktag{position:absolute;top:7px;left:9px;font-size:9px;font-weight:700;color:#fff;background:var(--dsw-alias-brand-primary,#0d1f33);border-radius:999px;padding:2px 7px;letter-spacing:.05em;}',
        '#' + AES_VIEWER_ID + ' .aes-style:hover .aes-del{opacity:1;}',
        '#' + AES_VIEWER_ID + ' .aes-del:hover{background:#dc2626;color:#fff;border-color:transparent;}',
        '#' + AES_VIEWER_ID + ' .aes-ops{position:absolute;top:7px;right:9px;display:flex;gap:4px;}',
        '#' + AES_VIEWER_ID + ' .aes-op-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-tertiary,#777);font-size:10px;line-height:1;padding:0;cursor:pointer;text-align:center;opacity:0;transition:opacity .12s ease,background .12s ease;font-family:inherit;}',
        '#' + AES_VIEWER_ID + ' .aes-style:hover .aes-op-btn{opacity:1;}',
        '#' + AES_VIEWER_ID + ' .aes-op-btn:hover{background:var(--dsw-alias-button-primary-fill,#0d1f33);color:#fff;}',
        '#' + AES_VIEWER_ID + ' .aes-style-head{display:flex;align-items:baseline;justify-content:space-between;gap:6px;padding-left:52px;padding-right:56px;}',
        '#' + AES_VIEWER_ID + ' .aes-style-name{flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary,#111);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '#' + AES_VIEWER_ID + ' .aes-style-slug{flex:none;font-size:9px;color:var(--dsw-alias-label-tertiary,#999);}',
        '#' + AES_VIEWER_ID + ' .aes-style-scene{font-size:10px;color:var(--dsw-alias-label-tertiary,#777);line-height:1.35;margin:1px 0 6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
        '#' + AES_VIEWER_ID + ' .aes-swatch{display:inline-block;width:15px;height:15px;border-radius:4px;margin:0 3px 2px 0;border:1px solid rgba(0,0,0,.15);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);vertical-align:middle;}',
        '#' + AES_VIEWER_ID + ' .aes-swatch-label{font-size:9px;color:var(--dsw-alias-label-tertiary,#777);margin-bottom:3px;}',
        '#' + AES_VIEWER_ID + ' .aes-fontrow{display:flex;gap:6px;align-items:center;margin-top:6px;}',
        '#' + AES_VIEWER_ID + ' .aes-select{flex:1;min-width:0;height:24px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));border-radius:7px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#111);font-size:10px;font-family:inherit;padding:0 4px;}',
        '#' + AES_VIEWER_ID + ' .aes-preview{margin-top:5px;padding:5px 7px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));font-size:13px;line-height:1.4;color:var(--dsw-alias-label-primary,#111);min-height:18px;word-break:break-all;}',
        '#' + AES_VIEWER_ID + ' .aes-footer{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));}',
        '#' + AES_VIEWER_ID + ' .aes-row{display:flex;gap:6px;align-items:center;margin-top:8px;}',
        '#' + AES_VIEWER_ID + ' .aes-input{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));border-radius:8px;padding:6px 8px;font-size:11px;font-family:inherit;color:var(--dsw-alias-label-primary,#111);background:transparent;}',
        '#' + AES_VIEWER_ID + ' .aes-btn{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111);font-size:11px;font-family:inherit;padding:5px 9px;cursor:pointer;flex:none;}',
        '#' + AES_VIEWER_ID + ' .aes-btn:hover{background:var(--dsw-alias-button-primary-fill,#0d1f33);color:#fff;}',
        '#' + AES_VIEWER_ID + ' .aes-muted{font-size:10px;color:var(--dsw-alias-label-tertiary,#777);word-break:break-all;}',
        '#' + AES_VIEWER_ID + ' .aes-empty{font-size:12px;color:var(--dsw-alias-label-tertiary,#777);padding:8px 0;}',
        '#' + AES_VIEWER_ID + ' .aes-footer{flex:none;background:var(--dsw-alias-bg-overlay,#fff);border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));padding:12px 16px;}',
        '#' + AES_VIEWER_ID + ' .aes-modal{position:fixed;z-index:2147483002;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);}',
        '#' + AES_VIEWER_ID + ' .aes-modal-panel{width:min(480px,calc(100vw - 48px));max-height:calc(100vh - 80px);display:flex;flex-direction:column;border-radius:16px;overflow:hidden;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));box-shadow:0 24px 60px rgba(0,0,0,.35);}',
        '#' + AES_VIEWER_ID + ' .aes-modal-body{flex:1;overflow:auto;padding:10px 16px;}',
        '#' + AES_VIEWER_ID + ' .aes-modal-foot{display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));}',
        '#' + AES_VIEWER_ID + ' .aes-field{margin-bottom:10px;}',
        '#' + AES_VIEWER_ID + ' .aes-field-label{display:block;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary,#111);margin-bottom:4px;}',
        '#' + AES_VIEWER_ID + ' .aes-ta{width:100%;box-sizing:border-box;resize:vertical;line-height:1.5;}',
        '#' + AES_VIEWER_ID + ' .aes-swatchedit{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:4px 0;}',
        '#' + AES_VIEWER_ID + ' .aes-sw-wrap{position:relative;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;box-shadow:0 1px 2px rgba(0,0,0,.18);border-radius:50%;}',
        '#' + AES_VIEWER_ID + ' .aes-sw-color{width:20px;height:20px;border:none;border-radius:50%;padding:0;cursor:pointer;background:none;transition:transform .12s ease;display:block;}',
        '#' + AES_VIEWER_ID + ' .aes-sw-color::-webkit-color-swatch-wrapper{padding:0;}',
        '#' + AES_VIEWER_ID + ' .aes-sw-color::-webkit-color-swatch{border:none;border-radius:50%;box-shadow:inset 0 1px 2px rgba(0,0,0,.25),inset 0 0 0 1px rgba(255,255,255,.35);}',
        '#' + AES_VIEWER_ID + ' .aes-sw-color:hover{transform:scale(1.15);}',
        '#' + AES_VIEWER_ID + ' .aes-sw-rm{position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-tertiary,#777);font-size:8px;line-height:10px;padding:0;cursor:pointer;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.15);opacity:0;transition:opacity .12s ease;}',
        '#' + AES_VIEWER_ID + ' .aes-sw-wrap:hover .aes-sw-rm{opacity:1;}',
        '#' + AES_VIEWER_ID + ' .aes-sw-add{border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.25));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font-size:9px;font-weight:400;padding:2px 9px;cursor:pointer;font-family:inherit;line-height:1.5;transition:all .12s ease;}',
        '#' + AES_VIEWER_ID + ' .aes-sw-add:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));border-color:var(--dsw-alias-brand-primary,rgba(0,0,0,.4));color:var(--dsw-alias-label-primary,#111);}',
        // 取色器样式见 aesPickerSheet()（独立无前缀，面板挂 body 也能命中）
        '#' + AES_VIEWER_ID + ' .aes-fontsel-wide{width:100%;height:28px;margin-bottom:6px;}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:10px;padding:8px;margin-bottom:8px;position:relative;}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-label{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary,#666);letter-spacing:.06em;flex:none;}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-add{flex:none;height:22px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));border-radius:7px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#111);font-size:10px;font-family:inherit;padding:0 8px;cursor:pointer;}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-add:hover{background:var(--dsw-alias-button-primary-fill,#0d1f33);color:#fff;}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-search{flex:1;min-width:0;height:22px;font-size:10px;padding:0 7px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary,#111);}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-menu{position:absolute;z-index:2147483003;min-width:160px;max-width:220px;max-height:180px;overflow-y:auto;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.25);padding:4px;}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-menu-item{display:block;width:100%;text-align:left;border:none;background:none;font-size:12px;color:var(--dsw-alias-label-primary,#111);padding:6px 8px;border-radius:7px;cursor:pointer;font-family:inherit;line-height:1.4;}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-menu-item .aes-fontcat-menu-meta{font-size:9px;color:var(--dsw-alias-label-tertiary,#999);margin-left:6px;}',
        '#' + AES_VIEWER_ID + ' .aes-fontchips{display:flex;flex-wrap:wrap;gap:5px;max-height:88px;overflow-y:auto;align-content:flex-start;padding:6px 2px 0 0;}',
        '#' + AES_VIEWER_ID + ' .aes-chip .aes-chip-x{top:-3px;right:-3px;}',
        '#' + AES_VIEWER_ID + ' .aes-chip{flex:none;position:relative;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.15));border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#111);font-size:12px;padding:3px 12px 3px 10px;cursor:default;font-family:inherit;line-height:1.5;transition:all .12s ease;display:inline-flex;align-items:center;}',
        '#' + AES_VIEWER_ID + ' .aes-chip .aes-chip-x{position:absolute;top:-5px;right:-5px;width:13px;height:13px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-tertiary,#777);font-size:8px;line-height:11px;padding:0;cursor:pointer;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.15);opacity:0;transition:opacity .12s ease;font-family:inherit;}',
        '#' + AES_VIEWER_ID + ' .aes-chip:hover .aes-chip-x{opacity:1;}',
        '#' + AES_VIEWER_ID + ' .aes-chip .aes-chip-x:hover{background:#dc2626;color:#fff;border-color:transparent;}',
        '#' + AES_VIEWER_ID + ' .aes-chip .aes-chip-dot{font-size:8px;margin-left:4px;color:#16a34a;opacity:.85;}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-empty{font-size:10px;color:var(--dsw-alias-label-tertiary,#999);padding:2px 0;}',
        '#' + AES_VIEWER_ID + ' .aes-fontcat-hint{font-size:10px;color:var(--dsw-alias-label-tertiary,#777);margin-top:2px;line-height:1.4;}',
        '#' + AES_VIEWER_ID + ' .aes-head.aes-head-viewer{flex-direction:column;align-items:stretch;padding:0;}',
        '#' + AES_VIEWER_ID + ' .aes-head-top{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 6px;}',
        '#' + AES_VIEWER_ID + ' .aes-head-viewer .aes-searchbar{display:flex;gap:6px;padding:0 16px 10px;margin:0;background:transparent;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));}',
        '#' + AES_VIEWER_ID + ' .aes-searchbar{position:relative;}',
        '#' + AES_VIEWER_ID + ' .aes-tagbtn{flex:none;height:26px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));border-radius:7px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#111);font-size:10px;font-family:inherit;padding:0 10px;cursor:pointer;}',
        '#' + AES_VIEWER_ID + ' .aes-tagbtn:hover{background:var(--dsw-alias-button-primary-fill,#0d1f33);color:#fff;}',
        '#' + AES_VIEWER_ID + ' .aes-tagmenu{position:absolute;top:calc(100% - 4px);left:0;z-index:2147483003;min-width:170px;max-width:240px;max-height:220px;overflow-y:auto;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.25);padding:4px;}',
        '#' + AES_VIEWER_ID + ' .aes-tagmenu-item{display:flex;align-items:center;gap:6px;width:100%;text-align:left;border:none;background:none;font-size:11px;color:var(--dsw-alias-label-primary,#111);padding:5px 8px;border-radius:7px;cursor:pointer;font-family:inherit;}',
        '#' + AES_VIEWER_ID + ' .aes-tagmenu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));}',
        '#' + AES_VIEWER_ID + ' .aes-tagmenu-item.on{color:var(--dsw-alias-brand-primary,#0d1f33);font-weight:600;}',
        '#' + AES_VIEWER_ID + ' .aes-tagmenu-item .aes-tagmenu-count{font-size:9px;color:var(--dsw-alias-label-tertiary,#999);margin-left:auto;font-weight:400;}',
        '#' + AES_VIEWER_ID + ' .aes-searchinp{height:26px;font-size:10px;padding:0 8px;}',
        '#' + AES_VIEWER_ID + ' .aes-newcard{border:1.5px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.25));background:transparent;display:flex;align-items:center;justify-content:center;min-height:120px;}',
        '#' + AES_VIEWER_ID + ' .aes-newcard:hover{border-color:var(--dsw-alias-brand-primary,rgba(0,0,0,.4));box-shadow:0 2px 10px rgba(0,0,0,.06);}',
        '#' + AES_VIEWER_ID + ' .aes-btn-primary{background:var(--dsw-alias-button-primary-fill,#0d1f33);color:var(--dsw-alias-label-primary-inverted,#fff);border-color:transparent;font-weight:600;}',
        '#' + AES_VIEWER_ID + ' .aes-btn-primary:hover{background:var(--dsw-alias-button-primary-fill,#0d1f33);color:#fff;}'
      ].join('\n')
      var st = document.createElement('style')
      st.id = 'dsh-raw-html-v2-aes-style'
      st.textContent = css
      return st
    }

    /** 动态加载字体（@font-face + fonts.load）用于预览；rel 为空则跳过（回退系统字体）。
     *  用一个统一 @font-face 容器，按 rule 字符串去重——绝不能按 family 生成 style id：
     *  中文字体名被替换成下划线后会互相撞 id（如「Lanxi-超粗黑」与「Lanxi-狂侠体」同 id），
     *  第二个字体的 @font-face 会被 getElementById 短路跳过、永不注入，导致预览失效。 */
    function aesEnsureFontFace(family, rel) {
      if (!rel) return window.Promise.resolve(false)
      var host = document.getElementById('dsh-raw-html-v2-aes-fontfaces')
      if (!host) {
        host = document.createElement('style')
        host.id = 'dsh-raw-html-v2-aes-fontfaces'
        document.head.appendChild(host)
      }
      var rule = "@font-face{font-family:'" + family + "';src:url('/fonts-v2/" + rel + "');font-display:swap;}"
      if (host.textContent.indexOf(rule) === -1) host.textContent += rule
      return document.fonts.load("13px '" + family + "'").then(function () { return true }).catch(function () { return false })
    }

    /** 构建单个风格板块：名称/slug/场景 + 色板 + 字体下拉（剥离前缀）+ 预览 + 锁定标记 + 打开源文档。 */
    function aesBuildStyleSection(st, fontMap, aliasMap, installed, lockedSlug) {
      var sec = document.createElement('div')
      sec.className = 'aes-style' + (lockedSlug === st.slug ? ' aes-locked' : '')

      var head = document.createElement('div')
      head.className = 'aes-style-head'
      var nm = document.createElement('span')
      nm.className = 'aes-style-name'
      nm.textContent = st.name
      var slug = document.createElement('span')
      slug.className = 'aes-style-slug'
      slug.textContent = st.slug
      head.appendChild(nm)
      head.appendChild(slug)
      sec.appendChild(head)

      if (lockedSlug === st.slug) {
        var tag = document.createElement('span')
        tag.className = 'aes-locktag'
        tag.textContent = '已锁定'
        sec.appendChild(tag)
      }

      // 操作按钮：编辑 + 删除（右上角，hover 显现）
      {
        var ops = document.createElement('div')
        ops.className = 'aes-ops'
        // 打开源文档按钮：系统文件管理器定位 styles/<slug>.md（线条 SVG，与 ✎ 同一视觉语言）
        var openBtn = document.createElement('button')
        openBtn.type = 'button'
        openBtn.className = 'aes-op-btn'
        openBtn.title = '在文件管理器中打开此风格的源文档（styles/' + st.slug + '.md）'
        openBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>'
        openBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          aesOpenStyleFolder(st.slug)
        })
        ops.appendChild(openBtn)
        // 编辑按钮：打开新建模态的编辑模式（预填当前风格数据）
        var editBtn = document.createElement('button')
        editBtn.type = 'button'
        editBtn.className = 'aes-op-btn'
        editBtn.textContent = '✎'
        editBtn.title = '编辑此风格'
        editBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          openAesNewStyle(st)
        })
        ops.appendChild(editBtn)
        // 删除按钮：Host 侧二次校验保护内置
        var delBtn = document.createElement('button')
        delBtn.type = 'button'
        delBtn.className = 'aes-op-btn'
        delBtn.textContent = '🗑'
        delBtn.title = '删除此风格'
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          if (!window.confirm('确定删除风格「' + st.name + '」吗？此操作不可恢复。')) return
          aesRpc('delete-style', { slug: st.slug }).then(function (d) {
            if (d && d.error) { window.alert('删除失败：' + (d.error.message || JSON.stringify(d.error))); return }
            var v = document.getElementById(AES_VIEWER_ID)
            if (v && typeof v._aesRender === 'function') v._aesRender()
          })
        })
        ops.appendChild(delBtn)
        sec.appendChild(ops)
      }

      if (st.scene) {
        var scene = document.createElement('div')
        scene.className = 'aes-style-scene'
        scene.textContent = st.scene
        sec.appendChild(scene)
      }


      var swLabel = document.createElement('div')
      swLabel.className = 'aes-swatch-label'
      swLabel.textContent = '色板'
      sec.appendChild(swLabel)
      var swDiv = document.createElement('div')
      swDiv.innerHTML = aesSwatches(st.colors)
      sec.appendChild(swDiv)

      var names = aesExtractFontNames(st.fonts)
      if (names.length) {
        var frow = document.createElement('div')
        frow.className = 'aes-fontrow'
        var sel = document.createElement('select')
        sel.className = 'aes-select'
        var opt0 = document.createElement('option')
        opt0.value = ''
        opt0.textContent = '字体预览'
        sel.appendChild(opt0)
        for (var i = 0; i < names.length; i++) {
          var n = names[i]
          var inst = fontMap[aesBaseName(n)]
          var aliasRel = aliasMap[n]
          var available = !!(inst || (aliasRel && installed[n]))
          var opt = document.createElement('option')
          opt.value = inst ? inst.rel : (aliasRel || n)
          opt.textContent = aesDispFont(n) + (available ? ' ✓' : ' ○')
          sel.appendChild(opt)
        }
        var prev = document.createElement('div')
        prev.className = 'aes-preview'
        prev.textContent = '床前明月光 · 0123456789'
        sel.addEventListener('change', function () {
          if (!sel.value) { prev.style.fontFamily = ''; return }
          var fam = sel.options[sel.selectedIndex].textContent.replace(/\s+[✓○]$/, '')
          var fullFam = sel.options[sel.selectedIndex].textContent.replace(/\s+[✓○]$/, '')
          // 补回 Lanxi- 前缀做 @font-face 引用
          var prefix = ''
          for (var k = 0; k < names.length; k++) { if (aesDispFont(names[k]) === fam) { prefix = names[k]; break } }
          prev.style.fontFamily = "'" + (prefix || fullFam) + "',sans-serif"
          aesEnsureFontFace(prefix || fullFam, sel.value)
        })
        // 下拉/预览是交互区：阻止点击冒泡到板块（否则点字体预览会误触锁定）
        frow.addEventListener('click', function (e) { e.stopPropagation() })
        frow.appendChild(sel)
        frow.appendChild(prev)
        sec.appendChild(frow)
      }

      // 点卡片 → 锁定/解锁该风格（边框高亮 + 左上角「已锁定」徽标）
      sec.addEventListener('click', function () { aesLockStyle(st.slug, lockedSlug === st.slug) })
      return sec
    }

    /** 系统文件夹选择器：FS Access API 读字体 → FontFace 注册当前窗口（仅本会话）。 */
    function aesPickSystemDir() {
      return new window.Promise(function (resolve, reject) {
        if (!window.showDirectoryPicker) { reject(new Error('浏览器不支持 File System Access API')); return }
        window.showDirectoryPicker().then(function (dir) {
          var names = []
          var jobs = []
          function walkDir(d) {
            var it = d.values()
            function step() {
              return it.next().then(function (r) {
                if (r.done) return window.Promise.resolve()
                var entry = r.value
                if (entry.kind === 'directory') return walkDir(entry).then(function () { return step() })
                if (entry.kind === 'file' && /\.(ttf|otf|woff2?)$/i.test(entry.name)) {
                  jobs.push(entry.getFile().then(function (f) {
                    return f.arrayBuffer().then(function (buf) {
                      var family = 'AesFont_' + entry.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]/g, '_')
                      var face = new window.FontFace(family, buf)
                      return face.load().then(function () { document.fonts.add(face); names.push(entry.name) })
                    })
                  }))
                  return step()
                }
                return step()
              })
            }
            return step()
          }
          walkDir(dir).then(function () { return window.Promise.all(jobs) }).then(function () { resolve(names) }).catch(reject)
        }).catch(reject)
      })
    }

    /** 打开风格源文档所在文件夹：Host 用系统文件管理器定位选中该 md。 */
    function aesOpenStyleFolder(slug) {
      aesRpc('open-style-folder', { slug: slug }).then(function (d) {
        if (d && d.error) window.alert('无法打开文件夹：' + (d.error.message || JSON.stringify(d.error)))
      })
    }

    /** 锁定/解锁风格：持久化到 Host（注入协议会优先提示该风格）。 */
    function aesLockStyle(slug, isLocked) {
      aesRpc('set-style', { style: isLocked ? '' : slug }).then(function (d) {
        // 原地重绘刷新锁定态（不关闭面板；openAestheticsViewer 是切换式，直接调会关掉自己）
        var v = document.getElementById(AES_VIEWER_ID)
        if (v && typeof v._aesRender === 'function') v._aesRender()
      })
    }

    function openAestheticsViewer() {
      closePanel()
      var existing = document.getElementById(AES_VIEWER_ID)
      if (existing) { existing.remove(); return }
      if (!document.getElementById('dsh-raw-html-v2-aes-style')) document.head.appendChild(aesSheet())

      var view = document.createElement('div')
      view.id = AES_VIEWER_ID
      var panel = document.createElement('div')
      panel.className = 'aes-panel'

      // ---- 顶栏：head-top（标题+关闭）+ searchbar（检索栏融入，紧贴同底色）----
      var head = document.createElement('div')
      head.className = 'aes-head aes-head-viewer'
      var headTop = document.createElement('div')
      headTop.className = 'aes-head-top'
      var tWrap = document.createElement('div')
      var title = document.createElement('div')
      title.className = 'aes-title'
      title.textContent = '美学系统'
      var sub = document.createElement('div')
      sub.className = 'aes-subtitle'
      sub.textContent = '点击板块即锁定该风格 · 点右上角文件夹图标打开源文档'
      tWrap.appendChild(title)
      tWrap.appendChild(sub)
      var close = document.createElement('button')
      close.className = 'aes-btn'
      close.textContent = '✕ 关闭'
      close.addEventListener('click', function () { aesCloseAllPickers(); view.remove() })
      headTop.appendChild(tWrap)
      headTop.appendChild(close)
      head.appendChild(headTop)

      // 检索栏：创建一次，永不随 grid 重建（输入时焦点不丢）
      var searchbar = document.createElement('div')
      searchbar.className = 'aes-searchbar'
      // 标签过滤按钮 + 弹出菜单（替代原 multiple select——内容一多太长，改弹出式更好看）
      var tagBtn = document.createElement('button')
      tagBtn.type = 'button'
      tagBtn.className = 'aes-tagbtn'
      tagBtn.textContent = '标签'
      var tagMenu = document.createElement('div')
      tagMenu.className = 'aes-tagmenu'
      tagMenu.style.display = 'none'
      searchbar.appendChild(tagMenu)
      tagBtn.addEventListener('click', function (e) {
        e.stopPropagation()
        var willShow = tagMenu.style.display === 'none'
        document.querySelectorAll('.aes-tagmenu').forEach(function (m) { if (m !== tagMenu) m.style.display = 'none' })
        document.querySelectorAll('.aes-fontcat-menu').forEach(function (m) { m.style.display = 'none' })
        tagMenu.style.display = willShow ? 'block' : 'none'
      })
      searchbar.appendChild(tagBtn)
      var searchInp = document.createElement('input')
      searchInp.className = 'aes-input aes-searchinp'
      searchInp.placeholder = '🔍 检索名称/场景/标签…'
      searchbar.appendChild(searchInp)
      head.appendChild(searchbar)
      panel.appendChild(head)

      // ---- 滚动区（只放 grid，searchbar/footer 不在此重建）----
      var body = document.createElement('div')
      body.className = 'aes-body'
      var loading = document.createElement('div')
      loading.className = 'aes-empty'
      loading.textContent = '加载中…'
      body.appendChild(loading)
      panel.appendChild(body)
      view.appendChild(panel)
      document.body.appendChild(view)

      var search = { tags: [], text: '' }
      view._aesSearch = search

      view.addEventListener('click', function (e) { if (e.target === view) { aesCloseAllPickers(); view.remove() } })
      var esc = function (e) { if (e.key === 'Escape') { if (view.querySelector('.aes-modal')) return; aesCloseAllPickers(); view.remove(); document.removeEventListener('keydown', esc) } }
      document.addEventListener('keydown', esc)

      // ---- 数据一次性加载，grid/footer 只负责渲染 ----
      var data = { styles: [], fonts: [], aliasMap: {}, installed: {}, extraRoots: [], locked: '' }
      var loaded = false

      function fontMap() {
        var m = {}
        for (var i = 0; i < data.fonts.length; i++) m[aesBaseName(data.fonts[i].name)] = data.fonts[i]
        return m
      }

      function buildTagOptions() {
        var tagCount = {}
        for (var i = 0; i < data.styles.length; i++) {
          (String(data.styles[i].tags || '').split(/[,，\s/]+/)).forEach(function (tg) { tg = tg.trim(); if (tg) tagCount[tg] = (tagCount[tg] || 0) + 1 })
        }
        var allTags = Object.keys(tagCount).sort(function (a, b) { return tagCount[b] - tagCount[a] })
        tagMenu.textContent = ''
        if (allTags.length) {
          for (var j = 0; j < allTags.length; j++) {
            (function (tag) {
              var item = document.createElement('button')
              item.type = 'button'
              item.className = 'aes-tagmenu-item' + (search.tags.indexOf(tag) !== -1 ? ' on' : '')
              item.textContent = (search.tags.indexOf(tag) !== -1 ? '✓ ' : '') + tag
              var cnt = document.createElement('span')
              cnt.className = 'aes-tagmenu-count'
              cnt.textContent = tagCount[tag]
              item.appendChild(cnt)
              item.addEventListener('click', function (e) {
                e.stopPropagation()
                var idx = search.tags.indexOf(tag)
                if (idx === -1) search.tags.push(tag); else search.tags.splice(idx, 1)
                buildTagOptions()
                buildGrid()
              })
              tagMenu.appendChild(item)
            })(allTags[j])
          }
        } else {
          var none = document.createElement('div')
          none.className = 'aes-fontcat-empty'
          none.textContent = '（无标签）'
          tagMenu.appendChild(none)
        }
        tagBtn.textContent = search.tags.length ? '标签 (' + search.tags.length + ')' : '标签'
      }

      // 输入事件只重建 grid——搜索框本身不被销毁，焦点保持（修复「一输入就跳出」）
      searchInp.addEventListener('input', function () {
        search.text = searchInp.value
        buildGrid()
      })

      function buildGrid() {
        body.textContent = ''
        var q = search.text.trim().toLowerCase()
        var filtered = data.styles.filter(function (st) {
          if (search.tags.length && !search.tags.some(function (tg) { return (String(st.tags || '').split(/[,，\s/]+/)).indexOf(tg) !== -1 })) return false
          if (q) {
            var hay = (st.name + ' ' + st.slug + ' ' + st.scene + ' ' + st.tags).toLowerCase()
            if (hay.indexOf(q) === -1) return false
          }
          return true
        })
        var secLabel = document.createElement('div')
        secLabel.className = 'aes-subtitle'
        secLabel.textContent = '共 ' + data.styles.length + ' 个风格' + (data.locked ? ' · 当前锁定：' + data.locked : ' · 未锁定（自动检索）')
        body.appendChild(secLabel)
        var grid = document.createElement('div')
        grid.className = 'aes-grid'
        grid.appendChild(aesBuildNewStyleCard())
        for (var j = 0; j < filtered.length; j++) grid.appendChild(aesBuildStyleSection(filtered[j], fontMap(), data.aliasMap, data.installed, data.locked))
        if (!filtered.length) {
          var empty = document.createElement('div')
          empty.className = 'aes-empty'
          empty.textContent = '没有匹配的风格——换个关键词，或点击「＋ 新建」创造它'
          empty.style.gridColumn = '1 / -1'
          grid.appendChild(empty)
        }
        body.appendChild(grid)
      }

      // ---- 底部外置字体库：固定，创建一次 ----
      var foot = document.createElement('div')
      foot.className = 'aes-footer'
      var fLabel = document.createElement('div')
      fLabel.className = 'aes-swatch-label'
      fLabel.textContent = '外置字体库（粘贴绝对路径，字体放进去后点刷新即用）'
      foot.appendChild(fLabel)
      var row = document.createElement('div')
      row.className = 'aes-row'
      var inp = document.createElement('input')
      inp.className = 'aes-input'
      inp.placeholder = 'G:\\AI\\H3MINI\\美学包'
      var addBtn = document.createElement('button')
      addBtn.className = 'aes-btn'
      addBtn.textContent = '挂载'
      var pickBtn = document.createElement('button')
      pickBtn.className = 'aes-btn'
      pickBtn.textContent = '系统选择器'
      var refBtn = document.createElement('button')
      refBtn.className = 'aes-btn'
      refBtn.textContent = '⟳ 刷新'
      row.appendChild(inp)
      row.appendChild(addBtn)
      row.appendChild(pickBtn)
      row.appendChild(refBtn)
      foot.appendChild(row)
      var rootsDiv = document.createElement('div')
      rootsDiv.className = 'aes-muted'
      rootsDiv.style.marginTop = '8px'
      foot.appendChild(rootsDiv)
      var tmpDiv = document.createElement('div')
      tmpDiv.className = 'aes-muted'
      tmpDiv.style.marginTop = '4px'
      foot.appendChild(tmpDiv)
      function updateRoots() {
        rootsDiv.textContent = data.extraRoots && data.extraRoots.length ? '已挂载：' + data.extraRoots.join(' · ') : '已挂载：无（默认 I:\\字体 + 内置自动服务）'
      }
      addBtn.addEventListener('click', function () {
        var p = (inp.value || '').trim()
        if (!p) return
        aesRpc('add-fonts-root', { path: p }).then(function (d) {
          inp.value = ''
          data.extraRoots = (d && d.extraFonts) || data.extraRoots
          updateRoots()
          loadFontsOnly()
        })
      })
      refBtn.addEventListener('click', loadFontsOnly)
      pickBtn.addEventListener('click', function () {
        tmpDiv.textContent = '正在打开系统选择器…'
        aesPickSystemDir().then(function (names) {
          tmpDiv.textContent = names && names.length ? '本窗口临时挂载 ✓：' + names.join(' · ') : '（该目录无字体文件）'
        }).catch(function (e) { tmpDiv.textContent = '系统选择器不可用：' + ((e && e.message) || e) + '（请用粘贴路径）' })
      })
      panel.appendChild(foot)

      function loadFontsOnly() {
        aesRpc('list-fonts').then(function (fd) {
          data.fonts = (fd && fd.fonts) || []
          data.extraRoots = (fd && fd.extraFonts) || []
          data.aliasMap = (fd && fd.aliasMap) || {}
          data.installed = (fd && fd.installed) || {}
          updateRoots()
          buildGrid()
        })
      }

      function load() {
        aesRpc('get-state').then(function (st) {
          data.locked = (st && st.preferredStyle) || ''
          aesRpc('list-styles').then(function (sd) {
            data.styles = (sd && sd.styles) || []
            aesRpc('list-fonts').then(function (fd) {
              data.fonts = (fd && fd.fonts) || []
              data.extraRoots = (fd && fd.extraFonts) || []
              data.aliasMap = (fd && fd.aliasMap) || {}
              data.installed = (fd && fd.installed) || {}
              loaded = true
              buildTagOptions()
              updateRoots()
              buildGrid()
            })
          })
        })
      }

      // 锁定/新建/删除后原地刷新 grid（边框亮起），不关面板
      view._aesRender = function () {
        // 完全重载：重新拉取状态、风格列表、字体，让锁定态与增删立即生效
        aesRpc('get-state').then(function (st) {
          data.locked = (st && st.preferredStyle) || ''
          aesRpc('list-styles').then(function (sd) {
            data.styles = (sd && sd.styles) || []
            aesRpc('list-fonts').then(function (fd) {
              data.fonts = (fd && fd.fonts) || []
              data.extraRoots = (fd && fd.extraFonts) || []
              data.aliasMap = (fd && fd.aliasMap) || {}
              data.installed = (fd && fd.installed) || {}
              loaded = true
              buildTagOptions && buildTagOptions()
              buildGrid()
            })
          })
        })
      }
      load()
    }

    /** 新建框卡片：与风格板块同尺寸，虚线边框，永远在网格第一位。 */
    function aesBuildNewStyleCard() {
      var card = document.createElement('div')
      card.className = 'aes-style aes-newcard'
      card.title = '创建自定义美学风格'
      var inner = document.createElement('div')
      inner.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:120px;gap:6px;text-align:center;'
      var plus = document.createElement('div')
      plus.textContent = '＋'
      plus.style.cssText = 'font-size:26px;font-weight:300;color:var(--dsw-alias-label-tertiary,#999);line-height:1;'
      var lab = document.createElement('div')
      lab.textContent = '新建风格'
      lab.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-secondary,#666);'
      var hint = document.createElement('div')
      hint.textContent = '把想法变成可检索的风格'
      hint.style.cssText = 'font-size:10px;color:var(--dsw-alias-label-tertiary,#999);'
      inner.appendChild(plus)
      inner.appendChild(lab)
      inner.appendChild(hint)
      card.appendChild(inner)
      card.addEventListener('click', function (e) { e.stopPropagation(); openAesNewStyle() })
      return card
    }

    // ---- 新建风格模态：用户自定义美学（把想法变成可检索的风格文档）-----------

    /** 色板编辑器：一排 <input type=color> + 加色/删色。 */
    /** 自定义取色弹层（跟随主题令牌、小圆角、小字号）。点击色块弹出。 */
    var AES_PRESET_COLORS = ['#F7F2EB', '#081F5C', '#334EAC', '#7096D1', '#D4A017', '#F5572F', '#C85A3F', '#A9714B', '#FFC700', '#7C5CFF', '#FF69B4', '#9400D3', '#00FFFF', '#00FF00', '#FF00FF', '#1C1C1A', '#2B2B2B', '#FFFFFF']

    /** 颜色转换：hex ↔ HSV。 */
    function aesHexToHsv(hex) {
      var r = parseInt(hex.slice(1, 3), 16) / 255
      var g = parseInt(hex.slice(3, 5), 16) / 255
      var b = parseInt(hex.slice(5, 7), 16) / 255
      var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
      var h = 0
      if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6
        else if (max === g) h = (b - r) / d + 2
        else h = (r - g) / d + 4
        h = h * 60; if (h < 0) h += 360
      }
      return { h: h, s: max === 0 ? 0 : d / max, v: max }
    }
    function aesHsvToHex(h, s, v) {
      s = s / 100; v = v / 100
      var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
      var r = 0, g = 0, b = 0
      if (h < 60) { r = c; g = x }
      else if (h < 120) { r = x; g = c }
      else if (h < 180) { g = c; b = x }
      else if (h < 240) { g = x; b = c }
      else if (h < 300) { r = x; b = c }
      else { r = c; b = x }
      function p(n) { var s2 = Math.round(n * 255).toString(16); return s2.length < 2 ? '0' + s2 : s2 }
      return '#' + p(r + m) + p(g + m) + p(b + m)
    }

    /** 色块按钮 + 点击弹出自定义 HSV 取色器（可自由选任意颜色，含吸管）。
     *  面板挂 document.body + position:fixed + 超高 z-index：避免被模态内字体分类遮挡、
     *  也解决「关不掉」（点外部/Esc/✕ 均可关闭）。 */
    function aesColorChip(current, onPick) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'aes-sw-color'
      btn.style.background = current
      btn.title = '点击取色'
      var panel = null
      var hsv = aesHexToHsv(current)
      var h = hsv.h, s = hsv.s * 100, v = hsv.v * 100
      var escHandler = null
      var outsideHandler = null

      function closePanel() {
        if (panel) { panel.remove(); panel = null }
        if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null }
        if (outsideHandler) { document.removeEventListener('mousedown', outsideHandler); outsideHandler = null }
        aesOpenPicker = null
      }

      function setColor(hexStr, syncInput) {
        current = hexStr
        btn.style.background = hexStr
        onPick(hexStr)
        if (!panel) return
        var hexEl = panel.querySelector('.aes-picker-hex')
        if (hexEl) hexEl.textContent = hexStr.toUpperCase()
        if (syncInput) {
          var inp = panel.querySelector('.aes-picker-input')
          if (inp && document.activeElement !== inp) inp.value = hexStr
        }
        var sv = panel.querySelector('.aes-picker-sv')
        if (sv) sv.style.background = 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(' + h + ',100%,50%))'
        var svDot = panel.querySelector('.aes-picker-sv-dot')
        if (svDot) { svDot.style.left = s + '%'; svDot.style.top = (100 - v) + '%' }
        var hueDot = panel.querySelector('.aes-picker-hue-dot')
        if (hueDot) hueDot.style.left = (h / 360 * 100) + '%'
        var sws = panel.querySelectorAll('.aes-picker-swatch')
        for (var i = 0; i < sws.length; i++) sws[i].classList.toggle('on', sws[i].style.background.toLowerCase() === hexStr.toLowerCase())
      }

      function bindDrag(el, onMove) {
        el.addEventListener('mousedown', function (e) {
          e.preventDefault()
          e.stopPropagation()
          onMove(e)
          function mv(ev) { onMove(ev) }
          function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up) }
          document.addEventListener('mousemove', mv)
          document.addEventListener('mouseup', up)
        })
      }

      btn.addEventListener('click', function (e) {
        e.stopPropagation()
        // 强制清理：移除所有已存在的 .aes-picker 面板（含残留），重置 panel 状态
        try {
          var leftovers = document.querySelectorAll('.aes-picker')
          for (var lix = 0; lix < leftovers.length; lix++) { var lp = leftovers[lix]; if (lp && lp.parentNode) lp.parentNode.removeChild(lp) }
        } catch (le) {}
        if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null }
        if (outsideHandler) { document.removeEventListener('mousedown', outsideHandler); outsideHandler = null }
        panel = null
        aesOpenPicker = null

        panel = document.createElement('div')
        panel.className = 'aes-picker'
        // 内联样式强制生效：fixed + 顶层 z-index + 不透明背景，完全不依赖外部 CSS 类
        panel.style.cssText = 'position:fixed;z-index:2147483006;background:var(--dsw-alias-bg-overlay,#ffffff);width:280px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.14));border-radius:14px;box-shadow:0 16px 42px rgba(0,0,0,.35);padding:12px;color-scheme:light dark;display:block;'

        // 顶部行：hex + 吸管 + 关闭
        var top = document.createElement('div')
        top.className = 'aes-picker-top'
        var hex = document.createElement('div')
        hex.className = 'aes-picker-hex'
        hex.textContent = current.toUpperCase()
        top.appendChild(hex)
        if (window.EyeDropper) {
          var drop = document.createElement('button')
          drop.type = 'button'
          drop.className = 'aes-picker-tool'
          drop.textContent = '🖌 吸管'
          drop.title = '从屏幕任意位置取色'
          drop.addEventListener('click', function (ev) {
            ev.stopPropagation()
            try {
              var ed = new window.EyeDropper()
              ed.open().then(function (res) {
                if (res && res.sRGBHex) {
                  var hh = aesHexToHsv(res.sRGBHex)
                  h = hh.h; s = hh.s * 100; v = hh.v * 100
                  setColor(res.sRGBHex, true)
                }
              }).catch(function () {})
            } catch (err) {}
          })
          top.appendChild(drop)
        }
        var closeX = document.createElement('button')
        closeX.type = 'button'
        closeX.className = 'aes-picker-tool'
        closeX.textContent = '✕'
        closeX.title = '关闭'
        closeX.addEventListener('click', function (ev) { ev.stopPropagation(); closePanel() })
        top.appendChild(closeX)
        panel.appendChild(top)

        // 饱和度/明度 2D 面板（放大）
        var sv = document.createElement('div')
        sv.className = 'aes-picker-sv'
        sv.style.background = 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(' + h + ',100%,50%))'
        var svDot = document.createElement('div')
        svDot.className = 'aes-picker-sv-dot'
        sv.appendChild(svDot)
        bindDrag(sv, function (ev) {
          var r = sv.getBoundingClientRect()
          var x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width))
          var y = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))
          s = x * 100; v = (1 - y) * 100
          setColor(aesHsvToHex(h, s, v), true)
        })

        // 色相条（放大）
        var hue = document.createElement('div')
        hue.className = 'aes-picker-hue'
        var hueDot = document.createElement('div')
        hueDot.className = 'aes-picker-hue-dot'
        hue.appendChild(hueDot)
        bindDrag(hue, function (ev) {
          var r = hue.getBoundingClientRect()
          var x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width))
          h = Math.round(x * 360)
          setColor(aesHsvToHex(h, s, v), true)
        })

        // hex 输入 + 确定
        var row = document.createElement('div')
        row.className = 'aes-picker-row'
        var inp = document.createElement('input')
        inp.className = 'aes-picker-input'
        inp.value = current
        inp.placeholder = '#RRGGBB'
        inp.spellcheck = false
        inp.addEventListener('input', function () {
          var val = (inp.value || '').trim()
          if (/^#[0-9a-fA-F]{6}$/.test(val)) {
            var hh = aesHexToHsv(val)
            h = hh.h; s = hh.s * 100; v = hh.v * 100
            setColor(val)
          }
        })
        inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') closePanel() })
        var ok = document.createElement('button')
        ok.type = 'button'
        ok.className = 'aes-picker-ok'
        ok.textContent = '确定'
        ok.addEventListener('click', function () {
          var val = (inp.value || '').trim()
          if (/^#[0-9a-fA-F]{6}$/.test(val)) { var hh = aesHexToHsv(val); h = hh.h; s = hh.s * 100; v = hh.v * 100; setColor(val) }
          closePanel()
        })
        row.appendChild(inp)
        row.appendChild(ok)

        // 预设快捷色板（缩小 50%：9 列小圆点）
        var swRow = document.createElement('div')
        swRow.className = 'aes-picker-swatches'
        AES_PRESET_COLORS.forEach(function (c) {
          var sw = document.createElement('button')
          sw.type = 'button'
          sw.className = 'aes-picker-swatch'
          sw.style.background = c
          sw.title = c
          sw.addEventListener('click', function (ev) {
            ev.stopPropagation()
            var hh = aesHexToHsv(c); h = hh.h; s = hh.s * 100; v = hh.v * 100
            setColor(c, true)
          })
          swRow.appendChild(sw)
        })

        panel.appendChild(sv)
        panel.appendChild(hue)
        panel.appendChild(row)
        panel.appendChild(swRow)

        // 注入独立取色器样式（无前缀，面板挂 body 也能命中；不依赖查看器样式）
        try {
          if (typeof aesPickerSheet === 'function') aesPickerSheet()
        } catch (e) {}
        // 查看器样式（供面板内其他复用类兜底）
        if (!document.getElementById('dsh-raw-html-v2-aes-style') && typeof aesSheet === 'function') {
          try { document.head.appendChild(aesSheet()) } catch (e) {}
        }
        // 记录全局引用（供 aesCloseAllPickers 清理）
        aesOpenPicker = { self: aesColorChip, closePanel: closePanel }

        // 挂 body + fixed 定位（不被模态内内容遮挡）
        document.body.appendChild(panel)
        var rect = btn.getBoundingClientRect()
        var pw = 280
        var left = Math.max(4, Math.min(rect.left, window.innerWidth - pw - 8))
        var estH = 300
        var topY = rect.bottom + 6
        if (topY + estH > window.innerHeight - 8) topY = Math.max(4, rect.top - estH - 6)
        panel.style.left = left + 'px'
        panel.style.top = topY + 'px'
        // 强制显隐确认（防御：某些环境 display 被样式覆盖）
        panel.style.display = 'block'
        if (window.console && console.debug) console.debug('[dsh-raw-html-v2] aes-picker opened', left, topY)

        setColor(current)

        // 点击外部关闭
        outsideHandler = function (ev) {
          if (panel && !panel.contains(ev.target) && !btn.contains(ev.target)) closePanel()
        }
        document.addEventListener('mousedown', outsideHandler)
        // Esc 关闭
        escHandler = function (ev) { if (ev.key === 'Escape') closePanel() }
        document.addEventListener('keydown', escHandler)
      })
      return btn
    }

    /** 色板编辑器：一排取色圆点（点开自定义取色器）+ 加色/删色。 */
    function aesColorEditor(initial, onColorChange) {
      var box = document.createElement('div')
      box.className = 'aes-swatchedit'
      var colors = initial.slice()
      function render() {
        box.textContent = ''
        for (var i = 0; i < colors.length; i++) {
          (function (idx) {
            var wrap = document.createElement('span')
            wrap.className = 'aes-sw-wrap'
            var chip = aesColorChip(colors[idx], function (c) {
              colors[idx] = c
              onColorChange(colors.slice())
            })
            var rm = document.createElement('button')
            rm.type = 'button'
            rm.className = 'aes-sw-rm'
            rm.textContent = '✕'
            rm.title = '删除此色'
            rm.addEventListener('click', function (e) { e.stopPropagation(); colors.splice(idx, 1); render(); onColorChange(colors.slice()) })
            wrap.appendChild(chip)
            wrap.appendChild(rm)
            box.appendChild(wrap)
          })(i)
        }
        var add = document.createElement('button')
        add.type = 'button'
        add.className = 'aes-sw-add'
        add.textContent = '＋ 加色'
        add.addEventListener('click', function () { colors.push('#8899AA'); render(); onColorChange(colors.slice()) })
        box.appendChild(add)
      }
      render()
      return box
    }

    /** 字体分类板块：已选 chips（用字体本身渲染名字，hover 右上角 × 删除）+ 添加器（下拉菜单 + 搜索已加载字体）。 */
    /** 字体分类板块：已选 chips（用字体本身渲染名字，hover 右上角 × 删除）+ 添加器（下拉菜单 + 搜索已加载字体）。 */
    function aesFontCategory(label, initial, aliasMap, installed) {
      var wrap = document.createElement('div')
      wrap.className = 'aes-fontcat'
      var selected = (initial || []).slice()

      var head = document.createElement('div')
      head.className = 'aes-fontcat-head'
      var lab = document.createElement('div')
      lab.className = 'aes-fontcat-label'
      lab.textContent = label
      var addBtn = document.createElement('button')
      addBtn.type = 'button'
      addBtn.className = 'aes-fontcat-add'
      addBtn.textContent = '＋ 添加'
      var searchInp = document.createElement('input')
      searchInp.type = 'text'
      searchInp.className = 'aes-fontcat-search'
      searchInp.placeholder = '🔍 搜索字体…'
      head.appendChild(lab)
      head.appendChild(addBtn)
      head.appendChild(searchInp)
      wrap.appendChild(head)

      var chips = document.createElement('div')
      chips.className = 'aes-fontchips'
      wrap.appendChild(chips)

      var menu = document.createElement('div')
      menu.className = 'aes-fontcat-menu'
      menu.style.display = 'none'
      wrap.appendChild(menu)

      function isAliasKey(ak) { return Object.prototype.hasOwnProperty.call(aliasMap, ak) }

      // 字体懒加载观察器（2026-08-27 定调 · 滚动加载）：菜单项滚动到可见才 load
      // 字体——首屏秒开、内存只驻留看过的字体（33 款 214MB 全量 → 仅首屏几十 MB）；
      // 已加载字体驻留 document.fonts，再次打开面板立即命中、无需重新下载。
      // root=menu（滚动容器）：菜单内部滚动时按可见性触发；display:none 时自动不触发。
      var fontLazyIO = null

      function buildMenu(filterText) {
        menu.textContent = ''
        var q = (filterText || '').trim().toLowerCase()
        var aliasKeys = Object.keys(aliasMap).sort(function (a, b) {
          if ((installed[b] ? 1 : 0) !== (installed[a] ? 1 : 0)) return (installed[b] ? 1 : 0) - (installed[a] ? 1 : 0)
          return a.localeCompare(b)
        })
        var added = 0
        // 滚动懒加载：断开旧观察器（菜单每次重建），按可见项观察；无 IO 时降级全量预加载
        if (fontLazyIO) fontLazyIO.disconnect()
        fontLazyIO = null
        if (window.IntersectionObserver) {
          fontLazyIO = new window.IntersectionObserver(function (entries) {
            for (var ei = 0; ei < entries.length; ei++) {
              var en = entries[ei]
              if (!en.isIntersecting) continue
              var it = en.target
              var rel2 = it.getAttribute('data-rel')
              if (rel2) aesEnsureFontFace(it.getAttribute('data-ak'), rel2)
              if (fontLazyIO) fontLazyIO.unobserve(it)
            }
          }, { root: menu, rootMargin: '60px 0px' })
        } else {
          // 降级（无 IntersectionObserver 的旧浏览器）：全量预加载已装字体（原行为）
          aliasKeys.forEach(function (ak) {
            if (selected.indexOf(ak) !== -1) return
            if (installed[ak] && aliasMap[ak]) aesEnsureFontFace(ak, aliasMap[ak])
          })
        }
        aliasKeys.forEach(function (ak) {
          if (selected.indexOf(ak) !== -1) return
          var disp = aesDispFont(ak)
          if (q && disp.toLowerCase().indexOf(q) === -1) return
          added++
          var item = document.createElement('button')
          item.type = 'button'
          item.className = 'aes-fontcat-menu-item'
          item.style.fontFamily = "'" + ak + "',sans-serif"
          item.setAttribute('data-ak', ak)
          if (installed[ak] && aliasMap[ak]) item.setAttribute('data-rel', aliasMap[ak])
          item.appendChild(document.createTextNode(disp))
          var meta = document.createElement('span')
          meta.className = 'aes-fontcat-menu-meta'
          meta.textContent = installed[ak] ? '已装' : '未装'
          item.appendChild(meta)
          if (fontLazyIO) fontLazyIO.observe(item)
          item.addEventListener('click', function () {
            selected.push(ak)
            if (aliasMap[ak]) aesEnsureFontFace(ak, aliasMap[ak])
            menu.style.display = 'none'
            searchInp.value = ''
            renderChips()
          })
          menu.appendChild(item)
        })
        if (!added) {
          var none = document.createElement('div')
          none.className = 'aes-fontcat-empty'
          none.textContent = '无匹配字体'
          menu.appendChild(none)
        }
      }

      // 点击菜单外部关闭（document 级 mousedown，面板打开时绑定）
      function closeMenuIfOutside(ev) {
        if (menu.style.display === 'none') return
        if (!wrap.contains(ev.target)) menu.style.display = 'none'
      }
      document.addEventListener('mousedown', closeMenuIfOutside)

      addBtn.addEventListener('click', function (e) {
        e.stopPropagation()
        buildMenu(searchInp.value)
        var willShow = menu.style.display === 'none'
        document.querySelectorAll('.aes-fontcat-menu').forEach(function (m) { if (m !== menu) m.style.display = 'none' })
        menu.style.display = willShow ? 'block' : 'none'
      })
      searchInp.addEventListener('input', function () {
        if (menu.style.display !== 'none') buildMenu(searchInp.value)
      })
      menu.addEventListener('click', function (e) { e.stopPropagation() })

      function renderChips() {
        chips.textContent = ''
        if (!selected.length) {
          var empty = document.createElement('div')
          empty.className = 'aes-fontcat-empty'
          empty.textContent = '（未添加，agent 自由搭配）'
          chips.appendChild(empty)
          return
        }
        selected.forEach(function (ak) {
          var chip = document.createElement('span')
          chip.className = 'aes-chip'
          chip.style.fontFamily = "'" + ak + "',sans-serif"
          chip.title = ak + (isAliasKey(ak) && installed[ak] ? ' · 已装' : ' · 未装')
          chip.appendChild(document.createTextNode(aesDispFont(ak)))
          if (isAliasKey(ak) && installed[ak]) {
            var dot = document.createElement('span')
            dot.className = 'aes-chip-dot'
            dot.textContent = '✓'
            chip.appendChild(dot)
          }
          var x = document.createElement('button')
          x.type = 'button'
          x.className = 'aes-chip-x'
          x.textContent = '✕'
          x.title = '移除 ' + aesDispFont(ak)
          x.addEventListener('click', function (e) {
            e.stopPropagation()
            var idx = selected.indexOf(ak)
            if (idx !== -1) selected.splice(idx, 1)
            renderChips()
          })
          chip.appendChild(x)
          chips.appendChild(chip)
        })
      }

      renderChips()
      return {
        wrap: wrap,
        getValue: function () { return selected.slice() },
        setValue: function (names) {
          selected = (names || []).filter(function (n) { return isAliasKey(n) }).slice(0, 6)
          renderChips()
        },
      }
    }

    /** 新建风格模态：名称/slug/场景/标签/核心思路/色板编辑器/字体选择+预览/确定。 */
    function openAesNewStyle(existing) {
      existing = existing || null
      aesRpc('list-fonts').then(function (fd) {
        var aliasMap = (fd && fd.aliasMap) || {}
        var installed = (fd && fd.installed) || {}
        var view = document.getElementById(AES_VIEWER_ID)
        if (!view) return

        var mask = document.createElement('div')
        mask.className = 'aes-modal'
        var mpanel = document.createElement('div')
        mpanel.className = 'aes-modal-panel'

        var head = document.createElement('div')
        head.className = 'aes-head'
        var tWrap = document.createElement('div')
        var t = document.createElement('div')
        t.className = 'aes-title'
        t.textContent = existing ? '编辑美学风格' : '新建美学风格'
        var sub = document.createElement('div')
        sub.className = 'aes-subtitle'
        sub.textContent = existing ? '对「' + existing.name + '」进行改造，保存后即时生效' : '把找到的关键词与想法，变成一份可被检索的风格'
        tWrap.appendChild(t)
        tWrap.appendChild(sub)
        var close = document.createElement('button')
        close.className = 'aes-btn'
        close.textContent = '✕ 关闭'
        close.title = '关闭（不保存）'
        close.addEventListener('click', function () { aesCloseAllPickers(); mask.remove() })
        head.appendChild(tWrap)
        head.appendChild(close)
        mpanel.appendChild(head)

        var body = document.createElement('div')
        body.className = 'aes-modal-body'

        function field(label, node, hint) {
          var f = document.createElement('div')
          f.className = 'aes-field'
          var lb = document.createElement('label')
          lb.className = 'aes-field-label'
          lb.textContent = label
          f.appendChild(lb)
          f.appendChild(node)
          if (hint) { var h = document.createElement('div'); h.className = 'aes-muted'; h.textContent = hint; f.appendChild(h) }
          return f
        }

        var nameInp = document.createElement('input')
        nameInp.className = 'aes-input'
        nameInp.placeholder = '例如：琉璃手账 · 透明感'
        if (existing) nameInp.value = existing.name || ''
        body.appendChild(field('风格名称 *', nameInp))

        var slugInp = document.createElement('input')
        slugInp.className = 'aes-input'
        slugInp.placeholder = '留空自动生成（英文小写连字符最佳）'
        if (existing) { slugInp.value = existing.slug || ''; slugInp.readOnly = true; slugInp.title = '编辑模式下 slug 不可改（文件名/检索键）' }
        body.appendChild(field('标识 slug', slugInp, '留空将根据名称自动生成；仅用于文件命名与检索' + (existing ? '（编辑模式下锁定）' : '')))

        var sceneInp = document.createElement('input')
        sceneInp.className = 'aes-input'
        sceneInp.placeholder = '例如：手账 / 便签 / 心情记录'
        if (existing) sceneInp.value = existing.scene || ''
        body.appendChild(field('适用场景', sceneInp))

        var tagInp = document.createElement('input')
        tagInp.className = 'aes-input'
        tagInp.placeholder = '逗号分隔，例如：透明, 手账, 清新'
        if (existing) tagInp.value = existing.tags || ''
        body.appendChild(field('标签', tagInp))

        var descTa = document.createElement('textarea')
        descTa.className = 'aes-input aes-ta'
        descTa.rows = 4
        if (existing) descTa.value = existing.desc || ''
        descTa.placeholder = '这个风格的灵魂是什么？\n它像什么材质（纸/玻璃/塑料）？什么光（晨光/霓虹）？什么心绪（安静/雀跃）？\n有什么一眼可辨的视觉特征？\n写可迁移的判断逻辑——别人看到能照着做；留空可点「✨ AI 兜底」自动生成'
        var descWrap = document.createElement('div')
        var aiBtn = document.createElement('button')
        aiBtn.type = 'button'
        aiBtn.className = 'aes-btn'
        aiBtn.textContent = '✨ AI 生成'
        aiBtn.title = '输入你的想法后点击：AI 自动把名称/场景/标签/描述/色板/字体全部填好'
        aiBtn.addEventListener('click', function () {
          var idea = (nameInp.value || '') + ' ' + (sceneInp.value || '') + ' ' + (tagInp.value || '') + ' ' + (descTa.value || '')
          idea = idea.trim()
          if (!idea) { descTa.value = '（请输入你的想法，例如：想做一个透明感的手账风格，清新治愈）'; return }
          aiBtn.textContent = '⏳ AI 生成中…'
          aiBtn.disabled = true
          var hintEl = document.createElement('div')
          hintEl.className = 'aes-muted'
          hintEl.style.color = '#16a34a'
          hintEl.style.marginTop = '4px'
          hintEl.textContent = 'AI 正在理解你的想法并生成完整风格…'
          descWrap.appendChild(hintEl)
          aesRpc('ai-generate', { idea: idea }).then(function (d) {
            aiBtn.textContent = '✨ AI 生成'
            aiBtn.disabled = false
            if (!d || d.error) {
              hintEl.textContent = '生成失败：' + ((d && d.error && (d.error.message || JSON.stringify(d.error))) || '未知错误') + '，请重试或换一种描述'
              return
            }
            // 填名称/场景/标签/描述/slug
            if (d.name && !nameInp.value.trim()) nameInp.value = d.name
            if (d.slug && !slugInp.value.trim()) slugInp.value = d.slug
            if (d.scene && !sceneInp.value.trim()) sceneInp.value = d.scene
            if (d.tags && !tagInp.value.trim()) tagInp.value = d.tags
            if (d.desc) descTa.value = d.desc
            // 填色板
            if (d.colors && d.colors.length) {
              colorState = d.colors.slice()
              if (colorBox && colorBox.parentNode) {
                var newBox = aesColorEditor(colorState, function (c) { colorState = c })
                colorBox.parentNode.replaceChild(newBox, colorBox)
                colorBox = newBox
              }
            }
            // 填字体四分类
            if (d.fonts) {
              if (d.fonts.title) fontTitle.setValue(d.fonts.title)
              if (d.fonts.subtitle) fontSub.setValue(d.fonts.subtitle)
              if (d.fonts.body) fontBody.setValue(d.fonts.body)
              if (d.fonts.deco) fontDeco.setValue(d.fonts.deco)
            }
            hintEl.textContent = '✓ 已由 AI 生成完整风格，可再微调'
          })
        })
        descWrap.appendChild(descTa)
        descWrap.appendChild(aiBtn)
        descWrap.style.marginTop = '4px'
        body.appendChild(field('核心思路 / 判断准则', descWrap))

        var colorState = existing && existing.colors && existing.colors.length ? existing.colors.slice() : ['#F7F2EB', '#081F5C', '#334EAC', '#D4A017']
        var colorBox = aesColorEditor(colorState, function (c) { colorState = c })
        body.appendChild(field('色板', colorBox, '点色块改色，× 删除，+ 加色'))

        // 四分类字体：主标题/副标题/正文/装饰——agent 创作时按语境挑选，而非死绑一个
        // 编辑模式：预填 existing.fontCats（Host parseStyleMeta 解析的结构化字体分类）
        var initFonts = existing && existing.fontCats ? existing.fontCats : {}
        var fontTitle = aesFontCategory('主标题', initFonts.title || [], aliasMap, installed)
        var fontSub = aesFontCategory('副标题', initFonts.subtitle || [], aliasMap, installed)
        var fontBody = aesFontCategory('正文', initFonts.body || [], aliasMap, installed)
        var fontDeco = aesFontCategory('装饰', initFonts.deco || [], aliasMap, installed)
        var fontBlock = document.createElement('div')
        // 提示放在「字体分类（多选）」标题正下方、四分类之上
        var fontHint = document.createElement('div')
        fontHint.className = 'aes-fontcat-hint'
        fontHint.style.marginTop = '2px'
        fontHint.style.fontSize = '10px'
        fontHint.style.color = 'var(--dsw-alias-label-tertiary,#777)'
        fontHint.textContent = '每类可多选；agent 创作时会按内容语境从中挑选'
        fontBlock.appendChild(fontHint)
        fontBlock.appendChild(fontTitle.wrap)
        fontBlock.appendChild(fontSub.wrap)
        fontBlock.appendChild(fontBody.wrap)
        fontBlock.appendChild(fontDeco.wrap)
        body.appendChild(field('字体分类（多选）', fontBlock))

        mpanel.appendChild(body)

        var foot = document.createElement('div')
        foot.className = 'aes-modal-foot'
        var err = document.createElement('div')
        err.className = 'aes-muted'
        err.style.color = '#dc2626'
        err.style.flex = '1'
        var cancel = document.createElement('button')
        cancel.className = 'aes-btn'
        cancel.textContent = '取消'
        cancel.addEventListener('click', function () { aesCloseAllPickers(); mask.remove() })
        var ok = document.createElement('button')
        ok.className = 'aes-btn aes-btn-primary'
        ok.textContent = existing ? '保存修改' : '确定创建'
        ok.addEventListener('click', function () {
          var name = nameInp.value.trim()
          if (!name) { err.textContent = '请填写风格名称'; return }
          var slug = existing ? existing.slug : slugInp.value.trim()
          if (!slug) {
            slug = name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || ('user-style-' + Date.now().toString().slice(-6))
          }
          var payload = {
            name: name,
            slug: slug,
            scene: sceneInp.value.trim(),
            tags: tagInp.value.trim(),
            desc: descTa.value.trim(),
            colors: colorState,
            fonts: {
              title: fontTitle.getValue(),
              subtitle: fontSub.getValue(),
              body: fontBody.getValue(),
              deco: fontDeco.getValue(),
            },
          }
          var ep = existing ? 'update-style' : 'create-style'
          aesRpc(ep, payload).then(function (d) {
            if (d && d.error) { err.textContent = (existing ? '保存失败：' : '创建失败：') + (d.error.message || JSON.stringify(d.error)); return }
            if (!d || !d.slug) { err.textContent = (existing ? '保存失败：' : '创建失败：') + '未收到确认'; return }
            aesCloseAllPickers()
            mask.remove()
            var v = document.getElementById(AES_VIEWER_ID)
            if (v && typeof v._aesRender === 'function') v._aesRender()
          })
        })
        foot.appendChild(err)
        foot.appendChild(cancel)
        foot.appendChild(ok)
        mpanel.appendChild(foot)

        mask.appendChild(mpanel)
        view.appendChild(mask)

        mask.addEventListener('click', function (e) { if (e.target === mask) { aesCloseAllPickers(); mask.remove() } })
        var esc2 = function (e) { if (e.key === 'Escape') { aesCloseAllPickers(); mask.remove(); document.removeEventListener('keydown', esc2) } }
        document.addEventListener('keydown', esc2)
      })
    }

    // ---- 应用 ------------------------------------------------------------

    // ---- 官方 Slot 渲染（v2 核心：assistant-step 替换渲染器 · v1 引擎复用）----
    // 架构（定调 · 2026-09-02 v2 返工）：v1（patch/v6-inject.js）的渲染引擎已把
    // 流式增量 / 字体链 !important 锁权 / 消息级作用域化 / KaTeX·Mermaid / 安全过滤 /
    // 自愈层全部做到完美——v2 绝不重写渲染器，只解决「v1 依赖 bundle 补丁」这一个
    // 安装问题：把 v1 引擎【原样】复制为 assets/vcp-engine-v1.js，以
    //   new Function('vc','hp','f', engineSrc)()
    // 加载（引擎是自包含 IIFE，自由符号 vc/hp/f 由参数注入；其余 window/DOMParser/
    // Node/performance 等均浏览器全局）。引擎入口 window.__vcpStable.render(html, streaming)
    // 输入【卡 HTML 片段（含流式半截）】→ 输出 React 元素（内部做 scope/boost/流式增量）。
    // 依赖契约（v1 tests/stable.test.mjs 的 vm stub 实证）：f=React；
    // vc(domNode,key)=DOM→React 元素（含安全过滤）；hp(styleStr)=CSS 串→对象。
    // 本插件以【更低 priority】注册 conversation.chat.node 的 assistant-step 渲染器 shadow
    // 官方 AssistantNodeView（slots：keyed 同 key 同 priority 冲突 throw、低 priority 胜出）
    // → 遍历 node.data.blocks：
    //   · text 块：切 md / vcp-root 段——md 段 → 官方 MarkdownText（primitives，require
    //     失败纯文本兜底）；vcp/pending 段 → __vcpStable.render(html, streaming)（半截也
    //     喂引擎，原生流式：未闭合容器内部闭合子块逐步固化、样式随输出长出）
    //   · reasoning 块：轻量折叠；image 块：占位（ImageGallery 接入留待后续）
    //   · tool-call：跳过（ChatView 分组处理）
    // 槽位契约（rc.6 实测）：renderSlot("conversation.chat.node", owner, {entryKey})
    // → props 含 node（node.data.blocks / node.data.status）+ openFile/loadImage 等；
    // AssistantBlock: {kind:'text',text}|{kind:'reasoning',text}|{kind:'image',attachment}|
    // {kind:'tool-call',callId,name,argsRaw}|{kind:'other',block}。

    // 官方 MarkdownText（@deepseek-ai/dsh-client-ui-primitives）：require 失败或不可用
    // 时普通文本段降级为纯文本渲染（HTML 卡片渲染优先保证）。
    var vcpMdComp = null
    try {
      var vcpPrimitives = require('@deepseek-ai/dsh-client-ui-primitives')
      if (vcpPrimitives && vcpPrimitives.MarkdownText) vcpMdComp = vcpPrimitives.MarkdownText
    } catch (e) {
      vcpMdComp = null
    }
    var vcpCodeLabels = { copyLabel: '复制', copiedLabel: '已复制' }

    // md 段级错误边界（2026-09-02 · alpha.5 TypeError「reading 'code'」驱动）：官方
    // MarkdownText 对个别畸形文本（孤立 ```/$$ 等）会在渲染期抛错——若整条消息共用一个
    // 边界会连带卡也看不到。这里每个 md 段独立保护：坏段降级为转义原文显示（内容可见、
    // 便于反馈定位），同消息的卡/其它段正常渲染。
    function VcpMdSafe(props) {
      React.Component.call(this, props)
      this.state = { err: null }
    }
    VcpMdSafe.prototype = Object.create(React.Component.prototype)
    VcpMdSafe.prototype.constructor = VcpMdSafe
    VcpMdSafe.prototype.componentDidCatch = function (err) {
      console.error('[dsh-raw-html-v2] md 段渲染降级（原文可见）：', err && err.message, err && err.stack ? err.stack : '')
      try {
        var dbgTxt = String(this.props.text || '').replace(/\s+/g, ' ').slice(0, 600)
        console.error('[dsh-raw-html-v2] md 段降级原文片段（前 600 字）:', dbgTxt)
      } catch (e4) {}
      this.setState({ err: err })
    }
    VcpMdSafe.prototype.render = function () {
      if (this.state.err !== null) {
        var esc = String(this.props.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        return createElement('pre', {
          style: {
            margin: '4px 0', padding: '8px 10px', fontSize: '11.5px', lineHeight: '1.55',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'var(--dsw-alias-markdown-code-block,rgba(0,0,0,.05))',
            color: 'var(--dsw-alias-label-tertiary,#777)', borderRadius: '8px',
            border: '1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.2))',
          },
        }, esc)
      }
      return this.props.children
    }

    // 行内 ``` 避雷（2026-09-02 · alpha.5 官方 MarkdownText 对段落中行内 ``` 解析崩溃
    // 「reading 'code'」）：真围栏 ``` 必须在行首；正文里出现的行内 ```（如引用代码片段）
    // 转义为 \`\`\` → md 渲染出字面 ```，不再触发官方解析器 bug。围栏内/代码块内不处理
    // （fence 行首原样保留切换状态，fence 内行不动——代码内容含 ``` 不受影响；未闭合
    // fence（流式半截）时 fence 内不转义，与官方 streaming 代码块语义一致）。
    function mdEscapeInlineFences(md) {
      var lines = String(md || '').split('\n')
      var inFence = false
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i]
        if (/^[ \t]{0,3}```/.test(line)) {
          inFence = !inFence
          continue
        }
        if (!inFence && line.indexOf('```') !== -1) {
          lines[i] = line.replace(/```/g, '\\`\\`\\`')
        }
      }
      return lines.join('\n')
    }

    /** 围栏感知拆分（v0.7.14 · 2026-09-02 实测驱动）：把 md 按行首 ``` 围栏切成
     *  md 子段与 code 子段交替。目的：官方 MarkdownText 的代码围栏渲染路径存在
     *  TypeError「reading 'code'」缺陷（孤立/流式半截 fence 触发）——一旦崩整条 md 段
     *  降级、普通文字陪葬（实测：消息里一个代码块让整段 md 变转义原文）。本函数把 fence
     *  全部抽走交 VcpCodeBlock 自绘，官方 MarkdownText 只收到无 ``` 的文本 → 从根上
     *  绕过官方 fence bug；降级粒度从「整段」缩到「md 子段」。未闭合 fence（流式半截）
     *  按 code 子段处理。 */
    function splitMdFences(md) {
      var out = []
      var buf = ''
      var lang = ''
      var inF = false
      var lines = String(md || '').split('\n')
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i]
        if (/^[ \t]{0,3}```/.test(line)) {
          if (!inF) {
            if (buf) { out.push({ type: 'md', text: buf }); buf = '' }
            inF = true
            lang = line.replace(/^[ \t]{0,3}```+[ \t]*/, '').trim()
          } else {
            inF = false
            out.push({ type: 'code', lang: lang, text: buf })
            buf = ''
            lang = ''
          }
          continue
        }
        buf += (buf ? '\n' : '') + line
      }
      if (buf) {
        if (inF) out.push({ type: 'code', lang: lang, text: buf })
        else out.push({ type: 'md', text: buf })
      }
      return out.length ? out : [{ type: 'md', text: String(md || '') }]
    }

    /** 代码围栏子段自绘组件（接管官方 MarkdownText 的 fence 渲染路径，见 splitMdFences）。
     *  深色代码块 + 语言标签 + 复制按钮；文本以 React 文本节点输出（自动转义，安全）。 */
    function VcpCodeBlock(props) {
      var text = String(props.text == null ? '' : props.text)
      if (text.slice(-1) === '\n') text = text.slice(0, -1)
      var lang = props.lang || ''
      return createElement('div', {
        style: {
          margin: '8px 0', borderRadius: '10px', overflow: 'hidden',
          background: '#0d1117', border: '1px solid rgba(13,17,23,.25)',
        },
      },
        createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '4px 12px', background: 'rgba(255,255,255,.04)',
            borderBottom: '1px solid rgba(255,255,255,.06)',
            fontSize: '10.5px', color: 'rgba(230,237,243,.55)',
            letterSpacing: '.06em', fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace',
          },
        },
          createElement('span', null, lang || 'code'),
          createElement('button', {
            type: 'button', title: '复制代码',
            onClick: function () {
              try { if (navigator && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text) } catch (e) {}
            },
            style: {
              background: 'transparent', border: 'none', color: 'rgba(230,237,243,.6)',
              cursor: 'pointer', fontSize: '10.5px', padding: '2px 6px', borderRadius: '4px',
              fontFamily: 'inherit',
            },
          }, '复制')),
        createElement('pre', {
          style: {
            margin: '0', padding: '10px 14px', overflowX: 'auto',
            fontSize: '12.5px', lineHeight: '1.7', color: '#e6edf3',
            fontFamily: 'ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace',
            whiteSpace: 'pre', wordBreak: 'normal',
          },
        },
          createElement('code', { style: { fontFamily: 'inherit', whiteSpace: 'pre' } }, text)))
    }

    /** 文本段 → React 元素（v0.7.14）：md 子段走官方 MarkdownText（fence 已抽走 +
     *  行内 ``` 避雷 + md 子段级错误边界），code 子段走 VcpCodeBlock 自绘——官方 fence
     *  渲染 bug（TypeError reading 'code'）从根上绕过；官方组件不可用时整段纯文本兜底。
     *  注意：VcpMdSafe fallback 显示子段原始文本（未转义前）便于反馈定位。 */
    function renderMdSegment(text, streaming, key) {
      var t = String(text || '')
      if (!vcpMdComp) {
        return createElement('div', {
          key: key,
          style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '1.2em' },
        }, t)
      }
      var segs = splitMdFences(t)
      var kids = []
      for (var si = 0; si < segs.length; si++) {
        var s = segs[si]
        if (s.type === 'code') {
          kids.push(createElement(VcpCodeBlock, { key: key + '-c' + si, lang: s.lang, text: s.text }))
        } else {
          var safeS = mdEscapeInlineFences(s.text)
          kids.push(createElement(VcpMdSafe, { key: key + '-m' + si, text: s.text },
            createElement(vcpMdComp, {
              text: safeS,
              streaming: streaming === true,
              codeLabels: vcpCodeLabels,
            })))
        }
      }
      return createElement(React.Fragment, { key: key }, kids.length ? kids : t)
    }

    /** 思考块轻量折叠（仿官方 ReasoningRow 观感，零依赖自绘）。 */
    function VcpReasoningRow(props) {
      var text = String(props.text || '')
      var lines = text.split('\n').map(function (s) { return s.trim() }).filter(Boolean)
      var summary = props.running
        ? (lines[lines.length - 1] || '…')
        : (lines[0] || '')
      return createElement('details', {
        style: {
          display: 'flex', flexDirection: 'column', margin: '2px 0',
          border: '1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))',
          borderRadius: '10px', padding: '6px 12px',
          background: 'var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.03))',
          fontSize: '13px', lineHeight: '20px',
          color: 'var(--dsw-alias-label-primary,#111)',
          cursor: 'pointer',
        },
      },
        createElement('summary', {
          style: {
            display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            color: 'var(--dsw-alias-label-secondary,#666)',
            outline: 'none', listStyle: 'none',
          },
        },
          createElement('span', { style: { flex: 'none', fontSize: '11px', fontWeight: '600' } }, props.running ? '思考中…' : '思考过程'),
          createElement('span', {
            style: {
              flex: '1', minWidth: '0', overflow: 'hidden', whiteSpace: 'nowrap',
              textOverflow: 'ellipsis', fontSize: '12px',
              color: 'var(--dsw-alias-label-tertiary,#999)',
            },
          }, summary)),
        createElement('div', {
          style: {
            marginTop: '6px', padding: '8px 10px', whiteSpace: 'pre-wrap',
            wordBreak: 'break-word', maxHeight: '260px', overflow: 'auto',
            fontSize: '12.5px', lineHeight: '1.7',
            color: 'var(--dsw-alias-label-secondary,#555)',
            background: 'var(--dsw-alias-bg-overlay,rgba(0,0,0,.02))',
            borderRadius: '8px', cursor: 'auto',
          },
        }, text))
    }

    // ---- vcp-root 提取 / 切段（参考 v1 v6-inject.js 的配平思路，React 化）---------

    /** 自 html 的 from 起做标签级扫描：配平 <div>…</div> 嵌套，返回闭合点 end；未闭合返回 end=-1。
     *  depth 初始 1：根 <div id="vcp-root"> 的开标签在 openEnd 之前，已计入一层。 */
    function scanVcpDiv(html, openEnd) {
      var depth = 1
      var i = openEnd
      var len = html.length
      while (i < len) {
        var lt = html.indexOf('<', i)
        if (lt === -1) break
        if (html.startsWith('<!--', lt)) {
          var ce = html.indexOf('-->', lt + 4)
          if (ce === -1) break
          i = ce + 3
          continue
        }
        var gt = html.indexOf('>', lt + 1)
        if (gt === -1) break
        var raw = html.slice(lt, gt + 1)
        var name = /^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw)
        var isClose = /^<\s*\//.test(raw)
        var selfClose = /\/\s*>$/.test(raw) || /^<\s*(?:!|meta|link|br|hr|img|input|source|area|base|col|embed|track|wbr)\b/i.test(raw)
        if (name && !isClose && !selfClose) {
          var nm = name[1].toLowerCase()
          if (nm === 'div') depth += 1
          else if (/^(script|style|textarea|title)$/.test(nm)) {
            // 跳过 RAW 文本元素（其内容里的 </div> 不是标签——按 v1 思路）
            var closer = html.toLowerCase().indexOf('</' + nm + '>', gt + 1)
            if (closer === -1) break
            i = closer + nm.length + 3
            continue
          }
        } else if (isClose && name) {
          var nm2 = name[1].toLowerCase()
          if (nm2 === 'div') {
            depth -= 1
            if (depth <= 0) return { start: -1, end: gt + 1 }
          }
        }
        i = gt + 1
      }
      return { start: -1, end: -1 } // 未闭合
    }

    /** 找 <div … id="vcp-root" …> 开标签（属性顺序任意）。未发现返回 null。
     *  块级卡判定（实测 2026-09-02 修正）：开标签必须位于【行首】（行首到标签
     *  起点只允许空白/制表）——markdown 里作为说明文字/行内提及的 `<div id="vcp-root">`
     *  字样（如「没有包 <div id="vcp-root">」）不是卡片，不能被误切撕碎整条消息；
     *  与 v1 依赖 mdast html 块（独立块才成节点）的语义对齐。 */
    function findVcpOpen(text, from) {
      var t = String(text || '')
      var re = /<div\b[^>]*?\bid\s*=\s*["']vcp-root["'][^>]*>/gi
      re.lastIndex = from || 0
      var m = null
      while ((m = re.exec(t))) {
        var lineStart = t.lastIndexOf('\n', m.index - 1) + 1
        if (/^[ \t]*$/.test(t.slice(lineStart, m.index))) {
          return { start: m.index, end: re.lastIndex }
        }
        // 行内/说明文字中的字样 → 跳过继续找
      }
      return null
    }

    /** 紧跟闭合点之后（允许空白）吞并同属卡片的 <style>/<script> 兄弟块（模型把
     *  样式/交互脚本写在卡尾 </div> 之外）。script 必须随卡进引擎——可信模式由
     *  extractTrustedScripts 提取执行（源码不显示），非可信由 vc 丢弃（安全默认）；
     *  若 script 落入 md 段会被官方 MarkdownText 转义显示成源码（实测溢出代码格式）。
     *  流式半截（2026-09-02 长 script 压测定位）：流式 chunk 把 script 从中间切开时，
     *  半截帧无 </script>，旧正则不吞 → script 源码落 md 段溢出（长 script 必现，短 script
     *  侥幸完整到达不显形）。修复：闭合或未闭合（吞到文尾）都吞——未闭合的 style/script
     *  交给引擎 v3 的 RAWTEXT 跨帧续接处理（半截静默复用、闭合帧一次 fullRender 提取执行），
     *  md 段保持干净。while 循环吞多个（style/script 交替、任意顺序）。 */
    function swallowTrailingRaw(text, end) {
      var pos = end
      while (pos < text.length) {
        var i = pos
        while (i < text.length && /\s/.test(text[i])) i++
        var m = /^<(style|script)\b[\s\S]*?(?:<\/\1>|$)/i.exec(text.slice(i))
        if (!m || m[0].length === 0) return pos
        pos = i + m[0].length
      }
      return pos
    }
    function swallowTrailingStyle(text, end) {
      var i = end
      while (i < text.length && /\s/.test(text[i])) i++
      var m = /^<style[\s\S]*?<\/style>/i.exec(text.slice(i))
      if (!m) return end
      // style 内若还有 vcp-root 文本需要随卡作用域化，一并吞入
      return i + m[0].length
    }

    // ---- 整页 HTML（可信程序页：<!DOCTYPE html>…</html> 含 script/canvas/css）----
    // v1 能力：正文里输出完整网页源码（如 canvas 动画 demo）→ html 块渲染 + 可信模式
    // 放行 script（引擎 extractTrustedScripts→flushTrustedScripts，需 window.__vcpTrusted）。
    // v2 接入层补「识别整页段」并把页面级 html/body 选择器脱敏为 .vcp-page-host
    // （防 body{background:#111} 等全局污染 DSH 页面——vcp-root 卡内 style 走 #uid 隔离，
    // 整页无根容器，需这一道）。
    var PAGE_OPEN_RE = /(?:^|[\r\n]{1,2})(<!doctype\s+html\b[^>]*>|<html\b[^>]*>)/gi
    /** 找整页 html 起点（<!DOCTYPE html> / <html …>，须在行首出现避免误伤正文讨论）。
     *  tagEnd 指向标签结束；start 同（前导换行归 md 段）。 */
    function findPageOpen(text, from) {
      var t = String(text || '')
      var re = PAGE_OPEN_RE
      re.lastIndex = from || 0
      var m = re.exec(t)
      if (!m) return null
      var tag = m[1] || m[2]
      return { start: m.index + m[0].length - tag.length, tagEnd: m.index + m[0].length }
    }
    /** 页面闭合点：找 </html>（含尾随空白）。未闭合返回 -1（流式中途/被截断）。 */
    function scanPageEnd(text, after) {
      var m = /<\/html\s*>/i.exec(String(text || '').slice(after))
      return m ? after + m.index + m[0].length : -1
    }
    /** 页面样式脱敏：style 内的独立 html/body 选择器 → .vcp-page-host（防全局污染）。
     *  同时覆盖未闭合 <style>（流式中途），字符串/注释内的字样不受影响（前导符约束）。 */
    function scopePageCss(html) {
      return String(html || '').replace(/<style\b[^>]*>([\s\S]*?)(?:<\/style>|$)/gi, function (all, css) {
        var fixed = css.replace(/(^|[,}\s>])(html|body)(?=[\s,.#:>\[{])/gi, '$1.vcp-page-host')
        return fixed === css ? all : all.replace(css, fixed)
      })
    }

    // ---- markdown 段里的 ```mermaid 围栏（甘特图/思维图/时序图等，v1 未覆盖、官方只显示
    // 代码）→ 转 HTML 喂引擎渲染。形态对齐卡内成功路径：<pre><code class="language-mermaid">
    // （code 带 class——引擎 renderMermaidInContent 的 pre>code 分支为实测成功路径；
    // pre 自带 class 会先被源码层 mermaidBlockConvert 转 div.mermaid 走弱分支，勿用）。
    // 围栏未闭合（流式中）留 md 段由官方 streaming 显示代码块，闭合后下一帧切成图。----
    var MERMAID_FENCE_RE = /(^|\n)[ \t]*```[ \t]*mermaid[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*(?=\n|$)/gi
    function splitMermaidFence(md) {
      var out = []
      var t = String(md || '')
      var re = MERMAID_FENCE_RE
      re.lastIndex = 0
      var last = 0
      var m = null
      while ((m = re.exec(t))) {
        var start = m.index + m[1].length
        if (start > last) out.push({ type: 'md', text: t.slice(last, start) })
        var code = m[2]
        var esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        out.push({ type: 'mermaid', html: '<pre><code class="language-mermaid">' + esc + '</code></pre>' })
        last = m.index + m[0].length
      }
      if (last < t.length) out.push({ type: 'md', text: t.slice(last) })
      return out
    }

    /** 把一条 assistant text 切成段：{type:'md'|'vcp'|'pending'|'page', text?, html?}。
     *  vcp：完整闭合的 vcp-root 卡片 HTML；pending：vcp-root 已开未闭合（流式）；
     *  page：整页 HTML 文档（<!DOCTYPE html>/<html 起至 </html>，未闭合则 text 存半截）。
     *  顺带剥离 v1 锚点 E 对齐的「纯围栏包装」：```html\n <卡> \n``` 时围栏行不进 md。 */
    function stripFenceWrapper(md) {
      var t = String(md || '')
      t = t.replace(/^[ \t]*```[^\n]*\n+/, '')
      t = t.replace(/\n[ \t]*```[ \t]*\n?$/, '')
      return t
    }
    /** F1 修复（2026-09-02 实测驱动 · 流式起始源码闪一帧）：vcp-root 开标签逐字
     *  输出时 id 尚未凑齐（如 '<div id="vcp-r…'）→ findVcpOpen 识别不到 → 半截 HTML
     *  落入 md 段被渲染成源码样文本（视觉：卡片出现前代码块溢出闪一下）。处理：把 md
     *  尾部「未完成开标签」剥掉不渲染——下一帧 id 完整后走 pending/vcp 正常流式，前面
     *  文字已在上一帧渲染、不会重放 → 闪烁消除。仅剥「字母开头的未闭合标签样」尾巴，
     *  不误伤 'a < b' 等比较符；多层半截（<div…<style 等）循环剥，上限 8 层防呆。 */
    function trimTrailingOpenTag(s) {
      var t = String(s || '')
      var out = t
      var guard = 0
      while (guard++ < 8) {
        var lt = out.lastIndexOf('<')
        if (lt === -1) break
        if (out.indexOf('>', lt) !== -1) break // 该 '<' 之后已闭合，非半截
        if (!/^<[a-zA-Z]/.test(out.slice(lt))) break // 非标签形态（比较符/实体等）
        out = out.slice(0, lt)
      }
      return out
    }
    function splitVcpText(text) {
      var out = []
      var t = String(text || '')
      var pos = 0
      var mdStart = 0
      while (pos < t.length) {
        var openV = findVcpOpen(t, pos)
        var openP = findPageOpen(t, pos)
        var useP = openP && (!openV || openP.start < openV.start)
        if (!openV && !openP) break
        var start = useP ? openP.start : openV.start
        if (start > mdStart) {
          var mdSeg = trimTrailingOpenTag(stripFenceWrapper(t.slice(mdStart, start)))
          if (mdSeg) out.push({ type: 'md', text: mdSeg })
        }
        if (useP) {
          var pEnd = scanPageEnd(t, openP.tagEnd)
          if (pEnd === -1) {
            out.push({ type: 'page', text: t.slice(start) }) // 未闭合：整段半截交给引擎流式
            mdStart = t.length
            break
          }
          out.push({ type: 'page', html: t.slice(start, pEnd) })
          mdStart = pEnd
          pos = pEnd
          continue
        }
        var scan = scanVcpDiv(t, openV.end)
        if (scan.end === -1) {
          // 未闭合：开标签自身可能仍在流式（id 属性还没写完就找不到 open → 落到 md）。
          // 一旦 id 完整出现而未闭合 → pending 尾巴，不再切分其后内容。
          out.push({ type: 'pending', text: t.slice(openV.start) })
          mdStart = t.length
          break
        }
        var end = swallowTrailingRaw(t, scan.end)
        out.push({ type: 'vcp', html: t.slice(openV.start, end) })
        mdStart = end
        pos = end
      }
      if (mdStart < t.length) {
        var tailMd = trimTrailingOpenTag(stripFenceWrapper(t.slice(mdStart)))
        if (tailMd) out.push({ type: 'md', text: tailMd })
      }
      return out
    }

    // ---- v1 渲染引擎复用（核心）：vcp-engine-v1.js 引导 + vc/hp shim -------------
    // 引擎原样来自 v1 patch/v6-inject.js（自包含 IIFE），自由符号仅 vc/hp/f：
    //   f  = React（Fragment/jsx）；vc = DOM 节点 → React 元素（安全过滤）；
    //   hp = CSS 字符串 → 对象。契约实证：v1 tests/stable.test.mjs（vm stub 驱动流式帧）。
    // 加载：同步 XHR 拉 /vendor-v2/vcp-engine-v1.js → new Function('vc','hp','f', src)()
    // 执行 → 引擎挂 window.__vcpStable（render/fixBlank）与 window.__vcpMath 等。
    // 引擎产出即 React 元素（含流式增量 / scope / !important 字体锁权 / KaTeX·Mermaid
    // ref 后处理 / 自愈层），渲染器只做「切段 → 喂给引擎」的搬运，不重写任何渲染逻辑。

    // vc 用：内联 style 安全过滤（与 v1 宿主 vc / stable.test.mjs stub 同规则）
    function vcpFilterStyle(sv) {
      return String(sv || '')
        .replace(/position\s*:\s*fixed\s*;?/gi, '')
        .replace(/z-index\s*:\s*\d{4,}\s*;?/gi, '')
        .replace(/(?<![\w-])content\s*:[^;]*;?/gi, '')
    }
    // hp：CSS 声明串 → camelCase 对象（引擎 parseOpen/属性转换用）
    function vcpHpShim(s) {
      var r = {}
      var parts = String(s || '').split(';')
      for (var i = 0; i < parts.length; i++) {
        var idx = parts[i].indexOf(':')
        if (idx === -1) continue
        var k = parts[i].slice(0, idx).trim().replace(/-([a-z])/g, function (h, p) { return p.toUpperCase() })
        r[k] = parts[i].slice(idx + 1).trim()
      }
      return r
    }
    function vcpAllowHref(v) { return /^(https?:|mailto:|\/|#)/i.test(v) }
    function vcpAllowSrc(v) { return /^(https?:|data:image\/|\/|#)/i.test(v) }
    // vc：DOM 节点 → React 元素（安全过滤 + onclick 桥 window.__dshInput）
    function vcpVcShim(node, key) {
      if (!node) return null
      if (node.nodeType === 3) return node.textContent
      if (node.nodeType !== 1) return null
      var tag = node.localName
      // script 内容已由引擎 extractTrustedScripts 按可信模式提前提取（此处丢弃元素无碍）；
      // object/embed 过时高风险一律丢弃。iframe：https/http/相对 src 放行（B 站/YouTube
      // 第三方嵌入——浏览器同源沙箱内隔离，与引擎 parseOpen 的 src 白名单语义一致），
      // 无 src / 危险协议（javascript: data:text/html 等）丢弃。
      if (tag === 'script' || tag === 'object' || tag === 'embed') return null
      if (tag === 'iframe') {
        var fsrc = ''
        for (var fi = 0; fi < node.attributes.length; fi++) {
          if (node.attributes[fi].name === 'src') { fsrc = node.attributes[fi].value; break }
        }
        if (!/^(https?:|\/)/i.test(fsrc)) return null
      }
      var props = { key: key }
      // 可信模式：收集 on* 事件源码，循环结束后统一经 ref 直写 DOM attribute（浏览器
      // 原生 inline handler 机制）——绕开 React 属性管线对事件名的特殊处理，GUI 点击与
      // 下载快照行为完全一致（2026-09-02 实测「小写透传点不动」后改用 ref 直写）
      var vcpTrustedNow = typeof window.__vcpTrusted === 'function' && window.__vcpTrusted()
      var extraOn = []
      for (var i = 0; i < node.attributes.length; i++) {
        var c = node.attributes[i]
        var nm = c.name
        if (nm === 'onclick') {
          // 通道一（永远可用）：input('...') 桥 → React onClick → window.__dshInput 真发送
          var m = /^input\s*\(\s*['"]([\s\S]*?)['"]\s*\)\s*;?\s*$/.exec(c.value)
          if (m) props.onClick = function () { var fn = window.__dshInput; if (fn) fn(m[1]) }
          // 通道二（可信模式 · 2026-09-02 定调放宽）：自定义函数 onclick 由 ref
          // 直写原生 attribute（函数需由卡内 <script> 定义在全局作用域）
          else if (vcpTrustedNow) extraOn.push(['onclick', c.value])
          continue
        }
        if (/^on/i.test(nm)) {
          // 其它 on*（onchange/onmouseover/…）：默认剥离；可信模式同走 ref 直写
          if (vcpTrustedNow) extraOn.push([nm, c.value])
          continue
        }
        if (nm === 'style') { props.style = vcpHpShim(vcpFilterStyle(c.value)); continue }
        if (nm === 'class') { props.className = c.value; continue }
        if (nm === 'href' && !vcpAllowHref(c.value)) continue
        if (nm === 'src' && !vcpAllowSrc(c.value)) continue
        if (nm === 'allowfullscreen') { props.allowFullScreen = true; continue } // React 驼峰
        props[nm] = c.value
      }
      if (extraOn.length && !props.ref) {
        props.ref = (function (pairs) {
          return function (el) {
            if (!el) return
            try { for (var p = 0; p < pairs.length; p++) el.setAttribute(pairs[p][0], pairs[p][1]) } catch (e2) {}
          }
        })(extraOn)
      }
      var kids = []
      for (var j = 0; j < node.childNodes.length; j++) {
        var ch = vcpVcShim(node.childNodes[j], j)
        if (ch !== null && ch !== undefined) kids.push(ch)
      }
      return createElement(tag, props, kids.length ? kids : undefined)
    }

    /** 字体 url 路径兼容：url('/fonts/…') → url('/fonts-v2/…')（v1 协议旧路径兜底归一；
     *  幂等——/fonts-v2/ 前缀不会被 /fonts/ 规则命中）。 */
    function vcpFontUrlCompat(html) {
      return String(html || '').replace(/url\(\s*(['"]?)\/fonts\//gi, 'url($1/fonts-v2/')
    }

    // ---- 根容器字体 DOM 锁定（2026-09-02 · 流式丝滑 + settle 不回退的最终方案）----
    // 问题演变：① 引擎兜底 #uid div{font-family:inherit !important} 压掉非 important 的根
    //   容器内联字体 → settle（fullRender 无 parseOpen 的 ref 锁）后整卡回退系统字体；
    // ② 字符串追加锁定规则（vcpRootFontLock）虽修回退，但追加的 style 在流式中每帧位于
    //   正文尾部、位置随正文增长浮动 → 结构乱/掉格式/字体不即时。
    // 本方案不加任何字符串：display:contents 守卫组件包住引擎产物，ref 挂载时（React
    // 每帧 commit 均触发，幂等）直接对根容器 DOM 元素 setProperty('font-family', 内联值,
    // 'important')——与引擎 parseOpen 的 ref 锁同机制，流式中与 settle 后一致执行：
    // 根字体即时生效、永不回退、零结构干扰（display:contents 不产生盒）。
    function VcpRootFontGuard(props) {
      return createElement('div', {
        style: { display: 'contents' },
        ref: function (el) {
          if (!el || !el.querySelector) return
          try {
            var root = el.querySelector('[id^="vcp-msg-"], [id="vcp-root"]')
            if (!root || !root.style) return
            var fam = root.style.fontFamily
            if (fam && fam.indexOf('!important') === -1 && fam.indexOf('important') === -1) {
              root.style.setProperty('font-family', fam, 'important')
            }
          } catch (e5) {}
        },
      }, props.children)
    }

    var vcpEngineState = { tried: 0, ready: false }
    /** 加载 v1 渲染引擎（同步 XHR，本地静态文件秒回；失败异步重试 5 次）。幂等。 */
    function ensureVcpEngine() {
      if (window.__vcpStable && typeof window.__vcpStable.render === 'function') { vcpEngineState.ready = true; return }
      if (vcpEngineState.tried > 5) return
      vcpEngineState.tried += 1
      try {
        var xhr = new XMLHttpRequest()
        xhr.open('GET', '/vendor-v2/vcp-engine-v1.js', false)
        xhr.send()
        if (xhr.status === 200 && xhr.responseText && xhr.responseText.indexOf('__vcpStable') !== -1) {
          // f 必须提供 jsx/Fragment（引擎流式组装路径调用 f.jsx）——React 主对象没有 .jsx
          // 方法（在 react/jsx-runtime），直接用 React.createElement 等价实现（engine-smoke
          // 一直包装即通过；client 曾漏包 → 流式路径 f.jsx is not a function 每帧崩 → 卡
          // 只能等 settle 走 fullRender 才整块出现。alpha.5 实测定位 2026-09-02）
          var fn = new Function('vc', 'hp', 'f', xhr.responseText)
          var vcpF = { Fragment: React.Fragment, jsx: React.createElement }
          fn(vcpVcShim, vcpHpShim, vcpF)
          vcpEngineState.ready = !!(window.__vcpStable && typeof window.__vcpStable.render === 'function')
          if (vcpEngineState.ready) return
        }
      } catch (e) {
        console.warn('[dsh-raw-html-v2] vcp-engine 同步加载失败', (e && e.message) || e)
      }
      window.setTimeout(ensureVcpEngine, 500)
    }
    // 立即加载（apply 前）；引擎产物 ref 回调依赖的 KaTeX/Mermaid 由 apply 的 ensure* 加载
    ensureVcpEngine()

    var vcpDbgLast = 0
    // settle 复用缓存（2026-09-02 · 收尾闪修复）：引擎 settle 帧（streaming=false）
    // 走 fullRender——而 fullRender 不查缓存、每次 resetF + 全新建树，与流式闭合帧的
    // fullRender 叠加 = 「全部渲染完成后又闪一下」（两次全新构建 commit）。这里按
    // (key + html) 记住最后一次引擎产物：settle 帧内容与上帧完全一致 → 直接复用上帧
    // 元素（已挂载 DOM、React diff 零更新 → 零闪）。html 变化 / 首帧 / 段结构变化自然
    // 失配走正常引擎路径；历史消息 IO 降级后升级同样命中 → 顺带免引擎重跑。
    var vcpSettleMemo = new Map() // key → { html, el }
    var VCP_SETTLE_MEMO_MAX = 16

    /** 卡 HTML（闭合或流式半截）→ React 元素：喂 v1 引擎；引擎未就绪时给轻量占位。 */
    function vcpEngineRender(html, streaming, key) {
      if (!vcpEngineState.ready || !window.__vcpStable || typeof window.__vcpStable.render !== 'function') {
        // 引擎未就绪（几乎不会发生：同步加载在 client 启动早期完成）
        return createElement('div', {
          key: key,
          style: { padding: '6px 0', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary,#999)' },
        }, streaming ? '✦ 正在生成视觉卡片…' : '（VCP 渲染引擎未就绪）')
      }
      var memoKey = key === undefined || key === null ? '' : String(key)
      var el = null
      var rawHtml = String(html || '')
      // 字体路径兼容垫片（2026-09-02 实测「艺术字全黑体」根因）：协议文档/模型输出
      // 沿用 v1 路径 url('/fonts/…')，而 v2 字体路由是 /fonts-v2/ → 404 → 全部回退黑体。
      // 渲染前把卡内字体 url 归一为 v2 路由（历史卡/存量模型输出一次修复，引擎零改动）。
      rawHtml = vcpFontUrlCompat(rawHtml)
      // settle 复用：非流式且内容与 memo 一致 → 直接返回上帧元素（跳过引擎 fullRender）
      if (streaming !== true && memoKey) {
        var hit = vcpSettleMemo.get(memoKey)
        if (hit && hit.html === rawHtml && hit.el !== null) {
          return createElement(VcpRootFontGuard, { key: key }, hit.el)
        }
      }
      try {
        // 与 v1 宿主一致的前处理：fixBlank 压缩 vcp-root 内空行 + 前置空行兜底
        if (window.__vcpStable && typeof window.__vcpStable.fixBlank === 'function') {
          try { rawHtml = window.__vcpStable.fixBlank(rawHtml) } catch (e) {}
        }
        el = window.__vcpStable.render(rawHtml, streaming === true)
      } catch (e) {
        console.warn('[dsh-raw-html-v2] v1 引擎 render 异常，回退文本', (e && e.message) || e)
      }
      // 帧级诊断（节流 500ms）：确认流式中引擎是否被逐帧调用、产物是否为空
      var nowDbg = Date.now()
      if (nowDbg - vcpDbgLast > 500) {
        vcpDbgLast = nowDbg
        try {
          console.debug('[vcp-v2-frame] len=' + rawHtml.length + ' streaming=' + (streaming === true) + ' el=' + (el === null || el === undefined ? 'NULL' : 'OK') + ' head=' + rawHtml.slice(0, 60).replace(/\s+/g, ' '))
        } catch (e3) {}
      }
      if (el === null || el === undefined) return null
      // 记录 memo（流式帧与 settle 帧都记；LRU 裁上限，防多消息累积）
      if (memoKey) {
        try {
          vcpSettleMemo.set(memoKey, { html: rawHtml, el: el })
          if (vcpSettleMemo.size > VCP_SETTLE_MEMO_MAX) {
            var it = vcpSettleMemo.keys().next()
            if (!it.done) vcpSettleMemo.delete(it.value)
          }
        } catch (e4) {}
      }
      // 引擎元素用守卫组件包裹：补 key + 根容器字体 DOM 锁定（display:contents 零结构影响）
      return createElement(VcpRootFontGuard, { key: key }, el)
    }

    /** 整页 HTML（可信程序页）渲染：style 内 html/body 选择器脱敏为 .vcp-page-host 后喂
     *  引擎（script 由引擎 extract→flush 按可信模式执行）；外层 frame（限高滚动）+ host
     *  （承接页面级样式，防 body{…} 全局污染 DSH）。 */
    function vcpPageRender(seg, streaming, key) {
      var rawHtml = seg.html !== undefined && seg.html !== null ? seg.html : (seg.text || '')
      var html = scopePageCss(rawHtml)
      var inner = vcpEngineRender(html, streaming)
      if (inner === null || inner === undefined) return null
      return createElement('div', {
        key: key,
        style: {
          boxSizing: 'border-box', width: '100%', margin: '2px 0',
          borderRadius: '10px', overflow: 'auto', maxHeight: '72vh',
          border: '1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))',
          background: 'var(--dsw-alias-bg-overlay,#ffffff)',
        },
      },
        createElement('div', {
          className: 'vcp-page-host',
          style: { boxSizing: 'border-box', width: '100%' },
        }, inner))
    }


    // ---- assistant-step 替换渲染器（MyAssistantView）----------------------------
    // 热窗策略（定调 2026-09-02 · 治「历史卡全量重建」卡顿）：
    //   官方按批加载全部会话消息并一次性渲染——历史卡/图/程序越积越多，打开/切会话
    //   时同步重建+后处理爆发。解法 = 滚动跟随窗口（IO follower）：
    //   · 可视区 + 预取半径（VCP_HOT_RADIUS ≈ 两屏）内的引擎段 → 全量渲染（md 文本
    //     任何模式都照常官方渲染，零影响）；
    //   · 窗口外 → 引擎段渲染轻量占位（VcpLite），滚动进入即 IO 升级（立即）、离开
    //     800ms 防抖降级——full 集恒定 ≈ 窗口大小，style/后处理常驻量不再随会话累积；
    //   · 流式消息全程 full（永不占位/降级）；
    //   · 纯 md 消息不进 IO 逻辑（无引擎段 = 无额外开销）；
    //   · 升降级往返靠引擎缓存（整串 F.c + mermaid SVG cache）≈ 零成本。
    var VCP_HOT_RADIUS = 1600        // 预取半径 px（≈ 两屏阅读深度）
    var VCP_DEMOTE_DELAY = 800       // 离开窗口后的降级防抖 ms（防边界抖动）
    var VCP_SETTLE_KEEP_MS = 2000    // 流式完成后的「保活窗口」ms：期内强制全量防占位闪
    /** 轻量占位：历史窗口外的引擎段先显示骨架条，滚动进入再升级（无动画，保守流式规范）。 */
    function VcpLite(props) {
      var label = props.kind === 'page' ? 'HTML 程序页'
        : props.kind === 'mermaid' ? 'Mermaid 图表'
          : 'VCP 视觉卡片'
      return createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px',
          boxSizing: 'border-box', minHeight: props.minH || '110px',
          padding: '10px 14px', margin: '2px 0',
          borderRadius: '10px',
          border: '1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.18))',
          background: 'var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.035))',
          fontSize: '12px', color: 'var(--dsw-alias-label-tertiary,#888)',
          lineHeight: '1.5',
        },
      },
        createElement('span', {
          style: { flex: 'none', fontWeight: '600', letterSpacing: '.04em' },
        }, '▦ ' + label),
        createElement('span', { style: { flex: '1', minWidth: '0', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, '滚动到附近自动渲染'))
    }

    /** 构建 children（full=false 时引擎段降级 VcpLite）；返回 {children, hasEngine, leaked}。 */
    function buildAssistantChildren(blocks, streaming, full, groupPart) {
      var children = []
      var keySeq = 0
      var hasEngine = false
      var leaked = false // F8 自检：卡 html 泄漏进 md 段（settle 语义下为异常）
      function pushEngine(el, kind) {
        if (el !== null && el !== undefined) children.push(el)
      }
      function engineOrLite(renderFn, kind, minH) {
        hasEngine = true
        if (full) pushEngine(renderFn())
        else children.push(createElement(VcpLite, { key: 'k' + (keySeq++), kind: kind, minH: minH }))
      }
      // F8 泄漏判定：md 文本中出现「完整卡标签」残留（本 block 确实含 vcp-root 卡为前提）
      // ——正常切分时 md 段绝不含卡标签；出现即切分把卡漏进了 md。只认完整标签形态
      // （不含孤立的 `</div>`/`</style>` 字样，避免把 md 正文讨论/笔误当泄漏误报，
      // v0.7.27 收紧）。
      function vcpCheckMdLeak(mdText, blockHasCard) {
        if (streaming || !blockHasCard) return
        if (/<div\b[^>]*\bid\s*=\s*["']vcp-root["']|<div\s+class=|<style\b[^>]*>|<script\b[^>]*>/i.test(String(mdText || ''))) leaked = true
      }
      // v0.8.0 修复（issue #4 · DSH 0.2.x 流式期整条消息渲染两份）：
      // DSH 0.2.x 对同一条 assistant-step 节点渲染两个分组变体（data-chat-group-part =
      // reasoning / response），由 slot 注入的 groupPart 参数把内容切开——官方语义是
      // 「reasoning 变体只画思考块、response 变体跳过思考块」。本插件以 priority -10
      // shadow 官方渲染器后曾全量遍历 blocks、从不消费 groupPart，于是两个变体各渲染
      // 一份完整内容 → 流式期间同一内容成对重复（轮次 settle 后过程组收敛才恢复一份）。
      // 此处与官方同语义过滤；groupPart 缺失（0.1.x 无分组机制 / 未分组场景）时不过滤，
      // 行为与旧版逐帧一致。
      var visible = blocks
      if (groupPart === 'reasoning' || groupPart === 'response') {
        visible = []
        for (var gi = 0; gi < blocks.length; gi++) {
          var gb = blocks[gi]
          if (!gb) continue
          if (groupPart === 'reasoning' ? gb.kind === 'reasoning' : gb.kind !== 'reasoning') visible.push(gb)
        }
      }
      for (var i = 0; i < visible.length; i++) {
        var b = visible[i]
        if (!b) continue
        if (b.kind === 'text') {
          var blockHasCard = /<div\b[^>]*\bid\s*=\s*["']vcp-root["']/i.test(String(b.text || ''))
          var segs = splitVcpText(b.text)
          for (var j = 0; j < segs.length; j++) {
            var seg = segs[j]
            if (seg.type === 'vcp') {
              engineOrLite(function () { return vcpEngineRender(seg.html, streaming, 'k' + (keySeq++)) }, 'card')
            } else if (seg.type === 'pending') {
              // 半截卡也喂引擎（未闭合容器内部子块固化渲染）；settled 仍不闭合（如被
              // 中断）时引擎 fullRender 会把残缺结构按浏览器容错补全——v1 同款行为
              engineOrLite(function () { return vcpEngineRender(seg.text, streaming, 'k' + (keySeq++)) }, 'card')
            } else if (seg.type === 'page') {
              // 整页 HTML（可信程序页）：样式脱敏 + frame/host 包装后喂引擎（含 script）
              engineOrLite(function () { return vcpPageRender(seg, streaming, 'k' + (keySeq++)) }, 'page', '160px')
            } else if (seg.text !== undefined && String(seg.text).length > 0) {
              // md 段里再切 ```mermaid 围栏（甘特图/思维图/时序图…→ 引擎渲染成图）
              var mdFrags = splitMermaidFence(seg.text)
              for (var fi = 0; fi < mdFrags.length; fi++) {
                var fr = mdFrags[fi]
                if (fr.type === 'mermaid') {
                  engineOrLite(function () { return vcpEngineRender(fr.html, streaming, 'k' + (keySeq++)) }, 'mermaid')
                } else if (fr.text !== undefined && String(fr.text).length > 0) {
                  vcpCheckMdLeak(fr.text, blockHasCard)
                  children.push(renderMdSegment(fr.text, streaming, 'k' + (keySeq++)))
                }
              }
            }
          }
        } else if (b.kind === 'reasoning') {
          children.push(createElement(VcpReasoningRow, {
            key: 'k' + (keySeq++),
            text: b.text,
            running: streaming && i === visible.length - 1,
          }))
        } else if (b.kind === 'image') {
          // 完整 ImageGallery（@deepseek-ai/dsh-client-ui-attachment）接入留待后续；
          // VCP 正文贴图走 HTML <img>（卡内自渲染），image 块少用，先占位。
          children.push(createElement('div', {
            key: 'k' + (keySeq++),
            style: {
              padding: '6px 10px', borderRadius: '8px', fontSize: '12px',
              color: 'var(--dsw-alias-label-tertiary,#888)',
              background: 'var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))',
            },
          }, '［图片附件］'))
        } else if (b.kind === 'other') {
          children.push(createElement('pre', {
            key: 'k' + (keySeq++),
            style: {
              margin: '0', padding: '8px 10px', fontSize: '11px', whiteSpace: 'pre-wrap',
              wordBreak: 'break-all', overflow: 'auto', maxHeight: '200px',
              background: 'var(--dsw-alias-markdown-code-block,rgba(0,0,0,.05))',
              color: 'var(--dsw-alias-label-tertiary,#777)', borderRadius: '8px',
            },
          }, JSON.stringify(b.block !== undefined ? b.block : b)))
        }
      }
      return { children: children, hasEngine: hasEngine, leaked: leaked }
    }

    /** F8b DOM 健康检测（2026-09-02 实测驱动）：卡内出现「HTML 源码残渣文本」——
     *  独立文本节点以 `">` / `</xxx` / `<div ` 开头（且不在 code/pre/script/style 内）即
     *  判定异常。⚠️入参必须是【引擎渲染的卡元素】（[id^="vcp-msg-"]），不得传含 md 文本
     *  的整条消息——md 正文里真实书写的 `</div>` 字样不是残渣（v0.7.27 修正误报）。 */
    function vcpDomUnhealthy(root) {
      try {
        var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        var n
        while (w.nextNode()) {
          n = w.currentNode
          if (!n.nodeValue) continue
          var p = n.parentNode
          if (!p || !p.tagName) continue
          if (/^(CODE|PRE|SCRIPT|STYLE|TEXTAREA)$/.test(p.tagName)) continue
          var v = n.nodeValue
          if (/^\s*"?>\s*$/.test(v)) return true
          if (/^\s*<\/[a-z]/.test(v)) return true
          if (/^[ \t]*<div[\s>]/.test(v)) return true
          // CSS 源码残渣（2026-09-04 新闻晚报卡实测：<style> 内容被流式渲染成可见文本，
          // 如 `box-sizing:border-box;…}` / `#vcp-msg-19 .mast{…}`）：作用域化选择器是铁证，
          // 通用声明块形态兜底（防首条规则选择器被吞后只剩 `属性:值;…}` 的形态漏检）。
          if (/#vcp-(?:msg-\d+|root)\s*[{>.]/.test(v)) return true
          if (/(?:[a-z-]+\s*:\s*[^;{}]+;){2,}/i.test(v)) return true
        }
      } catch (e) {}
      return false
    }

    /** 遍历 node.data.blocks 渲染整条 assistant 消息（含 IO 热窗升级/降级，见上注释）。
     *  hooks 一律前置（React 规则：条件 return 之前必须完成全部 hook 调用）。 */
    function MyAssistantView(props) {
      var rootRef = useRef(null)
      var hotRef = useRef(false)
      var ioRef = useRef(null)
      var demoteTimer = useRef(null)
      var hasEngineRef = useRef(false)
      var everStreamedRef = useRef(false) // 本消息是否经历过流式（running）——一旦 true 永真
      var settledAtRef = useRef(0)        // 流式完成时间戳（ms），保活窗口起点
      var repairedRef = useRef(false)     // F8b：本消息是否已执行过一次 DOM 健康兜底
      var _hot = useState(false)
      var hot = _hot[0]
      var setHot = _hot[1]
      var _bump = useState(0)             // F8b：健康兜底后强制重渲染的信号
      var bump = _bump[0]
      var setBump = _bump[1]

      var node = props && props.node
      var data = (node && node.data) || {}
      var blocks = data.blocks || []
      var streaming = data.status === 'running'
      var interrupted = data.status === 'interrupted'

      // 空态语义（官方 AssistantMarkdown 同款）：纯 tool-call 回合不渲染。
      // 【hooks 铁律】所有 hook（含下方 useEffect）必须先于任何条件 return 调用——
      // 这里只算标志位，return null 放在 useEffect 之后（此前把 return 放在 effect 前，
      // 遇到纯 tool-call 回合会少调一次 useEffect → React「hooks 数量不一致」抛错 →
      // slot 崩溃 abdicate → 全部消息退回官方渲染成源码。实测 2026-09-02 根因。）
      var hasVisible = false
      if (!streaming && !interrupted) {
        for (var vi = 0; vi < blocks.length; vi++) {
          if (blocks[vi] && blocks[vi].kind !== 'tool-call') { hasVisible = true; break }
        }
      } else {
        hasVisible = true
      }
      // hasVisible=false 也先算完 built（引擎段必然无）再统一 return——hooks 已全部调用
      // F3c 修复（2026-09-02 · 占位框三现）：流式结束的 settle 期间 isFull 必须保持
      // true——否则引擎段降级成 VcpLite 占位框（「VCP视觉卡片·滚动到附近自动渲染」）再
      // 升级回卡。DSH 流式状态存在非 running 中间帧（思考↔回答切换等），「上一帧还在
      // 流式」的判定不可靠；改为消息级「曾经流式过 + 完成保活窗口」：
      //   · everStreamedRef：任何 running 帧即置 true（永真，渲染期写 ref，幂等）；
      //   · settledAtRef：everStreamed 后首个非流式帧记录完成时间（渲染期首次写）；
      //   · 完成后的 VCP_SETTLE_KEEP_MS（2s）内 isFull=true——settle 全量走 vcpEngineRender
      //     且命中 F2 memo → 复用元素零 diff，完全无感；窗口过期后交回 IO（hot/demote）。
      //   历史消息冷挂载 everStreamed=false → 不触发保活，IO 热窗性能语义不变。
      if (streaming) everStreamedRef.current = true
      var settleKeep = false
      if (everStreamedRef.current && !streaming) {
        if (settledAtRef.current === 0) settledAtRef.current = Date.now()
        settleKeep = Date.now() - settledAtRef.current < VCP_SETTLE_KEEP_MS
      }
      var isFull = streaming || hot || settleKeep
      var built = null
      var renderErr = null
      try {
        built = buildAssistantChildren(blocks, streaming, isFull, props && props.groupPart)
        hasEngineRef.current = built.hasEngine
        // F8 自检兜底（2026-09-02 定调 · 中间帧异常 → 卡刷新兜底，正常 → 丝滑固化）：
        // settle（非流式）检测到「卡 html 泄漏进 md 段」= 切分中间态被固化（多卡流式震动）。
        // 处理：清空 settle 复用缓存 → 立即重 build 一次 → memo 空、引擎走 fresh fullRender
        // → 产物正确；无泄漏则 memo 照常丝滑复用（视觉零变化）。
        if (!streaming && built.leaked) {
          try { if (vcpSettleMemo.size) vcpSettleMemo.clear() } catch (e) {}
          console.warn('[dsh-raw-html-v2] F8 自检：卡 html 泄漏进 md 段，已清缓存强制全量重渲')
          built = buildAssistantChildren(blocks, streaming, isFull, props && props.groupPart)
          hasEngineRef.current = built.hasEngine
        }
      } catch (e) {
        // 兜底防线：任何渲染期异常 → 单条降级官方 md（不抛给 slot，杜绝全局 abdicate）
        renderErr = e
        console.error('[dsh-raw-html-v2] assistant-step 渲染异常，本条已降级官方文本：', e, e && e.stack ? e.stack : '')
      }
      // ⚠️ 注意：不得在此处提前 return null——所有 hooks（下方 useEffect）必须先调用完。
      // 空态出口与异常降级出口统一在 useEffect 之后（hooks 数量恒定是 slot 不崩的前提）。

      // F7（2026-09-02 实测：settle 后卡内 <style> 规则未被浏览器 CSSOM 收录 →
      // 整卡掉格式/艺术字黑体，但 inline !important 手动设置却立即生效——规则文本在
      // DOM、带 !important、特异性足够，纯粹是样式表没被收录）。补丁：非流式 settle
      // 后 rAF 做「完整性补跑」：
      //   ① style touch（textContent 重写同值）→ 强制浏览器 CSSOM 重新收录；
      //   ② __vcpMath.processMath(消息根) → KaTeX 占位还原渲染 + Mermaid 转换
      //      （引擎 scheduleMath 依赖流式帧 lastMathEl，settle 复用路径上会断 →
      //      「渲染中」滞留，大杂烩卡实测 2026-09-02）；
      //   ③ enforceFontChain / healSvgAnimation（字体链 DOM 强制 + SVG 动画自愈）。
      // 全部为同值/幂等操作：零视觉变化、无重渲无闪；每消息仅 streaming 翻转时触发一次。
      useEffect(function () {
        if (streaming || !hasEngineRef.current) return
        var raf = window.requestAnimationFrame(function () {
          try {
            var el = rootRef.current
            if (!el) return
            var sts = el.querySelectorAll('style')
            for (var si2 = 0; si2 < sts.length; si2++) {
              var stEl = sts[si2]
              stEl.textContent = stEl.textContent
            }
            var vmath = window.__vcpMath
            if (vmath && typeof vmath.processMath === 'function') {
              try { vmath.processMath(el) } catch (e) {}
            }
            var vtest = window.__vcpStable && window.__vcpStable._test
            if (vtest && typeof vtest.enforceFontChain === 'function') {
              try { vtest.enforceFontChain(el) } catch (e) {}
            }
            if (vtest && typeof vtest.healSvgAnimation === 'function') {
              try { vtest.healSvgAnimation(el) } catch (e) {}
            }
            // F8b DOM 健康兜底：仅扫描引擎卡 DOM（不含 md 区），检测 HTML 残渣文本 →
            // 清缓存强制全量重渲一次（防循环：每消息仅一次；v0.7.27 起遍历 [id^="vcp-msg-"]）
            if (!repairedRef.current) {
              var cardEls = el.querySelectorAll('[id^="vcp-msg-"],[id="vcp-root"]')
              var bad = false
              for (var ci3 = 0; ci3 < cardEls.length; ci3++) {
                if (vcpDomUnhealthy(cardEls[ci3])) { bad = true; break }
              }
              if (bad) {
                repairedRef.current = true
                try { if (vcpSettleMemo.size) vcpSettleMemo.clear() } catch (e) {}
                console.warn('[dsh-raw-html-v2] F8b DOM 健康自检：检测到卡内 HTML 残渣文本，已清缓存强制重渲')
                setBump(bump + 1)
              }
            }
          } catch (e) {}
        })
        return function () { if (raf) window.cancelAnimationFrame(raf) }
      }, [streaming])

      // 完成态收尾（F3c）：streaming true→false 时（effect 里 streaming 已为新值，用
      // everStreamedRef 判定「本消息经历过流式」）——设置保活窗口起点（渲染期已设则不动）
      // 并立即置位 hot，防 IO 异步 decide 空窗期的占位帧；窗口过期后由 IO 正常接管降级。
      useEffect(function () {
        if (!streaming && everStreamedRef.current) {
          if (settledAtRef.current === 0) settledAtRef.current = Date.now()
          if (hasEngineRef.current && !hotRef.current) {
            hotRef.current = true
            setHot(true)
          }
        }
      }, [streaming])

      // IO 热窗观察（定调 2026-09-02）：可视 + 预取半径内 → 全量；离开 → 防抖降级
      useEffect(function () {
        var el = rootRef.current
        if (!el || !hasEngineRef.current) return
        var scroller = el.closest ? el.closest('[data-conversation-scroll]') : null
        function decide(entries) {
          var any = entries && entries[0] ? entries[0].isIntersecting : false
          if (any) {
            if (demoteTimer.current) { window.clearTimeout(demoteTimer.current); demoteTimer.current = null }
            if (!hotRef.current) { hotRef.current = true; setHot(true) }
            return
          }
          if (streaming) return // 流式消息不降级
          if (demoteTimer.current) return
          demoteTimer.current = window.setTimeout(function () {
            demoteTimer.current = null
            if (hotRef.current) { hotRef.current = false; setHot(false) }
          }, VCP_DEMOTE_DELAY)
        }
        try {
          var io = new IntersectionObserver(decide, {
            root: scroller || null,
            rootMargin: VCP_HOT_RADIUS + 'px 0px ' + VCP_HOT_RADIUS + 'px 0px',
            threshold: 0.01,
          })
          ioRef.current = io
          io.observe(el)
        } catch (e) {
          // 无 IO 支持：直接全量（降级为旧行为）
          hotRef.current = true
          setHot(true)
        }
        return function () {
          if (ioRef.current) { try { ioRef.current.disconnect() } catch (e2) {} ioRef.current = null }
          if (demoteTimer.current) { window.clearTimeout(demoteTimer.current); demoteTimer.current = null }
        }
      }, [streaming])

      // 空态/降级出口（必须位于全部 hooks 之后——hooks 数量恒定是 slot 不崩的前提）
      if (!hasVisible) return null
      if (renderErr !== null || built === null) {
        // 渲染异常兜底：把 text 块交给官方 MarkdownText（HTML 转义为源码，仅本条降级）
        var fb = []
        var fk = 0
        for (var fb2 = 0; fb2 < blocks.length; fb2++) {
          var bb = blocks[fb2]
          if (!bb) continue
          if (bb.kind === 'text') fb.push(renderMdSegment(bb.text, streaming, 'f' + (fk++)))
          else if (bb.kind === 'reasoning') fb.push(createElement(VcpReasoningRow, { key: 'f' + (fk++), text: bb.text, running: false }))
        }
        return createElement('div', { 'data-streaming': streaming || undefined },
          createElement('div', {
            style: { display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '16px', lineHeight: '28px' },
          }, fb.length ? fb : null))
      }

      var children = built.children
      return createElement('div', {
        ref: rootRef,
        'data-streaming': streaming || undefined,
      },
        createElement('div', {
          style: {
            display: 'flex', flexDirection: 'column', gap: '16px',
            fontSize: '16px', lineHeight: '28px',
            color: 'var(--dsw-alias-label-primary,#111)',
          },
        }, children.length ? children : null),
        interrupted
          ? createElement('div', {
              style: {
                marginTop: '12px', fontSize: '12px',
                color: 'var(--dsw-alias-label-tertiary,#888)',
              },
            }, '（回复已中断）')
          : null)
    }

    // ---- 错误边界（2026-09-02 实测「又崩一次」驱动 · 健壮性防线）----
    // 崩溃已确认可发生在 commit/ref 阶段（引擎元素挂载时跑 processMath 等 ref 回调）——
    // render 期 try/catch 罩不住，必须用 React 错误边界（componentDidCatch）接住：
    //   1) render / 生命周期 / commit(ref) / effect 抛错都冒泡到最近边界 → 被吞、子树降级
    //   2) 不再上抛给官方 slot 机制 → 杜绝「单条崩溃 → entry abdicate → 全局还原成代码」
    //   3) console.error 输出完整栈（componentDidCatch 的 err + info）→ 下次复现即可定位真凶
    function VcpErrorBoundary(props) {
      React.Component.call(this, props)
      this.state = { err: null }
    }
    VcpErrorBoundary.prototype = Object.create(React.Component.prototype)
    VcpErrorBoundary.prototype.constructor = VcpErrorBoundary
    VcpErrorBoundary.prototype.componentDidCatch = function (err, info) {
      console.error('[dsh-raw-html-v2] 渲染边界捕获（本条消息已降级显示，不再影响其余消息）', err, err && err.stack ? err.stack : '', info)
      this.setState({ err: err })
    }
    VcpErrorBoundary.prototype.render = function () {
      if (this.state.err !== null) {
        return createElement('div', {
          style: {
            padding: '10px 12px', borderRadius: '8px', fontSize: '12px', lineHeight: '1.6',
            color: 'var(--dsw-alias-label-tertiary,#888)',
            background: 'var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))',
            border: '1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.18))',
          },
        }, '本条消息渲染异常，已局部降级（其余消息不受影响）。请在浏览器 console 查找 [dsh-raw-html-v2] 渲染边界捕获 的错误详情并反馈。')
      }
      return this.props.children
    }
    /** Slot 注册包装：错误边界 + MyAssistantView（边界内错误不外溢 → slot 永不 abdicate）。 */
    function VcpSlotGuard(props) {
      return createElement(VcpErrorBoundary, null, createElement(MyAssistantView, props))
    }

    // 注册官方 Slot 渲染器：shadow conversation.chat.node 的 assistant-step（priority -10）。
    // 官方 registerChatNodeRenderers 以 priority=0 注册 AssistantNodeView——slots 语义为
    // keyed 同 key 同 priority 冲突 throw、低 priority 胜出（最低渲染）→ -10 保证替换且
    // 本插件停用时官方渲染器自动接管（消息不空白）。有 slots 服务才注册，否则静默跳过。
    function registerSlotRenderer(ctx) {
      try {
        // 渲染开关关闭 → 不接管：官方渲染器继续（HTML 转义为源码，与 v1 语义一致）
        if (!isRenderEnabled()) return
        var slots = ctx && (ctx.get ? ctx.get('slots') : ctx.slots)
        if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
        slots.inject('conversation.chat.node', function () {
          return slots.register(
            { name: 'conversation.chat.node', key: 'assistant-step', priority: -10 },
            VcpSlotGuard,
          )
        })
      } catch (e) {
        console.warn('[dsh-raw-html-v2] assistant-step 渲染器注册失败（可忽略，回退官方渲染）', (e && e.message) || e)
      }
    }

    /** Mermaid 漏渲兜底（接入层职责，渲染仍用引擎自带 renderMermaidInContent）：
     *  引擎 processMath 以 KaTeX 就绪为前置，若资源时序/重挂载导致 mermaid 代码块
     *  残留未渲（甘特图/思维图/时序图显示为代码），MutationObserver 发现后补渲；
     *  流式中（宿主带 data-streaming）不抢跑，等 settle；已渲（svg 替换/缓存）自动跳过。 */
    function initMermaidFallback() {
      if (window.__vcpMmdFallbackOn) return
      window.__vcpMmdFallbackOn = true
      var timer = null
      var scans = 0
      var mo = null
      function scan() {
        timer = null
        if (!window.__vcpMath || typeof window.__vcpMath.renderMermaidInContent !== 'function') return
        if (typeof window.mermaid !== 'object' || typeof window.mermaid.render !== 'function') {
          // mermaid 引擎未就绪：自轮询（本地 vendor 秒加载，上限约 10s）
          scans += 1
          if (scans < 14) timer = window.setTimeout(scan, 800)
          return
        }
        var codes = document.querySelectorAll('code.language-mermaid')
        if (!codes.length) return
        var done = false
        for (var i = 0; i < codes.length; i++) {
          var c = codes[i]
          if (!c.textContent || !c.textContent.trim()) continue
          if (c.closest && c.closest('[data-streaming]')) continue // 流式中 → 等 settle 帧引擎处理
          if (c.closest && c.closest('.vcp-mermaid-box')) continue
          done = true
          var host = c.closest
            ? (c.closest('[id^="vcp-msg-"], [id="vcp-root"], .vcp-page-host') || c.parentElement || c)
            : c
          try { window.__vcpMath.renderMermaidInContent(host) } catch (e) {}
        }
        if (!done) return
        scans += 1
        if (scans <= 10) timer = window.setTimeout(scan, 600) // 引擎渲染异步，复查至多 10 轮
      }
      try {
        mo = new window.MutationObserver(function () {
          if (timer) window.clearTimeout(timer)
          timer = window.setTimeout(scan, 900)
        })
        mo.observe(document.body, { childList: true, subtree: true })
      } catch (e) {}
      window.addEventListener('pagehide', function () { if (mo) mo.disconnect() })
    }

    function apply(ctx) {
      // 旧版单开关状态迁移（仅一次）
      migrateState()

      // 暴露 input 桥（渲染补丁的 onclick 处理器调用）
      window.__dshInput = sendText

      // 卡片 hover 下载：全局单例浮动按钮 + 事件委托（不插 React DOM）
      initDownload()

      // 加载 KaTeX 数学公式资源（改名版 CSS + katex.js → auto-render.js 链式）
      ensureMathAssets()
      // 加载 Mermaid 图表引擎（异步，未就绪时渲染层轮询重试）
      ensureMermaidAssets()
      // 加载 VCP 色彩引擎（data-vcp-preset 声明式配色，未就绪时渲染层静默降级）
      ensureColorEngine()

      // Mermaid 漏渲兜底（甘特图/思维图等：引擎 processMath 因 KaTeX 时序漏渲时补枪）
      initMermaidFallback()

      // 初始化 Host RPC 并上报当前开关状态（Host 据此注入/撤回 VCP 协议说明）
      hostRpc = makeHostRpc(ctx)
      syncHostState(hostRpc, isRenderEnabled(), isAestheticEnabled(), isSubagentInjectEnabled())

      // 全局注册已安装字体 @font-face：模型输出的 Lanxi-* 字体名直接命中真实字体，
      // 不再回退系统黑体（2026-08-27 实测：此前仅面板打开时才注册）
      ensureGlobalFonts(ctx)

      // 注册官方 Slot 渲染器（v2 核心：assistant-step 替换渲染；渲染开关关闭时不注册，
      // 官方渲染器自动接管 → HTML 显示为源码；切换开关会强制刷新页面重新判定）
      registerSlotRenderer(ctx)

      // 右下角融合胶囊（</> 渲染 + 可信模式）在模块加载期已挂（mountDock）；
      // 这里只做兜底：若被外域移除（极端情况），apply 时补挂一次。
      mountDock()

      // capsule 被意外移除时补回（MutationObserver 只兜这一个 id）
      var mo = new window.MutationObserver(function () {
        if (!document.getElementById('vcp-trusted-toggle')) {
          window.__vcpDockMounted = false
          mountDock()
        }
      })
      mo.observe(document.body, { childList: true, subtree: true })
      window.addEventListener('pagehide', function () {
        mo.disconnect()
        closePanel()
      })
    }

    exports.apply = apply
    return module.exports
  },
})
