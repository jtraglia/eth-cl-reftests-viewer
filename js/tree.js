/**
 * Tree navigation functionality
 */

let onTestSelectCallback = null;
let treeData = null;
let selectedPresets = new Set();
let selectedForks = new Set();
let selectedRunners = new Set();

// Cache for DOM queries
let cachedTreeNodes = null;
let cachedPresetButtons = null;
let cachedForkButtons = null;
let cachedRunnerButtons = null;
let cachedPresetTreeNodes = null; // Cache for top-level preset nodes

// Debounce timer for filters
let filterTimeout = null;

/**
 * Build the tree navigation from manifest
 */
export function buildTree(manifest, onTestSelect) {
  onTestSelectCallback = onTestSelect;
  treeData = manifest;

  const treeContainer = document.getElementById('tree');
  treeContainer.innerHTML = '';

  // Build preset filters
  buildPresetFilters(manifest);

  // Build fork filters
  buildForkFilters(manifest);

  // Build runner filters
  buildRunnerFilters(manifest);

  // Build tree for each preset
  for (const [preset, presetData] of Object.entries(manifest.presets)) {
    const presetNode = createTreeNode({
      label: preset,
      type: 'preset',
      preset: preset,
      children: buildForkNodes(preset, presetData.forks)
    });

    treeContainer.appendChild(presetNode);
  }

  // Invalidate DOM caches
  cachedTreeNodes = null;
  cachedPresetButtons = null;
  cachedForkButtons = null;
  cachedRunnerButtons = null;
  cachedPresetTreeNodes = null;
}

/**
 * Build preset filter buttons
 */
function buildPresetFilters(manifest) {
  const presetFiltersContainer = document.getElementById('presetFilters');
  presetFiltersContainer.innerHTML = '';

  // Get presets in specific order: general, minimal, mainnet
  const presetOrder = ['general', 'minimal', 'mainnet'];
  const availablePresets = Object.keys(manifest.presets);
  const orderedPresets = presetOrder.filter(p => availablePresets.includes(p));

  // Create filter buttons
  for (const preset of orderedPresets) {
    const btn = document.createElement('button');
    btn.className = 'preset-filter-btn';
    btn.textContent = preset;
    btn.dataset.preset = preset;

    btn.addEventListener('click', () => {
      // Toggle selection - only allow one preset at a time
      if (selectedPresets.has(preset)) {
        selectedPresets.delete(preset);
        btn.classList.remove('active');
      } else {
        // Clear all other preset selections
        selectedPresets.clear();
        getPresetButtons().forEach(b => b.classList.remove('active'));

        selectedPresets.add(preset);
        btn.classList.add('active');
      }

      // Apply filters
      applyFilters();
    });

    presetFiltersContainer.appendChild(btn);
  }
}

/**
 * Build fork filter buttons
 */
function buildForkFilters(manifest) {
  const forkFiltersContainer = document.getElementById('forkFilters');
  forkFiltersContainer.innerHTML = '';

  // Collect all unique forks
  const forks = new Set();
  for (const preset of Object.values(manifest.presets)) {
    for (const fork of Object.keys(preset.forks)) {
      forks.add(fork);
    }
  }

  // Create filter buttons with phase0 first, eip* forks last
  const forkOrder = ['phase0', 'altair', 'bellatrix', 'capella', 'deneb', 'electra', 'fulu'];
  const sortedForks = Array.from(forks).sort((a, b) => {
    const aIsEip = a.startsWith('eip');
    const bIsEip = b.startsWith('eip');

    // Put eip forks at the end
    if (aIsEip && !bIsEip) return 1;
    if (!aIsEip && bIsEip) return -1;

    // If both are eip or both are not eip, use normal sorting
    const aIndex = forkOrder.indexOf(a);
    const bIndex = forkOrder.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  });

  for (const fork of sortedForks) {
    const btn = document.createElement('button');
    btn.className = 'fork-filter-btn';
    btn.textContent = fork;
    btn.dataset.fork = fork;

    btn.addEventListener('click', () => {
      // Toggle selection - only allow one fork at a time
      if (selectedForks.has(fork)) {
        selectedForks.delete(fork);
        btn.classList.remove('active');
      } else {
        // Clear all other fork selections
        selectedForks.clear();
        getForkButtons().forEach(b => b.classList.remove('active'));

        selectedForks.add(fork);
        btn.classList.add('active');
      }

      // Apply filters
      applyFilters();
    });

    forkFiltersContainer.appendChild(btn);
  }
}

/**
 * Build runner filter buttons
 */
function buildRunnerFilters(manifest) {
  const runnerFiltersContainer = document.getElementById('runnerFilters');
  runnerFiltersContainer.innerHTML = '';

  // Collect all unique runners (test types)
  const runners = new Set();
  for (const preset of Object.values(manifest.presets)) {
    for (const fork of Object.values(preset.forks)) {
      for (const testType of Object.keys(fork.testTypes)) {
        runners.add(testType);
      }
    }
  }

  // Create filter buttons alphabetically
  const sortedRunners = Array.from(runners).sort();
  for (const runner of sortedRunners) {
    const btn = document.createElement('button');
    btn.className = 'runner-filter-btn';
    btn.textContent = runner.replace(/_/g, ' ');
    btn.dataset.runner = runner;

    btn.addEventListener('click', () => {
      // Toggle selection - only allow one runner at a time
      if (selectedRunners.has(runner)) {
        selectedRunners.delete(runner);
        btn.classList.remove('active');
      } else {
        // Clear all other runner selections
        selectedRunners.clear();
        getRunnerButtons().forEach(b => b.classList.remove('active'));

        selectedRunners.add(runner);
        btn.classList.add('active');
      }

      // Apply filters
      applyFilters();
    });

    runnerFiltersContainer.appendChild(btn);
  }
}

/**
 * Build fork nodes
 */
function buildForkNodes(preset, forks) {
  const nodes = [];

  // Define fork order with phase0 first, eip* forks last
  const forkOrder = ['phase0', 'altair', 'bellatrix', 'capella', 'deneb', 'electra', 'fulu'];

  const sortedForks = Object.entries(forks).sort(([a], [b]) => {
    const aIsEip = a.startsWith('eip');
    const bIsEip = b.startsWith('eip');

    // Put eip forks at the end
    if (aIsEip && !bIsEip) return 1;
    if (!aIsEip && bIsEip) return -1;

    // If both are eip or both are not eip, use fork order
    const aIndex = forkOrder.indexOf(a);
    const bIndex = forkOrder.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  });

  for (const [fork, forkData] of sortedForks) {
    nodes.push({
      label: fork,
      type: 'fork',
      preset: preset,
      fork: fork,
      children: buildTestTypeNodes(preset, fork, forkData.testTypes)
    });
  }

  return nodes;
}

/**
 * Build test type nodes
 */
function buildTestTypeNodes(preset, fork, testTypes) {
  const nodes = [];

  for (const [testType, testTypeData] of Object.entries(testTypes)) {
    nodes.push({
      label: testType,
      type: 'testType',
      preset: preset,
      fork: fork,
      runner: testType,
      children: buildTestSuiteNodes(preset, fork, testType, testTypeData.testSuites)
    });
  }

  return nodes;
}

/**
 * Build test suite nodes
 */
function buildTestSuiteNodes(preset, fork, testType, testSuites) {
  const nodes = [];

  for (const [testSuite, suiteData] of Object.entries(testSuites)) {
    nodes.push({
      label: testSuite,
      type: 'testSuite',
      preset: preset,
      fork: fork,
      runner: testType,
      count: suiteData.testCount,
      children: buildConfigNodes(preset, fork, testType, testSuite, suiteData.configs)
    });
  }

  return nodes;
}

/**
 * Build config nodes
 */
function buildConfigNodes(preset, fork, testType, testSuite, configs) {
  const nodes = [];

  for (const [config, configData] of Object.entries(configs)) {
    nodes.push({
      label: config,
      type: 'config',
      preset: preset,
      fork: fork,
      runner: testType,
      children: buildTestCaseNodes(preset, fork, testType, testSuite, config, configData.tests)
    });
  }

  return nodes;
}

/**
 * Build test case nodes
 */
function buildTestCaseNodes(preset, fork, testType, testSuite, config, tests) {
  return tests.map(test => ({
    label: test.name,
    type: 'testCase',
    preset: preset,
    fork: fork,
    runner: testType,
    path: { preset, fork, testType, testSuite, config, testCase: test.name, testPath: test.path, files: test.files }
  }));
}

/**
 * Create a tree node element
 */
function createTreeNode(nodeData) {
  const container = document.createElement('div');
  container.className = 'tree-node';
  container.dataset.type = nodeData.type;
  container.dataset.label = nodeData.label.toLowerCase();

  // Add preset data attribute for filtering
  if (nodeData.preset) {
    container.dataset.preset = nodeData.preset;
  }

  // Add fork data attribute for filtering
  if (nodeData.fork) {
    container.dataset.fork = nodeData.fork;
  }

  // Add runner data attribute for filtering
  if (nodeData.runner) {
    container.dataset.runner = nodeData.runner;
  }

  // Create label
  const label = document.createElement('div');
  label.className = 'tree-label';

  // Icon
  const icon = document.createElement('span');
  icon.className = 'tree-icon';

  if (nodeData.children && nodeData.children.length > 0) {
    icon.innerHTML = '<i class="fas fa-chevron-right"></i>';
  } else {
    icon.innerHTML = '<i class="fas fa-file"></i>';
  }

  label.appendChild(icon);

  // Label text
  const text = document.createElement('span');
  text.textContent = nodeData.label;
  label.appendChild(text);

  // Count badge
  if (nodeData.count) {
    const count = document.createElement('span');
    count.className = 'tree-count';
    count.textContent = nodeData.count;
    label.appendChild(count);
  }

  container.appendChild(label);

  // Children container
  if (nodeData.children && nodeData.children.length > 0) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children collapsed';

    for (const child of nodeData.children) {
      childrenContainer.appendChild(createTreeNode(child));
    }

    container.appendChild(childrenContainer);

    // Toggle children on click
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNode(container, icon);
    });
  } else if (nodeData.path) {
    // Leaf node - test case
    label.addEventListener('click', (e) => {
      e.stopPropagation();

      // Remove active class from all labels
      document.querySelectorAll('.tree-label.active').forEach(el => {
        el.classList.remove('active');
      });

      // Add active class to this label
      label.classList.add('active');

      // Call callback
      if (onTestSelectCallback) {
        onTestSelectCallback(nodeData.path);
      }
    });
  }

  return container;
}

/**
 * Toggle tree node expansion
 */
function toggleNode(container, icon) {
  const children = container.querySelector('.tree-children');

  if (!children) return;

  children.classList.toggle('collapsed');

  // Update icon
  if (children.classList.contains('collapsed')) {
    icon.innerHTML = '<i class="fas fa-chevron-right"></i>';
  } else {
    icon.innerHTML = '<i class="fas fa-chevron-down"></i>';
  }
}

/**
 * Get cached tree nodes
 */
function getTreeNodes() {
  if (!cachedTreeNodes) {
    cachedTreeNodes = document.querySelectorAll('.tree-node');
  }
  return cachedTreeNodes;
}

/**
 * Get cached top-level preset tree nodes
 */
function getPresetTreeNodes() {
  if (!cachedPresetTreeNodes) {
    cachedPresetTreeNodes = document.querySelectorAll('.tree-node[data-type="preset"]');
  }
  return cachedPresetTreeNodes;
}

/**
 * Get cached preset buttons
 */
function getPresetButtons() {
  if (!cachedPresetButtons) {
    cachedPresetButtons = document.querySelectorAll('.preset-filter-btn');
  }
  return cachedPresetButtons;
}

/**
 * Get cached fork buttons
 */
function getForkButtons() {
  if (!cachedForkButtons) {
    cachedForkButtons = document.querySelectorAll('.fork-filter-btn');
  }
  return cachedForkButtons;
}

/**
 * Get cached runner buttons
 */
function getRunnerButtons() {
  if (!cachedRunnerButtons) {
    cachedRunnerButtons = document.querySelectorAll('.runner-filter-btn');
  }
  return cachedRunnerButtons;
}

/**
 * Update button states based on available data
 */
function updateButtonStates() {
  if (!treeData) return;

  // Get current selections
  const selectedPreset = selectedPresets.size > 0 ? Array.from(selectedPresets)[0] : null;
  const selectedFork = selectedForks.size > 0 ? Array.from(selectedForks)[0] : null;
  const selectedRunner = selectedRunners.size > 0 ? Array.from(selectedRunners)[0] : null;

  // Update fork buttons based on selected preset/runner
  const forkButtons = getForkButtons();
  if (selectedPreset || selectedRunner) {
    const availableForks = new Set();

    // Collect all available forks for the current selection
    for (const [presetName, presetData] of Object.entries(treeData.presets)) {
      if (selectedPreset && presetName !== selectedPreset) continue;

      for (const [forkName, forkData] of Object.entries(presetData.forks)) {
        // If runner is selected, only include forks that have this runner
        if (selectedRunner) {
          if (Object.keys(forkData.testTypes).includes(selectedRunner)) {
            availableForks.add(forkName);
          }
        } else {
          availableForks.add(forkName);
        }
      }
    }

    forkButtons.forEach(btn => {
      const fork = btn.dataset.fork;
      if (availableForks.has(fork)) {
        btn.disabled = false;
        btn.classList.remove('disabled');
      } else {
        btn.disabled = true;
        btn.classList.add('disabled');
      }
    });
  } else {
    forkButtons.forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('disabled');
    });
  }

  // Update runner buttons based on selected preset/fork
  const runnerButtons = getRunnerButtons();
  if (selectedPreset || selectedFork) {
    const availableRunners = new Set();

    // Collect all available runners for the current selection
    for (const [presetName, presetData] of Object.entries(treeData.presets)) {
      if (selectedPreset && presetName !== selectedPreset) continue;

      for (const [forkName, forkData] of Object.entries(presetData.forks)) {
        if (selectedFork && forkName !== selectedFork) continue;

        for (const testType of Object.keys(forkData.testTypes)) {
          availableRunners.add(testType);
        }
      }
    }

    runnerButtons.forEach(btn => {
      const runner = btn.dataset.runner;
      if (availableRunners.has(runner)) {
        btn.disabled = false;
        btn.classList.remove('disabled');
      } else {
        btn.disabled = true;
        btn.classList.add('disabled');
      }
    });
  } else {
    runnerButtons.forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('disabled');
    });
  }

  // Update preset buttons based on selected fork/runner
  const presetButtons = getPresetButtons();
  if (selectedFork || selectedRunner) {
    const availablePresets = new Set();

    for (const [presetName, presetData] of Object.entries(treeData.presets)) {
      for (const [forkName, forkData] of Object.entries(presetData.forks)) {
        if (selectedFork && forkName !== selectedFork) continue;

        for (const testType of Object.keys(forkData.testTypes)) {
          if (selectedRunner && testType !== selectedRunner) continue;
          availablePresets.add(presetName);
        }
      }
    }

    presetButtons.forEach(btn => {
      const preset = btn.dataset.preset;
      if (availablePresets.has(preset)) {
        btn.disabled = false;
        btn.classList.remove('disabled');
      } else {
        btn.disabled = true;
        btn.classList.add('disabled');
      }
    });
  } else {
    presetButtons.forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('disabled');
    });
  }
}

/**
 * Apply combined filters (search + forks)
 */
function applyFilters() {
  // Defer filter work to next frame for immediate button feedback
  requestAnimationFrame(() => {
    const searchInput = document.getElementById('searchInput');
    const searchTerm = searchInput.value.trim().toLowerCase();
    updateButtonStates();
    filterTree(searchTerm);
  });
}

/**
 * Filter tree based on search term, selected presets, selected forks, and selected runners
 */
export function filterTree(searchTerm) {
  const allNodes = getTreeNodes();

  // If no filters active, show all
  if (!searchTerm && selectedPresets.size === 0 && selectedForks.size === 0 && selectedRunners.size === 0) {
    allNodes.forEach(node => {
      node.classList.remove('tree-filtered');
    });
    return;
  }

  // Fast path: if ONLY preset filter is active, just show/hide top-level preset nodes
  if (!searchTerm && selectedPresets.size > 0 && selectedForks.size === 0 && selectedRunners.size === 0) {
    const selectedPreset = Array.from(selectedPresets)[0];
    const presetNodes = getPresetTreeNodes();

    // Show/hide top-level preset nodes (just 3: general, minimal, mainnet)
    for (const node of presetNodes) {
      const nodePreset = node.dataset.preset;
      if (nodePreset === selectedPreset) {
        node.classList.remove('tree-filtered');

        // Ensure all children of selected preset are visible
        const childNodes = node.querySelectorAll('.tree-node');
        childNodes.forEach(child => child.classList.remove('tree-filtered'));
      } else {
        node.classList.add('tree-filtered');
      }
    }
    return;
  }

  // Full filtering for complex queries
  // Mark all nodes as filtered initially
  allNodes.forEach(node => {
    node.classList.add('tree-filtered');
  });

  // Find matching nodes based on filters
  const matchingNodes = [];
  for (const node of allNodes) {
    // Check search term
    const label = node.dataset.label;
    const matchesSearch = !searchTerm || (label && label.includes(searchTerm));

    // Check preset filter
    const preset = node.dataset.preset;
    const matchesPreset = selectedPresets.size === 0 || (preset && selectedPresets.has(preset));

    // Check fork filter
    const fork = node.dataset.fork;
    const matchesFork = selectedForks.size === 0 || (fork && selectedForks.has(fork));

    // Check runner filter
    const runner = node.dataset.runner;
    const matchesRunner = selectedRunners.size === 0 || (runner && selectedRunners.has(runner));

    if (matchesSearch && matchesPreset && matchesFork && matchesRunner) {
      matchingNodes.push(node);
    }
  }

  // Track processed nodes to avoid redundant work
  const processedNodes = new Set();

  // Show matching nodes and their ancestors (batch with classList)
  for (const node of matchingNodes) {
    showNodeAndAncestors(node, processedNodes);
  }
}

/**
 * Show a node and all its ancestors
 */
function showNodeAndAncestors(node, processedNodes) {
  let current = node;

  while (current && current.classList.contains('tree-node')) {
    // Skip if already processed
    if (processedNodes.has(current)) {
      break;
    }
    processedNodes.add(current);

    // Remove filtered class to show the node
    current.classList.remove('tree-filtered');

    // Expand children container if collapsed
    const children = current.querySelector(':scope > .tree-children');
    if (children && children.classList.contains('collapsed')) {
      const label = current.querySelector(':scope > .tree-label');
      const icon = label?.querySelector('.tree-icon');
      if (icon) {
        children.classList.remove('collapsed');
        icon.innerHTML = '<i class="fas fa-chevron-down"></i>';
      }
    }

    // Move to parent tree node
    current = current.parentElement?.closest('.tree-node');
  }
}
