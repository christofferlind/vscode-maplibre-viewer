import type { MapWebviewController } from './mapWebviewController';
import type { BaseMapStyle, OverlayLayer } from '../layers/layerTypes';
import type { MapBookmark } from '../bookmarks/bookmarkTypes';
import type { Coordinate } from '../services/coordinateParser';

/**
 * Manages multiple map webview providers and broadcasts operations to all.
 * This eliminates the need to manually call methods on both mapsViewProvider and mapEditorProvider.
 */
export class ProviderManager {
    private providers: MapWebviewController[] = [];

    /**
     * Registers a provider with the manager.
     * @param provider The provider to register
     */
    register(provider: MapWebviewController): void {
        this.providers.push(provider);
    }

    /**
     * Unregisters a provider from the manager.
     * @param provider The provider to unregister
     */
    unregister(provider: MapWebviewController): void {
        const index = this.providers.indexOf(provider);
        if (index !== -1) {
            this.providers.splice(index, 1);
        }
    }

    /**
     * Returns all registered providers.
     * @returns A copy of the providers array
     */
    getProviders(): MapWebviewController[] {
        return [...this.providers];
    }

    /**
     * Broadcasts a method call to all registered providers.
     * @param method - The method name to call
     * @param args - Arguments to pass to the method
     */
    private broadcast<K extends keyof MapWebviewController>(
        method: K,
        ...args: Parameters<MapWebviewController[K]>
    ): void {
        this.providers.forEach(provider => {
            const fn = provider[method];
            if (typeof fn === 'function') {
                (fn as (...args: unknown[]) => void).call(provider, ...args);
            }
        });
    }

    /**
     * Convenience method: fitBoundsOnly on all providers.
     * Fits the map to show a bounding box without creating markers.
     * @param bbox The bounding box with southwest and northeast coordinates
     */
    fitBoundsOnly(bbox: { southwest: Coordinate; northeast: Coordinate }): void {
        this.broadcast('fitBoundsOnly', bbox);
    }

    /**
     * Convenience method: flyToLocation on all providers.
     * Flies to a specific location on the map.
     * @param lat The latitude
     * @param lng The longitude
     * @param zoom Optional zoom level
     */
    flyToLocation(lat: number, lng: number, zoom?: number): void {
        this.broadcast('flyToLocation', lat, lng, zoom);
    }

    /**
     * Convenience method: updateOverlayLayers on all providers.
     * Updates the overlay layers on the map.
     * @param layers The overlay layers to set
     */
    updateOverlayLayers(layers: OverlayLayer[]): void {
        this.broadcast('updateOverlayLayers', layers);
    }

    /**
     * Convenience method: setBaseMap on all providers.
     * Sets the base map style.
     * @param baseMap The base map style to set
     */
    setBaseMap(baseMap: BaseMapStyle): void {
        this.broadcast('setBaseMap', baseMap);
    }

    /**
     * Convenience method: flyToBookmark on all providers.
     * Flies to a bookmark location on the map.
     * @param bookmark The bookmark to fly to
     */
    flyToBookmark(bookmark: MapBookmark): void {
        this.broadcast('flyToBookmark', bookmark);
    }

    /**
     * Convenience method: fitBoundingBox on all providers.
     * Fits the map to show all coordinates within a bounding box.
     * @param coordinates The coordinates to show
     * @param bbox The bounding box with southwest and northeast coordinates
     */
    fitBoundingBox(coordinates: Coordinate[], bbox: { southwest: Coordinate; northeast: Coordinate }): void {
        this.broadcast('fitBoundingBox', coordinates, bbox);
    }

    /**
     * Convenience method: updateConfiguration on all providers.
     * Updates the map configuration when settings change.
     */
    updateConfiguration(): void {
        this.broadcast('updateConfiguration');
    }

    /**
     * Convenience method: setMapLanguage on all providers.
     * Sets the map language for labels.
     * @param languageCode The language code to set
     */
    setMapLanguage(languageCode: string): void {
        this.broadcast('setMapLanguage', languageCode);
    }
}