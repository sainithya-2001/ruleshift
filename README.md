# RULESHIFT

**Rewrite the rules of your room.** A Spectacles Lens where you build a small living world in your room, connect objects with links, give each link a rule (Attract, Repel, On Collision, Transfer or Grow), and then change a rule *while the world is running* to watch the whole system respond.

It was built for Snap Spectacles and tested in Lens Studio's Preview only (no glasses hardware).

## Overview

- **Create** objects from a small menu: basic shapes, saved creations, or *Imagine something new* (Snap3D generates a 3D model from a prompt in about 30 s; voice input works on Spectacles only).
- **Connect** two objects with a link and give it one of five rules. Tap a link at any time, including while running, to change its rule.
- **Cause pulses** show chain reactions: a glowing pulse travels along each link a collision is about to flip, and the rule changes when it arrives.
- **Real objects join the system.** Pinch empty space and Gemini names the real object in a camera crop (for example a turntable). It becomes a node you can link and give rules to. Without a Google token you pick the name from a short list.
- **Room scale.** The world sits about 1.25 m away on real furniture. The sample room has a floating island house, a cat that stays on the surface and walks beneath the floating lantern, a lantern, and a lotus. The look is an evening room: light pools, glowing beams, fireflies, glassy UI.
- The toolbar is just **Create**, **Play/Pause** and **...** (Reset, Unlink, Clear). Other controls appear next to the selected object or link.

## Open it

1. Install **Lens Studio 5.23.2**.
2. Open `RULESHIFT.esproj`.
3. Run it in the **Preview** panel (Spectacles device preview). To see the sample room, set `demoPreset` on the **RULESHIFT Controller** scene object and `demoStage` to `room`.
4. For the intended look, set the Preview environment to **Evening Room** (a Lens Studio panel setting, not part of the project). Sunlit Room works too.

The Lens runs without any token; Snap3D generation and Gemini recognition are optional extras.

## Optional: tokens (local, gitignored files)

Both tokens come from Lens Studio's **Window > Remote Service Gateway Token**. Never commit a token or paste one into a scene component.

- **Snap token** (Snap3D, voice-to-3D): in `Assets/Scripts/`, copy `Snap3DConfig.example.ts` to `snapTokenLocal.ts` and paste the token as the value of `SNAP_TOKEN`. Without it, "Imagine" falls back to a placeholder orb.
- **Google token** (Gemini naming of real objects): copy `googleTokenLocal.example.ts` to `googleTokenLocal.ts` and paste the token as `GOOGLE_TOKEN`. Without it, pinching empty space opens a name list instead.

`snapTokenLocal.ts` and `googleTokenLocal.ts` (and their `.meta` files) are gitignored. A harmless "Failed to resolve dependency" log line appears once at startup when one of them is absent.

## Tests

`Assets/Scripts/RuleShiftTests.js` is a self-driving test harness inside the Lens. It spawns, links, drags, fires collisions and reads back state, on a fixed simulation clock so results do not depend on Preview's frame rate. It has more than 400 checks (414 at the last run, all passing).

To run it, turn on `runTests` on the **RULESHIFT Tests** scene object, run Preview, and read the `RULESHIFT TEST` lines in the logs. The last line is a summary (`RULESHIFT TEST SUMMARY: 414/414 PASS - ALL PASS`). The full suite takes about 9 minutes. Other flags on that object (`showRoom`, `roomPlay`, `showUi`, `perfSweep`, `genModels`) are visual or measurement runs, not tests. Keep every flag off when committing.

We did not use the LEAF or AI Preview Agent packages: they conflicted with the installed Spectacles Interaction Kit and broke the TypeScript compile.

## Known limits

- **Tested in Preview only.** Comfort, hand-tracking feel and on-device frame rate are unproven.
- **Voice is Spectacles-only.** Preview has no microphone speech recognition.
- **Preview frame rate** is roughly 6-9 fps on our machine. The Lens costs about 0.5 fps of that.
- **Surfaces are calibrated to the Preview room** (the sideboard top and the turntable). The Preview has no usable table, so a virtual surface stands in; on a device the Lens relies on WorldQuery hits, which we could not test.
- Gemini recognition needs a Google token and takes about 3-6 s per pinch in Preview.
- Only the toolbar follows the head; other panels are anchored in the world, which is untested with a moving head.
- Up to 8 objects, five fixed rules, no user-programmed physics.

## Project layout

- `Assets/RuleShiftController.js`: physics, links, the five rules, collisions, cause pulses, presets, light pools, beams, real-object nodes, Snap3D flow.
- `Assets/Scripts/RuleShiftControls.ts`: toolbar, menus, palette, voice, the rule panel (Spectacles UI Kit).
- `Assets/Scripts/RealVision.ts`, `GoogleConfig.ts`, `Snap3DGenerator.ts`, `Snap3DConfig.ts`: Gemini and Snap3D access and token lookup.
- `Assets/Scripts/RuleShiftTests.js`: the test harness.
- `Assets/RULESHIFT Models/`: the four saved models (decimated to 9,000 triangles each).
- `devpost/`: design brief, design evolution, Devpost description, handoff notes and screenshots.

## CREDITS

- **Embers VFX** and **Sparkles VFX** (Lens Studio Asset Library, `Embers_VFX.lspkg` and `Sparkles_VFX.lspkg`): the lantern's embers and the lotus's sparkles. Low-particle-count copies live in `Assets/VFX/`.
- **House (floating island), cat, lantern and flower models** (`Assets/RULESHIFT Models/`): generated with **Snap3D** through the Remote Service Gateway (house and lantern with `refine: true`), exported as GLB and decimated with Blender.
- **Spectacles Interaction Kit, Spectacles UI Kit, Remote Service Gateway, Icons, Motion, Utilities**: Snap Inc., via the Lens Studio Asset Library.
- **Gemini** (Google), called through the Remote Service Gateway, to name real objects.
- **Sunlit Room and Evening Room** Preview environments: built into Lens Studio.
- No per-asset licence text is bundled with the Asset Library packages; check each listing before redistributing.
