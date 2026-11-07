# Status (room-scale build and UI stage done)

**Tests:** 342/342 PASS on the sim clock (sections 0-24 at legacy scale K=1, section 25 at room scale). **Room-scale build:** complete in the controller; see below.

## Room scale (what changed)
- World scale `K = ROOM_K = 2.4`: every distance, speed, force, threshold and size is multiplied by K. `api.test.setWorldScale(1)` restores the legacy 46 cm stage so the original regression suite still runs (the suite starts with it); section 25 switches to ROOM_K. In the room, link rest gap is 6 cm (not K-scaled) and the repel range is 48 cm (`gapK()`, `repK()`), so a compact layout still has room to travel.
- Stage disc removed. Play volume `ROOM = {x:36, yMax:42, zNear:-110, zFar:-145}` (x 36 cm is exactly the default Preview view at 1.25 m, so nothing can leave the screen). Virtual table plane `TABLE_Y_ROOM = -24` (24 cm below eye level) is also `FLOOR_Y`, the volume's floor. WorldQuery hits take precedence when present (none in Preview).
- Measured in the Sunlit Room Preview: the real coffee table is about 3.2 m away, the real floor about 1.5 m below the eye, so there is no real table within 2 m. Runtime view tan x 0.289, tan y 0.331. The toolbar is world-fixed at the bottom of the default view (top edge about -0.28 in angular terms); `api.toolbarTop()` exposes it.
- `demoStage="room"` (`ROOM_LAYOUT`, all at z -125, visible from the default camera, above the toolbar): house 28 cm at (-21, 26) floating high left; cat 26 cm on the table at (-22); lantern 22 cm at (14, 14) floating between and above; flower 24 cm on the table at (24). Links at the start: lantern-flower COLLISION_TRIGGER, cat-lantern ATTRACT only (no cat-home link). The cat travels about 14 cm toward the lantern; after the flip to Repel it flees about 20 cm back toward the left, under the house. Real rule engine only. Add a cat-home Attract only if you want it to settle at home.
- Visual pass at scale: thin beams, depth-scaled labels, captions above their node, Delete pill depth-aware, ambient sparkles scaled. Embers and Sparkles VFX follow the lantern and hover over the flower (`embersVfx`/`sparklesVfx` controller inputs).
- Models: the four saved GLBs are now decimated to 9,000 triangles each (from 30,000; house/lantern are the refined round-2/round-1 Snap3D versions, cat/flower the originals). Decimated with Blender 5.2.3 in background mode (merge vertices, collapse decimate, glTF export). Blender here is the Microsoft Store build: `C:\Program Files\WindowsApps\BlenderFoundation.Blender_5.2.3.0_x64__ppwjx1n5r4v9t\Blender\blender.exe` cannot be run directly (access denied); run it through `C:\Users\saini\AppData\Local\Microsoft\WindowsApps\blender-launcher.exe --background --python script.py -- args` (Start-Process -Wait; no stdout, so write results to a file).
- VFX: low-count copies in `Assets/VFX/embers_lite.graphVfx` (30 particles, rate 14; stock was 500, rate 500) and `sparkles_lite.graphVfx` (120, rate 12; stock was 2000, rate 200). The package originals stay in `Packages/`; the scene components point at the lite copies.
- Screenshots (default camera, no pitch): `devpost/screenshots/room-before-play.jpg`, `room-chase.jpg` (frozen mid-travel), `room-fled.jpg` (after the flip and the flee).
- Test-only flags on the tests object: `showRoom`, `roomPlay` (Play, freeze frames for screenshots, lantern drag, flip), `perfSweep` (interleaved on/off fps A/B of each subsystem), `genModels`. `api.test.prof(true)` / `profReport()` give a CPU profile of the update loop; `api.test.perfSet(name, on)` switches subsystems. Keep all flags off when committing.

## Performance (measured; Lens Studio NOT focused)
- Same way each time: `showRoom` on, `RULESHIFT ROOM fps` log lines (5 s averages).
- Before (30k-tri models, stock VFX): 4.2-5.7 fps, average about 4.9. JS in the update loop is only about 3.5 ms per frame (beams 1 ms, UI 1 ms, everything else under 0.4 ms), so per-frame JS allocation is not a bottleneck and beam segment counts were left alone.
- After decimating the models alone: 3.9-4.4 fps (no measurable change; Preview throttle noise is +-1 fps and swings between 2 and 13 fps during asset import and right after reloads).
- After the low-count VFX (quiet state): steady 8.5-8.7 fps. Interleaved on/off A/B (drift cancels): all RULESHIFT content on 8.48 vs all off 8.66; UI 8.58 vs 9.01; lighting 8.66 vs 8.71; ambient sparkles 8.72 vs 8.57. So the Lens now costs about 0.2 fps; the Preview itself is the limit. The 15 fps target is NOT reached unfocused; the user measured 5-7 fps focused before these changes and should re-measure focused (click the Lens Studio window; read `RULESHIFT ROOM fps`).
- Evidence for the VFX being the big cost: a one-shot sweep on the stock-VFX state (30 s pre-roll, models already 9k tris) gave baseline 3.9 fps, VFX off 9.7 fps (noisy single reading, not interleaved). Interleaved on/off on the lite-VFX state (drift cancels): vfx 5.03 vs 5.17, beams 5.89 vs 5.99, halos 6.65 vs 7.12, models 8.41 vs 8.68, SIK visuals 7.88 vs 7.61 (fps drifts upward during the run, so only the on/off difference within a block means anything).
- Stray folder: an early failed unzip created `C:\c\Users\...` (my mistake, outside the project); safe to delete.

## UI stage (done)
Small UI, big few buttons, only what is needed. All in `Assets/Scripts/RuleShiftControls.ts` plus small controller hooks.
- **Toolbar** (nothing selected): three big pills low in the view, `[Create] [Play/Pause] […]`, on a `Toolbar Root` that eases toward the camera rotation (`updateToolbarFollow`, 5/s smoothing; identity in the Preview where the camera is fixed). A tiny **status** word sits above Play: Building (yellow) / Running (green) / Paused (orange). Toolbar top is still published through `api.setToolbarTop` so the rule editor and Discoveries card keep clear of it.
- **"…" menu**: Reset, Unlink, Clear (Unlink kept so no function is lost). **Create menu**: "Imagine something new" (Surprise, Speak), "Your creations" (saved models via `api.spawnSaved(name)`, `api.savedModels()`), and a collapsed "Basic building blocks" pill that opens the old palette band. One menu open at a time; menus close on any action, Play, or when the rule editor opens.
- **Speak in the Preview** shows the caption "Voice works on Spectacles" (`deviceInfoSystem.isEditor()`); on device it is unchanged (ASR). `api.test.forceVoice(true)` bypasses the check.
- **Object selected**: **Connect** and **Remove** pills stacked beside the object (right, or left near the view edge) at the nearer depth 70 so nothing covers them; hidden while the object is generating or a menu is open. Connect arms linking (`api.connectSelected()`, `connectArmed()`): the next object tapped is linked (Attract); with exactly two objects it links them at once. The pill turns blue-bright while armed. Remove = old Delete (`deleteObj`/`deletePlate` names kept).
- **Connection selected**: the rule editor, 5 coloured rule pills in a compact panel beside the link, the current rule bright with a white border and a check mark.
- **Discoveries off by default** (`api.setDiscoveries(true)` turns the card and "Discovered" captions back on; section 23 of the suite enables it). **First-time hint** "Create something to begin" shows only on an empty stage until the first object exists, never on presets (`api.setFirstHint`, `firstHintVisible`). The placement hint ("Pinch a surface to place it") is unchanged.
- **Bright rooms**: every pill has its own saturated blue plate (`PILL`), the Button's grey plate is hidden (`opacity = 0`), pill text is white with a dark outline (`updateOutlines`), captions/status are outlined.
- Test hooks: `api.test.openMenu('create'|'more')`, `closeMenus`, `menuState`, `menuPills`, `statusText`, `forceVoice`, `connectColor`; tests object flag `showUi` (room preset, holds 24 s each on: nothing selected, Create menu, object selected, connection selected).
- Screenshots (default camera, room preset): `devpost/screenshots/ui-nothing-selected.jpg`, `ui-create-menu.jpg`, `ui-object-selected.jpg`, `ui-connection-selected.jpg`.
- Not done / honest limits: only the toolbar follows the head; the object pills, rule editor and card are still anchored in angular space at the world plane (fine for a fixed Preview camera, untested head-moving on device). The Create menu covers part of the room while open. Real taps on the new pills are untested (tests call the same handlers).

## E2E run (room preset, default camera, scripted through the UI handlers; screenshots `devpost/screenshots/e2e-*.jpg`)
Cat-lantern 43.8 -> 29.0 cm in 8 sim s on Play; drag lantern into flower: pulse, cat-lantern flips to REPEL, cat flees x -8.2 -> -22.3 (cat-lantern 51.8); cat-house link settles at 32.9 cm (rest = radii 27 + gap 6); real Snap3D "a glowing alien flower" arrived in about 26 s and linked to the cat; saved Flower spawns at a free spot; Reset -> Building, Clear -> 0 objects. Known visual limits: the rule label of a selected link can sit far from a link whose neighbourhood is crowded (it is nudged up past nodes); the Imagining caption can overlap another object behind the orb; the Create menu covers the cat while open; two links from the same node can run along each other. Menu pill text raised (More 46 -> 58, creations 52 -> 58). The e2e scenario code was removed after the run.

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
- Test-only scene flags on the tests object: `showRoom`, `showUi`, `roomPlay`, `genModels`, `showUniverse`, `showEditor`, `showGrow`, `showShots`, `shotsPulses`, `liveImagine`, `showCause`. Keep all off when committing.

## Known issues / honest limits
- Preview only: no Spectacles hardware testing. Voice is device-only (no mic ASR in Preview).
- Real taps on the editor pills and the Discoveries card are untested (tests call the same functions).
- Legacy `universe`/`chain` presets are now K-scaled copies about the camera (look identical on screen).
- Story physics in the room: the cat is pulled equally by lantern and house, so it hovers between them rather than strictly chasing.
- Cat facing direction was tuned in Preview only; the real model's forward axis on device is unconfirmed.
- Up to 8 objects. Bloom was skipped by decision; no focused fps figure yet (see fps).
- Lens Studio can run stale scripts: always run `RecompileTypeScriptTool` before refreshing the Preview.

## Locked direction (room-as-canvas and UI items done)
A user-created living world in the user's real room. Creation and simulation are the two primary actions. No new rules, shapes or challenges.
- **Room as canvas:** remove the stage disc; objects live 0.5-2 m away at different heights, on real surfaces (WorldQuery, Sunlit Room table/floor as fallback) or floating; bounds become a large volume; retune forces, distances, collision sizes and caps for room scale; hero objects 20-40 cm.
- **Sample world plus live creation:** a `room` preset as the sample world (island house above the table, flower on the floor, floating lantern, cat on the floor), story through the real rule engine (cat-lantern Attract, lantern into flower fires the trigger, flips to Repel, cat flees home). The user can then create and change things live.
- **Minimal contextual UI:** controls appear only when relevant.
- **Discoveries off** by default.
- **Palette moved under Create** as "Basic building blocks".
- **Voice inside Create** (no separate Speak control). Done.
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
