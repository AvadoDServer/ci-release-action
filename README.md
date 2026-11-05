## Release Action for AVADO Packages

### Usage

- Be sure there is a repository or ornagization secret called `RPC_TOKEN`
- Put the content below into `.github/workflows` directory

```yaml
name: Release
on:
  push:
    branches:
      - master
jobs:
  release:
    runs-on: ubuntu-22.04
    steps:
      - uses: AvadoDServer/ci-release-action@main
        with:
          rpcToken: ${{ secrets.RPC_TOKEN }}
```

This works for public and private package repositories.

### Private repositories

A public repository is cloned without a token, as it always was. A private
repository is cloned with the `token` input (default: the workflow's own
token), sent as an HTTP header through git's environment, so it is never on a
command line or in `.git/config`, and the runner masks it in the log. The
release commit is pushed with the same token, as before.

The workflow token needs `contents: write` (clone and push) and
`actions: read` (find and download the build's diff artifact). The default
workflow permissions of the AvadoDServer repositories ("read and write")
cover both. If a workflow sets its own `permissions:`, it must keep both.

### Finding the build's diff

The release looks for the `asset-<commit>-diff` artifact of the pushed
commits among the newest 50 artifacts of the repository, as before. If it is
not there (the build action also uploads an SBOM artifact per build now, and
busy repositories have many builds), it asks GitHub for that artifact by its
exact name.
