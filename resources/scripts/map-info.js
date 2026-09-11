/**
 * Map Info Module
 * Listens for map clicks and reports the clicked location plus all rendered
 * features under the cursor (both basemap and overlay layers) to the
 * extension for display in the Map Information view.
 * Loaded after map-core.js so it can attach to the MapLibre instance.
 */

/**
 * Maximum number of features reported per click. Prevents flooding the
 * extension host when clicking on dense basemap layers (e.g. label layers
 * at low zoom levels can return dozens of features).
 */
var MAX_FEATURES_PER_CLICK = 50;

var clickHandlerAttached = false;

/**
 * Flatten a feature's properties (including nested objects) into a
 * single-level map of dotted keys to values. Mirrors the flattening used by
 * map-popup.js so the tree view and popup show the same property set.
 * @param {object} properties - Raw feature properties
 * @returns {object} Flattened properties keyed by dotted path
 */
function flattenFeatureProperties(properties) {
	var allProperties = {};
	function flattenProperties(obj, prefix) {
		for (var key in obj) {
			if (obj.hasOwnProperty(key)) {
				var value = obj[key];
				var fullKey = prefix ? prefix + '.' + key : key;

				if (value !== null && value !== undefined) {
					if (typeof value === 'object' && !Array.isArray(value)) {
						flattenProperties(value, fullKey);
					} else {
						allProperties[fullKey] = value;
					}
				}
			}
		}
	}
	flattenProperties(properties, '');
	return allProperties;
}

/**
 * Reduce a rendered feature to the plain serializable shape sent to the
 * extension. Properties are flattened and non-JSON values are stringified.
 * @param {object} feature - A feature from map.queryRenderedFeatures
 * @returns {object} Serializable feature info
 */
function serializeFeature(feature) {
	var layer = feature.layer || {};
	var serialized = {
		source: typeof feature.source === 'string' ? feature.source : '',
		sourceLayer: feature.sourceLayer || undefined,
		layerId: typeof layer.id === 'string' ? layer.id : '',
		layerName: undefined,
		geometryType: feature.geometry && feature.geometry.type ? feature.geometry.type : 'Unknown',
		properties: {}
	};

	var flattened = flattenFeatureProperties(feature.properties || {});
	// layer.metadata may carry a human-readable name from the style definition
	var metadata = layer.metadata || {};
	var metadataName = metadata.name || metadata.title;
	if (typeof metadataName === 'string' && metadataName.length > 0) {
		serialized.layerName = metadataName;
	}

	for (var key in flattened) {
		if (flattened.hasOwnProperty(key)) {
			var value = flattened[key];
			if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
				serialized.properties[key] = value;
			} else {
				serialized.properties[key] = String(value);
			}
		}
	}

	return serialized;
}

/**
 * Attach the click handler that gathers feature information and posts it to
 * the extension. Safe to call multiple times: the handler is only attached
 * once per map instance (the map is recreated on basemap switches).
 * @param {object} map - The MapLibre GL map instance
 */
function attachInfoHandler(map) {
	if (clickHandlerAttached) {
		return;
	}
	clickHandlerAttached = true;

	map.on('click', function(e) {
		var features = map.queryRenderedFeatures(e.point) || [];
		console.log('[MapInfo] Click at', e.lngLat, 'found', features.length, 'feature(s)');

		var serialized = [];
		for (var i = 0; i < features.length && serialized.length < MAX_FEATURES_PER_CLICK; i++) {
			serialized.push(serializeFeature(features[i]));
		}

		vscode.postMessage({
			type: 'featureInfoUpdate',
			lngLat: {
				lng: e.lngLat.lng,
				lat: e.lngLat.lat
			},
			features: serialized
		});
	});
}

/**
 * Test API: reports whether the click handler has been attached.
 * @returns {boolean} True if the info click handler is attached
 */
function isInfoHandlerAttached() {
	return clickHandlerAttached;
}

window.MapInfo = {
	attachInfoHandler: attachInfoHandler,
	isInfoHandlerAttached: isInfoHandlerAttached
};