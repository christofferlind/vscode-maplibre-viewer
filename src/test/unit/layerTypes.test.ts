import * as assert from 'assert';
import {
    isBaseMapsRoot,
    isLayersRoot,
    isBaseMapStyle,
    isOverlayLayer,
    DEFAULT_OVERLAY_LAYERS,
    SELECTED_FILE_LAYER_ID
} from '../../layers/layerTypes';

suite('layerTypes Type Guards', () => {
    suite('isBaseMapsRoot', () => {
        test('should return true for baseMapsRoot', () => {
            assert.strictEqual(isBaseMapsRoot('baseMapsRoot'), true);
        });

        test('should return false for other values', () => {
            assert.strictEqual(isBaseMapsRoot('layersRoot'), false);
            assert.strictEqual(isBaseMapsRoot('bogus' as never), false);
        });
    });

    suite('isLayersRoot', () => {
        test('should return true for layersRoot', () => {
            assert.strictEqual(isLayersRoot('layersRoot'), true);
        });

        test('should return false for other values', () => {
            assert.strictEqual(isLayersRoot('baseMapsRoot'), false);
            assert.strictEqual(isLayersRoot('bogus' as never), false);
        });
    });

    suite('isBaseMapStyle', () => {
        test('should return true for vector style with styleUrl', () => {
            assert.strictEqual(isBaseMapStyle({ id: 'v', name: 'v', styleUrl: 'x' }), true);
        });

        test('should return true for raster style with tileUrl', () => {
            assert.strictEqual(isBaseMapStyle({ id: 'r', name: 'r', tileUrl: 'x' }), true);
        });

        test('should return false for strings and roots', () => {
            assert.strictEqual(isBaseMapStyle('baseMapsRoot'), false);
            assert.strictEqual(isBaseMapStyle('layersRoot'), false);
        });

        test('should return false for overlay layers and null', () => {
            assert.strictEqual(isBaseMapStyle(null as never), false);
            assert.strictEqual(
                isBaseMapStyle({ id: 'o', name: 'o', type: 'geojson', visible: true, source: { type: 'geojson' } } as never),
                false
            );
        });
    });

    suite('isOverlayLayer', () => {
        test('should return true for objects with visible property', () => {
            const overlay = { id: 'o', name: 'o', type: 'geojson', visible: true, source: { type: 'geojson' } } as never;
            assert.strictEqual(isOverlayLayer(overlay), true);
        });

        test('should return false for basemaps, roots and null', () => {
            assert.strictEqual(isOverlayLayer('layersRoot'), false);
            assert.strictEqual(isOverlayLayer('baseMapsRoot'), false);
            assert.strictEqual(isOverlayLayer({ id: 'b', name: 'b', styleUrl: 'x' }), false);
            assert.strictEqual(isOverlayLayer(null as never), false);
        });
    });

    suite('constants', () => {
        test('should define the selected file layer id', () => {
            assert.strictEqual(SELECTED_FILE_LAYER_ID, 'selected-file');
        });

        test('should provide a default overlay layer for the selected file', () => {
            assert.strictEqual(DEFAULT_OVERLAY_LAYERS.length, 1);
            assert.strictEqual(DEFAULT_OVERLAY_LAYERS[0].id, SELECTED_FILE_LAYER_ID);
            assert.strictEqual(DEFAULT_OVERLAY_LAYERS[0].type, 'geojson');
            assert.strictEqual(DEFAULT_OVERLAY_LAYERS[0].visible, false);
        });
    });
});
