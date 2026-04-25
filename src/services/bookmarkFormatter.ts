/**
 * Bookmark formatting utilities.
 * Provides formatters for bookmark display in tree views, tooltips, and copy operations.
 */

import * as vscode from 'vscode';
import type { MapBookmark } from '../bookmarks/bookmarkTypes';
import { formatCoordinate, formatViewState, formatBookmarkDescription } from './coordinateFormatter';

/**
 * Format a bookmark for display in the tree view.
 * @param bookmark - The bookmark to format
 * @returns Formatted label for the bookmark
 */
export function formatBookmarkLabel(bookmark: MapBookmark): string {
    return bookmark.name || formatCoordinate({
        latitude: bookmark.center.latitude,
        longitude: bookmark.center.longitude
    });
}

/**
 * Format a bookmark's tooltip content as a MarkdownString.
 * @param bookmark - The bookmark to format
 * @returns Formatted tooltip as MarkdownString
 */
export function formatBookmarkTooltip(bookmark: MapBookmark): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${bookmark.name}**\n\n`);
    
    if (bookmark.description) {
        md.appendMarkdown(`${bookmark.description}\n\n`);
    }
    
    // Use null-safe access for corrupted bookmark data
    const lat = bookmark.center?.latitude ?? 0;
    const lng = bookmark.center?.longitude ?? 0;
    md.appendMarkdown(`**Coordinates:** ${formatCoordinate({ latitude: lat, longitude: lng }, 6)}\n\n`);
    md.appendMarkdown(`**Zoom:** ${(bookmark.zoom ?? 0).toFixed(1)}\n\n`);
    md.appendMarkdown(`**Bearing:** ${(bookmark.bearing ?? 0).toFixed(0)}°\n\n`);
    md.appendMarkdown(`**Pitch:** ${(bookmark.pitch ?? 0).toFixed(0)}°\n\n`);
    
    if (bookmark.tags && bookmark.tags.length > 0) {
        md.appendMarkdown(`**Tags:** ${bookmark.tags.join(', ')}\n\n`);
    }
    
    md.appendMarkdown(`*Created: ${new Date(bookmark.createdAt).toLocaleString()}*`);
    
    return md;
}

/**
 * Format bookmark for copy/paste operations.
 * @param bookmark - The bookmark to format
 * @returns JSON string representation
 */
export function formatBookmarkForCopy(bookmark: MapBookmark): string {
    return JSON.stringify({
        name: bookmark.name,
        latitude: bookmark.center.latitude,
        longitude: bookmark.center.longitude,
        zoom: bookmark.zoom,
        bearing: bookmark.bearing,
        pitch: bookmark.pitch
    }, null, 2);
}

/**
 * Parse a bookmark from a copied string.
 * @param str - JSON string representation
 * @returns Parsed bookmark data or null if invalid
 */
export function parseBookmarkFromCopy(str: string): Partial<MapBookmark> | null {
    try {
        const data = JSON.parse(str);
        if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
            return {
                name: data.name,
                center: {
                    latitude: data.latitude,
                    longitude: data.longitude
                },
                zoom: data.zoom ?? 10,
                bearing: data.bearing ?? 0,
                pitch: data.pitch ?? 0
            };
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Format a bookmark's description with coordinate and view state.
 * @param bookmark - The bookmark to format
 * @returns Formatted description string
 */
export function formatBookmarkDescriptionFromBookmark(bookmark: MapBookmark): string {
    return formatBookmarkDescription(
        {
            latitude: bookmark.center.latitude,
            longitude: bookmark.center.longitude
        },
        {
            zoom: bookmark.zoom,
            bearing: bookmark.bearing,
            pitch: bookmark.pitch
        }
    );
}