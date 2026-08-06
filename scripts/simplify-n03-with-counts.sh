#!/bin/bash
# N03を簡略化して施設数を付与
set -e

echo "Creating simplified N03 with facility counts..."

INPUT_GEOJSON="/home/ubuntu/SVG2/trash/cleanup-20260308/heavy-data/N03-180101_GML/N03-18_180101.geojson"
SIMPLIFIED_GEOJSON="/home/ubuntu/SVG2/data/source/n03_simplified.geojson"
OUTPUT_WITH_COUNTS="/home/ubuntu/SVG2/frontend/public/n03_with_counts.geojson"

# Step 1: Simplify N03 using mapshaper (if installed) or tippecanoe
if command -v mapshaper &> /dev/null; then
    echo "Using mapshaper to simplify..."
    mapshaper "$INPUT_GEOJSON" \
        -simplify 5% \
        -o "$SIMPLIFIED_GEOJSON"
else
    echo "mapshaper not found, using tippecanoe for simplification..."
    # Use tippecanoe to simplify (create zoom 0-8, then extract back)
    tippecanoe \
        -o /tmp/n03_temp.pmtiles \
        --force \
        --minimum-zoom=0 \
        --maximum-zoom=8 \
        --simplification=20 \
        --drop-densest-as-needed \
        --layer=municipalities \
        "$INPUT_GEOJSON"

    # Extract back to GeoJSON (note: this requires tile-join or similar tool)
    echo "Warning: Simplified PMTiles created, but extraction to GeoJSON requires additional tools"
    echo "Using original GeoJSON with limited properties instead..."

    # Just copy and limit properties
    jq '{
        type: .type,
        features: .features | map({
            type: .type,
            geometry: .geometry,
            properties: {
                N03_001: .properties.N03_001,
                N03_004: .properties.N03_004,
                N03_007: .properties.N03_007
            }
        })
    }' "$INPUT_GEOJSON" > "$SIMPLIFIED_GEOJSON"
fi

echo "Simplified GeoJSON created (this may still be large...)"

# Step 2: Add facility counts using Node.js
echo "Adding facility counts..."
node << 'EOF'
const fs = require('fs');
const path = require('path');

// Load simplified N03
const n03Path = '/home/ubuntu/SVG2/data/source/n03_simplified.geojson';
const n03Data = JSON.parse(fs.readFileSync(n03Path, 'utf-8'));

// Load welfare facilities
const welfarePath = '/home/ubuntu/SVG2/data/source/welfare_facilities_roujin.geojson';
const welfareData = JSON.parse(fs.readFileSync(welfarePath, 'utf-8'));

// Count facilities by municipality
const counts = {};
for (const f of welfareData.features) {
    const pref = (f.properties.P14_001 || '').trim();
    const city = (f.properties.P14_002 || '').trim();
    if (!pref || !city) continue;

    const normalizedCity = city.replace(/^.*郡/, '').replace(/^.*支庁/, '');
    const key = `${pref}_${normalizedCity}`;
    counts[key] = (counts[key] || 0) + 1;
}

console.log(`Counted ${Object.keys(counts).length} municipalities`);

// Add counts to N03 features
for (const f of n03Data.features) {
    const pref = (f.properties.N03_001 || '').trim();
    const city = (f.properties.N03_004 || '').trim();

    if (!pref || !city) {
        f.properties.count = 0;
        f.properties.height = 0;
        continue;
    }

    const normalizedCity = city.replace(/^.*郡/, '').replace(/^.*支庁/, '');
    const key = `${pref}_${normalizedCity}`;
    const count = counts[key] || 0;

    f.properties.count = count;
    f.properties.height = count * 50;  // For 3D
}

// Write output
const outputPath = '/home/ubuntu/SVG2/frontend/public/n03_with_counts.geojson';
fs.writeFileSync(outputPath, JSON.stringify(n03Data));

console.log(`Output written to ${outputPath}`);
console.log(`Size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
EOF

if [ -f "$OUTPUT_WITH_COUNTS" ]; then
    echo "Success! N03 with counts created: $(du -h $OUTPUT_WITH_COUNTS | cut -f1)"
else
    echo "Error: Output file not created"
    exit 1
fi
