# DSH 插件弹层「透字」问题：诊断与统一修法

> 适用对象：在 DSH（DeepSeek Harness）0.2.x 里自绘弹层/下拉/选择器的插件。
> 结论基于本机 `@deepseek-ai/dsh-client-ui-theme@0.2.1-rc.1` 的实际取值与实测截图，
> 首次落地案例为 dsh-mysql（`openspec/changes/refine-picker-menu-material/`），
> 复现案例为 dsh-ssh（见 §8）。

---

## 0. 一句话结论

DSH 已经把菜单/弹层表面改成了**「半透明填充 + 背景模糊」的材质（material）**。
照抄了填充色、没照抄模糊的插件，就得到一块 **58% 不透明、且没有模糊的板**：
下层正文原样透出，白底上几乎看不见边界，滚动时内容从粘性页眉/页脚下穿过去。

修法不是「把背景改成不透明」一条路，而是**先决定你要哪种表面**，再按 §4 施工。

---

## 1. 30 秒确认是不是这个问题

现象（命中任意两条基本可以确诊）：

- 弹层后面的正文**清晰可读**（不是糊成一团，是字还是字）；
- 白底页面上**几乎描不出弹层边界**；
- 有搜索框的话，搜索框看着「只有一条边、没有底色」；
- 列表滚动时，行内容从固定页眉/页脚**下方透出**；
- 同一个插件在 **macOS 上看起来正常**，Windows 上发虚。

手动核对（DevTools → 选中弹层 → Computed）：

| 属性 | 出问题时的值 | 正常时的值 |
| --- | --- | --- |
| `background-color` | `rgba(248, 249, 250, 0.58)` | 同左，但…… |
| `backdrop-filter` | `none` | `blur(40px) saturate(1.5)` |
| 暗色主题 `background-color` | `rgba(67, 69, 74, 0.45)` | 同左 + blur |

要更省事，直接跑 §2 的审计脚本。

---

## 2. 审计脚本（DevTools Console 整段粘贴）

在 DSH GUI 里 `Ctrl+Shift+I` 打开 DevTools，粘进 Console 回车。
它会解析当前主题下的材质 token，然后找出**用了材质填充却没有（自身或祖先）模糊层**的元素。

```js
;(function () {
  const FILL_TOKENS = ['--dsw-menu-surface-fill', '--dsw-specific-menu']
  const CHROME_TOKENS = ['--dsw-alias-menu-group-header-fill', '--dsw-alias-menu-group-header']

  const probe = document.createElement('span')
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;pointer-events:none'
  document.body.appendChild(probe)

  const resolve = (names) => {
    const map = {}
    for (const name of names) {
      probe.style.background = ''
      probe.style.background = `var(${name})`
      const color = getComputedStyle(probe).backgroundColor
      if (color && color !== 'rgba(0, 0, 0, 0)') map[color] = name
    }
    return map
  }
  const fills = resolve(FILL_TOKENS)
  const chromes = resolve(CHROME_TOKENS)
  probe.remove()

  const alphaOf = (color) => {
    const parts = String(color).match(/rgba?\(([^)]+)\)/)
    if (!parts) return 1
    const values = parts[1].split(',').map((v) => parseFloat(v))
    return values.length > 3 ? values[3] : 1
  }

  // 自身或任一祖先带 backdrop-filter，就说明它坐在模糊层上
  const onBlurredLayer = (el) => {
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const filter = getComputedStyle(node).backdropFilter
      if (filter && filter !== 'none') return true
    }
    return false
  }

  const describe = (el) => {
    const tag = el.tagName.toLowerCase()
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : ''
    return tag + (el.id ? '#' + el.id : '') + cls
  }

  const findings = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 30) continue

    const fillToken = fills[cs.backgroundColor]
    const chromeToken = chromes[cs.backgroundColor]
    const alpha = alphaOf(cs.backgroundColor)

    let kind = null
    if (fillToken) kind = 'menu-material-fill'
    else if (chromeToken) kind = 'menu-chrome-fill'
    else if (alpha > 0 && alpha < 0.95 && cs.boxShadow !== 'none' && rect.width * rect.height > 20000) {
      kind = 'translucent-popover-like'   // 自定义 rgba 弹层
    }
    if (!kind) continue

    findings.push({
      kind,
      token: fillToken || chromeToken || '(自定义半透明底色)',
      selector: describe(el),
      size: Math.round(rect.width) + '×' + Math.round(rect.height),
      alpha: Math.round(alpha * 100) + '%',
      backdrop: cs.backdropFilter,
      blurredLayer: onBlurredLayer(el),
    })
  }

  const risky = findings.filter((f) => !f.blurredLayer && f.kind !== 'menu-chrome-fill')
  if (risky.length === 0) {
    console.log('%c✅ 没有发现「无模糊的半透明菜单板」', 'color:#22c55e;font-weight:600')
  } else {
    console.log('%c❌ 发现 ' + risky.length + ' 处无模糊的半透明菜单板', 'color:#ef4444;font-weight:600')
    console.table(risky.map((f) => ({ selector: f.selector, token: f.token, size: f.size, alpha: f.alpha })))
  }
  window.__dshSurfaceAudit = () => ({ risky, all: findings })
  return { risky, all: findings }
})()
```

判读：

- `menu-material-fill` + `blurredLayer: false` → **就是本文说的 bug**；
- `menu-chrome-fill` → 粘性组头色（94%），单独看不算错，但它挡不挡得住要看 §5.2；
- `translucent-popover-like` → 自定义 `rgba()` 弹层，同一个观感问题，同一个修法。

脚本已在两个夹具上验过：复刻 dsh-ssh 弹层的页面能稳定命中 1 处材质板 + 1 处自定义半透明板；
修好之后的 dsh-mysql 面板返回空数组（见 §7.2 的实测输出）。

---

## 3. 根因：token 链路与官方 DOM

### 3.1 取值（0.2.1-rc.1，运行时实测）

| token | 浅色 | 深色 | 说明 |
| --- | --- | --- | --- |
| `--dsw-menu-surface-fill` | `#f8f9fa94`（α 0.58） | `#43454a73`（α 0.45） | 材质填充，**半透明** |
| `--dsw-menu-backdrop-filter` | `blur(40px) saturate(150%)` | 同左 | 材质模糊，**必须与填充配对** |
| `--dsw-specific-menu` | `= var(--dsw-menu-surface-fill)` | 同 | 旧别名，插件最常误用的那个 |
| `--dsw-alias-menu-group-header-fill` | `#f8f9faf0`（α 0.94） | `#303136f0` | 粘性组头/页眉页脚用的近实底色 |
| `--dsw-elevation-prominent` | 0.5px `#00000029` + 两层柔投影 | 0.5px `#fff3` + 同 | 官方弹层阴影，替代 `--dsw-shadow-lv3` |

### 3.2 官方的 DOM 结构

```
.surface[data-menu-material="translucent"] { isolation: isolate }
  ├─ ._material   position:absolute; inset:0; z-index:-1;
  │               background: var(--dsw-menu-surface-fill);
  │               backdrop-filter: var(--dsw-menu-backdrop-filter);   ← 模糊在这里
  ├─ 内容（列表、页眉……）
  └─ [仅 darwin] body > ._backing   background: var(--dsw-alias-bg-base)  ← 不透明垫底
```

**关键点：官方从来不会只画那层 58% 的填充。** 填充只是个着色层，观感由模糊 + 立体描边共同完成。

### 3.3 为什么「以前看着没问题」

```
html[data-platform=darwin] body          { --dsw-specific-menu: #f8f9faf0 }   /* 94%，近乎实体 */
html[data-platform=darwin] body[dark]    { --dsw-specific-menu: #303136f0 }
```

同一份 CSS：

- **macOS**：94% → 看起来就是不透明板，怎么写都能用；
- **Windows / Linux**：58% → 一旦没有模糊就透字。

所以在 Mac 上开发/截图、在 Windows 上使用的插件，最容易踩这个坑。

⚠️ 反过来也有坑：把 `--dsw-specific-menu` 换成 `--dsw-menu-surface-fill` 时，
**macOS 上的填充会从 94% 掉到 58%**（darwin 只覆写了前者）。所以必须同时带上 blur，否则 Mac 上反而变差。

---

## 4. 修法

先选表面，再动手。两者都是「一处声明」级别的改动。

### 4.1 方案 B：补上模糊（保留官方观感）

```css
/* 把材质收成两个插件私有变量，将来 DSH 再改 token 只动这里 */
.my-panel {
  --panel-fill: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-2, #fff));
  --panel-blur: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));

  background: var(--panel-fill);
  -webkit-backdrop-filter: var(--panel-blur);
  backdrop-filter: var(--panel-blur);

  border: 0;                                   /* 别和 elevation 的 0.5px 描边叠成双线 */
  box-shadow: var(--dsw-elevation-prominent,
              0 0 0 .5px rgba(0, 0, 0, .16), 0 3px 8px rgba(0, 0, 0, .04), 0 0 20px rgba(0, 0, 0, .05));
  isolation: isolate;                          /* 和官方一致，避免内部 z-index 逃逸 */
}

/* 渲染器不支持背景模糊时，退回实体，绝不留无模糊的半透明板 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .my-panel { --panel-fill: var(--dsw-alias-bg-layer-2, #fff); --panel-blur: none; }
}
```

「材质 token 不存在」的降级是**免费的**：`var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-2, #fff))`
在旧 DSH 上直接落到不透明层色。

### 4.2 方案 A：改成实体（最省事、最确定）

```css
.my-panel {
  --panel-fill: var(--dsw-alias-bg-layer-2, #fff);   /* 浅色 #fff / 深色 #2c2c2e */
  --panel-blur: none;
  /* 其余同上 */
}
```

### 4.3 怎么选

| | 方案 B 补模糊 | 方案 A 实体 |
| --- | --- | --- |
| 观感 | 与官方弹层一致 | 与卡片/设置页一致 |
| 可预测性 | 依赖合成器，软渲染下性能略差 | 完全可预测，零合成开销 |
| 适用 | 内容轻、面积小的选择器/菜单 | 列表密集、需要绝对可读的工具面板 |
| 代价 | 58% 填充下深色文字仍会留一层极淡轮廓 | 丢掉磨砂质感 |

不确定就先上 B，把开关留好（§4.1 的两个变量），审稿时不满意改两行切 A。

---

## 5. 一起要改的六件事

只改面板背景，通常还会剩一半「透」的感觉。逐项过：

### 5.1 面板：填充 + 模糊 + 立体描边（§4）

### 5.2 粘性页眉 / 页脚：不能再 `inherit`

```css
.my-panel-header,
.my-panel-footer {
  position: sticky;
  z-index: 1;                                  /* ← 见 §6.3，缺了它页眉会被行内容盖住 */
  background: var(--dsw-alias-menu-group-header-fill, var(--dsw-alias-bg-layer-2, #fff));
  -webkit-backdrop-filter: var(--panel-blur);
  backdrop-filter: var(--panel-blur);          /* ← 94% 仍会留 6% 残影，再叠一层模糊 */
}
```

`background: inherit` 继承的是**半透明**那条声明，等于把 58% 复制到页眉上，
滚动时行内容会从页眉下方透出来。

> 实测：只有 94% 组头色时，滚到页脚下面的红色错误行会合成出 ≈`#eaeaea` 的灰影（肉眼可见）。
> 加上同款 blur 后，透出来的是模糊平均色，残影消失。

### 5.3 输入框：先确认 token 真的存在

```css
.my-field {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  border: 1px solid var(--dsw-alias-border-l1);
}
@supports not (background: color-mix(in srgb, red 50%, blue 50%)) {
  .my-field { background: var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2, #f5f6f7)); }
}
```

为什么不用 `--dsw-alias-bg-input`：**这个 token 在 DSH 0.2.1 里不存在**（整包扫描 16711 个文件，0 命中），
所有 `var(--dsw-alias-bg-input, transparent)` 都静默退化成透明——这正是「搜索框只有一条边」的来源。
dsh-mysql 修复前有 6 处踩在这上面（修完还剩 4 处：3 处在设置页、1 处是触发器的 `@supports` 兜底），
dsh-ssh 有 1 处。

用 6% `label-primary` 而不是固定色，是因为**输入框在浅色要向暗、深色要向亮**：
`label-primary` 在浅色是墨、深色是纸，一个声明两边都对。

### 5.4 描边与阴影

- `1px border-l1`（浅色 4% 黑）在白底上等于没有 → 换 `--dsw-elevation-prominent`（0.5px 16% + 柔投影）；
- 别把 `border` 和 `elevation-prominent` 的 0.5px 描边叠用，会出现双线；
- `--dsw-shadow-lv3` 是给普通卡片的，弹层用 `elevation-*`。

### 5.5 滚动条与焦点环

```css
.my-panel {
  --dsh-scrollbar-width: 6px;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2, var(--dsw-alias-scrollbar-bg-l1));
  --dsh-scrollbar-thumb-border: 2px;
  --dsh-scrollbar-track-margin: 12px;
}
/* 焦点环用「业务蓝」，不是 brand-primary */
.my-panel :focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 1px; }
```

### 5.6 标签（tag / badge）：先对齐量纲，再谈配色

小胶囊「看着粗糙」几乎都是量纲问题，不是颜色问题。DSH 自带一套 tag 配方（`._tag_*`），照抄即可：

| 属性 | 官方值 | 常见错法 |
| --- | --- | --- |
| font-size / line-height | `11px` / `17px` | `10px` / `1` |
| padding | `1px 8px` | `3px 7px` |
| font-weight | `500` | 继承 400 |
| 边框 | 有底色的档位**不描边** | 每颗都加 1px |
| 圆角 | `999px` + `corner-shape: round` | 只写 `999px` |

```css
.my-tag {
  display:inline-flex; align-items:center;
  font-size:11px; line-height:17px; font-weight:500; padding:1px 8px;
  border:0; border-radius:999px; corner-shape:round; white-space:nowrap;
  background:var(--dsw-alias-bg-module-platform); color:var(--dsw-alias-label-secondary);
}
.my-tag.warning { background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); color:var(--dsw-alias-state-warn-primary); }
.my-tag.info    { background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); color:var(--dsw-alias-state-business-primary); }
/* 默认态只留文字，不给底色 */
.my-tag.quiet { background:transparent; color:var(--dsw-alias-label-secondary); }
```

两条经验：

1. **默认态用 quiet，异常态才给底色。** 每行都挂两个胶囊时，「只读 / 全部表」这种默认信息会和白名单、权限标签抢注意力，反而看不出哪行特殊。
2. **文字档用 `label-secondary` 而不是 `label-tertiary`。** 后者在材质上约 3.5:1，11px 太小；前者 5.6:1 才稳。胶囊与文字档共用同一 padding，文字左沿才对得齐。

排版注意：字号从 10 → 11 后单行容量会下降，原来「一行塞 4 个」的地方要重算（dsh-mysql 从 4 收到 3，溢出用 `+N 表` 收口，并把完整列表挂到它的 `title` 上）。

---

## 6. 反复踩的八个坑

### 6.1 只取 fill，不取 blur
最常见，本文主题。审计脚本第一条就是它。

### 6.2 `background: inherit` 继承半透明
粘性页眉/页脚、`thead`、悬浮工具条——继承下来的是 58%，不是你以为的「和面板一样」。

### 6.3 `position: sticky` 挡不住后面的行
行元素只要有 `position: relative`（很常见），就会在绘制顺序上**晚于**页眉，
滚动时压到页眉上面。给页眉/页脚 `z-index: 1` 才能稳定盖住。这个 bug 在半透明时看不出来（反正都透），
改成实体后才暴露。

### 6.4 不存在的 token 不会报错
CSS 变量拼错/被上游删除时不会报错，`var(--x, transparent)` 静默变透明。
**用法前先确认它在当前版本存在**：

```js
// Console：打印你想用的 token 在本机的实际取值（空字符串=不存在）
['--dsw-alias-bg-input', '--dsw-menu-surface-fill', '--dsw-alias-menu-group-header-fill',
 '--dsw-elevation-prominent', '--dsw-alias-state-business-primary']
  .forEach((n) => console.log(n, '=', JSON.stringify(
    getComputedStyle(document.body).getPropertyValue(n).trim())))
```

### 6.5 `color-mix(..., transparent)` × 半透明面板 = 双重透明
9% 的 chip 叠在 58% 的板上，最终只有 ~4% 的可见度。
面板改成材质后，所有 `color-mix(x, transparent)` 的装饰色都要重新看一眼，
必要时改成 6% `label-primary`（不透明度由面板那层保证）。

### 6.6 `--dsw-alias-brand-primary` 是「墨色」，不是品牌蓝
浅色 `#0f1115`、深色 `#f9fafb`（反色）。
所以：`background: var(--brand-primary); color: #fff` 在**深色主题下是白底白字**。
需要蓝色请用 `--dsw-alias-state-business-primary`（`#4176e6`）或 `--dsw-alias-link`。
dsh-ssh 的 checkbox 勾选态（`background: brand-primary` + `color:#fff`）和 dsh-mysql 的主按钮都踩在这上面。

顺带：`var(--dsw-alias-brand-primary, #5b8def)` 这种「蓝色兜底」永远不会生效（token 存在），
写的人以为自己在用蓝，实际拿到的是墨色。**兜底值只在 token 缺失时用**，别拿它表达设计意图。

### 6.7 `backdrop-filter` 会创建层叠上下文与包含块
给面板加 blur 后：
- 它成为 `position: fixed` 子元素的包含块（弹层里再嵌套 fixed 定位要重新确认）；
- 内部的 `z-index: -1` 子层会被限制在面板内（这其实是好事，等价于官方的 `isolation: isolate`）。

### 6.8 平台差异会被带到截图里
darwin 94% / 其它 58%。只在一台机器上验过，等于没验。

---

## 7. 验证：别靠肉眼

### 7.1 计算样式断言

在页面里跑，对照期望值：

```js
const panel = document.querySelector('.my-panel')
const cs = getComputedStyle(panel)
console.log({
  fill: cs.backgroundColor,        // 期望 rgba(248, 249, 250, 0.58)
  blur: cs.backdropFilter,         // 期望 blur(40px) saturate(1.5)，不能是 none
  border: cs.borderTopWidth,       // 期望 0px
  shadow: cs.boxShadow,            // 期望 0.5px 描边 + 两层柔投影
})
```

### 7.2 审计脚本必须返回空

```
✅ 没有发现「无模糊的半透明菜单板」
```

### 7.3 截图矩阵

四个组合缺一不可，缺哪个都会漏：

| 维度 | 取值 |
| --- | --- |
| 主题 | 浅色 / 深色 |
| 背后内容 | 空白页 / **有正文压住**（判透字） |
| 状态 | 空闲 / 悬停 / 选中 / 报错（判对比度） |
| 滚动 | 顶部 / **滚到中间**（判粘性页眉页脚遮挡） |

没有浏览器自动化时，可以把插件 CSS 抽出来 + 抄上 token 值做成静态页，
用 `chrome --headless=new --screenshot` 出图。dsh-mysql 的夹具在
`.tmp/picker-preview/`（`build.cjs` 生成 light/dark/opaque/scroll 四个页面）。

### 7.4 对比度

材质合成色（浅色）≈ `#fbfcfc`，可以拿它当真值算：

| 组合 | 比值 | 结论 |
| --- | --- | --- |
| `label-primary` `#0f1115` | 18.4 | ✅ |
| `label-secondary` `#61666b` | 5.6 | ✅ |
| `state-error-primary` `#ec1313` | 4.4 | ⚠️ 小字临界 |
| `state-warn-primary` `#f59e0b` 叠 12% 底 | 1.9 | ❌ |
| `state-success-primary` `#22c55e` 叠 12% 底 | 2.0 | ❌ |

结论：**状态色直接当小字用不够**。要么加粗/加大，要么派生一个 `color-mix(state, label-primary 35%)` 的深色版。
（dsh-mysql 这两个角标还没改，见 §8.1 的遗留项。）

---

## 8. 两个真实案例

### 8.1 dsh-mysql（已修）

改前 → 改后（computed style 实测）：

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 面板 `background` | `rgba(248,249,250,0.58)` | 同左 |
| 面板 `backdrop-filter` | `none` | `blur(40px) saturate(1.5)` |
| 页眉/页脚 | `inherit`（0.58） | `rgba(248,249,250,0.94)` + blur |
| 搜索框 | `rgba(0,0,0,0)`（token 不存在） | `color(srgb … / 0.06)` |
| 面板描边 | `1px` `#0000000a` + `shadow-lv3` | `0` + `elevation-prominent` |
| 行高 | ≈99px（截图量得） | 70.8px |
| 焦点环 | `#0f1115`（墨色） | `#4176e6` |

遗留（同一类问题，尚未处理）：`可写` 药丸 1.9:1、`已选择` 角标 2.0:1 的对比度；
设置页 3 处 `--dsw-alias-bg-input`；主按钮 `color:#fff` 在深色下不可见。

### 8.2 dsh-ssh（待修，可直接照抄）

源码位置（`lib/style.css` 是 tsdown 产物，改 `src/`）：

| 位置 | 现状 | 对应本文 |
| --- | --- | --- |
| `src/client/session-selector.module.css:124` | `background: var(--dsw-specific-menu, …)`，无 blur | §4 |
| 同文件 `:125` | `box-shadow: var(--dsw-shadow-lv3, …)` | §5.4 |
| 同文件 `:122` | `border: 1px solid var(--dsw-alias-border-l1)` | §5.4 |
| 同文件 `:200` | `background: var(--dsw-alias-bg-input, transparent)` → 实际透明 | §5.3 |
| 同文件 `:241-242` | `color-mix(brand-primary 38%/9%)`，蓝色兜底 `#5b8def` 永不生效 | §6.6 |
| 同文件 `:265-266` | `background: brand-primary` + `color:#fff` → 深色白底白勾 | §6.6 |

好消息：`.hostRow` 的 hover 用的是 `--dsw-alias-interactive-bg-hover`（正确），
`.body` 自己滚动、页眉不在滚动容器里，所以**不需要** §5.2 的粘性遮挡处理。

最小改动（B 方案）：

```css
.dialog {
  background: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-2, #fff));
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
  border: 0;
  box-shadow: var(--dsw-elevation-prominent, 0 0 0 .5px rgba(0,0,0,.16), 0 3px 8px rgba(0,0,0,.04), 0 0 20px rgba(0,0,0,.05));
  isolation: isolate;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .dialog {
    background: var(--dsw-alias-bg-layer-2, #fff);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
.search {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
}
```

---

## 9. 回滚

材质是「一处声明」级别的开关，回滚成本极低：

```css
.my-root { --panel-fill: var(--dsw-alias-bg-layer-2, #fff); --panel-blur: none; }
```

不要为了让面板不透明去改 `--dsw-*` 全局 token——那会污染同页其它插件与官方 UI。

---

## 10. 上游会不会再变

会。本机安装目录里已经躺着 `0.2.1-rc.3` 的待安装更新（材质是最近几个版本才引入的）。
所以：

1. 插件侧只通过 `--dsw-*` token 表达颜色，不写死 `#f8f9fa` 之类的具体值；
2. 把材质收进 `--panel-fill` / `--panel-blur` 两个私有变量，上游改名只改两行；
3. 升级 DSH 后**重跑 §2 的审计脚本**——它不依赖版本号，只看运行时算出来的值。

---

## 附：一分钟版检查清单

- [ ] 审计脚本返回空
- [ ] 弹层 `backdrop-filter` 不是 `none`（或已改成实体）
- [ ] 粘性页眉/页脚有显式底色 + `z-index: 1`，滚到中间不透
- [ ] 输入框有可见底色（别用不存在的 `--dsw-alias-bg-input`）
- [ ] 弹层描边走 `elevation-*`，不叠 `border`
- [ ] 焦点环是 `state-business-primary`，不是 brand 墨色
- [ ] 浅色 + 深色、有正文压住、滚动中，四种截图都看过
- [ ] 状态色小字对比度 ≥ 4.5（不达标就派生深色版）
