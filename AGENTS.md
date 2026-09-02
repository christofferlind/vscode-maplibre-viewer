# AGENTS.md

Instructions for AI coding agents working in the vscode-maplibre-viewer repository.
Keywords: **MUST** = hard requirement, **SHOULD** = strong recommendation, **MAY** = optional.

## Project purpose

This extension is designed to run fully offline. End users **MUST** be able to install it and view local GeoJSON/geospatial files without any internet connection. Treat offline operation as a first-class requirement when making any change:

- **MUST NOT** introduce a runtime dependency on a remote service for core viewing/navigation features (loading local files, rendering basemaps, toggling overlays, bookmarks, coordinate parsing).
- **MUST** keep the built-in basemap and MapLibre GL JS assets vendored locally under `resources/` so the map renders without network access.
- **SHOULD** gate any optional network-dependent feature (geocoding, remote tile sources) behind an explicit opt-in, with graceful no-op/feedback when the network is unavailable.
- **MUST NOT** fetch scripts, styles, or data from a CDN at runtime. Bundle assets at build/install time instead.

## Hard rules

- **MUST** run `npm run test` after modifying any file under `src/` or `resources/`.
- **MUST** run `npm run lint` and `npm run compile` before declaring a task complete.
- **MUST NOT** add production dependencies without explicit user confirmation.
- **MUST NOT** use `@ts-ignore`, `any` to silence errors, or hardcode API keys/secrets.
- **MUST NOT** commit, push, amend, or create PRs unless explicitly requested by the user.
- **MUST NOT** delete files, run `npm run test:vscode`, or run packaging commands (`npm run package`, `vsce publish`) without approval.
- **MUST** write unit tests for every behavioral change, including edge cases.
- **MUST** mock external dependencies in tests so they remain fast and isolated.
- **MUST** keep business logic strictly separated from I/O handling.
- **MUST** keep files under 600 lines. Run `wc -l <file>` after edits; refactor if exceeded.
- **MUST** bump the `version` field in [`package.json`](package.json:6) for every change, following SemVer: patch for bug fixes, minor for backward-compatible additions, major for breaking changes.

## UI / configuration synchronization

When an end user mutates any persisted or in-memory configuration (settings, basemap selection, overlay visibility, bookmarks, layer properties, or any other state), you **MUST** update every UI element that depends on it so none shows stale data. Affected surfaces:

- The map webview (sidebar `MapViewProvider` and editor panel `MapEditorProvider`)
- Tree views (bookmarks, layers/basemaps)
- Status bar items
- Command/UI context keys (enable/disable states, menu visibility)
- Custom views registered via the extension API

Wire every configuration mutation through the existing controller/provider mechanisms — `MapWebviewController` message dispatch, `TreeDataProvider` refresh events, `onDidChangeActiveBasemap` and similar emitters — so dependent views re-render automatically. **MUST** add or update unit/integration tests asserting the affected UI reflects the new value after the mutation.

## Code style

- TypeScript strict mode (`strict: true` in `tsconfig.json`), target ES2022, Node16 modules.
- Formatting enforced by ESLint + typescript-eslint; `curly` required, `===` strict equality, semicolons required.
- Naming: `camelCase` for variables/functions/imports (warn), `PascalCase` for types/classes.
- Use guard clauses: return early on invalid preconditions; no nested conditionals for validation.
- **MUST NOT** write a statement on the same line as `if`/`else`.

```typescript
// Forbidden
if (!map) return;

// Required
if (!map) {
    return;
}
```

- **MUST NOT** add comments unless the *why* is non-obvious and the user has not forbidden them.
- **MUST** use clear, descriptive names for variables, functions, and classes.

## Code review checklist (run after every file change)

1. Verify the file satisfies every rule in the "Code style" and "Hard rules" sections.
2. Confirm no statements share a line with `if`/`else`; guard clauses are multi-line.
3. Run `npm run lint` — zero ESLint errors.
4. Run `wc -l <file>` — refactor if > 600 lines.
5. Run `npm run clean:test` — all tests pass.

## Commands

### File-scoped (preferred for fast feedback)

```bash
npm run compile    # Compile TypeScript once
npm run lint       # ESLint on src/
npm run test       # Unit tests (requires compile first)
npm run test:vscode # Unit tests in vscode (approval required for full suite)
wc -l <file>       # Line count check
```

### Watch

```bash
npm run watch      # TypeScript watch mode
```

### Full suite (only when explicitly requested)

```bash
npm run vscode:prepublish   # Full build + asset copy (for publishing)
npm run test:vscode         # Full suite incl. VS Code integration tests (approval required)
npm run package             # Package extension as .vsix (approval required)
```

## Environment

- Node.js 18+ (LTS recommended)
- VS Code 1.110.0+ (extension engine requirement)
- Install: `npm install`
- Develop: F5 in VS Code to launch Extension Development Host

## Architecture

- **Entry point**: [`src/extension.ts`](src/extension.ts) — activation, command registration, API export.
- **Webview pattern**: [`MapWebviewController`](src/map/mapWebviewController.ts) base class, extended by `MapViewProvider` (sidebar) and `MapEditorProvider` (editor panel).
- **Tree providers**: implement `vscode.TreeDataProvider<T>` for bookmarks and layers.
- **Services**: stateless utility modules in `src/services/` (coordinate parsing, geocoding, API).
- **Adapters**: `FileToGeoJsonAdapter` interface for pluggable file format support.

### Key files

- [`src/services/api.ts`](src/services/api.ts:58) — public API interface for external extensions.
- [`src/services/coordinateParser.ts`](src/services/coordinateParser.ts:106) — core coordinate parsing logic.
- [`src/layers/layerTreeProvider.ts`](src/layers/layerTreeProvider.ts:12) — layer and basemap management.

## Project structure

```
src/
├── extension.ts              # Entry point, command registration, API export
├── extensionUtils.ts         # Shared UI utilities (confirmations, state)
├── adapters/
│   └── geojsonAdapter.ts     # Built-in GeoJSON file adapter
├── bookmarks/
│   ├── bookmarkManager.ts    # Bookmark CRUD with globalState persistence
│   ├── bookmarkTreeProvider.ts # Tree view for bookmarks
│   └── bookmarkTypes.ts      # Type definitions
├── layers/
│   ├── layerTreeProvider.ts  # Tree view for basemaps/overlays
│   └── layerTypes.ts         # BaseMapStyle, OverlayLayer types
├── map/
│   ├── mapViewProvider.ts    # Sidebar webview (WebviewViewProvider)
│   ├── mapEditorProvider.ts  # Editor panel webview
│   └── mapWebviewController.ts # Shared webview logic base class
├── services/
│   ├── api.ts                # Public API (MapLibreViewerAPI interface)
│   ├── coordinateParser.ts   # Regex-based coordinate extraction
│   └── geocodingSearch.ts    # Photon/MapTiler geocoding
└── test/
    ├── unit/                 # Fast unit tests (coordinate parsing, API protocol)
    ├── integration/          # VS Code integration tests
    └── testUtils/            # MockWebview, TestableMapWebviewController, factories
resources/
├── map-view.html             # Webview HTML template
├── scripts/
│   ├── main.js               # Message handler (extension ↔ webview)
│   ├── test-api.js           # window.__test API for UI verification in tests
│   └── ...                   # map-core.js, map-overlays.js, etc.
└── maplibre-gl/              # MapLibre GL JS assets
```

## Testing

- Framework: Mocha with TDD UI (`suite`/`test` pattern).
- Unit tests live in `src/test/unit/*.test.ts`; run with `npm run test`.
- Integration tests live in `src/test/integration/*.test.ts`; run with `npm run test:vscode` (approval required).
- Test config: `.vscode-test.mjs` defines test file patterns.
- Test utilities in `src/test/testUtils/`: `MockWebview`, `TestableMapWebviewController`, factories.
- Import paths in tests: relative `../../services/...`.

### Test structure

```typescript
suite('Test Suite Name', () => {
    test('should do something', () => {
        assert.strictEqual(actual, expected);
    });
});
```

### __testQuery protocol (webview UI verification)

The extension exposes `window.__test` in the webview (`resources/scripts/test-api.js`) so tests can inspect internal map renderer state without `console.log` in production code. Tests query it via `__testQuery`/`__testResponse` messages.

**Webview-side methods** (callable from tests):

- `getOverlayLayers()` — tracked overlay layer objects
- `getMapSources()` — all MapLibre sources currently on the map
- `getLayerVisibility(layerId)` — visibility per sub-layer (`{ circles, lines, fills }`)
- `getOverlaySource(layerId)` — source info with `exists` flag
- `isOverlayLayerOnMap(layerId)` — full map-renderer state check
- `getAllOverlayState()` — comprehensive dump of all overlay state
- `isAvailable()` — sanity check that the API loaded

**Extension-side** (integration tests):

- `MapWebviewController.queryWebview(method, args?, timeoutMs?)` — returns a Promise resolving to the webview-side method result. Works with real webviews in `npm run test:vscode`.

**Unit test support** (`MockWebview`):

- `mockWebview.onTestQuery(method, handler)` — registers a handler that auto-responds to `__testQuery` messages for the given method, enabling full round-trip unit tests without a real webview.

```typescript
// Unit test example: verify overlay toggle
mockWebview.onTestQuery('getLayerVisibility', (args) => {
    const layerId = args[0] as string;
    return { circles: visibility[layerId], lines: visibility[layerId], fills: visibility[layerId] };
});

await controller.updateOverlayLayers([{ id: 'test', visible: true, ... }]);
const state = await controller.queryWebview('getLayerVisibility', ['test']);
assert.strictEqual((state as any).circles, 'visible');

await layerTreeProvider.toggleLayerVisibility('test');
const after = await controller.queryWebview('getLayerVisibility', ['test']);
assert.strictEqual((after as any).circles, 'none');
```

## Extension API

The extension exports `MapLibreViewerAPI` enabling other extensions to:

- Register custom basemaps via `registerBasemap(provider)`
- Register file adapters via `registerFileToGeoJsonAdapter(adapter)`
- Listen to basemap changes via `onDidChangeActiveBasemap`

Access:

```typescript
const ext = vscode.extensions.getExtension<MapLibreViewerAPI>('christofferlind.vscode-maplibre-viewer');
const api = ext?.exports;
```