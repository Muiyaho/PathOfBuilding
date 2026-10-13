// Reduces raw pathofexile-dat output to English + Korean only, in UTF-8.
// Usage: node slim.mjs <exportDir> <outDir> <patch>
//   <exportDir> contains files/ and tables/ as written by pathofexile-dat
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const [exportDir, outDir, patch] = process.argv.slice(2)
if (!exportDir || !outDir || !patch) {
  console.error('Usage: node slim.mjs <exportDir> <outDir> <patch>')
  process.exit(1)
}

const KEEP_LANG = 'Korean'

function decodeText (buf) {
  if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf.subarray(2))
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.subarray(3).toString('utf-8')
  return buf.toString('utf-8')
}

// Stat description files hold every language inline:
//   description / <stats> / <English variants> / lang "French" / <variants> / lang "Korean" / ...
// Keep the English variants and the Korean block, drop the other languages.
function slimStatDescriptions (text) {
  const out = []
  let curLang = null
  for (const line of text.split(/\r?\n/)) {
    const langMatch = line.match(/^\s*lang "(.+)"/)
    if (langMatch) {
      curLang = langMatch[1]
    } else if (/^\S/.test(line)) {
      // Any top level directive (description, no_description, include, ...) starts a new block
      curLang = null
    }
    if (curLang === null || curLang === KEEP_LANG) out.push(line)
  }
  return out.join('\n')
}

const report = { patch, files: {}, tables: {} }

await fs.rm(outDir, { recursive: true, force: true })
await fs.mkdir(path.join(outDir, 'StatDescriptions'), { recursive: true })
await fs.mkdir(path.join(outDir, 'tables'), { recursive: true })

for (const name of await fs.readdir(path.join(exportDir, 'files'))) {
  if (!name.startsWith('Metadata@StatDescriptions@')) continue
  const text = slimStatDescriptions(decodeText(await fs.readFile(path.join(exportDir, 'files', name))))
  const outName = name.replace('Metadata@StatDescriptions@', '')
  await fs.writeFile(path.join(outDir, 'StatDescriptions', outName), text)
  report.files[outName] = {
    descriptions: (text.match(/^description/gm) || []).length,
    korean: (text.match(/^\s*lang "Korean"/gm) || []).length
  }
}

// pathofexile-dat silently falls back to English when a translated table is missing,
// so compare against English to detect tables that were not actually translated.
for (const name of await fs.readdir(path.join(exportDir, 'tables', 'English'))) {
  const en = JSON.parse(await fs.readFile(path.join(exportDir, 'tables', 'English', name), 'utf-8'))
  const ko = JSON.parse(await fs.readFile(path.join(exportDir, 'tables', KEEP_LANG, name), 'utf-8'))
  if (en.length !== ko.length) throw new Error(`Row count mismatch in ${name}: ${en.length} vs ${ko.length}`)
  const textCols = Object.keys(en[0] || {}).filter(col => col !== '_index' && col !== 'Id' && typeof en[0][col] === 'string')
  let differing = 0
  const rows = en.map((enRow, idx) => {
    const koRow = ko[idx]
    const row = {}
    for (const [col, val] of Object.entries(enRow)) {
      if (textCols.includes(col)) {
        row[col] = { en: val, ko: koRow[col] }
        if (val !== koRow[col]) differing++
      } else {
        row[col] = val
      }
    }
    return row
  })
  await fs.writeFile(path.join(outDir, 'tables', name), JSON.stringify(rows))
  report.tables[name.replace(/\.json$/, '')] = { rows: rows.length, translatedCells: differing, fallbackToEnglish: differing === 0 }
}

await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
