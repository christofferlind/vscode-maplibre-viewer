/**
 * Map Terrain Module
 * Opt-in 3D terrain rendering: raster-dem source, separate hillshade
 * source/layer, and a TerrainControl. Loaded before map-core.js so MapCore
 * can export applyTerrain; the function reads the map instance and the
 * style-readiness helpers through the map-core globals, which exist by the
 * time any call is made, never at load time.
 */

var terrain = true;
var terrainUrl = 'https://tiles.mapterhorn.com/tilejson.json';

// Terrain source added to the map when 3D terrain is enabled
var terrainSourceId = 'terrain-3d';

// Separate raster-dem source and hillshade layer for render quality
var hillshadeSourceId = 'hillshade-3d';
var hillshadeLayerId = 'hillshade-3d';

// TerrainControl instance shown while 3D terrain is available
var terrainControl = null;

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