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
