/**
 * Main Entry Point
 * Handles initialization and message handling from the extension
 */

// Get the VS Code API for communication with the extension
var vscode = acquireVsCodeApi();

// Configuration state
var initialViewState = null;

/**
 * Handle messages from the extension
 */
function setupMessageHandler() {
	window.addEventListener('message', function(event) {
		var message = event.data;

		switch (message.type) {
			case 'configUpdate':
				console.log('Received configuration update:', message.config);
				if (message.config) {
					if (message.config.flyToDuration !== undefined) {
						window.MapConfig.flyToDuration = message.config.flyToDuration;
					}
					if (message.config.searchResultsTransparency !== undefined) {
						window.MapConfig.searchResultsTransparency = message.config.searchResultsTransparency;
						// Apply updated transparency to search results
						if (window.MapSearch && window.MapSearch.applyTransparency) {
							window.MapSearch.applyTransparency(message.config.searchResultsTransparency);
						}
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
				// Hide loading overlay first to prevent stale state
				window.MapUtils.hideLoadingOverlay();
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
		}
	});
}

/**
 * Initialize the application
 * @param {Object} config - Configuration from the extension
 */
function initialize(config) {
	// Store configuration globally
	window.MapConfig = {
		geocodingApiKey: config.geocodingApiKey || '',
		photonSearchUrl: config.photonSearchUrl || 'https://photon.komoot.io/api',
		enableSearch: config.enableSearch || false,
		searchResultsTransparency: config.searchResultsTransparency || 20,
		flyToDuration: config.flyToDuration || 1500,
		mapStyleUrl: config.mapStyleUrl || ''
	};

	// Set configuration in core module
	window.MapCore.setConfig(window.MapConfig);

	// Store initial view state
	initialViewState = config.initialViewState || null;

	// Setup message handler
	setupMessageHandler();

	// Initialize the map
	window.MapCore.initializeMap(initialViewState);

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