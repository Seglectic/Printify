# AGENTS.md

This file gives AI coding agents the minimum context needed to work safely in this repository.

## Project Summary

Printify is a small Node.js + Express app for receiving print jobs from a browser UI and sending them to local printers.

Primary responsibilities:
- Serve static UI files from `src/`
- Accept uploaded PDF, image, and ZIP files
- Convert images to PDF before printing when needed
- Send jobs to configured printers
- Track page hits and print counts in `serverData.json`

## Runtime

- Entry point: `Printify.js`
- Start command: `npm start`
- Default server port in current code: `8020`
- Static assets are served from `src/`
- Uploaded files are written to `uploads/`

## Important Files

- `Printify.js`: main Express server, upload handlers, print logic, server metadata endpoint
- `package.json`: dependencies and npm scripts
- `src/pages/index.html`: main printer-selection UI
- `src/pages/logs.html`: logs view
- `src/scripts/index.js`: index-page behavior and printer card wiring
- `src/styles/index.css`: index-page styling
- `src/scripts/logDrawer.js`: Recent Logs drawer behavior
- `src/scripts/clippy.js`: clippy mascot UI
- `src/scripts/input.js`: shared hidden input sequence manager for config and client-plugin activation codes
- `lib/previewer.js`: preview-cache generation and checksum-keyed thumbnail lookup
- `lib/pluginLoader.js`: discovers plugins and exposes enabled client plugins to the browser
- `lib/plugins/dmg/`: optional gen 1 Game Boy client plugin with ROM library and save slots
- `lib/plugins/presence/`: Linux `lsusb` printer availability plugin keyed by printer id and regex
- `lib/previewCache/`: generated log thumbnail cache keyed by checksum
- `src/dymo.html`: legacy Dymo-specific browser UI, if still present
- `serverData.json`: persisted counters for page hits and print count
- `uploads/`: temporary uploaded and extracted files

## Coding Preferences

- Follow the repo's existing section-header comment style when touching established files.
- Prefer comments that explain intent, assumptions, and hardware-specific caveats.
- Avoid obvious line-by-line comments that restate the code.
- Keep comments short and useful. Add them where behavior is non-obvious, cross-platform, or easy to break.
- When introducing new abstractions, name them clearly enough that they reduce the need for excessive comments.
- For the index page, keep printer-card labels subtle and monospaced, preserve the drag-to-print affordance, and keep load animations intentional but light.
- Split versioning is acceptable in this repo. Do not assume `package.json` and any client-facing version constant should match unless the task explicitly calls for alignment.

## Delegation Preferences

- When commits are requested, prefer having the agent directly handling the task make the commit so the commit author has the fullest context for the change set.
- When version numbers need to change, prefer a dedicated `version-audit` worker first. Base the bump on the actual change set since the last relevant version, not on guesswork or a generic patch bump.
- Treat `version-roll` as the full versioning workflow: run a `version-audit`, bump the affected version surfaces, and commit the result.
- During a `version-audit`, use patch bumps for fixes, polish, and small behavior tweaks. Use minor bumps when the change adds a meaningful new feature, new capability, new config surface, new endpoint, or another clearly user-facing workflow.
- When `AGENTS.md` is part of the task, prefer assigning a dedicated worker to maintain or revise this file so repo guidance stays intentional and isolated.
- Commit messages should read naturally and a bit casual rather than overly formal.

## Printing Model

The app uses a printer config object pattern in `Printify.js`.

Known printer configs:
- `printers.zebra`
- `printers.brotherLaser`
- `printers.dymoLabel`

Current behavior:
- `testing = true` means printing is skipped and calls are logged instead
- Linux path uses `lp`
- Windows/macOS path uses `pdf-to-printer`
- Image conversion uses ImageMagick via `convert`

Preferred direction:
- Move toward a modular, config-driven printer system instead of hardcoded per-printer behavior.
- New printer support should prefer extending a shared printer registry/config layer over adding one-off logic branches.
- Favor separations like printer definition, file preparation, and transport/print execution.
- Make it possible to add, disable, or remove printers with minimal route and UI churn.
- Prefer shared request handlers and capability flags over duplicating near-identical endpoints.

## API Endpoints

Current server endpoints in `Printify.js` include:
- `POST /zebra`
- `POST /zebrapng`
- `POST /zebrazip`
- `POST /brother`
- `POST /brotherImg`
- `POST /labelmake`
- `POST /dymopng`
- `GET /version`

## Agent Guardrails

- Preserve existing endpoint names unless the user explicitly asks for API changes.
- Do not silently change printer names, port numbers, or printing behavior without calling that out.
- Treat printing code as hardware-sensitive. Prefer small, explicit changes.
- When refactoring, bias toward flexibility and modular printer composition, but do not break current flows just to chase abstraction.
- Avoid introducing dependencies unless necessary.
- Keep the app runnable with `npm start`.
- Prefer minimal edits over broad refactors.
- Do not remove `testing` mode unless explicitly requested.
- Security weakpoint: the web config editor plus `printMode: "cli"` can let someone with UI access point a printer at arbitrary commands, and uploads/ZIP extraction make this especially dangerous. Treat this as a glaring known vulnerability; do not expand configurable command execution surfaces, and prefer hardcoded/proven probe commands until this is fixed.
- Client plugins should use a `code` config field for hidden activation sequences and register through the shared `window.printifyInput` path instead of adding one-off keydown buffers.
- Keep client plugin ids, config keys, public plugin URLs, and `/client-plugins/:pluginId` API paths aligned. The gen 1 Game Boy plugin id is `dmg`; reserve broader emulator names for future backends.
- The `presence` plugin is intentionally Linux-only and hardcoded to `lsusb`; do not add arbitrary command probes to it without first addressing the CLI/config execution risk.
- For `lib/plugins/dmg/`, ROM selection is browser-driven from the discovered `ROM/` library. Do not reintroduce per-ROM `rom` or `save` config fields unless the user asks for a startup-default feature.
- Be careful with filesystem writes in `uploads/` and `serverData.json`.
- Treat `lib/previewCache/` as generated cache output, not hand-edited source.
- Keep preview filenames checksum-keyed and prefer direct file existence checks over scanning historical logs for dedupe.
- Preserve `chksum` on log entries so log-drawer thumbnails can resolve through the shared checksum key.
- Keep preview generation best-effort. Preview failures should not turn successful prints into failed jobs unless the user explicitly asks for stricter behavior.
- Keep the index page config-driven from `/printers`; do not hardcode printer availability.
- Do not reintroduce the removed hero/status/builder UI on the index page.
- Preserve the footer, Recent Logs button, and clippy on the index page.
- Do not force server/package and client-facing versions to match unless the user explicitly asks for aligned versioning.

## Known Constraints

- This repo may be used on Windows and non-Windows systems.
- Some paths and printer names are machine-specific.
- Browser pages are plain HTML/JS, not a framework app.
- The `src/agents/` directory is for the Clippy-style UI mascot system, not AI workers.

## Suggested Workflow For Future Agents

1. Read `package.json` and `Printify.js` first.
2. Confirm whether the task affects server routes, frontend pages, printer availability rendering, or print pipeline behavior.
3. If version numbers need to change, run a `version-audit` step to identify the correct server and client bumps from the real change history before editing version files. If the user asks for a `version-roll`, treat that as the full audit, bump, and commit flow.
4. If `AGENTS.md` is in scope, update it intentionally and keep any guidance changes narrowly scoped to the workflow being adjusted.
5. If editing print behavior, verify which printer object and endpoint are involved.
6. If the task touches previews or log thumbnails, keep `lib/previewer.js` as the owner of ImageMagick preview generation and cache lookup instead of scattering preview logic across routes or UI code.
7. Prefer verifying with `npm start` when sandbox rules allow port binding.
8. If commits are requested, have the agent already doing the work make the commit and keep each commit scoped to one slice of work.
9. Report clearly when runtime verification is blocked by the environment.
