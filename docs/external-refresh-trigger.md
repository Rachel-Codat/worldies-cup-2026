# Reliable refresh via an external cron

GitHub's `schedule` event is best-effort and heavily throttled — during WC2026 it
dropped almost every `*/5` tick, leaving the site stale for hours. The fix is to
trigger the existing **Refresh results** workflow from an external scheduler using
the `workflow_dispatch` API, which is **not** subject to schedule throttling.

This keeps the in-repo `schedule:` block as a backstop; the external trigger is the
primary driver.

## 1. Create a fine-grained personal access token (PAT)

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → *Generate new token*.
2. **Resource owner:** `Rachel-Codat`.
3. **Repository access:** *Only select repositories* → `worldies-cup-2026`.
4. **Repository permissions:** set **Actions → Read and write**. (This is what the
   `workflow_dispatch` endpoint requires; no other permission is needed.)
5. **Expiration:** set it to just past the final (e.g. `2026-07-21`) so it dies on its
   own. Delete it sooner once the tournament ends.
6. Generate and copy the token (`github_pat_…`). You only see it once.

The token is a secret. It will be stored by cron-job.org, so the minimal scope above
matters — it can do nothing beyond triggering Actions on this one repo.

## 2. Confirm the API call works (local test)

```bash
PAT='github_pat_xxxxxxxx'   # paste your token
curl -i -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $PAT" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/Rachel-Codat/worldies-cup-2026/actions/workflows/refresh.yml/dispatches \
  -d '{"ref":"main"}'
```

Success is **HTTP 204 No Content** (empty body). Then check the repo's **Actions** tab —
a new run tagged `workflow_dispatch` should appear within a few seconds.

If you get `404`, the token lacks Actions write or the workflow filename is wrong;
`401/403` means the token is invalid/expired.

## 3. Create the cron-job.org job

1. Sign up / log in at <https://cron-job.org>.
2. **Create cronjob** and set:
   - **Title:** `WC2026 refresh trigger`
   - **URL:** `https://api.github.com/repos/Rachel-Codat/worldies-cup-2026/actions/workflows/refresh.yml/dispatches`
   - **Schedule:** every 5 minutes. Restrict to the match windows if you want to save
     quota — under *Custom*, set minutes `*/5` and hours `0-7,15-23`. Set the job's
     **timezone to UTC** so the hours line up with the kickoff times.
3. Open **Advanced / Settings**:
   - **Request method:** `POST`
   - **Headers** (add three):
     - `Accept: application/vnd.github+json`
     - `Authorization: Bearer github_pat_xxxxxxxx`
     - `X-GitHub-Api-Version: 2022-11-28`
   - **Request body:** `{"ref":"main"}`
   - **Treat as success:** HTTP status `204` (cron-job.org counts 2xx as success by
     default, but pin it to 204 if it offers a "expected status" field).
   - Enable **Save responses** while testing so failures are visible in the history.
4. Save, then use **Run now / Test run** to fire it once and confirm a
   `workflow_dispatch` run appears in the Actions tab.

## 4. Verify it's driving updates

- Actions tab: runs should now appear reliably on the cron-job.org cadence, tagged
  `workflow_dispatch` (not `schedule`).
- Live freshness: `https://rachel-codat.github.io/worldies-cup-2026/data.json` —
  `generatedAt` should advance roughly every 5 min during a match window.

## Notes / safety

- **football-data.org free tier** is 10 requests/min; every 5 min is well within it,
  and `build/refresh.sh` already retries on the occasional 429 using the API's
  `X-RequestCounter-Reset` header.
- The workflow's `concurrency: group: pages, cancel-in-progress: true` means a new
  trigger that lands mid-run cancels the older run — harmless here.
- **Teardown:** after the final, delete the cron-job.org job and revoke the PAT.
- Keep the in-repo `schedule:` block — it costs nothing and acts as a fallback if the
  external job is ever paused.
