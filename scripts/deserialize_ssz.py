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
import re
import yaml
from pathlib import Path

# Import the debug tools from consensus-specs
from eth2spec.debug.tools import get_ssz_object_from_ssz_encoded, output_ssz_to_file

# Import SSZ types for defining Deltas
from remerkleable.complex import Container, List
from remerkleable.basic import uint64

# Import VALIDATOR_REGISTRY_LIMIT constant from specs
from eth2spec.phase0.mainnet import VALIDATOR_REGISTRY_LIMIT

# Define Deltas type for rewards tests (as specified in tests/formats/rewards/README.md)
class Deltas(Container):
    rewards: List[uint64, VALIDATOR_REGISTRY_LIMIT]
    penalties: List[uint64, VALIDATOR_REGISTRY_LIMIT]


def load_previous_fork_mapping():
    """
    Parse PREVIOUS_FORK_OF from constants.py to get fork transition mapping.
    Returns a dict mapping fork -> previous_fork (e.g., 'altair' -> 'phase0')
    """
    constants_path = Path(__file__).parent.parent / 'consensus-specs' / 'tests' / 'core' / 'pyspec' / 'eth2spec' / 'test' / 'helpers' / 'constants.py'

    if not constants_path.exists():
        # Return empty dict if file doesn't exist - will use current fork
        return {}

    content = constants_path.read_text()

    # Parse PREVIOUS_FORK_OF dictionary
    previous_fork_of = {}

    # Find the PREVIOUS_FORK_OF dictionary in the file
    match = re.search(r'PREVIOUS_FORK_OF\s*=\s*\{([^}]+)\}', content, re.DOTALL)
    if match:
        dict_content = match.group(1)
        # Parse lines like: ALTAIR: PHASE0,
        for line in dict_content.split('\n'):
            line = line.strip()
            if ':' in line and not line.startswith('#'):
                parts = line.split(':')
                if len(parts) == 2:
                    key = parts[0].strip()
                    value = parts[1].strip().rstrip(',')
                    if value and value != 'None':
                        # Convert to lowercase (e.g., ALTAIR -> altair)
                        previous_fork_of[key.lower()] = value.lower()

    return previous_fork_of


# Load fork mapping at module level
PREVIOUS_FORK_OF = load_previous_fork_mapping()


def parse_ssz_path(file_path: Path):
    """
    Parse an SSZ file path to extract preset, fork, test_type, test_suite and derive type name.

    Expected path format:
    .../tests/{preset}/{fork}/{test_type}/{test_suite}/.../{file}.ssz_snappy

    For ssz_static tests:
    .../tests/{preset}/{fork}/ssz_static/{type_name}/...

    For other tests (operations, epoch_processing, etc.):
    .../tests/{preset}/{fork}/{test_type}/{test_suite}/...
    The type is derived from the test_suite name (usually by capitalizing it)

    Returns:
        tuple: (preset, fork, type_name, filename)
    """
    parts = file_path.parts

    # Find the 'tests' directory index
    tests_idx = -1
    for i in range(len(parts)):
        if parts[i] == 'tests':
            tests_idx = i
            break

    if tests_idx == -1:
        raise ValueError(f"Path must contain 'tests' directory: {file_path}")

    # After 'tests', we expect: {preset}/{fork}/{test_type}/{test_suite}/...
    if len(parts) < tests_idx + 5:
        raise ValueError(f"Path too short, expected format: tests/{{preset}}/{{fork}}/{{test_type}}/{{test_suite}}/...: {file_path}")

    preset = parts[tests_idx + 1]    # e.g., 'mainnet', 'minimal', 'general'
    fork = parts[tests_idx + 2]      # e.g., 'phase0', 'altair', 'bellatrix', 'capella', 'deneb', 'eip7805'
    test_type = parts[tests_idx + 3] # e.g., 'ssz_static', 'operations', 'epoch_processing'
    test_suite = parts[tests_idx + 4] # e.g., 'attestation', 'BeaconState', 'justification_and_finalization'

    # Get the filename to determine which SSZ object we're looking for
    filename = file_path.name  # e.g., 'serialized.ssz_snappy', 'pre.ssz_snappy', 'post.ssz_snappy'

    # For fork tests with pre.ssz_snappy, use the previous fork
    actual_fork = fork
    if test_type == 'fork' and filename == 'pre.ssz_snappy':
        if fork in PREVIOUS_FORK_OF:
            actual_fork = PREVIOUS_FORK_OF[fork]
            print(f"Fork test detected: using previous fork '{actual_fork}' for pre.ssz_snappy (current fork: '{fork}')")
        else:
            print(f"Warning: No previous fork found for '{fork}', using current fork")

    # For transition tests with pre.ssz_snappy, use the pre-fork
    if test_type == 'transition' and filename == 'pre.ssz_snappy':
        # Read meta.yaml to get post_fork
        meta_path = file_path.parent / 'meta.yaml'
        if meta_path.exists():
            with open(meta_path, 'r') as f:
                meta = yaml.safe_load(f)
                post_fork = meta.get('post_fork', fork).lower()

                # Use previous fork of post_fork
                if post_fork in PREVIOUS_FORK_OF:
                    actual_fork = PREVIOUS_FORK_OF[post_fork]
                    print(f"Transition test: using pre-fork '{actual_fork}' for pre.ssz_snappy (post_fork: '{post_fork}')")
                else:
                    print(f"Warning: No previous fork found for post_fork '{post_fork}', using current fork")
        else:
            print(f"Warning: meta.yaml not found at {meta_path}, using current fork '{fork}'")

    # For transition tests with blocks_*.ssz_snappy, determine fork from meta.yaml
    if test_type == 'transition' and filename.startswith('blocks_'):
        # Parse block index from filename (e.g., blocks_0.ssz_snappy -> 0)
        try:
            block_index = int(filename.split('_')[1].split('.')[0])

            # Read meta.yaml to get fork_block and post_fork
            meta_path = file_path.parent / 'meta.yaml'
            if meta_path.exists():
                with open(meta_path, 'r') as f:
                    meta = yaml.safe_load(f)
                    post_fork = meta.get('post_fork', fork).lower()
                    fork_block = meta.get('fork_block')

                    if fork_block is not None:
                        if block_index <= fork_block:
                            # Use pre-fork (previous fork of post_fork)
                            if post_fork in PREVIOUS_FORK_OF:
                                actual_fork = PREVIOUS_FORK_OF[post_fork]
                                print(f"Transition test: block {block_index} <= fork_block {fork_block}, using pre-fork '{actual_fork}'")
                            else:
                                print(f"Warning: No previous fork found for post_fork '{post_fork}'")
                        else:
                            # Use post-fork
                            actual_fork = post_fork
                            print(f"Transition test: block {block_index} > fork_block {fork_block}, using post-fork '{actual_fork}'")
                    else:
                        print(f"Warning: fork_block not found in meta.yaml, using current fork '{fork}'")
            else:
                print(f"Warning: meta.yaml not found at {meta_path}, using current fork '{fork}'")
        except (ValueError, IndexError) as e:
            print(f"Warning: Could not parse block index from filename '{filename}': {e}")

    # Determine type name based on test type
    if test_type == 'ssz_static':
        # For ssz_static, test_suite IS the type name
        type_name = test_suite
    elif test_type in ['light_client', 'merkle_proof'] and test_suite == 'single_merkle_proof' and filename == 'object.ssz_snappy':
        # For light_client/single_merkle_proof and merkle_proof/single_merkle_proof:
        # Path format: .../light_client/single_merkle_proof/{TypeName}/test_name/object.ssz_snappy
        # The TypeName is at parts[tests_idx + 5]
        if len(parts) > tests_idx + 5:
            type_name = parts[tests_idx + 5]
        else:
            raise ValueError(f"Path too short for light_client/merkle_proof single_merkle_proof test: {file_path}")
    else:
        # For other test types, derive the type name from test_suite
        # Common mappings based on test format specifications
        type_name = derive_type_from_suite(test_type, test_suite, filename)

    return preset, actual_fork, type_name, filename


def derive_type_from_suite(test_type: str, test_suite: str, filename: str) -> str:
    """
    Derive the SSZ type name from test_type and test_suite.

    Uses test format specifications to map test suites to SSZ types.

    Args:
        test_type: The test type (e.g., 'operations', 'epoch_processing')
        test_suite: The test suite name (e.g., 'attestation', 'justification_and_finalization')
        filename: The SSZ filename (e.g., 'pre.ssz_snappy', 'post.ssz_snappy', 'blocks_0.ssz_snappy')
    """
    # pre/post state files are always BeaconState
    if filename in ['pre.ssz_snappy', 'post.ssz_snappy', 'pre_epoch.ssz_snappy', 'post_epoch.ssz_snappy']:
        return 'BeaconState'

    # body.ssz_snappy is always BeaconBlockBody
    if filename == 'body.ssz_snappy':
        return 'BeaconBlockBody'

    # signed_envelope.ssz_snappy is always SignedExecutionPayloadEnvelope
    if filename == 'signed_envelope.ssz_snappy':
        return 'SignedExecutionPayloadEnvelope'

    # Fork choice tests (also used by sync tests)
    if test_type in ['fork_choice', 'sync']:
        if filename == 'anchor_state.ssz_snappy':
            return 'BeaconState'
        if filename == 'anchor_block.ssz_snappy':
            return 'BeaconBlock'  # Unsigned
        if filename.startswith('block_'):
            return 'SignedBeaconBlock'
        if filename.startswith('attestation_'):
            return 'Attestation'
        if filename.startswith('attester_slashing_'):
            return 'AttesterSlashing'
        if filename.startswith('pow_block_'):
            return 'PowBlock'

    # Light client and merkle proof tests with object.ssz_snappy
    if test_type in ['light_client', 'merkle_proof']:
        if test_suite == 'single_merkle_proof' and filename == 'object.ssz_snappy':
            # Type is determined from the parent directory name
            # Path format: .../single_merkle_proof/{TypeName}/test_name/object.ssz_snappy
            # The test_suite in parse_ssz_path is actually the next level, which should be the type
            # But we need to extract it differently - this will be handled in parse_ssz_path
            pass  # Will be handled specially in parse_ssz_path

    # Rewards tests - deltas files
    if test_type == 'rewards':
        if filename.endswith('_deltas.ssz_snappy'):
            return 'Deltas'

    # Check filename patterns - these apply across multiple test types
    # In operations/block_header and operations/execution_payload_bid, block.ssz_snappy is BeaconBlock (unsigned)
    if test_type == 'operations' and test_suite in ['block_header', 'execution_payload_bid'] and filename == 'block.ssz_snappy':
        return 'BeaconBlock'

    # In other tests, blocks_* and block.ssz_snappy are SignedBeaconBlock
    if filename.startswith('blocks_') or filename == 'block.ssz_snappy':
        return 'SignedBeaconBlock'

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
    # Special case: Deltas is a test-only type from rewards tests (defined at top of this file)
    if type_name == 'Deltas':
        return Deltas

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
