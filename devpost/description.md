# RULESHIFT (Devpost description)

**Tagline:** Rewrite the rules of your room.

## What it does

RULESHIFT turns the room you are standing in into a small living world. The loop is **create, connect, play, rewrite live**.

- **Create.** Make objects from a small menu: a palette of basic shapes, saved creations, or "Imagine something new". Imagine sends a prompt to **Snap3D**, which generates a 3D model (about 30 s) that swaps in as a normal object. On Spectacles you can ask for it by voice.
- **Connect.** Link two objects. Each link carries one of **five rules**: Attract, Repel, On Collision, Transfer and Grow.
- **Play.** The world runs: a cat chases a floating lantern along the sideboard, a lotus glows pink, and the beams between objects show the rule by colour.
- **Rewrite live.** Tap a link while the world is running, pick another rule, and the objects respond immediately, with no pause or restart.

Rules chain. When a collision fires a trigger, a glowing **cause pulse** travels along each link it is about to change. The link flashes and only then flips, so you see cause before effect. In the sample room the lantern, dragged into the lotus, flips the cat-lantern link from Attract to Repel and the cat runs away.

**The world shares your view.** Pinch empty space and a camera crop goes to **Gemini**, which names the real object there. It becomes a node in the system (a turntable, a speaker, a lamp) that you can link and give rules to. The cat will walk to the real turntable.

## Who it's for

Curious people who want to build living, interactive worlds, and to learn cause and effect by changing the rules themselves. There is no code and no physics knowledge involved: you change one rule and watch what happens.

## How we built it

- Lens Studio 5.23.2 for Spectacles, with the Spectacles Interaction Kit and UI Kit for pinch, drag and the toolbar.
- A small hand-written physics loop in JavaScript. Forces are summed per link, then integrated, with edge-triggered collisions. The cat is ground-bound: it only moves horizontally on the surface.
- Snap3D and Gemini through the Remote Service Gateway. Tokens live in local gitignored files, and the Lens runs without them.
- An evening-room look: additive light pools, luminous beams with sparkle trails, fireflies and slow motes with hard particle caps, and a glassy UI.
- Our own test harness inside the Lens: 414 checks on a fixed simulation clock, run before every commit.
- Built with **CLAD and the Lens Studio MCP**, driven by Claude Code. Everything was verified in Lens Studio's Preview only.

## How the skill pack helped

The plan-lens interview forced us to choose **one key moment** (changing a rule while the system runs) and to answer "why glasses?". The resulting brief stayed our reference through every redesign. The SPECS Live Review then reshaped the product: use the real world, keep the UI small, big few buttons. The room became the world, and the toolbar went from seven buttons to three.

## Challenges

- Making the live change obviously live: small, readable motion, plus pulses and flashes.
- Collisions that fired repeatedly during contact (fixed with edge-triggering).
- Generation takes about 30 s and some prompts are rejected, so we designed the wait and a fallback.
- No Spectacles hardware: feel, comfort and on-device frame rate are unproven, and Preview runs at roughly 6-9 fps on our machine.
- The LEAF and AI Preview Agent packages conflicted with the installed Spectacles Interaction Kit and broke the compile, so we built our own test harness.
- Keeping the cat on the furniture while it chases something floating.

## What we learned

A bigger, more open world was not a better one: the version that worked was the one with the fewest buttons and the clearest cause and effect. Grounding things on real surfaces and giving them light made a bigger difference than adding features.

## What's next

- Respond to more of what the camera sees, not just one named object.
- Test on Spectacles.
- Shareable worlds.
- Research on how people reason about connected systems: do they predict the ripple from a rule change, and does watching it change what they expect next time?

## Built with

Lens Studio, Spectacles Interaction Kit, UI Kit, Snap3D and Gemini (Remote Service Gateway), JavaScript and TypeScript, Blender (model decimation), Claude Code with the Lens Studio MCP.
