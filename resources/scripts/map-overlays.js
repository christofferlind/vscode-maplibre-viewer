/**
 * Map Overlays Module
 * Handles overlay layer management (adding, removing, updating layers)
 * 
 * STATELESS DESIGN: This module maintains no internal state for layer tracking.
 * All layer synchronization is driven by the layer tree provider's current state.
 * On basemap change or overlay update, the map is completely reconstructed from
 * the provided layer configurations.
 */

// Selected file layer ID constant
var SELECTED_FILE_LAYER_ID = 'selected-file';

/**
 * Update overlay layers on the map.
 * Main entry point called by the extension when overlay state changes.
 * Performs complete reconstruction: removes all existing overlay layers
 * and rebuilds from the provided layer configurations.
 * @param {Array} layers - Array of layer configurations from tree provider
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
	console.log('[MapOverlays] updateOverlayLayers called with ' + layers.length + ' layer(s) - performing full reconstruction');

	syncAllOverlays(layers);
}

/**
 * Synchronize all overlay layers with the map.
 * Removes all existing overlay layers and rebuilds from the provided configurations.
 * This is the core stateless synchronization mechanism.
 * @param {Array} layers - Array of layer configurations from tree provider
 */
function syncAllOverlays(layers) {
	if (!window.MapUtils.withMap(function(map) {
		console.log('[MapOverlays] syncAllOverlays: removing all existing overlay layers');
		
		var style = map.getStyle();
		if (!style || !style.layers) {
			console.log('[MapOverlays] No layers in style, skipping removal');
		} else {
			var overlayLayerIds = [];
			for (var i = 0; i < style.layers.length; i++) {
				var layer = style.layers[i];
				if (layer.source && layer.source.indexOf('overlay-') === 0) {
					overlayLayerIds.push(layer.id);
				}
			}
			
			console.log('[MapOverlays] Removing ' + overlayLayerIds.length + ' existing overlay layer(s)');
			for (var j = 0; j < overlayLayerIds.length; j++) {
				try {
					if (map.getLayer(overlayLayerIds[j])) {
						map.removeLayer(overlayLayerIds[j]);
					}
				} catch (e) {
					console.warn('[MapOverlays] Error removing layer:', overlayLayerIds[j], e);
				}
			}
			
			var overlaySourceIds = [];
			for (var k = 0; k < style.layers.length; k++) {
				var layer = style.layers[k];
				if (layer.source && layer.source.indexOf('overlay-') === 0 && overlaySourceIds.indexOf(layer.source) === -1) {
					overlaySourceIds.push(layer.source);
				}
			}
			
			console.log('[MapOverlays] Removing ' + overlaySourceIds.length + ' existing overlay source(s)');
			for (var m = 0; m < overlaySourceIds.length; m++) {
				try {
					if (map.getSource(overlaySourceIds[m])) {
						map.removeSource(overlaySourceIds[m]);
					}
				} catch (e) {
					console.warn('[MapOverlays] Error removing source:', overlaySourceIds[m], e);
				}
			}
		}
		
		console.log('[MapOverlays] syncAllOverlays: adding ' + layers.length + ' layer(s) from tree provider state');
		for (var n = 0; n < layers.length; n++) {
			var layer = layers[n];
			if (layer.visible !== false) {
				addOverlayLayer(layer);
			}
		}
	})) {
		return;
	}
}

/**
 * Add a single overlay layer.
 * Adds the layer to the map based on its type (geojson, vector, or raster).
 * @param {Object} layer - Layer configuration from tree provider
 */
function addOverlayLayer(layer) {
	if (!window.MapUtils.withMap(function(map) {
		console.log('[MapOverlays] Adding overlay layer:', layer.id, layer.name, 'visible:', layer.visible);

		try {
			var sourceId = 'overlay-' + layer.id;

			if (layer.type === 'geojson') {
				var geojsonSource = {
					type: 'geojson',
					data: layer.source.data
				};
				map.addSource(sourceId, geojsonSource);

				var layerOpacity = layer.opacity !== undefined ? layer.opacity : 1;
				var layerColor = layer.color || '#FF0000';
				var layerDefinitions = window.MapUtils.createGeoJsonLayerDefinitions(sourceId, {
					prefix: '',
					circlePaint: {
						'circle-radius': 6,
						'circle-color': layerColor,
						'circle-opacity': layerOpacity
					},
					linePaint: {
						'line-color': layerColor,
						'line-width': 2,
						'line-opacity': layerOpacity
					},
					fillPaint: {
						'fill-color': layerColor,
						'fill-opacity': layerOpacity * 0.5
					}
				});

			var circleLayer = layerDefinitions.circle;
			if (layer.minzoom !== undefined) {
				circleLayer.minzoom = layer.minzoom;
			}
			if (layer.maxzoom !== undefined) {
				circleLayer.maxzoom = layer.maxzoom;
			}
			map.addLayer(circleLayer);

			var lineLayer = layerDefinitions.line;
			if (layer.minzoom !== undefined) {
				lineLayer.minzoom = layer.minzoom;
			}
			if (layer.maxzoom !== undefined) {
				lineLayer.maxzoom = layer.maxzoom;
			}
			map.addLayer(lineLayer);

			var fillLayer = layerDefinitions.fill;
			if (layer.minzoom !== undefined) {
				fillLayer.minzoom = layer.minzoom;
			}
			if (layer.maxzoom !== undefined) {
				fillLayer.maxzoom = layer.maxzoom;
			}
			map.addLayer(fillLayer);

			} else if (layer.type === 'vector') {
				var vectorSource = {
					type: 'vector',
					url: layer.source.url
				};
				map.addSource(sourceId, vectorSource);

				console.warn('Vector tile layers require additional configuration for source-layer');

			} else if (layer.type === 'raster') {
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
			if (layer.minzoom !== undefined) {
				rasterLayer.minzoom = layer.minzoom;
			}
			if (layer.maxzoom !== undefined) {
				rasterLayer.maxzoom = layer.maxzoom;
			}
			map.addLayer(rasterLayer);
			}

			console.log('[MapOverlays] Successfully added overlay layer:', layer.id);

		} catch (e) {
			console.error('[MapOverlays] Error adding overlay layer:', e);
		}
	})) {
		return;
	}
}

/**
 * Remove a single overlay layer
 * @param {string} layerId - Layer ID to remove
 */
function removeOverlayLayer(layerId) {
	if (!window.MapUtils.withMap(function(map) {
		console.log('[MapOverlays] Removing overlay layer:', layerId);
		_removeLayerLayersAndSource(map, layerId);
	})) {
		return;
	}
}

/**
 * Internal: Remove all map layers and the source associated with an overlay ID.
 * Safe to call even if the layers/source don't exist on the map.
 * @param {object} map - The MapLibre map instance
 * @param {string} layerId - The overlay layer ID
 */
function _removeLayerLayersAndSource(map, layerId) {
	var sourceId = 'overlay-' + layerId;

	var layersToRemove = [];
	var style = map.getStyle();
	if (style && style.layers) {
		for (var i = 0; i < style.layers.length; i++) {
			if (style.layers[i].source === sourceId) {
				layersToRemove.push(style.layers[i].id);
			}
		}
	}

	for (var j = 0; j < layersToRemove.length; j++) {
		try {
			if (map.getLayer(layersToRemove[j])) {
				map.removeLayer(layersToRemove[j]);
			}
		} catch (e) {
			console.warn('[MapOverlays] Error removing layer:', layersToRemove[j], e);
		}
	}

	try {
		if (map.getSource(sourceId)) {
			map.removeSource(sourceId);
		}
	} catch (e) {
		console.warn('[MapOverlays] Error removing source:', sourceId, e);
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

		var isGeoJsonWithData = layer.type === 'geojson' && layer.source && layer.source.data;
		if (isGeoJsonWithData) {
			var source = map.getSource(sourceId);
			if (source) {
				source.setData(layer.source.data);
			}
		}

		var style = map.getStyle();
		if (!style || !style.layers) {
			return;
		}

		for (var i = 0; i < style.layers.length; i++) {
			var mapLayer = style.layers[i];
			if (mapLayer.source !== sourceId) {
				continue;
			}
			
			try {
				if (!map.getLayer(mapLayer.id)) {
					continue;
				}
				map.setLayoutProperty(mapLayer.id, 'visibility', layer.visible ? 'visible' : 'none');
			} catch (e) {
				console.warn('[MapOverlays] Error updating layer visibility:', mapLayer.id, e);
			}
		}
	})) {
		return;
	}
}

/**
 * Update the selected file layer's GeoJSON source data
 * @param {Object} geojson - GeoJSON data
 */
function updateSelectedFileLayerSource(geojson) {
	if (!window.MapUtils.withMap(function(map) {
		console.log('[MapOverlays] Updating selected file layer with GeoJSON data');

		var sourceId = 'overlay-' + SELECTED_FILE_LAYER_ID;
		var source = map.getSource(sourceId);

		if (source) {
			source.setData(geojson);
		} else {
			var layer = {
				id: SELECTED_FILE_LAYER_ID,
				name: 'Selected file',
				type: 'geojson',
				source: {
					type: 'geojson',
					data: geojson
				},
				visible: true
			};
			addOverlayLayer(layer);
		}
	})) {
		return;
	}
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
	})) {
		return;
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