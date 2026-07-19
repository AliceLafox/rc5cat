# Changelog

All notable changes to rc5cat. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[semver](https://semver.org/).

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
