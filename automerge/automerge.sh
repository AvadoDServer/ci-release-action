#!/usr/bin/env bash
# Picks at most one upstream-update pull request that may be merged now, and
# merges it (merge commit, so the release finds the build of its head commit).
# Outputs pr= and sha= for the release step; both empty when nothing merged.
# Rules: README.md in this directory.
set -euo pipefail

R="$GITHUB_REPOSITORY"
OWNER="${R%%/*}"
BOT_BRANCH='^(upstream-check|update-.+|automated/update-.+|auto-update-.+)$'
BOT_COMMITTER='github-actions[bot]'
HOLD_LABELS='^(hold|no-automerge|do-not-merge)$'
NOW=$(date -u +%s)

out() { echo "pr=$1" >> "$GITHUB_OUTPUT"; echo "sha=$2" >> "$GITHUB_OUTPUT"; }
log() { echo "$*"; echo "- $*" >> "$GITHUB_STEP_SUMMARY"; }

if [ "${ENABLED:-}" = "off" ]; then
  log "Automatic merges are off in this repo (repository variable AUTOMERGE=off)."
  out "" ""; exit 0
fi

# Comment once per head commit and reason, so a waiting PR does not get a
# new comment on every scheduled run.
note() { # pr sha reason text
  [ "${ENABLED:-}" = "dry-run" ] && return 0
  local marker="<!-- automerge:$2:$3 -->"
  if ! gh api "repos/$R/issues/$1/comments?per_page=100" -q '.[].body' | grep -qF "$marker"; then
    gh pr comment "$1" -R "$R" --body "$4

$marker" >/dev/null
  fi
}

upstream_at() { # ref -> the manifest's upstream field as text
  gh api "repos/$R/contents/dappnode_package.json?ref=$1" -q .content | base64 -d |
    jq -r 'if (.upstream|type) == "string" then .upstream else (.upstream|tostring) end'
}

# 0 when the update changes a first version number (or the second of a 0.x
# version) in any of the versions the upstream field names.
is_major() { # from to
  python3 - "$1" "$2" <<'EOF'
import re, sys
a = [list(map(int, v.split("."))) for v in re.findall(r"\d+(?:\.\d+)+|\d+", sys.argv[1])]
b = [list(map(int, v.split("."))) for v in re.findall(r"\d+(?:\.\d+)+|\d+", sys.argv[2])]
if not a or len(a) != len(b):
    sys.exit(0)  # unreadable: treat as major, a person looks at it
for x, y in zip(a, b):
    if x[0] != y[0] or (x[0] == 0 and x[1:2] != y[1:2]):
        sys.exit(0)
sys.exit(1)
EOF
}

# 0 when no version in the upstream field goes down and at least one goes up.
is_newer() { # from to
  python3 - "$1" "$2" <<'EOF'
import re, sys
a = [list(map(int, v.split("."))) for v in re.findall(r"\d+(?:\.\d+)+|\d+", sys.argv[1])]
b = [list(map(int, v.split("."))) for v in re.findall(r"\d+(?:\.\d+)+|\d+", sys.argv[2])]
if not a or len(a) != len(b) or any(y < x for x, y in zip(a, b)):
    sys.exit(1)
sys.exit(0 if any(y > x for x, y in zip(a, b)) else 1)
EOF
}

build_passed() { # sha
  local run
  run=$(gh api "repos/$R/actions/workflows/build.yml/runs?head_sha=$1&per_page=20" \
    -q '[.workflow_runs[] | select(.conclusion != "action_required" and .conclusion != "skipped" and .conclusion != "cancelled")] | sort_by(.created_at) | last | .id // empty')
  [ -n "$run" ] || return 1
  [ "$(gh api "repos/$R/actions/runs/$run/jobs" -q '[.jobs[] | select(.name == "build")][0].conclusion')" = "success" ]
}

# The release needs the Build's diff artifact, made by a workflow run on this
# very commit (the same test as buildArtifact.js in ci-release-action: an
# artifact that only carries the name does not count).
has_artifact() { # sha
  [ "$(gh api "repos/$R/actions/artifacts?name=asset-$1-diff&per_page=100" \
    -q "[.artifacts[] | select(.expired == false and .workflow_run.head_sha == \"$1\")] | length")" != "0" ]
}

# A pull request this action merged whose release never happened (the run
# failed in between): the release pushes a "Release ..." commit on top of the
# merge, so a default branch that still ends in our merge commit was not
# released. Release it now instead of looking for the next one.
unreleased=$(gh api "repos/$R/commits/$(gh api "repos/$R" -q .default_branch)" \
  -q 'select((.commit.message | test("^Merge #[0-9]+: ")) and (.commit.message | contains("Merged automatically by the update pipeline.")) and (.parents | length == 2)) | "\(.commit.message | capture("^Merge #(?<n>[0-9]+): ").n) \(.parents[1].sha)"')
if [ -n "$unreleased" ]; then
  read -r un usha <<<"$unreleased"
  if [ "${ENABLED:-}" = "dry-run" ]; then
    log "#$un was merged but not released: WOULD release it now (dry run)."
    out "" ""; exit 0
  fi
  log "#$un was merged but not released (an earlier run failed): releasing it now."
  out "$un" "$usha"; exit 0
fi

if [ -n "$PR" ]; then
  candidates="$PR"
else
  candidates=$(gh pr list -R "$R" --state open --limit 50 --json number,createdAt -q 'sort_by(.createdAt) | .[].number')
fi

for n in $candidates; do
  pr=$(gh pr view "$n" -R "$R" --json number,title,isDraft,headRefName,headRefOid,isCrossRepository,labels,baseRefName,state)
  sha=$(jq -r .headRefOid <<<"$pr")
  title=$(jq -r .title <<<"$pr")
  branch=$(jq -r .headRefName <<<"$pr")

  # Only the update bots' own pull requests, never a fork or a person's branch.
  [ "$(jq -r .state <<<"$pr")" = "OPEN" ] || continue
  [ "$(jq -r .isCrossRepository <<<"$pr")" = "false" ] || continue
  [ "$(jq -r .baseRefName <<<"$pr")" = "main" ] || [ "$(jq -r .baseRefName <<<"$pr")" = "master" ] || continue
  [[ "$branch" =~ $BOT_BRANCH ]] || continue
  [ "$(jq -r .isDraft <<<"$pr")" = "false" ] || { log "#$n: draft, skipped."; continue; }
  if jq -r '.labels[].name' <<<"$pr" | grep -qE "$HOLD_LABELS"; then
    log "#$n: has a hold label, skipped."; continue
  fi

  # A person pushed to the bot's branch: they are working on it, hands off.
  others=$(gh api "repos/$R/pulls/$n/commits?per_page=100" -q "[.[] | select(.committer.login != \"$BOT_COMMITTER\")] | length")
  if [ "$others" != "0" ]; then
    log "#$n: has commits that are not the bot's, merge it by hand."
    note "$n" "$sha" human "Not merged automatically: this branch has commits that are not the update bot's. Merge it by hand when it is ready."
    continue
  fi

  base_up=$(upstream_at "$(jq -r .baseRefName <<<"$pr")")
  head_up=$(upstream_at "$sha")
  if ! is_newer "$base_up" "$head_up"; then
    log "#$n: $head_up is not newer than $base_up on the base branch (stale), skipped."
    note "$n" "$sha" stale "Not merged automatically: the base branch already ships **$base_up**, so this update to **$head_up** is stale. Close it."
    continue
  fi
  if is_major "$base_up" "$head_up"; then
    log "#$n: $base_up -> $head_up is a major upgrade, merge it by hand."
    note "$n" "$sha" major "Not merged automatically: **$base_up → $head_up** is a major upgrade. Read the upstream release notes, then merge by hand."
    [ "${ENABLED:-}" = "dry-run" ] || gh pr edit "$n" -R "$R" --add-label needs-review >/dev/null 2>&1 || true
    continue
  fi

  if ! build_passed "$sha"; then
    log "#$n: no passed Build for $sha yet."; continue
  fi
  if ! has_artifact "$sha"; then
    log "#$n: the Build of $sha left no artifact to release (expired or missing), run the Build again."
    note "$n" "$sha" artifact "Not merged automatically: the Build passed but its release artifact is missing or expired. Run the Build again: Actions, Build, Run workflow, pull request **$n**."
    continue
  fi

  urgent=false
  { [[ "$title" == "[REQUIRED]"* ]] || jq -r '.labels[].name' <<<"$pr" | grep -qx urgent; } && urgent=true
  committed=$(gh api "repos/$R/commits/$sha" -q .commit.committer.date)
  age_h=$(( (NOW - $(date -u -d "$committed" +%s)) / 3600 ))
  if [ "$urgent" = false ] && [ "$age_h" -lt "$MIN_AGE_HOURS" ]; then
    when=$(date -u -d "$committed + $MIN_AGE_HOURS hours" '+%Y-%m-%d %H:%M UTC')
    log "#$n: waits until $when (${age_h}h old)."
    note "$n" "$sha" wait "Build passed. This update is merged and released automatically on the first bot run after **$when**. Add the \`hold\` label to stop that."
    continue
  fi

  # GitHub computes mergeability lazily; ask again until it knows.
  for _ in 1 2 3 4 5 6; do
    m=$(gh pr view "$n" -R "$R" --json mergeable -q .mergeable)
    [ "$m" != "UNKNOWN" ] && break; sleep 5
  done
  if [ "$m" != "MERGEABLE" ]; then
    log "#$n: not mergeable ($m)."
    note "$n" "$sha" conflict "Not merged automatically: GitHub says the branch is not mergeable ($m). The bot rewrites it on its next run if upstream moves; otherwise fix it by hand."
    continue
  fi

  if [ "${ENABLED:-}" = "dry-run" ]; then
    log "#$n: WOULD merge and release now (dry run: AUTOMERGE=dry-run)."
    out "" ""; exit 0
  fi
  gh pr merge "$n" -R "$R" --merge --match-head-commit "$sha" \
    --subject "Merge #$n: $title" --body "Merged automatically by the update pipeline."
  log "#$n: merged ($title; urgent: $urgent)."
  out "$n" "$sha"
  exit 0
done

log "Nothing to merge."
out "" ""
