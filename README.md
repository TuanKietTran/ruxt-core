# ruxt-core

Public shared source packages for Ruxt applications.

## Packages

- `@ruxt/core` (repository root) — framework-free domain models, CQRS handlers, repository ports, sagas, feature policy, and analytics.
- `@ruxt/editor` (`packages/editor`) — route-free Nuxt layer containing CodeMirror and sandboxed CV preview primitives.

Neither package owns HTTP routes, persistence adapters, deployment configuration, or application authentication.

## Layout

| Path | Owns |
|---|---|
| `cqrs.ts`, `saga.ts` | Mediator, handler factory, and the orchestrated saga runner used by multi-step handlers |
| `domain/<subdomain>/` | Pure value objects and rules, including `domain/analytics` (hourly metric buckets, route normalization, in-process recorder) |
| `handlers/` | One CQRS use case per file (`create*Handler`, `*Command`/`*Query`, `register*`). Contracts the application implements for a handler live with it, e.g. `CvExtractor` in `handlers/extract-cv.ts`; shared use-case helpers are exported by the owning handler (`requireCvImport` from `get-cv-import.ts`) |
| `repos/` | Repository interfaces only, e.g. `MetricRepository` and the shared `metricStorageKey` |
| `shared/` | Feature-flag policy |
| `tests/` | Unit specs for the package; fixtures are copies of Ruxt's bundled templates and reference CV |

`ports/`, `services/`, and `analytics/` are retired; `pnpm lint` rejects them and any framework or runtime import inside the package.

## Development

```sh
pnpm install
pnpm test
pnpm lint
```

## Release policy

Applications consume pinned semver releases from the package registry rather than Git submodules or sibling-directory aliases. The initial extraction version is `0.1.0`. Publish both packages before switching Ruxt and Ruxt Admin away from their migration workspaces.

No open-source license has been granted yet. The repository is publicly readable, but reuse remains subject to the repository owner's rights until a license is added explicitly.
