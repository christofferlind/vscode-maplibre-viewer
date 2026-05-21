import * as vscode from 'vscode';
import * as path from 'path';
import { OverlayLayer } from './layerTypes';
import { FileToGeoJsonAdapter } from '../services/api';
import { validateFile, convertToGeoJson, getDefaultLayerName } from '../services/fileConversionService';
import { calculateBoundingBoxFromGeoJson, BoundingBox } from '../services/coordinateParser';

const MIME_TEXT_URI_LIST = 'text/uri-list';

export interface DragDropResult {
    addedLayers: { layer: OverlayLayer; bbox: BoundingBox | null }[];
    errors: { file: string; error: string }[];
}

/**
 * Parses URI list from a DataTransfer object.
 */
function parseUriList(sources: vscode.DataTransfer): vscode.Uri[] {
    const uriList = sources.get(MIME_TEXT_URI_LIST);
    if (!uriList) {
        return [];
    }

    const uriListValue = uriList.value;
    if (typeof uriListValue !== 'string' || !uriListValue.trim()) {
        return [];
    }

    return uriListValue
        .split('\n')
        .map(u => u.trim())
        .filter(u => u.length > 0)
        .map(u => {
            try {
                return vscode.Uri.parse(u);
            } catch {
                return undefined;
            }
        })
        .filter((u): u is vscode.Uri => u !== undefined);
}

/**
 * Processes a single dropped file and converts it to a GeoJSON layer.
 */
async function processDroppedFile(
    filePath: string,
    fileAdapters: FileToGeoJsonAdapter[]
): Promise<{
    success: boolean;
    layer?: OverlayLayer;
    bbox?: BoundingBox | null;
    error?: string;
}> {
    const validation = validateFile(filePath);
    if (!validation.valid) {
        return { success: false, error: validation.error };
    }

    try {
        const geojson = await convertToGeoJson(filePath, fileAdapters);
        const layerName = getDefaultLayerName(filePath);
        const layerId = `drag-drop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const newLayer: OverlayLayer = {
            id: layerId,
            name: layerName,
            description: `Imported from ${path.basename(filePath)}`,
            type: 'geojson',
            source: {
                type: 'geojson',
                data: geojson
            },
            visible: true
        };

        const bbox = calculateBoundingBoxFromGeoJson(geojson);
        return { success: true, layer: newLayer, bbox };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
    }
}

/**
 * Processes drag-and-drop data transfer items into overlay layers.
 * Validates files, converts them to GeoJSON, and returns results.
 */
export async function processDragDropItems(
    sources: vscode.DataTransfer,
    fileAdapters: FileToGeoJsonAdapter[]
): Promise<DragDropResult> {
    const uris = parseUriList(sources);
    const addedLayers: { layer: OverlayLayer; bbox: BoundingBox | null }[] = [];
    const errors: { file: string; error: string }[] = [];

    for (const uri of uris) {
        if (uri.scheme !== 'file') {
            errors.push({
                file: uri.toString(),
                error: 'Only local files are supported'
            });
            continue;
        }

        const result = await processDroppedFile(uri.fsPath, fileAdapters);
        if (result.success && result.layer && result.bbox !== undefined) {
            addedLayers.push({ layer: result.layer, bbox: result.bbox });
        } else if (result.error) {
            errors.push({ file: path.basename(uri.fsPath), error: result.error });
        }
    }

    return { addedLayers, errors };
}
