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
  @input iconMic: Texture
  @input iconMicOn: Texture

  private mainPill: Pill
  private speakPill: Pill
  private asrModule: any = null
  private listening = false
  private heard = ""
  private caption: Text
  private captionTimer = 0
  private asrStartedAt = 0
  private asrLastEventAt = 0
  private asrSilenceLogged = false
  private asrEvents = 0
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
    this.createEvent("UpdateEvent").bind(() => {
      this.updateFloating()
      if (this.listening && !this.asrSilenceLogged) {
        const since = getTime() - this.asrLastEventAt
        if (since >= 2) {
          this.asrSilenceLogged = true
          print("RULESHIFT ASR silence timeout: no transcript event for " + since.toFixed(1) + "s (events so far: " + this.asrEvents + ", session age " + (getTime() - this.asrStartedAt).toFixed(1) + "s)")
        }
      }
      if (this.captionTimer > 0) {
        this.captionTimer -= getDeltaTime()
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

  // ---- Toolbar: one compact row of icon + label pills along the bottom edge ----
  private buildToolbar() {
    const api = this.controller.api
    const h = 6.3
    const labels = ["Activate", "Reset", "Create", "Speak", "Clear links", "Clear all"]
    const icons = [this.iconPlay, this.iconReset, this.iconAdd, this.iconMic, this.iconClose, this.iconTrash]
    let widths = [8.9, 7.6, 8.0, 7.6, 10.1, 9.2]
    const gap = 0.3
    const total = widths.reduce((a, b) => a + b, 0) + gap * 4
    const k = Math.min(1, (this.halfW * 2 - 1.5) / total)
    widths = widths.map((w) => w * k)
    const y = -this.halfH + 0.8 + h / 2
    api.makePlate("Toolbar Strip", total * k + 1.4, h + 1.2, 0.4, new vec3(0, y, Z - 1.2), DARK, -8)
    let x = (-total * k) / 2
    const pills: Pill[] = []
    labels.forEach((label, i) => {
      const cx = x + widths[i] / 2
      api.makePlate("Pill " + label, widths[i], h, 0.4, new vec3(cx, y, Z - 0.8), PILL, -7)
      pills.push(this.makePill(this.sceneObject, "Pill" + i, label, icons[i], new vec3(cx, y, Z + 0.5), new vec2(widths[i], h), 44, false, 2.2))
      x += widths[i] + gap * k
    })
    this.mainPill = pills[0]
    pills[0].button.onTriggerUp.add(() => this.controller.api.toggle())
    pills[1].button.onTriggerUp.add(() => this.controller.api.reset())
    pills[2].button.onTriggerUp.add(() => this.setPalette(!this.palette.enabled))
    this.speakPill = pills[3]
    pills[3].button.onTriggerUp.add(() => this.toggleSpeak())
    pills[4].button.onTriggerUp.add(() => this.controller.api.clearLinks())
    pills[5].button.onTriggerUp.add(() => this.controller.api.clearAll())
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
    so.getTransform().setWorldPosition(new vec3(0, 12, Z))
    so.enabled = false
  }

  private showCaption(text: string, secs: number) {
    this.caption.text = text
    this.caption.sceneObject.enabled = true
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
    try {
      if (!this.asrModule) this.asrModule = require("LensStudio:AsrModule")
      const options = AsrModule.AsrTranscriptionOptions.create()
      options.silenceUntilTerminationMs = 2000 // stop after a 2 s pause
      options.mode = AsrModule.AsrMode.HighAccuracy
      this.heard = ""
      options.onTranscriptionUpdateEvent.add((e: any) => {
        this.asrEvents++
        this.asrLastEventAt = getTime()
        this.asrSilenceLogged = false
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
      this.asrSilenceLogged = false
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
      this.showCaption("Try: 'a glowing blue ring'", 3)
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

  private makePill(parent: SceneObject, name: string, label: string, icon: Texture | null, pos: vec3, size: vec2, textSize: number, local = false, iconSize = 2.2): Pill {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (local) so.getTransform().setLocalPosition(pos)
    else so.getTransform().setWorldPosition(pos)
    const button = so.createComponent(Button.getTypeName()) as Button
    const content = so.createComponent(ElementContent.getTypeName()) as ElementContent
    content.text = label
    content.textSize = textSize
    ;(content as any)._useThemeColors = false // bright white labels (the theme's grey reads dim on the additive display)
    if (icon) {
      content.leadingIcon = icon
      content.leadingIconSize = Math.min(size.y * 0.55, iconSize)
    }
    button.onInitialized.add(() => {
      button.size = new vec3(size.x, size.y, 1)
    })
    return {button, content}
  }
}
