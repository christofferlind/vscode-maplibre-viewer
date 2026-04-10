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

#### Custom Coordinate Patterns

You can extend the coordinate parser with custom patterns to detect coordinate formats specific to your workflow or data sources. This is useful for proprietary formats, regional coordinate systems, or specialized notation.

##### Adding Patterns via VS Code Settings

1. Open VS Code Settings (`Ctrl+,` / `Cmd+,`)
2. Search for "MapLibre Viewer" or navigate to **Extensions > MapLibre Viewer**
3. Find the **Coordinate Patterns** setting
4. Click **Edit in settings.json** to add your patterns

Alternatively, edit your `settings.json` directly:

```json
{
  "vscodeMaplibreViewer.coordinatePatterns": [
    {
      "name": "Swedish Grid (SWEREF99 TM)",
      "pattern": "X:\\s*(?<lng>\\d+)\\s*,\\s*Y:\\s*(?<lat>\\d+)",
      "flags": "g"
    },
    {
      "name": "UTM Coordinates",
      "pattern": "UTM\\s*\\d+[NS]\\s*(?<lng>\\d+)\\s*(?<lat>\\d+)",
      "flags": "gi"
    },
    {
      "name": "British National Grid",
      "pattern": "Easting:\\s*(?<lng>\\d+)\\s*Northing:\\s*(?<lat>\\d+)",
      "flags": "g"
    }
  ]
}
```

**Pattern Properties:**
- `name` (required): A descriptive name for the pattern (shown in logs and error messages)
- `pattern` (required): The regex pattern string with named capture groups
- `flags` (optional): Regex flags (default: `g`). Common flags:
  - `g` - Global (find all matches, required)
  - `i` - Case-insensitive matching
  - `m` - Multiline mode

##### Pattern Requirements

**Named Groups:**
- For simple coordinates: Use `(?<lat>...)` and `(?<lng>...)` named groups
- For DMS (Degrees Minutes Seconds) format: Use these named groups:
  - `latDegrees`, `latMinutes`, `latSeconds`, `latDirection`
  - `lngDegrees`, `lngMinutes`, `lngSeconds`, `lngDirection`

**Regex Flags:**
- Always include the `g` (global) flag to find all matches in the text
- Use `i` flag for case-insensitive matching (e.g., `LAT`/`lat`/`Lat`)

**Escaping in JSON:**
When writing patterns in `settings.json`, remember to double-escape backslashes:
- `\d` becomes `\\d`
- `\s` becomes `\\s`
- `\.` becomes `\\.`

##### Testing Your Patterns

You can test your custom patterns by:
1. Adding them to settings
2. Selecting text containing coordinates in your format
3. The map should automatically navigate to the detected coordinates

If a pattern fails to load, check the **Output** panel (View > Output) for error messages.

For adding patterns programmatically via the extension API, see the [DEVELOPMENT.md](docs/DEVELOPMENT.md#extension-api) documentation.

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

- **Bookmark Current View**: Save current map position (center, zoom, bearing, pitch) as a named bookmark
- **Load Bookmark**: Quick-pick dialog to navigate to saved bookmarks
- **Persistent Storage**: Bookmarks are saved globally and persist across sessions
- **Duplicate Handling**: Prompts to overwrite existing bookmarks with same name

### 🔍 Search Functionality

- **Geocoding Search**: Search for places directly from the map view
- **MapTiler Integration**: Configure your MapTiler API key for enhanced search functionality
- **Photon Fallback**: Free Photon geocoding service available when MapTiler API key is not configured
- **Toggle Search**: Enable/disable search via settings

### ⚙️ Configuration

Customize the extension via VS Code settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `vscodeMaplibreViewer.geocodingApiKey` | API key for MapTiler geocoding service | `""` (empty) |
| `vscodeMaplibreViewer.photonSearchUrl` | URL for Photon geocoding search service | `"https://photon.komoot.io/api/"` |
| `vscodeMaplibreViewer.enableSearch` | Enable search functionality | `true` |
| `vscodeMaplibreViewer.flyToDuration` | Animation duration in ms | `500` |
| `vscodeMaplibreViewer.singlePointZoom` | Zoom level for single coordinate points | `10` |
| `vscodeMaplibreViewer.baseMaps` | Custom basemap styles | `[]` (empty) |
| `vscodeMaplibreViewer.coordinatePatterns` | Custom coordinate detection patterns | `[]` (empty) |

### 🗺️ Custom Basemaps

You can contribute custom basemaps in two ways:

#### Via Configuration (settings.json)

Add custom basemaps in your VS Code settings. The extension supports both **vector styles** (MapLibre style JSON) and **raster tiles** (XYZ tile servers):

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
    },
    {
      "id": "custom-imagery",
      "name": "Custom Imagery",
      "type": "raster",
      "tileUrl": "https://my-tile-server.com/{z}/{x}/{y}.png",
      "tileSize": 512,
      "minzoom": 0,
      "maxzoom": 18
    }
  ]
}
```

**Basemap Properties:**
- `id` (required): Unique identifier for the basemap
- `name` (required): Display name shown in the Layers View
- `type` (optional): Type of basemap - `'vector'` for style JSON, `'raster'` for raster tiles. Defaults to `'vector'` if `styleUrl` is provided.
- `styleUrl` (optional): URL to the MapLibre style JSON (for vector basemaps)
- `tileUrl` (optional): Raster tile URL template with `{z}/{x}/{y}` placeholders (for raster basemaps)
- `tileSize` (optional): Tile size for raster sources (default: 256)
- `minzoom` (optional): Minimum zoom level for raster tiles
- `maxzoom` (optional): Maximum zoom level for raster tiles
- `description` (optional): Description shown in tooltips
- `thumbnail` (optional): Thumbnail image URL for the basemap

**Note:** A basemap must have either `styleUrl` (for vector) or `tileUrl` (for raster).

For programmatic registration of basemaps from other extensions, see the [Extension API](docs/DEVELOPMENT.md#extension-api) documentation.

### 🎯 Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| `Map: Set Language to Native` | Use native/local place names |
| `Map: Set Language to English` | Use English labels |
| `Map: Set Language to German` | Use German labels |
| `Map: Set Language...` | Open language picker |
| `Toggle Coordinate Selection` | Toggle coordinate detection on/off |
| `Enable Coordinate Selection` | Enable coordinate detection |
| `Disable Coordinate Selection` | Disable coordinate detection |
| `Open Map Settings` | Open extension settings |
| `Map: Bookmark Current View` | Save current view as bookmark |
| `Map: Load Bookmark...` | Load a saved bookmark |
| `Go to Bookmark` | Navigate to a bookmark |
| `Delete Bookmark` | Delete a saved bookmark |
| `Set Active Base Map` | Set the active basemap |
| `Toggle Layer Visibility` | Toggle overlay layer visibility |
| `Add Overlay Layer` | Add a new overlay layer |
| `Remove Layer` | Remove an overlay layer |

### 🛠️ Toolbar Icons

The map view toolbar provides quick access to:

- **Language Selector** - Change map label language
- **Coordinate Toggle** - Enable/disable coordinate detection
- **Bookmark** - Save current view as bookmark
- **Settings** - Open map settings

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "MapLibre Viewer"
4. Click Install

## Usage Examples

### Viewing GeoJSON Files

The MapLibre Viewer extension can automatically render GeoJSON files on an interactive map. Here's how to use this feature:

#### Step-by-Step Walkthrough

1. **Create or open a GeoJSON file** in VS Code with a `.geojson` or `.json` extension
2. **Select the file** in the editor or file explorer
3. The extension will automatically detect compatible file types and render the data on the map
4. The map viewport will automatically fit to the bounding box of all features

For a sample GeoJSON file for testing, see the [DEVELOPMENT.md](docs/DEVELOPMENT.md#testing) documentation.

#### Automatic Bounding Box Fitting

When a GeoJSON file is loaded, the extension automatically:

1. **Extracts all coordinates** from every feature in the collection (supports Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon, and GeometryCollection)
2. **Calculates the bounding box** using the `calculateBoundingBox` function to determine the geographic extent
3. **Fits the map viewport** to show all features using `fitMapToGeoJSON`, ensuring the entire dataset is visible with appropriate padding

This means you don't need to manually pan or zoom—the map will automatically center on your data.

#### Supported File Extensions

The extension supports GeoJSON files through the built-in adapter for:

- `.geojson` - Standard GeoJSON files
- `.json` - JSON files containing GeoJSON data

Additional file formats (KML, GPX, Shapefile, etc.) can be supported by installing extensions that register custom `FileToGeoJsonAdapter` implementations.

#### Tips for Best Results

- **Valid GeoJSON**: Ensure your file contains valid GeoJSON following [RFC 7946](https://tools.ietf.org/html/rfc7946)
- **Coordinate Order**: Remember GeoJSON uses `[longitude, latitude]` order (x, y)
- **Feature Properties**: Add meaningful properties to your features for future identification
- **Large Files**: For large datasets, consider splitting into smaller files for faster rendering

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

1. **Save**: Use "Map: Bookmark Current View" command or toolbar
2. **Load**: Use "Map: Load Bookmark..." command
3. Bookmarks are stored globally and persist across sessions

## Requirements

- VS Code 1.110.0 or higher
- For enhanced search functionality: MapTiler API key (or use the free Photon geocoding service)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

For development instructions, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Acknowledgments

- [MapLibre GL JS](https://maplibre.org/) - Open source vector tile rendering
- [VS Code Extension API](https://code.visualstudio.com/api) - Extension development