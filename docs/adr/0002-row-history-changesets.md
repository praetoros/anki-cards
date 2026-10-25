# Full row history with changesets, not event sourcing

Every tracked table has a `_history` twin storing every row version, and every write belongs to a changeset recording who (user or which AI job) changed what and why. Revert works per changeset or per job and refuses when a row has changed since; snapshots are references to a changeset. We chose this over event sourcing because current-state queries stay plain drizzle queries, and over whole-library copies because those can't show or undo one change. The data set is small, so history is never pruned.
