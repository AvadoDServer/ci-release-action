const core = require('@actions/core');
const exec = require('@actions/exec');
const { context } = require('@actions/github');
const axios = require('axios').default;
const github = require('@actions/github');
const fs = require('fs');
const { gitReadOptions } = require('./gitAuth');

async function run() {
    try {
        const payload = context.payload;
        const rpcAuthToken = core.getInput('rpcToken');
        const githubToken = core.getInput('token');
        core.setSecret(githubToken);
        core.setSecret(rpcAuthToken);

        const octokit = github.getOctokit(githubToken);
        const [owner, repo] = payload.repository.full_name.split('/');

        const artifactsResponse = await octokit.rest.actions.listArtifactsForRepo({
            owner,
            repo,
            per_page: 50,
        });

        const artifacts = artifactsResponse.data.artifacts;

        let artifactToDownload;

        // Commits are ascending, but we need to check from latest -> oldest.
        // With the `sha` input (an automatic merge by the automerge action,
        // which pushes with the workflow token, so no push event runs this
        // workflow) the release looks for that pull request head's build.
        const shaInput = core.getInput('sha');
        const commits = shaInput ? [{ id: shaInput }] : (payload.commits || []);
        const reversedCommits = [...commits].reverse();

        for (let commit of reversedCommits) {
            const commitDiffArtifactName = `asset-${commit.id}-diff`;

            const matchedArtifacts = artifacts.filter(artifact => artifact.name == commitDiffArtifactName);

            if (matchedArtifacts.length) {
                artifactToDownload = matchedArtifacts[0];
                break;
            }
        }

        // The build action now also uploads an SBOM artifact per build, so the
        // newest 50 artifacts cover fewer builds than before. If the diff is
        // not among them, look it up by its exact name.
        if (!artifactToDownload) {
            for (let commit of reversedCommits) {
                const commitDiffArtifactName = `asset-${commit.id}-diff`;

                const namedResponse = await octokit.rest.actions.listArtifactsForRepo({
                    owner,
                    repo,
                    name: commitDiffArtifactName,
                    per_page: 1,
                });

                // An expired artifact cannot be downloaded any more, so treat
                // it as missing (no release), the same as before this lookup.
                const namedArtifacts = namedResponse.data.artifacts.filter(artifact => artifact.name == commitDiffArtifactName && !artifact.expired);

                if (namedArtifacts.length) {
                    artifactToDownload = namedArtifacts[0];
                    break;
                }
            }
        }

        if (!artifactToDownload) {
            core.info('There is no build artifact belongs to commits of this push so no need to release.');
            return;
        }

        // Public repositories are cloned anonymously, exactly as before.
        // Private ones need the token; see gitAuth.js. (The push below
        // already uses the token.)
        await exec.exec(`git clone https://github.com/${payload.repository.full_name}.git .`, undefined, gitReadOptions(payload.repository, githubToken));

        const artifactDownloadResponse = await octokit.rest.actions.downloadArtifact({
            owner,
            repo,
            artifact_id: artifactToDownload.id,
            archive_format: 'zip',
        });

        const artifactFilename = 'diff.zip';
        await exec.exec(`wget -O ${artifactFilename} ${artifactDownloadResponse.url}`);
        await exec.exec(`unzip ${artifactFilename}`);

        await exec.exec(`git apply ${artifactToDownload.name}`);

        await exec.exec(`rm ${artifactToDownload.name}`);
        await exec.exec(`rm ${artifactFilename}`);

        await exec.exec('git config user.name "github-actions[bot]"');
        await exec.exec('git config user.email "github-actions[bot]@users.noreply.github.com"');
        await exec.exec('git add .');
        
        const manifest = JSON.parse(fs.readFileSync('./dappnode_package.json'));
        const releases = JSON.parse(fs.readFileSync('./releases.json'));

        const packageName = manifest.name;
        const version = manifest.version;
        const ipfsHash = releases[version].hash.replace('/ipfs/', '');

        await exec.exec(`git commit --allow-empty -m "Release ${packageName} ${version}" -m "Manifest hash: ${ipfsHash}"`);
        await exec.exec(`git push https://${process.env.GITHUB_ACTOR}:${githubToken}@github.com/${payload.repository.full_name}.git`);
        
        await axios.post(
            'https://adminrpc.ava.do',
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'store.setPackageHash',
                params: {
                    name: packageName,
                    ipfsHash: ipfsHash,
                },
            },
            {
                headers: {
                    Authorization: `${rpcAuthToken}`,
                }
            }
        );

        // Straight to adminrpc: bo.ava.do/rpc only proxied this call to it,
        // and bo.ava.do's backend (bo2) went down on 2026-10-20.
        await axios.post(
            'https://adminrpc.ava.do',
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'store.releaseStore',
            },
            {
                headers: {
                    Authorization: `${rpcAuthToken}`,
                }
            }
        );
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
