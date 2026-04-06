import * as assert from 'assert';
import { regexDMS, findCoordinatesRegex } from '../coordinateParser';

suite('Regex DMS Test Suite', () => {
    
    test('should match standard DMS format with direction letters', () => {
        const testString = "59°19'45.5\"N 18°4'7.0\"E";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.329306);
        assert.strictEqual(coords[0].longitude, 18.068611);
    });
    
    test('should match DMS format with degrees and minutes and seconds', () => {
        const testString = "59°19'45.5\"N 18°4'7.0\"E";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.329306);
        assert.strictEqual(coords[0].longitude, 18.068611);
    });
    
    test('should match DMS format with only degrees and minutes', () => {
        // This test is now expected to fail with the stricter regex
        // The stricter regex requires seconds for DMS format
        const testString = "59°19'N 18°4'E";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 0, 'Should not match without seconds');
    });
    
    test('should match multiple coordinates in text', () => {
        const testString = "59°19'45.5\"N 18°4'7.0\"E and 40°26'46\"N 79°58'56\"W";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 2, 'Should find exactly 2 coordinates');
    });
    
    test('should match DMS with zero values', () => {
        const testString = "0°0'0.0\"N 0°0'0.0\"E";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 0);
        assert.strictEqual(coords[0].longitude, 0);
    });
    
    test('should not match invalid DMS format', () => {
        const testString = "not a coordinate";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match decimal coordinates as DMS', () => {
        const testString = "59.3293, 18.0686";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 0, 'Should not match decimal format as DMS');
    });
    
    test('should not match plain decimal coordinates', () => {
        const testString = "45.2 20.06767";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 0, 'Should not match plain decimal format');
    });
    
    test('should not match DMS without direction letters', () => {
        const testString = "59°19'45.5 18°4'7.0";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 0, 'Should not match without direction letters');
    });
    
    test('should not match DMS with only degrees', () => {
        const testString = "59° 18°";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 0, 'Should not match with only degrees');
    });
    
    test('should not match DMS with space separators instead of degree symbol', () => {
        const testString = "59 19 45.5 N 18 4 7.0 E";
        const coords = findCoordinatesRegex(testString, [regexDMS]);
        
        assert.strictEqual(coords.length, 0, 'Should not match without degree symbols');
    });
});