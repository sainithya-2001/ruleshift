import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"

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

const Z = -95 // the world's depth plane
const DARK = new vec4(0.12, 0.14, 0.27, 1) // additive display: pure black would vanish, so use a deep slate
const PILL = new vec4(0.2, 0.23, 0.42, 1)
const WHITE = new vec4(1, 1, 1, 1)
const ACCENT = new vec4(0.1, 0.55, 1.0, 1)

type Pill = {button: Button; content: ElementContent}

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

  private mainPill: Pill
  private lastState: string = ""
  private palette: SceneObject
  private paletteParts: SceneObject[] = []
  private deleteObj: SceneObject
  private deletePlate: SceneObject
  private sel = {shape: 0, color: 0, glow: 0, size: 1, weight: 0, bounce: 0}
  private markers: {[g: string]: SceneObject[]} = {}
  private halfW = 35
  private halfH = 27

  onAwake() {
    const v = this.controller.api.view()
    this.halfW = v.halfW
    this.halfH = v.halfH
    this.buildToolbar()
    this.buildPalette()
    this.buildDelete()

    this.createEvent("OnStartEvent").bind(() => {
      this.controller.api.onState((st: string) => this.onState(st))
      this.setPalette(false)
    })
    this.createEvent("UpdateEvent").bind(() => this.updateFloating())
  }

  // ---- Toolbar: one compact row of icon + label pills along the bottom edge ----
  private buildToolbar() {
    const api = this.controller.api
    const h = 4.2
    const labels = ["Activate", "Reset", "+ Create", "Clear links", "Clear all"]
    const icons = [this.iconPlay, this.iconReset, this.iconAdd, this.iconClose, this.iconTrash]
    let widths = [11.5, 8.6, 10.2, 11.8, 10.2]
    const gap = 0.8
    const total = widths.reduce((a, b) => a + b, 0) + gap * 4
    const k = Math.min(1, (this.halfW * 2 - 3) / total)
    widths = widths.map((w) => w * k)
    const y = -this.halfH + 0.8 + h / 2
    api.makePlate("Toolbar Strip", total * k + 1.4, h + 1.2, 0.4, new vec3(0, y, Z - 1.2), DARK, -8)
    let x = (-total * k) / 2
    const pills: Pill[] = []
    labels.forEach((label, i) => {
      const cx = x + widths[i] / 2
      api.makePlate("Pill " + label, widths[i], h, 0.4, new vec3(cx, y, Z - 0.8), PILL, -7)
      pills.push(this.makePill(this.sceneObject, "Pill" + i, label, icons[i], new vec3(cx, y, Z + 0.5), new vec2(widths[i], h), 48))
      x += widths[i] + gap * k
    })
    this.mainPill = pills[0]
    pills[0].button.onTriggerUp.add(() => this.controller.api.toggle())
    pills[1].button.onTriggerUp.add(() => this.controller.api.reset())
    pills[2].button.onTriggerUp.add(() => this.setPalette(!this.palette.enabled))
    pills[3].button.onTriggerUp.add(() => this.controller.api.clearLinks())
    pills[4].button.onTriggerUp.add(() => this.controller.api.clearAll())
  }

  private onState(st: string) {
    if (st === this.lastState) return
    this.lastState = st
    this.mainPill.content.text = st === "live" ? "Pause" : st === "paused" ? "Resume" : "Activate"
    this.mainPill.content.leadingIcon = st === "live" ? this.iconPause : this.iconPlay
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
  }

  // ---- Delete: a small pill floating just above the selected object, in front of everything ----
  private buildDelete() {
    const api = this.controller.api
    this.deletePlate = api.makePlate("Delete Plate", 8.2, 3.4, 0.4, new vec3(0, 0, Z), PILL, -7)
    const p = this.makePill(this.sceneObject, "DeleteButton", "Delete", this.iconTrash, new vec3(0, 0, Z), new vec2(8.2, 3.4), 46)
    this.deleteObj = p.button.sceneObject
    this.deleteObj.enabled = false
    this.deletePlate.enabled = false
    p.button.onTriggerUp.add(() => this.controller.api.deleteSelected())
  }

  private updateFloating() {
    const api = this.controller.api
    if (!api.selectedInfo) return
    const info = api.selectedInfo()
    if (!info || this.palette.enabled) {
      this.deleteObj.enabled = false
      this.deletePlate.enabled = false
      return
    }
    this.deleteObj.enabled = true
    this.deletePlate.enabled = true
    // above the object, drawn at a nearer depth (same screen position) so nothing can cover it
    const q = new vec3(info.x, Math.min(info.y + info.r + 3.2, this.halfH - 4), info.z)
    const nearer = q.uniformScale(70 / -q.z)
    this.deleteObj.getTransform().setWorldPosition(nearer)
    this.deletePlate.getTransform().setWorldPosition(new vec3(nearer.x, nearer.y, nearer.z - 0.6))
  }

  private makePill(parent: SceneObject, name: string, label: string, icon: Texture | null, pos: vec3, size: vec2, textSize: number, local = false): Pill {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (local) so.getTransform().setLocalPosition(pos)
    else so.getTransform().setWorldPosition(pos)
    const button = so.createComponent(Button.getTypeName()) as Button
    const content = so.createComponent(ElementContent.getTypeName()) as ElementContent
    content.text = label
    content.textSize = textSize
    if (icon) {
      content.leadingIcon = icon
      content.leadingIconSize = Math.min(size.y * 0.55, 2.2)
    }
    button.onInitialized.add(() => {
      button.size = new vec3(size.x, size.y, 1)
    })
    return {button, content}
  }
}
