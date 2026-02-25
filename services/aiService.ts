
import { ConversationRow, StandardLogRow, AnalysisResult, ModelOption, BatchAnalysisProgress } from "../types";
import { analyzeWithGemini } from "./geminiService";
import { analyzeWithOpenAI } from "./openaiService";
import { analyzeWithBatching } from "./batchAnalysisService";

export const analyzeConversations = async (
    csvData: ConversationRow[],
    botSummary: string,
    goals: string,
    model: ModelOption,
    customGeminiKey?: string,
    customOpenAIKey?: string,
    standardLogData?: any[],
    chatLogData?: any[],
    botTitle?: string
): Promise<AnalysisResult> => {
    if (model === 'gemini-flash') {
        return analyzeWithGemini(csvData, botSummary, goals, customGeminiKey, standardLogData, chatLogData);
    } else {
        // OpenAI models
        return analyzeWithOpenAI(csvData, botSummary, goals, model, customOpenAIKey, standardLogData, chatLogData);
    }
};

export const analyzeConversationsWithBatching = async (
    csvData: ConversationRow[],
    botSummary: string,
    goals: string,
    model: ModelOption,
    geminiApiKey?: string,
    openaiApiKey?: string,
    standardLogData?: any[],
    chatLogData?: any[],
    onProgress?: (progress: BatchAnalysisProgress) => void,
    botTitle?: string,
    originalCsvStats?: { total: number; filteredOut: number; filterStatuses: string[] }
): Promise<AnalysisResult> => {
    const progressFn = onProgress || (() => { });
    if (csvData.length <= 250 && !(chatLogData && chatLogData.length > 0)) {
        return analyzeConversations(csvData, botSummary, goals, model, geminiApiKey, openaiApiKey, standardLogData, chatLogData);
    }
    // If only chatLogData is present (no CRA csv), fall through to analyzeConversations too
    if (csvData.length === 0) {
        return analyzeConversations(csvData, botSummary, goals, model, geminiApiKey, openaiApiKey, standardLogData, chatLogData);
    }
    const apiKey = model === 'gemini-flash'
        ? (geminiApiKey || process.env.GEMINI_API_KEY || '')
        : (openaiApiKey || process.env.OPENAI_BEARER_TOKEN || '');
    return analyzeWithBatching(csvData, botSummary, goals, model, apiKey, botTitle || 'Bot Analysis', progressFn, originalCsvStats);
};
