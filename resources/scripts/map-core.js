/**
 * Map Core Module
 * Handles map initialization, state management, and view state
 */

// Map instance and state
var map = null;
var currentStyleUrl = null;
var flyToDuration = 1500;
var viewStateDebounceTimer = null;

// Configuration (will be set from main)
var geocodingApiKey = '';
var photonSearchUrl = '';
var enableSearch = false;

// Queue for pending operations that need to run after map is loaded
var pendingOperations = [];

/**
 * Set configuration options
 * @param {Object} config - Configuration object
 */
function setConfig(config) {
	if (config.geocodingApiKey !== undefined) {
		geocodingApiKey = config.geocodingApiKey;
	}
	if (config.photonSearchUrl !== undefined) {
		photonSearchUrl = config.photonSearchUrl;
	}
	if (config.enableSearch !== undefined) {
		enableSearch = config.enableSearch;
	}
	if (config.flyToDuration !== undefined) {
		flyToDuration = config.flyToDuration;
	}
	if (config.mapStyleUrl !== undefined) {
		currentStyleUrl = config.mapStyleUrl;
	}
}

/**
 * Check if the map is ready
 * @returns {boolean} True if map is initialized and loaded
 */
function isMapReady() {
	return map !== null;
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
	var div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

/**
 * Queue an operation to run after the map is loaded
 * @param {Function} operation - Function to execute when map is ready
 */
function queueOperation(operation) {
	if (isMapReady()) {
		// Map is already ready, execute immediately
		operation();
	} else {
		// Queue for later execution
		pendingOperations.push(operation);
	}
}

/**
 * Process all pending operations after map loads
 */
function processPendingOperations() {
	console.log('Processing pending operations, count:', pendingOperations.length);
	while (pendingOperations.length > 0) {
		var operation = pendingOperations.shift();
		try {
			operation();
		} catch (e) {
			console.error('Error executing pending operation:', e);
		}
	}
}

/**
 * Initialize the map
 * @param {Object} initialViewState - Initial view state (center, zoom, bearing, pitch)
 * @returns {maplibregl.Map} The map instance
 */
function initializeMap(initialViewState) {
	hideErrorOverlay();

	try {
		// Use initial view state if available, otherwise use defaults
		var initialCenter = initialViewState ?
			[initialViewState.center.longitude, initialViewState.center.latitude] :
			[0, 0];
		var initialZoom = initialViewState ? initialViewState.zoom : 1;
		var initialBearing = initialViewState ? (initialViewState.bearing || 0) : 0;
		var initialPitch = initialViewState ? (initialViewState.pitch || 0) : 0;

		map = new maplibregl.Map({
			container: 'map',
			style: currentStyleUrl,
			center: initialCenter,
			zoom: initialZoom,
			bearing: initialBearing,
			pitch: initialPitch,
			attributionControl: false,
			canvasContextAttributes: { antialias: true }
		});

		map.addControl(new maplibregl.NavigationControl({
			visualizePitch: true,
			showZoom: true,
			showCompass: true
		}));

		map.on('error', function(e) {
			console.error('MapLibre error:', e.error);
			var errorMsg = 'Unknown error occurred';
			if (!e.error) {
				showErrorOverlay('Failed to load map: ' + errorMsg);
				return;
			}
			
			if (e.error.message) {
				errorMsg = e.error.message;
			} else if (typeof e.error === 'string') {
				errorMsg = e.error;
			}
			showErrorOverlay('Failed to load map: ' + errorMsg);
		});

		map.on('load', function() {
			console.log('[MapCore] load event fired on style');
			hideErrorOverlay();
			// Process any pending operations queued while map was loading
			processPendingOperations();
			// Notify the extension that the map is ready. The extension will
			// respond with a fresh updateOverlayLayers message which performs
			// a complete reconstruction of overlays from the tree provider state.
			console.log('[MapCore] Sending mapReady to extension');
			vscode.postMessage({
				type: 'mapReady'
			});
		});

		// map.on('sourcedata', function() {
		// 	console.log('[MapCore] Event sourcedata');
		// });

		// map.on('data', function() {
		// 	console.log('[MapCore] Event data');
		// });

		map.on('mapReady', function() {
			console.log('[MapCore] Event mapReady');
		});

		map.on('styledata', function() {
			console.log('[MapCore] Event styledata');
		});

		map.on('load', function() {
			console.log('[MapCore] Event load');
		});

		// Listen for map move events and save view state
		map.on('moveend', function() {
			// Debounce the view state update
			if (viewStateDebounceTimer) {
				clearTimeout(viewStateDebounceTimer);
			}
			viewStateDebounceTimer = setTimeout(function() {
				saveViewStateToExtension();
			}, 500);
		});

		// Save view state immediately before the webview is unloaded
		window.addEventListener('beforeunload', function() {
			if (map) {
				saveViewStateToExtension();
			}
		});

		// Add a listener for the right-click event - send coordinates to extension for native context menu
		map.on('contextmenu', function(e) {
			var lngLat = e.lngLat;
			
			// Update data-vscode-context on the canvas for the native context menu.
			// VS Code looks for this attribute on the event target or its parents.
			var canvas = map.getCanvas();
			if (canvas) {
				canvas.setAttribute('data-vscode-context', JSON.stringify({
					'maplibre:clickedLngLat': {
						lng: lngLat.lng,
						lat: lngLat.lat
					}
				}));
			}

			vscode.postMessage({
				type: 'contextMenu',
				lngLat: {
					lng: lngLat.lng,
					lat: lngLat.lat
				}
			});
		});

		// Add a listener for mouse move events - send coordinates to statusbar
		map.on('mousemove', function(e) {
			var lngLat = e.lngLat;
			vscode.postMessage({
				type: 'mouseMove',
				lngLat: {
					lng: lngLat.lng,
					lat: lngLat.lat
				}
			});
		});

		// Add a listener for click events to show feature popups
		var popup = null;
		map.on('click', function(e) {
			console.log('[MapCore] Click event at:', e.lngLat);
			var lngLat = e.lngLat;
			var features = map.queryRenderedFeatures(e.point);
			console.log('[MapCore] Found', features ? features.length : 0, 'features');
			
			if (!features || features.length === 0) {
				if (popup) {
					popup.remove();
					popup = null;
				}
				return;
			}
			
			// Log all features found
			for (var i = 0; i < features.length; i++) {
				console.log('[MapCore] Feature', i, 'source:', features[i].source, 'layer:', features[i].layer.id);
			}
			
			// Find the first feature from an overlay layer (source starts with 'overlay-')
			var overlayFeature = null;
			for (var i = 0; i < features.length; i++) {
				var feature = features[i];
				var source = feature.source;
				if (source && source.indexOf('overlay-') === 0) {
					overlayFeature = feature;
					console.log('[MapCore] Found overlay feature:', overlayFeature);
					break;
				}
			}
			
			if (overlayFeature) {
				var properties = overlayFeature.properties || {};
				console.log('[MapCore] Feature properties:', properties);
				
				// Collect all properties including nested ones
				var allProperties = {};
				var nameValue = null;
				var descValue = null;
				
				// First check for common name/desc variations at top level
				nameValue = properties.name || properties.title || properties.label || null;
				descValue = properties.desc || properties.description || properties.note || properties.comment || null;
				
				// Collect all properties, flattening nested objects
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
				
				// Re-check name/desc from flattened properties
				if (!nameValue) {
					nameValue = allProperties.name || allProperties.title || allProperties.label || null;
				}
				if (!descValue) {
					descValue = allProperties.desc || allProperties.description || allProperties.note || allProperties.comment || null;
				}
				
				// Build popup content from feature properties
				var popupContent = '<div style="max-height: 300px; overflow-y: auto;">';
				
				// Show name prominently if it exists
				if (nameValue) {
					popupContent += '<h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">' + escapeHtml(String(nameValue)) + '</h3>';
				}
				
				// Show description if it exists
				if (descValue) {
					popupContent += '<p style="margin: 0 0 12px 0; font-size: 13px; color: #555; line-height: 1.4;">' + escapeHtml(String(descValue)) + '</p>';
					popupContent += '<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 8px 0;" />';
				}
				
				popupContent += '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">';
				
				var propertyCount = 0;
				for (var key in allProperties) {
					if (allProperties.hasOwnProperty(key)) {
						// Skip name/desc variations as they're shown above
						if (key === 'name' || key === 'desc' || key === 'title' || key === 'description' || 
							key === 'label' || key === 'note' || key === 'comment') {
							continue;
						}
						propertyCount++;
						var value = allProperties[key];
						popupContent += '<tr style="border-bottom: 1px solid #e0e0e0;">';
						popupContent += '<td style="padding: 4px; font-weight: 500; color: #666; white-space: nowrap;">' + escapeHtml(key) + '</td>';
						popupContent += '<td style="padding: 4px; color: #333; word-break: break-word;">' + escapeHtml(String(value)) + '</td>';
						popupContent += '</tr>';
					}
				}
				
				if (propertyCount === 0 && !nameValue && !descValue) {
					popupContent += '<tr><td style="padding: 8px; color: #999;" colspan="2">No properties available</td></tr>';
				}
				
				popupContent += '</table></div>';
				
				// Show popup with feature details
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
				// Clicked on basemap or non-overlay layer, close popup
				if (popup) {
					popup.remove();
					popup = null;
				}
			}
		});
	} catch (e) {
		console.error('Error initializing map:', e);
		showErrorOverlay('Failed to initialize map: ' + (e.message || e));
	}

	return map;
}

/**
 * Get the current map instance
 * @returns {maplibregl.Map|null} The map instance or null
 */
function getMap() {
	return map;
}

/**
 * Save view state to extension
 */
function saveViewStateToExtension() {
	if (!map) {
		return;
	}

	var viewState = window.MapUtils.createViewState(map);

	vscode.postMessage({
		type: 'viewStateChanged',
		viewState: viewState
	});
}

/**
 * Send current view state to the extension
 */
function sendViewStateChanged() {
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	var viewState = window.MapUtils.createViewState(map);

	console.log('Sending view state:', viewState);
	vscode.postMessage({
		type: 'viewStateChanged',
		viewState: viewState
	});
}

/**
 * Update map style dynamically
 * @param {string} newStyleUrl - The new style URL
 */
function updateMapStyle(newStyleUrl) {
	if (!window.MapUtils.withMap(function(map) {
		if (newStyleUrl === currentStyleUrl) {
			console.log('Style URL unchanged, skipping update');
			return;
		}

		console.log('Updating map style to:', newStyleUrl);
		currentStyleUrl = newStyleUrl;

		// Store current view state
		var currentCenter = map.getCenter();
		var currentZoom = map.getZoom();
		var currentBearing = map.getBearing();
		var currentPitch = map.getPitch();

		map.setStyle(newStyleUrl, {
			transformStyle: function(previousStyle, nextStyle) {
				return nextStyle;
			},
			preserveSources: true
		});

		map.once('styledata', function(e) {
			console.log('[MapCore] Post event mapReady after vector style change');
			vscode.postMessage({
				type: 'mapReady'
			});
		});

		map.jumpTo({
			center: currentCenter,
			zoom: currentZoom,
			bearing: currentBearing,
			pitch: currentPitch
		});

		map.once('error', function(e) {
			console.error('Error updating map style:', e.error);
		});
	})) return;
}

/**
 * Create a style JSON for raster tile basemap
 * @param {Object} rasterConfig - Raster configuration
 * @returns {Object} Style JSON object
 */
function createRasterStyle(rasterConfig) {
	var sources = {};
	var sourceId = 'raster-basemap';

	sources[sourceId] = {
		type: 'raster',
		tiles: [rasterConfig.tileUrl],
		tileSize: rasterConfig.tileSize || 256,
		attribution: rasterConfig.attribution || ''
	};

	// Add minzoom/maxzoom if provided
	if (rasterConfig.minzoom !== undefined) {
		sources[sourceId].minzoom = rasterConfig.minzoom;
	}
	if (rasterConfig.maxzoom !== undefined) {
		sources[sourceId].maxzoom = rasterConfig.maxzoom;
	}

	return {
		version: 8,
		sources: sources,
		layers: [
			{
				id: 'raster-layer',
				type: 'raster',
				source: sourceId,
				minzoom: rasterConfig.minzoom || 0,
				maxzoom: rasterConfig.maxzoom || 22
			}
		]
	};
}

/**
 * Update basemap - handles both vector styles and raster tiles
 * @param {Object} basemap - Basemap configuration
 */
function updateBasemap(basemap) {
	if (!window.MapUtils.withMap(function(map) {
		console.log('[MapCore] updateBasemap called:', basemap.id, basemap.name);

		// Store current view state
		var currentCenter = map.getCenter();
		var currentZoom = map.getZoom();
		var currentBearing = map.getBearing();
		var currentPitch = map.getPitch();

		if (basemap.type === 'raster' && basemap.tileUrl) {
			// Raster tile basemap
			console.log('[MapCore] Setting raster basemap:', basemap.tileUrl);

			var rasterStyle = createRasterStyle(basemap);
			currentStyleUrl = null;

			map.setStyle(rasterStyle, {
				transformStyle: function(previousStyle, nextStyle) {
					return nextStyle;
				},
				preserveSources: true
			});

			map.once('styledata', function(e) {
				console.log('[MapCore] Post event mapReady after raster basemap change');
				vscode.postMessage({
					type: 'mapReady'
				});
			});

			map.jumpTo({
				center: currentCenter,
				zoom: currentZoom,
				bearing: currentBearing,
				pitch: currentPitch
			});

		} else if (basemap.styleUrl) {
			// Vector style basemap
			updateMapStyle(basemap.styleUrl);
		} else {
			console.error('Invalid basemap configuration: must have either styleUrl or tileUrl');
		}
	})) return;
}

/**
 * Change map language for labels
 * @param {string} language - Language code or 'native'
 */
function changeMapLanguage(language) {
	if (!window.MapUtils.withMap(function(map) {
		console.log('Changing map language to:', language);

		// Determine the text-field expression based on language
		var textField;
		if (language === 'native') {
			// Use native/local names
			textField = ['get', 'name'];
		} else {
			// Use specific language
			textField = ['get', 'name:' + language];
		}

		// Get all layers in the current style
		var style = map.getStyle();
		if (!style || !style.layers) {
			console.warn('Could not get style layers');
			return;
		}

		// Update each label layer that exists in the style
		var updatedCount = 0;
		style.layers.forEach(function(layer) {
			// Check if this is a label layer (has 'label' in the id and is a symbol layer)
			if (layer.type === 'symbol' && layer.id &&
				(layer.id.indexOf('label') !== -1 || layer.id.indexOf('place') !== -1)) {
				try {
					map.setLayoutProperty(layer.id, 'text-field', textField);
					updatedCount++;
				} catch (e) {
					console.debug('Could not update layer', layer.id, e.message);
				}
			}
		});

		console.log('Updated', updatedCount, 'label layers to language:', language);
	})) return;
}

// Export functions for use in other modules
window.MapCore = {
	setConfig: setConfig,
	initializeMap: initializeMap,
	getMap: getMap,
	isMapReady: isMapReady,
	queueOperation: queueOperation,
	processPendingOperations: processPendingOperations,
	saveViewStateToExtension: saveViewStateToExtension,
	sendViewStateChanged: sendViewStateChanged,
	updateMapStyle: updateMapStyle,
	createRasterStyle: createRasterStyle,
	updateBasemap: updateBasemap,
	changeMapLanguage: changeMapLanguage
};