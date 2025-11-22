## About
GitHub Action to validate a PowerOn against the Jack Henry™ credit union core platform

___

- [Usage](#usage)
  - [Basic Example](#basic-example)
  - [Using HTTPS Connection](#using-https-connection)
  - [Validate All Files (No Target Branch)](#validate-all-files-no-target-branch)
  - [Ignoring Specific Files](#ignoring-specific-files)
- [Customizing](#customizing)
  - [Inputs](#inputs)
  - [Secrets](#secrets)
- [Contributing](#contributing)

## Usage

### Basic Example

```yaml
name: Validate PowerOn Files

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Validate PowerOn files
        uses: libum-llc/validate-poweron-action@v1
        with:
          symitar-hostname: ${{ secrets.SYMITAR_HOSTNAME }}
          sym-number: ${{ secrets.SYM_NUMBER }}
          symitar-user-number: ${{ secrets.SYMITAR_USER_NUMBER }}
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: ${{ secrets.SSH_USERNAME }}
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          target-branch: origin/main
```

### Using HTTPS Connection

```yaml
- name: Validate PowerOn files (HTTPS)
  uses: libum-llc/validate-poweron-action@v1
  with:
    symitar-hostname: ${{ secrets.SYMITAR_HOSTNAME }}
    sym-number: ${{ secrets.SYM_NUMBER }}
    symitar-user-number: ${{ secrets.SYMITAR_USER_NUMBER }}
    symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
    ssh-username: ${{ secrets.SSH_USERNAME }}
    ssh-password: ${{ secrets.SSH_PASSWORD }}
    api-key: ${{ secrets.API_KEY }}
    connection-type: https
    target-branch: origin/main
```

### Validate All Files (No Target Branch)

```yaml
- name: Validate all PowerOn files
  uses: libum-llc/validate-poweron-action@v1
  with:
    symitar-hostname: ${{ secrets.SYMITAR_HOSTNAME }}
    sym-number: ${{ secrets.SYM_NUMBER }}
    symitar-user-number: ${{ secrets.SYMITAR_USER_NUMBER }}
    symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
    ssh-username: ${{ secrets.SSH_USERNAME }}
    ssh-password: ${{ secrets.SSH_PASSWORD }}
    api-key: ${{ secrets.API_KEY }}
    poweron-directory: REPWRITERSPECS/
```

### Ignoring Specific Files

```yaml
- name: Validate PowerOn files (with ignore list)
  uses: libum-llc/validate-poweron-action@v1
  with:
    symitar-hostname: ${{ secrets.SYMITAR_HOSTNAME }}
    sym-number: ${{ secrets.SYM_NUMBER }}
    symitar-user-number: ${{ secrets.SYMITAR_USER_NUMBER }}
    symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
    ssh-username: ${{ secrets.SSH_USERNAME }}
    ssh-password: ${{ secrets.SSH_PASSWORD }}
    api-key: ${{ secrets.API_KEY }}
    target-branch: origin/main
    validate-ignore: TEST.PO,DEPRECATED.PO,EXAMPLE.PO
```

## Customizing

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `symitar-hostname` | Symitar hostname (e.g., symitar.example.com) | Yes | - |
| `sym-number` | Sym number to validate against | Yes | - |
| `symitar-user-number` | Symitar user number for authentication | Yes | - |
| `symitar-user-password` | Symitar user password for authentication | Yes | - |
| `ssh-username` | SSH username for SSH connections | Yes | - |
| `ssh-password` | SSH password for SSH connections | Yes | - |
| `ssh-port` | SSH port for SSH connections | No | `22` |
| `api-key` | API key for Symitar connections | Yes | - |
| `connection-type` | Connection type: "https" or "ssh" | No | `ssh` |
| `poweron-directory` | Directory containing PowerOn files | No | `REPWRITERSPECS/` |
| `target-branch` | Target branch to compare against for changed files (e.g., origin/main) | No | - |
| `validate-ignore` | Comma-separated list of PowerOn filenames to ignore during validation | No | `''` |

### Outputs

| Output | Description |
|--------|-------------|
| `files-validated` | Number of PowerOn files validated |
| `files-passed` | Number of PowerOn files that passed validation |
| `files-failed` | Number of PowerOn files that failed validation |
| `duration` | Validation duration in seconds |

### Secrets

The following inputs contain sensitive information and should be stored as GitHub secrets:

- `symitar-user-password` - Symitar user password
- `ssh-username` - SSH username
- `ssh-password` - SSH password
- `api-key` - Symitar API key

To add secrets to your repository:
1. Go to your repository settings
2. Navigate to **Secrets and variables** > **Actions**
3. Click **New repository secret**
4. Add each secret with an appropriate name (e.g., `SYMITAR_USER_PASSWORD`, `SSH_USERNAME`, `SSH_PASSWORD`, `API_KEY`)
5. Reference them in your workflow using `${{ secrets.SECRET_NAME }}`

## Contributing
We at [Libum](https://libum.io) are committed to improving the software development process of Jack Henry" credit unions. The best way for you to contribute / get involved is communicate ways we can improve the Validate PowerOn Action feature set.

Please share your thoughts with us through our [Feedback Portal](https://feedback.libum.io), on our [Libum Community](https://discord.gg/libum) Discord, or at [development@libum.io](mailto:development@libum.io)
