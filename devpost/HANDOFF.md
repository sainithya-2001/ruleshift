# Status (updated after the visual pass)

**Latest code commit:** `b167d67` Visual pass (curved beams, procedural model life, ambient sparkles). **Tests:** 308/308 PASS on the sim clock.

## Workflow rules
- Tests must pass before each commit; commit and push per step; retune test values, never delete checks; keep reports short.
- Run tests: set `runTests` on the RULESHIFT Tests object (scene-graphql `setProperty`, `valueType: BOOLEAN`), run `RecompileTypeScriptTool`, then `RunAndCollectLogsTool` (refresh), read the `RULESHIFT TEST SUMMARY` log line, turn the flag off. The suite runs on a fixed 0.1 s sim clock (`fixedStep`), so it is load-independent.
- Never use curl/fetch/HTTP against Lens Studio; use the MCP tools.
- **Banned MCP tools** (each reinstalls AiPreviewAgentInspect.lspkg or needs it/Leaf and breaks the TS compile): PreviewInteractTool, QueryRuntimeSceneTool, CaptureRuntimeViewTool, InjectPreviewGesture, list_leaf_scenarios, run_leaf_scenario, open_leaf_panel, push_leaf_lens, set_leaf_execution_target. Do not install AiPreviewAgent* or Leaf; if a skill tries to, stop and tell the user. Allowed: RunAndCollectLogsTool, CapturePanelScreenshotTool, ExecuteEditorCode, RecompileTypeScriptTool, scene-graphql, asset-graphql, other editor tools.

## Snap3D token setup
Generation (Surprise, voice-to-3D) needs a Snap token. In Lens Studio: Window > Remote Service Gateway Token, generate a token, copy `Assets/Scripts/Snap3DConfig.example.ts` to `Assets/Scripts/snapTokenLocal.ts` and set `SNAP_TOKEN`. That file is gitignored: never commit a token or paste it into a scene component. The log line `RULESHIFT Snap3D token: present (local override)` confirms it loaded. Without a token the Lens still runs and generation falls back to the orb with "Couldn't imagine that". Generation takes about 30 s and the safety filter rejects some prompts.

## What is built
Five rules (Attract, Repel, Collision Trigger, Transfer, Grow); contextual rule editor (tap a link, panel of five coloured pills, applies live); Discoveries card (five system-event goals); thin curved glowing beams with flowing motes, rule name shown only on the selected link; procedural life on saved models (cat turns and hops, lantern sways, island bobs, flower pulses); a few ambient sparkles; cause pulses; sim-clock test mode.

## Presets (`demoStage` input on the controller; empty by default = empty stage for recording)
- `""` (default): empty stage with the placement hint.
- `chain`: three spheres (gem, orb, cube) spread across the stage with Attract, Repel and On Collision links so one collision flips another rule.
- `universe`: four saved Snap3D models from `Assets/RULESHIFT Models/` (house on a floating island 1.5x heavy, cat 0.7x light, lantern, flower). Cat-lantern Attract, lantern-flower Collision Trigger, cat-home Attract. Hand-triggered: the cat chases the lantern (about 10 cm); drag the lantern into the flower, the pulse flips cat-lantern to Repel and the cat is pushed home. No token needed.
- Test-only scene flags on the tests object: `showUniverse`, `showEditor`, `showGrow`, `showShots`, `shotsPulses`, `liveImagine`, `showCause`. Keep all off when committing.

## Known issues / honest limits
- Preview only: no Spectacles hardware testing. Voice is device-only (no mic ASR in Preview).
- Real taps on the editor pills and the Discoveries card are untested (tests call the same functions).
- The universe layout is cramped on the current stage; the chase is only about 10 cm.
- Cat facing direction was tuned in Preview only; the real model's forward axis on device is unconfirmed.
- Up to 8 objects. Post-effects (bloom/glow) were not measured; no fps figures.
- Lens Studio can run stale scripts: always run `RecompileTypeScriptTool` before refreshing the Preview.

## Locked direction (next work, not yet implemented)
A user-created living world in the user's real room. Creation and simulation are the two primary actions. No new rules, shapes or challenges.
- **Room as canvas:** remove the stage disc; objects live 0.5-2 m away at different heights, on real surfaces (WorldQuery, Sunlit Room table/floor as fallback) or floating; bounds become a large volume; retune forces, distances, collision sizes and caps for room scale; hero objects 20-40 cm.
- **Sample world plus live creation:** a `room` preset as the sample world (island house above the table, flower on the floor, floating lantern, cat on the floor), story through the real rule engine (cat-lantern Attract, lantern into flower fires the trigger, flips to Repel, cat flees home). The user can then create and change things live.
- **Minimal contextual UI:** controls appear only when relevant.
- **Discoveries off** by default.
- **Palette moved under Create** as "Basic building blocks".
- **Voice inside Create** (no separate Speak control).
- Preserve: AI generation, saved models, the rule engine, cause pulses, tests. Add every asset and licence to a CREDITS section in the README. Design for bright rooms (saturated colours, bright beam cores, outlined UI text). Parked decisions from the Step 0 report: UI anchoring, which saved models to keep versus new assets, whether to test bloom on a throwaway branch.

Original handoff follows (older details; this Status section wins on conflicts).

---

Read devpost/HANDOFF.md and devpost/design-brief.md. Follow section 12 rules strictly. Be terse. Never read Scene.scene or Cache files in full.



Confirm in 3 lines: lens-studio MCP connected, CLAD skills visible, plan-lens skill visible (check .claude/skills and .agents/skills; if skills only exist under .agents, copy them to .claude/skills).



Then do this, lightweight MCP calls only:



STEP 1 — RuleShiftController.js is JS, so TS errors may not block it.

\- Start Preview, collect \~10s of logs, take one Preview screenshot.

\- Report: does Preview render, are there any RuleShiftController errors, do the 7 AiPreviewAgentInspect TS errors block other scripts.

\- If Preview works, STOP and report.



STEP 2 — only if the TS errors block Preview:

\- Inspect the AiPreviewAgentInspect.lspkg manifest and location, check which scene objects use AgentInspectScript.ts, and find the real SIK/UIKit package names.

\- Choose the smallest supported fix: remove the unused package and its component if nothing in RULESHIFT depends on it, otherwise update it.

\- Zip Assets/ and the .esproj to %TEMP%\\RULESHIFT-pre-pkgfix-<timestamp>.zip first.

\- Never edit Cache files or official Spectacles packages.

\- Compile once, then rerun Step 1.



Final report: max 8 lines.



NOTE: Do not install or use AiPreviewAgent*, Leaf, or PreviewInteractTool. They import InteractionKit.lspkg, don't match SpectaclesInteractionKit, and break the TS compile.

BANNED lens-studio MCP tools (denied in .claude/settings.local.json; each reinstalls AiPreviewAgentInspect.lspkg or needs it/Leaf): PreviewInteractTool, QueryRuntimeSceneTool, CaptureRuntimeViewTool, InjectPreviewGesture, list_leaf_scenarios, run_leaf_scenario, open_leaf_panel, push_leaf_lens, set_leaf_execution_target.
ALLOWED: RunAndCollectLogsTool, CapturePanelScreenshotTool, ExecuteEditorCode, RecompileTypeScriptTool, scene-graphql, asset-graphql and other editor tools.
If a skill or tool tries to install AiPreviewAgent*/Leaf, stop and tell the user.
