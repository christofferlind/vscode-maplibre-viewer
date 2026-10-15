import * as assert from 'assert';
import { createRequire } from 'module';
import { vscodeStub } from '../testUtils/vscodeLayersMock';

/**
 * Unit tests for the layer style prompt helpers. The pure parsing functions
 * are covered directly; the interactive picker only needs the vscode module
 * to be resolvable, which is provided by the vscode stub.
 */

const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');
const originalPrototypeRequire = ModuleCtor.prototype.require;

type LayerStylePrompt = typeof import('../../layers/layerStylePrompt');

const stylePrompt = ((): LayerStylePrompt => {
    ModuleCtor.prototype.require = function (id: string): unknown {
        if (id === 'vscode') {
            return vscodeStub;
        }
        return originalPrototypeRequire.call(this, id);
    };
    try {
        const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, NodeModule | undefined> })._cache;
        const resolved = nodeRequire.resolve('../../layers/layerStylePrompt');
        delete moduleCache[resolved];
        return nodeRequire('../../layers/layerStylePrompt') as LayerStylePrompt;
    } finally {
        ModuleCtor.prototype.require = originalPrototypeRequire;
    }
})();

suite('layerStylePrompt parsers', () => {
    suite('parseOpacityPercent', () => {
        test('converts percentages to the 0-1 range', () => {
            assert.strictEqual(stylePrompt.parseOpacityPercent('0'), 0);
            assert.strictEqual(stylePrompt.parseOpacityPercent('50'), 0.5);
            assert.strictEqual(stylePrompt.parseOpacityPercent('100'), 1);
            assert.strictEqual(stylePrompt.parseOpacityPercent('37.5'), 0.375);
        });

        test('trims surrounding whitespace', () => {
            assert.strictEqual(stylePrompt.parseOpacityPercent(' 75 '), 0.75);
        });

        test('returns undefined for empty input', () => {
            assert.strictEqual(stylePrompt.parseOpacityPercent(''), undefined);
            assert.strictEqual(stylePrompt.parseOpacityPercent('   '), undefined);
        });

        test('returns undefined for non-numeric input', () => {
            assert.strictEqual(stylePrompt.parseOpacityPercent('abc'), undefined);
        });

        test('returns undefined for out-of-range percentages', () => {
            assert.strictEqual(stylePrompt.parseOpacityPercent('-1'), undefined);
            assert.strictEqual(stylePrompt.parseOpacityPercent('101'), undefined);
        });
    });

    suite('parsePixelValue', () => {
        test('accepts values within the inclusive bounds', () => {
            assert.strictEqual(stylePrompt.parsePixelValue('6', 1, 50), 6);
            assert.strictEqual(stylePrompt.parsePixelValue('50', 1, 50), 50);
            assert.strictEqual(stylePrompt.parsePixelValue('2.5', 1, 50), 2.5);
        });

        test('returns undefined for non-numeric input', () => {
            assert.strictEqual(stylePrompt.parsePixelValue('wide', 1, 50), undefined);
            assert.strictEqual(stylePrompt.parsePixelValue('', 1, 50), undefined);
        });

        test('returns undefined for out-of-bounds values', () => {
            assert.strictEqual(stylePrompt.parsePixelValue('0', 1, 50), undefined);
            assert.strictEqual(stylePrompt.parsePixelValue('51', 1, 50), undefined);
            assert.strictEqual(stylePrompt.parsePixelValue('-5', 1, 50), undefined);
        });
    });
});