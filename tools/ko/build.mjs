// Builds the Korean dictionaries in src/Language/ko/Generated/ from the extracted game data.
// Usage: node build.mjs <koDataDir> [outDir]
//   <koDataDir> is a checkout of the ko-data branch (written by tools/ko/extract/slim.mjs)
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const [dataDir, outDirArg] = process.argv.slice(2)
if (!dataDir) {
  console.error('Usage: node build.mjs <koDataDir> [outDir]')
  process.exit(1)
}
const outDir = outDirArg ?? path.join(here, '../../src/Language/ko/Generated')

const readTable = async name => JSON.parse(await fs.readFile(path.join(dataDir, 'tables', `${name}.json`), 'utf-8'))
const report = JSON.parse(await fs.readFile(path.join(dataDir, 'report.json'), 'utf-8'))

// Must match normalize() in src/Language/ko/Init.lua: numbers and ranges such as "+(10-20)" become "#",
// but only at a word boundary
const RANGE = /^[+-]?\(-?\d+\.?\d*--?\d+\.?\d*\)/
const NUMBER = /^[+-]?\d[\d,]*\.?\d*/
function normalize (text) {
  let out = ''
  const values = []
  let pos = 0
  let plainStart = 0
  while (pos < text.length) {
    const rest = text.slice(pos)
    const token = (rest.match(RANGE) ?? rest.match(NUMBER))?.[0]
    if (token && (pos === 0 || !/[A-Za-z0-9_]/.test(text[pos - 1]))) {
      out += text.slice(plainStart, pos) + '#'
      values.push(token)
      pos += token.length
      plainStart = pos
    } else {
      pos++
    }
  }
  return { key: out + text.slice(plainStart), values }
}

// "[Keyword|Shown text]" -> "Shown text", "[Keyword]" -> "Keyword"
const stripMarkup = text => text.replace(/\[([^\]|]*)\|([^\]]*)\]/g, '$2').replace(/\[([^\]|]*)\]/g, '$1')

class Dictionary {
  constructor () {
    this.entries = new Map()
    this.conflicts = 0
  }

  add (en, kr, override = false) {
    if (!en || !kr || en === kr) return
    if (this.entries.has(en) && this.entries.get(en) !== kr) {
      this.conflicts++
      if (!override) return
    }
    this.entries.set(en, kr)
  }
}

// ---- Names and interface strings from the data tables ----

const exact = new Dictionary()

// Generic client strings first, so the more specific tables below take precedence
for (const row of await readTable('ClientStrings')) {
  const { en, ko } = row.Text
  if (en && en.length <= 80 && !/[{}%]/.test(en) && !en.includes('\n')) exact.add(stripMarkup(en), stripMarkup(ko))
}

const nameTables = [
  ['ItemClassCategories', ['Text']],
  ['ItemClasses', ['Name']],
  ['Characters', ['Name']],
  ['Ascendancy', ['Name']],
  ['PantheonPanelLayout', ['GodName1', 'GodName2', 'GodName3', 'GodName4']],
  ['AlternatePassiveSkills', ['Name']],
  ['PassiveSkills', ['Name']],
  ['Mods', ['Name']],
  ['ActiveSkills', ['DisplayedName']],
  ['BaseItemTypes', ['Name']],
  ['Words', ['Text2']]
]
for (const [table, columns] of nameTables) {
  for (const row of await readTable(table)) {
    for (const col of columns) {
      const { en, ko } = row[col]
      if (!en || en.startsWith('[DNT]')) continue
      exact.add(en, ko, true)
      // Path of Building names support gems without the " Support" suffix
      if (table === 'BaseItemTypes' && / Support$/.test(en) && / 보조$/.test(ko)) {
        exact.add(en.replace(/ Support$/, ''), ko.replace(/ 보조$/, ''), true)
      }
    }
  }
}

// ---- Mod and skill stat lines from the stat description files ----

const exactMods = new Dictionary()
const templates = new Dictionary()
let skippedLines = 0

function parseVariant (line) {
  const first = line.indexOf('"')
  const last = line.lastIndexOf('"')
  if (first < 0 || last <= first) return null
  return { cond: line.slice(0, first).trim(), text: line.slice(first + 1, last) }
}

// Converts an English/Korean description pair into a template keyed the way Init.lua looks it up
function addDescription (enText, krText) {
  enText = stripMarkup(enText)
  krText = stripMarkup(krText)
  const enLines = enText.split('\\n')
  const krLines = krText.split('\\n')
  if (enLines.length !== krLines.length) {
    skippedLines++
    return
  }
  for (let i = 0; i < enLines.length; i++) {
    let seq = 0
    // Replace placeholders with markers that normalize() sees as numbers, to find which "#" each one becomes
    const marked = enLines[i].replace(/\{(\d*)(?::[^}]*)?\}/g, (_, idx) => `7770${idx === '' ? seq++ : idx}777`)
    const { key, values } = normalize(marked)
    const positionOf = new Map()
    values.forEach((val, pos) => {
      const m = val.match(/7770(\d+)777/)
      if (m) positionOf.set(m[1], pos + 1)
    })
    if (key.includes('7770')) {
      // Placeholder glued to a word: cannot be matched at runtime
      skippedLines++
      continue
    }
    let krSeq = 0
    let unmapped = false
    let kr = krLines[i].replace(/\{(\d*)(?::[^}]*)?\}/g, (_, idx) => {
      const pos = positionOf.get(idx === '' ? String(krSeq++) : idx)
      if (!pos) unmapped = true
      return `{${pos}}`
    })
    // Numbers written literally in the English text are still "#" at runtime, so the Korean text must
    // take them from the actual line too, e.g. "20% less maximum Life" -> "생명력 최대치 {1}% 감폭"
    values.forEach((val, pos) => {
      if (/7770\d+777/.test(val)) return
      const literal = val.replace(/^\+/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(^|[^\\d{])[+]?${literal}(?![\\d}])`)
      if (re.test(kr)) {
        kr = kr.replace(re, `$1{${pos + 1}}`)
      } else {
        unmapped = true
      }
    })
    if (unmapped) {
      skippedLines++
    } else if (values.length === 0) {
      exactMods.add(enLines[i], kr)
    } else {
      templates.add(key, kr)
    }
  }
}

function parseStatDescriptions (text) {
  let english = []
  let korean = []
  let lang = null
  const flush = () => {
    if (english.length && english.length === korean.length) {
      english.forEach((variant, idx) => addDescription(variant.text, korean[idx].text))
    } else if (english.length && korean.length) {
      skippedLines += english.length
    }
    english = []
    korean = []
  }
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) {
      flush()
      lang = null
      continue
    }
    const langMatch = line.match(/^\s*lang "(.+)"/)
    if (langMatch) {
      lang = langMatch[1]
      continue
    }
    const variant = parseVariant(line)
    if (!variant) continue
    if (lang === null) english.push(variant)
    else if (lang === 'Korean') korean.push(variant)
  }
  flush()
}

const statDir = path.join(dataDir, 'StatDescriptions')
// The first translation of a line wins: stat_descriptions.txt first so the main item mod wording takes
// precedence over skill specific variants
const statFiles = (await fs.readdir(statDir)).sort((a, b) => (b === 'stat_descriptions.txt') - (a === 'stat_descriptions.txt'))
for (const file of statFiles) {
  parseStatDescriptions(await fs.readFile(path.join(statDir, file), 'utf-8'))
}

// ---- Output ----

const luaString = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"'

// LuaJIT runs out of constants in large table constructors, so emit chunks of assignments in separate functions
function writeLua (file, header, tables) {
  const lines = [`-- ${header}`, `-- Generated by tools/ko/build.mjs from game data patch ${report.patch}. Do not edit.`, 'local exact, templates = { }, { }']
  for (const [name, dict] of Object.entries(tables)) {
    const entries = [...dict.entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    for (let i = 0; i < entries.length; i += 4000) {
      // Leading ";" avoids Lua 5.1's "ambiguous syntax" error after the previous chunk's "end)()"
      lines.push(';(function()')
      for (const [en, kr] of entries.slice(i, i + 4000)) lines.push(`${name}[${luaString(en)}]=${luaString(kr)}`)
      lines.push('end)()')
    }
  }
  lines.push('return { exact = exact, templates = templates }', '')
  return fs.writeFile(path.join(outDir, file), lines.join('\n'))
}

await fs.mkdir(outDir, { recursive: true })
await writeLua('Data.lua', 'Korean names from the game data tables', { exact })
await writeLua('Mods.lua', 'Korean mod and stat lines from the game stat descriptions', { exact: exactMods, templates })

console.log(`patch ${report.patch}`)
console.log(`names:     ${exact.entries.size} (conflicts ${exact.conflicts})`)
console.log(`mod exact: ${exactMods.entries.size} (conflicts ${exactMods.conflicts})`)
console.log(`templates: ${templates.entries.size} (conflicts ${templates.conflicts})`)
console.log(`skipped:   ${skippedLines}`)
