#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.resolve(__dirname, '../dist')
const parquetDir = path.resolve(__dirname, '../public/data/parquet')
const outputFile = path.resolve(__dirname, '../../../k8s-api-explorer.html')

console.log('📦 Building single HTML file with embedded Parquet...')

// ============================================================================
// ASCII Art Helpers
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  white: '\x1b[37m',
}

const BAR_CHARS = {
  full: '█',
  seven: '▉',
  six: '▊',
  five: '▋',
  four: '▌',
  three: '▍',
  two: '▎',
  one: '▏',
  empty: '░',
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function createBar(percent, width = 30, color = COLORS.cyan) {
  const filled = Math.floor(percent * width)
  const remainder = (percent * width) - filled
  
  let bar = color + BAR_CHARS.full.repeat(filled)
  
  // Add partial block (always adds one character for the partial)
  let hasPartial = false
  if (remainder >= 0.875) { bar += BAR_CHARS.seven; hasPartial = true }
  else if (remainder >= 0.75) { bar += BAR_CHARS.six; hasPartial = true }
  else if (remainder >= 0.625) { bar += BAR_CHARS.five; hasPartial = true }
  else if (remainder >= 0.5) { bar += BAR_CHARS.four; hasPartial = true }
  else if (remainder >= 0.375) { bar += BAR_CHARS.three; hasPartial = true }
  else if (remainder >= 0.25) { bar += BAR_CHARS.two; hasPartial = true }
  else if (remainder >= 0.125) { bar += BAR_CHARS.one; hasPartial = true }
  
  // Fill remaining with empty blocks to ensure consistent width
  const usedChars = filled + (hasPartial ? 1 : 0)
  const remaining = width - usedChars
  bar += COLORS.dim + BAR_CHARS.empty.repeat(Math.max(0, remaining)) + COLORS.reset
  
  return bar
}

// Get display width of a string (accounting for emoji and Unicode)
function getDisplayWidth(str) {
  // Remove ANSI codes first
  const clean = str.replace(/\x1b\[[0-9;]*m/g, '')
  let width = 0
  for (const char of clean) {
    const code = char.codePointAt(0)
    // Emoji and wide chars typically display as 2 columns
    if (code > 0x1F600 || (code >= 0x2500 && code <= 0x257F)) {
      width += 1 // Box drawing chars are 1 wide
    } else if (code > 0xFFFF) {
      width += 2 // Emoji are typically 2 wide
    } else {
      width += 1
    }
  }
  return width
}

function printSizeBreakdown(items, total, title) {
  const nameWidth = 22
  const barWidth = 25
  const percentWidth = 7
  const sizeWidth = 10
  // Total display width: "║ " + name + bar + percent + size + " ║"
  const contentWidth = nameWidth + barWidth + percentWidth + sizeWidth
  const boxWidth = contentWidth + 4 // +4 for "║ " and " ║"
  
  // Use simple ASCII titles for alignment
  const cleanTitle = title.replace(/[^\x20-\x7E]/g, '').trim()
  
  console.log(`\n${COLORS.bright}${COLORS.white}+${'-'.repeat(boxWidth - 2)}+${COLORS.reset}`)
  console.log(`${COLORS.bright}${COLORS.white}|${COLORS.reset} ${COLORS.bright}${cleanTitle}${' '.repeat(contentWidth - cleanTitle.length)} ${COLORS.bright}${COLORS.white}|${COLORS.reset}`)
  console.log(`${COLORS.bright}${COLORS.white}+${'-'.repeat(boxWidth - 2)}+${COLORS.reset}`)
  
  for (const item of items) {
    const percent = item.size / total
    const percentStr = `${(percent * 100).toFixed(1)}%`.padStart(percentWidth)
    const sizeStr = formatBytes(item.size).padStart(sizeWidth)
    const bar = createBar(percent, barWidth, item.color || COLORS.cyan)
    const name = item.name.length > nameWidth - 1 
      ? item.name.slice(0, nameWidth - 2) + '..' 
      : item.name.padEnd(nameWidth)
    
    console.log(`${COLORS.bright}${COLORS.white}|${COLORS.reset} ${name}${bar}${COLORS.dim}${percentStr}${COLORS.reset}${sizeStr} ${COLORS.bright}${COLORS.white}|${COLORS.reset}`)
  }
  
  console.log(`${COLORS.bright}${COLORS.white}+${'-'.repeat(boxWidth - 2)}+${COLORS.reset}`)
  console.log(`${COLORS.bright}${COLORS.white}|${COLORS.reset} ${'TOTAL'.padEnd(nameWidth)}${' '.repeat(barWidth + percentWidth)}${COLORS.bright}${formatBytes(total).padStart(sizeWidth)}${COLORS.reset} ${COLORS.bright}${COLORS.white}|${COLORS.reset}`)
  console.log(`${COLORS.bright}${COLORS.white}+${'-'.repeat(boxWidth - 2)}+${COLORS.reset}`)
}

function printPieChart(items, total) {
  const pieChars = ['◉', '◎', '○', '●', '◐', '◑', '◒', '◓']
  const colors = [COLORS.cyan, COLORS.green, COLORS.yellow, COLORS.magenta, COLORS.blue, COLORS.red, COLORS.white]
  
  console.log(`\n${COLORS.bright}  📊 Bundle Composition${COLORS.reset}`)
  console.log(`  ${'─'.repeat(40)}`)
  
  // Simple horizontal stacked bar
  const barWidth = 50
  let bar = '  '
  let legend = []
  
  items.forEach((item, i) => {
    const percent = item.size / total
    const chars = Math.max(1, Math.round(percent * barWidth))
    const color = colors[i % colors.length]
    bar += color + BAR_CHARS.full.repeat(chars) + COLORS.reset
    legend.push({ name: item.name, percent, color, size: item.size })
  })
  
  console.log(bar)
  console.log()
  
  // Legend
  for (const item of legend) {
    const percentStr = `${(item.percent * 100).toFixed(1)}%`.padStart(6)
    const sizeStr = formatBytes(item.size).padStart(10)
    console.log(`  ${item.color}█${COLORS.reset} ${item.name.padEnd(20)} ${COLORS.dim}${percentStr}${COLORS.reset} ${sizeStr}`)
  }
}

// Analyze bundle composition from stats JSON
function analyzeBundleStats() {
  const statsFile = path.join(distDir, 'bundle-stats.json')
  if (!fs.existsSync(statsFile)) return null
  
  const stats = JSON.parse(fs.readFileSync(statsFile, 'utf-8'))
  const { nodeParts, nodeMetas } = stats
  
  if (!nodeParts || !nodeMetas) return null
  
  const sizes = new Map()
  
  // Aggregate sizes by package
  for (const [uid, meta] of Object.entries(nodeMetas)) {
    const id = meta.id || ''
    let pkg = 'app code'
    
    // Extract package name from module id
    if (id.includes('node_modules/.bun/')) {
      // Bun format: node_modules/.bun/three@0.160.0/node_modules/three/...
      const match = id.match(/\.bun\/([^@/]+)@[^/]+\/node_modules\/([^/]+)/)
      if (match) {
        pkg = match[2].startsWith('@') ? `${match[2]}` : match[2]
      }
    } else if (id.includes('node_modules/')) {
      const match = id.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/)
      if (match) pkg = match[1]
    } else if (id.includes('/src/')) {
      pkg = 'app code'
    }
    
    // Sum up gzip sizes from all parts of this module
    if (meta.moduleParts) {
      for (const partUid of Object.values(meta.moduleParts)) {
        const part = nodeParts[partUid]
        if (part && part.gzipLength) {
          sizes.set(pkg, (sizes.get(pkg) || 0) + part.gzipLength)
        }
      }
    }
  }
  
  // Sort by size and return top entries
  return [...sizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, size]) => ({ name, size }))
}

// Read Vite output
const assetsDir = path.join(distDir, 'assets')
const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'))
const cssFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.css'))

let jsContent = ''
let jsTotalSize = 0
for (const f of jsFiles) {
  const content = fs.readFileSync(path.join(assetsDir, f), 'utf-8')
  jsContent += content
  jsTotalSize += Buffer.byteLength(content, 'utf-8')
  console.log(`  ${COLORS.green}✓${COLORS.reset} Inlined JS: ${f} ${COLORS.dim}(${formatBytes(Buffer.byteLength(content, 'utf-8'))})${COLORS.reset}`)
}

let cssContent = ''
let cssTotalSize = 0
for (const f of cssFiles) {
  const content = fs.readFileSync(path.join(assetsDir, f), 'utf-8')
  cssContent += content
  cssTotalSize += Buffer.byteLength(content, 'utf-8')
  console.log(`  ${COLORS.green}✓${COLORS.reset} Inlined CSS: ${f} ${COLORS.dim}(${formatBytes(Buffer.byteLength(content, 'utf-8'))})${COLORS.reset}`)
}

// Load parquet files as base64
const parquetData = {}
const parquetFiles = []
let parquetTotalSize = 0
if (fs.existsSync(parquetDir)) {
  for (const file of fs.readdirSync(parquetDir)) {
    if (file.endsWith('.parquet')) {
      const filePath = path.join(parquetDir, file)
      const buffer = fs.readFileSync(filePath)
      parquetData[file] = buffer.toString('base64')
      parquetFiles.push({ name: file.replace('.parquet', ''), size: buffer.length })
      parquetTotalSize += buffer.length
      console.log(`  ${COLORS.green}✓${COLORS.reset} Embedded parquet: ${file} ${COLORS.dim}(${formatBytes(buffer.length)})${COLORS.reset}`)
    } else if (file.endsWith('.json')) {
      // Also embed JSON files (like schema_metadata.json)
      const filePath = path.join(parquetDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      parquetData[file] = Buffer.from(content).toString('base64')
      const size = Buffer.byteLength(content, 'utf-8')
      parquetTotalSize += size
      console.log(`  ${COLORS.green}✓${COLORS.reset} Embedded JSON: ${file} ${COLORS.dim}(${formatBytes(size)})${COLORS.reset}`)
    }
  }
}
console.log(`  ${COLORS.cyan}📊${COLORS.reset} Total parquet: ${COLORS.bright}${formatBytes(parquetTotalSize)}${COLORS.reset}`)

// Load JSON data - only small files not in DuckDB
// With DuckDB, we can derive most data from parquet, so skip everything
const jsonData = {}

// In single-file mode with DuckDB, we don't need any JSON files
// - releases: from releases parquet (includes version info, is_latest)
// - api-trees: from api_groups + kinds + kinds_relationships parquet
// - schemas: from kinds.parquet (schema_json column)
// - diffs: from api_diffs.parquet
// - field-history: derived from diffs (MIN version where field added)
// - kind-history: derived from kinds (MIN/MAX version per kind)
// - features: from features + keps parquet

console.log(`  ${COLORS.dim}ℹ️  All data loaded from DuckDB parquet - no JSON needed${COLORS.reset}`)

// Build HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>K8s Compass</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>${cssContent}</style>
</head>
<body>
  <div id="root"></div>
  <script>
    // Embedded parquet files as base64
    window.__PARQUET_DATA__ = ${JSON.stringify(parquetData)};
    
    // Embedded JSON data (for schemas)
    window.__K8S_API_DATA__ = ${JSON.stringify(jsonData)};
    
    // Helper to decode base64 to Uint8Array
    window.__decodeBase64__ = function(base64) {
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    };
    
    // Intercept fetch for both parquet and JSON
    (function() {
      var origFetch = window.fetch;
      window.fetch = function(url) {
        var u = String(url);
        
        // Handle parquet files
        if (u.includes('/data/parquet/')) {
          var filename = u.split('/').pop();
          if (window.__PARQUET_DATA__[filename]) {
            var bytes = window.__decodeBase64__(window.__PARQUET_DATA__[filename]);
            return Promise.resolve(new Response(bytes, {
              headers: {'Content-Type': 'application/octet-stream'}
            }));
          }
        }
        
        // Handle JSON files
        if (u.includes('/data/')) {
          var p = u.replace(/^.*\\/data\\//, '');
          if (window.__K8S_API_DATA__[p]) {
            return Promise.resolve(new Response(JSON.stringify(window.__K8S_API_DATA__[p]), {
              headers: {'Content-Type': 'application/json'}
            }));
          }
        }
        
        return origFetch.apply(this, arguments);
      };
    })();
  </script>
  <script>
    // Create blob URL to run ES module from file://
    var code = ${JSON.stringify(jsContent)};
    var blob = new Blob([code], {type: 'application/javascript'});
    var url = URL.createObjectURL(blob);
    var s = document.createElement('script');
    s.type = 'module';
    s.src = url;
    document.body.appendChild(s);
  </script>
</body>
</html>`

fs.writeFileSync(outputFile, html)
const finalSize = fs.statSync(outputFile).size

// Calculate base64 overhead (parquet binary → base64 is ~33% larger)
const parquetBase64Size = Object.values(parquetData).reduce((sum, b64) => sum + b64.length, 0)
const base64Overhead = parquetBase64Size - parquetTotalSize
const htmlBoilerplate = finalSize - jsTotalSize - cssTotalSize - parquetBase64Size

// ============================================================================
// Print Beautiful Size Breakdown
// ============================================================================

console.log(`\n${COLORS.bright}${COLORS.cyan}`)
console.log(`  ╭─────────────────────────────────────────────────────────────╮`)
console.log(`  │                    📦 BUNDLE SIZE REPORT                    │`)
console.log(`  ╰─────────────────────────────────────────────────────────────╯${COLORS.reset}`)

// Main components breakdown
const mainComponents = [
  { name: 'JavaScript Bundle', size: jsTotalSize, color: COLORS.yellow },
  { name: 'Parquet Data (raw)', size: parquetTotalSize, color: COLORS.cyan },
  { name: 'Base64 Overhead', size: base64Overhead, color: COLORS.magenta },
  { name: 'CSS Styles', size: cssTotalSize, color: COLORS.green },
  { name: 'HTML Boilerplate', size: htmlBoilerplate, color: COLORS.blue },
]

printSizeBreakdown(mainComponents, finalSize, '🗂️  FILE COMPOSITION')

// JS Bundle breakdown (if stats available)
const bundleStats = analyzeBundleStats()
if (bundleStats && bundleStats.length > 0) {
  const colors = [COLORS.yellow, COLORS.green, COLORS.cyan, COLORS.magenta, COLORS.blue, COLORS.red, COLORS.white]
  const coloredStats = bundleStats.map((item, i) => ({
    ...item,
    color: colors[i % colors.length]
  }))
  
  const bundleTotal = bundleStats.reduce((sum, s) => sum + s.size, 0)
  printSizeBreakdown(coloredStats, bundleTotal, '📦 JS DEPENDENCIES (gzipped)')
  
  // Stacked bar visualization
  printPieChart(coloredStats.slice(0, 6), bundleTotal)
}

// Parquet files breakdown
if (parquetFiles.length > 0) {
  const sortedParquet = parquetFiles.sort((a, b) => b.size - a.size)
  const colors = [COLORS.cyan, COLORS.blue, COLORS.green, COLORS.yellow, COLORS.magenta]
  const coloredParquet = sortedParquet.slice(0, 10).map((item, i) => ({
    ...item,
    color: colors[i % colors.length]
  }))
  
  printSizeBreakdown(coloredParquet, parquetTotalSize, '💾 PARQUET DATA FILES')
}

// Runtime dependencies
console.log(`\n${COLORS.bright}${COLORS.white}  ⚡ RUNTIME DEPENDENCIES (loaded from CDN)${COLORS.reset}`)
console.log(`  ${'─'.repeat(45)}`)
console.log(`  ${COLORS.dim}DuckDB WASM${COLORS.reset}      ~4.0 MB   ${COLORS.dim}jsDelivr${COLORS.reset}`)
console.log(`  ${COLORS.dim}Google Fonts${COLORS.reset}     ~50 KB    ${COLORS.dim}fonts.googleapis.com${COLORS.reset}`)
console.log(`  ${COLORS.dim}Strudel samples${COLORS.reset}  ~2.0 MB   ${COLORS.dim}strudel.cc (on-demand)${COLORS.reset}`)

// ============================================================================
// Build Compressed Versions (self-extracting HTML using DecompressionStream)
// ============================================================================

console.log(`\n${COLORS.bright}${COLORS.cyan}  🗜️  Building compressed versions...${COLORS.reset}`)

// Compress the entire HTML using DEFLATE (raw, no zlib header)
const htmlBuffer = Buffer.from(html, 'utf-8')
const compressed = zlib.deflateRawSync(htmlBuffer, { level: 9 })

// ---- Version 1: Web server version (raw binary, smallest) ----
const webOutputFile = path.resolve(__dirname, '../../../k8s-api-explorer.web.html')

// Bootstrap that fetches itself and decompresses - only works over HTTP
const webBootstrap = `<svg onload="fetch(location.href).then(r=>r.blob()).then(b=>new Response(b.slice(BOOTSTRAP_SIZE).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()).then(h=>{document.open();document.write(h);document.close()})"><!--`

// Calculate actual bootstrap size and rebuild with correct offset
const actualBootstrapSize = Buffer.byteLength(webBootstrap.replace('BOOTSTRAP_SIZE', '000'), 'utf-8')
const finalWebBootstrap = webBootstrap.replace('BOOTSTRAP_SIZE', String(actualBootstrapSize).padStart(3, '0'))

// Combine bootstrap + raw compressed data
const webCompressedHtml = Buffer.concat([
  Buffer.from(finalWebBootstrap, 'utf-8'),
  compressed
])

fs.writeFileSync(webOutputFile, webCompressedHtml)
const webCompressedSize = webCompressedHtml.length
const webCompressionRatio = ((1 - webCompressedSize / finalSize) * 100).toFixed(1)

console.log(`  ${COLORS.green}✓${COLORS.reset} Web version: ${formatBytes(finalSize)} → ${COLORS.bright}${formatBytes(webCompressedSize)}${COLORS.reset} (${webCompressionRatio}% smaller)`)
console.log(`  ${COLORS.dim}   Bootstrap: ${actualBootstrapSize} bytes, requires HTTP server${COLORS.reset}`)

// ---- Version 2: File:// version (base64 encoded, works offline) ----
const compressedOutputFile = path.resolve(__dirname, '../../../k8s-api-explorer.compressed.html')

// Convert compressed data to base64 for embedding
const compressedBase64 = compressed.toString('base64')

// Bootstrap that decodes base64 and decompresses using native DecompressionStream
const compressedHtmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<script>
(async()=>{
  const b64="${compressedBase64}";
  const bin=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  const ds=new DecompressionStream('deflate-raw');
  const writer=ds.writable.getWriter();
  writer.write(bin);
  writer.close();
  const chunks=[];
  const reader=ds.readable.getReader();
  while(true){
    const{done,value}=await reader.read();
    if(done)break;
    chunks.push(value);
  }
  const html=new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  document.open();
  document.write(html);
  document.close();
})();
</script>
</body>
</html>`

fs.writeFileSync(compressedOutputFile, compressedHtmlContent)
const compressedSize = Buffer.byteLength(compressedHtmlContent, 'utf-8')

// Calculate sizes
const bootstrapOverhead = compressedSize - compressedBase64.length
const deflateBase64Overhead = compressedBase64.length - compressed.length

const compressionRatio = ((1 - compressedSize / finalSize) * 100).toFixed(1)

console.log(`  ${COLORS.green}✓${COLORS.reset} File version: ${formatBytes(finalSize)} → ${COLORS.bright}${formatBytes(compressedSize)}${COLORS.reset} (${compressionRatio}% smaller)`)
console.log(`  ${COLORS.dim}   Raw deflate: ${formatBytes(compressed.length)}, +base64: ${formatBytes(deflateBase64Overhead)}, +bootstrap: ${formatBytes(bootstrapOverhead)}${COLORS.reset}`)

console.log(`  ${COLORS.dim}ℹ️  Both use native DecompressionStream API (95% browser support)${COLORS.reset}`)

// Final summary with all files
console.log(`\n${COLORS.bright}${COLORS.green}  ✅ BUILD COMPLETE${COLORS.reset}`)
console.log(`  ${'─'.repeat(55)}`)
console.log(`  ${COLORS.dim}Standard:${COLORS.reset}     ${path.basename(outputFile)}`)
console.log(`                ${COLORS.bright}${formatBytes(finalSize)}${COLORS.reset} ${COLORS.dim}(works everywhere)${COLORS.reset}`)
console.log(`  ${COLORS.dim}Compressed:${COLORS.reset}   ${path.basename(compressedOutputFile)}`)
console.log(`                ${COLORS.bright}${formatBytes(compressedSize)}${COLORS.reset} ${COLORS.green}(${compressionRatio}% smaller)${COLORS.reset} ${COLORS.dim}file:// OK${COLORS.reset}`)
console.log(`  ${COLORS.dim}Web:${COLORS.reset}          ${path.basename(webOutputFile)}`)
console.log(`                ${COLORS.bright}${formatBytes(webCompressedSize)}${COLORS.reset} ${COLORS.green}(${webCompressionRatio}% smaller)${COLORS.reset} ${COLORS.dim}HTTP only${COLORS.reset}`)

// Fun ASCII art footer
console.log(`
${COLORS.dim}  ┌────────────────────────────────────────┐
  │  ${COLORS.cyan}K8s Compass${COLORS.dim} - Your Kubernetes Guide  │
  │  ${COLORS.reset}${COLORS.dim}Single-file, offline-capable, fast   │
  └────────────────────────────────────────┘${COLORS.reset}
`)
