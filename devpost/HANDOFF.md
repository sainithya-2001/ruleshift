# Status (room-scale build and UI stage done)

**Tests:** 424/424 PASS after the click-priority fix (section 32; 414/414 after the final fixes, section 31; 404/404 after the magic pass (see the last section; 361/361 at the final-presentation stage) on the sim clock (sections 0-24 at legacy scale K=1, section 25 at room scale). **Room-scale build:** complete in the controller; see below.

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

## Presentation fixes (screenshots `devpost/screenshots/fix*.jpg`; 351/351 tests)
1. Selected-link label sits beside its own beam midpoint (room mode); in crowded spots it slides sideways along the beam (about 14 cm), picking the least-overlapping spot. 2. Beams from one node in similar directions arc to opposite sides, taller per extra link. 3. Create menu is compact (16 cm), opens above the toolbar slid sideways to cover no object (penetration 0), with a brighter navy backing. Limit: the Preview simulates an additive display, so the backing cannot be fully opaque there. 4. Connect armed: bright cyan fill, "Tap another object" hint, selected object haloed; fixed latent bug where the next selection after a cancel appeared pre-armed. Story beat: after the flee, cat-lantern set to Attract goes 50.9 -> 28.5 cm (cat moves 17.0 cm). Scenario code removed; test flags off.

## Final presentation fixes (screenshots `devpost/screenshots/final-*.jpg`; 361/361 tests)
- **Sideboard grounding.** The room preset now stands on the real sideboard of the Sunlit Room Preview: `TABLE_Y_ROOM = FLOOR_Y = -37.5` (the thin top strip at the bottom of the default view, back edge at angular -0.277 = `SIDEBOARD_TOP`; calibrated from a Preview screenshot, 0.0509 cm per pixel at 1.25 m). Cat (x -22) and flower (x 4) stand on it, lantern floats at (16, 10), island house floats at (-21, 24). In room mode `swapInModel` drops each model so its lowest point touches the bottom of its collision sphere, so a body resting on the floor visibly touches it (`api.test.visualBottom`). `ROOM.zNear` is -116 so a floor-standing object never drops below the bottom of the view. Story re-checked: cat-lantern 51.4 -> 28.8 cm in 4 s (cat climbs off the sideboard toward the lantern), flee after the drag-into-flower flip (cat back on the sideboard at x -23, cat-lantern 49.1), switch back to Attract 49.1 -> 29.3 cm (cat moved 14.8 cm).
- **Toolbar.** Three pills 5.8 x 5.0 cm, translucent (pills alpha 0.6, strip alpha 0.12), low in the bottom-right corner; menus anchor to it (More menu clamped inside the view). `tbTop()` in the controller keeps floating panels above the sideboard line in room mode.
- **Flower.** The room's flower is a refine:true Snap3D "a glowing pink lotus flower" (30 s), decimated to 9,000 triangles with Blender (same pipeline as before) and saved over `Assets/RULESHIFT Models/flower.glb` (same asset reference, so the room preset, the Create menu's "Flower" and the scene input all use it).
- **Labels / panel.** In room mode the selected link shows no floating label (the open rule panel already names the rule; fixes the lone top-left "ATTRACT"). The label placement code remains for the test hook `labelsAll`. The rule panel still places beside the link's midpoint (`updateEditor`); its pill text is 38 so "✓ Collision Trigger" and "Transfer" fit; panels stay above the sideboard line, so the toolbar can no longer hide the lowest row.
- **Beams.** `routeArc` / `beamClip` (room mode): every frame a beam picks the arc multiplier (keeping the neighbour-separation preference first, then opposite side, then taller) that does not run through another object (`api.test.beamClipNow`).
- Create menu made more compact (14-16 cm) and its disc test uses 85% of each bounding sphere (the visible model is smaller); the "..." glyph size is capped by the pill height.
- The Preview's default panel is wider than `api.view()` (the code assumes 36 cm half width at 1.25 m, the panel shows about 42 cm); everything is placed with the conservative value.

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

## Last polish (final-* screenshots)
- Toolbar ends just left of the sideboard's right speaker (`TOOLBAR_RIGHT_ANG`); 4.8 cm pills; third pill label is "•••" (the "…" glyph rendered low). Room layout sizes: cat 22, lantern 22, flower 20, home 28.
- Beams attach at each model's visual centre: `n.vOff` (set in `swapInModel`) and `endOf(n)`, nudged toward the camera so the model doesn't hide the beam end.
- Rule panel is a single column on the free side of the link near its midpoint (room-mode node obstacles scaled 0.62); saturated colours in `EDITOR_COLOR`.
- `sparklesVfx` is disabled (stray white star); only `embersVfx` is driven.
- Section 25 story test now drags the lantern with pressStart/pressEnd. 361/361 pass.
- `final-2-mid-chase.jpg` removed; shots are final-1, -3, -4.

## Real-object nodes, step 1 (no vision, on main; screenshots `devpost/screenshots/real-*.jpg`; 383/383 tests)
- Pinching empty space (no object, button or link under the press; not while Connect is armed, a menu is open or an editor was just closed) opens a two-column name list "What is this?" beside the pinch: Lamp, Table, Plant, Speaker, Turntable, Chair, Cancel. A press elsewhere closes it. Controller: `realPinchAtScreen` / `openRealMenu` (ray onto the room depth plane z = -125, WorldQuery hit replaces it on a device), `api.realMenuInfo()`, `api.chooseReal(name|null)`; UI in `RuleShiftControls.ts` (`buildRealMenu`, `updateRealMenu`). The controls object sits at (0, -22, -95), so children of the menu are positioned LOCALLY.
- A choice creates `spawnRealNode`: an ordinary node (collider, links, selection, Connect/Remove, rule panel) with `anchored = true`, no model, a soft glowing ring (three nested additive annuli, breathing) and an outlined name tag. Default diameters (cm): Lamp 16, Table 40, Plant 16, Speaker 10, Turntable 15, Chair 30.
- Anchored means: never integrated, never clamped, never pushed (overlaps move only the other node), the Interactable drag is undone every frame, Reset keeps it, Clear and Remove delete it (and its tag). Rules: Attract rest distance has no link gap (the other node settles touching the ring); Transfer gives up 90% of the mover's speed; Grow grows the ring and collision size; Repel and Collision Trigger unchanged.
- Calibration: the Preview camera frame matches the panel (tan per pixel 0.000416, panel centre x = 823); the real turntable is at angular (-0.221, -0.2975) = (-27.6, -37.2) cm at z -125, the speaker at about (0.2575, -0.2727).
- Known limits (the ring-clipping limit is fixed, see the review section below): the sideboard objects are all at the same depth plane in Preview, so anchoring is by the ray's angular position.

## Real-object nodes, step 2 (vision) - token file
- `Assets/Scripts/googleTokenLocal.ts` (gitignored, local only) holds `export const GOOGLE_TOKEN = ""`; paste the Google token from Lens Studio's Remote Service Gateway Token window between the quotes on line 3. `GoogleConfig.ts` (committed) exposes `getGoogleToken()` (same try/require pattern as Snap3DConfig.ts; "" when the file is missing, project compiles without it). `googleTokenLocal.example.ts` documents the format.
- Feasibility findings: Preview camera frames work (CameraModule.requestCamera, 1392x1590, shows the simulated room); RSG offers Gemini.models (inlineData images) and OpenAI.chatCompletions (image_url). With only the Snap token passed as the Google/OpenAI token every call failed with an empty error, so a real Google token is needed.

## Real-object nodes, step 2 (vision; 391/391 tests)
- With a token in `googleTokenLocal.ts`, a pinch on empty space shows a small "Looking..." plate (no list), crops the camera frame (360 px square around the pinch point, `RealVision.ts`), asks Gemini "Name the single real object at the centre of this image in 1-2 words", and creates the real node with the answer (a known type keeps its default size, any other name gets 14 cm). On any failure or after 8 s the name list appears instead; a late answer is ignored; a press elsewhere cancels. Without a token nothing changes (list immediately).
- RSG quirk: `RemoteServiceGatewayCredentials.setApiToken` only handles the Snap token, so the Google token is written to the static `googleToken` field (`as any`) right before every call (the credentials component resets it at start).
- Models tried in order: gemini-2.5-flash, then gemini-2.0-flash (2.0 failed in Preview at first call). Measured in Preview: Turntable 3.4 s, Speaker 6.1 s (first run 4.8 s / 4.8 s); the 8 s limit is close to the slow end.
- Tests use a stub provider (`api.setVisionProvider`), section 29; section 28 clears the provider so tests never call Gemini.
- The camera frame to angle calibration (0.4164 mrad per pixel, frame centre = view centre) is measured for the Preview; on a device the intrinsics differ, so the crop (generous 360 px) may be off-centre.

## End-to-end review (392/392 tests)
- Screenshots `devpost/screenshots/review-*.jpg`, default camera, scripted through the UI handlers (room, play, drag lantern into lotus, back to Attract, pinch turntable, cat to turntable, Surprise, Reset, Clear). All eight beats pass.
- Fix: the ring and tag of a real object are shifted just enough to stay inside 97% of the visible view (`updateRealVisuals`); the collision circle stays on the object. New test in section 28.
- Observed, not fixed: after the lantern hits the lotus the lotus drifts under the toolbar's left edge; the lantern-lotus beam passes under the toolbar plate; a generated object can be small and partly hidden by beams.

## Final visual fixes (403/403 tests)
- Toolbar no-go zone: the controller gets the toolbar plate's angular rectangle (`setToolbarRect` from RuleShiftControls.ts, top = `toolbarTopAng`). In room mode `clampToBox` moves any object whose disc would overlap it out the short way (left or up); beams (`beamClip`/`routeArc`) count samples inside it as clipping, so they arc the other way.
- Surprise objects: `heroSpot` picks a spot in the visible view clear of nodes, beams and the toolbar (falls back to ignoring beams); a generated model is scaled by its longest side to 22 cm (`HERO_CM`) instead of fitting a sphere around its diagonal, which made flat models small.
- Cat start is back on the sideboard at (-25, floor) and tests 25/27 require it on the surface again. Only when a real-object node overlaps a node's start does Reset (`stepAsideOfReal`) set that node down on the surface at the nearest free spot (sideways or a little deeper into the room, grid search over the play volume, clear of the other nodes, the view edge and the toolbar). With the turntable the only fit is 18 cm: the cat is scaled to 18 cm (growK, restored to full size by the next Reset without the node) and stands behind-right of the ring at about (-19, floor, -136).
- The real-object name tag on the surface rides 24 cm above the floor (above the cat's head).
- Vision fallback limit is 12 s (`VISION_LIMIT`).
- Screenshots `devpost/screenshots/review2-*.jpg`: room loaded, after flee, after Surprise, cat at the turntable.
- Screenshots `review3-*.jpg`: room loaded, cat at the turntable, after Reset with a turntable node present.

## Magic pass (visual only, no rule or physics changes; 404/404 tests; screenshots `devpost/screenshots/magic-*.jpg`)
Target look: a warm, magical evening room where the creations glow and light the room. The Preview environment is a Lens Studio panel setting (not stored in the project): set it with `PreviewPanelTool setConfig` (Interactive, `.../InteractiveResources.bundle/Scenes/Evening Room`). Evening Room has the Sunlit Room furniture, so the sideboard, turntable and speakers sit where they did; nothing was recalibrated, and the room still looks fine in Sunlit Room (checked).
- **Light pools** (`updatePools`, `makePool` in the controller): for the lantern (warm orange), lotus (pink) and cat (faint, warm) a camera-facing wall halo just behind the model plus a flat pool on the sideboard top under it, both as nested additive discs (no real lights; 6 wall and 4 floor discs, falloff like (1-r)^2, flicker on the lantern). The floor pool fades and widens with the object's height. Gotcha: the shader squares alpha (colour and alpha are both premultiplied), so use `baseColor = (c*a, a)` with a around 0.2-0.7. Render order -9 keeps pools under the UI; the wall halo depth-tests so models hide it.
- **Cat aura**: a tight warm halo (6 discs) behind the cat so only its rim shows.
- **Beams**: three layers per beam: body (rule colour, 1.1x width), soft halo (2.9x width, alpha 0.34, rule colour) and a white core (0.4x). A gentle travelling wave (amplitude about 0.5 cm, pinned at both ends) runs along the arc; motes follow it. 3 sparkles per beam drift off it and fade (never shown near the view edge). `setBeamColor` tints body and halo (flash goes white); the core stays white.
- **Ambient magic** (`updateMagic`): 4 fireflies orbiting the lantern, 4 slow air motes (alpha 0.5 max, recycled when they leave the view), plus the existing ambient sparkles (cap 5: warm from the lantern, pink from the lotus). The stock Embers VFX is now always off (it scattered red specks across the whole view). Hard caps: `api.test.magicCount() <= magicMax`, `ambientCount() <= ambientMax` (new check in section 25).
- **Glassy UI** (RuleShiftControls.ts + `api.makeRound`, `makeRuleIcon`): the toolbar is one dark translucent rounded bar (`GLASS`) with a three-layer soft purple glow outline (`glowFrame`) and faint dividers; the blue pill plates are gone, words and icons are white (sizes and tap targets unchanged). The rule panel is a dark glass card with the same glow; each row is a glass row with a round coloured icon chip (white glyph per rule: two triangles in/out, burst, arrow, ring) and the current rule outlined in its own colour and marked with a check. Text size 30 with left padding so words clear the chip. `fill` of each row is still the per-rule colour (test 22).
- **Hero models**: the island was regenerated twice with refine:true as "a floating island with a cozy cottage, a blossoming tree and a glowing waterfall" (29 s and 32 s, 30,000 triangles each, decimated with Blender to 9,000). Neither shows a waterfall and both hide the cottage under large faceted blossom canopies (the second is also very dark), so the current `house.glb` (a readable cottage) is kept. Previews rendered with Blender workbench; the candidates were not added to the project. The harness `genModels` now only regenerates the island (two parallel tries).
- **fps** (Evening Room, Lens Studio focused, Preview still throttled): before the pass about 6.6 (5.9-7.2 over 11 five-second samples); after about 6.0 (5.6-6.5), then 5.6 after trimming particles, so run-to-run drift is as large as the effect. Interleaved on/off A/B after the pass (`perfSweep`, drift cancels): all RULESHIFT content 4.71 vs 5.22 fps (about 0.5 fps, 10%), ambient (fireflies, air motes, sparkles) 5.94 vs 6.26, light pools + cat aura 5.95 vs 6.21, beams (core, halo, wave, trail) 4.90 vs 4.89 (no measurable cost), UI 4.97 vs 5.49. Particle counts were trimmed once (trail 4 to 3, fireflies/air 5 to 4, sparkles 6 to 5, pool discs 7/5 to 6/4). The 15 fps target is still not reachable in the Preview; the cost of the new content is about 0.5 fps there.
- **Screenshots** (default camera, Evening Room): `magic-1-room.jpg` (room loaded), `magic-2-chase.jpg` (mid-chase, frozen), `magic-3-pulse.jpg` (the lantern hits the lotus: the cause pulse burst), `magic-4-fled.jpg` (after the flip: blue Repel beam, cat back on the sideboard), `magic-5-rules.jpg` (rule panel open).
- Harness changes (`showRoom` + `roomPlay`): the lantern is now glided into the lotus while held (pressStart / pressEnd) because a teleport has no approach speed and does not fire the collision trigger; the sim is frozen on a pulse in flight (`room-pulse (frozen)` marker) for 14 s, then released. `perfSweep` now also A/Bs pools and beams. Keep all flags off when committing.

## Final fixes (ground-bound cat, flee shot, bigger rule labels; 414/414 tests; screenshots `devpost/screenshots/magic2-*.jpg`)
- **Ground-bound cat** (`groundBound(n)`: room mode, not anchored, model kind "cat"): forces on it are horizontal only (x, z), its velocity y is zero, and `settleGrounded` drops it straight onto `FLOOR_Y + radius` when let go in the air. For a pair with a ground-bound creature, ATTRACT rests at the horizontal distance that keeps the 3D rest gap (zero when the other object floats high), so a cat chasing the floating lantern walks beneath it; REPEL pushes it sideways; overlaps are resolved sideways (`sqrt(minD^2 - dy^2)`). The hop is the existing visual hop. Rules, forces and magnitudes are otherwise unchanged. Test hooks `api.test.groundBound(i)`, `api.test.pulseLook()`.
- **Flee shot**: the white blob and the "lantern close to the camera" were the node pop (`PULSE_AMOUNT` 0.9: a model swelled to 1.9x, spilling past the view bottom) plus a 9 cm additive pulse head. Now the pop is 0.25 and the head is 1.5 x K = 3.6 cm (trail 2.9/2.2/1.4 cm, lower alpha). Dragged objects were already clamped to `ROOM.zNear/zFar` by `clampToBox`; a new test drags the lantern to z -50 and -400 and checks it stays in range.
- **Rule panel**: label text size 30 -> 45 (`editorTextSize` in `RuleShiftControls.ts`), pills 11.8 x 3.6 cm (were 8 x 3). Layouts are now column, 2x3, 3x2 (a single row of five no longer fits the view). Test hook `editorFit().textSize`.
- Tests: section 31 (cat height never changes while chasing and fleeing, walks beneath the lantern, drops when let go in the air, drag depth clamp, pulse head and pop limits, nothing cut off at the bottom, label size 45 fits).
- Screenshots (Evening Room, default camera): `magic2-1-chase.jpg` (cat walking along the sideboard toward the lantern), `magic2-2-pulse.jpg` (small pulse head), `magic2-3-fled.jpg` (after the flip: Repel, cat on the sideboard), `magic2-4-rules.jpg` (rule panel, larger labels).

## Click priority and beam tap targets (424/424 tests)
- **Root cause of "the click passes through the beam"**: the Lens physics probe (`Physics.createGlobalProbe().rayCast`) answers in a later frame (its callback is asynchronous), but `rayBlocked` read the result straight away, so it never blocked anything: every press on empty-looking space (and on a beam, whose straight chord collider the curved arc slips past) opened the real-object pinch. Found with a test that logged the result before and after a 0.2 s wait.
- **Fix**: `pointerPress(sp)` (TouchStartEvent calls it; `api.test.pointerPress` runs the same function) resolves a press in order: the open editor, placement, then a synchronous geometric test (`virtualHitAt`: nodes by their collision spheres, then link beams as 24 points along the arc within `TAP_W/2` = 3 cm of the ray), then the asynchronous physics ray for UI and anything else with a collider, and only if nothing is hit the real-object pinch. A beam hit calls `tapLink` (the SIK interactor path calls it too; a second call within 0.45 s is ignored). `realPinchAtScreen` also refuses a node or beam hit.
- **Beam tap targets**: each link carries `TAP_SEGS = 6` box colliders (6 cm wide) that follow the current arc every frame (trimmed where the beam is inside an object); they are added to the link's Interactable and registered with SIK's InteractionManager from `RuleShiftControls.ts` (`api.registerLinkColliders`). The old straight chord collider shrinks to a token size once they are registered. Halos, light pools, fireflies and motes have no colliders.
- **Rules pill**: with an object selected that has links, a **Rules** pill sits between Connect and Remove; tapping it lists the links ("-> Lantern", "-> Turntable"); tapping one opens that link's rule panel (`api.selectedLinks`, `api.openLinkEditor`).
- Test section 32 (also runnable alone with the tests object flag `only32`): physics ray through the cat-lantern arc at 40/50/60%, press mid-arc while Running opens the panel and creates no real node, press within 2 cm of the beam, press on a node, on a toolbar pill (no real-object list), on empty space (list still opens), Rules pill list and link pick. Test 28's empty spot is now chosen among candidates that are not on a node or beam.
- Caveat: the tests drive the press function and the physics ray directly; they do not synthesise a real mouse event.
- Note: while recording, the Controller's `demoPreset`/`demoStage` may be set in the open Lens Studio scene (unsaved); the test run needs `demoPreset` off (test 0 expects an empty start). Never save the project with those left on.
