import * as assert from 'assert';
import { createRequire } from 'module';

// The vscode module only resolves inside the extension host; stub it so the
// configService module can be imported in plain node unit tests.
const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');

class MockConfiguration {
    constructor(private values: Record<string, unknown>) {}

    get<T>(key: string, defaultValue?: T): T | undefined {
        const value = this.values[key];
        return value === undefined ? defaultValue : (value as T);
    }
}

let mockConfigValues: Record<string, unknown> = {};
const vscodeStub = {
    workspace: {
        getConfiguration: () => new MockConfiguration(mockConfigValues),
        onDidChangeConfiguration: (callback: () => void) => ({
            dispose: () => {
                // no-op
            }
        })
    }
};
const originalPrototypeRequire = ModuleCtor.prototype.require;
ModuleCtor.prototype.require = function (id: string): unknown {
    if (id === 'vscode') {
        return vscodeStub;
    }
    return originalPrototypeRequire.call(this, id);
};

// Other test files may have already loaded configService with a different
// vscode stub; evict the cache entry so a fresh instance captures our stub.
const configServicePath = nodeRequire.resolve('../../services/configService');
delete nodeRequire.cache[configServicePath];

const configService = nodeRequire('../../services/configService') as typeof import('../../services/configService');
ModuleCtor.prototype.require = originalPrototypeRequire;
delete nodeRequire.cache[configServicePath];

suite('configService', () => {
    setup(() => {
        mockConfigValues = {};
    });

    suite('settings getters with defaults', () => {
        test('getBasemapStyle defaults to osm', () => {
            assert.strictEqual(configService.getBasemapStyle(), 'osm');
        });

        test('getBasemapStyle returns configured value', () => {
            mockConfigValues = { basemapStyle: 'custom' };
            assert.strictEqual(configService.getBasemapStyle(), 'custom');
        });

        test('getBasemapApiKey defaults to empty string', () => {
            assert.strictEqual(configService.getBasemapApiKey(), '');
        });

        test('getBasemapApiKey returns configured value', () => {
            mockConfigValues = { basemapApiKey: 'secret' };
            assert.strictEqual(configService.getBasemapApiKey(), 'secret');
        });

        test('getGeocodingApiKey defaults to empty string', () => {
            assert.strictEqual(configService.getGeocodingApiKey(), '');
        });

        test('getGeocodingProvider defaults to photon', () => {
            assert.strictEqual(configService.getGeocodingProvider(), 'photon');
        });

        test('getGeocodingProvider returns configured value', () => {
            mockConfigValues = { geocodingProvider: 'maptiler' };
            assert.strictEqual(configService.getGeocodingProvider(), 'maptiler');
        });

        test('getLanguage defaults to en', () => {
            assert.strictEqual(configService.getLanguage(), 'en');
        });

        test('getLanguage returns configured value', () => {
            mockConfigValues = { language: 'sv' };
            assert.strictEqual(configService.getLanguage(), 'sv');
        });
    });

    suite('onConfigurationChanged', () => {
        test('should return a disposable for the configuration change listener', () => {
            const disposable = configService.onConfigurationChanged(() => {
                // no-op
            });
            assert.strictEqual(typeof disposable.dispose, 'function');
            assert.doesNotThrow(() => disposable.dispose());
        });
    });
});
