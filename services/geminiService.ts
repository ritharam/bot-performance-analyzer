
import { GoogleGenAI, Type } from "@google/genai";
import { ConversationRow, AnalysisResult } from "../types";

function safeJsonParse<T>(text: string | undefined, defaultValue: T): T {
  if (!text || !text.trim()) return defaultValue;
  try {
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch (e) {
    console.error("JSON Parse Error:", e);
    return defaultValue;
  }
}

export const analyzeWithGemini = async (
  csvData: ConversationRow[],
  botSummary: string,
  goals: string,
  apiKey?: string,
  standardLogData?: any[]
): Promise<AnalysisResult> => {
  const activeApiKey = apiKey || process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey: activeApiKey || "" });
  const MAX_RECORDS = 100; // Increased limit for better breadth

  // Choose which data to process. If csvData is empty, use standardLogData.
  const isStandardLog = csvData.length === 0 && standardLogData && standardLogData.length > 0;
  const processData = isStandardLog ? standardLogData!.slice(0, MAX_RECORDS) : csvData.slice(0, MAX_RECORDS);

  const dataPrompt = isStandardLog
    ? JSON.stringify(processData.map((r, i) => ({ i, q: r.CONVERSATION_SUMMARY || r.USER_SUMMARY || "N/A", s: r.HANGUP_REASON || "N/A", t: "N/A" })))
    : JSON.stringify(processData.map((r, i) => ({ i, q: r.USER_QUERY, s: r.RESOLUTION_STATUS, t: r.TOPIC })));

  const prompt = `Act as a senior Chatbot Performance Strategist for Royal Enfield. 
  
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
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        seed: 42
      }
    });

    const parsed = safeJsonParse<any>(response.text, { bucket1: [], bucket2: [], bucket3: [] });

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
      : csvData.map(row => ({
        ...row,
        BUCKET: '0',
        BUCKET_LABEL: 'Resolved / Out of Scope',
        APPROVAL_STATUS: 'Pending' as const
      }));

    // Function to process buckets and assign indices to rows
    const processBucket = (recs: any[], bucketId: string, label: string) => {
      (recs || []).forEach(rec => {
        if (Array.isArray(rec.indices)) {
          rec.indices.forEach((idx: number) => {
            if (categorizedRows[idx]) {
              categorizedRows[idx].BUCKET = bucketId;
              categorizedRows[idx].BUCKET_LABEL = label;
              // If the AI didn't provide a specific topic in the log, use the recommendation topic
              if (!categorizedRows[idx].TOPIC || categorizedRows[idx].TOPIC === 'None') {
                categorizedRows[idx].TOPIC = rec.topic;
              }
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
      recommendations: { bucket1, bucket2, bucket3 }
    };
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};
