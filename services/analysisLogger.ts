import { AnalysisLog } from "../types";

export const createLog = (model: string, botTitle: string): AnalysisLog => {
    return {
        runId: Math.random().toString(36).substring(2, 9).toUpperCase(),
        startTime: new Date().toISOString(),
        model,
        botTitle,
        csvTotalRows: 0,
        csvAfterFilter: 0,
        csvFilteredOut: 0,
        filterStatuses: [],
        totalClustersGenerated: 0,
        topClustersSelected: 0,
        clustersDropped: 0,
        clusterDetails: [],
        batchSummary: [],
        topicAssignmentsReturned: 0,
        topicAssignmentsMapped: 0,
        topicAssignmentsUnmatched: 0,
        bucket0Count: 0,
        bucket1Count: 0,
        bucket2Count: 0,
        bucket3Count: 0,
        recommendationsGenerated: 0,
        rowsAccountedFor: 0,
        dataLossRows: 0,
        dataLossTopics: [],
        errors: []
    };
};

export const finaliseLog = (log: AnalysisLog): AnalysisLog => {
    log.endTime = new Date().toISOString();

    // Basic sanity calculation for data loss
    // (In a real scenario, this would be updated throughout the batch process)
    log.dataLossRows = Math.max(0, log.csvAfterFilter - log.rowsAccountedFor);

    return log;
};

/** Fixed localStorage key — always overwritten, never accumulates new files */
export const ANALYSIS_LOG_STORAGE_KEY = 'bot_analysis_log';

/**
 * Serialises the log to a Markdown string.
 * Does NOT trigger any download — call downloadLogAsMarkdown() for that.
 */
export const buildLogMarkdown = (log: AnalysisLog): string => {
    if (!log) return '';

    const sections = [
        {
            title: "1. Run Info",
            headers: ["Run ID", "Bot Title", "Model", "Start Time", "End Time", "Duration"],
            rows: [[
                log.runId,
                log.botTitle,
                log.model,
                log.startTime,
                log.endTime || "N/A",
                log.endTime ? `${(new Date(log.endTime).getTime() - new Date(log.startTime).getTime()) / 1000}s` : "N/A"
            ]]
        },
        {
            title: "2. CSV Input",
            headers: ["Total Rows", "After Filter", "Filtered Out", "Applied Filters"],
            rows: [[
                log.csvTotalRows,
                log.csvAfterFilter,
                log.csvFilteredOut,
                log.filterStatuses.join(", ") || "None"
            ]]
        },
        {
            title: "3. Clustering",
            headers: ["Total Clusters", "Top 50 Selected (by conversation count)", "Dropped"],
            rows: [[
                log.totalClustersGenerated,
                log.topClustersSelected,
                log.clustersDropped
            ]]
        },
        {
            title: "Clustering Detail",
            headers: ["Rank", "Topic", "Total Conversations", "Failure Rate", "Negative Rate", "Sent to AI", "Batch #"],
            rows: log.clusterDetails.map(c => [
                c.rank,
                c.topic,
                c.total,
                `${(c.failure_rate * 100).toFixed(1)}%`,
                `${(c.negative_rate * 100).toFixed(1)}%`,
                c.sentToAI ? "YES" : "NO",
                c.batchNumber ?? "--"
            ])
        },
        {
            title: "4. Batch Processing",
            headers: ["Batch Name", "Input Size", "Token Est.", "Duration", "Success", "Error"],
            rows: log.batchSummary.map(b => [
                b.batchName,
                b.inputSize,
                b.tokenEstimate,
                `${(b.durationMs / 1000).toFixed(2)}s`,
                b.success ? "✅" : "❌",
                b.errorMessage || "--"
            ])
        },
        {
            title: "5. LLM Output",
            headers: ["Topics Returned", "Mapped Successfully", "Unmatched Topics", "Recommendations"],
            rows: [[
                log.topicAssignmentsReturned,
                log.topicAssignmentsMapped,
                log.topicAssignmentsUnmatched,
                log.recommendationsGenerated
            ]]
        },
        {
            title: "6. Bucket Distribution",
            headers: ["Bucket 0 (Resolved)", "Bucket 1 (Expansion)", "Bucket 2 (Optimization)", "Bucket 3 (Info Gaps)"],
            rows: [[
                log.bucket0Count,
                log.bucket1Count,
                log.bucket2Count,
                log.bucket3Count
            ]]
        },
        {
            title: "7. Data Loss Summary",
            headers: ["Accounted For", "Missing Rows", "Missing Topics"],
            rows: [[
                log.rowsAccountedFor,
                log.dataLossRows,
                log.dataLossTopics.length > 0 ? log.dataLossTopics.join(", ") : "None"
            ]]
        }
    ];

    let md = `# Analysis Log - ${log.botTitle}\n\n`;

    sections.forEach(s => {
        md += `## ${s.title}\n\n`;
        md += `| ${s.headers.join(" | ")} |\n`;
        md += `| ${s.headers.map(() => "---").join(" | ")} |\n`;
        s.rows.forEach(r => {
            md += `| ${r.join(" | ")} |\n`;
        });
        md += `\n`;
    });

    if (log.errors.length > 0) {
        md += `## System Errors\n\n`;
        log.errors.forEach(e => {
            md += `- ${e}\n`;
        });
    }

    return md;
};

/**
 * Persists the log markdown to localStorage under a fixed key so each
 * execution overwrites the previous one — no new files accumulate.
 */
export const saveLogToStorage = (log: AnalysisLog): void => {
    if (!log) return;
    const md = buildLogMarkdown(log);
    try {
        localStorage.setItem(ANALYSIS_LOG_STORAGE_KEY, md);
    } catch (e) {
        console.warn('Could not save analysis log to localStorage:', e);
    }
};

/**
 * Reads the stored log markdown from localStorage.
 * Returns null if nothing has been stored yet.
 */
export const loadLogFromStorage = (): string | null => {
    try {
        return localStorage.getItem(ANALYSIS_LOG_STORAGE_KEY);
    } catch (e) {
        return null;
    }
};

/**
 * Triggers a one-off browser download of the current stored log as
 * `analysis_log.md` (fixed filename — always overwrites the previous copy
 * in the user's Downloads folder when the browser is set to auto-accept).
 * Only called when the user explicitly clicks "Download Log".
 */
export const downloadLogAsMarkdown = (log: AnalysisLog): void => {
    if (!log) return;
    const md = buildLogMarkdown(log);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Fixed filename — no runId suffix so the file overwrites itself in Downloads
    a.download = 'analysis_log.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

/** @deprecated Use saveLogToStorage + downloadLogAsMarkdown instead */
export const exportLogAsMarkdown = saveLogToStorage;
