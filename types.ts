
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
  USER_SUMMARY?: string;
  BOT_SUMMARY?: string;
  CONVERSATION_SUMMARY?: string;
}

export interface StandardLogRow {
  CALL_ID: string;
  CALL_DURATION: string;
  HANGUP_REASON: string;
  HANGUP_SOURCE: string;
  RECORDING_URL: string;
  CONVERSATION_SUMMARY: string;
  USER_SUMMARY: string;
  BOT_SUMMARY: string;
}

export interface ChatLogRow {
  'Created Date': string;
  'Bot Id': string;
  'UID': string;
  'Message': string;
  'Message Type': string;
  'Session Id': string;
  'Journey:Step': string;
  'Source': string;
  'Interaction medium': string;
  'Node type': string;
  'Feedback': string;
  'Language': string;
  'Translated message': string;
  'User_Summary'?: string;
  'Bot_Summary'?: string;
  'Conversation_Summary'?: string;
}

export interface BucketRecommendation {
  topic: string;
  count: number;
  indices?: number[];
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
  clusterSummaries?: ClusterSummary[];
  totalRowsProcessed?: number;
  analysisLog?: AnalysisLog;
}

export interface AnalysisSummary {
  totalChats: number;
  statusBreakdown: Record<string, number>;
  bucketDistribution: Record<string, number>;
}

export interface ClusterSummary {
  topic: string;
  total: number;
  unresolved: number;
  resolution_attempted: number;
  partially_resolved: number;
  user_drop_off: number;
  positive_sentiment: number;
  neutral_sentiment: number;
  negative_sentiment: number;
  failure_rate: number;
  resolution_rate: number;
  confidence: number;
  negative_rate: number;
  sample_queries: string[];
  row_indices: number[];
}

export interface BatchAnalysisProgress {
  currentBatch: number;
  totalBatches: number;
  stage: 'clustering' | 'strategic' | 'detail' | 'merging' | 'done';
  message: string;
}

export interface ValidationResult {
  type: 'Index' | 'Bucket' | 'Examples' | 'Quality';
  status: 'Pass' | 'Fail' | 'Warning';
  message: string;
  details?: string;
}

export interface AnalysisLog {
  runId: string;
  startTime: string;
  endTime?: string;
  model: string;
  botTitle: string;
  csvTotalRows: number;
  csvAfterFilter: number;
  csvFilteredOut: number;
  filterStatuses: string[];
  totalClustersGenerated: number;
  topClustersSelected: number;
  clustersDropped: number;
  clusterDetails: {
    rank: number;
    topic: string;
    total: number;
    failure_rate: number;
    negative_rate: number;
    sentToAI: boolean;
  }[];
  batchSummary: {
    batchName: string;
    inputSize: number;
    tokenEstimate: number;
    durationMs: number;
    success: boolean;
    errorMessage?: string;
  }[];
  topicAssignmentsReturned: number;
  topicAssignmentsMapped: number;
  topicAssignmentsUnmatched: number;
  bucket0Count: number;
  bucket1Count: number;
  bucket2Count: number;
  bucket3Count: number;
  recommendationsGenerated: number;
  rowsAccountedFor: number;
  dataLossRows: number;
  dataLossTopics: string[];
  validationResults: ValidationResult[];
  errors: string[];
}
