import { MapBookmark } from './bookmarkTypes';

/**
 * Generates a unique ID for bookmarks
 * @returns A unique string identifier
 */
export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 12);
}

/**
 * Validates that a bookmark has valid data
 * @param bookmark The bookmark to validate
 * @returns True if valid, false otherwise
 */
export function validateBookmark(bookmark: unknown): bookmark is MapBookmark {
    if (!bookmark || typeof bookmark !== 'object') {
        return false;
    }

    const b = bookmark as Partial<MapBookmark>;

    // Required fields
    if (typeof b.id !== 'string' || b.id.trim().length === 0) {
        return false;
    }
    if (typeof b.name !== 'string' || b.name.trim().length === 0) {
        return false;
    }
    if (!b.center || typeof b.center.latitude !== 'number' || typeof b.center.longitude !== 'number') {
        return false;
    }
    if (typeof b.zoom !== 'number') {
        return false;
    }

    // Validate coordinate ranges
    if (b.center.latitude < -90 || b.center.latitude > 90) {
        return false;
    }
    if (b.center.longitude < -180 || b.center.longitude > 180) {
        return false;
    }
    if (b.zoom < 0 || b.zoom > 28) {
        return false;
    }

    return true;
}