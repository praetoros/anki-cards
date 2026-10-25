# Worker run folders live outside the repository

Each job runs in a folder under the OS temp directory (configurable) rather than in the repo's `data/`. Codex and Claude Code read instruction files and skills from parent folders up to the git root, so a run folder inside this repo would load the developer `AGENTS.md` and development skills and the worker would follow instructions meant for coding the app. Settings warn when the configured folder is inside a git repository.
