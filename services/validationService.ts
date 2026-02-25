import { BucketRecommendation, ConversationRow, ValidationResult, ClusterSummary } from '../types';

/**
 * Validates that all indices in recommendations are valid for the given dataset.
 */
export function validateIndices(
    recommendations: BucketRecommendation[],
    totalRows: number
): ValidationResult {
    const invalidIndices: { topic: string; indices: number[] }[] = [];

    recommendations.forEach((rec) => {
        const bad = rec.indices?.filter(
            (idx: any) => !Number.isInteger(idx) || idx < 0 || idx >= totalRows
        ) || [];
        if (bad.length > 0) {
            invalidIndices.push({ topic: rec.topic, indices: bad });
        }
    });

    if (invalidIndices.length > 0) {
        return {
            type: 'Index',
            status: 'Fail',
            message: `Found ${invalidIndices.length} topics with invalid row indices.`,
            details: JSON.stringify(invalidIndices)
        };
    }

    return {
        type: 'Index',
        status: 'Pass',
        message: 'All recommendation indices are valid and within range.'
    };
}

/**
 * Validates that Bucket "0" (Resolved) actually corresponds to topics with low failure rates.
 */
export function validateBucketConsistency(
    categorizedRows: ConversationRow[],
    clusterSummaries: ClusterSummary[]
): ValidationResult {
    const thresholdFailure = 0.15;
    const thresholdNegative = 0.10;
    const inconsistencies: string[] = [];

    clusterSummaries.forEach((c) => {
        const row = categorizedRows.find((r) => (r.TOPIC || '').toLowerCase() === (c.topic || '').toLowerCase());
        const isResolvedBucket = row?.BUCKET === '0';

        const highFailure = c.failure_rate > thresholdFailure;
        const highNegative = c.negative_rate > thresholdNegative;

        if (isResolvedBucket && (highFailure || highNegative)) {
            inconsistencies.push(c.topic);
        }
    });

    if (inconsistencies.length > 0) {
        return {
            type: 'Bucket',
            status: 'Warning',
            message: `${inconsistencies.length} topics marked as "Resolved" have high failure/negative rates.`,
            details: inconsistencies.join(', ')
        };
    }

    return {
        type: 'Bucket',
        status: 'Pass',
        message: 'Bucket assignments are consistent with topic performance metrics.'
    };
}

/**
 * Ensures every recommendation has at least one example.
 */
export function validateExamplePresence(
    recommendations: BucketRecommendation[]
): ValidationResult {
    const missingExamples = recommendations
        .filter((rec) => !rec.examples || rec.examples.length === 0)
        .map((rec) => rec.topic);

    if (missingExamples.length > 0) {
        return {
            type: 'Examples',
            status: 'Fail',
            message: `${missingExamples.length} recommendations are missing evidence/examples.`,
            details: missingExamples.join(', ')
        };
    }

    return {
        type: 'Examples',
        status: 'Pass',
        message: 'All recommendations include supporting evidence.'
    };
}

/**
 * Validates the quality of recommendation text.
 */
export function validateRecommendationQuality(
    recommendations: BucketRecommendation[]
): ValidationResult {
    const poorQuality: string[] = [];
    const strategicKeywords = ['implement', 'update', 'fix', 'add', 'create', 'optimize', 'improve', 'expand'];

    recommendations.forEach((rec) => {
        const text = (rec.recommendation || '').toLowerCase();
        const problem = (rec.problemStatement || '').toLowerCase();

        const tooShort = text.length < 20 || problem.length < 20;
        const missingAction = !strategicKeywords.some(kw => text.includes(kw));

        if (tooShort || missingAction) {
            poorQuality.push(rec.topic);
        }
    });

    if (poorQuality.length > 0) {
        return {
            type: 'Quality',
            status: 'Warning',
            message: `${poorQuality.length} recommendations have low detail or lack clear action items.`,
            details: poorQuality.join(', ')
        };
    }

    return {
        type: 'Quality',
        status: 'Pass',
        message: 'Recommendation quality is high with actionable descriptions.'
    };
}

/**
 * Runs all validations and returns a list of results.
 */
export function runAllValidations(
    recommendations: BucketRecommendation[],
    categorizedRows: ConversationRow[],
    clusterSummaries: ClusterSummary[]
): ValidationResult[] {
    return [
        validateIndices(recommendations, categorizedRows.length),
        validateBucketConsistency(categorizedRows, clusterSummaries),
        validateExamplePresence(recommendations),
        validateRecommendationQuality(recommendations)
    ];
}
