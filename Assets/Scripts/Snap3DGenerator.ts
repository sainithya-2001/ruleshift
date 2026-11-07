import {Snap3D} from "RemoteServiceGateway.lspkg/HostedSnap/Snap3D"
import {Snap3DTypes} from "RemoteServiceGateway.lspkg/HostedSnap/Snap3DTypes"
import {AvaliableApiTypes, RemoteServiceGatewayCredentials} from "RemoteServiceGateway.lspkg/RemoteServiceGatewayCredentials"
import {getSnapToken} from "./Snap3DConfig"

export type Snap3DCallbacks = {
  onSuccess: (gltf: GltfAsset, url?: string) => void
  onFail: (reason: string) => void
}

export type Snap3DOptions = {
  refine?: boolean // true: wait for the refined mesh (slower, nicer) instead of taking the first base mesh
}

// Generator contract used by the controller (and replaced by a stub in tests): start a job, return a cancel function.
// Exactly one callback fires per job; with no token the failure is immediate. onSuccess also receives the downloadable .glb URL,
// which the model-regeneration harness uses to save a result as an asset.
export function snap3DGenerate(prompt: string, cb: Snap3DCallbacks, opts?: Snap3DOptions): () => void {
  const refine = !!(opts && opts.refine)
  let cancelled = false
  let finished = false
  const succeed = (g: GltfAsset, url?: string) => {
    if (cancelled || finished) return
    finished = true
    cb.onSuccess(g, url)
  }
  const fail = (why: string) => {
    if (cancelled || finished) return
    finished = true
    cb.onFail(why)
  }
  const token = getSnapToken()
  if (!token) {
    fail("no Snap token configured")
    return () => {
      cancelled = true
    }
  }
  try {
    RemoteServiceGatewayCredentials.setApiToken(AvaliableApiTypes.Snap, token)
    Snap3D.submitAndGetStatus({prompt: prompt, format: "glb", refine: refine, use_vertex_color: false})
      .then((res) => {
        res.event.add(([kind, data]) => {
          if (kind === "refined_mesh" || (kind === "base_mesh" && !refine)) {
            const d = data as Snap3DTypes.GltfAssetData
            succeed(d.gltfAsset, d.url)
          } else if (kind === "failed") fail("Snap3D failed: " + (data as Snap3DTypes.ErrorData).errorMsg)
        })
      })
      .catch((e) => fail("Snap3D request error: " + e))
  } catch (e) {
    fail("Snap3D exception: " + e)
  }
  return () => {
    cancelled = true
  }
}
