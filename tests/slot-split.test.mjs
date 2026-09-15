// dsh-raw-html-v2 · assistant-step 渲染接入层切段函数回归测试
// 直接从 lib/client.js 源码提取真实函数（防复制漂移），验证：
//   splitVcpText / findVcpOpen / scanVcpDiv / swallowTrailingStyle /
//   findPageOpen / scanPageEnd / scopePageCss / splitMermaidFence
// （作用域化/安全过滤/KaTeX·Mermaid/字体锁权由复用的 v1 引擎包办，其由 v1 tests/ 覆盖）
// 用法：node tests/slot-split.test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/client.js')
const src = readFileSync(CLIENT, 'utf8')

const TARGETS = ['findVcpOpen', 'scanVcpDiv', 'swallowTrailingStyle', 'trimTrailingOpenTag', 'splitVcpText', 'findPageOpen', 'scanPageEnd', 'scopePageCss', 'splitMermaidFence', 'stripFenceWrapper', 'swallowTrailingRaw']

/** 从源码提取一个函数定义全文（含签名到配平闭合括号）。跳过字符串/注释/正则字面量。 */
function extractFn(name) {
  const anchor = new RegExp('^[ \\t]*function ' + name + '\\s*\\(', 'm')
  const am = anchor.exec(src)
  if (!am) throw new Error('未找到函数 ' + name)
  let i = src.indexOf('{', am.index)
  if (i === -1) throw new Error(name + ' 无函数体')
  let depth = 0
  let str = null
  const RE_START_PREV = '(=,:,[!&|?{};+-*%^~<>'
  for (; i < src.length; i++) {
    const c = src[i]
    if (str) {
      if (c === '\\') { i++; continue }
      if (c === str) str = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { str = c; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue }
    // 正则字面量（近似：前一个非空白字符是运算符/定界符且非 // 与 /*）
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
        i = j // 停在结束 / 上，循环 i++ 后越过
        continue
      }
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(am.index, i + 1)
    }
  }
  throw new Error(name + ' 括号不闭合')
}

const bodies = TARGETS.map(extractFn)
// findPageOpen / splitMermaidFence 引用模块级正则常量（var 声明，随函数提取补注入）
const prelude = 'var PAGE_OPEN_RE = /(?:^|[\\r\\n]{1,2})(<!doctype\\s+html\\b[^>]*>|<html\\b[^>]*>)/gi;\n'
  + 'var MERMAID_FENCE_RE = /(^|\\n)[ \\t]*```[ \\t]*mermaid[ \\t]*\\n([\\s\\S]*?)\\n[ \\t]*```[ \\t]*(?=\\n|$)/gi;\n'
const mod = new Function(
  prelude + bodies.join('\n\n') + '\n\nreturn { ' + TARGETS.join(', ') + ' }'
)()
const { splitVcpText, scopePageCss, scanPageEnd, splitMermaidFence } = mod

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  ✓ ' + label) }
  else { fail++; console.log('  ✗ ' + label + '\n    期望 ' + e + '\n    实际 ' + a) }
}
function kinds(segs) { return segs.map(s => s.type) }

console.log('== splitVcpText 切段 ==')
{
  const t = '开场白文字。'
  eq(kinds(splitVcpText(t)), ['md'], '纯 md 文本 → 单 md 段')
}
{
  const card = '<div id="vcp-root" style="color:#333">你好</div>'
  eq(kinds(splitVcpText(card)), ['vcp'], '纯卡片 → 单 vcp 段')
}
{
  const t = '引子文字\n\n<div id="vcp-root">卡</div>\n\n结尾文字。'
  const segs = splitVcpText(t)
  eq(kinds(segs), ['md', 'vcp', 'md'], '引子+卡+结尾 → md/vcp/md')
  eq(segs[1].html, '<div id="vcp-root">卡</div>', 'vcp 段 HTML 完整')
}
{
  // 卡内嵌套 div + 样式写在卡内开头（协议规范）
  const card = '<div id="vcp-root"><style>#vcp-root{color:red}</style><div class="inner"><p>深</p></div></div>'
  const segs = splitVcpText(card)
  eq(kinds(segs), ['vcp'], '嵌套 div + 卡内 style → 单 vcp 段')
  eq(segs[0].html.length, card.length, '整卡完整吸收（含嵌套闭合）')
}
{
  // 卡尾兄弟 style（旧规范/模型不听话）：应吞并进 vcp 段
  const t = '<div id="vcp-root">正文</div>\n<style>#vcp-root{background:#fff}</style>'
  const segs = splitVcpText(t)
  eq(kinds(segs), ['vcp'], '卡尾 <style> 被吞并 → 单 vcp 段')
  eq(segs[0].html.indexOf('<style>') !== -1, true, 'vcp 段含卡尾 style')
}
{
  // 先生实测 2026-09-02：卡尾兄弟 <script>（交互脚本）必须随卡进引擎——
  // 否则落入 md 被官方转义显示成源码（溢出代码格式）
  const t = '<div id="vcp-root">卡</div><script>function showSec(i){var b=1;}</script>'
  const segs = splitVcpText(t)
  eq(kinds(segs), ['vcp'], '卡尾 <script> 被吞并 → 单 vcp 段')
  eq(segs[0].html.indexOf('<script>function showSec') !== -1, true, 'vcp 段含卡尾 script 源码')
}
{
  // style + script 交替任意顺序，循环吞并
  const t = '<div id="vcp-root">卡</div><style>a{}</style>\n<script>s();</script>'
  eq(kinds(splitVcpText(t)), ['vcp'], '卡尾 style+script 交替全部吞并')
}
{
  // 流式中途：开标签完整、闭合未出现 → pending
  const t = '开头\n<div id="vcp-root"><div class="half">半截内容'
  const segs = splitVcpText(t)
  eq(kinds(segs), ['md', 'pending'], '未闭合卡 → md + pending')
}
{
  // 两个卡片
  const t = '<div id="vcp-root">A</div>\n文字\n<div id="vcp-root">B</div>'
  eq(kinds(splitVcpText(t)), ['vcp', 'md', 'vcp'], '两卡 + 间隔文字')
}
{
  // v1 锚点 E 对齐：```html 围栏纯包装卡 → 围栏行剥离，卡正常渲染
  const t = '```html\n<div id="vcp-root"><p>你好</p></div>\n```'
  eq(kinds(splitVcpText(t)), ['vcp'], '```html 围栏包装 → 仅 vcp 段（围栏剥离）')
}
{
  // 属性顺序：style 在 id 前 / id 在 style 后
  const t1 = '<div style="x:1" id="vcp-root" data-a="1">卡</div>'
  eq(kinds(splitVcpText(t1)), ['vcp'], '属性顺序 style 在前')
  const t2 = '<div data-a="1" id="vcp-root">卡</div>'
  eq(kinds(splitVcpText(t2)), ['vcp'], '属性顺序 data 在前')
}
{
  // 卡内 style 里的 </div> 字样不应干扰配平（style 是 RAW 文本元素）
  const card = '<div id="vcp-root"><style>.x::before{content:"</div>"}</style>内容</div>'
  eq(kinds(splitVcpText(card)), ['vcp'], 'style 内 </div> 字样不干扰')
}
{
  // HTML 讨论文本里出现孤立 <div>（非 vcp-root）→ 仍归 md
  const t = '模型说：<div> 标签是块级元素，但这里只是讨论。'
  eq(kinds(splitVcpText(t)), ['md'], '非 vcp-root 的 <div> 归 md')
}
{
  // 先生实测 2026-09-02：说明文字里的 vcp-root 字样（行内/反引号内）不得误切
  const t = '请看：**没有包 <div id="vcp-root">** 的裸围栏如下：\n\n```mermaid\nflowchart LR\nA-->B\n```'
  const segs = splitVcpText(t)
  eq(segs.length === 1 && segs[0].type === 'md', true, '行内 vcp-root 字样（说明文字）不误切')
}
{
  // 说明文字在前 + 真卡在后：只有行首真卡被切
  const t = '下面是卡片（必须包 <div id="vcp-root"> 容器）：\n\n<div id="vcp-root">真卡</div>'
  const segs = splitVcpText(t)
  eq(kinds(segs), ['md', 'vcp'], '说明文字 + 行首真卡 → md + vcp')
}

console.log('== 整页 HTML（可信程序页）识别 ==')
{
  const page = '<!DOCTYPE html>\n<html lang="zh">\n<head><style>body{margin:0;background:#111}canvas{border:2px solid #fff}</style></head>\n<body><canvas id="c"></canvas><script>let x=1;</script></body>\n</html>'
  const segs = splitVcpText(page)
  eq(kinds(segs), ['page'], '整页 <!DOCTYPE html>…</html> → page 段')
  eq(segs[0].html.indexOf('</html>') !== -1, true, 'page 段含完整闭合')
}
{
  const t = '引子文字\n\n<html lang="zh"><body>页</body></html>\n结尾'
  eq(kinds(splitVcpText(t)), ['md', 'page', 'md'], '<html> 起始的整页可夹在 md 中')
}
{
  // 半截页（未闭合 </html>）→ page（text 半截）
  const t = '<!DOCTYPE html>\n<html><body><canvas></canvas><script>let x=1;'
  const segs = splitVcpText(t)
  eq(segs[segs.length - 1].type, 'page', '未闭合整页 → page（半截）')
}
{
  // 正文讨论 <html> 标签（行内，非行首整标签）不误伤
  const t = '这段讨论 <html> 标签的用法，但它不是页面。'
  eq(kinds(splitVcpText(t)), ['md'], '行内 <html> 讨论不误判为整页')
}
console.log('== scopePageCss 页面样式脱敏 ==')
{
  const css = '<style>body{margin:0;min-height:100vh}html,body{background:#111}.cls{color:red}</style>'
  const out = scopePageCss(css)
  eq(out.indexOf('body{') === -1, true, '独立 body 选择器被替换')
  eq(out.indexOf('.vcp-page-host{margin:0') !== -1, true, 'body → .vcp-page-host')
  eq(out.indexOf('html,') === -1, true, 'html 组合选择器被替换')
  eq(out.indexOf('.cls{color:red}') !== -1, true, '普通类选择器不动')
}
{
  // 半截未闭合 style 也脱敏（流式中）
  const half = '<style>body{background:#111}canvas{border:'
  const out = scopePageCss(half)
  eq(out.indexOf('body{') === -1 && out.indexOf('.vcp-page-host{background:#111}') !== -1, true, '未闭合 style 内 body 亦脱敏')
}
{
  eq(scanPageEnd('<html><body>x</body></html>', 0) > 0, true, 'scanPageEnd 命中 </html>')
  eq(scanPageEnd('<html><body>x', 0), -1, 'scanPageEnd 未闭合返回 -1')
}

console.log('== splitMermaidFence（```mermaid 围栏切分）==')
{
  const t = '正文文字，没有图。'
  const segs = splitMermaidFence(t)
  eq(segs.length === 1 && segs[0].type === 'md', true, '无围栏 → 单 md')
}
{
  const md = '开头介绍\n\n```mermaid\ngantt\ntitle 项目计划\ndateFormat  YYYY-MM-DD\nsection A\n任务1 :a1, 2026-09-01, 7d\n```\n\n结尾'
  const segs = splitMermaidFence(md)
  eq(segs.map(s => s.type).join(','), 'md,mermaid,md', 'md+mermaid+md 三段')
  eq(segs[1].html.indexOf('<pre><code class="language-mermaid">') === 0, true, 'mermaid 段转 pre>code.language-mermaid（卡内成功同款形态）')
  eq(segs[1].html.indexOf('gantt') !== -1, true, 'mermaid 源码保留')
}
{
  // 内容含尖括号需转义（mermaid 文本里可能有 < > 字符）
  const md = '```mermaid\nmindmap\n  root((主题))\n    A < B\n```'
  const segs = splitMermaidFence(md)
  eq(segs[0].type === 'mermaid' && segs[0].html.indexOf('A &lt; B') !== -1, true, 'mermaid 内容 HTML 转义')
}
{
  // 未闭合围栏（流式中）→ 整段留 md
  const md = '正在输出\n```mermaid\ngantt\n任务1 :a1,'
  const segs = splitMermaidFence(md)
  eq(segs.length === 1 && segs[0].type === 'md', true, '未闭合围栏 → 留 md（官方流式显示代码）')
}
{
  // 普通 ```js 围栏不切（官方代码高亮）
  const md = '示例：\n```js\nconst a = 1\n```\n结束'
  const segs = splitMermaidFence(md)
  eq(segs.length === 1 && segs[0].type === 'md', true, '非 mermaid 围栏不切分')
}
{
  // 多围栏
  const md = '```mermaid\ngraph TD;A-->B\n```\n中间\n```mermaid\npie title 占比\n"A":1\n```'
  const segs = splitMermaidFence(md)
  eq(segs.filter(s => s.type === 'mermaid').length, 2, '多 mermaid 围栏全识别')
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
