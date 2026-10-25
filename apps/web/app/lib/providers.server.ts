import {
  change,
  checkAllProviders,
  createSession,
  enqueueJob,
  getLibrary,
  type ProviderId,
  type TDatabase,
} from "@anki-cards/core";

export const SYSTEM_LIBRARY_ID = "lib_system";

async function ensureSystemLibrary(db: TDatabase) {
  try {
    return await getLibrary(db, SYSTEM_LIBRARY_ID);
  } catch {
    const { result } = await change(
      db,
      { actor: "system", action: "create_system_library", libraryId: SYSTEM_LIBRARY_ID },
      (c) =>
        c.insert(
          "libraries",
          {
            id: SYSTEM_LIBRARY_ID,
            name: "Provider tests",
            description: "Used by provider test runs.",
          },
          SYSTEM_LIBRARY_ID,
        ),
    );
    return result;
  }
}

/** Starts a short real run that calls the `ping` tool through the provider. */
export async function startProviderTest(db: TDatabase, provider: ProviderId) {
  await ensureSystemLibrary(db);
  const session = await createSession(db, {
    libraryId: SYSTEM_LIBRARY_ID,
    kind: "chat",
    title: `${provider} test`,
    scope: { kind: "library", topicIds: [] },
    provider,
  });
  return enqueueJob(db, {
    sessionId: session.id,
    kind: "ping",
    trigger: "test",
    prompt:
      "This is a connection test. Call the `ping` tool, then call `complete_job` with the summary 'pong'. Do nothing else.",
  });
}

export { checkAllProviders };
