# Progress tracking: the SVG mindmap

`docs/progress-mindmap.svg` is the canonical at-a-glance view of implementation
progress across all five phases. Keep it current.

## When to update it

Update the mindmap in the same change as the work it describes:

- a task moves to in-progress or done
- a task is added, removed or re-scoped
- a phase completes
- a risk is retired or a new blocker appears

Never batch mindmap updates up for later. A stale map is worse than none,
because it is believed.

## How to update it

Edit the SVG by hand. It is authored as plain, readable SVG for exactly this
reason: no diagram tool, no build step, no generated blob.

Each leaf node carries a `data-status` attribute and takes its fill from the
status palette. Change both together, then update the counters in the header
band so the summary matches the nodes.

| Status | `data-status` | Colour |
| --- | --- | --- |
| Done | `done` | `#16a34a` |
| In progress | `in-progress` | `#f59e0b` |
| Not started | `todo` | `#94a3b8` |
| Investigation only | `investigation` | `#8b5cf6` |
| Blocked / at risk | `blocked` | `#dc2626` |

Mark a task `done` only when it is verified — tests passing or behaviour
confirmed — not when the code is merely written. `investigation` is for work
whose deliverable is a documented finding rather than a feature, which is most
of Phase 6, and part of Phase 5.

After editing, render it to confirm it still displays correctly, and surface it
in chat as an artifact so the user sees the current state without opening a
file.

## Scope

The mindmap tracks implementation status only. Requirements live in
`.kiro/specs/`, decisions in `docs/adr/`. Do not duplicate their content into
the diagram; keep leaf labels short and let the specs carry the detail.
