/**
 * Test utilities for vscode-maplibre-viewer tests
 */

export { MockWebview } from './mockWebview';
export { 
    createTestBookmark, 
    createStockholmBookmark, 
    createGothenburgBookmark,
    createBookmarkWithRotation,
    createExtremeCoordinatesBookmark,
    createFullBookmark
} from './testBookmarkFactory';
// Note: TestableMapWebviewController is not exported here because it requires vscode module
// Use it directly from './testableController' in integration tests that run in VS Code context