# Anki Cards

A local app that turns lecture material into a reviewed knowledge library and then into Anki decks,
with AI work done by the user's own coding-agent CLI.

## Knowledge

**Library**:
The whole body of synthesised knowledge for one subject, grown over many sources and exported as one deck tree.
_Avoid_: SCL, project, deck, collection

**Source**:
One uploaded original file (lecture PDF, slide deck, document, image) kept unchanged as the authority for what was provided.
_Avoid_: upload, document, input

**Source unit**:
The smallest locatable part of a source that carries meaning: a slide, page, table, figure, diagram or visual component.
_Avoid_: chunk, segment

**Coverage entry**:
The recorded outcome for one source unit, saying whether and where its content ended up in the library.
_Avoid_: ledger line

**Topic** / **Subtopic**:
The two grouping levels above concepts in a library's hierarchy.

**Concept**:
A focused idea within a subtopic, with a readable explanation built from its knowledge items.
_Avoid_: note, section

**Knowledge item**:
One atomic, sourced statement within a concept, with its own priority, origin and interpretation status.
_Avoid_: fact, claim, KI

**Evidence**:
The record of what supports a knowledge item: a source unit, or an external reference with the specific passage.
_Avoid_: citation, reference

**Priority**:
How essential a knowledge item is for learning: P1 essential, P2 supporting, P3 enrichment.

**Interpretation status**:
How confidently a knowledge item was read from its source: supported, tentative or unresolved.
_Avoid_: confidence

**Learning objective**:
A statement of what the learner should be able to do, either taken verbatim from a source (explicit) or inferred.
_Avoid_: goal, outcome

**Enrichment**:
Knowledge or images taken from outside the uploaded sources, allowed only within an approved scope.
_Avoid_: supplement, research

**Media asset**:
A stored image or other file extracted from a source or fetched externally, with its provenance.
_Avoid_: attachment, visual

## Review

**Review item**:
Anything that needs the user's attention or decision: a problem, a proposal, a gate or a failure.
_Avoid_: issue, ticket, task

**Category**:
How urgent a review item is: Requires Decision, Recommended Review, or Informational.
_Avoid_: severity

**Feedback**:
A user correction or comment on a review item that the AI must act on.
_Avoid_: note, reply

**Approval**:
A recorded user decision that permits a specific change within a stated scope; never a statement that the content is verified.
_Avoid_: permission, sign-off

## Workflow

**Stage**:
One of the five steps from sources to deck: synthesis, card planning, card generation, card review, export.
_Avoid_: phase, step

**Gate**:
A point between stages that only the user can pass: approving the synthesis, the card plan or the card set.
_Avoid_: checkpoint, milestone

**Snapshot**:
A named, frozen state of the library created when a gate is approved, read by later stages.
_Avoid_: version, release

**Changeset**:
One recorded group of changes with its author and reason, which can be reverted as a unit.
_Avoid_: commit, revision, edit

## Cards

**Card plan**:
The proposed list of which knowledge items become which kind of card, approved before cards are generated.
_Avoid_: blueprint

**Card**:
One Anki note produced from knowledge items, with a stable identity across exports.
_Avoid_: flashcard, note

**Note type**:
The Anki field and template layout a card uses: Basic, Basic + Reversed, Cloze, Image Occlusion, Image + Question.
_Avoid_: model, card type

**Occlusion mask**:
A shape hiding part of an image on an Image Occlusion card.
_Avoid_: box, overlay

**Retired card**:
A card removed from the library after being exported, sent once more with a removal tag so the user can delete it in Anki.
_Avoid_: deleted card

## AI work

**Provider**:
The coding-agent CLI that does AI work, signed in with the user's subscription: Codex or Claude Code.
_Avoid_: model, client, backend

**Worker**:
A provider CLI process the app starts to do one job, which changes the library only through the app's tools.
_Avoid_: agent, bot

**Session**:
A continuing provider conversation tied to a library and a scope, resumed across jobs until the user starts a new one or compacts it.
_Avoid_: thread, chat

**Scope**:
The part of a library a session may change: the whole library, a set of topics or subtopics, or a card set.

**Job**:
One worker run for a session, with its trigger, events, and the changesets it produced.
_Avoid_: task, run

**Session summary**:
The handoff a session writes before compaction, used to start its replacement.
_Avoid_: memory, context

**Stage instructions**:
The method a worker follows for a stage, supplied to it by the app at the start of each job.
_Avoid_: skill, prompt
