/**
 * Main entry point for the Ethereum Consensus Spec Test Viewer
 */

import { initDarkMode } from './darkMode.js';
import { loadVersions, loadManifest, loadTestFiles, loadTestFilesProgressive } from './loader.js';
import { buildTree, filterTree } from './tree.js';
import { displayTest, displayWelcome, displayTestSkeleton, updateFileBox, enableDownloadTest } from './testViewer.js';
import { initResizable } from './resizable.js';

// Application state
const state = {
  versions: null,
  currentVersion: null,
  manifest: null,
  currentTest: null,
  loadedSuites: new Map(), // Cache for loaded test suites
  searchTerm: ''
};

const VERSION_KEY = 'eth-spec-tests-version';

/**
 * Initialize the application
 */
async function init() {
  // Initialize dark mode
  initDarkMode();

  // Initialize resizable sidebar
  initResizable();

  // Load versions
  try {
    state.versions = await loadVersions();
    setupVersionSelector();

    // Get saved or default version
    const savedVersion = localStorage.getItem(VERSION_KEY);
    const defaultVersion = state.versions.versions[0]; // Newest first
    state.currentVersion = savedVersion && state.versions.versions.includes(savedVersion)
      ? savedVersion
      : defaultVersion;

    // Set version selector
    document.getElementById('versionSelect').value = state.currentVersion;

    // Load manifest for selected version
    await loadVersionData(state.currentVersion);
  } catch (error) {
    showError('Failed to load versions: ' + error.message);
  }

  // Set up search
  setupSearch();
}

/**
 * Setup version selector
 */
function setupVersionSelector() {
  const versionSelect = document.getElementById('versionSelect');

  // Clear and populate options
  versionSelect.innerHTML = '';
  for (const version of state.versions.versions) {
    const option = document.createElement('option');
    option.value = version;
    option.textContent = version;
    versionSelect.appendChild(option);
  }

  // Handle version change
  versionSelect.addEventListener('change', async (e) => {
    const newVersion = e.target.value;
    state.currentVersion = newVersion;
    localStorage.setItem(VERSION_KEY, newVersion);

    // Clear cache
    state.loadedSuites.clear();

    // Load new version data
    await loadVersionData(newVersion);
  });
}

/**
 * Load data for a specific version
 */
async function loadVersionData(version) {
  try {
    state.manifest = await loadManifest(version);
    displayWelcome(state.manifest);
    buildTree(state.manifest, onTestSelect);
  } catch (error) {
    showError(`Failed to load manifest for ${version}: ` + error.message);
  }
}

/**
 * Handle test selection from tree
 */
async function onTestSelect(testPath) {
  const { preset, fork, testType, testSuite, config, testCase, testPath: fullPath, files } = testPath;

  try {
    // Check cache
    const cacheKey = `${state.currentVersion}:${fullPath}`;
    let loadedFiles = state.loadedSuites.get(cacheKey);

    if (loadedFiles) {
      // Use cached data - display immediately
      state.currentTest = { preset, fork, testType, testSuite, config, testCase, files: loadedFiles };
      displayTest(state.currentTest);
      return;
    }

    // Show test skeleton immediately with loading spinners
    displayTestSkeleton({
      preset,
      fork,
      testType,
      testSuite,
      config,
      testCase,
      fileNames: files
    });

    // Start loading all files in parallel
    const filePromises = loadTestFilesProgressive(state.currentVersion, fullPath, files);

    // Track loaded files
    const allLoadedFiles = [];
    const loadedFileMap = new Map(); // filename -> file data

    // Identify which SSZ files have YAML companions
    const sszWithYaml = new Set();
    for (const filePromise of filePromises) {
      const name = filePromise.name;
      if (name.endsWith('.ssz_snappy.yaml')) {
        const sszName = name.replace('.yaml', '');
        sszWithYaml.add(sszName);
      }
    }

    // Process each file as it loads (truly parallel, updates UI progressively)
    const loadPromises = filePromises.map(filePromise => {
      return filePromise.promise.then(fileData => {
        allLoadedFiles.push(fileData);
        loadedFileMap.set(fileData.name, fileData);

        // Check if this is a YAML companion file
        if (fileData.name.endsWith('.ssz_snappy.yaml')) {
          const sszName = fileData.name.replace('.yaml', '');

          // Check if the SSZ file has already loaded
          if (loadedFileMap.has(sszName)) {
            const sszFile = loadedFileMap.get(sszName);
            updateFileBox(sszName, sszFile, fileData);
          }
          // Otherwise, the SSZ file will handle it when it loads
        } else {
          // This is a primary file
          // Check if it needs a YAML companion
          if (sszWithYaml.has(fileData.name)) {
            const yamlName = fileData.name + '.yaml';
            const yamlData = loadedFileMap.get(yamlName);

            if (yamlData) {
              // YAML companion already loaded, update with both
              updateFileBox(fileData.name, fileData, yamlData);
            }
            // Otherwise, YAML companion will trigger update when it loads
          } else {
            // No YAML companion, update immediately
            updateFileBox(fileData.name, fileData);
          }
        }
      }).catch(error => {
        console.error(`Failed to load ${filePromise.name}:`, error);
        // Could show error state in the file box here
      });
    });

    // Wait for all files to complete, then enable download button
    await Promise.all(loadPromises);

    // Cache the loaded files
    state.loadedSuites.set(cacheKey, allLoadedFiles);

    // Enable download button
    enableDownloadTest(testCase, allLoadedFiles);

  } catch (error) {
    showError('Failed to load test data: ' + error.message);
  }
}

/**
 * Set up search functionality
 */
function setupSearch() {
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  let searchTimeout = null;

  searchInput.addEventListener('input', (e) => {
    state.searchTerm = e.target.value.trim().toLowerCase();

    // Show/hide clear button
    if (state.searchTerm) {
      searchClear.classList.remove('hidden');
    } else {
      searchClear.classList.add('hidden');
    }

    // Debounce search - wait 300ms after typing stops
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      filterTree(state.searchTerm);
    }, 300);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    state.searchTerm = '';
    searchClear.classList.add('hidden');
    filterTree('');
  });
}

/**
 * Show loading state
 */
function showLoading() {
  document.getElementById('welcome').classList.add('hidden');
  document.getElementById('testViewer').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');
  document.getElementById('loading').classList.remove('hidden');
}

/**
 * Show error message
 */
function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');

  document.getElementById('loading').classList.add('hidden');
  document.getElementById('testViewer').classList.add('hidden');
}

/**
 * Export state for debugging
 */
window.debugState = () => state;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
