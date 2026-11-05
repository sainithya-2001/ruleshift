import {Snap3D} from "RemoteServiceGateway.lspkg/HostedSnap/Snap3D"
import {Snap3DTypes} from "RemoteServiceGateway.lspkg/HostedSnap/Snap3DTypes"
import {AvaliableApiTypes, RemoteServiceGatewayCredentials} from "RemoteServiceGateway.lspkg/RemoteServiceGatewayCredentials"
import {getSnapToken} from "./Snap3DConfig"

export type Snap3DCallbacks = {
  onSuccess: (gltf: GltfAsset) => void
  onFail: (reason: string) => void
}

// Generator contract used by the controller (and replaced by a stub in tests): start a job, return a cancel function.
// Exactly one callback fires per job; with no token the failure is immediate.
export function snap3DGenerate(prompt: string, cb: Snap3DCallbacks): () => void {
  let cancelled = false
  let finished = false
  const succeed = (g: GltfAsset) => {
    if (cancelled || finished) return
    finished = true
    cb.onSuccess(g)
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
    Snap3D.submitAndGetStatus({prompt: prompt, format: "glb", refine: false, use_vertex_color: false})
      .then((res) => {
        res.event.add(([kind, data]) => {
          if (kind === "base_mesh" || kind === "refined_mesh") succeed((data as Snap3DTypes.GltfAssetData).gltfAsset)
          else if (kind === "failed") fail("Snap3D failed: " + (data as Snap3DTypes.ErrorData).errorMsg)
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
