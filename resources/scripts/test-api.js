/**
 * Test API Module
 * Exposes window.__test for integration tests to inspect internal map state.
 * Only loaded in VS Code test contexts (webview with __testQuery message support).
 */

window.__test = {
    /**
     * Get all tracked overlay layer objects
     * @returns {Object} Mapping of layer IDs to layer configurations
     */
    getOverlayLayers: function() {
        return window.MapOverlays ? window.MapOverlays.addedOverlayLayers || {} : {};
    },

    /**
     * Get all sources currently on the map
     * @returns {Object} Style sources object
     */
    getMapSources: function() {
        var map = window.MapCore && window.MapCore.getMap();
        if (!map) { return {}; }
        var style = map.getStyle();
        return style ? style.sources || {} : {};
    },

    /**
     * Get visibility state of all sub-layers for a given overlay layer ID.
     * @param {string} layerId - The overlay layer ID
     * @returns {Object} Visibility per sub-layer type (circles, lines, fills)
     */
    getLayerVisibility: function(layerId) {
        var map = window.MapCore && window.MapCore.getMap();
        if (!map) { return { error: 'map not initialized' }; }
        var results = {};
        ['circles', 'lines', 'fills'].forEach(function(type) {
            var fullId = 'overlay-' + layerId + '-' + type;
            try {
                if (map.getLayer(fullId)) {
                    results[type] = map.getLayoutProperty(fullId, 'visibility') || 'visible';
                } else {
                    results[type] = 'not-found';
                }
            } catch (e) {
                results[type] = 'error: ' + e.message;
            }
        });
        return results;
    },

    /**
     * Get the source object for a given overlay layer
     * @param {string} layerId - The overlay layer ID
     * @returns {Object} Source info with exists flag
     */
    getOverlaySource: function(layerId) {
        var map = window.MapCore && window.MapCore.getMap();
        if (!map) { return { exists: false, error: 'map not initialized' }; }
        var source = map.getSource('overlay-' + layerId);
        return source ? { type: source.type, exists: true } : { exists: false };
    },

    /**
     * Check if an overlay layer's source and style layers exist on the map
     * @param {string} layerId - The overlay layer ID
     * @returns {boolean}
     */
    isOverlayLayerOnMap: function(layerId) {
        if (window.MapOverlays && window.MapOverlays.isOverlayLayerOnMap) {
            return window.MapOverlays.isOverlayLayerOnMap(layerId);
        }
        return false;
    },

    /**
     * Get comprehensive overlay state for all tracked overlays
     * @returns {Object} Full state dump
     */
    getAllOverlayState: function() {
        var tracked = window.__test.getOverlayLayers();
        var state = {};
        for (var id in tracked) {
            if (tracked.hasOwnProperty(id)) {
                state[id] = {
                    name: tracked[id].name || id,
                    visible: tracked[id].visible,
                    onMap: window.__test.isOverlayLayerOnMap(id),
                    visibility: window.__test.getLayerVisibility(id),
                    source: window.__test.getOverlaySource(id)
                };
            }
        }
        return state;
    },

    /**
     * Check if the test API is available
     * @returns {boolean} Always true
     */
    isAvailable: function() {
        return true;
    }
};
