import * as vscode from 'vscode';
import { BaseMapStyle, OverlayLayer, SELECTED_FILE_LAYER_ID } from './layerTypes';

/**
 * Creates a tree item for a root section (Base Maps or Overlay Layers).
 */
export function createRootTreeItem(
	label: string,
	icon: string,
	contextValue: string
): vscode.TreeItem {
	const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
	item.contextValue = contextValue;
	item.iconPath = new vscode.ThemeIcon(icon);
	return item;
}

/**
 * Creates a tree item for a base map style.
 */
export function createBaseMapTreeItem(
	baseMap: BaseMapStyle,
	isActive: boolean
): vscode.TreeItem {
	const item = new vscode.TreeItem(baseMap.name, vscode.TreeItemCollapsibleState.None);
	item.description = isActive
		? `${baseMap.description ? `${baseMap.description} ` : ''}✓`
		: baseMap.description;
	item.tooltip = `${baseMap.name}\n${baseMap.styleUrl || baseMap.tileUrl}`;
	item.contextValue = isActive ? 'activeBaseMap' : 'baseMap';
	const isRaster = baseMap.type === 'raster' || (!baseMap.type && !!baseMap.tileUrl);
	item.iconPath = new vscode.ThemeIcon(isRaster ? 'table' : 'map');
	item.command = {
		command: 'vscodeMaplibreViewer.setBaseMap',
		title: 'Set Active Base Map',
		arguments: [baseMap]
	};
	return item;
}

/**
 * Creates a tree item for an overlay layer.
 */
export function createOverlayTreeItem(layer: OverlayLayer): vscode.TreeItem {
	const item = new vscode.TreeItem(layer.name, vscode.TreeItemCollapsibleState.None);
	item.description = layer.description;
	item.tooltip = [
		layer.name,
		`Type: ${layer.type}`,
		`Visible: ${layer.visible}`,
		`Color: ${layer.color || 'default (#FF0000)'}`,
		`Opacity: ${layer.opacity !== undefined ? `${Math.round(layer.opacity * 100)}%` : 'default (100%)'}`,
		`Circle radius: ${layer.circleRadius !== undefined ? `${layer.circleRadius} px` : 'default (6 px)'}`,
		`Line width: ${layer.lineWidth !== undefined ? `${layer.lineWidth} px` : 'default (2 px)'}`
	].join('\n');

	if (layer.id === SELECTED_FILE_LAYER_ID) {
		item.contextValue = layer.visible ? 'visibleSelectedFileLayer' : 'selectedFileLayer';
	} else {
		item.contextValue = layer.visible ? 'visibleOverlayLayer' : 'overlayLayer';
	}

	item.checkboxState = layer.visible
		? vscode.TreeItemCheckboxState.Checked
		: vscode.TreeItemCheckboxState.Unchecked;

	item.command = {
		command: 'vscodeMaplibreViewer.layerItemActivated',
		title: 'Show Layer On Map',
		arguments: [layer]
	};
	return item;
}
