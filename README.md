# ruxt-core

Public shared source packages for Ruxt applications.

## Packages

- `@ruxt/core` (repository root) — framework-free domain models, CQRS handlers, repository/service ports, feature policy, and analytics contracts.
- `@ruxt/editor` (`packages/editor`) — route-free Nuxt layer containing CodeMirror and sandboxed CV preview primitives.

Neither package owns HTTP routes, persistence adapters, deployment configuration, or application authentication.

## Release policy

Applications consume pinned semver releases from the package registry rather than Git submodules or sibling-directory aliases. The initial extraction version is `0.1.0`. Publish both packages before switching Ruxt and Ruxt Admin away from their migration workspaces.

No open-source license has been granted yet. The repository is publicly readable, but reuse remains subject to the repository owner's rights until a license is added explicitly.
