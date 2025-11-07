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
const os = require('os');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

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
async function downloadAndExtractTests(version, extractDir) {
  console.log('Downloading and extracting test archives...\n');

  // Ensure extract directory exists
  fs.mkdirSync(extractDir, { recursive: true });

  for (const preset of PRESETS) {
    const filename = `${preset}.tar.gz`;
    const url = `https://github.com/${GITHUB_REPO}/releases/download/${version}/${filename}`;
    const dest = path.join(extractDir, filename);

    console.log(`Downloading ${filename}...`);

    try {
      await downloadFile(url, dest);
      console.log(`Extracting ${filename}...`);

      // Extract to extract directory (tar contains tests/ directory)
      execSync(`tar -xzf "${dest}" -C "${extractDir}"`, { stdio: 'inherit' });

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
 * Path format: {preset}/{fork}/{test_type}/{test_suite}/{config}/{test_case}
 */
function parseTestPath(testPath) {
  const parts = testPath.split(path.sep);

  if (parts.length < 6) {
    return null; // Invalid path
  }

  return {
    preset: parts[0],
    fork: parts[1],
    testType: parts[2],
    testSuite: parts[3],
    config: parts[4],
    testCase: parts[5]
  };
}

/**
 * Recursively find all .ssz_snappy files
 */
function findSSZFiles(dir) {
  const results = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.ssz_snappy')) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Deserialize a single SSZ file
 */
async function deserializeSingleFile(sszFile, yamlFile, scriptPath, consensusSpecsPath) {
  try {
    const { stdout, stderr } = await execAsync(
      `cd "${consensusSpecsPath}" && uv run python "${scriptPath}" "${sszFile}" "${yamlFile}"`,
      { timeout: 600000, maxBuffer: 1024 * 1024 }  // 10 minute timeout for large files
    );
    return { status: 'success', stdout, stderr };
  } catch (error) {
    // Check exit code - Python script exits with 2 for "skip this file"
    const exitCode = error.code || error.exitCode || (error.killed ? null : 1);
    if (exitCode === 2) {
      return { status: 'skipped' };
    } else {
      return { status: 'error', error };
    }
  }
}

/**
 * Deserialize SSZ files to YAML using Python script (with parallel processing)
 */
async function deserializeSSZFiles(outputDir) {
  console.log('\nDeserializing SSZ files to YAML...');

  const scriptPath = path.join(__dirname, 'deserialize_ssz.py');
  const consensusSpecsPath = path.resolve(__dirname, '../consensus-specs');

  // Find all .ssz_snappy files using filesystem API
  console.log('Finding SSZ files...');
  const allSszFiles = findSSZFiles(outputDir);
  console.log(`Found ${allSszFiles.length} total SSZ files`);

  // Filter out files to process
  const filesToProcess = [];
  let skippedGeneral = 0;
  let alreadyExists = 0;

  for (const sszFile of allSszFiles) {
    // Skip general directory tests (includes ssz_generic, bls, etc.)
    if (sszFile.includes('/tests/general/')) {
      skippedGeneral++;
      continue;
    }

    const yamlFile = sszFile.replace('.ssz_snappy', '.ssz_snappy.yaml');

    // Skip if YAML already exists
    if (fs.existsSync(yamlFile)) {
      alreadyExists++;
      continue;
    }

    filesToProcess.push({ sszFile, yamlFile });
  }

  console.log(`Skipping ${skippedGeneral} general directory files`);
  console.log(`Skipping ${alreadyExists} already processed files`);
  console.log(`Processing ${filesToProcess.length} files in parallel...\n`);

  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  const BATCH_SIZE = os.cpus().length; // Use all CPU cores
  const totalBatches = Math.ceil(filesToProcess.length / BATCH_SIZE);

  console.log(`Using ${BATCH_SIZE} parallel processes (CPU cores: ${os.cpus().length})`);
  console.log(`Starting ${totalBatches} batches...\n`);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const start = batchIdx * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, filesToProcess.length);
    const batch = filesToProcess.slice(start, end);

    // Print which files are being processed
    for (const { sszFile } of batch) {
      console.log(`Processing: ${sszFile}`);
    }

    // Process batch in parallel
    const promises = batch.map(({ sszFile, yamlFile }) =>
      deserializeSingleFile(sszFile, yamlFile, scriptPath, consensusSpecsPath)
    );

    const results = await Promise.all(promises);

    // Count results and show output immediately
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'success') {
        successCount++;
        // Print success details (uncomment to debug successful deserializations)
        // console.log(`\n${'='.repeat(80)}`);
        // console.log(`SUCCESS #${successCount}:`);
        // console.log(`File: ${batch[i].sszFile}`);
        // console.log(`${'='.repeat(80)}`);
        // if (result.stdout) {
        //   console.log('STDOUT:');
        //   console.log(result.stdout.toString());
        // }
        // if (result.stderr) {
        //   console.log('STDERR:');
        //   console.log(result.stderr.toString());
        // }
        // console.log(`${'='.repeat(80)}\n`);
      } else if (result.status === 'skipped') {
        skippedCount++;
      } else {
        errorCount++;
        // Print full error details immediately
        console.error(`\n${'='.repeat(80)}`);
        console.error(`ERROR #${errorCount}:`);
        console.error(`File: ${batch[i].sszFile}`);
        console.error(`${'='.repeat(80)}`);
        if (result.error.stdout) {
          console.error('STDOUT:');
          console.error(result.error.stdout.toString());
        }
        if (result.error.stderr) {
          console.error('STDERR:');
          console.error(result.error.stderr.toString());
        }
        if (!result.error.stdout && !result.error.stderr) {
          console.error('ERROR MESSAGE:');
          console.error(result.error.message);
        }
        console.error(`${'='.repeat(80)}\n`);
      }
    }

    // Report progress every 100 batches
    if ((batchIdx + 1) % 100 === 0) {
      const processed = end;
      const percent = Math.round((processed / filesToProcess.length) * 100);
      console.log(`  Progress: ${processed}/${filesToProcess.length} (${percent}%) - ${successCount} success, ${skippedCount} skipped, ${errorCount} errors`);
    }
  }

  console.log(`\nDeserialization complete: ${successCount} success, ${skippedCount} skipped, ${errorCount} errors (${skippedGeneral} general directory skipped, ${alreadyExists} already existed)`);
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
  const testsDir = path.join(versionDir, 'tests');

  console.log('Ethereum Consensus Layer Reference Tests');
  console.log('=========================================\n');
  console.log(`Version: ${version}`);
  console.log(`Output: ${dataDir}\n`);

  try {
    // Create version directory
    fs.mkdirSync(versionDir, { recursive: true });

    // Download and extract tests to version directory (tar contains tests/ directory)
    await downloadAndExtractTests(version, versionDir);

    // Deserialize SSZ files to YAML
    await deserializeSSZFiles(testsDir);

    // Find all test cases in tests directory
    console.log('Finding test cases...');
    const testCases = findTestCases(testsDir);
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
    console.log(`Tests:    ${testsDir}`);
    console.log(`Manifest: ${manifestPath}`);
  } catch (error) {
    console.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
