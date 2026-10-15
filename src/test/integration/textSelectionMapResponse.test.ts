import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { activateViewGroup } from '../testUtils/integrationSetup';
import { getMapViewerTestAccess } from '../../extension';
import { MapWebviewController } from '../../map/mapWebviewController';
import { resetFileSelectionState } from '../../selectionHandler';

/**
 * End-to-end integration test running against the real, visible sidebar map
 * webview (not a mock): the test opens a text editor, writes a coordinate,
 * selects the text, and verifies that the visible map responds to the
 * selection and that the rendered point uses the overlay layer's color.
 *
 * The text-selection flow exercises the real extension wiring:
 *   editor selection -> onDidChangeTextEditorSelection (300ms debounce) ->
 *   handleTextSelection -> ProviderManager -> real mapsView webview.
 *
 * Tests share the suite's editor and map state (see the ordering comment on
 * test 3): the WKT document from test 2 stays open and is re-selected after
 * the layer style is configured in test 3.
 */

suite('Text Selection Map Response Integration Tests', () => {
    const POLL_TIMEOUT = 25000;
    const POLL_INTERVAL = 250;
    const FLY_SETTLE_MS = 600;

    // Stockholm coordinate used for both the decimal selection and the WKT
    // point (WKT is lng/lat order).
    const DECIMAL_TEXT = '59.3293, 18.0686';
    const WKT_TEXT = 'POINT (18.0686 59.3293)';
    const EXPECTED_LAT = 59.3293;
    const EXPECTED_LNG = 18.0686;

    interface MapViewState {
        center: { latitude: number; longitude: number };
        zoom: number;
    }

    interface OverlayPaint {
        circles?: Record<string, unknown>;
        lines?: Record<string, unknown>;
        fills?: Record<string, unknown>;
        error?: string;
    }

    let editor: vscode.TextEditor | undefined;
    let decimalFilePath: string | undefined;
    let wktFilePath: string | undefined;

    function sleep(ms: number): Promise<void> {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }

    async function poll<T>(
        description: string,
        action: () => Promise<T | undefined>,
        check: (value: T) => boolean,
        timeoutMs: number = POLL_TIMEOUT
    ): Promise<T> {
        const deadline = Date.now() + timeoutMs;
        let lastValue: T | undefined;
        while (Date.now() < deadline) {
            lastValue = await action();
            if (lastValue !== undefined && check(lastValue)) {
                await sleep(FLY_SETTLE_MS);
                lastValue = await action();
                if (lastValue !== undefined && check(lastValue)) {
                    return lastValue;
                }
            }
            await sleep(POLL_INTERVAL);
        }
        assert.fail(`Timed out waiting for: ${description} (last value: ${JSON.stringify(lastValue)})`);
    }

    function mapsViewWebview(): MapWebviewController {
        const access = getMapViewerTestAccess();
        assert.ok(access, 'test access to live map providers must be available');
        const webview = access.mapWebviews[0];
        assert.ok(webview, 'the sidebar mapsView controller must exist');
        return webview;
    }

    async function queryViewState(): Promise<MapViewState | undefined> {
        return await mapsViewWebview().queryWebview('getViewState') as MapViewState | undefined;
    }

    async function queryPointPaint(): Promise<OverlayPaint | undefined> {
        return await mapsViewWebview().queryWebview('getLayerPaint', ['selected-file']) as OverlayPaint | undefined;
    }

    async function queryPointFeatureCount(): Promise<{ exists: boolean; count?: number; error?: string } | undefined> {
        return await mapsViewWebview().queryWebview('getOverlayFeatureCount', ['selected-file']) as
            { exists: boolean; count?: number; error?: string } | undefined;
    }

    /**
     * Writes `text` into a temp file (real file, so closing the editor never
     * triggers an untitled-save prompt), opens it in the visible editor, and
     * selects the whole line.
     */
    async function openEditorWithSelectedText(text: string, fileName: string, trackedPath?: (p: string) => void): Promise<vscode.TextEditor> {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplibre-selection-test-'));
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, text, 'utf-8');
        trackedPath?.(filePath);

        const document = await vscode.workspace.openTextDocument(filePath);
        const openedEditor = await vscode.window.showTextDocument(document);
        const lineEnd = document.lineAt(0).range.end.character;
        openedEditor.selection = new vscode.Selection(0, 0, 0, lineEnd);
        return openedEditor;
    }

    suiteSetup(async function() {
        this.timeout(60000);
        await activateViewGroup(3000);
    });

    teardown(async function() {
        this.timeout(10000);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        editor = undefined;
    });

    test('should fly the visible map to a coordinate selected in the text editor', async function() {
        this.timeout(60000);

        const before = await poll(
            'initial map view state',
            queryViewState,
            (state) => Math.abs(state.center.latitude - EXPECTED_LAT) > 0.05
                || Math.abs(state.center.longitude - EXPECTED_LNG) > 0.05
        );

        editor = await openEditorWithSelectedText(DECIMAL_TEXT, 'coordinate.txt', file => {
            decimalFilePath = file;
        });
        assert.strictEqual(editor.selection.isEmpty, false, 'the coordinate text must be selected');

        const after = await poll(
            'map to respond to the selected coordinate',
            queryViewState,
            (state) => Math.abs(state.center.latitude - EXPECTED_LAT) < 0.02
                && Math.abs(state.center.longitude - EXPECTED_LNG) < 0.02
        );

        assert.ok(
            Math.abs(after.zoom - 10) <= 0.6,
            `map should fly to the single-point zoom (10), got ${after.zoom}`
        );
        assert.ok(
            Math.abs(before.center.latitude - after.center.latitude) > 0.05
                || Math.abs(before.center.longitude - after.center.longitude) > 0.05,
            'the map center must move in response to the text selection'
        );
    });

    test('should render a WKT point selected in the text editor with the default layer color', async function() {
        this.timeout(60000);

        editor = await openEditorWithSelectedText(WKT_TEXT, 'point.wkt', file => {
            wktFilePath = file;
        });
        assert.strictEqual(editor.selection.isEmpty, false, 'the WKT text must be selected');

        const featureCount = await poll(
            'the WKT point to be rendered on the map',
            queryPointFeatureCount,
            (result) => result.exists && (result.count ?? 0) >= 1
        );
        assert.strictEqual(featureCount.count, 1, 'exactly one point should be in the selected file layer');

        const paint = await poll(
            'the rendered point paint',
            queryPointPaint,
            (result) => !result.error && result.circles?.['circle-color'] === '#FF0000'
        );
        assert.ok(paint.circles, 'paint must include circle properties');
        assert.strictEqual(paint.circles['circle-radius'], 6, 'default circle radius should be 6 px');
        assert.strictEqual(paint.circles['circle-opacity'], 1, 'default circle opacity should be 1');
    });

    test('should render the selection point in the configured layer color', async function() {
        this.timeout(60000);

        const access = getMapViewerTestAccess();
        assert.ok(access, 'test access must be available for layer style updates');
        assert.ok(wktFilePath, 'the WKT file path from the previous test must be known');

        await access.layerTreeProvider.updateLayerStyle('selected-file', {
            color: '#00FF00',
            circleRadius: 8
        });

        const paint = await poll(
            'the layer paint to pick up the configured color',
            queryPointPaint,
            (result) => result.circles?.['circle-color'] === '#00FF00'
                && result.circles['circle-radius'] === 8
        );
        assert.ok(paint.circles, 'paint must include circle properties after the style update');
        assert.strictEqual(paint.circles['circle-radius'], 8,
            'the configured circle radius must be applied to the visible map');

        // The style update rebuilds the overlay layers from the tree provider
        // state, which does not carry the selection-broadcast GeoJSON data, so
        // re-apply the selection to prove the point then renders in green.
        const document = await vscode.workspace.openTextDocument(wktFilePath);
        const activeEditor = await vscode.window.showTextDocument(document);
        resetFileSelectionState();
        const fullRange = document.lineAt(0).range;
        activeEditor.selection = new vscode.Selection(fullRange.end, fullRange.end);
        await sleep(400);
        activeEditor.selection = new vscode.Selection(0, 0, 0, fullRange.end.character);

        const featureCount = await poll(
            'the re-selected WKT point to be rendered again',
            queryPointFeatureCount,
            (result) => result.exists && (result.count ?? 0) >= 1
        );
        assert.strictEqual(featureCount.count, 1, 'exactly one point should be rendered after the style update');

        const greenPaint = await poll(
            'the point to render with the configured color',
            queryPointPaint,
            (result) => result.circles?.['circle-color'] === '#00FF00'
                && (result.circles['circle-radius'] === 8)
        );
        assert.ok(greenPaint.circles, 'paint must include circle properties');
        assert.strictEqual(greenPaint.circles['circle-radius'], 8,
            'the configured style must persist across selection-driven source updates');
    });
});