# Security model

## Trust boundaries

1. **Browser ↔ control plane** — session-authenticated humans.
2. **Node ↔ control plane** — bearer-credential-authenticated daemons. A node
   is trusted to execute runs _only_ inside directories its operator listed
   in the node's local config.
3. **Control plane ↔ agent process** — the control plane can never name a
   filesystem path or a command; it can only reference workspace/agent keys
   the node previously advertised.

## Browser authentication

- **Sessions**: an HTTP-only, SameSite=Lax cookie carries a random 256-bit
  secret; the database stores only its SHA-256 hash. With
  `STEWARD_COOKIE_SECURE=true` the cookie is `__Host-stx_session` (browser
  enforces Secure, Path=/, no Domain — never shared with sibling subdomains).
- **Passwords**: scrypt (N=32768, r=8, p=1) with per-user salt and
  constant-time comparison. Unknown emails verify against a dummy hash so
  response timing does not reveal account existence.
- **CSRF**: double-submit — a JS-readable cookie must be echoed in the
  `x-steward-csrf` header on every state-changing request, on top of
  SameSite=Lax.
- **Rate limiting**: Redis-backed per-IP limits, with tighter limits on
  login, setup, and enrollment endpoints.
- **First boot**: `POST /api/v1/setup` only works while zero users exist and
  takes an exclusive lock so concurrent attempts cannot both create an admin.
- **CORS**: exactly the configured dashboard origin, with credentials; never
  a wildcard.

## Node credentials and tokens

- Enrollment tokens and node credentials are generated with CSPRNG bytes and
  prefixed (`stx_enroll_`, `stx_node_`) for identifiability. **Plaintext is
  shown exactly once and only hashes are stored**, so a database dump does
  not yield usable credentials.
- Enrollment tokens are single-use (atomic burn), expire, and can be revoked.
- The node stores its credential at mode `0600` in a `0700` directory and
  refuses plain-HTTP transport unless a development flag is set explicitly.

## Workspace security (on the node)

Workspace paths come only from the node's local YAML config — the operator's
explicit allow-list. Before advertising or running:

- paths must be absolute (no relative paths, no `~`),
- the canonical path (all symlinks resolved) is computed and used everywhere,
- the path must exist and be a directory,
- a workspace whose canonical path escapes via symlink to a sensitive
  location is rejected at validation, and the canonical path is re-verified
  at run time in case the filesystem changed,
- `readOnly` workspaces are advertised as such and enforced by the agent
  contract (the diagnostic agent is read-only by construction).

## Run execution

- Agents are spawned with `shell: false`, fixed executables, and fixed
  argument arrays — no string interpolation into a shell, ever. The built-in
  diagnostic agent accepts no arbitrary commands (its only "task" input is a
  bounded `delay=N` testing affordance).
- Runs get their own process group; cancellation is SIGTERM to the group,
  then SIGKILL after a grace period.
- Output is capped per stream and per event; oversized output is truncated
  on UTF-8 boundaries.
- Every outgoing event and error message passes through a redactor that
  strips the node credential and operator-configured secret values.
- Timeouts are enforced on the node, with a server-side backstop for nodes
  that heartbeat but never finish.

## Logging and audit

- Pino redaction censors tokens, credentials, passwords, cookies, and
  authorization headers even if a carrying object is logged by mistake.
- Security-relevant actions (setup, login/logout, token create/revoke, node
  enrollment, run create/cancel) are recorded in the `audit_events` table
  with actor, target, and metadata.

## Reporting

This is pre-1.0 software; do not expose it to the internet without the TLS
setup in [deployment.md](deployment.md). Report vulnerabilities via a private
GitHub security advisory rather than a public issue.
