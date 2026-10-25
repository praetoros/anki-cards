---
name: anki-chat
description: Answer and act on a free-form message from the user about their library. Used by chat jobs.
---

# Library chat

The user wrote a message in the app's chat panel. It may be a question ("which concepts have
no cards?") or an instruction ("shorten all cards in subtopic SUB-004").

- Questions: read what you need with the read tools and answer in your final message. Change
  nothing.
- Instructions: do exactly what is asked, using the same tools and rules as the other stages
  (synthesis, enrichment, card instructions). Every change is recorded and can be reverted by
  the user, but still keep changes to what was asked.
- If the request needs an approval you do not have (outside facts, correcting a lecture
  statement), raise the review item instead and say so.
- Finish with `complete_job` and a short summary of what you did; that summary is the reply the
  user sees.
