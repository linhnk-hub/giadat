import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = path.resolve(process.cwd());

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, fn: () => string | void) {
  try {
    const detail = fn() || 'OK';
    results.push({ name, passed: true, detail });
  } catch (err) {
    results.push({
      name,
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'firebase-applet-config.json'), 'utf-8')
) as Record<string, string>;

const blueprint = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'firebase-blueprint.json'), 'utf-8')
) as {
  entities: Record<
    string,
    {
      title: string;
      description: string;
      type: string;
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
    }
  >;
  firestore: Record<string, { schema: { $ref: string } | string; description: string }>;
};

const indexes = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'firestore.indexes.json'), 'utf-8')
) as {
  indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order: string }> }>;
};

const rulesText = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf-8');
const firebaseTsText = fs.readFileSync(path.join(rootDir, 'src/firebase.ts'), 'utf-8');

// 1. Firebase Config & Database ID verification
check('1. Firebase config projectId & databaseId == "giadat"', () => {
  assert.equal(firebaseConfig.projectId, 'giadat');
  assert.equal(firebaseConfig.firestoreDatabaseId, 'giadat');
  assert.equal(firebaseConfig.authDomain, 'giadat.firebaseapp.com');
  assert.ok(firebaseConfig.apiKey && firebaseConfig.appId, 'Missing Firebase web appId/apiKey');
  return `projectId=${firebaseConfig.projectId}, db=${firebaseConfig.firestoreDatabaseId}, authDomain=${firebaseConfig.authDomain}`;
});

// 2. src/firebase.ts uses databaseId 'giadat', persistentLocalCache, FIXED_ADMIN_EMAIL, handleFirestoreError
check('2. src/firebase.ts SDK wiring & A1 fixed admin constant', () => {
  assert.match(firebaseTsText, /FIXED_ADMIN_EMAIL\s*=\s*'linhnk2013@gmail\.com'/);
  assert.match(firebaseTsText, /DEFAULT_FIRESTORE_DATABASE_ID\s*=\s*'giadat'/);
  assert.match(firebaseTsText, /persistentLocalCache/);
  assert.match(firebaseTsText, /export function handleFirestoreError/);
  assert.match(firebaseTsText, /verifyFirestoreConnection/);
  return 'Single fixed admin email, persistentLocalCache, and structured error handler verified';
});

// 3. firebase-blueprint.json strict schema & 6 collections
check('3. firebase-blueprint.json strict schema & all 6 collections present', () => {
  const expectedCollections = [
    '/dataset_categories/{datasetKind}',
    '/active_versions/{datasetKind}',
    '/dataset_versions/{versionId}',
    '/dataset_records/{recordId}',
    '/activation_history/{eventId}',
    '/pdf_documents/{docId}',
  ];
  assert.deepEqual(Object.keys(blueprint.firestore).sort(), expectedCollections.sort());

  const allowedPropKeys = new Set([
    'type',
    'format',
    'description',
    'enum',
    '$ref',
    'maxLength',
    'minLength',
    'pattern',
  ]);
  for (const [entityName, entity] of Object.entries(blueprint.entities)) {
    assert.equal(entity.type, 'object', `${entityName} must be object`);
    for (const [propName, propDef] of Object.entries(entity.properties)) {
      for (const k of Object.keys(propDef)) {
        assert.ok(allowedPropKeys.has(k), `Disallowed key "${k}" on ${entityName}.${propName}`);
      }
    }
  }
  return `${Object.keys(blueprint.entities).length} entities, ${expectedCollections.length} collections validated`;
});

// 4. PII isolation in blueprint (zero email/UID fields on public collections)
check('4. PII Isolation on public collections', () => {
  const publicEntities = ['DatasetCategory', 'ActiveVersionPointer', 'DatasetRecord', 'PdfReferenceDocument'];
  for (const name of publicEntities) {
    const props = Object.keys(blueprint.entities[name].properties);
    for (const p of props) {
      assert.ok(!/email|phone|uid/i.test(p), `Potential PII field "${p}" found on public entity ${name}`);
    }
  }
  return 'Zero email/phone/UID properties in public entities';
});

// 5. firestore.indexes.json covers Geohash + administrative + audit + PDF queries
check('5. firestore.indexes.json composite indexes coverage', () => {
  const signatures = indexes.indexes.map(
    (idx) => `${idx.collectionGroup}:${idx.fields.map((f) => f.fieldPath).join(',')}`
  );
  const required = [
    'dataset_records:datasetKind,versionId,visibility,isDemo,geohash5',
    'dataset_records:datasetKind,versionId,visibility,isDemo,districtKey',
    'dataset_records:datasetKind,versionId,visibility,isDemo,wardKey',
    'dataset_records:datasetKind,versionId,visibility,isDemo',
    'dataset_versions:datasetKind,createdAt',
    'activation_history:datasetKind,createdAt',
    'pdf_documents:visibility,createdAt',
  ];
  for (const req of required) {
    assert.ok(signatures.includes(req), `Missing required composite index: ${req}`);
  }
  return `${signatures.length} composite indexes verified`;
});

// 6. Global default deny + rules_version 2 + Single Fixed Admin Email with email_verified
check('6. Rules Pillar 1/3/4: rules_version=2, default-deny, verified A1 admin email', () => {
  assert.match(rulesText, /rules_version\s*=\s*'2';/);
  assert.match(rulesText, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  assert.match(rulesText, /request\.auth\.token\.email_verified\s*==\s*true/);
  assert.match(rulesText, /request\.auth\.token\.email\.lower\(\)\s*==\s*'linhnk2013@gmail\.com'/);
  assert.ok(!rulesText.includes('linhhnk2013@gmail.com'), 'Typo admin email detected');
  return 'Default-deny and verified linhnk2013@gmail.com gate enforced';
});

// 7. Dirty Dozen — Demo data blocking & HTTPS-only market URLs
check('7. Rules Dirty Dozen: isDemo == false & HTTP(S)-only market URL', () => {
  assert.match(rulesText, /data\.isDemo\s*==\s*false/);
  assert.match(rulesText, /existing\(\)\.isDemo\s*==\s*false/);
  assert.match(rulesText, /p\.url\.matches\('\^https\?:\/\/\.\*\$'\)/);
  assert.match(rulesText, /data\.geohash6\[0:5\]\s*==\s*data\.geohash5/);
  return 'DEMO poisoning, XSS URL schemes, and geohash mismatch blocked';
});

// 8. Dirty Dozen — Immutable versions & records (no delete on historical data)
check('8. Rules Dirty Dozen: No delete on versions/records/history/active_versions/categories', () => {
  const noDeleteCollections = [
    'dataset_categories',
    'active_versions',
    'dataset_versions',
    'dataset_records',
    'activation_history',
  ];
  for (const col of noDeleteCollections) {
    const matchStart = rulesText.indexOf(`match /${col}/`);
    assert.ok(matchStart >= 0, `Missing match block for ${col}`);
    const nextMatch = rulesText.indexOf('match /', matchStart + 10);
    const block = nextMatch > 0 ? rulesText.slice(matchStart, nextMatch) : rulesText.slice(matchStart);
    assert.match(block, /allow delete:\s*if false;/, `${col} must forbid delete`);
  }
  return 'All 5 core/audit collections strictly forbid delete';
});

// 9. Dirty Dozen — Terminal State Locking & Master Gate on dataset_records
check('9. Rules Dirty Dozen: Terminal state locking & Master Gate staging check', () => {
  assert.match(rulesText, /existing\(\)\.commitState\s*==\s*'staging'/);
  assert.match(rulesText, /incoming\(\)\.commitState\s*==\s*'staging'/);
  assert.match(
    rulesText,
    /get\(\/databases\/\$\(database\)\/documents\/dataset_versions\/\$\(incoming\(\)\.versionId\)\)\.data\.commitState\s*==\s*'staging'/
  );
  return 'Staging-only record ingestion & terminal committed/aborted locking enforced';
});

// 10. Dirty Dozen — Atomicity Guarantee (existsAfter/getAfter between active_versions & activation_history)
check('10. Rules Dirty Dozen: Mutual atomicity between active_versions, dataset_versions & activation_history', () => {
  assert.match(
    rulesText,
    /getAfter\(\/databases\/\$\(database\)\/documents\/dataset_versions\/\$\(incoming\(\)\.activeVersionId\)\)\.data\.commitState\s*==\s*'committed'/
  );
  assert.match(
    rulesText,
    /getAfter\(\/databases\/\$\(database\)\/documents\/dataset_versions\/\$\(incoming\(\)\.activeVersionId\)\)\.data\.verifiedRowCount\s*==\s*incoming\(\)\.rowCount/
  );
  assert.match(
    rulesText,
    /getAfter\(\/databases\/\$\(database\)\/documents\/activation_history\/\$\(incoming\(\)\.lastEventId\)\)\.data\.toVersionId\s*==\s*incoming\(\)\.activeVersionId/
  );
  assert.match(
    rulesText,
    /getAfter\(\/databases\/\$\(database\)\/documents\/active_versions\/\$\(incoming\(\)\.datasetKind\)\)\.data\.lastEventId\s*==\s*eventId/
  );
  return 'Atomic 3-way synchronization enforced';
});

// 11. Dirty Dozen — Bounded public list queries & zero get()/exists() inside allow list
check('11. Rules Pillar 8: Bounded public list queries (<=500 / <=100) with zero DB lookups', () => {
  const listBlocks = [...rulesText.matchAll(/allow list:\s*if([\s\S]*?);/g)].map((m) => m[1]);
  assert.equal(listBlocks.length, 6, 'Expected 6 allow list blocks (1 per collection)');
  for (const expr of listBlocks) {
    assert.ok(!/\b(get|exists|getAfter|existsAfter)\s*\(/.test(expr), `Forbidden DB lookup inside allow list: ${expr}`);
  }
  assert.match(rulesText, /request\.query\.limit\s*<=\s*500/);
  assert.match(rulesText, /request\.query\.limit\s*<=\s*100/);
  assert.match(rulesText, /request\.query\.limit\s*<=\s*200/);
  return 'All 6 allow list blocks have 0 DB lookups and strict query limits';
});

// 12. Official @firebase/eslint-plugin-security-rules lint check on firestore.rules
check('12. ESLint @firebase/eslint-plugin-security-rules on firestore.rules', () => {
  const output = execSync('npx eslint --format json firestore.rules', {
    cwd: rootDir,
    encoding: 'utf-8',
  });
  const report = JSON.parse(output) as Array<{ errorCount: number; warningCount: number; messages: unknown[] }>;
  assert.equal(report.length, 1);
  assert.equal(report[0].errorCount, 0, `ESLint errors: ${JSON.stringify(report[0].messages)}`);
  assert.equal(report[0].warningCount, 0, `ESLint warnings: ${JSON.stringify(report[0].messages)}`);
  return '0 errors, 0 warnings';
});

let failed = 0;
for (const r of results) {
  const icon = r.passed ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${r.name} — ${r.detail}`);
  if (!r.passed) failed += 1;
}

console.log(`\nGate 2 Summary: ${results.length - failed}/${results.length} PASS`);
if (failed > 0) {
  process.exit(1);
}
