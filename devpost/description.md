# RULESHIFT (Devpost description, draft)

**Tagline:** Change one rule and watch a small world rearrange itself.

## The problem

Most of the systems we live inside (a power grid, a team, an ecosystem, a group chat) are made of parts connected by rules, and the surprising behaviour comes from how those rules interact. That is hard to feel from a diagram or a paragraph. You rarely get to flip one rule and see the consequences ripple through the whole thing while it is still moving.

## What it does

RULESHIFT puts a small, tabletop-sized world of glowing objects in front of you. You create objects (orb, cube, gem, cone, ring), connect pairs with links, and give each link one of five rules:

- **Attract**: the pair is pulled together up to a rest distance.
- **Repel**: the pair is pushed apart.
- **On Collision**: nothing happens until the two touch, and then the other links on those objects flip between Attract and Repel.
- **Transfer**: when the pair touches, the faster object hands most of its velocity to the slower one, like Newton's cradle.
- **Grow**: each touch makes both objects 15% bigger (up to 2x). Grow makes objects touch sooner, which fires Collision Triggers and Transfers, so the rules chain.

Press Play and the world runs. The core moment is changing a link's rule *while it is running*: tap a link and a small panel opens beside it with all five rules; pick one and the objects respond immediately, with no pause or restart. When a collision triggers a chain, a glowing pulse travels from the collision along each link it is about to flip; the link flashes and only then does its rule change, so you can see cause before effect.

You can also ask for an object instead of building one: **Surprise me** sends a prompt to Snap3D, shows a growing orb with a seconds counter while the model is generated (about 30 s), and swaps the finished 3D model in as a normal object you can drag, link and give rules to. Voice creation (say a shape and colour, or describe anything) is written for Spectacles but could not be exercised in Preview (voice is device-only).

**Discoveries** gives the sandbox open goals without a script: a small collapsible card lists five (First contact, Chain reaction, Growth spurt, Newton's cradle, Rewrite reality). Each is detected from what the system does, not from particular objects, so there are many ways to earn it, and dragging alone never does.

A **universe** preset shows the idea: four saved Snap3D models (house, cat, lantern, flower). The cat chases the lantern; you drag the lantern into the flower, the collision flips the cat-lantern link to Repel, and the cat retreats home.

## How we built it

- Lens Studio 5.23.2, targeting Spectacles, with the Spectacles Interaction Kit and UIKit for pinch, drag and the toolbar.
- A small hand-written physics loop in JavaScript: forces summed per link, integrated per node, with a stage boundary, overlap resolution and edge-triggered collision detection.
- A pooled pulse system for the cause chains, and per-frame label placement that nudges link labels off objects.
- Snap3D through the Remote Service Gateway package. The token lives in a gitignored local file; a fresh clone compiles and runs without one and falls back to the placeholder orb.
- A self-driving test harness inside the Lens itself (308 checks at the time of writing) that spawns, links, drags, fires collisions and reads back state, which we ran after every change. It runs on a fixed simulation clock so results do not depend on how slowly Preview runs. Everything was verified in Lens Studio's Preview only.

## Challenges

- **Live rule editing had to be obviously live.** The whole point is the immediate change, so we kept the world small and the motion readable, and added the pulse and flash so the change is visible rather than only felt.
- **Collisions fired repeatedly during sustained contact**, flipping links back and forth. We made the trigger edge-based: fire once on touch, re-arm only after the pair separates.
- **Generative latency and limits.** Snap3D takes about 30 s and its safety filter rejects some prompts. We designed the wait (growing orb, counter) and a clear fallback instead of hiding the delay.
- **Preview-only testing.** We have no Spectacles hardware, so hand-tracking feel, comfort and on-device frame rate are unproven, and Preview itself ran at a low frame rate on our machine.
- **Tests flaked under load.** Preview's low frame rate made timing checks fail. We moved the suite to a deterministic simulation clock instead of loosening tolerances.
- A lot of small readability problems (labels over objects, captions over objects, toolbar text wrapping) that only showed up in screenshots, which is why we kept screenshots in the test loop.

## What's next

The research direction we care about is **how people reason about interconnected systems**: do they predict the ripple from a rule change, and does watching it unfold change what they expect next time? RULESHIFT is a small instrument for asking that. Next steps would be:

- Try it on real Spectacles to learn what reaching into the world feels like.
- Add a prediction step (guess what a rule change will do, then run it) and record how predictions improve.
- Compare how different people explain the chain reactions they see.

We are not claiming a new simulation technique: the rules are deliberately simple and the physics is basic. The contribution we are aiming for is an interaction: changing a rule in a running system and watching the consequences, in your own space.

## Built with

Lens Studio, Spectacles Interaction Kit, UIKit, Snap3D (Remote Service Gateway), JavaScript and TypeScript.
