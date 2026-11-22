import * as XLSX from 'xlsx';

export interface ExcelColumn<T = any> {
  header: string;
  key: keyof T | ((row: T) => string | number | null | undefined);
  width?: number;
}

export function exportToExcel<T = any>(options: {
  fileName: string;
  sheetName?: string;
  columns: ExcelColumn<T>[];
  rows: T[];
}) {
  const { fileName, sheetName = 'Relatório', columns, rows } = options;

  const dataMatrix: any[][] = [
    columns.map((col) => col.header),
    ...rows.map((row) =>
      columns.map((col) => {
        if (typeof col.key === 'function') {
          const val = col.key(row);
          return val ?? '';
        }
        const val = (row as any)?.[col.key];
        return val ?? '';
      })
    ),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(dataMatrix);
  worksheet['!cols'] = columns.map((col, idx) => {
    const maxLen = Math.max(
      col.header.length + 4,
      ...(dataMatrix.slice(1).map((r) => String(r[idx] ?? '').length + 2))
    );
    return { wch: col.width || Math.min(Math.max(maxLen, 12), 45) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));

  const safeName = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  XLSX.writeFile(workbook, safeName);
}
