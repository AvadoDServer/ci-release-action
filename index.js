const core = require('@actions/core');
const exec = require('@actions/exec');
const { context } = require('@actions/github');
const axios = require('axios').default;
const github = require('@actions/github');
const fs = require('fs');

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

        for (let commit of payload.commits) {
            const commitDiffArtifactName = `${commit.id}.diff`;

            const matchedArtifacts = artifacts.filter(artifact => artifact.name == commitDiffArtifactName);

            if (matchedArtifacts.length) {
                artifactToDownload = matchedArtifacts[0];
                break;
            }
        }

        if (!artifactToDownload) {
            core.info('There is no build artifact belongs to commits of this push so no need to release.');
            return;
        }

        await exec.exec(`git clone https://github.com/${payload.repository.full_name}.git .`);

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
        await exec.exec('git commit -m "apply build diff"');
        await exec.exec(`git push https://${process.env.GITHUB_ACTOR}:${githubToken}@github.com/${payload.repository.full_name}.git`);

        const manifest = JSON.parse(fs.readFileSync('./dappnode_package.json'));
        const releases = JSON.parse(fs.readFileSync('./releases.json'));

        const packageName = manifest.name;
        const version = manifest.version;
        const ipfsHash = releases[version].hash;

        await axios.post(
            'https://adminrpc.ava.do',
            {
                name: packageName,
                ipfsHash,
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
