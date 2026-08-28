# Changelog

## v2.0.0

The validation logic is no longer implemented in this repository. It now comes
from [`@libum-llc/pipelines-core`](https://github.com/libum-llc/poweron-pipelines/tree/main/packages/core),
the host-agnostic package shared with the PowerOn Pipelines Azure DevOps
extension and `synchronize-symitar-action`, and this repo holds only the
GitHub-specific wiring around it. `src/validator.ts` and `src/subscription.ts`
are gone along with their suites.

The major bump is that swap, not the interface. **Almost every v1 workflow
keeps working unchanged** — the two items below are the exceptions.

### Breaking changes

1. **`target-branch` takes a bare branch name.** `origin/main` and
   `refs/heads/main` are rejected with an `InputError` rather than accepted and
   rewritten. Use `target-branch: main`, or omit the input entirely — on
   `pull_request` events it defaults to the base branch automatically.

2. **`debug` is strict.** It is parsed with `@actions/core`'s
   `getBooleanInput`, which accepts only `true`, `True`, `TRUE`, `false`,
   `False` and `FALSE`. v1 compared the raw string to `'true'`, so every other
   spelling silently meant `false`. `debug: yes`, `debug: 1` and `debug: on`
   now fail the step instead of being read as `false`, and `debug: TRUE` flips
   from off to on.

### Also changed

- **`files-validated` / `files-passed` / `files-failed` are not published when
  a run aborts before validation completes** — a bad input, a failed API-key
  check, a connection failure. v1 set them regardless. They *are* still
  published when the step fails because PowerOns were invalid, which is the
  case most workflows read.
- **`symitar-app-port` is required up front when `connection-type` is
  `https`.** It was previously discovered missing only after the API-key check.
  `ssh` runs are unaffected — they never read it.
- **`sym-number` is bounded** to a whole number between 0 and 999. Values like
  `-627`, `627.5` and `1e6` previously reached the Symitar client unchecked.
- **A shallow checkout now fails with an actionable message** naming
  `fetch-depth: 0`, instead of git's unexplained `Command failed`.
- **A tag or release run warns** that it resolved no branch-shaped ref and will
  validate nothing, rather than silently reporting `0/0/0` and exiting green.

### Explicitly unchanged

These were changed during development and reverted before release, because
neither break bought anything:

- **`connection-type` still defaults to `ssh`.** It briefly defaulted to
  `https` to match the Azure DevOps task, which would have broken every v1
  workflow that relied on the default and set no `symitar-app-port`.
- **List inputs still accept commas, newlines and YAML block sequences.**
  `validate-ignore` and `preserve-server-files` are parsed exactly as v1
  parsed them. A comma-only parser would not have errored on a multi-line
  value — it would have produced one entry matching nothing, silently
  un-ignoring and un-preserving files.

### Fixed

- The first 8 characters of the API key were printed on an authentication
  failure. `core.setSecret` does not mask substrings, so real keys reached this
  public repository's logs.
- A `poweron-directory` without a trailing slash concatenated into filenames
  (`REPWRITERSPECS` + `FOO.PO` → `REPWRITERSPECSFOO.PO`).
- `connection-type` was never validated, so a typo such as `htpps` silently ran
  the SSH path.
- Renamed PowerOns escaped validation: `git diff --name-status` reports a
  rename as `R100\tOLD\tNEW`, and the parser took the deleted source path.
- The action could hang after logging success — observed live as a 14-minute
  hang until the job timeout — because nothing forced process teardown once the
  Symitar client left a handle on the event loop.
