/**
 * Map Globe Module
 * Owns the globe projection toggle and its persisted preference for MapLibre
 * GL v6. In v6 the projection is part of the style stylesheet: the v5-era
 * 'projectionchange' event no longer exists, zooming only fires
 * 'projectiontransition' without changing the configured projection, and style
 * swaps reset the stylesheet projection. MapCore therefore hands every map
 * instance to attach(), which adds a custom toggle button styled like the
 * built-in GlobeControl, applies the configured projection once the style
 * loads, and re-applies it after style data changes. Clicking the button
 * reports the new state to the extension as a 'globeStateChanged' message so
 * the preference is saved; zooming never reports anything. Loaded before
 * map-core.js so the attach hook exists when a map instance is created.
 */

// Requested projection state, initialized from the extension configuration
var globe = false;

// Map instance and toggle button owned by this module
var activeMap = null;
var globeButton = null;

// Bounded polling repair. v6 can fire the last styledata event of a basemap
// swap while the incoming style still reports as loading, leaving no later
// event once it reports loaded; polling catches that committed-but-unrepaired
// window, mirroring the retry map-basemap.js uses for mapReady.
var repairTimer = null;
var repairAttempts = 0;
var REPAIR_INTERVAL_MS = 50;
var MAX_REPAIR_ATTEMPTS = 100;

/**
 * Set configuration options
 * @param {Object} config - Configuration object
 */
function setConfig(config) {
	if (config.globe !== undefined) {
		globe = config.globe;
	}
	if (activeMap) {
		applyGlobe();
	}
}

/**
 * Check whether the globe projection is requested
 * @returns {boolean} True when the globe projection is enabled
 */
function isGlobeEnabled() {
	return globe === true;
}

/**
 * Read the projection type configured on the map
 * @param {maplibregl.Map} mapInstance - The map to inspect
 * @returns {string|null} 'globe', 'mercator', or null when unavailable
 */
function currentProjectionType(mapInstance) {
	try {
		var projection = mapInstance.getProjection();
		return projection && projection.type ? projection.type : null;
	} catch (e) {
		return null;
	}
}

/**
 * Update the toggle button to reflect the requested state, mirroring the
 * built-in GlobeControl's icon classes from maplibre-gl.css.
 */
function updateButtonState() {
	if (!globeButton) {
		return;
	}
	globeButton.title = globe ? 'Switch to flat map view' : 'Switch to globe view';
	globeButton.classList.remove('maplibregl-ctrl-globe');
	globeButton.classList.remove('maplibregl-ctrl-globe-enabled');
	globeButton.classList.add(globe ? 'maplibregl-ctrl-globe-enabled' : 'maplibregl-ctrl-globe');
}

/**
 * Stop the polling repair and re-arm it from a clean slate after the requested
 * projection is confirmed applied or satisfied.
 */
function clearRepairRetry() {
	if (repairTimer !== null) {
		clearTimeout(repairTimer);
		repairTimer = null;
	}
	repairAttempts = 0;
}

/**
 * Schedule one polling repair retry while the style is loading (or a repair
 * could not be applied). Bounded so a permanently failing style cannot poll
 * forever.
 */
function scheduleRepairRetry() {
	if (repairTimer !== null || repairAttempts >= MAX_REPAIR_ATTEMPTS) {
		return;
	}
	repairTimer = setTimeout(function() {
		repairTimer = null;
		repairAttempts++;
		applyGlobe();
	}, REPAIR_INTERVAL_MS);
}

/**
 * Apply the requested projection to the attached map. In v6
 * map.setProjection mutates the stylesheet and needs a loaded style, so the
 * call is re-attempted by the polling repair until the style reports loaded.
 */
function applyGlobe() {
	updateButtonState();
	if (!activeMap) {
		return;
	}
	if (activeMap.isStyleLoaded() !== true) {
		scheduleRepairRetry();
		return;
	}
	var target = globe ? 'globe' : 'mercator';
	var current = currentProjectionType(activeMap);
	if (current === target) {
		clearRepairRetry();
		return;
	}
	try {
		activeMap.setProjection({ type: target });
		clearRepairRetry();
	} catch (e) {
		console.warn('MapGlobe: could not set projection:', e.message);
		scheduleRepairRetry();
	}
}

/**
 * Toggle the projection from the button click and report the new state to the
 * extension so the preference is saved. The projection is applied immediately;
 * when the style is not loaded yet the polling repair applies it once the
 * style reports loaded.
 */
function toggleGlobe() {
	globe = !globe;
	vscode.postMessage({
		type: 'globeStateChanged',
		enabled: globe
	});
	applyGlobe();
}

/**
 * Build the toggle control. Uses the same markup classes as the built-in
 * GlobeControl so the vendored maplibre-gl.css provides the icons.
 * @returns {Object} A MapLibre IControl-compatible object
 */
function createGlobeControl() {
	var container = document.createElement('div');
	container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
	var button = document.createElement('button');
	button.type = 'button';
	button.setAttribute('aria-label', 'Toggle globe projection');
	var icon = document.createElement('span');
	icon.className = 'maplibregl-ctrl-icon';
	icon.setAttribute('aria-hidden', 'true');
	button.appendChild(icon);
	button.addEventListener('click', function() {
		toggleGlobe();
	});
	container.appendChild(button);
	globeButton = button;
	updateButtonState();
	return {
		onAdd: function() {
			return container;
		},
		onRemove: function() {
			container.remove();
			globeButton = null;
		}
	};
}

/**
 * Attach the toggle to a map instance. Style changes (initial load, basemap
 * swap, or our own projection application) re-run applyGlobe, which repairs
 * the requested projection whenever the style's projection drifted. Zoom
 * transitions do not modify the stylesheet projection, so they cannot
 * retrigger this and cannot affect the persisted preference.
 * @param {maplibregl.Map} mapInstance - The newly created map
 */
function attach(mapInstance) {
	activeMap = mapInstance;
	globeButton = null;
	mapInstance.addControl(createGlobeControl());
	mapInstance.on('styledata', function() {
		applyGlobe();
	});
	applyGlobe();
}

// Export for use in map-core.js and main.js
window.MapGlobe = {
	setConfig: setConfig,
	applyGlobe: applyGlobe,
	isGlobeEnabled: isGlobeEnabled,
	attach: attach
};