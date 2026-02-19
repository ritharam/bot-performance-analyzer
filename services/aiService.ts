
import { ConversationRow, StandardLogRow, AnalysisResult, ModelOption } from "../types";
import { analyzeWithGemini } from "./geminiService";
import { analyzeWithOpenAI } from "./openaiService";

export const analyzeConversations = async (
    csvData: ConversationRow[],
    botSummary: string,
    goals: string,
    model: ModelOption,
    customGeminiKey?: string,
    customOpenAIKey?: string,
    standardLogData?: any[],
    chatLogData?: any[]
): Promise<AnalysisResult> => {
    if (model === 'gemini-flash') {
        return analyzeWithGemini(csvData, botSummary, goals, customGeminiKey, standardLogData, chatLogData);
    } else {
        // OpenAI models
        return analyzeWithOpenAI(csvData, botSummary, goals, model, customOpenAIKey, standardLogData, chatLogData);
    }
};
