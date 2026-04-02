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

// Files to copy from maplibre-gl
// Using CSP-compliant versions for VS Code webview compatibility
const filesToCopy = [
    { src: 'dist/maplibre-gl-csp.js', dest: 'maplibre-gl.js' },
    { src: 'dist/maplibre-gl.css', dest: 'maplibre-gl.css' },
    { src: 'dist/maplibre-gl-csp-worker.js', dest: 'maplibre-gl-worker.js' }
];

// Ensure the destination directory exists
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
    }
}

// Copy a single file
function copyFile(srcPath, destPath) {
    try {
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied: ${path.basename(srcPath)} -> ${destPath}`);
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
    filesToCopy.forEach(({ src, dest }) => {
        const srcPath = path.join(nodeModulesPath, src);
        const destFilePath = path.join(maplibreDestPath, dest);

        if (!fs.existsSync(srcPath)) {
            console.error(`Source file not found: ${srcPath}`);
            console.error('Make sure to run "npm install" first.');
            process.exit(1);
        }

        copyFile(srcPath, destFilePath);
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