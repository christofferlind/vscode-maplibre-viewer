import * as assert from 'assert';
import { regexXmlAttributes, findCoordinatesRegex } from '../../services/coordinateParser';

suite('Regex XmlAttributes Test Suite', () => {
    
    test('should match XML-style attributes with double quotes', () => {
        const testString = 'lat="50.085556" lon="14.4183102"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 50.085556);
        assert.strictEqual(coords[0].longitude, 14.4183102);
    });
    
    test('should match XML-style attributes with single quotes', () => {
        const testString = "lat='50.085556' lon='14.4183102'";
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 50.085556);
        assert.strictEqual(coords[0].longitude, 14.4183102);
    });
    
    test('should match with spaces around equals sign', () => {
        const testString = 'lat = "50.085556" lon = "14.4183102"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 50.085556);
        assert.strictEqual(coords[0].longitude, 14.4183102);
    });
    
    test('should match negative latitude', () => {
        const testString = 'lat="-33.8523" lon="151.2104"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, -33.8523);
        assert.strictEqual(coords[0].longitude, 151.2104);
    });
    
    test('should match negative longitude', () => {
        const testString = 'lat="40.7128" lon="-74.0060"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 40.7128);
        assert.strictEqual(coords[0].longitude, -74.006);
    });
    
    test('should match both negative coordinates', () => {
        const testString = 'lat="-33.8523" lon="-74.0060"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, -33.8523);
        assert.strictEqual(coords[0].longitude, -74.006);
    });
    
    test('should match integer coordinates', () => {
        const testString = 'lat="59" lon="18"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59);
        assert.strictEqual(coords[0].longitude, 18);
    });
    
    test('should match coordinates with many decimal places', () => {
        const testString = 'lat="59.3293123456" lon="18.0686123456"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293123456);
        assert.strictEqual(coords[0].longitude, 18.0686123456);
    });
    
    test('should match coordinates at equator', () => {
        const testString = 'lat="0" lon="18.0686"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 0);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match coordinates at prime meridian', () => {
        const testString = 'lat="51.5074" lon="0"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 51.5074);
        assert.strictEqual(coords[0].longitude, 0);
    });
    
    test('should match coordinates at lat 90 lng 180 boundary', () => {
        const testString = 'lat="90" lon="180"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 90);
        assert.strictEqual(coords[0].longitude, 180);
    });
    
    test('should match coordinates at lat -90 lng -180 boundary', () => {
        const testString = 'lat="-90" lon="-180"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, -90);
        assert.strictEqual(coords[0].longitude, -180);
    });
    
    test('should match coordinates in text with surrounding content', () => {
        const testString = 'The location is at lat="59.3293" lon="18.0686" in Stockholm';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should match multiple coordinates in text', () => {
        const testString = 'lat="59.3293" lon="18.0686" and lat="40.7128" lon="-74.0060"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 2, 'Should find exactly 2 coordinates');
    });
    
    test('should match coordinates with leading zeros', () => {
        const testString = 'lat="059.3293" lon="018.0686"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 1, 'Should find one coordinate');
        assert.strictEqual(coords[0].latitude, 59.3293);
        assert.strictEqual(coords[0].longitude, 18.0686);
    });
    
    test('should not match single attribute', () => {
        const testString = 'lat="59.3293"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match text without attributes', () => {
        const testString = 'This is just text without coordinates';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match with missing quotes', () => {
        const testString = 'lat=59.3293 lon=18.0686';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match with reversed order', () => {
        const testString = 'lon="18.0686" lat="59.3293"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
    
    test('should not match invalid format', () => {
        const testString = 'latitude="59.3293" longitude="18.0686"';
        const coords = findCoordinatesRegex(testString, [regexXmlAttributes]);
        
        assert.strictEqual(coords.length, 0, 'Should not find any coordinates');
    });
});
