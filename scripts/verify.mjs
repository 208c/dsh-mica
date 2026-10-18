/**
 * Offline smoke test for the dsh-mica client bundle.
 *
 * Executes `lib/client.js` inside a minimal DOM + cordis shim and asserts the
 * observable contract: the loader protocol registers exactly one factory, the
 * factory returns a valid plugin, `apply()` paints the layer, the settings row
 * drives the store, and teardown removes everything it added.
 *
 * No test framework and no dependencies — run it with the bundled Node:
 *   <node> dsh-mica/scripts/verify.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
console.log('[verify] booting, root=' + ROOT)

//#region DOM shim
/** One attribute bag with just the element API the bundle touches. */
class ClassList {
  constructor(owner) { this.owner = owner }
  add(...names) { for (const n of names) this.owner.attrs[n] = '' }
  contains(name) { return Object.hasOwn(this.owner.attrs, name) }
  remove(...names) { for (const n of names) delete this.owner.attrs[n] }
}

class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase()
    this.nodeType = 1
    this.ownerDocument = ownerDocument
    this.attrs = {}
    this.children = []
    this.parentNode = null
    this.textContent = ''
    this.style = new Style()
    this.dataset = new Proxy({}, {
      set: (target, key, value) => { target[key] = value; this.attrs['data-' + camelToDash(String(key))] = String(value); return true },
      get: (target, key) => target[key],
    })
    this.classList = new ClassList(this)
  }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name) }
  removeAttribute(name) { delete this.attrs[name] }
  toggleAttribute(name, force) {
    const on = force === undefined ? !this.hasAttribute(name) : Boolean(force)
    if (on) this.setAttribute(name, ''); else this.removeAttribute(name)
    return on
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child }
  insertBefore(child, before) {
    child.parentNode = this
    const at = before === null ? this.children.length : this.children.indexOf(before)
    this.children.splice(at === -1 ? this.children.length : at, 0, child)
    return child
  }
  removeChild(child) {
    const at = this.children.indexOf(child)
    if (at !== -1) this.children.splice(at, 1)
    child.parentNode = null
    return child
  }
  remove() { if (this.parentNode !== null) this.parentNode.removeChild(this) }
  hasChildNodes() { return this.children.length > 0 }
  get isConnected() {
    let node = this
    while (node !== null) { if (node === this.ownerDocument.documentElement) return true; node = node.parentNode }
    return false
  }
  get firstElementChild() { return this.children.find((c) => c.tagName) ?? null }
  get firstChild() { return this.children[0] ?? null }
  /** Tag-name matcher good enough for `main, aside, header, nav`. */
  querySelectorAll(selector) {
    const wanted = String(selector)
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => /^[a-z]+$/.test(part))
    if (wanted.length === 0) return []
    return this.walk().filter((el) => wanted.includes(el.tagName.toLowerCase()))
  }
  /** Depth-first walk of the subtree (test helper). */
  walk() {
    const out = []
    const visit = (node) => { for (const child of node.children) { out.push(child); visit(child) } }
    visit(this)
    return out
  }
  find(predicate) { return this.walk().find(predicate) ?? null }
  findAll(predicate) { return this.walk().filter(predicate) }
}

/** The subset of CSSStyleDeclaration the bundle uses. */
class Style {
  constructor() { this.properties = {} }
  setProperty(name, value) { this.properties[name] = String(value) }
  removeProperty(name) { delete this.properties[name] }
  getPropertyValue(name) { return this.properties[name] ?? '' }
}

class Document {
  constructor() {
    this.documentElement = new Element('html', this)
    this.head = new Element('head', this)
    this.body = new Element('body', this)
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
    this.byId = new Map()
  }
  createElement(tagName) { return new Element(tagName, this) }
  getElementById(id) { return this.byId.get(id) ?? null }
  querySelector() { return null }
  querySelectorAll() { return [] }
}

/** Install the shim globals for one scenario. */
function installGlobals({ rootTree = null, sample = null, geo = { x: 0, y: 0 } } = {}) {
  const document = new Document()
  if (rootTree !== null) {
    const root = document.createElement('div')
    root.setAttribute('id', 'root')
    document.body.appendChild(root)
    document.byId.set('root', root)
    if (rootTree === 'frame' || rootTree === 'wrapped') {
      // A DSH-shaped frame: three column panes inside the frame element, with the
      // conversation carrying the CSS-module class that marks it as the inner one.
      // 'wrapped' adds the shell wrapper the real app has between #root and the
      // frame - that extra level is what broke the old assumption.
      const frame = document.createElement('div')
      frame.setAttribute('class', 'BynINW_frame')
      const sidebar = document.createElement('aside')
      sidebar.setAttribute('class', 'BynINW_sidebarCol')
      const center = document.createElement('main')
      center.setAttribute('class', 'BynINW_centerCol')
      const rightbar = document.createElement('div')
      rightbar.setAttribute('class', 'BynINW_rightbarCol')
      frame.appendChild(sidebar)
      frame.appendChild(center)
      frame.appendChild(rightbar)
      if (rootTree === 'wrapped') {
        const wrapper = document.createElement('div')
        wrapper.setAttribute('class', 'dsh-web-shell')
        wrapper.appendChild(frame)
        root.appendChild(wrapper)
      } else {
        root.appendChild(frame)
      }
    } else {
      const shell = document.createElement('div')
      shell.appendChild(document.createElement('main'))
      shell.appendChild(document.createElement('aside'))
      root.appendChild(shell)
    }
  }
  const storage = new Map()
  const listeners = new Map()
  const g = globalThis
  const define = (key, value) => Object.defineProperty(g, key, {
    value, writable: true, enumerable: true, configurable: true,
  })
  define('document', document)
  define('window', g)
  define('navigator', { platform: 'Win32', language: 'zh-CN' })
  define('screen', { width: 2560, height: 1440, availLeft: 0, availTop: 0 })
  // The tile is built at the viewport's aspect ratio: 1280x720 -> 240x135.
  define('innerWidth', 1280)
  define('innerHeight', 720)
  // Window geometry for the window-relative sampling: the window starts at the
  // top-left of a 2560x1440 monitor, so a 1280x720 viewport covers its top-left
  // quadrant.
  define('screenX', geo.x)
  define('screenY', geo.y)
  define('devicePixelRatio', 1)
  define('localStorage', {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)) },
    removeItem: (k) => { storage.delete(k) },
  })
  define('btoa', (binary) => Buffer.from(binary, 'binary').toString('base64'))
  define('atob', (text) => Buffer.from(String(text), 'base64').toString('binary'))
  define('setTimeout', () => 0) // the palette probe stays unresolved in tests
  define('clearTimeout', () => {})
  // The follower's waker interval is recorded, so a test can fire it.
  const intervals = new Map()
  let intervalId = 0
  define('setInterval', (fn) => { intervalId += 1; intervals.set(intervalId, fn); return intervalId })
  define('clearInterval', (id) => { intervals.delete(id) })
  // Animation frames are queued, so a test can pump the follower frame by frame.
  const frames = new Map()
  let frameId = 0
  define('requestAnimationFrame', (fn) => { frameId += 1; frames.set(frameId, fn); return frameId })
  define('cancelAnimationFrame', (id) => { frames.delete(id) })
  // Without a supplied sample the host route is treated as unreachable, which
  // is the desktop-shell / non-Windows case.
  define('fetch', () => (sample === null
    ? Promise.reject(new Error('offline test'))
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(sample) })))
  define('AbortController', class { constructor() { this.signal = {} } abort() {} })
  define('addEventListener', (type, fn) => { listeners.set(type, fn) })
  define('removeEventListener', (type) => { listeners.delete(type) })
  g.window.document = document
  return { document, storage, localStorage: g.localStorage, listeners, frames, intervals }
}
//#endregion

//#region cordis shim
/** A recording cordis context: collects effects, listeners and slot rows. */
function makeContext() {
  const effects = []
  const listeners = []
  const slotRegistrations = []
  const tokenLayers = []
  let theme = { active: { colorScheme: 'dark' } }
  const services = {
    locale: {
      register: (ns, dicts) => ({ ns, dicts }),
      bind: () => (key) => key, // identity: the row falls back to its defaults
    },
  }
  const ctx = {
    effect(callback, label) {
      const disposer = callback()
      effects.push({ label, dispose: typeof disposer === 'function' ? disposer : () => {} })
      return disposer
    },
    on(name, callback) { listeners.push({ name, callback }); return () => {} },
    get(name) { return services[name] },
    theme: {
      getTheme: () => theme,
      overrideTokens(source, tokens) {
        tokenLayers.push({ source, tokens })
        return () => {
          const at = tokenLayers.findIndex((layer) => layer.source === source)
          if (at !== -1) tokenLayers.splice(at, 1)
        }
      },
    },
    slots: {
      inject(name, register) { slotRegistrations.push({ name, registration: register() }) },
      register(options, component) { return { options, component } },
    },
  }
  return {
    ctx,
    effects,
    listeners,
    slotRegistrations,
    tokenLayers,
    setScheme(scheme) { theme = { active: { colorScheme: scheme } } },
  }
}
//#endregion

//#region element helpers
/** Depth-first list of the element tree produced by `React.createElement`. */
function flatten(node) {
  const out = []
  const visit = (current) => {
    if (current === null || current === undefined || typeof current !== 'object') return
    if (Array.isArray(current)) { current.forEach(visit); return }
    if (current.type === undefined) return
    out.push(current)
    if (Array.isArray(current.children)) current.children.forEach(visit)
    else if (current.children !== undefined) visit(current.children)
  }
  visit(node)
  return out
}
//#endregion

//#region loader harness
/** Load the client bundle and capture its registered factory. */
function loadFactory() {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const registrations = []
  globalThis.window = globalThis
  globalThis.__ModuleLoader__ = { load: (entry) => registrations.push(entry) }
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', source)(globalThis, () => ({}))
  assert.equal(registrations.length, 1, 'the bundle must register exactly one module')
  assert.equal(registrations[0].id, 'dsh-mica', 'the module id must be the package name')
  assert.equal(typeof registrations[0].factory, 'function', 'the entry must carry a factory')
  return registrations[0].factory
}

/** The minimum platform module table the factory requires. */
function platformModules() {
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }
  return (name) => {
    if (name === 'react') return { default: react }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { default: {} }
    throw new Error('unexpected platform module: ' + name)
  }
}
//#endregion

//#region tests
const results = []
/** Queue one test; the queue is drained sequentially below. */
function test(name, fn) { cases.push({ name, fn }) }
const cases = []

const factory = installGlobals() && loadFactory()

test('factory exports the plugin contract', () => {
  const plugin = factory(platformModules())
  assert.equal(plugin.name, 'dsh-mica')
  assert.deepEqual(plugin.inject, ['slots', 'theme'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply paints the Mica layer and registers the settings row', () => {
  const env = installGlobals({ rootTree: true })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)

  const html = env.document.documentElement
  assert.equal(html.getAttribute('data-dsh-mica'), 'mica', 'the root attribute scopes the stylesheet')
  const ROOT_ATTR = 'data-dsh-mica'

  const backdrop = env.document.body.find((el) => el.hasAttribute('data-dsh-mica-backdrop'))
  assert.ok(backdrop !== null, 'the backdrop element must be mounted')
  for (const hook of ['data-dsh-mica-wallpaper', 'data-dsh-mica-tint', 'data-dsh-mica-veil', 'data-dsh-mica-grain', 'data-dsh-mica-fill', 'data-dsh-mica-relief']) {
    assert.ok(backdrop.find((el) => el.hasAttribute(hook)) !== null, 'backdrop must contain ' + hook)
  }

  const image = html.style.getPropertyValue('--dsh-mica-image')
  assert.match(image, /^url\("data:image\/png;base64,/, 'the wallpaper tile must be an inlined PNG')

  const styleTag = env.document.head.find((el) => el.tagName === 'STYLE')
  assert.ok(styleTag !== null, 'the stylesheet must be injected into <head>')
  assert.ok(styleTag.textContent.includes('data-dsh-mica-backdrop'), 'the stylesheet must carry the backdrop rules')

  assert.equal(harness.slotRegistrations.length, 1, 'exactly one slot must be targeted')
  assert.equal(harness.slotRegistrations[0].name, 'settings.general.item')

  // Every top-level shell region is tagged, and the regions are TRANSPARENT:
  // the material behind them is the one surface they all share, so a region
  // that is never tagged still gets the same look.
  assert.equal(html.walk().filter((el) => el.hasAttribute('data-dsh-mica-glass')).length, 2)
  assert.match(styleTag.textContent, /\[data-dsh-mica-glass\][^}]*background-color: transparent !important/,
    'shell regions must not paint their own background over the material')
  const materialFill = html.style.getPropertyValue('--dsh-mica-material-fill')
  assert.match(materialFill, /^rgba\(/, 'the material itself must carry the fill')
  // The material is two zones now, so "solid" is the COMPOSITE the conversation
  // column shows: its plate over the outer sheet. The outer sheet alone is
  // deliberately thinner.
  const alphaOf = (name) => {
    const match = /,\s*([\d.]+)\)$/.exec(html.style.getPropertyValue(name))
    assert.ok(match !== null, name + ' must be an rgba colour')
    return Number(match[1])
  }
  const outerAlpha = alphaOf('--dsh-mica-material-fill')
  const plateAlpha = alphaOf('--dsh-mica-inner-fill')
  const innerAlpha = 1 - (1 - outerAlpha) * (1 - plateAlpha)
  assert.ok(innerAlpha >= 0.84, 'the conversation composite must be at least 0.84, got ' + innerAlpha.toFixed(3))
  assert.ok(1 - innerAlpha <= 0.17, 'it may leave at most ~17% of the wallpaper, got ' + (1 - innerAlpha).toFixed(3))
  assert.ok(outerAlpha < 0.7, 'the outer sheet must stay thinner than the conversation, got ' + outerAlpha.toFixed(3))
  assert.ok(Number(html.style.getPropertyValue('--dsh-mica-wall-sat')) <= 100, 'the wallpaper must be neutralised at full strength')

  // The flat fill erases the desktop's relief, so the layer has to put it back
  // - and only as a soft-light term, never as wallpaper colour. It has to sit
  // ABOVE the fill, or the fill attenuates the desktop back down to a trace.
  const relief = Number(html.style.getPropertyValue('--dsh-mica-relief'))
  assert.ok(relief >= 0.7, 'the desktop relief must be present at full strength, got ' + relief)
  assert.match(styleTag.textContent, /\[data-dsh-mica-relief\][^}]*mix-blend-mode: soft-light/, 'the relief must be a soft-light term')
  assert.ok(!/\[data-dsh-mica-relief\][^}]*background-color/.test(styleTag.textContent), 'the relief must not paint colour of its own')
  // Soft-light's neutral input is mid grey: the relief's mean has to be scaled
  // onto it, or the blend lifts the whole surface instead of shading it.
  assert.match(styleTag.textContent, /\[data-dsh-mica-relief\][^}]*brightness\(var\(--dsh-mica-relief-tone/, 'the relief must be re-centred on mid grey')
  const tone = Number(html.style.getPropertyValue('--dsh-mica-relief-tone'))
  assert.ok(tone > 0.5 && tone < 2, 'the relief tone must be a sane scale factor, got ' + tone)

  // A rule declared twice silently drops the earlier one (the later wins), which
  // is exactly how the relief's brightness was once cancelled by a stale copy of
  // its own rule. Only top-level rules count: a @media override is legitimate.
  const rules = []
  const bodies = []
  let depth = 0
  let pending = ''
  for (const line of styleTag.textContent.split('\n')) {
    if (depth === 0) {
      const brace = line.indexOf('{')
      if (brace === -1) {
        // A selector list may be spread over several lines.
        const part = line.trim()
        if (part !== '' && part !== '}') pending += (pending === '' ? '' : ' ') + part
        continue
      }
      rules.push((pending + ' ' + line.slice(0, brace)).trim())
      bodies.push(line.slice(brace + 1))
      pending = ''
    } else {
      bodies[bodies.length - 1] += '\n' + line
    }
    if (line.includes('{')) depth += 1
    if (line.includes('}')) depth -= 1
  }
  const bodyOf = (selector) => {
    const at = rules.indexOf(selector)
    return at === -1 ? null : bodies[at]
  }
  assert.ok(rules.length > 15, 'the stylesheet must carry its rules, found ' + rules.length)
  assert.equal(new Set(rules).size, rules.length, 'no selector may be declared twice: ' + rules.join(' | '))
  const order = ['data-dsh-mica-grain', 'data-dsh-mica-fill', 'data-dsh-mica-relief']
    .map((hook) => backdrop.children.findIndex((el) => el.hasAttribute(hook)))
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'grain, then the fill, then the relief on top')

  // The alias-token layer rides the theme override stack.
  assert.equal(harness.tokenLayers.length, 1)
  assert.equal(harness.tokenLayers[0].source, 'dsh-mica')
  assert.ok(harness.tokenLayers[0].tokens['--dsw-alias-bg-layer-1'].dark.startsWith('rgba('))

  // A translucent surface without a backplate shows whatever is behind it SHARP
  // (DSH ships these opaque, so their components install no filter of their own).
  // The composer plate must live on a `::before` LAYER, never on the card itself:
  // a filtered element is a backdrop root, Chromium then ignores `backdrop-filter`
  // on every descendant of it, and DSH renders the slash-command and @ menus
  // INSIDE `[data-composer-card]` (MenuView resolves `closest("[data-composer-card]")`).
  // Filtering the card was therefore what made those popups leak the transcript.
  const composerRule = bodyOf('html[' + ROOT_ATTR + '] [data-composer-card]')
  assert.ok(composerRule !== null, 'the composer must have a rule')
  assert.ok(!/filter/.test(composerRule), 'the composer card must not filter: its popups live inside it')
  assert.match(composerRule, /isolation: isolate/, 'the composer must isolate its plate layer')
  assert.match(composerRule, /background-color: transparent/, 'the card keeps no fill of its own')
  const plateRule = bodyOf('html[' + ROOT_ATTR + '] [data-composer-card]::before')
  assert.ok(plateRule !== null, 'the composer needs a ::before plate')
  assert.match(plateRule, /backdrop-filter/, 'the composer plate must blur')
  assert.match(plateRule, /z-index: -1/, 'the plate must sit behind the card content')
  assert.match(plateRule, /var\(--dsw-specific-input-major\)/, 'the plate paints the composer fill')

  // Menus are the opposite case: every DSH menu goes through `MenuSurface`, which
  // owns a `[data-menu-material]` surface plus a `.material` child that paints
  // `--dsw-menu-surface-fill` under `blur(40px)`. A second filter on the surface
  // stacks two blurs over one fill - a doubled plate - and it would also catch the
  // menu's inner `role="listbox"` viewport. Nothing may filter those.
  for (let at = 0; at < rules.length; at += 1) {
    const selector = rules[at]
    // `:not([data-menu-material])` claims the surfaces that own NO material, which
    // is the opposite of the rule this test is about.
    const claimed = selector.replace(/:not\([^)]*\)/g, '')
    if (!/data-menu-material|role="listbox"/.test(claimed)) continue
    if (/@media/.test(selector) && !/backdrop-filter/.test(bodies[at])) continue
    assert.ok(!/backdrop-filter/.test(bodies[at]),
      'no rule may filter a menu material or a menu listbox (' + selector + '): that double-plates the menu')
  }
  // Surfaces without a material of their own still get one, minus the menu family.
  // The docking kit's tab menu is exactly that: `role="menu"`, a border, and no
  // background at all, so the plate has to paint a fill as well as a blur.
  const popoverRule = rules.find((selector) => /\[role="menu"\]:not\(\[data-menu-material\]\)/.test(selector))
  assert.ok(popoverRule !== undefined, 'popovers without a material still need a backplate')
  assert.match(bodyOf(popoverRule), /backdrop-filter/, 'that backplate must blur')
  assert.match(bodyOf(popoverRule), /background-color: var\(--dsw-menu-surface-fill\)/,
    'a menu with no material of its own must be painted with the menu fill, or the blur shows a hole')

  // CONTAINERS may not be filtered THEMSELVES: a dialog holds menus and tooltips,
  // the dock's float holds its tab menu. A filtered ancestor silently unblurs
  // every popup inside it. They keep a frosted plate through a negative-z child
  // layer instead (`::before`), exactly like the composer.
  for (let at = 0; at < rules.length; at += 1) {
    const selector = rules[at]
    if (/::before|::after/.test(selector)) continue
    const claimed = selector.replace(/:not\([^)]*\)/g, '')
    if (!/role="dialog"|aria-modal|data-dockkit-float/.test(claimed)) continue
    if (/@media/.test(selector)) continue
    assert.ok(!/backdrop-filter/.test(bodies[at]),
      'containers must not filter (' + selector + '): that unblurs the menus and tooltips inside them')
    assert.match(bodies[at], /background-color: transparent/,
      'the container keeps the plate on its ::before, not on itself (' + selector + ')')
    assert.match(bodies[at], /isolation: isolate/,
      'the container must isolate its plate layer (' + selector + ')')
  }
  // The image lightbox is `role="dialog" aria-modal="true"` too, but it is a
  // full-viewport container with no background of its own; a fill there would
  // cover the whole window. It is the copy WITHOUT `tabindex`, so the dialog rule
  // must be scoped by `[tabindex]`.
  const dialogRule = rules.find((selector) => /\[aria-modal="true"\]\[tabindex\]/.test(selector) && !/::before/.test(selector))
  assert.ok(dialogRule !== undefined, 'the dialog card must be scoped by [tabindex]')
  const dialogPlate = rules.find((selector) => /\[aria-modal="true"\]\[tabindex\]::before/.test(selector))
  assert.ok(dialogPlate !== undefined, 'dialogs need a ::before plate (the settings panel is one)')
  assert.match(bodyOf(dialogPlate), /backdrop-filter/, 'the dialog plate must blur')
  assert.match(bodyOf(dialogPlate), /z-index: -1/, 'the dialog plate must sit behind the card content')
  assert.match(bodyOf(dialogPlate), /var\(--dsh-mica-dialog-fill\)/, 'the plate paints the dialog fill')
  // ...and that fill has to be genuinely glassy, not a near-solid card: the plate
  // already has a 40px blur, so extra opacity only hides the material. The last
  // report was "the light-mode settings panel is still not transparent enough",
  // which is exactly what an alpha above ~0.75 looks like on a light palette.
  const dialogFill = html.style.getPropertyValue('--dsh-mica-dialog-fill')
  const dialogAlpha = Number(/,\s*([\d.]+)\)$/.exec(dialogFill)?.[1] ?? '1')
  assert.ok(dialogAlpha > 0.3 && dialogAlpha <= 0.6,
    'the dialog plate must stay glassy (0.3 < alpha <= 0.6), got ' + dialogAlpha + ' from ' + dialogFill)

  // THE RIGHT SIDEBAR: a work surface when docked, an overlay sheet when
  // maximized. Both are a `::before` LAYER inside the panel, never a background
  // ON the panel: the panel itself does not move when the sidebar collapses - only
  // its dock children slide out - so a panel-level fill stayed behind as a white
  // sheet covering the conversation after "collapse".
  const panelRule = bodyOf('html[' + ROOT_ATTR + '] [data-sidebar-right-panel]')
  assert.ok(panelRule !== null, 'the right panel must have a rule')
  assert.match(panelRule, /isolation: isolate/, 'the panel must isolate its plate layer')
  for (let at = 0; at < rules.length; at += 1) {
    const selector = rules[at]
    if (!/\[data-sidebar-right-panel/.test(selector)) continue
    if (/::before/.test(selector) || /@media/.test(selector)) continue
    assert.ok(!/background/.test(bodies[at]),
      'no background may live on the panel itself (' + selector + '): it would survive the collapse')
  }
  const panelPlate = bodyOf('html[' + ROOT_ATTR + '] [data-sidebar-right-panel]::before')
  assert.ok(panelPlate !== null, 'the right sidebar needs a plate')
  assert.match(panelPlate, /var\(--dsh-mica-inner-fill\)/, 'docked, the right sidebar is the conversation material')
  assert.match(panelPlate, /z-index: -1/, 'the plate must sit behind the panel content')
  assert.match(panelPlate, /transform: translateX\(var\(--dsh-sidebar-width/,
    'the plate must slide out with the dock contents')
  const panelOpen = bodyOf('html[' + ROOT_ATTR + '] [data-sidebar-right-panel][data-sidebar-right-open]::before')
  assert.ok(panelOpen !== null, 'the open state must reset the plate slide')
  assert.match(panelOpen, /transform: none/, 'an open panel sits still')

  // The maximized sheet has to win the paint order as well as the fill: the
  // conversation's composer seat is sticky at z-index 7 (9 while a slash menu is
  // open) and its view tabs sit at 1, so a `z-index: auto` panel leaves the
  // composer and the tab strip visible ON TOP of it.
  const fullscreenRule = bodyOf('html[' + ROOT_ATTR + '] [data-sidebar-right-panel="fullscreen"]')
  assert.ok(fullscreenRule !== null, 'the fullscreen sheet must have a rule')
  const sheetZ = /z-index:\s*(\d+)/.exec(fullscreenRule)
  assert.ok(sheetZ !== null, 'the fullscreen sheet must set a z-index')
  assert.ok(Number(sheetZ[1]) >= 10,
    'the sheet must clear the conversation layers (composer seat 7/9, tabs 1), got ' + sheetZ[1])
  const sheetPlate = bodyOf('html[' + ROOT_ATTR + '] [data-sidebar-right-panel="fullscreen"]::before')
  assert.ok(sheetPlate !== null, 'the maximized sheet is a plate too')
  assert.match(sheetPlate, /background-color: var\(--dsh-mica-inner-fill\)/,
    'maximized, the panel must paint the SAME plate as docked: maximizing changes the box, not the material')
  assert.match(sheetPlate, /border-radius: var\(--dsh-windows-content-radius, 16px\) 0 0 0/,
    'the sheet must repeat the conversation 16px top-left notch at the same boundary')
  assert.match(sheetPlate, /--dsh-mica-edge/, 'the sheet carries the boundary hairline')
  // A translucent sheet needs a CONTINUOUS backdrop. The conversation plate ends
  // at the right column's track, so letting the material through would print the
  // plate's edge as a hard vertical step inside the sheet. DSH's own
  // `data-rightbar-fullscreen` marks exactly the maximized state, and the plate
  // steps aside for it.
  const sheetBackdrop = bodyOf('html[' + ROOT_ATTR
    + '] [data-dsh-mica-frame][data-rightbar-fullscreen] [data-dsh-mica-inner]::before')
  assert.ok(sheetBackdrop !== null, 'the maximized sheet needs a continuous backdrop')
  assert.match(sheetBackdrop, /display: none/,
    'the conversation plate must step aside while the translucent sheet is up, or its edge shows through')
  // The pane itself must stop painting too: even at the plate's density the
  // transcript read through the sheet as a second layer of type. It may only be
  // hidden with `visibility` - `display: none` would drop the column out of the
  // frame's grid and move the sheet's left edge off the inner/outer boundary.
  const hiddenPane = bodyOf('html[' + ROOT_ATTR
    + '] [data-dsh-mica-frame][data-rightbar-fullscreen] [data-dsh-mica-inner]')
  assert.ok(hiddenPane !== null, 'the covered conversation pane must have a rule')
  assert.match(hiddenPane, /visibility: hidden/, 'the covered pane must not paint through the sheet')
  assert.ok(!/display:\s*none/.test(hiddenPane),
    'the pane must stay in the grid: display:none would move the maximized sheet off the boundary')
  // One material, two presentations: a separate maximized fill is exactly what
  // made the docked and maximized states read as two different surfaces.
  assert.equal(html.style.getPropertyValue('--dsh-mica-fullscreen-fill'), '',
    'there must be no separate maximized fill')
  assert.ok(!/var\(--dsh-mica-solid-fill\)/.test(sheetPlate),
    'the maximized sheet must not fall back to the opaque fill: that is the sheet that hid the conversation')

  // ...and NOTHING on the path from those surfaces to the document root may carry
  // a filter either. The shell regions sit on that path.
  const regionRule = bodyOf('html[' + ROOT_ATTR + '] [data-dsh-mica-glass]')
  assert.ok(regionRule !== null, 'the regions must have a rule')
  assert.ok(!/filter/.test(regionRule), 'the region rule must not filter: that kills nested backplates')
  assert.match(regionRule, /background-color: transparent/, 'regions stay transparent over the material')

  // The desktop backdrop is the one layer that MOVES, so it may not carry a
  // filter either: a filtered layer is re-rasterised whenever its box moves
  // through new tiles, which would put the per-frame blur straight back. The
  // blur and the saturation are baked into the texture instead, and the motion
  // is a transform on an already-rasterised layer.
  const desktopLayers = bodyOf('html[' + ROOT_ATTR + '][data-dsh-mica-source="desktop"] [data-dsh-mica-wallpaper], '
    + 'html[' + ROOT_ATTR + '][data-dsh-mica-source="desktop"] [data-dsh-mica-relief]')
  assert.ok(desktopLayers !== null, 'the desktop layers need their own rule')
  assert.match(desktopLayers, /filter: none/, 'the moving backdrop must not filter per frame')
  assert.match(desktopLayers, /will-change: transform/, 'the moving backdrop must stay on the compositor')
  assert.match(desktopLayers, /transform: translate3d\(var\(--dsh-mica-shift-x/,
    'the moving backdrop must be moved by transform, not by background-position')
  assert.match(desktopLayers, /width: var\(--dsh-mica-frame-w/, 'the backdrop is placed at the wallpaper rect')
  const tokens = harness.tokenLayers[0].tokens
  const surfaceAlpha = (name) => Number(/,\s*([\d.]+)\)$/.exec(tokens[name].light)[1])
  for (const token of ['--dsw-specific-input-major', '--dsw-specific-tip', '--dsw-specific-selector']) {
    assert.ok(surfaceAlpha(token) >= 0.8, token + ' must stay close to solid, got ' + surfaceAlpha(token))
  }
  // DSH paints tooltips and toasts DARK in both palettes and colours their copy
  // with a hard-coded white, so a light fill here is unreadable. Both must stay
  // dark (low luminance) while still letting the material through (alpha < 1).
  const tokenChannels = (name, scheme) => {
    const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(tokens[name][scheme])
    assert.ok(match !== null, name + ' must be an rgba() colour, got ' + tokens[name][scheme])
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4]) }
  }
  for (const token of ['--dsw-alias-tooltip-bg', '--dsw-alias-toast-bg']) {
    for (const scheme of ['light', 'dark']) {
      const colour = tokenChannels(token, scheme)
      const luma = (0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b) / 255
      assert.ok(luma < 0.35, token + ' (' + scheme + ') must stay dark: its copy is hard-coded white, got luma ' + luma.toFixed(2))
      assert.ok(colour.a > 0.7 && colour.a < 1, token + ' (' + scheme + ') must be translucent but still a plate')
    }
  }
  // The menu material belongs to DSH: `MenuSurface` paints it and every frosted
  // popover pairs `--dsw-specific-menu` with the global `--dsw-menu-backdrop-filter`,
  // so the plugin must not touch either token - a hand-made fill there is what
  // produced the doubled plate and the solid band on the slash menu's scroll fade.
  for (const token of ['--dsw-specific-menu', '--dsw-menu-surface-fill', '--dsw-menu-backdrop-filter']) {
    assert.equal(tokens[token], undefined, token + ' belongs to DSH and must be left alone')
  }
  // ... while the layout layers stay translucent, or the material stops showing.
  assert.ok(surfaceAlpha('--dsw-alias-bg-layer-1') <= 0.65, 'layout layers must stay translucent')
  // The shell is the material, not a fill of its own. This token paints the
  // sidebar (and the frame in the Windows layout); leaving it translucent made
  // the sidebar paler than the title strip, i.e. two materials in one shell.
  assert.equal(surfaceAlpha('--dsw-specific-sidebar-fill'), 0, 'the sidebar token must paint nothing')
})

test('the material is two zones: a thin shell and a rounded inner pane', async () => {
  const env = installGlobals({ rootTree: 'frame' })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  const root = env.document.getElementById('root')
  const frame = root.firstElementChild
  const classOf = (el) => el.getAttribute('class') ?? ''
  const center = frame.children.find((el) => classOf(el).includes('_centerCol'))
  const sidebar = frame.children.find((el) => classOf(el).includes('_sidebarCol'))

  assert.equal(frame.hasAttribute('data-dsh-mica-frame'), true, 'the frame must be marked')
  assert.equal(center.hasAttribute('data-dsh-mica-inner'), true, 'the conversation column must be marked inner')
  assert.equal(center.hasAttribute('data-dsh-mica-glass'), true, 'the conversation is still a region')
  assert.equal(sidebar.hasAttribute('data-dsh-mica-glass'), true, 'the sidebar is still a region')
  assert.equal(sidebar.hasAttribute('data-dsh-mica-inner'), false, 'the sidebar must not get the inner plate')

  // The plate owns the corner and the hairline; the column itself must not be
  // filtered - a filtered ancestor is a backdrop root, and the composer and every
  // in-column menu live inside the conversation.
  const css = env.document.head.find((el) => el.tagName === 'STYLE').textContent
  const ruleAt = (selector) => {
    const at = css.indexOf(selector + ' {')
    assert.ok(at !== -1, selector + ' must have a rule')
    return css.slice(at, css.indexOf('}', at))
  }
  const column = ruleAt('html[data-dsh-mica] [data-dsh-mica-inner]')
  assert.ok(!/filter/.test(column), 'the conversation column must not filter')
  assert.match(column, /isolation: isolate/, 'the plate needs its own stacking context')
  assert.match(column, /border-radius: var\(--dsh-windows-content-radius, 16px\) 0 0 0/,
    "the corner must be DSH's own 16px, top-left only")
  const plate = ruleAt('html[data-dsh-mica] [data-dsh-mica-inner]::before')
  assert.match(plate, /background-color: var\(--dsh-mica-inner-fill\)/, 'the plate paints the inner fill')
  assert.match(plate, /border-radius: inherit/, 'the plate follows the corner')
  assert.ok(!/backdrop-filter/.test(plate), 'the plate must not blur: that would re-blur the window every frame')
  // The hairline is an overlay above the conversation's own content, or its
  // header strip would cover it.
  const ring = ruleAt('html[data-dsh-mica] [data-dsh-mica-inner]::after')
  assert.match(ring, /inset 1px 0 0 var\(--dsh-mica-edge\)/, 'the hairline runs down the left edge')
  assert.match(ring, /inset 0 1px 0 var\(--dsh-mica-edge\)/, 'and along the top edge')
  assert.match(ring, /pointer-events: none/, 'the hairline must not eat clicks')
  assert.match(ring, /z-index: 1/, 'the hairline must sit above the column content')
  const strip = ruleAt('html[data-dsh-mica] [data-dsh-mica-frame]::before')
  assert.match(strip, /background-color: transparent/, 'the title strip is the outer sheet, not its own fill')
})

test('the frame is found even when the app wraps it', async () => {
  // The real desktop app puts the frame inside a shell element. The old tagging
  // assumed it was #root's first child, so it marked the WRAPPER and left the
  // columns painting their own fills: the sidebar kept its 46 % white and the
  // conversation never got its plate.
  const env = installGlobals({ rootTree: 'wrapped' })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  const root = env.document.getElementById('root')
  const wrapper = root.firstElementChild
  const frame = wrapper.firstElementChild
  const classOf = (el) => el.getAttribute('class') ?? ''
  const center = frame.children.find((el) => classOf(el).includes('_centerCol'))
  const sidebar = frame.children.find((el) => classOf(el).includes('_sidebarCol'))

  assert.equal(wrapper.hasAttribute('data-dsh-mica-glass'), true, 'the extra wrapper must be cleared as well')
  assert.equal(frame.hasAttribute('data-dsh-mica-frame'), true, 'the frame must be found through the wrapper')
  assert.equal(center.hasAttribute('data-dsh-mica-inner'), true, 'the conversation must be found through the wrapper')
  assert.equal(sidebar.hasAttribute('data-dsh-mica-glass'), true, 'the sidebar must be cleared')
})

test('the generated PNG tile is a decodable image payload', () => {
  const env = installGlobals()
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  const url = env.document.documentElement.style.getPropertyValue('--dsh-mica-image')
  const base64 = /base64,([^"]+)/.exec(url)[1]
  const bytes = Buffer.from(base64, 'base64')
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'PNG signature')
  assert.equal(bytes.subarray(12, 16).toString('latin1'), 'IHDR')
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  assert.equal(width, 240)
  // The tile carries the viewport's aspect ratio (1280x720), so the whole
  // sampled desktop reaches the screen instead of a centre crop of it.
  assert.equal(height, 135)
  assert.equal(bytes[24], 8, 'bit depth')
  assert.equal(bytes[25], 2, 'truecolour')
  // Chunk CRCs must verify, or no browser will decode it.
  let at = 8
  let chunks = 0
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.subarray(at + 4, at + 8).toString('latin1')
    const crc = bytes.readUInt32BE(at + 8 + length)
    assert.equal(crc >>> 0, crc32of(bytes.subarray(at + 4, at + 8 + length)), 'CRC mismatch in ' + type)
    chunks += 1
    at += 12 + length
  }
  assert.equal(at, bytes.length, 'chunk walk must consume the file exactly')
  assert.equal(chunks, 3, 'IHDR + IDAT + IEND')
})

test('the tile keeps BOTH axes of the wallpaper sample', async () => {
  // A sample that varies on both axes: bright top-left, dark right, blue top.
  // Reading a single column (or a single row) of this would lose an axis.
  const env = installGlobals({ rootTree: true, sample: { ok: true, wallpaper: 'C:\\wall\\desk.jpg', colors: gradientSample() } })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  await flush()

  assert.notEqual(env.document.documentElement.style.getPropertyValue('--dsh-mica-image'), '', 'the host sample must replace the procedural palette')
  const tile = decodeTile(env.document.documentElement.style.getPropertyValue('--dsh-mica-image'))
  assert.equal(tile.width, 240)
  assert.equal(tile.height, 135)
  // Horizontal: the sample runs 240 -> 58 in red from left to right.
  assert.ok(tile.columnMean(0, 20) - tile.columnMean(0, 219) > 100,
    'the tile must vary horizontally, left ' + tile.columnMean(0, 20).toFixed(0) + ' vs right ' + tile.columnMean(0, 219).toFixed(0))
  // Vertical: the sample runs 240 -> 84 in blue from top to bottom.
  assert.ok(tile.rowMean(2, 2) - tile.rowMean(2, 132) > 100,
    'the tile must vary vertically, top ' + tile.rowMean(2, 2).toFixed(0) + ' vs bottom ' + tile.rowMean(2, 132).toFixed(0))
  // The old bug in one assertion: no scanline may be a constant colour.
  for (const y of [4, 40, 67, 100, 131]) {
    assert.ok(tile.rowSpread(0, y) > 100, 'row ' + y + ' must not be a flat band, spread ' + tile.rowSpread(0, y))
  }
  // A generated tile fills its box; the sampled grid is a square area average,
  // so stretching it to the display aspect un-squashes the desktop again.
  assert.equal(env.document.documentElement.style.getPropertyValue('--dsh-mica-size'), '100% 100%')

  // The row's swatch is the same 2-D image, not a 1-D gradient.
  const registration = harness.slotRegistrations[0].registration
  const tree = registration.component(registration.options.inject())
  const swatch = flatten(tree).find((node) => node.props && node.props.className === 'dsh-mica-swatch')
  assert.ok(swatch !== undefined, 'the row must render its swatch')
  assert.match(swatch.props.style.backgroundImage, /^url\("data:image\/png;base64,/, 'the swatch must show the material tile')
  const used = flatten(tree).find((node) => node.type === 'span' && typeof node.children[0] === 'string' && node.children[0].includes('背景取自'))
  assert.ok(used.children[0].includes('跟随桌面'), 'the row must report the desktop sample, got ' + used.children[0])
})

test('the material follows the window with a transform, not a repaint', async () => {
  // A wallpaper whose LEFT half is red and RIGHT half is blue, laid out as Fill
  // over a 2560x1440 monitor. A 1280x720 window at the monitor's origin covers
  // exactly the red half; the same window at x=1280 covers the blue half.
  const env = installGlobals({ sample: desktopSample(), geo: { x: 0, y: 0 } })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  await flush()

  const html = env.document.documentElement
  const style = html.style
  const store = harness.slotRegistrations[0].registration.options.inject().store
  assert.equal(html.getAttribute('data-dsh-mica-source'), 'desktop',
    'a desktop sample must switch the backdrop to the desktop texture')

  // The texture is the WHOLE wallpaper, blurred once - not the crop.
  const texture = decodeTile(style.getPropertyValue('--dsh-mica-desktop'))
  assert.equal(texture.width, 128, 'the texture must keep the sample resolution')
  assert.ok(texture.columnMean(0, 2) > 180 && texture.columnMean(2, 2) < 60,
    'the texture must carry the red half, got r=' + texture.columnMean(0, 2).toFixed(0) + ' b=' + texture.columnMean(2, 2).toFixed(0))
  assert.ok(texture.columnMean(2, 125) > 180 && texture.columnMean(0, 125) < 60,
    'the texture must carry the blue half, got r=' + texture.columnMean(0, 125).toFixed(0) + ' b=' + texture.columnMean(2, 125).toFixed(0))
  const textureUrl = style.getPropertyValue('--dsh-mica-desktop')

  // It is placed at the wallpaper's own rect on the monitor...
  assert.equal(style.getPropertyValue('--dsh-mica-frame-w'), '2560px', 'the wallpaper fills the monitor width')
  assert.equal(style.getPropertyValue('--dsh-mica-frame-h'), '1440px', 'the wallpaper fills the monitor height')
  assert.equal(style.getPropertyValue('--dsh-mica-frame-x'), '0px', 'a Fill wallpaper starts at the monitor origin')
  assert.equal(style.getPropertyValue('--dsh-mica-shift-x'), '0px', 'a window at x=0 shifts nothing')

  // ...and a window move only SHIFTS it: the frame clock moves the texture, the
  // wallpaper is never rebuilt.
  globalThis.screenX = 1280
  pumpIntervals(env)
  pumpFrames(env, 1)
  assert.equal(style.getPropertyValue('--dsh-mica-shift-x'), '-1280px',
    'the texture must move by exactly the window delta')
  assert.equal(style.getPropertyValue('--dsh-mica-desktop'), textureUrl,
    'the texture must not be rebuilt while the window moves')
  assert.equal(style.getPropertyValue('--dsh-mica-image'), '',
    'desktop mode must paint no generated tile')

  // The colour cast still comes from the part of the wallpaper under the window.
  const tint = style.getPropertyValue('--dsh-mica-tint')
  assert.match(tint, /^rgba\(\d+, \d+, \d+, /, 'the tint must be an rgba colour, got ' + tint)
  const channels = tint.match(/\d+/g).map(Number)
  assert.ok(channels[2] > channels[0], 'the tint must turn blue over the blue half, got ' + tint)

  // Off the left edge the texture keeps moving instead of clamping into a black
  // band: the desktop continues under the window, so there is nothing to clamp.
  globalThis.screenX = -640
  pumpIntervals(env)
  pumpFrames(env, 6)
  assert.equal(style.getPropertyValue('--dsh-mica-shift-x'), '640px',
    'a window dragged past the left edge must keep sliding the wallpaper')

  // Turning the follower off restores the generated-tile path.
  globalThis.screenX = 0
  store.set('followWindow', false)
  assert.equal(html.getAttribute('data-dsh-mica-source'), 'tile',
    'whole-wallpaper mode must go back to the generated tile')
  const whole = decodeTile(style.getPropertyValue('--dsh-mica-image'))
  assert.ok(whole.columnMean(0, 20) - whole.columnMean(0, 219) > 100,
    'the whole-wallpaper mode must fit the entire image, got ' + whole.columnMean(0, 20).toFixed(0) + ' vs ' + whole.columnMean(0, 219).toFixed(0))
})

test('a window that leaves the screen keeps the edge colour cast', async () => {
  // The sample rect has to stay window-sized and INSIDE the monitor. Sampling
  // the real (partly off-desktop) rect repeats the wallpaper's edge pixels, and
  // the cast then drifts towards the edge colour as the window leaves the
  // screen - which the surface shows as a brightness change.
  const env = installGlobals({ sample: desktopSample(), geo: { x: 0, y: 0 } })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  await flush()

  const style = env.document.documentElement.style
  const store = harness.slotRegistrations[0].registration.options.inject().store
  const castAt = (x) => {
    globalThis.screenX = x
    store.renderMaterial()
    return style.getPropertyValue('--dsh-mica-tint') + '|' + style.getPropertyValue('--dsh-mica-material-fill')
  }
  const left = castAt(0)
  assert.equal(castAt(-640), left, 'half the window off the left edge must keep the edge cast')
  assert.equal(castAt(-1280), left, 'a window fully off the left edge must keep the edge cast')
  const right = castAt(1280)
  assert.notEqual(left, right, 'the cast must still follow the window across the desktop')
  assert.equal(castAt(1920), right, 'a window off the right edge must keep that edge cast')
})

test('the fill has no step where the contrast protection starts', async () => {
  // A luma ramp wallpaper walks the crop's mean through the protection
  // threshold. Under the old `if (protective > 0.84) fill = max(...)` that was a
  // one-frame step in the whole surface's opacity. Swept at 55 %, where the
  // protection still engages: at full strength the conversation's own base fill
  // (0.90) already sits above the floor, so the protection cannot add a step.
  const env = installGlobals({ sample: rampSample(), geo: { x: 0, y: 0 } })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  await flush()

  const style = env.document.documentElement.style
  const store = harness.slotRegistrations[0].registration.options.inject().store
  store.set('tintStrength', 55)
  const alphaOf = (name) => Number(/,\s*([\d.]+)\)$/.exec(style.getPropertyValue(name))[1])
  // What the conversation column actually shows: its plate over the outer sheet.
  const composite = () => 1 - (1 - alphaOf('--dsh-mica-material-fill')) * (1 - alphaOf('--dsh-mica-inner-fill'))
  const alphas = []
  for (let x = 0; x <= 1280; x += 16) {
    globalThis.screenX = x
    store.renderMaterial()
    alphas.push(composite())
  }
  const range = Math.max(...alphas) - Math.min(...alphas)
  assert.ok(range > 0.02, 'the sweep must cross into the protection, range was ' + range.toFixed(3))
  let maxStep = 0
  for (let i = 1; i < alphas.length; i += 1) maxStep = Math.max(maxStep, Math.abs(alphas[i] - alphas[i - 1]))
  // 16 px of window movement may move the composite smoothly; a THRESHOLD would
  // have jumped it by 0.31 for no movement at all.
  assert.ok(maxStep <= 0.04, 'the composite must not step at the protection threshold, biggest step was ' + maxStep.toFixed(3))
  assert.ok(Math.max(...alphas) >= 0.84, 'the protection must still reach its floor, got ' + Math.max(...alphas).toFixed(3))
})

test('at mid strength the tint luminance stays put while the window moves', async () => {
  // The tint is a flat colour sampled from the crop. Without pinning its
  // luminance, a 55 % material swung ~16 levels of mean brightness as an 800 px
  // window crossed a 2560 px desktop - the whole surface changed exposure.
  const env = installGlobals({ sample: rampSample(), geo: { x: 0, y: 0 } })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  await flush()

  const style = env.document.documentElement.style
  const store = harness.slotRegistrations[0].registration.options.inject().store
  store.set('tintStrength', 55)
  const lumas = []
  for (let x = 0; x <= 1280; x += 160) {
    globalThis.screenX = x
    store.renderMaterial()
    const channels = style.getPropertyValue('--dsh-mica-tint').match(/\d+/g).map(Number)
    lumas.push(0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2])
  }
  const spread = Math.max(...lumas) - Math.min(...lumas)
  assert.ok(spread <= 1.5,
    'the tint luminance must not follow the window, spread was ' + spread.toFixed(2))
  // ...and it must still be a tint, not a neutralised grey.
  assert.ok(Math.max(...lumas) > 40, 'the tint must stay visible, got ' + Math.max(...lumas).toFixed(1))
})

test('a drag writes transforms only, and the loop stops when the window rests', async () => {  const env = installGlobals({ sample: desktopSample(), geo: { x: 0, y: 0 } })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  await flush()

  const style = env.document.documentElement.style
  const texture = style.getPropertyValue('--dsh-mica-desktop')
  const realNow = Date.now
  let now = 1000
  Date.now = () => now
  try {
    for (let i = 1; i <= 10; i += 1) {
      // 13 px per frame is a 800 px/s drag at 60 Hz - the frame the material is
      // supposed to move by. At the old 120 ms cadence the same drag moved it
      // 96 px per step, which is the flicker this test guards against.
      now += 16
      globalThis.screenX = i * 13
      pumpIntervals(env)
      pumpFrames(env, 1)
      assert.equal(style.getPropertyValue('--dsh-mica-shift-x'), '-' + (i * 13) + 'px',
        'frame ' + i + ' must move the texture by exactly the window delta')
      assert.equal(style.getPropertyValue('--dsh-mica-desktop'), texture,
        'frame ' + i + ' must reuse the same texture')
      assert.equal(style.getPropertyValue('--dsh-mica-image'), '',
        'frame ' + i + ' must not repaint a tile')
    }
    // The loop keeps running only while the window is moving.
    now += 400
    pumpFrames(env, 1)
    assert.equal(env.frames.size, 0, 'the follower must stop scheduling once the window has rested')
  } finally {
    Date.now = realNow
  }
})

test('letterboxed wallpaper placement insets the texture and keeps the bars black', async () => {
  // "Fit" (WallpaperStyle 6) with a square image on a 16:9 monitor: the image is
  // centred with black bars at both sides.
  const env = installGlobals({ sample: desktopSample({ w: 128, h: 128, style: '6' }), geo: { x: 0, y: 0 } })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  await flush()

  const style = env.document.documentElement.style
  assert.equal(style.getPropertyValue('--dsh-mica-frame-w'), '1440px', 'a fitted square is 1440 px tall')
  assert.equal(style.getPropertyValue('--dsh-mica-frame-h'), '1440px')
  assert.equal(style.getPropertyValue('--dsh-mica-frame-x'), '560px', 'a fitted square is centred horizontally')
  assert.equal(style.getPropertyValue('--dsh-mica-frame-y'), '0px')
  const texture = decodeTile(style.getPropertyValue('--dsh-mica-desktop'))
  assert.equal(texture.width, 128, 'the texture is the image, not the monitor')
  assert.equal(texture.height, 128)
  // The bars come from the backdrop's own base colour, which is black only in
  // desktop mode: Windows letterboxes a wallpaper with black, not with paint.
  const styleTag = env.document.head.find((el) => el.tagName === 'STYLE')
  assert.match(styleTag.textContent,
    /\[data-dsh-mica-source="desktop"\] \[data-dsh-mica-backdrop\] \{\n  background-color: #000;/)
})

test('an unreachable host route falls back and says so', async () => {
  const env = installGlobals({ rootTree: true })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)
  await flush()

  const registration = harness.slotRegistrations[0].registration
  const tree = registration.component(registration.options.inject())
  const used = flatten(tree).find((node) => node.type === 'span' && typeof node.children[0] === 'string' && node.children[0].includes('背景取自'))
  assert.ok(used.children[0].includes('本地生成'), 'the fallback must be labelled, got ' + used.children[0])
  assert.ok(used.children[0].includes('桌面采样不可用'), 'the reason must be surfaced, got ' + used.children[0])
  // The procedural fallback is 2-D too: a vertical ramp would be flat per row.
  const tile = decodeTile(env.document.documentElement.style.getPropertyValue('--dsh-mica-image'))
  assert.ok(tile.rowSpread(0, 67) > 8, 'the procedural backdrop must not be horizontal bands, spread ' + tile.rowSpread(0, 67))
})

test('the settings row reflects and writes the store', () => {
  const env = installGlobals()
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)

  // The slot registration options are exactly what the slot contract requires.
  const registration = harness.slotRegistrations[0].registration
  assert.deepEqual(registration.options, { name: 'settings.general.item', id: 'mica', order: 18, inject: registration.options.inject })
  assert.equal(typeof registration.options.inject, 'function')

  // The row owns its copy and write path through its own inject face.
  const face = registration.options.inject()
  assert.ok(face.store !== undefined && typeof face.store.set === 'function')
  assert.equal(typeof face.t, 'function')

  const component = registration.component
  assert.equal(typeof component, 'function')
  const tree = component(registration.options.inject())
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'dsh-mica-row')
  const switchButton = flatten(tree).find((node) => node.props && node.props.className === 'dsh-mica-switch')
  assert.ok(switchButton !== undefined, 'the row must render its switch')
  assert.equal(switchButton.props.role, 'switch')
  assert.equal(switchButton.props['aria-checked'], true, 'Mica is on by default')
  const rangeInputs = flatten(tree).filter((node) => node.type === 'input' && node.props.type === 'range')
  assert.equal(rangeInputs.length, 3, 'tint / blur / noise sliders')

  // Writing through the face repaints the layer and persists the value.
  face.store.set('blur', 34)
  assert.equal(env.document.documentElement.style.getPropertyValue('--dsh-mica-blur'), '34px')
  assert.match(env.localStorage.getItem('dsh.mica.settings'), /"blur":34/)
})

test('the settings row collapses to the switch while disabled', () => {
  const env = installGlobals()
  const plugin = factory(platformModules())
  env.localStorage.setItem('dsh.mica.settings', JSON.stringify({ enabled: false }))
  const harness = makeContext()
  plugin.apply(harness.ctx)
  const tree = harness.slotRegistrations[0].registration.component(harness.slotRegistrations[0].registration.options.inject())
  assert.equal(flatten(tree).filter((node) => node.type === 'input').length, 0, 'no controls while off')
  assert.ok(flatten(tree).some((node) => node.props && node.props.className === 'dsh-mica-switch'))
  assert.equal(env.document.documentElement.getAttribute('data-dsh-mica'), null, 'a disabled layer paints nothing')
})

test('the layer survives a scheme switch and tears down cleanly', () => {
  const env = installGlobals({ rootTree: true })
  const plugin = factory(platformModules())
  const harness = makeContext()
  plugin.apply(harness.ctx)

  // Light scheme re-render.
  harness.setScheme('light')
  const themeListener = harness.listeners.find((l) => l.name === 'theme/change')
  assert.ok(themeListener !== undefined, 'the layer must follow theme/change')
  themeListener.callback()
  assert.equal(env.document.documentElement.style.getPropertyValue('--dsh-mica-wall-sat'), '100')

  // Dispose every effect (what plugin unload does).
  for (const effect of [...harness.effects].reverse()) effect.dispose()

  const html = env.document.documentElement
  assert.equal(html.getAttribute('data-dsh-mica'), null, 'the root attribute must be removed')
  assert.equal(html.walk().filter((el) => el.hasAttribute('data-dsh-mica-glass')).length, 0, 'glass hooks must be removed')
  assert.equal(html.walk().filter((el) => el.hasAttribute('data-dsh-mica-backdrop')).length, 0, 'the backdrop must be removed')
  assert.equal(html.style.getPropertyValue('--dsh-mica-image'), '', 'the custom properties must be cleared')
  assert.equal(harness.tokenLayers.length, 0, 'the token layer must be withdrawn')
})

test('the host half exposes a side-effect-free apply', async () => {
  const host = await import(new URL('../lib/index.js', import.meta.url).href)
  assert.equal(host.name, 'dsh-mica')
  assert.equal(typeof host.apply, 'function')
  const registered = []
  const harness = makeContext()
  harness.ctx.get = (name) => (name === 'webServer' ? { register: (route) => { registered.push(route); return () => {} } } : undefined)
  host.apply(harness.ctx)
  assert.equal(registered.length, 1, 'the palette route must register when a web server exists')
  assert.equal(registered[0].path, '/plugins/dsh-mica/palette')
  assert.equal(registered[0].kind, 'exact')
})

test('the host half tolerates a host without a web server', async () => {
  const host = await import(new URL('../lib/index.js', import.meta.url).href + '?noserver')
  const harness = makeContext()
  harness.ctx.get = () => undefined
  host.apply(harness.ctx)
  assert.equal(harness.effects.length, 1, 'the wait-for-service effect must be the only one')
  assert.equal(harness.listeners.length, 1)
})
//#endregion

//#region reporting
for (const entry of cases) {
  try {
    await entry.fn()
    results.push({ name: entry.name, ok: true })
  } catch (error) {
    results.push({ name: entry.name, ok: false, error })
  }
}

const failed = results.filter((r) => !r.ok)
for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.name}`)
  if (!result.ok) console.log('      ' + String(result.error && result.error.stack ? result.error.stack : result.error).split('\n').slice(0, 6).join('\n      '))
}
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exitCode = failed.length === 0 ? 0 : 1

/** CRC-32, matching the PNG specification (independent of the bundle's copy). */
function crc32of(bytes) {
  let c = 0xFFFFFFFF
  for (const b of bytes) {
    c ^= b
    for (let i = 0; i < 8; i += 1) c = (c & 1) !== 0 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

/** `dataFoo` -> `data-foo`. */
function camelToDash(text) {
  return text.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
}

/** A 14x14 sample that varies on BOTH axes: bright left/top, dark right/bottom. */function gradientSample() {
  const colors = []
  for (let y = 0; y < 14; y += 1) {
    for (let x = 0; x < 14; x += 1) {
      colors.push({
        r: 240 - x * 14, // 240 at the left edge .. 58 at the right one
        g: 240 - x * 9 - y * 4,
        b: 240 - y * 12, // 240 at the top edge .. 84 at the bottom one
      })
    }
  }
  return colors
}

/** Let the palette probe's promise chain (and the render it triggers) settle. */
async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => { setImmediate(resolve) })
}

/** Run `count` queued animation frames (each frame may queue the next one). */
function pumpFrames(env, count) {
  for (let i = 0; i < count; i += 1) {
    const due = [...env.frames.values()]
    env.frames.clear()
    for (const fn of due) fn()
  }
}

/** Fire every registered interval callback once (the follower's waker). */
function pumpIntervals(env) {
  for (const fn of [...env.intervals.values()]) fn()
}

/**
 * A host payload carrying the desktop thumbnail: the wallpaper's left half is
 * red, its right half blue, plus the placement Windows reports for it.
 * @param options - thumbnail size and wallpaper style.
 * @returns a palette-route payload.
 */
function desktopSample({ w = 128, h = 72, style = '10', tile = '0' } = {}) {
  const rgb = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const at = (y * w + x) * 3
      const right = x >= w / 2
      rgb[at] = right ? 0 : 240
      rgb[at + 1] = 20
      rgb[at + 2] = right ? 240 : 0
    }
  }
  return {
    ok: true,
    wallpaper: 'C:\\wall\\desk.jpg',
    colors: gradientSample(),
    desktop: { w, h, rgb: rgb.toString('base64') },
    style: { wallpaperStyle: style, tile },
  }
}

/**
 * A host payload whose wallpaper is a horizontal LUMA RAMP (60 .. 240), so a
 * window sliding across it walks the crop's mean luminance through the
 * contrast-protection threshold instead of jumping over it.
 */
function rampSample({ w = 128, h = 72 } = {}) {
  const rgb = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const at = (y * w + x) * 3
      const v = Math.round(60 + (x / (w - 1)) * 180)
      rgb[at] = v
      rgb[at + 1] = v
      rgb[at + 2] = v
    }
  }
  return {
    ok: true,
    wallpaper: 'C:\\wall\\ramp.jpg',
    colors: gradientSample(),
    desktop: { w, h, rgb: rgb.toString('base64') },
    style: { wallpaperStyle: '10', tile: '0' },
  }
}

/**
 * Decode the bundle's backdrop tile back into pixels.
 *
 * The bundle writes stored (uncompressed) deflate blocks, so the pixels can be
 * recovered without an inflater - which is what makes it possible to assert on
 * the actual image rather than on the code path that produced it.
 */
function decodeTile(cssUrl) {
  const base64 = /base64,([^"]+)/.exec(cssUrl)[1]
  const bytes = Buffer.from(base64, 'base64')
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const idat = []
  let at = 8
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.subarray(at + 4, at + 8).toString('latin1')
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  const stream = Buffer.concat(idat)
  assert.equal(stream[0], 0x78, 'zlib header')
  const raw = []
  let cursor = 2
  for (;;) {
    const header = stream[cursor]
    assert.equal((header >> 1) & 3, 0, 'the tile must use stored deflate blocks')
    const size = stream[cursor + 1] | (stream[cursor + 2] << 8)
    const nsize = stream[cursor + 3] | (stream[cursor + 4] << 8)
    assert.equal((size ^ 0xFFFF) & 0xFFFF, nsize, 'stored block length check')
    cursor += 5
    for (let i = 0; i < size; i += 1) raw.push(stream[cursor + i])
    cursor += size
    if ((header & 1) === 1) break
  }
  const stride = width * 3
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    assert.equal(raw[y * (stride + 1)], 0, 'scanline filter must be None')
    for (let i = 0; i < stride; i += 1) pixels[y * stride + i] = raw[y * (stride + 1) + 1 + i]
  }
  const channel = (x, y, c) => pixels[(y * width + x) * 3 + c]
  return {
    width,
    height,
    /** Mean of one colour channel down column `x`. */
    columnMean(c, x) {
      let sum = 0
      for (let y = 0; y < height; y += 1) sum += channel(x, y, c)
      return sum / height
    },
    /** Mean of one colour channel across row `y`. */
    rowMean(c, y) {
      let sum = 0
      for (let x = 0; x < width; x += 1) sum += channel(x, y, c)
      return sum / width
    },
    /** Max-min of one colour channel across row `y` (0 = a flat band). */
    rowSpread(c, y) {
      let min = 255
      let max = 0
      for (let x = 0; x < width; x += 1) {
        const v = channel(x, y, c)
        min = Math.min(min, v)
        max = Math.max(max, v)
      }
      return max - min
    },
  }
}
//#endregion
