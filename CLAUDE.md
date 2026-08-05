# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

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

This is a GitHub Action that validates PowerOn files against Jack Henry Symitar systems. It is a **port of the `ValidatePowerOn` task from the `poweron-pipelines` Azure DevOps extension** onto the GitHub Actions runtime. Most of the validation logic is not written here — it is vendored byte-identical from `poweron-pipelines` and re-hosted through a small GitHub-specific adapter layer.

### Vendored code — do not edit

The following files are copied byte-identical from `poweron-pipelines`:

- `src/lib/constants.ts`
- `src/lib/errors.ts`
- `src/lib/types.ts`
- `src/lib/logger.ts`
- `src/lib/subscription.ts`
- `src/lib/validation-utils.ts`
- `src/lib/server-managed-files.ts`
- `src/lib/change-debug.ts`
- `src/validate/run.ts` (the `runValidatePowerOnTask` orchestrator, vendored from `poweron-pipelines`'s `ValidatePowerOn/run.ts`)

**Do not edit these files directly.** If the behavior in one of them needs to change, make the change in `poweron-pipelines` first and then re-vendor the file into this repo unmodified. Editing them here creates a silent fork that a future re-vendor will either overwrite (losing the fix) or conflict with (losing the byte-identity guarantee). This also means these files should read as slightly foreign to this repo — they use pipelines-shaped concepts (`azure-pipelines-task-lib`, Azure-flavored config) that only make sense because of the adapter layer described below.

### The adapter layer — allowed to diverge

Three files exist specifically to bridge the vendored code onto GitHub Actions, and are the only `src/lib/` files allowed to differ from their `poweron-pipelines` counterparts:

- **`src/lib/utils.ts`** — GitHub-flavored input reading and git-diff helpers (`getInput`/`getBoolInput` against `@actions/core`, `action.yml` kebab-case input name translation, `getChangedFilesInDir` via `git diff --name-status`).
- **`src/lib/task-orchestration.ts`** — builds the task configuration and Symitar clients from `action.yml` inputs instead of from `.poweron-pipelines/config.yml`, including the `target-branch` bare-name validation and the HTTPS-requires-`symitar-app-port` check.
- **`src/lib/task-shim.ts`** — see the module alias section below.

### `src/validate/dependencies.ts` — GitHub-specific dependency injection

`runValidatePowerOnTask` (vendored, in `src/validate/run.ts`) takes all of its host interactions through a `ValidatePowerOnTaskDependencies` object rather than calling anything host-specific directly. `src/validate/dependencies.ts` is the concrete implementation of that object for this repo. Its main job beyond simple wiring is **workspace path anchoring**: it wraps the Symitar HTTPS/SSH clients so every local path they touch is resolved relative to `GITHUB_WORKSPACE`, and normalizes changed-file paths returned by the Symitar client so the vendored `mapDeployedToChangedFiles` (which unconditionally builds `${directory}${name}`) never double-prefixes the PowerOn directory. This exists because a GitHub Actions runner's working directory conventions differ from an Azure Pipelines agent's — see the doc comment on `resolveLocalPowerOnPath` in that file for the specific failure mode it fixes.

### `src/main.ts` — the entry point

The `@actions/core` entry point. Masks secret inputs, calls `runValidatePowerOnTask(validatePowerOnDependencies)`, and maps the vendored typed errors (`AuthenticationError`, `ConnectionError`, `InputError`, `SymNumberError`, `ValidationError`, `PowerOnError`) onto `core.setFailed`/`core.error` with per-error-type detail (host/port for connection failures, a masked API key prefix, one `core.error()` per invalid file). It deliberately does not use `ValidationError.getAzureFormattedMessage()` — that emits Azure Pipelines `##[error]` log commands, which GitHub Actions would print as literal text rather than interpret.

### The module alias: `azure-pipelines-task-lib/task` → `task-shim.ts`

This is the least discoverable thing in the repo. The vendored code (`src/validate/run.ts` and anything else copied from `poweron-pipelines`) imports its host toolkit the Azure Pipelines way:

```ts
import * as tl from 'azure-pipelines-task-lib/task';
```

`azure-pipelines-task-lib` is **deliberately not listed as a dependency in `package.json`** — there is no such package installed. Instead, that exact import specifier is remapped to `src/lib/task-shim.ts` in two places that must be kept in sync:

- `tsconfig.json` → `compilerOptions.paths`: `"azure-pipelines-task-lib/task": ["src/lib/task-shim"]`
- `jest.config.ts` → `moduleNameMapper`: `'^azure-pipelines-task-lib/task$': '<rootDir>/src/lib/task-shim.ts'`

`task-shim.ts` implements only the surface the vendored runner actually calls (`getInput`, `warning`, `setVariable`) in terms of `@actions/core`, translating camelCase pipelines input/output names to this action's kebab-case `action.yml` names along the way.

The alias exists so the vendored files can be copied from `poweron-pipelines` **without editing their import statements**. If this repo instead installed a real (or stub) `azure-pipelines-task-lib` package and imported `@lib/task-shim` directly from the vendored files, every vendored file would need a source edit on every re-vendor, defeating the byte-identity guarantee above. A contributor who greps for `azure-pipelines-task-lib` in `package.json` and finds nothing should look at `tsconfig.json` `paths` and `jest.config.ts` `moduleNameMapper` next, not assume the import is dead or broken.

### Key Dependencies

- `@libum-llc/symitar` - Proprietary client library for Symitar communication (`SymitarHTTPs`, `SymitarSSH` classes)
- `@actions/core` - GitHub Actions toolkit for inputs/outputs/logging, wrapped by `task-shim.ts` for the vendored code

### File Detection Modes

- **`git-diff`** (target branch resolved, e.g. on `pull_request` events or an explicit `target-branch` input): uses `git diff --name-status` to find changed files in `poweron-directory`.
- **`hash-comparison`** (no target branch resolved): compares the local directory against files deployed on the Symitar host via the Symitar client's `getChangedFiles`, using the `sync-method` transport.
