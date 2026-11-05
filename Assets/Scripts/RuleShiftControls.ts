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
const SIZE_LABELS = ["Small", "Medium", "Large"]
const WEIGHT_KEYS = ["light", "heavy"]
const WEIGHT_LABELS = ["Light", "Heavy"]
const BOUNCE_KEYS = ["low", "high"]
const BOUNCE_LABELS = ["Low bounce", "High bounce"]
const GLOW_LABELS = ["No glow", "Glow"]

@component
export class RuleShiftControls extends BaseScriptComponent {
  @input
  @hint("RuleShiftController script (JS) exposing script.api")
  controller: ScriptComponent

  @input
  @hint("Button width/height in cm")
  buttonSize: vec2 = new vec2(24, 9)

  @input
  @hint("Horizontal gap between buttons in cm")
  gap: number = 3

  private mainContent: ElementContent
  private lastState: string = ""
  private palette: SceneObject
  private plate: SceneObject
  private spawnContent: ElementContent
  private deleteObj: SceneObject
  private sel = {shape: 0, color: 0, glow: 0, size: 1, weight: 0, bounce: 0}
  private busy = false
  private groups: {[k: string]: Button[]} = {}

  onAwake() {
    const w = this.buttonSize.x
    const x = (w + this.gap) / 2
    const rowSize = new vec2(w, this.buttonSize.y - 1)
    const main = this.makeButton(this.sceneObject, "ActivateButton", "Activate", -x, 1, rowSize, 110)
    const reset = this.makeButton(this.sceneObject, "ResetButton", "Reset", x, 1, rowSize, 110)
    const create = this.makeButton(this.sceneObject, "CreateButton", "+ Create", -17, -6.5, new vec2(16, 5.5), 80)
    const clear = this.makeButton(this.sceneObject, "ClearLinksButton", "Clear links", 0, -6.5, new vec2(16, 5.5), 80)
    const clearAll = this.makeButton(this.sceneObject, "ClearAllButton", "Clear all", 17, -6.5, new vec2(16, 5.5), 80)
    clear.button.onTriggerUp.add(() => this.controller.api.clearLinks())
    clearAll.button.onTriggerUp.add(() => this.controller.api.clearAll())
    create.button.onTriggerUp.add(() => this.setPalette(!this.palette.enabled))
    this.mainContent = main.content
    main.button.onTriggerUp.add(() => this.controller.api.toggle())
    reset.button.onTriggerUp.add(() => this.controller.api.reset())

    this.buildPalette()
    this.buildDelete()

    this.createEvent("OnStartEvent").bind(() => {
      this.controller.api.onState((st: string) => this.onState(st))
      this.setPalette(false)
    })
    this.createEvent("UpdateEvent").bind(() => this.updateFloating())
  }

  private onState(st: string) {
    if (st === this.lastState) return
    this.lastState = st
    this.mainContent.text = st === "live" ? "Pause" : st === "paused" ? "Resume" : "Activate"
  }

  private setPalette(on: boolean) {
    this.palette.enabled = on
    this.plate.enabled = on
  }

  // ---- Create palette: a compact panel in front of the world, right of centre ----
  private buildPalette() {
    const api = this.controller.api
    const origin = new vec3(9, 5, -80)
    this.palette = global.scene.createSceneObject("Create Palette")
    this.palette.getTransform().setWorldPosition(origin)
    this.plate = api.makePlate("Palette Plate", 28.5, 37.5, 0.5, new vec3(origin.x, origin.y, origin.z - 1), new vec4(0.3, 0.12, 0.6, 1))
    const rowY = (r: number) => 15 - r * 5.0
    const bh = 4.2

    const radioRow = (group: string, r: number, labels: string[], total: number, textSize: number, key: string) => {
      const n = labels.length
      const gapw = 0.5
      const bw = (total - gapw * (n - 1)) / n
      this.groups[group] = []
      labels.forEach((label, i) => {
        const x = -total / 2 + bw / 2 + i * (bw + gapw)
        const b = this.makeButton(this.palette, group + i, label, x, rowY(r), new vec2(bw, bh), textSize)
        b.button.setIsToggleable(true)
        b.button.onInitialized.add(() => {
          b.button.isOn = (this.sel as any)[key] === i
        })
        b.button.onValueChange.add(() => {
          if (this.busy) return
          this.busy = true
          ;(this.sel as any)[key] = i
          this.groups[group].forEach((o, j) => (o.isOn = j === i))
          this.busy = false
        })
        this.groups[group].push(b.button)
      })
      return bw
    }

    radioRow("shape", 0, SHAPE_LABELS, 25.5, 48, "shape")
    const sw = radioRow("color", 1, COLORS.map(() => ""), 25.5, 48, "color")
    this.groups["color"].forEach((b, i) => api.makeSwatch(b.sceneObject, COLORS[i], Math.min(sw, bh) * 0.72, 1.2))
    radioRow("glow", 2, GLOW_LABELS, 25.5, 52, "glow")
    radioRow("size", 3, SIZE_LABELS, 25.5, 52, "size")
    radioRow("weight", 4, WEIGHT_LABELS, 25.5, 52, "weight")
    radioRow("bounce", 5, BOUNCE_LABELS, 25.5, 52, "bounce")

    const spawn = this.makeButton(this.palette, "SpawnButton", "Spawn", -4.5, rowY(6), new vec2(16.5, 4.6), 70)
    const close = this.makeButton(this.palette, "CloseButton", "Close", 8.5, rowY(6), new vec2(8.5, 4.6), 52)
    this.spawnContent = spawn.content
    spawn.button.onTriggerUp.add(() => this.spawn())
    close.button.onTriggerUp.add(() => this.setPalette(false))
  }

  private spawn() {
    const api = this.controller.api
    const s = this.sel
    const idx = api.spawn({
      shape: SHAPES[s.shape],
      color: COLORS[s.color],
      glow: s.glow === 1,
      sizeKey: SIZE_KEYS[s.size],
      weight: WEIGHT_KEYS[s.weight],
      bounce: BOUNCE_KEYS[s.bounce],
    })
    this.spawnContent.text = idx < 0 ? "Limit " + api.maxNodes : "Spawn"
  }

  // ---- Delete button that floats next to the selected object ----
  private deleteButton: {button: Button; content: ElementContent}
  private buildDelete() {
    this.deleteButton = this.makeButton(this.sceneObject, "DeleteButton", "Delete", 0, 0, new vec2(12, 4.5), 70)
    this.deleteObj = this.deleteButton.button.sceneObject
    this.deleteObj.enabled = false
    this.deleteButton.button.onTriggerUp.add(() => this.controller.api.deleteSelected())
  }

  private updateFloating() {
    const api = this.controller.api
    if (!api.selectedInfo) return
    const info = api.selectedInfo()
    if (!info) {
      this.deleteObj.enabled = false
      return
    }
    this.deleteObj.enabled = true
    // sit beside the object, on the side with more room, drawn in front of the palette (projected to a nearer depth)
    const side = info.x > 0 ? -1 : 1
    const q = new vec3(info.x + side * (info.r + 8), info.y + info.r * 0.6, info.z)
    this.deleteObj.getTransform().setWorldPosition(q.uniformScale(74 / -q.z))
    if (this.spawnContent && api.count() < api.maxNodes && this.spawnContent.text !== "Spawn") this.spawnContent.text = "Spawn"
  }

  private makeButton(parent: SceneObject, name: string, label: string, x: number, y: number, size: vec2, textSize: number) {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setLocalPosition(new vec3(x, y, 1.5))
    const button = so.createComponent(Button.getTypeName()) as Button
    const content = so.createComponent(ElementContent.getTypeName()) as ElementContent
    content.text = label
    content.textSize = textSize
    button.onInitialized.add(() => {
      button.size = new vec3(size.x, size.y, 1)
    })
    return {button, content}
  }
}
