const { isBuildOf, pickBuild, artifactName } = require('./buildArtifact');

const SHA = 'dc23fe156a019eab0000000000000000000000aa';
const OTHER = '1111111111111111111111111111111111111111';
const real = { id: 1, name: artifactName(SHA), expired: false, workflow_run: { head_sha: SHA } };

test('the build of the commit is accepted', () => {
    expect(isBuildOf(real, SHA)).toBe(true);
});

test('an artifact that only carries the name is refused (uploaded by another run, e.g. a fork pull request)', () => {
    const spoof = { id: 2, name: artifactName(SHA), expired: false, workflow_run: { head_sha: OTHER } };
    expect(isBuildOf(spoof, SHA)).toBe(false);
});

test('a newer spoofed artifact does not hide the real one', () => {
    const spoof = { id: 2, name: artifactName(SHA), expired: false, workflow_run: { head_sha: OTHER } };
    expect(pickBuild([spoof, real], SHA)).toBe(real);
});

test('expired, run-less and other commits\' artifacts are refused', () => {
    expect(isBuildOf({ ...real, expired: true }, SHA)).toBe(false);
    expect(isBuildOf({ ...real, workflow_run: null }, SHA)).toBe(false);
    expect(isBuildOf({ ...real, workflow_run: undefined }, SHA)).toBe(false);
    expect(isBuildOf(real, OTHER)).toBe(false);
    expect(pickBuild([], SHA)).toBeUndefined();
    expect(pickBuild(undefined, SHA)).toBeUndefined();
});

test('a build from a fork pull request of that very commit still counts', () => {
    const fork = { ...real, workflow_run: { head_sha: SHA, head_repository_id: 2, repository_id: 1 } };
    expect(isBuildOf(fork, SHA)).toBe(true);
});
