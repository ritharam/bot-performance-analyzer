
# Application Functionalities: Strategic Bot Performance Analyzer

This document records the current features of the Royal Enfield Bot Analyzer (Stable Strategy Build).

## 1. Multi-Stage Navigation Flow
*   **Setup Stage**: Initial configuration page for syncing Yellow.ai API or uploading JSON/CSV datasets. 
*   **Dashboard Stage**: Interactive analysis workspace featuring tabbed views for strategic pillars and raw audit logs.
*   **Report Stage (Web View)**: A dedicated, high-fidelity long-form web page that aggregates all findings into a clean, management-ready presentation. This replaces the unstable PDF export with a persistent on-screen report.
*   **Non-Destructive Navigation**: Users can move back and forth between results and setup using "Edit Settings" without losing their uploaded context.

## 2. Context Ingestion & Hybrid Configuration
*   **Yellow.ai API Sync**: Direct connection to fetch real-time bot configurations (flows, rules, metadata).
*   **Manual JSON Upload**: Robust file-based ingestion for offline bot journeys. 
*   **Summarization Engine**: Logic-stripping engine that converts nested JSON bot structures into human-readable strategic summaries for AI auditing.

## 3. Analysis Consistency & Performance
*   **Consistency Mode**: Implemented deterministic AI parameters (Seed: 42, Temperature: 0) to ensure identical outputs for repeated runs of the same data.
*   **AI-Driven Strategy Mapping**: Categorizes failures into three business growth pillars:
    *   **Pillar 1: Service Expansion**: Identifying where users need new automated agents or intent flows.
    *   **Pillar 2: System Optimization**: Identifying where existing NLU/Logic flows are broken or misaligned.
    *   **Pillar 3: Information Gaps**: Identifying where Knowledge Base or Dynamic Data updates are required.

## 4. Professional Reporting & Data Exports
*   **Strategic Web Report**: A full-width, clean-layout report view reachable from the dashboard, optimized for strategic reviews and screen sharing.
*   **Executive Metrics**: Automated calculation of alignment scores, strategic priority levels, and suggested KPIs for every identified gap.
*   **Excel Power Export**: Multi-sheet workbook containing the full audit log and prioritized strategic backlog for technical implementation teams.
