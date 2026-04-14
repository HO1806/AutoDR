"use client";

import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { UploadCloud, CheckCircle, Play, Loader2, Database, Terminal, FileCode2, Cpu, ChevronRight, Zap, Activity, AlertCircle } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, AnimatePresence } from 'framer-motion';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Prompt {
  category_title: string;
  prompt_title: string;
  prompt_text: string;
  filename?: string;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loadingExtract, setLoadingExtract] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  
  // Pipeline status
  const [pipelineActive, setPipelineActive] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [stage, setStage] = useState<"idle" | "research" | "synthesis" | "complete" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [synthesisContent, setSynthesisContent] = useState<string | null>(null);
  const [reportInView, setReportInView] = useState<{title: string, content: string} | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`].slice(-50));
  };


  const handleFiles = async (fileList: FileList) => {
    if (fileList && fileList[0]) {
      const selected = fileList[0];
      setFile(selected);
      await extractPrompts(selected);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      await handleFiles(e.dataTransfer.files);
    }
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const extractPrompts = async (targetFile: File) => {
    // Show loading state immediately to provide feedback per UX guidelines
    setLoadingExtract(true);
    setPrompts([]);
    setStage("idle");
    setStatusMessage("");

    try {
      const formData = new FormData();
      formData.append("file", targetFile);

      const res = await fetch("/api/extract-prompts", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setPrompts(data.prompts || []);
        addLog(`SUCCESS: ${data.prompts?.length || 0} PROMPTS EXTRACTED FROM PAYLOAD.`);
      } else {
        addLog(`EXTRACT_ERROR: ${data.error}`);
        alert("Extract error: " + data.error);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`FATAL_ERROR: CONNECTION_FAILED - ${msg}`);
      alert("Error: " + msg);
    } finally {
      setLoadingExtract(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const startPipeline = async () => {
    if (prompts.length === 0) return;
    
    setPipelineActive(true);
    setStage("research");
    setLogs([]);
    addLog("DEEP RESEARCH PROTOCOL INITIATED.");
    setStatusMessage("INITIALIZING...");

    try {
      const res = await fetch("/api/run-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts, searchEnabled }),
      });

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let isDone = false;

      while (!isDone) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const events = chunk.split("\n\n");
        
        for (const event of events) {
          if (!event.trim()) continue;
          
          if (event.includes("event: done")) {
            const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
            if (dataLine) {
               try {
                 const data = JSON.parse(dataLine.replace("data: ", ""));
                 if (data.synthesis) setSynthesisContent(data.synthesis);
               } catch(e) {}
            }
            isDone = true;
            addLog("PROTOCOL COMPLETE. SYNTHESIS GENERATED.");
            break;
          }

          if (event.startsWith("event: status")) {
            const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
            if (dataLine) {
              const data = JSON.parse(dataLine.replace("data: ", ""));
              setStage(data.stage);
              setStatusMessage(data.message.toUpperCase());
              addLog(data.message.toUpperCase());
              if (data.total) {
                setProgress({ current: data.current, total: data.total });
              }
              if (data.filename && data.current) {
                // Update the prompt at index data.current - 1
                setPrompts(prev => {
                  const updated = [...prev];
                  if (updated[data.current - 1]) {
                    updated[data.current - 1].filename = data.filename;
                  }
                  return updated;
                });
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(err);
      addLog(`FATAL_ERROR: PIPELINE DISCONNECTED - ${msg}`);
      setStatusMessage("FATAL ERROR: PIPELINE DISCONNECTED");
      setStage("error");
    } finally {
      setPipelineActive(false);
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const fetchReport = async (filename: string, title: string) => {
    try {
      addLog(`FETCHING_REPORT: ${filename}...`);
      const res = await fetch(`/api/research-report?filename=${filename}`);
      const data = await res.json();
      if (res.ok) {
        setReportInView({ title, content: data.content });
      } else {
        alert("Report error: " + data.error);
      }
    } catch (err: unknown) {
      alert("Failed to fetch report");
    }
  };

  return (
    <div className="crt min-h-screen bg-[#050505] text-[#f0f0f0] flex flex-col font-sans selection:bg-[#ff5500]/40 pb-20">
      
      {/* Top Console Header */}
      <header className="border-b-2 border-[#ff5500] bg-black/80 backdrop-blur-md px-6 py-4 sticky top-0 z-50 flex items-center justify-between shadow-[0_4px_20px_rgba(255,85,0,0.15)]">
        <div className="flex items-center gap-4">
          <Terminal className="w-6 h-6 text-[#ff5500]" />
          <div>
            <h1 className="font-bold uppercase tracking-widest text-lg leading-tight text-white glitch-text" data-text="DEVIX_TERMINAL">DEVIX_TERMINAL</h1>
            <p className="text-[10px] text-[#ff5500] font-mono tracking-widest">DEEP RESEARCH PIPELINE v2.1</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#1a1a1a] border border-[#333] px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-[#aaa] shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
            <Cpu className="w-3.5 h-3.5" /> 
            <span>LOCAL_NODE_ACTIVE</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full p-4 md:p-8 space-y-8">
        
        {/* Module 1: Brutalist Ingestion Area (21st dev styled) */}
        <section className="space-y-4">
          <div className="w-full overflow-hidden border-2 border-[#333] bg-[#0c0c0e] shadow-[4px_4px_0px_0px_rgba(255,85,0,0.3)]">
            <div className="border-b-2 border-[#333] bg-[#1a1a1a] p-4">
              <div className="flex items-center gap-3">
                <Database className="h-5 w-5 text-[#ff5500]" />
                <h2 className="font-bold tracking-widest text-lg text-white uppercase">INGESTION_PORT</h2>
                <div className={cn(
                  "ml-auto px-2 py-0.5 text-xs font-mono font-bold border",
                  file ? "bg-[#ccff00]/20 text-[#ccff00] border-[#ccff00]/50" : "bg-[#ff5500]/20 text-[#ff5500] border-[#ff5500]/50"
                  )}>
                  {file ? "AWAITING_EXEC" : "AWAITING_INPUT"}
                </div>
              </div>
            </div>

            <div className="p-6 md:p-10">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".txt,.pdf,.html,.md,.csv"
                onChange={handleFileChange}
              />
              
              <motion.div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => !pipelineActive && fileInputRef.current?.click()}
                initial={false}
                animate={{
                  borderColor: isDragging ? "#ccff00" : "rgba(255,85,0,0.4)",
                  scale: isDragging ? 1.02 : 1,
                  backgroundColor: isDragging ? "rgba(204,255,0,0.05)" : "rgba(0,0,0,0.4)"
                }}
                whileHover={{ scale: pipelineActive ? 1 : 1.01 }}
                transition={{ duration: 0.2 }}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!pipelineActive) fileInputRef.current?.click();
                  }
                }}
                className={cn(
                  "relative border-2 border-dashed p-12 md:p-16 text-center cursor-pointer flex flex-col items-center justify-center gap-6 focus:outline-none focus:ring-2 focus:ring-[#ff5500]",
                  pipelineActive ? "opacity-50 pointer-events-none" : "hover:border-[#ff5500]",
                  loadingExtract && "animate-pulse border-solid border-[#ff5500]"
                )}
              >
                {/* Decorative Brackets */}
                <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#ff5500] -translate-x-[2px] -translate-y-[2px]" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#ff5500] translate-x-[2px] -translate-y-[2px]" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#ff5500] -translate-x-[2px] translate-y-[2px]" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#ff5500] translate-x-[2px] translate-y-[2px]" />

                {loadingExtract ? (
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-12 h-12 text-[#ff5500] animate-spin" />
                    <div className="text-center">
                      <p className="font-mono font-bold tracking-widest text-[#ff5500]">EXTRACTING_PAYLOAD...</p>
                      <p className="font-mono text-xs text-[#888] mt-1">LLM_PARSE: IN_PROGRESS</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-6">
                    <motion.div
                      animate={{ y: isDragging ? [-5, 0, -5] : 0 }}
                      transition={{ duration: 1.5, repeat: isDragging ? Infinity : 0, ease: "easeInOut" }}
                      className="relative"
                    >
                      <motion.div
                        animate={{
                          opacity: isDragging ? [0.5, 1, 0.5] : 0,
                          scale: isDragging ? [0.95, 1.05, 0.95] : 1,
                        }}
                        transition={{ duration: 2, repeat: isDragging ? Infinity : 0, ease: "easeInOut" }}
                        className="absolute -inset-4 bg-[#ccff00]/10 rounded-full blur-md"
                        style={{ display: isDragging ? "block" : "none" }}
                      />
                      <div className="w-20 h-20 bg-[#1a1a1a] border-2 border-[#333] flex items-center justify-center transition-colors shadow-[0_0_15px_rgba(0,0,0,0.8)] relative z-10 group-hover:border-[#ff5500]">
                        <UploadCloud className={cn("w-10 h-10 transition-colors", isDragging ? "text-[#ccff00]" : "text-[#666] group-hover:text-[#ff5500]")} />
                      </div>
                    </motion.div>
                    
                    <div className="text-center space-y-2">
                       <h3 className="font-mono font-bold tracking-widest text-lg md:text-xl text-white uppercase">
                        {isDragging ? "DROP CLASSIFIED DATA" : file ? "DOCUMENT LOADED" : "INITIALIZE UPLOAD SEQUENCE"}
                      </h3>
                      <p className="font-mono text-sm text-[#888] uppercase">
                        {isDragging ? (
                          <span className="text-[#ccff00]">RELEASE_TO_PROCESS</span>
                        ) : file ? (
                          <span className="text-[#ff5500]">[ {file.name} ]</span>
                        ) : (
                          "[ DRAG & DROP OR CLICK BROWSE ]"
                        )}
                      </p>
                      <p className="font-mono text-[10px] text-[#555] uppercase mt-2">
                        Supported: .TXT, .PDF, .HTML, .MD, .CSV
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            </div>
          </div>
        </section>

        {/* Module 2: Execution Status */}
        {prompts.length > 0 && (
          <section className="space-y-6">
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-4 bg-[#0c0c0e] border-2 border-[#333] p-1 pr-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <button
                  onClick={() => !pipelineActive && setSearchEnabled(!searchEnabled)}
                  disabled={pipelineActive}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 font-mono text-[10px] font-bold uppercase transition-all",
                    searchEnabled ? "bg-[#ccff00] text-black" : "bg-[#222] text-[#666]"
                  )}
                >
                  <Zap className={cn("w-3 h-3", searchEnabled && "fill-current")} />
                  {searchEnabled ? "SEARCH_GROUNDING_ON" : "SEARCH_GROUNDING_OFF"}
                </button>
                <div className="flex flex-col">
                  <span className="text-[9px] font-mono text-[#444] leading-tight">QUOTA_MODE:</span>
                  <span className={cn("text-[9px] font-mono font-bold leading-tight", searchEnabled ? "text-[#ccff00]" : "text-[#888]")}>
                    {searchEnabled ? "GOOGLE_SEARCH_GROUNDED" : "FAST_GENERATION_ONLY"}
                  </span>
                </div>
              </div>

              <button
                onClick={startPipeline}
                disabled={pipelineActive || stage === "complete"}
                className={cn(
                  "btn-glitch relative overflow-hidden px-8 py-4 font-mono font-bold uppercase tracking-widest text-sm flex items-center gap-3 transition-all border-2 shadow-[6px_6px_0px_0px_rgba(255,85,0,0.5)] active:translate-x-1 active:translate-y-1 active:shadow-none hover:shadow-[8px_8px_0px_0px_rgba(255,85,0,0.8)] focus:outline-none focus:ring-2 focus:ring-[#ff5500] focus:ring-offset-2 focus:ring-offset-[#050505]",
                  pipelineActive 
                    ? "bg-[#1a1a1a] text-[#666] border-[#333] cursor-not-allowed shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-1 translate-y-1" 
                    : stage === "complete"
                    ? "bg-[#ccff00] text-black border-[#ccff00] shadow-[6px_6px_0px_0px_rgba(204,255,0,0.4)]"
                    : "bg-[#ff5500] text-black border-[#ff5500]"
                )}
              >
                {pipelineActive ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> EXECUTING...</>
                ) : stage === "complete" ? (
                  <><CheckCircle className="w-4 h-4" /> SECURED</>
                ) : (
                  <><Play className="w-4 h-4 fill-black" /> COMMENCE PIPELINE</>
                )}
              </button>
            </motion.div>

            {/* Pipeline Status Banner */}
            {stage !== "idle" && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                tabIndex={0}
                aria-live="polite"
                className="border-2 border-[#333] bg-[#0c0c0e] p-6 space-y-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-[#ff5500]"
              >
                {/* Decorative scanning line */}
                {pipelineActive && <div className="absolute top-0 left-0 w-full h-[2px] bg-[#ff5500] opacity-50 animate-[scan_2s_ease-in-out_infinite]" />}
                
                <div className="flex items-center justify-between font-mono text-sm">
                  <span className={cn(
                    "flex items-center gap-2 font-bold tracking-widest",
                    stage === "error" ? "text-red-500" : stage === "complete" ? "text-[#ccff00]" : "text-[#ff5500]"
                  )}>
                    {stage === "research" || stage === "synthesis" ? <Activity className="w-4 h-4 animate-pulse" /> : null}
                    {stage === "complete" ? <CheckCircle className="w-4 h-4" /> : null}
                    {stage === "error" ? <AlertCircle className="w-4 h-4" /> : null}
                    
                    {stage === "complete" ? "[ SEQUENCE_COMPLETE ]" : `[ SYS_STATE: ${stage.toUpperCase()} ]`}
                  </span>
                  <span className="text-[#ccc] truncate max-w-[50%] md:max-w-[70%] text-right">{statusMessage}</span>
                </div>
                
                {progress.total > 0 && stage !== "complete" && stage !== "error" && (
                  <div className="w-full bg-[#1a1a1a] border border-[#333] h-3 relative overflow-hidden">
                    <motion.div 
                      className="absolute top-0 left-0 h-full bg-[#ff5500]"
                      initial={{ width: 0 }}
                      animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                    {/* Tick markings overlay */}
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMTAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGxpbmUgeDE9IjAiIHkxPSIwIiB4Mj0iMCIgeTI9IjEwIiBzdHJva2U9IiMxYTFhMWEiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==')] opacity-30 pointer-events-none" />
                  </div>
                )}
              </motion.div>
            )}

            {/* Module 3: Virtual Terminal Log */}
            <section className="space-y-4">
              <div className="w-full overflow-hidden border-2 border-[#333] bg-[#050505] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="border-b-2 border-[#333] bg-[#1a1a1a] p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#ff5500] animate-pulse" />
                    <span className="font-mono text-[10px] uppercase font-bold tracking-tighter text-[#888]">Live_System_Logs</span>
                  </div>
                  <span className="font-mono text-[10px] text-[#444]">{logs.length}/50_LINES</span>
                </div>
                <div className="p-4 h-40 overflow-y-auto font-mono text-xs space-y-1 bg-black/40 scrollbar-thin scrollbar-thumb-[#333] scrollbar-track-transparent">
                  {logs.length === 0 ? (
                    <div className="text-[#333] italic">SYSTEM_IDLE: AWAITING_UPSTREAM_COMMAND...</div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="text-[#333] shrink-0">{i.toString().padStart(2, '0')}</span>
                        <span className={cn(
                          "break-all",
                          log.includes("ERROR") ? "text-red-500" : 
                          log.includes("SUCCESS") ? "text-[#ccff00]" : 
                          log.includes("SEARCHING") ? "text-cyan-400 font-bold animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.5)] bg-cyan-950/20 px-1" :
                          "text-[#888]"
                        )}>{log}</span>
                      </div>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>
            </section>

            {/* Module 4: Strategic Synthesis Result */}
            {synthesisContent && (
              <motion.section 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-4"
              >
                <div className="w-full overflow-hidden border-2 border-[#ccff00] bg-[#0c0c0e] shadow-[8px_8px_0px_0px_rgba(204,255,0,0.2)]">
                  <div className="border-b-2 border-[#ccff00] bg-[#ccff00]/10 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Zap className="h-5 w-5 text-[#ccff00]" />
                      <h2 className="font-bold tracking-widest text-lg text-white uppercase">STRATEGIC_SYNTHESIS</h2>
                    </div>
                    <button 
                      onClick={() => {
                        const blob = new Blob([synthesisContent], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'DEVIX_RESEARCH_SYNTHESIS.md';
                        a.click();
                      }}
                      className="text-[10px] font-mono bg-[#ccff00] text-black px-3 py-1 font-bold hover:bg-white transition-colors"
                    >
                      DOWNLOAD_REPORT
                    </button>
                  </div>
                  <div className="p-6 md:p-8 max-h-[600px] overflow-y-auto font-mono text-sm leading-relaxed scrollbar-thin scrollbar-thumb-[#ccff00]/30">
                    <div className="prose prose-invert max-w-none prose-headings:text-[#ccff00] prose-headings:uppercase prose-headings:tracking-widest prose-hr:border-[#333]">
                      {synthesisContent.split('\n').map((line, i) => {
                        if (line.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold mb-4 mt-8">{line.replace('# ', '')}</h1>;
                        if (line.startsWith('## ')) return <h2 key={i} className="text-xl font-bold mb-3 mt-6 border-b border-[#333] pb-1">{line.replace('## ', '')}</h2>;
                        if (line.startsWith('### ')) return <h3 key={i} className="text-lg font-bold mb-2 mt-4">{line.replace('### ', '')}</h3>;
                        if (line.startsWith('- ')) return <li key={i} className="ml-4 list-disc">{line.replace('- ', '')}</li>;
                        if (line.trim() === '---') return <hr key={i} className="my-6" />;
                        return <p key={i} className="mb-4 text-[#ccc]">{line}</p>;
                      })}
                    </div>
                  </div>
                </div>
              </motion.section>
            )}

            {/* Module 5: Execution Array for Prompts */}
            <div className="w-full overflow-hidden border-2 border-[#333] bg-[#0c0c0e] shadow-[4px_4px_0px_0px_rgba(204,255,0,0.3)]">
              <div className="border-b-2 border-[#333] bg-[#1a1a1a] p-4">
                <div className="flex items-center gap-3">
                  <Terminal className="h-5 w-5 text-[#ccff00]" />
                  <h2 className="font-bold tracking-widest text-lg text-white uppercase">EXECUTION_ARRAY</h2>
                  <div className="ml-auto bg-[#ccff00]/20 text-[#ccff00] border border-[#ccff00]/50 px-2 py-0.5 text-xs font-mono font-bold">
                    {prompts.length} EXTRACTED
                  </div>
                </div>
              </div>

              <div className="divide-y-2 divide-[#333] bg-black">
                <AnimatePresence>
                  {prompts.map((p, index) => {
                    const isExpanded = expandedId === index;
                    return (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(index * 0.05, 0.5) }}
                        className="relative group cursor-pointer"
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setExpandedId(isExpanded ? null : index)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setExpandedId(isExpanded ? null : index);
                            }
                          }}
                          aria-expanded={isExpanded}
                          className="w-full p-4 text-left transition-all hover:bg-[#1a1a1a] hover:pl-6 focus:outline-none focus:bg-[#1a1a1a]"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center items-start gap-4 cursor-pointer">
                            <div className="rounded-[4px] border border-[#333] p-3 bg-[#1a1a1a] group-hover:border-[#ccff00]/50 transition-colors">
                              <FileCode2 className="h-5 w-5 text-[#ccff00]" />
                            </div>

                            <div className="flex-1 min-w-0 w-full">
                              <div className="flex items-center gap-2 mb-1">
                                <code className="font-mono text-sm font-bold text-white truncate break-all">
                                  $ {p.prompt_title || "UNTITLED_QUERY"}
                                </code>
                                <ChevronRight 
                                  className={cn(
                                    'h-4 w-4 text-[#555] transition-transform flex-shrink-0 group-hover:text-[#ccff00]',
                                    isExpanded && 'rotate-90 text-[#ccff00]'
                                  )} 
                                />
                              </div>
                              <div className="flex items-center gap-3 text-[10px] text-[#888] uppercase tracking-wider font-mono">
                                <span className="bg-[#222] px-2 py-0.5">CAT: {p.category_title || "SYS_ROOT"}</span>
                                <span className="text-[#ccff00]">IDX: {String(index).padStart(3, '0')}</span>
                              </div>
                            </div>

                            <div className={cn(
                               "uppercase font-bold border-2 px-3 py-1 text-[10px] sm:self-center font-mono self-start flex items-center gap-2",
                               stage === "complete" || p.filename
                                 ? "border-[#ccff00]/30 bg-[#ccff00]/10 text-[#ccff00]" 
                                 : pipelineActive 
                                   ? "border-[#ff5500]/30 bg-[#ff5500]/10 text-[#ff5500] animate-pulse"
                                   : "border-[#333] bg-[#1a1a1a] text-[#888]"
                             )}>
                              {p.filename && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    fetchReport(p.filename!, p.prompt_title);
                                  }}
                                  className="hover:underline flex items-center gap-1"
                                >
                                  <FileCode2 className="w-3 h-3" /> READ_REPORT
                                </button>
                              )}
                              {!p.filename && (stage === "complete" ? "COMPLETE" : pipelineActive ? "ACTIVE" : "QUEUED")}
                          </div>
                        </div>
                      </div>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeInOut" }}
                              className="overflow-hidden border-t-2 border-[#333] bg-[#0c0c0e]"
                            >
                              <div className="p-6">
                                <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#333]/50 text-[#ff5500]">
                                  <Zap className="w-4 h-4" />
                                  <span className="font-mono uppercase tracking-widest font-bold text-xs">Raw Payload Buffer</span>
                                </div>
                                <pre className="font-mono text-sm text-[#ccff00]/90 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                                  {p.prompt_text}
                                </pre>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Report Modal Overlay */}
      <AnimatePresence>
        {reportInView && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-10"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-4xl h-full max-h-[90vh] bg-[#0c0c0e] border-2 border-[#ccff00] flex flex-col shadow-[0_0_50px_rgba(204,255,0,0.2)]"
            >
              <div className="border-b-2 border-[#ccff00] bg-[#ccff00]/10 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Terminal className="w-5 h-5 text-[#ccff00]" />
                  <h2 className="font-bold tracking-widest text-lg text-white uppercase truncate">{reportInView.title}</h2>
                </div>
                <button 
                  onClick={() => setReportInView(null)}
                  className="bg-[#ccff00] text-black px-4 py-1 font-mono font-bold hover:bg-white transition-colors"
                >
                  CLOSE_TERMINAL
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 md:p-10 font-mono text-sm leading-relaxed scrollbar-thin scrollbar-thumb-[#ccff00]/30 selection:bg-[#ccff00]/20">
                <div className="prose prose-invert max-w-none prose-headings:text-[#ccff00] prose-headings:uppercase prose-headings:tracking-widest prose-hr:border-[#333]">
                  {reportInView.content.split('\n').map((line, i) => {
                    if (line.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold mb-4 mt-2 text-[#ccff00] bg-[#ccff00]/10 inline-block px-2">{line.replace('# ', '')}</h1>;
                    if (line.startsWith('## ')) return <h2 key={i} className="text-xl font-bold mb-3 mt-6 border-b border-[#333] pb-1">{line.replace('## ', '')}</h2>;
                    if (line.startsWith('### ')) return <h3 key={i} className="text-lg font-bold mb-2 mt-4 text-[#ccff00]">{line.replace('### ', '')}</h3>;
                    if (line.startsWith('- ')) return <li key={i} className="ml-4 list-disc mb-1">{line.replace('- ', '')}</li>;
                    if (line.trim() === '---') return <hr key={i} className="my-6 border-[#333]" />;
                    
                    // Simple URL detection
                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                    if (urlRegex.test(line)) {
                      const parts = line.split(urlRegex);
                      return (
                        <p key={i} className="mb-4 text-[#ccc]">
                          {parts.map((part, idx) => 
                            urlRegex.test(part) ? (
                              <a key={idx} href={part} target="_blank" rel="noopener noreferrer" className="text-[#ccff00] underline hover:text-white break-all">
                                {part}
                              </a>
                            ) : part
                          )}
                        </p>
                      );
                    }
                    
                    return <p key={i} className="mb-4 text-[#ccc]">{line}</p>;
                  })}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
