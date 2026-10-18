# dsh-mica

给 DeepSeek Harness（DSH）的 Web / 桌面界面加一层 **Windows 11 云母（Mica）材质**。

- 🖼 **真实壁纸背景（二维采样）**：host 半侧读取当前 Windows 桌面壁纸（`HKCU\Control Panel\Desktop\WallPaper`，取不到时退回 `TranscodedWallpaper`），把整张图缩成 **14×14 的二维色块阵列**交给浏览器；浏览器半侧保留**横竖两个方向**，合成一张跟在视口比例上的底片 —— 不是只取一列像素、也不是固定的假渐变。
- 🪟 **跟着窗口走（像真 Mica）**：host 另外给一张 **128 宽的桌面缩略图**和壁纸铺放方式（填充/适应/拉伸/居中/平铺/跨屏），浏览器**一次性**把它预模糊成桌面纹理，再按 `window.screenX/screenY` + 显示器原点把纹理摆到壁纸的真实位置上。拖动时每帧只写一个 `translate3d`（合成器搬运，不重绘），所以是**连续滑动**而不是一格一格跳：实测 800 px/s 拖动下逐帧色差 0.25 ΔE（旧实现 2.1，峰值 5.2）。
- 🪟 **云母着色 + 噪点**：按 Windows 11 的材质定义叠上着色层（Mica「基础」用比例透明度、Mica「Alt」用上重下轻的纱罩）与 2×2 有序抖动噪点。
- 🏔 **桌面起伏（relief）**：着色层是一个高不透明度的纯色，它会把桌面的明暗起伏一并抹平。所以底片会再以 `mix-blend-mode: soft-light` 叠回一层：只还原桌面的明暗，不还原壁纸的颜色 —— 既保持实心云母，又能看出桌面本身的形状。
- 🧊 **两个区，一块材质**：外侧（标题栏 + 左侧边栏 + 底栏）是同一层**更透**的云母面；对话区是同一层材质上再叠一块**更实**的板，左上角保留 **DSH 原版的 16px 圆角**（`--dsh-windows-content-radius`），交界处一条 Windows 风格的**发丝线**。右侧边栏停靠时用与对话区**同一块板**；最大化时还是这块板，只是盖到对话区上（背后不绘制对话），左上角在内外分界处重复同一个 16px 圆角。两区共用同一张壁纸纹理、同一套着色与浮雕，靠"再叠一层板"而不是"换一种材质"分出内外。
- 🫧 **表面各有其板，且只有一层**：输入框（`[data-composer-card]`）用一层 `::before` 模糊板托住自己（不能直接给卡片加 filter，否则卡片里弹出的斜杠/@ 菜单会连带失效）；菜单则**沿用 DSH 自己的** `MenuSurface` 材质（`.material` + `blur(40px)`），插件不再叠第二层，所以不会有"多层背板"。
- 🎚 **实心度有保证**：着色强度会同时缩放底色不透明度、纱罩与壁纸中性化；另外按采样壁纸的亮度做**对比度保护**（浅色面 + 深色壁纸、深色面 + 浅色壁纸都会把壁纸推出去），保证文字始终可读。
- ⚙️ **设置行**：设置 → 通用 → 「云母材质」里可以开关、切换云母 / 云母 Alt、调着色强度、模糊、噪点，并显示当前背景来源（跟随桌面 / 本地生成）与真实桌面纹理缩略图。
- ↩️ **完全可逆**：所有效果由 `ctx.effect` 持有；关掉开关或卸载插件，界面精确恢复原生状态，无需刷新。

## 安装

```sh
dsh plugin --profile desktop add <本目录绝对路径>
# 例如 dsh plugin --profile desktop add C:\path\to\dsh-mica
```

安装后 **重启 DSH**（宿主启动时会缓存包元数据与 bundles 层）。重启后在 设置 → 通用 中即可看到「云母材质」一行。

> 没有 `dsh` 命令时，等价于在 `%USERPROFILE%\.dsh\profiles\desktop` 目录里执行
> `pnpm add link:<本目录绝对路径>`，再把 `dsh-mica` 追加到该目录 `package.json`
> 的 `dsh.profile.bundles` 数组末尾。

卸载：

```sh
dsh plugin --profile desktop remove dsh-mica
```

## 配置

界面上可调，落在 `localStorage`（键前缀 `dsh.mica.`）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `mode` | `mica` | `mica`（着色比例、壁纸保留更多）/ `micaAlt`（纱罩更实、更"厚"） |
| `tintStrength` | `100` | 实心度：同时缩放底色不透明度（0.45 → 0.82）、纱罩（最高 +0.12）、壁纸中性化（饱和度 100% → 45%）与桌面起伏（0.18 → 0.80）。0 = 接近 Acrylic 的原始画面，100 = 实心云母 |
| `blur` | `22` | 壁纸柔化半径（桌面路径里会换算成纹理的预模糊 σ）；区域磨砂取它的 0.55 倍、浮层取 0.9 倍（0–60） |
| `noise` | `55` | 抖动噪点强度（0–100） |
| `wallpaper` | `''` | 预留的自定义背景（data URL），空 = 跟随桌面（无采样时用生成底片） |

此外还有一层按壁纸亮度自动生效、不受上表控制的**对比度保护**：材质填充（填充层）的不透明度
会从当前基线**连续**爬升到 0.94，所以浅色面压在深色壁纸上、深色面压在浅色壁纸上都不会糊掉文字；
只有"深色面 + 深色壁纸"这一种组合会保留更多壁纸。这段逻辑在 `applySettings()` 的 `need` /
`floorAlpha` / `ramp` 里，`scripts/preview.mjs` 用同一套公式以便预览与实机一致。

> 早先这一项是 `if (protective > 0.84) fill = max(fill, protective)`：裁剪区均值跨过 150 的那一帧，
> 填充会一步跳 +0.074（100% 时）/ +0.31（55%）/ +0.56（0%），整窗亮度跟着跳。现在是斜坡，
> 阈值处差值为 0，任何着色强度都不再有台阶。

### 采样管线

```
桌面壁纸 (2560×1600)
  │  host: PowerShell + System.Drawing，HighQualityBilinear
  ▼
14×14 二维色块（196 个 RGB，行优先）   +   128×72 桌面缩略图(RGB)   ← 同一次采样
  │                                             │
  │  client: 2×2 盒式平均                        │  client: 高斯预模糊（σ = blur×5 / 每texel像素）
  ▼                                             ▼
7×7 调色板网格                               两张 128×72 纹理
  ├─ 行平均 → 5 个色标：着色 / 纱罩 /            ├─ 壁纸纹理：模糊 + saturate(着色强度)
  │         对比度保护的亮度判据（整幅平均）      └─ 浮雕纹理：模糊 + brightness(整幅均值归一化)
  └─ 双线性采样 → 240×150 底片（仅回退路径）
       │
       └─ 材质层叠（自下而上）：
            壁纸层   跟随桌面时 = 桌面纹理（transform 位移，无 filter）
                     回退时 = 底片 + blur + saturate
            着色层   纯色 tint，按着色强度取 0.45–0.82
            纱罩层   上重下轻的渐变（Mica Alt 明显、Mica 极淡）
            噪点层   2×2 有序抖动
            填充层   材质的"实体"：100% 时对话区只透出 ~10% 的壁纸（外侧 ~35%，低强度时更透）—— 实心度的来源
            relief   壁纸纹理，soft-light（亮度已归一化），只还原明暗
```

**为什么渲染路径分两条**：跟随窗口要求材质按显示器的节奏移动，而"每帧换一张图"做不到平滑
（浏览器不会在两张图之间插值），并且每换一次都要重新解码 + 重新模糊两层全屏图层。所以主路径
把模糊烘进纹理、把运动交给 `transform`；只有"没有桌面采样 / 铺满整张 / 用了自定义图"时才走
底片 + 定时重绘的回退路径 —— 那条路径本来就不移动，所以不需要平滑。

**为什么要强调二维**：桌面壁纸在水平方向的差异往往比竖直方向更大（例如 210 → 96 的
左右亮度差，而上下只有 35）。曾经的做法只取 14×14 的**中间一列**当调色板，于是水平方向的
结构被整体丢掉，底片退化成一条竖直渐变 —— 无论壁纸长什么样，材质都只剩上下分层的条纹。
现在两个方向都保留：底片与采样在水平方向的亮度相关性为 0.995、竖直方向 0.971
（只取一列的话水平相关性恒为 0）。

**为什么要有 relief 层**：填充层是一块高不透明度的纯色，"实心"正是它带来的，但它同时会把
桌面的明暗起伏抹平。所以再叠一层同一张壁纸（跟随桌面时是同一张纹理），用 `soft-light` 把桌面的
**明暗**放回来、但不把它的**颜色**放回来。`soft-light` 不是保均值运算（暗底会被提亮、亮底会被
压暗），所以 relief 的亮度会先按壁纸的整体均值归一化（纹理路径烘进纹理、回退路径用 CSS
`brightness()`）：实测深色主题的面板平均亮度 59.6 对无 relief 的 59.7，也就是说 relief 只加
形状、不改变材质本身的黑白量级。

**为什么填充层在材质里、而不在区域上**：填充如果画在外壳区域上，它就压在 relief **上面**，
只留下 10% 的透过率，桌面的形状又被压回一条淡淡的痕迹；而且它得在每个区域各画一次，这
正是上一轮"三个区域材质不统一"的根源。把填充放进材质本体、让区域保持透明之后：整窗就是
同一块材质（连没被标记到的区域也一样），relief 也能整幅到达屏幕（深色主题的横向亮度起伏
从 3.2 提升到 24.9 个色阶，浅色 5.1 → 7.0）。

受此影响，设置行、气泡、输入框这类**浮在材质之上**的控件仍按 `--dsw-*` 令牌绘制自己的
半透明底色；对话框/菜单走 `--dsh-mica-overlay-fill` 单独填充（它们悬在内容之上，必须有
自己的底）。

### 表面与背板（以及一个会静默失效的坑）

令牌层分成两类，混在一起就会出 bug：

| 类别 | 例子 | 处理 | 理由 |
| --- | --- | --- | --- |
| **布局** | `--dsw-alias-bg-base`、`bg-layer-1/2/3`、`specific-sidebar-fill` | `bg-base` 与 `sidebar-fill` 归零，layer 保持 0.50–0.58 | 它们是窗口自身的"body"，桌面颜色就是从这些地方透进来的；`sidebar-fill` 归零是为了让侧边栏与标题栏真的同一块材质 |
| **表面** | `specific-input-major`、`specific-tip`、`specific-selector`、`bg-overlay` | 接近实心（0.84–0.94） | DSH 给它们的**原值是不透明的**（`specific-input-major` 就是纯白 / `#2c2c2e`），用它们的组件因此**不带任何 filter**；表面一旦透太多，身后的文字就会显形 |

第一类的问题好懂：不透就没材质。第二类的问题是**半透明底色本身不会模糊任何东西** ——
DSH 的输入框组件以为自己是实心板子，所以身后的会话文字会原样清晰地透出来。

这里的第二类要拆成两种，因为 DSH 对它们的做法完全相反：

| 表面 | DSH 自己的背板 | 插件该怎么办 |
| --- | --- | --- |
| 输入框 `[data-composer-card]` | **没有**（`background: var(--dsw-specific-input-major)`，纯色，无 filter） | 自己补一层 `::before` 板子 |
| 菜单 `[data-menu-material]`（`MenuSurface`） | **有**：`.material` 子层画 `--dsw-menu-surface-fill`，叠 `backdrop-filter: var(--dsw-menu-backdrop-filter)` = `blur(40px) saturate(150%)` | 什么都不做，**绝不能**再加 filter |

```css
/* 输入框：板子挂在 ::before 上，卡片自己不带 filter */
[data-composer-card] { background-color: transparent !important; isolation: isolate; }
[data-composer-card]::before {
  content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
  background-color: var(--dsw-specific-input-major);
  backdrop-filter: blur(var(--dsh-mica-panel-blur, 24px)) saturate(150%);
}
/* 只有「没有自己材质的浮层」才补背板 */
[role="menu"]:not([data-menu-material]),
[role="tooltip"]:not([data-menu-material]) { backdrop-filter: blur(…); }
```

`--dsh-mica-panel-blur` 默认取 `round(模糊 × 1.8)` ≈ **40px**，就是为了跟 DSH 菜单那个
`blur(40px)` 对齐：输入框和它正上方弹出的菜单必须是同一种材质，否则一眼就能看出两块板。

**坑一：背板会被祖先"静默废掉"。** 带 `backdrop-filter`（或 `filter`、`opacity < 1`、
`mask`）的元素会成为 **backdrop root**，浏览器随后**完全忽略**它的所有后代身上的
`backdrop-filter` —— 与模糊半径无关。这条坑踩了两次：

1. 第一版把 filter 加在**外壳区域**上，区域内所有背板全废；
2. 第二版把 filter 加在**输入框卡片**上 —— 而 DSH 的 `conversation.input.overlay` 槽位
   正是把斜杠命令菜单、@ 菜单渲染在 `[data-composer-card]` **里面**（`MenuView` 自己用
   `closest("[data-composer-card]")` 判断"是不是在输入框里"）。于是这些菜单的 `.material`
   一起失效，只剩下 58% 的填充，身后的会话文字原样透出来 —— 就是"斜杠命令菜单漏字"。

顺带一个反直觉的实测结论：`isolation: isolate` **不是** backdrop root（同一页、同一子元素，
加不加父级 `isolation` 测出来都是 0.11 / 0.12）。所以 `position:absolute; z-index:-1` 的
板子 + 父级 `isolation: isolate` 是安全组合，DSH 自己的 `MenuSurface` 就是这么写的。

**坑二：给菜单再加一层 filter = 多层背板。** 菜单的 `.material` 已经在模糊了，插件再往
`[role="menu"]` / `[data-menu-material]` / `[role="listbox"]`（菜单内层的 listbox 视口，
本身透明）上加 filter，就变成**一层填充叠两三次不同半径的模糊**，边界对不上，看起来就是
"多层背板叠加"。现在这三条全部撤掉。

还有一处容易搞错：`--dsw-specific-menu` 只是 `--dsw-menu-surface-fill` 的**别名**，改它**不会**
影响菜单表面（菜单读的是 `--dsw-menu-surface-fill`）。它自己的消费者也全都配着
`backdrop-filter: var(--dsw-menu-backdrop-filter)` 用 —— 那个令牌是全局声明在 `body` 上的
`blur(40px) saturate(150%)`，所以这些浮层自己就会糊，插件不需要（也不该）替它们改填充：
斜杠菜单底部那条"还有更多"的渐隐正是渐变到这个令牌，把它改成接近实心，渐隐就会变成
菜单底部多出来的一条实心带。三个菜单令牌现在**一律不碰**。

实测（同一页、只改结构；数字是**差分**指标：把身后的文字隐掉再相减，在表面**没有自身文字**
的行间空白处测残留的**锐利**分量，`53.4` = 文字完全不被遮挡，`0` = 完全糊平。深色主题，
浅色主题同向且更低，斜杠菜单 0.06–0.19）：

| 配置 | 斜杠命令菜单 | 模型菜单 | 输入框 |
| --- | --- | --- | --- |
| 上一版（卡片带 filter + 菜单表面再加 filter） | **30.6 / 49.0 / 34.2** | 0.39 | 0.05 |
| **当前版本**（板子在 `::before`、菜单只用自带材质） | **0.33 / 0.15 / 0.10** | 0.18 | 0.03 |

斜杠菜单那三列是菜单里三处行间空白（三个数字对应三处）；上一版每一处都能读出字，现在每一处
都只剩糊。模型菜单的数字本来就接近 0 —— 它的背板一直在卡片外面、从没失效过；它的问题是**多**
了一层，属于结构问题而不是像素问题，因而由测试断言守着（`scripts/verify.mjs`：任何规则都不许给
`[data-menu-material]` / 菜单内 `role="listbox"` 加 `backdrop-filter`；输入框卡片不许带
filter，板子必须在 `::before` 且带 `z-index:-1`；插件不许覆盖 `--dsw-specific-menu`、
`--dsw-menu-surface-fill`、`--dsw-menu-backdrop-filter` 这三个属于 DSH 的令牌）。

`scripts/preview.mjs` 会额外生成一个对照物：`preview/surface-backplate-before.html`（按上一版
的渲染方式重建：卡片带 filter + 菜单表面再加 filter），用来和当前版本并排看同一处菜单。

### 容器、提示与全屏面板

上一轮之后又有三份报告，根因各不相同，但都落在"什么该带 filter、什么该带填充"这条线上。

**1. 右侧边栏全屏会透出对话区。** 全屏不是给栏加宽，而是把整个面板变成一个 `width: 100vw`
的绝对定位薄片盖在对话区上（`data-sidebar-right-panel="fullscreen"`）。两个原因叠在一起：

- 面板自己没有背景，内部 dock 的 tab host 是 `--dsw-alias-bg-base`（插件有意改成全透明，材质要
  从这里透出来），所以薄片整个是透明的；
- 面板**没有 `z-index`**（`position: absolute; z-index: auto`），而对话区自己带层：
  输入框所在的 `composerSeat` 是 `position: sticky; z-index: 7`（斜杠菜单打开时 9），视图切换
  （对话 / 轨迹）是 `z-index: 1`。定位元素之间按 z-index 比较，`auto` 输给 7 和 1 —— 所以这些
  元素**画在薄片上面**，就算薄片铺满颜色也照样看得见。

现在给面板 20 的层级，填充则交给面板里的 `::before` 薄片（停靠/最大化两种填充见上一节）——
面板本身**不再画任何背景**，否则收起侧边栏后它会原地留下：

```css
[data-sidebar-right-panel="fullscreen"] {
  z-index: 20 !important;   /* 高过对话区的 7/9/1，低过菜单 70/100/1100 与对话框 1000 */
}
```

实测（同一页只改 `z-index`；数字是区域内的文字高频能量）：

| 区域 | 上一版（`z-index: auto`） | 本次（`z-index: 20`） |
| --- | --- | --- |
| 输入框 + 斜杠菜单 | **6.79** | **0.00** |
| 视图切换（对话 / 轨迹 / 文件） | 15.68 | 9.34（= 面板自己的标签，不再有对话区的字） |

**2. 浅色模式下提示文字看不清。** DSH 的 tooltip 气泡和 toast 在**两种主题下都是深色**，并且
文字是硬编码白色 —— 气泡写的是 `color: var(--dsw-static-neutral-bluish-00)`，toast 用的是
`--dsw-alias-toast-label`（同样是白色）。上一版为了"材质统一"把这两个底色改成了近白，
于是浅色主题里成了白字白底。现在它们保持 DSH 的深色，只把不透明度打开（0.88–0.92）让材质透出来：

| 指标（WCAG 对比度 = 文字亮度 / 底板亮度） | 上一版（浅色） | 本次（浅色） |
| --- | --- | --- |
| 悬停提示（tooltip） | **1.07 : 1**（等于看不见） | **7.41 : 1** |
| 弹出提示（toast） | **1.05 : 1** | **9.10 : 1** |

**3. 弹出提示没有模糊背板 / 设置界面没有背板。** 两条原因：

- **容器带了 filter。** 上一版给 `[role="dialog"]` / `[aria-modal="true"]` 加了 `backdrop-filter`，
  而对话框里会开 tooltip 和菜单 —— 带 filter 的祖先就是 backdrop root，它把所有后代的
  `backdrop-filter` 一起废掉。所以"对话框里的提示"必然没有模糊。现在**容器自己不带 filter**，
  磨砂交给它的 `::before` 子层（和输入框同一套写法）：

  ```css
  [aria-modal="true"][tabindex] { background-color: transparent !important; isolation: isolate; }
  [aria-modal="true"][tabindex]::before {
    content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
    background-color: var(--dsh-mica-dialog-fill);
    backdrop-filter: blur(var(--dsh-mica-panel-blur, 24px)) saturate(150%);
  }
  ```

  这也修好了**设置界面**：它就是 `role="dialog" aria-modal="true" tabindex="-1"` 的面板。

  填充度是单独的 `--dsh-mica-dialog-fill`，取 `材质填充 × 0.62` ≈ **0.53**（着色强度最低时
  0.36），比输入框那块板更透：板子已经有 40px 模糊在挡内容，再靠填充挡就只是在挡**材质**
  —— 浅色主题下材质本身就是近白色，0.87 的白板压上去和实心卡片看不出区别，所以"透明度不够"
  说的就是这件事。

  实测（浅色，设置面板内没有内容的行间空白；差分指标，edge = 残留的锐利分量，mass = 透上来的量）：

  | 配置 | edge（能不能读出字） | 填充 |
  | --- | --- | --- |
  | 上一版（0.96 实心、无模糊） | **70.7** | 4% 透光，但透过来的是**锐利**的字 |
  | **本次（0.53 + blur 40px）** | **≤0.21** | 47% 透光，透过来的是糊掉的色块 |

  对话框卡片用 `[aria-modal="true"][tabindex]` 识别 —— 图片灯箱也是 `aria-modal`，但它是铺满视口
  的透明容器（遮罩在子元素上），给它填色会把整个窗口盖住；灯箱没有 `tabindex`。
- **有 menu 没填充。** DSH 的 docking kit 标签右键菜单是 `role="menu"` 但只有边框、没有背景，
  插件只补了模糊，于是它成了一块"洞"。现在这类菜单补的是 DSH 自己的 `--dsw-menu-surface-fill`，
  和 `MenuSurface` 的菜单完全一致。

### 为什么不用 Windows 原生 Mica

真 Mica 由 DWM 在窗口背后合成，天然跟随移动/缩放。Electron 确实把它暴露成
`BrowserWindow#setBackgroundMaterial('mica')`，但这条路对插件是**关着**的，三条证据：

- 插件的 host 半侧跑在一个 `ELECTRON_RUN_AS_NODE=1` 的**子进程**里 —— 桌面外壳用
  `desktopNodeEnvironment()` spawn `@deepseek-ai/dsh-desktop-host` 并在那里 `runProfile`；
  Node 模式下 `require('electron')` 拿到的是二进制路径字符串，不是 `BrowserWindow` API。
- 主窗口 `createWindow()` 里没有 `backgroundMaterial`（只有欢迎窗用了 `acrylic`），标题栏
  overlay 的颜色还被渲染进程经 `windows-appearance` 通道同步成**不透明**色。
- 渲染进程的 preload 只暴露 `dshDesktop = { browser, deviceInfo, keyboard, shortcuts, updates }`，
  没有任何窗口外观 / 材质通道。

所以要拿到真 Mica 只能改 Desktop 外壳（`backgroundColor: '#00000000'` +
`backgroundMaterial: 'mica'` + 透明标题栏 overlay），属于上游改动，插件做不到 —— 插件能做的
上限是"按窗口在桌面上的位置采样壁纸"的近似。

### 按窗口位置采样（跟随窗口）

这就是"近似"的做法，效果上就等于 Mica 的"壁纸在窗口后面"：

**host 多给两样东西**，都来自同一次采样（PS 里顺带读两个注册表值）：

```jsonc
{
  "colors": [/* 14×14，整张壁纸，老路径 */],
  "desktop": { "w": 128, "h": 72, "rgb": "<base64 RGB>" },  // 桌面缩略图，约 41KB
  "style": { "wallpaperStyle": "10", "tile": "0" }          // 填充 / 适应 / 拉伸 / 居中 / 平铺 / 跨屏
}
```

**浏览器算出窗口是哪一块**：

```js
u0 = (screenX - monoLeft - ox) / (imageW * scale)      // 窗口左上角在图里的位置
u1 = (screenX - monoLeft + innerW - ox) / (imageW * scale)
// v 同理；dpr 只参与"显示器 -> CSS 像素"的换算，归一化之后与 dpr 无关
```

`(scale, ox, oy)` 由壁纸样式决定：填充/跨屏 = cover（居中裁切），适应 = contain（两侧黑边），
拉伸 = 非等比铺满，居中 = 1:1 居中，平铺 = 1:1 重复。窗口被拖出显示器时按 clamp 处理，
只有"适应/居中"的黑边才是真的黑。

**跟随方式：一张静态纹理 + 每帧只改变换**

跟随的关键不是"算得更快"，而是**每帧不换图**：

- host 的 128×72 缩略图在浏览器里**一次性**预模糊成两张纹理：壁纸层（模糊 + 按着色强度做饱和
  中性化）和浮雕层（模糊 + 按整张壁纸的均值归一化到 soft-light 的中性灰）。两张都只在一张新壁纸、
  改设置或切主题时重建（实测 **2.8 ms**），拖动时一直复用。
- 两层按**壁纸在屏幕上的真实矩形**定位（`--dsh-mica-frame-*`），再整体
  `translate3d(-screenX, -screenY)`（`--dsh-mica-shift-*`）。拖动 = 写两个 CSS 变量，合成器搬运
  已经光栅化好的图层：不解码、不模糊、不重绘，跟着显示器刷新率走（60/120Hz）。
- 浏览器仍没有"窗口移动"事件，所以还是 100 ms 轮询**发现**移动，然后唤醒 rAF 循环；
  连续 320 ms 没有位移就停掉循环（静止时零开销）。着色/纱罩/填充这几个标量按 4 Hz 更新
  （实测每步 ≤0.9 ΔE，本来就看不出来），停下后再完整重绘一次并通知设置行。

为什么必须这样（同一张壁纸、800 px/s 拖动，逐帧合成后的色差 ΔE，采样 7 个横向位置）：

| 更新方式 | 每帧位移 | 逐帧 ΔE 均值 | 逐帧 ΔE 峰值 |
| --- | --- | --- | --- |
| 旧：120 ms 定时重绘（换 `background-image`） | 96 px | 2.1 | 3.3–5.2 |
| 新：60 Hz transform | 13 px | **0.25** | **0.44** |
| 参照：新纹理 + 旧节奏（96 px/帧） | 96 px | 0.98 | 2.4 |

人眼在大面积上约 1–2 ΔE 起可见：8 次/秒、每次 3–5 ΔE 的阶跃就是"颜色闪烁"；13 px/帧的
0.4 ΔE 落在闪烁融合频率以上，看起来就是连续滑动。每帧的成本也从"两次全屏 `blur(40px)` 重绘"
降到 **0.04 ms** 的变量写入（纹理重建 2.8 ms 只发生在设置变化时）。

实测（同一张壁纸，预览页，窗口分别覆盖整个桌面 / 停在桌面右下 50%×50%）：

| 指标 | 铺满整张 | 右下 50%×50% |
| --- | --- | --- |
| 采样区平均亮度 | **170.6** | **122.7** |
| 侧边栏材质（100%） | rgb(46, 86, 83) · 77.5 | rgb(44, 62, 62) · **58.2** |
| 侧边栏材质（55%） | rgb(50, 82, 80) · 74.8 | rgb(52, 79, 79) · 72.9 |

100% 时对话区只透出 10%，所以位置差异主要靠明暗与色相的细微变化（右下那块桌面更暗，材质也跟着
暗约 19 个色阶）；55% 时两者反而接近：基线本身已有 0.85，亮壁纸那一侧的保护只把它抬到 0.857，
两侧的"实心度"几乎相同，只剩着色的冷暖差别。

**窗口有一部分出屏时**（这是最容易看出材质"变亮/变暗"的场合）：

- 采样区仍然是**窗口大小**，只是位置被夹在显示器内：`clamp(screenX, 0, monW - winW)`。
  以前是逐像素 clamp，窗口矩形一超出壁纸，壁纸边缘的像素就被反复计入裁剪区，着色统计被拉向
  边缘、**越拖越偏**（实测 tint 从 rgb(151,118,77) 漂到 rgb(171,144,101)）。现在出屏时着色
  停在边缘、完全不再漂移（tint 与填充保持不变）。
- 纹理本身照常平移（那正是"壁纸在窗口后面"），所以剩下那一条窗口看到的是真实的壁纸边缘。
- 出屏时的材质亮度摆动：100% 时 **11 → 4.8 个色阶**，55% 时 **15 → 6.3**（同一张壁纸、
  1600 px 宽窗口、屏幕 2560）。剩下的摆动来自"材质透出 10% 壁纸"这个设计本身，而不是着色漂移。

**中低着色强度下材质也不再随窗口变亮/变暗**：

- 着色层是一块**纯色**，颜色取自窗口下面那块壁纸（`stops[2]`）。强度低时填充变薄（55% 时壁纸透出
  42%），这块纯色的亮度就跟着窗口走——实测 800 px 宽的窗口横穿 2560 px 桌面，材质平均亮度摆动
  **16.2 个色阶**（100% 时只有 1–4，因为填充 0.85 把它盖住了，所以只有中低强度看得出来）。
- 现在只锁**亮度**：色相仍随桌面（材质照样会偏暖/偏冷），亮度对齐到"窗口所在高度、整幅宽度上的
  平均着色亮度"。同一组位置 16.2 → **6.4**，整体明暗保持不变（58.6 / 74.8 → 63.5 / 69.9，
  两者均值都是 66.7）。
- 参考值取"整幅宽度的平均"而不是"整张壁纸的平均色"：后者会把材质整体提亮 22 个色阶（窗口常常停在
  壁纸较暗的一段）。壁纸的**行**比**列**均匀得多，所以纵向拖动时亮度变化仍在几个色阶以内。
- 剩下的 6.4 是"55% 时透出 42% 壁纸"本身——壁纸自己的明暗在滑动。想再压下去只能让低强度也不那么
  透：实测把填充下限抬到 0.72 只再降到 5.3，却要整体变暗 8 个色阶，不划算，所以没做。

设置行里加了 `采样: 跟随窗口 / 铺满整张`：关掉就回到"整张壁纸铺满窗口"的老行为（那条路径仍然
是定时换图，只是不再移动，所以不会再闪），也用于多显示器 / 混合 DPI / 每屏不同壁纸这类算不准
的场合（那时位置映射会有偏移，但不会出错）。

**已知边界**：多显示器用"窗口所在显示器的 `availLeft/availTop`"当原点（任务栏在左侧时会偏一个
任务栏宽度）；每屏不同壁纸只能取到采样到的那一张；跨屏画布样式按 cover 近似。这些都是预模糊
之后不显眼、但确实存在的偏差。

### 两个区：外侧薄、内侧实（以及原版那个 16px 圆角）

DSH 桌面版自己就是这么分的（`@deepseek-ai/dsh-client-ui-layout` 的 `AppFrame.module.css`）：

```css
[data-windows-titlebar] .frame {
  --dsh-windows-content-radius: 16px;
  padding-top: var(--dsh-windows-titlebar-height);
  background: var(--dsw-specific-sidebar-fill);      /* 外侧：一整块 */
}
[data-windows-titlebar] .frame:before {              /* 标题栏条，同一块材质 */
  height: var(--dsh-windows-titlebar-height);
  background: var(--dsw-specific-sidebar-fill);
}
[data-windows-titlebar] .centerCol {                 /* 内侧对话区 */
  background: var(--dsw-alias-bg-base);
  border-radius: var(--dsh-windows-content-radius) 0 0 0;   /* 只有左上角 */
  corner-shape: round;
}
[data-windows-titlebar] .sidebarCol { border-right: none; }  /* Windows 上故意不画线 */
```

插件此前把 frame / 侧边栏 / 中间列全部设成透明、只留一层等密度材质，于是内侧没背景可裁（圆角消失）、
内外同密度（分不出内外）、那条本来就没有的线也不可能出现。现在按原版结构还原成两个区：

| | 100% 强度 | 说明 |
| --- | --- | --- |
| 外侧（frame + 标题栏条 + 左侧边栏 + 底栏） | 填充 **0.649** | 壁纸透出 35%；--dsw-specific-sidebar-fill 归零，侧边栏不再多一层 46% 白 |
| 内侧（对话区） | 背景 0.649 + 板 **0.721** = 合成 **0.902** | 比上一版更实（合成 0.857 → 0.902，透出 14% → 10%） |
| 右侧边栏（停靠） | 与内侧**同一块板**（0.721，合成 0.902） | 工作区，和对话区同密度；实测同一点与对话区同为 rgb(232,239,247) |
| 右侧边栏（最大化） | 与停靠**同一块板**（合成 0.902） | 只换盒子不换材质（同一屏幕点像素相同）；背后不绘制对话；左上角同一个 16px 圆角 |

- 圆角用 `border-radius: var(--dsh-windows-content-radius, 16px) 0 0 0`，板用 `border-radius: inherit`。
  角上那 16px 的缺口露出的是外侧那层材质：实测角点 rgb(198,219,240) 与外侧（标题栏 rgb(201,221,241)）
  同色，而板内是 rgb(235,241,247)。
- 分界线是板上的 `box-shadow: inset 1px 0 0, inset 0 1px 0`：深色 `rgba(255,255,255,0.09)`、
  浅色 `rgba(0,0,0,0.055)`；因为是 inset shadow，它会沿着圆角弧走。实测左边界、上边界各 +17 个色阶。
- 板**没有** `backdrop-filter`：背后已经是预模糊的纹理，而一段横跨大半个窗口的 backdrop-filter 会让
  拖动时每帧重算几百万像素。板只是纯色，拖动仍然是 0.04 ms 的变量写入。
- 中间列本身绝不能被 filter（它是输入框和所有内嵌菜单的祖先，filter 会变成 backdrop root），
  所以板必须是负 z 的 `::before` —— 和输入框、对话框同一套做法。
- 对话框/菜单的填充仍按**内侧**算（0.902×0.62 ≈ 0.56），否则它们会跟着外侧一起变透。
- 识别中间列：DSH 的类名是 `BynINW_centerCol`（哈希前缀随构建变，`_centerCol` 稳定），插件在打
  区域标记时按类名后缀判断，找不到就退回"含 `[data-composer-card]` 的那一列"，命中后打
  `data-dsh-mica-inner`；frame 打 `data-dsh-mica-frame`。样式只认这两个属性。
- **不要假设 frame 是 `#root` 的第一个孩子**：桌面版在 `#root` 和 frame 之间还有一层壳。早先的实现
  按"第一层孩子"打标记，结果标到了那层壳上 —— 侧边栏继续刷自己的 46% 白、中间列永远拿不到板，
  真实观感就成了"对话区比侧边栏还透，像 Acrylic"。现在改成从 `#root` 往下做**限深 6 层的遍历**，
  按类名找 `_centerCol`（它的父节点就是 frame），并把 frame 到 `#root` 之间的每一层都清掉底色；
  `_sidebarCol` / `_rightbarCol` / `_bottomRow` 再按类名兜底标记。
- 找不到内区时设置行会显示「分区未生效」：宁可报出来，也不要静默退回一层平板材质。
- 发丝线画在内侧列的 `::after` 覆盖层（`z-index: 1`、`pointer-events: none`），不是板的阴影：
  板在内容下面，阴影会被对话区自己的表头盖住。

### 右侧边栏：停靠是工作区，最大化是半透明薄片

`@deepseek-ai/dsh-client-ui-sidebar-right` 的结构和左侧边栏不一样：**右列只是一条轨道**，
真正可见的是轨道里一个 `position: absolute; top: 0; bottom: 0; right: 0` 的面板
（`[data-sidebar-right-panel]`）。停靠时 `width: 340px` 左右；最大化时 `width: 100vw`，
再由 `[data-windows-titlebar]` 规则压到 `calc(100vw - var(--dsh-windows-sidebar-width))` ——
**它的左边缘正好落在内外侧分界线上**，DSH 也会给第 0 列的 tab host 加同一个
`--dsh-windows-content-radius` 左上圆角。

因此三件事：

**1. 停靠时用内侧同一块板。** 板挂在面板的 `::before` 上，填充就是 `--dsh-mica-inner-fill`：
与对话区同色同密度（实测同一点 rgb(232,239,247)，与收起后的对话区完全一致），右列不再是
"对话区旁边一块更透的空白"。

**2. 板不能画在面板自己身上。** 收起侧边栏时，DSH 只把面板里的 dock 内容
`translateX(var(--dsh-sidebar-width))` 滑出去，**面板本身不动**。上一版把
`background-color: var(--dsh-mica-solid-fill)` 直接写在面板上，于是收起后那块不透明的白板
原地不动、继续盖住整块对话区（预览里就是 258→1280 一整片白）。现在面板只留
`isolation: isolate`，板是 `::before`，并且跟着 DSH 用同一个变量、同一条缓动滑走：

```css
[data-sidebar-right-panel]::before {
  content: ""; position: absolute; inset: 0; z-index: -1;
  background-color: var(--dsh-mica-inner-fill);
  transform: translateX(var(--dsh-sidebar-width, 100%));
  transition: transform var(--ds-transition-duration-slow) var(--ds-ease-in-out);
}
[data-sidebar-right-panel][data-sidebar-right-open]::before { transform: none; }
```

**3. 最大化只换盒子，不换材质。** 填充仍是 `--dsh-mica-inner-fill` —— 与停靠时、与对话区
**同一块板**；最大化只额外加左上的 `border-radius: var(--dsh-windows-content-radius, 16px) 0 0 0`
和内外侧那条发丝线（`inset 1px 0` / `inset 0 1px`）。实测停靠态与最大化态在同一个屏幕点上的
像素完全相同（例如 (1100,500) 两态都是 rgb(232,239,247)），所以切换呈现方式时材质不会变。

薄片背后**不绘制对话区**：即使按内侧的密度，转写文字仍会以约 10% 的对比透出，看起来像叠了
一层字。最大化时对话列直接不画：

```css
[data-dsh-mica-frame][data-rightbar-fullscreen] [data-dsh-mica-inner] { visibility: hidden; }
```

- 这里是 `visibility` 而**不是** `display: none`：后者会把对话列从 frame 的网格里拿掉，中间轨道
  塌缩，薄片的左边缘就离开内外分界线了。`visibility` 保留盒子与布局。
- 组件仍然挂载、继续接收流式输出，滚动位置和输入框状态都在；收起时同一帧恢复可见（那一刻薄片
  还盖着，不会闪）。
- 只跳过绘制，也就避开了"给薄片加一层全窗实时 `backdrop-filter`"那条路 —— 那条路会在拖窗口
  （壁纸纹理每帧在动）和模型流式输出（背后文字每帧在变）时每帧重算整个内容区。

这里还有一个**只要薄片不是完全不透明就会暴露**的问题：内侧那层板画到右列轨道处就结束了，而
最大化面板盖住的是"内侧板 + 轨道下的材质"两种底。薄片会把这条分界显成薄片内部一道**硬竖缝**
（更薄的 0.80 版本实测一个像素跨 11 个色阶）。解法不是把薄片加厚，而是让背后的底连续：DSH 在 frame 上
有 `data-rightbar-fullscreen`，它和"面板最大化"由同一次更新同时置位/清除，所以薄片在时内侧板
让开（`display: none`），背后的底只剩那张连续的材质：

```css
[data-dsh-mica-frame][data-rightbar-fullscreen] [data-dsh-mica-inner]::before { display: none; }
```

两次切换发生在同一帧：薄片出现时板已经让开（被薄片盖住），薄片收起时板已经回来（仍被薄片
盖住），所以不会闪。修完后同一扫描线上是连续渐变，没有台阶。

## 工作原理

```
lib/index.js   host 半侧：可选路由 /plugins/dsh-mica/palette
               └─ PowerShell(RegGetValueW → TranscodedWallpaper 兜底 + System.Drawing)
                  整张壁纸 → 14×14 色块 + 128×72 桌面缩略图(base64) + 壁纸铺放方式
                  → JSON（60s 内存缓存，永不抛错）
lib/client.js  浏览器半侧：window.__ModuleLoader__ 静态 bundle
               ├─ 桌面缩略图 → 一次性预模糊成两张 128×72 纹理（壁纸 / 浮雕），自带 PNG 编码器
               ├─ 按窗口位置裁出"窗口下面那块壁纸" → 7×7 调色板（2×2 盒式平均）→ 着色/纱罩/填充
               ├─ 着色的亮度锁定在"窗口高度上整幅宽度的平均"，所以横拖不会整窗变亮/变暗
               ├─ 材质六层：壁纸纹理 / 着色 / 纱罩 / 噪点 / 填充（实体）/ relief（soft-light）
               ├─ 窗口跟随：100ms 轮询唤醒 rAF，每帧只写 translate3d；静止 320ms 后停
               ├─ 回退路径（无缩略图 / 铺满整张 / 自定义图）：双线性底片 + 定时重绘
               ├─ 外壳每个顶层区域打上 data-dsh-mica-glass → background-color: transparent
               ├─ ctx.theme.overrideTokens() 叠加 --dsw-alias-* 半透明层
               └─ ctx.slots.register('settings.general.item') 设置行
```

host 路由是可选的：桌面外壳走 `file://`、非 Windows 主机、或探测失败时，浏览器半侧静默退回
程序生成的内置色板（它同样是二维的：每条色带按左右方向加了明暗倾斜），云母效果照常工作；
此时设置行会显示「本地生成 · 桌面采样不可用」，并把具体原因放在鼠标悬停提示里，便于区分
"真的取到了桌面" 和 "只是回退色板"。

区域标记覆盖外壳的**直接子元素**（标题栏、两列、右栏），只做两件事：把区域自己的底色关掉
（区域通常自带不透明背景），以及给区域加一层 `backdrop-filter` 磨砂。**材质本身与标记无关**，
所以即使某个区域没被标记到、或者层级更深，看到的仍然是同一块材质。对话框/菜单/提示这类
本就浮在内容之上的面板由样式表按 `[role="dialog"]` / `[aria-modal]` 单独处理，避免 filter
套 filter。

## 开发

```sh
# 离线验收测试（DOM + cordis 双 shim，不需要启动 DSH）
<node> scripts/verify.mjs
# 生成/更新 icon.png
<node> scripts/make-icon.mjs
# 生成预览页（把真实样式表铺在 shell 结构上），再用任意 Chromium 截图
<node> scripts/preview.mjs
```

`preview/` 里的四张截图就是上面这套流程产出的（浅色/深色 × 着色强度 100/55）：
`scripts/preview.mjs` 从 `lib/client.js` 里抽出**真正注入页面的样式表**，配上一层与
`apply()` 输出完全一致的 DOM 结构（`data-dsh-mica-backdrop` 六层 + 外壳 frame/中间列上的
`data-dsh-mica-frame` / `data-dsh-mica-inner` + 各区域上的 `data-dsh-mica-glass`）和同一套填充
公式，因此预览看到的就是实际效果。mock 的骨架也照抄了桌面版：`html[data-windows-titlebar]`、
frame 的 `padding-top` 与 `::before` 标题栏条、网格里的侧边栏 / 对话区两列，所以圆角和分界线
在预览里就位。

预览页左下角的「壁纸采样」面板会把采样管线的三段直接画出来：**主机采样 14×14 → 调色板 7×7 →
桌面纹理 128×72（预模糊）**，并标出壁纸路径，用来一眼确认两个方向的信息都还在。面板里的 196 个
色块是内置的 **Windows 11 默认壁纸（Bloom，`C:\Windows\Web\Wallpaper\Windows\img0.jpg`）** 采样样本
（`SAMPLE_B64`），所以预览可复现、也不含任何个人桌面内容；想换成别的壁纸，可以从 host 路由
`/plugins/dsh-mica/palette` 重新取一次数据再替换。

`preview/window-dark*.html`（`preview-window-dark.png`、`preview-window-dark-55.png`）是
**按窗口位置采样**的演示：同一个 shell，窗口被放在桌面右下 50%×50%，材质因此是右下那一块壁纸
（颜色和中央的蓝色花心明显不同），和 `mica-dark-*.png`（窗口覆盖整个桌面）对比即可看出差别。预览脚本
`preview.mjs` 里镜像了同一套映射（`fillRegion` / `regionCells` / `paletteFor` / `frameFor`）。

预览里的"桌面"就是 1280×800 的截图视口本身：材质的两张纹理是**屏幕空间**的（模糊半径按桌面像素
算），所以 1:1 的预览必须让桌面＝视口，否则模糊会被缩放带偏。

预览页里还有一处**背板演示**，照抄了真页面的结构：对话区中部铺了一段文字，然后

- 一个斜杠命令菜单压在文字上，它挂在 `[data-composer-card]` **里面**（`overlay-anchor`，和
  DSH 的 `conversation.input.overlay` 槽位一样）；
- 一个模型选择菜单挂在 shell **外面**（DSH 用 `createPortal` 挂到 `body`）；
- 两个菜单都用 `MenuSurface` 的 `.surface` + `.material` 结构（含 `isolation: isolate`），
  材质值取 DSH 的 `#f8f9fa94` / `#43454a73` 与 `blur(40px) saturate(150%)`。

所以 mock 里唯一由插件提供的板子是输入框那一层 —— 如果不生效，文字就会原样透出来。
`preview/surface-backplate-before.png` 按上一版的渲染方式重建（卡片带 filter + 菜单表面再叠
一层 filter），两张图里的斜杠菜单可以直接并排对比。

另外三个场景各写成一页，用来盯住各自的 bug：

| 页面 | 演示什么 |
| --- | --- |
| `preview-rightbar.html` / `preview-rightbar-fullscreen.html` / `preview-rightbar-collapsed.html` | 右侧边栏三态：停靠（与对话区同一块板）、最大化（半透明 + 分界处 16px 圆角）、最大化后收起（板随内容滑走，对话区完整露出） |
| `preview-rightbar-fullscreen-dark.html` | 同上的深色版 |
| `preview-rightbar-collapsed-before.html` | 同一收起场景按上一版渲染：填充画在面板上，白板原地留下盖住对话区 |
| `preview-surfaces.html` / `preview-surfaces-light.html` | 悬停提示（`role="tooltip"`）、弹出提示（`role="alert"`）、模态卡片（`role="dialog"[tabindex="-1"]`） |
| `preview-surfaces-before.html` / `preview-surfaces-light-before.html` | 同一页按上一版渲染（提示底色改回近白、对话框带 filter、无填充的菜单保持透明） |

对照截图：`preview-surfaces.png`、`preview-surfaces-light.png`、
`preview-surfaces-light-before.png`、`preview-rightbar.png`、`preview-rightbar-fullscreen.png`、
`preview-rightbar-collapsed.png`、`preview-rightbar-collapsed-before.png`、`rightbar-compare.png`。

> 表里的 HTML 场景页由 `node scripts/preview.mjs` 生成（每页内嵌当次采样的壁纸纹理，单页约
> 450 KB），仓库只跟踪同目录的 PNG 截图；clone 下来后跑一次预览脚本即可重新生成全部页面。

`lib/client.js` 是手写的 CommonJS closure factory（DSH client bundle 协议），
**不需要构建步骤** —— 改完文件后客户端模块系统会按文件 revision 自动热替换，
刷新页面即可看到新样式。

改动采样/材质数学时值得注意的两条经验：

- `verify.mjs` 会**解码底片 PNG**（bundle 用的是 stored deflate 块，不需要 inflate），
  然后断言横竖两个方向都有结构。把 `renderTile()` 的两轴采样临时改成只取一列，这组断言
  会立刻失败（横向相关性 0、整行 spread 归 0）—— 这正是这次修复的回归测试。
- `verify.mjs` 还会检查样式表里**没有重复的选择器**：同选择器后写的规则会静默覆盖先写的，
  relief 的 `brightness` 就曾被一条残留的同名规则整个抵消掉（渲染出来一模一样）。

想核对实机采样是否真的是二维，可以直接取一次 host 路由：

```sh
curl http://127.0.0.1:19387/plugins/dsh-mica/palette   # {"ok":true,"grid":14,"colors":[...196...]}
```

## 许可

MIT
