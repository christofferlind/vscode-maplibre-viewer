import * as vscode from 'vscode';

/**
 * Shows a confirmation dialog and returns true if confirmed
 * @param message The message to display
 * @param confirmLabel The label for the confirm button
 * @returns Promise resolving to true if confirmed, false otherwise
 */
export async function confirmAction(
	message: string,
	confirmLabel: string = 'Confirm'
): Promise<boolean> {
	const result = await vscode.window.showWarningMessage(
		message,
		confirmLabel,
		'Cancel'
	);
	return result === confirmLabel;
}

/**
 * Shows an error message with consistent formatting
 * @param operation The operation that failed
 * @param error The error that occurred
 */
export function showOperationError(operation: string, error: unknown): void {
	vscode.window.showErrorMessage(
		`Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`
	);
}

/**
 * Updates the coordinate selection state
 * @param context The extension context
 * @param enabled Whether coordinate selection should be enabled
 * @param showMessage Whether to show an information message
 */
export async function updateCoordinateSelectionState(
	context: vscode.ExtensionContext,
	enabled: boolean,
	showMessage: boolean = true
): Promise<void> {
	await context.globalState.update('coordinateSelectionEnabled', enabled);
	vscode.commands.executeCommand('setContext', 'maplibreView.coordinateSelectionEnabled', enabled);
	if (showMessage) {
		vscode.window.showInformationMessage(
			`Coordinate selection ${enabled ? 'enabled' : 'disabled'}`
		);
	}
}

/**
 * Gets the current coordinate selection state
 * @param context The extension context
 * @returns Whether coordinate selection is enabled
 */
export function getCoordinateSelectionState(context: vscode.ExtensionContext): boolean {
	return context.globalState.get<boolean>('coordinateSelectionEnabled', true);
}

/**
 * Toggles the coordinate selection state
 * @param context The extension context
 */
export async function toggleCoordinateSelectionState(context: vscode.ExtensionContext): Promise<void> {
	const currentState = getCoordinateSelectionState(context);
	await updateCoordinateSelectionState(context, !currentState);
}