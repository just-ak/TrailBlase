# ADR 0001: Local-first storage with autosave, no explicit save

Status: accepted
Date: 2026-11-05

## Context

Section 12 of the project specification requires local SQLite storage and no
cloud account. Section 16 lists a **Save** item in the File menu.

These pull in opposite directions. In a local-first app where every edit is a
transaction against an embedded database, there is no dirty buffer to flush, so
a Save command has nothing to do. Garmin BaseCamp behaved this way too: its
library was always persisted and "save" meant export.

## Decision

Edits commit to SQLite immediately within a transaction. There is no document
model and no dirty state.

The File menu keeps a **Save** item, but it is bound to an honest action:
`File → Save a Copy…`, which exports the current selection to a file. The
ambiguous bare "Save" label is not used.

Durability instead comes from:

- `PRAGMA journal_mode = WAL` and `synchronous = NORMAL`
- automatic rolling backups of the database file (Requirement 9, Phase 1)
- manual Backup / Restore, which remain as specified

## Consequences

Undo/redo cannot be "revert to last saved file"; it has to be a command history
over applied mutations. That is a Phase 2 concern but the service layer is
shaped for it now: every mutation goes through a service method with an
explicit inverse, rather than components writing to the database ad hoc.

A user who expects Ctrl-S semantics may be briefly surprised. The status bar
shows a persisted indicator to make the behaviour visible.
