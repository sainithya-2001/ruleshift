// Snap3D configuration (committed). The committed token is EMPTY on purpose: without a token, Snap3D
// immediately fails and RULESHIFT shows the placeholder orb with "Couldn't imagine that".
//
// To enable real generation on your machine, copy Snap3DConfig.example.ts to snapTokenLocal.ts (same folder),
// paste your Snap token there, and keep it out of git: snapTokenLocal.ts is gitignored.
//
// The override is a literal require() inside try/catch. TypeScript does not type-check require(), so a missing file does not break the
// compile; Lens Studio logs one "Failed to resolve dependency ./snapTokenLocal" error line and the catch below returns the empty default.
// (A non-literal path is NOT an option: Lens Studio only bundles modules it can see in a literal require, so it would never load.)

export const SNAP_TOKEN_DEFAULT = ""

export function getSnapToken(): string {
  try {
    const mod = require("./snapTokenLocal")
    const t = mod && mod.SNAP_TOKEN
    if (typeof t === "string" && t.trim().length > 0) return t.trim()
  } catch (e) {
    // no local file (fresh clone): fall through to the committed, empty default
  }
  return SNAP_TOKEN_DEFAULT
}
