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
	item.description = baseMap.description;
	item.tooltip = `${baseMap.name}\n${baseMap.styleUrl || baseMap.tileUrl}`;
	item.contextValue = isActive ? 'activeBaseMap' : 'baseMap';
	item.iconPath = isActive
		? new vscode.ThemeIcon('check')
		: new vscode.ThemeIcon('circle-outline');
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
	item.tooltip = `${layer.name}\nType: ${layer.type}\nVisible: ${layer.visible}`;

	if (layer.id === SELECTED_FILE_LAYER_ID) {
		item.contextValue = layer.visible ? 'visibleSelectedFileLayer' : 'selectedFileLayer';
	} else {
		item.contextValue = layer.visible ? 'visibleOverlayLayer' : 'overlayLayer';
	}

	item.iconPath = layer.visible
		? new vscode.ThemeIcon('eye')
		: new vscode.ThemeIcon('eye-closed');

	item.command = {
		command: 'vscodeMaplibreViewer.toggleLayer',
		title: 'Toggle Layer Visibility',
		arguments: [layer]
	};
	return item;
}
