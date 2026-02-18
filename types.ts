
export type ModelOption = 'gemini-flash' | 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4' | 'gpt-4.1' | 'gpt-5.2';

export interface ConversationRow {
  CHATURL: string;
  TOPIC: string;
  USER_QUERY: string;
  RESOLUTION: string;
  RESOLUTION_STATUS: string;
  RESOLUTION_STATUS_REASONING: string;
  TIME_STAMP: string;
  USER_ID: string;
  USER_SENTIMENT: string;
  BUCKET?: string;
  BUCKET_LABEL?: string;
  APPROVAL_STATUS: 'Yes' | 'No' | 'Pending';
}

export interface BucketRecommendation {
  topic: string;
  count: number;
  problemStatement: string;
  rootCause?: string;
  recommendation: string;
  examples: string[];
  goalAlignmentScore: number; // 1-10 score based on user goals
  strategicPriority: 'Low' | 'Medium' | 'High' | 'Critical';
  kpiToWatch: string; // Metric to track after implementation
}

export interface AnalysisResult {
  categorizedRows: ConversationRow[];
  recommendations: {
    bucket1: BucketRecommendation[];
    bucket2: BucketRecommendation[];
    bucket3: BucketRecommendation[];
  };
}

export interface AnalysisSummary {
  totalChats: number;
  statusBreakdown: Record<string, number>;
  bucketDistribution: Record<string, number>;
}
