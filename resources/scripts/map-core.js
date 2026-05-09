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
	return map !== null && map.isStyleLoaded();
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
	showLoadingOverlay('Initializing map...');

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
			hideLoadingOverlay();
			hideErrorOverlay();
			// Self-heal: restore overlays that were persisted before the style
			// change. This runs independently of extension message timing.
			// restoreOverlaysAfterStyleChange internally clears its persisted
			// state after restoring and rebuilds addedOverlayLayers tracking.
			if (window.MapOverlays && window.MapOverlays.restoreOverlaysAfterStyleChange) {
				window.MapOverlays.restoreOverlaysAfterStyleChange();
			}
			// Process any pending operations queued while map was loading
			processPendingOperations();
			// Notify the extension that the map is ready. The extension will
			// respond with a fresh updateOverlayLayers message which updates
			// visibility for any layers already on the map from the restore.
			console.log('[MapCore] Sending mapReady to extension');
			vscode.postMessage({
				type: 'mapReady'
			});
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
		showLoadingOverlay('Updating style...');

		// Persist overlay data BEFORE setStyle() destroys layers.
		// They will be restored in the 'load' event handler.
		if (window.MapOverlays && window.MapOverlays.persistOverlaysForStyleChange) {
			window.MapOverlays.persistOverlaysForStyleChange();
		}

		currentStyleUrl = newStyleUrl;

		// Store current view state
		var currentCenter = map.getCenter();
		var currentZoom = map.getZoom();
		var currentBearing = map.getBearing();
		var currentPitch = map.getPitch();

		// Update the style (destroys all programmatic layers/sources)
		map.setStyle(newStyleUrl, {
			transformStyle: function(previousStyle, nextStyle) {
				return nextStyle;
			}
		});

		map.jumpTo({
			center: currentCenter,
			zoom: currentZoom,
			bearing: currentBearing,
			pitch: currentPitch
		});

		hideLoadingOverlay();

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

		// Save overlay data BEFORE setStyle() destroys all layers.
		// This must happen BEFORE any tracking reset — the persist reads
		// from addedOverlayLayers and stores a snapshot for self-healing.
		if (window.MapOverlays && window.MapOverlays.persistOverlaysForStyleChange) {
			window.MapOverlays.persistOverlaysForStyleChange();
		}

		// Store current view state
		var currentCenter = map.getCenter();
		var currentZoom = map.getZoom();
		var currentBearing = map.getBearing();
		var currentPitch = map.getPitch();

		if (basemap.type === 'raster' && basemap.tileUrl) {
			// Raster tile basemap
			console.log('[MapCore] Setting raster basemap:', basemap.tileUrl);
			showLoadingOverlay('Updating style...');

			var rasterStyle = createRasterStyle(basemap);
			currentStyleUrl = null;

			// setStyle destroys all programmatic layers/sources.
			// They will be restored in the 'load' event handler.
			map.setStyle(rasterStyle, {
				transformStyle: function(previousStyle, nextStyle) {
					return nextStyle;
				}
			});

			map.jumpTo({
				center: currentCenter,
				zoom: currentZoom,
				bearing: currentBearing,
				pitch: currentPitch
			});

			hideLoadingOverlay();
		} else if (basemap.styleUrl) {
			// Vector style basemap. updateMapStyle handles persist + setStyle.
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