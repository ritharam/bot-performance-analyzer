import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import XLSXStyle from 'xlsx-js-style';
import Papa from 'papaparse';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { analyzeConversations, analyzeConversationsWithBatching } from './services/aiService';
import { generateBotSummary } from './services/botProcessor';
import { ConversationRow, AnalysisSummary, AnalysisResult, BucketRecommendation, ModelOption, BatchAnalysisProgress } from './types';

// Access globally loaded PDF libraries
declare const html2canvas: any;
declare const jspdf: any;

type ViewMode = 'setup' | 'dashboard' | 'report';

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('setup');
  const [botId, setBotId] = useState('');
  const [botTitle, setBotTitle] = useState('');
  const [goals, setGoals] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [csvData, setCsvData] = useState<ConversationRow[]>([]);
  const [standardLogData, setStandardLogData] = useState<any[]>([]);
  const [chatLogData, setChatLogData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [rawBotJson, setRawBotJson] = useState<any>(null);
  const [botSummary, setBotSummary] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [selectedModel, setSelectedModel] = useState<ModelOption>('gpt-4.1');
  const [activeTab, setActiveTab] = useState<'summary' | 'bucket1' | 'bucket2' | 'bucket3' | 'raw'>('summary');
  const [analysisProgress, setAnalysisProgress] = useState<BatchAnalysisProgress | null>(null);
  const [errorState, setErrorState] = useState<{ title: string; message: string; suggestion?: string } | null>(null);
  const [csvStats, setCsvStats] = useState<{ total: number; filteredOut: number; filterStatuses: string[] } | null>(null);

  // Filter States for Raw Data
  const [filterCluster, setFilterCluster] = useState<string>('');
  const [filterOutcome, setFilterOutcome] = useState<string>('');
  const [filterTopic, setFilterTopic] = useState<string>('');
  const [csvLoadMessage, setCsvLoadMessage] = useState<string>('');
  const [chatLogSessionCount, setChatLogSessionCount] = useState<number>(0);

  useEffect(() => {
    setFilterCluster('');
    setFilterOutcome('');
    setFilterTopic('');
  }, [analysisResult]);

  const uniqueFilters = useMemo(() => {
    if (!analysisResult) return { outcomes: [], topics: [] };
    const rowsInScope = analysisResult.categorizedRows.filter((r: any) =>
      filterCluster === '' || (r.BUCKET || '0').trim() === filterCluster
    );
    const outcomes = Array.from(new Set(rowsInScope.map((r: any) => (r.RESOLUTION_STATUS || '').trim()).filter(Boolean))).sort();
    const topics = Array.from(new Set(rowsInScope.map((r: any) => (r.TOPIC || '').trim()).filter(Boolean))).sort();
    return { outcomes, topics };
  }, [analysisResult, filterCluster]);

  useEffect(() => {
    if (filterOutcome !== '' && !uniqueFilters.outcomes.includes(filterOutcome)) setFilterOutcome('');
    if (filterTopic !== '' && !uniqueFilters.topics.includes(filterTopic)) setFilterTopic('');
  }, [filterCluster, uniqueFilters, filterOutcome, filterTopic]);

  const handleManualJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          setRawBotJson(data);

          // Try to extract botId and botTitle from JSON if it's a standard Yellow.ai export
          const extractedId = data?.data?.bot || data?.bot || '';
          if (extractedId) setBotId(extractedId);

          const extractedTitle = data?.data?.botName || data?.botName || data?.title || '';
          if (extractedTitle) setBotTitle(extractedTitle);

          setBotSummary(generateBotSummary(data));
          alert("Bot JSON uploaded successfully.");
        } catch (err) { alert("Invalid JSON file format."); }
      };
      reader.readAsText(file);
    }
  };

  const handleSummaryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setBotSummary(content);
        setRawBotJson(null); // Clear JSON if summary is uploaded directly
        alert("Summary file uploaded successfully.");
      };
      reader.readAsText(file);
    }
  };

  const downloadSummaryTxt = () => {
    if (!botSummary) return;
    const element = document.createElement("a");
    const file = new Blob([botSummary], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `bot_summary_${botId || 'manual'}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data as any[];
          const totalCount = rows.length;
          const allowedStatuses = new Set(['unresolved', 'partially_resolved', 'resolution_attempted', 'user_drop_off']);
          const mapped = rows.map((r) => ({
            CHATURL: r.CHATURL || '',
            TOPIC: r.TOPIC || '',
            USER_QUERY: r.USER_QUERY || '',
            RESOLUTION: r.RESOLUTION || '',
            RESOLUTION_STATUS: r.RESOLUTION_STATUS || '',
            RESOLUTION_STATUS_REASONING: r.RESOLUTION_STATUS_REASONING || '',
            TOPIC_DESCRIPTION: r.TOPIC_DESCRIPTION || '',
            TIME_STAMP: r.TIME_STAMP || r.CONVERSATION_START_TIME || '',
            USER_ID: r.USER_ID || '',
            USER_SENTIMENT: r.USER_SENTIMENT || '',
            APPROVAL_STATUS: 'Pending' as 'Pending' | 'Yes' | 'No'
          }));
          const filtered = mapped.filter((r) => allowedStatuses.has((r.RESOLUTION_STATUS || '').toLowerCase().trim()));
          setCsvData(filtered);
          setCsvStats({
            total: totalCount,
            filteredOut: totalCount - filtered.length,
            filterStatuses: Array.from(allowedStatuses)
          });
          setCsvLoadMessage(`${filtered.length} of ${totalCount} rows loaded (resolved conversations excluded)`);
        }
      });
    }
  };

  const handleStandardLogUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data as any[];
          setStandardLogData(rows.map((r) => ({
            CALL_ID: r.CALL_ID || '',
            CALL_DURATION: r.CALL_DURATION || '',
            HANGUP_REASON: r.HANGUP_REASON || '',
            HANGUP_SOURCE: r.HANGUP_SOURCE || '',
            RECORDING_URL: r.RECORDING_URL || '',
            CONVERSATION_SUMMARY: r.CONVERSATION_SUMMARY || '',
            USER_SUMMARY: r.USER_SUMMARY || '',
            BOT_SUMMARY: r.BOT_SUMMARY || ''
          })));
          alert("Voice Logs uploaded successfully.");
        }
      });
    }
  };

  const handleChatLogUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data as any[];
          const mapped = rows.map((r) => ({
            'Created Date': r['Created Date'] || '',
            'Bot Id': r['Bot Id'] || '',
            'UID': r['UID'] || '',
            'Message': r['Message'] || r.Message || '',
            'Message Type': r['Message Type'] || '',
            'Session Id': r['Session Id'] || '',
            'Journey:Step': r['Journey:Step'] || '',
            'Source': r['Source'] || '',
            'Interaction medium': r['Interaction medium'] || '',
            'Node type': r['Node type'] || '',
            'Feedback': r['Feedback'] || '',
            'Language': r['Language'] || '',
            'Translated message': r['Translated message'] || '',
            'User_Summary': r['User_Summary'] || '',
            'Bot_Summary': r['Bot_Summary'] || '',
            'Conversation_Summary': r['Conversation_Summary'] || ''
          }));
          setChatLogData(mapped);
          // Count unique sessions for accurate display
          const uniqueSessions = new Set(mapped.map(r => r['Session Id']).filter(Boolean)).size;
          setChatLogSessionCount(uniqueSessions);
          alert(`Chat Logs uploaded: ${rows.length} messages across ${uniqueSessions} sessions.`);
        }
      });
    }
  };

  const startAnalysis = async () => {
    if (!botSummary || (csvData.length === 0 && standardLogData.length === 0 && chatLogData.length === 0)) return alert("Please configure bot context and upload chat logs.");
    setLoading(true);
    try {
      const result = await analyzeConversationsWithBatching(
        csvData,
        botSummary,
        goals,
        selectedModel,
        geminiApiKey,
        openaiApiKey,
        standardLogData,
        chatLogData,
        setAnalysisProgress,
        botTitle || botId || 'Bot Analysis',
        csvStats || undefined
      );
      setAnalysisResult(result);

      setAnalysisProgress(null);
      setViewMode('dashboard');
      setActiveTab('summary');
    } catch (error: any) {
      const message = error.message || String(error);
      let title = "Analysis Failed";
      let suggestion = "Please check your connection and try again.";

      if (message.includes("401") || message.includes("Invalid API Key")) {
        title = "Authentication Error";
        suggestion = "Your API Key appears to be invalid or expired. Please check your settings.";
      } else if (message.includes("429") || message.includes("Quota")) {
        title = "Usage Limit Exceeded";
        suggestion = "You've hit the rate limit or quota for your API key. Please wait a moment or check your billing.";
      } else if (message.includes("500") || message.includes("503")) {
        title = "AI Service Error";
        suggestion = "The AI service is experiencing issues. We've already retried, but it's still down. Please try again later.";
      }

      setErrorState({ title, message, suggestion });
    } finally { setLoading(false); }
  };

  const summary = useMemo<AnalysisSummary>(() => {
    if (!analysisResult) return { totalChats: 0, statusBreakdown: {}, bucketDistribution: {} };
    const stats: Record<string, number> = {};
    const bDist: Record<string, number> = { '1': 0, '2': 0, '3': 0 };
    analysisResult.categorizedRows.forEach((r: any) => {
      const statusKey = (r.RESOLUTION_STATUS || 'Unknown').trim();
      stats[statusKey] = (stats[statusKey] || 0) + 1;
      if (r.BUCKET && r.BUCKET !== '0') bDist[r.BUCKET] = (bDist[r.BUCKET] || 0) + 1;
    });
    return { totalChats: analysisResult.categorizedRows.length, statusBreakdown: stats, bucketDistribution: bDist };
  }, [analysisResult]);

  const filteredRows = useMemo(() => {
    if (!analysisResult) return [];
    return analysisResult.categorizedRows.filter((r: any) => {
      const rBucket = (r.BUCKET || '0').trim();
      const rOutcome = (r.RESOLUTION_STATUS || '').trim();
      const rTopic = (r.TOPIC || '').trim();
      const matchCluster = filterCluster === '' || rBucket === filterCluster;
      const matchOutcome = filterOutcome === '' || rOutcome === filterOutcome;
      const matchTopic = filterTopic === '' || rTopic === filterTopic;
      return matchCluster && matchOutcome && matchTopic;
    });
  }, [analysisResult, filterCluster, filterOutcome, filterTopic]);

  const handleExportPdf = async () => {
    const reportElement = document.getElementById('report-content');
    if (!reportElement) return;
    setLoading(true);
    try {
      const originalStyle = reportElement.getAttribute('style') || '';
      reportElement.style.height = 'auto';
      reportElement.style.overflow = 'visible';
      reportElement.style.maxWidth = 'none';
      reportElement.style.boxShadow = 'none';
      await new Promise(resolve => setTimeout(resolve, 100));
      const canvas = await html2canvas(reportElement, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff', windowWidth: reportElement.scrollWidth, windowHeight: reportElement.scrollHeight });
      reportElement.setAttribute('style', originalStyle);
      const imgData = canvas.toDataURL('image/png');
      const { jsPDF } = jspdf;
      const pdf = new jsPDF('l', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      const pageHeight = pdf.internal.pageSize.getHeight();
      let heightLeft = pdfHeight;
      let position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`${botTitle || botId || 'Audit_Report'}.pdf`);
    } catch (err) { alert("PDF generation failed."); } finally { setLoading(false); }
  };

  const handleExportExcel = () => {
    if (!analysisResult) return;


    // ─── Detect data type ────────────────────────────────────────────────────
    const rows: any[] = analysisResult.categorizedRows;
    const isVoiceLog = rows.length > 0 && 'CALL_ID' in rows[0];
    const isChatLog = rows.length > 0 && 'Session Id' in rows[0];

    // ─── CRA Data: Full styled workbook via xlsx-js-style ────────────────────
    if (!isVoiceLog && !isChatLog) {
      const SX = XLSXStyle;
      const enc = SX.utils.encode_cell;

      // Color palette (matches Decathlon reference)
      const DARK_SLATE = '34495E';
      const WHITE = 'FFFFFF';
      const RED_BG = 'E74C3C';
      const ORANGE_BG = 'E67E22';
      const GREEN_BG = '27AE60';
      const LIGHT_RED = 'FADBD8';
      const LIGHT_ORANGE = 'FAE5D3';
      const LIGHT_GREEN = 'D5F4E6';
      const BLUE_KPI = 'D6EAF8';
      const ROW_ALT = 'F2F3F4';

      const mkFont = (bold: boolean, sz: number, rgb = '000000') =>
        ({ bold, sz, name: 'Calibri', color: { rgb } });
      const mkFill = (rgb: string) =>
        ({ patternType: 'solid' as const, fgColor: { rgb } });
      const mkAlign = (horizontal: string, vertical = 'center', wrapText = false) =>
        ({ horizontal, vertical, wrapText });
      const mkBorder = () => ({
        top: { style: 'thin' as const, color: { rgb: 'D5D8DC' } },
        bottom: { style: 'thin' as const, color: { rgb: 'D5D8DC' } },
        left: { style: 'thin' as const, color: { rgb: 'D5D8DC' } },
        right: { style: 'thin' as const, color: { rgb: 'D5D8DC' } },
      });

      const noFillBase = { patternType: 'none' as const };

      const cs = (v: any, s: any) => ({ v: v ?? '', s, t: 's' as const });
      const cn = (v: number, s: any) => ({ v, s, t: 'n' as const });
      const plainStyle = { font: mkFont(false, 11), fill: noFillBase, alignment: mkAlign('left', 'center') };
      const plain = (v: any) => ({ v: v ?? '', t: 's' as const, s: plainStyle });

      const hdrStyle = (rgb: string) => ({
        font: mkFont(true, 10, WHITE),
        fill: mkFill(rgb),
        alignment: mkAlign('center', 'center'),
        border: mkBorder(),
      });
      const bgStyle = (rgb: string) => ({
        font: mkFont(false, 9),
        fill: mkFill(rgb),
        alignment: mkAlign('left', 'center', true),
        border: mkBorder(),
      });
      const bgCStyle = (rgb: string) => ({
        font: mkFont(false, 9),
        fill: mkFill(rgb),
        alignment: mkAlign('center', 'center'),
        border: mkBorder(),
      });
      const dataStyle = {
        font: mkFont(false, 9),
        fill: noFillBase,
        alignment: mkAlign('left', 'center', true),
        border: mkBorder(),
      };
      const dataCStyle = {
        font: mkFont(false, 9),
        fill: noFillBase,
        alignment: mkAlign('center', 'center'),
        border: mkBorder(),
      };

      // ── Helper: sanitise Python "None" / "null" / empty strings ─────────────
      const clean = (v: any): string => {
        if (v === null || v === undefined) return '';
        const s = String(v).trim();
        if (s === 'None' || s === 'none' || s === 'null' || s === 'NULL' || s === 'N/A' || s === 'na' || s === 'NA') return '';
        return s;
      };
      const cleanOr = (v: any, fallback: string): string => clean(v) || fallback;

      // ── Derived counts — computed directly from categorizedRows ──────────────
      // Do NOT rely on rec.count (AI may return 0 for indices[]). Instead count
      // how many rows in categorizedRows actually carry each bucket assignment.
      const totalChats = rows.length;
      const b1Count = rows.filter((r: any) => r.BUCKET === '1').length;
      const b2Count = rows.filter((r: any) => r.BUCKET === '2').length;
      const b3Count = rows.filter((r: any) => r.BUCKET === '3').length;
      const successCount = rows.filter((r: any) => !r.BUCKET || r.BUCKET === '0').length;
      const unsuccessCount = b1Count + b2Count + b3Count;
      const successRate = totalChats > 0 ? ((successCount / totalChats) * 100).toFixed(1) + '%' : '0%';

      // ── Per-rec counts: residual method ─────────────────────────────────────
      // The AI assigns rows to recs via indices[]. When a rec has count=0 it means
      // its indices array was empty — the residual rows (bktTotal - knownCounts) belong
      // to it. We compute a resolved count per rec using:
      //   knownCount  = rec.count if > 0  (set by processBucket from rec.indices.length)
      //   missingRecs = recs where count === 0
      //   residual    = bktTotal - sum(knownCounts), split evenly across missingRecs
      const resolveRecCounts = (
        recs: BucketRecommendation[],
        bktTotal: number
      ): Map<BucketRecommendation, number> => {
        const result = new Map<BucketRecommendation, number>();
        const knownSum = recs.reduce((s, r) => s + (r.count > 0 ? r.count : 0), 0);
        const missing = recs.filter(r => !(r.count > 0));
        const residual = Math.max(0, bktTotal - knownSum);
        const perMissing = missing.length > 0 ? Math.round(residual / missing.length) : 0;
        recs.forEach(r => {
          result.set(r, r.count > 0 ? r.count : perMissing);
        });
        return result;
      };

      const b1Counts = resolveRecCounts(analysisResult.recommendations.bucket1, b1Count);
      const b2Counts = resolveRecCounts(analysisResult.recommendations.bucket2, b2Count);
      const b3Counts = resolveRecCounts(analysisResult.recommendations.bucket3, b3Count);

      const getRecCount = (rec: BucketRecommendation, bucketId: string): number => {
        const map = bucketId === '1' ? b1Counts : bucketId === '2' ? b2Counts : b3Counts;
        return map.get(rec) ?? 0;
      };

      // ── Row → Issue Category (strict whitelist, no fallback guessing) ─────────
      // Valid Issue Category values are STRICTLY the rec.topic strings written into
      // the bucket sheets. A row only gets an Issue Category if its ISSUE_CATEGORY
      // field (stamped by the AI pipeline in batchAnalysisService) is present AND
      // exists in that bucket's exact whitelist. No fuzzy matching, no fallbacks,
      // no cross-bucket bleed. If unconfirmed → cell stays empty.

      // Step 1: Build per-bucket whitelists from the actual rec.topic values
      const validRecTopics: Record<string, Set<string>> = {
        '1': new Set(analysisResult.recommendations.bucket1.map((r: BucketRecommendation) => r.topic)),
        '2': new Set(analysisResult.recommendations.bucket2.map((r: BucketRecommendation) => r.topic)),
        '3': new Set(analysisResult.recommendations.bucket3.map((r: BucketRecommendation) => r.topic)),
      };

      // Step 2: For each row, accept ISSUE_CATEGORY only if it is in that row's
      // bucket's whitelist. Reject anything else — leave the cell blank.
      const rowIssueCatMap = new Map<number, string>();
      rows.forEach((r: any, idx: number) => {
        const bkt = r.BUCKET || '0';
        if (bkt !== '1' && bkt !== '2' && bkt !== '3') return; // not bucketed → skip
        const allowed = validRecTopics[bkt];
        if (!allowed || allowed.size === 0) return;
        const ic = clean((r as any).ISSUE_CATEGORY);
        // Only set if the value is exactly in the whitelist for THIS bucket
        if (ic && allowed.has(ic)) {
          rowIssueCatMap.set(idx, ic);
        }
        // No fallback — if unconfirmed, the cell will be empty
      });

      const reportTitle = `${botTitle || 'Chat Bot'} — Resolution Analysis`;
      const analysisDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const generatedAt = `Generated on ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

      // ── Outcome, sentiment & topic aggregations ──────────────────────────────
      const outcomeCounts: Record<string, number> = {};
      const sentimentCounts: Record<string, number> = {};
      const interactionTypes: Record<string, number> = {};
      rows.forEach((r: any) => {
        const ok = cleanOr(r.RESOLUTION_STATUS, 'Unknown');
        outcomeCounts[ok] = (outcomeCounts[ok] || 0) + 1;
        const sk = cleanOr(r.USER_SENTIMENT, 'Unknown');
        sentimentCounts[sk] = (sentimentCounts[sk] || 0) + 1;
        const ik = cleanOr(r.TOPIC, 'General');
        interactionTypes[ik] = (interactionTypes[ik] || 0) + 1;
      });

      // =======================================================================
      // SHEET 1 — Executive Summary
      // =======================================================================
      const wsE: any = {};
      const mE: any[] = [];
      let eR = 0;

      // Title (plain — no fill)
      wsE[enc({ c: 0, r: eR })] = plain(reportTitle);
      mE.push({ s: { c: 0, r: eR }, e: { c: 6, r: eR } });
      eR++;

      // Subtitle
      wsE[enc({ c: 0, r: eR })] = plain(`Analysis Period: ${analysisDate} | Total Chats: ${totalChats}`);
      mE.push({ s: { c: 0, r: eR }, e: { c: 6, r: eR } });
      eR++;

      // Generated
      wsE[enc({ c: 0, r: eR })] = plain(generatedAt);
      mE.push({ s: { c: 0, r: eR }, e: { c: 6, r: eR } });
      eR++;

      eR++; // blank

      // KPI values row (B=Total, D=SuccessRate, F=Unsuccessful)
      wsE[enc({ c: 1, r: eR })] = cn(totalChats, { font: mkFont(true, 22, '2C3E50'), fill: mkFill(BLUE_KPI), alignment: mkAlign('center'), border: mkBorder() });
      wsE[enc({ c: 3, r: eR })] = cs(successRate, { font: mkFont(true, 22, '27AE60'), fill: mkFill(LIGHT_GREEN), alignment: mkAlign('center'), border: mkBorder() });
      wsE[enc({ c: 5, r: eR })] = cn(unsuccessCount, { font: mkFont(true, 22, 'C0392B'), fill: mkFill(LIGHT_RED), alignment: mkAlign('center'), border: mkBorder() });
      mE.push({ s: { c: 1, r: eR }, e: { c: 2, r: eR } });
      mE.push({ s: { c: 3, r: eR }, e: { c: 4, r: eR } });
      mE.push({ s: { c: 5, r: eR }, e: { c: 6, r: eR } });
      eR++;

      // KPI labels row
      wsE[enc({ c: 1, r: eR })] = cs('Total Chats', { font: mkFont(true, 9, '2C3E50'), fill: mkFill(BLUE_KPI), alignment: mkAlign('center'), border: mkBorder() });
      wsE[enc({ c: 3, r: eR })] = cs('Success Rate', { font: mkFont(true, 9, '27AE60'), fill: mkFill(LIGHT_GREEN), alignment: mkAlign('center'), border: mkBorder() });
      wsE[enc({ c: 5, r: eR })] = cs('Unsuccessful Chats', { font: mkFont(true, 9, 'C0392B'), fill: mkFill(LIGHT_RED), alignment: mkAlign('center'), border: mkBorder() });
      mE.push({ s: { c: 1, r: eR }, e: { c: 2, r: eR } });
      mE.push({ s: { c: 3, r: eR }, e: { c: 4, r: eR } });
      mE.push({ s: { c: 5, r: eR }, e: { c: 6, r: eR } });
      eR++;

      eR++; // blank

      // Bucket counts row
      wsE[enc({ c: 1, r: eR })] = cn(b1Count, { font: mkFont(true, 18, 'C0392B'), fill: mkFill(LIGHT_RED), alignment: mkAlign('center'), border: mkBorder() });
      wsE[enc({ c: 3, r: eR })] = cn(b2Count, { font: mkFont(true, 18, 'D35400'), fill: mkFill(LIGHT_ORANGE), alignment: mkAlign('center'), border: mkBorder() });
      wsE[enc({ c: 5, r: eR })] = cn(b3Count, { font: mkFont(true, 18, '1E8449'), fill: mkFill(LIGHT_GREEN), alignment: mkAlign('center'), border: mkBorder() });
      mE.push({ s: { c: 1, r: eR }, e: { c: 2, r: eR } });
      mE.push({ s: { c: 3, r: eR }, e: { c: 4, r: eR } });
      mE.push({ s: { c: 5, r: eR }, e: { c: 6, r: eR } });
      eR++;

      // Bucket label row
      wsE[enc({ c: 1, r: eR })] = cs('Bucket 1: New Workflow Required', { font: mkFont(true, 9, 'C0392B'), fill: mkFill(LIGHT_RED), alignment: mkAlign('center'), border: mkBorder() });
      wsE[enc({ c: 3, r: eR })] = cs('Bucket 2: Logic Fix Required', { font: mkFont(true, 9, 'D35400'), fill: mkFill(LIGHT_ORANGE), alignment: mkAlign('center'), border: mkBorder() });
      wsE[enc({ c: 5, r: eR })] = cs('Bucket 3: KB / Script Update', { font: mkFont(true, 9, '1E8449'), fill: mkFill(LIGHT_GREEN), alignment: mkAlign('center'), border: mkBorder() });
      mE.push({ s: { c: 1, r: eR }, e: { c: 2, r: eR } });
      mE.push({ s: { c: 3, r: eR }, e: { c: 4, r: eR } });
      mE.push({ s: { c: 5, r: eR }, e: { c: 6, r: eR } });
      eR++;

      eR++; // blank

      // ── Chat Outcome Distribution ──────────────────────────────────────────
      wsE[enc({ c: 0, r: eR })] = plain('Chat Outcome Distribution');
      mE.push({ s: { c: 0, r: eR }, e: { c: 6, r: eR } });
      eR++;

      ['Chat Outcome', 'Count', '% of Total'].forEach((h, ci) => {
        wsE[enc({ c: ci, r: eR })] = cs(h, hdrStyle(DARK_SLATE));
      });
      eR++;

      Object.entries(outcomeCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([status, count], idx) => {
          const pct = totalChats > 0 ? ((count / totalChats) * 100).toFixed(1) + '%' : '0%';
          const alt = idx % 2 === 0 ? ROW_ALT : '';
          wsE[enc({ c: 0, r: eR })] = cs(status, alt ? bgStyle(alt) : dataStyle);
          wsE[enc({ c: 1, r: eR })] = cn(count, alt ? bgCStyle(alt) : dataCStyle);
          wsE[enc({ c: 2, r: eR })] = cs(pct, alt ? bgCStyle(alt) : dataCStyle);
          eR++;
        });

      eR++; // blank

      // ── User Sentiment Analysis ────────────────────────────────────────────
      wsE[enc({ c: 0, r: eR })] = plain('User Sentiment Analysis');
      mE.push({ s: { c: 0, r: eR }, e: { c: 6, r: eR } });
      eR++;

      ['Sentiment', 'Count', '% of Total'].forEach((h, ci) => {
        wsE[enc({ c: ci, r: eR })] = cs(h, hdrStyle(DARK_SLATE));
      });
      eR++;

      Object.entries(sentimentCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([sentiment, count], idx) => {
          const pct = totalChats > 0 ? ((count / totalChats) * 100).toFixed(1) + '%' : '0%';
          const alt = idx % 2 === 0 ? ROW_ALT : '';
          wsE[enc({ c: 0, r: eR })] = cs(sentiment, alt ? bgStyle(alt) : dataStyle);
          wsE[enc({ c: 1, r: eR })] = cn(count, alt ? bgCStyle(alt) : dataCStyle);
          wsE[enc({ c: 2, r: eR })] = cs(pct, alt ? bgCStyle(alt) : dataCStyle);
          eR++;
        });

      eR++; // blank

      // ── Interaction Type Breakdown ─────────────────────────────────────────
      wsE[enc({ c: 0, r: eR })] = plain('Interaction Type Breakdown');
      mE.push({ s: { c: 0, r: eR }, e: { c: 6, r: eR } });
      eR++;

      ['Type', 'Count', '% of Total'].forEach((h, ci) => {
        wsE[enc({ c: ci, r: eR })] = cs(h, hdrStyle(DARK_SLATE));
      });
      eR++;

      Object.entries(interactionTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([type, count], idx) => {
          const pct = totalChats > 0 ? ((count / totalChats) * 100).toFixed(1) + '%' : '0%';
          const alt = idx % 2 === 0 ? ROW_ALT : '';
          wsE[enc({ c: 0, r: eR })] = cs(type, alt ? bgStyle(alt) : dataStyle);
          wsE[enc({ c: 1, r: eR })] = cn(count, alt ? bgCStyle(alt) : dataCStyle);
          wsE[enc({ c: 2, r: eR })] = cs(pct, alt ? bgCStyle(alt) : dataCStyle);
          eR++;
        });

      eR++; // blank

      // ── Bucket Classification Summary ──────────────────────────────────────
      wsE[enc({ c: 0, r: eR })] = plain('Bucket Classification Summary');
      mE.push({ s: { c: 0, r: eR }, e: { c: 8, r: eR } });
      eR++;

      ['Bucket #', 'Bucket Label', 'Chat Count', '% of Unsuccessful', 'Priority', 'Definition'].forEach((h, ci) => {
        wsE[enc({ c: ci, r: eR })] = cs(h, hdrStyle(DARK_SLATE));
      });
      eR++;

      [
        { num: '1', label: 'New Workflow Required', def: 'User intent outside bot scope — new flows needed', cnt: b1Count, accent: RED_BG, light: LIGHT_RED },
        { num: '2', label: 'Logic Fix Required', def: 'Existing flow breaks or produces incorrect output', cnt: b2Count, accent: ORANGE_BG, light: LIGHT_ORANGE },
        { num: '3', label: 'KB / Script Update', def: 'Flow works but content/KB is incomplete or wrong', cnt: b3Count, accent: GREEN_BG, light: LIGHT_GREEN },
      ].forEach(({ num, label, def, cnt, accent }) => {
        const pct = unsuccessCount > 0 ? ((cnt / unsuccessCount) * 100).toFixed(1) + '%' : '0%';
        wsE[enc({ c: 0, r: eR })] = cs(num, { font: mkFont(true, 9, WHITE), fill: mkFill(accent), alignment: mkAlign('center'), border: mkBorder() });
        wsE[enc({ c: 1, r: eR })] = cs(label, dataStyle);
        wsE[enc({ c: 2, r: eR })] = cn(cnt, dataCStyle);
        wsE[enc({ c: 3, r: eR })] = cs(pct, dataCStyle);
        wsE[enc({ c: 4, r: eR })] = cs(num === '1' ? 'High' : num === '2' ? 'Medium' : 'Low', dataCStyle);
        wsE[enc({ c: 5, r: eR })] = cs(def, { font: mkFont(false, 9), fill: noFillBase, alignment: mkAlign('left', 'center', true), border: mkBorder() });
        eR++;
      });

      eR++; // blank

      // ── Prioritization Roadmap ─────────────────────────────────────────────
      wsE[enc({ c: 0, r: eR })] = plain('Prioritization Roadmap');
      mE.push({ s: { c: 0, r: eR }, e: { c: 8, r: eR } });
      eR++;

      ['Priority', 'Issue Category', 'Bucket', 'Chat Count', 'Goal Alignment', 'Strategic Priority', 'KPI to Watch', 'Problem Statement', 'Recommended Action'].forEach((h, ci) => {
        wsE[enc({ c: ci, r: eR })] = cs(h, hdrStyle(DARK_SLATE));
      });
      eR++;

      const allRecs: Array<{ rec: BucketRecommendation; bucket: string; light: string }> = [
        ...analysisResult.recommendations.bucket1.map((r: BucketRecommendation) => ({ rec: r, bucket: '1', light: LIGHT_RED })),
        ...analysisResult.recommendations.bucket2.map((r: BucketRecommendation) => ({ rec: r, bucket: '2', light: LIGHT_ORANGE })),
        ...analysisResult.recommendations.bucket3.map((r: BucketRecommendation) => ({ rec: r, bucket: '3', light: LIGHT_GREEN })),
      ].sort((a, b) => (b.rec.goalAlignmentScore || 0) - (a.rec.goalAlignmentScore || 0));

      allRecs.forEach(({ rec, bucket, light }, idx) => {
        const rowStyle = (wt = false) => ({
          font: mkFont(false, 9),
          fill: mkFill(light),
          alignment: mkAlign(wt ? 'left' : 'center', 'center', wt),
          border: mkBorder(),
        });
        const cnt = getRecCount(rec, bucket);
        wsE[enc({ c: 0, r: eR })] = cn(idx + 1, rowStyle());
        wsE[enc({ c: 1, r: eR })] = cs(rec.topic, rowStyle(true));
        wsE[enc({ c: 2, r: eR })] = cs(`Bucket ${bucket}`, rowStyle());
        wsE[enc({ c: 3, r: eR })] = cn(cnt, rowStyle());
        wsE[enc({ c: 4, r: eR })] = cn(rec.goalAlignmentScore || 0, rowStyle());
        wsE[enc({ c: 5, r: eR })] = cs(rec.strategicPriority, rowStyle());
        wsE[enc({ c: 6, r: eR })] = cs(cleanOr(rec.kpiToWatch, '—'), rowStyle(true));
        wsE[enc({ c: 7, r: eR })] = cs(cleanOr(rec.problemStatement, '—'), rowStyle(true));
        wsE[enc({ c: 8, r: eR })] = cs(cleanOr(rec.recommendation, '—'), rowStyle(true));
        eR++;
      });

      wsE['!ref'] = SX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 8, r: eR } });
      wsE['!merges'] = mE;
      wsE['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 16 }, { wch: 35 }, { wch: 40 }, { wch: 40 }];

      // =======================================================================
      // SHEET 2 — Bucket 1: New Workflow Required
      // =======================================================================
      const wsB1: any = {};
      const mB1: any[] = [];
      const b1Recs: BucketRecommendation[] = analysisResult.recommendations.bucket1;

      wsB1[enc({ c: 0, r: 0 })] = plain(`Bucket 1: New Workflow Required`);
      mB1.push({ s: { c: 0, r: 0 }, e: { c: 9, r: 0 } });
      wsB1[enc({ c: 0, r: 1 })] = plain(`Total: ${b1Count} chats | ${unsuccessCount > 0 ? ((b1Count / unsuccessCount) * 100).toFixed(1) : '0'}% of unsuccessful`);
      mB1.push({ s: { c: 0, r: 1 }, e: { c: 9, r: 1 } });

      const b1Hdr = ['Priority', 'Issue Category', 'Chat Count', '% of Bucket', 'Problem Description', 'Root Cause', 'Transcript Excerpts', 'Recommended Fix', 'Complexity', 'Approval Status'];
      b1Hdr.forEach((h, ci) => { wsB1[enc({ c: ci, r: 3 })] = cs(h, hdrStyle(RED_BG)); });

      b1Recs.forEach((rec, idx) => {
        const r = idx + 4;
        const cnt = getRecCount(rec, '1');
        const pct = b1Count > 0 ? ((cnt / b1Count) * 100).toFixed(1) + '%' : '0%';
        const alt = idx % 2 === 0 ? LIGHT_RED : '';
        const rs = alt ? bgStyle(alt) : dataStyle;
        const rc = alt ? bgCStyle(alt) : dataCStyle;
        const wrapS = alt
          ? { font: mkFont(false, 9), fill: mkFill(alt), alignment: mkAlign('left', 'center', true), border: mkBorder() }
          : { font: mkFont(false, 9), fill: noFillBase, alignment: mkAlign('left', 'center', true), border: mkBorder() };
        wsB1[enc({ c: 0, r })] = cn(idx + 1, rc);
        wsB1[enc({ c: 1, r })] = cs(rec.topic, rs);
        wsB1[enc({ c: 2, r })] = cn(cnt, rc);
        wsB1[enc({ c: 3, r })] = cs(pct, rc);
        wsB1[enc({ c: 4, r })] = cs(cleanOr(rec.problemStatement, '—'), wrapS);
        wsB1[enc({ c: 5, r })] = cs(cleanOr((rec as any).rootCause || rec.problemStatement, '—'), wrapS);
        wsB1[enc({ c: 6, r })] = cs(rec.examples.slice(0, 2).map(clean).filter(Boolean).join(' | ') || '—', wrapS);
        wsB1[enc({ c: 7, r })] = cs(cleanOr(rec.recommendation, '—'), wrapS);
        wsB1[enc({ c: 8, r })] = cs(rec.strategicPriority, rc);
        wsB1[enc({ c: 9, r })] = cs('Pending', rc);
      });

      const b1LastR = 4 + b1Recs.length;
      wsB1[enc({ c: 0, r: b1LastR })] = plain(`Total: ${b1Count} chats across ${b1Recs.length} categories`);
      mB1.push({ s: { c: 0, r: b1LastR }, e: { c: 9, r: b1LastR } });
      wsB1['!ref'] = SX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 9, r: b1LastR } });
      wsB1['!merges'] = mB1;
      wsB1['!cols'] = [{ wch: 10 }, { wch: 25 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 40 }, { wch: 50 }, { wch: 45 }, { wch: 12 }, { wch: 15 }];

      // =======================================================================
      // SHEET 3 — Bucket 2: Logic Fix Required
      // =======================================================================
      const wsB2: any = {};
      const mB2: any[] = [];
      const b2Recs: BucketRecommendation[] = analysisResult.recommendations.bucket2;

      wsB2[enc({ c: 0, r: 0 })] = plain(`Bucket 2: Logic Fix Required`);
      mB2.push({ s: { c: 0, r: 0 }, e: { c: 9, r: 0 } });
      wsB2[enc({ c: 0, r: 1 })] = plain(`Total: ${b2Count} chats | ${unsuccessCount > 0 ? ((b2Count / unsuccessCount) * 100).toFixed(1) : '0'}% of unsuccessful`);
      mB2.push({ s: { c: 0, r: 1 }, e: { c: 9, r: 1 } });

      const b2Hdr = ['Priority', 'Issue Category', 'Chat Count', '% of Bucket', 'Problem Description', 'Root Cause', 'Transcript Excerpts', 'Recommended Fix', 'Complexity', 'Approval Status'];
      b2Hdr.forEach((h, ci) => { wsB2[enc({ c: ci, r: 3 })] = cs(h, hdrStyle(ORANGE_BG)); });

      b2Recs.forEach((rec, idx) => {
        const r = idx + 4;
        const cnt = getRecCount(rec, '2');
        const pct = b2Count > 0 ? ((cnt / b2Count) * 100).toFixed(1) + '%' : '0%';
        const alt = idx % 2 === 0 ? LIGHT_ORANGE : '';
        const rs = alt ? bgStyle(alt) : dataStyle;
        const rc = alt ? bgCStyle(alt) : dataCStyle;
        const wrapS = alt
          ? { font: mkFont(false, 9), fill: mkFill(alt), alignment: mkAlign('left', 'center', true), border: mkBorder() }
          : { font: mkFont(false, 9), fill: noFillBase, alignment: mkAlign('left', 'center', true), border: mkBorder() };
        wsB2[enc({ c: 0, r })] = cn(idx + 1, rc);
        wsB2[enc({ c: 1, r })] = cs(rec.topic, rs);
        wsB2[enc({ c: 2, r })] = cn(cnt, rc);
        wsB2[enc({ c: 3, r })] = cs(pct, rc);
        wsB2[enc({ c: 4, r })] = cs(cleanOr(rec.problemStatement, '—'), wrapS);
        wsB2[enc({ c: 5, r })] = cs(cleanOr((rec as any).rootCause || rec.problemStatement, '—'), wrapS);
        wsB2[enc({ c: 6, r })] = cs(rec.examples.slice(0, 2).map(clean).filter(Boolean).join(' | ') || '—', wrapS);
        wsB2[enc({ c: 7, r })] = cs(cleanOr(rec.recommendation, '—'), wrapS);
        wsB2[enc({ c: 8, r })] = cs(rec.strategicPriority, rc);
        wsB2[enc({ c: 9, r })] = cs('Pending', rc);
      });

      const b2LastR = 4 + b2Recs.length;
      wsB2[enc({ c: 0, r: b2LastR })] = plain(`Total: ${b2Count} chats across ${b2Recs.length} categories`);
      mB2.push({ s: { c: 0, r: b2LastR }, e: { c: 9, r: b2LastR } });
      wsB2['!ref'] = SX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 9, r: b2LastR } });
      wsB2['!merges'] = mB2;
      wsB2['!cols'] = [{ wch: 10 }, { wch: 25 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 40 }, { wch: 50 }, { wch: 45 }, { wch: 12 }, { wch: 15 }];

      // =======================================================================
      // SHEET 4 — Bucket 3: KB / Script Update
      // =======================================================================
      const wsB3: any = {};
      const mB3: any[] = [];
      const b3Recs: BucketRecommendation[] = analysisResult.recommendations.bucket3;

      wsB3[enc({ c: 0, r: 0 })] = plain(`Bucket 3: KB / Script Update`);
      mB3.push({ s: { c: 0, r: 0 }, e: { c: 9, r: 0 } });
      wsB3[enc({ c: 0, r: 1 })] = plain(`Total: ${b3Count} chats | ${unsuccessCount > 0 ? ((b3Count / unsuccessCount) * 100).toFixed(1) : '0'}% of unsuccessful`);
      mB3.push({ s: { c: 0, r: 1 }, e: { c: 9, r: 1 } });

      const b3Hdr = ['Priority', 'Issue Category', 'Chat Count', '% of Bucket', 'Problem Description', 'Root Cause', 'Transcript Excerpts', 'Recommended Fix', 'Complexity', 'Approval Status'];
      b3Hdr.forEach((h, ci) => { wsB3[enc({ c: ci, r: 3 })] = cs(h, hdrStyle(GREEN_BG)); });

      b3Recs.forEach((rec, idx) => {
        const r = idx + 4;
        const cnt = getRecCount(rec, '3');
        const pct = b3Count > 0 ? ((cnt / b3Count) * 100).toFixed(1) + '%' : '0%';
        const alt = idx % 2 === 0 ? LIGHT_GREEN : '';
        const rs = alt ? bgStyle(alt) : dataStyle;
        const rc = alt ? bgCStyle(alt) : dataCStyle;
        const wrapS = alt
          ? { font: mkFont(false, 9), fill: mkFill(alt), alignment: mkAlign('left', 'center', true), border: mkBorder() }
          : { font: mkFont(false, 9), fill: noFillBase, alignment: mkAlign('left', 'center', true), border: mkBorder() };
        wsB3[enc({ c: 0, r })] = cn(idx + 1, rc);
        wsB3[enc({ c: 1, r })] = cs(rec.topic, rs);
        wsB3[enc({ c: 2, r })] = cn(cnt, rc);
        wsB3[enc({ c: 3, r })] = cs(pct, rc);
        wsB3[enc({ c: 4, r })] = cs(cleanOr(rec.problemStatement, '—'), wrapS);
        wsB3[enc({ c: 5, r })] = cs(cleanOr((rec as any).rootCause || rec.problemStatement, '—'), wrapS);
        wsB3[enc({ c: 6, r })] = cs(rec.examples.slice(0, 2).map(clean).filter(Boolean).join(' | ') || '—', wrapS);
        wsB3[enc({ c: 7, r })] = cs(cleanOr(rec.recommendation, '—'), wrapS);
        wsB3[enc({ c: 8, r })] = cs(rec.strategicPriority, rc);
        wsB3[enc({ c: 9, r })] = cs('Pending', rc);
      });

      const b3LastR = 4 + b3Recs.length;
      wsB3[enc({ c: 0, r: b3LastR })] = plain(`Total: ${b3Count} chats across ${b3Recs.length} categories`);
      mB3.push({ s: { c: 0, r: b3LastR }, e: { c: 9, r: b3LastR } });
      wsB3['!ref'] = SX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 9, r: b3LastR } });
      wsB3['!merges'] = mB3;
      wsB3['!cols'] = [{ wch: 10 }, { wch: 25 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 40 }, { wch: 50 }, { wch: 45 }, { wch: 12 }, { wch: 15 }];

      // =======================================================================
      // SHEET 5 — Raw Data  (11 cols: removed Analysis Type, Start Time, End Time)
      // =======================================================================
      const wsRaw: any = {};
      const mRaw: any[] = [];

      // Col count is now 10 (indices 0-9) — Resolution Status removed
      wsRaw[enc({ c: 0, r: 0 })] = plain(`Raw Data — All ${totalChats} Chats`);
      mRaw.push({ s: { c: 0, r: 0 }, e: { c: 9, r: 0 } });

      const rawHdr = ['Row #', 'Chat URL', 'Chat Outcome', 'Bucket #', 'Bucket Label', 'Issue Category', 'Topic', 'User Query', 'Resolution', 'User Sentiment'];
      rawHdr.forEach((h, ci) => { wsRaw[enc({ c: ci, r: 2 })] = cs(h, hdrStyle(DARK_SLATE)); });

      rows.forEach((r: any, idx) => {
        const rn = idx + 3;
        const bkt = r.BUCKET || '0';
        const isBucketed = bkt === '1' || bkt === '2' || bkt === '3';
        const rowBg = bkt === '1' ? LIGHT_RED : bkt === '2' ? LIGHT_ORANGE : bkt === '3' ? LIGHT_GREEN : '';
        const rs = rowBg ? bgStyle(rowBg) : dataStyle;
        const rc = rowBg ? bgCStyle(rowBg) : dataCStyle;
        const bktAccent = bkt === '1' ? RED_BG : bkt === '2' ? ORANGE_BG : bkt === '3' ? GREEN_BG : DARK_SLATE;
        const bktLabel = bkt === '1' ? 'Bucket 1 - New Workflow Required'
          : bkt === '2' ? 'Bucket 2 - Logic Fix Required'
            : bkt === '3' ? 'Bucket 3 - KB / Script Update'
              : '';

        const rowNumStyle = { font: mkFont(false, 9), fill: rowBg ? mkFill(rowBg) : noFillBase, alignment: mkAlign('right', 'center'), border: mkBorder() };
        const urlLinkStyle = { font: { bold: false, sz: 9, name: 'Calibri', color: { rgb: '1155CC' }, underline: true }, fill: rowBg ? mkFill(rowBg) : noFillBase, alignment: mkAlign('center', 'center'), border: mkBorder() };
        const bktNumStyle = isBucketed
          ? { font: mkFont(true, 9, WHITE), fill: mkFill(bktAccent), alignment: mkAlign('center'), border: mkBorder() }
          : { font: mkFont(false, 9, DARK_SLATE), fill: noFillBase, alignment: mkAlign('center'), border: mkBorder() };
        const wrapRs = { font: mkFont(false, 9), fill: rowBg ? mkFill(rowBg) : noFillBase, alignment: mkAlign('left', 'center', true), border: mkBorder() };

        // Sanitise RESOLUTION — strip Python "None", then try every fallback field
        const resolutionText =
          clean(r.RESOLUTION) ||  // primary field
          clean(r.TOPIC_DESCRIPTION) ||  // CRA CSV: description of what happened
          clean(r.RESOLUTION_STATUS_REASONING) ||  // AI reasoning for resolution status
          clean(r.BOT_SUMMARY) ||  // voice-log style summaries
          clean(r.CONVERSATION_SUMMARY) ||
          clean(r.USER_SUMMARY) ||
          'No resolution recorded';                  // final human-readable fallback

        // Issue Category — only valid values are the exact rec.topic strings from
        // the bucket sheets. Uncategorised rows (bkt='0') get empty string.
        const issueCategory = isBucketed ? (rowIssueCatMap.get(idx) || '') : '';

        wsRaw[enc({ c: 0, r: rn })] = cn(idx + 1, rowNumStyle);
        if (r.CHATURL && clean(r.CHATURL)) {
          wsRaw[enc({ c: 1, r: rn })] = { v: 'Open Chat', t: 's', s: urlLinkStyle, l: { Target: r.CHATURL } };
        } else {
          wsRaw[enc({ c: 1, r: rn })] = cs('—', rc);
        }
        wsRaw[enc({ c: 2, r: rn })] = cs(cleanOr(r.RESOLUTION_STATUS, 'unknown'), rs);
        // Bucket #, Bucket Label, Issue Category: empty for uncategorised rows
        wsRaw[enc({ c: 3, r: rn })] = cs(isBucketed ? bkt : '', bktNumStyle);
        wsRaw[enc({ c: 4, r: rn })] = cs(isBucketed ? bktLabel : '', rs);
        wsRaw[enc({ c: 5, r: rn })] = cs(issueCategory, rs);
        wsRaw[enc({ c: 6, r: rn })] = cs(cleanOr(r.TOPIC, '—'), rs);
        wsRaw[enc({ c: 7, r: rn })] = cs(cleanOr(r.USER_QUERY, '—'), wrapRs);
        wsRaw[enc({ c: 8, r: rn })] = cs(resolutionText, wrapRs);
        wsRaw[enc({ c: 9, r: rn })] = cs(cleanOr(r.USER_SENTIMENT, '—'), rc);
      });

      wsRaw['!ref'] = SX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 9, r: 2 + rows.length } });
      wsRaw['!merges'] = mRaw;
      wsRaw['!cols'] = [{ wch: 7 }, { wch: 18 }, { wch: 22 }, { wch: 9 }, { wch: 30 }, { wch: 30 }, { wch: 25 }, { wch: 45 }, { wch: 55 }, { wch: 15 }];

      // ── Assemble workbook & download via Blob (avoids Chrome HTTP warning) ──
      const wb = SX.utils.book_new();
      SX.utils.book_append_sheet(wb, wsE, 'Executive Summary');
      SX.utils.book_append_sheet(wb, wsB1, 'Bucket 1 - New Workflow');
      SX.utils.book_append_sheet(wb, wsB2, 'Bucket 2 - Logic Fix');
      SX.utils.book_append_sheet(wb, wsB3, 'Bucket 3 - Script Update');
      SX.utils.book_append_sheet(wb, wsRaw, 'Raw Data');

      // Write to ArrayBuffer → Blob → object URL (no Chrome "insecure download" warning)
      const wbOut = SX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${botTitle || botId || 'ChatBot_Resolution_Analysis'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
      return;
    }

    // ─── Chat Log: plain XLSX export ─────────────────────────────────────────
    if (isChatLog) {
      const wb = XLSX.utils.book_new();
      const fmtRecs = (recs: BucketRecommendation[]) => [
        ["Topic", "Priority", "Score", "Problem Statement", "Recommendation", "KPI to Watch", "Examples"],
        ...recs.map(r => [r.topic, r.strategicPriority, r.goalAlignmentScore, r.problemStatement, r.recommendation, r.kpiToWatch, r.examples.join(' | ')])
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fmtRecs(analysisResult.recommendations.bucket1)), "1-Expansion");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fmtRecs(analysisResult.recommendations.bucket2)), "2-Optimization");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fmtRecs(analysisResult.recommendations.bucket3)), "3-KnowledgeGaps");
      const auditHeader = ["Pillar", "Topic", "Session ID", "Created Date", "Journey Step", "Source", "Medium", "Language", "Message", "Translated Message", "Feedback"];
      const auditRows = rows.map((r: any) => {
        const bn = r.BUCKET === '1' ? 'EXPANSION' : r.BUCKET === '2' ? 'OPTIMIZE' : r.BUCKET === '3' ? 'GAPS' : 'RESOLVED';
        return [bn, r.TOPIC, r['Session Id'], r['Created Date'], r['Journey:Step'], r['Source'], r['Interaction medium'], r['Language'], r['Message'], r['Translated message'], r['Feedback']];
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([auditHeader, ...auditRows]), "Full Audit Log");
      const clOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const clBlob = new Blob([clOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const clUrl = URL.createObjectURL(clBlob);
      const clA = document.createElement('a');
      clA.href = clUrl;
      clA.download = `${botTitle || botId || 'ChatLog_Audit_Report'}.xlsx`;
      document.body.appendChild(clA); clA.click();
      setTimeout(() => { URL.revokeObjectURL(clUrl); document.body.removeChild(clA); }, 1000);
      return;
    }

    // ─── VOICE LOGS: Full styled workbook via xlsx-js-style ─────────────────
    // xlsx-js-style is a drop-in fork of xlsx that actually writes cell styles.

    const SX = XLSXStyle; // alias for brevity
    const enc = SX.utils.encode_cell;

    // ── Color palette ────────────────────────────────────────────────────────
    const DARK_SLATE = '34495E';
    const WHITE = 'FFFFFF';
    const RED_BG = 'E74C3C';
    const ORANGE_BG = 'E67E22';
    const GREEN_BG = '27AE60';
    const LIGHT_RED = 'FADBD8';
    const LIGHT_ORANGE = 'FAE5D3';
    const LIGHT_GREEN = 'D5F4E6';
    const ORANGE_SOFT = 'F0B27A';
    const TITLE_BG = 'EBF5FB';
    const ROW_ALT = 'F2F3F4';

    // ── Style builders ───────────────────────────────────────────────────────
    const mkFont = (bold: boolean, sz: number, rgb = '000000') =>
      ({ bold, sz, name: 'Calibri', color: { rgb } });
    const mkFill = (rgb: string) =>
      ({ patternType: 'solid' as const, fgColor: { rgb } });
    const mkAlign = (horizontal: string, vertical = 'center', wrapText = false) =>
      ({ horizontal, vertical, wrapText });
    const mkBorder = () => ({
      top: { style: 'thin' as const, color: { rgb: 'D5D8DC' } },
      bottom: { style: 'thin' as const, color: { rgb: 'D5D8DC' } },
      left: { style: 'thin' as const, color: { rgb: 'D5D8DC' } },
      right: { style: 'thin' as const, color: { rgb: 'D5D8DC' } },
    });

    // Base style objects — all plain objects, no spread of functions
    const titleStyle = {
      font: mkFont(true, 14, DARK_SLATE),
      fill: mkFill(TITLE_BG),
      alignment: mkAlign('center', 'center'),
    };
    const subtitleStyle = {
      font: mkFont(false, 10, '555555'),
      fill: mkFill(TITLE_BG),
      alignment: mkAlign('center', 'center'),
    };
    const genStyle = {
      font: mkFont(false, 9, '888888'),
      fill: mkFill(TITLE_BG),
      alignment: mkAlign('center', 'center'),
    };
    const kpiValStyle = {
      font: mkFont(true, 22, DARK_SLATE),
      alignment: mkAlign('center', 'center'),
      border: mkBorder(),
    };
    const kpiLblStyle = {
      font: mkFont(true, 9, '777777'),
      alignment: mkAlign('center', 'center'),
      border: mkBorder(),
    };
    const dataStyle = {
      font: mkFont(false, 9),
      alignment: mkAlign('left', 'center', true),
      border: mkBorder(),
    };
    const dataCStyle = {
      font: mkFont(false, 9),
      alignment: mkAlign('center', 'center'),
      border: mkBorder(),
    };
    const dataNumStyle = {
      font: mkFont(false, 9),
      alignment: mkAlign('right', 'center'),
      border: mkBorder(),
    };
    const linkStyle = {
      font: { bold: false, sz: 9, name: 'Calibri', color: { rgb: '1155CC' }, underline: true },
      alignment: mkAlign('center', 'center'),
      border: mkBorder(),
    };

    // Per-color helper styles
    const hdrStyle = (rgb: string) => ({
      font: mkFont(true, 10, WHITE),
      fill: mkFill(rgb),
      alignment: mkAlign('center', 'center'),
      border: mkBorder(),
    });
    const bgStyle = (rgb: string) => ({
      font: mkFont(false, 9),
      fill: mkFill(rgb),
      alignment: mkAlign('left', 'center', true),
      border: mkBorder(),
    });
    const bgCStyle = (rgb: string) => ({
      font: mkFont(false, 9),
      fill: mkFill(rgb),
      alignment: mkAlign('center', 'center'),
      border: mkBorder(),
    });

    // Cell constructors
    const cs = (v: any, s: any) => ({ v, s, t: typeof v === 'number' ? 'n' : 's' });
    const cn = (v: number, s: any) => ({ v, s, t: 'n' as const });

    // ── Derived counts ───────────────────────────────────────────────────────
    const b1Count = summary.bucketDistribution['1'] || 0;
    const b2Count = summary.bucketDistribution['2'] || 0;
    const b3Count = summary.bucketDistribution['3'] || 0;
    const totalCalls = rows.length;
    const successCount = rows.filter((r: any) => !r.BUCKET || r.BUCKET === '0').length;
    const unsuccessCount = totalCalls - successCount;
    const successRate = totalCalls > 0 ? ((successCount / totalCalls) * 100).toFixed(1) + '%' : '0%';

    // ── Outcome & hangup aggregations ────────────────────────────────────────
    const outcomeCounts: Record<string, { count: number; totalDur: number }> = {};
    const hangupCounts: Record<string, number> = {};
    rows.forEach((r: any) => {
      const ok = r.TOPIC || r.HANGUP_REASON || 'Unknown';
      if (!outcomeCounts[ok]) outcomeCounts[ok] = { count: 0, totalDur: 0 };
      outcomeCounts[ok].count++;
      outcomeCounts[ok].totalDur += Number(r.CALL_DURATION) || 0;
      const hk = `${r.HANGUP_SOURCE || 'unknown'}|||${r.HANGUP_REASON || 'unknown'}`;
      hangupCounts[hk] = (hangupCounts[hk] || 0) + 1;
    });

    const reportTitle = `${botTitle || 'Voice Bot'} — Call Resolution Analysis`;
    const analysisDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');

    // =========================================================================
    // SHEET 1 — Executive Summary  (no nav row; starts at row 0)
    // =========================================================================
    const wsE: any = {};
    const mE: any[] = [];
    let eR = 0;

    // Title block — rows 0-2
    wsE[enc({ c: 0, r: eR })] = cs(reportTitle, titleStyle);
    mE.push({ s: { c: 0, r: eR }, e: { c: 8, r: eR } }); eR++;

    wsE[enc({ c: 0, r: eR })] = cs(
      `Analysis Period: ${analysisDate} | Total Calls: ${totalCalls} | Workflow: Voice Bot Analysis`,
      subtitleStyle
    );
    mE.push({ s: { c: 0, r: eR }, e: { c: 8, r: eR } }); eR++;

    wsE[enc({ c: 0, r: eR })] = cs(`Generated: ${generatedAt}`, genStyle);
    mE.push({ s: { c: 0, r: eR }, e: { c: 8, r: eR } }); eR++;

    eR++; // blank spacer

    // KPI section header
    wsE[enc({ c: 0, r: eR })] = cs('KEY PERFORMANCE INDICATORS', hdrStyle(DARK_SLATE));
    mE.push({ s: { c: 0, r: eR }, e: { c: 8, r: eR } }); eR++;

    // KPI values
    wsE[enc({ c: 1, r: eR })] = cn(totalCalls, kpiValStyle);
    wsE[enc({ c: 3, r: eR })] = cs(successRate, { ...kpiValStyle, font: mkFont(true, 22, GREEN_BG) });
    wsE[enc({ c: 5, r: eR })] = cn(unsuccessCount, { ...kpiValStyle, font: mkFont(true, 22, RED_BG) });
    mE.push({ s: { c: 1, r: eR }, e: { c: 2, r: eR } });
    mE.push({ s: { c: 3, r: eR }, e: { c: 4, r: eR } });
    mE.push({ s: { c: 5, r: eR }, e: { c: 6, r: eR } }); eR++;

    // KPI labels
    wsE[enc({ c: 1, r: eR })] = cs('Total Calls', kpiLblStyle);
    wsE[enc({ c: 3, r: eR })] = cs('Success Rate', kpiLblStyle);
    wsE[enc({ c: 5, r: eR })] = cs('Unsuccessful Calls', kpiLblStyle);
    mE.push({ s: { c: 1, r: eR }, e: { c: 2, r: eR } });
    mE.push({ s: { c: 3, r: eR }, e: { c: 4, r: eR } });
    mE.push({ s: { c: 5, r: eR }, e: { c: 6, r: eR } }); eR++;

    eR++; // blank spacer

    // Bucket count values
    wsE[enc({ c: 1, r: eR })] = cn(b1Count, { ...kpiValStyle, font: mkFont(true, 18, RED_BG) });
    wsE[enc({ c: 3, r: eR })] = cn(b2Count, { ...kpiValStyle, font: mkFont(true, 18, ORANGE_BG) });
    wsE[enc({ c: 5, r: eR })] = cn(b3Count, { ...kpiValStyle, font: mkFont(true, 18, GREEN_BG) });
    mE.push({ s: { c: 1, r: eR }, e: { c: 2, r: eR } });
    mE.push({ s: { c: 3, r: eR }, e: { c: 4, r: eR } });
    mE.push({ s: { c: 5, r: eR }, e: { c: 6, r: eR } }); eR++;

    // Bucket labels
    wsE[enc({ c: 1, r: eR })] = cs('Bucket 1: New Workflow ▸', { ...kpiLblStyle, font: mkFont(true, 9, RED_BG) });
    wsE[enc({ c: 3, r: eR })] = cs('Bucket 2: Logic Fix ▸', { ...kpiLblStyle, font: mkFont(true, 9, ORANGE_BG) });
    wsE[enc({ c: 5, r: eR })] = cs('Bucket 3: Script Update ▸', { ...kpiLblStyle, font: mkFont(true, 9, GREEN_BG) });
    mE.push({ s: { c: 1, r: eR }, e: { c: 2, r: eR } });
    mE.push({ s: { c: 3, r: eR }, e: { c: 4, r: eR } });
    mE.push({ s: { c: 5, r: eR }, e: { c: 6, r: eR } }); eR++;

    eR++; // blank spacer

    // Outcome distribution
    wsE[enc({ c: 0, r: eR })] = cs('CALL OUTCOME DISTRIBUTION', hdrStyle(DARK_SLATE));
    mE.push({ s: { c: 0, r: eR }, e: { c: 8, r: eR } }); eR++;

    ['Call Outcome / Topic', 'Count', '% of Total', 'Avg Duration (s)'].forEach((h, ci) => {
      wsE[enc({ c: ci, r: eR })] = cs(h, hdrStyle('566573'));
    }); eR++;

    Object.entries(outcomeCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .forEach(([topic, { count, totalDur }], idx) => {
        const pct = ((count / totalCalls) * 100).toFixed(1) + '%';
        const avgDur = count > 0 ? Math.round(totalDur / count) : 0;
        const alt = idx % 2 === 0 ? ROW_ALT : '';
        wsE[enc({ c: 0, r: eR })] = cs(topic, alt ? bgStyle(alt) : dataStyle);
        wsE[enc({ c: 1, r: eR })] = cn(count, alt ? bgCStyle(alt) : dataCStyle);
        wsE[enc({ c: 2, r: eR })] = cs(pct, alt ? bgCStyle(alt) : dataCStyle);
        wsE[enc({ c: 3, r: eR })] = cn(avgDur, alt ? bgCStyle(alt) : dataCStyle);
        eR++;
      });

    eR++; // blank spacer

    // Hangup analysis
    wsE[enc({ c: 0, r: eR })] = cs('HANGUP ANALYSIS', hdrStyle(DARK_SLATE));
    mE.push({ s: { c: 0, r: eR }, e: { c: 8, r: eR } }); eR++;

    ['HANGUP_SOURCE', 'HANGUP_REASON', 'Count', '% of Total'].forEach((h, ci) => {
      wsE[enc({ c: ci, r: eR })] = cs(h, hdrStyle('566573'));
    }); eR++;

    Object.entries(hangupCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([key, cnt], idx) => {
        const [src, rsn] = key.split('|||');
        const pct = ((cnt / totalCalls) * 100).toFixed(1) + '%';
        const alt = idx % 2 === 0 ? ROW_ALT : '';
        wsE[enc({ c: 0, r: eR })] = cs(src, alt ? bgCStyle(alt) : dataCStyle);
        wsE[enc({ c: 1, r: eR })] = cs(rsn, alt ? bgStyle(alt) : dataStyle);
        wsE[enc({ c: 2, r: eR })] = cn(cnt, alt ? bgCStyle(alt) : dataCStyle);
        wsE[enc({ c: 3, r: eR })] = cs(pct, alt ? bgCStyle(alt) : dataCStyle);
        eR++;
      });

    eR++; // blank spacer

    // Bucket classification
    wsE[enc({ c: 0, r: eR })] = cs('BUCKET CLASSIFICATION SUMMARY', hdrStyle(DARK_SLATE));
    mE.push({ s: { c: 0, r: eR }, e: { c: 8, r: eR } }); eR++;

    ['Bucket', 'Label', 'Definition', 'Call Count', '% of Unsuccessful'].forEach((h, ci) => {
      wsE[enc({ c: ci, r: eR })] = cs(h, hdrStyle('566573'));
    }); eR++;

    [
      { num: '1', label: 'Bucket 1 - New Workflow', def: 'User intent outside bot scope OR voicemail/IVR not detected', cnt: b1Count, accent: RED_BG, light: LIGHT_RED },
      { num: '2', label: 'Bucket 2 - Logic Fix', def: 'Workflow exists but fails: loops, VAD errors, flow breaks', cnt: b2Count, accent: ORANGE_BG, light: LIGHT_ORANGE },
      { num: '3', label: 'Bucket 3 - Script Update', def: "Flow works but script content doesn't convert", cnt: b3Count, accent: GREEN_BG, light: LIGHT_GREEN },
    ].forEach(({ num, label, def, cnt, accent, light }) => {
      const pct = unsuccessCount > 0 ? ((cnt / unsuccessCount) * 100).toFixed(1) + '%' : '0%';
      wsE[enc({ c: 0, r: eR })] = cs(num, { font: mkFont(true, 9, WHITE), fill: mkFill(accent), alignment: mkAlign('center'), border: mkBorder() });
      wsE[enc({ c: 1, r: eR })] = cs(label, bgStyle(light));
      wsE[enc({ c: 2, r: eR })] = cs(def, { ...bgStyle(light), alignment: mkAlign('left', 'center', true) });
      wsE[enc({ c: 3, r: eR })] = cn(cnt, bgCStyle(light));
      wsE[enc({ c: 4, r: eR })] = cs(pct, bgCStyle(light));
      eR++;
    });

    eR++; // blank spacer

    // Prioritization roadmap
    wsE[enc({ c: 0, r: eR })] = cs('PRIORITIZATION ROADMAP', hdrStyle(DARK_SLATE));
    mE.push({ s: { c: 0, r: eR }, e: { c: 8, r: eR } }); eR++;

    ['Priority', 'Category / Issue', 'Bucket', 'Call Count', 'Impact', 'Effort', 'Expected Lift', 'Approval'].forEach((h, ci) => {
      wsE[enc({ c: ci, r: eR })] = cs(h, hdrStyle(DARK_SLATE));
    }); eR++;

    const allRecs: Array<{ rec: BucketRecommendation; bucket: string; light: string }> = [
      ...analysisResult.recommendations.bucket1.map((r: BucketRecommendation) => ({ rec: r, bucket: '1', light: LIGHT_RED })),
      ...analysisResult.recommendations.bucket2.map((r: BucketRecommendation) => ({ rec: r, bucket: '2', light: LIGHT_ORANGE })),
      ...analysisResult.recommendations.bucket3.map((r: BucketRecommendation) => ({ rec: r, bucket: '3', light: LIGHT_GREEN })),
    ].sort((a, b) => (b.rec.goalAlignmentScore || 0) - (a.rec.goalAlignmentScore || 0));

    allRecs.forEach(({ rec, bucket, light }, idx) => {
      const effort = rec.strategicPriority === 'Low' ? 'Low' : rec.strategicPriority === 'Medium' ? 'Medium' : 'High';
      const lift = rec.goalAlignmentScore >= 8 ? '10-15%' : rec.goalAlignmentScore >= 6 ? '5-8%' : '2-5%';
      wsE[enc({ c: 0, r: eR })] = cn(idx + 1, bgCStyle(light));
      wsE[enc({ c: 1, r: eR })] = cs(rec.topic, bgStyle(light));
      wsE[enc({ c: 2, r: eR })] = cs(`Bucket ${bucket}`, bgCStyle(light));
      wsE[enc({ c: 3, r: eR })] = cn(rec.count || 0, bgCStyle(light));
      wsE[enc({ c: 4, r: eR })] = cs(rec.strategicPriority, bgCStyle(light));
      wsE[enc({ c: 5, r: eR })] = cs(effort, bgCStyle(light));
      wsE[enc({ c: 6, r: eR })] = cs(lift, bgCStyle(light));
      wsE[enc({ c: 7, r: eR })] = cs('Pending', bgCStyle(light));
      eR++;
    });

    wsE['!ref'] = SX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 8, r: eR } });
    wsE['!merges'] = mE;
    wsE['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 26 }, { wch: 26 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 15 }];
    wsE['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 16 }];

    // =========================================================================
    // SHEET 2 — Bucket 1 · New Workflow  (no nav row; starts at row 0)
    // =========================================================================
    const wsB1: any = {};
    const mB1: any[] = [];
    const b1Recs: BucketRecommendation[] = analysisResult.recommendations.bucket1;

    wsB1[enc({ c: 0, r: 0 })] = cs(
      `Bucket 1 — New Workflow / Missing Capabilities (${b1Count} calls)`,
      { ...titleStyle, font: mkFont(true, 13, RED_BG) }
    );
    mB1.push({ s: { c: 0, r: 0 }, e: { c: 9, r: 0 } });

    const b1Hdr = ['Priority', 'Missing Capability', 'Specific User Intent', 'Call Count', '% of Bucket 1', 'Transcript Excerpts', 'Business Impact', 'Recommended Workflow', 'Complexity', 'Approval Status'];
    b1Hdr.forEach((h, ci) => { wsB1[enc({ c: ci, r: 2 })] = cs(h, hdrStyle(RED_BG)); });

    b1Recs.forEach((rec, idx) => {
      const r = idx + 3;
      const pct = b1Count > 0 ? ((rec.count / b1Count) * 100).toFixed(1) + '%' : '0%';
      const alt = idx % 2 === 0 ? LIGHT_RED : '';
      wsB1[enc({ c: 0, r })] = cn(idx + 1, alt ? bgCStyle(alt) : dataCStyle);
      wsB1[enc({ c: 1, r })] = cs(rec.topic, alt ? bgStyle(alt) : dataStyle);
      wsB1[enc({ c: 2, r })] = cs(rec.problemStatement, { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB1[enc({ c: 3, r })] = cn(rec.count || 0, alt ? bgCStyle(alt) : dataCStyle);
      wsB1[enc({ c: 4, r })] = cs(pct, alt ? bgCStyle(alt) : dataCStyle);
      wsB1[enc({ c: 5, r })] = cs(rec.examples.slice(0, 2).join(' | '), { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB1[enc({ c: 6, r })] = cs(rec.kpiToWatch, { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB1[enc({ c: 7, r })] = cs(rec.recommendation, { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB1[enc({ c: 8, r })] = cs(rec.strategicPriority, alt ? bgCStyle(alt) : dataCStyle);
      wsB1[enc({ c: 9, r })] = cs('Pending', alt ? bgCStyle(alt) : dataCStyle);
    });

    const b1LastRow = 3 + b1Recs.length;
    wsB1['!ref'] = SX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 9, r: b1LastRow } });
    wsB1['!merges'] = mB1;
    wsB1['!cols'] = [{ wch: 8 }, { wch: 24 }, { wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 45 }, { wch: 16 }, { wch: 40 }, { wch: 12 }, { wch: 15 }];

    // =========================================================================
    // SHEET 3 — Bucket 2 · Logic Fix  (no nav row; starts at row 0)
    // =========================================================================
    const wsB2: any = {};
    const mB2: any[] = [];
    const b2Recs: BucketRecommendation[] = analysisResult.recommendations.bucket2;

    wsB2[enc({ c: 0, r: 0 })] = cs(
      `Bucket 2 — Logic Fix / System Optimization (${b2Count} calls)`,
      { ...titleStyle, font: mkFont(true, 13, ORANGE_BG) }
    );
    mB2.push({ s: { c: 0, r: 0 }, e: { c: 10, r: 0 } });

    const b2Hdr = ['Priority', 'Affected Workflow', 'Issue Category', 'Call Count', '% of Bucket 2', 'Problem Description', 'Root Cause', 'Conv. Flow Excerpt', 'Recommended Fix', 'Complexity', 'Approval Status'];
    b2Hdr.forEach((h, ci) => { wsB2[enc({ c: ci, r: 2 })] = cs(h, hdrStyle(ORANGE_BG)); });

    b2Recs.forEach((rec, idx) => {
      const r = idx + 3;
      const pct = b2Count > 0 ? ((rec.count / b2Count) * 100).toFixed(1) + '%' : '0%';
      const rootCause = (rec as any).rootCause || rec.problemStatement;
      const alt = idx % 2 === 0 ? ORANGE_SOFT : '';
      wsB2[enc({ c: 0, r })] = cn(idx + 1, alt ? bgCStyle(alt) : dataCStyle);
      wsB2[enc({ c: 1, r })] = cs(rec.topic, alt ? bgStyle(alt) : dataStyle);
      wsB2[enc({ c: 2, r })] = cs(rec.strategicPriority, alt ? bgCStyle(alt) : dataCStyle);
      wsB2[enc({ c: 3, r })] = cn(rec.count || 0, alt ? bgCStyle(alt) : dataCStyle);
      wsB2[enc({ c: 4, r })] = cs(pct, alt ? bgCStyle(alt) : dataCStyle);
      wsB2[enc({ c: 5, r })] = cs(rec.problemStatement, { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB2[enc({ c: 6, r })] = cs(rootCause, { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB2[enc({ c: 7, r })] = cs(rec.examples.slice(0, 1).join(''), { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB2[enc({ c: 8, r })] = cs(rec.recommendation, { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB2[enc({ c: 9, r })] = cs(rec.strategicPriority, alt ? bgCStyle(alt) : dataCStyle);
      wsB2[enc({ c: 10, r })] = cs('Pending', alt ? bgCStyle(alt) : dataCStyle);
    });

    const b2TotalRow = 3 + b2Recs.length;
    wsB2[enc({ c: 0, r: b2TotalRow })] = cs(
      `✓ Total: ${b2Count} calls across ${b2Recs.length} categories`,
      { font: mkFont(true, 9, GREEN_BG), alignment: mkAlign('left', 'center') }
    );
    mB2.push({ s: { c: 0, r: b2TotalRow }, e: { c: 10, r: b2TotalRow } });

    wsB2['!ref'] = SX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 10, r: b2TotalRow } });
    wsB2['!merges'] = mB2;
    wsB2['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 38 }, { wch: 38 }, { wch: 42 }, { wch: 40 }, { wch: 12 }, { wch: 15 }];

    // =========================================================================
    // SHEET 4 — Bucket 3 · Script Update  (no nav row; starts at row 0)
    // =========================================================================
    const wsB3: any = {};
    const mB3: any[] = [];
    const b3Recs: BucketRecommendation[] = analysisResult.recommendations.bucket3;

    wsB3[enc({ c: 0, r: 0 })] = cs(
      `Bucket 3 — Script Update / Information Gaps (${b3Count} calls)`,
      { ...titleStyle, font: mkFont(true, 13, GREEN_BG) }
    );
    mB3.push({ s: { c: 0, r: 0 }, e: { c: 10, r: 0 } });

    const b3Hdr = ['Priority', 'Script Section (Issue Category)', 'Affected Workflow', 'Call Count', '% of Bucket 3', 'Content Gap', 'Transcript Excerpts', 'Current Bot Script', 'Recommended Script', 'Data Source', 'Approval Status'];
    b3Hdr.forEach((h, ci) => { wsB3[enc({ c: ci, r: 2 })] = cs(h, hdrStyle(GREEN_BG)); });

    b3Recs.forEach((rec, idx) => {
      const r = idx + 3;
      const pct = b3Count > 0 ? ((rec.count / b3Count) * 100).toFixed(1) + '%' : '0%';
      const alt = idx % 2 === 0 ? LIGHT_GREEN : '';
      wsB3[enc({ c: 0, r })] = cn(idx + 1, alt ? bgCStyle(alt) : dataCStyle);
      wsB3[enc({ c: 1, r })] = cs(rec.topic, alt ? bgStyle(alt) : dataStyle);
      wsB3[enc({ c: 2, r })] = cs('Voice Bot Workflow', alt ? bgStyle(alt) : dataStyle);
      wsB3[enc({ c: 3, r })] = cn(rec.count || 0, alt ? bgCStyle(alt) : dataCStyle);
      wsB3[enc({ c: 4, r })] = cs(pct, alt ? bgCStyle(alt) : dataCStyle);
      wsB3[enc({ c: 5, r })] = cs(rec.problemStatement, { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB3[enc({ c: 6, r })] = cs(rec.examples.slice(0, 1).join(''), { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB3[enc({ c: 7, r })] = cs(rec.examples.slice(0, 1).join(''), { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB3[enc({ c: 8, r })] = cs(rec.recommendation, { ...(alt ? bgStyle(alt) : dataStyle), alignment: mkAlign('left', 'center', true) });
      wsB3[enc({ c: 9, r })] = cs('AI Analysis', alt ? bgCStyle(alt) : dataCStyle);
      wsB3[enc({ c: 10, r })] = cs('Pending', alt ? bgCStyle(alt) : dataCStyle);
    });

    const b3TotalRow = 3 + b3Recs.length;
    wsB3[enc({ c: 0, r: b3TotalRow })] = cs(
      `✓ Total: ${b3Count} calls across ${b3Recs.length} categories`,
      { font: mkFont(true, 9, GREEN_BG), alignment: mkAlign('left', 'center') }
    );
    mB3.push({ s: { c: 0, r: b3TotalRow }, e: { c: 10, r: b3TotalRow } });

    wsB3['!ref'] = SX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 10, r: b3TotalRow } });
    wsB3['!merges'] = mB3;
    wsB3['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 44 }, { wch: 40 }, { wch: 44 }, { wch: 24 }, { wch: 15 }];

    // =========================================================================
    // SHEET 5 — Raw Data  (no nav row; header at row 0, data from row 1)
    // =========================================================================
    const wsRaw: any = {};
    const mRaw: any[] = [];

    // Title row
    wsRaw[enc({ c: 0, r: 0 })] = cs(
      `Raw Data — All ${totalCalls} Calls | Filter by Bucket #, Affected Workflow, or Issue Category`,
      subtitleStyle
    );
    mRaw.push({ s: { c: 0, r: 0 }, e: { c: 14, r: 0 } });

    // Header row
    const rawHdr = ['Row #', 'CALL_ID', 'Call Outcome', 'Bucket #', 'Bucket Label', 'Affected Workflow', 'Issue Category', 'Category / Theme', 'Conv. Excerpt', 'Duration (s)', 'Hangup Reason', 'Hangup Source', 'Issue Description', 'Recording', 'Approval Status'];
    rawHdr.forEach((h, ci) => { wsRaw[enc({ c: ci, r: 1 })] = cs(h, hdrStyle(DARK_SLATE)); });

    // Data rows
    rows.forEach((r: any, idx) => {
      const rn = idx + 2;
      const bkt = r.BUCKET || '0';
      const rowBg = bkt === '1' ? LIGHT_RED : bkt === '2' ? LIGHT_ORANGE : bkt === '3' ? LIGHT_GREEN : '';
      const rs = rowBg ? bgStyle(rowBg) : dataStyle;
      const rc = rowBg ? bgCStyle(rowBg) : dataCStyle;
      const rnS = rowBg ? { ...bgCStyle(rowBg), alignment: mkAlign('right', 'center') } : dataNumStyle;

      const bktLabel = bkt === '1' ? 'Bucket 1 - New Workflow' : bkt === '2' ? 'Bucket 2 - Logic Fix' : bkt === '3' ? 'Bucket 3 - Script Update' : 'Resolved / Out of Scope';
      const callOutcome = r.RESOLUTION_STATUS || r.HANGUP_REASON || 'N/A';
      const convExcerpt = r.CONVERSATION_SUMMARY || r.USER_SUMMARY || 'N/A';
      const issueDesc = r.BUCKET_LABEL || r.TOPIC || 'N/A';
      const bktFontRgb = bkt === '1' ? RED_BG : bkt === '2' ? ORANGE_BG : bkt === '3' ? GREEN_BG : DARK_SLATE;

      wsRaw[enc({ c: 0, r: rn })] = cn(idx + 1, rnS);
      wsRaw[enc({ c: 1, r: rn })] = cs(r.CALL_ID || '', rs);
      wsRaw[enc({ c: 2, r: rn })] = cs(callOutcome, { ...rs, alignment: mkAlign('left', 'center', true) });
      wsRaw[enc({ c: 3, r: rn })] = cs(bkt, { ...rc, font: mkFont(true, 9, bktFontRgb) });
      wsRaw[enc({ c: 4, r: rn })] = cs(bktLabel, rs);
      wsRaw[enc({ c: 5, r: rn })] = cs(r.TOPIC || 'N/A', rs);
      wsRaw[enc({ c: 6, r: rn })] = cs(r.TOPIC || 'N/A', rs);
      wsRaw[enc({ c: 7, r: rn })] = cs(r.TOPIC || 'N/A', rs);
      wsRaw[enc({ c: 8, r: rn })] = cs(convExcerpt, { ...rs, alignment: mkAlign('left', 'center', true) });
      wsRaw[enc({ c: 9, r: rn })] = cn(Number(r.CALL_DURATION) || 0, rc);
      wsRaw[enc({ c: 10, r: rn })] = cs(r.HANGUP_REASON || 'N/A', rc);
      wsRaw[enc({ c: 11, r: rn })] = cs(r.HANGUP_SOURCE || 'N/A', rc);
      wsRaw[enc({ c: 12, r: rn })] = cs(issueDesc, { ...rs, alignment: mkAlign('left', 'center', true) });
      wsRaw[enc({ c: 13, r: rn })] = r.RECORDING_URL
        ? { v: 'Open Recording', t: 's', s: linkStyle, l: { Target: r.RECORDING_URL } }
        : cs('—', rc);
      wsRaw[enc({ c: 14, r: rn })] = cs(r.APPROVAL_STATUS || 'Pending', rc);
    });

    wsRaw['!ref'] = SX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 14, r: 1 + rows.length } });
    wsRaw['!merges'] = mRaw;
    wsRaw['!cols'] = [{ wch: 6 }, { wch: 34 }, { wch: 28 }, { wch: 8 }, { wch: 22 }, { wch: 26 }, { wch: 22 }, { wch: 28 }, { wch: 50 }, { wch: 10 }, { wch: 20 }, { wch: 12 }, { wch: 40 }, { wch: 10 }, { wch: 15 }];

    // =========================================================================
    // Assemble & write via xlsx-js-style
    // =========================================================================
    const wb = SX.utils.book_new();
    SX.utils.book_append_sheet(wb, wsE, 'Executive Summary');
    SX.utils.book_append_sheet(wb, wsB1, 'Bucket 1 - New Workflow');
    SX.utils.book_append_sheet(wb, wsB2, 'Bucket 2 - Logic Fix');
    SX.utils.book_append_sheet(wb, wsB3, 'Bucket 3 - Script Update');
    SX.utils.book_append_sheet(wb, wsRaw, 'Raw Data');

    // Blob download — avoids Chrome "insecure download" warning
    const vlOut = SX.write(wb, { bookType: 'xlsx', type: 'array' });
    const vlBlob = new Blob([vlOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const vlUrl = URL.createObjectURL(vlBlob);
    const vlA = document.createElement('a');
    vlA.href = vlUrl;
    vlA.download = `${botTitle || botId || 'VoiceBot_Resolution_Analysis'}.xlsx`;
    document.body.appendChild(vlA); vlA.click();
    setTimeout(() => { URL.revokeObjectURL(vlUrl); document.body.removeChild(vlA); }, 1000);

  };

  const tabs = [
    { id: 'summary', label: 'Overview' },
    { id: 'bucket1', label: 'Expansion' },
    { id: 'bucket2', label: 'Optimization' },
    { id: 'bucket3', label: 'Knowledge' },
    { id: 'raw', label: 'Raw Audit' }
  ] as const;

  return (
    <div className="min-h-screen bg-[#f8fafd] text-slate-900 font-sans pb-20 print:bg-white print:p-0 print:block print:min-h-0 print:overflow-visible">
      <header className="bg-slate-900 text-white p-5 shadow-2xl flex justify-between items-center sticky top-0 z-50 print:hidden">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-indigo-600 rounded-lg flex items-center justify-center"><i className="fas fa-chart-line"></i></div>
          <h1 className="text-xl font-black uppercase tracking-tight">Performance Analyzer</h1>
        </div>
        <div className="flex gap-3">
          {analysisResult && viewMode !== 'setup' && (
            <button onClick={() => setViewMode('setup')} className="bg-slate-700 hover:bg-slate-600 px-6 py-2 rounded-full font-black text-[10px] uppercase transition-all flex items-center gap-2"><i className="fas fa-cog"></i> Settings</button>
          )}
          {analysisResult && viewMode === 'dashboard' && (
            <button onClick={() => setViewMode('report')} className="bg-indigo-600 hover:bg-indigo-700 px-6 py-2 rounded-full font-black text-[10px] uppercase transition-all flex items-center gap-2"><i className="fas fa-file-alt"></i> View Full Report</button>
          )}
          {analysisResult && viewMode === 'report' && (
            <div className="flex gap-2">
              <button onClick={handleExportPdf} disabled={loading} className="bg-slate-800 hover:bg-black px-6 py-2 rounded-full font-black text-[10px] uppercase transition-all flex items-center gap-2 disabled:opacity-50"><i className={`fas ${loading ? 'fa-circle-notch fa-spin' : 'fa-file-pdf'}`}></i> {loading ? 'Rendering PDF...' : 'Export as PDF'}</button>
              <button onClick={handleExportExcel} className="bg-emerald-600 hover:bg-emerald-700 px-6 py-2 rounded-full font-black text-[10px] uppercase transition-all flex items-center gap-2">
                <i className="fas fa-file-excel"></i> Export as Excel
              </button>
              <button onClick={() => setViewMode('dashboard')} className="bg-indigo-600 hover:bg-indigo-700 px-6 py-2 rounded-full font-black text-[10px] uppercase transition-all flex items-center gap-2"><i className="fas fa-th-large"></i> Dashboard</button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto mt-10 px-6 print:m-0 print:p-0 print:w-full print:max-w-none print:overflow-visible">
        {viewMode === 'setup' && (
          <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 animate-fadeIn print:hidden max-w-7xl mx-auto">
            <div className="text-center mb-16"><h2 className="text-4xl font-black text-slate-900 mb-4 tracking-tight">Strategy Configuration</h2><p className="text-slate-500 text-lg">Initialize context to generate optimization recommendations.</p></div>
            <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-10 mb-16">
              <div className="p-8 bg-indigo-50/50 border border-indigo-100 rounded-[2.5rem] flex flex-col">
                <h3 className="text-xs font-black text-indigo-900 uppercase tracking-widest mb-6">1. Bot Configuration</h3>

                <div className="mb-6 space-y-4">
                  <p className="text-[11px] font-bold text-slate-600 leading-relaxed">
                    To perform a deep analysis, please provide your bot's configuration JSON.
                  </p>
                  <div className="bg-white/70 p-5 rounded-2xl border border-indigo-100 shadow-sm">
                    <p className="text-[10px] font-black text-indigo-900 uppercase mb-3 flex items-center gap-2">
                      <i className="fas fa-info-circle"></i> How to get this file
                    </p>
                    <ol className="text-[10px] text-slate-500 space-y-2 list-decimal ml-4 font-medium leading-tight">
                      <li>Use your <b>Bot ID</b> and <b>API Key</b>.</li>
                      <li>Download the configuration as a <code className="bg-slate-100 px-1 rounded">.json</code> file.</li>
                    </ol>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="relative group min-h-[140px]">
                    <input type="file" accept=".json" onChange={handleManualJsonUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                    <div className={`h-full border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all duration-300 ${rawBotJson ? 'bg-indigo-600 border-indigo-600 shadow-lg' : 'border-slate-300 group-hover:bg-white group-hover:border-indigo-400'}`}>
                      <div className={`h-12 w-12 rounded-full flex items-center justify-center mb-3 ${rawBotJson ? 'bg-white/20' : 'bg-slate-100'}`}>
                        <i className={`fas ${rawBotJson ? 'fa-check text-white' : 'fa-file-code text-slate-400'} text-xl`}></i>
                      </div>
                      <span className={`text-[10px] font-black uppercase tracking-widest text-center px-4 ${rawBotJson ? 'text-white' : 'text-slate-400'}`}>
                        {rawBotJson ? (botId ? `Bot: ${botId}` : 'JSON Loaded') : 'Upload JSON'}
                      </span>
                    </div>
                  </div>

                  <div className="relative group min-h-[140px]">
                    <input type="file" accept=".txt" onChange={handleSummaryUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                    <div className={`h-full border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all duration-300 ${botSummary && !rawBotJson ? 'bg-indigo-600 border-indigo-600 shadow-lg' : 'border-slate-300 group-hover:bg-white group-hover:border-indigo-400'}`}>
                      <div className={`h-12 w-12 rounded-full flex items-center justify-center mb-3 ${botSummary && !rawBotJson ? 'bg-white/20' : 'bg-slate-100'}`}>
                        <i className={`fas ${botSummary && !rawBotJson ? 'fa-check text-white' : 'fa-file-alt text-slate-400'} text-xl`}></i>
                      </div>
                      <span className={`text-[10px] font-black uppercase tracking-widest text-center px-4 ${botSummary && !rawBotJson ? 'text-white' : 'text-slate-400'}`}>
                        {botSummary && !rawBotJson ? 'Summary Uploaded' : 'Upload Summary'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mb-6 space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2">
                    <i className="fas fa-robot text-indigo-400"></i> Custom Bot Title (Optional)
                  </label>
                  <input
                    type="text"
                    value={botTitle}
                    onChange={(e) => setBotTitle(e.target.value)}
                    placeholder="Enter bot name (e.g. Royal Enfield Assistant)"
                    className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
                  />
                </div>

                {botSummary && rawBotJson && <button onClick={downloadSummaryTxt} className="w-full bg-slate-900 text-white py-3 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-black transition-all">Download summary.txt</button>}
              </div>

              <div className="p-8 bg-emerald-50/50 border border-emerald-100 rounded-[2.5rem] flex flex-col">
                <h3 className="text-xs font-black text-emerald-900 uppercase tracking-widest mb-6">2. Performance Transcripts (CSV)</h3>

                <div className="grid grid-cols-1 gap-3 flex-1">
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-emerald-200 rounded-[1.5rem] p-4 relative hover:bg-white transition-all group">
                    <i className={`fas ${standardLogData.length > 0 ? 'fa-check-circle text-emerald-500' : 'fa-list text-emerald-300'} text-2xl mb-2 group-hover:scale-110 transition duration-300`}></i>
                    <p className="text-[10px] font-black uppercase text-slate-400 text-center">{standardLogData.length > 0 ? `${standardLogData.length} records` : 'Voice Logs'}</p>
                    <input type="file" accept=".csv" onChange={handleStandardLogUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </div>

                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-emerald-200 rounded-[1.5rem] p-4 relative hover:bg-white transition-all group">
                    <i className={`fas ${chatLogData.length > 0 ? 'fa-check-circle text-emerald-500' : 'fa-comments text-emerald-300'} text-2xl mb-2 group-hover:scale-110 transition duration-300`}></i>
                    <p className="text-[10px] font-black uppercase text-slate-400 text-center">{chatLogData.length > 0 ? `${chatLogSessionCount} sessions` : 'Chat Logs'}</p>
                    {chatLogData.length > 0 && <p className="text-[8px] text-slate-300 text-center">{chatLogData.length} messages</p>}
                    <input type="file" accept=".csv" onChange={handleChatLogUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </div>

                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-emerald-200 rounded-[1.5rem] p-4 relative hover:bg-white transition-all group">
                    <i className={`fas ${csvData.length > 0 ? 'fa-check-circle text-emerald-500' : 'fa-database text-emerald-300'} text-2xl mb-2 group-hover:scale-110 transition duration-300`}></i>
                    <p className="text-[10px] font-black uppercase text-slate-400 text-center">{csvData.length > 0 ? `${csvData.length} records` : 'CRA Data'}</p>
                    <input type="file" accept=".csv" onChange={handleCsvUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </div>
                  {csvLoadMessage && (
                    <p className="text-[9px] font-medium text-slate-400 text-center mt-1 px-1 leading-tight">{csvLoadMessage}</p>
                  )}
                </div>

                <p className="text-[9px] font-bold text-slate-400 mt-4 text-center uppercase tracking-widest">Select processing format above</p>
              </div>
              <div className="p-8 bg-amber-50/50 border border-amber-100 rounded-[2.5rem] flex flex-col">
                <h3 className="text-xs font-black text-amber-900 uppercase tracking-widest mb-6">3. Strategic Goals</h3>
                <textarea value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="What are your goals?" className="flex-1 w-full bg-white border border-slate-200 rounded-[1.5rem] p-6 text-sm resize-none outline-none focus:ring-2 focus:ring-amber-500 mb-6" />

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-amber-400 uppercase tracking-widest ml-2">Preferred AI Model</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value as ModelOption)}
                    className="w-full bg-white border border-amber-200 rounded-2xl px-5 py-3 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500 transition-all shadow-sm"
                  >
                    <option value="gpt-4.1">GPT-4.1 (Standard)</option>
                    <option value="gpt-4o">GPT-4o (Advanced)</option>
                    <option value="gpt-4o-mini">GPT-4o Mini (Fast)</option>
                    <option value="gemini-flash">Gemini 1.5 Flash (Balanced)</option>
                  </select>
                </div>
              </div>


            </div>
            <button onClick={startAnalysis} disabled={loading || !botSummary || (csvData.length === 0 && standardLogData.length === 0 && chatLogData.length === 0)} className="w-full bg-slate-900 text-white py-6 rounded-full font-black uppercase text-xl shadow-2xl transition-all hover:bg-black disabled:opacity-30">{loading ? (analysisProgress ? `[${analysisProgress.currentBatch}/${analysisProgress.totalBatches}] ${analysisProgress.message}` : 'Processing...') : 'Analyze Performance'}</button>
          </div>
        )}

        {viewMode === 'dashboard' && analysisResult && (
          <div className="animate-fadeIn print:hidden max-w-7xl mx-auto">
            <div className="flex flex-wrap gap-3 mb-12 justify-center">{tabs.map(t => (<button key={t.id} onClick={() => setActiveTab(t.id)} className={`px-8 py-4 rounded-full font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === t.id ? 'bg-indigo-600 text-white shadow-xl' : 'bg-white text-slate-400 border border-slate-200 hover:border-indigo-400'}`}>{t.label}</button>))}</div>
            <div className="bg-white rounded-[4rem] shadow-2xl border border-slate-100 p-16 min-h-[700px]">
              {activeTab === 'summary' && <SummaryView summary={summary} />}
              {activeTab === 'bucket1' && <BucketListView recs={analysisResult.recommendations.bucket1} activeTab="bucket1" categorizedRows={analysisResult.categorizedRows} />}
              {activeTab === 'bucket2' && <BucketListView recs={analysisResult.recommendations.bucket2} activeTab="bucket2" categorizedRows={analysisResult.categorizedRows} />}
              {activeTab === 'bucket3' && <BucketListView recs={analysisResult.recommendations.bucket3} activeTab="bucket3" categorizedRows={analysisResult.categorizedRows} />}
              {activeTab === 'raw' && <RawDataView filteredRows={filteredRows} filterCluster={filterCluster} setFilterCluster={setFilterCluster} filterOutcome={filterOutcome} setFilterOutcome={setFilterOutcome} filterTopic={filterTopic} setFilterTopic={setFilterTopic} uniqueFilters={uniqueFilters} />}
            </div>
          </div>
        )}

        {viewMode === 'report' && analysisResult && (
          <div id="report-content" className="report-container bg-white rounded-[2rem] shadow-xl border border-slate-100 p-8 animate-fadeIn max-w-full print:shadow-none print:p-0">
            <div className="flex justify-between items-center border-b-4 border-slate-900 pb-4 mb-8">
              <div>
                <h1 className="text-3xl font-black uppercase text-slate-900 tracking-tighter">
                  {botTitle || 'Performance Audit'}
                </h1>
                <p className="text-slate-500 font-bold text-xs uppercase tracking-widest">
                  {botTitle || 'Bot Agent'} | {botId || 'N/A'}
                </p>
              </div>
              <div className="text-right"><p className="text-[9px] font-black uppercase text-slate-400">Analysis Date</p><p className="text-sm font-bold">{new Date().toLocaleDateString()}</p></div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start print:grid-cols-4 print:gap-4">
              <div className="space-y-4"><h2 className="text-xs font-black uppercase border-l-4 border-slate-900 pl-3 py-1 bg-slate-50">1. Matrix Summary</h2><SummaryView summary={summary} isReport /></div>
              <div className="space-y-4"><h2 className="text-xs font-black uppercase border-l-4 border-rose-600 pl-3 py-1 bg-rose-50 text-rose-600">2. Service Expansion</h2><BucketListView recs={analysisResult.recommendations.bucket1} activeTab="bucket1" isReport categorizedRows={analysisResult.categorizedRows} /></div>
              <div className="space-y-4"><h2 className="text-xs font-black uppercase border-l-4 border-amber-600 pl-3 py-1 bg-amber-50 text-amber-600">3. Optimization</h2><BucketListView recs={analysisResult.recommendations.bucket2} activeTab="bucket2" isReport categorizedRows={analysisResult.categorizedRows} /></div>
              <div className="space-y-4"><h2 className="text-xs font-black uppercase border-l-4 border-emerald-600 pl-3 py-1 bg-emerald-50 text-emerald-600">4. Information Gaps</h2><BucketListView recs={analysisResult.recommendations.bucket3} activeTab="bucket3" isReport categorizedRows={analysisResult.categorizedRows} /></div>
            </div>
          </div>
        )}
      </main>

      {errorState && <ErrorModal error={errorState} onClose={() => setErrorState(null)} />}
    </div>
  );
};

const SummaryView: React.FC<{ summary: AnalysisSummary; isReport?: boolean }> = ({ summary, isReport }) => (
  <div className={`${isReport ? 'space-y-4' : 'space-y-12'}`}>
    <div className={`grid ${isReport ? 'grid-cols-2 gap-3' : 'grid-cols-2 lg:grid-cols-4 gap-10'}`}>
      <KpiCard title="Total" value={summary.totalChats} icon="fa-chart-pie" color="indigo" isReport={isReport} />
      <KpiCard title="Expansion" value={summary.bucketDistribution['1']} icon="fa-rocket" color="rose" isReport={isReport} />
      <KpiCard title="Fixes" value={summary.bucketDistribution['2']} icon="fa-sliders" color="amber" isReport={isReport} />
      <KpiCard title="KB Gaps" value={summary.bucketDistribution['3']} icon="fa-database" color="emerald" isReport={isReport} />
    </div>
    {isReport && (
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
        <p className="text-[7px] font-black uppercase tracking-widest text-slate-400 mb-2">Legend — Strategic Pillars</p>
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <span className="h-2 w-2 rounded-full bg-rose-500 mt-0.5 shrink-0"></span>
            <p className="text-[7px] font-bold text-slate-600 leading-tight"><span className="text-rose-600 uppercase">Service Expansion</span> — Add a new intent or agent to handle queries the bot currently cannot address.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500 mt-0.5 shrink-0"></span>
            <p className="text-[7px] font-bold text-slate-600 leading-tight"><span className="text-amber-600 uppercase">System Optimization</span> — Improve the logic, flow, or responses of an existing agent that is broken or incomplete.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 mt-0.5 shrink-0"></span>
            <p className="text-[7px] font-bold text-slate-600 leading-tight"><span className="text-emerald-600 uppercase">Information Gaps</span> — Add or update resources in the Knowledge Base so the bot can answer correctly.</p>
          </div>
        </div>
      </div>
    )}
    <div className={`grid ${isReport ? 'grid-cols-1 gap-4' : 'lg:grid-cols-2 gap-16'}`}>
      <div className={`${isReport ? 'p-4' : 'p-12'} border rounded-[1.5rem] bg-slate-50/20`}><h3 className="text-[8px] font-black mb-4 text-center uppercase tracking-widest text-slate-400">Outcomes</h3><div className={`${isReport ? 'h-[150px]' : 'h-[350px]'}`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={Object.entries(summary.statusBreakdown).map(([n, v]) => ({ n, v }))} cx="50%" cy="50%" innerRadius={isReport ? 30 : 80} outerRadius={isReport ? 50 : 120} paddingAngle={5} dataKey="v"><Cell fill="#4f46e5" /><Cell fill="#f43f5e" /><Cell fill="#f59e0b" /><Cell fill="#10b981" /><Cell fill="#6366f1" /></Pie>{!isReport && <Tooltip />}{!isReport && <Legend verticalAlign="bottom" />}</PieChart></ResponsiveContainer></div></div>
      {!isReport && (<div className="p-12 border rounded-[2rem] bg-slate-50/20"><h3 className="text-xs font-black mb-10 text-center uppercase tracking-widest text-slate-400">Pillar Mapping</h3><div className="h-[350px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: 'Expansion', value: summary.bucketDistribution['1'], fill: '#f43f5e' }, { name: 'Optimization', value: summary.bucketDistribution['2'], fill: '#f59e0b' }, { name: 'Knowledge', value: summary.bucketDistribution['3'], fill: '#10b981' },]}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value" radius={[10, 10, 0, 0]} /></BarChart></ResponsiveContainer></div></div>)}
    </div>
  </div>
);

const BucketListView: React.FC<{ recs: BucketRecommendation[]; activeTab: string; categorizedRows: ConversationRow[]; isReport?: boolean }> = ({ recs, activeTab, categorizedRows, isReport }) => (
  <div className={`${isReport ? 'space-y-4' : 'space-y-12'}`}>
    {recs.length === 0 && isReport && (<div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200"><p className="text-[9px] font-black uppercase text-slate-300">No issues identified</p></div>)}
    {recs.map((rec, i) => {
      // CRITICAL FIX: Dynamically calculate count from data indices to ensure raw audit match
      const actualCount = Array.isArray((rec as any).indices)
        ? (rec as any).indices.filter((idx: number) => categorizedRows[idx]).length
        : rec.count;

      return (
        <div key={i} className={`${isReport ? 'p-4 rounded-xl border-l-4' : 'p-12 rounded-[3.5rem] border-l-[16px]'} bg-slate-50 shadow-sm border-slate-200 ${activeTab === 'bucket1' ? 'border-rose-500' : activeTab === 'bucket2' ? 'border-amber-500' : 'border-emerald-500'}`}>
          <div className={`flex justify-between items-start ${isReport ? 'mb-2' : 'mb-6'}`}>
            <div className="flex-1">
              <h4 className={`${isReport ? 'text-[11px]' : 'text-4xl'} font-black uppercase tracking-tight leading-tight`}>{rec.topic}</h4>
              <div className={`flex ${isReport ? 'gap-2 mt-1' : 'gap-4 mt-2'}`}>
                <span className={`bg-indigo-600 text-white px-2 py-0.5 rounded-full ${isReport ? 'text-[7px]' : 'text-[10px]'} font-black uppercase`}>Score: {rec.goalAlignmentScore}/10</span>
                <span className={`bg-white border border-slate-200 px-2 py-0.5 rounded-full ${isReport ? 'text-[7px]' : 'text-[10px]'} font-black uppercase text-slate-400`}>{actualCount} chats</span>
              </div>
            </div>
          </div>
          <div className={`grid ${isReport ? 'grid-cols-1 gap-2' : 'md:grid-cols-2 gap-8 mt-10 pt-10 border-t border-slate-200'}`}>
            <div className="space-y-2">
              <p className={`${isReport ? 'text-[9px]' : 'text-xl'} font-bold text-slate-700 leading-relaxed border-l-2 border-slate-200 pl-3 italic`}>"{rec.problemStatement}"</p>
              {!isReport && (
                <div className="bg-white p-6 rounded-[1.5rem] border border-slate-100 shadow-inner">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Evidence</p>
                  <ul className="space-y-2">{rec.examples.slice(0, 3).map((ex, idx) => <li key={idx} className="text-xs font-bold text-slate-500 flex gap-4 leading-tight"><span className="text-indigo-400">#</span> {ex}</li>)}</ul>
                </div>
              )}
            </div>
            <div className={`${isReport ? 'space-y-2' : 'space-y-6'}`}>
              <div className={`bg-slate-900 text-white ${isReport ? 'p-3 rounded-lg' : 'p-8 rounded-[2rem]'} shadow-lg`}><p className={`${isReport ? 'text-[7px]' : 'text-[10px]'} font-black text-indigo-300 uppercase tracking-widest ${isReport ? 'mb-1' : 'mb-3'}`}>Recommendation</p><p className={`font-bold ${isReport ? 'text-[8px]' : 'text-sm'} leading-relaxed`}>{rec.recommendation}</p></div>
              <div className={`${isReport ? 'bg-transparent' : 'bg-emerald-50 p-6 rounded-[1.5rem] border border-emerald-100 flex items-center gap-6'}`}>{isReport ? (<div className="bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100 flex items-center gap-2"><i className="fas fa-bullseye text-[8px] text-emerald-600"></i><p className="text-[7px] font-black uppercase text-slate-800">{rec.kpiToWatch}</p></div>) : (<><div className="h-12 w-12 bg-emerald-600 text-white rounded-xl flex items-center justify-center text-2xl"><i className="fas fa-bullseye"></i></div><div><p className="text-[9px] font-black text-emerald-800 uppercase tracking-widest mb-1">Target KPI</p><p className="text-sm font-black uppercase tracking-tighter text-slate-800">{rec.kpiToWatch}</p></div></>)}</div>
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

const RawDataView: React.FC<any> = ({ filteredRows, filterCluster, setFilterCluster, filterOutcome, setFilterOutcome, filterTopic, setFilterTopic, uniqueFilters }) => (
  <div className="space-y-10">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 bg-slate-50 p-10 rounded-[3rem] border border-slate-100">
      <div className="space-y-3"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Strategic Bucket</label><select value={filterCluster} onChange={(e) => setFilterCluster(e.target.value)} className="w-full bg-white border-2 rounded-2xl px-5 py-4 text-xs font-black shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"><option value="">All Buckets</option><option value="1">Service Expansion</option><option value="2">System Optimization</option><option value="3">Information Gaps</option></select></div>
      <div className="space-y-3"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Outcome</label><select value={filterOutcome} onChange={(e) => setFilterOutcome(e.target.value)} className="w-full bg-white border-2 rounded-2xl px-5 py-4 text-xs font-black shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"><option value="">All Outcomes</option>{uniqueFilters.outcomes.map((o: any) => <option key={o} value={o}>{o}</option>)}</select></div>
      <div className="space-y-3"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Topic Cluster</label><select value={filterTopic} onChange={(e) => setFilterTopic(e.target.value)} className="w-full bg-white border-2 rounded-2xl px-5 py-4 text-xs font-black shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"><option value="">All Topics</option>{uniqueFilters.topics.map((t: any) => <option key={t} value={t}>{t}</option>)}</select></div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs table-fixed">
        <thead className="border-b-4 border-slate-100 uppercase text-slate-400 font-black tracking-widest">
          <tr>
            <th className="p-8 w-[150px]">Pillar</th>
            {!filteredRows[0]?.['Session Id'] && <th className="p-8 w-[160px]">Outcome</th>}
            <th className="p-8 w-[180px]">Topic</th>
            <th className="p-8">{filteredRows[0]?.CALL_ID ? 'Conversation Summary' : (filteredRows[0]?.['Session Id'] ? 'Chat Log' : 'Query')}</th>
            {!filteredRows[0]?.['Session Id'] && <th className="p-8 w-[100px]">{filteredRows[0]?.CALL_ID ? 'Recording' : 'Audit'}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {filteredRows.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-8 align-top">
                <span className={`px-4 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest ${r.BUCKET === '1' ? 'bg-rose-100 text-rose-700' : r.BUCKET === '2' ? 'bg-amber-100 text-amber-700' : r.BUCKET === '3' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  {r.BUCKET === '0' ? 'RESOLVED' : r.BUCKET === '1' ? 'EXPANSION' : r.BUCKET === '2' ? 'OPTIMIZE' : 'GAPS'}
                </span>
              </td>
              {!r['Session Id'] && <td className="p-8 font-black text-slate-700 align-top">{r.RESOLUTION_STATUS}</td>}
              <td className="p-8 font-bold text-slate-400 uppercase tracking-tighter align-top break-words">{r.TOPIC}</td>
              <td className="p-8 font-medium text-slate-900 leading-relaxed align-top break-words">
                {r.CALL_ID ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-[8px] font-black uppercase text-slate-500">ID: {r.CALL_ID}</span>
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-[8px] font-black uppercase text-slate-500">Dur: {r.CALL_DURATION}</span>
                    </div>
                    <p>{r.CONVERSATION_SUMMARY}</p>
                    {r.USER_SUMMARY && <p className="text-[10px] text-slate-500 italic">User: {r.USER_SUMMARY}</p>}
                  </div>
                ) : r['Session Id'] ? (
                  <div className="space-y-2">
                    <div className="flex gap-2 flex-wrap">
                      <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[8px] font-black uppercase">Session: {r['Session Id']}</span>
                      {(r.LAST_STEP || r['Journey:Step']) && (r.LAST_STEP !== 'N/A' && r.LAST_STEP !== 'None') && <span className="bg-slate-100 px-2 py-0.5 rounded text-[8px] font-black uppercase text-slate-500">Last Step: {r.LAST_STEP || r['Journey:Step']}</span>}
                    </div>
                    {r.CONVERSATION_SUMMARY ? (
                      <div className="bg-indigo-50/50 p-2 rounded-lg border border-indigo-100">
                        <p className="text-[10px] font-bold text-indigo-900 mb-1">Summary</p>
                        <p className="text-[10px] leading-relaxed text-slate-700">{r.CONVERSATION_SUMMARY}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {r.USER_SUMMARY && <div><p className="text-[8px] font-black text-slate-400 uppercase">User Intent</p><p className="text-[9px] text-slate-600 leading-tight">{r.USER_SUMMARY}</p></div>}
                          {r.BOT_SUMMARY && <div><p className="text-[8px] font-black text-slate-400 uppercase">Bot Execution</p><p className="text-[9px] text-slate-600 leading-tight">{r.BOT_SUMMARY}</p></div>}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] leading-relaxed">{r.MESSAGE_AGGREGATE || r.USER_QUERY}</p>
                    )}
                    <div className="flex gap-2">
                      <span className="text-[8px] font-bold text-slate-400 uppercase">Lang: {r['Language']}</span>
                      <span className="text-[8px] font-bold text-slate-400 uppercase">Medium: {r['Interaction medium']}</span>
                      <span className="text-[8px] font-bold text-slate-400 uppercase">Source: {r['Source']}</span>
                    </div>
                  </div>
                ) : r.USER_QUERY}
              </td>
              {!r['Session Id'] && <td className="p-8 align-top">
                {r.RECORDING_URL || r.CHATURL ? (
                  <a href={r.RECORDING_URL || r.CHATURL} target="_blank" className="text-indigo-600 font-black hover:text-indigo-900">
                    {r.RECORDING_URL ? 'Audio' : 'Link'}
                  </a>
                ) : "--"}
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const KpiCard: React.FC<{ title: string; value: number; icon: string; color: string; isReport?: boolean }> = ({ title, value, icon, color, isReport }) => {
  const colors: Record<string, string> = { indigo: "text-indigo-600 bg-indigo-50 shadow-indigo-100/30", rose: "text-rose-600 bg-rose-50 shadow-rose-100/30", amber: "text-amber-600 bg-amber-50 shadow-amber-100/30", emerald: "text-emerald-600 bg-emerald-50 shadow-emerald-100/30" };
  return (<div className={`bg-white ${isReport ? 'p-3 rounded-lg border' : 'p-12 rounded-[3rem] shadow-xl'} border-slate-100 flex flex-col ${isReport ? 'gap-1' : 'gap-6'} print:border-slate-200`}><div className={`${isReport ? 'h-6 w-6 text-sm rounded-md' : 'h-16 w-16 text-3xl rounded-[1.5rem]'} flex items-center justify-center shadow-inner ${colors[color]}`}><i className={`fas ${icon}`}></i></div><div><p className={`${isReport ? 'text-[6px]' : 'text-[10px]'} font-black text-slate-400 uppercase tracking-widest`}>{title}</p><p className={`${isReport ? 'text-lg' : 'text-6xl'} font-black tracking-tighter`}>{value || 0}</p></div></div>);
};

const ErrorModal: React.FC<{ error: { title: string; message: string; suggestion?: string }; onClose: () => void }> = ({ error, onClose }) => (
  <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
    <div className="bg-white rounded-[2rem] shadow-2xl p-8 max-w-md w-full border border-rose-100">
      <div className="flex items-center gap-4 mb-6">
        <div className="h-12 w-12 bg-rose-100 rounded-full flex items-center justify-center shrink-0">
          <i className="fas fa-exclamation-triangle text-rose-600 text-xl"></i>
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">{error.title}</h3>
          <p className="text-xs font-bold text-rose-500 uppercase tracking-widest">Action Required</p>
        </div>
      </div>
      <p className="text-sm text-slate-600 font-medium leading-relaxed mb-4">{error.message}</p>
      {error.suggestion && (
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6">
          <p className="text-xs text-slate-500 italic"><i className="fas fa-info-circle mr-2 text-indigo-400"></i>{error.suggestion}</p>
        </div>
      )}
      <button onClick={onClose} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold uppercase tracking-widest hover:bg-black transition-colors">Dismiss</button>
    </div>
  </div>
);

export default App;
