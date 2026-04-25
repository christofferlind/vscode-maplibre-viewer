/**
 * Command registration module for extension commands
 */
import * as vscode from 'vscode';
import { ProviderManager } from './map/providerManager';
import { LANGUAGE_OPTIONS } from './services/languageOptions';
import { updateCoordinateSelectionState, toggleCoordinateSelectionState } from './extensionUtils';
import { addCoordinatePattern, clearCustomPatterns } from './services/coordinateParser';
import { getConfig } from './services/configService';

/**
 * Loads custom coordinate patterns from VS Code settings
 */
export function loadCustomCoordinatePatterns(): void {
    // Clear any existing custom patterns
    clearCustomPatterns();
    
    // Get custom patterns from configuration using configService
    const patterns = getConfig().get<Array<{name: string; pattern: string; flags?: string}>>('coordinatePatterns');
    
    if (!patterns || patterns.length === 0) {
        return;
    }
    
    // Add each custom pattern
    for (const patternConfig of patterns) {
        try {
            const flags = patternConfig.flags || 'g';
            const regex = new RegExp(patternConfig.pattern, flags);
            addCoordinatePattern(regex);
            console.log(`Loaded custom coordinate pattern: ${patternConfig.name}`);
        } catch (error) {
            console.error(`Failed to load custom coordinate pattern "${patternConfig.name}": ${error}`);
            vscode.window.showWarningMessage(
                `Invalid coordinate pattern "${patternConfig.name}": ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

/**
 * Registers language change commands
 */
export function registerLanguageCommands(context: vscode.ExtensionContext, providerManager: ProviderManager): void {
    // Register specific language commands
    const languageCommands: [string, string][] = [
        ['vscodeMaplibreViewer.setLanguageNative', 'native'],
        ['vscodeMaplibreViewer.setLanguageEnglish', 'en'],
        ['vscodeMaplibreViewer.setLanguageGerman', 'de']
    ];

    languageCommands.forEach(([commandId, languageCode]) => {
        context.subscriptions.push(
            vscode.commands.registerCommand(commandId, () => {
                providerManager.setMapLanguage(languageCode);
            })
        );
    });

    // Register generic language selection command
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.setLanguage', async () => {
            const selected = await vscode.window.showQuickPick(LANGUAGE_OPTIONS, {
                placeHolder: 'Select a language for map labels',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                providerManager.setMapLanguage(selected.languageCode);
            }
        })
    );
}

/**
 * Registers coordinate selection commands
 */
export function registerCoordinateSelectionCommands(context: vscode.ExtensionContext): void {
    // Register toggle coordinate selection command
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.toggleCoordinateSelection', async () => {
            await toggleCoordinateSelectionState(context);
        })
    );

    // Register enable coordinate selection command (for toolbar icon when disabled)
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.enableCoordinateSelection', async () => {
            await updateCoordinateSelectionState(context, true);
        })
    );

    // Register disable coordinate selection command (for toolbar icon when enabled)
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodeMaplibreViewer.disableCoordinateSelection', async () => {
            await updateCoordinateSelectionState(context, false);
        })
    );
}