// Google (Gemini vision) token lookup (committed, no token inside). The token lives only in the gitignored googleTokenLocal.ts; without that file
// (a fresh clone) getGoogleToken() returns "" and the project compiles and runs exactly as before. The literal require() inside try/catch is the same
// pattern as Snap3DConfig.ts: a missing file logs one "Failed to resolve dependency" line and the catch returns the empty default.

export function getGoogleToken(): string {
  try {
    const mod = require("./googleTokenLocal")
    const t = mod && mod.GOOGLE_TOKEN
    if (typeof t === "string" && t.trim().length > 0) return t.trim()
  } catch (e) {
    // no local file: fall through to the empty default
  }
  return ""
}
