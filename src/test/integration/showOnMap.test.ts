import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { activateViewGroup } from '../testUtils/integrationSetup';
import { getMapViewerTestAccess } from '../../extension';
import { extractCoordinatesFromGeoJson } from '../../services/coordinateParser';
import { OverlayLayer } from '../../layers/layerTypes';

/**
 * Integration test for the "Show on Map" command
 * (vscodeMaplibreViewer.showOverlayLayersOnMap) running against the real,
 * visible sidebar map webview:
 *
 *   1. Check the current viewport position.
 *   2. Select a layer that carries GeoJSON data.
 *   3. Execute the "Show on Map" command (as the layer-tree context menu does).
 *   4. Verify the viewport moved to the layer's bounding box.
 *
 * Two data paths are covered:
 *   - The "Selected file" layer filled by opening the real GPX fixture
 *     through the extension's file-activation flow.
 *   - A custom overlay layer added through the live layer tree provider.
 */

suite('Show on Map Integration Tests', () => {
    const POLL_TIMEOUT = 25000;
    const POLL_INTERVAL = 250;
    const FLY_SETTLE_MS = 600;

    const GPX_FIXTURE_PATH = path.join(__dirname, '..', '..', '..', 'resources', 'test', '2015-02-12_05-02_Thu_2.gpx');

    // Minimum number of coordinate vertices in the GPX fixture track
    // (~1511 <trkpt> records).
    const GPX_MIN_TRACK_COORDINATES = 1000;

    // The "Selected file" auto-fit already centers on the track after the GPX
    // is processed, so the fly-away target must be far from it.
    const FAR_LAT = 0;
    const FAR_LNG = 0;
    const FAR_ZOOM = 2;

    // Bounding box of the GPX fixture track (Rajasthan area, India).
    const TRACK_CENTER = {
        latitude: 26.742,
        longitude: 76.061
    };
    const TRACK_CENTER_TOLERANCE = 0.06;

    interface MapViewState {
        center: { latitude: number; longitude: number };
        zoom: number;
    }

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

    function mapsViewWebview(): NonNullable<ReturnType<typeof getMapViewerTestAccess>>['mapWebviews'][number] {
        const access = getMapViewerTestAccess();
        assert.ok(access, 'test access to live map providers must be available');
        const webview = access.mapWebviews[0];
        assert.ok(webview, 'the sidebar mapsView controller must exist');
        return webview;
    }

    async function queryViewState(): Promise<MapViewState | undefined> {
        return await mapsViewWebview().queryWebview('getViewState') as MapViewState | undefined;
    }

    async function flyMapAwayFromTrack(): Promise<void> {
        const mapsView = mapsViewWebview();
        mapsView.flyToLocation(FAR_LAT, FAR_LNG, FAR_ZOOM);
        await poll(
            'the map to move away from the track',
            queryViewState,
            (state) => Math.abs(state.center.latitude - FAR_LAT) < 0.05
                && Math.abs(state.center.longitude - FAR_LNG) < 0.05
        );
    }

    suiteSetup(async function() {
        this.timeout(60000);
        await activateViewGroup(3000);
    });

    teardown(async function() {
        this.timeout(10000);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('should move the viewport to the data layer bounds on Show on Map (GPX selected file layer)', async function() {
        this.timeout(90000);

        const access = getMapViewerTestAccess();
        assert.ok(access, 'test access must be available');

        // Load the real GPX fixture through the extension's file-activation
        // flow so the "Selected file" layer carries actual track data. The
        // track renders as a single LineString feature with ~3000 vertices,
        // so verify on the provider layer's GeoJSON data.
        const gpxDocument = await vscode.workspace.openTextDocument(GPX_FIXTURE_PATH);
        await vscode.window.showTextDocument(gpxDocument);

        await poll(
            'the GPX track to be loaded into the selected file layer',
            async () => {
                return extractCoordinatesFromGeoJson(
                    access.layerTreeProvider.getSelectedFileLayer()?.source.data
                ).length;
            },
            (coordinateCount) => coordinateCount >= GPX_MIN_TRACK_COORDINATES
        );

        await flyMapAwayFromTrack();

        const selectedFileLayer = access.layerTreeProvider.getSelectedFileLayer();
        assert.ok(selectedFileLayer, 'the selected file layer must exist');
        assert.strictEqual(selectedFileLayer.visible, true, 'the selected file layer must be visible');
        assert.ok(selectedFileLayer.source.data, 'the selected file layer must carry data');

        const before = await queryViewState();
        assert.ok(before, 'viewport state before the command must be available');

        // Execute the command exactly as the layer-tree context menu does:
        // with the live layer object as its argument.
        await vscode.commands.executeCommand(
            'vscodeMaplibreViewer.showOverlayLayersOnMap',
            selectedFileLayer
        );

        const after = await poll(
            'the viewport to move to the GPX track bounding box',
            queryViewState,
            (state) => Math.abs(state.center.latitude - TRACK_CENTER.latitude) < TRACK_CENTER_TOLERANCE
                && Math.abs(state.center.longitude - TRACK_CENTER.longitude) < TRACK_CENTER_TOLERANCE
        );

        assert.ok(
            Math.abs(before.center.latitude - after.center.latitude) > TRACK_CENTER_TOLERANCE / 2
                || Math.abs(before.center.longitude - after.center.longitude) > TRACK_CENTER_TOLERANCE / 2,
            'the viewport must move in response to Show on Map'
        );
        assert.ok(after.zoom > FAR_ZOOM, `the map should zoom in on the track, got zoom ${after.zoom}`);
    });

    test('should move the viewport to a custom data layer bounds on Show on Map', async function() {
        this.timeout(90000);

        const access = getMapViewerTestAccess();
        assert.ok(access, 'test access must be available');

        // A layer with data far away from the current viewport (Tokyo area).
        const tokyoLayer: OverlayLayer = {
            id: 'show-on-map-custom-layer',
            name: 'Custom data layer',
            type: 'geojson',
            visible: true,
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection' as const,
                    features: [
                        {
                            type: 'Feature' as const,
                            geometry: { type: 'Point' as const, coordinates: [139.7454, 35.6586] },
                            properties: { name: 'Tokyo Tower' }
                        },
                        {
                            type: 'Feature' as const,
                            geometry: { type: 'Point' as const, coordinates: [139.8106, 35.7101] },
                            properties: { name: 'Ueno' }
                        }
                    ]
                }
            }
        };
        await access.layerTreeProvider.addOverlayLayer({ ...tokyoLayer });

        const before = await queryViewState();
        assert.ok(before, 'viewport state before the command must be available');

        await vscode.commands.executeCommand(
            'vscodeMaplibreViewer.showOverlayLayersOnMap',
            access.layerTreeProvider.getOverlayLayers().find(l => l.id === tokyoLayer.id)
        );

        const after = await poll(
            'the viewport to move to the layer bounding box (Tokyo)',
            queryViewState,
            (state) => Math.abs(state.center.latitude - 35.6844) < 0.02
                && Math.abs(state.center.longitude - 139.778) < 0.02
        );

        assert.ok(
            Math.abs(before.center.latitude - after.center.latitude) > 0.02
                || Math.abs(before.center.longitude - after.center.longitude) > 0.02,
            'the viewport must move in response to Show on Map'
        );
    });
});