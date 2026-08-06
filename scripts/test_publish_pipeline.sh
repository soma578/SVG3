#!/usr/bin/env bash
# publish pipeline の動作確認スクリプト
# dev server が起動済みの状態で実行する
# 使い方: bash scripts/test_publish_pipeline.sh [http://localhost:3000]

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
REGION="okayama"
COOKIE_JAR=$(mktemp)
RESP_FILE=$(mktemp)
trap 'rm -f "$COOKIE_JAR" "$RESP_FILE"' EXIT

echo "=== publish pipeline test ==="
echo "target: $BASE_URL"
echo ""

# 1. login
echo "--- 1. admin login ---"
curl -s -c "$COOKIE_JAR" -X POST "$BASE_URL/api/admin/login" \
  -H "Content-Type: application/json" \
  -H "Origin: $BASE_URL" \
  -d '{"username":"admin","password":"admin"}' | python3 -m json.tool
echo ""

# 2. baseline: manifest の assetsVersion を記録
echo "--- 2. manifest assetsVersion before ---"
MANIFEST_PATH="frontend/public/regions/$REGION/manifest.json"
BEFORE_VERSION=$(python3 -c "import json; d=json.load(open('$MANIFEST_PATH')); print(d.get('assetsVersion','(none)'), end='')")
echo "before: $BEFORE_VERSION"
echo ""

# 3. 小さな test payload (5件) で publish
echo "--- 3. publish shelters (5 records) ---"
python3 -c "
import json
records = [
  {'id':'test-1','title':'テスト避難所A','kind':'shelter','lat':34.678,'lon':133.979,'status':'open','address':'岡山県岡山市中区テスト1','capacity':100,'facilityType':'指定避難所','barrierFree':True,'pets':False,'updatedAt':None,'note':None},
  {'id':'test-2','title':'テスト避難所B','kind':'shelter','lat':34.682,'lon':133.985,'status':'unknown','address':'岡山県岡山市中区テスト2','capacity':50,'facilityType':'指定緊急避難場所','barrierFree':None,'pets':None,'updatedAt':None,'note':None},
  {'id':'test-3','title':'テスト避難所C','kind':'shelter','lat':34.665,'lon':133.990,'status':'closed','address':'岡山県岡山市中区テスト3','capacity':200,'facilityType':'指定避難所','barrierFree':False,'pets':True,'updatedAt':None,'note':None},
  {'id':'test-4','title':'テスト避難所D','kind':'shelter','lat':34.670,'lon':134.000,'status':'open','address':'岡山県倉敷市テスト4','capacity':150,'facilityType':'指定避難所','barrierFree':True,'pets':False,'updatedAt':None,'note':None},
  {'id':'test-5','title':'テスト避難所E','kind':'shelter','lat':34.590,'lon':133.770,'status':'unknown','address':'岡山県津山市テスト5','capacity':80,'facilityType':'指定緊急避難場所 / 指定避難所','barrierFree':None,'pets':None,'updatedAt':None,'note':None}
]
print(json.dumps({'datasetType':'shelters','regionId':'okayama','records':records,'updatedBy':'test-script','updateNote':'pipeline test'}))
" | curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/admin/datasets/publish" \
  -H "Content-Type: application/json" \
  -H "Origin: $BASE_URL" \
  -d @- | tee "$RESP_FILE" | python3 -m json.tool
echo ""

# 4. derivedAssets の確認
echo "--- 4. derivedAssets summary ---"
python3 - "$RESP_FILE" <<'PYEOF'
import json, sys
try:
    d = json.loads(open(sys.argv[1]).read())
    da = d.get("derivedAssets", {})
    checks = [
        ("ok",                             d.get("ok")),
        ("assetsVersion",                  da.get("assetsVersion")),
        ("shelterMunicipalityFilesUpdated",da.get("shelterMunicipalityFilesUpdated")),
        ("shelterRecordsRanked",           da.get("shelterRecordsRanked")),
        ("shelterSvgFilesUpdated",         da.get("shelterSvgFilesUpdated")),
        ("teamActivitySvgFilesUpdated",    da.get("teamActivitySvgFilesUpdated")),
        ("summariesUpdated",               da.get("summariesUpdated")),
        ("manifestUpdated",                da.get("manifestUpdated")),
    ]
    for k, v in checks:
        mark = "✓" if v else "✗"
        print(f"  {mark} {k}: {v}")
except Exception as e:
    print(f"parse error: {e}")
    print(open(sys.argv[1]).read()[:300])
PYEOF

# 5. ファイルベースの確認
echo ""
echo "--- 5. file check ---"
AFTER_VERSION=$(python3 -c "import json; d=json.load(open('$MANIFEST_PATH')); print(d.get('assetsVersion','(none)'), end='')")
if [ "$BEFORE_VERSION" != "$AFTER_VERSION" ]; then
  echo "  ✓ manifest.assetsVersion: $BEFORE_VERSION → $AFTER_VERSION"
else
  echo "  ✗ manifest.assetsVersion unchanged: $AFTER_VERSION"
fi

for F in \
  "frontend/public/data/$REGION/shelters/summary.json" \
  "frontend/public/data/$REGION/shelters/summary-low.json" \
  "frontend/public/data/$REGION/shelters/summary-mid.json" \
  "frontend/public/data/$REGION/shelters/33101.json" \
  "frontend/public/map/layers/districts/$REGION/evacuation/33101.svg" \
  "frontend/public/map/layers/districts/$REGION/team_activity/33101.svg"
do
  if [ -f "$F" ]; then
    SIZE=$(wc -c < "$F")
    echo "  ✓ $F ($SIZE bytes)"
  else
    echo "  ✗ $F (missing)"
  fi
done

echo ""
echo "=== done ==="
