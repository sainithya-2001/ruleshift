# Status (room-scale build done; UI stage next)

**Tests:** 321/321 PASS on the sim clock (sections 0-24 at legacy scale K=1, section 25 at room scale). **Room-scale build:** complete in the controller; see below.

## Room scale (what changed)
- World scale `K = ROOM_K = 2.4`: every distance, speed, force, threshold and size is multiplied by K. A K-times copy of the stage dynamics keeps the same timing. `api.test.setWorldScale(1)` restores the legacy 46 cm stage so the original 308-check regression suite still runs (the suite starts with it); section 25 switches to ROOM_K.
- Stage disc removed. Room volume `ROOM = {x:110, yMax:80, zNear:-45, zFar:-260}`, floor `FLOOR_Y=-150`, virtual table plane `y=-75` (`TABLE_RECT`) used when WorldQuery has no hit. Placement rests objects on the surface.
- Measured in the Sunlit Room Preview (camera at the origin, eye about 1.5 m): no real table within 2 m (coffee table about 3.2 m away); runtime view about 32 x 37 degrees (tan x 0.289, tan y 0.331). So the layout is compact in angle, and the floor is only visible when the Preview camera pitches down about 18-26 degrees (MovePreviewCamera).
- `demoStage="room"` layout (`ROOM_LAYOUT`): house 40 cm at (-26,-18,-165), cat 28 cm on the floor (-12,floor,-205), lantern 24 cm (28,-70,-150), flower 26 cm on the floor (30,floor,-205). Floor items are about 2 m out in depth (not 0.5-2 m exactly; the floor is 1.5 m below the eye).
- Visual pass at scale: thin beams (0.07 radius ratio in the room), depth-scaled labels, captions above their node, Delete pill depth-aware, ambient sparkles scaled. Embers VFX follow the lantern and Sparkles VFX hover over the flower (`embersVfx`/`sparklesVfx` inputs; assets in `Assets/` from the Asset Library).
- Models: regenerated with Snap3D refine:true (2 rounds each, 8 candidates). Kept: house from round 2 and lantern from round 1 (now `house.glb`, `lantern.glb`); cat and flower kept from the original set (the refined ones were paler or lost the glow). Candidates deleted. `Snap3DGenerator.ts` accepts `opts.refine`; the `genModels` flag on the tests object reruns the comparison.
- Screenshots: `devpost/screenshots/room-before-play.jpg` and `room-chase.jpg` (taken with the Preview camera pitched -18 degrees; the second is after the collision, the blue REPEL beam and the cat heading home).
- Flags added on the tests object: `showRoom` (loads the room, prints per-node angles and an fps line every 5 s) and `roomPlay` (adds Play, the lantern drag and a flip marker). Keep off when committing.

## fps (honest)
Preview fps readings with Lens Studio NOT focused were 0.4-3.4 fps (the Preview throttles). I could not focus the window programmatically, so a focused fps figure has not been measured. To measure: turn on `showRoom`, click the Lens Studio window, and read the `RULESHIFT ROOM fps` log lines.

## UI stage (next, not started)
Object-anchored contextual panels plus one smoothed head-follow toolbar (decision from the user). Today the toolbar/editor/card are world-fixed at `WORLD_Z=-95` and overlap content when the view pitches. Also pending from the locked direction: Discoveries off by default, palette under Create, voice inside Create.

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
- `room`: the room-scale sample world (see Room scale above).
- Test-only scene flags on the tests object: `showRoom`, `roomPlay`, `genModels`, `showUniverse`, `showEditor`, `showGrow`, `showShots`, `shotsPulses`, `liveImagine`, `showCause`. Keep all off when committing.

## Known issues / honest limits
- Preview only: no Spectacles hardware testing. Voice is device-only (no mic ASR in Preview).
- Real taps on the editor pills and the Discoveries card are untested (tests call the same functions).
- Legacy `universe`/`chain` presets are now K-scaled copies about the camera (look identical on screen).
- Story physics in the room: the cat is pulled equally by lantern and house, so it hovers between them rather than strictly chasing.
- Cat facing direction was tuned in Preview only; the real model's forward axis on device is unconfirmed.
- Up to 8 objects. Bloom was skipped by decision; no focused fps figure yet (see fps).
- Lens Studio can run stale scripts: always run `RecompileTypeScriptTool` before refreshing the Preview.

## Locked direction (room-as-canvas items done; UI items pending)
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
