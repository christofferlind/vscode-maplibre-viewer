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
	if (isSearching) return;
	
	query = query.trim();
	
	if (query.length < 2) {
		hideSearchResults();
		return;
	}

	isSearching = true;
	showSearchLoading();

	// Get configuration
	var geocodingApiKey = window.MapConfig ? window.MapConfig.geocodingApiKey : '';
	var photonSearchUrl = window.MapConfig ? window.MapConfig.photonSearchUrl : 'https://photon.komoot.io/api';

	// Use MapTiler Geocoding API if API key is configured, otherwise use Photon
	var apiUrl;
	if (geocodingApiKey && geocodingApiKey.length > 0) {
		apiUrl = 'https://api.maptiler.com/geocoding/search.json?query=' + encodeURIComponent(query) + '&key=' + geocodingApiKey;
	} else {
		apiUrl = photonSearchUrl + '?q=' + encodeURIComponent(query);
	}

	fetch(apiUrl)
		.then(function(response) {
			if (!response.ok) {
				throw new Error('Geocoding API error: ' + response.status);
			}
			return response.json();
		})
		.then(function(data) {
			isSearching = false;
			
			// Parse results based on API type
			var results = [];
			if (geocodingApiKey && geocodingApiKey.length > 0) {
				// MapTiler format
				if (data.features && data.features.length > 0) {
					results = data.features.slice(0, 10).map(function(feature) {
						return {
							name: feature.text || feature.place_name,
							type: feature.place_type ? feature.place_type[0] : 'place',
							lng: feature.center[0],
							lat: feature.center[1]
						};
					});
				}
			} else {
				// Photon format
				if (data.features && data.features.length > 0) {
					results = data.features.slice(0, 10).map(function(feature) {
						var name = feature.properties.name || feature.properties.city || feature.properties.state || 'Unknown';
						var type = feature.properties.osm_value || feature.properties.osm_key || 'place';
						return {
							name: name,
							type: type,
							lng: feature.geometry.coordinates[0],
							lat: feature.geometry.coordinates[1]
						};
					});
				}
			}

			searchResults = results;
			selectedResultIndex = -1;
			renderSearchResults();
		})
		.catch(function(error) {
			isSearching = false;
			console.error('Search error:', error);
			showSearchError('Search failed. Please try again.');
		});
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
 * @param {Object} result - Result object with lng, lat
 */
function flyToResult(result) {
	var map = window.MapCore.getMap();
	if (!map) return;

	var flyToDuration = window.MapConfig ? window.MapConfig.flyToDuration : 1500;

	map.flyTo({
		center: [result.lng, result.lat],
		zoom: 14,
		duration: flyToDuration
	});
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
	clearResults: hideSearchResults
};