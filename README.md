# RULESHIFT

A Spectacles Lens about rules and consequences. You build a small world of glowing objects, connect them with links, give each link a rule (Attract, Repel or On Collision), then change a rule while the world is running and watch the whole system respond.

It is built for Snap Spectacles and tested in Lens Studio's Preview only (no glasses hardware).

## Features

- **Create** objects from a palette: orb, cube, gem, cone or ring, in six colours, plain or glowing, three sizes, light or heavy, flat or bouncy. Up to 8 objects on the stage.
- **Link** two objects by tapping one and then the other. Each pair has at most one link. **Unlink** removes all links (objects stay), **Clear** removes everything, and a **Delete** pill appears above the selected object to remove just that one.
- **Three rules** per link: **Attract** (pulls the pair together up to a rest distance), **Repel** (pushes them apart) and **On Collision** (fires when the pair touches).
- **Live rule editing**: tap a link while the world is running to cycle its rule; the objects respond immediately, with no pause or restart.
- **Edge-triggered collisions**: On Collision fires once when the pair starts touching and re-arms only after they separate. When it fires, the other links on those objects flip between Attract and Repel.
- **Visible cause chains**: a glowing pulse travels from the collision along each link it will flip. The link flashes and its rule changes only when the pulse arrives, so cause comes before effect. Tapping a link sends a short pulse across it too.
- **Play / Pause / Reset**: Reset restores the starting positions and keeps your objects and links.
- **Surprise me** (optional, needs a Snap token): a one-tap Snap3D generation of a 3D object from a prompt, about 30 seconds. While it works a glowing orb grows and shows a seconds counter; when the model arrives it swaps in as a normal object you can drag, link and give rules.
- **Voice** (Spectacles only): say a shape and colour to create it, or describe anything else and it goes to Snap3D.
- A self-driving test harness (see Tests below).

## Open it

1. Install **Lens Studio 5.23.2**.
2. Open `RULESHIFT.esproj`.
3. Run it in the **Preview** panel (Spectacles device preview).
4. Tap **Create**, pick a shape and **Spawn**, place it, make a second one, tap one object then the other to link them, then press **Play**. Tap a link to change its rule while it runs.

The Preview camera pose is a panel setting, not part of the project. If the framing looks off, reset it with the camera reset in the Preview panel (the Lens Studio default pose frames the stage centred in front of the camera).

## Recording setup

On the **RULESHIFT Controller** scene object:

- `demoPreset` (off by default): when on, the Lens opens on an empty stage with no hints, ready to record.
- `demoStage` (only read when `demoPreset` is on): set it to `chain` to open with a gem, an orb and a cube spread across the stage. The gem and orb are linked with **Attract** and the orb and cube with **On Collision**. Press Play: the orb is pulled toward the gem, bumps the cube, a pulse runs down the gem-orb link, and that link flips to **Repel**.

## Optional: Snap3D token (Surprise me and voice-to-3D)

Generation uses the Remote Service Gateway package and a Snap API token. Without a token the Lens still works; "Surprise me" simply falls back to the placeholder orb with "Couldn't imagine that".

1. In Lens Studio, open **Window > Remote Service Gateway Token** and generate a Snap token.
2. In `Assets/Scripts/`, copy `Snap3DConfig.example.ts` to `snapTokenLocal.ts` (same folder).
3. Paste the token into `snapTokenLocal.ts` as the value of `SNAP_TOKEN`.

`snapTokenLocal.ts` is gitignored. Never commit a token or paste it into a scene component. Snap3D can take about 30 seconds, and its safety filter rejects some prompts; a rejected prompt also ends in the orb fallback.

## Tests

`Assets/Scripts/RuleShiftTests.js` drives the Lens itself (spawning, linking, rules, collisions, pulses, drag, imagine, captions, toolbar fit and more). To run it, turn on `runTests` on the **RULESHIFT Tests** scene object, run Preview, and read the `RULESHIFT TEST` lines in the logs; the last line is a summary such as `214/214 PASS - ALL PASS`. Turn `runTests` back off afterwards. A few extra flags on the same object (`liveImagine`, `showCause`) are for manual checks, not for shipping.

## Known limits

- **Voice is device-only.** Lens Studio's Preview cannot provide microphone speech recognition, so voice creation was written against the ASR API but could not be exercised in Preview.
- **Tested in Preview only.** Nothing has been run on Spectacles hardware, so comfort, hand tracking feel and on-device frame rate are unproven.
- **Harmless log line without a token:** `Failed to resolve dependency ./snapTokenLocal` appears once at startup when `snapTokenLocal.ts` is absent. The Lens catches it and carries on with an empty token.
- Preview ran at roughly 8-17 fps on our machine (even with an empty stage), below the 24 fps we would want. Physics steps are clamped, so motion looks slower there than it will on a device.
- Up to 8 objects. The rule system is deliberately small: three rules, no user-programmed physics.
- Generated models are fitted to a fixed stage footprint, so their on-stage size reflects the footprint rather than the prompt.

## Project layout

- `Assets/RuleShiftController.js`: physics, links, rules, collisions, cause pulses, Snap3D imagine flow.
- `Assets/Scripts/RuleShiftControls.ts`: toolbar, palette, voice, captions and the Delete pill (Spectacles UIKit).
- `Assets/Scripts/Snap3DGenerator.ts`, `Snap3DConfig.ts`: Snap3D generation and token lookup.
- `Assets/Scripts/RuleShiftTests.js`: the test harness.
- `devpost/`: design brief and submission notes.
