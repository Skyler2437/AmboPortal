# Sentry Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use `superpowers:test-driven-development` for behavioral changes and `superpowers:verification-before-completion` before reporting completion. Follow the repository release workflow; do not push a mobile change until Skyler confirms the local Release build is good.

**Goal:** Prevent the observed React Navigation rehydration crash, restore useful Sentry symbolication for future mobile builds, and add the missing Next.js Sentry instrumentation hooks.

**Architecture:** Add a narrow, reproducible guard at the React Navigation router boundary and preserve it as an installed-package patch. Wrap the existing custom Metro configuration with Sentry's supported wrapper, apply the Sentry Expo config plugin deterministically to the committed iOS project, and expose Next.js's request/router hooks from the existing instrumentation entry points. Keep Sentry credentials in environment variables.

**Tech Stack:** Expo SDK 55, React Native 0.83, React Navigation 7, React 19, Sentry React Native 8, Next.js 14, Sentry Next.js 10, Vitest 4, Xcode Release builds.

## Constraints

- Preserve the user's unrelated `AGENTS.md`, `.codex/`, and `.superpowers/` working-tree changes.
- Do not resolve or archive Sentry issues remotely as part of the code fix.
- Do not hard-code Sentry credentials; only stable organization/project identifiers may have safe fallbacks.
- A local build can verify the upload wiring, but source maps and dSYMs will not appear in production Sentry until a later production EAS/Vercel build runs with valid auth tokens.
- Do not push until Skyler confirms the local iOS Release build is good.

### Task 1: Reproduce the Navigation Failure

**Files:**
- Create: `apps/mobile/tests/navigation-rehydration.test.ts`

- [x] Add a focused characterization test that calls the installed stack router with an undefined rehydration state, matching the concurrent nested-navigation path seen in Sentry.
- [x] Assert the router returns a valid initial state instead of throwing.
- [x] Run the focused test and verify RED with the observed `stale` access error.

### Task 2: Install a Durable Router Guard

**Files:**
- Modify: `package.json`
- Modify mechanically: `package-lock.json`
- Create: `patches/@react-navigation+routers+7.5.3.patch`

- [x] Add `patch-package` as a root development dependency and run it from `postinstall`.
- [x] Guard the stack, tab, and drawer router rehydration entry points so an undefined transient state falls back to each router's initial state.
- [x] Generate the patch from both the shipped JavaScript and source files.
- [x] Reinstall dependencies to prove the patch reapplies cleanly.
- [x] Run the navigation regression test and verify GREEN.

### Task 3: Restore Mobile Sentry Build Artifacts

**Files:**
- Modify: `apps/mobile/metro.config.js`
- Modify: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/ios/AmboPortal.xcodeproj/project.pbxproj`
- Create or modify through the supported config plugin: `apps/mobile/ios/sentry.properties`

- [x] Preserve the monorepo Metro resolution behavior while wrapping the final config with Sentry's Expo-specific Metro helper so bundles receive Debug IDs.
- [x] Give the Expo Sentry plugin stable organization/project fallbacks while keeping the auth token environment-only.
- [x] Apply the plugin's two native build changes to the committed project: wrap the React Native bundle script and add the debug-symbol upload phase.
- [x] Verify the evaluated Expo config contains the Sentry plugin and the native project contains both supported Sentry scripts.

### Task 4: Complete Web Sentry Instrumentation

**Files:**
- Modify: `apps/web/src/instrumentation-client.ts`
- Modify: `apps/web/src/instrumentation.ts`
- Modify: `apps/web/next.config.js`

- [x] Export `Sentry.captureRouterTransitionStart` as `onRouterTransitionStart`.
- [x] Export `Sentry.captureRequestError` as `onRequestError`.
- [x] Use safe organization/project fallbacks in the build plugin while leaving `SENTRY_AUTH_TOKEN` environment-only.
- [x] Run a production web build and confirm the missing-hook warnings are gone.

### Task 5: Verification and Handoff

- [x] Run the focused mobile regression test.
- [x] Run all mobile and web tests, lint, typecheck, and production web build.
- [x] Run `npm install` once to confirm the package patch applies from a clean install lifecycle.
- [x] Run the mobile app with `npx expo run:ios --configuration Release` and inspect the result.
- [x] Run `git diff --check`, review the scoped diff, and confirm unrelated working-tree files are untouched.
- [x] Report the exact local verification boundary and wait for Skyler's build confirmation before pushing.
