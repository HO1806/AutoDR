import { NextResponse } from 'next/server';
import path from 'path';
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60; 

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize Google AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || "");

async function generateWithRetry(prompt: string, retries = 3, initialDelay = 5000): Promise<string> {
  let delay = initialDelay;
  
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
    }
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      
      // Handle rate limits (429) and temporary errors
      if ((errorMessage.includes('429') || errorMessage.includes('503')) && attempt < retries) {
        console.log(`Extraction Gemini Rate limit or 503 hit. Retrying in ${delay / 1000}s... (Attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2; 
        continue;
      }
      
      if (attempt < retries) {
        console.log(`Extraction Request failed: ${errorMessage}. Retrying in ${delay / 1000}s...`);
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
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }

    if (!GEMINI_API_KEY) {
        return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    let textContent = "";

    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      const pdfParse = (await import('pdf-parse')).default;
      const parsed = await pdfParse(buffer);
      textContent = parsed.text;
    } else {
      textContent = buffer.toString('utf-8');
    }

    if (!textContent || textContent.trim().length === 0) {
      return NextResponse.json({ error: "File appears to be empty or could not be read." }, { status: 400 });
    }

    // Gemini 2.0 Flash has a massive context window, but we limit for speed/reliability in extraction
    const safeText = textContent.length > 500000 ? textContent.substring(0, 500000) : textContent;

    const extractionPrompt = `
      You are an expert data structured extractor. The user has uploaded a raw file containing research prompts.
      Your task is to identify and extract EVERY SINGLE prompt found in the text.
      
      Return the output strictly as a JSON object with a key "prompts" which is an array of objects.
      Each object in the "prompts" array MUST have these EXACT keys:
      - "category_title": The section, topic, or category the prompt belongs to.
      - "prompt_title": The short descriptive title of the prompt itself.
      - "prompt_text": The complete, raw prompt instruction text.

      Raw File Content:
      ${safeText}
    `;

    const resultText = await generateWithRetry(extractionPrompt);
    
    let prompts = [];
    try {
      const parsed = JSON.parse(resultText);
      prompts = parsed.prompts || parsed; 
    } catch (e) {
      console.error("JSON Parse Error on extraction:", e);
      // Fallback: search for json block if model ignored generationConfig (rare with gemini-2.0-flash)
      const cleaned = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        prompts = parsed.prompts || parsed;
      } catch {
        throw new Error("Failed to parse extracted prompts as JSON");
      }
    }

    return NextResponse.json({ prompts });

  } catch (err: unknown) {
    console.error("Extraction error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to extract prompts" }, { status: 500 });
  }
}


