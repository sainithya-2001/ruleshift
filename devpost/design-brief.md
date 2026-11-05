---
status: approved
---

# Design brief: RULESHIFT

## The one spatial moment
The user creates a small surreal universe in their room from colorful objects and visible connections. While it is running, they change one connection from attraction to repulsion and immediately watch the objects scatter and trigger new interactions, discovering how one rule changes the whole system.

## Why it belongs on glasses
- Uses: draws in the world; leaves your body free.
- Why it's better than the phone or laptop version: the user can look around a world placed in their physical space, reach into it to move objects, and watch the consequences around the objects rather than in a separate screen.

## Product or overlay
- Type: product: the virtual world and its rule system are the experience.
- What the real version would sense: nothing.
- Stand-in for the preview: none needed.

## Where things live
- Where the user is looking during the main task: at the small world and the connections between its objects, in front of them.
- World and objects: a comfortable miniature spatial playground around arm's length away. Keep the active area within the view; use roughly 1 m distance, slightly below eye level, and a compact footprint (defaults).
- Main controls: a small, easy-to-reach Activate/Pause/Resume and Reset area beside the world (exact placement and size default).
- Connection rule editor: appears beside the selected connection; selected object and connection get clear highlights.

## Hands and input
- Place and move objects: use large mouse-driven pinch, grab, and drag interactions in Preview.
- Create a connection: select two objects and use a clear in-world action to connect them (specific gesture/control default).
- Select and edit a connection: click/pinch the visible connection; show a compact contextual control beside it with Attract, Repel, and Trigger on Collision.
- Change a rule: choose a rule with a large, readable target; apply it immediately while simulation continues.
- Activate, Pause/Resume, and Reset: use large, easy-to-reach buttons.
- Targets are big and highlight when aimed at.
- Voice (if any) and the button that does the same job: no voice input.

## When things show
- World and objects: remain visible throughout.
- Creation mode: objects are stationary; connections and rule indicators are subtle; show Activate and Reset.
- Live mode: objects move and respond to rules; connections become less prominent; show the contextual editor only when a connection is selected; change Activate to Pause.
- Paused mode: freeze objects, make connections and rule indicators easier to inspect, and allow editing; show Resume.
- Reset: restore the initial object arrangement and stop the simulation while preserving objects and connections; return to Creation mode.
- If something needs attention out of view: none; keep the active world and controls in view.

## Done criteria
Each one can be checked in Lens Studio's preview.
1. Place at least three different virtual objects in front of the user and move them with mouse-driven pinch, grab, and drag.
2. Select two objects, create a visible connection, and assign Attract, Repel, or Trigger on Collision.
3. Activate the simulation and visibly demonstrate objects responding to their assigned rules.
4. **HIGHEST PRIORITY — CORE REQUIREMENT:** While the simulation is running, select a connection, change its rule, and see an immediate behavior change without pausing or restarting.
5. Pause, inspect or edit, resume, and reset the simulation to its initial arrangement without losing objects or connections.

## Out of scope
- Recognizing or reacting to real objects in the room.
- General-purpose user-programmed physics or unrestricted rule types; the MVP demonstrates the three named rules.
- Persistent worlds across sessions or multi-person shared worlds.

## Risks and open questions
- The preview can demonstrate standard mouse-driven pinch, grab, and drag, but not real glasses comfort or hand-tracking feel; those remain unproven.
- Uninterrupted live rule editing is the highest-priority core requirement and proof of RULESHIFT. Keep the simulation small and readable enough that the change and resulting motion are obvious in Preview.
- Exact object palette, connection-creation control, and world footprint were not chosen; marked defaults should be reviewed during the brief sign-off.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it

This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources

