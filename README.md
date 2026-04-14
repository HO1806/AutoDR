# 🛰️ AutoDR v2.2
### *Advanced Multi-Agent Deep Research & Synthesis*

AutoDR is a high-performance orchestration engine designed to transform raw documents into comprehensive, search-grounded research reports. Powered by **Gemini 2.0 Flash** via the **Google AI SDK**, it features real-time web grounding and autonomous agent loops.

---

## 🚀 Key Features

-   **🔍 AI-Powered Extraction**: Automatically identifies research categories and formulates optimized search queries from input documents.
-   **🌐 Real-Time Web Grounding**: Deep Research mode utilizes Gemini's native **Google Search Grounding** to fetch the latest data, statistics, and citations at zero extra cost.
-   **🤖 Multi-Agent Logic**:
    -   *Extraction Agent*: Gemini 2.0 Flash for structured JSON prompt generation.
    -   *Research Agent*: Specialized search-to-report loop with live citations.
    -   *Synthesis Agent*: High-level summary generation for executive decision-making.
-   **📈 Resilience Architecture**: Built-in exponential backoff and retry logic to maintain high uptime across Google AI endpoints.
-   **🛡️ Secure & Scalable**: Environment-driven configuration and optimized token usage for heavy-duty research workloads.

---

## 🛠️ Technology Stack

-   **Framework**: Next.js 15 (App Router)
-   **Logic**: TypeScript / Node.js
-   **AI Infrastructure**: Google AI SDK (@google/generative-ai)
-   **Core Model**: `gemini-2.0-flash`
-   **Web Tools**: Native Google Search Retrieval (Grounding)

---

## 🚦 Getting Started

### 1. Environment Setup
Create a `.env.local` file in the root directory:
```env
GEMINI_API_KEY=your_key_here
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to access the Research Dashboard.

---

## 📝 Usage Flow

1.  **Ingest**: Paste your project documentation or requirements into the "Input Document" section.
2.  **Extract**: Click "Extract Research Prompts" to generate targeted research tracks.
3.  **Research**: Click "Run Research Pipeline". Enable **Deep Research** for live web search functionality.
4.  **Synthesize**: The system automatically compiles all findings into a master synthesis document.

---

## 📦 Output Structure
All results are persisted in the `/output/research/` directory:
- `catXX_...`: Individual research tracks with citations.
- `master_synthesis.md`: Unified executive summary.

---
**Status**: `ACTIVE` | **Engine**: `Google/Gemini-2.0-Flash` | **Version**: `2.2.0`

