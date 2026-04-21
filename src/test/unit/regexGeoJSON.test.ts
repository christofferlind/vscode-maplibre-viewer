import * as assert from 'assert';
import { regexGeoJSON, findCoordinatesRegex } from '../../services/coordinateParser';

suite('Regex GeoJSON Test Suite', () => {
    
    test('should match GeoJSON array format with brackets', () => {
        const testString = "[-73.9732, 40.7644]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 40.7644, 'Second value should be latitude');
        assert.strictEqual(coords[0].longitude, -73.9732, 'First value should be longitude');
    });
    
    test('should match GeoJSON array without spaces', () => {
        const testString = "[-73.9732,40.7644]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 40.7644);
        assert.strictEqual(coords[0].longitude, -73.9732);
    });
    
    test('should match GeoJSON array with extra spaces', () => {
        const testString = "[  -73.9732  ,  40.7644  ]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 40.7644);
        assert.strictEqual(coords[0].longitude, -73.9732);
    });
    
    test('should match negative longitude', () => {
        const testString = "[-74.0060, 40.7128]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 40.7128);
        assert.strictEqual(coords[0].longitude, -74.006);
    });
    
    test('should match negative latitude', () => {
        const testString = "[151.2104, -33.8523]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, -33.8523);
        assert.strictEqual(coords[0].longitude, 151.2104);
    });
    
    test('should match both negative coordinates', () => {
        const testString = "[-74.0060, -33.8523]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, -33.8523);
        assert.strictEqual(coords[0].longitude, -74.006);
    });
    
    test('should match integer coordinates', () => {
        const testString = "[18, 59]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59);
        assert.strictEqual(coords[0].longitude, 18);
    });
    
    test('should match coordinates with many decimal places', () => {
        const testString = "[18.0686123456, 59.3293123456]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293123456);
        assert.strictEqual(coords[0].longitude, 18.0686123456);
    });
    
    test('should match coordinates at equator', () => {
        const testString = "[18.0686, 0]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 0);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match coordinates at prime meridian', () => {
        const testString = "[0, 51.5074]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 51.5074);
        assert.strictEqual(coords[0].longitude, 0);
    });
    
    test('should match coordinates at lat 90 lng 180 boundary', () => {
        const testString = "[180, 90]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 90);
        assert.strictEqual(coords[0].longitude, 180);
    });
    
    test('should match coordinates at lat -90 lng -180 boundary', () => {
        const testString = "[-180, -90]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, -90);
        assert.strictEqual(coords[0].longitude, -180);
    });
    
    test('should match GeoJSON coordinates in text with surrounding content', () => {
        const testString = "The location is at [-73.9732, 40.7644] in New York";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 40.7644);
        assert.strictEqual(coords[0].longitude, -73.9732);
    });
    
    test('should match multiple GeoJSON coordinates in text', () => {
        const testString = "First location: [-73.9732, 40.7644] and second: [-74.0060, 40.7128]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 2, 'Should find exactly 2 coordinates');
    });
    
    test('should match GeoJSON with leading zeros', () => {
        const testString = "[018.0686, 059.3293]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should not match array without brackets', () => {
        const testString = "-73.9732, 40.7644";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match single value in brackets', () => {
        const testString = "[-73.9732]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match text without coordinates', () => {
        const testString = "This is just text without coordinates";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match invalid format with three numbers in brackets', () => {
        const testString = "[-73.9732, 40.7644, 100]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match empty brackets', () => {
        const testString = "[]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match brackets with only one number', () => {
        const testString = "[40.7644]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('Specific test', () => {
        const testString = "[18.06767 59.3]";
        const coords = findCoordinatesRegex(testString, [regexGeoJSON]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3);
        assert.strictEqual(coords[0].longitude, 18.06767);
    });
});