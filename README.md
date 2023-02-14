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