export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function medianAbsoluteDeviation(values: readonly number[]): number {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const center = mean(values);
  return Math.sqrt(sum(values.map((value) => (value - center) ** 2)) / (values.length - 1));
}

export function rootMeanSquare(values: readonly number[]): number {
  return Math.sqrt(mean(values.map((value) => value * value)));
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface Regression {
  coefficients: number[];
  standardErrors: number[];
}

export function leastSquares(rows: readonly (readonly number[])[], target: readonly number[]): Regression | null {
  const size = rows[0]?.length ?? 0;
  if (rows.length <= size) return null;
  const matrix = Array.from({ length: size }, (_, i) => [
    ...Array.from({ length: size }, (_, j) => sum(rows.map((row) => row[i]! * row[j]!))),
    ...Array.from({ length: size }, (_, j) => (i === j ? 1 : 0)),
    sum(rows.map((row, index) => row[i]! * target[index]!)),
  ]);
  const width = 2 * size + 1;
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(matrix[pivot]![column]!) < 1e-9) return null;
    [matrix[column], matrix[pivot]] = [matrix[pivot]!, matrix[column]!];
    const lead = matrix[column]![column]!;
    for (let k = 0; k < width; k++) matrix[column]![k]! /= lead;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = matrix[row]![column]!;
      for (let k = 0; k < width; k++) matrix[row]![k]! -= factor * matrix[column]![k]!;
    }
  }
  const coefficients = matrix.map((row) => row[width - 1]!);
  const residualVariance =
    sum(rows.map((row, index) => (target[index]! - sum(row.map((value, k) => value * coefficients[k]!))) ** 2)) / (rows.length - size);
  const standardErrors = matrix.map((row, index) => Math.sqrt(Math.max(residualVariance * row[size + index]!, 0)));
  return { coefficients, standardErrors };
}
