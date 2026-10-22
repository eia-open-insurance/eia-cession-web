# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- React 19 / Webpack 5 Module Federation remote exposing `./App` on port 3006.
- Async bootstrap and shared React runtime; `@swc/core` pinned to 1.10.7.
- DIRECT-book cession workbench with create, list, and lifecycle actions.
- `/api` proxy to the domain service and Playwright test with a mocked API.
- FS-RI hand-off reference, status, timestamp, and last-error fields on the record.
- Event-derived **Activity** tab: selecting a cession fetches
  `GET /api/v1/events/aggregate/{cessionId}?limit=50` with the tenant header and
  renders a newest-first timeline of timestamp, readable event type, event
  status, version, and the payload facts a cession user needs — the case status
  transition, FS-RI hand-off reference/status/contract, ceded premium and loss,
  and the rejection or FS-RI error. The card carries its own loading, error,
  empty, and refresh states plus an event-derived/append-only/source-of-truth
  note, so a slow or unavailable event service never blocks the record.
- Playwright coverage for the aggregate path and tenant header, newest-first
  ordering and rendering, the empty state, a contained 503, the cession payload
  facts, refetching on selection, and the card refresh.
- Related notifications on the cession **Overview**: selecting a cession fetches
  `GET /api/v1/notifications?sourceType=CESSION&sourceId={cessionId}` with the
  tenant header and renders the total count, the newest three messages with
  notification link/number, subject, delivery status, and created-at, and a
  **View all** hand-off to the Notifications queue filtered to the cession. The
  card carries its own loading, empty, and error states, so a slow or unavailable
  Notifications service never blocks the cession record.
- Playwright coverage for the related-notification count and newest-three
  preview, source-filter query and tenant header, `{items}` envelope and single
  row, the empty state, a contained 503, an in-flight Notifications response,
  refetching on selection, and both the record and filtered-queue links.

### Changed

- Adopted the shared EIA operational record design: page head, DIRECT queue, record
  panel, summary grid, and the Overview / FS-RI Hand-off / Status History /
  Activity tabs, plus a Create cession modal.
- Copied the canonical `ui.css` and added `style-loader` / `css-loader` while
  keeping `@swc/core` pinned to 1.10.7.
- Extended Playwright coverage for the record shell, modal create, lifecycle, and
  FS-RI hand-off requests carrying the DIRECT book header.
