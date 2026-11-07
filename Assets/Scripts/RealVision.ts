import {Gemini} from "RemoteServiceGateway.lspkg/HostedExternal/Gemini"
import {RemoteServiceGatewayCredentials} from "RemoteServiceGateway.lspkg/RemoteServiceGatewayCredentials"
import {getGoogleToken} from "./GoogleConfig"

// Vision naming for real-object nodes: crop the camera frame around the pinch point, ask Gemini what is at its centre.
// Calibration (Preview camera frame 1392x1590 = the panel's central part, 0.4164 mrad per pixel): pixel = centre + angular / TAN_PER_PX. On a device the
// frame has its own intrinsics; the crop is generous (CROP px square) so a small mismatch still keeps the object in the middle third.
const TAN_PER_PX = 0.0004164
const CROP = 360
const PROMPT = "Name the single real object at the centre of this image in 1-2 words"
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"]

export type VisionResult = {name: string | null; why: string; ms: number; crop?: string}

export class RealVision {
  private cam: CameraModule | null = null
  private tex: Texture | null = null
  private token = ""

  available(): boolean {
    return this.token.length > 0
  }

  // call once at start: requests the camera stream when a token exists (the first frames take a few seconds to arrive)
  init() {
    this.token = getGoogleToken()
    if (!this.token) return
    try {
      this.cam = require("LensStudio:CameraModule") as CameraModule
      const req = CameraModule.createCameraRequest()
      req.cameraId = CameraModule.CameraId.Default_Color
      this.tex = this.cam.requestCamera(req)
    } catch (e) {
      print("RULESHIFT vision: camera unavailable: " + e)
      this.tex = null
    }
  }

  // ax, ay: the pinch point as tan angles from the view centre. cb fires exactly once.
  name(ax: number, ay: number, wantCrop: boolean, cb: (r: VisionResult) => void) {
    const t0 = getTime()
    let done = false
    const finish = (name: string | null, why: string, crop?: string) => {
      if (done) return
      done = true
      cb({name: name, why: why, ms: Math.round((getTime() - t0) * 1000), crop: crop})
    }
    const tex = this.tex
    if (!this.token || !tex || tex.getWidth() < 16) {
      finish(null, !this.token ? "no token" : "no camera frame yet")
      return
    }
    try {
      const W = tex.getWidth()
      const H = tex.getHeight()
      const cx = Math.round(W / 2 + ax / TAN_PER_PX)
      const cy = Math.round(H / 2 - ay / TAN_PER_PX)
      const half = CROP / 2
      const x0 = Math.max(0, Math.min(W - CROP, cx - half))
      const y0 = Math.max(0, Math.min(H - CROP, cy - half))
      const src = ProceduralTextureProvider.createFromTexture(tex)
      const sp = src.control as ProceduralTextureProvider
      const data = new Uint8Array(CROP * CROP * 4)
      // pixel rows are bottom-up in texture space
      sp.getPixels(x0, H - y0 - CROP, CROP, CROP, data)
      const dst = ProceduralTextureProvider.createWithFormat(CROP, CROP, TextureFormat.RGBA8Unorm)
      ;(dst.control as ProceduralTextureProvider).setPixels(0, 0, CROP, CROP, data)
      Base64.encodeTextureAsync(
        dst,
        (b64: string) => this.ask(b64, 0, wantCrop ? b64 : undefined, finish),
        () => finish(null, "encode failed"),
        CompressionQuality.LowQuality,
        EncodingType.Jpg
      )
    } catch (e) {
      finish(null, "crop failed: " + e)
    }
  }

  private ask(b64: string, mi: number, crop: string | undefined, finish: (n: string | null, w: string, c?: string) => void) {
    ;(RemoteServiceGatewayCredentials as any).googleToken = this.token // RSG's setApiToken only handles the Snap token, so the Google static is set directly, right before each call (the credentials component resets it at start)
    Gemini.models({
      model: MODELS[mi],
      type: "generateContent",
      body: {contents: [{role: "user", parts: [{inlineData: {mimeType: "image/jpeg", data: b64}}, {text: PROMPT}]}]},
    } as any)
      .then((r: any) => {
        const txt: string = (r && r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts && r.candidates[0].content.parts[0] && r.candidates[0].content.parts[0].text) || ""
        const nm = RealVision.clean(txt)
        if (nm) finish(nm, "ok " + MODELS[mi] + " raw=" + JSON.stringify(txt), crop)
        else finish(null, "empty answer", crop)
      })
      .catch((e: any) => {
        if (mi + 1 < MODELS.length) this.ask(b64, mi + 1, crop, finish)
        else finish(null, "gemini error: " + String(e).slice(0, 120), crop)
      })
  }

  // "A turntable." -> "Turntable"; at most two words, letters only
  static clean(s: string): string {
    const words = s
      .replace(/[^A-Za-z \-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0 && !/^(a|an|the)$/i.test(w))
      .slice(0, 2)
    if (words.length === 0) return ""
    const out = words.join(" ")
    return out.charAt(0).toUpperCase() + out.slice(1).toLowerCase()
  }
}
