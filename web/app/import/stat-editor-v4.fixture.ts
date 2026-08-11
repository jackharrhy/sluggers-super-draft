export function buildStatEditorV4Fixture(): string {
  let lines: string[] = []
  appendRows(lines, 101, 101, () => 1)
  appendRows(lines, 101, 30, (row, column) => row === 0 ? 100 + column : 50 + column)
  appendRows(lines, 24, 25, () => 1)
  lines.push('Medium,High,Low,Group 3,Group 4,Group 5')
  lines.push('1,1,1,0,0,0')
  appendRows(lines, 101, 14, (_row, column) => 1 + column / 10)
  appendRows(lines, 101, 5, (_row, column) => column === 3 ? 0.75 : 10 + column)
  appendRows(lines, 43, 2, () => 1)
  appendRows(lines, 12, 41, () => 0)
  appendRows(lines, 16, 4, () => 1)
  appendRows(lines, 4, 2, () => 1)
  appendRows(lines, 2, 3, () => 1)
  return lines.join('\n')
}

function appendRows(
  lines: string[],
  rows: number,
  columns: number,
  value: (row: number, column: number) => number,
): void {
  for (let row = 0; row < rows; row += 1) {
    lines.push(Array.from({ length: columns }, (_, column) => value(row, column)).join(','))
  }
}
