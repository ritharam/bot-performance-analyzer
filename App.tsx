import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { analyzeConversations } from './services/aiService';
import { generateBotSummary } from './services/botProcessor';
import { ConversationRow, AnalysisSummary, AnalysisResult, BucketRecommendation, ModelOption } from './types';

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

  // Filter States for Raw Data
  const [filterCluster, setFilterCluster] = useState<string>('');
  const [filterOutcome, setFilterOutcome] = useState<string>('');
  const [filterTopic, setFilterTopic] = useState<string>('');

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
          setCsvData(rows.map((r) => ({
            CHATURL: r.CHATURL || '',
            TOPIC: r.TOPIC || '',
            USER_QUERY: r.USER_QUERY || '',
            RESOLUTION: r.RESOLUTION || '',
            RESOLUTION_STATUS: r.RESOLUTION_STATUS || '',
            RESOLUTION_STATUS_REASONING: r.RESOLUTION_STATUS_REASONING || '',
            TIME_STAMP: r.TIME_STAMP || '',
            USER_ID: r.USER_ID || '',
            USER_SENTIMENT: r.USER_SENTIMENT || '',
            APPROVAL_STATUS: 'Pending'
          })));
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
          setChatLogData(rows.map((r) => ({
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
            'Translated message': r['Translated message'] || ''
          })));
          alert("Chat Logs uploaded successfully.");
        }
      });
    }
  };

  const startAnalysis = async () => {
    if (!botSummary || (csvData.length === 0 && standardLogData.length === 0 && chatLogData.length === 0)) return alert("Please configure bot context and upload chat logs.");
    setLoading(true);
    try {
      const result = await analyzeConversations(
        csvData,
        botSummary,
        goals,
        selectedModel,
        geminiApiKey,
        openaiApiKey,
        standardLogData,
        chatLogData
      );
      setAnalysisResult(result);
      setViewMode('dashboard');
      setActiveTab('summary');
    } catch (error) { alert(`AI Analysis failed: ${error instanceof Error ? error.message : String(error)}`); } finally { setLoading(false); }
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

    const reportElement = document.getElementById('report-content');
    const originalStyle = reportElement?.getAttribute('style') || '';
    if (reportElement) {
      reportElement.style.height = 'auto';
      reportElement.style.overflow = 'visible';
    }

    const wb = XLSX.utils.book_new();

    const execData = [
      ["STRATEGIC PERFORMANCE AUDIT - EXECUTIVE OVERVIEW"],
      [`Bot ID: ${botId || 'N/A'}`],
      [`Analysis Date: ${new Date().toLocaleDateString()}`],
      [],
      ["KEY PERFORMANCE INDICATORS"],
      ["Metric", "Value", "Pillar Status"],
      ["Total Chats Analyzed", summary.totalChats, "N/A"],
      ["Service Expansion (Bucket 1)", summary.bucketDistribution['1'], "Critical Growth"],
      ["System Optimization (Bucket 2)", summary.bucketDistribution['2'], "Urgent Fixes"],
      ["Information Gaps (Bucket 3)", summary.bucketDistribution['3'], "Knowledge Updates"],
      [],
      ["RESOLUTION OUTCOMES BREAKDOWN"],
      ["Status", "Count"],
      ...Object.entries(summary.statusBreakdown).map(([k, v]) => [k, v])
    ];
    const wsExec = XLSX.utils.aoa_to_sheet(execData);
    XLSX.utils.book_append_sheet(wb, wsExec, "Executive Overview");

    const formatRecommendations = (recs: BucketRecommendation[]) => {
      const header = ["Topic", "Priority", "Score", "Problem Statement", "Recommendation", "KPI to Watch", "Examples"];
      const rows = recs.map(r => [
        r.topic,
        r.strategicPriority,
        r.goalAlignmentScore,
        r.problemStatement,
        r.recommendation,
        r.kpiToWatch,
        r.examples.join(' | ')
      ]);
      return [header, ...rows];
    };

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formatRecommendations(analysisResult.recommendations.bucket1)), "1-Expansion");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formatRecommendations(analysisResult.recommendations.bucket2)), "2-Optimization");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formatRecommendations(analysisResult.recommendations.bucket3)), "3-KnowledgeGaps");

    const auditHeader = analysisResult.categorizedRows[0]?.CALL_ID
      ? ["Pillar", "Outcome", "Topic", "Call ID", "Duration", "Conversation Summary", "User Summary", "Recording"]
      : analysisResult.categorizedRows[0]?.['Session Id']
        ? ["Pillar", "Outcome", "Topic", "Session ID", "Created Date", "Journey Step", "Source", "Medium", "Language", "Message", "Translated Message", "Feedback"]
        : ["Pillar", "Outcome", "Topic", "User Query", "Chat URL"];

    const auditRows = analysisResult.categorizedRows.map((r: any) => {
      const bucketName = r.BUCKET === '1' ? 'EXPANSION' : r.BUCKET === '2' ? 'OPTIMIZE' : r.BUCKET === '3' ? 'GAPS' : 'RESOLVED';

      if (r.CALL_ID) {
        return [
          bucketName,
          r.RESOLUTION_STATUS,
          r.TOPIC,
          r.CALL_ID,
          r.CALL_DURATION,
          r.CONVERSATION_SUMMARY,
          r.USER_SUMMARY,
          r.RECORDING_URL ? { f: `HYPERLINK("${r.RECORDING_URL}", "Open Recording")` } : "--"
        ];
      }

      if (r['Session Id']) {
        return [
          bucketName,
          r.RESOLUTION_STATUS,
          r.TOPIC,
          r['Session Id'],
          r['Created Date'],
          r['Journey:Step'],
          r['Source'],
          r['Interaction medium'],
          r['Language'],
          r['Message'],
          r['Translated message'],
          r['Feedback']
        ];
      }

      const rowData = [
        bucketName,
        r.RESOLUTION_STATUS,
        r.TOPIC,
        r.USER_QUERY,
        r.CHATURL ? { f: `HYPERLINK("${r.CHATURL}", "Open Chat")` } : "--"
      ];
      return rowData;
    });
    const wsAudit = XLSX.utils.aoa_to_sheet([auditHeader, ...auditRows]);
    XLSX.utils.book_append_sheet(wb, wsAudit, "Full Audit Log");

    if (reportElement) reportElement.setAttribute('style', originalStyle);

    XLSX.writeFile(wb, `${botTitle || botId || 'Audit_Report'}.xlsx`);
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
                    <p className="text-[10px] font-black uppercase text-slate-400 text-center">{chatLogData.length > 0 ? `${chatLogData.length} records` : 'Chat Logs'}</p>
                    <input type="file" accept=".csv" onChange={handleChatLogUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </div>

                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-emerald-200 rounded-[1.5rem] p-4 relative hover:bg-white transition-all group">
                    <i className={`fas ${csvData.length > 0 ? 'fa-check-circle text-emerald-500' : 'fa-database text-emerald-300'} text-2xl mb-2 group-hover:scale-110 transition duration-300`}></i>
                    <p className="text-[10px] font-black uppercase text-slate-400 text-center">{csvData.length > 0 ? `${csvData.length} records` : 'CRA Data'}</p>
                    <input type="file" accept=".csv" onChange={handleCsvUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </div>
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
            <button onClick={startAnalysis} disabled={loading || !botSummary || (csvData.length === 0 && standardLogData.length === 0 && chatLogData.length === 0)} className="w-full bg-slate-900 text-white py-6 rounded-full font-black uppercase text-xl shadow-2xl transition-all hover:bg-black disabled:opacity-30">{loading ? 'Processing...' : 'Analyze Performance'}</button>
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
            <th className="p-8 w-[160px]">Outcome</th>
            <th className="p-8 w-[180px]">Topic</th>
            <th className="p-8">{filteredRows[0]?.CALL_ID ? 'Conversation Summary' : (filteredRows[0]?.['Session Id'] ? 'Chat Log' : 'Query')}</th>
            <th className="p-8 w-[100px]">{filteredRows[0]?.CALL_ID ? 'Recording' : 'Audit'}</th>
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
              <td className="p-8 font-black text-slate-700 align-top">{r.RESOLUTION_STATUS}</td>
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
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-[8px] font-black uppercase text-slate-500">Last Step: {r.LAST_STEP || r['Journey:Step']}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">{r.MESSAGE_AGGREGATE || r.USER_QUERY}</p>
                    <div className="flex gap-2">
                      <span className="text-[8px] font-bold text-slate-400 uppercase">Lang: {r['Language']}</span>
                      <span className="text-[8px] font-bold text-slate-400 uppercase">Medium: {r['Interaction medium']}</span>
                      <span className="text-[8px] font-bold text-slate-400 uppercase">Source: {r['Source']}</span>
                    </div>
                  </div>
                ) : r.USER_QUERY}
              </td>
              <td className="p-8 align-top">
                {r.RECORDING_URL || r.CHATURL ? (
                  <a href={r.RECORDING_URL || r.CHATURL} target="_blank" className="text-indigo-600 font-black hover:text-indigo-900">
                    {r.RECORDING_URL ? 'Audio' : 'Link'}
                  </a>
                ) : "--"}
              </td>
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

export default App;
