# Codex Worker Prompt

Work only from the assigned task manifest in `tasks/`.

- Verify dependencies first.
- Use the exact task branch.
- Keep changes within owned files unless a minimal shared-registry change is necessary.
- Prefer tests before broad refactors.
- Reuse existing FFmpeg/provider/MCP infrastructure.
- Never call paid production APIs during tests.
- Open a PR, do not merge.
- Return PR number, commit SHA, test results, risks and any follow-up task needed.
