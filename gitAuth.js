const core = require('@actions/core');

// Exec options for the git commands that read the package repository.
//
// Public repository: returns undefined, so the commands run exactly as they
// always did (anonymous https clone, no token anywhere).
//
// Private repository: returns options whose environment makes git send the
// workflow token to github.com as an "AUTHORIZATION: basic" header (the same
// header actions/checkout uses). The token goes through GIT_CONFIG_* variables,
// so it is never on a command line, never written to .git/config and never in
// the git diff the build uploads. Both the token and its base64 form are
// registered as secrets, so the runner masks them if they ever reach the log.
function gitReadOptions(repository, token) {
    if (!repository || !repository.private) {
        return undefined;
    }

    if (!token) {
        throw new Error(
            'This package repository is private, so the action needs a GitHub token to read it. ' +
            'Leave the "token" input out to use the workflow token, or pass one that can read this repository.'
        );
    }

    const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    core.setSecret(token);
    core.setSecret(basic);

    const env = { ...process.env };
    const index = parseInt(env.GIT_CONFIG_COUNT || '0', 10) || 0;
    env[`GIT_CONFIG_KEY_${index}`] = 'http.https://github.com/.extraheader';
    env[`GIT_CONFIG_VALUE_${index}`] = `AUTHORIZATION: basic ${basic}`;
    env.GIT_CONFIG_COUNT = String(index + 1);

    return { env };
}

module.exports = { gitReadOptions };
