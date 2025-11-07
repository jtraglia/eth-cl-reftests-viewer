/**
 * Test viewer functionality
 */

/**
 * Display welcome screen
 */
export function displayWelcome(manifest) {
  // Welcome screen is displayed by default
  // Stats have been removed per user request
}

/**
 * Display a test case
 */
export function displayTest(test) {
  const { preset, fork, testType, testSuite, config, testCase, files } = test;

  // Hide other views
  document.getElementById('welcome').classList.add('hidden');
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  // Show test viewer
  const viewer = document.getElementById('testViewer');
  viewer.classList.remove('hidden');

  // Set title
  document.getElementById('testTitle').textContent = testCase;

  // Set breadcrumb
  document.getElementById('breadcrumb').innerHTML = `
    <span>${preset}</span> /
    <span>${fork}</span> /
    <span>${testType}</span> /
    <span>${testSuite}</span> /
    <span>${config}</span>
  `;

  // Display files in collapsible boxes
  const content = document.getElementById('testContent');
  content.innerHTML = '';

  // Create a map of ssz_snappy files to their yaml companions
  const fileMap = new Map();
  const yamlFiles = new Set();

  for (const file of files) {
    if (file.name.endsWith('.ssz_snappy.yaml')) {
      // This is a companion YAML file
      const sszName = file.name.replace('.yaml', '');
      yamlFiles.add(file.name);
      fileMap.set(sszName, file);
    }
  }

  // Display each file, combining ssz_snappy with their yaml companions
  for (const file of files) {
    // Skip standalone .yaml files (they'll be paired with their ssz_snappy)
    if (yamlFiles.has(file.name)) {
      continue;
    }

    // Check if this ssz_snappy file has a yaml companion
    const yamlCompanion = fileMap.get(file.name);
    const fileBox = createFileBox(file, yamlCompanion);
    content.appendChild(fileBox);
  }

  // Set up download test button
  setupDownloadTestButton(testCase, files);
}

/**
 * Create a collapsible file box
 * @param {Object} file - The primary file
 * @param {Object} yamlCompanion - Optional YAML companion file for binary files
 */
function createFileBox(file, yamlCompanion = null) {
  const container = document.createElement('div');
  container.className = 'file-box';

  // Header
  const header = document.createElement('div');
  header.className = 'file-header';

  const icon = document.createElement('i');
  icon.className = 'fas fa-chevron-right file-toggle-icon';

  const filenameEl = document.createElement('span');
  filenameEl.className = 'file-name';
  filenameEl.textContent = file.name;

  const sizeEl = document.createElement('span');
  sizeEl.className = 'file-size';
  sizeEl.textContent = formatBytes(file.size);

  // Create hex/yaml toggle buttons for binary files with YAML companion
  let hexBtn = null;
  let yamlBtn = null;
  let toggleGroup = null;
  if (file.isBinary && yamlCompanion) {
    toggleGroup = document.createElement('div');
    toggleGroup.className = 'view-toggle-group';

    hexBtn = document.createElement('button');
    hexBtn.className = 'view-toggle-button active';
    hexBtn.textContent = 'hex';
    hexBtn.dataset.view = 'hex';

    yamlBtn = document.createElement('button');
    yamlBtn.className = 'view-toggle-button';
    yamlBtn.textContent = 'yaml';
    yamlBtn.dataset.view = 'yaml';

    toggleGroup.appendChild(hexBtn);
    toggleGroup.appendChild(yamlBtn);
  }

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'file-download-button';
  downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
  downloadBtn.title = 'Download file';

  // Track current view mode for files with toggle
  let currentViewMode = 'hex'; // default

  downloadBtn.onclick = (e) => {
    e.stopPropagation();
    if (yamlCompanion && currentViewMode === 'yaml') {
      // Download YAML file
      downloadFileFromContent(file.name + '.yaml', yamlCompanion.content, false);
    } else {
      // Download original file
      downloadFileFromContent(file.name, file.content, file.isBinary);
    }
  };

  header.appendChild(icon);
  header.appendChild(filenameEl);
  header.appendChild(sizeEl);
  if (toggleGroup) {
    header.appendChild(toggleGroup);
  }
  header.appendChild(downloadBtn);

  // Content (collapsed by default)
  const contentContainer = document.createElement('div');
  contentContainer.className = 'file-content collapsed';

  const codeBox = document.createElement('pre');
  codeBox.className = 'test-code-box';

  const codeContent = document.createElement('code');

  if (file.isBinary) {
    // Display hex preview for binary files
    codeContent.className = 'language-text';
    codeContent.textContent = formatHexPreview(file.content);
  } else {
    // Display text content
    codeContent.className = 'language-yaml';
    codeContent.textContent = file.content;
  }

  codeBox.appendChild(codeContent);
  contentContainer.appendChild(codeBox);

  // Set up toggle buttons if available
  if (file.isBinary && yamlCompanion && hexBtn && yamlBtn) {
    hexBtn.onclick = (e) => {
      e.stopPropagation();
      // Switch to hex view
      codeContent.className = 'language-text';
      codeContent.textContent = formatHexPreview(file.content);
      hexBtn.classList.add('active');
      yamlBtn.classList.remove('active');
      currentViewMode = 'hex';
    };

    yamlBtn.onclick = (e) => {
      e.stopPropagation();
      // Switch to YAML view
      codeContent.className = 'language-yaml';
      codeContent.textContent = yamlCompanion.content;
      yamlBtn.classList.add('active');
      hexBtn.classList.remove('active');
      currentViewMode = 'yaml';
    };
  }

  // Toggle functionality
  header.addEventListener('click', () => {
    contentContainer.classList.toggle('collapsed');
    if (contentContainer.classList.contains('collapsed')) {
      icon.className = 'fas fa-chevron-right file-toggle-icon';
    } else {
      icon.className = 'fas fa-chevron-down file-toggle-icon';
    }
  });

  container.appendChild(header);
  container.appendChild(contentContainer);

  return container;
}

/**
 * Format binary data as hex preview (first 1024 bytes)
 */
function formatHexPreview(arrayBuffer) {
  const maxBytes = 1024;
  const bytes = new Uint8Array(arrayBuffer);
  const preview = bytes.slice(0, maxBytes);

  let hex = '';
  for (let i = 0; i < preview.length; i += 16) {
    // Offset
    hex += i.toString(16).padStart(8, '0') + '  ';

    // Hex bytes
    for (let j = 0; j < 16; j++) {
      if (i + j < preview.length) {
        hex += preview[i + j].toString(16).padStart(2, '0') + ' ';
      } else {
        hex += '   ';
      }
      if (j === 7) hex += ' ';
    }

    // ASCII
    hex += ' |';
    for (let j = 0; j < 16 && i + j < preview.length; j++) {
      const byte = preview[i + j];
      hex += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
    }
    hex += '|\n';
  }

  if (bytes.length > maxBytes) {
    hex += `\n... (${bytes.length - maxBytes} more bytes, download to view full file)`;
  }

  return hex;
}

/**
 * Format bytes to human readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format data as YAML-like text
 */
function formatAsYAML(data, indent = 0) {
  const indentStr = '  '.repeat(indent);
  let result = '';

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return '[]';
    }
    for (const item of data) {
      if (typeof item === 'object' && item !== null) {
        result += `\n${indentStr}- ${formatAsYAML(item, indent + 1).trim()}`;
      } else {
        result += `\n${indentStr}- ${formatValueYAML(item)}`;
      }
    }
    return result;
  } else if (typeof data === 'object' && data !== null) {
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          result += `${indentStr}${key}: []\n`;
        } else {
          result += `${indentStr}${key}:${formatAsYAML(value, indent + 1)}\n`;
        }
      } else if (typeof value === 'object' && value !== null) {
        result += `${indentStr}${key}:\n${formatAsYAML(value, indent + 1)}`;
      } else {
        result += `${indentStr}${key}: ${formatValueYAML(value)}\n`;
      }
    }
    return result;
  } else {
    return formatValueYAML(data);
  }
}

/**
 * Format a value for YAML display
 */
function formatValueYAML(value) {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'boolean') {
    return value.toString();
  }
  if (typeof value === 'string') {
    // Quote strings with special characters
    if (value.includes('\n') || value.includes(':') || value.includes('#')) {
      return `"${value}"`;
    }
    return value;
  }
  return String(value);
}


/**
 * Download a file from content
 */
function downloadFileFromContent(filename, content, isBinary) {
  const blob = isBinary
    ? new Blob([content], { type: 'application/octet-stream' })
    : new Blob([content], { type: 'text/plain' });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Set up download test button
 */
function setupDownloadTestButton(testName, files) {
  const downloadButton = document.getElementById('downloadTestButton');

  downloadButton.onclick = async () => {
    try {
      // Create zip file
      const zip = new JSZip();
      const folder = zip.folder(testName);

      // Add all files to zip
      for (const file of files) {
        if (file.isBinary) {
          folder.file(file.name, file.content);
        } else {
          folder.file(file.name, file.content);
        }
      }

      // Generate zip and download
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${testName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to create zip:', error);
      alert('Failed to download test. See console for details.');
    }
  };
}
