/**
 * Map Basemap Module
 * Handles basemap/style switching, raster style construction, language
 * changes, and recovery from a failed initial style load (e.g. offline).
 * Loaded after map-core.js so it can reach the MapLibre instance via MapCore.
 */

/**
 * Notify the extension that the map is ready once the style is actually
 * loaded. 'styledata' fires during style loading (not necessarily when the
 * style is committed), so posting 'mapReady' from it can make overlay
 * addSource/addLayer calls throw "Style is not done loading" and silently
 * drop overlays. Poll via 'styledata'/'load' one-shots until
 * isStyleLoaded() is true, and post 'mapReady' exactly once per call.
 * @param {Object} map - MapLibre map instance
 */
function notifyMapReadyWhenStyleLoaded(map) {
	var done = false;
	// Right after setStyle() the old style still reports isStyleLoaded() as
	// true, so a synchronous check would post mapReady against the stale
	// style and overlays re-added then get wiped when the new style applies.
	// Require at least one styledata/load event after setStyle before the
	// isStyleLoaded() result is trusted.
	var sawStyleEvent = false;
	// 'styledata' fires during style loading and may never fire again after
	// the initial load; a bounded retry guarantees mapReady is eventually
	// posted even if no event arrives while isStyleLoaded() is false.
	var attempts = 0;
	var MAX_ATTEMPTS = 100;
	var pendingTimers = [];
	var detach = function() {
		// Guard: not every map-like object exposes off()
		if (typeof map.off !== 'function') {
			return;
		}
		map.off('styledata', retry);
		map.off('load', retry);
	};
	var onDone = function() {
		if (done) {
			return;
		}
		done = true;
		// Clear pending timers and detach this round's once-listeners so they
		// do not accumulate when the retry loop is abandoned or a later load
		// event fires.
		for (var i = 0; i < pendingTimers.length; i++) {
			clearTimeout(pendingTimers[i]);
		}
		pendingTimers = [];
		detach();
		// A style swap drops the previous style's terrain, so re-apply it
		// (or remove it) according to the current terrain settings.
		if (window.MapCore && window.MapCore.applyTerrain) {
			window.MapCore.applyTerrain();
		}
		console.log('[MapBasemap] Style loaded; posting mapReady');
		vscode.postMessage({
			type: 'mapReady'
		});
	};
	var retry = function() {
		if (done) {
			return;
		}
		if (attempts >= MAX_ATTEMPTS) {
			console.warn('[MapBasemap] Style never reported loaded; giving up on mapReady');
			done = true;
			detach();
			return;
		}
		attempts++;
		if (!sawStyleEvent) {
			// Wait for the first post-setStyle style event before trusting
			// isStyleLoaded(); timers alone must not report readiness.
			map.once('styledata', onStyleEvent);
			map.once('load', onStyleEvent);
			pendingTimers.push(setTimeout(retry, 50));
			return;
		}
		if (map.isStyleLoaded()) {
			onDone();
			return;
		}
		map.once('styledata', retry);
		// Also guard with 'load' in case styledata no longer fires
		map.once('load', retry);
		pendingTimers.push(setTimeout(retry, 50));
	};
	var onStyleEvent = function() {
		if (done) {
			return;
		}
		sawStyleEvent = true;
		if (map.isStyleLoaded()) {
			onDone();
			return;
		}
		retry();
	};
	retry();
}

/**
 * Update map style dynamically.
 * If the previous map instance never finished loading (its initial style
 * fetch failed, e.g. while offline), setStyle does not reliably render, so
 * the map is recreated from scratch with the new style instead.
 * @param {string} newStyleUrl - The new style URL
 */
function updateMapStyle(newStyleUrl) {
	if (window.MapCore.isMapReady() && !window.MapCore.isMapLoaded()) {
		console.log('[MapBasemap] Map never loaded; recreating with style:', newStyleUrl);
		hideErrorOverlay();
		recreateMapWithStyle(newStyleUrl);
		return;
	}

	if (!window.MapUtils.withMap(function(map) {
		if (newStyleUrl === window.MapCore.getCurrentStyleUrl()) {
			console.log('Style URL unchanged, skipping update');
			return;
		}

		console.log('Updating map style to:', newStyleUrl);
		hideErrorOverlay();
		window.MapCore.setCurrentStyleUrl(newStyleUrl);

		// Store current view state
		var currentCenter = map.getCenter();
		var currentZoom = map.getZoom();
		var currentBearing = map.getBearing();
		var currentPitch = map.getPitch();

		map.setStyle(newStyleUrl, {
			transformStyle: function(previousStyle, nextStyle) {
				return nextStyle;
			}
		});

		notifyMapReadyWhenStyleLoaded(map);

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
 * Update basemap - handles both vector styles and raster tiles.
 * If the previous map instance never finished loading, the map is recreated
 * from scratch instead of calling setStyle on a broken instance.
 * @param {Object} basemap - Basemap configuration
 */
function updateBasemap(basemap) {
	if (window.MapCore.isMapReady() && !window.MapCore.isMapLoaded()) {
		console.log('[MapBasemap] Map never loaded; recreating with basemap:', basemap.id, basemap.name);
		hideErrorOverlay();
		if (basemap.type === 'raster' && basemap.tileUrl) {
			recreateMapWithStyle(createRasterStyle(basemap));
		} else if (basemap.styleUrl) {
			recreateMapWithStyle(basemap.styleUrl);
		}
		return;
	}

	if (!window.MapUtils.withMap(function(map) {
		console.log('[MapBasemap] updateBasemap called:', basemap.id, basemap.name);
		hideErrorOverlay();

		// Store current view state
		var currentCenter = map.getCenter();
		var currentZoom = map.getZoom();
		var currentBearing = map.getBearing();
		var currentPitch = map.getPitch();

		if (basemap.type === 'raster' && basemap.tileUrl) {
			// Raster tile basemap
			console.log('[MapBasemap] Setting raster basemap:', basemap.tileUrl);

			var rasterStyle = createRasterStyle(basemap);
			window.MapCore.setCurrentStyleUrl(null);

			map.setStyle(rasterStyle, {
				transformStyle: function(previousStyle, nextStyle) {
					return nextStyle;
				}
			});

			notifyMapReadyWhenStyleLoaded(map);

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
			// Fall back to the native name when the style has no localized
			// name for the requested language; otherwise labels disappear
			// entirely for languages with partial coverage.
			textField = ['coalesce', ['get', 'name:' + language], ['get', 'name']];
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

/**
 * Recreate the map instance from scratch. Used to recover from a previous
 * failed initial load (e.g. a remote vector style fetch failed while offline),
 * since setStyle on a never-loaded map does not reliably render. The current
 * view state is captured before teardown and applied to the new instance.
 * @param {string|Object} style - New style URL or inline style JSON object
 * @returns {boolean} True if recreation was started, false if unavailable
 */
function recreateMapWithStyle(style) {
	var existingMap = window.MapCore.getMap();
	var savedViewState = null;
	if (existingMap) {
		try {
			savedViewState = window.MapUtils.createViewState(existingMap);
		} catch (e) {
			savedViewState = null;
		}
		try {
			existingMap.remove();
		} catch (e) {
			console.warn('Error removing previous map instance:', e);
		}
	}

	window.MapCore.setCurrentStyleUrl(style);

	var viewStateArg = null;
	if (savedViewState) {
		viewStateArg = {
			center: { longitude: savedViewState.center.lng, latitude: savedViewState.center.lat },
			zoom: savedViewState.zoom,
			bearing: savedViewState.bearing,
			pitch: savedViewState.pitch
		};
	}

	window.MapCore.initializeMap(viewStateArg);

	return window.MapCore.isMapReady();
}

window.MapBasemap = {
	updateMapStyle: updateMapStyle,
	createRasterStyle: createRasterStyle,
	updateBasemap: updateBasemap,
	changeMapLanguage: changeMapLanguage,
	recreateMapWithStyle: recreateMapWithStyle
};