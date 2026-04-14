import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const RESEARCH_DIR = path.join(OUTPUT_DIR, 'research');
const SYNTHESIS_DIR = path.join(OUTPUT_DIR, 'synthesis');
const SYNTHESIS_FILE = path.join(SYNTHESIS_DIR, 'AUTODR_SYNTHESIS.md');

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 60);
}

// Initialize Google AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || "");

// Helper for Exponential Backoff with Gemini
async function generateWithRetry(prompt: string, searchEnabled: boolean, retries = 3, initialDelay = 5000): Promise<string> {
  let delay = initialDelay;
  
  // Configure model with search if enabled
  const modelOptions: any = {
    model: "gemini-2.0-flash",
  };

  if (searchEnabled) {
    modelOptions.tools = [
      {
        googleSearchRetrieval: {},
      },
    ];
  }

  const model = genAI.getGenerativeModel(modelOptions);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      
      // Handle rate limits (429)
      if (errorMessage.includes('429') && attempt < retries) {
        console.log(`Gemini Rate limit hit. Retrying in ${delay / 1000}s... (Attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2; 
        continue;
      }
      
      if (attempt < retries) {
        console.log(`Request failed: ${errorMessage}. Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
  throw new Error("Maximum retries exceeded");
}

export async function POST(req: Request) {
  try {
    const { prompts, searchEnabled } = await req.json();

    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      return NextResponse.json({ error: "Invalid prompts array provided" }, { status: 400 });
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        
        function sendEvent(type: string, data: unknown) {
          const payload = JSON.stringify(data);
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${payload}\n\n`));
        }

        try {
          await fs.mkdir(RESEARCH_DIR, { recursive: true });
          await fs.mkdir(SYNTHESIS_DIR, { recursive: true });

          const researchFiles: string[] = [];
          sendEvent('status', { stage: 'research', total: prompts.length, current: 0, message: "Initializing research nodes..." });

          let allResearchContent = "";

          for (let i = 0; i < prompts.length; i++) {
            const p = prompts[i];
            const title = p.prompt_title || "Untitled";
            const filename = `cat${i+1}_${slug(title)}.md`;
            const outPath = path.join(RESEARCH_DIR, filename);

            try {
              if (searchEnabled) {
                sendEvent('status', { 
                  stage: 'research', 
                  total: prompts.length, 
                  current: i, 
                  message: `DEEP RESEARCH (Search): ${title.substring(0, 30)}...` 
                });
              } else {
                 sendEvent('status', { 
                  stage: 'research', 
                  total: prompts.length, 
                  current: i, 
                  message: `GENERATING_ANSWER: ${title.substring(0, 30)}...` 
                });
              }

              const answer = await generateWithRetry(p.prompt_text, searchEnabled, 3, 5000);
              const sourcesMd = searchEnabled ? `\n\n---\n\n*Information researched using Gemini 2.0 Flash with Google Search Grounding.*` : "";

              const md = `# ${title}\n\n**Category:** ${p.category_title || "Uncategorized"}\n**Provider:** Google AI Studio\n**Model:** Gemini 2.0 Flash ${searchEnabled ? '(Deep Research Mode)' : ''}\n**Generated:** ${new Date().toISOString()}\n\n---\n\n${answer}${sourcesMd}`;
              
              await fs.writeFile(outPath, md, 'utf-8');
              researchFiles.push(outPath);
              allResearchContent += `\n\n## ${filename}\n\n${answer}\n\n---\n`;

              sendEvent('status', { 
                stage: 'research', 
                total: prompts.length, 
                current: i + 1, 
                message: `SUCCESS: ${title.substring(0, 30)}... COMPLETED`,
                filename: filename 
              });

              // Delay to stay under free tier limits (Gemini Flash free tier is generous but has RPM limits)
              if (i < prompts.length - 1) {
                const waitTime = searchEnabled ? 10000 : 5000; // Search grounding takes more time/rate
                await new Promise(r => setTimeout(r, waitTime));
              }

            } catch (err: unknown) {
              console.error(`Error on prompt ${i+1}:`, err);
              const errorMessage = err instanceof Error ? err.message : String(err);
              sendEvent('status', { stage: 'research', total: prompts.length, current: i + 1, message: `FAIL: ${title.substring(0, 20)}... - ${errorMessage}` });
              
              const errMd = `# ERROR\n\n${errorMessage}\n\nOriginal prompt:\n\n${p.prompt_text}\n`;
              await fs.writeFile(outPath, errMd, 'utf-8');
              researchFiles.push(outPath);
            }
          }

          // Phase 2: Synthesis
          sendEvent('status', { stage: 'synthesis', total: prompts.length, current: prompts.length, message: "Synthesizing strategic findings..." });

          const synthesisPrompt = `
You are a senior strategy consultant. Synthesize these ${prompts.length} reports into a master strategy document.
Highlight key insights, architectural constraints, and actionable recommendations.

REPORTS TO SYNTHESIZE:

${allResearchContent}

Generate a comprehensive executive synthesis in Markdown.
`;
          
          try {
            // No search for synthesis
            const synthAnswer = await generateWithRetry(synthesisPrompt, false);

            const finalMd = `# Deep Research — Strategic Synthesis\n\n**Provider:** Google AI Studio\n**Generated by:** Gemini 2.0 Flash\n**Source prompts:** ${prompts.length}\n**Date:** ${new Date().toISOString()}\n\n---\n\n${synthAnswer}`;
            
            await fs.writeFile(SYNTHESIS_FILE, finalMd, 'utf-8');

            sendEvent('status', { stage: 'complete', message: "Deep Research pipeline secured. All data synced." });
            sendEvent('done', { synthesis: finalMd });

          } catch (synthErr: unknown) {
             console.error("Synthesis error:", synthErr);
             const errorMessage = synthErr instanceof Error ? synthErr.message : String(synthErr);
             sendEvent('status', { stage: 'error', message: `Synthesis failed: ${errorMessage}` });
             sendEvent('done', {});
          }

        } catch (error: unknown) {
          console.error("Pipeline error:", error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          sendEvent('status', { stage: 'error', message: errorMessage || "Unknown pipeline error" });
          sendEvent('done', {});
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error("Route error:", error);
    return NextResponse.json({ error: "Failed to start pipeline" }, { status: 500 });
  }
}
