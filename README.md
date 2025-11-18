[![GitHub release](https://img.shields.io/github/release/libum-llc/validate-poweron-action.svg?style=flat-square)](https://github.com/libum-llc/validate-poweron-action/releases/latest)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-validate--poweron-blue?logo=github&style=flat-square)](https://github.com/marketplace/actions/validate-poweron)
[![CI workflow](https://img.shields.io/github/actions/workflow/status/libum-llc/validate-poweron-action/test.yml?branch=main&label=ci&logo=github&style=flat-square)](https://github.com/libum-llc/validate-poweron-action/actions?workflow=test)

# About

GitHub Action to validate PowerOn files against a Symitar environment.

* [Usage](#usage)
  * [HTTPs connection](#https-connection)
  * [SSH connection](#ssh-connection)
  * [Changed files only](#changed-files-only)
  * [Validate all files](#validate-all-files)
  * [Ignore specific files](#ignore-specific-files)
* [Customizing](#customizing)
  * [inputs](#inputs)
  * [outputs](#outputs)

## Usage

### HTTPs connection

HTTPs connections use the Symitar API for faster validation. This requires an API key.

```yaml
name: Validate PowerOns

on:
  pull_request:
    paths:
      - 'PowerOns/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      -
        name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      -
        name: Validate PowerOn files
        uses: libum-llc/validate-poweron-action@v1
        with:
          symitar-hostname: ${{ secrets.SYMITAR_HOSTNAME }}
          sym-number: ${{ secrets.SYM_NUMBER }}
          symitar-user-number: ${{ secrets.SYMITAR_USER_NUMBER }}
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          api-key: ${{ secrets.SYMITAR_API_KEY }}
          connection-type: https
```

### SSH connection

SSH connections work with all Symitar environments and don't require an API key, but may be slower than HTTPs.

```yaml
name: Validate PowerOns

on:
  pull_request:
    paths:
      - 'PowerOns/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      -
        name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      -
        name: Validate PowerOn files
        uses: libum-llc/validate-poweron-action@v1
        with:
          symitar-hostname: ${{ secrets.SYMITAR_HOSTNAME }}
          sym-number: ${{ secrets.SYM_NUMBER }}
          symitar-user-number: ${{ secrets.SYMITAR_USER_NUMBER }}
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          connection-type: ssh
```

### Changed files only

By default, if you specify a `target-branch`, the action will only validate PowerOn files that have changed compared to that branch. This is useful for pull request validation.

```yaml
- name: Validate PowerOn files
  uses: libum-llc/validate-poweron-action@v1
  with:
    symitar-hostname: ${{ secrets.SYMITAR_HOSTNAME }}
    sym-number: ${{ secrets.SYM_NUMBER }}
    symitar-user-number: ${{ secrets.SYMITAR_USER_NUMBER }}
    symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
    api-key: ${{ secrets.SYMITAR_API_KEY }}
    target-branch: origin/main
```

### Validate all files

To validate all PowerOn files in the directory, omit the `target-branch` input.

```yaml
- name: Validate all PowerOn files
  uses: libum-llc/validate-poweron-action@v1
  with:
    symitar-hostname: ${{ secrets.SYMITAR_HOSTNAME }}
    sym-number: ${{ secrets.SYM_NUMBER }}
    symitar-user-number: ${{ secrets.SYMITAR_USER_NUMBER }}
    symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
    api-key: ${{ secrets.SYMITAR_API_KEY }}
```

### Ignore specific files

You can specify a comma-separated list of PowerOn filenames to exclude from validation.

```yaml
- name: Validate PowerOn files
  uses: libum-llc/validate-poweron-action@v1
  with:
    symitar-hostname: ${{ secrets.SYMITAR_HOSTNAME }}
    sym-number: ${{ secrets.SYM_NUMBER }}
    symitar-user-number: ${{ secrets.SYMITAR_USER_NUMBER }}
    symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
    api-key: ${{ secrets.SYMITAR_API_KEY }}
    validate-ignore: TEST.PO,DEBUG.PO,EXPERIMENTAL.PO
```

## Customizing

### inputs

The following inputs can be used as `step.with` keys:

| Name                       | Type   | Default      | Description                                                      |
|----------------------------|--------|--------------|------------------------------------------------------------------|
| `symitar-hostname`         | String |              | **Required**. Symitar hostname (e.g., `symitar.example.com`)    |
| `sym-number`               | String |              | **Required**. Sym number to validate against                    |
| `symitar-user-number`      | String |              | **Required**. Symitar user number for authentication            |
| `symitar-user-password`    | String |              | **Required**. Symitar user password for authentication          |
| `api-key`                  | String |              | API key for HTTPs connections (required for HTTPs)              |
| `connection-type`          | String | `https`      | Connection type: `https` or `ssh`                               |
| `poweron-directory`        | String | `PowerOns/`  | Directory containing PowerOn files                              |
| `target-branch`            | String |              | Target branch to compare for changed files (e.g., `origin/main`)|
| `validate-ignore`          | String |              | Comma-separated list of PowerOn filenames to ignore             |
| `log-prefix`               | String | `[PowerOn Validate]` | Prefix for log messages                             |

### outputs

The following outputs are available:

| Name               | Type   | Description                                      |
|--------------------|--------|--------------------------------------------------|
| `files-validated`  | String | Number of PowerOn files validated                |
| `files-passed`     | String | Number of PowerOn files that passed validation   |
| `files-failed`     | String | Number of PowerOn files that failed validation   |
| `duration`         | String | Validation duration in seconds                   |

## Security

Store all sensitive information as GitHub repository secrets:
- `SYMITAR_HOSTNAME`
- `SYM_NUMBER`
- `SYMITAR_USER_NUMBER`
- `SYMITAR_USER_PASSWORD`
- `SYMITAR_API_KEY` (for HTTPs connections)

**Never commit credentials or API keys to your repository.**

## Development

### Prerequisites
- Node.js 20+
- pnpm

### Setup
```bash
pnpm install
```

### Build
```bash
pnpm build
```

### Test
```bash
pnpm test
```

### Lint
```bash
pnpm lint
```

### Format
```bash
pnpm format
```

## Support

- [Documentation](https://docs.libum.io)
- [Feedback Portal](https://feedback.libum.io)
- [Discord Community](https://discord.gg/libum)
- [Email Support](mailto:development@libum.io)

## License

MIT
