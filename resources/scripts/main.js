/**
 * Main Entry Point
 * Handles initialization and message handling from the extension
 */

// Get the VS Code API for communication with the extension. The instance is
// acquired once by the console-forwarding script in map-view.html and shared
// here, because acquireVsCodeApi may only be called once per webview session.
var vscode = window.__vscodeApi || acquireVsCodeApi();

// Configuration state
var initialViewState = null;

/**
 * Send a message to the extension
 * @param {string} type - Message type
 * @param {Object} data - Message data
 */
function sendMessage(type, data) {
	vscode.postMessage({
		type: type,
		...data
	});
}

/**
 * Handle messages from the extension
 */
function setupMessageHandler() {
	window.addEventListener('message', function(event) {
		var message = event.data;

		switch (message.type) {
			case 'configUpdate':
				console.log('Received configuration update:', message.config);
				if (!message.config) {
					break;
				}

				if (message.config.flyToDuration !== undefined) {
					window.MapConfig.flyToDuration = message.config.flyToDuration;
				}
				if (message.config.searchResultsTransparency !== undefined) {
					window.MapConfig.searchResultsTransparency = message.config.searchResultsTransparency;
				}
				if (message.config.enableSearch !== undefined) {
					window.MapConfig.enableSearch = message.config.enableSearch;
				}
				if (message.config.geocodingApiKey !== undefined) {
					window.MapConfig.geocodingApiKey = message.config.geocodingApiKey;
				}
				if (message.config.photonSearchUrl !== undefined) {
					window.MapConfig.photonSearchUrl = message.config.photonSearchUrl;
				}
				if (message.config.terrain !== undefined) {
					window.MapConfig.terrain = message.config.terrain;
				}
				if (message.config.terrainUrl !== undefined) {
					window.MapConfig.terrainUrl = message.config.terrainUrl;
				}
				if (message.config.scaleUnits !== undefined) {
					window.MapConfig.scaleUnits = message.config.scaleUnits;
					if (window.MapScale) {
						window.MapScale.setUnits(message.config.scaleUnits);
					}
				}

			if (message.config.globe !== undefined) {
				window.MapConfig.globe = message.config.globe;
			}

			// Re-apply (or remove) 3D terrain when terrain settings change;
			// MapCore reads its own copy, so it must receive the new config
			if ((message.config.terrain !== undefined || message.config.terrainUrl !== undefined) && window.MapCore) {
				window.MapCore.setConfig(window.MapConfig);
				window.MapCore.applyTerrain();
			}

			// Re-apply the configured projection when the globe setting changes
			if (message.config.globe !== undefined && window.MapCore && window.MapGlobe) {
				window.MapGlobe.setConfig(window.MapConfig);
				window.MapGlobe.applyGlobe();
			}

				// Apply updated transparency to search results
				if (window.MapSearch && window.MapSearch.applyTransparency && message.config.searchResultsTransparency !== undefined) {
					window.MapSearch.applyTransparency(message.config.searchResultsTransparency);
				}

				// Show or hide the search container according to enableSearch
				if (window.MapConfig.enableSearch) {
					var searchContainer = document.getElementById('search-container');
					if (searchContainer) {
						searchContainer.style.display = 'block';
					}
				} else {
					var searchContainer = document.getElementById('search-container');
					if (searchContainer) {
						searchContainer.style.display = 'none';
					}
					if (window.MapSearch && window.MapSearch.clearResults) {
						window.MapSearch.clearResults();
					}
				}
				break;

			case 'languageChange':
				console.log('Received language change request:', message.language);
				window.MapCore.changeMapLanguage(message.language);
				break;

			case 'flyToLocation':
				console.log('Received flyToLocation request:', message.latitude, message.longitude, message.zoom);
				if (message.latitude !== undefined && message.longitude !== undefined) {
					window.MapNavigation.flyToLocation(message.latitude, message.longitude, message.zoom);
				}
				break;

			case 'fitBoundingBox':
				console.log('Received fitBoundingBox request:', message.coordinates, message.boundingBox);
				if (message.coordinates && message.boundingBox) {
					window.MapNavigation.fitBoundingBox(message.coordinates, message.boundingBox);
				}
				break;

			case 'fitBoundsOnly':
				console.log('Received fitBoundsOnly request:', message.boundingBox);
				if (message.boundingBox) {
					window.MapNavigation.fitBoundsOnly(message.boundingBox);
				}
				break;

			case 'requestViewState':
				console.log('Received requestViewState message');
				window.MapCore.sendViewStateChanged();
				break;

			case 'getMapCenter':
				console.log('Received getMapCenter request');
				var map = window.MapCore.getMap();
				if (map) {
					var center = map.getCenter();
					var zoom = map.getZoom();
					var bearing = map.getBearing();
					var pitch = map.getPitch();
					vscode.postMessage({
						type: 'mapCenterResponse',
						center: {
							latitude: center.lat,
							longitude: center.lng
						},
						zoom: zoom,
						bearing: bearing,
						pitch: pitch
					});
				} else {
					vscode.postMessage({
						type: 'mapCenterResponse',
						error: 'Map not initialized'
					});
				}
				break;

			case 'flyToBookmark':
				console.log('Received flyToBookmark message:', message.bookmark);
				if (message.bookmark) {
					window.MapNavigation.flyToBookmark(message.bookmark);
				}
				break;

			case 'bookmarksUpdated':
				console.log('Received bookmarksUpdated message:', message.bookmarks);
				// Future use: update local bookmark list if needed
				break;

			case 'setBaseMap':
				console.log('Received setBaseMap message:', message);
				if (message.basemap) {
					window.MapCore.updateBasemap(message.basemap);
				} else if (message.styleUrl) {
					// Legacy support: handle old-style styleUrl messages
					window.MapCore.updateMapStyle(message.styleUrl);
				}
				break;

			case 'updateOverlayLayers':
				console.log('Received updateOverlayLayers message:', message.layers);
				if (message.layers) {
					window.MapOverlays.updateOverlayLayers(message.layers);
				}
				break;

			case 'updateSelectedFileLayer':
				console.log('Received updateSelectedFileLayer message');
				if (message.geojson) {
					window.MapOverlays.updateSelectedFileLayerSource(message.geojson);
				} else {
					window.MapOverlays.clearSelectedFileLayer();
				}
				break;

			case 'geocodingSearchResults':
				console.log('Received geocodingSearchResults message:', message.results);
				if (window.MapSearch && window.MapSearch.handleGeocodingSearchResults) {
					window.MapSearch.handleGeocodingSearchResults(message.results, message.query);
				}
				break;

			case 'geocodingSearchError':
				console.log('Received geocodingSearchError message:', message.message);
				if (window.MapSearch && window.MapSearch.handleGeocodingSearchError) {
					window.MapSearch.handleGeocodingSearchError(message.message);
				}
				break;

			case '__testQuery':
				var method = message.method;
				var args = message.args || [];
				// Async __test methods return a promise; deliver the response
				// once it settles so integration tests can await the result.
				function postTestResponse(response) {
					vscode.postMessage({
						type: '__testResponse',
						requestId: message.requestId,
						result: response.result,
						error: response.error
					});
				}
				try {
					if (window.__test && typeof window.__test[method] === 'function') {
						var maybePromise = window.__test[method].apply(window.__test, args);
						if (maybePromise && typeof maybePromise.then === 'function') {
							maybePromise.then(
								function(value) { postTestResponse({ result: value }); },
								function(e) { postTestResponse({ error: e.message || String(e) }); }
							);
						} else {
							postTestResponse({ result: maybePromise });
						}
					} else {
						error = 'Method not found: ' + method;
						postTestResponse({ result: undefined, error: error });
					}
				} catch (e) {
					error = e.message || String(e);
					postTestResponse({ result: undefined, error: error });
				}
				break;
		}
	});
}

/**
 * Initialize the application
 * @param {Object} config - Configuration from the extension
 */
	function initialize(config) {
		// Store configuration globally, honoring explicit 0 values
		window.MapConfig = {
			geocodingApiKey: config.geocodingApiKey !== undefined ? config.geocodingApiKey : '',
			photonSearchUrl: config.photonSearchUrl !== undefined ? config.photonSearchUrl : 'https://photon.komoot.io/api',
			enableSearch: config.enableSearch !== undefined ? config.enableSearch : false,
			searchResultsTransparency: config.searchResultsTransparency !== undefined ? config.searchResultsTransparency : 20,
			flyToDuration: config.flyToDuration !== undefined ? config.flyToDuration : 500,
			terrain: config.terrain !== undefined ? config.terrain : false,
			terrainUrl: config.terrainUrl !== undefined ? config.terrainUrl : 'https://tiles.mapterhorn.com/tilejson.json',
			globe: config.globe !== undefined ? config.globe : false,
			scaleUnits: config.scaleUnits !== undefined ? config.scaleUnits : 'metric',
			mapStyleUrl: config.mapStyleUrl !== undefined ? config.mapStyleUrl : ''
		};

	// Set configuration in core module
	window.MapCore.setConfig(window.MapConfig);

	// Store initial view state
	initialViewState = config.initialViewState || null;

	// Setup message handler
	setupMessageHandler();

	// Initialize the map
	window.MapCore.initializeMap(initialViewState);

	// Apply the configured scale unit system (metric default) to the map
	if (window.MapScale) {
		window.MapScale.setUnits(window.MapConfig.scaleUnits);
	}

	// Apply the persisted globe preference once the map exists; MapGlobe
	// defers projection changes until the style reports loaded.
	if (window.MapGlobe) {
		window.MapGlobe.setConfig(window.MapConfig);
		window.MapGlobe.applyGlobe();
	}

	// Initialize search after map loads
	document.addEventListener('DOMContentLoaded', function() {
		// Small delay to ensure map container is ready
		setTimeout(function() {
			window.MapSearch.initialize();
		}, 100);
	});
}

// Export for use in HTML
window.Main = {
	initialize: initialize
};