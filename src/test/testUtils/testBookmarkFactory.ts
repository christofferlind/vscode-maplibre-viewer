import { MapBookmark } from '../../bookmarks/bookmarkTypes';

/**
 * Factory for creating test bookmarks with sensible defaults.
 * @param overrides - Partial bookmark properties to override defaults
 * @returns A complete MapBookmark object
 */
export function createTestBookmark(overrides?: Partial<MapBookmark>): MapBookmark {
    return {
        id: 'test-bookmark-id',
        name: 'Test Location',
        center: { latitude: 59.3293, longitude: 18.0686 },
        zoom: 12,
        bearing: 0,
        pitch: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        ...overrides
    };
}

/**
 * Creates a bookmark representing Stockholm, Sweden
 */
export function createStockholmBookmark(overrides?: Partial<MapBookmark>): MapBookmark {
    return createTestBookmark({
        id: 'stockholm-id',
        name: 'Stockholm',
        center: { latitude: 59.3293, longitude: 18.0686 },
        zoom: 12,
        ...overrides
    });
}

/**
 * Creates a bookmark representing Gothenburg, Sweden
 */
export function createGothenburgBookmark(overrides?: Partial<MapBookmark>): MapBookmark {
    return createTestBookmark({
        id: 'gothenburg-id',
        name: 'Gothenburg',
        center: { latitude: 57.7089, longitude: 11.9746 },
        zoom: 11,
        ...overrides
    });
}

/**
 * Creates a bookmark with custom bearing and pitch
 */
export function createBookmarkWithRotation(overrides?: Partial<MapBookmark>): MapBookmark {
    return createTestBookmark({
        id: 'rotated-view-id',
        name: 'Rotated View',
        bearing: 45,
        pitch: 30,
        ...overrides
    });
}

/**
 * Creates a bookmark at extreme coordinates
 */
export function createExtremeCoordinatesBookmark(overrides?: Partial<MapBookmark>): MapBookmark {
    return createTestBookmark({
        id: 'extreme-coords-id',
        name: 'Extreme Location',
        center: { latitude: 89.9999, longitude: 179.9999 },
        zoom: 5,
        ...overrides
    });
}

/**
 * Creates a bookmark with all optional fields populated
 */
export function createFullBookmark(overrides?: Partial<MapBookmark>): MapBookmark {
    return createTestBookmark({
        id: 'full-bookmark-id',
        name: 'Full Featured Bookmark',
        description: 'A bookmark with all optional fields',
        center: { latitude: 59.3293, longitude: 18.0686 },
        zoom: 14,
        bearing: 90,
        pitch: 45,
        tags: ['favorite', 'work'],
        styleUrl: 'https://example.com/style.json',
        ...overrides
    });
}