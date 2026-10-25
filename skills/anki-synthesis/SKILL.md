---
name: anki-synthesis
description: Turn uploaded lecture sources into the library's topics, concepts and knowledge items, with evidence, coverage and learning objectives. Used by synthesis and feedback jobs.
---

# Synthesis method

Goal: a library that keeps **every meaningful piece of knowledge** from the sources, organised so
a student can learn from it and cards can be made from it. Nothing is invented.

## 1. Inspect before you write

1. `get_workflow_state`, then `list_sources` and `get_source_outline` for each source in the task.
2. Read every unit with `read_source_unit`. Look at the page or slide image, not only the text:
   diagrams, tables and labels often carry the content.
3. A source can have extraction limitations (listed on the source). Where content could not be
   read, record coverage `unprocessed` and raise an `extraction_limitation` review item rather
   than guessing.

## 2. Diagrams and figures

- Transcribe what is literally there first: labels, arrows and their direction, order, legend,
  axis titles. Put that in the media `description` (`link_media`).
- Only then interpret. Never read exact values off a diagram without a scale.
- `supports_claim` links are for images that themselves show the claim (say which component
  and why). Everything else is `contextual`. Decorative images get relevance `decorative` and no
  links.

## 3. Build the hierarchy

Library → **Topic** → **Subtopic** → **Concept** → **Knowledge item**.

- Search first (`search_knowledge`, `get_library_outline`) so you extend existing concepts
  instead of duplicating them. When two concepts mean the same thing, `merge_concepts`.
- **Concept explanation**: a readable synthesis in Markdown that a student could learn from. It
  explains, connects and orders, but adds no fact that is not also a knowledge item.
- **Knowledge items** are atomic statements: one fact, definition, step, comparison, number or
  exception each. Keep qualifiers, numbers, units, exceptions and conditions exactly.
- `types`: definition, structure, function, mechanism, process, cause_effect, comparison,
  numerical, clinical_application, exception (several allowed).
- `priority`: P1 essential (core to the objectives or stressed by the lecturer), P2 supporting,
  P3 enrichment. Priority never removes anything.
- Every source knowledge item has `sourceEvidence` pointing at the unit(s) it comes from.

## 4. Uncertainty and conflicts

- `interpretationStatus`: `supported` when the source says it plainly, `tentative` when you had
  to interpret (unclear diagram, abbreviation, partial text), `unresolved` when you could not
  decide. Raise an `interpretation` review item for tentative and unresolved items that matter.
- Contradictions (between sources, or a source against itself): keep both statements with their
  evidence, and raise a `contradiction` review item that explains the conflict and proposes a
  correction (`payload.knowledgeItemIds`). Do not "fix" a source claim yourself.

## 5. Learning objectives

- Copy explicit objectives word for word (`upsert_learning_objective`, origin `explicit`, with
  the source unit). You may add objectives the lecture clearly implies, as `inferred`.
- `map_objective` each objective to the concepts or items that address it. Judge **source
  coverage** (does the lecture material cover it?) and **library coverage** separately, against
  the objective's verb (identify, describe, explain, compare, apply), from evidence, not keywords.
- For a gap or partial coverage, raise a `gap` review item. If outside material would close it,
  raise an `enrichment_request` instead with `payload.conceptIds`, `payload.purpose`
  (what is missing and why it matters), and `payload.includeVisualSearch` when an image would
  help. Do not add outside facts until the request is approved.

## 6. Coverage ledger

Every unit gets one `record_coverage` entry: `incorporated`, `consolidated` (merged into
existing items), `preserved_as_visual`, `excluded_with_reason` (title slides, administrative
notes; say why), `requires_review`, or `unprocessed`. Link the concepts, items and media it
went into.

## 7. Incremental runs

When the library already has content, classify new material as new, complementary, duplicate,
contradictory or corrective. Keep existing ids when meaning is unchanged. Never overwrite a row
the user edited (the tools will stop you); raise a review item instead.

## 8. Finish

Check that every unit in the task has coverage, then `complete_job` with a summary: topics and
concepts added or changed (display ids), number of knowledge items, review items raised.
