// pdfjs-dist is browser-only (relies on DOM APIs). Both the library and its
// worker URL are imported dynamically so this never gets pulled into the SSR
// bundle just by being imported — it only loads when a PDF is actually dropped.
type PositionedPdfText = {
  str: string;
  transform: ArrayLike<number>;
};

const MAX_PDF_PAGES = 100;

function isPositionedPdfText(value: unknown): value is PositionedPdfText {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PositionedPdfText>;
  return typeof item.str === "string" && Boolean(item.transform) && item.transform!.length >= 6;
}

/** Preserve table rows and headings instead of flattening a PDF page into one long sentence. */
export function reconstructPdfPageText(items: readonly unknown[]): string {
  const positioned = items.filter(isPositionedPdfText).filter((item) => item.str.trim());
  if (!positioned.length) return "";

  const lines: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];
  const lineTolerance = 2.5;

  for (const item of positioned) {
    const x = Number(item.transform[4]);
    const y = Number(item.transform[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= lineTolerance);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, text: item.str.trim() });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) =>
      line.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" "),
    )
    .filter(Boolean)
    .join("\n");
}

export async function extractPdfText(file: File): Promise<string> {
  const [pdfjsLib, { default: pdfWorkerUrl }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  if (pdf.numPages > MAX_PDF_PAGES) {
    await pdf.destroy();
    throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page limit.`);
  }

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = reconstructPdfPageText(content.items);
    pageTexts.push(`--- Page ${pageNum} of ${pdf.numPages} ---\n${text}`);
  }

  return pageTexts.join("\n\n").trim();
}
