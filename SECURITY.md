# Security Policy

## Supported Versions

This project is currently maintained on the `main` branch. Please report security issues against the latest commit on `main`.

## Reporting a Vulnerability

- Do not open public issues for suspected vulnerabilities.
- Send details privately to the maintainer through GitHub security reporting or private contact channels.
- Include:
  - impact and affected files
  - reproduction steps
  - suggested fix if available

We will acknowledge reports as soon as possible and coordinate disclosure after a fix is ready.

## Data Safety for Open Source Usage

Before sharing this repository publicly, ensure:

- `knowledge/Daily/` content is not committed.
- `.memory/sessions/*.json` and `.memory/events.jsonl` are not committed.
- No secrets are stored in `configs/secrets.yaml`, `.env*`, or markdown notes.
- Any shared examples are sanitized and contain no personal or customer data.
