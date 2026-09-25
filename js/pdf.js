// Client-side PDF in the layout of the reference chart: Letter landscape,
// 8 dates per page, bold shaded Date row, bold shaded first column repeated
// on every page, full borders, wrapped text, uniform column widths.
import { buildTable, fromISO } from "./model.js";

const PER_PAGE = 8;
const MARGIN = 36;
const FIRST_COL = 88;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (iso) => {
  const d = fromISO(iso);
  return `${d.getDate()}_${MONTHS[d.getMonth()]}_${d.getFullYear()}`;
};

export function fileName(from, to, name) {
  const who = (name || "").trim().replace(/[^\w-]+/g, "_");
  return `${who ? who + "_" : ""}Medical_Chart_${nice(from)}_-_${nice(to)}.pdf`;
}

export function makePdf(dates, dayMap, ctx) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const colW = (pageW - MARGIN * 2 - FIRST_COL) / PER_PAGE;

  for (let i = 0; i < dates.length; i += PER_PAGE) {
    const chunk = dates.slice(i, i + PER_PAGE);
    const [head, ...body] = buildTable(chunk, dayMap, ctx);
    if (i > 0) doc.addPage();

    const columnStyles = { 0: { cellWidth: FIRST_COL, halign: "left", font: "times", fontStyle: "bold", fillColor: [242, 242, 242] } };
    chunk.forEach((_, j) => (columnStyles[j + 1] = { cellWidth: colW }));

    doc.autoTable({
      head: [head],
      body,
      startY: MARGIN,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN },
      tableWidth: FIRST_COL + colW * chunk.length,
      theme: "grid",
      showHead: "everyPage",
      styles: {
        font: "helvetica",
        fontSize: 9.5,
        textColor: 0,
        halign: "center",
        valign: "middle",
        lineColor: [0, 0, 0],
        lineWidth: 0.6,
        cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
        overflow: "linebreak",
        minCellHeight: 15,
      },
      headStyles: { font: "times", fontStyle: "bold", fillColor: [226, 231, 242], textColor: 0, halign: "center" },
      columnStyles,
    });
  }
  return doc;
}
