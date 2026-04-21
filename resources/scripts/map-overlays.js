/**
 * Map Overlays Module
 * Handles overlay layer management (adding, removing, updating layers)
 */

// Track added overlay layers by ID
var addedOverlayLayers = {};

// Selected file layer ID constant
var SELECTED_FILE_LAYER_ID = 'selected-file';

/**
 * Update overlay layers on the map
 * @param {Array} layers - Array of layer configurations
 */
function updateOverlayLayers(layers) {
	var map = window.MapCore.getMap();
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	console.log('Updating overlay layers:', layers);

	// Get current overlay layer IDs
	var currentLayerIds = Object.keys(addedOverlayLayers);
	var newLayerIds = layers.map(function(l) { return l.id; });

	// Remove layers that are no longer in the list
	currentLayerIds.forEach(function(layerId) {
		if (newLayerIds.indexOf(layerId) === -1) {
			removeOverlayLayer(layerId);
		}
	});

	// Add or update layers
	layers.forEach(function(layer) {
		if (addedOverlayLayers[layer.id]) {
			// Layer already exists, update visibility/opacity if needed
			updateLayerVisibility(layer);
		} else {
			// Add new layer
			addOverlayLayer(layer);
		}
	});
}

/**
 * Add a single overlay layer
 * @param {Object} layer - Layer configuration
 */
function addOverlayLayer(layer) {
	var map = window.MapCore.getMap();
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	console.log('Adding overlay layer:', layer.id, layer.name);

	try {
		// Add source if it doesn't exist
		var sourceId = 'overlay-' + layer.id;
		
		if (layer.type === 'geojson') {
			// GeoJSON source
			var geojsonSource = {
				type: 'geojson',
				data: layer.source.data
			};
			map.addSource(sourceId, geojsonSource);

			// Add a default layer for GeoJSON (points as circles, lines as lines, polygons as fills)
			var circleLayer = {
				id: 'overlay-' + layer.id + '-circles',
				type: 'circle',
				source: sourceId,
				paint: {
					'circle-radius': 6,
					'circle-color': '#FF0000',
					'circle-opacity': (layer.opacity !== undefined ? layer.opacity : 1)
				}
			};
			if (layer.minzoom !== undefined) circleLayer.minzoom = layer.minzoom;
			if (layer.maxzoom !== undefined) circleLayer.maxzoom = layer.maxzoom;
			map.addLayer(circleLayer);

			var lineLayer = {
				id: 'overlay-' + layer.id + '-lines',
				type: 'line',
				source: sourceId,
				paint: {
					'line-color': '#FF0000',
					'line-width': 2,
					'line-opacity': (layer.opacity !== undefined ? layer.opacity : 1)
				}
			};
			if (layer.minzoom !== undefined) lineLayer.minzoom = layer.minzoom;
			if (layer.maxzoom !== undefined) lineLayer.maxzoom = layer.maxzoom;
			map.addLayer(lineLayer);

			var fillLayer = {
				id: 'overlay-' + layer.id + '-fills',
				type: 'fill',
				source: sourceId,
				paint: {
					'fill-color': '#FF0000',
					'fill-opacity': (layer.opacity !== undefined ? layer.opacity * 0.5 : 0.5)
				}
			};
			if (layer.minzoom !== undefined) fillLayer.minzoom = layer.minzoom;
			if (layer.maxzoom !== undefined) fillLayer.maxzoom = layer.maxzoom;
			map.addLayer(fillLayer);

		} else if (layer.type === 'vector') {
			// Vector tile source
			var vectorSource = {
				type: 'vector',
				url: layer.source.url
			};
			map.addSource(sourceId, vectorSource);

			// For vector tiles, we need to know the source-layer
			console.warn('Vector tile layers require additional configuration for source-layer');

		} else if (layer.type === 'raster') {
			// Raster tile source
			var rasterSource = {
				type: 'raster',
				url: layer.source.url,
				tileSize: layer.source.tileSize || 256
			};
			map.addSource(sourceId, rasterSource);

			var rasterLayer = {
				id: 'overlay-' + layer.id,
				type: 'raster',
				source: sourceId,
				paint: {
					'raster-opacity': (layer.opacity !== undefined ? layer.opacity : 1)
				}
			};
			if (layer.minzoom !== undefined) rasterLayer.minzoom = layer.minzoom;
			if (layer.maxzoom !== undefined) rasterLayer.maxzoom = layer.maxzoom;
			map.addLayer(rasterLayer);
		}

		// Track the added layer
		addedOverlayLayers[layer.id] = layer;
		console.log('Successfully added overlay layer:', layer.id);

	} catch (e) {
		console.error('Error adding overlay layer:', e);
	}
}

/**
 * Remove a single overlay layer
 * @param {string} layerId - Layer ID to remove
 */
function removeOverlayLayer(layerId) {
	var map = window.MapCore.getMap();
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	console.log('Removing overlay layer:', layerId);

	var sourceId = 'overlay-' + layerId;

	// Remove all layers associated with this overlay
	var layersToRemove = [];
	var style = map.getStyle();
	if (style && style.layers) {
		style.layers.forEach(function(layer) {
			if (layer.id.indexOf('overlay-' + layerId) === 0) {
				layersToRemove.push(layer.id);
			}
		});
	}

	// Remove layers
	layersToRemove.forEach(function(layerIdToRemove) {
		try {
			if (map.getLayer(layerIdToRemove)) {
				map.removeLayer(layerIdToRemove);
			}
		} catch (e) {
			console.warn('Error removing layer:', layerIdToRemove, e);
		}
	});

	// Remove source
	try {
		if (map.getSource(sourceId)) {
			map.removeSource(sourceId);
		}
	} catch (e) {
		console.warn('Error removing source:', sourceId, e);
	}

	// Remove from tracking
	delete addedOverlayLayers[layerId];
}

/**
 * Update layer visibility and data
 * @param {Object} layer - Layer configuration
 */
function updateLayerVisibility(layer) {
	var map = window.MapCore.getMap();
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	var layerId = layer.id;
	var sourceId = 'overlay-' + layerId;

	// For GeoJSON layers, update the source data if provided
	if (layer.type === 'geojson' && layer.source && layer.source.data) {
		var source = map.getSource(sourceId);
		if (source) {
			source.setData(layer.source.data);
		}
	}

	// Find all layers associated with this overlay
	var style = map.getStyle();
	if (style && style.layers) {
		style.layers.forEach(function(mapLayer) {
			if (mapLayer.id.indexOf('overlay-' + layerId) === 0) {
				try {
					if (map.getLayer(mapLayer.id)) {
						map.setLayoutProperty(mapLayer.id, 'visibility', layer.visible ? 'visible' : 'none');
					}
				} catch (e) {
					console.warn('Error updating layer visibility:', mapLayer.id, e);
				}
			}
		});
	}

	// Update tracking
	addedOverlayLayers[layerId] = layer;
}

/**
 * Update the selected file layer's GeoJSON source data
 * @param {Object} geojson - GeoJSON data
 */
function updateSelectedFileLayerSource(geojson) {
	var map = window.MapCore.getMap();
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	console.log('Updating selected file layer with GeoJSON data');

	var sourceId = 'overlay-' + SELECTED_FILE_LAYER_ID;
	var source = map.getSource(sourceId);

	// Check if the layer is currently visible (default to true if not tracked)
	var isVisible = true;
	if (addedOverlayLayers[SELECTED_FILE_LAYER_ID]) {
		isVisible = addedOverlayLayers[SELECTED_FILE_LAYER_ID].visible !== false;
	}

	if (source) {
		// Source exists, update the data
		source.setData(geojson);
		
		// Set layer visibility based on current state
		['circles', 'lines', 'fills'].forEach(function(layerType) {
			var layerId = 'overlay-' + SELECTED_FILE_LAYER_ID + '-' + layerType;
			if (map.getLayer(layerId)) {
				map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
			}
		});
	} else {
		// Source doesn't exist yet, create the layer
		var layer = {
			id: SELECTED_FILE_LAYER_ID,
			name: 'Selected file',
			type: 'geojson',
			source: {
				type: 'geojson',
				data: geojson
			},
			visible: isVisible
		};
		addOverlayLayer(layer);
	}

	// Note: Map fitting is handled by the extension via fitBoundingBox message
}

/**
 * Clear the selected file layer
 */
function clearSelectedFileLayer() {
	var map = window.MapCore.getMap();
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	console.log('Clearing selected file layer');

	var sourceId = 'overlay-' + SELECTED_FILE_LAYER_ID;
	var source = map.getSource(sourceId);

	if (source) {
		// Clear the data
		source.setData({ type: 'FeatureCollection', features: [] });
		
		// Hide the layers
		['circles', 'lines', 'fills'].forEach(function(layerType) {
			var layerId = 'overlay-' + SELECTED_FILE_LAYER_ID + '-' + layerType;
			if (map.getLayer(layerId)) {
				map.setLayoutProperty(layerId, 'visibility', 'none');
			}
		});
	}
}

// Export functions for use in other modules
window.MapOverlays = {
	updateOverlayLayers: updateOverlayLayers,
	addOverlayLayer: addOverlayLayer,
	removeOverlayLayer: removeOverlayLayer,
	updateLayerVisibility: updateLayerVisibility,
	updateSelectedFileLayerSource: updateSelectedFileLayerSource,
	clearSelectedFileLayer: clearSelectedFileLayer
};