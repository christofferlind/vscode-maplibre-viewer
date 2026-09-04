# Changelog

All notable changes to this project will be documented in this file.

## [0.6.0] - 2026-09-04

### Added

- Base map type icons with an active state indicator in the layers view.
- Output channel logging so map errors surface in VS Code's Output panel.
- Country shown alongside other details in search result entries.
- Configurable fly-to animation duration, now respected when navigating to results.

### Changed

- Coordinate lookup now uses the result index, making searches more reliable when multiple matches share names.
- Hardened base map, CSV, and KML parsers to avoid crashes on malformed files.
- Geocoding responses are now guarded against stale results, and re-parsing is skipped when re-activating a tab.

### Fixed

- Reduced redundant geocoding results and improved stability when switching between search results.

