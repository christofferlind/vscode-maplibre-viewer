import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Tests for the map scale control: resources/scripts/map-scale.js owns the
 * scale control state and application logic and wraps MapCore.initializeMap so
 * every (re-)created map gets the control; main.js must bridge the scaleUnits
 * setting through configUpdate messages. The webview sources run inside a
 * sandbox with a fake MapLibre v6 map and ScaleControl.
 */

const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'resources', 'scripts');

function readScript(name: string): string {
    return fs.readFileSync(path.join(SCRIPTS_DIR, name), 'utf-8');
}

interface FakeScaleControlInstance {
    constructorMaxWidth?: number;
    constructorUnit?: string;
    unitCalls: string[];
}

interface ScaleHarness {
    scaleModule: {
        setUnits: (units: string) => void;
        applyScaleUnits: () => void;
        resetScaleControl: () => void;
        getScaleControlState: () => { configured: string; onMap: boolean };
    };
    state: () => { configured: string; onMap: boolean };
    attachMap: () => void;
    dropMap: () => void;
    addedControlPositions: string[];
    controls: FakeScaleControlInstance[];
    removedControls: FakeScaleControlInstance[];
}

class FakeScaleControl {
    constructorMaxWidth?: number;
    constructorUnit?: string;
    unitCalls: string[] = [];
    constructor(options: { maxWidth: number; unit?: string }) {
        this.constructorMaxWidth = options.maxWidth;
        this.constructorUnit = options.unit;
    }
    setUnit(unit: string): void {
        this.unitCalls.push(unit);
    }
    onAdd(_map: unknown): Record<string, unknown> {
        return {};
    }
}

// MapLibre v5-style fake: only the plural setUnits method exists
class FakeLegacyScaleControl {
    unitCalls: string[] = [];
    setUnits(unit: string): void {
        this.unitCalls.push(unit);
    }
}

function createFreshSandbox(): Record<string, unknown> {
    const sandbox: Record<string, unknown> = {
        console,
        map: null,
        document: { createElement: () => ({}) },
        maplibregl: { ScaleControl: FakeScaleControl }
    };
    sandbox.window = sandbox;
    sandbox.__setMap = (value: unknown) => {
        sandbox.map = value;
    };
    return sandbox;
}

function createBareHarness(): ScaleHarness {
    const sandbox = createFreshSandbox();
    vm.runInContext(readScript('map-scale.js'), vm.createContext(sandbox), { filename: 'map-scale.js' });

    const scale = (sandbox.window as Record<string, unknown>).MapScale as ScaleHarness['scaleModule'];

    const addedControlPositions: string[] = [];
    const controls: FakeScaleControlInstance[] = [];
    const removedControls: FakeScaleControlInstance[] = [];

    return {
        scaleModule: scale,
        state: () => scale.getScaleControlState(),
        attachMap: () => {
            (sandbox.__setMap as (value: unknown) => void)({
                addControl: (control: FakeScaleControl, position?: string) => {
                    if (position !== undefined) {
                        addedControlPositions.push(position);
                    }
                    controls.push(control);
                },
                removeControl: (control: FakeScaleControl) => {
                    removedControls.push(control);
                }
            });
        },
        dropMap: () => {
            (sandbox.__setMap as (value: unknown) => void)(null);
        },
        addedControlPositions,
        controls,
        removedControls
    };
}

interface MainHarness {
    run: (config: Record<string, unknown>) => void;
    dispatch: (message: Record<string, unknown>) => void;
    mapConfigAtBoot: () => Record<string, unknown>;
    setUnitsCalls: string[];
}

function createMainHarness(): MainHarness {
    const sandbox = createFreshSandbox();
    delete sandbox.maplibregl;
    delete sandbox.document;
    delete sandbox.map;

    const setUnitsCalls: string[] = [];
    sandbox.MapScale = { setUnits: (units: string) => { setUnitsCalls.push(units); } };

    const windowMessageListeners: Array<(event: { data: unknown }) => void> = [];
    sandbox.addEventListener = (event: string, handler: (e: { data: unknown }) => void) => {
        if (event === 'message') {
            windowMessageListeners.push(handler);
        }
    };
    sandbox.acquireVsCodeApi = () => ({ postMessage: () => undefined });
    sandbox.MapCore = { setConfig: () => undefined, initializeMap: () => undefined };
    sandbox.document = {
        addEventListener: () => undefined,
        getElementById: () => null,
        createElement: () => ({})
    };
    sandbox.setTimeout = () => 0;
    sandbox.clearTimeout = () => undefined;

    vm.runInContext(readScript('main.js'), vm.createContext(sandbox), { filename: 'main.js' });

    const windowObj = sandbox.window as Record<string, unknown>;
    const main = windowObj.Main as { initialize: (config: Record<string, unknown>) => void };

    return {
        run: (config) => {
            main.initialize(config);
        },
        dispatch: (message) => {
            windowMessageListeners.forEach((handler) => handler({ data: message }));
        },
        mapConfigAtBoot: () => windowObj.MapConfig as Record<string, unknown>,
        setUnitsCalls
    };
}

suite('map-scale.js (scale control unit system)', () => {
    test('metric is the default configuration', () => {
        const harness = createBareHarness();
        assert.strictEqual(harness.state().configured, 'metric');
    });

    test('applyScaleUnits adds the control once at bottom-left with metric units', () => {
        const harness = createBareHarness();
        harness.attachMap();
        harness.scaleModule.applyScaleUnits();
        harness.scaleModule.applyScaleUnits();
        assert.strictEqual(harness.state().onMap, true);
        assert.deepStrictEqual(harness.addedControlPositions, ['bottom-left']);
        assert.strictEqual(harness.controls.length, 1);
        assert.strictEqual(harness.controls[0].constructorMaxWidth, 120);
        assert.deepStrictEqual(harness.controls[0].unitCalls, ['metric', 'metric']);
    });

    test('setUnits applies imperial and invalid values fall back to metric', () => {
        const harness = createBareHarness();
        harness.attachMap();
        harness.scaleModule.setUnits('imperial');
        assert.strictEqual(harness.state().configured, 'imperial');
        assert.deepStrictEqual(harness.controls[0].unitCalls, ['imperial']);

        harness.scaleModule.setUnits('bananas');
        assert.strictEqual(harness.state().configured, 'metric');
        assert.strictEqual(harness.controls.length, 1, 'unit switches must reuse the existing control');
    });

    test('nautical is applied as its own unit system', () => {
        const harness = createBareHarness();
        harness.attachMap();
        harness.scaleModule.setUnits('nautical');
        assert.strictEqual(harness.state().configured, 'nautical');
        assert.strictEqual(harness.controls[0].unitCalls[0], 'nautical');
        assert.strictEqual(harness.controls.length, 1, 'nautical must reuse the existing control');
    });

    test('off removes the scale control from the map', () => {
        const harness = createBareHarness();
        harness.attachMap();
        harness.scaleModule.setUnits('off');
        assert.strictEqual(harness.state().onMap, false);
        assert.strictEqual(harness.state().configured, 'off');

        harness.scaleModule.applyScaleUnits();
        assert.strictEqual(harness.controls.length, 0, 'no control may be created while off');
        assert.deepStrictEqual(harness.removedControls, []);
    });

    test('off removes an existing control from the map', () => {
        const harness = createBareHarness();
        harness.attachMap();
        harness.scaleModule.applyScaleUnits();
        assert.strictEqual(harness.controls.length, 1);
        harness.scaleModule.setUnits('off');
        assert.strictEqual(harness.state().onMap, false);
        assert.deepStrictEqual(harness.removedControls, harness.controls.slice(0, 1));

        harness.scaleModule.applyScaleUnits();
        assert.strictEqual(harness.controls.length, 1, 'no new control may be created while off');
    });

    test('off before the first apply never creates a control', () => {
        const harness = createBareHarness();
        harness.attachMap();
        harness.scaleModule.setUnits('off');
        harness.scaleModule.applyScaleUnits();
        harness.scaleModule.applyScaleUnits();
        assert.strictEqual(harness.controls.length, 0);
    });

    test('switching from off back to metric re-creates the control', () => {
        const harness = createBareHarness();
        harness.attachMap();
        harness.scaleModule.setUnits('off');
        harness.scaleModule.setUnits('imperial');
        assert.strictEqual(harness.state().onMap, true);
        assert.strictEqual(harness.state().configured, 'imperial');
        assert.strictEqual(harness.controls[0].unitCalls[0], 'imperial');
    });

    test('resetScaleControl drops the control so a rebuilt map starts fresh', () => {
        const harness = createBareHarness();
        harness.attachMap();
        harness.scaleModule.applyScaleUnits();
        harness.scaleModule.resetScaleControl();
        assert.strictEqual(harness.state().onMap, false);
        harness.scaleModule.applyScaleUnits();
        assert.strictEqual(harness.state().onMap, true);
        assert.strictEqual(harness.controls.length, 2, 'a new map must get a new control instance');
    });

    test('applyScaleUnits is a safe no-op without a map', () => {
        const harness = createBareHarness();
        assert.doesNotThrow(() => harness.scaleModule.applyScaleUnits());
        assert.strictEqual(harness.state().onMap, false);
        harness.attachMap();
        harness.dropMap();
        assert.doesNotThrow(() => harness.scaleModule.applyScaleUnits());
    });

    test('a MapLibre v5-style control with only setUnits is supported', () => {
        const sandbox = createFreshSandbox();
        sandbox.maplibregl = { ScaleControl: FakeLegacyScaleControl };
        vm.createContext(sandbox);
        vm.runInContext(readScript('map-scale.js'), sandbox as vm.Context, { filename: 'map-scale.js' });
        const scale = ((sandbox.window as Record<string, unknown>).MapScale) as ScaleHarness['scaleModule'];

        (sandbox.__setMap as (value: unknown) => void)({
            addControl: (control: unknown) => {
                (sandbox.map as Record<string, unknown>).lastControl = control;
            }
        });
        scale.applyScaleUnits();
        scale.setUnits('imperial');
        const control = (sandbox.map as Record<string, unknown>).lastControl as FakeLegacyScaleControl;
        assert.deepStrictEqual(control.unitCalls, ['metric', 'imperial']);
    });
});

suite('map-scale.js wraps MapCore.initializeMap', () => {
    test('a map created through initializeMap gets the scale control', () => {
        const sandbox = createFreshSandbox();
        sandbox.applyTerrain = () => undefined;
        sandbox.addEventListener = () => undefined;
        sandbox.hideErrorOverlay = () => undefined;
        sandbox.showErrorOverlay = () => undefined;
        sandbox.MapGlobe = { attach: () => undefined };
        sandbox.MapPopup = { attachPopupHandler: () => undefined };
        sandbox.MapInfo = { attachInfoHandler: () => undefined };
        sandbox.setTimeout = () => 0;
        sandbox.clearTimeout = () => undefined;

        const added: Array<{ control: FakeScaleControl; position?: string }> = [];

        sandbox.vscode = { postMessage: () => undefined };
        sandbox.maplibregl = {
            ScaleControl: FakeScaleControl,
            Map: function(this: unknown) {
                return {
                    on: () => undefined,
                    addControl: (control: FakeScaleControl, position?: string) => {
                        added.push({ control, position });
                    },
                    isStyleLoaded: () => false
                };
            },
            NavigationControl: function() {
                return {};
            }
        };

        vm.createContext(sandbox);
        vm.runInContext(readScript('map-core.js'), sandbox as vm.Context, { filename: 'map-core.js' });
        vm.runInContext(readScript('map-scale.js'), sandbox as vm.Context, { filename: 'map-scale.js' });

        const windowObj = sandbox.window as Record<string, unknown>;
        const core = windowObj.MapCore as Record<string, (...args: unknown[]) => unknown>;
        core.setConfig({ mapStyleUrl: 'https://example.com/style.json' });
        core.initializeMap(undefined);

        const createdMap = sandbox.map as Record<string, unknown> | null;
        assert.ok(createdMap, 'initializeMap must create a map instance');

        const scaleState = (windowObj.MapScale as Record<string, () => { configured: string; onMap: boolean }>)
            .getScaleControlState();
        assert.strictEqual(scaleState.onMap, true, 'initializeMap must leave the scale control on the map');
        assert.strictEqual(scaleState.configured, 'metric');

        const scaleControls = added.filter((entry) => entry.control instanceof FakeScaleControl);
        assert.strictEqual(scaleControls.length, 1, 'exactly one scale control must be added');
        assert.strictEqual(scaleControls[0].position, 'bottom-left');
        assert.deepStrictEqual(added.length, 2, 'navigation + scale controls');

        (windowObj.MapScale as Record<string, (units: string) => void>).setUnits('imperial');
        assert.deepStrictEqual(scaleControls[0].control.unitCalls, ['metric', 'imperial']);
    });
});

suite('main.js scale units bridge', () => {
    test('initialize stores scaleUnits with metric default', () => {
        const harness = createMainHarness();
        harness.run({});
        assert.strictEqual(harness.mapConfigAtBoot().scaleUnits, 'metric');
        assert.deepStrictEqual(harness.setUnitsCalls, ['metric']);
    });

    test('a scaleUnits configUpdate is forwarded to MapScale.setUnits', () => {
        const harness = createMainHarness();
        harness.run({});
        harness.dispatch({ type: 'configUpdate', config: { scaleUnits: 'imperial' } });
        assert.strictEqual(harness.mapConfigAtBoot().scaleUnits, 'imperial');
        assert.deepStrictEqual(harness.setUnitsCalls, ['metric', 'imperial']);
    });

    test('a scaleUnits off configUpdate is forwarded so the control hides live', () => {
        const harness = createMainHarness();
        harness.run({});
        harness.dispatch({ type: 'configUpdate', config: { scaleUnits: 'off' } });
        assert.strictEqual(harness.mapConfigAtBoot().scaleUnits, 'off');
        assert.deepStrictEqual(harness.setUnitsCalls, ['metric', 'off']);
    });

    test('unrelated config updates do not re-apply the scale units', () => {
        const harness = createMainHarness();
        harness.run({});
        harness.dispatch({ type: 'configUpdate', config: { flyToDuration: 300 } });
        assert.deepStrictEqual(harness.setUnitsCalls, ['metric']);
        assert.strictEqual(harness.mapConfigAtBoot().scaleUnits, 'metric');
    });
});