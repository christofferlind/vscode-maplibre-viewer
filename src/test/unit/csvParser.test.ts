import * as assert from 'assert';
import { parseCsvContent } from '../../services/csvParser';

interface TestFeature {
    type: string;
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: number[] };
}

function getFeatures(result: object): TestFeature[] {
    return (result as { features: TestFeature[] }).features;
}

function getWarnings(fn: () => object): string[] {
    const originalWarn = console.warn;
    const captured: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
        captured.push(args);
    };
    try {
        fn();
    } finally {
        console.warn = originalWarn;
    }
    return captured.flat().filter((item): item is string => typeof item === 'string');
}

suite('CsvParser', () => {
    suite('quoted field whitespace', () => {
        test('should preserve whitespace in quoted fields', () => {
            const csv = 'lat,lng,name\n52.0,13.0,"  padded  "';
            const result = parseCsvContent(csv);
            const features = getFeatures(result);
            assert.strictEqual(features.length, 1);
            assert.strictEqual(features[0].properties['name'], '  padded  ');
        });

        test('should still trim unquoted fields', () => {
            const csv = 'lat,lng,name\n52.0,13.0,  padded  ';
            const result = parseCsvContent(csv);
            const features = getFeatures(result);
            assert.strictEqual(features[0].properties['name'], 'padded');
        });
    });

    suite('newline inside quoted field', () => {
        test('should keep record intact with \\n inside quotes', () => {
            const csv = 'lat,lng,name\n52.0,13.0,"line1\nline2"';
            const result = parseCsvContent(csv);
            const features = getFeatures(result);
            assert.strictEqual(features.length, 1);
            assert.strictEqual(features[0].properties['name'], 'line1\nline2');
        });

        test('should keep record intact with \\r\\n inside quotes', () => {
            const csv = 'lat,lng,name\n52.0,13.0,"line1\r\nline2"';
            const result = parseCsvContent(csv);
            const features = getFeatures(result);
            assert.strictEqual(features.length, 1);
            assert.strictEqual(features[0].properties['name'], 'line1\r\nline2');
        });

        test('should still split records on \\r\\n outside quotes', () => {
            const csv = 'lat,lng,name\r\n52.0,13.0,a\r\n53.0,14.0,b';
            const result = parseCsvContent(csv);
            const features = getFeatures(result);
            assert.strictEqual(features.length, 2);
        });

        test('should still split records on bare \\r outside quotes', () => {
            const csv = 'lat,lng,name\r52.0,13.0,a\r53.0,14.0,b';
            const result = parseCsvContent(csv);
            const features = getFeatures(result);
            assert.strictEqual(features.length, 2);
        });
    });

    suite('row numbers in errors', () => {
        test('should report original line numbers when blank lines are skipped', () => {
            const csv = 'lat,lng,name\n52.0,13.0,a\n\n999,13.0,b\n\n\n96,14.0,c';
            let warnings: string[] = [];
            const originalWarn = console.warn;
            console.warn = (...args: unknown[]) => {
                warnings.push(args.join(' '));
            };
            try {
                parseCsvContent(csv);
            } finally {
                console.warn = originalWarn;
            }
            const joined = warnings.join('\n');
            assert.ok(joined.includes('Row 4:'), `expected Row 4 in warnings: ${joined}`);
            assert.ok(joined.includes('Row 7:'), `expected Row 7 in warnings: ${joined}`);
        });

        test('should report original line numbers for out-of-range latitude', () => {
            const csv = 'lat,lng,name\n52.0,13.0,a\n\n999,13.0,b';
            const warnings = getWarnings(() => parseCsvContent(csv));
            const joined = warnings.join('\n');
            assert.ok(joined.includes('Row 4:'), `expected Row 4 in warnings: ${joined}`);
        });
    });

    suite('header-only CSV', () => {
        test('should throw for header-only content with trailing newline', () => {
            assert.throws(
                () => parseCsvContent('lat,lng\n'),
                /at least one data row/
            );
        });

        test('should throw for header-only content without trailing newline', () => {
            assert.throws(
                () => parseCsvContent('lat,lng'),
                /at least one data row/
            );
        });

        test('should throw when only blank data rows exist', () => {
            assert.throws(
                () => parseCsvContent('lat,lng\n\n\n'),
                /at least one data row/
            );
        });
    });
});