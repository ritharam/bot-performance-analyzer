import { ConversationRow, AnalysisResult, BucketRecommendation, ModelOption, BatchAnalysisProgress } from '../types';
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
    clusters: ReturnType<typeof buildClusterSummaries>,
    botSummary: string,
    goals: string,
    csvData: ConversationRow[],
    batchNumber: number,
    totalBatches: number
): string {
    return `Act as a senior Chatbot Performance Strategist.

BUSINESS GOALS: "${goals}"

BOT SUMMARY: ${botSummary.slice(0, 3000)}

DATASET: ${csvData.length} total conversations. Below are ${clusters.length} topic clusters (Batch ${batchNumber} of ${totalBatches}, ranked by conversation volume — Rank 1 has most conversations):
${JSON.stringify(clusters.map(c => ({
        rank: c.rank,
        topic: c.topic,
        total: c.total,
        failure_rate: Math.round(c.failure_rate * 100) + '%',
        negative_rate: Math.round(c.negative_rate * 100) + '%',
        unresolved: c.unresolved,
        drop_off: c.user_drop_off,
        sample_queries: c.sample_queries
    })))}

TASK: For each topic cluster, assign it to a bucket and return full recommendations. Prioritise clusters with higher conversation counts (lower rank number) as they impact more users.

Buckets:
- "1" = Service Expansion: no handler exists, new intent/flow needed
- "2" = System Optimization: handler exists but logic is broken or incomplete
- "3" = Information Gaps: handler exists but returns wrong or missing data
- "0" = Resolved: failure_rate below 5% and negative_rate below 5% (be proactive in identifying gaps even for mostly successful topics)

Return valid JSON only:
{
  "topic_assignments": [{ "topic": "...", "bucket": "1"|"2"|"3"|"0", "bucket_label": "...", "issue_category": "...", "reason": "..." }],
  "bucket1": [{ "topic": "...", "problemStatement": "...", "recommendation": "...", "rootCause": "...", "goalAlignmentScore": 1-10, "strategicPriority": "Low|Medium|High|Critical", "kpiToWatch": "...", "examples": ["..."] }],
  "bucket2": [...],
  "bucket3": [...]
}

IMPORTANT: In topic_assignments, "issue_category" must exactly match the "topic" field of one of the recs in the assigned bucket (bucket1/bucket2/bucket3). This tells us which Issue Category each cluster belongs to.`;
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
        if (!existing) {
            map.set(key, rec);
        } else {
            const existingCount = (existing as any).count || 0;
            const recCount = (rec as any).count || 0;
            if (
                recCount > existingCount ||
                (recCount === existingCount && (rec.goalAlignmentScore || 0) > (existing.goalAlignmentScore || 0))
            ) {
                map.set(key, rec);
            }
        }
    }

    return Array.from(map.values()).sort((a, b) => {
        const countDiff = ((b as any).count || 0) - ((a as any).count || 0);
        if (countDiff !== 0) return countDiff;
        return (b.goalAlignmentScore || 0) - (a.goalAlignmentScore || 0);
    });
}

function processBucket(
    recs: any[],
    categorizedRows: ConversationRow[],
    bucketId: string,
    label: string,
    clustersByTopic?: Map<string, number[]>
): BucketRecommendation[] {
    (recs || []).forEach((rec) => {
        const llmIndices: number[] = Array.isArray(rec.indices)
            ? rec.indices.filter(
                (idx: number) =>
                    Number.isInteger(idx) && idx >= 0 && idx < categorizedRows.length
            )
            : [];

        const expandedSet = new Set<number>(llmIndices);
        if (clustersByTopic && rec.topic) {
            const recTopicLower = (rec.topic || '').toLowerCase().trim();
            clustersByTopic.forEach((indices, clusterTopic) => {
                if (
                    clusterTopic.includes(recTopicLower) ||
                    recTopicLower.includes(clusterTopic)
                ) {
                    indices.forEach((idx) => {
                        if (idx >= 0 && idx < categorizedRows.length) expandedSet.add(idx);
                    });
                }
            });
        }

        rec.indices = Array.from(expandedSet);
        rec.count = rec.indices.length;
        rec.indices.forEach((idx: number) => {
            categorizedRows[idx].BUCKET = bucketId;
            categorizedRows[idx].BUCKET_LABEL = label;
        });
    });

    return (recs || []).sort((a: any, b: any) => {
        const countDiff = (b.count || 0) - (a.count || 0);
        if (countDiff !== 0) return countDiff;
        return (b.goalAlignmentScore || 0) - (a.goalAlignmentScore || 0);
    });
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

    const CLUSTER_BATCH_SIZE = 25;
    const TOP_N_CLUSTERS = 100;

    try {
        onProgress({
            currentBatch: 0,
            totalBatches: 2,
            stage: 'clustering',
            message: `Building topic clusters from ${csvData.length} rows...`,
        });

        const allClusters = buildClusterSummaries(csvData);
        log.totalClustersGenerated = allClusters.length;

        const topClustersSelected = allClusters.slice(0, TOP_N_CLUSTERS);
        log.topClustersSelected = topClustersSelected.length;
        log.clustersDropped = Math.max(0, allClusters.length - TOP_N_CLUSTERS);

        log.clusterDetails = allClusters.map((c) => ({
            rank: c.rank,
            topic: c.topic,
            total: c.total,
            failure_rate: c.failure_rate,
            negative_rate: c.negative_rate,
            sentToAI: c.rank <= TOP_N_CLUSTERS,
        }));

        const clusterBatches: typeof topClustersSelected[] = [];
        for (let i = 0; i < topClustersSelected.length; i += CLUSTER_BATCH_SIZE) {
            clusterBatches.push(topClustersSelected.slice(i, i + CLUSTER_BATCH_SIZE));
        }
        const totalStrategicBatches = clusterBatches.length;

        onProgress({
            currentBatch: 1,
            totalBatches: 1 + totalStrategicBatches + 1,
            stage: 'strategic',
            message: `Mapping improvement areas across ${topClustersSelected.length} clusters in ${totalStrategicBatches} batch(es)...`,
        });

        const mergedStrategicParsed: {
            topic_assignments: any[];
            bucket1: any[];
            bucket2: any[];
            bucket3: any[];
        } = { topic_assignments: [], bucket1: [], bucket2: [], bucket3: [] };

        for (let bIdx = 0; bIdx < clusterBatches.length; bIdx++) {
            const batch = clusterBatches[bIdx];
            const batchNum = bIdx + 1;
            const strategicStartTime = Date.now();
            const strategicPrompt = buildStrategicPrompt(batch, botSummary, goals, csvData, batchNum, totalStrategicBatches);
            let strategicRaw = "";
            let strategicSuccess = false;
            let strategicError = "";

            try {
                strategicRaw = await callAI(strategicPrompt, model, apiKey);
                strategicSuccess = true;
            } catch (e: any) {
                strategicError = e.message || String(e);
                log.errors.push(`Stage 2 Batch ${batchNum} (Strategic) API Error: ${strategicError}`);
            }

            log.batchSummary.push({
                batchName: `Stage 2 Batch ${batchNum}/${totalStrategicBatches}: Strategic Mapping (clusters ${(bIdx * CLUSTER_BATCH_SIZE) + 1}–${Math.min((bIdx + 1) * CLUSTER_BATCH_SIZE, topClustersSelected.length)})`,
                inputSize: batch.length,
                tokenEstimate: strategicPrompt.length / 4,
                durationMs: Date.now() - strategicStartTime,
                success: strategicSuccess,
                errorMessage: strategicError || undefined,
            });

            batch.forEach(c => {
                const detail = log.clusterDetails.find(d => d.topic === c.topic);
                if (detail) detail.batchNumber = batchNum;
            });

            const batchParsed = safeJsonParse<any>(strategicRaw, {
                topic_assignments: [],
                bucket1: [],
                bucket2: [],
                bucket3: [],
            });

            mergedStrategicParsed.topic_assignments.push(...(batchParsed.topic_assignments || []));
            mergedStrategicParsed.bucket1.push(...(batchParsed.bucket1 || []));
            mergedStrategicParsed.bucket2.push(...(batchParsed.bucket2 || []));
            mergedStrategicParsed.bucket3.push(...(batchParsed.bucket3 || []));

            onProgress({
                currentBatch: 1 + batchNum,
                totalBatches: 1 + totalStrategicBatches + 1,
                stage: 'strategic',
                message: `Strategic batch ${batchNum}/${totalStrategicBatches} complete...`,
            });
        }

        const strategicParsed = mergedStrategicParsed;
        const topicToBucket: Record<string, string> = {};
        const topicToLabel: Record<string, string> = {};
        const topicToIssueCategory: Record<string, string> = {};

        const assignments: Array<{ topic: string; bucket: string; bucket_label?: string; label?: string; issue_category?: string; reason?: string }> =
            strategicParsed.topic_assignments || [];

        log.topicAssignmentsReturned = assignments.length;

        assignments.forEach(({ topic, bucket, bucket_label, label, issue_category }) => {
            const key = (topic || '').toLowerCase().trim();
            topicToBucket[key] = bucket || '0';
            topicToLabel[key] = bucket_label || label || 'Resolved / Out of Scope';
            if (issue_category && bucket !== '0') {
                topicToIssueCategory[key] = issue_category;
            }
        });

        const failureEntry = getFailureRows(csvData, 500);

        onProgress({
            currentBatch: 1 + totalStrategicBatches,
            totalBatches: 1 + totalStrategicBatches + 1,
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

        onProgress({
            currentBatch: 1 + totalStrategicBatches + 1,
            totalBatches: 1 + totalStrategicBatches + 1,
            stage: 'merging',
            message: `Merging results across all ${csvData.length} rows...`,
        });

        const categorizedRows: ConversationRow[] = assignBucketsByTopic(
            csvData,
            topicToBucket,
            topicToLabel
        );

        let uniqueTopicsMappedSet = new Set<string>();
        categorizedRows.forEach(r => {
            const key = (r.TOPIC || '').toLowerCase().trim();
            if (topicToBucket[key]) uniqueTopicsMappedSet.add(key);
        });
        log.topicAssignmentsMapped = uniqueTopicsMappedSet.size;
        log.topicAssignmentsUnmatched = Math.max(0, log.totalClustersGenerated - uniqueTopicsMappedSet.size);

        log.dataLossTopics = allClusters
            .filter(c => !topicToBucket[(c.topic || '').toLowerCase().trim()])
            .map(c => c.topic);

        const clustersByTopic = new Map<string, number[]>();
        topClustersSelected.forEach((c) => {
            clustersByTopic.set((c.topic || '').toLowerCase().trim(), c.row_indices);
        });

        const strategicBucket1 = processBucket(strategicParsed.bucket1, categorizedRows, '1', 'Service Expansion (New Agent)', clustersByTopic);
        const strategicBucket2 = processBucket(strategicParsed.bucket2, categorizedRows, '2', 'System Optimization (Logic Update)', clustersByTopic);
        const strategicBucket3 = processBucket(strategicParsed.bucket3, categorizedRows, '3', 'Information Gaps (KB Update)', clustersByTopic);

        const detailBucket1 = processBucket(detailParsed.bucket1, categorizedRows, '1', 'Service Expansion (New Agent)', clustersByTopic);
        const detailBucket2 = processBucket(detailParsed.bucket2, categorizedRows, '2', 'System Optimization (Logic Update)', clustersByTopic);
        const detailBucket3 = processBucket(detailParsed.bucket3, categorizedRows, '3', 'Information Gaps (KB Update)', clustersByTopic);

        const bucket1 = mergeRecommendations(strategicBucket1, detailBucket1);
        const bucket2 = mergeRecommendations(strategicBucket2, detailBucket2);
        const bucket3 = mergeRecommendations(strategicBucket3, detailBucket3);

        const buildIssueCategoryMap = (
            bucketRecs: BucketRecommendation[],
            bucketId: string,
            rows: ConversationRow[]
        ) => {
            if (!bucketRecs || bucketRecs.length === 0) return;
            const validRecTopics = new Set(bucketRecs.map(r => r.topic));
            const recTopicToGranularTopics = new Map<string, Set<string>>();
            bucketRecs.forEach((rec: any) => {
                const covered = new Set<string>();
                if (Array.isArray(rec.indices)) {
                    rec.indices.forEach((idx: number) => {
                        const rowTopic = (rows[idx]?.TOPIC || '').toLowerCase().trim();
                        if (rowTopic) covered.add(rowTopic);
                    });
                }
                recTopicToGranularTopics.set(rec.topic, covered);
            });

            assignments.forEach(({ topic: clusterTopic, bucket }) => {
                if (bucket !== bucketId) return;
                const key = (clusterTopic || '').toLowerCase().trim();
                if (!key) return;
                const existing = topicToIssueCategory[key];
                if (existing && !validRecTopics.has(existing)) {
                    delete topicToIssueCategory[key];
                }
                if (topicToIssueCategory[key]) return;
                for (const [recTopic, granularSet] of recTopicToGranularTopics) {
                    if (granularSet.has(key)) {
                        topicToIssueCategory[key] = recTopic;
                        return;
                    }
                }
                const clusterWords = new Set(key.split(/[\s_\-,]+/).filter((w: string) => w.length > 2));
                let bestRec = '';
                let bestScore = -1;
                bucketRecs.forEach((rec: any) => {
                    const recLower = (rec.topic || '').toLowerCase();
                    const recWords = recLower.split(/[\s_\-,]+/).filter((w: string) => w.length > 2);
                    let score = 0;
                    recWords.forEach((w: string) => { if (clusterWords.has(w)) score += 2; });
                    if (recLower.includes(key)) score += 3;
                    else if (key.includes(recLower.split(' ').slice(0, 2).join(' '))) score += 2;
                    clusterWords.forEach((cw: string) => { if (recLower.includes(cw)) score += 1; });
                    if (score > bestScore) { bestScore = score; bestRec = rec.topic; }
                });
                if (bestRec && bestScore > 0) {
                    topicToIssueCategory[key] = bestRec;
                    return;
                }
                topicToIssueCategory[key] = bucketRecs[0].topic;
            });
        };

        buildIssueCategoryMap(bucket1, '1', categorizedRows);
        buildIssueCategoryMap(bucket2, '2', categorizedRows);
        buildIssueCategoryMap(bucket3, '3', categorizedRows);

        const rowIndexToIssueCategory = new Map<number, string>();
        [
            { recs: bucket1 },
            { recs: bucket2 },
            { recs: bucket3 },
        ].forEach(({ recs }) => {
            recs.forEach((rec: any) => {
                if (Array.isArray(rec.indices)) {
                    rec.indices.forEach((idx: number) => {
                        if (!rowIndexToIssueCategory.has(idx)) {
                            rowIndexToIssueCategory.set(idx, rec.topic);
                        }
                    });
                }
            });
        });

        categorizedRows.forEach((row, rowIdx) => {
            if (!row.BUCKET || row.BUCKET === '0') return;
            const topicKey = (row.TOPIC || '').toLowerCase().trim();
            const bktRecs = row.BUCKET === '1' ? bucket1 : row.BUCKET === '2' ? bucket2 : bucket3;
            const topicLevelCategory = topicToIssueCategory[topicKey];
            if (topicLevelCategory) {
                (row as any).ISSUE_CATEGORY = topicLevelCategory;
                return;
            }
            const indexLevelCategory = rowIndexToIssueCategory.get(rowIdx);
            if (indexLevelCategory) {
                (row as any).ISSUE_CATEGORY = indexLevelCategory;
                return;
            }
            if (topicKey) {
                const clusterIndices = allClusters.find(
                    c => (c.topic || '').toLowerCase().trim() === topicKey
                )?.row_indices;
                if (clusterIndices) {
                    for (const ci of clusterIndices) {
                        const sibling = categorizedRows[ci];
                        if (sibling && (sibling as any).ISSUE_CATEGORY) {
                            (row as any).ISSUE_CATEGORY = (sibling as any).ISSUE_CATEGORY;
                            return;
                        }
                    }
                }
            }
            if (bktRecs && bktRecs.length > 0) {
                (row as any).ISSUE_CATEGORY = bktRecs[0].topic;
            }
        });

        log.recommendationsGenerated = bucket1.length + bucket2.length + bucket3.length;
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
        log.rowsAccountedFor = categorizedRows.length;

        const totalBatchesCount = 1 + totalStrategicBatches + 1;
        onProgress({
            currentBatch: totalBatchesCount,
            totalBatches: totalBatchesCount,
            stage: 'done',
            message: `Analysis complete — ${csvData.length} rows processed across ${topClustersSelected.length} clusters.`,
        });

        const allRecommendations = [...bucket1, ...bucket2, ...bucket3];
        log.validationResults = runAllValidations(allRecommendations, categorizedRows, allClusters);
        finaliseLog(log);

        return {
            categorizedRows,
            recommendations: { bucket1, bucket2, bucket3 },
            clusterSummaries: topClustersSelected,
            totalRowsProcessed: csvData.length,
            analysisLog: log
        };
    } catch (criticalError: any) {
        log.errors.push(`Critical Pipeline Error: ${criticalError.message || String(criticalError)}`);
        finaliseLog(log);
        throw criticalError;
    }
}
