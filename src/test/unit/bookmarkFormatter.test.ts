import * as assert from 'assert';
import { createRequire } from 'module';
import { createTestBookmark, createFullBookmark } from '../testUtils';

// The vscode module only resolves inside the extension host; stub it so the
// bookmarkFormatter module can be imported in plain node unit tests.
const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');
const vscodeStub = {
    MarkdownString: class MarkdownString {
        value = '';
        appendMarkdown(text: string): void {
            this.value += text;
        }
    }
};
const originalPrototypeRequire = ModuleCtor.prototype.require;
ModuleCtor.prototype.require = function (id: string): unknown {
    if (id === 'vscode') {
        return vscodeStub;
    }
    return originalPrototypeRequire.call(this, id);
};

const formatter = nodeRequire('../../services/bookmarkFormatter') as typeof import('../../services/bookmarkFormatter');
ModuleCtor.prototype.require = originalPrototypeRequire;

suite('bookmarkFormatter', () => {
    suite('formatBookmarkLabel', () => {
        test('should use the bookmark name when present', () => {
            assert.strictEqual(
                formatter.formatBookmarkLabel(createTestBookmark({ name: 'Home' })),
                'Home'
            );
        });

        test('should fall back to coordinates when name is missing', () => {
            const bk = createTestBookmark({
                name: '',
                center: { latitude: 59.3293, longitude: 18.0686 }
            });
            assert.strictEqual(formatter.formatBookmarkLabel(bk), '59.329300, 18.068600');
        });

        test('should fall back to zeroed coordinate when center is missing', () => {
            const bk = createTestBookmark({ name: '', center: undefined });
            assert.strictEqual(formatter.formatBookmarkLabel(bk), '0.000000, 0.000000');
        });
    });

    suite('formatBookmarkTooltip', () => {
        test('should include name and coordinates', () => {
            const md = formatter.formatBookmarkTooltip(createTestBookmark());
            assert.ok(md.value.includes('Test Location'));
            assert.ok(md.value.includes('59.329300, 18.068600'));
            assert.ok(md.value.includes('**Zoom:** 12.0'));
        });

        test('should include description when present', () => {
            const bk = createFullBookmark({ description: 'A lovely place' });
            const md = formatter.formatBookmarkTooltip(bk);
            assert.ok(md.value.includes('A lovely place'));
        });

        test('should include tags when present', () => {
            const bk = createFullBookmark({ tags: ['favorite', 'work'] });
            const md = formatter.formatBookmarkTooltip(bk);
            assert.ok(md.value.includes('**Tags:** favorite, work'));
        });

        test('should not add tags section when empty', () => {
            const bk = createFullBookmark({ tags: [] });
            const md = formatter.formatBookmarkTooltip(bk);
            assert.ok(!md.value.includes('**Tags:**'));
        });
    });

    suite('formatBookmarkForCopy', () => {
        test('should serialize bookmark into JSON string', () => {
            const bk = createFullBookmark();
            const parsed = JSON.parse(formatter.formatBookmarkForCopy(bk)) as {
                name: string;
                latitude: number;
                longitude: number;
                zoom: number;
                bearing: number;
                pitch: number;
            };
            assert.strictEqual(parsed.name, 'Full Featured Bookmark');
            assert.strictEqual(parsed.latitude, 59.3293);
            assert.strictEqual(parsed.longitude, 18.0686);
            assert.strictEqual(parsed.zoom, 14);
            assert.strictEqual(parsed.bearing, 90);
            assert.strictEqual(parsed.pitch, 45);
        });

        test('should handle missing center', () => {
            const bk = createTestBookmark({ center: undefined });
            const parsed = JSON.parse(formatter.formatBookmarkForCopy(bk)) as {
                latitude: number;
                longitude: number;
            };
            assert.strictEqual(parsed.latitude, 0);
            assert.strictEqual(parsed.longitude, 0);
        });
    });

    suite('parseBookmarkFromCopy', () => {
        test('should parse a valid copied bookmark', () => {
            const parsed = formatter.parseBookmarkFromCopy(
                JSON.stringify({
                    name: 'Home',
                    latitude: 59.3293,
                    longitude: 18.0686,
                    zoom: 12,
                    bearing: 0,
                    pitch: 0
                })
            );
            assert.ok(parsed);
            assert.strictEqual(parsed.name, 'Home');
            assert.deepStrictEqual(parsed.center, { latitude: 59.3293, longitude: 18.0686 });
        });

        test('should apply defaults when optional fields missing', () => {
            const parsed = formatter.parseBookmarkFromCopy(
                JSON.stringify({ latitude: 10, longitude: 20 })
            );
            assert.ok(parsed);
            assert.strictEqual(parsed.zoom, 10);
            assert.strictEqual(parsed.bearing, 0);
            assert.strictEqual(parsed.pitch, 0);
        });

        test('should return null when lat/lng are not numbers', () => {
            assert.strictEqual(
                formatter.parseBookmarkFromCopy(JSON.stringify({ latitude: 'x', longitude: 20 })),
                null
            );
        });

        test('should return null for invalid JSON', () => {
            assert.strictEqual(formatter.parseBookmarkFromCopy('{ not json'), null);
        });
    });

    suite('formatBookmarkDescriptionFromBookmark', () => {
        test('should combine coordinate and view state', () => {
            const bk = createFullBookmark();
            assert.strictEqual(
                formatter.formatBookmarkDescriptionFromBookmark(bk),
                '59.329300, 18.068600 | Zoom: 14.0, Bearing: 90°, Pitch: 45°'
            );
        });

        test('should handle missing center', () => {
            const bk = createTestBookmark({ center: undefined });
            assert.strictEqual(
                formatter.formatBookmarkDescriptionFromBookmark(bk),
                '0.000000, 0.000000 | Zoom: 12.0'
            );
        });
    });
});
