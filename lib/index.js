/**
 * dsh-mica host half.
 *
 * The visual layer lives entirely in the browser (see `lib/client.js`); this
 * half exists for exactly one optional capability: reading the ACTIVE Windows
 * desktop wallpaper's colour palette so the browser side can build a Mica
 * backdrop that matches the user's actual desktop instead of a canned one.
 *
 * Everything here is best-effort and side-effect free:
 *   - no route is required for the effect to work (the browser side falls back
 *     to a procedural palette),
 *   - any failure (non-Windows host, no PowerShell, no wallpaper, registry
 *     denial) is reported as `{ ok: false }` and never throws,
 *   - the sampled palette is cached in memory for the process lifetime.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-mica'

/** Public shape handed to the browser half. */
const ROUTE_PATH = '/plugins/dsh-mica/palette'
const GRID = 14
/** Width of the desktop thumbnail handed to the browser (aspect preserved). */
const DESKTOP_WIDTH = 128
const SAMPLE_TTL_MS = 60_000

/**
 * The sampler. Windows PowerShell reads `HKCU\Control Panel\Desktop\WallPaper`
 * through `RegGetValueW` and averages the image in PowerShell, because Node has
 * no image decoder available to a profile plugin. All heavy work happens in
 * PowerShell; this process only reads back a small JSON blob.
 */
const SAMPLER_SCRIPT = String.raw`
param([Parameter(Mandatory=$true)][string]$Out)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ ok = $false; wallpaper = ''; colors = @(); error = '' }
try {
  $type = @'
using System;
using System.Runtime.InteropServices;
public static class DshMica {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int RegGetValueW(IntPtr hkey, string lpSubKey, string lpValue, uint dwFlags, out uint pdwType, System.Text.StringBuilder pvData, ref uint pcbData);
}
'@
  Add-Type -TypeDefinition $type -ErrorAction SilentlyContinue

  $buf = New-Object System.Text.StringBuilder 2048
  [uint32]$size = 2048
  [uint32]$regType = 0
  $rc = [DshMica]::RegGetValueW([IntPtr]0x80000001, 'Control Panel\Desktop', 'WallPaper', 2, [ref]$regType, $buf, [ref]$size)
  $wall = $buf.ToString()

  # HKCU\Control Panel\Desktop\WallPaper holds the wallpapers picked per theme,
  # but it is empty under a slideshow / Windows spotlight / per-monitor setup.
  # TranscodedWallpaper is the file the desktop actually renders in those cases
  # (it is a JPEG with no extension, which Image.FromStream sniffs fine), so try
  # it as the fallback rather than giving up and losing the desktop palette.
  $candidates = @($wall, (Join-Path $env:APPDATA 'Microsoft\Windows\Themes\TranscodedWallpaper'))
  $file = ''
  foreach ($candidate in $candidates) {
    if ($candidate -ne '' -and (Test-Path -LiteralPath $candidate)) { $file = $candidate; break }
  }
  $result.wallpaper = $file

  if ($rc -ne 0 -and $file -eq '') { throw "WallPaper registry read failed (rc=$rc)" }
  if ($file -eq '') { throw "no wallpaper file found (tried: $($candidates -join '; '))" }

  # Wallpaper placement, so the browser half can map the window's rect on the
  # monitor to pixels of this image: 0 center, 2 stretch, 6 fit, 10 fill
  # (Windows' default), 22 span; TileWallpaper tiling wins over all of them.
  $styleBuf = New-Object System.Text.StringBuilder 32
  [uint32]$styleSize = 32
  [uint32]$styleType = 0
  if ([DshMica]::RegGetValueW([IntPtr]0x80000001, 'Control Panel\Desktop', 'WallpaperStyle', 2, [ref]$styleType, $styleBuf, [ref]$styleSize) -eq 0) {
    $result.wallpaperStyle = $styleBuf.ToString()
  }
  $tileBuf = New-Object System.Text.StringBuilder 32
  [uint32]$tileSize = 32
  [uint32]$tileType = 0
  if ([DshMica]::RegGetValueW([IntPtr]0x80000001, 'Control Panel\Desktop', 'TileWallpaper', 2, [ref]$tileType, $tileBuf, [ref]$tileSize) -eq 0) {
    $result.tile = $tileBuf.ToString()
  }

  Add-Type -AssemblyName System.Drawing
  $stream = [System.IO.File]::OpenRead($file)
  try {
    $img = [System.Drawing.Image]::FromStream($stream)
    try {
      $w = ${GRID}; $h = ${GRID}
      $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
          $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
          $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $g.DrawImage($img, 0, 0, $w, $h)
        } finally { $g.Dispose() }

        $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
        $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
          $bytes = New-Object byte[] ($data.Stride * $h)
          [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        } finally { $bmp.UnlockBits($data) }

        $list = New-Object System.Collections.ArrayList
        for ($y = 0; $y -lt $h; $y++) {
          for ($x = 0; $x -lt $w; $x++) {
            $i = $y * $data.Stride + $x * 4
            [void]$list.Add(([ordered]@{
              r = [int]$bytes[$i + 2]
              g = [int]$bytes[$i + 1]
              b = [int]$bytes[$i]
            }))
          }
        }
        $result.colors = $list
        $result.ok = $true

        # A desktop-shaped thumbnail, DESKTOP_WIDTH wide, for window-relative
        # sampling: the browser crops the rect under the window out of THIS image
        # instead of reading one whole-desktop average. 128 px across is plenty -
        # a Mica backdrop is blurred by tens of pixels anyway.
        $dw = ${DESKTOP_WIDTH}
        $dh = [Math]::Max(1, [int][Math]::Round($dw * $img.Height / $img.Width))
        $dbmp = New-Object System.Drawing.Bitmap $dw, $dh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
          $dg = [System.Drawing.Graphics]::FromImage($dbmp)
          try {
            $dg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
            $dg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $dg.DrawImage($img, 0, 0, $dw, $dh)
          } finally { $dg.Dispose() }
          $drect = New-Object System.Drawing.Rectangle 0, 0, $dw, $dh
          $ddata = $dbmp.LockBits($drect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
          try {
            $dbytes = New-Object byte[] ($ddata.Stride * $dh)
            [System.Runtime.InteropServices.Marshal]::Copy($ddata.Scan0, $dbytes, 0, $dbytes.Length)
          } finally { $dbmp.UnlockBits($ddata) }
          $rgb = New-Object byte[] ($dw * $dh * 3)
          for ($y = 0; $y -lt $dh; $y++) {
            for ($x = 0; $x -lt $dw; $x++) {
              $si = $y * $ddata.Stride + $x * 4
              $di = ($y * $dw + $x) * 3
              $rgb[$di] = $dbytes[$si + 2]
              $rgb[$di + 1] = $dbytes[$si + 1]
              $rgb[$di + 2] = $dbytes[$si]
            }
          }
          $result.desktop = [ordered]@{ w = $dw; h = $dh; rgb = [Convert]::ToBase64String($rgb) }
        } finally { $dbmp.Dispose() }
      } finally { $bmp.Dispose() }
    } finally { $img.Dispose() }
  } finally { $stream.Dispose() }
} catch {
  $result.error = $_.Exception.Message
}
$json = $result | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
`

/** Resolve the Windows PowerShell executable without ever touching a shell. */
function powershellPath() {
  const root = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
  const candidates = [
    join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    join(root, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return null
}

/** Run the sampler in a scratch directory and read its JSON result. */
async function sampleWallpaper() {
  if (process.platform !== 'win32') return { ok: false, error: 'unsupported platform' }
  const powershell = powershellPath()
  if (powershell === null) return { ok: false, error: 'Windows PowerShell not found' }

  const dir = await mkdtemp(join(tmpdir(), 'dsh-mica-'))
  const scriptPath = join(dir, 'sample.ps1')
  const outPath = join(dir, 'palette.json')
  try {
    await writeFile(scriptPath, SAMPLER_SCRIPT, 'utf8')
    const encoded = Buffer.from(
      `& ${psQuote(scriptPath)} -Out ${psQuote(outPath)}`,
      'utf16le',
    ).toString('base64')
    await new Promise((resolve) => {
      execFile(
        powershell,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { timeout: 20_000, windowsHide: true, maxBuffer: 1 << 20 },
        () => resolve(), // a non-zero exit is surfaced by the missing/invalid file
      )
    })
    const raw = await readFile(outPath, 'utf8')
    return JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Quote one PowerShell single-quoted literal. */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** Keep a sampled palette plus its provenance. */
function normalize(sample) {
  if (sample === null || typeof sample !== 'object' || sample.ok !== true) {
    return { ok: false, reason: typeof sample?.error === 'string' && sample.error !== '' ? sample.error : 'sampling failed' }
  }
  const colors = Array.isArray(sample.colors) ? sample.colors : []
  const grid = []
  for (const cell of colors) {
    if (cell === null || typeof cell !== 'object') continue
    grid.push({
      r: clampByte(cell.r),
      g: clampByte(cell.g),
      b: clampByte(cell.b),
    })
  }
  if (grid.length !== GRID * GRID) return { ok: false, reason: `unexpected sample size ${grid.length}` }
  return {
    ok: true,
    grid: GRID,
    wallpaper: typeof sample.wallpaper === 'string' ? sample.wallpaper : '',
    colors: grid,
    // The desktop thumbnail (base64 RGB) the browser crops the window rect from;
    // null when the sampler could not produce one, and then the browser falls
    // back to the whole-wallpaper palette above.
    desktop: normalizeDesktop(sample.desktop),
    style: normalizeStyle(sample),
    sampledAt: Date.now(),
  }
}

/** Validate the base64 desktop thumbnail. */
function normalizeDesktop(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const w = Math.round(Number(raw.w))
  const h = Math.round(Number(raw.h))
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h)) return null
  if (w < 2 || h < 2 || w * h > 512 * 512) return null
  if (typeof raw.rgb !== 'string' || raw.rgb === '') return null
  // Base64 carries 3 bytes per 4 characters; a short payload cannot be the image.
  if (Math.ceil((raw.rgb.length * 3) / 4) < w * h * 3) return null
  return { w, h, rgb: raw.rgb }
}

/** Validate the wallpaper placement (Fill when the registry has nothing). */
function normalizeStyle(sample) {
  const style = typeof sample.wallpaperStyle === 'string' ? sample.wallpaperStyle.trim() : ''
  const tile = typeof sample.tile === 'string' ? sample.tile.trim() : ''
  return {
    wallpaperStyle: /^(?:0|2|6|10|22)$/u.test(style) ? style : '10',
    tile: tile === '1' ? '1' : '0',
  }
}

/** Coerce one channel to 0..255. */
function clampByte(value) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : 0
}

/**
 * Register the palette route (best effort — a host without a Web server keeps
 * the rest of the plugin working).
 * @param ctx - host context.
 */
export function apply(ctx) {
  /** @type {{ at: number, value: object } | null} */
  let cache = null
  let inFlight = null

  async function palette() {
    if (cache !== null && Date.now() - cache.at < SAMPLE_TTL_MS) return cache.value
    if (inFlight !== null) return inFlight
    inFlight = (async () => {
      const value = normalize(await sampleWallpaper())
      cache = { at: Date.now(), value }
      return value
    })()
    try {
      return await inFlight
    } finally {
      inFlight = null
    }
  }

  /**
   * Register one route through the optional Web server.
   * @param path - absolute route path.
   * @param handler - (req, res) handler.
   * @returns whether the route was registered.
   */
  const registerOne = (path, handler) => {
    const web = ctx.get('webServer') ?? ctx.get('httpServer')
    if (web === null || web === undefined || typeof web.register !== 'function') return false
    ctx.effect(() => web.register({ kind: 'exact', path, handler }), 'dsh-mica: ' + path)
    ctx.logger?.info?.(`[dsh-mica] route ready at ${path}`)
    return true
  }

  /** The palette route, registered lazily because the Web server is optional. */
  const registerRoute = () => registerOne(ROUTE_PATH, async (req, res) => {
    let body
    try {
      body = await palette()
    } catch (error) {
      body = { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    const json = JSON.stringify(body)
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(json),
    })
    res.end(json)
  })

  if (!registerRoute()) {
    // The Web server may bind after this row activates; wait for it once.
    ctx.effect(() => ctx.on('internal/service', (service) => {
      if (service === 'webServer' || service === 'httpServer') registerRoute()
    }), 'dsh-mica: await web server')
  }
}
