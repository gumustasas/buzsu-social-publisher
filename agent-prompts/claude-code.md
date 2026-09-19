# Claude Code Worker Prompt

You are a coding worker for `gumustasas/buzsu-social-publisher`.

1. Read the assigned `tasks/TASK-xxx-*.yaml`.
2. Confirm all `depends_on` tasks are DONE before coding.
3. Create/use exactly the task branch named in the manifest, branched from up-to-date `main`.
4. Respect `owns`, `shared_touch`, and `do_not_touch`:
   - `owns`: work freely — refactor, rename, add files.
   - `shared_touch` (e.g. `api/mcp.js`, `test/mcp.test.js`, `README.md`, `.env.example`): make the minimum integration change only (register your tool, add your test case, add your doc section). Never broadly refactor a `shared_touch` file or remove/reorder another task's section in it.
   - anything not listed in `owns` or `shared_touch` is off-limits.
5. Reuse existing architecture; do not duplicate providers or infrastructure.
6. Do not make real paid AI generation calls.
7. Run relevant tests and `npm run check`.
8. Commit and open a PR. Do not merge.
9. **Never edit `status` (or any other field) in `tasks/*.yaml`.** Task state (READY/RUNNING/REVIEW/DONE/FAILED/BLOCKED) is mutated only by `chatgpt-root`, after it reviews your PR. Your job ends at reporting, not at updating the manifest.
10. Report in the PR description (RESULT format): PR, commit SHA, tests, changed files (split by `owns` vs `shared_touch`), risks, blockers.
11. If a `shared_touch` file conflicts with another task's PR, do not rewrite your own feature code — resolve only the integration conflict (e.g. merge two `case` blocks in `api/mcp.js`), and defer merge-order decisions to `chatgpt-root`.
