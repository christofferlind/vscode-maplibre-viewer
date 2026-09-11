import * as assert from 'assert';
import { loadWithStubbedVscode } from '../testUtils/loadWithStubbedVscode';

interface WatcherModule {
    ClipboardWatcher: new (
        readClipboard?: () => Promise<string>,
        intervalMs?: number
    ) => {
        onDidChangeText: (listener: (text: string) => void) => void;
        start: () => void;
        stop: () => void;
        dispose: () => void;
    };
}

interface ManagerModule {
    ClipboardLayerManager: new (deps: Record<string, unknown>) => {
        processClipboardText: (text: string) => Promise<boolean>;
        start: () => void;
        stop: () => void;
        syncWithLayerState: () => void;
        dispose: () => void;
    };
}

interface PointFeature {
    geometry: {
        type: string;
        coordinates: number[];
    };
}

function firstPointCoordinate(geojson: unknown): number[] {
    const fc = geojson as { features: PointFeature[] };
    return fc.features[0].geometry.coordinates;
}

const watcher = loadWithStubbedVscode<WatcherModule>('../../services/clipboardWatcher');
const manager = loadWithStubbedVscode<ManagerModule>('../../services/clipboardLayerManager');

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

suite('ClipboardWatcher Test Suite', () => {
    test('Should fire onDidChangeText when clipboard content changes', async () => {
        let current = 'initial';
        const instance = new watcher.module.ClipboardWatcher(async () => current, 10);
        const seen: string[] = [];
        instance.onDidChangeText((text) => seen.push(text));
        instance.start();

        await sleep(30);
        current = '59.33, 18.06';
        await sleep(30);
        instance.dispose();

        assert.ok(seen.includes('initial'));
        assert.ok(seen.includes('59.33, 18.06'));
    });

    test('Should not fire when clipboard content is unchanged', async () => {
        const instance = new watcher.module.ClipboardWatcher(async () => 'same', 10);
        let fired = 0;
        instance.onDidChangeText(() => { fired += 1; });
        instance.start();

        await sleep(50);
        instance.dispose();

        assert.strictEqual(fired, 1);
    });

    test('Should survive clipboard read errors and retry', async () => {
        let shouldThrow = true;
        const instance = new watcher.module.ClipboardWatcher(async () => {
            if (shouldThrow) {
                throw new Error('clipboard locked');
            }
            return 'recovered';
        }, 10);
        const seen: string[] = [];
        instance.onDidChangeText((text) => seen.push(text));
        instance.start();

        await sleep(30);
        shouldThrow = false;
        await sleep(30);
        instance.dispose();

        assert.ok(seen.includes('recovered'));
    });

    test('Should not poll after stop', async () => {
        let reads = 0;
        const instance = new watcher.module.ClipboardWatcher(async () => {
            reads += 1;
            return 'x';
        }, 10);
        instance.start();
        await sleep(25);
        instance.stop();
        const readsAtStop = reads;
        await sleep(30);

        assert.strictEqual(reads, readsAtStop);
    });
});

function makeLayer(visible: boolean): Record<string, unknown> {
    return {
        id: 'clipboard',
        name: 'Clipboard',
        type: 'geojson',
        source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        visible
    };
}

suite('ClipboardLayerManager Test Suite', () => {
    test('Should not parse when the clipboard layer is hidden', async () => {
        let updated: object | null | undefined;
        const instance = new manager.module.ClipboardLayerManager({
            getClipboardLayer: () => makeLayer(false),
            updateClipboardLayer: async (geojson: object | null) => { updated = geojson; },
            fitBoundsOnly: () => {},
            setContextKey: async () => {},
            createWatcher: () => new watcher.module.ClipboardWatcher(async () => '')
        });

        instance.syncWithLayerState();
        const result = await instance.processClipboardText('59.33, 18.06');

        assert.strictEqual(result, false);
        assert.strictEqual(updated, undefined);
        instance.dispose();
    });

    test('Should update the layer with parsed coordinates when visible', async () => {
        let updated: object | null | undefined;
        let fitted: { southwest: { latitude: number; longitude: number }; northeast: { latitude: number; longitude: number } } | undefined;
        const instance = new manager.module.ClipboardLayerManager({
            getClipboardLayer: () => makeLayer(true),
            updateClipboardLayer: async (geojson: object | null) => { updated = geojson; },
            fitBoundsOnly: (bbox: typeof fitted) => { fitted = bbox; },
            setContextKey: async () => {},
            createWatcher: () => new watcher.module.ClipboardWatcher(async () => '')
        });

        const result = await instance.processClipboardText('59.3293, 18.0686');

        assert.strictEqual(result, true);
        const fc = updated as { type: string; features: Array<{ geometry: { coordinates: number[] } }> };
        assert.strictEqual(fc.type, 'FeatureCollection');
        assert.deepStrictEqual(fc.features[0].geometry.coordinates, [18.0686, 59.3293]);
        assert.ok(fitted);
        instance.dispose();
    });

    test('Should parse WKT POINT as lng lat order, not swapped', async () => {
        let updated: object | null | undefined;
        const instance = new manager.module.ClipboardLayerManager({
            getClipboardLayer: () => makeLayer(true),
            updateClipboardLayer: async (geojson: object | null) => { updated = geojson; },
            fitBoundsOnly: () => {},
            setContextKey: async () => {},
            createWatcher: () => new watcher.module.ClipboardWatcher(async () => '')
        });

        const result = await instance.processClipboardText('POINT (17.8 59.4)');

        assert.strictEqual(result, true);
        assert.deepStrictEqual(firstPointCoordinate(updated), [17.8, 59.4]);
        instance.dispose();
    });

    test('Should parse WKT LINESTRING from clipboard', async () => {
        let updated: object | null | undefined;
        const instance = new manager.module.ClipboardLayerManager({
            getClipboardLayer: () => makeLayer(true),
            updateClipboardLayer: async (geojson: object | null) => { updated = geojson; },
            fitBoundsOnly: () => {},
            setContextKey: async () => {},
            createWatcher: () => new watcher.module.ClipboardWatcher(async () => '')
        });

        const result = await instance.processClipboardText('LINESTRING (17.8 59.4, 18.0 59.5)');

        assert.strictEqual(result, true);
        const fc = updated as { features: Array<{ geometry: { type: string; coordinates: number[][] } }> };
        assert.strictEqual(fc.features[0].geometry.type, 'LineString');
        assert.strictEqual(fc.features[0].geometry.coordinates.length, 2);
        instance.dispose();
    });

    test('Should not update the layer for out-of-range WKT coordinates', async () => {
        let updated: object | null | undefined;
        const instance = new manager.module.ClipboardLayerManager({
            getClipboardLayer: () => makeLayer(true),
            updateClipboardLayer: async (geojson: object | null) => { updated = geojson; },
            fitBoundsOnly: () => {},
            setContextKey: async () => {},
            createWatcher: () => new watcher.module.ClipboardWatcher(async () => '')
        });

        const result = await instance.processClipboardText('POINT (999 999)');

        assert.strictEqual(result, false);
        assert.strictEqual(updated, undefined);
        instance.dispose();
    });

    test('Should ignore non-coordinate text', async () => {
        let updated: object | null | undefined;
        const instance = new manager.module.ClipboardLayerManager({
            getClipboardLayer: () => makeLayer(true),
            updateClipboardLayer: async (geojson: object | null) => { updated = geojson; },
            fitBoundsOnly: () => {},
            setContextKey: async () => {},
            createWatcher: () => new watcher.module.ClipboardWatcher(async () => '')
        });

        const result = await instance.processClipboardText('just some plain text');

        assert.strictEqual(result, false);
        assert.strictEqual(updated, undefined);
        instance.dispose();
    });

    test('Should ignore empty clipboard text', async () => {
        let updated: object | null | undefined;
        const instance = new manager.module.ClipboardLayerManager({
            getClipboardLayer: () => makeLayer(true),
            updateClipboardLayer: async (geojson: object | null) => { updated = geojson; },
            fitBoundsOnly: () => {},
            setContextKey: async () => {},
            createWatcher: () => new watcher.module.ClipboardWatcher(async () => '')
        });

        const result = await instance.processClipboardText('   ');

        assert.strictEqual(result, false);
        assert.strictEqual(updated, undefined);
        instance.dispose();
    });

    test('Should dispose the watcher when the layer is hidden again', () => {
        let visible = true;
        let watcherDisposed = false;
        const fakeWatcher = {
            onDidChangeText: () => {},
            start: () => {},
            dispose: () => { watcherDisposed = true; }
        };
        const instance = new manager.module.ClipboardLayerManager({
            getClipboardLayer: () => makeLayer(visible),
            createWatcher: () => fakeWatcher
        });

        instance.syncWithLayerState();
        visible = false;
        instance.syncWithLayerState();

        assert.strictEqual(watcherDisposed, true);
        instance.dispose();
    });
});