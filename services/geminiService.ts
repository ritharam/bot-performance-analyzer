import { GoogleGenAI } from "@google/genai";
import { ConversationRow, AnalysisResult } from "../types";

// Helper for safe JSON parsing
function safeJsonParse<T>(text: string | undefined, defaultValue: T): T {
  if (!text || !text.trim()) return defaultValue;
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
    }
    return JSON.parse(text);
  } catch (e) {
    console.error("JSON Parse Error:", e);
    return defaultValue;
  }
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
      const shouldRetry = status === 429 || (status >= 500 && status < 600) || message.includes('Rate limit') || message.includes('quota') || message.includes('429');

      if (shouldRetry) {
        console.warn(`Retrying operation... (${retries} attempts left). Error: ${message}`);
        await new Promise((res) => setTimeout(res, delayMs));
        return withRetry(operation, retries - 1, delayMs * 2);
      }
    }
    throw error;
  }
}

export const analyzeWithGemini = async (
  csvData: ConversationRow[],
  botSummary: string,
  goals: string,
  apiKey?: string,
  standardLogData?: any[],
  chatLogData?: any[]
): Promise<AnalysisResult> => {
  const activeApiKey = apiKey || process.env.GEMINI_API_KEY;
  // Priority: csvData > standardLogData > chatLogData
  const isStandardLog = csvData.length === 0 && standardLogData && standardLogData.length > 0;
  const isChatLog = csvData.length === 0 && (!standardLogData || standardLogData.length === 0) && chatLogData && chatLogData.length > 0;
  const MAX_RECORDS = isChatLog ? 250 : 250; // More sessions for chat logs


  // For Chat Logs: group individual messages by Session Id into conversations
  let groupedChatSessions: any[] = [];
  if (isChatLog && chatLogData) {
    const sessionMap = new Map<string, any[]>();
    chatLogData.forEach(row => {
      const sid = row['Session Id'] || 'unknown';
      if (!sessionMap.has(sid)) sessionMap.set(sid, []);
      sessionMap.get(sid)!.push(row);
    });
    groupedChatSessions = Array.from(sessionMap.entries()).map(([sid, rows]) => {
      const firstRow = rows[0];
      const userMessages = rows
        .filter((r: any) => r['Message Type'] === 'USER' || r['Message Type'] === 'user')
        .map((r: any) => r['Translated message'] || r['Message'])
        .filter(Boolean)
        .slice(0, 5)
        .join(' | ');
      const allMessages = rows
        .map((r: any) => r['Translated message'] || r['Message'])
        .filter(Boolean)
        .slice(0, 8)
        .join(' | ');
      const feedback = rows.map((r: any) => r['Feedback']).filter(Boolean).pop() || 'N/A';
      const lastStep = rows.map((r: any) => r['Journey:Step']).filter(Boolean).pop() || 'N/A';
      // Extract summaries
      const convSummary = rows.map((r: any) => r['Conversation_Summary']).filter(Boolean).pop() || '';
      const userSummary = rows.map((r: any) => r['User_Summary']).filter(Boolean).pop() || '';
      const botSummary = rows.map((r: any) => r['Bot_Summary']).filter(Boolean).pop() || '';

      return {
        ...firstRow,
        'Session Id': sid,
        'MESSAGE_AGGREGATE': userMessages || allMessages || 'N/A',
        'FEEDBACK_AGGREGATE': feedback,
        'LAST_STEP': lastStep,
        'CONVERSATION_SUMMARY': convSummary,
        'USER_SUMMARY': userSummary,
        'BOT_SUMMARY': botSummary,
        'SOURCE_ROWS': rows
      };
    });
  }

  const processData = isStandardLog
    ? standardLogData!.slice(0, MAX_RECORDS)
    : isChatLog
      ? groupedChatSessions.slice(0, MAX_RECORDS)
      : csvData.slice(0, MAX_RECORDS);

  const dataPrompt = isStandardLog
    ? JSON.stringify(processData.map((r, i) => ({ i, q: r.CONVERSATION_SUMMARY || r.USER_SUMMARY || "N/A", s: r.HANGUP_REASON || "N/A", t: "N/A" })))
    : isChatLog
      ? JSON.stringify(processData.map((r, i) => ({
        i,
        q: r.CONVERSATION_SUMMARY ? `SUMMARY: ${r.CONVERSATION_SUMMARY}` : (r.MESSAGE_AGGREGATE || "N/A"),
        s: r.FEEDBACK_AGGREGATE || "N/A",
        t: r.LAST_STEP || "N/A"
      })))
      : JSON.stringify(processData.map((r, i) => ({ i, q: r.USER_QUERY, s: r.RESOLUTION_STATUS, t: r.TOPIC })));

  const chatLogContext = isChatLog
    ? `DATA TYPE: Raw Chat Log Sessions (each entry = one full user conversation, NOT a single message)
TOTAL SESSIONS UPLOADED: ${groupedChatSessions.length} sessions (${chatLogData?.length || 0} raw messages)
SESSIONS IN SAMPLE: ${processData.length}

FIELD GUIDE FOR EACH SESSION:
- "q" = Aggregated user messages in this session (joined with " | ")
- "s" = Final feedback/outcome if captured (may be "N/A")
- "t" = Last journey step the user reached before session ended`
    : '';

  const prompt = isChatLog
    ? `Act as a senior Chatbot Performance Strategist. Analyse the following CHAT LOG SESSIONS to identify structural issues with the bot's conversation design.

CORE BUSINESS GOALS:
"${goals || "Increase overall resolution rates and improve the quality of automated responses."}"

BOT ARCHITECTURE SUMMARY:
${botSummary.slice(0, 6000)}

${chatLogContext}

CHAT SESSION DATA (Indices 0 to ${processData.length - 1}, each row is ONE full session):
${dataPrompt}

INSTRUCTIONS:
1. Read the user messages in each session to understand what users are trying to do.
2. Look for PATTERNS across sessions — topics, intents, failures, and drop-off points.
3. Group sessions into recurring clusters of issues and categorize them:
   - Bucket 1: Service Expansion — intents or flows the bot doesn't handle at all
   - Bucket 2: System Optimization — existing flows that have errors, friction, or wrong responses
   - Bucket 3: Information Gaps — queries the bot can't answer due to missing data/KB

4. For EVERY recommendation, list the EXACT indices of sessions (from the sample above) that match that cluster.
   CRITICAL: Only use indices between 0 and ${processData.length - 1}. Do NOT invent indices.

5. Set "count" to equal the NUMBER of indices you list for that recommendation (must match).

OUTPUT FORMAT (strict JSON):
{
  "bucket1": [{
    "topic": "Short cluster name",
    "indices": [0, 3, 7, ...],
    "count": <number matching indices length>,
    "problemStatement": "What pattern/issue was found?",
    "recommendation": "What should be built or improved?",
    "goalAlignmentScore": 8,
    "strategicPriority": "High",
    "kpiToWatch": "Metric to track",
    "examples": ["user query from session 0", "user query from session 3"]
  }],
  "bucket2": [...],
  "bucket3": [...]
}`
    : `Act as a senior Chatbot Performance Strategist for Royal Enfield. 
  
  CORE MISSION / BUSINESS GOALS:
  "${goals || "Increase overall resolution rates and improve the quality of automated responses."}"

  BOT ARCHITECTURE SUMMARY:
  ${botSummary.slice(0, 8000)}

  CONVERSATION DATA (Indices 0 to ${processData.length - 1}):
  ${dataPrompt}

  TASK:
  1. Identify recurring clusters of failures and categorize them into:
     - Bucket 1: Service Expansion (Missing intents/flows)
     - Bucket 2: System Optimization (Logic/Existing flow errors)
     - Bucket 3: Information Gaps (Missing KB/Data)
  
  2. For EACH recommendation in a bucket, you MUST provide the specific indices of the rows from the provided "CONVERSATION DATA" that belong to it.

  3. Output JSON format (MUST BE VALID JSON):
  {
    "bucket1": [{
      "topic": "...", 
      "indices": [0, 5, 12...],
      "problemStatement": "...", 
      "recommendation": "...",
      "goalAlignmentScore": 9,
      "strategicPriority": "Critical",
      "kpiToWatch": "...",
      "examples": ["Query from row 0", "Query from row 5"]
    }],
    "bucket2": [...],
    "bucket3": [...]
  }`;

  try {
    const ai = new GoogleGenAI({ apiKey: activeApiKey || "" });

    const result = await withRetry(async () => {
      try {
        return await ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: prompt,
          config: { responseMimeType: 'application/json', temperature: 0, seed: 42 }
        });
      } catch (err: any) {
        // Normalize Gemini SDK errors
        const message = err.message || 'Unknown Gemini error';
        const error: any = new Error(`Gemini API error: ${message}`);
        if (message.includes('429') || message.includes('ResourceExhausted')) error.status = 429;
        throw error;
      }
    });

    const text = result.text;
    const parsed = safeJsonParse<any>(text, { bucket1: [], bucket2: [], bucket3: [] });

    // Initialize rows with default bucket '0'
    const categorizedRows = isStandardLog
      ? standardLogData!.map(row => ({
        ...row,
        USER_QUERY: row.CONVERSATION_SUMMARY || row.USER_SUMMARY || 'N/A',
        RESOLUTION_STATUS: row.HANGUP_REASON || 'N/A',
        BUCKET: '0',
        BUCKET_LABEL: 'Resolved / Out of Scope',
        APPROVAL_STATUS: 'Pending' as const
      }))
      : isChatLog
        ? groupedChatSessions.map(row => ({
          ...row,
          USER_QUERY: row.MESSAGE_AGGREGATE || 'N/A',
          RESOLUTION_STATUS: row.FEEDBACK_AGGREGATE || 'N/A',
          TOPIC: row.LAST_STEP || 'N/A',
          CONVERSATION_SUMMARY: row.CONVERSATION_SUMMARY,
          USER_SUMMARY: row.USER_SUMMARY,
          BOT_SUMMARY: row.BOT_SUMMARY,
          BUCKET: '0',
          BUCKET_LABEL: 'Resolved / Out of Scope',
          APPROVAL_STATUS: 'Pending' as const
        }))
        : csvData.map(row => ({
          ...row,
          BUCKET: '0',
          BUCKET_LABEL: 'Resolved / Out of Scope',
          APPROVAL_STATUS: 'Pending' as const
        }));

    // Function to process buckets and assign indices to rows
    const processBucket = (recs: any[], bucketId: string, label: string) => {
      (recs || []).forEach(rec => {
        // Enforce count matches actual indices length
        if (Array.isArray(rec.indices)) {
          // Filter out invalid indices
          rec.indices = rec.indices.filter((idx: number) => Number.isInteger(idx) && idx >= 0 && idx < categorizedRows.length);
          rec.count = rec.indices.length;
          rec.indices.forEach((idx: number) => {
            categorizedRows[idx].BUCKET = bucketId;
            categorizedRows[idx].BUCKET_LABEL = label;
            // Always assign topic from recommendation so it's properly labeled
            if (!categorizedRows[idx].TOPIC || categorizedRows[idx].TOPIC === 'None' || categorizedRows[idx].TOPIC === 'N/A') {
              categorizedRows[idx].TOPIC = rec.topic;
            }
          });
        }
      });
      return recs.sort((a, b) => (b.goalAlignmentScore || 0) - (a.goalAlignmentScore || 0));
    };

    const bucket1 = processBucket(parsed.bucket1, '1', "Service Expansion (New Agent)");
    const bucket2 = processBucket(parsed.bucket2, '2', "System Optimization (Logic Update)");
    const bucket3 = processBucket(parsed.bucket3, '3', "Information Gaps (KB Update)");

    return {
      categorizedRows,
      recommendations: { bucket1, bucket2, bucket3 },
      totalRowsProcessed: categorizedRows.length,
    };
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};
