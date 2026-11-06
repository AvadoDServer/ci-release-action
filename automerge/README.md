# Automatic merge and release of upstream updates

Every package repo with an update bot runs this action in two places:

- in **Build** (`build.yml`), right after the pull request built, uploaded to
  IPFS and passed the start test (`AvadoDServer/ci-build-action/smoke`);
- at the start of the **bot workflow** (daily), before the bot looks upstream.

The action looks at the open pull requests (in Build: only that one) and
merges **at most one** per run, with a merge commit, then releases it exactly
like the Release workflow does (`ci-release-action` with `sha:` set to the
pull request head, whose build it releases). Boxes with automatic updates then
pick it up. It comments "Merged and released automatically" on the pull request.

## What gets merged

All of these must hold:

| Rule | Why |
|---|---|
| The branch is an update bot's (`upstream-check`, `update-*`, `automated/update-*`, `auto-update-*`) in this repo, into `main`/`master`. Never a fork. | Only robot updates are automatic. |
| Every commit on it was made by `github-actions[bot]`. | If a person pushed to it, they are working on it: hands off. |
| No `hold`, `no-automerge` or `do-not-merge` label, not a draft. | Your brake for one pull request. |
| The `upstream` version in `dappnode_package.json` goes up and not down. | A stale bot pull request never downgrades a package. |
| It is not a major upgrade (first number changes, or the second one of a 0.x version). Such a pull request gets the `needs-review` label and a comment. | Breaking changes live in major versions. |
| The Build's `build` job passed for the head commit (build, IPFS upload, start test). | The package is installable and starts. |
| The head commit is at least 20 hours old, unless the update is urgent (title starts with `[REQUIRED]`, or the `urgent` label). The pull request gets one comment saying when it will be merged. | An upstream release that is pulled or fixed within a day never ships, and you can add `hold` in time. |
| GitHub says it is mergeable. | |

Anything else is left open, with one comment saying why where a person has to act.

## Switches

- One pull request: add the label `hold`.
- One repo: repository variable `AUTOMERGE` = `off` (Settings, Secrets and variables, Actions, Variables).
- Try it: `AUTOMERGE` = `dry-run` logs what would be merged, changes nothing.
- Everything: organization variable `AUTOMERGE` = `off` (a repository variable overrides it).
- Wait time: input `min-age-hours` (default 20; the bots run daily, so 20 h means "next day").

## Notes

- The merge and the release commit are pushed with the workflow token, so no
  push workflow runs on them; the release runs inside this action instead.
  When a person merges by hand, the Release workflow runs as before.
- If the release fails after the merge, the run fails (GitHub emails you).
  Release it by re-running the failed job, or by hand.
