"""
Devix Deep Research Pipeline
────────────────────────────
Phase 1 → Gemini 1.5 Flash  : runs each of the 27 prompts → saves individual .md files
Phase 2 → Gemini 1.5 Pro    : reads all .md files → writes final synthesis

Usage:
    python run_research.py              # run all 27 prompts
    python run_research.py --limit 3    # run first N prompts (testing)
    python run_research.py --synthesis-only  # skip Phase 1, just re-synthesise
"""

import argparse
import json
import os
import re
import sys
import time
import io
from pathlib import Path

# Force UTF-8 for Windows console
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import requests
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────
API_KEY      = os.getenv("GEMINI_API_KEY")
BASE_URL     = "https://generativelanguage.googleapis.com/v1beta/models"
FLASH_MODEL  = "gemini-flash-latest"
PRO_MODEL    = "gemini-pro-latest"

HTML_FILE    = Path("devix-research-prompts-v2.html")
OUTPUT_DIR   = Path("output")
RESEARCH_DIR = OUTPUT_DIR / "research"
SYNTHESIS_FILE = OUTPUT_DIR / "DEVIX_SYNTHESIS.md"

RESEARCH_DIR.mkdir(parents=True, exist_ok=True)

DELAY_BETWEEN_CALLS = 4   # seconds between Flash calls to respect rate limits
MAX_TOKENS          = 8192


# ── Gemini API call ────────────────────────────────────────────────────────────
def call_gemini(model: str, prompt: str, system: str = "") -> str:
    url = f"{BASE_URL}/{model}:generateContent"
    headers = {"Content-Type": "application/json", "X-goog-api-key": API_KEY}

    contents = []
    if system:
        # Gemini doesn't have a system role; prepend it as a user turn context
        contents.append({"role": "user", "parts": [{"text": system}]})
        contents.append({"role": "model", "parts": [{"text": "Understood. I will follow those instructions precisely."}]})

    contents.append({"role": "user", "parts": [{"text": prompt}]})

    body = {
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": MAX_TOKENS,
            "temperature": 0.3,
        },
    }

    resp = requests.post(url, headers=headers, json=body, timeout=120)

    if resp.status_code != 200:
        raise RuntimeError(f"API error {resp.status_code}: {resp.text[:400]}")

    data = resp.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"Unexpected response shape: {data}") from e


# ── HTML parser ────────────────────────────────────────────────────────────────
def parse_prompts(html_path: Path) -> list[dict]:
    """
    Returns a list of dicts:
        { category_num, category_title, prompt_title, badge, prompt_text }
    """
    soup = BeautifulSoup(html_path.read_text(encoding="utf-8"), "html.parser")
    prompts = []

    for section in soup.select("section.cat-section"):
        cat_num   = section.select_one(".cat-num").get_text(strip=True)
        cat_title = section.select_one(".cat-title").get_text(strip=True)

        for card in section.select(".prompt-card"):
            title_el = card.select_one(".prompt-title")
            badge_el  = card.select_one(".pbadge")
            text_el   = card.select_one(".prompt-text")

            if not text_el:
                continue

            prompts.append({
                "category_num":   cat_num,
                "category_title": cat_title,
                "prompt_title":   title_el.get_text(strip=True) if title_el else "Untitled",
                "badge":          badge_el.get_text(strip=True)  if badge_el  else "",
                "prompt_text":    text_el.get_text(strip=True),
            })

    return prompts


def slug(text: str) -> str:
    """Convert text to a filesystem-safe slug."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")[:60]


# ── Phase 1: Flash research ────────────────────────────────────────────────────
def run_research(prompts: list[dict], limit: int | None = None) -> list[Path]:
    total = len(prompts) if limit is None else min(limit, len(prompts))
    print(f"\n{'-'*60}")
    print(f"  PHASE 1 - Gemini 1.5 Flash Research ({total} prompts)")
    print(f"{'-'*60}\n")

    saved_files = []

    for i, p in enumerate(prompts[:total], start=1):
        filename = f"cat{p['category_num']}_{slug(p['prompt_title'])}.md"
        out_path  = RESEARCH_DIR / filename

        # Skip if already done (resume support)
        if out_path.exists():
            print(f"  [{i:02d}/{total}] SKIP  {p['prompt_title'][:55]}")
            saved_files.append(out_path)
            continue

        print(f"  [{i:02d}/{total}] FLASH  {p['prompt_title'][:55]} ...", end=" ", flush=True)

        try:
            answer = call_gemini(FLASH_MODEL, p["prompt_text"])

            md = f"""# {p['prompt_title']}

**Category:** {p['category_num']} — {p['category_title']}  
**Priority:** {p['badge']}  
**Model:** {FLASH_MODEL}  
**Generated:** {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}

---

{answer}
"""
            out_path.write_text(md, encoding="utf-8")
            saved_files.append(out_path)
            print(f"OK  ({len(answer):,} chars)")

        except Exception as e:
            print(f"FAIL  ERROR: {e}")
            # Write an error stub so we can see what failed
            out_path.write_text(f"# ERROR\n\n{e}\n\nOriginal prompt:\n\n{p['prompt_text']}\n")
            saved_files.append(out_path)

        if i < total:
            time.sleep(DELAY_BETWEEN_CALLS)

    return saved_files


# ── Phase 2: Pro synthesis ─────────────────────────────────────────────────────
def run_synthesis(research_files: list[Path]) -> Path:
    print(f"\n{'-'*60}")
    print(f"  PHASE 2 - Gemini 1.5 Pro Synthesis ({len(research_files)} files)")
    print(f"{'-'*60}\n")

    # Assemble all research into one context block
    all_research = []
    for f in sorted(research_files):
        try:
            content = f.read_text(encoding="utf-8", errors="replace")
            all_research.append(f"## {f.stem}\n\n{content}\n\n---\n")
        except Exception as e:
            print(f"  WARN: Could not read {f.name}: {e}")

    combined = "\n".join(all_research)

    synthesis_prompt = f"""You are a senior strategy consultant and product advisor. 
You have just received the results of 27 deep-research reports about building "Devix" — 
a B2B SaaS platform that helps local service businesses (salons, clinics, hammams) in Morocco 
grow through automated websites, booking tools, WhatsApp automation, and review management.

Below are all the research reports. Your task is to write a comprehensive, actionable 
STRATEGIC SYNTHESIS document that:

1. **Executive Summary** (3–5 paragraphs): The single most important strategic conclusion 
   from each of the 9 research categories.

2. **Morocco Market Reality** — What are the 5 most critical validated facts about Morocco 
   that should change how Devix is built vs. a Western-market product?

3. **Niche Recommendation** — Which niche(s) should Devix launch in first, and why? 
   Rank top 3 with justification from the research.

4. **Product Architecture Implications** — What must be true about the product based on 
   digital behaviour, WhatsApp norms, mobile-first requirements, and booking friction research?

5. **Competitive Position** — What is Devix's unique opening in the Morocco market? 
   Who is the real competition, and what is the defensible moat?

6. **Paperclip Configuration Recommendations** — Concrete recommended structure for the 
   Devix multi-agent company: org chart, adapter per department, heartbeat settings, budgets.

7. **Go-to-Market Strategy** — Pricing in MAD, sales channels, trust-building tactics, 
   onboarding design, and first-30-days activation moment.

8. **Automation Configuration** — Validated reminder timing, channel mix (WhatsApp vs SMS vs email), 
   reactivation threshold, and review request timing calibrated for the Moroccan market.

9. **Critical Risks & Open Questions** — What did the research NOT resolve? What are the 
   highest-uncertainty bets Devix is making, and how should they be validated?

10. **Recommended First 90 Days** — A concrete action sequence for the first 90 days of 
    building and launching Devix in Morocco.

Be direct. Use numbered lists and tables where they add clarity. 
Cite specific data points from the research. Be opinionated — this is a strategy document, 
not a summary. Flag where data was absent or weak.

---

RESEARCH REPORTS:

{combined}
"""

    print(f"  PRO  Synthesising {len(combined):,} chars of research ...", end=" ", flush=True)

    try:
        synthesis = call_gemini(PRO_MODEL, synthesis_prompt)

        final_md = f"""# Devix — Strategic Research Synthesis

**Generated by:** Gemini 1.5 Pro  
**Source prompts:** 27 across 9 categories  
**Date:** {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}  
**Research model:** {FLASH_MODEL}  
**Synthesis model:** {PRO_MODEL}

---

{synthesis}
"""
        SYNTHESIS_FILE.write_text(final_md, encoding="utf-8")
        print(f"OK  ({len(synthesis):,} chars)")
        print(f"\n  Saved -> {SYNTHESIS_FILE}")
        return SYNTHESIS_FILE

    except Exception as e:
        print(f"FAIL  ERROR: {e}")
        raise


# ── Entry point ────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Devix Gemini Research Pipeline")
    parser.add_argument("--limit",          type=int, default=None, help="Run only first N prompts")
    parser.add_argument("--synthesis-only", action="store_true",    help="Skip Phase 1, re-run synthesis")
    args = parser.parse_args()

    prompts = parse_prompts(HTML_FILE)
    print(f"\n  Parsed {len(prompts)} prompts from HTML")

    if not args.synthesis_only:
        research_files = run_research(prompts, limit=args.limit)
    else:
        research_files = sorted(RESEARCH_DIR.glob("*.md"))
        print(f"\n  Using {len(research_files)} existing research files")

    synthesis_path = run_synthesis(research_files)

    print(f"\n{'-'*60}")
    print(f"  COMPLETE")
    print(f"  Research files : {RESEARCH_DIR}")
    print(f"  Synthesis      : {synthesis_path}")
    print(f"{'-'*60}\n")


if __name__ == "__main__":
    main()
