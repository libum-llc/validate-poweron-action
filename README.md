[![GitHub release](https://img.shields.io/github/release/libum-llc/validate-poweron-action.svg?style=flat-square)](https://github.com/libum-llc/validate-poweron-action/releases/latest)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-validate--poweron-blue?logo=github&style=flat-square)](https://github.com/marketplace/actions/validate-poweron)
[![CI workflow](https://img.shields.io/github/actions/workflow/status/libum-llc/validate-poweron-action/ci.yml?branch=main&label=ci&logo=github&style=flat-square)](https://github.com/libum-llc/validate-poweron-action/actions?workflow=ci)

## About
GitHub Action to validate a PowerOn on the Jack Henry™ credit union core platform

![Validate PowerOn Action](.github/validate-poweron.png)

___

## v2.0.0: Breaking Changes

Upgrading from v1? Read this before you change `@v1` to `@v2` in your workflow. All three changes below can make a workflow that worked in v1 fail, misbehave, or silently stop validating files in v2.

1. **`connection-type` now defaults to `https`, not `ssh`.** If your v1 workflow relied on the SSH default and did not set `connection-type` or `symitar-app-port`, it will now fail: the HTTPS client requires `symitar-app-port` to be set, and `action.yml` does not supply a default for it. Either set `connection-type: ssh` explicitly to keep v1 behavior, or add `symitar-app-port` to move to HTTPS.

2. **List inputs (`validate-ignore`, `preserve-server-files`) are comma-delimited only.** v1 also accepted a newline-delimited YAML block (`validate-ignore: |` followed by one item per line). In v2 that same YAML block is still accepted as a *string* by the Action input mechanism, but it is no longer parsed as a list — it is split only on commas. A multi-line value with no commas in it becomes **one entry containing embedded newlines**, not a parse error. There is no warning, and nothing fails: the value silently stops matching any file, so ignored or preserved files start getting validated (or start triggering server-managed-file warnings) again. If you upgrade from v1, search your workflows for any `validate-ignore:` or `preserve-server-files:` block using the `|` YAML syntax and convert it to a single comma-delimited line.

3. **`target-branch` takes a bare branch name.** `origin/main` and `refs/heads/main` are now rejected with an `InputError` instead of being accepted. Use `target-branch: main`, or omit the input entirely — on `pull_request` events it defaults to the PR's base branch (`GITHUB_BASE_REF`) automatically.

**Unchanged from v1, but easy to miss:** `ssh-username` and `ssh-password` have always been required inputs regardless of `connection-type` — v1 required them unconditionally too, and always built an internal SSH client from them even when connecting over HTTPS. This is not a v2 behavior change; it's called out here only because it surprises people who assume HTTPS mode should need no SSH credentials. The reason is unchanged as well: the HTTPS client does not do its own change detection — it delegates to an SSH client built from those same credentials.

- [Usage](#usage)
  - [Basic Example (HTTPS)](#basic-example-https)
  - [Using SSH Connection](#using-ssh-connection)
  - [Validate All Files (No Target Branch)](#validate-all-files-no-target-branch)
  - [Ignoring Specific Files](#ignoring-specific-files)
  - [Preserving Server-Managed Files](#preserving-server-managed-files)
  - [Debugging Comparisons](#debugging-comparisons)
- [List Inputs](#list-inputs)
- [Server-Managed File Warnings](#server-managed-file-warnings)
- [Migrating from v1](#migrating-from-v1)
- [Customizing](#customizing)
  - [Inputs](#inputs)
  - [Outputs](#outputs)
  - [Secrets](#secrets)
- [Contributing](#contributing)

## Usage

### Basic Example (HTTPS)

`connection-type` defaults to `https`, which requires `symitar-app-port`. SSH credentials are still required — the HTTPS client uses them internally for change detection.

```yaml
name: Validate PowerOn Files

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: self-hosted
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for git diff to work

      - name: Validate PowerOn files
        uses: libum-llc/validate-poweron-action@v2
        with:
          symitar-hostname: 93.455.43.232
          sym-number: 627
          symitar-user-number: 1995
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: libum
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          symitar-app-port: '42627'
          # target-branch is omitted here on purpose: on pull_request events
          # it defaults to the PR's base branch (GITHUB_BASE_REF).
```

### Using SSH Connection

Set `connection-type: ssh` explicitly to skip HTTPS and `symitar-app-port` entirely.

```yaml
- name: Validate PowerOn files (SSH)
  uses: libum-llc/validate-poweron-action@v2
  with:
    symitar-hostname: 93.455.43.232
    sym-number: 627
    symitar-user-number: 1995
    symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
    ssh-username: libum
    ssh-password: ${{ secrets.SSH_PASSWORD }}
    api-key: ${{ secrets.API_KEY }}
    connection-type: ssh
    target-branch: main
```

### Validate All Files (No Target Branch)

Without a `target-branch` and outside a `pull_request` event, the action compares the local directory against what is deployed on the Symitar host instead of using `git diff`. Use `sync-method` to control the transfer transport used for that comparison.

```yaml
- name: Validate all PowerOn files
  uses: libum-llc/validate-poweron-action@v2
  with:
    symitar-hostname: 93.455.43.232
    sym-number: 627
    symitar-user-number: 1995
    symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
    ssh-username: libum
    ssh-password: ${{ secrets.SSH_PASSWORD }}
    api-key: ${{ secrets.API_KEY }}
    symitar-app-port: '42627'
    poweron-directory: REPWRITERSPECS/
    sync-method: sftp
```

### Ignoring Specific Files

```yaml
- name: Validate PowerOn files (with ignore list)
  uses: libum-llc/validate-poweron-action@v2
  with:
    symitar-hostname: 93.455.43.232
    sym-number: 627
    symitar-user-number: 1995
    symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
    ssh-username: libum
    ssh-password: ${{ secrets.SSH_PASSWORD }}
    api-key: ${{ secrets.API_KEY }}
    symitar-app-port: '42627'
    target-branch: main
    validate-ignore: TEST.PO, DEPRECATED.PO, EXAMPLE.PO
```

### Preserving Server-Managed Files

Use `preserve-server-files` for files that are generated or forcibly updated by the server. Matched files are skipped during validation so pull requests do not validate repository copies that should be preserved from the Symitar server. It also suppresses the [server-managed file warning](#server-managed-file-warnings) for any file it covers.

```yaml
- name: Validate PowerOn files (preserve server-managed files)
  uses: libum-llc/validate-poweron-action@v2
  with:
    symitar-hostname: 93.455.43.232
    sym-number: 627
    symitar-user-number: 1995
    symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
    ssh-username: libum
    ssh-password: ${{ secrets.SSH_PASSWORD }}
    api-key: ${{ secrets.API_KEY }}
    symitar-app-port: '42627'
    target-branch: main
    preserve-server-files: RD.*, PFR.*
```

### Debugging Comparisons

Set `debug: true` to see, per run, which comparison strategy was used and why each file was considered changed. This is most useful in [no-target-branch](#validate-all-files-no-target-branch) mode, where "changed" is determined by comparing the local directory against the deployed Symitar host rather than by `git diff`:

```yaml
- name: Validate PowerOn files (debug)
  uses: libum-llc/validate-poweron-action@v2
  with:
    # ...other inputs...
    debug: true
```

With `debug: true`, the action's debug log includes a line describing the comparison strategy (transport and compare mode), followed by one line per file explaining why it was considered changed, e.g.:

```
Change detection strategy: SFTP quick comparison (file presence and normalized byte size; timestamps and content hashes are not compared)
FILENAME.PO: considered changed because it is missing from Sym or its normalized byte size differs
```

GitHub Actions only surfaces `debug`-level log lines when step debug logging is enabled for the run (the `ACTIONS_STEP_DEBUG` secret/variable, or re-running with debug logging). Setting the `debug` input to `true` controls what this action *emits*; it does not by itself turn on GitHub's step debug logging.

## List Inputs

`validate-ignore` and `preserve-server-files` accept **comma-delimited strings only**. Both entries are matched against file basenames, and `preserve-server-files` also accepts glob patterns (`*`, `?`).

```yaml
# Comma-delimited (the only supported form)
validate-ignore: TEST.PO, DEPRECATED.PO

preserve-server-files: RD.*, PFR.*
```

Do **not** use a multi-line YAML block (`validate-ignore: |` followed by one item per line, with or without a `- ` prefix). It is not rejected — it is parsed as a single comma-delimited value with no commas in it, which produces exactly one malformed entry containing embedded newlines. See [Breaking Change #2](#v200-breaking-changes) above; this is the most common upgrade pitfall from v1.

## Server-Managed File Warnings

Symitar frequently regenerates or force-updates certain files as a side effect of server activity outside of your repository (e.g. reports, forms, letters generated by report/document writers). This action recognizes filenames matching `RB.*`, `RD.*`, or `PFR.*` as typically server-managed.

When a file matching one of those patterns is in scope for a run — via `git diff` on a `pull_request`, or via hash comparison in [no-target-branch mode](#validate-all-files-no-target-branch) — and is **not** covered by `preserve-server-files`, the action emits a GitHub Actions warning annotation naming the file(s) and recommending you add the matching pattern to `preserve-server-files`. This is a warning, not a failure: the run still validates and can still succeed.

To suppress the warning for files you have intentionally chosen to preserve from the server, add the matching pattern(s) to `preserve-server-files`:

```yaml
preserve-server-files: RD.*, PFR.*
```

If a matched file is *not* server-managed in your setup and should be validated normally, there is no way to suppress the warning without also excluding it from validation (via `preserve-server-files` or `validate-ignore`) — the warning exists specifically to flag files this action cannot otherwise distinguish from server-managed ones.

## Migrating from v1

The examples below are a complete v1 workflow and its v2 equivalent, so the diff is explicit. This workflow used the (then-default) SSH connection and a newline-delimited ignore list.

<table>
<tr><th>v1</th><th>v2</th></tr>
<tr valign="top">
<td>

```yaml
name: Validate PowerOn Files

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: libum-llc/validate-poweron-action@v1
        with:
          symitar-hostname: 93.455.43.232
          sym-number: 627
          symitar-user-number: 1995
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: libum
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          target-branch: origin/${{ github.base_ref }}
          validate-ignore: |
            - TEST.PO
            - DEPRECATED.PO
```

</td>
<td>

```yaml
name: Validate PowerOn Files

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: libum-llc/validate-poweron-action@v2
        with:
          symitar-hostname: 93.455.43.232
          sym-number: 627
          symitar-user-number: 1995
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: libum
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          connection-type: ssh
          # target-branch omitted: defaults to GITHUB_BASE_REF on pull_request
          validate-ignore: TEST.PO, DEPRECATED.PO
```

</td>
</tr>
</table>

What changed in this migration, beyond the version tag:

- `connection-type: ssh` was added explicitly, since `https` is now the default and this workflow has no `symitar-app-port` to support it.
- `target-branch: origin/${{ github.base_ref }}` was removed. It would now raise an `InputError` (the `origin/` prefix is rejected); on `pull_request` events it is unnecessary anyway, since the default already resolves to the PR's base branch.
- `validate-ignore` was rewritten from a YAML block (`|` with `- ` prefixed items) to a single comma-delimited line. Left as-is, the YAML block would have silently become one malformed ignore entry — see [Breaking Change #2](#v200-breaking-changes).

## Customizing

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `symitar-hostname` | The endpoint by which you connect to the Symitar host | Yes | - |
| `sym-number` | The directory (aka Sym) number for your connection | Yes | - |
| `symitar-user-number` | Your Symitar Quest user number (just the number) | Yes | - |
| `symitar-user-password` | Your Symitar Quest password (just the password) | Yes | - |
| `ssh-username` | The AIX user name for the Symitar host. Required even when `connection-type` is `https` — the HTTPS client delegates change detection to an SSH client built from these credentials. | Yes | - |
| `ssh-password` | The AIX password for the Symitar host. Required even when `connection-type` is `https` — the HTTPS client delegates change detection to an SSH client built from these credentials. | Yes | - |
| `ssh-port` | The port to connect to the SSH server | No | `22` |
| `api-key` | Your PowerOn Pipelines API Key from [Libum Portal](https://portal.libum.io) | Yes | - |
| `symitar-app-port` | The port which your SymAppServer communicates over. This is typically `42` + `symNumber`. Since `connection-type` defaults to `https`, this is effectively required unless you set `connection-type: ssh` — the action fails fast with a clear error if it is missing under HTTPS. | No | - |
| `connection-type` | Connection type: `https` or `ssh` | No | `https` |
| `poweron-directory` | The directory in the repository to monitor PowerOn changes in | No | `REPWRITERSPECS/` |
| `target-branch` | Bare branch name to compare against for changed files (e.g. `main`). Defaults to the pull request base branch on `pull_request` events. The `origin/` and `refs/heads/` prefixes are rejected with an error. | No | - |
| `validate-ignore` | List of PowerOn filenames to ignore during validation. Comma-delimited only — see [List Inputs](#list-inputs). | No | `''` |
| `preserve-server-files` | List of exact filenames or glob patterns to skip during validation because they are preserved from the server. Comma-delimited only — see [List Inputs](#list-inputs) and [Server-Managed File Warnings](#server-managed-file-warnings). | No | `''` |
| `debug` | Enable debug logging for Symitar clients — see [Debugging Comparisons](#debugging-comparisons) | No | `false` |
| `sync-method` | Transport method for file synchronization when no `target-branch` is provided: `rsync` or `sftp` | No | `sftp` |

### Outputs

| Output | Description |
|--------|-------------|
| `files-validated` | Number of PowerOn files validated |
| `files-passed` | Number of PowerOn files that passed validation |
| `files-failed` | Number of PowerOn files that failed validation |

### Secrets

The following secrets should be configured in your repository:

- `SYMITAR_USER_PASSWORD` - Your Symitar Quest password (just the password)
- `SSH_PASSWORD` - The AIX password for the Symitar host
- `API_KEY` - Your PowerOn Pipelines API Key from [Libum Portal](https://portal.libum.io)

## Contributing
We at [Libum](https://libum.io) are committed to improving the software development process of Jack Henry" credit unions. The best way for you to contribute / get involved is communicate ways we can improve the Validate PowerOn Action feature set.

Please share your thoughts with us through our [Feedback Portal](https://feedback.libum.io), on our [Libum Community](https://discord.gg/libum) Discord, or at [development@libum.io](mailto:development@libum.io)
