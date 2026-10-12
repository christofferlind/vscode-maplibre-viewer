/**
 * Map Core Module
 * Handles map initialization, state management, and view state.
 * Basemap/style switching lives in map-basemap.js and popup handling
 * in map-popup.js; both reach the map instance through MapCore.getMap().
 */

// Map instance and state
var map = null;
var currentStyleUrl = null;
var flyToDuration = 500;
var viewStateDebounceTimer = null;
var beforeUnloadHandler = null;
var mapLoaded = false;

// Configuration (will be set from main)
var geocodingApiKey = '';
var photonSearchUrl = '';
var enableSearch = false;
var terrain = true;
var terrainUrl = 'https://tiles.mapterhorn.com/tilejson.json';

// Terrain source added to the map when 3D terrain is enabled
var terrainSourceId = 'terrain-3d';

// Separate raster-dem source and hillshade layer for render quality
var hillshadeSourceId = 'hillshade-3d';
var hillshadeLayerId = 'hillshade-3d';

// TerrainControl instance shown while 3D terrain is available
var terrainControl = null;

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
	if (config.terrain !== undefined) {
		terrain = config.terrain;
	}
	if (config.terrainUrl !== undefined) {
		terrainUrl = config.terrainUrl;
	}
	if (config.flyToDuration !== undefined) {
		flyToDuration = config.flyToDuration;
	}
	if (config.mapStyleUrl !== undefined) {
		currentStyleUrl = config.mapStyleUrl;
	}
}

/**
 * Apply or remove 3D terrain based on the current configuration. Terrain is
 * opt-in through settings because it requires network access to fetch tiles.
 * After a style swap MapLibre drops the terrain source, so callers re-run
 * this whenever the style reports loaded.
 */
function applyTerrain() {
	if (!map) {
		return;
	}
	if (!isMapStyleLoaded()) {
		// addSource/setTerrain require a loaded style; retry once it reports data
		map.once('styledata', function() {
			applyTerrain();
		});
		return;
	}
	if (!terrain || !terrainUrl) {
		if (map.getTerrain()) {
			map.setTerrain(null);
		}
		if (terrainControl) {
			map.removeControl(terrainControl);
			terrainControl = null;
		}
		if (map.getLayer(hillshadeLayerId)) {
			map.removeLayer(hillshadeLayerId);
		}
		if (map.getSource(hillshadeSourceId)) {
			map.removeSource(hillshadeSourceId);
		}
		if (map.getSource(terrainSourceId)) {
			map.removeSource(terrainSourceId);
		}
		return;
	}

	// Insert the hillshade below the first symbol layer so labels stay readable;
	// fall back to the top of the stack when the style has no symbol layers.
	function firstSymbolLayerId() {
		var style = map.getStyle();
		if (!style || !style.layers) {
			return undefined;
		}
		for (var i = 0; i < style.layers.length; i++) {
			if (style.layers[i].type === 'symbol') {
				return style.layers[i].id;
			}
		}
		return undefined;
	}

	var sourceSpec = terrainUrl.indexOf('{z}') !== -1 ?
		{ type: 'raster-dem', tiles: [terrainUrl], tileSize: 256 } :
		{ type: 'raster-dem', url: terrainUrl };

	if (!map.getSource(terrainSourceId)) {
		map.addSource(terrainSourceId, sourceSpec);
	}
	if (!map.getTerrain()) {
		map.setTerrain({ source: terrainSourceId });
	}

	// Hillshading uses a separate raster-dem source so the DEM decoder does not
	// trade terrain mesh quality for shading quality (per MapLibre guidance)
	if (!map.getSource(hillshadeSourceId)) {
		map.addSource(hillshadeSourceId, sourceSpec);
	}
	if (!map.getLayer(hillshadeLayerId)) {
		map.addLayer({
			id: hillshadeLayerId,
			type: 'hillshade',
			source: hillshadeSourceId,
			layout: { visibility: 'visible' },
			paint: { 'hillshade-exaggeration': 0.2 }
		}, firstSymbolLayerId());
	}

	// Show the pitch/terrain toggle control while the terrain source works
	if (!terrainControl && maplibregl.TerrainControl) {
		terrainControl = new maplibregl.TerrainControl({ source: terrainSourceId });
		map.addControl(terrainControl);
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
 * Check if the map's style is ready for addSource/addLayer calls. The map
 * instance exists synchronously while the style loads asynchronously, so
 * isMapReady() alone is not sufficient for style mutations.
 * @returns {boolean} True if the map exists and its style is loaded
 */
function isMapStyleLoaded() {
	return map !== null && map.isStyleLoaded();
}

/**
 * Check if the map has finished its initial style load. A map that failed to
 * load (e.g. offline) is ready (instance exists) but not loaded.
 * @returns {boolean} True if the map's first style load completed
 */
function isMapLoaded() {
	return mapLoaded;
}

/**
 * Get the current style URL (or inline style object) applied to the map.
 * @returns {string|Object|null} Current style
 */
function getCurrentStyleUrl() {
	return currentStyleUrl;
}

/**
 * Set the current style URL (or inline style object). Used by map-basemap.js
 * to keep the cached style in sync when switching basemaps.
 * @param {string|Object|null} style - Style URL, style object, or null
 */
function setCurrentStyleUrl(style) {
	currentStyleUrl = style;
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
	if (isMapReady() && isMapStyleLoaded()) {
		// Map is ready and style is loaded, execute immediately
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
	// A drained op's style mutation can make isStyleLoaded() report false
	// synchronously, so a gated op queued behind it would requeue and spin
	// forever here; stop and let styledata/load events resume the drain.
	while (pendingOperations.length > 0 && isMapStyleLoaded()) {
		var operation = pendingOperations.shift();
		try {
			operation();
		} catch (e) {
			console.error('Error executing pending operation:', e);
		}
	}
}

// Bounded retry bookkeeping for the error-triggered drain path
var errorDrainAttempts = 0;
var errorDrainTimer = null;
var MAX_ERROR_DRAIN_ATTEMPTS = 20;

/**
 * Detect recoverable per-tile fetch failures. MapLibre surfaces a failed tile
 * request as an AJAXError with a numeric status; these fire one per tile while
 * panning offline raster/vector sources and must not be forwarded to the
 * extension as fatal errors. Failures before the initial 'load' (style fetch)
 * are not tile errors and are still forwarded.
 * @param {Object} e - MapLibre error event
 * @returns {boolean} True when the error is a tile fetch failure
 */
function isTileFetchError(e) {
	if (!mapLoaded) {
		return false;
	}
	var error = e && e.error;
	if (!error || typeof error !== 'object') {
		return false;
	}
	return typeof error.status === 'number';
}

/**
 * When map errors occur while operations are queued (e.g. a failed style
 * fetch), retry the drain with a short delay, capped so a permanently broken
 * map does not spin forever.
 */
function attemptErrorRecoveryDrain() {
	if (pendingOperations.length === 0 || errorDrainTimer !== null) {
		return;
	}
	if (errorDrainAttempts >= MAX_ERROR_DRAIN_ATTEMPTS) {
		console.warn('[MapCore] Giving up on error-recovery drain after', errorDrainAttempts, 'attempts');
		return;
	}
	errorDrainAttempts++;
	errorDrainTimer = setTimeout(function() {
		errorDrainTimer = null;
		if (pendingOperations.length > 0 && map !== null) {
			if (isMapStyleLoaded()) {
				errorDrainAttempts = 0;
				processPendingOperations();
			} else {
				attemptErrorRecoveryDrain();
			}
		}
	}, 250);
}

/**
 * Initialize the map
 * @param {Object} initialViewState - Initial view state (center, zoom, bearing, pitch)
 * @returns {maplibregl.Map} The map instance
 */
function initializeMap(initialViewState) {
	hideErrorOverlay();
	mapLoaded = false;
	terrainControl = null;

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

		// GlobeControl exists only in MapLibre GL JS v5+; keep working on v4
		if (maplibregl.GlobeControl) {
			map.addControl(new maplibregl.GlobeControl());
		}

		map.on('error', function(e) {
			console.error('MapLibre error:', e.error);
			// If the initial style fetch failed (e.g. offline), 'load' never
			// fires and queued operations would be stranded forever. Attempt a
			// bounded drain so they are not lost permanently.
			attemptErrorRecoveryDrain();
			// Individual tile fetch failures are recoverable and can flood the
			// extension host with one message per tile while panning; only
			// forward other errors (style load failures, runtime errors).
			if (isTileFetchError(e)) {
				return;
			}
			var errorMsg = 'Unknown error occurred';
			var details = '';
			var stack = '';
			if (e.error) {
				if (e.error.message) {
					errorMsg = e.error.message;
				} else if (typeof e.error === 'string') {
					errorMsg = e.error;
				}
				if (e.error.stack) {
					stack = e.error.stack;
				}
				try {
					details = JSON.stringify(e.error, null, 2);
				} catch (stringifyError) {
					details = String(e.error);
				}
			}
			vscode.postMessage({
				type: 'mapError',
				message: 'Failed to load map: ' + errorMsg,
				details: details,
				stack: stack,
				source: e.source || ''
			});
		});

		map.on('load', function() {
			console.log('[MapCore] load event fired on style');
			// Temporary diagnostics: report why 3D buildings (fill-extrusion)
			// may be missing from the loaded basemap style.
			var extrusionLayers = [];
			var pitch = '?';
			var zoom = '?';
			try {
				var style = map.getStyle();
				extrusionLayers = style && style.layers ?
					style.layers
						.filter(function(layer) { return layer.type === 'fill-extrusion'; })
						.map(function(layer) {
							return {
								id: layer.id,
								source: layer.source,
								sourceLayer: layer['source-layer'] || '',
								minzoom: layer.minzoom,
								maxzoom: layer.maxzoom,
								visibility: layer.layout && layer.layout.visibility ? layer.layout.visibility : 'visible'
							};
						}) :
					[];
				pitch = map.getPitch();
				zoom = Number(map.getZoom().toFixed(2));
			} catch (diagError) {
				// Diagnostics only: never break map load
			}
			console.log('[MapCore] buildings check pitch=' + pitch +
				' zoom=' + zoom +
				' fill-extrusion layers: ' + JSON.stringify(extrusionLayers));
			mapLoaded = true;
			errorDrainAttempts = 0;
			hideErrorOverlay();
			applyTerrain();
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

		map.on('mapReady', function() {
			console.log('[MapCore] Event mapReady');
		});

		map.on('styledata', function() {
			console.log('[MapCore] Event styledata');
		});

		// The map-level 'load' event fires only for the initial style in
		// MapLibre v6, so retry queued style mutations whenever an event
		// reports the style ready again.
		map.on('styledata', function() {
			if (pendingOperations.length > 0 && isMapStyleLoaded()) {
				processPendingOperations();
			}
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

		// Save view state immediately before the webview is unloaded. A named
		// handler is used so it can be removed before adding again; otherwise
		// recreating the map (basemap switches) stacks listeners.
		if (beforeUnloadHandler) {
			window.removeEventListener('beforeunload', beforeUnloadHandler);
		}
		beforeUnloadHandler = function() {
			if (map) {
				saveViewStateToExtension();
			}
		};
		window.addEventListener('beforeunload', beforeUnloadHandler);

		// Add a listener for the right-click event - send coordinates to extension for native context menu
		map.on('contextmenu', function(e) {
			var lngLat = e.lngLat;
			
			// Update data-vscode-context on the canvas for the native context menu.
			// VS Code looks for this attribute on the event target or its parents.
			var canvas = map.getCanvas();
			if (canvas) {
				canvas.setAttribute('data-vscode-context', JSON.stringify({
					'maplibre:hasClickedLngLat': true,
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

	// Listen for mouse move events - send coordinates to statusbar (throttled
	// so panning does not flood the extension host with messages per pixel)
	var mouseMoveThrottleTimer = null;
	var pendingMouseLngLat = null;
	map.on('mousemove', function(e) {
		pendingMouseLngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };
		// Keep the context-menu state current with the pointer position so
		// "Copy coordinates" is available without requiring a click first.
		var moveCanvas = map.getCanvas();
		if (moveCanvas) {
			moveCanvas.setAttribute('data-vscode-context', JSON.stringify({
				'maplibre:hasClickedLngLat': true,
				'maplibre:clickedLngLat': pendingMouseLngLat
			}));
		}
		if (mouseMoveThrottleTimer !== null) {
			return;
		}
		mouseMoveThrottleTimer = setTimeout(function() {
			mouseMoveThrottleTimer = null;
			if (pendingMouseLngLat) {
				var lngLat = pendingMouseLngLat;
				pendingMouseLngLat = null;
				vscode.postMessage({
					type: 'mouseMove',
					lngLat: lngLat
				});
			}
		}, 75);
	});

		// Add a listener for click events to show feature popups
		if (window.MapPopup) {
			window.MapPopup.attachPopupHandler(map, escapeHtml);
		}

		// Add a listener for click events that report feature information to
		// the Map Information view
		if (window.MapInfo) {
			window.MapInfo.attachInfoHandler(map);
		}
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

// Export functions for use in other modules. Basemap/style/language operations
// are delegated to MapBasemap so consumers can keep calling MapCore.<name>.
window.MapCore = {
	setConfig: setConfig,
	initializeMap: initializeMap,
	getMap: getMap,
	isMapReady: isMapReady,
	isMapLoaded: isMapLoaded,
	isMapStyleLoaded: isMapStyleLoaded,
	applyTerrain: applyTerrain,
	getCurrentStyleUrl: getCurrentStyleUrl,
	setCurrentStyleUrl: setCurrentStyleUrl,
	queueOperation: queueOperation,
	processPendingOperations: processPendingOperations,
	saveViewStateToExtension: saveViewStateToExtension,
	sendViewStateChanged: sendViewStateChanged,
	updateMapStyle: function(newStyleUrl) {
		window.MapBasemap.updateMapStyle(newStyleUrl);
	},
	createRasterStyle: function(rasterConfig) {
		return window.MapBasemap.createRasterStyle(rasterConfig);
	},
	updateBasemap: function(basemap) {
		window.MapBasemap.updateBasemap(basemap);
	},
	changeMapLanguage: function(language) {
		window.MapBasemap.changeMapLanguage(language);
	}
};