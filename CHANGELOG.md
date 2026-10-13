# Changelog

All notable changes to this project will be documented in this file.

## [0.9.5] - 2026-10-13

### Added

- A scale bar is now shown at the bottom left of the map.
- The scale bar can be switched between metric, imperial and nautical units via the new `scaleUnits` setting (metric remains the default), or hidden entirely by setting it to `off`.
- A globe button on the map toggles between the flat map view and a 3D globe; your choice is remembered across sessions.

## [0.9.4] - 2026-10-13

### Added

- Optional 3D terrain rendering. Enable it in settings; it is off by default because terrain tiles require network access.
- The terrain data source is configurable, supporting both TileJSON URLs and raster-dem tile URL templates.
- New globe and terrain controls on the map when terrain is enabled.

### Changed

- The built-in basemap is now the OpenFreeMap.org Liberty style, replacing the MapLibre demo tiles.
- Upgraded the bundled MapLibre GL JS map engine to v6.

### Fixed

- Overlay layers you have added are now kept on the map when you switch basemaps, instead of disappearing.
- The map no longer stalls when loading operations while a new basemap style is being applied.
- Switching to a basemap whose style fails to load no longer silently does nothing when you pick it again.
- Map panel loading is more reliable, with better error details surfaced in the output panel.

## [0.7.0] - 2026-09-11

### Added

- New "Map Information" view that shows details about the features you click on the map, including their properties.
- New clipboard overlay layer that automatically renders coordinates and geometry copied to the clipboard as text, which can be toggled on and off from the layers view.
- WKT content containing multiple geometries on separate lines is now all rendered on the map, instead of only the first geometry.

## [0.6.3] - 2026-09-11

### Added

- Well-known text (WKT) geometry selections are now rendered on the map, so picking WKT content shows the actual shapes instead of only coordinates.
- Point search results now place a temporary marker on the map, making it easier to see exactly where a result is.
- Coordinate lists that wrap items in extra parentheses are now handled, so more pasted coordinate formats are recognized.

## [0.6.2] - 2026-09-08

### Added

- New "Copy Coordinates" command available from the right-click menu on the map, letting you copy the coordinates of any clicked point.
- Bookmarks now emit a change notification, so all open map panels and the bookmarks list update immediately when a bookmark is created, edited, or deleted.

### Fixed

- Map panels and sidebar views no longer show outdated bookmark information after updates.
- Improved error reporting when a map fails to load.
- Hardened GPX, KML, and CSV file parsing against malformed content, preventing crashes on broken or unusual files.
- Improved robustness of map search, overlays, and base map switching in edge cases.

## [0.6.1] - 2026-09-08

### Fixed

- Bookmarks are no longer accidentally deleted when saving with incomplete data, and invalid entries are cleaned up more safely.
- Updating a bookmark no longer wipes existing details, and invalid updates now show a clear error message.
- Creating a bookmark from the picker now captures where the map currently is, not where it was when the picker opened.
- Flying to a bookmark in a newly opened map panel now waits for the map to finish loading instead of using a fixed delay.
- Search results are less likely to be stale or duplicated when typing quickly.
- Improved overall stability of the map when switching between tabs and handling messages.

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

