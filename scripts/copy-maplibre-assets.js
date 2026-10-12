/**
 * Build script to copy MapLibre GL JS assets to the resources folder
 * for offline bundling in the VS Code extension.
 */

const fs = require('fs');
const path = require('path');

// Paths
const nodeModulesPath = path.join(__dirname, '..', 'node_modules', 'maplibre-gl');
const resourcesPath = path.join(__dirname, '..', 'resources');
const maplibreDestPath = path.join(resourcesPath, 'maplibre-gl');

// MapLibre GL JS v6 ships only ES module bundles (maplibre-gl.mjs). The webview
// loads the library as a classic <script>, so the bundle is rewritten at copy
// time: the trailing `export { X as Y, ... }` statement becomes
// `window.maplibregl = { X: Y, ... }` and `import.meta.url` (a syntax error in
// classic scripts) is replaced with a host-provided global fallback.
// MapLibre GL JS v6 ships the worker as an ES module with a trailing
// `export { Rs as default }` statement. Blob module workers do not load in VS
// Code webviews, and the classic-worker fallback rejects ESM syntax, so the
// copied worker is made classic-compatible: the self-contained top-level code
// (`self.worker = new RS(self)`) stays, the export statement is removed and
// `import.meta.url` references become a host-provided global fallback.
function classicizeWorker(source) {
    return source
        .replace(/export\{[^}]*\};?/g, '')
        .replace(/import\.meta\.url/g, `(self.__maplibreImportUrl||'')`);
}

function classicizeBundle(source) {
    const exportMatch = source.match(/export\{[^}]*\};?/);
    if (!exportMatch) {
        throw new Error('No export statement found in maplibre-gl bundle');
    }
    const exportList = exportMatch[0].slice('export{'.length, -1).replace(/};?$/, '');
    // `X as Y` exports local binding X as public key Y, so the object literal
    // must be `Y : X` (the local binding is what actually exists at runtime).
    const globals = exportList.split(',').map((entry) => {
        const parts = entry.split(' as ');
        return parts.length === 2 ?
            `${parts[1].trim()} : ${parts[0].trim()}` :
            entry.trim();
    }).join(', ');
    // Blob module workers fail to load in VS Code webviews while classic
    // workers work (this is what v4 used). Force the classic worker path in
    // the only `new Worker` call site of the bundle.
    return source
        .replace(exportMatch[0], `window.maplibregl={${globals}};`)
        .replace(/try\{return new Worker\(e,\{type:`module`\}\)\}catch\(e\)\{console\.warn\(`Module worker not supported, falling back to classic worker`,e\)\}return new Worker\(e\)/, 'return new Worker(e)')
        .replace(/import\.meta\.url/g, `(window.__maplibreImportUrl||'')`);
}

// Files to copy from maplibre-gl
// Using CSP-compliant versions for VS Code webview compatibility
const filesToCopy = [
    { src: 'dist/maplibre-gl.mjs', dest: 'maplibre-gl.js', transform: classicizeBundle },
    { src: 'dist/maplibre-gl.css', dest: 'maplibre-gl.css' },
    { src: 'dist/maplibre-gl-worker.mjs', dest: 'maplibre-gl-worker.js', transform: classicizeWorker },
    { src: 'LICENSE.txt', dest: 'LICENSE.txt' }
];

// Ensure the destination directory exists
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
    }
}

// Copy a single file
function copyFile(srcPath, destPath, transform) {
    try {
        if (transform) {
            const content = fs.readFileSync(srcPath, 'utf8');
            fs.writeFileSync(destPath, transform(content));
            console.log(`Copied (transformed): ${path.basename(srcPath)} -> ${destPath}`);
        } else {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied: ${path.basename(srcPath)} -> ${destPath}`);
        }
    } catch (error) {
        console.error(`Error copying ${srcPath}:`, error.message);
        process.exit(1);
    }
}

// Main function
function main() {
    console.log('Copying MapLibre GL JS assets...\n');

    // Create destination directory
    ensureDirectoryExists(maplibreDestPath);

    // Copy each file
    filesToCopy.forEach(({ src, dest, transform }) => {
        const srcPath = path.join(nodeModulesPath, src);
        const destFilePath = path.join(maplibreDestPath, dest);

        if (!fs.existsSync(srcPath)) {
            console.error(`Source file not found: ${srcPath}`);
            console.error('Make sure to run "npm install" first.');
            process.exit(1);
        }

        copyFile(srcPath, destFilePath, transform);
    });

    // Copy sprites directory if it exists
    const spritesSrcPath = path.join(nodeModulesPath, 'dist', 'sprites');
    if (fs.existsSync(spritesSrcPath)) {
        const spritesDestPath = path.join(maplibreDestPath, 'sprites');
        ensureDirectoryExists(spritesDestPath);
        
        // Copy all files in sprites directory
        const spriteFiles = fs.readdirSync(spritesSrcPath);
        spriteFiles.forEach(file => {
            const srcPath = path.join(spritesSrcPath, file);
            const destPath = path.join(spritesDestPath, file);
            copyFile(srcPath, destPath);
        });
    }

    console.log('\nMapLibre GL JS assets copied successfully!');
}

main();