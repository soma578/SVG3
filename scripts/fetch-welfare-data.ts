/**
 * 厚生労働省オープンデータから福祉施設データを取得
 * https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000124501.html
 */

import fs from 'fs';
import path from 'path';

interface WelfareFacility {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    id: string;
    name: string;
    type: string; // 特別養護老人ホーム、デイサービスセンター等
    prefCode: string;
    prefName: string;
    cityName: string;
    address: string;
    capacity?: number;
    tel?: string;
    url?: string;
  };
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: WelfareFacility[];
  metadata: {
    source_name: string;
    source_url: string;
    updated_at: string;
    license: string;
    layer_type: string;
    total_count: number;
  };
}

/**
 * 都道府県別の福祉施設データを取得（デモ版）
 */
async function fetchWelfareDataByPrefecture(prefCode: string): Promise<WelfareFacility[]> {
  // 実際のデータソース例:
  // - 厚生労働省介護サービス情報公表システム
  // - 各都道府県オープンデータポータル
  // - WAM NET（福祉医療機構）

  // TODO: 実際のAPI/CSVから取得する実装
  console.log(`Fetching welfare data for prefecture ${prefCode}...`);

  // デモデータ（実装時は削除）
  return [];
}

/**
 * 全国の福祉施設データを統合
 */
async function generateNationalWelfareData(): Promise<GeoJSONCollection> {
  const allFacilities: WelfareFacility[] = [];

  // 全47都道府県のデータを取得
  const prefCodes = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0'));

  for (const prefCode of prefCodes) {
    const facilities = await fetchWelfareDataByPrefecture(prefCode);
    allFacilities.push(...facilities);
    console.log(`✓ ${prefCode}: ${facilities.length} facilities`);
  }

  const geojson: GeoJSONCollection = {
    type: 'FeatureCollection',
    features: allFacilities,
    metadata: {
      source_name: '厚生労働省',
      source_url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000124501.html',
      updated_at: new Date().toISOString().split('T')[0],
      license: 'CC BY 4.0',
      layer_type: 'welfare_facilities',
      total_count: allFacilities.length,
    },
  };

  return geojson;
}

/**
 * データ取得・保存のメイン処理
 */
async function main() {
  console.log('🏥 全国福祉施設データの取得を開始...');

  const outputDir = path.join(process.cwd(), 'data', 'source');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const geojson = await generateNationalWelfareData();
  const outputPath = path.join(outputDir, 'welfare_facilities.geojson');

  fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

  console.log(`✅ 完了: ${geojson.features.length} 施設を保存`);
  console.log(`📁 出力先: ${outputPath}`);
  console.log(`📊 ファイルサイズ: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
}

// スクリプト実行時のエラーハンドリング
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ エラー:', error);
    process.exit(1);
  });
}

export { generateNationalWelfareData, WelfareFacility, GeoJSONCollection };
