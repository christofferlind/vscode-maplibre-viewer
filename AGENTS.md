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
- Every new feature or fix must be accompanied by comprehensive unit tests that cover core functionality and edge cases.
- In tests, use mocking for external service dependencies to ensure tests are fast, reliable, and isolated.

## Commands

### File-scoped (preferred - fast feedback)

```bash
npm run compile                    # Compile TypeScript once
npm run lint                        # Run ESLint on src/
npm run test                        # Run unit tests (requires compile first)
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

### Architecture Patterns

- **Extension entry**: [`src/extension.ts`](src/extension.ts) - Main activation, command registration
- **Webview pattern**: [`MapWebviewController`](src/map/mapWebviewController.ts) base class, extended by `MapViewProvider` (sidebar) and `MapEditorProvider` (editor panel)
- **Tree providers**: Implement `vscode.TreeDataProvider<T>` for bookmarks and layers views
- **Services**: Stateless utility modules in `src/services/` (coordinate parsing, geocoding, API)
- **Adapters**: `FileToGeoJsonAdapter` interface for pluggable file format support

## Testing

- Framework: Mocha with TDD UI (`suite`/`test` pattern)
- Unit tests: `src/test/unit/*.test.ts` - Run with `npm run test`
- Integration tests: `src/test/integration/*.test.ts` - Run with `npm run test:vscode`
- Test config: `.vscode-test.mjs` defines test file patterns
- Pattern: Import from `../../services/` relative paths

### Test Structure

```typescript
suite('Test Suite Name', () => {
    test('should do something', () => {
        assert.strictEqual(actual, expected);
    });
});
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
    ├── unit/                 # Fast unit tests (coordinate parsing)
    └── integration/          # VS Code integration tests
resources/
├── map-view.html             # Webview HTML template
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

## PR Requirements

- Title format: `[component] Brief description` (e.g., `[bookmarks] Add search functionality`)
- Run `npm run compile && npm run lint` before committing
- Keep diffs small and focused on single feature/fix
- Tests required for new features (coordinate parsing, adapters)
- All existing tests must pass

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