# The app drives headless provider CLIs instead of living inside a chat client

All AI work is done by spawning the user's own `codex exec` or `claude -p` from the app, with the app's MCP endpoint injected per run and only its tools pre-approved. A worker changes the library only through those tools. We chose this over running a skill inside ChatGPT or Claude Desktop because plain ChatGPT chat can't reach a local MCP server, neither desktop chat can be woken when the user submits feedback in the web UI, and tool calls that wait for feedback time out after one to five minutes. Spawning the unmodified CLIs keeps the user's subscription as the billing source, which both providers' docs allow for personal use. The app being the whole UX also means no user-level client configuration.

## Considered options

- Skill in the chat client, polling a `wait_for_feedback` tool: rejected for timeouts and token cost of polling.
- MCP sampling: deprecated in the 2026-07-28 MCP revision and not offered by Codex.
- Claude Agent SDK sessions owned by the app: Anthropic doesn't allow third-party products built on the SDK to use claude.ai logins.
