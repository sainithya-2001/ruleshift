# How RULESHIFT changed (design evolution)

## Where it started
The plan-lens interview produced a short design brief with one spatial moment: three coloured spheres, connected by Attract or Repel, and the user switching a connection's rule **while the system runs** and watching everything rearrange. The brief made us pick that one moment and answer "why glasses?" (a world placed in your space that you can reach into). It stayed the reference for every later decision.

## MVP: it worked, but it was a toy
We built it to the brief: a small stage, spheres, three rules, a live rule editor. The live switch worked. It also read as a physics toy on a table-sized stage, with nothing connecting it to the room you were in.

## Open creation
We replaced the fixed spheres with creation: first a palette of shapes, then Snap3D generation ("Surprise me" turns a prompt into a 3D model in about 30 s), and voice creation for Spectacles. Two rules (Transfer, Grow) and visible cause pulses were added so rules could chain.

## The SPECS Live Review
The review feedback was: use the real world, keep the UI small, make a few big buttons, know your user, show the full experience. We changed a lot:
- The room became the world. The stage disc was removed; objects stand on furniture or float at room scale (hero objects 20-40 cm, about 1.25 m away).
- The toolbar went from seven buttons to three (Create, Play/Pause, "…"). Controls appear next to the selected object or link, and rule labels are hidden until a link is selected.
- Discoveries (the goals card) went off by default.

## "Shares your view"
Real objects can join the system. Pinch empty space and, with a Google token, a camera frame crop goes to Gemini, which names the object. It then becomes an ordinary node you can link and give rules to. In the demo the cat walks to the real turntable. Without a token you pick from a short name list instead.

## Magic pass
We made it an evening room: soft light pools under the lantern, lotus and cat; beams with a white core, a coloured halo and a sparkle trail; fireflies and slow motes, with hard particle caps; glassy UI; and a cat that stays on the surface and walks beneath the floating lantern.

## What stayed constant
Live editing of relationships while the world runs. Every redesign made that moment easier to see, never different.

## How we built and tested it
CLAD and the Lens Studio MCP, driven by Claude Code. The LEAF and AI Preview Agent packages conflicted with the installed Spectacles Interaction Kit and broke the TypeScript compile, so we did not use them. We wrote our own test harness inside the Lens instead: 414 checks on a fixed simulation clock, run before every commit.

## Known limits
- Tested in Lens Studio's Preview only; no Spectacles hardware, so comfort and hand-tracking feel are unproven.
- Voice works only on Spectacles (Preview has no microphone speech recognition).
- Preview runs at roughly 6-9 fps on our machine, and the Lens costs well under 1 fps of that.
- Surfaces are calibrated to the Preview room (the sideboard top and turntable). On a device the Lens relies on WorldQuery hits, which we could not test.
- Real-object recognition needs a Google token and takes 3-6 s per pinch in Preview.
