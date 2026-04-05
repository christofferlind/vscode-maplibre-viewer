# vscode-maplibre-viewer

A VS Code extension that provides an interactive map viewer powered by MapLibre GL JS and vector tiles. Perfect for visualizing geographic data and coordinates directly in your editor.

## Features

### 🗺️ Interactive Map View

- **Sidebar Panel**: Map view integrated into VS Code's activity bar for quick access
- **MapLibre GL JS**: Full-featured vector tile rendering with smooth pan/zoom
- **Customizable Map Style**: Configure your own style URL via settings
- **Configurable Animation**: Adjustable fly-to animation duration

### 📍 Coordinate Detection

Automatically detects and navigates to coordinates when you select text in the editor. Supports multiple coordinate formats:

- **Decimal Degrees**: `59.3293, 18.0686` or `59.3293 18.0686`
- **DMS Format**: `59°19'45.5"N 18°4'7.0"E`
- **GeoJSON Arrays**: `[18.0686, 59.3293]` (note: GeoJSON uses [lng, lat] order)
- **URL Format**: `@59.3293,18.0686` (common in mapping URLs)

The coordinate parser intelligently handles:
- Latitude/longitude detection based on value ranges
- Various separators (comma, space)
- Negative coordinates
- Coordinate validation

### 🌐 Multi-Language Map Labels

Support for 60+ languages for map labels:

- Native/Local place names
- English, German, French, Spanish, Russian
- Chinese (Simplified & Traditional), Japanese, Korean
- Arabic, Hindi, Dutch, Polish, Turkish
- And many more...

Quick access via:
- **Map: Set Language to Native** - Use local place names
- **Map: Set Language to English** - Use English labels
- **Map: Set Language to German** - Use German labels
- **Map: Set Language...** - Open language picker with all options

### 🔖 Bookmark Management

Save and manage your favorite map locations:

- **Save View**: Save current map position (center, zoom, bearing, pitch) as a named bookmark
- **Load Place**: Quick-pick dialog to navigate to saved bookmarks
- **Persistent Storage**: Bookmarks are saved globally and persist across sessions
- **Duplicate Handling**: Prompts to overwrite existing bookmarks with same name

### 🔍 Search Functionality

- **Geocoding Search**: Search for places directly from the map view (requires API key)
- **MapTiler Integration**: Configure your MapTiler API key for search functionality
- **Toggle Search**: Enable/disable search via settings

### ⚙️ Configuration

Customize the extension via VS Code settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `vscodeMaplibreViewer.geocodingApiKey` | API key for geocoding service | `""` (empty) |
| `vscodeMaplibreViewer.enableSearch` | Enable search functionality | `true` |
| `vscodeMaplibreViewer.flyToDuration` | Animation duration in ms | `500` |
| `vscodeMaplibreViewer.baseMaps` | Custom basemap styles | `[]` (empty) |

### 🗺️ Custom Basemaps

You can contribute custom basemaps in two ways:

#### Via Configuration (settings.json)

Add custom basemaps in your VS Code settings:

```json
{
  "vscodeMaplibreViewer.baseMaps": [
    {
      "id": "osm-standard",
      "name": "OpenStreetMap",
      "styleUrl": "https://demotiles.maplibre.org/style.json",
      "description": "OpenStreetMap default style"
    },
    {
      "id": "maptiler-streets",
      "name": "MapTiler Streets",
      "styleUrl": "https://api.maptiler.com/maps/streets/style.json?key=YOUR_KEY",
      "description": "MapTiler streets style"
    },
    {
      "id": "custom-satellite",
      "name": "My Satellite",
      "styleUrl": "https://my-server.com/styles/satellite/style.json"
    }
  ]
}
```

**Basemap Properties:**
- `id` (required): Unique identifier for the basemap
- `name` (required): Display name shown in the Layers View
- `styleUrl` (required): URL to the MapLibre style JSON
- `description` (optional): Description shown in tooltips
- `thumbnail` (optional): Thumbnail image URL for the basemap

#### Via Extension API

Other VS Code extensions can register basemaps programmatically. See the [Extension API](#extension-api) section for details.

### 🎯 Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| `Map: Set Language to Native` | Use native/local place names |
| `Map: Set Language to English` | Use English labels |
| `Map: Set Language to German` | Use German labels |
| `Map: Set Language...` | Open language picker |
| `Listen for Coordinate Selection` | Toggle coordinate detection on/off |
| `Open Map Settings` | Open extension settings |
| `Map: Save Current View` | Save current view as bookmark |
| `Map: Load Saved Place...` | Load a saved bookmark |

### 🛠️ Toolbar Icons

The map view toolbar provides quick access to:

- **Language Selector** - Change map label language
- **Coordinate Toggle** - Enable/disable coordinate detection
- **Settings** - Open map settings

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "MapLibre Viewer"
4. Click Install

## Usage

1. Click the **Maps** icon in the activity bar (left sidebar)
2. The map view will open in the sidebar panel
3. Interact with the map using mouse/trackpad:
   - **Pan**: Click and drag
   - **Zoom**: Scroll wheel or +/- buttons
   - **Rotate**: Right-click and drag
   - **Tilt**: Ctrl + drag

### Coordinate Detection

1. Select text containing coordinates in any editor
2. The map will automatically fly to that location
3. Toggle detection on/off via the toolbar icon

### Bookmarks

1. **Save**: Use "Map: Save Current View" command or toolbar
2. **Load**: Use "Map: Load Saved Place..." command
3. Bookmarks are stored globally and persist across sessions

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/your-username/vscode-maplibre-viewer.git
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

## Extension API

The MapLibre Viewer extension exposes a public API that allows other VS Code extensions to register custom basemaps.

### Accessing the API

```typescript
const extension = vscode.extensions.getExtension<MapLibreViewerAPI>('your-publisher.vscode-maplibre-viewer');
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
- `styleUrl` (string, required): URL to the MapLibre style JSON
- `description` (string, optional): Description shown in tooltips

Returns a `Disposable` that removes the basemap when disposed.

#### `getBasemaps(): readonly BaseMapStyle[]`

Get all registered basemaps (both built-in and external).

#### `getActiveBasemap(): BaseMapStyle | undefined`

Get the currently active basemap.

#### `onDidChangeActiveBasemap: Event<BaseMapStyle>`

Event that fires when the active basemap changes.

### Example Extension

```typescript
import * as vscode from 'vscode';
import { MapLibreViewerAPI, BasemapProvider } from 'vscode-maplibre-viewer';

export function activate(context: vscode.ExtensionContext) {
    const maplibreExt = vscode.extensions.getExtension<MapLibreViewerAPI>(
        'publisher.vscode-maplibre-viewer'
    );
    
    if (!maplibreExt?.exports) {
        console.warn('MapLibre Viewer extension not found');
        return;
    }
    
    const api = maplibreExt.exports;
    
    // Register custom basemaps
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
        }
    ];
    
    for (const basemap of basemaps) {
        const disposable = api.registerBasemap(basemap);
        context.subscriptions.push(disposable);
    }
}
```

## Requirements

- VS Code 1.110.0 or higher
- For search functionality: MapTiler API key (or compatible geocoding service)

## Known Issues

- This extension is currently a work in progress
- Some features may be incomplete or subject to change

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- [MapLibre GL JS](https://maplibre.org/) - Open source vector tile rendering
- [VS Code Extension API](https://code.visualstudio.com/api) - Extension development