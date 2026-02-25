import { ConversationRow, AnalysisResult, BucketRecommendation, ModelOption, BatchAnalysisProgress, AnalysisLog } from '../types';
import { buildClusterSummaries, getFailureRows, assignBucketsByTopic } from './clusteringService';
import { createLog, finaliseLog } from './analysisLogger';
import { runAllValidations } from './validationService';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJsonParse<T>(text: string | undefined, defaultValue: T): T {
    if (!text || !text.trim()) return defaultValue;
    try {
        const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned) as T;
    } catch (e) {
        console.error('BatchAnalysis JSON Parse Error:', e);
        return defaultValue;
    }
}

function resolveOpenAIModel(model: ModelOption): string {
    if (model === 'gpt-4.1') return 'gpt-4-turbo';
    if (model === 'gpt-5.2') return 'gpt-4o';
    return model as string;
}

/**
 * Retries an async operation with exponential backoff.
 */
async function withRetry<T>(
    operation: () => Promise<T>,
    retries: number = 3,
    delayMs: number = 1000
): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        if (retries > 0) {
            // Check for 429 (Too Many Requests) or 5xx (Server Errors) to retry
            const status = error.status || error.response?.status;
            const message = error.message || '';
            const shouldRetry = status === 429 || (status >= 500 && status < 600) || message.includes('Rate limit') || message.includes('quota');

            if (shouldRetry) {
                console.warn(`Retrying operation... (${retries} attempts left). Error: ${message}`);
                await new Promise((res) => setTimeout(res, delayMs));
                return withRetry(operation, retries - 1, delayMs * 2);
            }
        }
        throw error;
    }
}

/** Call OpenAI with json_object response format */
async function callOpenAI(prompt: string, model: ModelOption, apiKey: string): Promise<any> {
    return withRetry(async () => {
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: resolveOpenAIModel(model),
                messages: [
                    { role: 'system', content: 'You are a senior Chatbot Performance Strategist.' },
                    { role: 'user', content: prompt },
                ],
                response_format: { type: 'json_object' },
                temperature: 0,
                seed: 42,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            const message = errorData.error?.message || response.statusText;
            const error: any = new Error(`OpenAI API error: ${message}`);
            error.status = response.status;
            throw error;
        }

        const data = await response.json();
        return data.choices[0].message.content;
    });
}

/** Call Gemini via GoogleGenAI SDK */
async function callGemini(prompt: string, apiKey: string): Promise<any> {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    return withRetry(async () => {
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
                config: { responseMimeType: 'application/json', temperature: 0, seed: 42 },
            });
            return response.text;
        } catch (err: any) {
            // Normalize Gemini SDK errors
            const message = err.message || 'Unknown Gemini error';
            const error: any = new Error(`Gemini API error: ${message}`);
            if (message.includes('429') || message.includes('ResourceExhausted')) error.status = 429;
            throw error;
        }
    });
}

async function callAI(prompt: string, model: ModelOption, apiKey: string): Promise<string> {
    if (model === 'gemini-flash') {
        return callGemini(prompt, apiKey);
    }
    return callOpenAI(prompt, model, apiKey);
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildStrategicPrompt(
    top20Clusters: ReturnType<typeof buildClusterSummaries>,
    botSummary: string,
    goals: string,
    csvData: ConversationRow[]
): string {
    return `Act as a senior Chatbot Performance Strategist.

BUSINESS GOALS: "${goals}"

BOT SUMMARY: ${botSummary.slice(0, 5000)}

DATASET: ${csvData.length} total conversations. Below are the top 20 failure topic clusters (sorted by failure rate):
${JSON.stringify(top20Clusters.map(c => ({
        topic: c.topic,
        total: c.total,
        failure_rate: Math.round(c.failure_rate * 100) + '%',
        negative_rate: Math.round(c.negative_rate * 100) + '%',
        unresolved: c.unresolved,
        drop_off: c.user_drop_off,
        sample_queries: c.sample_queries
    })))}

TASK: For each topic cluster, assign it to a bucket and return full recommendations.

Buckets:
- "1" = Service Expansion: no handler exists, new intent/flow needed
- "2" = System Optimization: handler exists but logic is broken or incomplete
- "3" = Information Gaps: handler exists but returns wrong or missing data
- "0" = Resolved: failure_rate below 15% and negative_rate below 10%

Return valid JSON only:
{
  "topic_assignments": [{ "topic": "...", "bucket": "1"|"2"|"3"|"0", "bucket_label": "...", "reason": "..." }],
  "bucket1": [{ "topic": "...", "problemStatement": "...", "recommendation": "...", "rootCause": "...", "goalAlignmentScore": 1-10, "strategicPriority": "Low|Medium|High|Critical", "kpiToWatch": "...", "examples": ["..."] }],
  "bucket2": [...],
  "bucket3": [...]
}`;
}

function buildDetailPrompt(
    failureRows: ReturnType<typeof getFailureRows>,
    csvData: ConversationRow[],
    goals: string
): string {
    return `Act as a senior Chatbot Performance Strategist.

BUSINESS GOALS: "${goals}"

FAILURE CONVERSATIONS: ${failureRows.length} rows sampled from ${csvData.length} total (unresolved, drop-offs, and negative sentiment only):
${JSON.stringify(failureRows.map(({ row, originalIndex }) => ({
        i: originalIndex,
        q: row.USER_QUERY,
        s: row.RESOLUTION_STATUS,
        t: row.TOPIC,
        sentiment: row.USER_SENTIMENT,
        reason: (row.RESOLUTION_STATUS_REASONING || '').slice(0, 80)
    })))}

TASK: Analyse these failure conversations and assign each to a bucket.
Use the exact "i" values as indices in your response — these are original row positions in the full dataset.

Return valid JSON only:
{
  "bucket1": [{ "topic": "...", "indices": [<i values>], "problemStatement": "...", "recommendation": "...", "rootCause": "...", "goalAlignmentScore": 1-10, "strategicPriority": "Low|Medium|High|Critical", "kpiToWatch": "...", "examples": ["..."] }],
  "bucket2": [...],
  "bucket3": [...]
}`;
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

function mergeRecommendations(
    strategic: BucketRecommendation[],
    detail: BucketRecommendation[]
): BucketRecommendation[] {
    const map = new Map<string, BucketRecommendation>();

    for (const rec of [...strategic, ...detail]) {
        const key = (rec.topic || '').toLowerCase().trim();
        const existing = map.get(key);
        if (!existing || (rec.goalAlignmentScore || 0) > (existing.goalAlignmentScore || 0)) {
            map.set(key, rec);
        }
    }

    return Array.from(map.values()).sort(
        (a, b) => (b.goalAlignmentScore || 0) - (a.goalAlignmentScore || 0)
    );
}

function processBucket(
    recs: any[],
    categorizedRows: ConversationRow[],
    bucketId: string,
    label: string
): BucketRecommendation[] {
    (recs || []).forEach((rec) => {
        if (Array.isArray(rec.indices)) {
            rec.indices = rec.indices.filter(
                (idx: number) =>
                    Number.isInteger(idx) && idx >= 0 && idx < categorizedRows.length
            );
            rec.count = rec.indices.length;
            rec.indices.forEach((idx: number) => {
                categorizedRows[idx].BUCKET = bucketId;
                categorizedRows[idx].BUCKET_LABEL = label;
            });
        }
    });
    return (recs || []).sort(
        (a: any, b: any) => (b.goalAlignmentScore || 0) - (a.goalAlignmentScore || 0)
    );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function analyzeWithBatching(
    csvData: ConversationRow[],
    botSummary: string,
    goals: string,
    model: ModelOption,
    apiKey: string,
    botTitle: string,
    onProgress: (progress: BatchAnalysisProgress) => void,
    originalCsvStats?: { total: number; filteredOut: number; filterStatuses: string[] }
): Promise<AnalysisResult> {
    const log = createLog(model, botTitle);
    log.csvTotalRows = originalCsvStats?.total || csvData.length;
    log.csvAfterFilter = csvData.length;
    log.csvFilteredOut = originalCsvStats?.filteredOut || 0;
    log.filterStatuses = originalCsvStats?.filterStatuses || [];

    try {
        // ── Stage 1: Clustering (pure TS, no API) ─────────────────────────────────
        onProgress({
            currentBatch: 0,
            totalBatches: 2,
            stage: 'clustering',
            message: `Building topic clusters from ${csvData.length} rows...`,
        });

        const allClusters = buildClusterSummaries(csvData);
        log.totalClustersGenerated = allClusters.length;
        const top20Clusters = allClusters.slice(0, 20);
        log.topClustersSelected = top20Clusters.length;
        log.clustersDropped = Math.max(0, allClusters.length - 20);

        log.clusterDetails = allClusters.map((c, i) => ({
            rank: i + 1,
            topic: c.topic,
            total: c.total,
            failure_rate: c.failure_rate,
            negative_rate: c.negative_rate,
            sentToAI: i < 20
        }));

        // ── Stage 2: Strategic API call ───────────────────────────────────────────
        onProgress({
            currentBatch: 1,
            totalBatches: 2,
            stage: 'strategic',
            message: 'Mapping improvement areas...',
        });

        const strategicStartTime = Date.now();
        const strategicPrompt = buildStrategicPrompt(top20Clusters, botSummary, goals, csvData);
        let strategicRaw = "";
        let strategicSuccess = false;
        let strategicError = "";

        try {
            strategicRaw = await callAI(strategicPrompt, model, apiKey);
            strategicSuccess = true;
        } catch (e: any) {
            strategicError = e.message || String(e);
            log.errors.push(`Stage 2 (Strategic) API Error: ${strategicError}`);
        }

        log.batchSummary.push({
            batchName: "Stage 2: Strategic Mapping",
            inputSize: top20Clusters.length,
            tokenEstimate: strategicPrompt.length / 4, // Rough estimate
            durationMs: Date.now() - strategicStartTime,
            success: strategicSuccess,
            errorMessage: strategicError || undefined
        });

        const strategicParsed = safeJsonParse<any>(strategicRaw, {
            topic_assignments: [],
            bucket1: [],
            bucket2: [],
            bucket3: [],
        });

        // Build topic → bucket/label maps from AI response
        const topicToBucket: Record<string, string> = {};
        const topicToLabel: Record<string, string> = {};

        const assignments: Array<{ topic: string; bucket: string; bucket_label?: string; label?: string; reason?: string }> =
            strategicParsed.topic_assignments || [];

        log.topicAssignmentsReturned = assignments.length;

        assignments.forEach(({ topic, bucket, bucket_label, label }) => {
            const key = (topic || '').toLowerCase().trim();
            topicToBucket[key] = bucket || '0';
            topicToLabel[key] = bucket_label || label || 'Resolved / Out of Scope';
        });

        // ── Stage 3: Detail API call ──────────────────────────────────────────────
        const failureEntry = getFailureRows(csvData, 150);

        onProgress({
            currentBatch: 2,
            totalBatches: 2,
            stage: 'detail',
            message: 'Preparing smart recommendations...',
        });

        const detailStartTime = Date.now();
        const detailPrompt = buildDetailPrompt(failureEntry, csvData, goals);
        let detailRaw = "";
        let detailSuccess = false;
        let detailError = "";

        try {
            detailRaw = await callAI(detailPrompt, model, apiKey);
            detailSuccess = true;
        } catch (e: any) {
            detailError = e.message || String(e);
            log.errors.push(`Stage 3 (Detail) API Error: ${detailError}`);
        }

        log.batchSummary.push({
            batchName: "Stage 3: Detail Recommendations",
            inputSize: failureEntry.length,
            tokenEstimate: detailPrompt.length / 4,
            durationMs: Date.now() - detailStartTime,
            success: detailSuccess,
            errorMessage: detailError || undefined
        });

        const detailParsed = safeJsonParse<any>(detailRaw, {
            bucket1: [],
            bucket2: [],
            bucket3: [],
        });

        // ── Stage 4: Merging ──────────────────────────────────────────────────────
        onProgress({
            currentBatch: 2,
            totalBatches: 2,
            stage: 'merging',
            message: `Merging results across all ${csvData.length} rows...`,
        });

        // Assign buckets to ALL rows by topic first (from strategic call)
        const categorizedRows: ConversationRow[] = assignBucketsByTopic(
            csvData,
            topicToBucket,
            topicToLabel
        );

        // Count how many were successfully mapped from strategic assignments
        let mappedCount = 0;
        categorizedRows.forEach(r => {
            const key = (r.TOPIC || '').toLowerCase().trim();
            if (topicToBucket[key]) mappedCount++;
        });
        log.topicAssignmentsMapped = mappedCount; // Actually this is rows mapped. 
        // User asked for topicAssignmentsMapped... let's count unique topics in categorizedRows that have a bucket from strategic
        const uniqueTopicsMapped = new Set(
            categorizedRows
                .filter(r => topicToBucket[(r.TOPIC || '').toLowerCase().trim()])
                .map(r => (r.TOPIC || '').toLowerCase().trim())
        ).size;
        log.topicAssignmentsMapped = uniqueTopicsMapped;
        log.topicAssignmentsUnmatched = Math.max(0, log.totalClustersGenerated - uniqueTopicsMapped);

        // Populate data loss topics (any cluster that wasn't assigned a bucket)
        log.dataLossTopics = allClusters
            .filter(c => !topicToBucket[(c.topic || '').toLowerCase().trim()])
            .map(c => c.topic);

        // Apply detail overrides: for rows referenced in detail bucket recs, override BUCKET/BUCKET_LABEL
        const strategicBucket1 = processBucket(strategicParsed.bucket1, categorizedRows, '1', 'Service Expansion (New Agent)');
        const strategicBucket2 = processBucket(strategicParsed.bucket2, categorizedRows, '2', 'System Optimization (Logic Update)');
        const strategicBucket3 = processBucket(strategicParsed.bucket3, categorizedRows, '3', 'Information Gaps (KB Update)');

        const detailBucket1 = processBucket(detailParsed.bucket1, categorizedRows, '1', 'Service Expansion (New Agent)');
        const detailBucket2 = processBucket(detailParsed.bucket2, categorizedRows, '2', 'System Optimization (Logic Update)');
        const detailBucket3 = processBucket(detailParsed.bucket3, categorizedRows, '3', 'Information Gaps (KB Update)');

        // Merge strategic + detail for each bucket, de-duping by topic (higher score wins)
        const bucket1 = mergeRecommendations(strategicBucket1, detailBucket1);
        const bucket2 = mergeRecommendations(strategicBucket2, detailBucket2);
        const bucket3 = mergeRecommendations(strategicBucket3, detailBucket3);

        log.recommendationsGenerated = bucket1.length + bucket2.length + bucket3.length;

        // Final counts
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0;
        categorizedRows.forEach(r => {
            if (r.BUCKET === '1') b1++;
            else if (r.BUCKET === '2') b2++;
            else if (r.BUCKET === '3') b3++;
            else b0++;
        });
        log.bucket0Count = b0;
        log.bucket1Count = b1;
        log.bucket2Count = b2;
        log.bucket3Count = b3;
        log.rowsAccountedFor = categorizedRows.length; // In this system, all rows are accounted for (bucketed to something)

        onProgress({
            currentBatch: 2,
            totalBatches: 2,
            stage: 'done',
            message: `Analysis complete — ${csvData.length} rows processed.`,
        });

        // ── Stage 5: Validation ───────────────────────────────────────────────────
        const allRecommendations = [...bucket1, ...bucket2, ...bucket3];
        log.validationResults = runAllValidations(allRecommendations, categorizedRows, allClusters);

        finaliseLog(log);

        return {
            categorizedRows,
            recommendations: { bucket1, bucket2, bucket3 },
            clusterSummaries: top20Clusters,
            totalRowsProcessed: csvData.length,
            analysisLog: log
        };
    } catch (criticalError: any) {
        log.errors.push(`Critical Pipeline Error: ${criticalError.message || String(criticalError)}`);
        finaliseLog(log);
        throw criticalError;
    }
}
