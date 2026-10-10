# Contributing

1. Use Node.js 22 or newer.
2. Run npm ci --ignore-scripts, then npm test.
3. Keep changes focused and add tests for behavior changes.
4. Do not include .env, personal paths/phone numbers, state, logs, credentials,
   vendor binaries, or real message history in commits or fixtures.
5. Preserve fail-closed sender authorization, session isolation, and no automatic
   retries for side-effecting browser tasks.
6. Explain dependency or CLI protocol changes and test their actual wire format.

Do not test by sending messages to other people or modifying real accounts
without permission. Report security issues privately, not in public issues.
