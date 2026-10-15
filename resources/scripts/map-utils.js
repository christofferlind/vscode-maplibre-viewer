/**
 * Map Utilities Module
 * Handles error overlays
 */

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
 * Check if a source id follows the overlay source naming convention
 * ('overlay-' prefix). Shared by overlay sync and the basemap-switch
 * transformStyle merge so both act on the same overlay set.
 * @param {string} sourceId - Source id or layer source value to test
 * @returns {boolean} True when the id is an overlay source id
 */
function isOverlaySourceId(sourceId) {
	return typeof sourceId === 'string' && sourceId.indexOf('overlay-') === 0;
}

/**
 * Check if a style layer targets an overlay source.
 * @param {Object} layer - Style layer definition
 * @returns {boolean} True when the layer references an overlay source
 */
function isOverlayLayer(layer) {
	return !!layer && isOverlaySourceId(layer.source);
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
 * Clamps a requested fit padding so the map still has positive available
 * space. MapLibre's fitBounds silently refuses to fit (cameraForBounds
 * returns undefined) when the padding fully consumes the smaller container
 * dimension, which previously made 'Show on Map' a silent no-op whenever the
 * map panel was small or collapsed.
 * @param {number} requested - Requested padding in pixels
 * @param {object} map - The MapLibre GL map instance
 * @returns {number} Padding clamped to the container size
 */
function resolveFitPadding(requested, map) {
	var container = map.getContainer ? map.getContainer() : null;
	if (!container) {
		return requested;
	}
	var width = container.offsetWidth || 0;
	var height = container.offsetHeight || 0;
	// A small margin keeps the fit animation visibly padded even in tiny
	// panels while guaranteeing a positive available area.
	var paddingBudget = Math.floor(Math.max(0, Math.min(width, height) - 4) / 2);
	if (paddingBudget <= 0) {
		return 4;
	}
	return Math.min(requested, paddingBudget);
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
		duration: window.MapUtils.getConfig('flyToDuration', 500),
		maxZoom: 16
	};
	// Normalize corners so an inverted or swapped bounds array still fits;
	// MapLibre warns and refuses to fit inverted bounds.
	var swLng = Math.min(bounds[0][0], bounds[1][0]);
	var neLng = Math.max(bounds[0][0], bounds[1][0]);
	var swLat = Math.min(bounds[0][1], bounds[1][1]);
	var neLat = Math.max(bounds[0][1], bounds[1][1]);
	var container = map.getContainer ? map.getContainer() : null;
	// Nothing sensible can be fitted while the map has no layout yet.
	if ((!container || ((container.offsetWidth || 0) <= 0 && (container.offsetHeight || 0) <= 0))) {
		return;
	}
	var normalized = [
		[swLng, swLat],
		[neLng, neLat]
	];
	var finalOptions = Object.assign({}, defaultOptions, options);
	finalOptions.padding = resolveFitPadding(finalOptions.padding, map);
	map.fitBounds(normalized, finalOptions);
}

// Export functions for use in other modules
window.MapUtils = {
	showErrorOverlay: showErrorOverlay,
	hideErrorOverlay: hideErrorOverlay,
	createViewState: createViewState,
	withMap: withMap,
	getConfig: getConfig,
	createGeoJsonLayerDefinitions: createGeoJsonLayerDefinitions,
	fitBoundsWithDefaults: fitBoundsWithDefaults,
	isOverlaySourceId: isOverlaySourceId,
	isOverlayLayer: isOverlayLayer
};