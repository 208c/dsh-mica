/**
 * Visual preview: write the Mica stylesheet over a mock of the DSH shell to a
 * pair of standalone HTML files (light + dark), plus the sampling diagnostic.
 *
 * The backdrop is built from a 14x14 sample of the Windows 11 default wallpaper
 * (the same 196 cells the host half reads off the desktop), so a preview
 * exercises the whole shipped pipeline: raw 14x14 sample -> 7x7 palette grid ->
 * backdrop tile -> material. Nothing here re-implements a shortcut version of it.
 *
 * Screenshot them with any Chromium (the shipped layer is what renders, not a
 * hand-copy of it):
 *   msedge --headless=new --disable-gpu --screenshot=out.png --window-size=1280,800 file:///.../preview-light-100.html
 *
 *   <node> dsh-mica/scripts/preview.mjs [outDir]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT_DIR = process.argv[2] ?? path.join(ROOT, 'preview')

/** The two compile-time values the bundle's stylesheet array closes over. */
const ROOT_ATTR = 'data-dsh-mica'
const NOISE_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'>"
  + "<rect width='2' height='2' fill='rgb(128,128,128)'/>"
  + "<rect width='1' height='1' fill='rgb(255,255,255)'/>"
  + "<rect x='1' y='1' width='1' height='1' fill='rgb(255,255,255)'/>"
  + '</svg>',
)

/** Extract the real injected stylesheet out of the hand-authored bundle. */
function stylesheetFromBundle() {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const match = /var STYLESHEET = \[([\s\S]*?)\]\.join\('\\n'\)/.exec(source)
  if (match === null) throw new Error('STYLESHEET array not found in lib/client.js')
  // eslint-disable-next-line no-new-func
  const parts = new Function('ROOT_ATTR', 'NOISE_URL', 'return [' + match[1] + ']')(ROOT_ATTR, NOISE_URL)
  return parts.join('\n')
}

// The sampling constants, mirrored from lib/client.js.
const GRID = 14
const COLS = 7
const ROWS = 7
const TILE_W = 240
const TILE_H = 150 // 240 x (800 / 1280): the screenshot viewport's aspect ratio

/**
 * A sample of the Windows 11 default wallpaper (Bloom, `C:\Windows\Web\
 * Wallpaper\Windows\img0.jpg`): the 196 cells the host half reads off it,
 * row-major, one RGB triplet per cell, as base64. The flower is deep blue in
 * the centre and the sky pale at the edges, so the sample varies on both axes -
 * which is exactly what a one-dimensional palette destroys. Using the shipped
 * wallpaper instead of the developer's own desktop keeps the previews
 * reproducible and free of personal content.
 */
const SAMPLE_WALLPAPER = 'C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg'
const SAMPLE_B64 = 'hq7JibHMjrTOlbnTm73WoMHZocPaoMLZm77WlbrTjrTOibHMhK3JgavIibDLjrPOlLjSm77Wo8PaqMjdqsnfk8LjgrbjlrvYlLjSjbPOiK/LhKzJjrLMk7bRmrzVo8ParMnfsc7jj8XrPqX6Joz6X53mmLvVkrbRjLLNiK7KkbXPl7nToMDYqsfdrc3lkMfuSbL7LKH+HIT6KnntjrPYl7nTkLTPjLHLlrfRnLzVpsPao8fkWKT0Npz8IIj9Dmb5EF3oGVzagafXnLzVlLfRkLPNmbnSob/XpsXeXqzzJIf6KI37G3T6FV/sDkzSFkOxhaXRoL/XmLnSkrTQnbvUpcHYmMHkOp37Oan9In32C0XfDkvcDU3KHz2WmLPSpMHYnLvUlrbQoLzUqMPagrbnOqf5I4r6DU3cE1LcEVPVCTGbHDaCV3u4krLUn7zVmbjSo7/Xq8XcarDuJJX7EWPpCTW9E1HXDTijCCF1BhxjBid9P2y5nbrUnLnSpsDXrsbdgLnrFXbtCj23EDy2FEOyCR9qBxlbCyl0Ci18HEulkrDTnrvTp8DYqcbfQ5z0A1PeDFXME1XPE0y/BhZTCSFpCDmfBzaLIEeXlbHSobzUqcHYpsTgM5H2BFLZFWzfEmXpEVXXCjGKCzORDFTGDD2SSWmlo73WorzUqsLZscfed6vqEFrZCUC7ClLYDk7UCzmgCTKUBzqnJkOEmLDNqcHYo73Uq8LZssfdsMfjQnLRCTmrBlDRDEK/CCV6CDGbBiBgX3GRr8bcqcDZpb7U'

/** Decode the embedded sample into `[r,g,b]` triples. */
function sampleColors() {
  const bytes = Buffer.from(SAMPLE_B64, 'base64')
  const colors = []
  for (let i = 0; i < GRID * GRID; i += 1) {
    colors.push([bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2]])
  }
  return colors
}

//#region codec (a copy of make-icon.mjs's writer, so previews render the same tiles)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xFFFFFFFF
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, payload) {
  const out = new Uint8Array(12 + payload.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, payload.length)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(payload, 8)
  view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)))
  return out
}

function zlib(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const deflated = new Uint8Array(raw.length + blocks * 5)
  let at = 0
  let offset = 0
  for (let i = 0; i < blocks; i += 1) {
    const size = Math.min(65535, raw.length - offset)
    deflated[at] = i === blocks - 1 ? 1 : 0
    deflated[at + 1] = size & 0xFF
    deflated[at + 2] = (size >>> 8) & 0xFF
    deflated[at + 3] = ~size & 0xFF
    deflated[at + 4] = (~size >>> 8) & 0xFF
    at += 5
    deflated.set(raw.subarray(offset, offset + size), at)
    at += size
    offset += size
  }
  const out = new Uint8Array(deflated.length + 6)
  out[0] = 0x78
  out[1] = 0x9C
  out.set(deflated, 2)
  let s1 = 1
  let s2 = 0
  for (const byte of raw) {
    s1 = (s1 + byte) % 65521
    s2 = (s2 + s1) % 65521
  }
  new DataView(out.buffer).setUint32(out.length - 4, ((s2 << 16) | s1) >>> 0)
  return out
}

function encodePng(width, height, pixels) {
  const stride = width * 3
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 2
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  return Buffer.concat(parts.map((p) => Buffer.from(p)))
}

/** `data:image/png` URL for an RGB pixel buffer. */
function dataUrl(width, height, pixels) {
  return 'data:image/png;base64,' + encodePng(width, height, pixels).toString('base64')
}
//#endregion

//#region the bundle's sampling pipeline, mirrored exactly
const byte = (value) => Math.min(255, Math.max(0, Math.round(value)))
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** 14x14 sample -> 7x7 palette grid (2x2 box average, both axes kept). */
function gridFromSample(colors) {
  const cells = []
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const sum = [0, 0, 0]
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const cell = colors[(row * 2 + dy) * GRID + (col * 2 + dx)]
          sum[0] += cell[0]
          sum[1] += cell[1]
          sum[2] += cell[2]
        }
      }
      cells.push([sum[0] / 4, sum[1] / 4, sum[2] / 4])
    }
  }
  return cells
}

/** Row averages of the palette grid, compressed to the five tint stops. */
function stopsFromGrid(cells) {
  const rows = []
  for (let y = 0; y < ROWS; y += 1) {
    const sum = [0, 0, 0]
    for (let x = 0; x < COLS; x += 1) {
      sum[0] += cells[y * COLS + x][0]
      sum[1] += cells[y * COLS + x][1]
      sum[2] += cells[y * COLS + x][2]
    }
    rows.push([sum[0] / COLS, sum[1] / COLS, sum[2] / COLS])
  }
  return [0, 1.5, 3, 4.5, ROWS - 1].map((at) => {
    const i = Math.min(ROWS - 2, Math.floor(at))
    return mix(rows[i], rows[i + 1], at - i)
  })
}

function averageOfGrid(cells) {
  const sum = [0, 0, 0]
  for (const cell of cells) {
    sum[0] += cell[0]
    sum[1] += cell[1]
    sum[2] += cell[2]
  }
  return [sum[0] / cells.length, sum[1] / cells.length, sum[2] / cells.length]
}

/** Bilinear sample of the palette grid at fractional grid coordinates. */
function sampleGrid(cells, fx, fy) {
  const x0 = Math.max(0, Math.min(COLS - 1, Math.floor(fx)))
  const y0 = Math.max(0, Math.min(ROWS - 1, Math.floor(fy)))
  const x1 = Math.min(COLS - 1, x0 + 1)
  const y1 = Math.min(ROWS - 1, y0 + 1)
  const top = mix(cells[y0 * COLS + x0], cells[y0 * COLS + x1], fx - x0)
  const bottom = mix(cells[y1 * COLS + x0], cells[y1 * COLS + x1], fx - x0)
  return mix(top, bottom, fy - y0)
}

/** The backdrop tile: the palette grid sampled bilinearly on both axes. */
function renderTile(cells, width, height) {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    const fy = Math.max(0, ((y + 0.5) / height) * ROWS - 0.5)
    for (let x = 0; x < width; x += 1) {
      const fx = Math.max(0, ((x + 0.5) / width) * COLS - 0.5)
      const color = sampleGrid(cells, fx, fy)
      const at = (y * width + x) * 3
      pixels[at] = byte(color[0])
      pixels[at + 1] = byte(color[1])
      pixels[at + 2] = byte(color[2])
    }
  }
  return pixels
}

/** Nearest-neighbour view of a grid, so the samples stay countable cells. */
function gridImage(cells, cols, rows, scale) {
  const pixels = Buffer.alloc(cols * scale * rows * scale * 3)
  for (let y = 0; y < rows * scale; y += 1) {
    for (let x = 0; x < cols * scale; x += 1) {
      const cell = cells[Math.floor(y / scale) * cols + Math.floor(x / scale)]
      const at = (y * cols * scale + x) * 3
      pixels[at] = byte(cell[0])
      pixels[at + 1] = byte(cell[1])
      pixels[at + 2] = byte(cell[2])
    }
  }
  return dataUrl(cols * scale, rows * scale, pixels)
}
//#endregion

const SAMPLE = sampleColors()
const CELLS = gridFromSample(SAMPLE)
const AVERAGE = averageOfGrid(CELLS)

//#region window-relative sampling (mirror of lib/client.js)
/** The desktop the mock pretends the window sits on. */
// The preview viewport IS the desktop here: the main pages represent a window
// that covers the whole screen, and the "window" pages the same window parked in
// its bottom-right quarter. The real desktop is 2560x1440; a preview at that size
// would have to be scaled down to be readable, and the material's blur is a
// screen-space radius, so an honest 1:1 preview needs a 1:1 desktop.
const MONITOR = { w: 1280, h: 800 }
/** Every preview page represents a window of this size, at `windowRect`. */
const FULL_MONITOR = { x: 0, y: 0, w: MONITOR.w, h: MONITOR.h }

/**
 * A desktop-shaped thumbnail of the wallpaper, exactly like the host's: the
 * 7x7 palette bilinearly upsampled to 128x72. The real host sends the wallpaper
 * itself; the preview only has the sampled grid, so this is its stand-in.
 */
function desktopImage(width = 128) {
  const height = Math.round((width * MONITOR.h) / MONITOR.w)
  const rgb = Buffer.alloc(width * height * 3)
  const sample = (fx, fy) => sampleGrid(CELLS, fx, fy)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width
      const v = (y + 0.5) / height
      const color = sample(Math.max(0, u * COLS - 0.5), Math.max(0, v * ROWS - 0.5))
      const at = (y * width + x) * 3
      rgb[at] = byte(color[0])
      rgb[at + 1] = byte(color[1])
      rgb[at + 2] = byte(color[2])
    }
  }
  return { w: width, h: height, rgb }
}

const DESKTOP = desktopImage()

/** The window's rect in image-normalised coordinates, for a Fill wallpaper. */
function fillRegion(rect, image = DESKTOP) {
  const cover = Math.max(MONITOR.w / image.w, MONITOR.h / image.h)
  const ox = (MONITOR.w - image.w * cover) / 2
  const oy = (MONITOR.h - image.h * cover) / 2
  const u = (px) => (px - ox) / (image.w * cover)
  const v = (py) => (py - oy) / (image.h * cover)
  // The sample rect stays window-sized and inside the monitor, exactly like
  // `regionFor` in lib/client.js: a window hanging over the screen edge samples
  // the nearest area that exists instead of repeating the wallpaper's edge.
  const span = (value, size, limit) => {
    const room = limit - size
    return room > 0 ? Math.min(room, Math.max(0, value)) : 0
  }
  const x0 = span(rect.x, rect.w, MONITOR.w)
  const y0 = span(rect.y, rect.h, MONITOR.h)
  return { u0: u(x0), v0: v(y0), u1: u(x0 + rect.w), v1: v(y0 + rect.h) }
}

/** Bilinear sample of the desktop thumbnail (mirror of `sampleImage`). */
function sampleDesktop(image, u, v) {
  const clampedU = Math.min(1, Math.max(0, u))
  const clampedV = Math.min(1, Math.max(0, v))
  const fx = clampedU * image.w - 0.5
  const fy = clampedV * image.h - 0.5
  const x0 = Math.max(0, Math.min(image.w - 1, Math.floor(fx)))
  const y0 = Math.max(0, Math.min(image.h - 1, Math.floor(fy)))
  const x1 = Math.min(image.w - 1, x0 + 1)
  const y1 = Math.min(image.h - 1, y0 + 1)
  const tx = Math.min(1, Math.max(0, fx - x0))
  const ty = Math.min(1, Math.max(0, fy - y0))
  const at = (x, y) => (y * image.w + x) * 3
  const top = [0, 1, 2].map((c) => image.rgb[at(x0, y0) + c] + (image.rgb[at(x1, y0) + c] - image.rgb[at(x0, y0) + c]) * tx)
  const bottom = [0, 1, 2].map((c) => image.rgb[at(x0, y1) + c] + (image.rgb[at(x1, y1) + c] - image.rgb[at(x0, y1) + c]) * tx)
  return [0, 1, 2].map((c) => top[c] + (bottom[c] - top[c]) * ty)
}

/** The 7x7 palette for one window rect (mirror of `regionCells`). */
function regionCells(rect) {
  const region = fillRegion(rect)
  const du = region.u1 - region.u0
  const dv = region.v1 - region.v0
  const cells = []
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const sum = [0, 0, 0]
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const u = region.u0 + ((col + 0.25 + dx * 0.5) / COLS) * du
          const v = region.v0 + ((row + 0.25 + dy * 0.5) / ROWS) * dv
          const color = sampleDesktop(DESKTOP, u, v)
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

/** The palette for one window rect, with the tile the fallback path paints. */
function paletteFor(rect) {
  const cells = regionCells(rect)
  return {
    cells,
    stops: stopsFromGrid(cells),
    average: averageOfGrid(cells),
    tileUrl: dataUrl(TILE_W, TILE_H, renderTile(cells, TILE_W, TILE_H)),
    rect,
  }
}

/**
 * The desktop textures the layer moves (mirror of `desktopTextures` in
 * lib/client.js): the wallpaper blurred + saturated, and the relief copy
 * blurred + re-centred on mid grey. Both are built from the WHOLE desktop, so a
 * window move cannot invalidate them - it only moves them.
 */
function blurThumbnail(image, sigma) {
  const radius = Math.max(1, Math.min(12, Math.round(sigma * 3)))
  const kernel = []
  let total = 0
  for (let i = -radius; i <= radius; i += 1) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel.push(weight)
    total += weight
  }
  const normalised = kernel.map((w) => w / total)
  const { w, h, rgb } = image
  const mid = new Float64Array(w * h * 3)
  const out = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sum = [0, 0, 0]
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(w - 1, Math.max(0, x + k))
        const at = (y * w + xx) * 3
        sum[0] += rgb[at] * normalised[k + radius]
        sum[1] += rgb[at + 1] * normalised[k + radius]
        sum[2] += rgb[at + 2] * normalised[k + radius]
      }
      const to = (y * w + x) * 3
      mid[to] = sum[0]
      mid[to + 1] = sum[1]
      mid[to + 2] = sum[2]
    }
  }
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      const sum = [0, 0, 0]
      for (let k = -radius; k <= radius; k += 1) {
        const yy = Math.min(h - 1, Math.max(0, y + k))
        const from = (yy * w + x) * 3
        sum[0] += mid[from] * normalised[k + radius]
        sum[1] += mid[from + 1] * normalised[k + radius]
        sum[2] += mid[from + 2] * normalised[k + radius]
      }
      const to = (y * w + x) * 3
      out[to] = byte(sum[0])
      out[to + 1] = byte(sum[1])
      out[to + 2] = byte(sum[2])
    }
  }
  return out
}

/** CSS `saturate(s)`'s colour matrix (mirror of `saturatePixel`). */
function saturatePixel(r, g, b, s) {
  const lr = 0.213
  const lg = 0.715
  const lb = 0.072
  return [
    (lr + (1 - lr) * s) * r + (lg - lg * s) * g + (lb - lb * s) * b,
    (lr - lr * s) * r + (lg + (1 - lg) * s) * g + (lb - lb * s) * b,
    (lr - lr * s) * r + (lg - lg * s) * g + (lb + (1 - lb) * s) * b,
  ]
}

/** The wallpaper's scale: one thumbnail texel is this many CSS px. */
const TEXEL = MONITOR.w / DESKTOP.w

function desktopTextures(theme, strength) {
  const dark = theme === 'dark'
  const s = strength / 100
  const sat = ((45 + 55 * s) * (dark ? 0.95 : 1)) / 100
  // Mirrors applySettings: blurPx = max(4, blur * 5), converted to texels.
  const sigma = Math.min(6, Math.max(0.4, Math.max(4, 22 * 5) / TEXEL))
  const blurred = blurThumbnail(DESKTOP, sigma)
  const count = DESKTOP.w * DESKTOP.h
  const mean = [0, 0, 0]
  for (let i = 0; i < count; i += 1) {
    mean[0] += blurred[i * 3] / count
    mean[1] += blurred[i * 3 + 1] / count
    mean[2] += blurred[i * 3 + 2] / count
  }
  const luma = (0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2]) / 255
  const tone = Math.round((0.5 / Math.max(0.08, Math.min(0.92, luma))) * 1000) / 1000
  const wall = new Uint8Array(blurred.length)
  const relief = new Uint8Array(blurred.length)
  for (let i = 0; i < count; i += 1) {
    const at = i * 3
    const colour = saturatePixel(blurred[at], blurred[at + 1], blurred[at + 2], sat)
    wall[at] = byte(colour[0])
    wall[at + 1] = byte(colour[1])
    wall[at + 2] = byte(colour[2])
    relief[at] = byte(blurred[at] * tone)
    relief[at + 1] = byte(blurred[at + 1] * tone)
    relief[at + 2] = byte(blurred[at + 2] * tone)
  }
  return {
    wallUrl: dataUrl(DESKTOP.w, DESKTOP.h, wall),
    reliefUrl: dataUrl(DESKTOP.w, DESKTOP.h, relief),
    tone,
    sigma,
  }
}

/** The texture's placement for one window rect (mirror of `frameRect`). */
function frameFor(windowRect) {
  const cover = Math.max(MONITOR.w / DESKTOP.w, MONITOR.h / DESKTOP.h)
  return {
    x: (MONITOR.w - DESKTOP.w * cover) / 2,
    y: (MONITOR.h - DESKTOP.h * cover) / 2,
    w: DESKTOP.w * cover,
    h: DESKTOP.h * cover,
    shiftX: -windowRect.x,
    shiftY: -windowRect.y,
  }
}
//#endregion

/**
 * The layer's own custom properties, per theme. Mirrors `applySettings` in
 * lib/client.js so the preview shows exactly what the bundle writes.
 */
/**
 * Mean "tint luminance" over the window's possible positions - the mirror of
 * `tintReference` in lib/client.js. The tint keeps the sampled hue but its
 * luminance is pinned to the full-width average at the window's own height, so
 * the material does not change exposure when the window moves sideways (the
 * wallpaper's rows are far more alike than its columns).
 */
function tintReference(winW, winH, winY) {
  const cols = 7
  const roomX = Math.max(0, MONITOR.w - winW)
  const y = Math.min(Math.max(0, MONITOR.h - winH), Math.max(0, winY))
  let total = 0
  for (let col = 0; col < cols; col += 1) {
    const rect = {
      x: (col / (cols - 1)) * roomX,
      y,
      w: winW,
      h: winH,
    }
    const tint = stopsFromGrid(regionCells(rect))[2]
    total += 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2]
  }
  return total / cols
}

function layerVars(theme, strength, palette, tintLuma) {
  const dark = theme === 'dark'
  const stops = palette.stops
  let tint = stops[2]
  // Mirror of the client's pin: the hue comes from the crop, the luminance does
  // not.
  if (tintLuma !== undefined && tintLuma > 0) {
    const sampled = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2]
    if (sampled > 1) {
      const gain = tintLuma / sampled
      tint = tint.map((v) => Math.min(255, Math.round(v * gain)))
    }
  }
  const bottom = stops[stops.length - 1]
  const s = strength / 100
  const round3 = (v) => Math.round(v * 1000) / 1000
  const tintAlpha = round3(0.45 + 0.37 * s)
  const veilStrong = round3(0.03 + 0.09 * s)
  const veilSoft = round3(0.03 + 0.07 * s)
  const fill = dark ? [40, 40, 40] : [250, 250, 250]
  let fillAlpha = round3((1 - (1 - tintAlpha) * (1 - veilStrong * 0.6)) * (0.62 + 0.30 * s))
  // At full strength the wallpaper keeps only ~15% of the surface (it used to
  // keep 23%, which made the whole window's brightness track the desktop).
  const keep = (1 - fillAlpha) * (1 - 0.58 * s * s)
  fillAlpha = round3(1 - keep)
  // Contrast protection: a continuous ramp from the base fill, never a
  // threshold. Mirroring applySettings (`luminance()*255` == raw luma).
  const average = palette.average
  const luma = 0.2126 * average[0] + 0.7152 * average[1] + 0.0722 * average[2]
  const need = Math.min(1, Math.max(0, (dark ? luma - 150 : 150 - luma) / 120))
  const floorAlpha = Math.min(0.94, 0.84 + need * 0.10)
  let ramp = Math.min(1, need / 0.15)
  ramp = ramp * ramp * (3 - 2 * ramp)
  fillAlpha = round3(fillAlpha + Math.max(0, floorAlpha - fillAlpha) * ramp)
  // Two zones: the conversation column keeps this density (its plate over the
  // outer sheet solves back to `fillAlpha`), the outer shell is thinner.
  const outerFill = round3(fillAlpha * 0.72)
  const plateFill = round3(1 - (1 - fillAlpha) / Math.max(0.08, 1 - outerFill))
  return [
    "--dsh-mica-image: url('" + palette.tileUrl + "')",
    '--dsh-mica-size: 100% 100%',
    '--dsh-mica-tint: rgba(' + tint.map(byte).join(',') + ', ' + tintAlpha + ')',
    '--dsh-mica-veil-strong: rgba(' + tint.map(byte).join(',') + ', ' + veilStrong + ')',
    '--dsh-mica-veil-soft: rgba(' + bottom.map(byte).join(',') + ', ' + veilSoft + ')',
    '--dsh-mica-material-fill: rgba(' + fill.join(',') + ', ' + outerFill + ')',
    '--dsh-mica-inner-fill: rgba(' + fill.join(',') + ', ' + plateFill + ')',
    '--dsh-mica-edge: ' + (dark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(0, 0, 0, 0.055)'),
    '--dsh-mica-solid-fill: rgba(' + fill.join(',') + ', 1)',
    // Dialog / floating-panel plate: glassy on purpose (~0.53 at the default
    // strength). The 40px blur, not the fill, is what hides the text behind it.
    '--dsh-mica-dialog-fill: rgba(' + fill.join(',') + ', ' + round3(Math.min(0.9, Math.max(0.36, fillAlpha * 0.62))) + ')',
    '--dsh-mica-noise: 0.03',
    '--dsh-mica-blur: 22px',
    '--dsh-mica-bleed: 68px',
    '--dsh-mica-region-blur: 12px',
    // round(22 * 1.8) - the shipped plate matches DSH's 40px menu blur.
    '--dsh-mica-panel-blur: 40px',
    '--dsh-mica-position: center',
    '--dsh-mica-wall-sat: ' + Math.round((45 + 55 * s) * (dark ? 0.95 : 1)),
    '--dsh-mica-relief: ' + round3(0.18 + 0.62 * s),
    '--dsh-mica-relief-tone: ' + round3(0.5 / Math.max(0.08, Math.min(0.92, luma / 255))),
  ].join(';\n  ')
}

/**
 * The alias tokens the plugin's override layer installs, per theme - plus the
 * handful of DSH menu tokens the mock needs because it has no ui-theme
 * stylesheet of its own (ui-theme declares them on `body`, at the shipped
 * values, and the plugin deliberately does not touch them).
 */
function tokenVars(theme) {
  const dark = theme === 'dark'
  const at = (light, darkValue) => (dark ? darkValue : light)
  return [
    '--dsw-alias-bg-base: rgba(243,243,243,0)',
    '--dsw-alias-bg-layer-1: ' + at('rgba(252,252,252,0.58)', 'rgba(58,58,58,0.58)'),
    '--dsw-alias-bg-layer-2: ' + at('rgba(246,246,246,0.54)', 'rgba(52,52,52,0.54)'),
    '--dsw-alias-bg-layer-3: ' + at('rgba(240,240,240,0.50)', 'rgba(48,48,48,0.50)'),
    '--dsw-alias-bg-overlay: ' + at('rgba(252,252,252,0.88)', 'rgba(44,44,44,0.90)'),
    '--dsw-alias-border-l1: ' + at('rgba(0,0,0,0.07)', 'rgba(255,255,255,0.09)'),
    '--dsw-alias-border-l2: ' + at('rgba(0,0,0,0.12)', 'rgba(255,255,255,0.14)'),
    '--dsw-specific-sidebar-fill: ' + at('rgba(252,252,252,0)', 'rgba(50,50,50,0)'),
    '--dsw-specific-selector: ' + at('rgba(250,250,250,0.88)', 'rgba(54,54,54,0.90)'),
    '--dsw-menu-surface-fill: ' + at('#f8f9fa94', '#43454a73'),
    '--dsw-menu-backdrop-filter: blur(40px) saturate(150%)',
    '--dsw-specific-menu: ' + at('#f8f9fa94', '#43454a73'),
    // DSH paints tooltips and toasts DARK in both palettes and colours their copy
    // with a hard-coded white; the plugin only opens the alpha up.
    '--dsw-alias-tooltip-bg: ' + at('rgba(44,44,46,0.88)', 'rgba(44,44,46,0.90)'),
    '--dsw-alias-toast-bg: ' + at('rgba(53,54,56,0.90)', 'rgba(53,54,56,0.92)'),
    '--dsw-alias-toast-label: #ffffff',
    '--dsw-static-neutral-bluish-00: #ffffff',
    '--dsw-alias-tooltip-key-bg: ' + at('#4a4a4c', '#545456'),
    '--dsw-alias-menu-group-header-fill: ' + at('#f8f9faf0', '#303136f0'),
    '--dsw-alias-menu-icon: ' + at('#3c3c3d', '#c8d4e4'),
    '--dsw-specific-bubble: ' + at('rgba(255,255,255,0.56)', 'rgba(64,64,64,0.52)'),
    '--dsw-specific-input-major: ' + at('rgba(255,255,255,0.86)', 'rgba(58,58,58,0.88)'),
    '--dsw-alias-interactive-bg-hover: ' + at('rgba(0,0,0,0.05)', 'rgba(255,255,255,0.06)'),
    '--dsw-alias-brand-primary: ' + at('#4d6dfe', '#6e9be8'),
    '--dsw-alias-label-primary: ' + at('#13243e', '#eaf2fc'),
    '--dsw-alias-label-secondary: ' + at('#40597a', '#afc3dc'),
    '--dsw-alias-label-tertiary: ' + at('#5d7696', '#8399b5'),
    '--dsw-alias-label-primary-foreground: #fff',
    '--dsw-shadow-lv2: ' + at('0 4px 12px rgba(19,45,83,0.06)', '0 4px 12px rgba(2,6,14,0.4)'),
    '--ds-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)',
    "--dsw-font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif",
  ].join(';\n  ')
}

/**
 * Text the surfaces are painted over. Each line is deliberately long enough to
 * run past the far edge of BOTH the menu and the composer, so a measurement
 * inside either surface is measuring text and not empty material.
 */
const GHOST_TEMPLATE = [
  '这一段文字刻意写得很长，用来铺满输入框所在的整行宽度，确保它同时压在菜单和输入框的后面，而不是只在左边一小段。',
  '半透明的表面如果不带可用的背板，身后的文字就会原样清晰地透出来，看起来像是两层字叠在一起，非常影响阅读。',
  '带 backdrop-filter 的元素会成为 backdrop root，它所有后代身上的 backdrop-filter 都会被浏览器直接忽略，与模糊半径无关。',
  '所以外壳区域必须保持透明、自己不能带 filter，否则输入框与菜单的背板会一起失效，而这正是之前反复出现的现象。',
  '背板生效之后，这一整行字应该只剩下一片模糊的色块，无论它落在输入框上、落在菜单上，还是落在两者的交界处。',
  '最后再确认一遍：如果右边这些字还能被辨认出来，就说明背板没有真正作用到这块板子上，而不是因为字号太小。',
]
const GHOST_LINES = Array.from({ length: 18 }, (_, index) => GHOST_TEMPLATE[index % GHOST_TEMPLATE.length])
const GHOST_HTML = GHOST_LINES
  .map((line, index) => (index % 3 === 2 ? '<b>' + line + '</b>' : line))
  .join('<br>')

/** Mock shell chrome: the shipped layout shape, in shipped tokens. */
const SHELL_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body { color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); font-size: 14px; }
  #root { position: relative; z-index: 1; height: 100%; }
  /* DSH's Windows frame: the title strip is the frame's own ::before, the frame
     is padded by the strip's height, and the columns sit in a grid below it. The
     conversation column is the pane with the top-left corner. */
  .frame { position: relative; height: 100%; padding-top: 46px; overflow: hidden;
    display: grid; grid-template-columns: 258px minmax(0, 1fr) var(--rb-track, 0px); grid-template-rows: minmax(0, 1fr); }
  .frame::before { content: ""; position: absolute; inset: 0 0 auto; height: 46px;
    background: var(--dsw-specific-sidebar-fill); -webkit-app-region: drag; }
  .title { position: absolute; inset: 0 0 auto; z-index: 2; height: 46px;
    display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
    color: var(--dsw-alias-label-secondary); font-size: 13px; pointer-events: none; }
  .sidebar { display: flex; flex-direction: column; gap: 6px; padding: 12px 10px; min-width: 0; overflow: hidden;
    background: var(--dsw-specific-sidebar-fill); border-right: .5px solid var(--dsw-alias-border-l3); }
  /* DSH removes the sidebar's own divider on Windows; the hairline the plug-in
     draws on the conversation plate is the one the user sees. */
  [data-windows-titlebar] .sidebar { border-right: none; }
  .brand { display: flex; gap: 10px; align-items: center; padding: 6px 8px 14px; font-weight: 600; }
  .mark { width: 22px; height: 22px; border-radius: 7px; background: linear-gradient(160deg, #4d6dfe, #8aa8f0); }
  .row { padding: 7px 10px; border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
  .row.active { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
  .main { display: flex; flex-direction: column; min-width: 0; position: relative; overflow: hidden; }
  /* ---- the right sidebar, in DSH's geometry ----
     The right column is only a TRACK: the panel is absolutely positioned against
     its right edge, so in fullscreen it hangs left over the conversation and its
     left edge lands exactly on the inner/outer boundary. The panel itself carries
     no background; the plate comes from the plug-in and slides out with the dock
     contents when the panel is closed. */
  .rightbar { position: relative; min-width: 0; overflow: visible; }
  .rb-panel { position: absolute; top: 0; right: 0; bottom: 0; display: flex; flex-direction: column;
    width: var(--dsh-sidebar-width, 360px); pointer-events: none; overflow: clip;
    border-left: .5px solid var(--dsw-alias-border-l3); }
  .rb-panel[data-sidebar-right-panel="fullscreen"] { width: 100vw; border-left: 0;
    max-width: calc(100vw - var(--dsh-windows-sidebar-width, 258px)); }
  /* DSH slides the dock out; the plug-in's plate is driven by the same attribute. */
  .rb-panel:not([data-sidebar-right-open]) .rb-strip,
  .rb-panel:not([data-sidebar-right-open]) .rb-dock {
    transform: translateX(var(--dsh-sidebar-width)); visibility: hidden; }
  .rb-strip { flex: none; display: flex; align-items: center; gap: 6px; height: 40px; padding: 10px 10px 0 12px; }
  .rb-tab { padding: 3px 10px; border-radius: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
  .rb-tab.on { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
  .rb-chrome { width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center;
    margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 12px; }
  .rb-chrome + .rb-chrome { margin-left: 0; }
  .rb-dock { flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
  .rb-panel[data-sidebar-right-panel="fullscreen"] .rb-dock { border-left: none; }
  .rb-line { height: 10px; border-radius: 4px; background: var(--dsw-alias-bg-layer-3); }
  .rb-line.w70 { width: 70%; }
  /* The conversation's own view switch (对话 / 轨迹) - DSH keeps it sticky at
     z-index 1, which is what let it paint over the fullscreen sheet. */
  .view-tabs { position: relative; z-index: 1; flex: none; display: flex; gap: 6px; padding: 8px 28px 2px; }
  .view-tab { padding: 4px 12px; border-radius: 999px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
  .view-tab.on { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
  .transcript { flex: 1; padding: 14px 28px; display: flex; flex-direction: column; gap: 16px; overflow: hidden; }
  .bubble { max-width: 620px; padding: 12px 14px; border-radius: 14px; background: var(--dsw-specific-bubble);
    border: 1px solid var(--dsw-alias-border-l1); box-shadow: var(--dsw-shadow-lv2); line-height: 1.6; }
  .bubble.user { align-self: flex-end; background: var(--dsw-alias-bg-layer-3); }
  /* ---- the surface backplate demo ----
     Text that the surfaces below are painted OVER. If a surface is translucent
     without a working backplate, this very text is readable through it. Nothing
     in this mock adds a filter to a surface on its own: the plates come from the
     plugin's stylesheet (composer) and from MenuSurface's own .material
     (menus), exactly as on the real page. */
  .behind { position: absolute; left: 28px; right: 28px; top: 284px; bottom: 0; overflow: hidden;
    color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 24px; opacity: .92; }
  .behind b { font-weight: 600; }
  .composer-slot { position: relative; z-index: 7; margin-top: auto; padding: 0 28px 22px 90px; }
  .composer { position: relative; padding: 13px 15px 11px;
    border-radius: 16px; background: var(--dsw-specific-input-major);
    border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary);
    box-shadow: var(--dsw-shadow-lv2); }
  .composer-tools { display: flex; gap: 8px; margin-top: 9px; }
  .composer-chip { padding: 3px 9px; border-radius: 999px; font-size: 11px;
    background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary); }
  /* DSH's own hook: the conversation.input.overlay slot renders the slash/@ menu inside
     the composer card, which is what makes the card's own filter poison it. */
  .overlay-anchor { position: absolute; inset: 0 0 auto; height: 0; }
  /* ---- MenuSurface, copied from ui-primitives/MenuSurface.module.css ----
     .surface isolates (so the z-index:-1 plate stays inside it) and owns NO
     filter; only .material is filtered, which is why a menu can sit inside a
     filtered ancestor and still blur. */
  .mat-surface { position: relative; isolation: isolate; border-radius: 12px;
    border: 1px solid var(--dsw-alias-border-l1); box-shadow: var(--dsw-shadow-lv2); }
  .mat-surface > .material { position: absolute; inset: 0; z-index: -1; border-radius: inherit;
    background: var(--dsw-menu-surface-fill); backdrop-filter: var(--dsw-menu-backdrop-filter);
    pointer-events: none; }
  .slash-menu { position: absolute; left: 0; bottom: 100%; width: 386px; padding: 5px; }
  .model-menu { position: absolute; left: 430px; top: 302px; width: 268px; padding: 5px; z-index: 30; }
  .menu-group { padding: 4px 8px 3px; font-size: 11px; line-height: 15px;
    color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-menu-group-header-fill);
    border-radius: 6px; }
  .menu-item { display: flex; gap: 8px; align-items: baseline; padding: 5px 8px; border-radius: 7px;
    font-size: 13px; color: var(--dsw-alias-label-secondary); }
  .menu-item .mi-label { color: var(--dsw-alias-label-primary); font-weight: 500; }
  .menu-item .mi-detail { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
  .menu-item.active { background: var(--dsw-alias-interactive-bg-hover); }
  .menu-item.active .mi-label { color: var(--dsw-alias-brand-primary); }
  .overlay { position: absolute; right: 26px; bottom: 26px; z-index: 40; width: 300px; padding: 14px; border-radius: 16px;
    background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); box-shadow: var(--dsw-shadow-lv2); }
  .swatch { height: 10px; border-radius: 5px; margin-top: 10px; border: 1px solid var(--dsw-alias-border-l1); }
`

/** The sampling diagnostic card: raw sample, palette grid, generated tile. */
const DIAG_CSS = `
  .diag { position: fixed; left: 26px; bottom: 26px; z-index: 40; width: 300px; padding: 12px 14px; border-radius: 16px;
    background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2);
    box-shadow: var(--dsw-shadow-lv2); font-size: 12px; color: var(--dsw-alias-label-secondary); }
  .diag h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
  .diag-row { display: flex; gap: 10px; align-items: flex-start; }
  .diag figure { margin: 0; flex: 1; min-width: 0; }
  .diag img { display: block; width: 100%; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; }
  /* Only the countable grids are pixelated; the tile is a smooth downsample. */
  .diag img.px { image-rendering: pixelated; }
  /* The tile reuses the layer's own image, so the big data URL is inlined once. */
  .diag .tile { display: block; width: 100%; aspect-ratio: 128 / 72; border-radius: 6px;
    border: 1px solid var(--dsw-alias-border-l1);
    background-image: var(--dsh-mica-desktop); background-size: 100% 100%; background-repeat: no-repeat; }
  .diag figcaption { margin-top: 5px; line-height: 1.45; }
  .diag .path { margin-top: 8px; overflow-wrap: anywhere; color: var(--dsw-alias-label-tertiary); }
`

/** Surfaces that the last round of reports was about: a tooltip, a toast, a dialog. */
const SURFACES_CSS = `
  /* Tooltip bubble - DSH paints it with --dsw-alias-tooltip-bg and a hard-coded
     white label (--dsw-static-neutral-bluish-00), in BOTH themes. */
  .tip { position: absolute; left: 372px; top: 452px; z-index: 45; display: inline-flex; align-items: center; gap: 8px;
    padding: 3px 7px; border-radius: 7px; background: var(--dsw-alias-tooltip-bg);
    color: var(--dsw-static-neutral-bluish-00); font-size: 13px; line-height: 20px; }
  .tip kbd { display: inline-flex; align-items: center; height: 16px; padding: 0 4px; border-radius: 4px;
    background: var(--dsw-alias-tooltip-key-bg); font: inherit; font-size: 11px; }
  /* Toast - --dsw-alias-toast-bg + --dsw-alias-toast-label, both dark/white. */
  .toast { position: absolute; left: 470px; top: 366px; z-index: 45; display: flex; align-items: center; gap: 10px;
    width: max-content; max-width: 640px; padding: 12px 16px; border-radius: 14px;
    background: var(--dsw-alias-toast-bg); color: var(--dsw-alias-toast-label);
    font-size: 14px; line-height: 22px; box-shadow: var(--dsw-shadow-lv2); }
  /* Modal card / settings panel - DSH paints both with --dsw-alias-bg-layer-2 and
     gives them tabindex="-1"; the lightbox's browser-wide backdrop has neither.
     Sized like the settings panel so the frosted plate is actually visible. */
  .dialog { position: absolute; left: 470px; top: 452px; z-index: 45; box-sizing: border-box; width: 640px;
    display: flex; flex-direction: column; gap: 8px; padding: 22px 24px 24px; border-radius: 16px;
    background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-shadow-lv2); }
  .dialog h3 { margin: 0 0 6px; font-size: 16px; font-weight: 500; color: var(--dsw-alias-label-primary); }
  .dlg-row { display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 9px 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 13px; }
  .dlg-row span:first-child { color: var(--dsw-alias-label-primary); }
  .dlg-row span:last-child { color: var(--dsw-alias-label-tertiary); }
  .dlg-chip { padding: 2px 9px; border-radius: 999px; background: var(--dsw-alias-bg-layer-3);
    color: var(--dsw-alias-label-secondary); }
`

/**
 * The right sidebar scenes: the floating report cards belong to other surfaces
 * and would sit on top of the panel, so the scene is just the shell.
 */
const RIGHTBAR_CSS = `
  .overlay, .diag, .behind, .model-menu, .slash-menu, .view-tabs { display: none; }
  .rb-note { position: absolute; left: 14px; bottom: 14px; z-index: 60; pointer-events: none;
    width: 226px; font-size: 11px; line-height: 1.55; color: var(--dsw-alias-label-tertiary); }
`

/**
 * One standalone preview page.
 * @param theme - 'light' | 'dark'.
 * @param stylesheet - the bundle's own stylesheet.
 * @param strength - the tint-strength knob, 0..100.
 * @param variant - '' | 'surfaces' | 'rightbar' | 'rightbar-fullscreen' |
 *   'rightbar-collapsed' | 'window'.
 * @param windowRect - the window's rect on the (mock) desktop; the material
 *   samples exactly this part of the wallpaper, like Windows' own Mica.
 */
function buildPage(theme, stylesheet, strength, variant = '', windowRect = FULL_MONITOR) {
  const palette = paletteFor(windowRect)
  const texture = desktopTextures(theme, strength)
  const frame = frameFor(windowRect)
  const rightbarScene = variant.indexOf('rightbar') === 0
  const rbFullscreen = variant === 'rightbar-fullscreen' || variant === 'rightbar-collapsed'
  const rbOpen = variant !== 'rightbar-collapsed'
  const rbWidth = 360
  const rbTrack = variant === 'rightbar-collapsed' ? 0 : rbWidth
  const pinnedTintLuma = tintReference(windowRect.w, windowRect.h, windowRect.y)
  const textureVars = [
    "--dsh-mica-desktop: url('" + texture.wallUrl + "')",
    "--dsh-mica-desktop-relief: url('" + texture.reliefUrl + "')",
    '--dsh-mica-frame-x: ' + frame.x + 'px',
    '--dsh-mica-frame-y: ' + frame.y + 'px',
    '--dsh-mica-frame-w: ' + frame.w + 'px',
    '--dsh-mica-frame-h: ' + frame.h + 'px',
    '--dsh-mica-shift-x: ' + frame.shiftX + 'px',
    '--dsh-mica-shift-y: ' + frame.shiftY + 'px',
    '--dsh-mica-relief-tone: ' + texture.tone,
  ].join(';\n  ')
  const extraCss = variant === 'surfaces'
    ? SURFACES_CSS
    : rightbarScene
      ? RIGHTBAR_CSS
      : ''
  const windowNote = variant === 'window'
    ? `<div style="color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:4px">
        窗口位置: 桌面右下 · 采样区 ${Math.round((windowRect.w / MONITOR.w) * 100)}% × ${Math.round((windowRect.h / MONITOR.h) * 100)}%
      </div>`
    : ''
  const surfaces = variant === 'surfaces'
    ? `
  <div class="toast" role="alert">已复制到剪贴板</div>
  <div class="tip" role="tooltip">打开设置<kbd>Ctrl</kbd><kbd>,</kbd></div>
  <div class="dialog" role="dialog" aria-modal="true" tabindex="-1" aria-label="设置">
    <h3>设置</h3>
    <div class="dlg-row"><span>材质模式</span><span>云母 · Mica</span></div>
    <div class="dlg-row"><span>着色强度</span><span>100%</span></div>
    <div class="dlg-row"><span>模糊</span><span>22 px</span></div>
    <div class="dlg-row"><span>外观</span><span class="dlg-chip">跟随系统</span></div>
  </div>`
    : ''
  // The right sidebar, in DSH's own geometry: the column is only a track and the
  // panel hangs on its right edge, so a maximized panel starts exactly on the
  // inner/outer boundary.
  const rightbarMarkup = rightbarScene
    ? `
    <aside class="rightbar" data-dsh-mica-glass>
      <div class="rb-panel" data-sidebar-right-panel="${rbFullscreen ? 'fullscreen' : 'push'}"${rbOpen ? ' data-sidebar-right-open' : ''}
           style="--dsh-sidebar-width:${rbFullscreen ? '100vw' : rbWidth + 'px'}">
        <div class="rb-strip">
          <span class="rb-tab on">README.md</span>
          <span class="rb-tab">terminal</span>
          <span class="rb-chrome">⤢</span>
          <span class="rb-chrome">⇥</span>
        </div>
        <div class="rb-dock" data-dockkit-host="dock">
          <div class="rb-line w70"></div>
          <div class="rb-line"></div>
          <div class="rb-line w70"></div>
          <div class="rb-line"></div>
          <div class="rb-line w70"></div>
          <div class="rb-line"></div>
          <div class="rb-line w70"></div>
        </div>
      </div>
    </aside>`
    : ''
  const rbNote = rightbarScene
    ? `<div class="rb-note">${rbOpen
      ? (rbFullscreen ? '最大化：半透明背板，左上角与内外分界重合' : '停靠：背板与对话区同一块材质')
      : '最大化后点「收起侧边栏」：背板随内容一起滑走，对话区完整露出'}</div>`
    : ''
  return `<!doctype html>
<html lang="zh-CN" ${ROOT_ATTR}="mica" data-dsh-mica-source="desktop" data-windows-titlebar data-platform="win32" style="
  ${layerVars(theme, strength, palette, pinnedTintLuma)};
  ${textureVars};
  ${tokenVars(theme)};
">
<head>
<meta charset="utf-8">
<title>dsh-mica preview (${theme}, tint ${strength}%${variant === '' ? '' : ', ' + variant})</title>
<style>
${stylesheet}
</style>
<style>${SHELL_CSS}</style>
<style>${DIAG_CSS}</style>
<style>${extraCss}</style>
</head>
<body>
<div data-dsh-mica-backdrop aria-hidden="true">
  <div data-dsh-mica-wallpaper></div>
  <div data-dsh-mica-tint></div>
  <div data-dsh-mica-veil></div>
  <div data-dsh-mica-grain></div>
  <div data-dsh-mica-fill></div>
  <div data-dsh-mica-relief></div>
</div>
<div id="root">
  <div class="frame" data-dsh-mica-frame${rbFullscreen && rbOpen ? ' data-rightbar-fullscreen' : ''}${rightbarScene
    ? ` style="--rb-track:${rbTrack}px;--dsh-windows-sidebar-width:258px"`
    : ''}>
    <div class="title"><span>DeepSeek Harness</span><span>新会话 · deepseek-flash</span></div>
    <aside class="sidebar" data-dsh-mica-glass>
      <div class="brand"><span class="mark"></span><span>工作区</span></div>
      <div class="row active">云母材质 · Mica</div>
      <div class="row">会话</div>
      <div class="row">插件</div>
      <div class="row">设置</div>
    </aside>
    <main class="main" data-dsh-mica-glass data-dsh-mica-inner>
        <div class="view-tabs">
          <span class="view-tab on">对话</span>
          <span class="view-tab">轨迹</span>
          <span class="view-tab">文件</span>
        </div>
        <div class="transcript">
          <div class="bubble user">给 dsh 界面加上 Mica 效果。</div>
          <div class="bubble">Mica 材质分两个区：外侧（标题栏 + 侧边栏）是同一层薄一点的壁纸材质；对话区是同一层材质上再叠一块更实的板，左上角保留 DSH 原版的 16px 圆角，交界处一条 Windows 风格的发丝线。桌面纹理按窗口位置用 transform 滑动，每帧只写两个变量。</div>
          <div class="bubble">材质模式、着色强度、模糊与噪点可以在「设置 → 通用 → 云母材质」里调整。</div>
        </div>
        <div class="behind">${GHOST_HTML}</div>
        <div class="composer-slot">
          <div class="composer" data-composer-card>
            <div class="overlay-anchor">
              <!-- the slash-command menu: inside the composer card, as DSH renders it -->
              <div class="mat-surface slash-menu" data-menu-material="translucent" data-trigger-menu role="menu" aria-label="斜杠命令">
                <div class="material" aria-hidden="true"></div>
                <div class="menu-group">斜杠命令</div>
                <div class="menu-item active"><span class="mi-label">/model</span><span class="mi-detail">切换模型</span></div>
                <div class="menu-item"><span class="mi-label">/clear</span><span class="mi-detail">清空上下文</span></div>
                <div class="menu-item"><span class="mi-label">/compact</span><span class="mi-detail">压缩本次会话</span></div>
                <div class="menu-item"><span class="mi-label">/plugin</span><span class="mi-detail">管理插件</span></div>
              </div>
            </div>
            输入消息…（这一行的背后是上面那段文字）
            <div class="composer-tools">
              <span class="composer-chip">模型</span>
              <span class="composer-chip">工作区</span>
              <span class="composer-chip">附件</span>
            </div>
          </div>
        </div>
      </main>${rightbarMarkup}${rbNote}
  </div>
  <!-- the model picker: createPortal(..., document.body), so it is NOT inside
       the composer card - a sibling of the shell, exactly like the real page -->
  <div class="mat-surface model-menu" data-menu-material="translucent" role="menu" aria-label="模型选择">
    <div class="material" aria-hidden="true"></div>
    <div class="menu-item"><span class="mi-label">模型</span><span class="mi-detail">deepseek-flash ▸</span></div>
    <div class="menu-item active"><span class="mi-label">推理强度</span><span class="mi-detail">中 ▸</span></div>
  </div>
  <div class="overlay">
    <strong>云母材质</strong>
    <div style="color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:4px">
      背景取自: 跟随桌面 · ${SAMPLE_WALLPAPER.split('\\').pop()}
    </div>${windowNote}
    <div class="swatch" style="background-image:url('${texture.wallUrl}');background-size:cover;background-position:center"></div>
  </div>
  <div class="diag">
    <h4>壁纸采样（着色强度 ${strength}%）</h4>    <div class="diag-row">
      <figure>
        <img class="px" src="${gridImage(SAMPLE, GRID, GRID, 10)}" alt="14x14 sample">
        <figcaption>主机采样<br>14×14</figcaption>
      </figure>
      <figure>
        <img class="px" src="${gridImage(palette.cells, COLS, ROWS, 20)}" alt="7x7 palette">
        <figcaption>调色板<br>7×7</figcaption>
      </figure>
      <figure>
        <span class="tile"></span>
        <figcaption>桌面纹理<br>128×72 预模糊</figcaption>
      </figure>
    </div>
    <div class="path">${SAMPLE_WALLPAPER}</div>
  </div>${surfaces}
</div>
</body>
</html>`
}

/**
 * The same page as the SHIPPED-but-broken release rendered it, kept next to the
 * previews so the two bugs stay reproducible instead of only being described:
 *
 *  1. the composer carried the `backdrop-filter` on the card itself. A filtered
 *     element is a backdrop root and Chromium ignores `backdrop-filter` on every
 *     descendant, so the slash menu inside the card lost its material blur and
 *     showed the transcript through at 58% fill;
 *  2. the menu family got a second filter on the surface, on top of the material
 *     child that already blurs it - two blurs over one fill, i.e. a doubled plate.
 */
function legacySurfacePage(page) {
  return page.replace('</head>', `<style>
  html[data-dsh-mica] [data-composer-card] {
    background-color: var(--dsw-specific-input-major) !important;
    isolation: auto !important;
    -webkit-backdrop-filter: blur(20px) saturate(130%) !important;
    backdrop-filter: blur(20px) saturate(130%) !important;
  }
  html[data-dsh-mica] [data-composer-card]::before { display: none !important; }
  html[data-dsh-mica] [data-menu-material],
  html[data-dsh-mica] [role="menu"],
  html[data-dsh-mica] [role="listbox"] {
    -webkit-backdrop-filter: blur(20px) saturate(130%) !important;
    backdrop-filter: blur(20px) saturate(130%) !important;
  }
</style>
</head>`)
}

/**
 * The surfaces scene as the PREVIOUS release rendered it, i.e. the three reports:
 *
 *  1. tooltips and toasts were lightened for the Mica look, but DSH paints their
 *     copy with a hard-coded white - white on white in the light theme;
 *  2. the dialog carried the `backdrop-filter`, which made it a backdrop root and
 *     left every tooltip opened inside it unblurred;
 *  3. a `role="menu"` with no material of its own got a blur but no fill.
 */
function legacySurfacesPage(page) {
  return page.replace('</head>', `<style>
  html[data-dsh-mica] {
    --dsw-alias-tooltip-bg: rgba(252,252,252,0.88) !important;
    --dsw-alias-toast-bg: rgba(252,252,252,0.86) !important;
  }
  /* the previous release: a flat near-solid fill, no frost and no plate */
  html[data-dsh-mica] [aria-modal="true"][tabindex] {
    background-color: color-mix(in srgb, var(--dsh-mica-solid-fill) 96%, transparent) !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  html[data-dsh-mica] [aria-modal="true"][tabindex]::before { display: none !important; }
  html[data-dsh-mica] [role="menu"]:not([data-menu-material]) {
    background-color: transparent !important;
  }
</style>
</head>`)
}

const stylesheet = stylesheetFromBundle()
fs.mkdirSync(OUT_DIR, { recursive: true })
// Tint strength 100 is the shipped default; 55 shows the raw-wallpaper end of
// the range the way a user sees it while dragging the slider.
for (const theme of ['light', 'dark']) {
  for (const strength of [100, 55]) {
    const file = path.join(OUT_DIR, `preview-${theme}-${strength}.html`)
    fs.writeFileSync(file, buildPage(theme, stylesheet, strength))
    console.log('wrote ' + file)
  }
}
const beforeFile = path.join(OUT_DIR, 'surface-backplate-before.html')
fs.writeFileSync(beforeFile, legacySurfacePage(buildPage('dark', stylesheet, 100)))
console.log('wrote ' + beforeFile + '   (the previous release, for comparison)')

/**
 * The tooltip / toast / dialog family, a scene the main mock does not carry.
 */
{
  const file = path.join(OUT_DIR, 'preview-surfaces.html')
  fs.writeFileSync(file, buildPage('dark', stylesheet, 100, 'surfaces'))
  console.log('wrote ' + file)
}
// The unreadable-copy report was a LIGHT-theme one: the fills were lightened for
// the light palette while the copy stayed a hard-coded white.
const surfacesLight = path.join(OUT_DIR, 'preview-surfaces-light.html')
fs.writeFileSync(surfacesLight, buildPage('light', stylesheet, 100, 'surfaces'))
console.log('wrote ' + surfacesLight)
const surfacesBefore = path.join(OUT_DIR, 'preview-surfaces-before.html')
fs.writeFileSync(surfacesBefore, legacySurfacesPage(buildPage('dark', stylesheet, 100, 'surfaces')))
console.log('wrote ' + surfacesBefore + '   (the previous release, for comparison)')
const surfacesLightBefore = path.join(OUT_DIR, 'preview-surfaces-light-before.html')
fs.writeFileSync(surfacesLightBefore, legacySurfacesPage(buildPage('light', stylesheet, 100, 'surfaces')))
console.log('wrote ' + surfacesLightBefore + '   (the previous release, for comparison)')

/**
 * The right sidebar in its three states: docked (the conversation's plate),
 * maximized (a thinner sheet, boundary notch) and maximized-then-collapsed (the
 * plate has to leave with the dock contents instead of staying over the
 * conversation as a white sheet).
 */
for (const [name, variant] of [
  ['preview-rightbar', 'rightbar'],
  ['preview-rightbar-fullscreen', 'rightbar-fullscreen'],
  ['preview-rightbar-collapsed', 'rightbar-collapsed'],
]) {
  const file = path.join(OUT_DIR, name + '.html')
  fs.writeFileSync(file, buildPage('light', stylesheet, 100, variant))
  console.log('wrote ' + file)
}
const rightbarDark = path.join(OUT_DIR, 'preview-rightbar-fullscreen-dark.html')
fs.writeFileSync(rightbarDark, buildPage('dark', stylesheet, 100, 'rightbar-fullscreen'))
console.log('wrote ' + rightbarDark)

/**
 * The collapse bug as the previous release had it: the fill lived on the panel
 * itself, and the panel never moves when the sidebar collapses - only its dock
 * children slide out - so the white sheet stayed behind and covered the
 * conversation.
 */
const rightbarBefore = path.join(OUT_DIR, 'preview-rightbar-collapsed-before.html')
fs.writeFileSync(rightbarBefore, buildPage('light', stylesheet, 100, 'rightbar-collapsed').replace('</head>', `<style>
  html[data-dsh-mica] [data-sidebar-right-panel="fullscreen"] {
    background-color: var(--dsh-mica-solid-fill) !important;
  }
  html[data-dsh-mica] [data-sidebar-right-panel]::before { display: none !important; }
</style>
</head>`))
console.log('wrote ' + rightbarBefore + '   (the previous release, for comparison)')

/**
 * Window-relative sampling: the same shell with the window parked at the bottom
 * right of a 2560x1440 desktop, so the material shows THAT part of the wallpaper
 * instead of the whole image. Compare with `preview-dark-100.png`, which stands
 * for a window covering the entire desktop.
 */
const REGION_WINDOW = { x: 640, y: 400, w: 640, h: 400 }
for (const [theme, strength] of [['dark', 100], ['dark', 55], ['light', 100]]) {
  const file = path.join(OUT_DIR, 'preview-window-' + theme + (strength === 100 ? '' : '-' + strength) + '.html')
  fs.writeFileSync(file, buildPage(theme, stylesheet, strength, 'window', REGION_WINDOW))
  console.log('wrote ' + file + '   (window at the desktop bottom right)')
}
console.log('sample: ' + SAMPLE_WALLPAPER)
console.log('average luma ' + (0.2126 * AVERAGE[0] + 0.7152 * AVERAGE[1] + 0.0722 * AVERAGE[2]).toFixed(1)
  + ', left/right column luma ' + sampleLuma(0).toFixed(1) + ' / ' + sampleLuma(13).toFixed(1))

/** Mean luminance of one column of the raw sample (diagnostic print). */
function sampleLuma(x) {
  let sum = 0
  for (let y = 0; y < GRID; y += 1) {
    const c = SAMPLE[y * GRID + x]
    sum += 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  return sum / GRID
}
