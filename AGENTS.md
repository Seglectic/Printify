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
- `src/index.html`: main browser UI for Zebra and Brother flows
- `src/dymo.html`: Dymo-specific browser UI
- `serverData.json`: persisted counters for page hits and print count
- `uploads/`: temporary uploaded and extracted files

## Coding Preferences

- Follow the repo's existing section-header comment style when touching established files.
- Prefer comments that explain intent, assumptions, and hardware-specific caveats.
- Avoid obvious line-by-line comments that restate the code.
- Keep comments short and useful. Add them where behavior is non-obvious, cross-platform, or easy to break.
- When introducing new abstractions, name them clearly enough that they reduce the need for excessive comments.

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
- Be careful with filesystem writes in `uploads/` and `serverData.json`.

## Known Constraints

- This repo may be used on Windows and non-Windows systems.
- Some paths and printer names are machine-specific.
- Browser pages are plain HTML/JS, not a framework app.
- The `src/agents/` directory is for the Clippy-style UI mascot system, not AI workers.

## Suggested Workflow For Future Agents

1. Read `package.json` and `Printify.js` first.
2. Confirm whether the task affects server routes, frontend pages, or print pipeline behavior.
3. If editing print behavior, verify which printer object and endpoint are involved.
4. Prefer verifying with `npm start` when sandbox rules allow port binding.
5. Report clearly when runtime verification is blocked by the environment.
