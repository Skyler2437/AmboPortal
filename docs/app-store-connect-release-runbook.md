# iOS App Store Release Runbook

Use this runbook after a mobile feature has been tested on a physical iPhone, merged to `main`, and approved for release by Skyler.

## Release authorization

At the start of a release, ask Skyler for one consolidated authorization covering:

- the marketing version and build number;
- uploading the private AmboPortal monorepo to Expo/EAS;
- submitting the signed archive to Apple App Store Connect;
- creating and editing the matching App Store version;
- attaching the build and submitting it to App Review;
- the release method after approval.

A useful authorization is:

> Release iOS version X.Y.Z, build N. You may upload the private repository to Expo/EAS, submit the resulting archive to App Store Connect, create and complete the App Store version, and submit it to App Review. Release it automatically to all users after approval.

This keeps the workflow moving with one decision. Stored documentation does not grant permanent external-action authority, so obey any confirmation the current environment still requires.

## 1. Verify the source release

1. Confirm the feature PR is merged and GitHub CI is green.
2. Confirm the Vercel production deployment succeeded when shared/web code changed.
3. Work from a clean, freshly pulled `main`.
4. If the normal checkout has unrelated or untracked files, do not clean or overwrite it. Use a fresh temporary clone of `main`.
5. Run `git status --short`. Before the version bump, it must be empty.
6. Install the exact locked dependencies with `npm ci` when the clean checkout has no `node_modules`.

EAS uploads the whole monorepo, including untracked files. Never build from a checkout containing stray files.

## 2. Set the version

The project uses `appVersionSource: local`. Update all native version locations:

- `apps/mobile/ios/AmboPortal/Info.plist`
  - `CFBundleShortVersionString` = marketing version, such as `1.4.0`
  - `CFBundleVersion` = build number, such as `20`
- `apps/mobile/ios/AmboPortal.xcodeproj/project.pbxproj`
  - every `MARKETING_VERSION` entry = marketing version
  - every `CURRENT_PROJECT_VERSION` entry = build number

Verify the values:

```bash
rg -n 'MARKETING_VERSION|CURRENT_PROJECT_VERSION|CFBundleShortVersionString|CFBundleVersion' \
  apps/mobile/ios/AmboPortal.xcodeproj/project.pbxproj \
  apps/mobile/ios/AmboPortal/Info.plist
git diff --check
```

App Store Connect rejects a build number already used for this bundle identifier.

## 3. Build the signed archive with EAS

Run from `apps/mobile/`:

```bash
npx eas whoami
npm run build:prod:ios
```

Expected configuration:

- EAS project: `@skyler2437/ambo-portal`
- bundle identifier: `com.amboportal.app`
- build profile: `production`
- distribution: `STORE`
- Apple team: `2RLH9PFCH5`
- remote distribution certificate and provisioning profile are active
- push notifications are configured

When EAS asks whether to log in to the Apple account, Apple login is optional if all remote credentials are already present. Choosing **No** is acceptable when EAS reports that the distribution certificate, provisioning profile, and push notifications are ready.

Record the EAS build ID and build-details URL. If the interactive command is stopped after the upload, the remote build continues.

Monitor a specific build without creating a duplicate:

```bash
npx eas build:view BUILD_ID --json
```

Proceed only when the status is `FINISHED`, the reported app version/build number are correct, and an IPA artifact URL exists.

## 4. Upload the exact build to App Store Connect

Prefer an explicit build ID so an older archive cannot be selected accidentally:

```bash
npx eas submit \
  --platform ios \
  --profile production \
  --id BUILD_ID \
  --non-interactive
```

Confirm the output shows:

- App Store Connect app ID `6761090244`;
- the intended app version and build number;
- the configured App Store Connect API key;
- a submission details URL.

Wait until EAS reports the submission status as `FINISHED`. This means Apple accepted the binary upload. It does **not** mean the version has been sent to App Review.

## 5. Complete the version in App Store Connect

Open AmboPortal in App Store Connect and use **Distribution**.

1. Wait until the uploaded build finishes Apple processing.
2. Create the new iOS version with **Add iOS App** and enter the marketing version.
3. Confirm the prior version's screenshots, description, keywords, support URL, copyright, review information, and release settings were carried forward.
4. Add concise release notes in **What's New in This Version**.
5. In **Build**, choose **Add Build**, select the exact build number, choose **Done**, and save.
6. Verify the page shows the intended version and build together.
7. Choose **Add for Review**.
8. Open **App Review**, open the new draft, and verify:
   - the draft contains exactly one intended item;
   - the version and build are correct;
   - the status is **Ready for Review**.
9. Choose **Submit for Review**.
10. Verify the draft moves to **Submissions** and shows Apple's submitted/review status.

Never write reviewer passwords, Apple API keys, session tokens, or other credentials into this repository. Confirm the existing App Review login information is still valid directly in App Store Connect.

## 6. Release settings

Unless Skyler requests something different:

- automatically release after App Review approval;
- release the update to all users immediately;
- keep the existing App Store summary rating.

Call these settings out in the final pre-submission summary.

## 7. Release handoff

Report:

- marketing version and build number;
- merged commit/PR;
- EAS build ID and build URL;
- EAS submission ID and submission URL;
- App Store Connect status;
- whether automatic release is enabled;
- anything Apple still requires.

After Apple approval, confirm the version is **Ready for Distribution** and available on the App Store.

## Troubleshooting

### Expo cannot resolve `expo-router`

The clean checkout does not have dependencies installed. Run `npm ci` at the monorepo root, then retry the build.

### Build concurrency limit reached

Do not start another build. Keep the recorded build ID and monitor it with `eas build:view BUILD_ID --json`.

### EAS submit is waiting for a submitter

Do not create a duplicate submission. Keep the recorded submission URL and wait for the existing submission to finish.

### The build is not listed in App Store Connect

Apple is still processing the uploaded archive. Wait and refresh the version page or TestFlight before creating another upload.

### App Store version is only Ready for Review

The version was added to a draft but has not been sent to Apple. Open **App Review**, open the draft, and choose **Submit for Review**.
