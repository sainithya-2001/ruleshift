import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"

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

  onAwake() {
    const w = this.buttonSize.x
    const x = (w + this.gap) / 2
    const main = this.makeButton("ActivateButton", "Activate", -x)
    const reset = this.makeButton("ResetButton", "Reset", x)
    this.mainContent = main.content
    main.button.onTriggerUp.add(() => this.controller.api.toggle())
    reset.button.onTriggerUp.add(() => this.controller.api.reset())

    this.createEvent("OnStartEvent").bind(() => {
      this.controller.api.onState((st: string) => this.onState(st))
    })
  }

  private onState(st: string) {
    if (st === this.lastState) return
    this.lastState = st
    this.mainContent.text = st === "live" ? "Pause" : st === "paused" ? "Resume" : "Activate"
  }

  private makeButton(name: string, label: string, x: number) {
    const so = global.scene.createSceneObject(name)
    so.setParent(this.sceneObject)
    so.getTransform().setLocalPosition(new vec3(x, 0, 1.5))
    const button = so.createComponent(Button.getTypeName()) as Button
    const content = so.createComponent(ElementContent.getTypeName()) as ElementContent
    content.text = label
    content.textSize = 110
    button.onInitialized.add(() => {
      button.size = new vec3(this.buttonSize.x, this.buttonSize.y, 1)
    })
    return {button, content}
  }
}
