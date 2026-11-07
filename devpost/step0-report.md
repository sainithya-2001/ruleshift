# Step 0 report: room-scale plan (re-run, 2026-11-06)

Nothing was installed into the project. Candidate packages were downloaded to a scratch folder and inspected there. The bloom test ran on a throwaway branch, which is now deleted. `main` is clean.

## What must change (from the locked direction in HANDOFF.md)
- Remove the stage disc. Objects live 0.5-2 m away at different heights, on real surfaces (WorldQuery, with the Sunlit Room table/floor as the Preview fallback) or floating.
- Bounds become a large volume. Forces, distances, collision sizes and object caps all need retuning for room scale. Hero objects should be 20-40 cm.
- Add a `room` preset as the sample world (island house above the table, flower on the floor, floating lantern, cat on the floor).
- The story runs through the existing rule engine: cat-lantern Attract, lantern into flower fires the trigger, flips to Repel, and the cat flees home.
- UI becomes minimal and contextual. Discoveries is off by default. The palette moves under Create as "Basic building blocks". Voice moves inside Create.
- Design for bright rooms: saturated colours, bright beam cores, outlined UI text.

## What is preserved
AI generation, saved models (`Assets/RULESHIFT Models/`), the rule engine (five rules), cause pulses, the rule editor, and the sim-clock tests (308/308). Every added asset and its licence goes in a README CREDITS section.

## Asset Library candidates
**How this was checked.** Search results give only name, ID and download link. I downloaded the packages and read the manifests and meshes.
- **Licences:** no package contains licence text or an author. A per-asset licence cannot be confirmed from here, so every licence below is "unverified". Check the Asset Library listing or Snap's terms before shipping, and credit each asset.
- **Polycounts:** triangle counts come from parsing the FBX files. For the Bitmoji props I assumed the model order matches the geometry order, so treat them as approximate.

| Need | Candidate | Tris | Animation | Look | Licence |
|---|---|---|---|---|---|
| Cat | **Kitty** (`5GP1a1AsXQn6Vhyd9qCwJC`) | ~8.0k | Skinned, 75 bones. AnimationPlayer clips IDLE, SLEEP, STAND_UP. **No walk.** | Realistic PBR fur, not cozy | unverified |
| Cat | **Cartoon Kitty Pack** (`4QVQWAmzOjq4ooKV8Wezbr`) | ~1.3k | Rigged (29 bones), **no clips** | Stylised, calico/grey/black skins. Best look match. | unverified |
| Cat | **Maneki Neko** (`5XvhUiuyCddr1z73cnkksr`) | not parsed (two ~60-170 KB meshes) | Static | Stylised, but a lucky-cat figurine | unverified |
| Island house | **Toybox Models** (`3t3A7Yah0D8yV7IxLBhXO1`): house, tree, cloud | not isolated (house mesh not found as a separate file) | Static | Toy-like, fits | unverified |
| Island house | **3D Verdant Environment Pack** (`MiNbN3oEuFVnPfHCJfRQ9`): "base" and "mountain" pieces | not parsed (meshes 0.3-0.9 MB, likely heavy) | Static | Landscape pieces; could serve as an island base | unverified |
| Island house | Exterior Props Vol 1, dog_house | ~580 | Static | Bitmoji style; a dog house, not an island house | unverified |
| Lantern | **Exterior Props Vol 1**, `hh_ext_lantern_bitmoji` (`1r6QZSxKB3ATLW5PJRQsVZ`) | ~610 | Static | Bitmoji style, cozy, cheap | unverified |
| Lantern | Interior Props Vol 3, table lamps (cone, classic, round base) | ~460-565 | Static | Cozy, but lamps rather than lanterns | unverified |
| Flower | **Nature Props Vol 1**, `nat_flower_cluster` / `nat_flower_small` / `nat_bush_flowers` (`1rsevZqaFVITb3mMDvErQk`) | ~540 / ~330 / ~1.2k | Static | Bitmoji style, cozy | unverified |
| Flower | Rose (`3QDhb2aAMX7Gemu5eBoXGc`) | one 64 KB mesh, not parsed | Static | Single rose | unverified |
| Flower | Interior Props Vol 3, `vase_rose` / `vase_lily` | ~2.0k / ~0.9k | Static | In a vase | unverified |
| Sparkles | **Sparkles VFX** (`3V2yK8YNC0kZx6ql8tm8t7`) | no mesh (GPU VFX graph) | Particle animation | Generic sparkle | unverified |
| Sparkles | Embers VFX (`54qp7960gAxIZbBax2MpnN`) | no mesh | Particle animation | Warm glow, suits the lantern | unverified |
| Sparkles | Blinking Stars Particles (`7ydfpbsmdfwYSfW2KuoM1b`) | no mesh | Particle animation | Needs camera Near = 0 | unverified |

**Takeaways**
- No Asset Library cat has an idle plus walk pair. The only cat with real clips (Kitty) has idle, sleep and stand-up, and its look is realistic rather than cozy.
- The Bitmoji prop packs (Exterior, Interior, Nature) are the best cozy-stylised fit and are all under about 1.2k tris, but they are static.
- The four existing saved Snap3D models already cover cat, island house, lantern and flower, with the procedural motion already built.

## Bloom
- **Setup:** the Bloom Post Effect package (`1DlikLL8DonWv66vRR9w4l`) is an extra camera, a render target and a full-screen screen-texture material. It was not installed: the Preview fps measurement turned out to be invalid, so there was nothing to compare.
- **Measurement:** I put an fps probe (a temporary script) on the throwaway branch. It read **about 1 fps (0.4-1.4)** on the empty stage and the universe preset alike. So the Preview is throttled in this environment, and fps with versus without bloom cannot be measured here.
- **Result:** no bloom fps figure exists. The probe, scene object and branch are removed. HANDOFF's "no fps figures" still stands.

## Parked decisions: recommendations
1. **UI anchoring: object-anchored contextual panels, plus one smoothed head-follow toolbar.** At room scale with objects 0.5-2 m away, a world-fixed UI gets lost and a rigid head-locked UI blocks the view. Panels near the selected object or link, and a lazily following toolbar, avoid both.
2. **Saved vs new models: keep the four saved Snap3D models as the heroes.** They are already in the story, tested and generated by the Lens's own pipeline, so no third-party licence is involved. Use the Asset Library only for ambient extras such as Embers or Sparkles VFX. Revisit Cartoon Kitty only if the procedural cat life reads poorly in the room.
3. **Bloom: skip it for now.** I have no valid fps number, it adds a full extra camera plus a screen pass, and it barely shows in bright rooms. Keep the bright additive beam cores and sparkles as the glow. Revisit only with an on-device fps measurement.
