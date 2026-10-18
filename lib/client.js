/**
 * dsh-mica client half - hand-authored DSH client bundle.
 *
 * Protocol: `window.__ModuleLoader__.load({ id, factory })`; the factory is a
 * lazy CommonJS module body whose exports are the cordis plugin contract
 * (`name` / `inject` / `apply`). It is written as plain CommonJS+ES5-in-ES2020
 * JavaScript instead of being built by tsdown so the package needs no build
 * step - the only externals are the platform module table entries `react` and
 * `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * What it does: paints a Windows 11 "Mica" material over the Web/Desktop
 * surface - *
 *   1. a backdrop built from the real desktop wallpaper (sampled by the host
 *      half) or a procedural palette fallback,
 *   2. the Mica tint + the 2x2 dither noise that defines the material,
 *   3. translucent alias-token surfaces with `backdrop-filter` frosting.
 * Everything is owned by `ctx.effect`, so unloading the plugin or switching the
 * row off restores the stock UI exactly.
 */

window.__ModuleLoader__.load({
  id: 'dsh-mica',
  factory: (require) => {
    //#region platform modules
    // The module table hands back namespace objects; `default` is the runtime.
    var reactModule = require('react')
    var React = reactModule.default || reactModule
    var primitivesModule = require('@deepseek-ai/dsh-client-ui-primitives')
    var primitives = primitivesModule.default || primitivesModule
    //#endregion

    //#region constants
    /** Root attribute that scopes every stylesheet rule this plugin owns. */
    var ROOT_ATTR = 'data-dsh-mica'
    /**
     * Which backdrop the material is built from: `desktop` (one static, moving
     * wallpaper texture) or `tile` (a generated tile, repainted in steps).
     */
    var SOURCE_ATTR = 'data-dsh-mica-source'
    /** Local storage namespace. */
    var LS = 'dsh.mica.'
    /** The host palette route (best effort - absence is handled). */
    var PALETTE_URL = '/plugins/dsh-mica/palette'
    /** Edge of the grid the host samples the wallpaper into (14x14 = 196 cells). */
    var GRID = 14
    /**
     * The palette grid the backdrop is built from: one cell per 2x2 block of
     * the host sample. BOTH axes are kept - a desktop wallpaper varies across
     * the screen horizontally as much as it does vertically, and a palette
     * holding a single column paints vertical bands instead of the desktop.
     * This second 2x2 average (the host's 14x14 is already an area average) is
     * what gives the material Mica's soft, low-frequency shading rather than a
     * 14x14 mosaic.
     */
    var COLS = 7
    var ROWS = 7
    /** Generated backdrop tile: width, and the height clamp for the viewport. */
    var TILE_W = 240
    var TILE_MIN_H = 72
    var TILE_MAX_H = 400
    /**
     * Window-following cadence.
     *
     * A window move fires no DOM event in a browser (only `resize` exists), so
     * the screen position has to be polled to NOTICE the move. Noticing may be
     * slow; following must not be. The poll therefore only wakes an
     * animation-frame loop, which writes the two transform values every frame
     * while the window moves and stops again once it has rested. A cadence-based
     * repaint was the previous design, and a repaint every 120 ms moves the
     * material in 90-px steps at a normal drag speed - which reads as flicker.
     */
    var POLL_MS = 100
    var SETTLE_MS = 260
    /** Stop the animation-frame loop after this much silence. */
    var IDLE_MS = 320
    /** How often the colour cast (tint/veil/fill) is resampled during a drag. */
    var PALETTE_MS = 240

    var DEFAULTS = {
      enabled: true,
      mode: 'mica', // 'mica' | 'micaAlt'
      tintStrength: 100, // % - 0 = raw (Acrylic-like), 100 = shipped Mica tint
      blur: 22, // px - wallpaper softening + panel backdrop blur
      noise: 55, // % - dither strength
      wallpaper: '', // user override (data URL) or ''
      position: 'center',
      // Sample the part of the wallpaper the window covers (and follow it), the
      // way Windows' own Mica does. Off = the whole wallpaper fitted to the
      // window, which is the old behaviour and the fallback for odd setups.
      followWindow: true,
    }

    /**
     * Alias tokens the Mica layer overrides, as `{ light, dark }` pairs.
     *
     * Two rules decide an alpha here, because getting either wrong is visible:
     *
     *  - LAYOUT tokens (`bg-base`, the `bg-layer-*` stack, the sidebar fill) are
     *    the window's own body. They stay quite translucent: the shell regions
     *    are transparent over the material, so these are what let the desktop
     *    tint the panels inside them.
     *  - SURFACE tokens (cards, the composer, menus, tips, popovers) belong to
     *    components that ship NO backplate, because DSH gives them an OPAQUE
     *    colour (`--dsw-specific-input-major` is plain white / #2c2c2e). Making
     *    one translucent without a blur lets whatever is behind it - a
     *    scrolling transcript, another panel - show through sharp. So they stay
     *    close to solid, and the plug-in puts a real blurred backplate on the
     *    composer and on the menu surfaces (see the stylesheet).
     */
    var COLOR_TOKENS = {
      '--dsw-alias-bg-base': { light: 'rgba(243, 243, 243, 0)', dark: 'rgba(32, 32, 32, 0)' },
      '--dsw-alias-bg-layer-1': { light: 'rgba(252, 252, 252, 0.58)', dark: 'rgba(58, 58, 58, 0.58)' },
      '--dsw-alias-bg-layer-2': { light: 'rgba(246, 246, 246, 0.54)', dark: 'rgba(52, 52, 52, 0.54)' },
      '--dsw-alias-bg-layer-3': { light: 'rgba(240, 240, 240, 0.50)', dark: 'rgba(48, 48, 48, 0.50)' },
      '--dsw-alias-bg-module-platform': { light: 'rgba(252, 252, 252, 0.58)', dark: 'rgba(58, 58, 58, 0.58)' },
      '--dsw-alias-bg-multi-select': { light: 'rgba(252, 252, 252, 0.58)', dark: 'rgba(58, 58, 58, 0.58)' },
      '--dsw-alias-bg-overlay': { light: 'rgba(252, 252, 252, 0.88)', dark: 'rgba(44, 44, 44, 0.90)' },
      '--dsw-alias-bg-mask-drop': { light: 'rgba(243, 243, 243, 0.55)', dark: 'rgba(32, 32, 32, 0.55)' },
      '--dsw-alias-bg-mask-1': { light: 'rgba(0, 0, 0, 0.12)', dark: 'rgba(0, 0, 0, 0.36)' },
      '--dsw-alias-bg-mask-2': { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(0, 0, 0, 0.18)' },
      '--dsw-alias-bg-mask-3': { light: 'rgba(0, 0, 0, 0.16)', dark: 'rgba(0, 0, 0, 0.42)' },
      '--dsw-alias-bg-skeleton': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.07)' },
      '--dsw-alias-border-l1': { light: 'rgba(0, 0, 0, 0.07)', dark: 'rgba(255, 255, 255, 0.09)' },
      '--dsw-alias-border-l2': { light: 'rgba(0, 0, 0, 0.12)', dark: 'rgba(255, 255, 255, 0.14)' },
      '--dsw-alias-border-l3': { light: 'rgba(0, 0, 0, 0.18)', dark: 'rgba(255, 255, 255, 0.20)' },
      '--dsw-alias-border-l4': { light: 'rgba(0, 0, 0, 0.26)', dark: 'rgba(255, 255, 255, 0.28)' },
      // The shell is the material, not a fill of its own. This token paints the
      // sidebar (and, in the Windows layout, the frame and its title strip). Left
      // at 46 % white it made the sidebar paler than the title strip - the one
      // surface with no such fill - so the two halves of the outer shell read as
      // two different materials. Measured in light mode: sidebar (217,232,245)
      // against the strip's (190,216,239).
      '--dsw-specific-sidebar-fill': { light: 'rgba(252, 252, 252, 0)', dark: 'rgba(50, 50, 50, 0)' },
      // `--dsw-specific-menu` is deliberately NOT here. DSH defines it as an
      // alias of `--dsw-menu-surface-fill` and paints every frosted popover
      // with it *together with* `backdrop-filter: var(--dsw-menu-backdrop-filter)`
      // (which is a global `body` token, `blur(40px) saturate(150%)`), so those
      // surfaces blur on their own and do not need a hand-made fill. Overriding
      // it also reaches consumers that expect the menu colour exactly - the
      // slash menu's bottom scroll fade is a gradient into this token, and a
      // near-opaque value turns that fade into a second visible band.
      '--dsw-specific-selector': { light: 'rgba(250, 250, 250, 0.88)', dark: 'rgba(54, 54, 54, 0.90)' },
      '--dsw-specific-tip': { light: 'rgba(252, 252, 252, 0.92)', dark: 'rgba(48, 48, 48, 0.94)' },
      '--dsw-specific-bubble': { light: 'rgba(255, 255, 255, 0.56)', dark: 'rgba(64, 64, 64, 0.52)' },
      '--dsw-specific-bubble-highlight': { light: 'rgba(246, 246, 246, 0.62)', dark: 'rgba(72, 72, 72, 0.56)' },
      '--dsw-specific-input-major': { light: 'rgba(255, 255, 255, 0.86)', dark: 'rgba(58, 58, 58, 0.88)' },
      '--dsw-specific-login-input': { light: 'rgba(250, 250, 250, 0.88)', dark: 'rgba(52, 52, 52, 0.88)' },
      '--dsw-alias-markdown-code-block': { light: 'rgba(250, 250, 250, 0.68)', dark: 'rgba(40, 40, 40, 0.68)' },
      '--dsw-alias-markdown-code-block-banner': { light: 'rgba(252, 252, 252, 0.72)', dark: 'rgba(46, 46, 46, 0.72)' },
      '--dsw-alias-markdown-inline-code': { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(255, 255, 255, 0.06)' },
      '--dsw-alias-markdown-tag': { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.05)' },
      // Tooltips and toasts are the two surfaces DSH paints DARK in both themes,
      // and their copy is a hard-coded white: the tooltip bubble sets
      // `color: var(--dsw-static-neutral-bluish-00)` next to
      // `background: var(--dsw-alias-tooltip-bg)`, and the toast pairs
      // `--dsw-alias-toast-bg` with `--dsw-alias-toast-label` (also white in both
      // palettes). Lightening those fills therefore produced white-on-white copy
      // in the light theme. They keep DSH's dark colours; only the alpha opens up,
      // so the material reads through the plate without touching the contrast.
      '--dsw-alias-toast-bg': { light: 'rgba(53, 54, 56, 0.90)', dark: 'rgba(53, 54, 56, 0.92)' },
      '--dsw-alias-tooltip-bg': { light: 'rgba(44, 44, 46, 0.88)', dark: 'rgba(44, 44, 46, 0.90)' },
    }
    //#endregion

    //#region utilities
    /** Read one localStorage key, tolerating a hostile/storage-less page. */
    var readRaw = (key) => {
      try { return window.localStorage.getItem(LS + key) } catch (error) { return null }
    }
    /** Write one localStorage key, tolerating quota/security errors. */
    var writeRaw = (key, value) => {
      try { window.localStorage.setItem(LS + key, String(value)) } catch (error) { /* memory only */ }
    }
    /** Drop one localStorage key. */
    var dropRaw = (key) => {
      try { window.localStorage.removeItem(LS + key) } catch (error) { /* ignore */ }
    }

    /** Clamp a finite number into [min, max]. */
    var clamp = (value, min, max, fallback) => {
      var n = Number(value)
      if (!Number.isFinite(n)) return fallback
      return Math.min(max, Math.max(min, n))
    }
    /** Coerce one byte channel. */
    var byte = (value) => {
      var n = Math.round(Number(value))
      return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : 0
    }
    /** RGBA triple to a CSS colour. */
    var rgba = (r, g, b, a) => 'rgba(' + byte(r) + ', ' + byte(g) + ', ' + byte(b) + ', ' + a + ')'
    /** Rec. 709 relative luminance of an `[r,g,b]` triple. */
    var luminance = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
    /** Blend `a` toward `b` by `t`. */
    var mix = (a, b, t) => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]
    /** Deterministic 32-bit string hash (stable procedural seed). */
    var hash32 = (text) => {
      var h = 2166136261
      for (var i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
      return h >>> 0
    }
    //#endregion

    //#region png encoding
    var CRC_TABLE = (() => {
      var table = new Uint32Array(256)
      for (var n = 0; n < 256; n += 1) {
        var c = n
        for (var k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
        table[n] = c >>> 0
      }
      return table
    })()

    /** CRC-32 as required by PNG chunks. */
    var crc32 = (bytes) => {
      var c = 0xFFFFFFFF
      for (var i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
      return (c ^ 0xFFFFFFFF) >>> 0
    }

    /** One PNG chunk: length, type, payload, CRC. */
    var chunk = (type, payload) => {
      var out = new Uint8Array(12 + payload.length)
      var view = new DataView(out.buffer)
      view.setUint32(0, payload.length)
      for (var i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
      out.set(payload, 8)
      view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)))
      return out
    }

    /** Standard zlib stream (RFC 1950) around a deflate payload. */
    var zlib = (raw) => {
      var out = new Uint8Array(raw.length + 6)
      out[0] = 0x78
      out[1] = 0x9C
      out.set(raw, 2)
      var adler = 1
      var s1 = 1
      var s2 = 0
      for (var i = 0; i < raw.length; i += 1) {
        s1 = (s1 + raw[i]) % 65521
        s2 = (s2 + s1) % 65521
      }
      adler = ((s2 << 16) | s1) >>> 0
      var view = new DataView(out.buffer)
      view.setUint32(out.length - 4, adler)
      return out
    }

    /** RFC 1951 stored (uncompressed) deflate blocks, 65535 bytes each. */
    var storedDeflate = (raw) => {
      var blockCount = Math.max(1, Math.ceil(raw.length / 65535))
      var out = new Uint8Array(raw.length + blockCount * 5)
      var at = 0
      var offset = 0
      for (var i = 0; i < blockCount; i += 1) {
        var size = Math.min(65535, raw.length - offset)
        var last = i === blockCount - 1 ? 1 : 0
        out[at] = last
        out[at + 1] = size & 0xFF
        out[at + 2] = (size >>> 8) & 0xFF
        out[at + 3] = ~size & 0xFF
        out[at + 4] = (~size >>> 8) & 0xFF
        at += 5
        out.set(raw.subarray(offset, offset + size), at)
        at += size
        offset += size
      }
      return out
    }

    /** Wrap `bytes` in a zlib stream, synchronously, without any dependency. */
    var deflate = (bytes) => zlib(storedDeflate(bytes))

    /**
     * Encode one RGB image as a PNG data URL.
     * @param width image width.
     * @param height image height.
     * @param pixels tightly packed RGB triplets, `width * height * 3` bytes.
     */
    var encodePng = (width, height, pixels) => {
      var stride = width * 3
      var raw = new Uint8Array((stride + 1) * height)
      for (var y = 0; y < height; y += 1) {
        raw[y * (stride + 1)] = 0 // filter: None
        raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
      }
      var ihdr = new Uint8Array(13)
      var view = new DataView(ihdr.buffer)
      view.setUint32(0, width)
      view.setUint32(4, height)
      ihdr[8] = 8 // bit depth
      ihdr[9] = 2 // colour type: truecolour
      var parts = [
        new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflate(raw)),
        chunk('IEND', new Uint8Array(0)),
      ]
      var total = 0
      for (var i = 0; i < parts.length; i += 1) total += parts[i].length
      var out = new Uint8Array(total)
      var at = 0
      for (var j = 0; j < parts.length; j += 1) { out.set(parts[j], at); at += parts[j].length }
      var binary = ''
      for (var k = 0; k < out.length; k += 1) binary += String.fromCharCode(out[k])
      return 'data:image/png;base64,' + window.btoa(binary)
    }
    //#endregion

    //#region palette
    /**
     * Downsample the host's 14x14 sample into the `COLS x ROWS` palette grid.
     *
     * 2x2 box averaging: exact, and it keeps both axes, which is the whole
     * point. The sample is a two-dimensional area average of the desktop, so
     * collapsing it to one column throws away every horizontal feature - a
     * sunrise, a bright window, a second monitor - and leaves vertical bands
     * that no longer resemble the wallpaper.
     */
    var gridFromSample = (colors) => {
      var cells = []
      for (var row = 0; row < ROWS; row += 1) {
        for (var col = 0; col < COLS; col += 1) {
          var sum = [0, 0, 0]
          for (var dy = 0; dy < 2; dy += 1) {
            for (var dx = 0; dx < 2; dx += 1) {
              var cell = colors[(row * 2 + dy) * GRID + (col * 2 + dx)]
              sum[0] += byte(cell.r)
              sum[1] += byte(cell.g)
              sum[2] += byte(cell.b)
            }
          }
          cells.push([sum[0] / 4, sum[1] / 4, sum[2] / 4])
        }
      }
      return cells
    }

    /**
     * The five-stop vertical ramp that the tint, the veil and the contrast
     * check read, as ROW AVERAGES of the palette grid - never a single column,
     * which is what used to make the tint follow one slice of the wallpaper.
     */
    var stopsFromGrid = (cells) => {
      var rows = []
      for (var y = 0; y < ROWS; y += 1) {
        var sum = [0, 0, 0]
        for (var x = 0; x < COLS; x += 1) {
          sum[0] += cells[y * COLS + x][0]
          sum[1] += cells[y * COLS + x][1]
          sum[2] += cells[y * COLS + x][2]
        }
        rows.push([sum[0] / COLS, sum[1] / COLS, sum[2] / COLS])
      }
      // Five stops at the first, quarter, middle, three-quarter and last row.
      return [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        var at = fraction * (ROWS - 1)
        var i = Math.min(ROWS - 2, Math.floor(at))
        return mix(rows[i], rows[i + 1], at - i)
      })
    }

    /** The area average of a palette grid, as one `[r,g,b]` triple. */
    var averageOfGrid = (cells) => {
      var sum = [0, 0, 0]
      for (var i = 0; i < cells.length; i += 1) {
        sum[0] += cells[i][0]
        sum[1] += cells[i][1]
        sum[2] += cells[i][2]
      }
      var n = Math.max(1, cells.length)
      return [sum[0] / n, sum[1] / n, sum[2] / n]
    }

    /** Derive a readable wallpaper palette from a host sample. */
    var paletteFromSample = (sample) => {
      if (sample === null || typeof sample !== 'object' || sample.ok !== true || !Array.isArray(sample.colors)) return null
      if (sample.colors.length !== GRID * GRID) return null
      var colors = sample.colors
      var cells = gridFromSample(colors)
      return {
        source: 'host',
        cells: cells,
        stops: stopsFromGrid(cells),
        average: averageOfGrid(cells),
        wallpaper: typeof sample.wallpaper === 'string' ? sample.wallpaper : '',
      }
    }

    /**
     * A deterministic procedural palette for hosts where the wallpaper cannot
     * be sampled (non-Windows, refused registry, headless browser). Index 0 is
     * a cool desktop blue, index 1 a warmer "spotlight" tone; the seed picks.
     */
    var PROCEDURAL = [
      [[243, 243, 243], [207, 220, 235], [131, 168, 206], [70, 108, 152], [240, 242, 245]],
      [[248, 246, 244], [232, 214, 199], [188, 150, 124], [116, 84, 66], [246, 243, 240]],
      [[240, 244, 240], [206, 222, 210], [133, 174, 150], [70, 112, 92], [242, 245, 242]],
      [[243, 240, 248], [214, 205, 232], [152, 138, 198], [88, 76, 138], [243, 241, 248]],
      [[238, 242, 246], [200, 210, 222], [124, 140, 162], [62, 74, 94], [238, 241, 245]],
    ]

    /**
     * Give one of the fallback ramps a light direction.
     *
     * The fallback has to be two dimensional for exactly the same reason the
     * sampled path does: a pure vertical ramp IS what one-dimensional sampling
     * looks like. The ramp keeps its shape and each column is shaded across x,
     * so the procedural backdrop has a dark side and a bright side the way a
     * photograph does instead of reading as horizontal stripes.
     */
    var rampGrid = (ramp) => {
      var cells = []
      for (var y = 0; y < ROWS; y += 1) {
        var t = (y / (ROWS - 1)) * (ramp.length - 1)
        var i = Math.min(ramp.length - 2, Math.floor(t))
        var base = mix(ramp[i], ramp[i + 1], t - i)
        for (var x = 0; x < COLS; x += 1) {
          var f = (x / (COLS - 1)) * 2 - 1 // -1 at the left edge, +1 at the right
          cells.push([
            base[0] * (1 - 0.13 * f),
            base[1] * (1 - 0.08 * f),
            base[2] * (1 + 0.04 * f),
          ])
        }
      }
      return cells
    }

    /** Build the procedural palette for a seed string. */
    var proceduralPalette = (seed) => {
      var index = hash32(seed) % PROCEDURAL.length
      var cells = rampGrid(PROCEDURAL[index])
      return {
        source: 'procedural',
        cells: cells,
        stops: stopsFromGrid(cells),
        average: averageOfGrid(cells),
        wallpaper: '',
      }
    }

    /**
     * The procedural palette for this page. Stable across a session (the seed
     * is host/shape derived, not time derived) so repeated renders do not
     * repaint the backdrop. Computed once, on first use.
     */
    var proceduralCache = null
    var proceduralForPage = () => {
      if (proceduralCache !== null) return proceduralCache
      var nav = window.navigator || {}
      var screenInfo = window.screen || {}
      proceduralCache = proceduralPalette([
        String(nav.platform || ''),
        String(nav.language || ''),
        String(screenInfo.width || 0) + 'x' + String(screenInfo.height || 0),
        String(new Date().getTimezoneOffset()),
      ].join('|'))
      return proceduralCache
    }
    //#endregion

    //#region wallpaper tile
    /**
     * Tile height for the current viewport.
     *
     * The tile is painted with a `background-size` that matches the viewport,
     * so building it at the viewport's aspect ratio means the whole sampled
     * desktop reaches the screen instead of a centre crop of it. The host
     * sample is a square area average of the wallpaper, so stretching the grid
     * to the display aspect also un-squashes it back to the desktop's shape.
     */
    var tileHeight = () => {
      var w = Number(window.innerWidth)
      var h = Number(window.innerHeight)
      var ratio = w > 0 && h > 0 ? h / w : 9 / 16
      return Math.max(TILE_MIN_H, Math.min(TILE_MAX_H, Math.round(TILE_W * ratio)))
    }

    /** Bilinear sample of the palette grid at fractional grid coordinates. */
    var sampleGrid = (cells, fx, fy) => {
      var x0 = Math.max(0, Math.min(COLS - 1, Math.floor(fx)))
      var y0 = Math.max(0, Math.min(ROWS - 1, Math.floor(fy)))
      var x1 = Math.min(COLS - 1, x0 + 1)
      var y1 = Math.min(ROWS - 1, y0 + 1)
      var top = mix(cells[y0 * COLS + x0], cells[y0 * COLS + x1], fx - x0)
      var bottom = mix(cells[y1 * COLS + x0], cells[y1 * COLS + x1], fx - x0)
      return mix(top, bottom, fy - y0)
    }

    /**
     * Render the palette grid into the backdrop tile.
     *
     * Sampled bilinearly on BOTH axes and cell centred, so every palette cell
     * owns an equal share of the tile and no axis is discarded. The result is a
     * heavily downsampled copy of the desktop, which CSS stretches to the
     * viewport and `--dsh-mica-blur` softens - exactly how a Mica backdrop is
     * produced.
     */
    var renderTile = (cells, width) => {
      var tileW = Math.max(8, Math.round(width === undefined ? TILE_W : width))
      var height = Math.max(2, Math.round((tileHeight() / TILE_W) * tileW))
      var pixels = new Uint8Array(tileW * height * 3)
      for (var y = 0; y < height; y += 1) {
        var fy = Math.max(0, ((y + 0.5) / height) * ROWS - 0.5)
        for (var x = 0; x < tileW; x += 1) {
          var fx = Math.max(0, ((x + 0.5) / tileW) * COLS - 0.5)
          var color = sampleGrid(cells, fx, fy)
          var at = (y * tileW + x) * 3
          pixels[at] = byte(color[0])
          pixels[at + 1] = byte(color[1])
          pixels[at + 2] = byte(color[2])
        }
      }
      return encodePng(tileW, height, pixels)
    }

    /**
     * The backdrop tile for one palette. Palettes are immutable, so the (fairly
     * large) data URL is built once and reused by every later render - the
     * settings row's swatch shows the very same image.
     */
    var tileFor = (palette) => {
      if (typeof palette.tile !== 'string') palette.tile = renderTile(palette.cells)
      return palette.tile
    }
    //#endregion

    //#region window-relative sampling
    /**
     * Decode the host's desktop thumbnail.
     *
     * The palette route also hands back a 128-wide RGB copy of the wallpaper.
     * Sampling THAT - instead of a fixed 14x14 whole-desktop grid - is what lets
     * the material show the part of the desktop the window actually covers, and
     * what makes it follow the window the way Windows' own Mica does.
     */
    var decodeDesktop = (sample) => {
      if (sample === null || typeof sample !== 'object') return null
      var desk = sample.desktop
      if (desk === null || typeof desk !== 'object') return null
      var w = Math.round(Number(desk.w))
      var h = Math.round(Number(desk.h))
      if (!(w > 0) || !(h > 0) || w * h > 512 * 512) return null
      if (typeof desk.rgb !== 'string' || typeof window.atob !== 'function') return null
      var binary
      try { binary = window.atob(desk.rgb) } catch (error) { return null }
      if (binary.length !== w * h * 3) return null
      var rgb = new Uint8Array(binary.length)
      for (var i = 0; i < binary.length; i += 1) rgb[i] = binary.charCodeAt(i)
      return { w: w, h: h, rgb: rgb }
    }

    /** The viewport rect, the monitor rect and the DPR, all in CSS pixels. */
    var viewGeometry = () => {
      var info = window.screen !== null && typeof window.screen === 'object' ? window.screen : {}
      var dpr = Number(window.devicePixelRatio)
      if (!(dpr > 0)) dpr = 1
      var width = Number(window.innerWidth)
      var height = Number(window.innerHeight)
      if (!(width > 0)) width = 1280
      if (!(height > 0)) height = 720
      var monW = Number(info.width)
      var monH = Number(info.height)
      if (!(monW > 0)) monW = width
      if (!(monH > 0)) monH = height
      var left = Number(info.availLeft)
      var top = Number(info.availTop)
      if (!isFinite(left)) left = 0
      if (!isFinite(top)) top = 0
      var x = Number(window.screenX)
      var y = Number(window.screenY)
      if (!isFinite(x)) x = left
      if (!isFinite(y)) y = top
      return {
        dpr: dpr,
        x: x,
        y: y,
        w: width,
        h: height,
        mon: { x: left, y: top, w: monW, h: monH },
      }
    }

    /**
     * Where the wallpaper sits on the monitor.
     *
     * Windows places the image by `HKCU\Control Panel\Desktop\WallpaperStyle`
     * (0 center, 2 stretch, 6 fit, 10 fill, 22 span) plus `TileWallpaper`. Every
     * one of those collapses into the same three numbers for the sampler: the
     * scale from monitor pixels to image pixels and the offset of the image's
     * top-left corner, plus how to treat points that fall outside the image.
     */
    var wallpaperLayout = (style, mon, image) => {
      var mode = 'fill'
      var raw = style !== null && typeof style === 'object' ? String(style.wallpaperStyle ?? '10') : '10'
      if (style !== null && typeof style === 'object' && String(style.tile ?? '0') === '1') mode = 'tile'
      else if (raw === '0') mode = 'center'
      else if (raw === '2') mode = 'stretch'
      else if (raw === '6') mode = 'fit'
      else if (raw === '22') mode = 'span'
      var sx = 1
      var sy = 1
      var ox = 0
      var oy = 0
      if (mode === 'fill' || mode === 'span') {
        var cover = Math.max(mon.w / image.w, mon.h / image.h)
        sx = cover
        sy = cover
        ox = (mon.w - image.w * cover) / 2
        oy = (mon.h - image.h * cover) / 2
      } else if (mode === 'stretch') {
        sx = mon.w / image.w
        sy = mon.h / image.h
      } else if (mode === 'fit') {
        var contain = Math.min(mon.w / image.w, mon.h / image.h)
        sx = contain
        sy = contain
        ox = (mon.w - image.w * contain) / 2
        oy = (mon.h - image.h * contain) / 2
      } else if (mode === 'center') {
        ox = (mon.w - image.w) / 2
        oy = (mon.h - image.h) / 2
      }
      // A window dragged partly off the monitor clamps (only its visible part can
      // matter); letterboxed styles really are black outside the image; a tiled
      // wallpaper repeats.
      var outside = 'clamp'
      if (mode === 'fit' || mode === 'center') outside = 'black'
      if (mode === 'tile') outside = 'tile'
      return { sx: sx > 0 ? sx : 1, sy: sy > 0 ? sy : 1, ox: ox, oy: oy, mode: mode, outside: outside }
    }

    /**
     * The window's rect in image-normalised coordinates.
     *
     * The rect is WINDOW-SIZED and its position is clamped inside the monitor,
     * so a window hanging over the screen edge samples the same amount of
     * wallpaper as one fully on screen - it only samples the nearest area that
     * actually exists. Sampling the true (partly off-desktop) rect instead
     * makes `sampleImage` repeat the wallpaper's edge pixels, which drags the
     * whole colour cast towards the edge colour as the window leaves the screen
     * (measured: the tint walked ~20/255 per channel over a 1200 px drag), and
     * the surface visibly changed brightness with it.
     */
    var regionFor = (geom, layout, image) => {
      var span = (value, size, limit) => {
        var room = limit - size
        if (!(room > 0)) return 0
        return Math.min(room, Math.max(0, value))
      }
      var x0 = span(geom.x - geom.mon.x, geom.w, geom.mon.w)
      var y0 = span(geom.y - geom.mon.y, geom.h, geom.mon.h)
      var u0 = (x0 - layout.ox) / (image.w * layout.sx)
      var u1 = (x0 + geom.w - layout.ox) / (image.w * layout.sx)
      var v0 = (y0 - layout.oy) / (image.h * layout.sy)
      var v1 = (y0 + geom.h - layout.oy) / (image.h * layout.sy)
      return { u0: u0, v0: v0, u1: u1, v1: v1, outside: layout.outside, mode: layout.mode }
    }

    /** Bilinear sample of the desktop thumbnail at normalised coordinates. */
    var sampleImage = (image, u, v, outside) => {
      if (outside === 'tile') {
        u -= Math.floor(u)
        v -= Math.floor(v)
      } else if (outside === 'clamp') {
        u = Math.min(1, Math.max(0, u))
        v = Math.min(1, Math.max(0, v))
      } else if (u < 0 || u > 1 || v < 0 || v > 1) {
        return [0, 0, 0]
      }
      var fx = u * image.w - 0.5
      var fy = v * image.h - 0.5
      var x0 = Math.max(0, Math.min(image.w - 1, Math.floor(fx)))
      var y0 = Math.max(0, Math.min(image.h - 1, Math.floor(fy)))
      var x1 = Math.min(image.w - 1, x0 + 1)
      var y1 = Math.min(image.h - 1, y0 + 1)
      var tx = Math.min(1, Math.max(0, fx - x0))
      var ty = Math.min(1, Math.max(0, fy - y0))
      var at00 = (y0 * image.w + x0) * 3
      var at01 = (y0 * image.w + x1) * 3
      var at10 = (y1 * image.w + x0) * 3
      var at11 = (y1 * image.w + x1) * 3
      var top = [
        image.rgb[at00] + (image.rgb[at01] - image.rgb[at00]) * tx,
        image.rgb[at00 + 1] + (image.rgb[at01 + 1] - image.rgb[at00 + 1]) * tx,
        image.rgb[at00 + 2] + (image.rgb[at01 + 2] - image.rgb[at00 + 2]) * tx,
      ]
      var bottom = [
        image.rgb[at10] + (image.rgb[at11] - image.rgb[at10]) * tx,
        image.rgb[at10 + 1] + (image.rgb[at11 + 1] - image.rgb[at10 + 1]) * tx,
        image.rgb[at10 + 2] + (image.rgb[at11 + 2] - image.rgb[at10 + 2]) * tx,
      ]
      return [
        top[0] + (bottom[0] - top[0]) * ty,
        top[1] + (bottom[1] - top[1]) * ty,
        top[2] + (bottom[2] - top[2]) * ty,
      ]
    }

    /**
     * The `COLS x ROWS` palette for one image region.
     *
     * Same 2x2 box average as the whole-wallpaper path, so the two palettes look
     * alike: the region's fraction of the image is divided into cells and every
     * cell averages four bilinear samples inside it.
     */
    var regionCells = (image, region) => {
      var cells = []
      var du = region.u1 - region.u0
      var dv = region.v1 - region.v0
      for (var row = 0; row < ROWS; row += 1) {
        for (var col = 0; col < COLS; col += 1) {
          var sum = [0, 0, 0]
          for (var dy = 0; dy < 2; dy += 1) {
            for (var dx = 0; dx < 2; dx += 1) {
              var u = region.u0 + ((col + 0.25 + dx * 0.5) / COLS) * du
              var v = region.v0 + ((row + 0.25 + dy * 0.5) / ROWS) * dv
              var color = sampleImage(image, u, v, region.outside)
              sum[0] += color[0]
              sum[1] += color[1]
              sum[2] += color[2]
            }
          }
          cells.push([sum[0] / 4, sum[1] / 4, sum[2] / 4])
        }
      }
      return cells
    }

    /** Stable identity for one region; drives the palette memo. */
    var regionKey = (region) => {
      var round = (value) => Math.round(value * 1e5) / 1e5
      return [round(region.u0), round(region.v0), round(region.u1), round(region.v1), region.outside].join('|')
    }

    /** A palette for one window region. */
    var paletteFromRegion = (image, region, wallpaper) => {
      var cells = regionCells(image, region)
      return {
        source: 'host',
        cells: cells,
        stops: stopsFromGrid(cells),
        average: averageOfGrid(cells),
        wallpaper: wallpaper,
        region: region,
        key: regionKey(region),
      }
    }
    //#endregion

    //#region desktop texture
    /**
     * Separable Gaussian over the desktop thumbnail, edges clamped.
     *
     * The backdrop used to be blurred by CSS (`filter: blur(40px)`) on a
     * viewport-sized layer, and that is exactly what a moving backdrop cannot
     * afford: every window position changed the image, so Chromium re-decoded
     * and re-blurred two full-screen layers per repaint. Baking the blur ONCE
     * into the texture turns the backdrop into a static image that only ever
     * MOVES (see the stylesheet's `translate3d`), which is compositor work with
     * no decode, no blur and no re-raster while the window is dragged.
     */
    var blurThumbnail = (image, sigma) => {
      var w = image.w
      var h = image.h
      var src = image.rgb
      var radius = Math.max(1, Math.min(12, Math.round(sigma * 3)))
      var kernel = new Float64Array(radius * 2 + 1)
      var total = 0
      var i
      for (i = -radius; i <= radius; i += 1) {
        var weight = Math.exp(-(i * i) / (2 * sigma * sigma))
        kernel[i + radius] = weight
        total += weight
      }
      for (i = 0; i < kernel.length; i += 1) kernel[i] /= total
      var mid = new Float64Array(w * h * 3)
      var out = new Uint8Array(w * h * 3)
      var x
      var y
      for (y = 0; y < h; y += 1) {
        for (x = 0; x < w; x += 1) {
          var r = 0
          var g = 0
          var b = 0
          for (var k = -radius; k <= radius; k += 1) {
            var xx = x + k
            if (xx < 0) xx = 0
            else if (xx > w - 1) xx = w - 1
            var at = (y * w + xx) * 3
            var kw = kernel[k + radius]
            r += src[at] * kw
            g += src[at + 1] * kw
            b += src[at + 2] * kw
          }
          var to = (y * w + x) * 3
          mid[to] = r
          mid[to + 1] = g
          mid[to + 2] = b
        }
      }
      for (x = 0; x < w; x += 1) {
        for (y = 0; y < h; y += 1) {
          r = 0
          g = 0
          b = 0
          for (k = -radius; k <= radius; k += 1) {
            var yy = y + k
            if (yy < 0) yy = 0
            else if (yy > h - 1) yy = h - 1
            var from = (yy * w + x) * 3
            kw = kernel[k + radius]
            r += mid[from] * kw
            g += mid[from + 1] * kw
            b += mid[from + 2] * kw
          }
          to = (y * w + x) * 3
          out[to] = byte(r)
          out[to + 1] = byte(g)
          out[to + 2] = byte(b)
        }
      }
      return out
    }

    /**
     * CSS `saturate(s)`'s colour matrix, applied to one pixel.
     *
     * The wallpaper layer used to carry `filter: saturate(...)`, which the tint
     * strength drives. A filter has to be baked into the texture for the same
     * reason as the blur: any filter on a full-desktop layer is re-rasterised
     * whenever its box moves through new tiles.
     */
    var saturatePixel = (r, g, b, s) => {
      var lr = 0.213
      var lg = 0.715
      var lb = 0.072
      return [
        (lr + (1 - lr) * s) * r + (lg - lg * s) * g + (lb - lb * s) * b,
        (lr - lr * s) * r + (lg + (1 - lg) * s) * g + (lb - lb * s) * b,
        (lr - lr * s) * r + (lg - lg * s) * g + (lb + (1 - lb) * s) * b,
      ]
    }

    /**
     * The two desktop textures the backdrop moves.
     *
     * `wall` is the wallpaper, blurred and neutralised by the tint strength;
     * `relief` is the same wallpaper blurred and re-centred on mid grey, which
     * is soft-light's neutral input. Both are built from the WHOLE desktop, so
     * a window move never invalidates them - it only moves them.
     *
     * The relief's re-centring reads the whole wallpaper's mean rather than the
     * crop's: the texture it modulates IS the whole wallpaper, so its own mean
     * is the right anchor, and the value stops changing as the window moves.
     */
    var desktopTextures = (image, layout, options) => {
      var sigma = Math.min(6, Math.max(0.4, options.blurPx / Math.max(0.5, layout.sx)))
      var blurred = blurThumbnail(image, sigma)
      var count = image.w * image.h
      var sum = [0, 0, 0]
      var i
      for (i = 0; i < count; i += 1) {
        sum[0] += blurred[i * 3]
        sum[1] += blurred[i * 3 + 1]
        sum[2] += blurred[i * 3 + 2]
      }
      var mean = [sum[0] / count, sum[1] / count, sum[2] / count]
      var tone = round3(0.5 / Math.max(0.08, Math.min(0.92, luminance(mean))))
      var wall = new Uint8Array(blurred.length)
      var relief = new Uint8Array(blurred.length)
      for (i = 0; i < count; i += 1) {
        var at = i * 3
        var colour = saturatePixel(blurred[at], blurred[at + 1], blurred[at + 2], options.sat)
        wall[at] = byte(colour[0])
        wall[at + 1] = byte(colour[1])
        wall[at + 2] = byte(colour[2])
        relief[at] = byte(blurred[at] * tone)
        relief[at + 1] = byte(blurred[at + 1] * tone)
        relief[at + 2] = byte(blurred[at + 2] * tone)
      }
      return {
        wall: encodePng(image.w, image.h, wall),
        relief: encodePng(image.w, image.h, relief),
        tone: tone,
        mean: mean,
        sigma: sigma,
      }
    }

    /** Where the wallpaper sits on screen, in CSS pixels. */
    var frameRect = (geom, layout, image) => ({
      x: geom.mon.x + layout.ox,
      y: geom.mon.y + layout.oy,
      w: image.w * layout.sx,
      h: image.h * layout.sy,
    })
    //#endregion

    /** The 2x2 Bayer dither that gives the Mica material its texture. */
    var NOISE_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'>"
      + "<rect width='2' height='2' fill='rgb(128,128,128)'/>"
      + "<rect width='1' height='1' fill='rgb(255,255,255)'/>"
      + "<rect x='1' y='1' width='1' height='1' fill='rgb(255,255,255)'/>"
      + '</svg>',
    )
    //#endregion

    //#region styles
    var STYLESHEET = [
      'html[' + ROOT_ATTR + '],',
      'html[' + ROOT_ATTR + '] body {',
      '  background-color: transparent !important;',
      '  background-image: none !important;',
      '}',
      'html[' + ROOT_ATTR + '] #root,',
      'html[' + ROOT_ATTR + '] #app,',
      'html[' + ROOT_ATTR + '] #dsh-root {',
      '  background-color: transparent !important;',
      '}',

      '[data-dsh-mica-backdrop] {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: 0;',
      '  pointer-events: none;',
      '  overflow: hidden;',
      '  contain: strict;',
      '}',
      '[data-dsh-mica-wallpaper] {',
      '  position: absolute;',
      '  inset: calc(-1 * var(--dsh-mica-bleed, 48px));',
      '  background-image: var(--dsh-mica-image);',
      '  background-position: var(--dsh-mica-position, center);',
      '  background-size: var(--dsh-mica-size, cover);',
      '  background-repeat: no-repeat;',
      '  filter: blur(var(--dsh-mica-blur, 22px)) saturate(var(--dsh-mica-wall-sat, 100%));',
      '  transform: scale(1.04);',
      '}',
      // Mica "base" tint: proportional alpha, so the wallpaper still shows.
      '[data-dsh-mica-tint] {',
      '  position: absolute;',
      '  inset: 0;',
      '  background-color: var(--dsh-mica-tint);',
      '}',
      // Mica "alt" tint: a stronger top-to-bottom veil.
      '[data-dsh-mica-veil] {',
      '  position: absolute;',
      '  inset: 0;',
      '  background-image: linear-gradient(180deg, var(--dsh-mica-veil-strong), var(--dsh-mica-veil-soft));',
      '}',
      // The desktop's SHAPE, re-injected above the flat tint.
      //
      // The tint is a single flat colour at a high alpha, which is what makes
      // the surface read as solid - but a flat colour also erases the desktop's
      // two-dimensional relief, leaving a material that no longer resembles the
      // wallpaper it was sampled from. `soft-light` puts the wallpaper's
      // luminance structure back without putting its colour back: the surface
      // keeps the Mica tint and gains the desktop's light and shade.
      '[data-dsh-mica-grain] {',
      '  position: absolute;',
      '  inset: 0;',
      '  background-image: url("' + NOISE_URL + '");',
      '  background-repeat: repeat;',
      '  background-size: 2px 2px;',
      '  opacity: var(--dsh-mica-noise, 0.03);',
      '}',
      // The material's own body: the flat, high-alpha fill that makes the
      // surface read as solid rather than as a window.
      //
      // It belongs HERE, inside the material, and not on the shell regions:
      // painted on the regions it sits ON TOP of the relief below (leaving only
      // its 23% pass-through, which flattens the desktop's shape back out), and
      // it has to be repeated on every region, which is what made them read as
      // separate boards. Filling the material once gives every region - tagged
      // or not, one level deep or ten - the identical surface.
      '[data-dsh-mica-fill] {',
      '  position: absolute;',
      '  inset: 0;',
      '  background-color: var(--dsh-mica-material-fill);',
      '}',
      // The desktop's SHAPE, re-injected above that flat fill.
      //
      // A single flat colour at a high alpha is what makes the surface read as
      // solid - but a flat colour also erases the desktop's two-dimensional
      // relief, leaving a material that no longer resembles the wallpaper it
      // was sampled from. `soft-light` puts the wallpaper's luminance structure
      // back without putting its colour back: the surface keeps the Mica tint
      // and gains the desktop's light and shade. Sitting above the fill instead
      // of below it is what lets the relief reach the screen whole.
      //
      // `brightness` re-centres that source on mid grey, which is soft-light's
      // neutral input. Soft-light is not mean preserving, so a tile carrying the
      // wallpaper's own (usually bright) mean would lift a dark material into
      // grey instead of shading it; the scale is `--dsh-mica-relief-tone`.
      '[data-dsh-mica-relief] {',
      '  position: absolute;',
      '  inset: calc(-1 * var(--dsh-mica-bleed, 48px));',
      '  background-image: var(--dsh-mica-image);',
      '  background-position: var(--dsh-mica-position, center);',
      '  background-size: var(--dsh-mica-size, cover);',
      '  background-repeat: no-repeat;',
      '  filter: blur(var(--dsh-mica-blur, 22px)) brightness(var(--dsh-mica-relief-tone, 1));',
      '  transform: scale(1.04);',
      '  mix-blend-mode: soft-light;',
      '  opacity: var(--dsh-mica-relief, 0);',
      '}',

      // DESKTOP MODE: one static, pre-blurred wallpaper texture, moved by
      // transform.
      //
      // This is the whole point of the texture. The material has to follow the
      // window at the display's own refresh rate, and only a transform can do
      // that: swapping the image - or even its `background-position` - forces
      // Chromium to decode and re-blur a desktop-sized layer on every frame, so
      // the material could only ever move in the steps of the repaint timer.
      // `translate3d` on an already-rasterised layer is pure compositor work:
      // the texture is uploaded once and then slides, at 60 Hz or 120 Hz,
      // without a single pixel being re-rendered.
      //
      // There is deliberately NO filter on these layers: the blur, the
      // saturation and the relief's brightness are baked into the textures.
      'html[' + ROOT_ATTR + '][data-dsh-mica-source="desktop"] [data-dsh-mica-backdrop] {',
      // A letterboxed wallpaper ("fit"/"center") really is black around the
      // image, which is what Windows shows and what the sampler reports.
      '  background-color: #000;',
      '}',
      'html[' + ROOT_ATTR + '][data-dsh-mica-source="desktop"] [data-dsh-mica-wallpaper],',
      'html[' + ROOT_ATTR + '][data-dsh-mica-source="desktop"] [data-dsh-mica-relief] {',
      '  inset: auto;',
      '  left: var(--dsh-mica-frame-x, 0px);',
      '  top: var(--dsh-mica-frame-y, 0px);',
      '  width: var(--dsh-mica-frame-w, 100vw);',
      '  height: var(--dsh-mica-frame-h, 100vh);',
      '  background-size: 100% 100%;',
      '  background-position: 0 0;',
      '  filter: none;',
      '  transform: translate3d(var(--dsh-mica-shift-x, 0px), var(--dsh-mica-shift-y, 0px), 0);',
      '  will-change: transform;',
      '}',
      'html[' + ROOT_ATTR + '][data-dsh-mica-source="desktop"] [data-dsh-mica-wallpaper] {',
      '  background-image: var(--dsh-mica-desktop);',
      '}',
      'html[' + ROOT_ATTR + '][data-dsh-mica-source="desktop"] [data-dsh-mica-relief] {',
      '  background-image: var(--dsh-mica-desktop-relief);',
      '}',

      // Shell regions: transparent over the material, so the title row, the
      // sidebar, the conversation column and the right bar are literally the
      // same surface rather than four copies of it. Their own background is
      // forced off (a region usually ships an opaque one).
      //
      // NO backdrop-filter here, deliberately. An element with `backdrop-filter`
      // becomes a BACKDROP ROOT, and Chromium then ignores `backdrop-filter` on
      // every descendant of it: a backplate inside a region does nothing at all,
      // at any blur radius. The composer and every in-region menu live inside a
      // region, so filtering the regions silently killed their backplates and
      // let the text behind them show through sharp. It bought nothing either -
      // the regions are transparent over an already-blurred material.
      'html[' + ROOT_ATTR + '] [data-dsh-mica-glass] {',
      '  background-color: transparent !important;',
      '}',

      // TWO ZONES. The outer shell (title strip, sidebar, right bar, bottom row)
      // is one thin sheet of the material; the conversation column is the SAME
      // material plus an extra plate, so it reads denser. This is DSH's own
      // Windows layout, which the plug-in had flattened into a single material:
      // the frame and its title strip paint one translucent fill, the center
      // column paints `--dsw-alias-bg-base` behind a 16px top-left radius
      // (`--dsh-windows-content-radius`) and, on Windows, NO divider at all.
      //
      // The frame's own fill goes transparent so the title strip and the sidebar
      // really are the same sheet (the strip used to carry an extra 46% white),
      // and the notch of the rounded corner shows that sheet, not a fill.
      'html[' + ROOT_ATTR + '] [data-dsh-mica-frame],',
      'html[' + ROOT_ATTR + '] [data-dsh-mica-frame]::before {',
      '  background-color: transparent !important;',
      '}',
      // The inner column may not be filtered itself - the composer and every
      // in-column menu live inside it, and a filtered ancestor is a backdrop root
      // (see the note above). The plate is a negative-z child layer instead, the
      // same trick the composer and the dialog cards use.
      'html[' + ROOT_ATTR + '] [data-dsh-mica-inner] {',
      '  position: relative;',
      '  isolation: isolate;',
      '  border-radius: var(--dsh-windows-content-radius, 16px) 0 0 0;',
      '  corner-shape: round;',
      '}',
      // The plate is a plain fill, NOT a backdrop blur: the material behind it is
      // already a pre-blurred texture, and a full-column `backdrop-filter` would
      // re-blur most of the window on every frame of a drag.
      'html[' + ROOT_ATTR + '] [data-dsh-mica-inner]::before {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 0;',
      '  z-index: -1;',
      '  border-radius: inherit;',
      '  background-color: var(--dsh-mica-inner-fill);',
      '}',
      // Windows 11's hairline along the top and left edges - the ones that meet
      // the outer sheet. It is a separate overlay, not a shadow on the plate:
      // the plate sits UNDER the column's content, so a shadow there would be
      // hidden by the conversation's own header strip.
      'html[' + ROOT_ATTR + '] [data-dsh-mica-inner]::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 0;',
      '  z-index: 1;',
      '  pointer-events: none;',
      '  border-radius: inherit;',
      '  box-shadow: inset 1px 0 0 var(--dsh-mica-edge), inset 0 1px 0 var(--dsh-mica-edge);',
      '}',

      // CONTAINERS: dialog cards (the settings panel is one of them) and the
      // dock's floating window.
      //
      // These are the surfaces that hold other surfaces - a dialog holds menus
      // and tooltips, a floating dock holds its tab menu. So they may NOT be
      // filtered themselves: a filtered element is a backdrop root, and Chromium
      // then ignores `backdrop-filter` on every descendant, which is what made
      // tooltips inside dialogs blurless.
      //
      // They keep a real frosted plate anyway, because a flat fill reads as
      // "opaque card" and loses the material - the same `::before` trick as the
      // composer: a negative-z layer INSIDE the card owns the fill and the blur,
      // so the card stays free of an ancestor backdrop root.
      //
      // `[tabindex]` separates a dialog CARD from the image lightbox, which is
      // also `role="dialog" aria-modal="true"` but is a full-viewport container
      // that owns no background of its own (its dimming mask is a child) - a fill
      // there would cover the entire window. The modal card is the one with
      // `tabindex="-1"`, and the settings panel sets the same.
      'html[' + ROOT_ATTR + '] [role="dialog"][aria-modal="true"][tabindex],',
      'html[' + ROOT_ATTR + '] [aria-modal="true"][tabindex],',
      'html[' + ROOT_ATTR + '] [data-dockkit-float] {',
      '  background-color: transparent !important;',
      '  isolation: isolate;',
      '}',
      'html[' + ROOT_ATTR + '] [role="dialog"][aria-modal="true"][tabindex]::before,',
      'html[' + ROOT_ATTR + '] [aria-modal="true"][tabindex]::before,',
      'html[' + ROOT_ATTR + '] [data-dockkit-float]::before {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 0;',
      '  z-index: -1;',
      '  border-radius: inherit;',
      '  background-color: var(--dsh-mica-dialog-fill);',
      '  -webkit-backdrop-filter: blur(var(--dsh-mica-panel-blur, 24px)) saturate(150%);',
      '  backdrop-filter: blur(var(--dsh-mica-panel-blur, 24px)) saturate(150%);',
      '  pointer-events: none;',
      '}',

      // THE RIGHT SIDEBAR. It has two presentations, and they want two different
      // sheets:
      //
      //  - docked, it is a work surface BESIDE the conversation, so it gets the
      //    conversation's plate - same fill, same tint - and the two panes read
      //    as one material instead of "conversation + a transparent leftover";
      //  - maximized, it is a sheet laid OVER the conversation (`width: 100vw`
      //    capped at `100vw - --dsh-windows-sidebar-width`, so its left edge IS
      //    the inner/outer boundary). There it is deliberately thinner than the
      //    plate, so the conversation ghosts through, and its top-left corner
      //    repeats the conversation's 16px notch at that same boundary.
      //
      // The plate is a `::before` INSIDE the panel, never a background ON the
      // panel. The panel does not move when the sidebar collapses - only its
      // dock children slide out (`translateX(--dsh-sidebar-width)`) - so the old
      // panel-level fill stayed behind as a white sheet covering the
      // conversation after "collapse". The plate is given that same slide, so
      // it leaves with the content and nothing is left on screen.
      //
      // The `z-index` is separate from the plate: the panel used to ship
      // `z-index: auto`, while the conversation's own seats are sticky and
      // layered (`--composerSeat` 7, 9 with a slash menu open, the view tabs 1),
      // which left the composer and tabs painted ON TOP of the maximized sheet.
      // 20 clears every conversation layer and stays under every popover
      // (menus 70/100/1100, dialogs 1000, toasts 1100).
      'html[' + ROOT_ATTR + '] [data-sidebar-right-panel] {',
      '  isolation: isolate;',
      '}',
      'html[' + ROOT_ATTR + '] [data-sidebar-right-panel]::before {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 0;',
      '  z-index: -1;',
      '  background-color: var(--dsh-mica-inner-fill);',
      '  transform: translateX(var(--dsh-sidebar-width, 100%));',
      '  transition: transform var(--ds-transition-duration-slow) var(--ds-ease-in-out);',
      '  pointer-events: none;',
      '}',
      'html[' + ROOT_ATTR + '] [data-sidebar-right-panel][data-sidebar-right-open]::before {',
      '  transform: none;',
      '}',
      'html[' + ROOT_ATTR + '] [data-sidebar-right-panel="fullscreen"] {',
      '  z-index: 20 !important;',
      '}',
      'html[' + ROOT_ATTR + '] [data-sidebar-right-panel="fullscreen"]::before {',
      // SAME sheet as the docked sidebar: maximizing changes the panel's box, not
      // its material. The plate is the conversation's plate either way, so the two
      // states read as one surface; only the 16px notch and the hairline are
      // added, at the boundary the sheet's left edge lands on.
      '  background-color: var(--dsh-mica-inner-fill);',
      '  border-radius: var(--dsh-windows-content-radius, 16px) 0 0 0;',
      '  corner-shape: round;',
      '  box-shadow: inset 1px 0 0 var(--dsh-mica-edge), inset 0 1px 0 var(--dsh-mica-edge);',
      '}',
      // The maximized sheet is translucent, so what lies BEHIND it has to be
      // continuous. The conversation's own plate ends at the right column's
      // track, and a sheet that lets the material through would then show the
      // plate's edge as a hard vertical step inside the sheet (measured: 11 RGB
      // across one pixel). DSH tells us exactly when the sheet is up
      // (`data-rightbar-fullscreen` on the frame, set false by the same update
      // that collapses the panel), so the plate steps aside while it is up: the
      // backdrop becomes the one continuous material, the sheet has no seam, and
      // the two swaps happen in the same frame - the sheet already covers the
      // plate when it goes, and it still covers it when it comes back.
      'html[' + ROOT_ATTR + '] [data-dsh-mica-frame][data-rightbar-fullscreen] [data-dsh-mica-inner]::before {',
      '  display: none;',
      '}',
      // ...and the pane itself stops painting. Even at the plate's density the
      // transcript read through the sheet as a second layer of type (the "透出
      // 工作区界面和文字" report); hiding the covered pane removes it without
      // making the sheet opaque.
      //
      // `visibility`, NOT `display`: `display: none` would take the column out of
      // the frame's grid, the centre track would collapse, and the sheet's left
      // edge would move off the inner/outer boundary. The pane stays mounted and
      // laid out - scroll offset, composer state and a streaming reply all stay
      // live - and the update that closes the sheet makes it visible again in the
      // same frame, while the sheet still covers it. Skipping paint is also what
      // keeps a large live blur (the other way to hide the type) out of the
      // frame budget.
      'html[' + ROOT_ATTR + '] [data-dsh-mica-frame][data-rightbar-fullscreen] [data-dsh-mica-inner] {',
      '  visibility: hidden;',
      '}',

      // The composer plate.
      //
      // DSH paints the card opaque (`--dsw-specific-input-major` is plain white)
      // and never blurs it, so once the plug-in makes that fill translucent the
      // transcript scrolling under it shows through SHARP. The blur has to live
      // on a `::before` plate, NOT on the card itself, for the same backdrop-root
      // reason as the regions above - and here it is not a corner case but the
      // main event: `conversation.input.overlay` renders the slash-command and @
      // menus INSIDE `[data-composer-card]` (DSH's own MenuView looks for
      // `closest("[data-composer-card]")` to decide what counts as "inside the
      // composer"), so a filter on the card made every one of those popups
      // unblurrable, at any radius. Their material fill is only 58% opaque, so
      // they showed the transcript through as sharp, readable text.
      //
      // This is the shape DSH's own `MenuSurface` uses: a `position:absolute;
      // inset:0; z-index:-1` child that filters only the plate. `isolation` keeps
      // that negative layer inside the card instead of letting it slide under the
      // transcript, and it is safe here - unlike a filter, isolation does not
      // become a backdrop root (measured: a filtered child blurs identically with
      // and without an `isolation: isolate` parent).
      'html[' + ROOT_ATTR + '] [data-composer-card] {',
      '  background-color: transparent !important;',
      '  isolation: isolate;',
      '}',
      'html[' + ROOT_ATTR + '] [data-composer-card]::before {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 0;',
      '  z-index: -1;',
      '  border-radius: inherit;',
      '  background-color: var(--dsw-specific-input-major);',
      '  -webkit-backdrop-filter: blur(var(--dsh-mica-panel-blur, 24px)) saturate(150%);',
      '  backdrop-filter: blur(var(--dsh-mica-panel-blur, 24px)) saturate(150%);',
      '  pointer-events: none;',
      '}',

      // Popovers that ship no material of their own get a backplate here.
      //
      // Menus with `[data-menu-material]` are deliberately NOT in this list.
      // Every DSH menu goes through `MenuSurface`, which already owns a plate: a
      // `[data-menu-material]` surface plus a `.material` child painting
      // `--dsw-menu-surface-fill` under `blur(40px) saturate(150%)`. Adding a
      // second filter to the surface stacks two blurs of the page behind one
      // fill, which reads as a doubled plate - and it also caught the menu's
      // inner `role="listbox"` viewport, adding a third.
      //
      // The ones that DO land here have no plate at all: the docking kit's tab
      // menu is `role="menu"` with only a border and no background, so a blur
      // alone left a hole showing the (already blurred) page. They get DSH's own
      // menu fill, which is exactly what a `MenuSurface` would have painted.
      'html[' + ROOT_ATTR + '] [role="menu"]:not([data-menu-material]) {',
      '  background-color: var(--dsw-menu-surface-fill) !important;',
      '  -webkit-backdrop-filter: blur(var(--dsw-mica-panel-blur, 24px)) saturate(150%);',
      '  backdrop-filter: blur(var(--dsw-mica-panel-blur, 24px)) saturate(150%);',
      '}',

      // Tooltips and toasts already own a DARK fill (their copy is hard-coded
      // white, see the token block); they only need the blur, and only their own
      // fill keeps the plate. `body > [role="alert"]` is the portaled toast -
      // the scoping keeps inline alert rows inside menus out of it.
      'html[' + ROOT_ATTR + '] [role="tooltip"]:not([data-menu-material]),',
      'html[' + ROOT_ATTR + '] body > [role="alert"] {',
      '  -webkit-backdrop-filter: blur(var(--dsh-mica-panel-blur, 24px)) saturate(150%);',
      '  backdrop-filter: blur(var(--dsh-mica-panel-blur, 24px)) saturate(150%);',
      '}',

      // The settings row.
      '.dsh-mica-row {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 10px;',
      '  padding: 14px 0;',
      '  font-family: var(--dsw-font-family);',
      '  color: var(--dsw-alias-label-primary);',
      '  border-top: 1px solid var(--dsw-alias-border-l1);',
      '}',
      '.dsh-mica-row-head {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 12px;',
      '}',
      '.dsh-mica-row-title {',
      '  flex: 1 1 auto;',
      '  min-width: 0;',
      '  font-size: 14px;',
      '  font-weight: 500;',
      '  line-height: 1.4;',
      '}',
      '.dsh-mica-row-sub {',
      '  margin-top: 2px;',
      '  font-size: 12px;',
      '  font-weight: 400;',
      '  color: var(--dsw-alias-label-secondary);',
      '}',
      '.dsh-mica-switch {',
      '  position: relative;',
      '  flex: 0 0 auto;',
      '  width: 40px;',
      '  height: 22px;',
      '  padding: 0;',
      '  border: 1px solid var(--dsw-alias-border-l2);',
      '  border-radius: 999px;',
      '  background: var(--dsw-alias-bg-layer-2);',
      '  cursor: pointer;',
      '  transition: background 160ms var(--ds-ease-in-out), border-color 160ms var(--ds-ease-in-out);',
      '}',
      '.dsh-mica-switch[data-on="true"] {',
      '  background: var(--dsw-alias-brand-primary);',
      '  border-color: transparent;',
      '}',
      '.dsh-mica-switch:focus-visible {',
      '  outline: 2px solid var(--dsw-alias-brand-primary);',
      '  outline-offset: 2px;',
      '}',
      '.dsh-mica-knob {',
      '  position: absolute;',
      '  top: 2px;',
      '  left: 2px;',
      '  width: 16px;',
      '  height: 16px;',
      '  border-radius: 50%;',
      '  background: var(--dsw-alias-label-primary-foreground, #fff);',
      '  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);',
      '  transition: transform 160ms var(--ds-ease-in-out);',
      '}',
      '.dsh-mica-switch[data-on="true"] .dsh-mica-knob {',
      '  transform: translateX(18px);',
      '}',
      '.dsh-mica-body {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 10px;',
      '}',
      '.dsh-mica-controls {',
      '  display: grid;',
      '  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));',
      '  gap: 10px 18px;',
      '}',
      '.dsh-mica-control-head {',
      '  display: flex;',
      '  align-items: baseline;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  font-size: 12px;',
      '  color: var(--dsw-alias-label-secondary);',
      '}',
      '.dsh-mica-value {',
      '  font-variant-numeric: tabular-nums;',
      '  color: var(--dsw-alias-label-primary);',
      '}',
      '.dsh-mica-range {',
      '  width: 100%;',
      '  margin: 6px 0 0;',
      '  accent-color: var(--dsw-alias-brand-primary);',
      '  cursor: pointer;',
      '}',
      '.dsh-mica-chips {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  align-items: center;',
      '  gap: 8px;',
      '}',
      '.dsh-mica-chips-label {',
      '  margin-inline-start: 6px;',
      '  font-size: 12px;',
      '  color: var(--dsw-alias-label-tertiary);',
      '}',
      '.dsh-mica-chip {',
      '  padding: 5px 12px;',
      '  font-family: inherit;',
      '  font-size: 12px;',
      '  color: var(--dsw-alias-label-secondary);',
      '  background: var(--dsw-alias-bg-layer-2);',
      '  border: 1px solid var(--dsw-alias-border-l1);',
      '  border-radius: 999px;',
      '  cursor: pointer;',
      '  transition: color 140ms var(--ds-ease-in-out), background 140ms var(--ds-ease-in-out), border-color 140ms var(--ds-ease-in-out);',
      '}',
      '.dsh-mica-chip:hover {',
      '  color: var(--dsw-alias-label-primary);',
      '  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3));',
      '}',
      '.dsh-mica-chip[data-active="true"] {',
      '  color: var(--dsw-alias-label-primary-foreground, #fff);',
      '  background: var(--dsw-alias-brand-primary);',
      '  border-color: transparent;',
      '}',
      '.dsh-mica-chip:focus-visible {',
      '  outline: 2px solid var(--dsw-alias-brand-primary);',
      '  outline-offset: 2px;',
      '}',
      '.dsh-mica-used {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  font-size: 12px;',
      '  color: var(--dsw-alias-label-tertiary);',
      '}',
      '.dsh-mica-swatch {',
      '  display: block;',
      '  width: 72px;',
      '  height: 26px;',
      '  border: 1px solid var(--dsw-alias-border-l1);',
      '  border-radius: 6px;',
      '}',
      '@media (prefers-reduced-motion: reduce) {',
      '  .dsh-mica-switch, .dsh-mica-knob, .dsh-mica-chip { transition: none; }',
      // DSH drops the dock's slide for these users; the plate must not keep
      // sliding on its own while the content it belongs to jumps.
      '  html[' + ROOT_ATTR + '] [data-sidebar-right-panel]::before { transition: none; }',
      '}',
      // A user who asked the system for less transparency gets solid surfaces
      // rather than a blur they would rather not have - and, because a solid
      // fill hides what is behind it, no backplate is needed for them at all.
      // The menus are switched through their own tokens: `MenuSurface` reads
      // `--dsw-menu-surface-fill`, and every frosted popover in DSH reads
      // `--dsw-specific-menu` + `--dsw-menu-backdrop-filter`. All three are
      // declared on `body`, so the override has to land there too (an inherited
      // value from <html> would lose to `body`'s own declaration).
      '@media (prefers-reduced-transparency: reduce) {',
      '  html[' + ROOT_ATTR + '] body {',
      '    --dsw-menu-surface-fill: var(--dsh-mica-solid-fill, #fafafa);',
      '    --dsw-specific-menu: var(--dsh-mica-solid-fill, #fafafa);',
      '    --dsw-menu-backdrop-filter: none;',
      '  }',
      '  html[' + ROOT_ATTR + '] [data-composer-card] {',
      '    background-color: var(--dsh-mica-solid-fill, #fafafa) !important;',
      '    isolation: auto;',
      '  }',
      '  html[' + ROOT_ATTR + '] [data-composer-card]::before { display: none; }',
      '  html[' + ROOT_ATTR + '] [role="menu"]:not([data-menu-material]),',
      '  html[' + ROOT_ATTR + '] [role="tooltip"]:not([data-menu-material]),',
      '  html[' + ROOT_ATTR + '] body > [role="alert"],',
      '  html[' + ROOT_ATTR + '] [aria-modal="true"][tabindex],',
      '  html[' + ROOT_ATTR + '] [data-dockkit-float] {',
      '    background-color: var(--dsh-mica-solid-fill, #fafafa) !important;',
      '    -webkit-backdrop-filter: none;',
      '    backdrop-filter: none;',
      '  }',
      // The right sidebar keeps its plate - it is a `::before`, so it has to be
      // the one made solid, not the panel (a solid panel is the white sheet that
      // outlived "collapse").
      '  html[' + ROOT_ATTR + '] [data-sidebar-right-panel]::before {',
      '    background-color: var(--dsh-mica-solid-fill, #fafafa);',
      '  }',
      '  html[' + ROOT_ATTR + '] [aria-modal="true"][tabindex]::before,',
      '  html[' + ROOT_ATTR + '] [data-dockkit-float]::before { display: none; }',
      '}',
    ].join('\n')
    //#endregion

    //#region settings store
    /** Normalize one persisted settings object. */
    var normalizeSettings = (input) => {
      var raw = input !== null && typeof input === 'object' ? input : {}
      return {
        enabled: raw.enabled === undefined ? DEFAULTS.enabled : raw.enabled !== false,
        mode: raw.mode === 'micaAlt' ? 'micaAlt' : 'mica',
        tintStrength: clamp(raw.tintStrength, 0, 100, DEFAULTS.tintStrength),
        blur: clamp(raw.blur, 0, 60, DEFAULTS.blur),
        noise: clamp(raw.noise, 0, 100, DEFAULTS.noise),
        wallpaper: typeof raw.wallpaper === 'string' ? raw.wallpaper : '',
        position: typeof raw.position === 'string' && raw.position !== '' ? raw.position : DEFAULTS.position,
        followWindow: raw.followWindow === undefined ? DEFAULTS.followWindow : raw.followWindow !== false,
      }
    }

    /** Load the persisted settings from localStorage. */
    var loadSettings = () => {
      var stored = readRaw('settings')
      if (stored === null) return normalizeSettings(null)
      try { return normalizeSettings(JSON.parse(stored)) } catch (error) { return normalizeSettings(null) }
    }
    //#endregion

    //#region plugin
    var NS = 'dsh-mica'
    var OVERRIDE_SOURCE = 'dsh-mica'

    var name = 'dsh-mica'
    // Both are mandatory in every Web composition (ui-layout already hard
    // depends on theme/slots), so requiring them cannot hide the plugin.
    var inject = ['slots', 'theme']

    /** Copy the alias-token layer, scaled by the tint-strength knob. */
    var scaledTokens = (strength) => {
      var out = {}
      var keys = Object.keys(COLOR_TOKENS)
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i]
        var pair = COLOR_TOKENS[key]
        out[key] = {
          light: scaleAlpha(pair.light, strength),
          dark: scaleAlpha(pair.dark, strength),
        }
      }
      return out
    }

    /** Scale the alpha of an `rgba(...)`/`#rrggbb` token value. */
    var scaleAlpha = (value, strength) => {
      var percent = clamp(strength, 0, 100, 100)
      var match = /^rgba\(([^)]+)\)$/.exec(value)
      if (match === null) return value
      var parts = match[1].split(',')
      if (parts.length < 4) return value
      var alpha = Number(parts[3])
      if (!Number.isFinite(alpha)) return value
      return 'rgba(' + parts[0] + ',' + parts[1] + ',' + parts[2] + ',' + String(Math.round(alpha * percent) / 100) + ')'
    }

    /**
     * The element carrying the Mica tint, grain and glass hook.
     *
     * The tint strength scales three things together, so "100%" really reads as
     * a solid material: how much the base tint blocks the wallpaper, how much
     * the Optional veil (Mica Alt) adds on top, and how neutral the wallpaper
     * showing through stays. A wallpaper is usually much more saturated than a
     * Mica surface - without the neutralising term a blue desktop bleeds
     * straight through the panels.
     */
    var applySettings = (settings, palette, dark, textures, tintLuma) => {
      var root = document.documentElement
      var v = palette.stops
      var strong100 = clamp(settings.tintStrength, 0, 100, 100) / 100
      var tint = v[2]
      // The tint's HUE follows the crop; its LUMINANCE does not (see
      // `tintReference` in the plugin body). Without this, a flat colour sampled
      // from the crop drags the whole surface's brightness around with the
      // window at mid/low strength - 16 levels of swing at 55 %.
      if (typeof tintLuma === 'number' && tintLuma > 0) {
        var sampledLuma = luminance(tint) * 255
        if (sampledLuma > 1) {
          var gain = tintLuma / sampledLuma
          tint = [byte(tint[0] * gain), byte(tint[1] * gain), byte(tint[2] * gain)]
        }
      }
      var alt = settings.mode === 'micaAlt'
      // Base tint: 45% (nothing) .. 82% (solid).
      var tintAlpha = round3(0.45 + 0.37 * strong100)
      // The veil is what distinguishes Mica Alt from Mica, so it never drops out.
      var veilStrong = alt ? round3(0.30 + 0.55 * strong100) : round3(0.03 + 0.09 * strong100)
      var veilSoft = alt ? round3(0.14 + 0.16 * strong100) : round3(0.03 + 0.07 * strong100)
      // Panels read the same material as the backdrop: the tint plus the veil
      // over the blurred wallpaper, so every column matches.
      var fill = alt
        ? (dark ? [46, 46, 46] : [248, 248, 248])
        : (dark ? [40, 40, 40] : [250, 250, 250])
      var fillAlpha = round3(
        (1 - (1 - tintAlpha) * (1 - veilStrong * 0.6)) * (0.62 + 0.30 * strong100),
      )
      // At full strength the CONVERSATION pane must stay a material, not a window
      // onto the desktop: it keeps only ~10% of the wallpaper. (It used to leave
      // 23%, and because a moving window slides the wallpaper through that
      // passthrough, the whole window's brightness tracked the desktop - visible
      // when the window hangs over the wallpaper's bright edge.) The shell is
      // solved separately, and deliberately thinner. The lower half of the slider
      // keeps its translucency: the term is quadratic in the strength.
      var keep = (1 - fillAlpha) * (1 - 0.58 * strong100 * strong100)
      fillAlpha = round3(1 - keep)
      // Contrast protection, driven by the sampled wallpaper's luminance. The
      // surface owns the fill, so the wallpaper stays a tint rather than the
      // page: a light surface over a dark wallpaper, and a dark surface over a
      // light one, both have to push the wallpaper well out to stay readable.
      // A dark surface over a dark wallpaper damages contrast least, so that is
      // the case where the wallpaper is allowed to show through the most.
      //
      // The protection is a CONTINUOUS ramp, not a threshold. It used to be
      // `if (protective > 0.84) fill = max(fill, protective)`, which stepped the
      // fill by +0.074 at full strength and by +0.31 at 55% the moment the
      // crop's mean crossed 150 - a one-frame jump in the whole surface's
      // opacity, exactly when a dragged window slides over a light/dark edge.
      // It now leaves the base fill untouched at the neutral point and reaches
      // the same 0.84..0.94 floor at 18 luma away from it, with zero slope at
      // both ends, so no window position can produce a step.
      var wallpaperLuma = luminance(palette.average) * 255
      var need = dark
        ? // dark surface: a light wallpaper needs the strongest fill
          Math.min(1, Math.max(0, (wallpaperLuma - 150) / 120))
        : // light surface: a dark wallpaper needs the strongest fill
          Math.min(1, Math.max(0, (150 - wallpaperLuma) / 120))
      var floorAlpha = Math.min(0.94, 0.84 + need * 0.10)
      var ramp = Math.min(1, need / 0.15)
      ramp = ramp * ramp * (3 - 2 * ramp)
      fillAlpha = round3(fillAlpha + Math.max(0, floorAlpha - fillAlpha) * ramp)
      var style = root.style
      var custom = settings.wallpaper !== ''
      if (textures === null || textures === undefined) {
        // FALLBACK: a generated tile (or the user's photograph). This path is
        // never dragged - it is only reached when there is no desktop to
        // follow - so it can afford to repaint whenever the settings change.
        if (root.getAttribute(SOURCE_ATTR) !== 'tile') root.setAttribute(SOURCE_ATTR, 'tile')
        var image = custom ? settings.wallpaper : tileFor(palette)
        style.setProperty('--dsh-mica-image', 'url("' + image + '")')
        // The generated tile already has the viewport's aspect ratio, so it is
        // stretched to fit; a user's photograph keeps its own aspect instead.
        style.setProperty('--dsh-mica-size', custom ? 'cover' : '100% 100%')
      } else {
        // DESKTOP MODE: a static texture in wallpaper coordinates, placed at
        // its real screen rect and then translated by the window's own offset.
        // Nothing is rebuilt or re-encoded while the window moves.
        if (root.getAttribute(SOURCE_ATTR) !== 'desktop') root.setAttribute(SOURCE_ATTR, 'desktop')
        var frame = textures.frame
        var geom = viewGeometry()
        style.setProperty('--dsh-mica-desktop', 'url("' + textures.wall + '")')
        style.setProperty('--dsh-mica-desktop-relief', 'url("' + textures.relief + '")')
        style.setProperty('--dsh-mica-frame-x', frame.x + 'px')
        style.setProperty('--dsh-mica-frame-y', frame.y + 'px')
        style.setProperty('--dsh-mica-frame-w', frame.w + 'px')
        style.setProperty('--dsh-mica-frame-h', frame.h + 'px')
        style.setProperty('--dsh-mica-shift-x', (-geom.x) + 'px')
        style.setProperty('--dsh-mica-shift-y', (-geom.y) + 'px')
        // The tile is not part of this mode; leaving an old one behind would
        // make the DOM claim a backdrop that is not on screen.
        style.removeProperty('--dsh-mica-image')
      }
      style.setProperty('--dsh-mica-tint', rgba(tint[0], tint[1], tint[2], tintAlpha))
      style.setProperty('--dsh-mica-veil-strong', rgba(tint[0], tint[1], tint[2], veilStrong))
      style.setProperty('--dsh-mica-veil-soft', rgba(v[v.length - 1][0], v[v.length - 1][1], v[v.length - 1][2], veilSoft))
      // TWO ZONES. Everything up to here solved ONE density, used by the whole
      // window. The material is now split: the outer shell (title strip, sidebar,
      // right bar, bottom row) keeps a thinner sheet, and the conversation column
      // gets an extra plate over that same sheet. Solving the plate from the
      // outer fill means the composite the user sees in the conversation is
      // exactly `fillAlpha` - the redesign changes the sidebar, not the content.
      var outerFill = round3(fillAlpha * 0.72)
      var plateFill = round3(1 - (1 - fillAlpha) / Math.max(0.08, 1 - outerFill))
      // The material's own body. Every region is transparent over it, so this
      // one fill IS the outer surface, and the relief above it survives intact.
      style.setProperty('--dsh-mica-material-fill', rgba(fill[0], fill[1], fill[2], outerFill))
      // The conversation column's plate, over that outer sheet. The right sidebar
      // paints the SAME plate - docked beside the conversation, maximized over it
      // - so the material does not change when the panel changes presentation.
      style.setProperty('--dsh-mica-inner-fill', rgba(fill[0], fill[1], fill[2], plateFill))
      // Windows 11's hairline between the content pane and the shell.
      style.setProperty('--dsh-mica-edge', dark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(0, 0, 0, 0.055)')
      // The same colour at full opacity, for `prefers-reduced-transparency`.
      style.setProperty('--dsh-mica-solid-fill', rgba(fill[0], fill[1], fill[2], 1))
      // Dialog / floating-panel plate. It carries a real 40px backdrop blur, so it
      // does not need the fill to hide anything - the blur already dissolves the
      // text behind it. A near-solid fill therefore only costs the material: on a
      // light palette both the surface AND the material are near-white, so any
      // alpha above ~0.75 is indistinguishable from an opaque card. This is
      // ~0.53 at full tint strength and ~0.36 at the low end - the lowest a
      // dialog can go while its own copy still sits on a stable plate - and it is
      // deliberately more transparent than the composer, which has to stay solid
      // because the transcript scrolls right up to it.
      style.setProperty('--dsh-mica-dialog-fill', rgba(fill[0], fill[1], fill[2], Math.min(0.9, Math.max(0.36, round3(fillAlpha * 0.62)))))
      style.setProperty('--dsh-mica-noise', String(round3((settings.noise / 100) * 0.055)))
      style.setProperty('--dsh-mica-blur', settings.blur + 'px')
      style.setProperty('--dsh-mica-bleed', Math.round(settings.blur * 2.2 + 20) + 'px')
      // Regions read the wallpaper through their own fill, so they need much
      // less blur than a floating pane to look like the same material.
      style.setProperty('--dsh-mica-region-blur', Math.max(4, Math.round(settings.blur * 0.55)) + 'px')
      // The composer plate has to match the blur of the menus that open right
      // above it: DSH's `MenuSurface` hard-codes `blur(40px) saturate(150%)`, and
      // a 20px plate next to a 40px popup reads as two different materials. The
      // slider still scales it, but around that 40px anchor.
      style.setProperty('--dsh-mica-panel-blur', Math.min(64, Math.max(8, Math.round(settings.blur * 1.8))) + 'px')
      style.setProperty('--dsh-mica-position', sanitizePosition(settings.position))
      // At full tint strength the wallpaper keeps only a trace of its hue; at
      // zero it stays untouched (the raw-Acrylic end of the range).
      style.setProperty('--dsh-mica-wall-sat', String(Math.round((45 + 55 * strong100) * (dark ? 0.95 : 1))))
      // The relief exists to compensate for the fill's flatness, so it grows
      // with the tint strength every bit as much as the fill itself does. It is
      // a pure soft-light term, so it can never leak the wallpaper's colour
      // into the surface - it only restores the desktop's light and shade.
      style.setProperty('--dsh-mica-relief', String(round3(0.18 + 0.62 * strong100)))
      // Soft-light's neutral source is mid grey, so the relief's mean is scaled
      // to exactly that: the blend then moves the surface up and down around
      // its own level instead of lifting it (which is what a wallpaper mean of
      // ~0.67 would otherwise do, especially over a dark material). In desktop
      // mode that scale is baked into the relief texture, taken from the whole
      // wallpaper's own mean - the texture IS the whole wallpaper, so the value
      // no longer changes while the window moves.
      var reliefTone = textures !== null && textures !== undefined
        ? textures.tone
        : round3(0.5 / Math.max(0.08, Math.min(0.92, luminance(palette.average))))
      style.setProperty('--dsh-mica-relief-tone', String(reliefTone))
    }

    /** Round to three decimals so repeated renders produce identical values. */
    var round3 = (value) => Math.round(value * 1000) / 1000

    /** Restrict the persisted background position to values CSS accepts. */
    var sanitizePosition = (value) => {
      var allowed = ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right', 'left top', 'right top', 'left bottom', 'right bottom']
      var text = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
      return allowed.indexOf(text) === -1 ? 'center' : text
    }

    /**
     * Assemble the backdrop DOM, bottom layer first: the wallpaper, the Mica
     * tint, the optional veil, the grain, the material's own fill, and the
     * relief that puts the desktop's shape back on top of that fill.
     * @returns the mounted backdrop element.
     */
    var mountBackdrop = () => {
      var backdrop = document.createElement('div')
      backdrop.setAttribute('data-dsh-mica-backdrop', '')
      backdrop.setAttribute('aria-hidden', 'true')
      var wallpaper = document.createElement('div')
      wallpaper.setAttribute('data-dsh-mica-wallpaper', '')
      var tint = document.createElement('div')
      tint.setAttribute('data-dsh-mica-tint', '')
      var veil = document.createElement('div')
      veil.setAttribute('data-dsh-mica-veil', '')
      var grain = document.createElement('div')
      grain.setAttribute('data-dsh-mica-grain', '')
      var fill = document.createElement('div')
      fill.setAttribute('data-dsh-mica-fill', '')
      var relief = document.createElement('div')
      relief.setAttribute('data-dsh-mica-relief', '')
      // Order matters: the grain sits under the fill (it is a shading detail of
      // the material, not a sheet over it) and the relief sits over the fill,
      // where it can still reach the screen.
      backdrop.appendChild(wallpaper)
      backdrop.appendChild(tint)
      backdrop.appendChild(veil)
      backdrop.appendChild(grain)
      backdrop.appendChild(fill)
      backdrop.appendChild(relief)
      document.body.insertBefore(backdrop, document.body.firstChild)
      return backdrop
    }

    /**
     * Tag every top-level shell region as one Mica surface.
     *
     * The title row, the sidebar, the conversation column and the right bar are
     * SIBLINGS inside the app shell, and each of them paints its own background
     * - which is why they used to read as different materials (translate a
     * token, keep an opaque panel, blur a different backdrop). Tagging them all
     * with the same hook gives every region the same fill, so the whole window
     * reads as one material.
     *
     * Two of those nodes get a second hook, because the material is NOT uniform:
     * the frame (the element that owns the columns, whose `::before` paints the
     * Windows title strip) becomes `data-dsh-mica-frame`, and the conversation
     * column becomes `data-dsh-mica-inner`. The stylesheet paints the inner one
     * with an extra plate and gives it DSH's own 16px top-left corner; everything
     * else keeps the thinner outer sheet.
     *
     * The frame is located by CLASS and by a bounded walk, NOT by "the root's
     * first element child": the app wraps the frame in at least one element, and
     * assuming a single level silently tagged that wrapper instead of the columns
     * - the sidebar kept its own 46 % fill and the conversation never got its
     * plate, which is exactly the "inner pane is more transparent than the shell"
     * report.
     *
     * Deliberately only the shell's direct children: panes that already float
     * above others (dialogs, menus, popovers) are styled by the stylesheet
     * instead, so a filter is never nested inside another filter.
     */
    var REGION_LIMIT = 8
    /** How deep the layout search descends below the app root. */
    var LAYOUT_DEPTH = 6
    /** What the last layout search found; the settings row reports a miss. */
    var layoutMarks = { frame: false, inner: false }
    /** Read a class attribute without assuming a real DOM (tests use a shim). */
    var classOf = (node) => {
      var value = typeof node.getAttribute === 'function' ? node.getAttribute('class') : null
      return typeof value === 'string' ? value : ''
    }
    /**
     * Is this pane the conversation column?
     *
     * DSH's frame paints the conversation with `--dsw-alias-bg-base` behind a
     * 16px top-left radius; that pane is the one holding the composer. The class
     * suffix (`_centerCol`) is stable even though the CSS-module hash in front of
     * it changes between builds, and the composer is the fallback for a build
     * that renames the class.
     */
    var isInnerPane = (node) => {
      if (classOf(node).indexOf('_centerCol') !== -1) return true
      if (typeof node.querySelector === 'function') {
        try {
          return node.querySelector('[data-composer-card]') !== null
        } catch (error) {
          return false
        }
      }
      return false
    }
    /** One bounded walk for the frame, the conversation column and the outer panes. */
    var findLayout = (root) => {
      var found = { frame: null, center: null, outer: [] }
      var stack = [{ node: root, depth: 0 }]
      while (stack.length > 0) {
        var entry = stack.pop()
        if (entry.depth >= LAYOUT_DEPTH) continue
        var children = entry.node.children
        if (children === undefined || children === null) continue
        for (var i = 0; i < children.length; i += 1) {
          var child = children[i]
          if (child === null || child === undefined || child.nodeType !== 1) continue
          var name = classOf(child)
          if (name.indexOf('_centerCol') !== -1) {
            if (found.center === null) found.center = child
          } else if (name.indexOf('_sidebarCol') !== -1
            || name.indexOf('_rightbarCol') !== -1
            || name.indexOf('_bottomRow') !== -1) {
            found.outer.push(child)
          }
          stack.push({ node: child, depth: entry.depth + 1 })
        }
      }
      if (found.center !== null && found.center.parentNode !== null
        && found.center.parentNode.nodeType === 1) {
        found.frame = found.center.parentNode
      }
      return found
    }
    var tagGlassPanes = (root) => {
      var tagged = []
      if (root === null || root === undefined) return tagged
      var layout = findLayout(root)
      var frame = layout.frame
      if (frame === null) frame = root.firstElementChild
      if (frame === null || frame === undefined || frame.nodeType !== 1) return tagged
      var mark = (node) => {
        if (node.hasAttribute('data-dsh-mica-glass')) return
        node.setAttribute('data-dsh-mica-glass', '')
        tagged.push(node)
      }
      // Every wrapper between the frame and the app root stops painting its own
      // background: it is the material, not a fill of its own. The frame itself
      // is cleared by the `[data-dsh-mica-frame]` rule.
      for (var wrapper = frame.parentNode; wrapper !== null && wrapper !== root; wrapper = wrapper.parentNode) {
        if (wrapper.nodeType !== 1) break
        if (wrapper.hasAttribute('data-dsh-mica-backdrop')) break
        mark(wrapper)
      }
      frame.setAttribute('data-dsh-mica-frame', '')
      layoutMarks.frame = true
      layoutMarks.inner = layout.center !== null
      var candidates = Array.prototype.slice.call(frame.children, 0, REGION_LIMIT)
      for (var i = 0; i < candidates.length; i += 1) {
        var node = candidates[i]
        if (node === null || node === undefined || node.nodeType !== 1) continue
        if (node.hasAttribute('data-dsh-mica-backdrop')) continue
        if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue
        if (node === layout.center || isInnerPane(node)) node.setAttribute('data-dsh-mica-inner', '')
        mark(node)
      }
      // The outer columns are known by name, wherever the app puts them.
      for (var k = 0; k < layout.outer.length; k += 1) mark(layout.outer[k])
      return tagged
    }

    /**
     * Ask the host for the desktop-wallpaper palette (silent on failure).
     *
     * A failure is not an error - the procedural palette stands in - but the
     * reason is kept on the store so the settings row can say WHICH backdrop
     * the user is looking at ("desktop sample" vs "generated") instead of
     * leaving a fallback indistinguishable from a real sample.
     */
    var probeHostPalette = async (store) => {
      if (typeof window.fetch !== 'function') { store.sampleNote = 'fetch unavailable'; return }
      var controller = typeof AbortController === 'function' ? new AbortController() : null
      var timer = window.setTimeout(() => { if (controller !== null) controller.abort() }, 4000)
      try {
        var response = await window.fetch(PALETTE_URL, {
          signal: controller === null ? undefined : controller.signal,
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        })
        if (!response.ok) { store.sampleNote = 'HTTP ' + response.status; return }
        var payload = await response.json()
        var palette = paletteFromSample(payload)
        if (palette === null) {
          var reason = payload !== null && typeof payload === 'object' && typeof payload.reason === 'string' ? payload.reason : ''
          store.sampleNote = reason !== '' ? reason : 'invalid sample'
          return
        }
        store.sampleNote = null
        store.hostPalette = palette
        // The desktop thumbnail turns "the wallpaper" into "the part of the
        // wallpaper this window covers"; without it the whole-wallpaper palette
        // above stays in force.
        var desktop = decodeDesktop(payload)
        var rawStyle = payload !== null && typeof payload === 'object' ? payload.style : null
        store.desktop = desktop === null
          ? null
          : {
            image: desktop,
            style: rawStyle !== null && typeof rawStyle === 'object' ? rawStyle : null,
            // A new sample invalidates every texture built from the old one.
            token: store.desktopStamp += 1,
          }
        store.regionCache = null
        store.textures = null
      } catch (error) {
        // No host route (file:// desktop shell, non-Windows host, auth):
        // the procedural backdrop stays, which is the intended fallback.
        store.sampleNote = error instanceof Error ? error.message : String(error)
      } finally {
        window.clearTimeout(timer)
      }
    }

    /**
     * Register against the host context.
     * @param ctx - client cordis context.
     */
    function apply(ctx) {
      // The cordis context wins over the captured module table when present, so
      // the plugin still runs under a host whose loader injects exactly this.
      var canvas = ctx

      canvas.effect(() => {
        if (typeof document === 'undefined') return
        var tag = document.createElement('style')
        tag.dataset.plugin = NS
        tag.dataset.pluginCss = NS + '/mica.css'
        tag.textContent = STYLESHEET
        document.head.appendChild(tag)
        return () => { tag.remove() }
      }, 'dsh-mica: stylesheet')

      /**
       * Live layer state. `render` / `teardown` are assigned below; `subscribe`
       * is the observable the settings row renders through.
       */
      var listeners = new Set()
      var notify = () => {
        listeners.forEach((fn) => { try { fn() } catch (error) { /* isolate */ } })
      }
      var store = {
        values: loadSettings(),
        /** Host-sampled palette, or null while only the procedural one exists. */
        hostPalette: null,
        /** The desktop thumbnail + wallpaper placement, when the host sent both. */
        desktop: null,
        /** Memoised palette for the last window region (see `currentPalette`). */
        regionCache: null,
        /** Why the desktop sample is unavailable, or null once one was read. */
        sampleNote: null,
        /** Set when the two-zone layout could not be recognised. */
        layoutNote: null,
        /** The last palette actually painted (read by the row's swatch). */
        activePalette: null,
        /** Built desktop textures, memoised on everything they depend on. */
        textures: null,
        /** Memoised tint luminance reference (see `ensureTintReference`). */
        tintRef: null,
        /** Bumped when a new desktop sample arrives, to invalidate the textures. */
        desktopStamp: 0,
        /** The wallpaper texture in force, for the row's swatch. */
        activeTexture: null,
        subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
        set: (key, value) => {
          store.values = normalizeSettings(Object.assign({}, store.values, { [key]: value }))
          writeRaw('settings', JSON.stringify(store.values))
          store.render()
          notify()
        },
        render: () => {},
        /** Repaint only the material (palette-derived properties), no re-tagging. */
        renderMaterial: () => {},
        teardown: () => {},
      }

      var disposed = false
      var backdrop = null
      var glassPanes = []
      var tokenDisposer = null

      /**
       * The palette currently in force.
       *
       * With "follow the window" on and a desktop thumbnail in hand, this is the
       * crop of the wallpaper sitting under the window - so the material shows
       * the same part of the desktop Windows' Mica would. Otherwise it is the
       * whole-wallpaper palette (or the procedural one).
       */
      var currentPalette = () => {
        if (store.desktop !== null && store.values.followWindow && store.values.wallpaper === '') {
          var geom = viewGeometry()
          var layout = wallpaperLayout(store.desktop.style, geom.mon, store.desktop.image)
          var region = regionFor(geom, layout, store.desktop.image)
          var key = regionKey(region)
          if (store.regionCache !== null && store.regionCache.key === key) return store.regionCache.palette
          var wallpaper = store.hostPalette !== null ? store.hostPalette.wallpaper : ''
          store.regionCache = { key: key, palette: paletteFromRegion(store.desktop.image, region, wallpaper) }
          return store.regionCache.palette
        }
        return store.hostPalette !== null ? store.hostPalette : proceduralForPage()
      }

      /**
       * The desktop textures currently in force, or null when the material is
       * not built from the desktop (no sample, "whole wallpaper", or a custom
       * image).
       *
       * Rebuilding costs a blur, two PNG encodes and a base64 of both, so it
       * happens ONLY when something it depends on changes: the sampled
       * wallpaper, the monitor geometry, the tint strength, the blur slider or
       * the theme. A window move cannot change any of those - which is the
       * whole reason the material can follow the window for free.
       */
      var ensureDesktopTextures = (dark) => {
        if (store.desktop === null) return null
        if (!store.values.followWindow || store.values.wallpaper !== '') return null
        var geom = viewGeometry()
        var layout = wallpaperLayout(store.desktop.style, geom.mon, store.desktop.image)
        var strength = clamp(store.values.tintStrength, 0, 100, 100) / 100
        var sat = ((45 + 55 * strength) * (dark ? 0.95 : 1)) / 100
        // The blur slider is in screen pixels; the texture is in wallpaper
        // texels, so the two are converted through the wallpaper's scale.
        var blurPx = Math.max(4, store.values.blur * 5)
        var key = [
          store.desktop.token, store.values.blur, store.values.tintStrength, dark ? 1 : 0,
          geom.w, geom.h,
          geom.mon.x, geom.mon.y, geom.mon.w, geom.mon.h,
          layout.mode, round3(layout.sx), round3(layout.ox), round3(layout.oy),
        ].join('|')
        if (store.textures !== null && store.textures.key === key) return store.textures
        var built = desktopTextures(store.desktop.image, layout, { sat: sat, blurPx: blurPx })
        built.key = key
        built.frame = frameRect(geom, layout, store.desktop.image)
        store.textures = built
        return built
      }

      /**
       * The tint's pinned luminance, memoised separately from the textures: it
       * depends on the window's HEIGHT (a vertical move re-anchors it) but not on
       * its width or horizontal position, so a horizontal drag never recomputes
       * it and a vertical one does not rebuild the textures.
       */
      var ensureTintReference = (image, layout, geom) => {
        var key = [
          store.desktop.token, geom.w, geom.h, Math.round(geom.y - geom.mon.y),
          layout.mode, round3(layout.sx),
        ].join('|')
        if (store.tintRef !== null && store.tintRef.key === key) return store.tintRef.value
        var value = tintReference(image, layout, geom)
        store.tintRef = { key: key, value: value }
        return value
      }

      /**
       * The luminance the tint is pinned to.
       *
       * The tint is a FLAT colour sampled from the crop, so at mid/low strength
       * the whole surface takes on the local wallpaper's brightness: moving an
       * 800 px window across a 2560 px desktop changed the material's mean
       * luminance by 16 levels at 55 % tint (measured), which reads as the whole
       * window changing exposure. Pinning the tint's LUMINANCE keeps the sampled
       * hue - the material still warms and cools with the wallpaper - while its
       * brightness stops depending on where the window is horizontally.
       *
       * The reference is the average over the FULL WIDTH at the window's own
       * height: that is what keeps the material's overall level where it already
       * was (the whole-image tint would have brightened it by 22 levels, and a
       * window sitting over a dark band would have been dragged up to the
       * desktop's average). The wallpaper's rows are much more alike than its
       * columns, so a vertical move still changes the level by only a few
       * levels.
       */
      var tintReference = (image, layout, geom) => {
        var cols = 7
        var roomX = Math.max(0, geom.mon.w - geom.w)
        var y = Math.min(geom.mon.y + Math.max(0, geom.mon.h - geom.h), Math.max(geom.mon.y, geom.y))
        var total = 0
        for (var col = 0; col < cols; col += 1) {
          var probe = {
            dpr: geom.dpr,
            x: geom.mon.x + (cols === 1 ? 0 : (col / (cols - 1)) * roomX),
            y: y,
            w: geom.w,
            h: geom.h,
            mon: geom.mon,
          }
          var stops = stopsFromGrid(regionCells(image, regionFor(probe, layout, image)))
          total += luminance(stops[2]) * 255
        }
        return total / cols
      }

      /** Resolve the active colour scheme from the theme service. */
      var scheme = () => {
        try {
          var snapshot = canvas.theme.getTheme()
          return snapshot !== null && snapshot !== undefined && snapshot.active !== null
            && snapshot.active !== undefined && snapshot.active.colorScheme === 'dark'
        } catch (error) {
          return document.body !== null && document.body.hasAttribute('data-ds-dark-theme')
        }
      }

      /** Paint the whole layer (idempotent). */
      store.render = () => {
        if (disposed) return
        var values = store.values
        var root = document.documentElement
        if (!values.enabled) {
          store.teardown()
          return
        }
        var dark = scheme()
        var palette = currentPalette()
        store.activePalette = palette
        var textures = ensureDesktopTextures(dark)
        store.activeTexture = textures === null ? null : textures.wall
        var tintLuma = 0
        if (textures !== null) {
          var geom = viewGeometry()
          var layout = wallpaperLayout(store.desktop.style, geom.mon, store.desktop.image)
          tintLuma = ensureTintReference(store.desktop.image, layout, geom)
        }
        root.setAttribute(ROOT_ATTR, values.mode)
        if (backdrop === null || !backdrop.isConnected) backdrop = mountBackdrop()
        applySettings(values, palette, dark, textures, tintLuma)
        // Newly discovered panes ADD to the tagged set: re-tagging skips the
        // panes already carrying the hook, so replacing the list here would
        // lose the only references teardown needs to remove them again.
        var discovered = tagGlassPanes(document.getElementById('root') || document.body)
        for (var g = 0; g < discovered.length; g += 1) glassPanes.push(discovered[g])
        // Surface a layout the search could not recognise, instead of silently
        // painting one flat sheet (that is what made the conversation read like
        // Acrylic while the sidebar kept its own fill).
        store.layoutNote = layoutMarks.inner ? null : 'zones'
        if (tokenDisposer !== null) { tokenDisposer(); tokenDisposer = null }
        try {
          tokenDisposer = canvas.theme.overrideTokens(OVERRIDE_SOURCE, scaledTokens(values.tintStrength))
        } catch (error) {
          // A host without the override stack still gets the structural layer.
          tokenDisposer = null
        }
      }

      /**
       * Repaint just the material. Used by the window follower: it must not
       * re-tag panes or re-register the token layer while a drag is in flight.
       * In desktop mode this is the 4 Hz colour-cast refresh; the motion itself
       * is two CSS variables written per frame, not a repaint.
       */
      store.renderMaterial = () => {
        if (disposed || !store.values.enabled) return
        var palette = currentPalette()
        store.activePalette = palette
        var dark = scheme()
        var textures = ensureDesktopTextures(dark)
        store.activeTexture = textures === null ? null : textures.wall
        var tintLuma = 0
        if (textures !== null) {
          var geom = viewGeometry()
          var layout = wallpaperLayout(store.desktop.style, geom.mon, store.desktop.image)
          tintLuma = ensureTintReference(store.desktop.image, layout, geom)
        }
        applySettings(store.values, palette, dark, textures, tintLuma)
      }

      /** Remove every owned effect. */
      store.teardown = () => {
        var root = document.documentElement
        root.removeAttribute(ROOT_ATTR)
        root.removeAttribute(SOURCE_ATTR)
        if (backdrop !== null) { backdrop.remove(); backdrop = null }
        store.textures = null
        store.activeTexture = null
        for (var i = 0; i < glassPanes.length; i += 1) {
          if (glassPanes[i].isConnected) glassPanes[i].removeAttribute('data-dsh-mica-glass')
        }
        glassPanes = []
        // The two-zone hooks are attributes on DSH's own layout nodes, so they
        // are not covered by the pane list (the frame is not a pane).
        var marks = typeof document.querySelectorAll === 'function'
          ? document.querySelectorAll('[data-dsh-mica-frame], [data-dsh-mica-inner]')
          : []
        for (var m = 0; m < marks.length; m += 1) {
          marks[m].removeAttribute('data-dsh-mica-frame')
          marks[m].removeAttribute('data-dsh-mica-inner')
        }
        if (tokenDisposer !== null) { tokenDisposer(); tokenDisposer = null }
        var keys = [
          '--dsh-mica-image', '--dsh-mica-tint', '--dsh-mica-veil-strong', '--dsh-mica-veil-soft',
          '--dsh-mica-material-fill', '--dsh-mica-inner-fill', '--dsh-mica-edge',
          '--dsh-mica-solid-fill', '--dsh-mica-dialog-fill', '--dsh-mica-noise', '--dsh-mica-blur',
          '--dsh-mica-bleed', '--dsh-mica-region-blur', '--dsh-mica-panel-blur',
          '--dsh-mica-position', '--dsh-mica-wall-sat', '--dsh-mica-size', '--dsh-mica-relief',
          '--dsh-mica-relief-tone',
          '--dsh-mica-desktop', '--dsh-mica-desktop-relief',
          '--dsh-mica-frame-x', '--dsh-mica-frame-y', '--dsh-mica-frame-w', '--dsh-mica-frame-h',
          '--dsh-mica-shift-x', '--dsh-mica-shift-y',
        ]
        for (var k = 0; k < keys.length; k += 1) root.style.removeProperty(keys[k])
      }

      // The palette source. A granted host sample replaces the procedural one.
      store.render()

      // Re-render on the theme switch (light/dark palette + saturation).
      canvas.effect(() => canvas.on('theme/change', () => { store.render() }), 'dsh-mica: theme follow')

      // Cross-tab settings sync.
      canvas.effect(() => {
        var onStorage = (event) => {
          if (event.key !== null && event.key !== LS + 'settings') return
          store.values = loadSettings()
          store.render()
          notify()
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      }, 'dsh-mica: storage sync')

      // The host palette probe (once per page).
      canvas.effect(() => {
        store.hostPalette = null
        store.desktop = null
        store.regionCache = null
        store.textures = null
        store.activeTexture = null
        store.sampleNote = null
        void probeHostPalette(store).then(() => {
          if (disposed) return
          // Repaint and re-notify either way: a failed probe changes what the
          // settings row has to say about the backdrop, even though the
          // procedural palette it already painted stays in force.
          store.render()
          notify()
        })
      }, 'dsh-mica: host palette probe')

      // Window follower.
      //
      // Windows' Mica shows the wallpaper BEHIND the window, so dragging the
      // window slides the material across the desktop. A browser fires no event
      // for a window move (only `resize`), so the position is polled - but only
      // to NOTICE the move. Following is done on the display's own frame clock:
      // the loop below writes two transform values per frame, which the
      // compositor turns into motion without repainting the wallpaper at all.
      //
      // That difference is the whole fix for the drag flicker. The previous
      // version repainted on a 120 ms timer, so at a normal drag speed the
      // material jumped ~90 px every step - a 3-5 dE colour step eight times a
      // second. At 60 Hz the same wallpaper moves 13 px per frame, which reads
      // as sliding.
      canvas.effect(() => {
        var handle = 0
        var lastKey = ''
        var lastMove = 0
        var lastPalette = 0
        var pending = false
        var raf = typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : null
        var cancel = typeof window.cancelAnimationFrame === 'function'
          ? window.cancelAnimationFrame.bind(window)
          : null
        // A host without animation frames still gets a follower, just a coarse
        // one; the alternative is not following at all.
        var schedule = raf !== null ? raf : (fn) => window.setTimeout(fn, 16)
        // Wall-clock rather than frame time: a hidden tab delivers no frames,
        // and the settle step must still fire when the window comes back.
        var clock = () => Date.now()

        var active = () => !disposed && store.values.enabled
          && store.desktop !== null && store.values.followWindow && store.values.wallpaper === ''

        var keyOf = (geom) => [geom.x, geom.y, geom.w, geom.h, geom.dpr].join(',')

        /** The cheap half of the paint: two transforms, nothing else. */
        var moveTo = (geom) => {
          var style = document.documentElement.style
          style.setProperty('--dsh-mica-shift-x', (-geom.x) + 'px')
          style.setProperty('--dsh-mica-shift-y', (-geom.y) + 'px')
        }

        var stop = () => {
          if (handle !== 0 && cancel !== null) cancel(handle)
          handle = 0
        }

        var frame = () => {
          handle = 0
          if (!active()) return
          var geom = viewGeometry()
          var key = keyOf(geom)
          var now = clock()
          if (key !== lastKey) {
            lastKey = key
            lastMove = now
            pending = true
            moveTo(geom)
            // The colour cast only needs a few updates a second: its own steps
            // are ~1 dE, an order of magnitude below the steps a repaint timer
            // used to put on screen.
            if (now - lastPalette >= PALETTE_MS) {
              lastPalette = now
              store.renderMaterial()
            }
          } else if (pending && now - lastMove >= SETTLE_MS) {
            pending = false
            store.renderMaterial()
            notify()
          }
          if (now - lastMove < IDLE_MS) handle = schedule(frame)
        }

        // The waker. Cheap enough to run forever, and deliberately idle while
        // the loop is already running.
        var wake = () => {
          if (!active()) { stop(); lastKey = ''; pending = false; return }
          if (handle !== 0) return
          if (keyOf(viewGeometry()) === lastKey) return
          handle = schedule(frame)
        }

        var onResize = () => { lastKey = ''; wake() }
        window.addEventListener('resize', onResize)
        var timer = window.setInterval(wake, POLL_MS)
        wake()
        return () => {
          window.removeEventListener('resize', onResize)
          window.clearInterval(timer)
          stop()
        }
      }, 'dsh-mica: follow the window')

      // Settings row.
      var locale = canvas.get('locale')
      var translate = null
      if (locale !== null && locale !== undefined && typeof locale.register === 'function') {
        try {
          canvas.effect(() => locale.register(NS, {
            zh: {
              title: '云母材质',
              subtitle: 'Windows 11 Mica：壁纸采样背景、云母着色与磨砂面板',
              enable: '启用云母材质',
              mode: '材质',
              mica: '云母',
              micaAlt: '云母 Alt',
              tint: '着色强度',
              blur: '模糊',
              noise: '噪点',
              sampling: '采样',
              follow: '跟随窗口',
              whole: '铺满整张',
              wallpaper: '背景来源',
              auto: '跟随桌面',
              generated: '本地生成',
              noSample: '桌面采样不可用',
              noZones: '分区未生效',
              image: '自定义图片',
              clear: '恢复默认',
              used: '背景取自',
            },
            en: {
              title: 'Mica material',
              subtitle: 'Windows 11 Mica: sampled wallpaper backdrop, tint and frosted panels',
              enable: 'Enable Mica material',
              mode: 'Material',
              mica: 'Mica',
              micaAlt: 'Mica Alt',
              tint: 'Tint strength',
              blur: 'Blur',
              noise: 'Noise',
              sampling: 'Sampling',
              follow: 'Follow window',
              whole: 'Whole wallpaper',
              wallpaper: 'Backdrop',
              auto: 'Desktop sample',
              generated: 'Generated',
              noSample: 'desktop sample unavailable',
              noZones: 'zones not recognised',
              image: 'Custom image',
              clear: 'Reset',
              used: 'Backdrop from',
            },
          }), 'dsh-mica: dictionaries')
          translate = locale.bind(NS)
        } catch (error) {
          translate = null
        }
      }
      var t = (key, fallback) => {
        if (translate === null) return fallback
        try {
          var text = translate(key)
          return text === undefined || text === null || text === '' || text === key ? fallback : text
        } catch (error) {
          return fallback
        }
      }

      // The row's private injection face: its store and its translator, per the
      // slot contract ("copy, current value, and the write path are all yours,
      // through your own inject face").
      canvas.effect(() => canvas.slots.inject('settings.general.item', () => canvas.slots.register({
        name: 'settings.general.item',
        id: 'mica',
        order: 18,
        inject: () => ({ store, t }),
      }, MicaRow)), 'dsh-mica: settings row')

      // Final teardown when the fiber is disposed.
      canvas.effect(() => () => {
        disposed = true
        store.teardown()
        listeners.clear()
      }, 'dsh-mica: layer lifetime')
    }

    //#region settings row component
    /**
     * The General-section preference row. The slot supplies no props and no
     * label, so the row owns its copy, its value and its write path.
     */
    var MicaRow = (props) => {
      // A host that does not hand the registration inject face down to the
      // component leaves the row without its store; render nothing rather than
      // throwing inside the settings dialog.
      if (props === null || props === undefined || props.store === undefined) return null
      var store = props.store
      var t = props.t
      var createElement = React.createElement
      // Subscribe through the idiomatic external-store hook when the platform
      // React exposes it (it does on React 18); the manual effect is the
      // fallback for an older runtime.
      var values
      if (typeof React.useSyncExternalStore === 'function') {
        values = React.useSyncExternalStore(store.subscribe, () => store.values)
      } else {
        var state = React.useState(0)
        var bump = state[1]
        React.useEffect(() => store.subscribe(() => bump((value) => value + 1)), [])
        values = store.values
      }

      var onToggle = () => store.set('enabled', !values.enabled)
      var header = createElement('div', { className: 'dsh-mica-row-head' },
        createElement('div', { className: 'dsh-mica-row-title' },
          t('title', '云母材质'),
          createElement('div', { className: 'dsh-mica-row-sub' }, t('subtitle', 'Windows 11 Mica：壁纸采样背景、云母着色与磨砂面板')),
        ),
        createElement('button', {
          type: 'button',
          className: 'dsh-mica-switch',
          'data-on': String(values.enabled),
          role: 'switch',
          'aria-checked': values.enabled,
          'aria-label': t('enable', '启用云母材质'),
          onClick: onToggle,
        }, createElement('span', { className: 'dsh-mica-knob' })),
      )

      if (!values.enabled) return createElement('div', { className: 'dsh-mica-row' }, header)

      var chip = (label, active, onClick) => createElement('button', {
        type: 'button',
        className: 'dsh-mica-chip',
        'data-active': String(active),
        'aria-pressed': active,
        onClick,
      }, label)

      var slider = (label, value, min, max, suffix, onChange) => createElement('div', { className: 'dsh-mica-control' },
        createElement('div', { className: 'dsh-mica-control-head' },
          createElement('span', null, label),
          createElement('span', { className: 'dsh-mica-value' }, value + suffix),
        ),
        createElement('input', {
          className: 'dsh-mica-range',
          type: 'range',
          min,
          max,
          step: 1,
          value,
          'aria-label': label,
          onChange: (event) => onChange(Number(event.target.value)),
        }),
      )

      var palette = store.activePalette
      var fromDesktop = palette !== null && palette.source === 'host'
      var sourceLabel = values.wallpaper !== ''
        ? t('image', '自定义图片')
        : (fromDesktop ? t('auto', '跟随桌面') : t('generated', '本地生成'))
      var detail = ''
      if (values.wallpaper === '') {
        if (fromDesktop && palette.wallpaper !== '') detail = ' · ' + palette.wallpaper.split('\\').pop()
        else if (!fromDesktop && store.sampleNote !== null) detail = ' · ' + t('noSample', '桌面采样不可用')
      }
      // A layout the two-zone search could not recognise paints one flat sheet;
      // say so here instead of leaving the user with an unexplained Acrylic look.
      if (store.layoutNote !== null) detail += ' · ' + t('noZones', '分区未生效')
      // The swatch shows the material's own backdrop: the desktop texture when
      // the material follows the window, otherwise the generated tile.
      var swatchImage = values.wallpaper !== ''
        ? values.wallpaper
        : (store.activeTexture !== null && store.activeTexture !== undefined
          ? store.activeTexture
          : (palette !== null ? tileFor(palette) : ''))
      var swatch = createElement('span', {
        className: 'dsh-mica-swatch',
        title: store.sampleNote === null ? undefined : store.sampleNote,
        style: {
          backgroundImage: swatchImage === '' ? '' : 'url("' + swatchImage + '")',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        },
      })

      var body = createElement('div', { className: 'dsh-mica-body' },
        createElement('div', { className: 'dsh-mica-chips' },
          chip(t('mica', '云母'), values.mode === 'mica', () => store.set('mode', 'mica')),
          chip(t('micaAlt', '云母 Alt'), values.mode === 'micaAlt', () => store.set('mode', 'micaAlt')),
          createElement('span', { className: 'dsh-mica-chips-label' }, t('sampling', '采样')),
          chip(t('follow', '跟随窗口'), values.followWindow, () => store.set('followWindow', true)),
          chip(t('whole', '铺满整张'), !values.followWindow, () => store.set('followWindow', false)),
        ),
        createElement('div', { className: 'dsh-mica-controls' },
          slider(t('tint', '着色强度'), values.tintStrength, 0, 100, '%', (value) => store.set('tintStrength', value)),
          slider(t('blur', '模糊'), values.blur, 0, 60, 'px', (value) => store.set('blur', value)),
          slider(t('noise', '噪点'), values.noise, 0, 100, '%', (value) => store.set('noise', value)),
        ),
        createElement('div', { className: 'dsh-mica-used' },
          swatch,
          createElement('span', null, t('used', '背景取自') + ': ' + sourceLabel + detail),
          values.wallpaper !== ''
            ? chip(t('clear', '恢复默认'), false, () => store.set('wallpaper', ''))
            : null,
        ),
      )

      return createElement('div', { className: 'dsh-mica-row' }, header, body)
    }
    //#endregion

    return { name, inject, apply }
  },
})
