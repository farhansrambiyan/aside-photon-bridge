# Aside Photon Bridge

Control Aside Browser from iMessage through a Photon project and the official Aside CLI. A small, self-hosted Node.js app for an always-on Mac.

**iMessage → Photon → local Aside CLI/MCP → iMessage reply**

This is an independent community integration, not an official Aside or Photon product. The repository contains only bridge source code. It does not distribute Aside, its CLI binary, credentials, or private conversations.

## Features

- Send ordinary messages without a command prefix.
- Follow-ups continue the same browser session, including after bridge restarts.
- `/new` starts a fresh conversation; `/new <task>` starts one immediately.
- `/status` checks the bridge; `/help` shows commands.
- Plain-text replies without Markdown or visible internal session IDs.
- Required sender allowlist and direct-message-only routing.
- Sequential execution and persistent message deduplication.
- Optional macOS background service, automatic crash restart, and login startup.
- Reminders ("remind me tomorrow morning to call mom"), important-email alerts and an on-demand briefing from Gmail and Calendar, using Aside's own Google access (no Google API keys).
- Typing indicator while Aside works, swipe-reply to continue an earlier conversation, and a "queued" note instead of silence.
- Photos, videos and files are handed to Aside by path; voice messages are transcribed on your Mac.
- Standalone terminal mode and an integration handler for existing Photon agents.

## Requirements

- macOS, Node.js 22.9 or newer, and npm.
- Aside Browser installed, configured, and running under the same macOS user.
- The official Aside CLI with MCP support.
- A Photon project with an iMessage line, registered sender, project ID, and secret.
- Internet access and an awake Mac.

This bridge adds no subscription of its own. Aside model usage, account entitlements, and Photon quotas/pricing still apply. It uses documented developer tools; it does not unlock Aside's paid native channel feature.

## Setup

After cloning or downloading this repository:

```sh
cd aside-photon-bridge
npm ci --ignore-scripts
bash install-cli.command
npm run setup
npm run doctor
npm start
npm run setup-voice   # optional: voice-message transcription
```

Alternatively, set `ASIDE_CLI` in `.env` to an existing official CLI's absolute path. The installer is downloaded from Aside at setup time and asks before executing.

Get Photon credentials from the project's Spectrum configuration in its dashboard. Enter them locally into the setup prompt, not in an issue, chat, or public repository. `.env` is saved with owner-only permissions and excluded from source control.

`ALLOWED_SENDERS` must be the exact registered sender phone number with country code or email address returned by Photon. `ALLOWED_SPACES` optionally restricts conversation IDs too. Missing or unrecognized senders cannot run browser tasks.

The cloud Photon provider uses its managed iMessage line. This app does not read the Mac's Messages database, require access to `chat.db`, or open a public webhook/tunnel.

## Chat commands

Text the number assigned to your Photon project:

```text
Open example.com and tell me the page title. Do not change anything.
Check that page again
/new
/new Search for a different topic
/status
/help
```

Every nonempty direct message from an allowed sender is a task, unless it is a supported slash command. Plain words such as “new” are normal messages. Legacy `/aside` commands also remain accepted.

A native iMessage reply and an ordinary follow-up both continue the currently saved conversation session. `/new` resets that conversation; it does not cancel an earlier task or route replies back to an older session.

Some tasks require approval inside the Aside desktop app. This bridge preserves the default permissions and does not grant unrestricted access. Do not text passwords or secrets.

## Background mode

After confirming a real task and reply work, run from normal macOS Terminal:

```sh
bash enable-autostart.command
```

This recognizes and stops the standalone foreground bridge in the same folder, installs a user LaunchAgent, and starts the background supervisor. If it refuses to identify a process, stop that bridge with Ctrl+C and try again.

After successful installation, Terminal can close. The service starts when you log in after reboot and restarts after an unexpected exit. It waits for Aside Browser and an available login keychain. It does not run before login, enable automatic login, disable FileVault, or prevent Mac sleep.

Check `/status` from iMessage and local logs in `logs/`. To disable:

```sh
bash disable-autostart.command
```

To load code updates, wait for any task to finish, then rerun the background installer. Restarting during an active task pauses new tasks to avoid duplicate actions.

## Terminal mode

```sh
npm run terminal
```

Type a task, `/new`, `/status`, `/help`, or `exit`. This mode needs Aside but no Photon credentials, and keeps its own session state separately.

## Existing Photon agent integration

Only one listener should consume a Photon project. Do not start this standalone bridge alongside another agent for the same project. Instead load the bridge configuration into the existing Node process and use the exported handler:

```js
import { createAsideHandler } from './src/integration.mjs';

const aside = createAsideHandler();
try {
  for await (const [space, message] of app.messages) {
    if (await aside.handle(space, message)) continue;
    // Your existing handler for other senders/platforms.
  }
} finally {
  aside.stop();
}
```

The handler consumes ALL allowlisted direct text messages, not only slash commands. It does not instantiate another Photon app. Load `.env` securely into the process, or pass explicit config overrides. Use one handler/process per state folder.

## Personal assistant features (iMessage mode)

These run inside the background service and use Aside's own Gmail, Google Calendar and Google Docs access through your signed-in Google account. No Google Cloud project, OAuth app or API keys are needed.

Reminders, handled locally and delivered by iMessage:

    remind me tomorrow morning to call mom      (morning = 9:00, afternoon 14:00, evening 18:00, tonight 20:00)
    remind me in 2 hours to check the oven
    remind me friday at 5pm to pay rent
    /reminders            list upcoming reminders
    /cancel 2             cancel reminder 2

Reminders are saved in state/assistant.json and survive restarts. If the Mac was asleep or off, the reminder is delivered as soon as the service is back, marked as late. Repeating reminders are not supported yet.

Important email alerts, built to save tokens: every 5 minutes between 08:00 and 22:00 the bridge runs a plain Gmail lookup through Aside's REPL (no AI model). If there is no new non-promotional mail, nothing else happens and no tokens are used. Only when new mail arrives does it send the new emails' sender, subject and a short preview to one small AI classification. The AI may only answer with list numbers, and the alert text is built from the bridge's own copy of sender and subject, so email content cannot make it say or do something else. With /watch rules there is no AI at all (keyword and sender rules, less accurate).

    /watch                show status
    /watch off | on       disable or enable
    /watch 10             check every 10 minutes (2 to 720)
    /watch rules | ai     no-AI rules, or short AI check for new mail

Briefing on request: send /briefing to get today's calendar, important unread email and today's reminders. Nothing is sent automatically. If you ever want it daily, send /briefing 08:00 (and /briefing off to stop).

Google Docs and anything else work on demand: just ask, for example "summarize my Google Doc called Q4 plan".

Settings live in .env (GOOGLE_ACCOUNT, EMAIL_CHECK_MINUTES, EMAIL_CHECK_START_HOUR, EMAIL_CHECK_END_HOUR, BRIEFING_TIME). Chat commands override them and are remembered. Each email check and briefing uses an Aside agent run, so they count toward your normal Aside model usage. Background checks share the task queue with your own requests, so a message sent during a check waits for it to finish.

Proactive messages go only to the first number in ALLOWED_SENDERS.

## Chat experience (iMessage)

- No "passing your task" message. When you send a message the chat shows it as read. When Aside actually starts working, iMessage shows the typing bubble, refreshed every 15 seconds until the answer arrives.
- If another task is already running, you get one short "Queued" message instead of silence.
- Swipe-reply (long press, Reply) on any earlier answer to continue that conversation, even after you started a newer one. Reply to another message (for example one of your own) and its text is passed along as context. A plain message continues the conversation you used last.
- If the conversation is still running elsewhere (for example in the Aside app), you are told it is busy instead of waiting silently. Send /new for a fresh one.
- Photos, files and voice notes are not read; you get a short note saying so.
- The service log (logs/service.log) records who was ignored and why, with the sender masked and no message text, so a missing message can be traced.

## Photos, videos, files and voice messages

- Photos, videos and other files you send are saved to a private folder (media/, owner-only) and handed to Aside as file paths. Aside opens and understands them itself; the bridge does no conversion. Add your question as the caption, or send them alone and Aside will say what it is.
- Voice messages are turned into text on this Mac and treated exactly like a typed message. By default you see a short "Heard: ..." line first (ECHO_TRANSCRIPT=off hides it).
- Voice setup (free, private, about 700 MB of downloads): run npm run setup-voice once. Alternatives: VOICE_API_KEY for a cloud service (audio leaves your Mac), or VOICE_COMMAND for your own program. If voice is not set up, you get a message saying how to do it, and nothing runs.
- Saved attachments are deleted after 3 days. Limit: 100 MB per file, 6 files per message.
- Only your allowlisted number can make the bridge download anything.

## Safety and privacy

- Prompts are JSON MCP tool arguments, never interpolated into shell commands.
- Group chats, outgoing events, unknown identities, and attachments without text are ignored.
- State is private and contains hashed message identities and session mappings, not message bodies.
- Message IDs are recorded before execution. Failed tasks are not retried automatically.
- Timeouts, uncertain transport failures, or restarts during execution pause future tasks persistently. Stop the bridge, inspect/stop the old task in Aside, run `npm run unblock` (or `npm run unblock -- --terminal` for terminal mode), then restart. Never retry side-effecting work blindly.
- Internal session IDs stay in local state and are removed from outgoing replies. Browser results themselves pass through Photon and iMessage; those services become additional places where sensitive output may appear.
- App diagnostics avoid credentials and task text; dependency logs can contain service metadata.
- `.env`, state, logs, database files, dependency folders, and proprietary binaries are ignored. Keep them out of commits, issue attachments, screenshots, and backups intended for publication.

See [SECURITY.md](SECURITY.md) before exposing a messaging agent to real accounts.

## Compatibility and limitations

Spectrum packages are pinned to 12.10.1. The MCP parser targets Aside CLI 1.26.1008.1938's fixed `session_id` response header. It parses only that protocol prefix, never an ID appearing in agent prose. An incompatible response fails closed instead of silently starting a new session. The installer fetches the latest official CLI, so run `npm run doctor` and a harmless test task after installing or updating it.

Replies are plain conversational text, not native threaded outgoing replies. Long replies are capped. File/screenshot delivery, pre-login operation, and guaranteed message replay during outages are not implemented. Session continuation and formatting are unit-tested; actual host permissions, service startup, and message delivery must be tested on your own Mac.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run check-photon  # initializes the configured provider; sends nothing
npm run doctor       # harmless authenticated browser connectivity check
```

The test suite uses mock browser tasks and temporary local state. It does not send real messages or transact on websites. CI runs on Node.js 22 and 24.

## License and credits

MIT for this bridge source. Third-party SDKs and applications retain their own licenses and terms. Aside and Photon names belong to their respective owners.

- [Aside developer documentation](https://docs.aside.com/help/developers)
- [Photon](https://photon.codes/)
- [Spectrum SDK](https://github.com/photon-hq/spectrum-ts)
