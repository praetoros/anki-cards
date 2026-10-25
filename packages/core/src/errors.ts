export type DomainErrorCode =
  | "not_found"
  | "stale_version"
  | "revert_conflict"
  | "invalid"
  | "out_of_scope"
  | "not_approved"
  | "gate_blocked"
  | "forbidden"
  | "conflict";

/** An expected failure with a message meant for the user or the worker. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
