# AGENTS.md

Development guide for AI agents working on the vscode-maplibre-viewer project.

## Environment Setup

- Node.js 18+ (LTS recommended)
- VS Code 1.110.0+ (extension engine requirement)
- Install dependencies: `npm install`
- Development: Press F5 in VS Code to launch Extension Development Host

## Working agreements

- Always run `npm run test` after modifying files
- Ask for confirmation before adding new production dependencies.
- Code must be organized into logical, small, and reusable functions/modules. Business logic should be strictly separated from input/output handling.
- Use clear, descriptive names for variables, functions, and classes. Add meaningful comments where the *why* of the code is not immediately obvious.
- Cover all changes with unit tests, including edge cases.
- Mock external dependencies to keep tests fast and isolated.
- Guard clauses: Return early on invalid preconditions. No nested conditionals for validation.

## Code Review Checklist

After making changes to any file, always:

1. Verify the entier file follows all code style rules in this document
2. Check for common violations:
   - No statements on same line as `if`/`else` conditions
   - Guard clauses use multi-line format
   - Proper brace usage for all blocks
3. Run `npm run lint` to verify no ESLint errors
4. Check file line count with `wc -l <filename>` (refactor if >600 lines)
5. Run `npm run test` to ensure tests pass

## Commands

### File-scoped (preferred - fast feedback)

```bash
npm run compile                    # Compile TypeScript once
npm run lint                        # Run ESLint on src/
npm run test                        # Run unit tests (requires compile first)
npm run test:vscode                 # Run unit tests in vscode
wc -l <filename>                    # Check line count for a specific file 
```

### Full suite (only when explicitly requested)

```bash
npm run vscode:prepublish           # Full build + asset copy (for publishing)
npm run test:vscode                 # Full test suite including VS Code integration tests
npm run package                     # Package extension as .vsix file
```

### Watch mode

```bash
npm run watch                       # Watch TypeScript for changes
```

## Code Style

- TypeScript: Strict mode enabled (`strict: true` in tsconfig.json)
- Target: ES2022 with Node16 modules
- Formatting: ESLint with typescript-eslint
- Naming: camelCase for imports (warn), PascalCase for types
- Rules: curly braces required, `===` strict equality, semicolons required
- Never use `@ts-ignore` or hardcode API keys
- Check files after changes `wc -l`. Refactor any over 600 lines.

### Architecture Patterns

- **Extension entry**: [`src/extension.ts`](src/extension.ts) - Main activation, command registration
- **Webview pattern**: [`MapWebviewController`](src/map/mapWebviewController.ts) base class, extended by `MapViewProvider` (sidebar) and `MapEditorProvider` (editor panel)
- **Tree providers**: Implement `vscode.TreeDataProvider<T>` for bookmarks and layers views
- **Services**: Stateless utility modules in `src/services/` (coordinate parsing, geocoding, API)
- **Adapters**: `FileToGeoJsonAdapter` interface for pluggable file format support

### Style Patterns

Don't write return statements on the same line as conditions (see bellow)

```typescript
// Don't write like this!
if (!map) return;

// Write like this!
if (!map){
    return;
} 
```

## Testing

- Framework: Mocha with TDD UI (`suite`/`test` pattern)
- Unit tests: `src/test/unit/*.test.ts` - Run with `npm run test`
- Integration tests: `src/test/integration/*.test.ts` - Run with `npm run test:vscode`
- Test config: `.vscode-test.mjs` defines test file patterns
- Test utilities: `src/test/testUtils/` - MockWebview, TestableMapWebviewController, test bookmark factories
- Pattern: Import from `../../services/` relative paths

### Test Structure

```typescript
suite('Test Suite Name', () => {
    test('should do something', () => {
        assert.strictEqual(actual, expected);
    });
});
```

### __testQuery Protocol (Webview UI Verification)

The extension exposes a `window.__test` API in the webview (`resources/scripts/test-api.js`) for integration tests to inspect internal map renderer state without adding `console.log` to production code. Tests query it via `__testQuery`/`__testResponse` messages.

**Webview-side methods** (callable from tests):

- `getOverlayLayers()` - Tracked overlay layer objects
- `getMapSources()` - All MapLibre sources currently on the map
- `getLayerVisibility(layerId)` - Visibility per sub-layer (`{ circles, lines, fills }`)
- `getOverlaySource(layerId)` - Source info with `exists` flag
- `isOverlayLayerOnMap(layerId)` - Full map-renderer state check
- `getAllOverlayState()` - Comprehensive dump of all overlay state
- `isAvailable()` - Sanity check that the API loaded

**Extension-side** (for integration tests):

- `MapWebviewController.queryWebview(method, args?, timeoutMs?)` - Returns a Promise resolving to the webview-side method result. Zero config, works with real webviews in `npm run test:vscode`.

**Unit test support** (`MockWebview`):

- `mockWebview.onTestQuery(method, handler)` - Registers a handler that auto-responds to `__testQuery` messages for the given method. This enables unit testing the full round-trip without a real webview.

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

## Project Structure

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

### Key Files

- [`src/services/api.ts`](src/services/api.ts:58) - Public API interface for external extensions
- [`src/services/coordinateParser.ts`](src/services/coordinateParser.ts:106) - Core coordinate parsing logic
- [`src/layers/layerTreeProvider.ts`](src/layers/layerTreeProvider.ts:12) - Layer and basemap management

## Permissions

### Allowed without prompting

- Read files, list directories
- Single file linting (`npm run lint`)
- TypeScript compilation (`npm run compile`)
- Unit tests on specific files

### Require approval first

- Package installations (`npm install`, `npm add`)
- Git operations (`git push`, `git commit`)
- File deletion
- Running full VS Code integration tests (`npm run test:vscode`)
- Publishing operations (`npm run package`, `vsce publish`)

## Extension API

The extension exports `MapLibreViewerAPI` allowing other extensions to:

- Register custom basemaps via `registerBasemap(provider)`
- Register file adapters via `registerFileToGeoJsonAdapter(adapter)`
- Listen to basemap changes via `onDidChangeActiveBasemap`

Access via:

```typescript
const ext = vscode.extensions.getExtension<MapLibreViewerAPI>('christofferlind.vscode-maplibre-viewer');
const api = ext?.exports;
```
