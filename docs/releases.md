# Releasing the Android app

Since app 2.4.0 the phone updates itself. Two kinds of release:

| Change | Command (in `apps/mobile`) | What the phone does |
|---|---|---|
| Code only (screens, logic, text) | `npm run ota -- "what changed"` | Downloads it at the next start; uses it from the restart after that ("Restart to update" in Profile, or a toast) |
| Native (new module, plugin, permission) | bump `version` + `versionCode` in `app.config.ts`, `npm run apk -- --clean`, `npm run release:apk -- "notes"` | Shows "Update available"; Profile → Update downloads, checks and installs it |

`npm run apk` without `--clean` reuses the native project (seconds to a couple of minutes). Use
`--clean` only after a native change.

## Safety

### Signed updates
- Over-the-air updates are signed with `keys/private-key.pem` (RSA, never committed). The app holds
  `certs/certificate.pem` and refuses any update not signed by that key, including rollbacks.
- Only updates made for the installed native build apply (`runtimeVersion` policy `fingerprint`):
  code that needs a newer native build never lands on an older app. The APK and the updates are
  built with the same environment (`scripts/release-env.mjs`), or the fingerprints would differ.
- An APK installs only if Android finds it signed with the same key as the installed app
  (`credentials/android/keystore.jks`), and Android always asks first.

### Rollback
- **On the phone, automatic:** if a new update crashes before it has started properly, Expo marks it
  bad and launches the previous working version (expo-updates error recovery).
- **For everyone, by hand:** `npm run ota:rollback` sends every phone back to the code inside its
  installed APK (signed, channel `production`). Publishing a fixed update afterwards moves them on.
- **APKs can't be rolled back by Android:** a bad APK is fixed by publishing a newer one (higher
  `versionCode`). So an APK release is tested before `release:apk` (checks, e2e, installing it).

### Atomic
- **Updates:** expo-updates downloads to a separate place, checks the signature and every file's
  hash, and switches only at a start. An interrupted download is discarded; the app keeps running
  the version it has.
- **APKs:** downloaded as `pocket-agent-<code>.apk.part`, renamed only after its size and MD5
  match `latest.json`; anything else is deleted and nothing is installed. Android's installer is
  itself all-or-nothing. `release:apk` uploads the APK before `latest.json`, so a phone that reads
  the new `latest.json` early finds a mismatch and installs nothing. Old downloads are cleaned up
  at the next start.

### Keys (never commit, never share)
| Key | Where | Backup | If it is lost |
|---|---|---|---|
| APK signing (`credentials/android/keystore.jks` + `credentials.json`) | this PC | the Expo account (EAS credentials; `eas credentials -p android` downloads it again) | Installed apps can't be updated; users would have to uninstall and reinstall. Keep the EAS copy. |
| Update signing (`keys/private-key.pem`) | this PC | must be kept by the owner (see below) | No more signed updates until a new certificate ships inside a new APK (installed through the in-app updater, which needs only the APK key). |

Back up `keys/private-key.pem` (and the APK keystore) somewhere private and encrypted: a password
manager, or an encrypted drive. Never in git, chat or e-mail.
