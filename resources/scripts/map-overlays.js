/**
 * Map Overlays Module
 * Handles overlay layer management (adding, removing, updating layers)
 */

// Track added overlay layers by ID - maps layer ID to the full layer config
var addedOverlayLayers = {};

// Snapshot of overlay configs preserved across style changes for self-healing
var _persistedOverlayLayers = {};

// Selected file layer ID constant
var SELECTED_FILE_LAYER_ID = 'selected-file';

/**
 * Save overlay layer data BEFORE a map style change.
 * Called by map-core.js just before map.setStyle(), which destroys all
 * programmatically-added layers and sources. The saved data is used to
 * self-heal overlay state after the new style loads, independently of
 * whether the extension sends a fresh updateOverlayLayers message.
 */
function persistOverlaysForStyleChange() {
	console.log('[MapOverlays] Persisting overlay data for style change');
	_persistedOverlayLayers = {};
	for (var id in addedOverlayLayers) {
		if (addedOverlayLayers.hasOwnProperty(id)) {
			_persistedOverlayLayers[id] = addedOverlayLayers[id];
		}
	}
	console.log('[MapOverlays] Persisted ' + Object.keys(_persistedOverlayLayers).length + ' overlay(s)');
}

/**
 * Re-apply overlay layers that were saved before a style change.
 * Called after the new map style has finished loading. This ensures
 * overlays survive style changes regardless of extension message timing.
 */
function restoreOverlaysAfterStyleChange() {
	var persistedIds = Object.keys(_persistedOverlayLayers);
	if (persistedIds.length === 0) {
		console.log('[MapOverlays] No persisted overlays to restore');
		return;
	}
	console.log('[MapOverlays] Restoring ' + persistedIds.length + ' persisted overlay(s)');
	// Reset tracking since setStyle() destroyed everything
	addedOverlayLayers = {};
	for (var i = 0; i < persistedIds.length; i++) {
		var id = persistedIds[i];
		var layer = _persistedOverlayLayers[id];
		console.log('[MapOverlays] Restoring overlay:', id, layer.name);
		addOverlayLayer(layer);
	}
	// Clear persisted state once restored
	_persistedOverlayLayers = {};
}

/**
 * Reset all overlay tracking state without removing anything from the map.
 * Called when overlay tracking is known to be stale (e.g., after setStyle()).
 */
function resetOverlayTracking() {
	console.log('[MapOverlays] Resetting overlay tracking state');
	addedOverlayLayers = {};
}

/**
 * Verify that an overlay layer's source and map layers actually exist on the map.
 * @param {string} layerId - The overlay layer ID
 * @returns {boolean} True if all sources and layers exist on the map
 */
function isOverlayLayerOnMap(layerId) {
	var map = window.MapCore.getMap();
	if (!map) {
		return false;
	}
	var sourceId = 'overlay-' + layerId;
	var source = map.getSource(sourceId);
	if (!source) {
		return false;
	}
	var style = map.getStyle();
	if (!style || !style.layers) {
		return false;
	}
	for (var i = 0; i < style.layers.length; i++) {
		if (style.layers[i].id.indexOf('overlay-' + layerId) === 0) {
			return true;
		}
	}
	return false;
}

/**
 * Update overlay layers on the map.
 * Main entry point called by the extension when overlay state changes.
 * @param {Array} layers - Array of layer configurations
 */
function updateOverlayLayers(layers) {
	if (!window.MapCore.isMapReady()) {
		console.log('[MapOverlays] Map not ready, queueing updateOverlayLayers');
		window.MapCore.queueOperation(function() {
			updateOverlayLayers(layers);
		});
		return;
	}

	var map = window.MapCore.getMap();
	console.log('[MapOverlays] updateOverlayLayers called with ' + layers.length + ' layer(s)');

	// Build a set of layer IDs that should exist
	var newLayerIdSet = {};
	for (var i = 0; i < layers.length; i++) {
		newLayerIdSet[layers[i].id] = true;
	}

	// Remove layers that are no longer in the list
	var currentIds = Object.keys(addedOverlayLayers);
	for (var j = 0; j < currentIds.length; j++) {
		if (!newLayerIdSet[currentIds[j]]) {
			removeOverlayLayer(currentIds[j]);
		}
	}

	// Add or update layers - always verify against actual map state
	for (var k = 0; k < layers.length; k++) {
		var layer = layers[k];
		if (isOverlayLayerOnMap(layer.id)) {
			console.log('[MapOverlays] Layer ' + layer.id + ' already on map, updating visibility');
			updateLayerVisibility(layer);
		} else {
			console.log('[MapOverlays] Layer ' + layer.id + ' NOT on map, adding fresh');
			delete addedOverlayLayers[layer.id];
			addOverlayLayer(layer);
		}
	}
}

/**
 * Add a single overlay layer.
 * Idempotent - if the source or layers already exist on the map, they are
 * cleaned up first before re-adding to prevent duplicates caused by stale
 * tracking after map.setStyle() destroys layers.
 * @param {Object} layer - Layer configuration
 */
function addOverlayLayer(layer) {
	if (!window.MapUtils.withMap(function(map) {
		console.log('Adding overlay layer:', layer.id, layer.name);

		try {
			var sourceId = 'overlay-' + layer.id;

			// Clean up any stale layers/sources that may exist from a prior
			// style that was replaced by map.setStyle(). This handles the case
			// where the tracking object was reset but map layers lingered.
			_removeLayerLayersAndSource(map, layer.id);

			if (layer.type === 'geojson') {
				// GeoJSON source
				var geojsonSource = {
					type: 'geojson',
					data: layer.source.data
				};
				map.addSource(sourceId, geojsonSource);

				// Create layer definitions using the factory
				var layerOpacity = layer.opacity !== undefined ? layer.opacity : 1;
				var layerDefinitions = window.MapUtils.createGeoJsonLayerDefinitions(sourceId, {
					prefix: '',
					circlePaint: {
						'circle-radius': 6,
						'circle-color': '#FF0000',
						'circle-opacity': layerOpacity
					},
					linePaint: {
						'line-color': '#FF0000',
						'line-width': 2,
						'line-opacity': layerOpacity
					},
					fillPaint: {
						'fill-color': '#FF0000',
						'fill-opacity': layerOpacity * 0.5
					}
				});

				// Add circle layer
				var circleLayer = layerDefinitions.circle;
				if (layer.minzoom !== undefined) circleLayer.minzoom = layer.minzoom;
				if (layer.maxzoom !== undefined) circleLayer.maxzoom = layer.maxzoom;
				map.addLayer(circleLayer);

				// Add line layer
				var lineLayer = layerDefinitions.line;
				if (layer.minzoom !== undefined) lineLayer.minzoom = layer.minzoom;
				if (layer.maxzoom !== undefined) lineLayer.maxzoom = layer.maxzoom;
				map.addLayer(lineLayer);

				// Add fill layer
				var fillLayer = layerDefinitions.fill;
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
	})) return;
}

/**
 * Remove a single overlay layer
 * @param {string} layerId - Layer ID to remove
 */
function removeOverlayLayer(layerId) {
	if (!window.MapUtils.withMap(function(map) {
		console.log('Removing overlay layer:', layerId);
		_removeLayerLayersAndSource(map, layerId);
		// Remove from tracking
		delete addedOverlayLayers[layerId];
	})) return;
}

/**
 * Internal: Remove all map layers and the source associated with an overlay ID.
 * Safe to call even if the layers/source don't exist on the map.
 * @param {object} map - The MapLibre map instance
 * @param {string} layerId - The overlay layer ID
 */
function _removeLayerLayersAndSource(map, layerId) {
	var sourceId = 'overlay-' + layerId;

		// Remove all layers that reference this source
		// Using source reference is more robust than relying on layer ID prefix,
		// as it handles both old double-prefixed IDs and new correct IDs
		var layersToRemove = [];
		var style = map.getStyle();
		if (style && style.layers) {
			style.layers.forEach(function(layer) {
				if (layer.source === sourceId) {
					layersToRemove.push(layer.id);
				}
			});
		}

	// Remove layers (order doesn't matter for removal)
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
}

/**
 * Update layer visibility and data
 * @param {Object} layer - Layer configuration
 */
function updateLayerVisibility(layer) {
	if (!window.MapUtils.withMap(function(map) {
		var layerId = layer.id;
		var sourceId = 'overlay-' + layerId;

		// For GeoJSON layers, update the source data if provided
		var isGeoJsonWithData = layer.type === 'geojson' && layer.source && layer.source.data;
		if (isGeoJsonWithData) {
			var source = map.getSource(sourceId);
			if (source) {
				source.setData(layer.source.data);
			}
		}

		// Find all layers associated with this overlay by source reference
		var style = map.getStyle();
		if (!style || !style.layers) {
			// Update tracking
			addedOverlayLayers[layerId] = layer;
			return;
		}

		style.layers.forEach(function(mapLayer) {
			if (mapLayer.source !== sourceId) {
				return;
			}
			
			try {
				if (!map.getLayer(mapLayer.id)) {
					return;
				}
				map.setLayoutProperty(mapLayer.id, 'visibility', layer.visible ? 'visible' : 'none');
			} catch (e) {
				console.warn('Error updating layer visibility:', mapLayer.id, e);
			}
		});

		// Update tracking
		addedOverlayLayers[layerId] = layer;
	})) return;
}

/**
 * Update the selected file layer's GeoJSON source data
 * @param {Object} geojson - GeoJSON data
 */
function updateSelectedFileLayerSource(geojson) {
	if (!window.MapUtils.withMap(function(map) {
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
	})) return;
}

/**
 * Clear the selected file layer
 */
function clearSelectedFileLayer() {
	if (!window.MapUtils.withMap(function(map) {
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
	})) return;
}

// Export functions for use in other modules
window.MapOverlays = {
	persistOverlaysForStyleChange: persistOverlaysForStyleChange,
	restoreOverlaysAfterStyleChange: restoreOverlaysAfterStyleChange,
	resetOverlayTracking: resetOverlayTracking,
	isOverlayLayerOnMap: isOverlayLayerOnMap,
	updateOverlayLayers: updateOverlayLayers,
	addOverlayLayer: addOverlayLayer,
	removeOverlayLayer: removeOverlayLayer,
	updateLayerVisibility: updateLayerVisibility,
	updateSelectedFileLayerSource: updateSelectedFileLayerSource,
	clearSelectedFileLayer: clearSelectedFileLayer
};