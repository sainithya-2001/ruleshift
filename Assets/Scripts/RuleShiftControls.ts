import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import {snap3DGenerate} from "./Snap3DGenerator"
import {getSnapToken} from "./Snap3DConfig"

const SHAPES = ["sphere", "cube", "crystal", "cone", "torus"]
const SHAPE_LABELS = ["Orb", "Cube", "Gem", "Cone", "Ring"]
const COLORS = [
  [1.0, 0.0, 0.35], // hot pink
  [0.0, 0.85, 1.0], // electric cyan
  [1.0, 0.9, 0.0], // vivid yellow
  [0.2, 1.0, 0.3], // lime
  [1.0, 0.5, 0.0], // orange
  [0.65, 0.3, 1.0], // violet
]
const SIZE_KEYS = ["S", "M", "L"]
const WEIGHT_KEYS = ["light", "heavy"]
const BOUNCE_KEYS = ["low", "high"]

const SURPRISE_PROMPTS = ["a glowing alien flower", "a floating crystal energy core", "a tiny floating island with trees", "a tiny planet with rings", "a floating paper lantern"]

const TOOLBAR_TEXT_PROBE = 40 // labels are measured at this size, then scaled to the largest size that fits
const TOOLBAR_TEXT_MAX = 72
const TOOLBAR_TEXT_MIN = 14

const Z = -95 // the world's depth plane
const ASR_INITIAL_WINDOW = 10 // seconds to start speaking
const ASR_SILENCE_AFTER_SPEECH = 2 // seconds of silence after the last partial ends the phrase
const DARK = new vec4(0.12, 0.14, 0.27, 1) // additive display: pure black would vanish, so use a deep slate
const PILL = new vec4(0.12, 0.3, 0.8, 1) // saturated blue: stays legible against bright rooms
const WHITE = new vec4(1, 1, 1, 1)
const MENU_BACK = new vec4(0.2, 0.26, 0.56, 1) // menu backing: as bright as a dark plate can be on an additive display, so the room behind is lifted and reads as quiet
const TB_PILL = new vec4(0.12, 0.3, 0.8, 0.88) // toolbar pills: lower opacity so the room (the sideboard) stays visible through them
const TB_DARK = new vec4(0.12, 0.14, 0.27, 0.0)
const TOOLBAR_RIGHT_ANG = 0.2286 // the toolbar ends here (angular): just left of the Sunlit Room sideboard's right speaker, so no pill sits over it
const ACCENT = new vec4(0.1, 0.55, 1.0, 1)
const ARMED = new vec4(0.35, 0.92, 1.0, 1) // Connect armed: a bright cyan fill, clearly different from the blue pills

type Pill = {button: Button; content: ElementContent}
const PILL_W = 8.6 // the Connect / Remove pills beside a selected object
const PILL_H = 3.2

@component
export class RuleShiftControls extends BaseScriptComponent {
  @input
  @hint("RuleShiftController script (JS) exposing script.api")
  controller: ScriptComponent

  @input iconPlay: Texture
  @input iconPause: Texture
  @input iconReset: Texture
  @input iconAdd: Texture
  @input iconClose: Texture
  @input iconTrash: Texture
  @input iconMic: Texture
  @input iconMicOn: Texture
  @input iconSurprise: Texture

  private mainPill: Pill
  private speakPill: Pill
  private asrModule: any = null
  private listening = false
  private heard = ""
  private caption: Text
  private captionTimer = 0
  private asrStartedAt = 0
  private asrLastEventAt = 0
  private asrEvents = 0
  private lastState: string = ""
  private surpriseIndex = 0
  private toolbarPills: Pill[] = []
  private toolbarLabels: string[] = []
  private toolbarCenters: number[] = []
  private pillWidth = 9
  private pillH = 6.3
  private fitStage = 0
  private fitFrame = 0
  private labelFit: {label: string; width: number; allowed: number; height: number; allowedH: number}[] = []
  private labelTextSize = TOOLBAR_TEXT_PROBE
  private palette: SceneObject
  private paletteParts: SceneObject[] = []
  private deleteObj: SceneObject
  private deletePlate: SceneObject
  private sel = {shape: 0, color: 0, glow: 0, size: 1, weight: 0, bounce: 0}
  private markers: {[g: string]: SceneObject[]} = {}
  private halfW = 35
  private halfH = 27
  private editorRoot: SceneObject
  private editorBgs: SceneObject[] = []
  private editorRows: {rule: string; name: string; pill: Pill; fill: SceneObject; border: SceneObject; color: number[]}[] = []
  private editorShown = false
  private editorTextFit = 0
  private cardRoot: SceneObject
  private cardPlates: SceneObject[] = []
  private cardHeader: Pill
  private cardRows: {name: Text; hint: Text; id: string}[] = []
  private cardOpen = false
  private cardShown = false
  private cardSeen: {[id: string]: boolean} = {}
  private cardVersion = -1
  private toolbarRoot: SceneObject
  private toolbarPlateTop = 0
  private statusText: Text
  private createPill: Pill
  private morePill: Pill
  private createMenu: SceneObject
  private moreMenu: SceneObject
  private basicPill: Pill
  private connectObj: SceneObject
  private connectPlate: SceneObject
  private connectPill: Pill
  private connectHint: Text
  private editorWidths: number[] = []
  private createW = 16
  private createH = 20
  private createTop = 0
  private createPlacement: any = null
  private allPills: Pill[] = []
  private pillByName: {[n: string]: Pill} = {}
  private outlinedCount = 0
  private forceVoice = false

  onAwake() {
    const v = this.controller.api.view()
    this.halfW = v.halfW
    this.halfH = v.halfH
    this.buildToolbar()
    this.buildPalette()
    this.buildMenus()
    this.buildDelete()
    this.buildEditor()
    this.buildCard()
    this.buildRealMenu()

    this.createEvent("OnStartEvent").bind(() => {
      this.controller.api.onState((st: string) => this.onState(st))
      this.controller.api.setGenerator(snap3DGenerate)
      this.controller.api.setUiBusyProbe(() => this.menusOpen() || this.palette.enabled)
      print("RULESHIFT Snap3D token: " + (getSnapToken().length > 0 ? "present (local override)" : "absent - imagined objects will fall back to the orb"))
      this.setPalette(false)
      this.closeMenus()
    })
    this.createEvent("UpdateEvent").bind(() => {
      this.updateToolbarFollow()
      this.updateOutlines()
      this.updateFloating()
      this.updateRealMenu()
      this.updateEditor()
      this.updateCard()
      this.updateLabelFit()
      if (this.listening) {
        // no timeout until the first partial arrives (10 s listening window), then 2 s of silence after the last partial
        if (this.asrEvents === 0) {
          const age = getTime() - this.asrStartedAt
          if (age >= ASR_INITIAL_WINDOW) {
            print("RULESHIFT ASR initial window expired: no transcript event in " + age.toFixed(1) + "s (events: 0)")
            this.finishSpeech()
          }
        } else {
          const since = getTime() - this.asrLastEventAt
          if (since >= ASR_SILENCE_AFTER_SPEECH) {
            print("RULESHIFT ASR silence timeout: " + since.toFixed(1) + "s since the last partial (events: " + this.asrEvents + ")")
            this.finishSpeech()
          }
        }
      }
      if (this.captionTimer > 0) {
        this.captionTimer -= getDeltaTime()
        // above the topmost object on the stage (stacked over any "Imagining" captions), never at a node
        this.caption.sceneObject.getTransform().setWorldPosition(new vec3(0, this.controller.api.captionY(this.controller.api.captionCount()), Z))
        if (this.captionTimer <= 0) this.caption.sceneObject.enabled = false
      }
    })
    this.buildCaption()
    // Preview has no permission API for the mic; report what is knowable. The first transcript event proves the mic is live.
    let editor = "unknown"
    try {
      editor = String((global as any).deviceInfoSystem.isEditor())
    } catch (e) {}
    print("RULESHIFT ASR mic check: isEditor=" + editor + " - Lens Studio exposes no mic-permission query; mic is considered live only if a transcript event arrives after Speak")
  }

  // ---- Toolbar: three big icon-first pills [Create] [Play/Pause] […], low in the view and following the head with a smoothed lag ----
  private buildToolbar() {
    const api = this.controller.api
    const h = 5.0
    const defs = [
      {label: "Create", icon: this.iconAdd},
      {label: "Play", icon: this.iconPlay},
      {label: "•••", icon: null as Texture | null},
    ]
    const gap = 0.4
    const statusH = 2.2 // a thin band above the pills for the Building / Running / Paused indicator
    const pw = 4.8
    this.pillWidth = pw
    this.pillH = h
    const total = pw * 3 + gap * 2
    const x0 = Math.min(this.halfW - 0.3, TOOLBAR_RIGHT_ANG * -Z) - total // low in the bottom-right corner, left of the sideboard's right speaker and clear of the lotus
    const y = -this.halfH + 0.6 + h / 2
    this.toolbarRoot = global.scene.createSceneObject("Toolbar Root")
    const plateH = h + 1.0 + statusH
    const plateY = y + statusH / 2
    const plate = api.makePlate("Toolbar Strip", total + 1.4, plateH, 0.4, new vec3(x0 + total / 2, plateY, Z - 1.2), TB_DARK, -8)
    plate.setParent(this.toolbarRoot)
    this.toolbarPlateTop = plateY + plateH / 2
    api.setToolbarTop(this.toolbarPlateTop / (-Z + 1.2)) // top edge of the toolbar in angular space (room mode also keeps panels above the sideboard line)
    let x = x0
    const pills: Pill[] = []
    defs.forEach((d, i) => {
      const cx = x + pw / 2
      const pl = api.makePlate("Pill " + d.label, pw, h, 0.4, new vec3(cx, y, Z - 0.8), TB_PILL, -7)
      pl.setParent(this.toolbarRoot)
      pills.push(this.makePill(this.toolbarRoot, "Pill" + i, d.label, d.icon, new vec3(cx, y, Z + 0.5), new vec2(pw, h), TOOLBAR_TEXT_PROBE, false, 1.9, d.icon !== null))
      this.toolbarLabels.push(d.label)
      this.toolbarCenters.push(cx)
      x += pw + gap
    })
    this.toolbarPills = pills
    this.createPill = pills[0]
    this.mainPill = pills[1]
    this.morePill = pills[2]
    this.statusText = this.makeLabel(this.toolbarRoot, "Status", "Building", 56, new vec4(1, 0.85, 0.25, 1), new vec3(this.toolbarCenters[1], this.toolbarPlateTop - statusH / 2 - 0.1, Z + 0.8))
    pills[0].button.onTriggerUp.add(() => this.toggleMenu("create"))
    pills[1].button.onTriggerUp.add(() => {
      this.closeMenus()
      this.controller.api.toggle()
    })
    pills[2].button.onTriggerUp.add(() => this.toggleMenu("more"))
  }

  // outlined label (bright rooms): a bright fill with a dark outline stays readable on any background
  private makeLabel(parent: SceneObject, name: string, text: string, size: number, col: vec4, pos: vec3): Text {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setWorldPosition(pos)
    const tx = so.createComponent("Component.Text") as Text
    tx.size = size
    tx.depthTest = false
    tx.horizontalAlignment = HorizontalAlignment.Center
    tx.verticalAlignment = VerticalAlignment.Center
    tx.horizontalOverflow = HorizontalOverflow.Overflow
    tx.textFill.color = col
    tx.renderOrder = 100
    tx.text = text
    this.outline(tx)
    return tx
  }

  private outline(tx: Text, size = 0.6) {
    tx.outlineSettings.enabled = true
    tx.outlineSettings.size = size
    tx.outlineSettings.fill.color = new vec4(0.03, 0.02, 0.16, 1)
  }

  private updateOutlines() {
    if (this.outlinedCount >= this.allPills.length) return
    let done = 0
    this.allPills.forEach((p) => {
      const tc: Text | null = (p.content as any).textComponent
      if (!tc) return
      tc.horizontalOverflow = HorizontalOverflow.Overflow // pill words never wrap onto a second line
      if (!tc.outlineSettings.enabled) this.outline(tc)
      done++
    })
    this.outlinedCount = done
  }

  // the toolbar follows the head: same low spot in the view, rotation eased toward the camera's (identity in the Preview, where the camera is fixed)
  private updateToolbarFollow() {
    const cam: Camera | null = (this.controller as any).camera
    if (!cam || !this.toolbarRoot) return
    const ct = cam.getTransform()
    const rt = this.toolbarRoot.getTransform()
    const k = 1 - Math.exp(-5 * getDeltaTime())
    rt.setWorldRotation(quat.slerp(rt.getWorldRotation(), ct.getWorldRotation(), k))
    rt.setWorldPosition(ct.getWorldPosition())
  }

  // ---- Menus: "Create" (imagine / your creations / basic building blocks) and "…" (Reset, Unlink, Clear) pop up above the toolbar ----
  private buildMenus() {
    const api = this.controller.api
    const top = this.toolbarPlateTop + 0.6
    // "…" menu: a column of three pills above the More pill
    {
      const pwid = 10.5
      const ph = 3.4
      const g = 0.4
      const pad = 0.6
      const hh = ph * 3 + g * 2 + pad * 2
      const cx = Math.min(this.toolbarCenters[2], this.halfW - (pwid + pad * 2) / 2 - 0.4)
      this.moreMenu = global.scene.createSceneObject("More Menu")
      this.moreMenu.setParent(this.toolbarRoot)
      const pl = api.makePlate("More Plate", pwid + pad * 2, hh, 0.4, new vec3(cx, top + hh / 2, Z - 1.2), MENU_BACK, -8, true)
      pl.setParent(this.moreMenu)
      const items = [
        {label: "Reset", icon: this.iconReset, fn: () => this.controller.api.reset()},
        {label: "Unlink", icon: this.iconClose, fn: () => this.controller.api.clearLinks()},
        {label: "Clear", icon: this.iconTrash, fn: () => this.controller.api.clearAll()},
      ]
      items.forEach((it, i) => {
        const cy = top + hh - pad - ph / 2 - i * (ph + g)
        const bp = api.makePlate("More Opt " + it.label, pwid, ph, 0.2, new vec3(cx, cy, Z - 0.8), PILL, -7, true)
        bp.setParent(this.moreMenu)
        const p = this.makePill(this.moreMenu, "More" + it.label, it.label, it.icon, new vec3(cx, cy, Z + 0.5), new vec2(pwid, ph), 58)
        p.button.onTriggerUp.add(() => {
          it.fn()
          this.closeMenus()
        })
      })
    }
    // Create menu: compact (about 16 cm wide) with a solid backing plate; it opens above the toolbar, slid sideways into the emptiest spot (placeCreateMenu)
    {
      const W = 16.2
      const pad = 0.9
      const ih = 3.0
      const hdr = 1.9
      const saved: string[] = api.savedModels()
      const savedRows = Math.max(1, Math.ceil(saved.length / 2))
      const hh = pad + hdr + 0.3 + ih + 0.5 + hdr + 0.3 + savedRows * (ih + 0.5) + 3.0 + pad
      const cx = 0
      this.createMenu = global.scene.createSceneObject("Create Menu")
      this.createMenu.setParent(this.toolbarRoot)
      this.createW = W
      this.createH = hh
      this.createTop = top
      const pl = api.makePlate("Create Plate", W, hh, 0.4, new vec3(cx, top + hh / 2, Z - 1.2), MENU_BACK, -8, true)
      pl.setParent(this.createMenu)
      const inner = W - pad * 2
      let yy = top + hh - pad
      const header = (text: string) => {
        this.makeLabel(this.createMenu, "Hdr " + text, text, 42, new vec4(1, 1, 1, 1), new vec3(cx, yy - hdr / 2, Z + 0.8))
        yy -= hdr + 0.3
      }
      const row = (labels: {label: string; icon: Texture | null; fn: () => void}[], text: number) => {
        const g = 0.6
        const w = (inner - g) / 2
        labels.forEach((it, i) => {
          const px = cx - inner / 2 + w / 2 + i * (w + g)
          const bp = api.makePlate("Create Opt " + it.label, w, ih, 0.2, new vec3(px, yy - ih / 2, Z - 0.8), PILL, -7, true)
          bp.setParent(this.createMenu)
          const p = this.makePill(this.createMenu, "Create" + it.label, it.label, it.icon, new vec3(px, yy - ih / 2, Z + 0.5), new vec2(w, ih), text)
          p.button.onTriggerUp.add(it.fn)
        })
        yy -= ih + 0.5
      }
      header("Imagine something new")
      row(
        [
          {label: "Surprise", icon: this.iconSurprise, fn: () => this.surpriseMe()},
          {label: "Speak", icon: this.iconMic, fn: () => this.toggleSpeak()},
        ],
        40
      )
      this.speakPill = this.pillByName["CreateSpeak"]
      header("Your creations")
      for (let i = 0; i < saved.length; i += 2) {
        row(
          saved.slice(i, i + 2).map((name) => ({label: name, icon: null as Texture | null, fn: () => this.spawnSaved(name)})),
          50
        )
      }
      // the old palette stays reachable, collapsed behind one wide pill
      const bp = api.makePlate("Create Opt Basic", inner, 3.0, 0.2, new vec3(cx, yy - 1.5, Z - 0.8), PILL, -7, true)
      bp.setParent(this.createMenu)
      this.basicPill = this.makePill(this.createMenu, "CreateBasic", "Basic building blocks  ▸", null, new vec3(cx, yy - 1.5, Z + 0.5), new vec2(inner, 3.0), 38)
      this.basicPill.button.onTriggerUp.add(() => {
        this.closeMenus()
        this.setPalette(true)
      })
    }
    this.closeMenus()
    api.test.createPlacement = () => this.createPlacement
    api.test.connectHintVisible = () => this.connectHint.sceneObject.enabled
    api.test.menuState = () => ({create: this.createMenu.enabled, more: this.moreMenu.enabled, palette: this.palette.enabled})
    api.test.openMenu = (which: string) => this.toggleMenu(which, true)
    api.test.closeMenus = () => this.closeMenus()
    api.test.menuPills = () => this.allPills.map((p) => ({text: (p.content as any).text}))
    api.test.statusText = () => this.statusText.text
    api.test.forceVoice = (on: boolean) => (this.forceVoice = on)
    api.test.connectColor = () => this.connectPlateColor()
  }

  private toggleMenu(which: string, forceOpen = false) {
    const target = which === "create" ? this.createMenu : this.moreMenu
    const open = forceOpen ? true : !target.enabled
    this.closeMenus()
    if (open) {
      if (which === "create") this.placeCreateMenu()
      target.enabled = true
      if (this.palette.enabled) this.setPalette(false)
    }
  }

  // The Create menu opens above the toolbar, slid sideways to where it covers the least of any object (angular discs from the controller); the choice is made when it opens.
  private placeCreateMenu() {
    const api = this.controller.api
    const discs: {x: number; y: number; r: number}[] = api.nodeDiscs ? api.nodeDiscs() : []
    const lim = api.view().halfW / -Z // visible half width, angular
    const hwA = this.createW / 2 / -Z
    const yLo = this.createTop / -Z
    const yHi = (this.createTop + this.createH) / -Z
    const cyA = (yLo + yHi) / 2
    const hhA = (yHi - yLo) / 2
    const maxDx = Math.max(0, lim - hwA - 0.005)
    let best = 0
    let bestPen = 1e9
    for (let k = -Math.round(maxDx * -Z); k <= Math.round(maxDx * -Z); k++) {
      const dxA = k / -Z
      let pen = 0
      discs.forEach((d) => {
        const ddx = Math.max(Math.abs(d.x - dxA) - hwA, 0)
        const ddy = Math.max(Math.abs(d.y - cyA) - hhA, 0)
        pen += Math.max(0, d.r - Math.sqrt(ddx * ddx + ddy * ddy))
      })
      pen += Math.abs(k) * 1e-5 // tie-break: nearest the centre
      if (pen < bestPen - 1e-9) {
        bestPen = pen
        best = k
      }
    }
    this.createMenu.getTransform().setLocalPosition(new vec3(best, 0, 0))
    this.createPlacement = {dx: best, penetration: Math.max(0, bestPen - Math.abs(best) * 1e-5), rect: {x: best / -Z, y: cyA, hw: hwA, hh: hhA}}
  }

  private closeMenus() {
    if (this.createMenu) this.createMenu.enabled = false
    if (this.moreMenu) this.moreMenu.enabled = false
  }

  private menusOpen(): boolean {
    return !!this.createMenu && (this.createMenu.enabled || this.moreMenu.enabled)
  }

  private spawnSaved(name: string) {
    this.controller.api.spawnSaved(name)
    this.closeMenus()
  }

  // Labels never wrap: overflow is forced to single-line, then the text size is chosen from the measured widths so the widest label fits its pill.
  private labelBox(p: Pill): {w: number; h: number} {
    const tc: Text | null = (p.content as any).textComponent
    if (!tc) return {w: -1, h: -1}
    tc.horizontalOverflow = HorizontalOverflow.Overflow
    const bb = tc.getBoundingBox()
    return {w: bb.right - bb.left, h: bb.top - bb.bottom}
  }

  private updateLabelFit() {
    this.fitFrame++
    if (this.fitStage === 2 || this.fitFrame < 6) return
    const allowed = this.pillWidth - 0.6 - 0.4 // padding plus a small safety margin
    const allowedH = this.pillH - 0.8 - 1.9 - 0.2 - 0.3 // pill height minus padding, icon, spacing and a margin: the room left for one line of text
    const boxes = this.toolbarPills.map((p) => this.labelBox(p))
    if (boxes.some((b) => !(b.w > 0) || !(b.h > 0))) return // layout not ready yet; try again next frame
    const widths = boxes.map((b) => b.w)
    if (this.fitStage === 0) {
      let size = TOOLBAR_TEXT_MAX
      boxes.forEach((b) => (size = Math.min(size, Math.floor(TOOLBAR_TEXT_PROBE * 0.92 * Math.min(allowed / b.w, allowedH / b.h)))))
      size = Math.max(TOOLBAR_TEXT_MIN, size)
      this.labelTextSize = size
      this.toolbarPills.forEach((p, i) => (p.content.textSize = this.toolbarLabels[i] === "•••" ? Math.min(Math.round(size * 1.3), Math.floor(TOOLBAR_TEXT_PROBE * 0.97 * allowedH / boxes[i].h)) : size)) // larger, but never taller than the pill allows // the lone ellipsis glyph is tiny at word size
      this.fitStage = 1
      this.fitFrame = 0 // re-measure a few frames later, once the new size has laid out
      return
    }
    if (this.fitFrame < 4) return
    this.labelFit = this.toolbarPills.map((p, i) => ({label: this.toolbarLabels[i], width: boxes[i].w, allowed, height: boxes[i].h, allowedH}))
    this.fitStage = 2
    print("RULESHIFT toolbar labels: text size " + this.labelTextSize + ", pill " + this.pillWidth.toFixed(2) + " cm, " + this.labelFit.map((f) => f.label + " " + f.width.toFixed(2) + "x" + f.height.toFixed(2) + " in " + f.allowed.toFixed(2) + "x" + f.allowedH.toFixed(2)).join(", "))
  }

  // read-only views for the tests
  public toolbarFit() {
    return {ready: this.fitStage === 2, size: this.labelTextSize, fit: this.labelFit, labels: this.toolbarLabels.slice(), centers: this.toolbarCenters.slice(), pillWidth: this.pillWidth}
  }

  // ---- Voice creation: ASR transcript -> keyword parser (in the controller) -> spawn ----
  private buildCaption() {
    const so = global.scene.createSceneObject("Voice Caption")
    this.caption = so.createComponent("Component.Text") as Text
    this.caption.size = 90
    this.caption.depthTest = false
    this.caption.horizontalAlignment = HorizontalAlignment.Center
    this.caption.verticalAlignment = VerticalAlignment.Center
    this.caption.textFill.color = new vec4(1, 1, 1, 1)
    this.caption.renderOrder = 100
    this.caption.outlineSettings.enabled = true
    this.caption.outlineSettings.size = 0.5
    this.caption.outlineSettings.fill.color = new vec4(0.05, 0.03, 0.2, 1)
    so.getTransform().setWorldPosition(new vec3(0, 12, Z))
    so.enabled = false
  }

  private showCaption(text: string, secs: number) {
    this.caption.text = text
    this.caption.sceneObject.enabled = true
    this.caption.sceneObject.getTransform().setWorldPosition(new vec3(0, this.controller.api.captionY(this.controller.api.captionCount()), Z))
    this.captionTimer = secs
  }

  private setListening(on: boolean) {
    this.listening = on
    this.speakPill.content.text = on ? "Stop" : "Speak"
    this.speakPill.content.leadingIcon = on ? this.iconMicOn : this.iconMic
  }

  private toggleSpeak() {
    if (this.listening) {
      this.finishSpeech()
      return
    }
    let inEditor = false
    try {
      inEditor = !!(global as any).deviceInfoSystem.isEditor()
    } catch (e) {}
    if (inEditor && !this.forceVoice) {
      // the Preview has no microphone: say so instead of failing
      this.closeMenus()
      this.showCaption("Voice works on Spectacles", 3)
      return
    }
    this.closeMenus()
    try {
      if (!this.asrModule) this.asrModule = require("LensStudio:AsrModule")
      const options = AsrModule.AsrTranscriptionOptions.create()
      options.silenceUntilTerminationMs = ASR_SILENCE_AFTER_SPEECH * 1000 // native end-of-phrase; the Update timers enforce the same 2 s after the last partial
      options.mode = AsrModule.AsrMode.HighAccuracy
      this.heard = ""
      options.onTranscriptionUpdateEvent.add((e: any) => {
        this.asrEvents++
        this.asrLastEventAt = getTime()
        print("RULESHIFT ASR " + (e.isFinal ? "FINAL" : "partial") + " #" + this.asrEvents + " t+" + (getTime() - this.asrStartedAt).toFixed(1) + "s: '" + e.text + "'")
        if (!this.listening) return
        this.heard = e.text
        this.showCaption(e.text, 8)
        if (e.isFinal) this.finishSpeech()
      })
      options.onTranscriptionErrorEvent.add((code: any) => {
        print("RULESHIFT ASR onError: code=" + code + " (" + this.asrCodeName(code) + ") typeof=" + typeof code + " raw=" + JSON.stringify(code))
        if (this.listening) {
          this.setListening(false)
          this.showCaption("Voice unavailable (error " + code + ")", 3)
        }
      })
      print("RULESHIFT ASR starting: mode=HighAccuracy silenceUntilTerminationMs=" + options.silenceUntilTerminationMs)
      this.asrStartedAt = getTime()
      this.asrLastEventAt = this.asrStartedAt
      this.asrEvents = 0
      this.asrModule.startTranscribing(options)
      this.setListening(true)
      this.showCaption("Listening… describe an object", 8)
      print("RULESHIFT ASR session started (startTranscribing returned without throwing)")
    } catch (e) {
      print("RULESHIFT ASR start failed (exception): " + e)
      this.setListening(false)
      this.showCaption("Voice unavailable", 3)
    }
  }

  private asrCodeName(code: any): string {
    try {
      const S = (AsrModule as any).AsrStatusCode
      for (const k in S) if (S[k] === code) return k
    } catch (e) {}
    return "unknown"
  }

  private finishSpeech() {
    if (!this.listening) return
    print("RULESHIFT ASR finishing: events=" + this.asrEvents + " heard='" + this.heard + "'")
    this.setListening(false)
    try {
      this.asrModule.stopTranscribing()
      print("RULESHIFT ASR session stopped")
    } catch (e) {
      print("RULESHIFT ASR stop failed: " + e)
    }
    this.handleTranscript(this.heard)
  }

  public handleTranscript(text: string) {
    const api = this.controller.api
    const p = api.parseVoice(text)
    print("RULESHIFT voice '" + text + "' -> " + JSON.stringify(p))
    if (!text || text.trim().length === 0) {
      this.showCaption("Didn't catch that, try again", 3)
      return
    }
    if (!p.found) {
      // no palette shape word: imagine it with Snap3D (a placeholder orb stands in while it generates)
      this.imagine(text)
      return
    }
    const s = this.sel
    api.spawn({
      shape: p.shape,
      color: COLORS[p.color !== null ? p.color : s.color],
      glow: p.glow !== null ? p.glow : s.glow === 1,
      sizeKey: p.sizeKey || SIZE_KEYS[s.size],
      weight: p.weight || WEIGHT_KEYS[s.weight],
      bounce: p.bounce || BOUNCE_KEYS[s.bounce],
    })
    this.setPalette(false)
    this.showCaption(text.trim() + " ✓", 3)
  }

  // ---- Snap3D: imagined objects (placeholder orb -> generated model; orb stays on failure/timeout) ----
  private imagine(prompt: string) {
    const idx = this.controller.api.imagine(prompt)
    this.setPalette(false)
    this.closeMenus()
    if (idx < 0) this.showCaption("Too many objects - clear some first", 3)
  }

  private surpriseMe() {
    const prompt = SURPRISE_PROMPTS[this.surpriseIndex % SURPRISE_PROMPTS.length]
    this.surpriseIndex++
    this.imagine(prompt)
  }

  private onState(st: string) {
    if (st === this.lastState) return
    this.lastState = st
    this.mainPill.content.text = st === "live" ? "Pause" : "Play"
    this.mainPill.content.leadingIcon = st === "live" ? this.iconPause : this.iconPlay
    // the tiny status indicator beside Play: Building (editing), Running (live), Paused
    this.statusText.text = st === "live" ? "Running" : st === "paused" ? "Paused" : "Building"
    this.statusText.textFill.color = st === "live" ? new vec4(0.35, 1, 0.45, 1) : st === "paused" ? new vec4(1, 0.6, 0.2, 1) : new vec4(1, 0.85, 0.25, 1)
  }

  private setPalette(on: boolean) {
    this.palette.enabled = on
    this.paletteParts.forEach((p) => (p.enabled = on))
  }

  // ---- Create palette: a compact band above the world (the view has no room beside the stage) ----
  private buildPalette() {
    const api = this.controller.api
    const k = Math.min(1, (this.halfW * 2 - 1.6) / 52.6)
    const bh = 3.1
    const stripW = 52.6 * k
    const stripH = 10.6
    const cy = this.halfH - 0.6 - stripH / 2
    const rowY = [cy + 3.55, cy, cy - 3.55]
    this.palette = global.scene.createSceneObject("Create Palette")
    this.palette.getTransform().setWorldPosition(new vec3(0, cy, Z))
    this.paletteParts.push(api.makePlate("Palette Plate", stripW, stripH, 0.4, new vec3(0, cy, Z - 1.2), DARK, -8))
    const x0 = -stripW / 2 + 0.8 * k

    // radio group in one row; the selected option gets a white border + bright fill behind it
    const group = (key: string, labels: string[], xStart: number, row: number, bw: number, textSize: number, swatches?: number[][]) => {
      const gapw = 0.4 * k
      bw = bw * k
      const slot = (i: number) => new vec3(xStart + bw / 2 + i * (bw + gapw), rowY[row], Z)
      this.markers[key] = [
        api.makePlate("Sel Border " + key, bw + 0.5, bh + 0.5, 0.2, slot(0).add(new vec3(0, 0, -0.4)), WHITE, -6),
        api.makePlate("Sel Fill " + key, bw + 0.1, bh + 0.1, 0.2, slot(0).add(new vec3(0, 0, -0.2)), ACCENT, -5),
      ]
      this.markers[key].forEach((m) => this.paletteParts.push(m))
      const mark = () => {
        const s = slot((this.sel as any)[key])
        this.markers[key][0].getTransform().setWorldPosition(s.add(new vec3(0, 0, -0.4)))
        this.markers[key][1].getTransform().setWorldPosition(s.add(new vec3(0, 0, -0.2)))
      }
      labels.forEach((label, i) => {
        const s = slot(i)
        this.paletteParts.push(api.makePlate("Opt " + key + i, bw, bh, 0.2, s.add(new vec3(0, 0, -0.6)), PILL, -7))
        const p = this.makePill(this.palette, key + i, label, null, new vec3(s.x, s.y - cy, 0.5), new vec2(bw, bh), textSize, true)
        p.button.onTriggerUp.add(() => {
          ;(this.sel as any)[key] = i
          mark()
        })
        if (swatches) api.makeSwatch(p.button.sceneObject, swatches[i], Math.min(bw, bh) * 0.7, 1.4)
      })
      mark()
      return xStart + labels.length * bw + (labels.length - 1) * gapw
    }
    const gap = 1.2 * k
    group("shape", SHAPE_LABELS, x0, 0, 7.2, 42)
    let x = group("color", COLORS.map(() => ""), x0, 1, 4.2, 42, COLORS) + gap
    group("glow", ["Plain", "Glow"], x, 1, 9, 42)
    x = group("size", ["S", "M", "L"], x0, 2, 5, 42) + gap
    x = group("weight", ["Light", "Heavy"], x, 2, 7.6, 42) + gap
    group("bounce", ["Flat", "Bouncy"], x, 2, 8.6, 42)
    const sw = 11 * k
    const sx = stripW / 2 - 0.8 * k - sw / 2
    this.paletteParts.push(api.makePlate("Spawn Base", sw, bh, 0.2, new vec3(sx, rowY[0], Z - 0.6), ACCENT, -7))
    const spawn = this.makePill(this.palette, "SpawnButton", "Spawn", this.iconAdd, new vec3(sx, rowY[0] - cy, 0.5), new vec2(sw, bh), 46, true)
    spawn.button.onTriggerUp.add(() => this.spawn())
  }

  private spawn() {
    const api = this.controller.api
    const s = this.sel
    api.spawn({
      shape: SHAPES[s.shape],
      color: COLORS[s.color],
      glow: s.glow === 1,
      sizeKey: SIZE_KEYS[s.size],
      weight: WEIGHT_KEYS[s.weight],
      bounce: BOUNCE_KEYS[s.bounce],
    })
    this.setPalette(false) // close automatically so the new object and the placement hint are in view
    this.closeMenus()
  }

  // ---- Object selected: small Connect and Remove pills just beside the object (drawn at a nearer depth, same screen position, so nothing covers them) ----
  private buildDelete() {
    const api = this.controller.api
    this.deletePlate = api.makePlate("Remove Plate", PILL_W, PILL_H, 0.4, new vec3(0, 0, Z), PILL, -7)
    const p = this.makePill(this.sceneObject, "RemoveButton", "Remove", this.iconTrash, new vec3(0, 0, Z), new vec2(PILL_W, PILL_H), 42)
    this.deleteObj = p.button.sceneObject
    this.deleteObj.enabled = false
    this.deletePlate.enabled = false
    p.button.onTriggerUp.add(() => this.controller.api.deleteSelected())
    this.connectPlate = api.makePlate("Connect Plate", PILL_W, PILL_H, 0.4, new vec3(0, 0, Z), PILL, -7)
    this.connectPill = this.makePill(this.sceneObject, "ConnectButton", "Connect", null, new vec3(0, 0, Z), new vec2(PILL_W, PILL_H), 42)
    this.connectObj = this.connectPill.button.sceneObject
    this.connectObj.enabled = false
    this.connectPlate.enabled = false
    this.connectPill.button.onTriggerUp.add(() => this.controller.api.connectSelected())
    this.connectHint = this.makeLabel(this.sceneObject, "ConnectHint", "Tap another object", 50, new vec4(1, 0.95, 0.45, 1), new vec3(0, 0, -70))
    this.connectHint.sceneObject.enabled = false
  }

  // ---- Real-object list: opens beside a pinch on empty space; one pick anchors a named node on the real object there ----
  private realRoot: SceneObject
  private realPills: {name: string; pill: Pill; plate: SceneObject}[] = []
  private realW = 9
  private realH = 24
  private realShown = false
  private realHeader: Text
  private realRect: {x: number; y: number; hw: number; hh: number} | null = null

  private buildRealMenu() {
    const api = this.controller.api
    const D = 70
    const names: string[] = api.realTypes().concat(["Cancel"])
    const pw = 8.4
    const ph = 2.9
    const g = 0.3
    const pad = 0.7
    const hdr = 2.0
    const rows = Math.ceil((names.length - 1) / 2) + 1 // two columns of names, then Cancel across the bottom
    const hh = pad * 2 + hdr + rows * ph + (rows - 1) * g
    const ww = pw * 2 + g + pad * 2
    this.realW = ww
    this.realH = hh
    this.realRoot = global.scene.createSceneObject("Real Menu")
    this.realRoot.setParent(this.sceneObject)
    const pl = api.makePlate("Real Plate", ww, hh, 0.4, new vec3(0, 0, -D - 1.2), MENU_BACK, -8, true)
    pl.setParent(this.realRoot)
    this.realHeader = this.makeLabel(this.realRoot, "Real Header", "What is this?", 40, new vec4(1, 1, 1, 1), new vec3(0, hh / 2 - pad - hdr / 2, -D + 0.8))
    this.realHeader.sceneObject.getTransform().setLocalPosition(new vec3(0, hh / 2 - pad - hdr / 2, -D + 0.8)) // the controls object is offset, so the position is set relative to the menu
    names.forEach((nm, i) => {
      const cancel = nm === "Cancel"
      const row = cancel ? rows - 1 : Math.floor(i / 2)
      const cx = cancel ? 0 : (i % 2 === 0 ? -1 : 1) * (pw + g) / 2
      const w = cancel ? pw * 2 + g : pw
      const cy = hh / 2 - pad - hdr - ph / 2 - row * (ph + g)
      const bp = api.makePlate("Real Opt " + nm, w, ph, 0.2, new vec3(cx, cy, -D - 0.6), cancel ? new vec4(0.5, 0.16, 0.3, 1) : PILL, -7, true)
      bp.setParent(this.realRoot)
      const p = this.makePill(this.realRoot, "Real" + nm, nm, null, new vec3(cx, cy, -D), new vec2(w, ph), 36, true)
      p.button.onTriggerUp.add(() => api.chooseReal(cancel ? null : nm))
      this.realPills.push({name: nm, pill: p, plate: bp})
    })
    this.realRoot.enabled = false
    api.test.realMenuInfo = () => ({shown: this.realShown, rect: this.realRect, names: this.realPills.map((r) => r.name), header: this.realHeader.text})
  }

  private updateRealMenu() {
    const api = this.controller.api
    const info = api.realMenuInfo()
    if (info && (this.menusOpen() || this.palette.enabled)) {
      api.closeRealMenu()
      this.realRoot.enabled = false
      this.realShown = false
      this.realRect = null
      return
    }
    if (!info) {
      if (this.realShown) {
        this.realRoot.enabled = false
        this.realShown = false
        this.realRect = null
      }
      return
    }
    const D = 70
    const v = api.view()
    const lim = v.halfW / -Z
    const hw = this.realW / 2 / D
    const hh = this.realH / 2 / D
    const ar = 0.045 // clear of the pinch point itself
    let cx = info.x + ar + hw
    if (cx + hw > lim - 0.01) cx = info.x - ar - hw
    cx = Math.max(-lim + hw + 0.01, Math.min(lim - hw - 0.01, cx))
    const tbLeft = (this.toolbarCenters[0] - this.pillWidth / 2 - 0.5) / -Z
    const floorAng = cx + hw > tbLeft ? api.toolbarTop() : -0.31 // clear of the toolbar it may sit lower, down to the bottom of the real view
    const lo = floorAng + hh + 0.01
    const hi = v.halfH / -Z - hh - 0.01
    const cy = Math.max(lo, Math.min(hi, info.y))
    this.realRoot.getTransform().setWorldPosition(new vec3(cx * D, cy * D, 0))
    this.realRoot.enabled = true
    this.realShown = true
    this.realRect = {x: cx, y: cy, hw: hw, hh: hh}
  }

  private connectPlateColor(): number[] {
    const c = this.connectPlate.getComponent("Component.RenderMeshVisual").mainPass.baseColor
    return [c.r, c.g, c.b]
  }

  private updateFloating() {
    const api = this.controller.api
    if (!api.selectedInfo) return
    const info = api.selectedInfo()
    if (!info || info.busy || this.palette.enabled || this.menusOpen()) {
      this.deleteObj.enabled = false
      this.deletePlate.enabled = false
      this.connectObj.enabled = false
      this.connectPlate.enabled = false
      this.connectHint.sceneObject.enabled = false
      if (api.setPillRect) api.setPillRect(null)
      return
    }
    this.deleteObj.enabled = true
    this.deletePlate.enabled = true
    this.connectObj.enabled = true
    this.connectPlate.enabled = true
    // beside the object (right of it, or left when the right side is off the view), at the nearer depth D; the gaps are angular so any room depth gets the same on-screen spacing
    const D = 70
    const dep = Math.max(-info.z, 1)
    const ax = info.x / dep
    const ay = info.y / dep
    const ar = info.r / dep
    const hw = (PILL_W / 2 + 0.4) / D
    const hh = (PILL_H + 0.1 + 0.4) / D
    const v = api.view()
    const lim = v.halfW / -Z
    let cx = ax + ar + 0.012 + hw
    if (cx + hw > lim - 0.01) cx = ax - ar - 0.012 - hw
    cx = Math.max(-lim + hw + 0.01, Math.min(lim - hw - 0.01, cx))
    const lo = api.toolbarTop() + hh + 0.01
    const hi = v.halfH / -Z - hh - 0.01
    const cy = Math.max(lo, Math.min(hi, ay))
    const off = (PILL_H / 2 + 0.2) / D
    this.connectObj.getTransform().setWorldPosition(new vec3(cx * D, (cy + off) * D, -D))
    this.connectPlate.getTransform().setWorldPosition(new vec3(cx * D, (cy + off) * D, -D - 0.6))
    this.deleteObj.getTransform().setWorldPosition(new vec3(cx * D, (cy - off) * D, -D))
    this.deletePlate.getTransform().setWorldPosition(new vec3(cx * D, (cy - off) * D, -D - 0.6))
    const armed = !!api.connectArmed && api.connectArmed()
    this.connectPlate.getComponent("Component.RenderMeshVisual").mainPass.baseColor = armed ? ARMED : PILL
    // armed: a hint beside the pills (above them, or below when they sit at the top of the view)
    this.connectHint.sceneObject.enabled = armed
    if (armed) {
      const topY = (v.halfH / -Z) * D * 0.94
      const above = (cy + off) * D + PILL_H / 2 + 1.5
      const hy = above + 1 < topY ? above : (cy - off) * D - PILL_H / 2 - 1.5
      const hx = Math.max(-lim * D + 5, Math.min(lim * D - 5, cx * D))
      this.connectHint.sceneObject.getTransform().setWorldPosition(new vec3(hx, hy, -D + 0.8))
    }
    // tell the controller where the pills are on screen so link labels keep clear of them (angular space)
    if (api.setPillRect) api.setPillRect({x: cx, y: cy, hw: hw + 0.002, hh: hh})
  }

  // ---- Discoveries: a small collapsible card in a top corner (placed by the controller so it never covers objects, labels or the toolbar) ----
  private makeText(name: string, size: number, col: vec4, align: HorizontalAlignment): Text {
    const so = global.scene.createSceneObject(name)
    so.setParent(this.cardRoot)
    const tx = so.createComponent("Component.Text") as Text
    tx.size = size
    tx.depthTest = false
    tx.horizontalAlignment = align
    tx.verticalAlignment = VerticalAlignment.Center
    tx.horizontalOverflow = HorizontalOverflow.Overflow
    tx.textFill.color = col
    tx.renderOrder = 100
    return tx
  }

  private buildCard() {
    const api = this.controller.api
    const C = api.cardSpec
    this.cardRoot = global.scene.createSceneObject("Discoveries Card")
    this.cardPlates.push(api.makePlate("Card Plate Collapsed", C.cw, C.ch, 0.4, new vec3(0, 0, Z), DARK, -8))
    C.layouts.forEach((L: any, li: number) => this.cardPlates.push(api.makePlate("Card Plate " + li, L.w, L.h, 0.4, new vec3(0, 0, Z), DARK, -8)))
    this.cardHeader = this.makePill(this.cardRoot, "CardHeader", "Discoveries 0/5", null, new vec3(0, 0, 0.5), new vec2(C.cw, C.ch), 38, true)
    this.cardHeader.button.onInitialized.add(() => {
      this.cardHeader.button.opacity = 0
    })
    this.cardHeader.button.onTriggerUp.add(() => {
      this.cardOpen = !this.cardOpen
      api.setCardOpen(this.cardOpen)
    })
    api.discoveries().forEach((d: any) => {
      this.cardRows.push({
        id: d.id,
        name: this.makeText("CardName " + d.id, 36, new vec4(1, 1, 1, 1), HorizontalAlignment.Center),
        hint: this.makeText("CardHint " + d.id, 22, new vec4(0.7, 0.78, 0.95, 1), HorizontalAlignment.Center),
      })
    })
    this.setCardShown(false)
    api.test.cardState = () => ({
      shown: this.cardShown,
      open: this.cardOpen,
      header: (this.cardHeader.content as any).text,
      rows: this.cardRows.map((r) => r.name.text),
    })
    api.test.toggleCard = () => {
      this.cardOpen = !this.cardOpen
      api.setCardOpen(this.cardOpen)
    }
  }

  private setCardShown(on: boolean) {
    this.cardShown = on
    this.cardRoot.enabled = on
    if (!on) this.cardPlates.forEach((p) => (p.enabled = false))
    this.cardRows.forEach((r) => {
      r.name.sceneObject.enabled = on && this.cardOpen
      r.hint.sceneObject.enabled = on && this.cardOpen
    })
  }

  private updateCard() {
    const api = this.controller.api
    // the Create band and the rule editor own the space; the card steps aside while they are open
    api.setCardSuppressed(this.palette.enabled || this.editorShown)
    const info = api.cardInfo()
    if (!info) {
      if (this.cardShown) this.setCardShown(false)
      return
    }
    const C = api.cardSpec
    const list = api.discoveries()
    if (api.discoveryVersion() !== this.cardVersion) {
      this.cardVersion = api.discoveryVersion()
      list.forEach((d: any) => {
        if (d.done && !this.cardSeen[d.id]) {
          this.showCaption("Discovered: " + d.name + " ✨", 4)
        }
        this.cardSeen[d.id] = d.done
      })
    }
    const n = list.filter((d: any) => d.done).length
    ;(this.cardHeader.content as any).text = "Discoveries " + n + "/" + list.length
    const expanded = this.cardOpen && info.expanded
    this.cardShown = true
    this.cardRoot.enabled = true
    const c = new vec3(info.x * C.d, info.y * C.d, -C.d)
    this.cardRoot.getTransform().setWorldPosition(c)
    const L = expanded ? C.layouts[info.layout] : null
    this.cardPlates.forEach((pl, i) => (pl.enabled = i === (expanded ? info.layout + 1 : 0)))
    const plate = this.cardPlates[expanded ? info.layout + 1 : 0]
    plate.getTransform().setWorldPosition(new vec3(c.x, c.y, c.z - 1.2))
    const hy = expanded ? info.h / 2 - C.ch / 2 : 0
    this.cardHeader.button.sceneObject.getTransform().setLocalPosition(new vec3(0, hy, 0.5))
    list.forEach((d: any, i: number) => {
      const r = this.cardRows[i]
      r.name.sceneObject.enabled = expanded
      r.hint.sceneObject.enabled = expanded && L.hints
      if (!expanded) return
      const col = i % L.cols
      const row = Math.floor(i / L.cols)
      const ry = info.h / 2 - C.ch - L.rowH * (row + 0.5)
      const lx = -info.w / 2 + C.pad + (col + 0.5) * L.cellW
      r.name.text = (d.done ? "✓ " : "○ ") + d.name
      r.name.textFill.color = d.done ? new vec4(0.55, 1, 0.65, 1) : new vec4(1, 1, 1, 1)
      r.hint.text = d.done || !L.hints ? "" : d.hint
      r.name.sceneObject.getTransform().setLocalPosition(new vec3(lx, L.hints ? ry + 0.45 : ry, 0.8))
      r.hint.sceneObject.getTransform().setLocalPosition(new vec3(lx, ry - 0.55, 0.8))
    })
  }

  // ---- Rule editor: five coloured rule pills in a column, placed beside the tapped link by the controller ----
  private buildEditor() {
    const api = this.controller.api
    const E = api.editorSpec
    this.editorRoot = global.scene.createSceneObject("Rule Editor")
    E.layouts.forEach((L: any, li: number) => this.editorBgs.push(api.makePlate("Rule Editor Plate " + li, L.w, L.h, 0.4, new vec3(0, 0, Z), DARK, -8)))
    const rules = api.editorRules()
    rules.forEach((r: any, i: number) => {
      const border = api.makePlate("Rule Border " + r.rule, E.pillW + 0.5, E.pillH + 0.5, 0.2, new vec3(0, 0, Z), WHITE, -6)
      const fill = api.makePlate("Rule Fill " + r.rule, E.pillW, E.pillH, 0.2, new vec3(0, 0, Z), PILL, -5)
      const pill = this.makePill(this.editorRoot, "Rule" + i, r.name, null, new vec3(0, 0, 0.5), new vec2(E.pillW, E.pillH), 38, true) // 38: even "✓ Collision Trigger" stays inside the 8 cm pill (at 42 the longest label with its check mark ran to the pill edge)
      pill.button.onTriggerUp.add(() => this.controller.api.applyEditorRule(r.rule))
      pill.button.onInitialized.add(() => {
        pill.button.opacity = 0 // the Button's own grey plate would cover the rule colours drawn behind it
      })
      this.editorRows.push({rule: r.rule, name: r.name, pill, fill, border, color: r.color})
    })
    this.setEditorShown(false)
    api.test.editorPills = () => this.editorRows.map((row) => ({rule: row.rule, selected: row.border.enabled, fill: this.fillColor(row)}))
    api.test.pressEditorPill = (i: number) => this.controller.api.applyEditorRule(this.editorRows[i].rule)
    api.test.editorShown = () => this.editorShown
    api.test.editorFit = () => ({widths: this.editorWidths.slice(), pill: E.pillW})
    api.test.editorFitReset = () => (this.editorWidths = [])
    api.test.togglePalette = (on: boolean) => this.setPalette(on)
  }

  private fillColor(row: {fill: SceneObject}): number[] {
    const c = row.fill.getComponent("Component.RenderMeshVisual").mainPass.baseColor
    return [c.r, c.g, c.b]
  }

  private setEditorShown(on: boolean) {
    this.editorShown = on
    this.editorRoot.enabled = on
    this.editorBgs.forEach((b) => (b.enabled = on))
    this.editorRows.forEach((r) => {
      r.fill.enabled = on
      r.border.enabled = on && r.border.enabled
    })
  }

  private updateEditor() {
    const api = this.controller.api
    const info = api.editorInfo()
    if (!info) {
      if (this.editorShown) this.setEditorShown(false)
      return
    }
    if (this.palette.enabled) this.setPalette(false) // the Create band would sit in the panel's way
    const E = api.editorSpec
    if (!this.editorShown) {
      this.closeMenus()
      this.setEditorShown(true)
    }
    // labels never wrap ("Collision Trigger" stays on one line): measure every row each frame and keep the widest seen (a selected row carries a check mark); report once
    this.editorTextFit++
    const ws = this.editorRows.map((row) => {
      const tc: Text | null = (row.pill.content as any).textComponent
      if (!tc) return -1
      tc.horizontalOverflow = HorizontalOverflow.Overflow
      const bb = tc.getBoundingBox()
      return bb.right - bb.left
    })
    this.editorWidths = ws.map((w, i) => Math.max(w, this.editorWidths[i] || 0))
    if (this.editorTextFit === 8) print("RULESHIFT editor labels width cm: " + ws.map((w) => w.toFixed(2)).join(", ") + " (pill " + E.pillW + ")")
    const c = new vec3(info.x * E.d, info.y * E.d, -E.d)
    this.editorRoot.getTransform().setWorldPosition(c)
    const L = E.layouts[info.layout]
    this.editorBgs.forEach((b, li) => {
      b.enabled = li === info.layout
      b.getTransform().setWorldPosition(new vec3(c.x, c.y, c.z - 1.2))
    })
    this.editorRows.forEach((row, i) => {
      const lx = -L.w / 2 + E.pad + E.pillW / 2 + (i % L.cols) * (E.pillW + E.gap)
      const ly = L.h / 2 - E.pad - E.pillH / 2 - Math.floor(i / L.cols) * (E.pillH + E.gap)
      row.pill.button.sceneObject.getTransform().setLocalPosition(new vec3(lx, ly, 0.5))
      const sel = row.rule === info.rule
      row.pill.content.text = (sel ? "✓ " : "") + row.name // the current rule is marked
      const k = sel ? 1.0 : 0.72 // the current rule is bright and outlined; the others are dimmed versions of their colours
      row.fill.getTransform().setWorldPosition(new vec3(c.x + lx, c.y + ly, c.z - 0.6))
      row.border.getTransform().setWorldPosition(new vec3(c.x + lx, c.y + ly, c.z - 0.9))
      row.border.enabled = sel
      row.fill.getComponent("Component.RenderMeshVisual").mainPass.baseColor = new vec4(row.color[0] * k, row.color[1] * k, row.color[2] * k, 1)
    })
  }

  private makePill(parent: SceneObject, name: string, label: string, icon: Texture | null, pos: vec3, size: vec2, textSize: number, local = false, iconSize = 2.2, stacked = false): Pill {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (local) so.getTransform().setLocalPosition(pos)
    else so.getTransform().setWorldPosition(pos)
    const button = so.createComponent(Button.getTypeName()) as Button
    const content = so.createComponent(ElementContent.getTypeName()) as ElementContent
    content.text = label
    content.textSize = textSize
    if (stacked) {
      content.iconLayout = "top" // icon above the label: icon-first and the full pill width is free for the word
      content.spacing = 0.2
      content.padding = {top: 0.4, right: 0.3, bottom: 0.4, left: 0.3}
    }
    ;(content as any)._useThemeColors = false // bright white labels (the theme's grey reads dim on the additive display)
    if (icon) {
      content.leadingIcon = icon
      content.leadingIconSize = Math.min(size.y * 0.55, iconSize)
    }
    button.onInitialized.add(() => {
      button.size = new vec3(size.x, size.y, 1)
      button.opacity = 0 // every pill has its own saturated plate behind it; the Button's grey plate would wash it out
    })
    const pill = {button, content}
    this.allPills.push(pill)
    this.pillByName[name] = pill
    return pill
  }
}
