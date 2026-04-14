import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get('filename');

    if (!filename) {
      return NextResponse.json({ error: "Filename is required" }, { status: 400 });
    }

    // Safety check: ensure filename doesn't contain path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const reportPath = path.join(process.cwd(), 'output', 'research', filename);
    
    try {
      const content = await fs.readFile(reportPath, 'utf-8');
      return NextResponse.json({ content });
    } catch (err) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
  } catch (error) {
    console.error("Report fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
