import * as vscode from 'vscode';
import { LayerStyle, OverlayLayer } from './layerTypes';

const PRESET_COLORS: Array<{ label: string; value: string }> = [
    { label: 'Red', value: '#FF0000' },
    { label: 'Blue', value: '#0000FF' },
    { label: 'Green', value: '#00FF00' },
    { label: 'Yellow', value: '#FFFF00' },
    { label: 'Orange', value: '#FFA500' },
    { label: 'Purple', value: '#800080' },
    { label: 'Cyan', value: '#00FFFF' },
    { label: 'Magenta', value: '#FF00FF' },
    { label: 'Black', value: '#000000' },
    { label: 'White', value: '#FFFFFF' }
];

const DEFAULT_CIRCLE_RADIUS = 6;
const DEFAULT_LINE_WIDTH = 2;

/**
 * Parses an opacity percentage string ("0"-"100") into an opacity in the
 * range 0-1. Returns undefined for invalid input or out-of-range values.
 */
export function parseOpacityPercent(input: string): number | undefined {
    const trimmed = input.trim();
    if (trimmed === '') {
        return undefined;
    }
    const percent = Number(trimmed);
    if (Number.isNaN(percent) || percent < 0 || percent > 100) {
        return undefined;
    }
    return percent / 100;
}

/**
 * Parses a pixel-dimension string (circle radius or line width) within the
 * given inclusive bounds. Returns undefined for invalid input.
 */
export function parsePixelValue(input: string, min: number, max: number): number | undefined {
    const value = Number(input.trim());
    if (Number.isNaN(value) || value < min || value > max) {
        return undefined;
    }
    return value;
}

/**
 * Opens a color picker (ten presets plus a custom value entry) and returns
 * the chosen color, or undefined when the picker was dismissed.
 */
export async function promptLayerColor(current: string | undefined): Promise<string | undefined> {
    const items: vscode.QuickPickItem[] = PRESET_COLORS.map(color => ({
        label: `$(circle-filled) ${color.label}`,
        detail: color.value
    }));
    items.push({ label: '$(color-mode) Custom...', detail: 'custom' });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select color',
        title: 'Layer Color'
    });
    if (!selected) {
        return undefined;
    }
    if (selected.detail !== 'custom') {
        return selected.detail;
    }
    return vscode.window.showInputBox({
        prompt: 'Enter color value (hex, rgb, or color name)',
        placeHolder: '#FF0000',
        value: current || '#FF0000'
    });
}

async function promptForOpacity(current: number | undefined): Promise<number | undefined> {
    const input = await vscode.window.showInputBox({
        prompt: 'Enter opacity percentage (0-100)',
        placeHolder: '100',
        value: current !== undefined ? `${Math.round(current * 100)}` : '100'
    });
    if (input === undefined) {
        return undefined;
    }
    return parseOpacityPercent(input);
}

async function promptForPixelValue(
    propertyName: string,
    current: number | undefined,
    fallback: number,
    min: number,
    max: number
): Promise<number | undefined> {
    const input = await vscode.window.showInputBox({
        prompt: `Enter ${propertyName} in pixels (${min}-${max})`,
        placeHolder: `${fallback}`,
        value: current !== undefined ? `${current}` : `${fallback}`
    });
    if (input === undefined) {
        return undefined;
    }
    return parsePixelValue(input, min, max);
}

function formatPercent(value: number | undefined): string {
    return value !== undefined ? `${Math.round(value * 100)}%` : 'default (100%)';
}

/**
 * Opens an interactive multi-step picker that lets the user configure the
 * style of an overlay layer (color, opacity, circle radius, line width).
 * Each confirmed property is applied immediately through the `apply`
 * callback; the picker stays open until the user dismisses it.
 */
export async function configureLayerStyle(
    layer: OverlayLayer,
    apply: (style: LayerStyle) => Promise<void>
): Promise<void> {
    const styleItems: vscode.QuickPickItem[] = [
        {
            label: '$(color-mode) Color...',
            detail: layer.color || 'default (#FF0000)'
        },
        {
            label: '$(eye) Opacity...',
            detail: formatPercent(layer.opacity)
        },
        {
            label: '$(symbol-ruler) Circle Radius...',
            detail: layer.circleRadius !== undefined ? `${layer.circleRadius} px` : `default (${DEFAULT_CIRCLE_RADIUS} px)`
        },
        {
            label: '$(spline-area) Line Width...',
            detail: layer.lineWidth !== undefined ? `${layer.lineWidth} px` : `default (${DEFAULT_LINE_WIDTH} px)`
        },
        {
            label: '$(clear-all) Reset to Defaults',
            detail: 'Restore default color and style'
        }
    ];

    const selected = await vscode.window.showQuickPick(styleItems, {
        placeHolder: `Configure style for "${layer.name}"`,
        title: 'Layer Style'
    });

    if (!selected) {
        return;
    }

    let style: LayerStyle | undefined;
    if (selected.label.indexOf('Color') !== -1) {
            const color = await promptLayerColor(layer.color);
        style = color ? { color } : undefined;
    } else if (selected.label.indexOf('Opacity') !== -1) {
        const opacity = await promptForOpacity(layer.opacity);
        style = opacity !== undefined ? { opacity } : undefined;
    } else if (selected.label.indexOf('Circle Radius') !== -1) {
        const radius = await promptForPixelValue('circle radius', layer.circleRadius, DEFAULT_CIRCLE_RADIUS, 1, 50);
        style = radius !== undefined ? { circleRadius: radius } : undefined;
    } else if (selected.label.indexOf('Line Width') !== -1) {
        const width = await promptForPixelValue('line width', layer.lineWidth, DEFAULT_LINE_WIDTH, 1, 30);
        style = width !== undefined ? { lineWidth: width } : undefined;
    } else {
        style = {
            color: undefined,
            opacity: undefined,
            circleRadius: undefined,
            lineWidth: undefined
        };
    }

    if (style) {
        await apply(style);
    }
}