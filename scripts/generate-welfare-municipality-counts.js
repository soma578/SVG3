#!/usr/bin/env node
/**
 * 市町村ごとの福祉施設数を事前計算
 */

const fs = require('fs')
const path = require('path')

console.log('📊 Generating municipality welfare counts...')

// 福祉施設データを読み込み
const welfarePath = path.join(__dirname, '..', 'data', 'source', 'welfare_facilities_roujin.geojson')
if (!fs.existsSync(welfarePath)) {
  console.error('❌ Welfare data not found:', welfarePath)
  process.exit(1)
}

const welfareData = JSON.parse(fs.readFileSync(welfarePath, 'utf-8'))
const facilities = welfareData.features || []

console.log(`✓ Loaded ${facilities.length} facilities`)

// 市町村コードごとにカウント
const counts = {}
const prefectureCounts = {}

for (const f of facilities) {
  const code = (f.properties?.P14_003 || '').trim()
  if (!code || code.length < 5) continue

  // 5桁の市町村コード
  const municipalityCode = code.substring(0, 5)
  counts[municipalityCode] = (counts[municipalityCode] || 0) + 1

  // 2桁の都道府県コード
  const prefCode = code.substring(0, 2)
  prefectureCounts[prefCode] = (prefectureCounts[prefCode] || 0) + 1
}

console.log(`✓ Counted ${Object.keys(counts).length} municipalities`)
console.log(`✓ Counted ${Object.keys(prefectureCounts).length} prefectures`)

// トップ10を表示
const topMunicipalities = Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)

console.log('\n📊 Top 10 municipalities by facility count:')
for (const [code, count] of topMunicipalities) {
  console.log(`   ${code}: ${count} facilities`)
}

// 結果を保存
const outputFile = path.join(__dirname, '..', 'frontend', 'public', 'welfare_municipality_counts.json')
fs.writeFileSync(outputFile, JSON.stringify({
  municipalityCounts: counts,
  prefectureCounts: prefectureCounts,
  meta: {
    totalMunicipalities: Object.keys(counts).length,
    totalPrefectures: Object.keys(prefectureCounts).length,
    totalFacilities: Object.values(counts).reduce((a, b) => a + b, 0),
    generatedAt: new Date().toISOString()
  }
}, null, 2))

console.log(`\n💾 Saved to: ${outputFile}`)
console.log('✅ Done!')
