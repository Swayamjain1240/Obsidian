import { execFileSync } from 'node:child_process';

const docker = (args, options = {}) => {
  const result = execFileSync('docker', args, { encoding: 'utf8', stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'], ...options });
  return typeof result === 'string' ? result.trim() : '';
};

const suffix = `${process.pid}-${Date.now()}`;
const network = `obsidian-phase3-${suffix}`;
const containers = ['1', '2', '3'].map((id) => `obsidian-mongo-${suffix}-${id}`);
const volume = `obsidian-phase3-node-modules-${suffix}`;
const uri = `mongodb://mongo-1:27017,mongo-2:27017,mongo-3:27017/obsidian_phase3?replicaSet=rs0&serverSelectionTimeoutMS=5000`;
const workspace = process.cwd();

function cleanup() {
  for (const container of containers) {
    try { docker(['rm', '-f', container], { stdio: 'ignore' }); } catch { /* best effort cleanup */ }
  }
  try { docker(['network', 'rm', network], { stdio: 'ignore' }); } catch { /* best effort cleanup */ }
  try { docker(['volume', 'rm', volume], { stdio: 'ignore' }); } catch { /* best effort cleanup */ }
}

function runBackendTests(files, extraEnv = {}) {
  docker([
    'run', '--rm', '--network', network,
    '-v', `${workspace}:/workspace`, '-v', `${volume}:/workspace/node_modules`,
    '-w', '/workspace', '-e', 'OBSIDIAN_ALLOW_DISPOSABLE_MONGO_TESTS=1', '-e', `OBSIDIAN_MONGODB_TEST_URI=${uri}`,
    ...Object.entries(extraEnv).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    'node:22-bookworm', 'bash', '-lc',
    `npm ci --ignore-scripts --no-audit --no-fund && npm run test --workspace backend -- --maxWorkers=1 ${files.join(' ')}`,
  ], { stdio: 'inherit' });
}

try {
  docker(['info'], { stdio: 'ignore' });
} catch {
  console.error('MongoDB replica-set tests unavailable: Docker daemon is not running.');
  process.exitCode = 2;
  process.exit();
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

docker(['network', 'create', network]);
docker(['volume', 'create', volume]);
for (let index = 0; index < containers.length; index += 1) {
  docker([
    'run', '-d', '--rm', '--name', containers[index], '--hostname', `mongo-${index + 1}`, '--network', network,
    'mongo:7.0', 'mongod', '--replSet', 'rs0', '--bind_ip_all', '--port', '27017', '--quiet',
  ]);
}

const members = containers.map((_container, index) => `{ _id: ${index}, host: 'mongo-${index + 1}:27017' }`).join(',');
const initiate = `rs.initiate({_id:'rs0',members:[${members}]})`;
docker(['exec', containers[0], 'mongosh', '--quiet', '--eval', initiate]);

let ready = false;
for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
  try {
    const status = docker(['exec', containers[0], 'mongosh', '--quiet', '--eval', "JSON.stringify(rs.status().members.map(m=>m.stateStr))"]);
    ready = status.includes('PRIMARY') && status.includes('SECONDARY');
  } catch { /* election still in progress */ }
  if (!ready) await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (!ready) throw new Error('MongoDB replica set did not elect a primary and secondary members.');

docker(['exec', containers[1], 'mongosh', '--quiet', `mongodb://mongo-1:27017,mongo-2:27017,mongo-3:27017/obsidian_phase3?replicaSet=rs0&readPreference=primary`, '--eval', "db.getSiblingDB('obsidian_phase3').dropDatabase()"]);
console.log(`MongoDB replica set ready on ${containers.join(', ')}.`);

runBackendTests([
  'src/db/mongodb-integration.test.ts',
  'src/db/mongodb-transaction.integration.test.ts',
  'src/db/mongodb-backup-restore.integration.test.ts',
  'src/workers/lease-failover.integration.test.ts',
]);

const backupArchive = '/tmp/obsidian-phase3.archive';
docker(['exec', containers[1], 'mongodump', '--uri', 'mongodb://mongo-1:27017/obsidian_phase3?replicaSet=rs0', `--archive=${backupArchive}`]);
const sourceNames = JSON.parse(docker(['exec', containers[1], 'mongosh', '--quiet', '--eval', "JSON.stringify(db.getSiblingDB('obsidian_phase3').getCollectionNames().filter(n=>!n.startsWith('system.')))"]).split(/\r?\n/).filter(Boolean).at(-1) ?? '[]');
for (const name of sourceNames) {
  docker(['exec', containers[1], 'mongorestore', '--uri', 'mongodb://mongo-1:27017/obsidian_phase3_restore?replicaSet=rs0', '--drop', `--archive=${backupArchive}`, `--nsInclude=obsidian_phase3.${name}`, `--nsFrom=obsidian_phase3.${name}`, `--nsTo=obsidian_phase3_restore.${name}`], { stdio: 'inherit' });
}
const integrity = docker(['exec', containers[1], 'mongosh', '--quiet', '--eval', `
  const source=db.getSiblingDB('obsidian_phase3');
  const restored=db.getSiblingDB('obsidian_phase3_restore');
  const restoredNames=new Set(restored.getCollectionNames().filter(n=>!n.startsWith('system.')));
  const names=source.getCollectionNames().filter(n=>!n.startsWith('system.') && source[n].countDocuments()>0).sort();
  const result=names.map(n=>({name:n,sourceCount:source[n].countDocuments(),restoredCount:restoredNames.has(n)?restored[n].countDocuments():0,sourceIndexes:source[n].getIndexes().map(i=>i.name).sort(),restoredIndexes:restoredNames.has(n)?restored[n].getIndexes().map(i=>i.name).sort():[]}));
  print(JSON.stringify(result));
`]);
const parsedIntegrity = JSON.parse(integrity.split(/\r?\n/).filter(Boolean).at(-1) ?? '[]');
if (!parsedIntegrity.length || parsedIntegrity.some((entry) => entry.sourceCount !== entry.restoredCount || JSON.stringify(entry.sourceIndexes) !== JSON.stringify(entry.restoredIndexes))) {
  throw new Error(`MongoDB backup restore integrity mismatch: ${integrity}`);
}
console.log(`MongoDB backup/restore integrity verified for ${parsedIntegrity.length} collections.`);

docker(['stop', containers[0]]);
let failoverReady = false;
for (let attempt = 0; attempt < 60 && !failoverReady; attempt += 1) {
  try {
    const status = docker(['exec', containers[1], 'mongosh', '--quiet', '--eval', "JSON.stringify(rs.status().members.map(m=>({name:m.name,state:m.stateStr})))"]);
    failoverReady = status.includes('PRIMARY') && !status.includes('mongo-1:27017\"}]');
  } catch { /* election still in progress */ }
  if (!failoverReady) await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (!failoverReady) throw new Error('MongoDB replica set did not elect a replacement primary after stopping mongo-1.');

runBackendTests(['src/db/mongodb-outage.integration.test.ts'], { OBSIDIAN_MONGODB_FAILOVER: '1' });
console.log('MongoDB primary-stop failover and post-failover reconnect verification completed.');
