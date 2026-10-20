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

### Changed

- Adopted the shared EIA operational record design: page head, DIRECT queue, record
  panel, summary grid, Overview / FS-RI Hand-off / Status History tabs, and a
  Create cession modal.
- Copied the canonical `ui.css` and added `style-loader` / `css-loader` while
  keeping `@swc/core` pinned to 1.10.7.
- Extended Playwright coverage for the record shell, modal create, lifecycle, and
  FS-RI hand-off requests carrying the DIRECT book header.
