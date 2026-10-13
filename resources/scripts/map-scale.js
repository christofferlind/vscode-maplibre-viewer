/**
 * Map Scale Module
 * Scale bar control with a unit system ('metric', default, or 'imperial')
 * configurable from the extension settings. Loaded after map-core.js so it
 * can wrap MapCore.initializeMap: every (re-)created map instance gets a
 * fresh scale control without map-core.js owning the feature.
 */

// Scale control state: 'metric' (default), 'imperial', 'nautical', or 'off'
// (hidden). The control is created once per map and switched when the
// preference changes.
var scaleUnits = 'metric';
var scaleControl = null;

/**
 * Create the scale control (once per map) and apply the configured unit
 * system ('metric' or 'imperial'), or remove it when the unit system is
 * 'off'. Safe to call repeatedly whenever the preference changes or a new
 * map instance is created.
 */
function applyScaleUnits() {
	if (!map) {
		return;
	}
	if (scaleUnits === 'off') {
		if (scaleControl) {
			map.removeControl(scaleControl);
			scaleControl = null;
		}
		return;
	}
	if (!scaleControl && maplibregl.ScaleControl) {
		scaleControl = new maplibregl.ScaleControl({ maxWidth: 120, unit: scaleUnits });
		map.addControl(scaleControl, 'bottom-left');
	}
	// MapLibre v5 and earlier name the method setUnits; v6 renamed it setUnit
	// (singular). Support both so the unit switch happens on every version.
	if (scaleControl) {
		var setUnitsMethod = scaleControl.setUnits || scaleControl.setUnit;
		if (typeof setUnitsMethod === 'function') {
			setUnitsMethod.call(scaleControl, scaleUnits);
		}
	}
}

/**
 * Drop the scale control reference for a map instance that is being replaced
 * (basemap switches recreate the map). The control is re-created lazily by
 * applyScaleUnits.
 */
function resetScaleControl() {
	scaleControl = null;
}

/**
 * Set the unit-system preference from a raw setting value and apply it to the
 * live map. 'off', 'imperial' and 'nautical' are used as-is; anything else
 * normalizes to 'metric'.
 * @param {string} units - 'off', 'metric', 'imperial', or 'nautical'
 */
function setScaleUnits(units) {
	scaleUnits = units === 'off' || units === 'imperial' || units === 'nautical' ? units : 'metric';
	applyScaleUnits();
}

/**
 * Report the current scale control state for tests and diagnostics.
 * @returns {Object} { configured, onMap }
 */
function getScaleControlState() {
	return {
		configured: scaleUnits,
		onMap: scaleControl !== null && map !== null
	};
}

window.MapScale = {
	setUnits: setScaleUnits,
	applyScaleUnits: applyScaleUnits,
	resetScaleControl: resetScaleControl,
	getScaleControlState: getScaleControlState
};

// Wrap MapCore.initializeMap so each new map instance starts with a reset
// scale control that is then created per the configured units. The wrapped
// function is what every later caller (main.js, basemap recreation) resolves
// at call time, so basemap switches pick it up too.
(function attachScaleControlToMap() {
	if (!window.MapCore || typeof window.MapCore.initializeMap !== 'function') {
		return;
	}
	var originalInitializeMap = window.MapCore.initializeMap;
	window.MapCore.initializeMap = function(initialViewState) {
		resetScaleControl();
		var created = originalInitializeMap(initialViewState);
		applyScaleUnits();
		return created;
	};
})();