'use strict';

// ── Labels ──────────────────────────────────────────────────────────────────

const CHART_LABELS = {
  '1HS': '1H Slashing',
  '1HC': '1H Concussion',
  '2HW': '2H Weapon',
  'BAL': 'Ball Spell',
  'BOL': 'Bolt Spell',
  'GRA': 'Grappling',
  'MIS': 'Missile',
  'TAC': 'Tooth & Claw'
};

const ARMOR_LABELS = {
  NONE: 'No Armor',
  SOFT: 'Soft Leather',
  RIGID: 'Rigid Leather',
  CHAIN: 'Chain Armor',
  PLATE: 'Plate Armor'
};

const CRIT_TABLE_LABELS = {
  COLD:           'Cold',
  CRUSH:          'Crush',
  ELECTRICITY:    'Electricity',
  GRAPPLING:      'Grappling',
  HEAT:           'Heat',
  IMPACT:         'Impact',
  PHYSICAL_LARGE: 'Physical (Large)',
  PUNCTURE:       'Puncture',
  SLASH:          'Slash',
  SPELL_LARGE:    'Spell (Large)',
  UNBALANCING:    'Unbalancing'
};

// Critical severity: letter → roll modifier
const CRIT_MOD = { T: -50, A: -20, B: -10, C: 0, D: 10, E: 20 };

// Likely critical table for each attack chart (smart default)
const DEFAULT_CRIT_TABLE = {
  '1HS': 'SLASH',
  '1HC': 'CRUSH',
  '2HW': 'CRUSH',
  'BAL': 'HEAT',
  'BOL': 'ELECTRICITY',
  'GRA': 'GRAPPLING',
  'MIS': 'PUNCTURE',
  'TAC': 'UNBALANCING'
};

// ── State ────────────────────────────────────────────────────────────────────

let attackCharts = null;
let criticals    = null;
let lastAttack   = null; // preserved across step 2 → 3

const $main = document.getElementById('main');

// ── Data loading ─────────────────────────────────────────────────────────────

async function init() {
  try {
    const [ac, cr] = await Promise.all([
      fetch('data/attack-charts.json').then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); }),
      fetch('data/criticals.json').then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    ]);
    attackCharts = ac;
    criticals    = cr;
    renderPrimary();
  } catch (err) {
    $main.innerHTML = `
      <div class="card">
        <div class="status-badge badge-fumble">Error</div>
        <p style="font-size:.9rem;color:var(--text-muted);margin-top:.5rem;">
          Could not load data files. Make sure the app is served via HTTP (not opened as a local file)
          and that <code>data/attack-charts.json</code> and <code>data/criticals.json</code> exist.
        </p>
        <p style="font-size:.8rem;color:var(--red);margin-top:.75rem;">${err.message}</p>
      </div>`;
  }
}

// ── Lookup helper ────────────────────────────────────────────────────────────

// Find the entry with the highest RID that is still <= roll (MERP table lookup rule).
function tableLookup(sortedEntries, roll) {
  let best = null;
  for (const e of sortedEntries) {
    if (e.rid <= roll) best = e;
    else break;
  }
  return best;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function chartOptions(selectedValue) {
  return Object.entries(CHART_LABELS)
    .map(([v, l]) => `<option value="${v}"${v === selectedValue ? ' selected' : ''}>${l}</option>`)
    .join('');
}

function armorOptions(selectedValue) {
  return Object.entries(ARMOR_LABELS)
    .map(([v, l]) => `<option value="${v}"${v === selectedValue ? ' selected' : ''}>${l}</option>`)
    .join('');
}

function critTableOptions(selectedValue) {
  return Object.entries(CRIT_TABLE_LABELS)
    .map(([v, l]) => `<option value="${v}"${v === selectedValue ? ' selected' : ''}>${l}</option>`)
    .join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Step 1: Primary attack form ──────────────────────────────────────────────

function renderPrimary(prefill) {
  const roll  = prefill?.roll  ?? '';
  const chart = prefill?.chart ?? '1HS';
  const armor = prefill?.armor ?? 'NONE';

  $main.innerHTML = `
    <div class="card">
      <div class="card-title">Primary Attack</div>
      <form id="attack-form" novalidate>
        <div class="field">
          <label for="roll">Modified Offensive Bonus</label>
          <input type="number" id="roll" name="roll" inputmode="numeric"
                 min="0" max="999" placeholder="e.g. 85"
                 value="${escHtml(roll)}" required autofocus>
        </div>
        <div class="field">
          <label for="attack-chart">Attack Chart</label>
          <select id="attack-chart" name="chart">${chartOptions(chart)}</select>
        </div>
        <div class="field">
          <label for="armor-type">Target Armor</label>
          <select id="armor-type" name="armor">${armorOptions(armor)}</select>
        </div>
        <button type="submit" class="btn btn-primary">Resolve Attack</button>
      </form>
    </div>`;

  document.getElementById('attack-form').addEventListener('submit', onAttackSubmit);
}

function onAttackSubmit(e) {
  e.preventDefault();

  const roll  = parseInt(document.getElementById('roll').value, 10);
  const chart = document.getElementById('attack-chart').value;
  const armor = document.getElementById('armor-type').value;

  if (!Number.isInteger(roll) || roll < 0) {
    showError('Enter a valid non-negative roll value.');
    return;
  }

  const entry = tableLookup(attackCharts[chart][armor], roll);
  if (!entry) {
    showError('No result found for that roll — try a higher value.');
    return;
  }

  lastAttack = { roll, chart, armor, ...entry };
  renderAttackResult();
}

// ── Step 2: Attack result + optional secondary form ──────────────────────────

function renderAttackResult() {
  const { roll, chart, armor, damage, fumble, description, critical } = lastAttack;

  let badgeClass, badgeText;
  if (fumble)          { badgeClass = 'badge-fumble';   badgeText = 'Possible Fumble'; }
  else if (damage === 0) { badgeClass = 'badge-miss';   badgeText = 'No Effect'; }
  else if (!critical)  { badgeClass = 'badge-damage';   badgeText = 'Damage Only'; }
  else                 { badgeClass = 'badge-critical';  badgeText = 'Critical!'; }

  const fumbleHtml = fumble ? `
    <div class="fumble-warn">
      ⚠ Possible fumble — check the fumble range for the specific weapon being used.
    </div>` : '';

  const secondaryHtml = (damage > 0 && critical) ? `
    <div class="card" id="secondary-card">
      <div class="card-title">Secondary Critical Roll</div>
      <div class="hint">
        Critical severity: <strong>${critical}</strong>
        &nbsp;·&nbsp; modifier: <strong>${CRIT_MOD[critical] >= 0 ? '+' : ''}${CRIT_MOD[critical]}</strong>
      </div>
      <form id="crit-form" novalidate>
        <div class="field">
          <label for="crit-roll">Unmodified Critical Roll</label>
          <input type="number" id="crit-roll" name="critRoll" inputmode="numeric"
                 min="1" max="999" placeholder="e.g. 65" required autofocus>
        </div>
        <div class="field">
          <label for="crit-table">Critical Table</label>
          <select id="crit-table" name="critTable">
            ${critTableOptions(DEFAULT_CRIT_TABLE[chart])}
          </select>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary">Resolve Critical</button>
          <button type="button" class="btn btn-ghost" id="start-over-btn">Start Over</button>
        </div>
      </form>
    </div>` : `
    <div class="card">
      <button class="btn btn-primary" id="start-over-btn">Start Over</button>
    </div>`;

  $main.innerHTML = `
    <div class="card">
      <div class="status-badge ${badgeClass}">${badgeText}</div>
      <div class="card-title">Attack Result</div>
      <div class="result-grid">
        <div class="result-box">
          <div class="result-box-label">Damage</div>
          <div class="result-box-value ${damage > 0 ? 'val-damage' : 'val-none'}">${damage}</div>
        </div>
        <div class="result-box">
          <div class="result-box-label">Critical</div>
          <div class="result-box-value ${critical ? 'val-critical' : 'val-none'}">${critical || '—'}</div>
        </div>
      </div>
      <div class="details-list">
        <div class="detail-row"><span class="dk">Roll</span>   <span class="dv">${roll}</span></div>
        <div class="detail-row"><span class="dk">Chart</span>  <span class="dv">${CHART_LABELS[chart]}</span></div>
        <div class="detail-row"><span class="dk">Armor</span>  <span class="dv">${ARMOR_LABELS[armor]}</span></div>
        <div class="detail-row"><span class="dk">Entry</span>  <span class="dv mono">${description}</span></div>
      </div>
      ${fumbleHtml}
    </div>
    ${secondaryHtml}`;

  document.querySelectorAll('#start-over-btn').forEach(btn =>
    btn.addEventListener('click', () => renderPrimary({ chart, armor }))
  );

  const critForm = document.getElementById('crit-form');
  if (critForm) critForm.addEventListener('submit', onCritSubmit);
}

// ── Step 3: Final resolution ─────────────────────────────────────────────────

function onCritSubmit(e) {
  e.preventDefault();

  const roll  = parseInt(document.getElementById('crit-roll').value, 10);
  const table = document.getElementById('crit-table').value;

  if (!Number.isInteger(roll) || roll < 0) {
    showError('Enter a valid non-negative roll value.');
    return;
  }

  const { critical, chart, armor } = lastAttack;
  const modifier     = CRIT_MOD[critical] ?? 0;
  // Clamp to 0 so very low T-critical rolls still resolve (maps to "no significant effect" entry)
  const modifiedRoll = Math.max(0, roll + modifier);

  const entry = tableLookup(criticals[table], modifiedRoll);
  if (!entry) {
    showError('No critical entry found — try a different roll.');
    return;
  }

  renderResolution({ roll, modifiedRoll, modifier, table, critDesc: entry.description });
}

function renderResolution({ roll, modifiedRoll, modifier, table, critDesc }) {
  const { damage, critical, chart, armor, roll: primaryRoll } = lastAttack;

  $main.innerHTML = `
    <div class="card">
      <div class="status-badge badge-resolved">Resolved</div>
      <div class="card-title">Critical Effect</div>
      <div class="crit-desc">${escHtml(critDesc)}</div>

      <div class="summary-list">
        <div class="summary-row">
          <span class="sum-key">Hits</span>
          <span class="sum-val val-damage">${damage}</span>
        </div>
        <div class="summary-row">
          <span class="sum-key">Critical Severity</span>
          <span class="sum-val val-critical">${critical}</span>
        </div>
        <div class="summary-row">
          <span class="sum-key">Critical Table</span>
          <span class="sum-val">${CRIT_TABLE_LABELS[table]}</span>
        </div>
      </div>

      <details class="roll-details">
        <summary>Roll details</summary>
        <div class="details-list" style="border-top:none;padding-top:0;">
          <div class="detail-row"><span class="dk">Primary Roll</span>   <span class="dv">${primaryRoll}</span></div>
          <div class="detail-row"><span class="dk">Chart</span>          <span class="dv">${CHART_LABELS[chart]}</span></div>
          <div class="detail-row"><span class="dk">Armor</span>          <span class="dv">${ARMOR_LABELS[armor]}</span></div>
          <div class="detail-row"><span class="dk">Secondary Roll</span> <span class="dv">${roll}</span></div>
          <div class="detail-row"><span class="dk">Modifier</span>       <span class="dv">${modifier >= 0 ? '+' : ''}${modifier}</span></div>
          <div class="detail-row"><span class="dk">Modified Roll</span>  <span class="dv">${modifiedRoll}</span></div>
        </div>
      </details>

      <button class="btn btn-primary" id="start-over-btn">New Attack</button>
    </div>`;

  document.getElementById('start-over-btn')
    .addEventListener('click', () => renderPrimary({ chart, armor }));
}

// ── Error banner ─────────────────────────────────────────────────────────────

function showError(msg) {
  document.querySelectorAll('.error-banner').forEach(el => el.remove());
  const div = document.createElement('div');
  div.className = 'error-banner';
  div.textContent = msg;
  $main.prepend(div);
  setTimeout(() => div.remove(), 4000);
}

// ── Boot ─────────────────────────────────────────────────────────────────────

init();
