/* ============================================================
   TEEJANO AGENCY — Dashboard App
   ============================================================ */

const API = '';   // same origin
let state = {
  currentWeek: null,
  drops: [],
  activeWeek: null,
  activeDropData: null,
  configName: null,
  approvalState: false,
  briefs: [],
  mockups: [],
  holidays: [],
};

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────

document.querySelectorAll('[data-page]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const page = link.dataset.page;
    navigateTo(page);
  });
});

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('[data-page]').forEach(l => l.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

  if (page === 'drops') loadDropsList();
  if (page === 'cowork') { populateWeekSelects(); loadCoworkPage(); }
  if (page === 'finalists') { populateWeekSelects(); loadFinalistsPage(); }
  if (page === 'ideas') loadIdeasPage();
  if (page === 'marketing') { populateWeekSelects(); loadMarketingPage(); }
  if (page === 'analytics') { populateWeekSelects(); loadAnalyticsPage(); }
  if (page === 'config') loadConfig('teejano_rules', document.querySelector('.config-tabs .tab-btn'));
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

async function init() {
  await loadDropsData();
  updateDashboard();
  loadDashboardLog();
}

async function loadDropsData() {
  try {
    const res = await fetch(`${API}/api/drops`);
    const data = await res.json();
    state.currentWeek = data.current_week;
    state.drops = data.drops || [];
    document.getElementById('current-week-badge').textContent = `📅 ${state.currentWeek}`;
    state.activeWeek = state.drops[0]?.week ?? state.currentWeek;
    if (state.activeWeek) {
      await loadActiveWeekData();
    }
  } catch (e) {
    showToast('Could not reach server', 'error');
  }
}

async function loadActiveWeekData() {
  if (!state.activeWeek) return;
  try {
    const res = await fetch(`${API}/api/drops/${state.activeWeek}`);
    state.activeDropData = await res.json();
  } catch {}
}

function updateDashboard() {
  const d = state.activeDropData;
  const w = state.activeWeek;

  document.getElementById('stat-week').textContent = w ?? '—';
  document.getElementById('stat-total-drops').textContent = state.drops.length;
  document.getElementById('stat-phase').textContent = formatPhase(d?.pipeline_phase);
  document.getElementById('stat-finalists').textContent = d?.finalist_count ?? 0;

  updatePipelineTrack(d?.pipeline_phase);
  renderRecentDrops();
}

function formatPhase(phase) {
  const map = {
    awaiting_cowork: 'Awaiting Cowork',
    scoring: 'Scoring...',
    finalists_ready: 'Finalists Ready',
    generating_briefs: 'Generating Briefs',
    awaiting_approval: 'Awaiting Approval',
    publishing: 'Publishing...',
    published: 'Published',
    postmortem: 'Postmortem',
    error: '⚠ Error',
  };
  return map[phase] ?? (phase ?? 'Not Started');
}

function updatePipelineTrack(phase) {
  const phaseOrder = ['awaiting_cowork', 'scoring', 'finalists_ready', 'awaiting_approval', 'publishing', 'published'];
  const stepMap = {
    awaiting_cowork: 0,
    scoring: 1,
    finalists_ready: 2,
    generating_briefs: 2,
    awaiting_approval: 3,
    publishing: 4,
    publish_error: 4,
    published: 5,
  };
  const currentStep = stepMap[phase] ?? -1;

  document.querySelectorAll('.pipeline-step').forEach((step, i) => {
    step.classList.remove('done', 'active');
    if (i < currentStep) step.classList.add('done');
    if (i === currentStep) step.classList.add('active');
  });
}

function renderRecentDrops() {
  const container = document.getElementById('recent-drops-table');
  if (!state.drops.length) {
    container.innerHTML = '<div class="table-loading">No drops yet. Start your first drop!</div>';
    return;
  }

  const rows = state.drops.slice(0, 5).map(d => `
    <div class="table-row drops-cols" onclick="navigateTo('drops')">
      <div>${d.week}</div>
      <div><span class="badge ${d.approved ? 'badge-green' : 'badge-yellow'}">${d.approved ? 'Approved' : 'Draft'}</span></div>
      <div>${formatPhase(d.pipeline_phase)}</div>
      <div>${d.finalist_count ?? '—'} concepts</div>
      <div>${d.cowork_inputs_submitted}/3 inputs</div>
      <div>${d.has_postmortem ? '<span class="badge badge-blue">Has Postmortem</span>' : '—'}</div>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="table-header drops-cols">
      <div>Week</div><div>Status</div><div>Phase</div><div>Finalists</div><div>Cowork</div><div>Analytics</div>
    </div>
    ${rows}
  `;
}

// ─────────────────────────────────────────────
// DROPS LIST PAGE
// ─────────────────────────────────────────────

function loadDropsList() {
  const container = document.getElementById('drops-list');
  if (!state.drops.length) {
    container.innerHTML = '<div class="table-loading">No drops found. Start your first drop!</div>';
    return;
  }

  const rows = state.drops.map(d => `
    <div class="table-row drops-cols" onclick="openDrop('${d.week}')">
      <div><strong>${d.week}</strong></div>
      <div><span class="badge ${d.approved ? 'badge-green' : 'badge-yellow'}">${d.approved ? 'Approved' : 'Draft'}</span></div>
      <div>${formatPhase(d.pipeline_phase)}</div>
      <div>${d.finalist_count ?? '—'} finalists</div>
      <div>${d.cowork_inputs_submitted}/3 inputs</div>
      <div>${d.has_postmortem ? '<span class="badge badge-blue">Postmortem</span>' : '—'}</div>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="table-header drops-cols">
      <div>Week</div><div>Status</div><div>Phase</div><div>Finalists</div><div>Cowork</div><div>Analytics</div>
    </div>
    ${rows}
  `;
}

function openDrop(week) {
  state.activeWeek = week;
  navigateTo('finalists');
  document.getElementById('finalists-week-select').value = week;
  loadFinalistsPage();
}

// ─────────────────────────────────────────────
// PIPELINE ACTIONS
// ─────────────────────────────────────────────

async function startNewDrop() {
  const week = state.currentWeek;
  if (!week) return showToast('Could not determine current week', 'error');

  const trends = document.getElementById('drop-trends-input')?.value?.trim() ?? '';

  const existing = state.drops.find(d => d.week === week);
  if (existing) {
    if (!confirm(`Drop ${week} already exists. Start it again (this will reset prompts)?`)) return;
  }

  showToast(`Starting drop for ${week}...`);

  try {
    const res = await fetch(`${API}/api/pipeline/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week, trends }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Drop ${week} initialized! Master prompt ready.`, 'success');
    document.getElementById('drop-trends-input').value = '';
    await loadDropsData();
    updateDashboard();
    navigateTo('cowork');
    document.getElementById('cowork-week-select').value = week;
    loadCoworkPage();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function runScoring() {
  const week = state.activeWeek ?? state.currentWeek;
  if (!week) return showToast('No active week', 'error');

  showToast(`Running scoring for ${week}...`);
  try {
    const res = await fetch(`${API}/api/pipeline/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Scoring complete: ${data.finalist_count} finalists selected from ${data.candidate_count} candidates!`, 'success');
    await loadDropsData();
    updateDashboard();
    navigateTo('finalists');
    document.getElementById('finalists-week-select').value = week;
    await loadFinalistsPage();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function runBriefs() {
  const week = state.activeWeek ?? state.currentWeek;
  if (!week) return showToast('No active week', 'error');

  showToast(`Generating briefs, listings, mockups for ${week}...`);
  try {
    const res = await fetch(`${API}/api/pipeline/briefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Generated: ${data.brief_count} briefs, ${data.listing_count} listings, ${data.mockup_count} mockups`, 'success');
    await loadDropsData();
    state.activeWeek = week;
    updateDashboard();
    navigateTo('finalists');
    document.getElementById('finalists-week-select').value = week;
    loadFinalistsPage();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function publishDrop() {
  const week = state.activeWeek ?? state.currentWeek;
  if (!week) return;
  if (!confirm(`Publish drop ${week} to Shopify? Make sure SHOPIFY API keys are configured.`)) return;

  try {
    const res = await fetch(`${API}/api/pipeline/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('Publish started — check the log for progress', 'success');
    loadDashboardLog();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function runPostmortem() {
  const week = document.getElementById('analytics-week-select')?.value ?? state.activeWeek;
  if (!week) return;
  showToast(`Running postmortem for ${week}...`);
  try {
    const res = await fetch(`${API}/api/pipeline/postmortem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('Postmortem complete!', 'success');
    loadAnalyticsPage();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function goToApproval() {
  navigateTo('finalists');
}

// ─────────────────────────────────────────────
// DESIGN STUDIO PAGE
// ─────────────────────────────────────────────

const SOURCES = ['chatgpt', 'gemini', 'design_arena'];

async function loadCoworkPage() {
  const week = document.getElementById('cowork-week-select')?.value ?? state.activeWeek;
  if (!week) return;
  state.activeWeek = week;

  try {
    const res = await fetch(`${API}/api/drops/${week}`);
    const data = await res.json();

    for (const source of SOURCES) {
      const generated = data.cowork_inputs?.[source];
      setSourceStatus(source, generated ? 'done' : 'idle');
    }
  } catch (e) {
    showToast('Could not load design studio data', 'error');
  }
}

/** Update a source card's visual state: idle | loading | done | error */
function setSourceStatus(source, state, message) {
  const statusEl = document.getElementById(`status-${source}`);
  const card = document.getElementById(`source-card-${source}`);
  const btn = document.getElementById(`gen-btn-${source}`);

  card.classList.remove('state-loading', 'state-done', 'state-error');

  if (state === 'idle') {
    statusEl.textContent = '⬡ Not generated';
    statusEl.className = 'source-status';
    btn.disabled = false;
    btn.textContent = 'Generate';
  } else if (state === 'loading') {
    statusEl.textContent = '⏳ Generating…';
    statusEl.className = 'source-status status-loading';
    card.classList.add('state-loading');
    btn.disabled = true;
    btn.textContent = '…';
  } else if (state === 'done') {
    statusEl.textContent = '✓ ' + (message || '10 concepts ready');
    statusEl.className = 'source-status status-done';
    card.classList.add('state-done');
    btn.disabled = false;
    btn.textContent = 'Regenerate';
  } else if (state === 'error') {
    statusEl.textContent = '✗ Failed';
    statusEl.className = 'source-status status-error';
    card.classList.add('state-error');
    btn.disabled = false;
    btn.textContent = 'Retry';
  }
}

/** Parse concepts from a raw AI response and render as cards. */
function renderConcepts(source, rawContent) {
  const container = document.getElementById(`concepts-${source}`);
  if (!container) return;

  let concepts = [];
  try {
    const match = rawContent.match(/\[[\s\S]*\]/);
    if (match) concepts = JSON.parse(match[0]);
  } catch {
    container.innerHTML = '<div class="concepts-empty">Could not parse concepts — check the manual paste area.</div>';
    return;
  }

  if (!concepts.length) {
    container.innerHTML = '<div class="concepts-empty">No concepts found in response.</div>';
    return;
  }

  container.innerHTML = concepts.map((c, i) => `
    <div class="concept-pill">
      <span class="concept-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="concept-phrase">${escHtml(c.PHRASE || c.phrase || '—')}</span>
      <span class="concept-angle">${escHtml(c.ANGLE || c.angle || '')}</span>
    </div>
  `).join('');
}

async function generateWithAI(source) {
  const week = document.getElementById('cowork-week-select')?.value ?? state.activeWeek;
  if (!week) return showToast('No active week — start a drop first.', 'error');

  setSourceStatus(source, 'loading');

  try {
    const res = await fetch(`${API}/api/drops/${week}/cowork/${source}/generate`, { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    renderConcepts(source, data.content);
    setSourceStatus(source, 'done');
    showToast(`${source === 'gemini' ? 'Gemini' : 'GPT'} generated 10 concepts!`, 'success');
  } catch (e) {
    setSourceStatus(source, 'error');
    showToast(e.message, 'error');
  }
}

async function generateAll() {
  const week = document.getElementById('cowork-week-select')?.value ?? state.activeWeek;
  if (!week) return showToast('No active week — start a drop first.', 'error');

  const allBtn = document.getElementById('btn-generate-all');
  allBtn.disabled = true;
  allBtn.textContent = '⏳ Generating all…';

  // Fire all 3 in parallel
  await Promise.allSettled(SOURCES.map(s => generateWithAI(s)));

  allBtn.disabled = false;
  allBtn.textContent = '⚡ Generate All Designs';
}

function toggleManual(source, btn) {
  const area = document.getElementById(`manual-${source}`);
  const visible = area.style.display !== 'none';
  area.style.display = visible ? 'none' : 'block';
  btn.textContent = visible ? '+ Paste manually instead' : '− Hide manual input';
}

async function submitCoworkResponse(source) {
  const week = document.getElementById('cowork-week-select')?.value ?? state.activeWeek;
  const content = document.getElementById(`response-${source}`)?.value?.trim();
  if (!content) return showToast('Paste a response first', 'error');
  if (!week) return showToast('No active week', 'error');

  try {
    const res = await fetch(`${API}/api/drops/${week}/cowork/${source}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    renderConcepts(source, content);
    setSourceStatus(source, 'done');
    showToast('Concepts saved!', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─────────────────────────────────────────────
// FINALISTS PAGE
// ─────────────────────────────────────────────

async function loadFinalistsPage() {
  const week = document.getElementById('finalists-week-select')?.value ?? state.activeWeek;
  if (!week) return;
  state.activeWeek = week;

  const container = document.getElementById('finalists-container');
  container.innerHTML = '<div class="table-loading"><span class="spinner"></span> Loading...</div>';

  try {
    const [dropRes, briefsRes] = await Promise.all([
      fetch(`${API}/api/drops/${week}`),
      fetch(`${API}/api/drops/${week}/briefs`),
    ]);
    const data = await dropRes.json();
    const briefsData = briefsRes.ok ? await briefsRes.json() : { briefs: [], mockups: [] };

    state.activeDropData = data;
    state.briefs = briefsData.briefs ?? [];
    state.mockups = briefsData.mockups ?? [];

    const finalists = data.finalists ?? [];
    state.approvalState = data.approved;

    if (!finalists.length) {
      container.innerHTML = `
        <div class="table-loading">
          No finalists yet for ${week}.<br><br>
          <button class="btn btn-primary btn-sm" onclick="runScoring()">Run Scoring Now</button>
        </div>`;
    } else {
      const approvedCount = finalists.filter(f => f.concept_approved).length;
      container.innerHTML = `
        <div class="finalists-toolbar">
          <span class="text-muted" style="font-size:12px">
            ${finalists.length} designs · ${approvedCount} approved
            ${data.listing_count ? ` · ${data.listing_count} listings` : ''}
          </span>
          <div style="display:flex;gap:8px">
            ${data.listing_count ? '' : '<button class="btn btn-secondary btn-sm" onclick="runBriefs()">Generate Briefs & Mockups</button>'}
            ${data.listing_count ? '<button class="btn btn-danger btn-sm" onclick="publishDrop()">Publish to Shopify →</button>' : ''}
          </div>
        </div>
        <div class="finalist-grid">
          ${finalists.map((c, i) => renderFinalistCard(c, i, state.briefs, state.mockups)).join('')}
        </div>
      `;
    }

    // Approval bar
    const bar = document.getElementById('approval-bar');
    const statusText = document.getElementById('approval-status-text');
    const approveBtn = document.getElementById('btn-approve');

    if (finalists.length > 0) {
      bar.style.display = 'flex';
      if (data.approved) {
        statusText.textContent = '✓ Drop approved';
        statusText.classList.add('approved');
        approveBtn.textContent = 'Revoke Approval';
        approveBtn.className = 'btn btn-secondary';
      } else {
        statusText.textContent = 'Not yet approved';
        statusText.classList.remove('approved');
        approveBtn.textContent = 'Approve Drop ✓';
        approveBtn.className = 'btn btn-danger';
      }
    } else {
      bar.style.display = 'none';
    }
  } catch (e) {
    container.innerHTML = `<div class="table-loading text-red">Error: ${e.message}</div>`;
  }
}

function renderFinalistCard(c, i, briefs, mockups) {
  const score = c.total_score ?? 0;
  const fillClass = score >= 80 ? 'high' : score >= 65 ? 'mid' : '';
  const scores = c.scores ?? {};
  const isApproved = !!c.concept_approved;

  // Find briefs for this concept (VA + VB)
  const conceptBriefs = (briefs ?? []).filter(b => b.concept_id === c.concept_id);

  // Find mockup images for this concept (prefer front_on_model)
  const conceptMockups = (mockups ?? []).filter(m => m.concept_id === c.concept_id);
  const primaryMockup = conceptMockups.find(m => m.mockup_type === 'front_on_model') ?? conceptMockups[0];

  return `
    <div class="finalist-card ${isApproved ? 'finalist-card--approved' : ''}" id="card-${c.concept_id}">
      ${primaryMockup?.url ? `
        <div class="finalist-mockup" onclick="openMockupModal('${escHtml(primaryMockup.url)}', '${escHtml(c.phrase_primary)}')">
          <img src="${escHtml(primaryMockup.url)}" alt="${escHtml(c.phrase_primary)}" loading="lazy" onerror="this.parentElement.style.display='none'">
          ${conceptMockups.length > 1 ? `<span class="mockup-count">${conceptMockups.length} views</span>` : ''}
        </div>` : ''}

      <div class="finalist-card-body">
        <div class="finalist-card-header">
          <div class="finalist-rank">#${i + 1} · ${score}/100</div>
          <div class="finalist-card-actions">
            <button class="btn-icon ${isApproved ? 'btn-icon--active' : ''}" title="${isApproved ? 'Approved — click to revoke' : 'Approve this design'}"
              onclick="toggleConceptApproval('${c.concept_id}', ${isApproved})">
              ${isApproved ? '✓' : '○'}
            </button>
            <button class="btn-icon" title="Edit this design" onclick="editConcept('${c.concept_id}')">✏</button>
          </div>
        </div>

        <div class="finalist-phrase">${escHtml(c.phrase_primary)}</div>
        <div class="finalist-score-bar">
          <div class="finalist-score-fill ${fillClass}" style="width:${score}%"></div>
        </div>

        <div class="finalist-meta">
          <span class="badge badge-gray">${c.angle ?? '—'}</span>
          ${c.bilingual_level && c.bilingual_level !== 'none' ? `<span class="badge badge-blue">Spanglish:${c.bilingual_level}</span>` : ''}
          ${isApproved ? '<span class="badge badge-green">Approved</span>' : ''}
        </div>

        <div class="finalist-detail">${escHtml(c.audience ?? '')}</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${escHtml(c.sell_thesis ?? '')}</div>

        ${scores.clarity !== undefined ? `
          <div class="score-grid">
            <span>Clarity: ${scores.clarity}/20</span>
            <span>Texas-ness: ${scores.texas_ness}/20</span>
            <span>Humor: ${scores.humor_punch}/20</span>
            <span>Wearability: ${scores.wearability}/20</span>
            <span>Print: ${scores.print_simplicity}/20</span>
          </div>` : ''}

        ${conceptBriefs.length ? `
          <details class="brief-details">
            <summary>Brief — ${conceptBriefs.length} variant${conceptBriefs.length > 1 ? 's' : ''}</summary>
            ${conceptBriefs.map(b => `
              <div class="brief-variant">
                <div class="brief-variant-label">${escHtml(b.variant_label ?? '')}</div>
                <div class="brief-row"><span>Layout</span><span>${escHtml(b.layout_map?.layout_type ?? '—')}</span></div>
                <div class="brief-row"><span>Font</span><span>${escHtml(b.layout_map?.font_primary ?? '—')}</span></div>
                <div class="brief-row"><span>Garment</span><span>${escHtml(b.colorways?.garment_color ?? '—')}</span></div>
                <div class="brief-row"><span>Ink colors</span><span>${(b.colorways?.ink_colors ?? []).map(ic => ic.name).join(', ') || '—'}</span></div>
                <div class="brief-row"><span>Placement</span><span>${escHtml(b.print_specs?.placement ?? '—')} ${b.print_specs ? `· ${b.print_specs.width_inches}"×${b.print_specs.height_inches}"` : ''}</span></div>
                ${b.icon_notes ? `<div class="brief-row brief-row--full"><span>Icons/Art</span><span>${escHtml(b.icon_notes)}</span></div>` : ''}
              </div>
            `).join('')}
          </details>` : ''}
      </div>
    </div>
  `;
}

async function toggleConceptApproval(conceptId, currentlyApproved) {
  const week = state.activeWeek;
  if (!week) return;
  try {
    const res = await fetch(`${API}/api/drops/${week}/finalists/${conceptId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concept_approved: !currentlyApproved }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast(!currentlyApproved ? 'Design approved ✓' : 'Approval removed', !currentlyApproved ? 'success' : '');
    await loadFinalistsPage();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function editConcept(conceptId) {
  const concept = (state.activeDropData?.finalists ?? []).find(f => f.concept_id === conceptId);
  if (!concept) return;

  document.getElementById('edit-concept-id').value = conceptId;
  document.getElementById('edit-phrase').value = concept.phrase_primary ?? '';
  document.getElementById('edit-sell-thesis').value = concept.sell_thesis ?? '';
  document.getElementById('edit-audience').value = concept.audience ?? '';
  document.getElementById('edit-notes').value = concept.imagery_notes ?? '';

  document.getElementById('edit-modal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
}

async function saveConceptEdit() {
  const conceptId = document.getElementById('edit-concept-id').value;
  const week = state.activeWeek;
  if (!conceptId || !week) return;

  const payload = {
    phrase_primary: document.getElementById('edit-phrase').value.trim(),
    sell_thesis: document.getElementById('edit-sell-thesis').value.trim(),
    audience: document.getElementById('edit-audience').value.trim(),
    imagery_notes: document.getElementById('edit-notes').value.trim(),
  };

  try {
    const res = await fetch(`${API}/api/drops/${week}/finalists/${conceptId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('Design updated!', 'success');
    closeEditModal();
    await loadFinalistsPage();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openMockupModal(url, phrase) {
  document.getElementById('mockup-modal-img').src = url;
  document.getElementById('mockup-modal-label').textContent = phrase;
  document.getElementById('mockup-modal').classList.add('open');
}

function closeMockupModal() {
  document.getElementById('mockup-modal').classList.remove('open');
}

async function toggleApproval() {
  const week = state.activeWeek;
  if (!week) return;
  const newState = !state.approvalState;

  try {
    const res = await fetch(`${API}/api/drops/${week}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: newState }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast(newState ? 'Drop approved! ✓' : 'Approval revoked', newState ? 'success' : '');
    state.approvalState = newState;
    loadFinalistsPage();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─────────────────────────────────────────────
// MARKETING PAGE
// ─────────────────────────────────────────────

async function loadMarketingPage() {
  const week = document.getElementById('marketing-week-select')?.value ?? state.activeWeek;
  if (!week) return;
  const container = document.getElementById('marketing-container');
  container.innerHTML = '<div class="table-loading"><span class="spinner"></span></div>';

  try {
    const res = await fetch(`${API}/api/drops/${week}/marketing`);
    const data = await res.json();
    const m = data.marketing;

    if (!m) {
      container.innerHTML = '<div class="table-loading">No marketing pack yet. Generate briefs first.</div>';
      return;
    }

    container.innerHTML = `
      <div class="marketing-grid">
        ${marketingCard('Instagram Drop Caption', m.instagram_drop_caption)}
        ${marketingCard('TikTok Script', m.tiktok_script)}
        ${marketingCard('SMS — Drop Live', m.sms_drop_live)}
        ${marketingCard('SMS — Last Call', m.sms_last_call)}
        ${marketingCard('Influencer DM', m.influencer_dm ?? 'Included in marketing pack')}
        <div class="marketing-card">
          <div class="marketing-card-header">
            <div class="marketing-card-title">Top Phrases This Drop</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${(m.top_phrases ?? []).map((p, i) => `
              <div style="display:flex;gap:12px;align-items:center">
                <span style="color:var(--text-dim);font-size:11px;font-weight:700;min-width:20px">#${i + 1}</span>
                <span style="font-family:'Oswald',sans-serif;font-size:18px">${escHtml(p)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // Also load email sequence
    const eRes = await fetch(`${API}/api/drops/${week}/email-sequence`);
    const eData = await eRes.json();
    if (eData.emails?.length) {
      container.innerHTML += `
        <div class="section-title" style="margin-top:28px">Email Sequence</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
          ${eData.emails.map(e => `
            <div class="marketing-card">
              <div class="marketing-card-header">
                <div class="marketing-card-title">${e.name?.replace('_', ' ') ?? ''}</div>
                <span class="badge badge-gray">${e.schedule?.day ?? ''} ${e.schedule?.time ?? ''}</span>
              </div>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Subject options:</div>
              ${(e.subject_options ?? []).map(s => `<div style="font-size:12px;color:var(--text-muted);padding:4px 0;border-bottom:1px solid var(--border)">${escHtml(s)}</div>`).join('')}
              <div style="margin-top:8px;font-size:11px;color:var(--text-dim)">Preview: ${escHtml(e.preview_text ?? '')}</div>
            </div>
          `).join('')}
        </div>
      `;
    }
  } catch (e) {
    container.innerHTML = `<div class="table-loading text-red">Error: ${e.message}</div>`;
  }
}

function marketingCard(title, content) {
  return `
    <div class="marketing-card">
      <div class="marketing-card-header">
        <div class="marketing-card-title">${title}</div>
        <button class="btn btn-sm btn-outline" onclick="copyText(this, ${JSON.stringify(content ?? '')})">Copy</button>
      </div>
      <div class="marketing-copy">${escHtml(content ?? 'Not generated yet')}</div>
    </div>
  `;
}

async function copyText(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {}
}

// ─────────────────────────────────────────────
// ANALYTICS PAGE
// ─────────────────────────────────────────────

async function loadAnalyticsPage() {
  const week = document.getElementById('analytics-week-select')?.value ?? state.activeWeek;
  if (!week) return;
  const container = document.getElementById('analytics-container');
  container.innerHTML = '<div class="table-loading"><span class="spinner"></span></div>';

  try {
    const res = await fetch(`${API}/api/drops/${week}/postmortem`);
    const data = await res.json();

    container.innerHTML = `
      <div class="analytics-actions">
        <button class="btn btn-secondary" onclick="runPostmortem()">Run Postmortem Now</button>
        <span class="text-muted" style="font-size:12px">Pulls Shopify order data, identifies winners/losers, updates knowledge base</span>
      </div>
      ${data.postmortem
        ? `<div class="postmortem-content">${renderMarkdown(data.postmortem)}</div>`
        : `<div class="table-loading">No postmortem yet for ${week}. Run it after the drop closes.</div>`
      }
    `;

    // Also show global winner patterns
    const wRes = await fetch(`${API}/api/data/winners`);
    const wData = await wRes.json();
    if (wData.winners) {
      container.innerHTML += `
        <div class="section-title" style="margin-top:28px">Winner Patterns (Global)</div>
        <div class="postmortem-content">${renderMarkdown(wData.winners)}</div>
      `;
    }
  } catch (e) {
    container.innerHTML = `<div class="table-loading text-red">Error: ${e.message}</div>`;
  }
}

// ─────────────────────────────────────────────
// CONFIG PAGE
// ─────────────────────────────────────────────

let activeConfigName = 'teejano_rules';

async function loadConfig(name, btn) {
  activeConfigName = name;
  document.getElementById('config-name-label').textContent = `Editing: ${name}.json`;
  document.querySelectorAll('.config-tabs .tab-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');

  try {
    const res = await fetch(`${API}/api/config/${name}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    document.getElementById('config-editor').value = JSON.stringify(data, null, 2);
  } catch (e) {
    document.getElementById('config-editor').value = `// Error loading config: ${e.message}`;
  }
}

async function saveConfig() {
  const text = document.getElementById('config-editor').value;
  try {
    const parsed = JSON.parse(text);
    const res = await fetch(`${API}/api/config/${activeConfigName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast(`${activeConfigName}.json saved!`, 'success');
  } catch (e) {
    showToast(e.message === 'JSON Parse error' ? 'Invalid JSON — check syntax' : e.message, 'error');
  }
}

// ─────────────────────────────────────────────
// LOG DRAWER
// ─────────────────────────────────────────────

let logOpen = false;

function toggleLog() {
  logOpen = !logOpen;
  document.getElementById('log-drawer').classList.toggle('open', logOpen);
  if (logOpen) loadDashboardLog();
}

function closeLog() {
  logOpen = false;
  document.getElementById('log-drawer').classList.remove('open');
}

async function loadDashboardLog() {
  const week = state.activeWeek;
  if (!week) return;
  try {
    const res = await fetch(`${API}/api/drops/${week}/log`);
    const data = await res.json();
    const content = document.getElementById('log-content');
    const lines = (data.log ?? '').split('\n').filter(Boolean);
    content.innerHTML = lines.map(line => {
      const cls = line.includes('[ERROR]') ? 'log-line-error'
        : line.includes('[WARN]') ? 'log-line-warn' : 'log-line-info';
      return `<span class="${cls}">${escHtml(line)}</span>`;
    }).join('\n');
    content.scrollTop = content.scrollHeight;
  } catch {}
}

// ─────────────────────────────────────────────
// WEEK SELECTORS
// ─────────────────────────────────────────────

function populateWeekSelects() {
  const selects = ['cowork-week-select', 'finalists-week-select', 'marketing-week-select', 'analytics-week-select'];
  const options = state.drops.map(d => `<option value="${d.week}">${d.week}</option>`).join('');
  for (const id of selects) {
    const el = document.getElementById(id);
    if (!el) continue;
    const curr = el.value;
    el.innerHTML = options || `<option value="${state.currentWeek}">${state.currentWeek}</option>`;
    if (state.activeWeek) el.value = state.activeWeek;
    else if (curr) el.value = curr;
  }
}

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────

let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); }, 3500);
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Very basic markdown → html (headings, bold, lists) */
function renderMarkdown(md) {
  return md
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hlp])/gm, '')
    .trim();
}

// ─────────────────────────────────────────────
// IDEAS PAGE — Holiday Calendar + Seed Generator
// ─────────────────────────────────────────────

async function loadIdeasPage() {
  await loadHolidayCalendar();
}

async function loadHolidayCalendar() {
  const container = document.getElementById('holiday-list');
  try {
    const res = await fetch(`${API}/api/ideas/holidays`);
    const data = await res.json();
    state.holidays = data.holidays ?? [];
    renderHolidayCalendar(state.holidays);
    populateHolidaySelect(state.holidays);
  } catch (e) {
    container.innerHTML = `<div class="table-loading text-red">Could not load calendar: ${e.message}</div>`;
  }
}

function renderHolidayCalendar(holidays) {
  const container = document.getElementById('holiday-list');

  // Split into sections: needs action now, coming up, future
  const urgent  = holidays.filter(h => h.urgency === 'urgent' || h.urgency === 'soon');
  const ok      = holidays.filter(h => h.urgency === 'ok');
  const future  = holidays.filter(h => h.urgency === 'future');

  let html = '';

  if (urgent.length) {
    html += `<div class="holiday-section-label holiday-section-label--urgent">⚡ Act Now</div>`;
    html += urgent.map(h => renderHolidayRow(h)).join('');
  }
  if (ok.length) {
    html += `<div class="holiday-section-label">Coming Up — Start Your Drop</div>`;
    html += ok.map(h => renderHolidayRow(h)).join('');
  }
  if (future.length) {
    html += `<div class="holiday-section-label">On the Horizon</div>`;
    html += future.map(h => renderHolidayRow(h)).join('');
  }

  container.innerHTML = html || '<div class="table-loading">No upcoming holidays found.</div>';
}

function renderHolidayRow(h) {
  const urgencyLabel = {
    urgent: 'OVERDUE — start now',
    soon:   'START THIS WEEK',
    ok:     `Start by ${h.startDate}`,
    future: `Start by ${h.startDate}`,
  }[h.urgency] ?? '';

  const daysLabel = h.daysUntilHoliday === 0
    ? 'Today!'
    : h.daysUntilHoliday < 0
    ? `${Math.abs(h.daysUntilHoliday)}d ago`
    : `${h.daysUntilHoliday} days away`;

  const startLabel = h.daysUntilStart <= 0
    ? `${Math.abs(h.daysUntilStart)}d past start`
    : `${h.daysUntilStart}d until start`;

  return `
    <div class="holiday-row urgency-${h.urgency}">
      <div class="holiday-row-left">
        <span class="holiday-emoji">${h.emoji}</span>
        <div class="holiday-info">
          <div class="holiday-name">${escHtml(h.name)}</div>
          <div class="holiday-note">${escHtml(h.note)}</div>
          <div class="holiday-tags">
            ${h.tags.map(t => `<span class="badge badge-gray">${t}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="holiday-row-right">
        <div class="holiday-date">${escHtml(h.date)}</div>
        <div class="holiday-days">${daysLabel}</div>
        <div class="holiday-urgency-label urgency-text-${h.urgency}">${urgencyLabel}</div>
        <div class="holiday-start-note">${startLabel} · ${h.leadWeeks}wk lead</div>
        <button class="btn btn-sm btn-outline" onclick="pinHolidayToSeed('${escHtml(h.name)}')">
          Use for Seeds →
        </button>
      </div>
    </div>
  `;
}

function populateHolidaySelect(holidays) {
  const sel = document.getElementById('seed-holiday-pick');
  if (!sel) return;
  // Preserve existing empty option
  sel.innerHTML = '<option value="">— Any / no specific holiday —</option>';
  holidays.forEach(h => {
    const opt = document.createElement('option');
    opt.value = h.name;
    opt.dataset.tags = (h.tags ?? []).join(',');
    opt.textContent = `${h.emoji} ${h.name} (${h.date})`;
    sel.appendChild(opt);
  });
}

function pinHolidayToSeed(holidayName) {
  const sel = document.getElementById('seed-holiday-pick');
  if (sel) sel.value = holidayName;
  document.getElementById('seed-preferences')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('seed-preferences')?.focus();
}

async function generateSeeds() {
  const preferences = document.getElementById('seed-preferences')?.value?.trim() ?? '';
  const sel = document.getElementById('seed-holiday-pick');
  const holiday = sel?.value ?? '';
  const holidayTags = sel?.selectedOptions[0]?.dataset?.tags?.split(',').filter(Boolean) ?? [];

  const container = document.getElementById('seeds-container');
  container.innerHTML = '<div class="table-loading"><span class="spinner"></span> Generating seeds...</div>';

  try {
    const res = await fetch(`${API}/api/ideas/seeds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences, holiday, holiday_tags: holidayTags }),
    });
    const data = await res.json();
    _lastSeeds = data.seeds ?? [];
    renderSeeds(_lastSeeds, preferences, holiday);
  } catch (e) {
    container.innerHTML = `<div class="table-loading text-red">Error: ${e.message}</div>`;
  }
}

function renderSeeds(seeds, preferences, holiday) {
  const container = document.getElementById('seeds-container');
  if (!seeds.length) {
    container.innerHTML = '<div class="table-loading">No seeds generated. Try adding more theme keywords.</div>';
    return;
  }

  const context = [holiday && `Holiday: ${holiday}`, preferences && `Themes: ${preferences}`]
    .filter(Boolean).join(' · ');

  container.innerHTML = `
    <div class="seeds-header">
      <div>
        <div class="section-title" style="margin:0 0 4px">${seeds.length} Concept Seeds</div>
        ${context ? `<div style="font-size:12px;color:var(--text-dim)">${escHtml(context)}</div>` : ''}
      </div>
      <button class="btn btn-outline btn-sm" onclick="copyAllSeeds()">Copy All as Prompt Seed</button>
    </div>
    <div class="seeds-grid" id="seeds-grid">
      ${seeds.map((s, i) => renderSeedCard(s, i)).join('')}
    </div>
  `;
}

function renderSeedCard(s, i) {
  const angleLabel = (s.angle ?? '').replace(/_/g, ' ');
  return `
    <div class="seed-card ${s.is_holiday_seed ? 'seed-card--holiday' : ''}">
      ${s.is_holiday_seed ? '<div class="seed-holiday-badge">🎯 Holiday Tie-in</div>' : ''}
      <div class="seed-phrase">"${escHtml(s.phrase)}"</div>
      <div class="seed-angle">${escHtml(angleLabel)}</div>
      <div class="seed-audience">Target: ${escHtml(s.audience)}</div>
      <div class="seed-thesis">${escHtml(s.sell_thesis)}</div>
      <div class="seed-actions">
        <button class="btn btn-sm btn-outline" onclick="copySeed(${i})">Copy</button>
        <button class="btn btn-sm btn-primary" onclick="useAsSeed(${i})">Use in Cowork →</button>
      </div>
    </div>
  `;
}

// Seeds array for copy/use actions (populated inside generateSeeds)
let _lastSeeds = [];

function copySeed(i) {
  const s = _lastSeeds[i];
  if (!s) return;
  const text = `Phrase: "${s.phrase}"\nAngle: ${s.angle}\nAudience: ${s.audience}\nSell thesis: ${s.sell_thesis}`;
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!', 'success'));
}

function copyAllSeeds() {
  if (!_lastSeeds.length) return;
  const text = _lastSeeds.map((s, i) =>
    `${i + 1}. "${s.phrase}" — ${s.angle} — ${s.audience}`
  ).join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('All seeds copied!', 'success'));
}

function useAsSeed(i) {
  const s = _lastSeeds[i];
  if (!s) return;
  // Store the seed hint and navigate to Cowork page
  const hint = `SEED CONCEPT:\nPhrase: "${s.phrase}"\nAngle: ${s.angle}\nAudience: ${s.audience}\nSell thesis: ${s.sell_thesis}\n\n[Expand this into 5-8 full concepts in the format below...]`;
  navigateTo('cowork');
  // Pre-fill a note in the first response box after a tick
  setTimeout(() => {
    const ta = document.getElementById('response-chatgpt');
    if (ta && !ta.value.trim()) {
      ta.value = hint;
      ta.focus();
      showToast('Seed concept added to ChatGPT response box', 'success');
    }
  }, 200);
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────

init();
