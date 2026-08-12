# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

Always use pnpm, never npm.

```bash
pnpm install          # Install dependencies
pnpm build            # Build with ncc to dist/
pnpm test             # Run tests with coverage
pnpm lint             # Check linting and formatting
pnpm lint:fix         # Fix linting and formatting issues
pnpm all              # Run lint:fix, build, and test
```

Run a single test file:
```bash
pnpm test -- src/lib/__tests__/utils.test.ts
```

## Architecture

This is a GitHub Action that validates PowerOn files against Jack Henry Symitar systems.

**The rule: shared logic lives in `@libum-llc/pipelines-core`; this repo holds
only GitHub-specific wiring.**

The validation logic is not written here. It lives in
[`@libum-llc/pipelines-core`](https://github.com/libum-llc/poweron-pipelines/tree/main/packages/core),
a host-agnostic package published to GitHub Packages and shared with the
`poweron-pipelines` Azure DevOps extension and `synchronize-symitar-action`.
Core owns the `runValidatePowerOnTask` runner, the error hierarchy, the logger,
validation utilities, changed-file filtering, License API subscription checks,
and the config *types*. It imports no CI host SDK and reads no host environment
variables.

What lives here is everything that knows it is running on GitHub Actions: input
parsing, config *loading*, client construction, workspace path anchoring, the
`TaskHost` adapter, and the error-to-annotation mapping.

This repo previously carried byte-identical *vendored copies* of core's modules,
kept in sync by hand under a "never edit these, change upstream and re-vendor"
rule. That rule is gone along with the copies. If shared behavior needs to
change, change it in `poweron-pipelines/packages/core`, publish a new version,
and bump the dependency here — do not reintroduce a local copy of a core module.

### Import from the package entrypoint only

```ts
import { runValidatePowerOnTask, type TaskHost } from '@libum-llc/pipelines-core';
```

Never deep-import into `@libum-llc/pipelines-core/dist/...`. `dist/`'s layout is
build output and can change in a patch release; only what core's `src/index.ts`
re-exports is stable. The entrypoint also carries the
`/// <reference types="node" />` directive that makes core's `Buffer`-typed
surface resolve.

Note that importing the package applies core's module-scope
`https.globalAgent.options.rejectUnauthorized = false`. That is a deliberate,
documented owner decision in core (Symitar hosts commonly present certificates
that fail default verification), not something to work around here.

### `src/lib/github-task-host.ts` — the `TaskHost` adapter

`TaskHost` is core's contract for talking to a CI host — the intersection of
what Azure Pipelines, GitHub Actions, and GitLab CI can all do.
`createGitHubTaskHost()` implements it over `@actions/core`. Two things about it
are load-bearing:

- **Name translation.** Core names inputs and outputs in camelCase
  (`connectionType`, `filesValidated`); `action.yml` spells them in kebab-case.
  Everything crossing this boundary goes through `toActionInputName()`.
- **`setOutput` must be a real step output.** Core deliberately leaves Azure's
  `setVariable(name, value, isSecret, isOutput)` flags out of the interface, so
  each adapter supplies its own equivalent. The GitHub equivalent of
  `isOutput: true` is `@actions/core`'s `setOutput`, **not** `exportVariable`.
  Using `exportVariable` writes to `$GITHUB_ENV` instead of `$GITHUB_OUTPUT`:
  the step still succeeds, still logs its summary, and the consuming workflow
  silently reads an empty string. `src/lib/__tests__/github-task-host.test.ts`
  and the end-to-end case in `src/validate/dependencies.test.ts` assert against
  real `$GITHUB_OUTPUT` / `$GITHUB_ENV` files precisely because a mocked
  `@actions/core` cannot tell the two apart.

Related: `setSecret` masks whole registered values, not substrings. Never log a
fragment of a secret and expect the mask to catch it — `main.ts` prints only
whether `AuthenticationError.apiKeyPrefix` is present, never its value.

### `src/lib/task-orchestration.ts` — config loading

Builds core's `ValidatePowerOnConfig` from `action.yml` inputs instead of from
`.poweron-pipelines/config.yml`. Also home to the validations the Azure
extension gets from its `task.json` pick lists and its zod config schema, and
which therefore have to be restored here:

- `connectionType` and `syncMethod` value checks
- hostname and port format checks
- `target-branch` bare-name validation (the `origin/` and `refs/heads/` prefixes
  are rejected, not silently rewritten)
- `symitar-app-port` required when `connection-type` is `https`
- **`toDirectoryPath()`** — normalizes `poweron-directory` to exactly one
  trailing slash. Core does *not* guarantee this:
  `ValidatePowerOnConfig.powerOnsDirectory` is a plain `string` and core
  validates nothing about it, while core's `mapDeployedToChangedFiles` builds
  `${directory}${name}` with no separator. Drop this and `REPWRITERSPECS` +
  `FOO.PO` becomes `REPWRITERSPECSFOO.PO`.
- `warnIfNothingWillBeValidated()` — core's `determineValidationMode` returns
  `'none'` on a tag/release run (`GITHUB_REF` is `refs/tags/...`), which would
  otherwise produce a green `0/0/0` run that never contacted Symitar.

### `src/lib/utils.ts` — GitHub input and git helpers

`getInput`/`getBoolInput` over `@actions/core`, the camelCase →
`action.yml` kebab-case name translation (`toActionInputName`, plus the
`INPUT_NAME_OVERRIDES` table for the names that are not a plain transform), and
`getChangedFilesInDir` via `git diff --name-status` (which handles rename/copy
records by taking the *destination* path).

### `src/validate/dependencies.ts` — dependency injection

`runValidatePowerOnTask` takes all of its host interactions through a
`ValidatePowerOnTaskDependencies` object. This file is the concrete
implementation for this repo. Beyond simple wiring, its job is **workspace path
anchoring**: it wraps the Symitar HTTPS/SSH clients so every local path they
touch resolves against `GITHUB_WORKSPACE`, and normalizes changed-file paths so
core's `mapDeployedToChangedFiles` never double-prefixes the PowerOn directory.
See the doc comment on `resolveLocalPowerOnPath` for the specific failure mode.

### `src/main.ts` — the entry point

Masks secret inputs, calls `runValidatePowerOnTask(validatePowerOnDependencies)`,
and maps core's typed errors (`AuthenticationError`, `ConnectionError`,
`InputError`, `SymNumberError`, `ValidationError`, `PowerOnError`) onto
`core.setFailed`/`core.error` with per-error-type detail.

Two things here must not be "simplified":

- **The explicit `process.exit`** in the `require.main === module` block. It is
  load-bearing, not defensive: the Symitar client can leave a handle on the
  event loop, and without it the step hung for 14 minutes *after* logging
  success. `poweron-pipelines` does the same at the end of its `executeTask`.
- **`resolveExitCode` and the `require.main === module` guard itself.** ncc
  rewrites that expression at bundle time; CI's smoke-test step exists to catch
  a future ncc version breaking the rewrite, which would silently turn the
  bundle into a no-op that exits 0.

### `dist/` is committed

`action.yml` ships `dist/index.js`, so the committed bundle — not `src/` — is
what consumers run, and they never run `pnpm install`. Two consequences:

- **`@libum-llc/pipelines-core` and `@libum-llc/symitar` must be inlined by
  ncc.** They are private GitHub Packages dependencies; a leftover runtime
  `require()` would throw `MODULE_NOT_FOUND` for every consumer while passing
  every test here. CI asserts on this.
- **Rebuild and commit `dist/` with any `src/` change.** CI's `Check dist` step
  rebuilds and fails if the committed tree differs. ncc output varies by Node
  major and by pnpm major (hoisting changes what gets bundled), so build with
  the Node and pnpm that CI pins: Node 24 (`.github/workflows/ci.yml`) and the
  pnpm in `package.json`'s `packageManager` field.

### Registry auth

`@libum-llc/*` packages come from GitHub Packages. Auth lives in the **global**
`~/.npmrc`; the repo `.gitignore`s `.npmrc` and must not contain one. In CI,
`actions/setup-node` writes the registry config and `NODE_AUTH_TOKEN` supplies
the token.

### Key Dependencies

- `@libum-llc/pipelines-core` — the shared, host-agnostic task runner and
  supporting modules
- `@libum-llc/symitar` — proprietary Symitar client (`SymitarHTTPs`,
  `SymitarSSH`). Core pins this to an **exact** version; keep this repo's
  version identical to core's, or the tree gets two copies and `instanceof`
  checks across them break silently.
- `@actions/core` — GitHub Actions toolkit, reached through
  `github-task-host.ts` and `utils.ts`

### File Detection Modes

- **`git-diff`** (target branch resolved, e.g. on `pull_request` events or an
  explicit `target-branch` input): uses `git diff --name-status` to find changed
  files in `poweron-directory`.
- **`hash-comparison`** (no target branch resolved): compares the local
  directory against files deployed on the Symitar host via the Symitar client's
  `getChangedFiles`, using the `sync-method` transport.

### Testing notes

`@libum-llc/pipelines-core` is a real dependency now, so a bare
`jest.mock('@libum-llc/pipelines-core', () => ({ ... }))` replaces the error
hierarchy that `main.ts` dispatches on and the helpers core's own runner calls,
which makes suites vacuous rather than failing. Spread `jest.requireActual` and
override only what you mean to stub. The same applies to
`jest.mock('@libum-llc/symitar', ...)`, since core imports it too.
