# Server v2.6.0 Draft

Status: draft only, not published

## Why 2.6.0

This feels like a server minor release from `2.5.6` because it adds meaningful runtime capability and new config surface:

- plugin loading and plugin config defaults
- `ptouch` server plugin support
- `presence` printer availability plugin support
- tape label and CLI bundle handling
- monochrome prep and monochrome preview support
- queued job system and related print-flow changes

## Highlights

- Added a shared plugin system with config-backed defaults under `plugins:`
- Added Linux USB presence monitoring to hide/show configured printers based on `lsusb`
- Added `ptouch-print` availability polling and tape width awareness for tape printers
- Added tape-printing prep improvements including monochrome output support
- Added monochrome preview support for builder/preview flows
- Added queued job tracking infrastructure and active job reporting
- Improved config layout so plugin options are easier to read and maintain

## Notable Polish / Patch-Scale Work Included

- Faster preview generation in the log drawer
- Better confirm/error handling around print flows
- Upload tightening and log drawer polish
- Security/dependency bump for Express and audit fixes
- Shared plugin default config cleanup and inline plugin comments in `config.yaml`

## Release Notes Draft

Printify server `v2.6.0` expands the print pipeline with plugin-driven runtime behavior, tape-label support improvements, monochrome prep/preview handling, and a more capable queued job flow. This release also adds plugin config defaults under `plugins:` and improves how printer availability can react to local hardware presence.

## Pre-Release Checklist

- Confirm server version bump target is `2.6.0`
- Decide whether to leave client split versions as-is or align the remaining stale client surfaces
- Run a final manual smoke test with `npm start`
- Test `/version`, `/client-version`, `/printers`, and at least one print flow
- Test one plugin-enabled config path if the release includes plugin support by default
- Push `main`
- Create tag `v2.6.0`
- Create GitHub release from this draft when ready
