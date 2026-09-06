import * as vscode from 'vscode';

/**
 * The contributed view container id (see `viewsContainers` in package.json).
 * The activity-bar view group can be focused via the built-in command
 * `workbench.view.extension.<container-id>`.
 */
const MAPS_VIEW_GROUP_COMMAND = 'workbench.view.extension.maps-container';

/**
 * Default settle delay after the view group is activated, giving the
 * sidebar webview time to initialize before tests interact with it.
 */
const DEFAULT_SETTLE_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Ensures the extension is activated and the contributed `maps-container`
 * view group is focused, so the sidebar `mapsView` webview is resolved by
 * `MapViewProvider.resolveWebviewView` before any tests execute.
 *
 * Tests that rely on the real sidebar provider being ready (or on the
 * extension host having activated the view) should call this from
 * `suiteSetup`. The built-in `workbench.view.extension.maps-container`
 * command is what actually causes VS Code to resolve the sidebar webview
 * view; activating the extension alone does not.
 *
 * @param settleDelayMs Optional override for the post-activation settle
 * delay. Defaults to {@link DEFAULT_SETTLE_DELAY_MS}. Pass `0` to skip.
 * @returns The activated extension.
 */
export async function activateViewGroup(settleDelayMs: number = DEFAULT_SETTLE_DELAY_MS): Promise<vscode.Extension<void>> {
    const extensionId = 'christofferlind.vscode-maplibre-viewer';
    const extension = vscode.extensions.getExtension(extensionId);
    if (!extension) {
        throw new Error(`Extension '${extensionId}' not found`);
    }
    if (!extension.isActive) {
        await extension.activate();
    }

    // Focus the contributed activity-bar view group so VS Code resolves the
    // sidebar webview view. Tolerate the command being absent on older hosts.
    try {
        await vscode.commands.executeCommand(MAPS_VIEW_GROUP_COMMAND);
    } catch (error) {
        // The built-in view-group command may not be present in every host
        // configuration; continue so the extension-activation guarantee
        // still holds.
        console.log('View group activation note:', error);
    }

    if (settleDelayMs > 0) {
        await sleep(settleDelayMs);
    }

    return extension;
}