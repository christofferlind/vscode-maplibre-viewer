# Development

This document contains development instructions for the vscode-maplibre-viewer extension.

## Building from Source

```bash
# Clone the repository
git clone https://github.com/christofferlind/vscode-maplibre-viewer.git
cd vscode-maplibre-viewer

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Copy MapLibre assets
npm run copy-assets

# Press F5 in VS Code to launch extension development host
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run compile` | Compile TypeScript |
| `npm run watch` | Watch for changes |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests |
| `npm run copy-assets` | Copy MapLibre GL assets |
| `npm run package` | Package extension as VSIX |

## Extension API

The MapLibre Viewer extension exposes a public API that allows other VS Code extensions to register custom basemaps, file adapters, and coordinate patterns.

### Accessing the API

```typescript
const extension = vscode.extensions.getExtension<MapLibreViewerAPI>('christofferlind.vscode-maplibre-viewer');
const api = extension?.exports;

if (api) {
    // Register a custom basemap
    const disposable = api.registerBasemap({
        id: 'my-custom-basemap',
        name: 'My Custom Basemap',
        styleUrl: 'https://my-server.com/style.json',
        description: 'A custom basemap from my server'
    });
    
    // Clean up when done
    context.subscriptions.push(disposable);
}
```

### API Reference

#### `registerBasemap(provider: BasemapProvider): Disposable`

Register a custom basemap from an external extension.

**BasemapProvider interface:**
- `id` (string, required): Unique identifier for the basemap
- `name` (string, required): Display name shown in the Layers View
- `type` (string, optional): Type of basemap - `'vector'` or `'raster'`. Defaults to `'vector'` if `styleUrl` is provided.
- `styleUrl` (string, optional): URL to the MapLibre style JSON (for vector basemaps)
- `tileUrl` (string, optional): Raster tile URL template with `{z}/{x}/{y}` placeholders (for raster basemaps)
- `tileSize` (number, optional): Tile size for raster sources (default: 256)
- `minzoom` (number, optional): Minimum zoom level for raster tiles
- `maxzoom` (number, optional): Maximum zoom level for raster tiles
- `description` (string, optional): Description shown in tooltips

**Note:** A basemap must have either `styleUrl` (for vector) or `tileUrl` (for raster).

Returns a `Disposable` that removes the basemap when disposed.

#### `getBasemaps(): readonly BaseMapStyle[]`

Get all registered basemaps (both built-in and external).

#### `getActiveBasemap(): BaseMapStyle | undefined`

Get the currently active basemap.

#### `onDidChangeActiveBasemap: Event<BaseMapStyle>`

Event that fires when the active basemap changes.

#### `registerFileToGeoJsonAdapter(adapter: FileToGeoJsonAdapter): Disposable`

Register a custom file-to-GeoJSON adapter from an external extension. This allows other extensions to add support for additional file formats (KML, GPX, Shapefile, etc.).

**FileToGeoJsonAdapter interface:**
- `getName(): string` - Returns the display name of the adapter
- `canHandle(fileExtension: string): boolean` - Checks if the adapter can handle the given file extension (e.g., `.kml`, `.gpx`)
- `toGeoJson(filePath: string): Promise<object>` - Converts the file at the given path to a GeoJSON object

Returns a `Disposable` that removes the adapter when disposed.

#### `getFileToGeoJsonAdapters(): readonly FileToGeoJsonAdapter[]`

Get all registered file-to-GeoJSON adapters.

#### `addCoordinatePattern(pattern: RegExp): void`

Add a custom coordinate detection pattern. This allows other extensions to add support for additional coordinate formats.

**Pattern Requirements:**
- Use named capture groups: `(?<lat>...)` and `(?<lng>...)` for simple coordinates
- For DMS (Degrees Minutes Seconds) format, use these named groups:
  - `latDegrees`, `latMinutes`, `latSeconds`, `latDirection`
  - `lngDegrees`, `lngMinutes`, `lngSeconds`, `lngDirection`
- Always include the `g` (global) flag to find all matches in the text
- Use `i` flag for case-insensitive matching

#### `getCoordinatePatterns(): RegExp[]`

Get all registered coordinate patterns (both default and custom).

#### `clearCustomPatterns(): void`

Clear all custom coordinate patterns (keeps default patterns).

### Example: Custom Coordinate Patterns

```typescript
import { addCoordinatePattern, clearCustomPatterns, getCoordinatePatterns } from 'vscode-maplibre-viewer';

// Example 1: Swedish SWEREF99 TM coordinates
// Format: "X: 123456, Y: 6543210"
addCoordinatePattern(/X:\s*(?<lng>\d+)\s*,\s*Y:\s*(?<lat>\d+)/g);

// Example 2: UTM coordinates with zone
// Format: "UTM 33N 123456 6543210"
addCoordinatePattern(/UTM\s*\d+[NS]\s*(?<lng>\d+)\s*(?<lat>\d+)/gi);

// Example 3: British National Grid
// Format: "Easting: 123456 Northing: 6543210"
addCoordinatePattern(/Easting:\s*(?<lng>\d+)\s*Northing:\s*(?<lat>\d+)/g);

// Example 4: Custom format with labels
// Format: "LAT: 59.3293 LON: 18.0686"
addCoordinatePattern(/LAT:\s*(?<lat>-?\d+\.?\d*)\s+LON:\s*(?<lng>-?\d+\.?\d*)/gi);

// Get all registered patterns (default + custom)
const allPatterns = getCoordinatePatterns();

// Clear all custom patterns (keeps default patterns)
clearCustomPatterns();
```

### Example: Custom Basemap Extension

```typescript
import * as vscode from 'vscode';
import { MapLibreViewerAPI, BasemapProvider } from 'vscode-maplibre-viewer';

export function activate(context: vscode.ExtensionContext) {
    const maplibreExt = vscode.extensions.getExtension<MapLibreViewerAPI>(
        'christofferlind.vscode-maplibre-viewer'
    );
    
    if (!maplibreExt?.exports) {
        console.warn('MapLibre Viewer extension not found');
        return;
    }
    
    const api = maplibreExt.exports;
    
    // Register custom basemaps (both vector and raster)
    const basemaps: BasemapProvider[] = [
        {
            id: 'my-company.streets',
            name: 'Company Streets',
            styleUrl: 'https://tiles.mycompany.com/styles/streets.json',
            description: 'Company internal street map'
        },
        {
            id: 'my-company.satellite',
            name: 'Company Satellite',
            styleUrl: 'https://tiles.mycompany.com/styles/satellite.json'
        },
        {
            id: 'my-company.raster-imagery',
            name: 'Company Imagery',
            type: 'raster',
            tileUrl: 'https://tiles.mycompany.com/imagery/{z}/{x}/{y}.png',
            tileSize: 512,
            minzoom: 0,
            maxzoom: 18
        }
    ];
    
    for (const basemap of basemaps) {
        const disposable = api.registerBasemap(basemap);
        context.subscriptions.push(disposable);
    }
}
```

### Example: Custom File Adapter Extension

This example shows how to create an extension that adds support for KML files:

```typescript
import * as vscode from 'vscode';
import { MapLibreViewerAPI, FileToGeoJsonAdapter } from 'vscode-maplibre-viewer';
import * as fs from 'fs';

// Example KML to GeoJSON converter (simplified)
async function convertKmlToGeoJson(filePath: string): Promise<object> {
    const kmlContent = fs.readFileSync(filePath, 'utf-8');
    // Implement your KML parsing logic here
    // This is a simplified example - use a proper KML parser library
    const geojson = {
        type: 'FeatureCollection',
        features: [] // Parse KML and populate features
    };
    return geojson;
}

export function activate(context: vscode.ExtensionContext) {
    const maplibreExt = vscode.extensions.getExtension<MapLibreViewerAPI>(
        'christofferlind.vscode-maplibre-viewer'
    );
    
    if (!maplibreExt?.exports) {
        console.warn('MapLibre Viewer extension not found');
        return;
    }
    
    const api = maplibreExt.exports;
    
    // Register KML file adapter
    const kmlAdapter: FileToGeoJsonAdapter = {
        getName: () => 'KML Adapter',
        canHandle: (fileExtension: string) => {
            return fileExtension.toLowerCase() === '.kml';
        },
        toGeoJson: async (filePath: string) => {
            return convertKmlToGeoJson(filePath);
        }
    };
    
    const disposable = api.registerFileToGeoJsonAdapter(kmlAdapter);
    context.subscriptions.push(disposable);
}
```

When a user opens a `.kml` file in VS Code, the MapLibre Viewer extension will:
1. Check all registered adapters via `canHandle()`
2. Find the KML adapter that handles `.kml` files
3. Call `toGeoJson()` to convert the file
4. Display the resulting GeoJSON on the map
5. Automatically fit the map viewport to show all features

## Testing

### Sample GeoJSON for Testing

Copy this sample GeoJSON to a file (e.g., `sample.geojson`) to test the extension:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "Central Park",
        "type": "park"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-73.9732, 40.7644],
          [-73.9819, 40.7681],
          [-73.9580, 40.8006],
          [-73.9494, 40.7969],
          [-73.9732, 40.7644]
        ]]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "name": "Brooklyn Bridge",
        "type": "landmark"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-73.9969, 40.7061],
          [-73.9903, 40.7024],
          [-73.9834, 40.6997]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "name": "Empire State Building",
        "type": "landmark"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [-73.9857, 40.7484]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "name": "Statue of Liberty",
        "type": "monument"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [-74.0445, 40.6892]
      }
    }
  ]
}
```

## Requirements

- VS Code 1.110.0 or higher
- For enhanced search functionality: MapTiler API key (or use the free Photon geocoding service)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- [MapLibre GL JS](https://maplibre.org/) - Open source vector tile rendering
- [VS Code Extension API](https://code.visualstudio.com/api) - Extension development