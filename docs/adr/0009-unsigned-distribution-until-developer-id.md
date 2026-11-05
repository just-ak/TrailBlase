# ADR 0009: Ad-hoc signing until a Developer ID is available

Status: accepted
Date: 2026-11-05

## Context

No Apple Developer ID is available to start with. Enrolment in the Apple
Developer Program is a paid annual membership, and the project is free software
with no revenue, so it is a real decision rather than a formality.

Signing and notarisation were already a Phase 1 requirement in the sense that
the build configuration must be *ready* for them. The question is what the build
actually does in the meantime, and what users experience.

Three facts constrain the answer.

**Completely unsigned is not a good default on Apple Silicon.** Electron's
pre-built frameworks carry Apple's Team ID. electron-builder's documentation is
explicit that when no valid certificate is found it skips signing entirely and
does **not** apply an ad-hoc signature automatically; ad-hoc has to be opted
into with `mac.identity: "-"`. Without any signature the app can still be run
locally after approval in System Settings, but it is a weaker starting point
than ad-hoc.

**Ad-hoc signing needs entitlements to launch at all.** An ad-hoc signature has
no Team ID, which mismatches the Electron frameworks' signature and produces a
launch failure referencing different Team IDs. The documented fix that keeps
hardened runtime active is the
`com.apple.security.cs.disable-library-validation` entitlement; Electron also
requires `com.apple.security.cs.allow-jit`. The alternative, disabling hardened
runtime, is worse and would have to be undone later.
([electron-builder macOS code signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac);
content rephrased for compliance with licensing restrictions.)

**Gatekeeper got stricter.** macOS Sequoia removed the long-standing
Control-click → Open bypass for unidentified developers. A user who downloads
an unnotarised DMG must now attempt to open the app, then go to System Settings
→ Privacy & Security and use "Open Anyway", authenticating to confirm
([AppleInsider](https://appleinsider.com/inside/macos-sequoia/tips/whats-changed-in-runtime-protection-for-macos-sequoia),
[iDownloadBlog](https://www.idownloadblog.com/2024/08/07/apple-macos-sequoia-gatekeeper-change-install-unsigned-apps-mac/)).
Content rephrased for compliance with licensing restrictions.

## Decision

**Ad-hoc signing with hardened runtime retained**, as the default build, until a
Developer ID is obtained.

```yaml
# electron-builder.yml
mac:
  identity: "-"                 # ad-hoc; no Apple Team ID
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  # notarize: deferred — requires a Developer ID
```

`build/entitlements.mac.plist` carries, from the outset:

- `com.apple.security.cs.disable-library-validation` — required for ad-hoc
  signing to coexist with Apple-signed Electron frameworks
- `com.apple.security.cs.allow-jit` — required by Electron

This configuration is deliberately the same shape the signed build will use.
Obtaining a Developer ID later means supplying a certificate and enabling
notarisation; the entitlements, hardened runtime and target configuration do not
change. That is the point: no restructuring when the certificate arrives.

Notarisation is configured but disabled, with the switch documented, rather than
absent.

## User-facing consequence

A downloaded DMG will be blocked by Gatekeeper on first launch, and the
right-click shortcut no longer works. This must be documented honestly in the
README and in release notes, with the System Settings → Privacy & Security
→ Open Anyway sequence spelled out. Users should not be instructed to disable
Gatekeeper system-wide (`spctl --master-disable`); that trades their whole
machine's protection for one app.

Local development is unaffected. Builds produced on the machine are not
quarantined, so `npm run dev` and locally built bundles launch normally. The
friction applies only to a DMG downloaded from the internet.

A **Homebrew Cask** is worth considering as an additional channel once releases
begin, because Homebrew removes the quarantine attribute from what it installs,
which sidesteps the Gatekeeper prompt without weakening anything. Recorded as an
option, not a commitment.

## Verification

Phase 1's packaging task must confirm by actually doing it, not by assuming:

1. The ad-hoc signed bundle launches on Apple Silicon.
2. `codesign --verify --deep --strict` passes on the bundle.
3. The DMG mounts and the app copies out.
4. A quarantined copy reproduces the expected Gatekeeper block, so the
   documented workaround is tested against real behaviour rather than guessed.

## Revisit when

A Developer ID becomes available. At that point: swap `identity`, enable
notarisation, re-verify with `spctl -a -vvv`, and update the README to drop the
workaround instructions. The Mac App Store remains out of scope permanently for
licence reasons (ADR 0007), so only Developer ID direct distribution is in play.
