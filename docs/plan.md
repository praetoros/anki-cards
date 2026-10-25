# Anki Cards — Implementation plan

Vertical slices, built in order. Each slice ends with `vp check` and `vp test` passing and the "done
when" items true. Section numbers refer to [design.md](./design.md). Items from design §19
(unverified) are checked in the slice listed there, before code depends on them.

## Slice 0 — Toolchain and skeleton

- Pin Node 26 through `devEngines.runtime`; add `runtimeOnFail: ignore` and `pmOnFail: ignore` to
  `pnpm-workspace.yaml`; raise `engines.node`.
- Remove `apps/website` and `packages/utils`. Create `apps/web` (React Router 8 framework mode),
  `packages/core`, `mcp`, `ingest`, `apkg`, `ui`, `skills/`, `tests/fixtures/`.
- shadcn init with Base UI and `base-nova` in monorepo mode; Tailwind v4.
- `vp run dev` and `vp run start` start the app on `127.0.0.1` and open the browser; `data/` is
  git-ignored.

Done when: the app serves an empty libraries page, and lint, type check (after `react-router
typegen`) and an empty test suite pass.

## Slice 1 — Core data and history

- drizzle schema for the tables in §5, migrations applied at startup after an automatic backup.
- Changesets, `_history` twins, `version` checks, revert changeset, revert job, restore to a point
  in time, snapshots as changeset references (§6).
- Settings with global and per-library resolution (§15).
- Libraries CRUD in the UI; settings screen (non-provider parts).

Done when: tests cover insert/update/delete history, stale-version rejection, revert, revert
conflicts, point-in-time restore and snapshot reads.

## Slice 2 — MCP endpoint, workers, jobs, live updates

- `/mcp` resource route with token auth, Host/Origin checks and per-stage tool lists; `ping`,
  `get_workflow_state`.
- Job runner: run folders (§8.3), Codex and Claude invocations (§8.4), event normalisation (§8.5),
  cancel, queue and concurrency limit.
- Provider check at startup and in settings, with the Test button and fix instructions (§8.6).
- `/events` SSE, root revalidation hook, jobs panel rendering events with AI Elements.
- Fake CLI binary and scripted fake worker for tests.
- Check: Codex instruction isolation, Codex skills in exec, Claude `${VAR}` in `--mcp-config`,
  long responses through resource routes under `vp dev`.

Done when: a Test run with each logged-in provider calls `ping` and shows its events live; fake
worker tests cover token rejection, tool listing per stage, cancel and event parsing for both
streams.

## Slice 3 — Ingest

- Upload and `register_source` with `paths.readableRoots`, storage by sha256.
- mupdf extraction (text with positions, original images, renders), PPTX unzip + XML, LibreOffice
  and ffmpeg detection and conversion (§12).
- Sources screen: units, renders, media, coverage ledger (empty until synthesis).
- Fixture generator scripts for PDF and PPTX.
- Check: mupdf image extraction and text positions on a real lecture.

Done when: fixtures ingest into the expected units and media; extraction limits are recorded when
LibreOffice is missing.

## Slice 4 — Synthesis and the review loop

- Synthesis stage instructions (§10) and the synthesis and common tools (§9).
- Knowledge and learning-objective screens; review queue with all actions (§7); feedback creates an
  _awaiting AI_ item and "Send N items to AI" starts a feedback job in the ingest session.
- Approvals and their enforcement in tools; synthesis gate creating a snapshot.

Done when: the fake worker runs fixture → synthesis → review items → user feedback → feedback job →
AI reply and change, with live UI updates, and unapproved external writes are rejected.

## Slice 5 — History UI and backups

- History screen: changesets, row diffs, revert changeset or job, restore, snapshots (§6, §14).
- Back up now, backup before migration, export library, `paths.backupFolder` (§16).

Done when: a feedback job can be reverted from the UI and the library restored from a backup.

## Slice 6 — Sessions and scopes

- Ingest, topic and chat sessions; scope claims; library-wide exclusivity (§8.1).
- Session panel: context meter, resume, new session, compact via `save_session_summary` with an
  editable summary.
- Auto-resume rules (§8.2), auto-trigger setting.
- Check: parallel Codex runs and token refresh; Codex compaction in exec.

Done when: two topic sessions run in parallel without crossing scopes; a killed worker resumes;
a rate-limited job waits; compaction starts a new session from the summary.

## Slice 7 — Enrichment

- `enrichment.mode`, trusted sources, enrichment request and visual proposal items, web search
  flags per provider, `add_external_evidence`, `propose_external_media` with download and
  attribution (§11).

Done when: an approved concept scope gets external knowledge items with passages; an external image
attaches only after its own approval; writes outside the approved scope are rejected.

## Slice 8 — Cards and export

1. **Image Occlusion check first:** generate an IO test `.apkg`; the user imports it into Anki and
   confirms rendering and editing (§13.3). Record the result; fall back to Image + Question if it
   fails.
2. `packages/apkg`: write tests against `anki-apkg-export@5.0.0` until they pass, then build our
   writer on `node:sqlite` to pass the same tests; add IO note type tests.
3. Note types, templates and CSS shared by preview and export (§13.2).
4. Planning stage instructions and tools; card plan screen and gate.
5. Generation stage instructions and tools; card review screen with preview, edit, regenerate
   request and mask editor; card-set gate.
6. Export: whole deck from the snapshot, deck mapping, retired cards, export history,
   `paths.exportFolder` (§13.4).

Done when: the pipeline test runs fixture → ingest → synthesis → feedback → plan → generate →
export, and the `.apkg` passes the oracle tests and imports into Anki.

## Slice 9 — Library chat

- Chat panel per library; each message starts a chat-session job with the same tools and rules;
  AI Elements rendering shared with the jobs panel.

Done when: a chat instruction ("shorten all cards in subtopic X") produces changesets that appear in
history and can be reverted.
