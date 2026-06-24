# SpecForge Developer Guide

This guide covers how to run the current MVP frontend pipeline (Stages P1 → P2 → P3).

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   Copy the example env file:
   ```bash
   cp .env.example .env
   ```

## Two Ways to Run the Pipeline

### A) Mock Mode (Recommended for Local Dev)
In this mode, the pipeline bypasses the OpenAI API and returns deterministic mock JSON for the core LLM stages (Extract and Enrich). No API key is needed. It currently supports mocking the default CRM sample prompt.

1. Edit `.env` and set:
   ```
   MOCK_LLM=true
   ```
2. Run the test script:
   ```bash
   npm run dev:test-frontend
   ```

### B) Real Provider Mode
In this mode, the pipeline hits the live OpenAI API.

1. Edit `.env`, set `MOCK_LLM=false` (or remove it), and add your API key:
   ```
   MOCK_LLM=false
   OPENAI_API_KEY=sk-your-openai-api-key-here
   ```
2. Run the test script:
   ```bash
   npm run dev:test-frontend
   ```

## What to expect

1. The script will initialize the LLM client (or Mock client) and parse the sample prompt.
2. It will sequentially run:
   - **P1**: Requirement Extraction
   - **P2**: Enrichment + Assumptions
   - **P3**: IntentIR Construction
3. A summary report will be printed to the console showing extracted requirement counts, assumptions made, conflicts detected, and the normalized IntentIR entity/feature breakdown.

### Inspecting Artifacts

Every pipeline run creates a timestamped folder inside the `artifacts/` directory (e.g., `artifacts/20260623-183012-build-a-crm/`).

Inside this directory, you will find the raw JSON output for each pipeline stage:
- `1-extraction.json`
- `2-enrichment.json`
- `3-intentIR.json`
- `8-result.json` (The overall pipeline wrapper stub)

Inspect these JSON files to verify that the LLM is correctly structuring the extracted domain requirements and that P3 is correctly compiling the `IntentIR`.

### Cleaning Artifacts

If your `artifacts/` folder gets too cluttered during testing, you can wipe it clean:

```bash
npm run clean:artifacts
```
