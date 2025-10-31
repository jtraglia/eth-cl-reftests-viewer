#!/usr/bin/env node

/**
 * Extract and process Ethereum consensus spec tests from unpacked tarball directories
 *
 * Usage: node extract.js <source-dir> <output-dir>
 * Example: node extract.js /Users/jtraglia/files/tests ./data/tests
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CHUNK_SIZE_LIMIT = 2 * 1024 * 1024; // 2MB per chunk

/**
 * Recursively find all data.yaml files
 */
function findTestFiles(dir) {
  const results = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name === 'data.yaml') {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Parse test path to extract hierarchy
 * Path format: {preset}/{fork}/{test_type}/{test_suite}/{config}/{test_case}/data.yaml
 */
function parseTestPath(filePath, sourceDir) {
  const relativePath = path.relative(sourceDir, filePath);
  const parts = relativePath.split(path.sep);

  // Remove 'data.yaml' from end
  parts.pop();

  return {
    preset: parts[0],
    fork: parts[1],
    testType: parts[2],
    testSuite: parts[3],
    config: parts[4],
    testCase: parts[5],
    relativePath: relativePath
  };
}

/**
 * Load and parse YAML test data
 */
function loadTestData(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content);
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Build hierarchical manifest structure
 */
function buildManifest(testFiles, sourceDir) {
  const manifest = {
    presets: {},
    stats: {
      totalTests: testFiles.length,
      totalSize: 0,
      generatedAt: new Date().toISOString()
    }
  };

  for (const filePath of testFiles) {
    const parsed = parseTestPath(filePath, sourceDir);
    const { preset, fork, testType, testSuite, config, testCase } = parsed;

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

    // Add test case
    manifest.presets[preset].forks[fork].testTypes[testType].testSuites[testSuite].configs[config].tests.push(testCase);
    manifest.presets[preset].forks[fork].testTypes[testType].testSuites[testSuite].testCount++;
  }

  return manifest;
}

/**
 * Process and chunk test data by test suite
 */
function processTests(testFiles, sourceDir, outputDir) {
  const testsByChunk = {}; // Key: preset/fork/testType/testSuite/config

  console.log(`Processing ${testFiles.length} test files...`);

  for (let i = 0; i < testFiles.length; i++) {
    const filePath = testFiles[i];
    const parsed = parseTestPath(filePath, sourceDir);
    const { preset, fork, testType, testSuite, config, testCase } = parsed;

    if (i % 50 === 0) {
      console.log(`  Processed ${i}/${testFiles.length} tests...`);
    }

    // Load test data
    const testData = loadTestData(filePath);
    if (!testData) continue;

    // Create chunk key
    const chunkKey = `${preset}/${fork}/${testType}/${testSuite}/${config}`;

    if (!testsByChunk[chunkKey]) {
      testsByChunk[chunkKey] = {
        preset,
        fork,
        testType,
        testSuite,
        config,
        tests: {}
      };
    }

    // Add test to chunk
    testsByChunk[chunkKey].tests[testCase] = testData;
  }

  console.log(`\nWriting ${Object.keys(testsByChunk).length} chunk files...`);

  // Write chunks to disk
  for (const [chunkKey, chunkData] of Object.entries(testsByChunk)) {
    const outputPath = path.join(outputDir, `${chunkKey}.json`);
    const outputDirPath = path.dirname(outputPath);

    // Create directories
    fs.mkdirSync(outputDirPath, { recursive: true });

    // Write chunk file
    fs.writeFileSync(outputPath, JSON.stringify(chunkData, null, 2));

    console.log(`  Written: ${chunkKey}.json`);
  }

  console.log('\nExtraction complete!');
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node extract.js <source-dir> <output-dir>');
    console.error('Example: node extract.js /Users/jtraglia/files/tests ./data/tests');
    process.exit(1);
  }

  const sourceDir = path.resolve(args[0]);
  const outputDir = path.resolve(args[1]);

  if (!fs.existsSync(sourceDir)) {
    console.error(`Error: Source directory does not exist: ${sourceDir}`);
    process.exit(1);
  }

  console.log('Ethereum Consensus Spec Test Extractor');
  console.log('======================================\n');
  console.log(`Source: ${sourceDir}`);
  console.log(`Output: ${outputDir}\n`);

  // Find all test files
  console.log('Finding test files...');
  const testFiles = findTestFiles(sourceDir);
  console.log(`Found ${testFiles.length} test files\n`);

  // Build manifest
  console.log('Building manifest...');
  const manifest = buildManifest(testFiles, sourceDir);

  // Write manifest
  const manifestPath = path.join(path.dirname(outputDir), 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to: ${manifestPath}\n`);

  // Process and write test chunks
  processTests(testFiles, sourceDir, outputDir);

  console.log('\n✓ All done!');
}

main();
