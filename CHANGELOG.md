# Changelog

All notable changes to rc5cat. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[semver](https://semver.org/).

## [0.6.0] — 2026-07-20

### Added

- **Opt-out from the clear trash safety net** — `rc5cat clear --no-trash`
  deletes the wav outright, and the UI grows a toolbar checkbox
  ("move cleared wavs to trash", **checked by default**). When opted out,
  the ✕ confirm dialog states plainly that the deletion is permanent, and
  no trash folder is created.

## [0.5.0] — 2026-07-20

### Added

- **`rc5cat pull <slot...> | --all`** (and a ⬇ button in the UI) — copy slot
  audio from the pedal to disk, e.g. loops recorded on the device. Files are
  named smartly: a meaningful original filename (your DAW export) is kept;
  pedal-technical names (DOS 8.3 artifacts like `FIFTH-~2.WAV`) become
  `"NN - Slot Name.wav"`; duplicates across slots get the slot number prefix
  instead of silently overwriting. `--raw-names` always keeps the on-pedal
  filename, existing files are never overwritten without `--force`, and the
  pedal is only ever read from.
- **Upload via file dialog** — an ⬆ button on every slot row, and the
  empty-row label ("drop a WAV here, or click to choose") now opens a file
  picker; drag-and-drop still works.

### Fixed

- A stale tab (rc5cat restarted since the page loaded) used to fail
  cryptically — downloads even saved a `wav.json` error file. Downloads now
  go through fetch with readable errors, and any stale-token failure shows
  "page is out of date" and reloads the tab automatically.

## [0.4.0] — 2026-07-20

### Added

- **Volume auto-detection** — the pedal is found by content
  (`ROLAND/DATA` + `ROLAND/WAVE`) across `/Volumes` (macOS), drive letters
  (Windows) and `/media`, `/run/media`, `/mnt` (Linux), so a renamed volume
  still works; `--volume` remains as the explicit override.
- **Windows friendliness** — `Thumbs.db` and `desktop.ini` join the junk
  sweep, `rc5cat ui` opens the browser on Windows and Linux too, and the
  README documents the Windows workflow.

## [0.3.0] — 2026-07-19

### Added

- **`rc5cat clear <slot...>`** (and a ✕ button in the UI) — reset slots to
  factory state. The slot config is restored to the pedal's exact virgin
  form, captured byte-for-byte from real hardware (with its non-obvious
  factory values: `Measure=1`, rhythm `Reverb=30`, `Fill=1`, `Stop=1`).
  `--keep-name` resets everything except the display name. Also heals
  "ghost" slots whose config references audio that is no longer there.
- **Trash safety net** — `clear` is the only rc5cat operation that removes
  audio, so it never deletes outright: the wav is moved to a dated folder
  under `~/.rc5cat/trash` (`--trash-dir` to relocate) before the slot is
  reset.

## [0.2.0] — 2026-07-19

### Added

- **`rc5cat ui`** — a browser UI for non-terminal humans, served from
  `node:http` with zero dependencies. Slot table with click-to-edit names,
  loop / One Shot toggle, drag-and-drop WAV upload with a live progress
  indicator, wav filenames per slot, health banners (collapsed past the first
  four), Backup and Clean buttons, dark-mode aware. Security: binds
  `127.0.0.1` only, every mutation requires a per-run token embedded in the
  page, foreign `Host` headers are rejected (DNS-rebinding guard).
- **Upload pre-normalization** — `push` (CLI and UI) rewrites the WAV into
  the pedal's own canonical form (RIFF + fmt + data, DAW metadata chunks
  stripped; float32 gets the pedal-style 28-byte fmt body) before writing.
  Verified byte-identical against files a real RC-5 normalized itself. The
  pedal therefore never rewrites an upload at boot — which also protects
  long filenames from being shortened to DOS 8.3 (a mangling that FAT
  directory rebuilds can otherwise inflict).
- API/server test suite on a fake volume and headless-browser checks for the
  UI (rename, toggle, drop-upload exercised end-to-end).

## [0.1.0] — 2026-07-19

### Added

- Initial release: `status`, `ls`, `backup`, `rename`, `oneshot`, `push`,
  `clean`, `doctor`.
- Byte-surgical editing of `MEMORY*.RC0`: anything not explicitly changed
  round-trips bit-exact, including the per-file trailer markers (`8`/`9`)
  whose absence or mismatch causes `LOOPER DATA READ ERR`.
- Boot-indexing parameter formula (measures, tempo, `Measure = MeasLen + 7`)
  pinned by tests to values computed by real hardware.
- AppleDouble junk sweeping after every write; `clean` and `doctor` commands
  for volumes touched by hand.
- Automatic dated config backups before every mutation.
- WAV validation (44.1 kHz stereo; 16/24-bit PCM and 32-bit float) with
  fail-fast semantics: a refused push leaves the pedal untouched.
- Documentation of the RC-5 storage format in the README: memory file
  structure, trailer markers, boot-time indexing algorithm, audio formats,
  and the macOS AppleDouble landmine.
