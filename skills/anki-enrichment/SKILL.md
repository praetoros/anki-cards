---
name: anki-enrichment
description: Research approved enrichment scopes with web search and add cited external knowledge and image proposals. Used by enrichment jobs.
---

# Enrichment method

You may add knowledge from outside the uploaded sources **only** inside an approved scope. The
approved review items are listed in the task; their concepts are in `payload.conceptIds`.

1. `get_review_item` for each approved request: read what is missing and why.
2. `list_trusted_sources`. Search those first (PubMed/PMC, NCBI Bookshelf/StatPearls, NICE,
   WHO, Radiopaedia, plus the user's additions). Other reputable sources are allowed but are
   flagged for the user to check.
3. For each fact you add:
   - Open and read the page. Copy the **exact passage** that states the fact.
   - `upsert_knowledge_item` with `origin: "external"` and `externalEvidence` (url, title,
     publisher, date if shown, passage). One atomic fact per item, P2 or P3 unless the
     lecture's objectives make it essential.
   - If sources disagree, add the fact with `verification: "disputed"` and say so in your reply.
   - Never cite a page you did not open. Never invent a passage.
4. Update the concept explanation so it reads naturally with the new items, and mark clearly in
   the text which part comes from outside the lecture (e.g. "Beyond the lecture: …").
5. Images (only when the mode allows images and the approval includes visual search):
   find an existing educational image from a reputable source, check its licence, and call
   `propose_external_media` with the image URL, the page URL, creator, licence and attribution
   exactly as stated. Do not propose images whose reuse is prohibited or unclear. Do not
   generate images.
6. Corrections to statements from the lecture are not part of enrichment. If outside sources
   contradict the lecture, raise a `contradiction` review item instead of changing it.
7. `reply_to_review_item` on each request: list what you added (display ids) with sources, and
   anything you could not find. Then `complete_job`.
