import * as assert from 'assert';
import { defaultPatterns, findCoordinatesRegex, getCoordinatePatterns } from '../../coordinateParser';

suite('Overlap Test Suite', () => {

    test('should handle overlapping matches - GeoJSON first then WGS84', () => {
        // Text: "45.2 20.06767\n\n[60.06767 34.2]"
        // The GeoJSON pattern [60.06767 34.2] when run first will match at position of "60.06767 34.2"
        // The WGS84 pattern would also match "34.2 60.06767" within the same text range
        // Since GeoJSON runs first, it should claim that text position and WGS84 should skip it
        const testString = "45.2 20.06767\n\n[60.06767 34.2]";
        
        // Use only GeoJSON and WGS84 (skip DMS which can cause additional matches)
        const coords = findCoordinatesRegex(testString, defaultPatterns
    
        );
        
        // Should find exactly 2 coordinates
        assert.strictEqual(coords.length, 2, 'Should find two coordinates');
        
        // First coordinate should be from GeoJSON: 34.2, 60.06767 (note: GeoJSON is [lng, lat])
        // GeoJSON runs first in the pattern order, so it gets processed first
        assert.strictEqual(coords[0].latitude, 34.2, 'First coord latitude should be 34.2');
        assert.strictEqual(coords[0].longitude, 60.06767, 'First coord longitude should be 60.06767');
        
        // Second coordinate should be from WGS84: 45.2, 20.06767
        assert.strictEqual(coords[1].latitude, 45.2, 'Second coord latitude should be 45.2');
        assert.strictEqual(coords[1].longitude, 20.06767, 'Second coord longitude should be 20.06767');
    });

    test('should skip overlapping WGS84 match when GeoJSON runs first', () => {
        // This tests specifically that when GeoJSON matches first, WGS84 doesn't match overlapping text
        const testString = "[60.06767 34.2]";
        
        // Run GeoJSON first, then WGS84
        const coords = findCoordinatesRegex(testString, defaultPatterns
    
        );
        
        // Should only find 1 coordinate from GeoJSON
        assert.strictEqual(coords.length, 1, 'Should find exactly one coordinate');
        
        // The coordinate should be from GeoJSON: 34.2, 60.06767
        assert.strictEqual(coords[0].latitude, 34.2, 'Latitude should be 34.2');
        assert.strictEqual(coords[0].longitude, 60.06767, 'Longitude should be 60.06767');
    });

    test('should find both coordinates when patterns do not overlap', () => {
        const testString = "45.2 20.06767 [60.06767 34.2]";
        
        const coords = findCoordinatesRegex(testString, defaultPatterns
    
        );
        
        // Should find 2 coordinates (no overlap)
        assert.strictEqual(coords.length, 2, 'Should find two coordinates');
    });

    test('should prioritize first pattern for overlapping matches', () => {
        // Both patterns could match "10 20" but GeoJSON runs first
        const testString = "[10 20]";
        
        const coords = findCoordinatesRegex(testString, defaultPatterns);
        
        // Should find 1 coordinate from GeoJSON
        assert.strictEqual(coords.length, 1, 'Should find exactly one coordinate');
        assert.strictEqual(coords[0].latitude, 20, 'Latitude should be 20');
        assert.strictEqual(coords[0].longitude, 10, 'Longitude should be 10');
    });
});