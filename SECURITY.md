# Security

This bridge allows an authenticated messaging sender to run browser tasks on a
Mac with logged-in websites. Treat it like remote access to those accounts.

Use a private Photon project, exact sender allowlisting, and an optional space
allowlist. Do not disable Aside approvals, share project secrets, or allow
untrusted people to use the same sender identity. This project does not promise
that messaging identity is stronger than the provider's authentication.

No browser task retries automatically. If a task times out or the bridge
restarts while work is active, inspect Aside before unblocking. Unblocking does
not stop an old task. Restart services only after active work has finished.

Never publish .env files, logs, state, browser exports, API keys, personal phone
numbers, messages, or screenshots of credential screens. .gitignore is a safety
net, not a substitute for inspecting your staged diff. Rotate any credential
that has been exposed.

Do not post exploit details or secrets in public issues. Prefer GitHub's private
vulnerability reporting when the repository has enabled it. If unavailable,
request a private contact method without publishing sensitive details.

This is an early community project. Review the source and test with harmless
tasks before using sensitive accounts. Host permissions, keychain availability,
SDK delivery semantics, and dependencies can affect its behavior.
