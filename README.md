# eia-cession-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-cession-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Cession
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Cession federated remote: screens, widgets, record tabs, and transaction composition. Direct-book ceded reinsurance contracts, cession rules, FS-RI hand-off, and recoverables.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Implemented slice

React 19 and Webpack 5 Module Federation remote. The container is `eia_cession`, exposes `./App`,
runs on port `3006`, and proxies `/api` to the domain service at `http://localhost:8092`. The
application uses an async bootstrap (`index.jsx` loads `bootstrap.jsx`) so React is shared correctly.
The workbench follows the shared EIA operational record design: a `Cession` page head with the
`DIRECT book` badge, a cession queue beside the record panel, ceded premium/loss and FS-RI summary
cards, and Overview, FS-RI Hand-off, Status History, and Activity tabs. Cessions are created in a
modal; the lifecycle and the FS-RI hand-off (including its reference, status, timestamp, and last
error) remain wired to the domain API. The Activity tab reads the append-only event stream from
`GET /api/v1/events/aggregate/{cessionId}?limit=50` and renders the case status, version, FS-RI
hand-off, and ceded-amount facts as an event-derived timeline. The Overview also shows related
notifications from `GET /api/v1/notifications?sourceType=CESSION&sourceId={cessionId}` — the total
count, the newest three deliveries, a link to each notification record, and a View all hand-off to
the Notifications queue filtered to the cession. The canonical `ui.css` is loaded through
`style-loader` and `css-loader`.

## Local run

```powershell
npm install
npm start        # http://localhost:3006
npm run build
npm test         # Playwright, API mocked
```

`@swc/core` is pinned to exactly `1.10.7` because later releases fail SWC cache validation on the
reference Windows machine.

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
