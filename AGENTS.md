# AGENTS.md — Pi Coding Agent adapter for agentic-stack

[Pi Coding Agent](https://github.com/badlogic/pi-mono) reads `AGENTS.md`
(or `CLAUDE.md`) natively as workspace-level context. This file points
it at the portable brain in `.agent/`.

## Startup (read in order)
1. `.agent/AGENTS.md` — the map
2. `.agent/memory/personal/PREFERENCES.md` — user conventions
3. `.agent/memory/semantic/LESSONS.md` — distilled lessons
4. `.agent/protocols/permissions.md` — hard rules

## Skills
Pi scans `.pi/skills/` at startup. The install script symlinks
`.pi/skills` → `.agent/skills` so every skill under the portable brain
is visible to pi without duplication. Customize under `.agent/skills/`;
pi sees it immediately on `/reload`.

## Automatic memory (no manual calls needed)
`.pi/extensions/memory-hook.ts` is installed by the adapter and
auto-discovered by pi at startup. It:

- Logs every `bash`, `edit`, and `write` tool call to
  `.agent/memory/episodic/AGENT_LEARNINGS.jsonl` automatically —
  same signal Claude Code captures via `PostToolUse`.
- Skips `read`, `find`, `ls`, `grep` and low-importance bash calls
  (grep, cat, echo, etc.) to keep the log signal-rich.
- Runs `auto_dream.py` when the session ends (quit / new session /
  resume) so the dream cycle fires without a cron job.

For deploy / ship / migration / schema tasks the extension scores
importance automatically — no manual `memory_reflect.py` calls needed
for individual tool actions.

## Recall before non-trivial tasks
For deploy / ship / migration / schema / timestamp / date / failing test /
debug / refactor, FIRST run:

```bash
python3 .agent/tools/recall.py "<description>"
```

Surface results in a `Consulted lessons before acting:` block and follow
them.

## Memory discipline
- Update `.agent/memory/working/WORKSPACE.md` as you work.
- After significant actions, run
  `python3 .agent/tools/memory_reflect.py <skill> <action> <outcome>`.
- Never delete memory entries; archive only.
- Quick state: `python3 .agent/tools/show.py`.
- Teach a rule in one shot:
  `python3 .agent/tools/learn.py "<rule>" --rationale "<why>"`.

## Hard rules
- No force push to `main`, `production`, `staging`.
- No modification of `.agent/protocols/permissions.md`.

## Pi-specific
- System prompt override: `.pi/SYSTEM.md` replaces pi's default system
  prompt entirely.
- Prompt templates: `.pi/prompts/`.
- TypeScript extensions: `.pi/extensions/` (auto-discovered at startup).

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **jam-p2p** (862 symbols, 1201 relationships, 17 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/jam-p2p/context` | Codebase overview, check index freshness |
| `gitnexus://repo/jam-p2p/clusters` | All functional areas |
| `gitnexus://repo/jam-p2p/processes` | All execution flows |
| `gitnexus://repo/jam-p2p/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
