import * as assert from 'assert';
import {
    isTerminalContextArgs,
    resolveSelectedTextFromTerminalProbe,
    TerminalClipboardProbe
} from '../../services/terminalSelection';

suite('Terminal Selection Test Suite', () => {
    suite('resolveSelectedTextFromTerminalProbe', () => {
        test('Should return copied text when the clipboard changed', () => {
            const probe: TerminalClipboardProbe = { before: 'old', after: 'Stockholm' };
            assert.strictEqual(resolveSelectedTextFromTerminalProbe(probe), 'Stockholm');
        });

        test('Should trim surrounding whitespace from the copied text', () => {
            const probe: TerminalClipboardProbe = { before: 'old', after: '  Stockholm  \n' };
            assert.strictEqual(resolveSelectedTextFromTerminalProbe(probe), 'Stockholm');
        });

        test('Should return empty string when nothing was copied', () => {
            const probe: TerminalClipboardProbe = { before: 'unchanged', after: 'unchanged' };
            assert.strictEqual(resolveSelectedTextFromTerminalProbe(probe), '');
        });

        test('Should treat selection identical to the previous clipboard as no selection', () => {
            const probe: TerminalClipboardProbe = { before: 'Stockholm', after: 'Stockholm' };
            assert.strictEqual(resolveSelectedTextFromTerminalProbe(probe), '');
        });

        test('Should return copied text when selection differs from empty clipboard', () => {
            const probe: TerminalClipboardProbe = { before: '', after: '59.33, 18.06' };
            assert.strictEqual(resolveSelectedTextFromTerminalProbe(probe), '59.33, 18.06');
        });
    });

    suite('isTerminalContextArgs', () => {
        test('Should detect a serialized terminal instance context', () => {
            assert.strictEqual(isTerminalContextArgs({ instanceId: 42 }), true);
        });

        test('Should reject undefined arguments', () => {
            assert.strictEqual(isTerminalContextArgs(undefined), false);
        });

        test('Should reject null arguments', () => {
            assert.strictEqual(isTerminalContextArgs(null), false);
        });

        test('Should reject primitive arguments', () => {
            assert.strictEqual(isTerminalContextArgs('Stockholm'), false);
        });

        test('Should reject editor context arguments without instanceId', () => {
            assert.strictEqual(isTerminalContextArgs({ scheme: 'file', path: '/a.txt' }), false);
        });

        test('Should reject webview lngLat arguments', () => {
            assert.strictEqual(isTerminalContextArgs({ lngLat: { lat: 59, lng: 18 } }), false);
        });
    });
});