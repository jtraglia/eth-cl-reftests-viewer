/**
 * Data loading functionality
 */

/**
 * Load available versions
 */
export async function loadVersions() {
  const response = await fetch('data/versions.json');

  if (!response.ok) {
    throw new Error(`Failed to load versions: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Load the manifest file for a specific version
 */
export async function loadManifest(version) {
  const response = await fetch(`data/${version}/manifest.json`);

  if (!response.ok) {
    throw new Error(`Failed to load manifest: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Load a test case files
 * @param {string} version - Version like "v1.6.0-beta.0"
 * @param {string} testPath - Path like "general/deneb/kzg/verify_blob_kzg_proof/kzg-mainnet/test_name"
 * @param {Array<string>} files - Array of filenames to load
 */
export async function loadTestFiles(version, testPath, files) {
  const loadedFiles = [];

  for (const filename of files) {
    const filePath = `data/${version}/tests/${testPath}/${filename}`;

    try {
      const response = await fetch(filePath);

      if (!response.ok) {
        console.warn(`Failed to load ${filename}: ${response.statusText}`);
        continue;
      }

      // Determine file type
      const isBinary = filename.endsWith('.ssz_snappy') || filename.endsWith('.ssz');

      let content;
      let yamlContent = null;

      if (isBinary) {
        // Load as arraybuffer for binary files
        content = await response.arrayBuffer();

        // Try to load the corresponding YAML file if it exists
        const yamlPath = `${filePath}.yaml`;
        try {
          const yamlResponse = await fetch(yamlPath);
          if (yamlResponse.ok) {
            yamlContent = await yamlResponse.text();
          }
        } catch (e) {
          // YAML file doesn't exist, which is fine
        }
      } else {
        // Load as text for YAML/text files
        content = await response.text();
      }

      loadedFiles.push({
        name: filename,
        content: content,
        isBinary: isBinary,
        size: content.byteLength || content.length,
        yamlContent: yamlContent  // Deserialized YAML content if available
      });
    } catch (error) {
      console.error(`Error loading ${filename}:`, error);
    }
  }

  return loadedFiles;
}
