#!/usr/bin/env node
// بيمسح بيانات Bedrock من minecraft-data. البوت ده Java Edition، فمش بيلمسها خالص.
// بتوفّر ~330 ميجا من التخزين (446MB ← 117MB).
//
// مهم: مجلد common لازم يفضل — minecraft-data بتعمله require وقت التشغيل،
// ولو اتمسح البوت بيقع بـ Cannot find module '.../bedrock/common/features.json'.
//
// شغّله بـ: npm run slim   (بعد npm install)

const fs = require('fs');
const path = require('path');

const KEEP = 'common';
const dir = path.join(
  __dirname, 'node_modules', 'minecraft-data', 'minecraft-data', 'data', 'bedrock'
);

if (!fs.existsSync(dir)) {
  console.log('ℹ️  مفيش مجلد bedrock — يا إما اتمسح قبل كده يا إما المكتبات لسه ما اتثبتتش.');
  process.exit(0);
}

let freed = 0;
const sizeOf = (p) => {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    total += e.isDirectory() ? sizeOf(full) : fs.statSync(full).size;
  }
  return total;
};

let removed = 0;
for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === KEEP) continue;
  const full = path.join(dir, entry.name);
  freed += sizeOf(full);
  fs.rmSync(full, { recursive: true, force: true });
  removed++;
}

if (removed === 0) {
  console.log('✅ متقلّم خلاص — مفيش حاجة تتمسح.');
} else {
  console.log(`✅ اتمسح ${removed} مجلد نسخة من bedrock — اتوفّر ${(freed / 1048576).toFixed(0)} ميجا.`);
  console.log(`   (مجلد ${KEEP} اتساب زي ما هو لأن المكتبة محتاجاه)`);
}