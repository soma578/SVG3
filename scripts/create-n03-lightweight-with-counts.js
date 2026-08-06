#!/usr/bin/env node
/**
 * N03から必要なプロパティだけを抽出して軽量版を作成し、施設数を付与
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const N03_PATH = '/home/ubuntu/SVG2/trash/cleanup-20260308/heavy-data/N03-180101_GML/N03-18_180101.geojson';
const WELFARE_PATH = '/home/ubuntu/SVG2/data/source/welfare_facilities_roujin.geojson';
const OUTPUT_PATH = '/home/ubuntu/SVG2/frontend/public/n03_with_counts.geojson';

async function main() {
  console.log('[Step 1] Counting facilities by municipality...');

  // Load welfare facilities
  const welfareData = JSON.parse(fs.readFileSync(WELFARE_PATH, 'utf-8'));

  // Count facilities by municipality (using normalized city name)
  const counts = {};
  for (const f of welfareData.features) {
    const pref = (f.properties.P14_001 || '').trim();
    const city = (f.properties.P14_002 || '').trim();
    if (!pref || !city) continue;

    const normalizedCity = city.replace(/^.*郡/, '').replace(/^.*支庁/, '');
    const key = `${pref}_${normalizedCity}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  console.log(`  Found ${Object.keys(counts).length} municipalities with facilities`);

  console.log('[Step 2] Processing N03 GeoJSON (streaming)...');
  console.log('  This may take a while for large files...');

  const features = [];
  let featureCount = 0;

  // Read N03 line by line to avoid memory issues
  const fileStream = fs.createReadStream(N03_PATH);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let buffer = '';
  let inFeatures = false;

  for await (const line of rl) {
    buffer += line;

    // Detect when we're in the features array
    if (line.includes('"features"')) {
      inFeatures = true;
      continue;
    }

    // Try to parse complete feature objects
    if (inFeatures && buffer.includes('}, {')) {
      const parts = buffer.split('}, {');
      for (let i = 0; i < parts.length - 1; i++) {
        try {
          const featureStr = (i === 0 ? '' : '{') + parts[i] + '}';
          const feature = JSON.parse(featureStr);

          // Extract only needed properties
          const pref = (feature.properties.N03_001 || '').trim();
          const city = (feature.properties.N03_004 || '').trim();

          const normalizedCity = city.replace(/^.*郡/, '').replace(/^.*支庁/, '');
          const key = `${pref}_${normalizedCity}`;
          const count = counts[key] || 0;

          features.push({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
              N03_001: feature.properties.N03_001,  // 都道府県
              N03_004: feature.properties.N03_004,  // 市区町村
              N03_007: feature.properties.N03_007,  // 行政区域コード
              count: count,
              height: count * 50  // For 3D
            }
          });

          featureCount++;
          if (featureCount % 10000 === 0) {
            process.stdout.write(`\r  Processed ${featureCount} features...`);
          }
        } catch (e) {
          // Skip malformed features
        }
      }
      buffer = parts[parts.length - 1];
    }
  }

  console.log(`\n  Total features processed: ${features.length}`);

  console.log('[Step 3] Writing output...');

  const output = {
    type: 'FeatureCollection',
    features: features
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));

  const sizeMB = (fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`\n✓ Success!`);
  console.log(`  Output: ${OUTPUT_PATH}`);
  console.log(`  Size: ${sizeMB} MB`);
  console.log(`  Features: ${features.length}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
