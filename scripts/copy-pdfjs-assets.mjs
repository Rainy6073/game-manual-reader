// Copies the decoder and font files pdf.js loads at runtime into public/, so
// manuals with JPEG 2000 / JBIG2 images, CJK text or non-embedded fonts render.
import { cpSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', 'pdfjs-dist')
const target = join(root, 'public', 'pdfjs')

rmSync(target, { recursive: true, force: true })
for (const dir of ['wasm', 'cmaps', 'standard_fonts', 'iccs']) {
  cpSync(join(source, dir), join(target, dir), { recursive: true })
}
