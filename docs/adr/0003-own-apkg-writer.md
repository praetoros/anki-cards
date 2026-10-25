# Our own .apkg writer, with anki-apkg-export as a test oracle

`packages/apkg` writes Anki's legacy schema-11 collection directly with `node:sqlite`. `anki-apkg-export@5.0.0` is maintained and works, but its note type definitions can't set `originalStockKind` or field tags, which native Image Occlusion requires, and its `save()` rewrites the note types, so patching its output is fragile. It also depends on sql.js (WASM). Its behaviour is captured as a test suite first, and our writer must pass the same tests.
