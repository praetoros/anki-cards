# Anki Cards

A local, single-user app that turns lecture material (PDF, PPTX, DOCX, Markdown, images, video)
into a reviewed knowledge library and then into Anki decks. You work in the browser; the AI
work is done by your own **Claude Code** or **Codex** CLI, which the app starts in the
background on your own subscription. See [docs/design.md](docs/design.md) for the full design
and [GLOSSARY.md](GLOSSARY.md) for the terms.

## Requirements

- [Vite+](https://viteplus.dev/guide/) (`vp`). It installs and pins Node 26 and pnpm for this
  repo; you don't need them installed separately.
- At least one AI provider, signed in with your subscription:
  - **Claude Code** 2.1.259 or later (`claude update`, then run `claude` once to sign in), or
  - **Codex** 0.122.0 or later (`npm i -g @openai/codex`, then `codex login`).
- Optional: **LibreOffice** (slide images for PPTX, DOCX conversion) and **ffmpeg** (video
  frames). The app detects both.

## Run it

```bash
vp install
```

```bash
vp run start
```

`start` builds the app and opens <http://127.0.0.1:4317>. For development with hot reload use
`vp run dev`. Then open **Settings**, check that a provider shows **Ready**, and press **Test**:
a short real run that proves the CLI, the app's MCP endpoint and the tool permissions work
together.

## How it works

1. **Sources**: upload lecture files. They are stored in `data/` and extracted (text, text
   positions, images, page renders).
2. **Synthesise**: a worker builds topics → subtopics → concepts → knowledge items with
   evidence, records coverage for every page or slide, maps learning objectives and raises
   **review items** for anything uncertain.
3. **Review**: approve, reject, defer, exclude, or write a correction or comment. Corrections go
   back to the AI with **Send to AI** (or automatically, if you turn that on).
4. **Approve synthesis** (a gate) → **plan cards** per topic → approve the plan → **generate**
   → review cards (preview, edit, feedback, Image Occlusion mask editor) → approve the card set.
5. **Export** an `.apkg`. Re-exports update the same notes in Anki.

Every change, by you or the AI, is a **changeset** in **History**, and can be reverted alone,
per job, or by restoring the library to an earlier point.

## Data and backups

- Everything lives in `data/` (git-ignored): the SQLite database, original sources, media and
  exports. Set `ANKI_CARDS_DATA` to use another folder.
- **Settings → Backups → Back up now** writes a consistent copy of the database plus the files
  to the backup folder (e.g. a synced Google Drive folder) or `data/backups/`. A backup is also
  made before every database migration.
- To restore a backup: stop the app, then replace `data/anki-cards.db` and the `sources`,
  `media` and `exports` folders with the ones from the backup folder.
- **Library settings → Export library archive** writes one library as a zip.
- Worker run folders go to the OS temp folder by default (`paths.runs`). Keep them outside any
  git repository: the CLIs read instruction files from parent folders.

## Image Occlusion check

Anki's native Image Occlusion import has not been confirmed yet. Generate a test deck and import
it into Anki desktop (23.10 or later):

```bash
vpx packages/apkg/scripts/io-check.ts data/io-check.apkg
```

The script prints what to check. If Image Occlusion cards don't open in Anki's IO editor, use the
**Image + Question** card type instead.

## Development

```bash
vp check
```

```bash
vp run test
```

| Package           | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `apps/web`        | React Router 8 app, `/mcp` endpoint, `/events` live updates         |
| `packages/core`   | Database, history, approvals, sessions, jobs, worker runner, export |
| `packages/mcp`    | MCP tools the workers use; tests drive them with a fake CLI         |
| `packages/ingest` | Extraction (mupdf, PPTX, DOCX, ffmpeg, LibreOffice)                 |
| `packages/apkg`   | `.apkg` writer, note types, Image Occlusion, card preview           |
| `packages/ui`     | shadcn components (Base UI, base-nova)                              |
| `skills/`         | Stage instructions given to workers                                 |

Database migrations: change the schema in `packages/core/src/db/schema`, then run
`vp run @anki-cards/core#db:generate`.
