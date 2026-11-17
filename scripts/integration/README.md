# Live GitHub Action Integration

The live workflow executes `uses: ./`: the committed `action.yml` and `dist/`
bundle customers receive. It does not rebuild the Action or mock Symitar.
Licensing alone is simulated for `POWERON_PIPELINES_ORG_ID`, as in the Azure
DevOps integration suite. This is not a licensing-entitlement test.

## Configuration and execution

Enable this repository in the `Symitar` runner group. Use the same single runner
for both Actions and the Azure DevOps extension's GitHub live workflows so they
cannot overlap against the shared test console. Repository concurrency groups
alone do not serialize different repositories.

In the `symitar-integration` environment, configure:

- Secrets: `SYMITAR_PASSWORD` and `SYMITAR_USER_PASSWORD` (valid test credentials).
- Variable: `POWERON_PIPELINES_ORG_ID`.
- Approved trust: `SYMITAR_SSH_HOST_KEY`, or the host's approved key already in
  the runner service account's `~/.ssh/known_hosts`. Never automatically accept
  an unknown key. Preflight performs no login.

Relevant trusted branch pushes run the suite and attach results to the PR.
Manual dispatch is also supported. Fork PRs and Dependabot do not run it.
Never blindly rerun a failed job: rerun attempts are blocked. Review the cause
and any remaining fixture journal before a fresh dispatch. No test changes
credentials, injects authentication failures, or retries a failed connection.

The workflow summary and `symitar-live-evidence` artifact contain each scenario's
elapsed milliseconds and outcome. Each Action has a three-minute timeout; this
is a safety ceiling, not a performance target. Failures stop further host calls.

## Coverage

- Server checksum selection validates one uniquely named valid PowerOn.
- Empty input succeeds with zero counts.
- A local-only Git commit tests the same git-diff path used for PR validation,
  including multiline ignore and preserve lists. It never pushes a branch.
- Two intentionally invalid PowerOns verify aggregated compiler errors and
  exclusions. This is the final host call: only exact failure counts `2/0/2`
  are accepted, and an authentication failure cannot produce a green run.

Compiler fixtures are pinned to LF with `.gitattributes`, matching the Azure
DevOps suite. Preparation reads their committed bytes to avoid persistent
runner checkout filters and rejects committed CRLF before connecting.

Validation uses the connector's temporary compile workflow and cleanup. Invalid
PowerOn source is different from invalid credentials; credentials never vary.
