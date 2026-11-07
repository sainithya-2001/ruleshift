# Status (updated after Step 3)

Built since the original handoff: Transfer and Grow rules (5 rules total); contextual rule editor (tap a link, panel of 5 coloured pills beside it, applies live); Discoveries card (5 system-event goals, sparkle + caption, persists until Clear); universe preset (saved Snap3D models in `Assets/RULESHIFT Models/`, hand-triggered chain: lantern starts far, cat chases ~10 cm, drag lantern into flower to fire the chain); placement-hint fix; sim-clock test mode (`fixedStep`, 0.1 s per frame, set by the harness).

Tests: 308/308 PASS on the sim clock (`runTests` on the RULESHIFT Tests object, read the `RULESHIFT TEST SUMMARY` log line, turn it off after). Workflow: tests pass before each commit; commit and push per step.

Limits to state honestly: tested in Lens Studio Preview only (no Spectacles hardware); voice is device-only (Preview has no mic ASR); real taps on the editor pills and Discoveries card are untested (tests call the same functions); the universe layout is cramped.

Still-valid rules from the original handoff follow.

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
