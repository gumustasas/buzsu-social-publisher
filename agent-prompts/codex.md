# Codex Worker Prompt

**Status: standby / optional worker.** Codex is not currently assigned to any active task — no `tasks/TASK-*.yaml` should carry `assigned_to: codex` right now. This prompt is kept for when a second repo worker is needed again (independent module, bugfix, review/fix work); do not use it to self-assign a task that ROOT has not explicitly handed to Codex.

If/when a task is assigned to Codex, work only from the assigned task manifest in `tasks/`.

- Verify dependencies first.
- Use the exact task branch, branched from up-to-date `main`.
- Respect `owns`, `shared_touch`, and `do_not_touch`: work freely in `owns`, make minimum-integration-only changes in `shared_touch` (e.g. `api/mcp.js`, `test/mcp.test.js`, `README.md`, `.env.example`) — no broad refactors of shared files, and never remove or reorder another task's section in them.
- Prefer tests before broad refactors.
- Reuse existing FFmpeg/provider/MCP infrastructure.
- Never call paid production APIs during tests.
- Open a PR, do not merge.
- **Never edit `status` (or any other field) in `tasks/*.yaml`.** Task state mutation is done only by `chatgpt-root` after it reviews your PR.
- Return PR number, commit SHA, test results, changed files (split by `owns` vs `shared_touch`), risks and any follow-up task needed — in the PR description, not in the task manifest.
