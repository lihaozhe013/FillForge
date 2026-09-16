# AGENTS.md

## Rules

1. All code comments, commit messages, and documentation must be written in English; commit messages
   must follow Conventional Commits.
2. Before adding responsibilities to a source file over 1,000 lines, evaluate whether it should be
   split into focused modules.

Debug builds write logs into `debug-logs/` (release builds into the per-user data directory):
`debug.log` is a summary of application warnings/errors, and
`debug-{feature}.log` hold full per-domain output with startup and 2 MB
size rotation (`*.previous.log` keeps the prior session) — check the summary file first, then the
matching domain file, when debugging.