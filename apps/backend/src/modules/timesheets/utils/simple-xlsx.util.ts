export type XlsxCell =
  | string
  | number
  | null
  | {
      value?: string | number | null;
      formula?: string;
      styleId?: number;
    };

type XlsxCellObject = {
  value?: string | number | null;
  formula?: string;
  styleId?: number;
};

export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
  columnWidths?: number[];
  rowHeights?: Record<number, number>;
  freeze?: {
    rows?: number;
    columns?: number;
  };
  pageSetup?: {
    orientation?: 'portrait' | 'landscape';
    fitToWidth?: number;
    fitToHeight?: number;
  };
}

interface ZipEntry {
  path: string;
  content: Buffer;
  crc32: number;
  localHeaderOffset: number;
}

const CRC32_TABLE = buildCrc32Table();

export function createSimpleXlsxWorkbook(sheets: XlsxSheet[]): Buffer {
  const safeSheets = sheets.length > 0 ? sheets : [{ name: 'Sheet1', rows: [] }];
  const files = new Map<string, string>();

  files.set('[Content_Types].xml', buildContentTypes(safeSheets.length));
  files.set('_rels/.rels', buildRootRels());
  files.set('xl/workbook.xml', buildWorkbook(safeSheets));
  files.set('xl/_rels/workbook.xml.rels', buildWorkbookRels(safeSheets.length));
  files.set('xl/styles.xml', buildStyles());

  safeSheets.forEach((sheet, index) => {
    files.set(`xl/worksheets/sheet${index + 1}.xml`, buildWorksheet(sheet));
  });

  return buildZip(
    [...files.entries()].map(([path, content]) => ({
      path,
      content: Buffer.from(content, 'utf8'),
    })),
  );
}

function buildWorksheet(sheet: XlsxSheet): string {
  const body = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) =>
          buildCell(cell, `${toColumnName(columnIndex + 1)}${rowIndex + 1}`),
        )
        .join('');
      const height = sheet.rowHeights?.[rowIndex + 1];
      const heightAttributes = height
        ? ` ht="${height}" customHeight="1"`
        : '';
      return `<row r="${rowIndex + 1}"${heightAttributes}>${cells}</row>`;
    })
    .join('');
  const columns = sheet.columnWidths?.length
    ? `<cols>${sheet.columnWidths
        .map(
          (width, index) =>
            `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
        )
        .join('')}</cols>`
    : '';
  const frozenRows = sheet.freeze?.rows ?? 0;
  const frozenColumns = sheet.freeze?.columns ?? 0;
  const pane =
    frozenRows || frozenColumns
      ? `<pane${frozenColumns ? ` xSplit="${frozenColumns}"` : ''}${frozenRows ? ` ySplit="${frozenRows}"` : ''} topLeftCell="${toColumnName(frozenColumns + 1)}${frozenRows + 1}" activePane="bottomRight" state="frozen"/>`
      : '';
  const pageSetup = sheet.pageSetup
    ? `<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="${sheet.pageSetup.orientation ?? 'portrait'}" fitToWidth="${sheet.pageSetup.fitToWidth ?? 1}" fitToHeight="${sheet.pageSetup.fitToHeight ?? 0}"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${sheet.pageSetup ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ''}
  <sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  ${columns}
  <sheetData>${body}</sheetData>
  ${pageSetup}
</worksheet>`;
}

function buildCell(cell: XlsxCell, ref: string): string {
  if (cell === null || cell === undefined) {
    return `<c r="${ref}"/>`;
  }

  const normalized: XlsxCellObject =
    typeof cell === 'object' ? (cell as XlsxCellObject) : { value: cell };
  const style = normalized.styleId ? ` s="${normalized.styleId}"` : '';

  if (normalized.formula) {
    const value = normalized.value ?? 0;
    return `<c r="${ref}"${style}><f>${escapeXml(normalized.formula)}</f><v>${escapeXml(String(value))}</v></c>`;
  }

  if (typeof normalized.value === 'number') {
    return `<c r="${ref}"${style}><v>${normalized.value}</v></c>`;
  }

  if (normalized.value === null || normalized.value === undefined) {
    return `<c r="${ref}"${style}/>`;
  }

  return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(String(normalized.value))}</t></is></c>`;
}

function buildContentTypes(sheetCount: number): string {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetOverrides}
</Types>`;
}

function buildRootRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildWorkbook(sheets: XlsxSheet[]): string {
  const sheetItems = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetItems}</sheets>
</workbook>`;
}

function buildWorkbookRels(sheetCount: number): string {
  const worksheetRels = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join('');
  const styleRelId = sheetCount + 1;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRels}
  <Relationship Id="rId${styleRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildStyles(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font/><font><b/></font></fonts>
  <fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF3CD"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F5"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBFF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE3E3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD3F9D8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE8CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFC9C9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9ECEF"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="7" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="8" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="9" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`;
}

function buildZip(files: Array<{ path: string; content: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const file of files) {
    const fileName = Buffer.from(file.path, 'utf8');
    const crc32 = crc32Buffer(file.content);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(file.content.length, 18);
    localHeader.writeUInt32LE(file.content.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, fileName, file.content);
    entries.push({
      path: file.path,
      content: file.content,
      crc32,
      localHeaderOffset: offset,
    });
    offset += localHeader.length + fileName.length + file.content.length;
  }

  const centralParts: Buffer[] = [];
  let centralSize = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.path, 'utf8');
    const centralHeader = Buffer.alloc(46);

    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(entry.crc32, 16);
    centralHeader.writeUInt32LE(entry.content.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(entry.localHeaderOffset, 42);

    centralParts.push(centralHeader, fileName);
    centralSize += centralHeader.length + fileName.length;
  }

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endRecord]);
}

function toColumnName(index: number): string {
  let value = index;
  let name = '';

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildCrc32Table(): number[] {
  return Array.from({ length: 256 }, (_unused, index) => {
    let crc = index;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }

    return crc >>> 0;
  });
}

function crc32Buffer(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
