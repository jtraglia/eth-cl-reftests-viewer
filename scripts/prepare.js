#!/usr/bin/env node

/**
 * Download and prepare test data for the viewer
 *
 * Usage: node prepare.js <version> [output-dir]
 * Example: node prepare.js v1.6.0-beta.0
 * Example: node prepare.js v1.6.0-beta.1 ./data
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const GITHUB_REPO = 'ethereum/consensus-specs';
const PRESETS = ['general', 'minimal', 'mainnet'];

/**
 * Download a file from URL to destination
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`Failed to download: ${response.statusCode}`));
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;
      let lastPercent = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const percent = Math.floor((downloaded / totalSize) * 100);
        if (percent > lastPercent && percent % 10 === 0) {
          process.stdout.write(`\r  Progress: ${percent}%`);
          lastPercent = percent;
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        process.stdout.write(`\r  Progress: 100%\n`);
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

/**
 * Download and extract test archives for a version
 */
async function downloadAndExtractTests(version, outputDir) {
  console.log('Downloading and extracting test archives...\n');

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  for (const preset of PRESETS) {
    const filename = `${preset}.tar.gz`;
    const url = `https://github.com/${GITHUB_REPO}/releases/download/${version}/${filename}`;
    const dest = path.join(outputDir, filename);

    console.log(`Downloading ${filename}...`);

    try {
      await downloadFile(url, dest);
      console.log(`Extracting ${filename}...`);

      // Extract directly to output directory
      execSync(`tar -xzf "${dest}" -C "${outputDir}"`, { stdio: 'inherit' });

      // Remove tar file
      fs.unlinkSync(dest);

      console.log(`✓ ${preset} complete\n`);
    } catch (error) {
      console.error(`Error processing ${preset}: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Recursively find all test case directories (containing data.yaml or *.ssz_snappy files)
 */
function findTestCases(dir, basePath = '') {
  const results = [];

  function walk(currentPath, relativePath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    // Check if this directory contains test files
    const hasDataYaml = entries.some(e => e.name === 'data.yaml');
    const hasSszFiles = entries.some(e => e.name.endsWith('.ssz_snappy'));
    const hasMetaYaml = entries.some(e => e.name === 'meta.yaml');

    if (hasDataYaml || hasSszFiles || hasMetaYaml) {
      // This is a test case directory
      const files = entries
        .filter(e => e.isFile())
        .map(e => e.name);

      results.push({
        path: relativePath,
        files: files
      });
    } else {
      // Keep walking
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const newPath = path.join(currentPath, entry.name);
          const newRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
          walk(newPath, newRelativePath);
        }
      }
    }
  }

  walk(dir, basePath);
  return results;
}

/**
 * Parse test path to extract hierarchy
 * Path format: tests/{preset}/{fork}/{test_type}/{test_suite}/{config}/{test_case}
 */
function parseTestPath(testPath) {
  const parts = testPath.split(path.sep);

  if (parts.length < 7) {
    return null; // Invalid path
  }

  // Skip "tests" directory at index 0
  return {
    preset: parts[1],
    fork: parts[2],
    testType: parts[3],
    testSuite: parts[4],
    config: parts[5],
    testCase: parts[6]
  };
}

/**
 * Build hierarchical manifest structure
 */
function buildManifest(testCases) {
  const manifest = {
    presets: {},
    stats: {
      totalTests: testCases.length,
      generatedAt: new Date().toISOString()
    }
  };

  for (const testCase of testCases) {
    const parsed = parseTestPath(testCase.path);

    if (!parsed) {
      console.warn(`Skipping invalid path: ${testCase.path}`);
      continue;
    }

    const { preset, fork, testType, testSuite, config, testCase: testName } = parsed;

    // Initialize nested structure
    if (!manifest.presets[preset]) {
      manifest.presets[preset] = { forks: {} };
    }
    if (!manifest.presets[preset].forks[fork]) {
      manifest.presets[preset].forks[fork] = { testTypes: {} };
    }
    if (!manifest.presets[preset].forks[fork].testTypes[testType]) {
      manifest.presets[preset].forks[fork].testTypes[testType] = { testSuites: {} };
    }
    if (!manifest.presets[preset].forks[fork].testTypes[testType].testSuites[testSuite]) {
      manifest.presets[preset].forks[fork].testTypes[testType].testSuites[testSuite] = {
        configs: {},
        testCount: 0
      };
    }
    if (!manifest.presets[preset].forks[fork].testTypes[testType].testSuites[testSuite].configs[config]) {
      manifest.presets[preset].forks[fork].testTypes[testType].testSuites[testSuite].configs[config] = {
        tests: []
      };
    }

    // Add test case with its files
    manifest.presets[preset].forks[fork].testTypes[testType].testSuites[testSuite].configs[config].tests.push({
      name: testName,
      files: testCase.files,
      path: testCase.path
    });

    manifest.presets[preset].forks[fork].testTypes[testType].testSuites[testSuite].testCount++;
  }

  return manifest;
}


/**
 * Update versions.json file
 */
function updateVersionsFile(dataDir, version) {
  const versionsPath = path.join(dataDir, 'versions.json');
  let versions = { versions: [] };

  // Load existing versions file if it exists
  if (fs.existsSync(versionsPath)) {
    versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
  }

  // Add new version if not already present
  if (!versions.versions.includes(version)) {
    versions.versions.push(version);
    versions.versions.sort().reverse(); // Sort descending (newest first)
  }

  fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2));
  console.log(`Updated versions list: ${versionsPath}`);
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node prepare.js <version> [output-dir]');
    console.error('Example: node prepare.js v1.6.0-beta.0');
    console.error('Example: node prepare.js v1.6.0-beta.1 ./data');
    process.exit(1);
  }

  const version = args[0];
  const dataDir = path.resolve(args[1] || './data');

  // Validate version format
  if (!/^v\d+\.\d+\.\d+/.test(version)) {
    console.error(`Error: Version must start with v{major}.{minor}.{patch} (e.g., v1.6.0-beta.0)`);
    process.exit(1);
  }

  const versionDir = path.join(dataDir, version);
  const outputDir = path.join(versionDir, 'tests');

  console.log('Ethereum Consensus Layer Reference Tests');
  console.log('=========================================\n');
  console.log(`Version: ${version}`);
  console.log(`Output: ${dataDir}\n`);

  try {
    // Create version directory
    fs.mkdirSync(versionDir, { recursive: true });

    // Download and extract tests directly to output directory
    await downloadAndExtractTests(version, outputDir);

    // Find all test cases in output directory
    console.log('Finding test cases...');
    const testCases = findTestCases(outputDir);
    console.log(`Found ${testCases.length} test cases\n`);

    // Build manifest
    console.log('Building manifest...');
    const manifest = buildManifest(testCases);
    manifest.version = version;

    // Write manifest
    const manifestPath = path.join(versionDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Manifest written to: ${manifestPath}\n`);

    // Update versions list
    updateVersionsFile(dataDir, version);

    console.log('\n✓ All done!');
    console.log(`\nVersion:  ${version}`);
    console.log(`Tests:    ${outputDir}`);
    console.log(`Manifest: ${manifestPath}`);
  } catch (error) {
    console.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
