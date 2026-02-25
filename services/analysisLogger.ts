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
        validationResults: [],
        errors: []
    };
};

const HISTORY_KEY = 'bot_analysis_history';

export const saveToHistory = (log: AnalysisLog) => {
    try {
        const historyJson = localStorage.getItem(HISTORY_KEY);
        const history = historyJson ? JSON.parse(historyJson) : [];

        // Store a condensed version of the log for history
        const historicalEntry = {
            runId: log.runId,
            endTime: log.endTime,
            botTitle: log.botTitle,
            totalRows: log.csvAfterFilter,
            bucketDistribution: {
                b0: log.bucket0Count,
                b1: log.bucket1Count,
                b2: log.bucket2Count,
                b3: log.bucket3Count
            },
            recommendations: log.recommendationsGenerated
        };

        history.push(historicalEntry);
        // Keep last 50 runs
        if (history.length > 50) history.shift();

        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.error('Failed to save to historical tracking:', e);
    }
};

export const finaliseLog = (log: AnalysisLog): AnalysisLog => {
    log.endTime = new Date().toISOString();

    // Basic sanity calculation for data loss
    log.dataLossRows = Math.max(0, log.csvAfterFilter - log.rowsAccountedFor);

    // Persist to localStorage for historical comparison
    if (typeof localStorage !== 'undefined') {
        saveToHistory(log);
    }

    return log;
};

export const exportLogAsMarkdown = (log: AnalysisLog) => {
    if (!log) return;

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
            headers: ["Total Clusters", "Top Selected", "Dropped"],
            rows: [[
                log.totalClustersGenerated,
                log.topClustersSelected,
                log.clustersDropped
            ]]
        },
        {
            title: "Clustering Detail",
            headers: ["Rank", "Topic", "Total Rows", "Failure Rate", "Negative Rate", "Sent to AI"],
            rows: log.clusterDetails.map(c => [
                c.rank,
                c.topic,
                c.total,
                `${(c.failure_rate * 100).toFixed(1)}%`,
                `${(c.negative_rate * 100).toFixed(1)}%`,
                c.sentToAI ? "YES" : "NO"
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
        },
        {
            title: "8. Validation Results",
            headers: ["Type", "Status", "Message", "Details"],
            rows: (log.validationResults || []).map(v => [
                v.type,
                v.status === 'Pass' ? '✅ Pass' : (v.status === 'Fail' ? '❌ Fail' : '⚠️ Warning'),
                v.message,
                v.details || "--"
            ])

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

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analysis_log_${log.runId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
