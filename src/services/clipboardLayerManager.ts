import * as vscode from 'vscode';

import { OverlayLayer } from '../layers/layerTypes';
import { Coordinate, calculateBoundingBoxFromGeoJson } from './coordinateParser';
import { parseGeoText } from './geoTextParser';
import { ClipboardWatcher } from './clipboardWatcher';
import { logInfo, logError } from './logger';

type Thenable<T> = { then: <R>(f: (v: T) => R, g?: (e: unknown) => R) => unknown };

/**
 * The id of the clipboard overlay layer
 */
export const CLIPBOARD_LAYER_ID = 'clipboard';

/**
 * Dependencies the manager needs to update the layer tree and the map views.
 * Injectable so unit tests can supply stubs.
 */
export interface ClipboardLayerManagerDeps {
    getClipboardLayer: () => OverlayLayer | undefined;
    updateClipboardLayer: (geojson: object | null) => Promise<void>;
    fitBoundsOnly: (bbox: { southwest: Coordinate; northeast: Coordinate }) => void;
    setContextKey: (key: string, value: boolean) => Thenable<void> | void;
    createWatcher: () => ClipboardWatcher;
    readInitialClipboard: () => Promise<string>;
}

function defaultDeps(deps: Partial<ClipboardLayerManagerDeps>): ClipboardLayerManagerDeps {
    return {
        getClipboardLayer: deps.getClipboardLayer ?? (() => undefined),
        updateClipboardLayer: deps.updateClipboardLayer ?? (async () => {}),
        fitBoundsOnly: deps.fitBoundsOnly ?? (() => {}),
        setContextKey: deps.setContextKey ?? (async () => {}),
        createWatcher: deps.createWatcher ?? (() => new ClipboardWatcher()),
        readInitialClipboard: deps.readInitialClipboard
            ?? (async () => Promise.resolve(vscode.env.clipboard.readText()))
    };
}

/**
 * Keeps the "Clipboard" overlay layer in sync with clipboard contents.
 *
 * While the layer is hidden, the clipboard is neither read nor parsed: no
 * polling work and no coordinate parsing happens. When the layer becomes
 * visible, the watcher starts and the current clipboard is parsed immediately
 * so the layer shows the freshest content.
 */
export class ClipboardLayerManager {
    private readonly deps: ClipboardLayerManagerDeps;
    private watcher?: ClipboardWatcher;
    private lastProcessedText: string | null = null;
    private started = false;

    constructor(deps: Partial<ClipboardLayerManagerDeps>) {
        this.deps = defaultDeps(deps);
    }

    /**
     * Processes a clipboard text: if it contains coordinates, the clipboard
     * layer's GeoJSON is updated and the map fits to the point. Non-coordinate
     * text is ignored (the layer keeps its previous content only if the text
     * was never parseable; newly empty/unparseable clipboard clears nothing
     * that was parsed from a previous clipboard).
     */
    async processClipboardText(text: string): Promise<boolean> {
        const layer = this.deps.getClipboardLayer();
        if (!layer || !layer.visible) {
            return false;
        }

        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (!trimmed) {
            return false;
        }

        let parsed;
        try {
            parsed = parseGeoText(trimmed);
        } catch {
            // Text looked like WKT but could not be parsed; treat as
            // non-coordinate clipboard content.
            return false;
        }
        if (!parsed) {
            return false;
        }

        this.lastProcessedText = text;
        await this.deps.updateClipboardLayer(parsed.geojson);

        const bbox = calculateBoundingBoxFromGeoJson(parsed.geojson);
        if (bbox) {
            this.deps.fitBoundsOnly(bbox);
        }
        logInfo('Clipboard contains coordinates and was applied to the map');
        return true;
    }

    /**
     * Starts the clipboard watcher if the layer is visible. Called when the
     * layer is toggled on or the extension initializes.
     */
    start(): void {
        const layer = this.deps.getClipboardLayer();
        if (!layer || !layer.visible) {
            return;
        }

        if (this.started) {
            return;
        }
        this.started = true;

        this.watcher = this.deps.createWatcher();
        this.watcher.onDidChangeText((text) => {
            this.processClipboardText(text).catch((error) => {
                logError(`Failed to process clipboard: ${error instanceof Error ? error.message : String(error)}`);
            });
        });
        this.watcher.start();
        void this.deps.setContextKey('maplibreViewer.clipboardWatching', true);

        // Parse the current clipboard right away so a freshly enabled layer
        // reflects what is already on the clipboard.
        void Promise.resolve(this.deps.readInitialClipboard()).then((text) => {
            return this.processClipboardText(text);
        }).catch(() => {
            // Initial read failing is non-fatal; the watcher polls anyway.
        });
    }

    /**
     * Stops the clipboard watcher. Called when the layer is hidden.
     */
    stop(): void {
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = undefined;
        }
        this.started = false;
        this.lastProcessedText = null;
        void this.deps.setContextKey('maplibreViewer.clipboardWatching', false);
    }

    /**
     * Reacts to layer visibility changes: starts watching when the layer
     * becomes visible and stops when hidden.
     */
    syncWithLayerState(): void {
        const layer = this.deps.getClipboardLayer();
        if (layer?.visible) {
            this.start();
        } else {
            this.stop();
        }
    }

    dispose(): void {
        this.stop();
    }
}