import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TEAM_ACTIVITY_CSV_TEMPLATE,
  buildTeamActivityCsvDocuments,
  parseTeamActivityCsv,
} from '../../map/layers/portable/team-activity/teamActivityCsv.js';

test('チーム活動CSVをQTCTのsummary/detailへ変換する', () => {
  const { records, errors } = parseTeamActivityCsv(TEAM_ACTIVITY_CSV_TEMPLATE);
  assert.deepEqual(errors, []);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'csv:sample-001');
  const { summary, detail } = buildTeamActivityCsvDocuments(records);
  assert.equal(summary.total, 1);
  assert.deepEqual(summary.tree.densityPoints, [133.928, 34.668]);
  assert.equal(detail.tree.records[0].title, '給水支援チーム');
});

test('必須列欠落と重複IDを拒否する', () => {
  const missing = parseTeamActivityCsv('id,title\na,活動A\n');
  assert.ok(missing.errors.some((error) => error.includes('regionId')));
  const duplicate = parseTeamActivityCsv(
    'id,title,regionId,municipalityCode,lat,lon,status,summary,description,area,operator\n'
    + 'a,活動A,okayama,33101,34.6,133.9,active,,,,\n'
    + 'a,活動B,okayama,33101,34.7,133.8,active,,,,\n',
  );
  assert.ok(duplicate.errors.some((error) => error.includes('重複')));
});
