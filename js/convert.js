#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, '..', 'install', 'create_database.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const CHART_MAP = {
  S_1HCONCUSSION: '1HC', S_1HSLASH: '1HS', S_2H: '2HW',
  S_BALL: 'BAL', S_BOLT: 'BOL', S_GRAPPLE: 'GRA',
  S_MISSLE: 'MIS', S_TOOTHCLAW: 'TAC'
};
const ARMOR_MAP = { 1: 'NONE', 2: 'SOFT', 3: 'RIGID', 4: 'CHAIN', 5: 'PLATE' };
const CRIT_LETTERS = new Set(['T', 'A', 'B', 'C', 'D', 'E']);
const CRIT_COLS = [
  'HEAT', 'COLD', 'ELECTRICITY', 'IMPACT', 'CRUSH', 'SLASH',
  'PUNCTURE', 'UNBALANCING', 'GRAPPLING', 'PHYSICAL_LARGE', 'SPELL_LARGE'
];

function getCritical(desc) {
  if (!desc || desc.length === 0) return '';
  const last = desc[desc.length - 1];
  return CRIT_LETTERS.has(last) ? last : '';
}

// Build attack charts
const attackCharts = {};
for (const code of Object.values(CHART_MAP)) {
  attackCharts[code] = { NONE: [], SOFT: [], RIGID: [], CHAIN: [], PLATE: [] };
}

// RID, ARMORTYPEID, DAMAGE, FUMBLE, DESCRIPTION
const attackRe = /INSERT INTO (S_\w+) \(RID, ARMORTYPEID, DAMAGE, FUMBLE, DESCRIPTION\) VALUES \((\d+),(\d+),(\d+),(\d+),'([^']*)'\)/g;
let m;
while ((m = attackRe.exec(sql)) !== null) {
  const chart = CHART_MAP[m[1]];
  if (!chart) continue;
  const armor = ARMOR_MAP[+m[3]];
  if (!armor) continue;
  attackCharts[chart][armor].push({
    rid: +m[2],
    damage: +m[4],
    fumble: m[5] === '1',
    description: m[6],
    critical: getCritical(m[6])
  });
}

for (const chart of Object.values(attackCharts))
  for (const entries of Object.values(chart))
    entries.sort((a, b) => a.rid - b.rid);

// Parse secondary criticals — quoted CSV where values contain commas
function parseSqlRow(str) {
  const values = [];
  let i = 0;
  while (i < str.length) {
    while (i < str.length && (str[i] === ' ' || str[i] === ',')) i++;
    if (i >= str.length) break;
    if (str[i] === "'") {
      let val = '';
      i++;
      while (i < str.length) {
        if (str[i] === "'" && str[i + 1] === "'") { val += "'"; i += 2; }
        else if (str[i] === "'") { i++; break; }
        else val += str[i++];
      }
      values.push(val);
    } else {
      let num = '';
      while (i < str.length && str[i] !== ',' && str[i] !== ')') num += str[i++];
      if (num.trim()) values.push(+num.trim());
    }
  }
  return values;
}

const criticals = {};
CRIT_COLS.forEach(c => (criticals[c] = []));

const critRe = /INSERT INTO S_SECONDARYCRITICAL\([^)]+\) VALUES \((.+)\);$/gm;
while ((m = critRe.exec(sql)) !== null) {
  const vals = parseSqlRow(m[1]);
  if (vals.length !== 12) {
    console.error('Unexpected value count:', vals.length, '— skipping row');
    continue;
  }
  const rid = vals[0];
  CRIT_COLS.forEach((col, i) => criticals[col].push({ rid, description: vals[i + 1] }));
}

for (const entries of Object.values(criticals))
  entries.sort((a, b) => a.rid - b.rid);

// Write output
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

fs.writeFileSync(path.join(dataDir, 'attack-charts.json'), JSON.stringify(attackCharts));
fs.writeFileSync(path.join(dataDir, 'criticals.json'), JSON.stringify(criticals));

console.log('Data files written to data/');
for (const [code, chart] of Object.entries(attackCharts))
  console.log(`  ${code}: ${chart.NONE.length} entries per armor type`);
for (const [col, entries] of Object.entries(criticals))
  console.log(`  ${col}: ${entries.length} critical entries`);
