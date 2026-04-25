import * as assert from 'assert';
import { createTestBookmark } from '../testUtils/testBookmarkFactory';

/**
 * Mock MapLibre Map instance that captures flyTo calls
 */
class MockMapLibreMap {
    public flyToCalls: Array<{
        center: [number, number];
        zoom: number;
        bearing: number;
        pitch: number;
        duration: number;
    }> = [];
    
    private _center: [number, number] = [0, 0];
    private _zoom: number = 1;
    private _bearing: number = 0;
    private _pitch: number = 0;
    private _styleLoaded: boolean = true;
    
    flyTo(options: {
        center: [number, number];
        zoom: number;
        bearing?: number;
        pitch?: number;
        duration?: number;
    }): this {
        this.flyToCalls.push({
            center: options.center,
            zoom: options.zoom,
            bearing: options.bearing ?? 0,
            pitch: options.pitch ?? 0,
            duration: options.duration ?? 0
        });
        
        // Simulate the map moving to the new position
        this._center = options.center;
        this._zoom = options.zoom;
        this._bearing = options.bearing ?? 0;
        this._pitch = options.pitch ?? 0;
        
        return this;
    }
    
    getCenter(): { lng: number; lat: number } {
        return { lng: this._center[0], lat: this._center[1] };
    }
    
    getZoom(): number {
        return this._zoom;
    }
    
    getBearing(): number {
        return this._bearing;
    }
    
    getPitch(): number {
        return this._pitch;
    }
    
    isStyleLoaded(): boolean {
        return this._styleLoaded;
    }
    
    /**
     * Clears all captured flyTo calls
     */
    clearCalls(): void {
        this.flyToCalls = [];
    }
    
    /**
     * Gets the last flyTo call
     */
    getLastFlyToCall(): typeof this.flyToCalls[0] | undefined {
        return this.flyToCalls[this.flyToCalls.length - 1];
    }
}

/**
 * Simulates the flyToBookmark function from map-navigation.js
 * This is the actual logic that runs in the webview
 *
 * NOTE: The implementation uses `||` operator which treats 0 as falsy.
 * This means zoom=0, bearing=0, pitch=0 will use defaults.
 * This matches the actual behavior in map-navigation.js line 137-139.
 */
function flyToBookmark(bookmark: { center?: { latitude: number; longitude: number }; zoom?: number; bearing?: number; pitch?: number }, map: MockMapLibreMap): void {
    if (!bookmark || !bookmark.center) {
        console.warn('Invalid bookmark data');
        return;
    }
    
    // This matches the actual implementation in map-navigation.js
    // which uses || operator (treats 0 as falsy)
    map.flyTo({
        center: [bookmark.center.longitude, bookmark.center.latitude],
        zoom: bookmark.zoom || 14,  // NOTE: zoom=0 will default to 14
        bearing: bookmark.bearing || 0,
        pitch: bookmark.pitch || 0,
        duration: 1500
    });
}

suite('MapLibre Map Center Tests', () => {
    let mockMap: MockMapLibreMap;
    
    setup(() => {
        mockMap = new MockMapLibreMap();
    });
    
    test('should set map center to bookmark coordinates', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 59.3293, longitude: 18.0686 }
        });
        
        flyToBookmark(bookmark, mockMap);
        
        const center = mockMap.getCenter();
        assert.strictEqual(center.lat, bookmark.center.latitude, 'Map center latitude should match bookmark latitude');
        assert.strictEqual(center.lng, bookmark.center.longitude, 'Map center longitude should match bookmark longitude');
    });
    
    test('should set map center with high precision coordinates', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 59.329323456789, longitude: 18.068698765432 }
        });
        
        flyToBookmark(bookmark, mockMap);
        
        const center = mockMap.getCenter();
        assert.strictEqual(center.lat, bookmark.center.latitude, 'Map center should preserve high precision latitude');
        assert.strictEqual(center.lng, bookmark.center.longitude, 'Map center should preserve high precision longitude');
    });
    
    test('should set map center with negative coordinates', () => {
        const bookmark = createTestBookmark({
            center: { latitude: -33.8688, longitude: -151.2093 }
        });
        
        flyToBookmark(bookmark, mockMap);
        
        const center = mockMap.getCenter();
        assert.strictEqual(center.lat, -33.8688, 'Map center should handle negative latitude');
        assert.strictEqual(center.lng, -151.2093, 'Map center should handle negative longitude');
    });
    
    test('should set map center at equator and prime meridian', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 0, longitude: 0 }
        });
        
        flyToBookmark(bookmark, mockMap);
        
        const center = mockMap.getCenter();
        assert.strictEqual(center.lat, 0, 'Map center latitude should be 0');
        assert.strictEqual(center.lng, 0, 'Map center longitude should be 0');
    });
    
    test('should set map center at maximum latitude (near poles)', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 85, longitude: 0 }
        });
        
        flyToBookmark(bookmark, mockMap);
        
        const center = mockMap.getCenter();
        assert.strictEqual(center.lat, 85, 'Map center should handle near-pole latitude');
    });
    
    test('should set map center at international date line', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 0, longitude: 180 }
        });
        
        flyToBookmark(bookmark, mockMap);
        
        const center = mockMap.getCenter();
        assert.strictEqual(center.lng, 180, 'Map center should handle longitude at date line');
    });
    
    test('should set map center with longitude wrapping', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 0, longitude: -180 }
        });
        
        flyToBookmark(bookmark, mockMap);
        
        const center = mockMap.getCenter();
        assert.strictEqual(center.lng, -180, 'Map center should handle negative longitude at date line');
    });
    
    test('should preserve zoom level from bookmark', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 16
        });
        
        flyToBookmark(bookmark, mockMap);
        
        assert.strictEqual(mockMap.getZoom(), 16, 'Map zoom should match bookmark zoom');
    });
    
    test('should use default zoom when bookmark has no zoom', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: undefined
        });
        
        flyToBookmark(bookmark, mockMap);
        
        assert.strictEqual(mockMap.getZoom(), 14, 'Map should use default zoom of 14');
    });
    
    test('should preserve bearing from bookmark', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 59.3293, longitude: 18.0686 },
            bearing: 45
        });
        
        flyToBookmark(bookmark, mockMap);
        
        assert.strictEqual(mockMap.getBearing(), 45, 'Map bearing should match bookmark bearing');
    });
    
    test('should preserve pitch from bookmark', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 59.3293, longitude: 18.0686 },
            pitch: 30
        });
        
        flyToBookmark(bookmark, mockMap);
        
        assert.strictEqual(mockMap.getPitch(), 30, 'Map pitch should match bookmark pitch');
    });
    
    test('should preserve all view parameters together', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 18,
            bearing: 90,
            pitch: 45
        });
        
        flyToBookmark(bookmark, mockMap);
        
        const center = mockMap.getCenter();
        assert.strictEqual(center.lat, 59.3293, 'Latitude should match');
        assert.strictEqual(center.lng, 18.0686, 'Longitude should match');
        assert.strictEqual(mockMap.getZoom(), 18, 'Zoom should match');
        assert.strictEqual(mockMap.getBearing(), 90, 'Bearing should match');
        assert.strictEqual(mockMap.getPitch(), 45, 'Pitch should match');
    });
    
    test('should not change map when bookmark has no center', () => {
        const bookmark = createTestBookmark({
            center: undefined
        });
        
        // Set initial position
        mockMap.flyTo({ center: [10, 20], zoom: 10 });
        mockMap.clearCalls();
        
        flyToBookmark(bookmark, mockMap);
        
        // Map should not have received any flyTo call
        assert.strictEqual(mockMap.flyToCalls.length, 0, 'Map should not receive flyTo call for invalid bookmark');
        // Map should still be at the previous position
        const center = mockMap.getCenter();
        assert.strictEqual(center.lng, 10, 'Map should remain at previous longitude');
        assert.strictEqual(center.lat, 20, 'Map should remain at previous latitude');
    });
    
    test('should not change map when bookmark is null', () => {
        // Set initial position
        mockMap.flyTo({ center: [10, 20], zoom: 10 });
        mockMap.clearCalls();
        
        flyToBookmark(null as unknown as ReturnType<typeof createTestBookmark>, mockMap);
        
        // Map should not have received any flyTo call
        assert.strictEqual(mockMap.flyToCalls.length, 0, 'Map should not receive flyTo call for null bookmark');
    });
    
    test('should capture flyTo call with correct parameters', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 15,
            bearing: 30,
            pitch: 20
        });
        
        flyToBookmark(bookmark, mockMap);
        
        const flyToCall = mockMap.getLastFlyToCall();
        assert.ok(flyToCall, 'flyTo should have been called');
        assert.deepStrictEqual(flyToCall?.center, [18.0686, 59.3293], 'flyTo center should be [lng, lat]');
        assert.strictEqual(flyToCall?.zoom, 15, 'flyTo zoom should match');
        assert.strictEqual(flyToCall?.bearing, 30, 'flyTo bearing should match');
        assert.strictEqual(flyToCall?.pitch, 20, 'flyTo pitch should match');
        assert.strictEqual(flyToCall?.duration, 1500, 'flyTo duration should be 1500ms');
    });
    
    test('should handle multiple sequential bookmark navigations', () => {
        const bookmark1 = createTestBookmark({
            id: 'bm1',
            center: { latitude: 59.3293, longitude: 18.0686 },
            zoom: 10
        });
        const bookmark2 = createTestBookmark({
            id: 'bm2',
            center: { latitude: 55.6761, longitude: 12.5683 },
            zoom: 12
        });
        const bookmark3 = createTestBookmark({
            id: 'bm3',
            center: { latitude: 48.8566, longitude: 2.3522 },
            zoom: 14
        });
        
        flyToBookmark(bookmark1, mockMap);
        let center = mockMap.getCenter();
        assert.strictEqual(center.lat, 59.3293, 'First bookmark latitude');
        assert.strictEqual(mockMap.getZoom(), 10, 'First bookmark zoom');
        
        flyToBookmark(bookmark2, mockMap);
        center = mockMap.getCenter();
        assert.strictEqual(center.lat, 55.6761, 'Second bookmark latitude');
        assert.strictEqual(mockMap.getZoom(), 12, 'Second bookmark zoom');
        
        flyToBookmark(bookmark3, mockMap);
        center = mockMap.getCenter();
        assert.strictEqual(center.lat, 48.8566, 'Third bookmark latitude');
        assert.strictEqual(mockMap.getZoom(), 14, 'Third bookmark zoom');
        
        // Should have 3 flyTo calls total
        assert.strictEqual(mockMap.flyToCalls.length, 3, 'Should have 3 flyTo calls');
    });
    
    test('should handle maximum zoom level (24)', () => {
        const maxZoomBookmark = createTestBookmark({
            center: { latitude: 0, longitude: 0 },
            zoom: 24
        });
        
        flyToBookmark(maxZoomBookmark, mockMap);
        assert.strictEqual(mockMap.getZoom(), 24, 'Should handle zoom level 24');
    });
    
    test('should use default zoom for zoom level 0 (implementation uses || operator)', () => {
        // NOTE: This documents the actual behavior in map-navigation.js line 137
        // which uses `bookmark.zoom || 14` - treating 0 as falsy
        const minZoomBookmark = createTestBookmark({
            center: { latitude: 0, longitude: 0 },
            zoom: 0
        });
        
        flyToBookmark(minZoomBookmark, mockMap);
        // Due to || operator, zoom=0 defaults to 14
        assert.strictEqual(mockMap.getZoom(), 14, 'Zoom level 0 defaults to 14 due to || operator');
    });
    
    test('should handle fractional zoom levels', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 0, longitude: 0 },
            zoom: 14.5
        });
        
        flyToBookmark(bookmark, mockMap);
        assert.strictEqual(mockMap.getZoom(), 14.5, 'Should handle fractional zoom');
    });
    
    test('should handle maximum bearing (360)', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 0, longitude: 0 },
            bearing: 360
        });
        
        flyToBookmark(bookmark, mockMap);
        assert.strictEqual(mockMap.getBearing(), 360, 'Should handle bearing of 360');
    });
    
    test('should handle maximum pitch (60)', () => {
        const bookmark = createTestBookmark({
            center: { latitude: 0, longitude: 0 },
            pitch: 60
        });
        
        flyToBookmark(bookmark, mockMap);
        assert.strictEqual(mockMap.getPitch(), 60, 'Should handle pitch of 60');
    });
    
    test('should verify center coordinates are in correct order [longitude, latitude]', () => {
        // MapLibre uses [lng, lat] order for center
        const bookmark = createTestBookmark({
            center: { latitude: 40.7128, longitude: -74.0060 } // New York
        });
        
        flyToBookmark(bookmark, mockMap);
        
        const flyToCall = mockMap.getLastFlyToCall();
        assert.ok(flyToCall, 'flyTo should have been called');
        // Verify the center array is [longitude, latitude] as MapLibre expects
        assert.strictEqual(flyToCall!.center[0], -74.0060, 'First element should be longitude');
        assert.strictEqual(flyToCall!.center[1], 40.7128, 'Second element should be latitude');
    });
});