/**
 * Map Utilities Module
 * Handles loading and error overlays
 */

/**
 * Show loading overlay
 * @param {string} [message='Loading map...'] - Message to display
 */
function showLoadingOverlay(message) {
	var overlay = document.getElementById('loading-overlay');
	var span = overlay ? overlay.querySelector('span') : null;
	if (span) {
		span.textContent = message || 'Loading map...';
	}
	if (overlay) {
		overlay.classList.add('visible');
	}
}

/**
 * Hide loading overlay
 */
function hideLoadingOverlay() {
	var overlay = document.getElementById('loading-overlay');
	if (overlay) {
		overlay.classList.remove('visible');
	}
}

/**
 * Show error overlay
 * @param {string} message - Error message to display
 */
function showErrorOverlay(message) {
	var overlay = document.getElementById('error-overlay');
	var messageEl = document.getElementById('error-message');
	if (messageEl) {
		messageEl.textContent = message;
	}
	if (overlay) {
		overlay.classList.add('visible');
	}
	hideLoadingOverlay();
}

/**
 * Hide error overlay
 */
function hideErrorOverlay() {
	var overlay = document.getElementById('error-overlay');
	if (overlay) {
		overlay.classList.remove('visible');
	}
}

// Export functions for use in other modules
window.MapUtils = {
	showLoadingOverlay: showLoadingOverlay,
	hideLoadingOverlay: hideLoadingOverlay,
	showErrorOverlay: showErrorOverlay,
	hideErrorOverlay: hideErrorOverlay
};