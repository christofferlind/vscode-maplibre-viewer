/**
 * Map Utilities Module
 * Handles loading and error overlays
 */

/**
 * Show loading overlay
 * @param {string} [message='Loading map...'] - Message to display
 */
function showLoadingOverlay(message) {
	var overlay = document.getElementById('loading-overlay');
	var span = overlay ? overlay.querySelector('span') : null;
	if (span) {
		span.textContent = message || 'Loading map...';
	}
	if (overlay) {
		overlay.classList.add('visible');
	}
}

/**
 * Hide loading overlay
 */
function hideLoadingOverlay() {
	var overlay = document.getElementById('loading-overlay');
	if (overlay) {
		overlay.classList.remove('visible');
	}
}

/**
 * Show error overlay
 * @param {string} message - Error message to display
 */
function showErrorOverlay(message) {
	var overlay = document.getElementById('error-overlay');
	var messageEl = document.getElementById('error-message');
	if (messageEl) {
		messageEl.textContent = message;
	}
	if (overlay) {
		overlay.classList.add('visible');
	}
	hideLoadingOverlay();
}

/**
 * Hide error overlay
 */
function hideErrorOverlay() {
	var overlay = document.getElementById('error-overlay');
	if (overlay) {
		overlay.classList.remove('visible');
	}
}

/**
 * Creates a view state object from the current map state.
 * @param {object} map - The MapLibre GL map instance
 * @returns {object} View state object with center, zoom, bearing, pitch
 */
function createViewState(map) {
	var center = map.getCenter();
	return {
		center: {
			lat: center.lat,
			lng: center.lng
		},
		zoom: map.getZoom(),
		bearing: map.getBearing(),
		pitch: map.getPitch()
	};
}

/**
 * Executes a callback with the map instance if available.
 * @param {function} callback - Function to execute with the map instance
 * @returns {boolean} True if callback was executed, false if map not available
 */
function withMap(callback) {
	var map = window.MapCore ? window.MapCore.getMap() : null;
	if (!map) {
		console.warn('Map not initialized');
		return false;
	}
	callback(map);
	return true;
}

/**
 * Gets a configuration value with a default fallback.
 * @param {string} key - The configuration key
 * @param {*} defaultValue - The default value if key not found
 * @returns {*} The configuration value or default
 */
function getConfig(key, defaultValue) {
	if (!window.MapConfig) {
		return defaultValue;
	}
	return window.MapConfig[key] !== undefined ? window.MapConfig[key] : defaultValue;
}

/**
 * Creates GeoJSON layer definitions for circle, line, and fill layers.
 * @param {string} sourceId - The source ID for the layers
 * @param {object} options - Optional paint property overrides
 * @returns {object} Object containing circle, line, and fill layer definitions
 */
function createGeoJsonLayerDefinitions(sourceId, options) {
	options = options || {};
	var prefix = options.prefix !== undefined ? options.prefix : 'overlay-';

	return {
		circle: {
			id: prefix + sourceId + '-circles',
			type: 'circle',
			source: sourceId,
			filter: ['==', '$type', 'Point'],
			paint: options.circlePaint || {
				'circle-radius': 6,
				'circle-color': '#FF0000',
				'circle-opacity': 0.8
			}
		},
		line: {
			id: prefix + sourceId + '-lines',
			type: 'line',
			source: sourceId,
			filter: ['==', '$type', 'LineString'],
			paint: options.linePaint || {
				'line-color': '#FF0000',
				'line-width': 2,
				'line-opacity': 0.8
			}
		},
		fill: {
			id: prefix + sourceId + '-fills',
			type: 'fill',
			source: sourceId,
			filter: ['==', '$type', 'Polygon'],
			paint: options.fillPaint || {
				'fill-color': '#FF0000',
				'fill-opacity': 0.3
			}
		}
	};
}

/**
 * Fits the map to bounds with default options.
 * @param {object} map - The MapLibre GL map instance
 * @param {array} bounds - [west, south, east, north] bounds array
 * @param {object} options - Optional overrides for default fitBounds options
 */
function fitBoundsWithDefaults(map, bounds, options) {
	options = options || {};
	var defaultOptions = {
		padding: 50,
		duration: window.MapUtils.getConfig('flyToDuration', 1500),
		maxZoom: 16
	};
	map.fitBounds(bounds, Object.assign({}, defaultOptions, options));
}

// Export functions for use in other modules
window.MapUtils = {
	showLoadingOverlay: showLoadingOverlay,
	hideLoadingOverlay: hideLoadingOverlay,
	showErrorOverlay: showErrorOverlay,
	hideErrorOverlay: hideErrorOverlay,
	createViewState: createViewState,
	withMap: withMap,
	getConfig: getConfig,
	createGeoJsonLayerDefinitions: createGeoJsonLayerDefinitions,
	fitBoundsWithDefaults: fitBoundsWithDefaults
};