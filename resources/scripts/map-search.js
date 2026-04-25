/**
 * Map Search Module
 * Handles geocoding search functionality
 */

// Search state
var searchResults = [];
var selectedResultIndex = -1;
var searchDebounceTimer = null;
var isSearching = false;

// DOM elements (initialized in initializeSearch)
var searchContainer = null;
var searchInput = null;
var searchResultsEl = null;
var clearBtn = null;

/**
 * Apply transparency to search results popup
 * @param {number} transparencyPercent - Transparency percentage (0-100)
 */
function applySearchResultsTransparency(transparencyPercent) {
	if (!searchResultsEl) return;
	
	// Clamp transparency to valid range
	var clampedTransparency = Math.max(0, Math.min(100, transparencyPercent));
	
	// Convert percentage to opacity (0% transparency = 1 opacity, 100% transparency = 0 opacity)
	var opacity = 1 - (clampedTransparency / 100);
	
	// Get the background color from VS Code CSS variable or use fallback
	var computedStyle = getComputedStyle(document.documentElement);
	var bgColor = computedStyle.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
	
	// Parse the color and apply alpha
	var rgbaColor = parseColorToRgba(bgColor, opacity);
	
	searchResultsEl.style.background = rgbaColor;
}

/**
 * Parse a CSS color to RGBA format with specified opacity
 * @param {string} color - CSS color value
 * @param {number} opacity - Opacity value (0-1)
 * @returns {string} RGBA color string
 */
function parseColorToRgba(color, opacity) {
	// Handle hex colors
	if (color.startsWith('#')) {
		var hex = color.slice(1);
		var r, g, b;
		if (hex.length === 3) {
			r = parseInt(hex[0] + hex[0], 16);
			g = parseInt(hex[1] + hex[1], 16);
			b = parseInt(hex[2] + hex[2], 16);
		} else if (hex.length === 6) {
			r = parseInt(hex.slice(0, 2), 16);
			g = parseInt(hex.slice(2, 4), 16);
			b = parseInt(hex.slice(4, 6), 16);
		} else {
			return 'rgba(30, 30, 30, ' + opacity + ')';
		}
		return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + opacity + ')';
	}
	
	// Handle rgb/rgba colors
	if (color.startsWith('rgb')) {
		var match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (match) {
			return 'rgba(' + match[1] + ', ' + match[2] + ', ' + match[3] + ', ' + opacity + ')';
		}
	}
	
	// Fallback for unknown formats
	return 'rgba(30, 30, 30, ' + opacity + ')';
}

/**
 * Initialize search functionality
 */
function initializeSearch() {
	searchContainer = document.getElementById('search-container');
	searchInput = document.getElementById('search-input');
	searchResultsEl = document.getElementById('search-results');
	clearBtn = document.getElementById('search-clear-btn');

	if (!searchContainer || !searchInput || !searchResultsEl) {
		console.warn('Search elements not found');
		return;
	}

	// Check if search is enabled
	var enableSearch = window.MapConfig ? window.MapConfig.enableSearch : false;
	if (enableSearch) {
		searchContainer.style.display = 'block';
	}
	
	// Apply transparency setting
	var transparency = window.MapConfig ? window.MapConfig.searchResultsTransparency : 20;
	applySearchResultsTransparency(transparency);

	// Input event handler with debounce
	searchInput.addEventListener('input', function() {
		updateClearButton();
		
		// Clear previous timer
		if (searchDebounceTimer) {
			clearTimeout(searchDebounceTimer);
		}

		var query = searchInput.value;
		
		if (query.length < 2) {
			hideSearchResults();
			return;
		}

		// Debounce search
		searchDebounceTimer = setTimeout(function() {
			performSearch(query);
		}, 300);
	});

	// Keyboard navigation
	searchInput.addEventListener('keydown', function(e) {
		if (!searchResultsEl.classList.contains('visible') || searchResults.length === 0) {
			return;
		}

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				selectedResultIndex = Math.min(selectedResultIndex + 1, searchResults.length - 1);
				renderSearchResults();
				navigateToResult(selectedResultIndex);
				break;
			case 'ArrowUp':
				e.preventDefault();
				selectedResultIndex = Math.max(selectedResultIndex - 1, 0);
				renderSearchResults();
				navigateToResult(selectedResultIndex);
				break;
			case 'Enter':
				e.preventDefault();
				if (selectedResultIndex >= 0 && selectedResultIndex < searchResults.length) {
					selectSearchResult(selectedResultIndex);
				}
				break;
			case 'Escape':
				e.preventDefault();
				hideSearchResults();
				break;
		}
	});

	// Clear button handler
	clearBtn.addEventListener('click', function() {
		searchInput.value = '';
		updateClearButton();
		hideSearchResults();
		searchInput.focus();
	});

	// Hide results when clicking outside
	document.addEventListener('click', function(e) {
		if (!searchContainer.contains(e.target)) {
			hideSearchResults();
		}
	});

	// Focus input when pressing '/' key
	document.addEventListener('keydown', function(e) {
		if (e.key === '/' && document.activeElement !== searchInput) {
			e.preventDefault();
			searchInput.focus();
		}
	});
}

/**
 * Perform geocoding search
 * @param {string} query - Search query
 */
function performSearch(query) {
	query = query.trim();
	
	if (query.length < 2) {
		searchResults = [];
		renderSearchResults();
		return;
	}

	isSearching = true;
	showSearchLoading();

	// Send message to extension to perform the search
	sendMessage('geocodingSearch', { query: query });
}

/**
 * Handle geocoding search results from the extension
 * @param {Array} results - Array of geocoding results
 */
function handleGeocodingSearchResults(results) {
	isSearching = false;
	
	if (!results || results.length === 0) {
		searchResults = [];
		selectedResultIndex = -1;
		renderSearchResults();
		return;
	}

	// Results are already in the correct format from the extension
	searchResults = results;
	selectedResultIndex = -1;
	renderSearchResults();
}

/**
 * Handle geocoding search error
 * @param {string} message - Error message
 */
function handleGeocodingSearchError(message) {
	isSearching = false;
	console.error('Search error:', message);
	showSearchError(message || 'Search failed. Please try again.');
}

/**
 * Render search results
 */
function renderSearchResults() {
	if (searchResults.length === 0) {
		showSearchNoResults();
		return;
	}

	var html = '';
	searchResults.forEach(function(result, index) {
		var selectedClass = index === selectedResultIndex ? ' selected' : '';
		html += '<div class="search-result-item' + selectedClass + '" data-index="' + index + '">';
		html += '<div class="search-result-name">' + escapeHtml(result.name) + '</div>';
		html += '<div class="search-result-type">' + escapeHtml(result.type) + '</div>';
		html += '</div>';
	});

	searchResultsEl.innerHTML = html;
	searchResultsEl.classList.add('visible');

	// Add click handlers to results
	var items = searchResultsEl.querySelectorAll('.search-result-item');
	items.forEach(function(item) {
		item.addEventListener('click', function() {
			var index = parseInt(this.getAttribute('data-index'), 10);
			selectSearchResult(index);
		});
		
		// Add hover handler to preview result on map
		item.addEventListener('mouseenter', function() {
			var index = parseInt(this.getAttribute('data-index'), 10);
			previewResultOnHover(index);
		});
	});
}

/**
 * Select a search result and fly to it
 * @param {number} index - Result index
 */
function selectSearchResult(index) {
	if (index < 0 || index >= searchResults.length) return;

	var result = searchResults[index];
	flyToResult(result);
	hideSearchResults();
	searchInput.value = result.name;
	updateClearButton();
}

/**
 * Fly to a result location
 * @param {Object} result - Result object with lng, lat, and optional bbox
 */
function flyToResult(result) {
	var map = window.MapCore.getMap();
	if (!map) return;

	var flyToDuration = window.MapUtils.getConfig('flyToDuration', 1500);

	// If bounding box is available, fit the map to it
	if (result.bbox) {
		window.MapUtils.fitBoundsWithDefaults(
			map,
			[
				[result.bbox.west, result.bbox.south],
				[result.bbox.east, result.bbox.north]
			]
		);
	} else {
		// Fallback to flying to center point with fixed zoom
		map.flyTo({
			center: [result.lng, result.lat],
			zoom: 14,
			duration: flyToDuration
		});
	}
}

/**
 * Preview result on hover - smoothly move to the location
 * @param {number} index - Result index
 */
function previewResultOnHover(index) {
	if (index < 0 || index >= searchResults.length) return;
	
	var result = searchResults[index];
	var map = window.MapCore.getMap();
	if (!map) return;

	// If bounding box is available, fit the map to it for preview
	if (result.bbox) {
		window.MapUtils.fitBoundsWithDefaults(
			map,
			[
				[result.bbox.west, result.bbox.south],
				[result.bbox.east, result.bbox.north]
			],
			{
				duration: 500
			}
		);
	} else {
		// Fallback to panning to center point
		map.panTo([result.lng, result.lat], {
			duration: 500
		});
	}
}

/**
 * Navigate to result by index (for keyboard navigation)
 * @param {number} index - Result index
 */
function navigateToResult(index) {
	if (index < 0 || index >= searchResults.length) return;
	
	var result = searchResults[index];
	flyToResult(result);
}

/**
 * Show loading state
 */
function showSearchLoading() {
	searchResultsEl.innerHTML = '<div class="search-loading">Searching...</div>';
	searchResultsEl.classList.add('visible');
}

/**
 * Show error state
 * @param {string} message - Error message
 */
function showSearchError(message) {
	searchResultsEl.innerHTML = '<div class="search-error">' + escapeHtml(message) + '</div>';
	searchResultsEl.classList.add('visible');
}

/**
 * Show no results state
 */
function showSearchNoResults() {
	searchResultsEl.innerHTML = '<div class="search-no-results">No results found</div>';
	searchResultsEl.classList.add('visible');
}

/**
 * Hide search results
 */
function hideSearchResults() {
	searchResultsEl.classList.remove('visible');
	searchResultsEl.innerHTML = '';
}

/**
 * Update clear button visibility
 */
function updateClearButton() {
	if (searchInput.value.length > 0) {
		clearBtn.style.display = 'block';
	} else {
		clearBtn.style.display = 'none';
	}
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
	var div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

// Export functions for use in other modules
window.MapSearch = {
	initialize: initializeSearch,
	performSearch: performSearch,
	clearResults: hideSearchResults,
	applyTransparency: applySearchResultsTransparency,
	handleGeocodingSearchResults: handleGeocodingSearchResults,
	handleGeocodingSearchError: handleGeocodingSearchError
};