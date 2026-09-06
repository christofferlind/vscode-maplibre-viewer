// src/services/configService.ts
import * as vscode from 'vscode';

const CONFIG_SECTION = 'vscodeMaplibreViewer';

export interface MapLibreViewerConfig {
    basemapStyle: string;
    basemapApiKey: string;
    geocodingApiKey: string;
    geocodingProvider: string;
    language: string;
}

export function getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

export function getBasemapStyle(): string {
    return getConfig().get<string>('basemapStyle') || 'osm';
}

export function getBasemapApiKey(): string {
    return getConfig().get<string>('basemapApiKey') || '';
}

export function getGeocodingApiKey(): string {
    return getConfig().get<string>('geocodingApiKey') || '';
}

export function getGeocodingProvider(): string {
    return getConfig().get<string>('geocodingProvider') || 'photon';
}

export function getLanguage(): string {
    return getConfig().get<string>('language') || 'en';
}

export function onConfigurationChanged(
    callback: (event: vscode.ConfigurationChangeEvent) => void
): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(CONFIG_SECTION)) {
            callback(e);
        }
    });
}

/**
 * Registers a hook that fires whenever a view state write to settings begins,
 * so callers can suppress redundant config-change broadcasts.
 */
let viewStateWriteGuard: (() => void) | undefined;

export function setViewStateWriteGuard(guard: () => void): void {
    viewStateWriteGuard = guard;
}

export function notifyViewStateWriteStarted(): void {
    viewStateWriteGuard?.();
}