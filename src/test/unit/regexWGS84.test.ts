import * as assert from 'assert';
import { regexWGS84, findCoordinatesRegex } from '../../services/coordinateParser';

suite('Regex WGS84 Test Suite', () => {
    
    test('should match decimal degrees with comma separator', () => {
        const testString = "59.3293, 18.0686";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match decimal degrees with space separator', () => {
        const testString = "59.3293 18.0686";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match decimal degrees with multiple spaces around separator', () => {
        const testString = "59.3293   ,   18.0686";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match negative latitude', () => {
        const testString = "-33.8523, 151.2104";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, -33.8523);
        assert.strictEqual(coords[0].longitude, 151.2104);
    });
    
    test('should match negative longitude', () => {
        const testString = "40.7128, -74.0060";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 40.7128);
        assert.strictEqual(coords[0].longitude, -74.006);
    });
    
    test('should match both negative coordinates', () => {
        const testString = "-33.8523, -74.0060";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, -33.8523);
        assert.strictEqual(coords[0].longitude, -74.006);
    });
    
    test('should match integer coordinates', () => {
        const testString = "59, 18";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59);
        assert.strictEqual(coords[0].longitude, 18);
    });
    
    test('should match coordinates with many decimal places', () => {
        const testString = "59.3293123456, 18.0686123456";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293123456);
        assert.strictEqual(coords[0].longitude, 18.0686123456);
    });
    
    test('should match coordinates at equator', () => {
        const testString = "0, 18.0686";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 0);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match coordinates at prime meridian', () => {
        const testString = "51.5074, 0";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 51.5074);
        assert.strictEqual(coords[0].longitude, 0);
    });
    
    test('should match coordinates at lat 90 lng 180 boundary', () => {
        const testString = "90, 180";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 90);
        assert.strictEqual(coords[0].longitude, 180);
    });
    
    test('should match coordinates at lat -90 lng -180 boundary', () => {
        const testString = "-90, -180";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, -90);
        assert.strictEqual(coords[0].longitude, -180);
    });
    
    test('should match coordinates in text with surrounding content', () => {
        const testString = "The location is at 59.3293, 18.0686 in Stockholm";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match coordinates with tab separator', () => {
        const testString = "59.3293\t,\t18.0686";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match coordinates with newline separator', () => {
        const testString = "59.3293\n,\n18.0686";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match multiple coordinates in text', () => {
        const testString = "59.3293, 18.0686 and 40.7128, -74.0060";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 2, 'Should find exactly 2 coordinates');
    });
    
    test('should match coordinates with leading zeros', () => {
        const testString = "059.3293, 018.0686";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should not match single coordinate', () => {
        const testString = "59.3293";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match text without coordinates', () => {
        const testString = "This is just text without coordinates";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match invalid format with three numbers', () => {
        const testString = "59.3293, 18.0686, 100";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        // Should only match first two numbers
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match coordinates in URL format', () => {
        const testString = "@59.3293,18.0686";
        const coords = findCoordinatesRegex(testString, [regexWGS84]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
});