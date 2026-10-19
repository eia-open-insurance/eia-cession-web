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
The workbench shows the `DIRECT book` header, lists cession cases, creates cessions, and drives the
SPEC 11.9.3 status lifecycle.

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
