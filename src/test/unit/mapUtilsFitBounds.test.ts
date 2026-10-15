import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Unit tests for MapUtils.fitBoundsWithDefaults. MapLibre GL v6 silently
 * refuses to fit when the padding consumes the map container
 * (cameraForBounds returns undefined whenever the available area becomes
 * negative), which made every fit-based navigation ("Show on Map", file
 * activation, WKT selection) a silent no-op in small or collapsed map
 * panels. The function must clamp the padding to the container size and skip
 * fitting only when the container has no layout at all.
 */

interface FitBoundsCall {
    bounds: unknown;
    options: Record<string, unknown>;
}

interface FakeMap {
    fitBoundsCalls: FitBoundsCall[];
    containerWidth: number;
    containerHeight: number;
    fitBounds: (bounds: unknown, options: Record<string, unknown>) => void;
    getContainer: () => { offsetWidth: number; offsetHeight: number };
}

function loadMapUtils(): Record<string, (...args: unknown[]) => unknown> {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-utils.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');
    const windowObj: Record<string, unknown> = {};
    windowObj.window = windowObj;
    const context: Record<string, unknown> = { window: windowObj, console };
    vm.runInNewContext(source, context);
    return windowObj.MapUtils as Record<string, (...args: unknown[]) => unknown>;
}

function loadMapUtilsWithFlyDuration(durationValue: number | undefined): Record<string, (...args: unknown[]) => unknown> {
    const sourcePath = path.join(__dirname, '..', '..', '..', 'resources', 'scripts', 'map-utils.js');
    const source = fs.readFileSync(sourcePath, 'utf-8');
    const windowObj: Record<string, unknown> = {};
    windowObj.window = windowObj;
    windowObj.MapConfig = { flyToDuration: durationValue };
    const context: Record<string, unknown> = { window: windowObj, console };
    vm.runInNewContext(source, context);
    return windowObj.MapUtils as Record<string, (...args: unknown[]) => unknown>;
}

function createFakeMap(containerWidth: number, containerHeight: number): FakeMap {
    const map: FakeMap = {
        fitBoundsCalls: [],
        containerWidth,
        containerHeight,
        fitBounds(bounds, options) {
            map.fitBoundsCalls.push({ bounds, options: { ...options } });
            return undefined;
        },
        getContainer() {
            return { offsetWidth: map.containerWidth, offsetHeight: map.containerHeight };
        }
    };
    return map;
}

const BIG_TRACK_BOUNDS = [[75.7, 26.55], [76.4, 26.95]];

suite('MapUtils.fitBoundsWithDefaults', () => {
    test('fits with the default padding on a normally sized container', () => {
        const utils = loadMapUtils();
        const map = createFakeMap(400, 600);

        (utils.fitBoundsWithDefaults as (...args: unknown[]) => unknown)(map, BIG_TRACK_BOUNDS);

        assert.strictEqual(map.fitBoundsCalls.length, 1, 'fitBounds must be called');
        assert.strictEqual(map.fitBoundsCalls[0].options.padding, 50, 'default padding must be kept');
        assert.strictEqual(map.fitBoundsCalls[0].options.maxZoom, 16);
        assert.strictEqual(JSON.stringify(map.fitBoundsCalls[0].bounds), JSON.stringify(BIG_TRACK_BOUNDS));
    });

    test('clamps the default padding on a container smaller than twice the padding', () => {
        const utils = loadMapUtils();
        const map = createFakeMap(298, 93);

        (utils.fitBoundsWithDefaults as (...args: unknown[]) => unknown)(map, BIG_TRACK_BOUNDS);

        assert.strictEqual(map.fitBoundsCalls.length, 1, 'fitBounds must still be called on the small container');
        assert.strictEqual(map.fitBoundsCalls[0].options.padding, Math.floor((Math.min(298, 93) - 4) / 2),
            'padding must be clamped so the available fit area stays positive');
    });

    test('clamps an explicitly requested padding (fitBoundingBox-style) on a small container', () => {
        const utils = loadMapUtils();
        const map = createFakeMap(200, 90);

        (utils.fitBoundsWithDefaults as (...args: unknown[]) => unknown)(map, BIG_TRACK_BOUNDS, { padding: 100 });

        assert.strictEqual(map.fitBoundsCalls[0].options.padding, Math.floor((Math.min(200, 90) - 4) / 2),
            'a requested padding above the container size must be clamped');
    });

    test('keeps a requested padding that fits the container', () => {
        const utils = loadMapUtils();
        const map = createFakeMap(400, 600);

        (utils.fitBoundsWithDefaults as (...args: unknown[]) => unknown)(map, BIG_TRACK_BOUNDS, { padding: 80 });

        assert.strictEqual(map.fitBoundsCalls[0].options.padding, 80,
            'padding below the container budget must be preserved');
    });

    test('skips the fit when the map container has no layout yet', () => {
        const utils = loadMapUtils();
        const map = createFakeMap(0, 0);

        (utils.fitBoundsWithDefaults as (...args: unknown[]) => unknown)(map, BIG_TRACK_BOUNDS);

        assert.strictEqual(map.fitBoundsCalls.length, 0,
            'fitBounds must not be called on an unrendered zero-size container');
    });

    test('still fits when only the smaller dimension is tiny', () => {
        const utils = loadMapUtils();
        const map = createFakeMap(800, 6);

        (utils.fitBoundsWithDefaults as (...args: unknown[]) => unknown)(map, BIG_TRACK_BOUNDS);

        assert.strictEqual(map.fitBoundsCalls.length, 1);
        assert.strictEqual(map.fitBoundsCalls[0].options.padding, 1,
            'the clamped padding must keep the remaining fit area positive');
    });

    test('normalizes inverted bounds before fitting', () => {
        const utils = loadMapUtils();
        const map = createFakeMap(400, 600);

        (utils.fitBoundsWithDefaults as (...args: unknown[]) => unknown)(map, [[76.4, 26.95], [75.7, 26.55]]);

        assert.strictEqual(JSON.stringify(map.fitBoundsCalls[0].bounds), JSON.stringify(BIG_TRACK_BOUNDS),
            'corners must be normalized so MapLibre does not refuse the fit');
    });

    test('honors the configured flyToDuration', () => {
        const utils = loadMapUtilsWithFlyDuration(1234);
        const map = createFakeMap(400, 600);

        (utils.fitBoundsWithDefaults as (...args: unknown[]) => unknown)(map, BIG_TRACK_BOUNDS);

        assert.strictEqual(map.fitBoundsCalls[0].options.duration, 1234);
    });

    test('uses the flyToDuration fallback when no configuration is present', () => {
        const utils = loadMapUtils();
        const map = createFakeMap(400, 600);

        (utils.fitBoundsWithDefaults as (...args: unknown[]) => unknown)(map, BIG_TRACK_BOUNDS);

        assert.strictEqual(map.fitBoundsCalls[0].options.duration, 500);
    });
});