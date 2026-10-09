# Post, notification and RSVP reliability — October 8, 2026

## Confirmed findings

1. **Student posts skipped student notifications.** The notification webhook sent student-authored posts only to staff. Production debug records for the reported October 4 and October 6 posts match that branch. The handler now targets staff and students, excludes the author, and honors each recipient's `new_posts` preference.
2. **The web RSVP database function rejected legitimate server requests.** Production logs contained 18 `42501: Service role required` failures during the preceding week. The function read the legacy individual JWT setting; current requests carry the role in `request.jwt.claims`. The production correction accepts the current setting while retaining the service-only grant and account-role validation. A non-mutating live request now reaches user validation instead of failing the service-role check.
3. **Attachment uploads could fail or leave partial posts.** The web composer offered 10 MB files but sent their bytes through a Vercel function, whose request limit is [4.5 MB](https://vercel.com/docs/functions/limitations#request-body-size). Both clients created the post before saving all attachments. New clients upload directly to signed storage URLs, verify completed uploads on the server, then publish the post and its attachment rows in one database transaction. A signed draft identifier is retained across retries, preventing duplicate publication after a lost response. The existing iPhone attachment-only post behavior remains supported.
4. **Handled failures were poorly reported.** The iPhone Going controls ignored save errors; rejected network requests could leave optimistic RSVPs looking saved. These now restore the previous state and display a recoverable error. Post, RSVP and push-provider failures receive Sentry operation/code tags. Reports omit mutation request bodies and breadcrumbs; signed upload credentials are redacted from telemetry. This improves visibility into item 2; it is not the cause of item 2.

Sentry issue history remains unverified: the available credential returned HTTP 403 for both projects, and the browser requires sign-in. The changes above are supported by production logs, live database inspection and regression tests. A specific reported iPhone incident still needs correlation with Sentry or an affected device. Expo acceptance is not proof of delivery to a physical phone; this change does not add receipt polling or replay historical notifications.

## Applied database changes

Applied through the authenticated migration operation to **AmboPortal** (`lazwwkysaygqkskpbzbd`):

- `20261008231759_fix_web_rsvp_service_claim.sql` — live web RSVP permission correction.
- `20261008232103_create_post_with_attachments.sql` — additive, service-only atomic publication helper; used when the updated web backend is deployed.

Both functions' execution grants were checked. No existing RSVP or post records were changed during verification. Security and performance advisor findings were unchanged from the baseline; existing findings can be reviewed using the [Supabase database linter guidance](https://supabase.com/docs/guides/database/database-linter).

## Verification and release boundary

- Web: 367 unit tests pass; TypeScript, lint and production build pass. Lint reports existing warnings outside the changed files.
- Mobile: 150 unit tests pass; TypeScript, lint, the production iOS JavaScript/Hermes bundle, and the Xcode Release simulator build pass. The native build contains its embedded `main.jsbundle`. Lint reports two existing warnings outside the changed files.
- Local PostgreSQL regressions pass for current/legacy access boundaries, explanation validation, atomic rollback, attachment limits, attachment-only posts and duplicate retries.
- A real 8 MB signed upload, duplicate-upload response and CORS preflight passed against production storage. Its disposable file was removed; no post or notification was created.
- The locally built post endpoints return JSON 401, rather than redirecting to login, for unsigned requests. The configured test-student sign-in failed, so authenticated UI verification remains pending. The Simulator GUI is not installed even though the command-line Release build succeeds.
- The Xcode Release build initially failed on dependencies targeting iOS 9/12/13. The Podfile now brings those targets up to the app's existing iOS 15.1 minimum without changing dependency versions. A one-line Expo Router patch guards an iOS 16-only subtitle API, using the repository's existing `patch-package` workflow. The Release simulator build then passed. Its artifact is `/private/tmp/ambo-release-build/Build/Products/Release-iphonesimulator/AmboPortal.app`. Interactive and physical-device validation remain pending.

Skyler explicitly authorized pushing all of these fixes directly to `main`. The Git publication includes the web, shared and mobile changes; the production web deployment must be verified before distributing the updated iPhone app because the new composer uses its upload/finalization endpoints. The native App Store release remains a separate step under `AGENTS.md` and the App Store runbook. A physical-device push test and Sentry sign-in are still required for full live confirmation.

To repeat the local database regressions, install `@electric-sql/pglite@0.5.8` into a temporary directory and set `PGLITE_MODULE` to its `dist/index.js`, then run:

```sh
node apps/web/supabase/tests/rsvp-service-claims.mjs
node apps/web/supabase/tests/post-attachments.mjs
```
