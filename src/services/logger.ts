import * as vscode from 'vscode';

const OUTPUT_CHANNEL_NAME = 'MapLibre Viewer';

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel | undefined {
    if (!outputChannel) {
        const win = (vscode as { window?: { createOutputChannel?: (name: string) => vscode.OutputChannel } }).window;
        if (!win || typeof win.createOutputChannel !== 'function') {
            return undefined;
        }
        outputChannel = win.createOutputChannel(OUTPUT_CHANNEL_NAME);
    }
    return outputChannel;
}

function write(prefix: string, message: string): void {
    const channel = getOutputChannel();
    const line = `[${new Date().toISOString()}] ${prefix} ${message}`;
    if (channel) {
        channel.appendLine(line);
    } else {
        console.log(line);
    }
}

export function logInfo(message: string): void {
    write('[INFO]', message);
}

export function logError(message: string): void {
    write('[ERROR]', message);
}

export function logWarn(message: string): void {
    write('[WARN]', message);
}

export function logLine(prefix: string, message: string): void {
    write(prefix, message);
}

export function showErrorLog(): void {
    const channel = getOutputChannel();
    if (channel) {
        channel.show(true);
    }
}
