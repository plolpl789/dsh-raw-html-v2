// dsh-raw-html-v2 · v1 引擎复用加载链路 smoke 测试
// 模拟 client.js 的真实引导：new Function('vc','hp','f', engineSrc) 注入 vc/hp/React，
// 然后驱动 __vcpStable.render 的流式帧序列（半截 → 闭合），验证：
//   1. 引擎经 new Function 加载成功并挂 window.__vcpStable
//   2. render 产出真 React 元素（根容器 uid 作用域化 vcp-msg-N）
//   3. 流式半截帧不崩；闭合帧全量渲染；跨帧引用复用
// vc/hp 直接从 lib/client.js 提取真实实现（与浏览器一致）。
// 运行：node tests/engine-smoke.test.mjs
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>')
const { window: domWindow, DOMParser, Node } = dom.window
const React = require(path.resolve(HERE, '../node_modules/react'))

// ---- 1. 从 client.js 提取 vc/hp 真实实现 ----
const client = readFileSync(path.resolve(HERE, '../lib/client.js'), 'utf8')
function extractFn(src, name) {
  const anchor = new RegExp('^[ \\t]*function ' + name + '\\s*\\(', 'm')
  const am = anchor.exec(src)
  if (!am) throw new Error('未找到 ' + name)
  let i = src.indexOf('{', am.index)
  if (i === -1) throw new Error(name + ' 无函数体')
  let depth = 0
  let str = null
  const RE_START_PREV = '(=,:,[!&|?{};+-*%^~<>'
  for (; i < src.length; i++) {
    const c = src[i]
    if (str) { if (c === '\\') { i++; continue } if (c === str) str = null; continue }
    if (c === "'" || c === '"' || c === '`') { str = c; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue }
    if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') {
      let prev = i - 1
      while (prev >= 0 && /\s/.test(src[prev])) prev--
      if (prev < 0 || RE_START_PREV.indexOf(src[prev]) !== -1) {
        let j = i + 1
        let inCls = false
        for (; j < src.length; j++) {
          const rc = src[j]
          if (rc === '\\') { j++; continue }
          if (rc === '[') inCls = true
          else if (rc === ']') inCls = false
          else if (rc === '/' && !inCls) break
        }
        i = j
        continue
      }
    }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(am.index, i + 1) }
  }
  throw new Error(name + ' 括号不闭合')
}
const engineSrc = readFileSync(path.resolve(HERE, '../assets/vendor/vcp-engine-v1.js'), 'utf8')
const vcSrc = extractFn(client, 'vcpVcShim')
const hpSrc = extractFn(client, 'vcpHpShim')
const filterSrc = extractFn(client, 'vcpFilterStyle')
const allowHrefSrc = extractFn(client, 'vcpAllowHref')
const allowSrcSrc = extractFn(client, 'vcpAllowSrc')
// 组装 vc/hp（闭包引用 filterStyle 等）
const vc = new Function('createElement', 'window', filterSrc + '\n' + allowHrefSrc + '\n' + allowSrcSrc + '\n' + hpSrc + '\n' + vcSrc + '\nreturn vcpVcShim')(React.createElement, domWindow)
const hp = new Function(hpSrc + '\nreturn vcpHpShim')()
const f = { Fragment: React.Fragment, jsx: React.createElement }

// ---- 2. 模拟引导：new Function('vc','hp','f', engineSrc) ----
const sandboxWindow = {}
const boot = new Function('vc', 'hp', 'f', engineSrc + '\n;return window.__vcpStable')
// 引擎自由引用 DOMParser/Node/document?/localStorage——放进全局：new Function 的执行全局是
// node 模块全局，没有 DOMParser → 需把必要符号挂 global 或用 vm。此处用 vm 提供沙箱全局。
import vm from 'node:vm'
const sb = {
  window: sandboxWindow,
  DOMParser, Node,
  document: domWindow.document,
  localStorage: { getItem: () => null, setItem: () => {} },
  performance: { now: () => Date.now() },
  console, setTimeout, clearTimeout, queueMicrotask,
  vc, hp, f,
}
vm.runInNewContext(engineSrc, sb)
const stable = sandboxWindow.__vcpStable
if (!stable || typeof stable.render !== 'function') { console.error('✗ 引擎未挂载 __vcpStable'); process.exit(1) }
console.log('  ✓ 引擎经 vm(new Function 同构) 加载成功')

let pass = 0
function ok(cond, label) { if (cond) { pass++; console.log('  ✓ ' + label) } else console.log('  ✗ ' + label) }

// ---- 3. 流式帧序列 ----
const f1 = '<div id="vcp-root" style="background:#0a2540;font-family:Lanxi-HeiTi,serif"><h3 style="color:#fff">欢迎</h3>'
const f2 = f1 + '<p>第一段已完整</p><p>第二段开始'
const f3 = f2 + '还在写…'
const f4 = f3 + '</p>'
const f5 = f4 + '<div class="foot">尾巴子块</div></div>'

const r1 = stable.render(f1, true)
ok(r1 !== null && r1 !== undefined, '帧1（开标签+半截内容）有产物')
const r2 = stable.render(f2, true)
ok(r2 !== null, '帧2 有产物')
const r3 = stable.render(f3, true)
ok(r3 !== null, '帧3 有产物')
const r4 = stable.render(f4, true)
ok(r4 !== null, '帧4（子块闭合）有产物')
const r5 = stable.render(f5, false)
ok(r5 !== null, '终帧（整卡闭合，非流式）有产物')

// 产物结构：收集元素断言根 uid
function collectEls(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.type && typeof node.type === 'string') out.push(node)
  else if (node.tag) out.push(node)
  const ch = node.children || (node.props && node.props.children)
  if (Array.isArray(ch)) for (const c of ch) collectEls(c, out)
  else if (ch && typeof ch === 'object') collectEls(ch, out)
  return out
}
const els5 = collectEls(r5)
const rootEl = els5.find(n => (n.props && n.props.id || '').indexOf('vcp-msg-') === 0) || els5.find(n => n.tag && n.props && (n.props.id || '').indexOf('vcp-msg-') === 0)
ok(!!rootEl, '终帧含作用域化根容器 vcp-msg-N（实际: ' + JSON.stringify(rootEl ? (rootEl.props || {}).id : null) + '）')

// 终帧里没有残留 vcp-root id
const idStr = JSON.stringify(collectEls(r5).map(n => (n.props && n.props.id) || (n.tag && n.props && n.props.id)).filter(Boolean))
ok(idStr.indexOf('vcp-root') === -1 && idStr.indexOf('vcp-msg-') !== -1, '无残留 vcp-root，已全量作用域化')

// React 元素可被 React.createElement 接受（渲染不炸的类型契约）：浅验证 key/type
ok(typeof r5.type === 'string' || r5.type === React.Fragment || r5.tag, '产物类型契约有效')

// ---- 4. 多消息切换（新卡文本前缀不同 → 重置，不串扰）----
stable.render(f5, false) // 重复同帧（缓存命中路径）
const other = stable.render('<div id="vcp-root" style="background:#fff">另一张卡内容</div>', false)
ok(other !== null, '第二张卡渲染不崩')

// ---- 5. 整页 HTML（可信程序页：先生示例 canvas 动画）----
// 开可信模式（script 由引擎 extract→flush 放行执行）
sandboxWindow.__vcpTrusted = () => true
const fullPage = '<!DOCTYPE html>\n<html lang="zh">\n<head><meta charset="UTF-8"><title>循环小球动画</title>\n<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111}canvas{border:2px solid #fff}</style></head>\n<body>\n<canvas id="c" width="480" height="320"></canvas>\n<script>const cvs=document.getElementById("c");let x=1;</script>\n</body>\n</html>'
const pageEl = stable.render(fullPage, false)
ok(pageEl !== null, '整页 html（非流式）渲染不崩')
const pageEls = collectEls(pageEl)
const canvasFound = pageEls.some(n => n.type === 'canvas' || n.tag === 'canvas')
ok(canvasFound, '整页产物含 <canvas> 元素')
const halfPage = '<!DOCTYPE html>\n<html><body><canvas></canvas><script>let x=1;'
const halfEl = stable.render(halfPage, false)
ok(halfEl !== null, '半截整页渲染不崩')

// ---- 6. md 裸围栏形态（splitMermaidFence 生成的 pre.language-mermaid html）----
// 先生实测：裸 ```mermaid 围栏转 html 喂引擎 → 显示为源码文字未出图。验证源码层转换
const fenceHtml = '<pre class="language-mermaid"><code>flowchart TD\nA[请求] --> B{渲染}\nB -->|是| C[图表]\n</code></pre>'
const fenceEl = stable.render(fenceHtml, false)
ok(fenceEl !== null, '裸围栏 html 渲染不崩')
const fenceEls = collectEls(fenceEl)
const hasMermaidDiv = fenceEls.some(n => {
  const cls = (n.props && n.props.className) || ''
  return (n.type === 'div' || n.tag === 'div') && cls.indexOf('mermaid') !== -1
})
ok(hasMermaidDiv, '源码层已转 div.mermaid（mermaidBlockConvert 命中）')

// ---- 7. iframe（在线镶嵌 B 站视频等）：https 放行、危险协议丢弃 ----
const iframeOk = stable.render('<div id="vcp-root"><iframe src="https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7" width="100%" height="200" allowfullscreen></iframe></div>', false)
const iframeEls = collectEls(iframeOk)
ok(iframeEls.some(n => n.type === 'iframe' || n.tag === 'iframe'), 'https iframe 放行（B 站嵌入）')
const iframeBad = stable.render('<div id="vcp-root"><iframe src="javascript:alert(1)"></iframe>内容</div>', false)
const badEls = collectEls(iframeBad)
ok(!badEls.some(n => n.type === 'iframe' || n.tag === 'iframe'), 'javascript: iframe 丢弃')

console.log('\n结果: ' + pass + ' 通过')
process.exit(0)
