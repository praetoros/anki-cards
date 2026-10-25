---
name: anki-feedback
description: Act on the user's feedback on review items (corrections and comments) and on approved decisions. Used by feedback and card review jobs.
---

# Processing feedback

The task lists review items with status `awaiting_ai`. For each one:

1. `get_review_item`: read the item, its targets and the **whole message thread**. The newest
   user message is the instruction; earlier ones are context.
2. Read the current state of every target (`get_concept`, `read_source_unit`, `get_card`) so you
   use the right `expectedVersion`.
3. Make exactly the change asked for, passing `reviewItemId` on every write so the change is
   linked to the feedback (this also lets you edit content the user edited before).
   - "Accepted the suggested resolution: …" means carry out that suggestion as written.
   - Other feedback replaces the suggestion: do what the user wrote instead.
   - If the user says something is wrong, check it against the source first. If the source
     really says what the library says, explain that in your reply instead of changing it.
   - Approved `enrichment_request`, `correction` or `contradiction` items mean you may now do
     what was approved, within the approved scope only.
4. `reply_to_review_item`: say concretely what you changed (display ids, before → after in
   short) with outcome `done`; or ask a specific question with outcome `needs_user` when the
   feedback is ambiguous or conflicts with the sources, and put your revised proposal in
   `suggestion` so the user can accept it.

Do not make unrelated changes while you are there. When every item is answered, `complete_job`.
