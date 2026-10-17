/** The Fibonacci scale used for effort and value ratings. */
export const FIB = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]

export const isFib = (n: number) => FIB.includes(n)

/** The next scale value above (dir 1) or below (dir -1) `n`. */
export function stepFib(n: number | null, dir: 1 | -1): number {
  if (n == null) return dir === 1 ? FIB[0] : FIB[0]
  const i = FIB.indexOf(n)
  return FIB[Math.min(FIB.length - 1, Math.max(0, i + dir))]
}
