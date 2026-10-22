import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetFile = path.resolve(__dirname, '../public/version.json');

let commitHash = 'v1.1.0';
let commitDate = new Date().toISOString();
let commitMsg = 'Cập nhật tính tiền phòng theo ngày ở & dropdown tìm kiếm';

try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
  commitMsg = execSync('git log -1 --pretty=%B').toString().trim().split('\n')[0];
} catch {
  // Git command fallback
}

const versionData = {
  version: '1.1.0',
  buildTime: commitDate,
  hash: `${commitHash}-${Date.now().toString(36)}`,
  notes: commitMsg || 'Cập nhật hệ thống mới'
};

fs.mkdirSync(path.dirname(targetFile), { recursive: true });
fs.writeFileSync(targetFile, JSON.stringify(versionData, null, 2) + '\n', 'utf8');
console.log('✓ Generated public/version.json with hash:', versionData.hash);
