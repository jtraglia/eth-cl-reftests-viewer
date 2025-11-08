#!/usr/bin/env python3
"""
Check for SSZ files without companion YAML files

Usage:
    python check_missing_yamls.py <version> [output-dir]

Example:
    python check_missing_yamls.py v1.6.0
    python check_missing_yamls.py v1.6.0 ./data
"""

import os
import sys
from pathlib import Path
from collections import defaultdict

def check_missing_yamls(tests_dir):
    """Check for SSZ files without companion YAML files"""

    missing_by_test_type = defaultdict(int)
    missing_files = []
    total_ssz = 0
    total_yaml = 0
    missing_count = 0

    for preset in ['minimal', 'mainnet']:
        preset_path = tests_dir / preset
        if not preset_path.exists():
            continue

        for root, dirs, files in os.walk(preset_path):
            for file in files:
                if file.endswith('.ssz_snappy') and not file.endswith('.ssz_snappy.yaml'):
                    total_ssz += 1
                    ssz_file = Path(root) / file
                    yaml_file = Path(root) / (file + '.yaml')

                    if yaml_file.exists():
                        total_yaml += 1
                    else:
                        missing_count += 1
                        # Extract test type from path
                        rel_path = ssz_file.relative_to(tests_dir)
                        parts = rel_path.parts

                        if len(parts) >= 4:
                            test_key = f"{parts[0]}/{parts[1]}/{parts[2]}/{parts[3]}"
                            missing_by_test_type[test_key] += 1
                            missing_files.append(str(rel_path))

    return {
        'total_ssz': total_ssz,
        'total_yaml': total_yaml,
        'missing_count': missing_count,
        'missing_by_test_type': missing_by_test_type,
        'missing_files': missing_files
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python check_missing_yamls.py <version> [output-dir]")
        print()
        print("Example:")
        print("  python check_missing_yamls.py v1.6.0")
        print("  python check_missing_yamls.py v1.6.0 ./data")
        sys.exit(1)

    version = sys.argv[1]
    data_dir = Path(sys.argv[2] if len(sys.argv) > 2 else './data').resolve()

    tests_dir = data_dir / version / 'tests'

    if not tests_dir.exists():
        print(f"Error: Tests directory does not exist: {tests_dir}", file=sys.stderr)
        print("Please run prepare.js first to download test data.", file=sys.stderr)
        sys.exit(1)

    print(f"Checking for missing YAML companions in: {tests_dir}")
    print()

    results = check_missing_yamls(tests_dir)

    print(f"Total SSZ files: {results['total_ssz']}")
    print(f"SSZ files with YAML companions: {results['total_yaml']}")
    print(f"SSZ files WITHOUT YAML companions: {results['missing_count']}")
    print()

    if results['missing_count'] > 0:
        print("Missing YAML files by test type:")
        print("=" * 80)

        # Sort by count descending
        for test_key, count in sorted(results['missing_by_test_type'].items(), key=lambda x: -x[1]):
            print(f"{test_key:70s} {count:6d} files")

        print()
        print(f"Total: {results['missing_count']} files missing YAML companions")
        print()

        # Output individual file paths
        print("Individual files missing YAML companions:")
        print("=" * 80)
        for file_path in sorted(results['missing_files']):
            print(f"{tests_dir}/{file_path}")

        print()
        print("Run deserialize_missing.js to generate missing YAML files:")
        print(f"  node scripts/deserialize_missing.js {version}")
    else:
        print("✓ All SSZ files have companion YAML files!")


if __name__ == "__main__":
    main()
