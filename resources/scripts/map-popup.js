/**
 * Map Popup Module
 * Builds and displays feature-info popups on map click.
 * Loaded after map-core.js so it can attach to the MapLibre instance.
 */

/**
 * Attach a click handler to the map that shows a popup for the first
 * overlay feature under the cursor.
 * @param {object} map - The MapLibre GL map instance
 * @param {function} escapeHtmlFn - HTML-escaping function from map-core
 */
function attachPopupHandler(map, escapeHtmlFn) {
	var popup = null;

	map.on('click', function(e) {
		console.log('[MapPopup] Click event at:', e.lngLat);
		var lngLat = e.lngLat;
		var features = map.queryRenderedFeatures(e.point);
		console.log('[MapPopup] Found', features ? features.length : 0, 'features');

		if (!features || features.length === 0) {
			if (popup) {
				popup.remove();
				popup = null;
			}
			return;
		}

		// Log all features found
		for (var i = 0; i < features.length; i++) {
			console.log('[MapPopup] Feature', i, 'source:', features[i].source, 'layer:', features[i].layer.id);
		}

		// Find the first feature from an overlay layer (source starts with 'overlay-')
		var overlayFeature = null;
		for (var i = 0; i < features.length; i++) {
			var feature = features[i];
			var source = feature.source;
			if (source && source.indexOf('overlay-') === 0) {
				overlayFeature = feature;
				console.log('[MapPopup] Found overlay feature:', overlayFeature);
				break;
			}
		}

		if (overlayFeature) {
			console.log('[MapPopup] Feature properties:', overlayFeature.properties || {});
			var popupContent = buildPopupContent(overlayFeature, escapeHtmlFn);

			if (popup) {
				popup.remove();
			}
			popup = new maplibregl.Popup({
				closeButton: true,
				closeOnClick: true,
				maxWidth: '400px'
			})
				.setLngLat(lngLat)
				.setHTML(popupContent)
				.addTo(map);
		} else {
			if (popup) {
				popup.remove();
				popup = null;
			}
		}
	});
}

/**
 * Flatten a feature's properties (including nested objects) into a
 * single-level map of dotted keys to values.
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
 * Build the HTML content for a feature popup.
 * @param {object} overlayFeature - The clicked overlay feature
 * @param {function} escapeHtmlFn - HTML-escaping function from map-core
 * @returns {string} Popup HTML
 */
function buildPopupContent(overlayFeature, escapeHtmlFn) {
	var properties = overlayFeature.properties || {};
	var allProperties = flattenFeatureProperties(properties);

	var nameValue = properties.name || properties.title || properties.label || null;
	var descValue = properties.desc || properties.description || properties.note || properties.comment || null;

	// Re-check name/desc from flattened properties
	if (!nameValue) {
		nameValue = allProperties.name || allProperties.title || allProperties.label || null;
	}
	if (!descValue) {
		descValue = allProperties.desc || allProperties.description || allProperties.note || allProperties.comment || null;
	}

	var popupContent = '<div style="max-height: 300px; overflow-y: auto;">';

	if (nameValue) {
		popupContent += '<h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">' + escapeHtmlFn(String(nameValue)) + '</h3>';
	}

	if (descValue) {
		popupContent += '<p style="margin: 0 0 12px 0; font-size: 13px; color: #555; line-height: 1.4;">' + escapeHtmlFn(String(descValue)) + '</p>';
		popupContent += '<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 8px 0;" />';
	}

	popupContent += '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">';

	var propertyCount = 0;
	var skipKeys = { name: true, desc: true, title: true, description: true, label: true, note: true, comment: true };
	for (var key in allProperties) {
		if (allProperties.hasOwnProperty(key) && !skipKeys[key]) {
			propertyCount++;
			var value = allProperties[key];
			popupContent += '<tr style="border-bottom: 1px solid #e0e0e0;">';
			popupContent += '<td style="padding: 4px; font-weight: 500; color: #666; white-space: nowrap;">' + escapeHtmlFn(key) + '</td>';
			popupContent += '<td style="padding: 4px; color: #333; word-break: break-word;">' + escapeHtmlFn(String(value)) + '</td>';
			popupContent += '</tr>';
		}
	}

	if (propertyCount === 0 && !nameValue && !descValue) {
		popupContent += '<tr><td style="padding: 8px; color: #999;" colspan="2">No properties available</td></tr>';
	}

	popupContent += '</table></div>';
	return popupContent;
}

window.MapPopup = {
	attachPopupHandler: attachPopupHandler
};