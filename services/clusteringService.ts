import { ConversationRow, ClusterSummary } from '../types';

// ---------------------------------------------------------------------------
// buildClusterSummaries
// ---------------------------------------------------------------------------
export function buildClusterSummaries(rows: ConversationRow[]): ClusterSummary[] {
    // Group by normalised topic key, but preserve original casing for output
    const groupMap = new Map<string, { originalTopic: string; indices: number[] }>();

    rows.forEach((row, idx) => {
        const key = (row.TOPIC || '').trim().toLowerCase();
        if (!groupMap.has(key)) {
            groupMap.set(key, { originalTopic: (row.TOPIC || '').trim(), indices: [] });
        }
        groupMap.get(key)!.indices.push(idx);
    });

    const summaries: ClusterSummary[] = [];

    groupMap.forEach(({ originalTopic, indices }) => {
        const groupRows = indices.map((i) => rows[i]);
        const total = groupRows.length;

        // Resolution status counts (case-insensitive)
        let unresolved = 0;
        let resolution_attempted = 0;
        let partially_resolved = 0;
        let user_drop_off = 0;

        // Sentiment counts (case-insensitive)
        let positive_sentiment = 0;
        let neutral_sentiment = 0;
        let negative_sentiment = 0;

        const unresolvedRows: ConversationRow[] = [];

        groupRows.forEach((r) => {
            const status = (r.RESOLUTION_STATUS || '').toLowerCase().trim();
            switch (status) {
                case 'unresolved':
                    unresolved++;
                    unresolvedRows.push(r);
                    break;
                case 'resolution_attempted':
                    resolution_attempted++;
                    break;
                case 'partially_resolved':
                    partially_resolved++;
                    break;
                case 'user_drop_off':
                    user_drop_off++;
                    break;
            }

            const sentiment = (r.USER_SENTIMENT || '').toLowerCase().trim();
            switch (sentiment) {
                case 'positive':
                    positive_sentiment++;
                    break;
                case 'neutral':
                    neutral_sentiment++;
                    break;
                case 'negative':
                    negative_sentiment++;
                    break;
            }
        });

        const failure_rate = total > 0 ? (unresolved + user_drop_off) / total : 0;
        const negative_rate = total > 0 ? negative_sentiment / total : 0;

        // Up to 3 sample queries – prefer unresolved rows first
        const sampleSource =
            unresolvedRows.length > 0 ? unresolvedRows : groupRows;
        const sample_queries = sampleSource
            .slice(0, 3)
            .map((r) => r.USER_QUERY || '')
            .filter(Boolean);

        summaries.push({
            topic: originalTopic,
            total,
            unresolved,
            resolution_attempted,
            partially_resolved,
            user_drop_off,
            positive_sentiment,
            neutral_sentiment,
            negative_sentiment,
            failure_rate,
            negative_rate,
            sample_queries,
            row_indices: indices,
        });
    });

    // Sort by failure_rate descending
    summaries.sort((a, b) => b.failure_rate - a.failure_rate);

    return summaries;
}

// ---------------------------------------------------------------------------
// getFailureRows
// ---------------------------------------------------------------------------
export function getFailureRows(
    rows: ConversationRow[],
    topN: number = 150
): Array<{ row: ConversationRow; originalIndex: number }> {
    const result: Array<{ row: ConversationRow; originalIndex: number; _sortKey: number }> = [];
    const seen = new Set<number>();

    rows.forEach((row, idx) => {
        const status = (row.RESOLUTION_STATUS || '').toLowerCase().trim();
        const sentiment = (row.USER_SENTIMENT || '').toLowerCase().trim();

        const isUnresolved = status === 'unresolved';
        const isDropOff = status === 'user_drop_off';
        const isNegative = sentiment === 'negative';

        if (isNegative || isUnresolved || isDropOff) {
            if (!seen.has(idx)) {
                seen.add(idx);
                // Lower sort key = higher priority
                // negative=0, unresolved=1, user_drop_off=2
                let sortKey = 2;
                if (isNegative) sortKey = 0;
                else if (isUnresolved) sortKey = 1;

                result.push({ row, originalIndex: idx, _sortKey: sortKey });
            }
        }
    });

    result.sort((a, b) => a._sortKey - b._sortKey);

    return result.slice(0, topN).map(({ row, originalIndex }) => ({ row, originalIndex }));
}

// ---------------------------------------------------------------------------
// assignBucketsByTopic
// ---------------------------------------------------------------------------
export function assignBucketsByTopic(
    rows: ConversationRow[],
    topicToBucket: Record<string, string>,
    topicToLabel: Record<string, string>
): ConversationRow[] {
    return rows.map((row) => {
        const key = (row.TOPIC || '').trim().toLowerCase();
        const bucket = topicToBucket[key];
        const label = topicToLabel[key];

        return {
            ...row,
            BUCKET: bucket !== undefined ? bucket : '0',
            BUCKET_LABEL: label !== undefined ? label : 'Resolved / Out of Scope',
            APPROVAL_STATUS: 'Pending' as const,
        };
    });
}
