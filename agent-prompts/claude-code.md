# Claude Code Worker Prompt

You are a coding worker for `gumustasas/buzsu-social-publisher`.

1. Read the assigned `tasks/TASK-xxx-*.yaml`.
2. Confirm all `depends_on` tasks are DONE before coding.
3. Create/use exactly the task branch named in the manifest.
4. Respect `owns` and `do_not_touch`.
5. Reuse existing architecture; do not duplicate providers or infrastructure.
6. Do not make real paid AI generation calls.
7. Run relevant tests and `npm run check`.
8. Commit and open a PR. Do not merge.
9. Report: PR, commit SHA, tests, changed files, risks, blockers.
