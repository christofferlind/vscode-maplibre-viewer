import * as vscode from 'vscode';
import { logError, logLine, showErrorLog } from '../services/logger';

/**
 * Formats a mapError webview message into its log lines.
 * @param message The raw webview message payload
 * @returns Array of log lines describing the error
 */
export function mapErrorLogLines(message: Record<string, unknown>): string[] {
    const errorMessage = typeof message.message === 'string' ? message.message : String(message.message);
    const details = message.details as string | undefined;
    const stack = message.stack as string | undefined;
    const source = message.source as string | undefined;

    const lines: string[] = [];
    lines.push(errorMessage);
    if (source) {
        lines.push(`Source: ${source}`);
    }
    if (details) {
        lines.push(`Details: ${details}`);
    }
    if (stack) {
        lines.push(`Stack: ${stack}`);
    }
    lines.push('---');
    return lines;
}

/**
 * Logs a mapError webview message to the error log.
 * @param message The raw webview message payload
 */
export function logMapError(message: Record<string, unknown>): void {
    const [errorMessage, ...rest] = mapErrorLogLines(message);
    logError(errorMessage);
    for (const line of rest) {
        logLine('[INFO]', line);
    }
}

/**
 * Webview errors can fire rapidly (e.g. one failed tile request per tile
 * while panning a raster basemap offline). Only surface the first error in
 * a 10 second window as a notification; everything is still logged.
 */
export class MapErrorNotifier {
    private _lastNotificationTime = 0;

    showThrottled(errorMessage: string): void {
        const now = Date.now();
        if (now - this._lastNotificationTime < 10000) {
            return;
        }
        this._lastNotificationTime = now;

        const showLog = 'Show Error Log';
        void vscode.window.showErrorMessage(errorMessage, showLog).then((selection) => {
            if (selection === showLog) {
                showErrorLog();
            }
        });
    }
}