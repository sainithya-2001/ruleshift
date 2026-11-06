# RULESHIFT

A Spectacles Lens about rules and consequences. You build a small world of glowing objects, connect them with links, give each link a rule (Attract, Repel, On Collision, Transfer or Grow), then change a rule while the world is running and watch the whole system respond.

It is built for Snap Spectacles and tested in Lens Studio's Preview only (no glasses hardware).

## Features

- **Create** objects from a palette: orb, cube, gem, cone or ring, in six colours, plain or glowing, three sizes, light or heavy, flat or bouncy. Up to 8 objects on the stage.
- **Link** two objects by tapping one and then the other. Each pair has at most one link. **Unlink** removes all links (objects stay), **Clear** removes everything, and a **Delete** pill appears above the selected object to remove just that one.
- **Five rules** per link: **Attract** (pulls the pair together up to a rest distance), **Repel** (pushes them apart), **On Collision** (fires when the pair touches), **Transfer** (green: when the pair touches, the faster object hands most of its velocity to the slower one, Newton's-cradle style) and **Grow** (pink-white: each touch makes both objects 15% bigger, capped at 2x, with the collision radius following; Reset restores sizes). Transfer and Grow are edge-triggered like On Collision and chain with it: growing makes objects touch sooner, which fires triggers and transfers.
- **Live rule editing**: tap a link and a small panel opens beside it with all five rules as coloured pills, the current one highlighted. Tap a pill to apply it at once while the world keeps running; the panel closes on selection or a tap elsewhere. It is placed clear of objects, labels, the Delete pill and the toolbar, and follows the link if the objects move.
- **Discoveries**: a small collapsible card in a top corner (collapsed by default) lists five open goals: *First contact* (two objects collide without being dragged), *Chain reaction* (a Collision Trigger pulse changes a rule), *Growth spurt* (an object reaches max Grow size), *Newton's cradle* (a Transfer hands off velocity) and *Rewrite reality* (edit a rule while running and an object reverses). They are detected from system events, not specific objects, so each has many solutions and dragging alone never earns one. A sparkle and a "Discovered: <name>" caption mark each one; progress survives Reset and is cleared by Clear.
- **Edge-triggered collisions**: On Collision fires once when the pair starts touching and re-arms only after they separate. When it fires, the other links on those objects flip between Attract and Repel.
- **Visible cause chains**: a glowing pulse travels from the collision along each link it will flip. The link flashes and its rule changes only when the pulse arrives, so cause comes before effect. Tapping a link sends a short pulse across it too.
- **Play / Pause / Reset**: Reset restores the starting positions and keeps your objects and links.
- **Surprise me** (optional, needs a Snap token): a one-tap Snap3D generation of a 3D object from a prompt, about 30 seconds. While it works a glowing orb grows and shows a seconds counter; when the model arrives it swaps in as a normal object you can drag, link and give rules.
- **Voice** (Spectacles only): say a shape and colour to create it, or describe anything else and it goes to Snap3D.
- A self-driving test harness on a deterministic simulation clock (see Tests below).

## Open it

1. Install **Lens Studio 5.23.2**.
2. Open `RULESHIFT.esproj`.
3. Run it in the **Preview** panel (Spectacles device preview).
4. Tap **Create**, pick a shape and **Spawn**, place it, make a second one, tap one object then the other to link them, then press **Play**. Tap a link to change its rule while it runs.

The Preview camera pose is a panel setting, not part of the project. If the framing looks off, reset it with the camera reset in the Preview panel (the Lens Studio default pose frames the stage centred in front of the camera).

## Recording setup

On the **RULESHIFT Controller** scene object:

- `demoPreset` (off by default): when on, the Lens opens on an empty stage with no hints, ready to record. Presets never leave the "Pinch a surface to place it" hint showing.
- `demoStage` (only read when `demoPreset` is on): set it to `chain` to open with a gem, an orb and a cube spread across the stage. The gem and orb are linked with **Attract** and the orb and cube with **On Collision**. Press Play: the orb is pulled toward the gem, bumps the cube, a pulse runs down the gem-orb link, and that link flips to **Repel**.
- `demoStage` = `universe`: opens on four saved Snap3D models (`Assets/RULESHIFT Models/`: library house on a floating island (1.5x, heavy), cat (0.7x, light), paper lantern, glowing flower), loaded instantly with no token or wait. The cat and lantern are linked with Attract, the lantern and flower with On Collision, and the cat and house with Attract. The chain is hand-triggered: the lantern starts far from the flower and nothing collides by itself for 20 s while the cat visibly chases the lantern (about 10 cm). Drag the lantern into the flower and the collision's pulse flips cat-lantern to **Repel**, so the cat is pushed back home.
- `lightFx` (off by default, recording only): uses one halo layer instead of three and a one-sphere pulse trail, to save frames in Preview while recording. Set it before running; it is read at startup.

## Optional: Snap3D token (Surprise me and voice-to-3D)

Generation uses the Remote Service Gateway package and a Snap API token. Without a token the Lens still works; "Surprise me" simply falls back to the placeholder orb with "Couldn't imagine that".

1. In Lens Studio, open **Window > Remote Service Gateway Token** and generate a Snap token.
2. In `Assets/Scripts/`, copy `Snap3DConfig.example.ts` to `snapTokenLocal.ts` (same folder).
3. Paste the token into `snapTokenLocal.ts` as the value of `SNAP_TOKEN`.

`snapTokenLocal.ts` is gitignored. Never commit a token or paste it into a scene component. Snap3D can take about 30 seconds, and its safety filter rejects some prompts; a rejected prompt also ends in the orb fallback.

## Tests

`Assets/Scripts/RuleShiftTests.js` drives the Lens itself (spawning, linking, rules, collisions, pulses, drag, imagine, captions, toolbar fit and more). To run it, turn on `runTests` on the **RULESHIFT Tests** scene object, run Preview, and read the `RULESHIFT TEST` lines in the logs; the last line is a summary (currently `290/290 PASS - ALL PASS`). The suite runs on a fixed simulation clock (0.1 s per frame, set by the harness through the controller's test-only `fixedStep`), so waits count simulated seconds and results do not depend on host load or Preview fps; production behaviour is unchanged when `fixedStep` is 0. `showEditor`, `showGrow` and `showUniverse` set up scenes for screenshots. Turn `runTests` back off afterwards. A few extra flags on the same object (`liveImagine`, `showCause`) are for manual checks, not for shipping.

## Known limits

- **Voice is device-only.** Lens Studio's Preview cannot provide microphone speech recognition, so voice creation was written against the ASR API but could not be exercised in Preview.
- **Tested in Preview only.** Nothing has been run on Spectacles hardware, so comfort, hand tracking feel and on-device frame rate are unproven.
- **Harmless log line without a token:** `Failed to resolve dependency ./snapTokenLocal` appears once at startup when `snapTokenLocal.ts` is absent. The Lens catches it and carries on with an empty token.
- Preview ran at roughly 8-17 fps on our machine (even with an empty stage), below the 24 fps we would want. Physics uses real elapsed time split into 0.02 s substeps (at most 6 per frame), so motion keeps real-time speed above about 8 fps and slows down only below that.
- Up to 8 objects. The rule system is deliberately small: five rules, no user-programmed physics.
- Real mouse or hand taps on the editor pills and the Discoveries card are untested; the tests drive the same functions. The universe layout is cramped, so the cat's chase is only about 10 cm.
- Generated models are fitted to a fixed stage footprint, so their on-stage size reflects the footprint rather than the prompt.

## Project layout

- `Assets/RuleShiftController.js`: physics, links, the five rules, collisions, cause pulses, rule editor and card placement, discovery detection, Snap3D imagine flow, presets.
- `Assets/Scripts/RuleShiftControls.ts`: toolbar, palette, voice, captions, the Delete pill, the rule editor panel and the Discoveries card (Spectacles UIKit).
- `Assets/Scripts/Snap3DGenerator.ts`, `Snap3DConfig.ts`: Snap3D generation and token lookup.
- `Assets/Scripts/RuleShiftTests.js`: the test harness.
- `devpost/`: design brief and submission notes.
