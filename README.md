# Ethereum Consensus Layer Reference Tests

A web-based viewer for browsing Ethereum consensus layer reference tests.

## Adding a New Version

Download and prepare a new test release:

```bash
./download.sh v1.6.0
```

This will:
- Download test archives from the [consensus-specs releases](https://github.com/ethereum/consensus-specs/releases)
- Extract and organize files into `data/v1.6.0/tests/`
- Generate `data/v1.6.0/manifest.json`
- Update `data/versions.json`

## Local Testing

Run a local server:

```bash
npm run serve
```

Then open http://localhost:8080

## Docker Deployment

Build and run with Docker:

```bash
docker compose up -d
```

Access at http://localhost:8080

To stop:

```bash
docker compose down
```
