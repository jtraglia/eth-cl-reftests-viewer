#!/usr/bin/env node

/**
 * Deserialize missing SSZ companion YAML files
 *
 * Usage: node deserialize_missing.js <version> [output-dir]
 * Example: node deserialize_missing.js v1.6.0
 * Example: node deserialize_missing.js v1.6.0 ./data
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

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
      } else if (entry.name.endsWith('.ssz_snappy') && !entry.name.endsWith('.ssz_snappy.yaml')) {
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
 * Deserialize missing SSZ files to YAML using Python script (with parallel processing)
 */
async function deserializeMissingSSZFiles(testsDir) {
  console.log('Finding SSZ files without YAML companions...');

  const scriptPath = path.join(__dirname, 'deserialize_ssz.py');
  const consensusSpecsPath = path.resolve(__dirname, '../consensus-specs');

  // Find all .ssz_snappy files
  const allSszFiles = findSSZFiles(testsDir);
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
  console.log(`Processing ${filesToProcess.length} missing files in parallel...\n`);

  if (filesToProcess.length === 0) {
    console.log('✓ No missing YAML files to process!');
    return;
  }

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

    // Process batch in parallel
    const promises = batch.map(({ sszFile, yamlFile }) =>
      deserializeSingleFile(sszFile, yamlFile, scriptPath, consensusSpecsPath)
    );

    const results = await Promise.all(promises);

    // Count results and show errors immediately
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'success') {
        successCount++;
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
    if ((batchIdx + 1) % 100 === 0 || batchIdx === totalBatches - 1) {
      const processed = end;
      const percent = Math.round((processed / filesToProcess.length) * 100);
      console.log(`  Progress: ${processed}/${filesToProcess.length} (${percent}%) - ${successCount} success, ${skippedCount} skipped, ${errorCount} errors`);
    }
  }

  console.log(`\nDeserialization complete: ${successCount} success, ${skippedCount} skipped, ${errorCount} errors`);
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node deserialize_missing.js <version> [output-dir]');
    console.error('Example: node deserialize_missing.js v1.6.0');
    console.error('Example: node deserialize_missing.js v1.6.0 ./data');
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

  if (!fs.existsSync(testsDir)) {
    console.error(`Error: Tests directory does not exist: ${testsDir}`);
    console.error('Please run prepare.js first to download test data.');
    process.exit(1);
  }

  console.log('Ethereum Consensus Layer Reference Tests');
  console.log('Deserialize Missing YAML Files');
  console.log('=========================================\n');
  console.log(`Version: ${version}`);
  console.log(`Data directory: ${dataDir}\n`);

  try {
    // Deserialize missing SSZ files to YAML
    await deserializeMissingSSZFiles(testsDir);

    console.log('\n✓ All done!');
  } catch (error) {
    console.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
