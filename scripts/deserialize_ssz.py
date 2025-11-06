#!/usr/bin/env python3
"""
Deserialize SSZ files to human-readable format (JSON/YAML)

Usage:
    python deserialize_ssz.py <ssz_file_path> [output_path]

Example:
    python deserialize_ssz.py data/v1.6.0/tests/tests/mainnet/gloas/ssz_static/IndexedPayloadAttestation/ssz_random/case_0/serialized.ssz_snappy
"""

import sys
import importlib
from pathlib import Path

# Import the debug tools from consensus-specs
from eth2spec.debug.tools import get_ssz_object_from_ssz_encoded, output_ssz_to_file


def parse_ssz_path(file_path: Path):
    """
    Parse an SSZ file path to extract preset, fork, test_type, test_suite and derive type name.

    Expected path format:
    .../tests/tests/{preset}/{fork}/{test_type}/{test_suite}/.../{file}.ssz_snappy

    For ssz_static tests:
    .../tests/tests/{preset}/{fork}/ssz_static/{type_name}/...

    For other tests (operations, epoch_processing, etc.):
    .../tests/tests/{preset}/{fork}/{test_type}/{test_suite}/...
    The type is derived from the test_suite name (usually by capitalizing it)

    Returns:
        tuple: (preset, fork, type_name, filename)
    """
    parts = file_path.parts

    # Find the 'tests' directory index - look for "tests/tests" pattern
    tests_idx = -1
    for i in range(len(parts) - 1):
        if parts[i] == 'tests' and parts[i + 1] == 'tests':
            tests_idx = i + 1  # Point to the second 'tests'
            break

    if tests_idx == -1:
        raise ValueError(f"Path must contain 'tests/tests' directories: {file_path}")

    # After the second 'tests', we expect: {preset}/{fork}/{test_type}/{test_suite}/...
    if len(parts) < tests_idx + 5:
        raise ValueError(f"Path too short, expected format: tests/tests/{{preset}}/{{fork}}/{{test_type}}/{{test_suite}}/...: {file_path}")

    preset = parts[tests_idx + 1]    # e.g., 'mainnet', 'minimal', 'general'
    fork = parts[tests_idx + 2]      # e.g., 'phase0', 'altair', 'bellatrix', 'capella', 'deneb', 'eip7805'
    test_type = parts[tests_idx + 3] # e.g., 'ssz_static', 'operations', 'epoch_processing'
    test_suite = parts[tests_idx + 4] # e.g., 'attestation', 'BeaconState', 'justification_and_finalization'

    # Get the filename to determine which SSZ object we're looking for
    filename = file_path.name  # e.g., 'serialized.ssz_snappy', 'pre.ssz_snappy', 'post.ssz_snappy'

    # Determine type name based on test type
    if test_type == 'ssz_static':
        # For ssz_static, test_suite IS the type name
        type_name = test_suite
    else:
        # For other test types, derive the type name from test_suite
        # Common mappings based on test format specifications
        type_name = derive_type_from_suite(test_type, test_suite, filename)

    return preset, fork, type_name, filename


def derive_type_from_suite(test_type: str, test_suite: str, filename: str) -> str:
    """
    Derive the SSZ type name from test_type and test_suite.

    Uses test format specifications to map test suites to SSZ types.

    Args:
        test_type: The test type (e.g., 'operations', 'epoch_processing')
        test_suite: The test suite name (e.g., 'attestation', 'justification_and_finalization')
        filename: The SSZ filename (e.g., 'pre.ssz_snappy', 'post.ssz_snappy') - reserved for future use
    """
    # Note: filename parameter is reserved for future use to distinguish between
    # different SSZ files in the same test (e.g., pre vs post state)
    # For operations tests, the test_suite is usually the operation name
    # and maps directly to the SSZ type (with proper capitalization)
    if test_type == 'operations':
        # Common operations: attestation, attester_slashing, block_header, deposit,
        # proposer_slashing, voluntary_exit, etc.
        # These map to: Attestation, AttesterSlashing, BeaconBlock, Deposit, etc.
        type_map = {
            'attestation': 'Attestation',
            'attester_slashing': 'AttesterSlashing',
            'block_header': 'BeaconBlock',  # Uses full BeaconBlock
            'deposit': 'Deposit',
            'proposer_slashing': 'ProposerSlashing',
            'voluntary_exit': 'SignedVoluntaryExit',
            'sync_aggregate': 'SyncAggregate',
            'execution_payload': 'ExecutionPayload',
            'withdrawals': 'ExecutionPayload',
            'bls_to_execution_change': 'SignedBLSToExecutionChange',
        }
        if test_suite in type_map:
            return type_map[test_suite]

    # For epoch_processing tests, need to determine type from filename
    if test_type == 'epoch_processing':
        # These tests have pre.ssz_snappy (BeaconState) and post.ssz_snappy (BeaconState)
        return 'BeaconState'

    # For sanity tests
    if test_type == 'sanity':
        if test_suite in ['blocks', 'slots']:
            return 'BeaconState'

    # For fork tests
    if test_type == 'fork':
        return 'BeaconState'

    # For transition tests
    if test_type == 'transition':
        return 'BeaconState'

    # For finality tests
    if test_type == 'finality':
        return 'BeaconState'

    # For random tests
    if test_type == 'random':
        return 'BeaconState'

    # Default: try capitalizing the test_suite name
    # Convert snake_case to PascalCase
    words = test_suite.split('_')
    return ''.join(word.capitalize() for word in words)


def get_ssz_type_class(preset: str, fork: str, type_name: str):
    """
    Dynamically import and return the SSZ type class.

    Args:
        preset: 'mainnet', 'minimal', or 'general'
        fork: 'phase0', 'altair', 'bellatrix', 'capella', 'deneb', 'gloas', etc.
        type_name: The SSZ type name, e.g., 'BeaconState', 'IndexedPayloadAttestation'

    Returns:
        The SSZ type class
    """
    # Handle 'general' preset - it uses mainnet types
    if preset == 'general':
        preset = 'mainnet'

    # Build the module path: eth2spec.{fork}.{preset}
    module_path = f"eth2spec.{fork}.{preset}"

    try:
        module = importlib.import_module(module_path)
    except ImportError as e:
        raise ImportError(f"Failed to import module {module_path}: {e}")

    # Get the type class from the module
    if not hasattr(module, type_name):
        raise AttributeError(f"Module {module_path} does not have type '{type_name}'")

    return getattr(module, type_name)


def deserialize_ssz_file(input_path: Path, output_path: Path = None):
    """
    Deserialize an SSZ file and optionally save to output file.

    Args:
        input_path: Path to the .ssz or .ssz_snappy file
        output_path: Optional path to save the output (YAML or JSON based on extension)

    Returns:
        The deserialized SSZ object
    """
    # Parse the path to get preset, fork, type name, and filename
    preset, fork, type_name, filename = parse_ssz_path(input_path)

    print(f"Detected configuration:")
    print(f"  Preset: {preset}")
    print(f"  Fork: {fork}")
    print(f"  Type: {type_name}")
    print(f"  File: {filename}")
    print()

    # Get the SSZ type class
    ssz_type_class = get_ssz_type_class(preset, fork, type_name)
    print(f"Loaded type: {ssz_type_class}")
    print()

    # Deserialize the SSZ file
    print(f"Deserializing: {input_path}")
    ssz_obj = get_ssz_object_from_ssz_encoded(input_path, ssz_type_class)
    print("Deserialization successful!")
    print()

    # Output to file if requested
    if output_path:
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_ssz_to_file(output_path, ssz_obj)
        print(f"Exported to: {output_path}")
    else:
        # Print to console
        print("Deserialized object:")
        print(ssz_obj)

    return ssz_obj


def main():
    if len(sys.argv) < 2:
        print("Usage: python deserialize_ssz.py <ssz_file_path> [output_path]")
        print()
        print("Example:")
        print("  python deserialize_ssz.py data/v1.6.0/tests/tests/mainnet/gloas/ssz_static/IndexedPayloadAttestation/ssz_random/case_0/serialized.ssz_snappy")
        print("  python deserialize_ssz.py input.ssz_snappy output.yaml")
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None

    if not input_path.exists():
        print(f"Error: Input file does not exist: {input_path}", file=sys.stderr)
        sys.exit(1)

    try:
        deserialize_ssz_file(input_path, output_path)
    except (ValueError, AttributeError, ImportError) as e:
        # These are expected errors for tests that can't be deserialized
        # (e.g., ssz_generic tests, tests with unknown types, etc.)
        # Exit with code 2 to indicate "skip this file"
        sys.exit(2)
    except Exception as e:
        # Unexpected errors
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
