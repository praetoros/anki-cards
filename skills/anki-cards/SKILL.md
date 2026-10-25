---
name: anki-cards
description: Plan and write Anki cards from the approved knowledge of a topic, and act on card feedback. Used by planning, generation and card review jobs.
---

# Card method

Read `get_settings` first: card types allowed, which priorities to card, the cloze limit, how to
treat uncertain knowledge, and the user's style instructions (follow them).

## Planning (`propose_card_plan`)

- Work from the topic's concepts and knowledge items (`get_library_outline`, `get_concept`).
  Skip excluded items. Card the priorities the settings list.
- Tentative or unresolved knowledge: leave it out unless the setting is `include-with-warning`.
- One row per planned card. Choose the type by what is being learned:
  - **basic**: one atomic fact, definition, number, cause → effect.
  - **reversed**: only true two-way pairs (term ↔ definition, structure ↔ function) where
    recalling both directions is useful.
  - **cloze**: lists, sequences, steps, and statements where the context is the cue. One idea
    per note; at most the configured number of deletions; group related deletions under one
    number only when they must be recalled together.
  - **image_occlusion**: labelled diagrams and images where the labels are the knowledge.
  - **image_question**: an image whose interpretation is the question (e.g. "Which phase does
    this pressure trace show?").
- Write the rationale so the user can approve quickly ("definition the objectives require",
  "sequence of four phases → cloze").

## Generation (`upsert_card`)

- Generate only accepted rows of the approved plan (`get_card_plan`), passing `planRowId`.
- Minimum information: one thing to recall per card. Short question, short answer.
- The question must be unambiguous on its own; include the context needed (e.g. "In the
  cardiac cycle, …"). Never let the answer leak into the question.
- Use the wording and values of the knowledge items exactly; do not add facts the items do not
  contain. `Extra` may add the explanation or mnemonic from the concept.
- Cloze: `{{c1::answer}}` or `{{c1::answer::hint}}`.
- Image occlusion: create the card with the figure in `mediaIds` and a `Header` (what the image
  shows), then call `suggest_occlusion_masks`. If it returns the labels, choose those to hide
  and pass them with origin `pdf-text`. Otherwise view the image (`get_media`) and estimate
  rectangles in fractions of the image with origin `ai-estimate`; the user will correct them.
- Never put patient-identifying details on a card.

## Card feedback

Feedback on cards arrives as review items targeting the card. Change only what was asked
(`upsert_card` with the card id, `expectedVersion` and `reviewItemId`), or `retire_card` if the
user asks to drop it, then reply on the item.
