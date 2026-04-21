/**
 * Map Navigation Module
 * Handles fly to locations, bounding boxes, and temporary markers
 */

// Temporary markers array
window.temporaryMarkers = [];

/**
 * Fly to a specific location on the map
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @param {number} [zoom=14] - Zoom level (optional)
 */
function flyToLocation(latitude, longitude, zoom) {
	var map = window.MapCore.getMap();
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	// Get flyToDuration from config
	var flyToDuration = window.MapConfig ? window.MapConfig.flyToDuration : 1500;

	// Use provided zoom or default to 14
	var zoomLevel = zoom !== undefined ? zoom : 14;
	
	console.log('Flying to location:', latitude, longitude, 'at zoom:', zoomLevel);

	// Remove any existing temporary markers
	clearTemporaryMarkers();

	// Fly to the location
	map.flyTo({
		center: [longitude, latitude],
		zoom: zoomLevel,
		duration: flyToDuration
	});

	// Add a temporary marker at the location
	var marker = new maplibregl.Marker()
		.setLngLat([longitude, latitude])
		.addTo(map);
	window.temporaryMarkers.push(marker);

	// Remove the markers after 10 seconds
	setTimeout(function() {
		clearTemporaryMarkers();
	}, 10000);
}

/**
 * Clear all temporary markers
 */
function clearTemporaryMarkers() {
	if (window.temporaryMarkers && window.temporaryMarkers.length > 0) {
		window.temporaryMarkers.forEach(function(marker) {
			marker.remove();
		});
		window.temporaryMarkers = [];
	}
}

/**
 * Fit map to show all coordinates within a bounding box
 * @param {Array} coordinates - Array of coordinate objects
 * @param {Object} boundingBox - Bounding box with southwest and northeast corners
 */
function fitBoundingBox(coordinates, boundingBox) {
	var map = window.MapCore.getMap();
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	// Get flyToDuration from config
	var flyToDuration = window.MapConfig ? window.MapConfig.flyToDuration : 1500;

	console.log('Fitting to bounding box:', coordinates.length, 'coordinates', boundingBox);

	// Clear any existing temporary markers
	clearTemporaryMarkers();

	// Add markers for all coordinates
	window.temporaryMarkers = window.temporaryMarkers || [];
	coordinates.forEach(function(coord) {
		var marker = new maplibregl.Marker()
			.setLngLat([coord.longitude, coord.latitude])
			.addTo(map);
		window.temporaryMarkers.push(marker);
	});

	// Calculate padding based on number of points
	var padding = Math.max(50, Math.min(100, 200 / coordinates.length));

	// Fit the map to the bounding box
	map.fitBounds(
		[
			[boundingBox.southwest.longitude, boundingBox.southwest.latitude],
			[boundingBox.northeast.longitude, boundingBox.northeast.latitude]
		],
		{
			padding: padding,
			duration: flyToDuration,
			maxZoom: 16
		}
	);

	// Remove the markers after 10 seconds
	setTimeout(function() {
		clearTemporaryMarkers();
	}, 10000);
}

/**
 * Fit map to bounding box only (no markers) - used for GeoJSON file viewing
 * @param {Object} boundingBox - Bounding box with southwest and northeast corners
 */
function fitBoundsOnly(boundingBox) {
	var map = window.MapCore.getMap();
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	// Get flyToDuration from config
	var flyToDuration = window.MapConfig ? window.MapConfig.flyToDuration : 1500;

	console.log('Fitting to bounding box (no markers):', boundingBox);

	// Fit the map to the bounding box
	map.fitBounds(
		[
			[boundingBox.southwest.longitude, boundingBox.southwest.latitude],
			[boundingBox.northeast.longitude, boundingBox.northeast.latitude]
		],
		{
			padding: 50,
			duration: flyToDuration,
			maxZoom: 16
		}
	);
}

/**
 * Fly to a bookmark location
 * @param {Object} bookmark - Bookmark object with center, zoom, bearing, pitch
 */
function flyToBookmark(bookmark) {
	var map = window.MapCore.getMap();
	if (!map) {
		console.warn('Map not initialized');
		return;
	}

	if (!bookmark || !bookmark.center) {
		console.warn('Invalid bookmark data');
		return;
	}

	console.log('Flying to bookmark:', bookmark.name, bookmark);

	map.flyTo({
		center: [bookmark.center.longitude, bookmark.center.latitude],
		zoom: bookmark.zoom || 14,
		bearing: bookmark.bearing || 0,
		pitch: bookmark.pitch || 0,
		duration: 1500
	});
}

// Export functions for use in other modules
window.MapNavigation = {
	flyToLocation: flyToLocation,
	clearTemporaryMarkers: clearTemporaryMarkers,
	fitBoundingBox: fitBoundingBox,
	fitBoundsOnly: fitBoundsOnly,
	flyToBookmark: flyToBookmark
};