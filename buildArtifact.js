// Which build artifact may be released for a commit.
//
// The build action uploads the release diff as "asset-<head sha>-diff". The
// name alone proves nothing: a pull request from a fork runs its own copy of
// the workflow and can upload an artifact under any name, also the name of
// someone else's commit. GitHub records which commit the workflow run that
// made an artifact ran on, and a fork cannot set that, so an artifact counts
// only when its run's head commit is the commit in its name.
function artifactName(sha) {
    return `asset-${sha}-diff`;
}

function isBuildOf(artifact, sha) {
    return Boolean(
        artifact
        && sha
        && artifact.name === artifactName(sha)
        && !artifact.expired
        && artifact.workflow_run
        && artifact.workflow_run.head_sha === sha
    );
}

// Newest first, like the API lists them.
function pickBuild(artifacts, sha) {
    return (artifacts || []).find(artifact => isBuildOf(artifact, sha));
}

module.exports = { artifactName, isBuildOf, pickBuild };
