/**
 * Regenerate `icon.png` — the package icon DSH shows in the Plugins list.
 *
 * A "Mica window" mark: the sampled desktop ramp behind a frosted pane, plus
 * the two-light-pane wordmark of the Mica material. Zero dependencies; run it
 * with the same Node used for `scripts/verify.mjs`.
 *
 *   <node> dsh-mica/scripts/make-icon.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(path.resolve(HERE, '..'), 'icon.png')
const SIZE = 256

//#region PNG encoding (independent copy; scripts must not import lib/client.js)
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

/** zlib stream with stored deflate blocks — no compression library needed. */
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

/** Encode RGB pixels (no alpha — the mark is opaque) as a PNG buffer. */
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
  let total = 0
  for (const part of parts) total += part.length
  const out = Buffer.concat(parts.map((p) => Buffer.from(p)), total)
  return out
}
//#endregion

//#region mark geometry
const RAMP = [
  [243, 243, 243],
  [207, 220, 235],
  [131, 168, 206],
  [70, 108, 152],
  [240, 242, 245],
]
const BRAND = [0x4D, 0x6D, 0xFE]
const clamp = (value) => Math.min(255, Math.max(0, Math.round(value)))
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Sample the vertical ramp at 0..1. */
function rampAt(t) {
  const scaled = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1)
  const index = Math.floor(scaled)
  return mix(RAMP[index], RAMP[index + 1], scaled - index)
}

/** Rounded-rectangle coverage: 1 inside, 0 outside, antialiased at the edge. */
function roundedCoverage(x, y, left, top, width, height, radius) {
  const cx = left + width / 2
  const cy = top + height / 2
  const dx = Math.abs(x - cx) - (width / 2 - radius)
  const dy = Math.abs(y - cy) - (height / 2 - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - radius
  const inside = Math.min(Math.max(dx, dy), 0)
  const distance = outside + inside
  return Math.min(1, Math.max(0, 0.5 - distance))
}

/** Render the icon pixels. */
function render() {
  const pixels = new Uint8Array(SIZE * SIZE * 3)
  const barrier = SIZE * 0.52 // the frosted pane's top edge
  const paneTop = barrier + 22
  const paneHeight = 70
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let color = rampAt(y / (SIZE - 1))
      // The frosted pane: a light translucent plate over the lower half.
      const pane = roundedCoverage(x, y, 30, barrier, SIZE - 60, SIZE - barrier - 26, 28)
      if (pane > 0) color = mix(color, [252, 252, 252], 0.66 * pane)
      // A hairline along the pane's top edge reads as the material's bevel.
      const bevel = roundedCoverage(x, y, 30, barrier, SIZE - 60, 3, 1.5)
      if (bevel > 0) color = mix(color, [255, 255, 255], 0.55 * bevel)
      // The two Mica light panes, inset inside the frosted plate.
      const leftPane = roundedCoverage(x, y, 70, paneTop, 50, paneHeight, 12)
      const rightPane = roundedCoverage(x, y, 136, paneTop, 50, paneHeight, 12)
      if (leftPane > 0) color = mix(color, BRAND, 0.94 * leftPane)
      if (rightPane > 0) color = mix(color, mix(BRAND, [255, 255, 255], 0.5), 0.94 * rightPane)
      const at = (y * SIZE + x) * 3
      pixels[at] = clamp(color[0])
      pixels[at + 1] = clamp(color[1])
      pixels[at + 2] = clamp(color[2])
    }
  }
  return pixels
}
//#endregion

const png = encodePng(SIZE, SIZE, render())
fs.writeFileSync(OUT, png)
console.log(`wrote ${OUT} (${png.length} bytes)`)
