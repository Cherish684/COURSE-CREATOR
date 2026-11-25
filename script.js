// ============================================================
//  Course Creator AI — script.js
// ============================================================

const API_BASE = 'http://localhost:5000';

// ── State ──
let currentCourse      = null;
let currentCourseId    = null;
let currentTopic       = '';
let currentShareToken  = null;
let moduleCompleted    = {};
let feedbackRating     = 5;
let ttsUtterance       = null;
let quizState          = {};
let pointsHistory      = [];
let quizzesTaken       = 0;
let submittedFeedbacks = [];
let sidebarCollapsed   = false;
let currentUser        = null;
let selectedLanguage   = 'English';

// ── Points per difficulty (separate counters) ──
let easyPoints   = 0;  // points earned from easy questions only
let mediumPoints = 0;  // points earned from medium questions only
let hardPoints   = 0;  // points earned from hard questions only
let totalPoints  = 0;  // grand total for display

// Level thresholds — all unlocked from start
const EASY_UNLOCK   = 0;     const EASY_COMPLETE   = 500;
const MEDIUM_UNLOCK = 0;     const MEDIUM_COMPLETE = 1000;
const HARD_UNLOCK   = 0;     const HARD_COMPLETE   = 1500;

// ── Video course state ──
let vcSelectedVideoId    = '';
let vcSelectedVideoTitle = '';
let vcStepTimers         = [];
let vcCurrentQuiz        = null;
let vcCurrentDifficulty  = 'easy';
let vcCurrentTopic       = '';

// ── Upload state ──
let uploadedFiles     = [];
let uploadChatHistory = [];

// ── Voice nav ──
let voiceActive  = false;
let recognition  = null;

// ── Focus detector ──
let engagementActive   = false;
let focusStream        = null;
let focusInterval      = null;
let sessionStartTime   = null;
let distractedTime     = 0;
let currentFocusScore  = 100;
let nudgeShown         = false;
let faceDetectionModel = null;
let localEngagementSessions = [];

const BREADCRUMBS = {
  written:            'Learning / Written Course',
  video:              'Learning / Video Course',
  quiz:               'Learning / Quiz Center',
  points:             'Rewards / Points',
  levels:             'Rewards / Levels',
  'saved-notes':      'Saved / Saved Notes',
  saved:              'Saved / Saved Topics',
  'my-courses':       'Saved / My Courses',
  upload:             'Study Tools / Upload File',
  engagement:         'Study Tools / Focus Report',
  settings:           'Account / Settings',
  feedback:           'Account / Feedback',
  'feedback-history': 'Account / My Submissions',
  faq: 'FAQs',
};

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadStateFromStorage();
  checkSession();
  initVoiceNav();
  renderSavedTopicsBar();
  renderSavedTopicsGrid();
  updateLevelsPage();
  updatePointsPage();
  document.getElementById('topicInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') generateCourse(); });
  document.getElementById('vcSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchYouTube(); });
  const sharedToken = getSharedTokenFromUrl();
  if (sharedToken) loadSharedCourse(sharedToken);
});

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// AUTH
// ============================================================
async function checkSession() {
  try {
    const res  = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
    const data = await res.json();
    if (data.success) {
      currentUser      = data.user;
      selectedLanguage = data.user.language || 'English';
      updateUserUI();
      hideLanding();
    }
  } catch(e) {}
}

function showAuthModal(tab) {
  document.getElementById('authModal').classList.add('open');
  switchAuthTab(tab || 'login');
}
function closeAuthModal() { document.getElementById('authModal').classList.remove('open'); }
function switchAuthTab(tab) {
  document.getElementById('authLogin').style.display  = tab === 'login'  ? 'block' : 'none';
  document.getElementById('authSignup').style.display = tab === 'signup' ? 'block' : 'none';
  document.getElementById('tabLogin').classList.toggle('active',  tab === 'login');
  document.getElementById('tabSignup').classList.toggle('active', tab === 'signup');
}

async function doLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  if (!email || !password) { showToast('Please fill in all fields', 'error'); return; }
  try {
    const res  = await fetch(`${API_BASE}/api/login`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({email, password}) });
    const data = await res.json();
    if (!data.success) { showToast(data.error || 'Login failed', 'error'); return; }
    currentUser = data.user; selectedLanguage = data.user.language || 'English';
    updateUserUI(); closeAuthModal(); hideLanding();
    showToast(`Welcome back, ${data.user.name}! 👋`, 'success');
  } catch(e) { showToast('Connection error', 'error'); }
}

async function doSignup() {
  const name     = document.getElementById('signupName').value.trim();
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value.trim();
  if (!name || !email || !password) { showToast('Please fill in all fields', 'error'); return; }
  try {
    const res  = await fetch(`${API_BASE}/api/register`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({name, email, password}) });
    const data = await res.json();
    if (!data.success) { showToast(data.error || 'Signup failed', 'error'); return; }
    currentUser = data.user; selectedLanguage = data.user.language || 'English';
    updateUserUI(); closeAuthModal(); hideLanding();
    showToast(`Welcome, ${data.user.name}! 🎉`, 'success');
  } catch(e) { showToast('Connection error', 'error'); }
}

async function doLogout() {
  try { await fetch(`${API_BASE}/api/logout`, { method:'POST', credentials:'include' }); } catch(e) {}
  currentUser = null; updateUserUI();
  document.getElementById('landingPage').style.display = 'flex';
  document.getElementById('mainApp').style.display     = 'none';
  showToast('Logged out successfully', 'info');
}

function skipAuth() { hideLanding(); }
function hideLanding() {
  document.getElementById('landingPage').style.display = 'none';
  document.getElementById('mainApp').style.display     = 'flex';
}

function updateUserUI() {
  const chip         = document.getElementById('userChip');
  const logoutBtn    = document.getElementById('logoutBtn');
  const settingsDesc = document.getElementById('settingsAccountDesc');
  const loginBtn     = document.getElementById('settingsLoginBtn');
  const langSel      = document.getElementById('languageSelect');
  if (currentUser) {
    if (chip) chip.style.display = 'flex';
    if (logoutBtn) logoutBtn.style.display = 'flex';
    const avatar = document.getElementById('userChipAvatar');
    const uname  = document.getElementById('userChipName');
    if (avatar) avatar.textContent = currentUser.name[0].toUpperCase();
    if (uname)  uname.textContent  = currentUser.name;
    if (settingsDesc) settingsDesc.textContent = `Logged in as ${currentUser.email}`;
    if (loginBtn) loginBtn.style.display = 'none';
    if (langSel) langSel.value = selectedLanguage;
  } else {
    if (chip) chip.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (settingsDesc) settingsDesc.textContent = 'Not logged in';
    if (loginBtn) loginBtn.style.display = 'inline-flex';
  }
}

// ============================================================
// SETTINGS
// ============================================================
async function saveLanguage() {
  selectedLanguage = document.getElementById('languageSelect').value;
  localStorage.setItem('cf_language', selectedLanguage);
  if (currentUser) {
    try { await fetch(`${API_BASE}/api/update-language`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({language: selectedLanguage}) }); } catch(e) {}
  }
  showToast(`Language set to ${selectedLanguage}`, 'success');
}

// ============================================================
// SIDEBAR & NAVIGATION
// ============================================================
function toggleSidebar() {} // legacy no-op

const SUPER_MAP = {
  'written':'learning','video':'learning','quiz':'learning',
  'points':'rewards','levels':'rewards',
  'saved-notes':'saved','saved':'saved','my-courses':'saved',
  'upload':'tools','engagement':'tools',
  'settings':'account','feedback':'account','feedback-history':'account',
  'faq':'faqs'
};

const SUPER_FIRST = {
  learning: 'written',
  rewards:  'points',
  saved:    'saved-notes',
  tools:    'upload',
  account:  'settings'
};

function toggleSuper(name) {
  const subrows = ['learning','rewards','saved','tools','account'];
  subrows.forEach(s => {
    const row = document.getElementById(`subrow-${s}`);
    const btn = document.getElementById(`super-${s}`);
    if (s === name) {
      if (row) row.style.display = 'flex';
      if (btn) btn.classList.add('active');
      if (SUPER_FIRST[name]) showSection(SUPER_FIRST[name]);
    } else {
      if (row) row.style.display = 'none';
      if (btn) btn.classList.remove('active');
    }
  });
}

function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.subnav-item').forEach(b => b.classList.remove('active'));
  const map = {
    written:'sectionWritten', video:'sectionVideo', quiz:'sectionQuiz',
    points:'sectionPoints', levels:'sectionLevels',
    'saved-notes':'sectionSavedNotes', saved:'sectionSaved',
    upload:'sectionUpload', engagement:'sectionEngagement',
    settings:'sectionSettings', feedback:'sectionFeedback',
    'feedback-history':'sectionFeedbackHistory', faq:'sectionFaq',
  };
  const el = document.getElementById(map[name]);
  if (el) el.classList.add('active');
  // Sync breadcrumb
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = BREADCRUMBS[name] || '';
  // Sync correct subrow + main tab + strip icon
  const superName = SUPER_MAP[name];
  const subrows = ['learning','rewards','saved','tools','account'];
  subrows.forEach(s => {
    const row = document.getElementById(`subrow-${s}`);
    const btn = document.getElementById(`super-${s}`);
    const strip = document.getElementById(`strip-${s}`);
    const show = superName ? s === superName : false;
    if (row)  row.style.display = show ? 'flex' : 'none';
    if (btn)  btn.classList.toggle('active', show);
    if (strip) strip.classList.toggle('active', show);
  });
  // Sync sub-tab active
  document.querySelectorAll('.vb-sub-tab').forEach(b => b.classList.remove('active'));
  const subBtn = document.getElementById(`nav-${name}`);
  if (subBtn) subBtn.classList.add('active');
  if (name === 'saved')              renderSavedTopicsGrid();
  if (name === 'saved-notes')        renderSavedNotesGrid();
  if (name === 'levels')             updateLevelsPage();
  if (name === 'points')             updatePointsPage();
  if (name === 'quiz')               renderQuizCenter();
  if (name === 'feedback-history')   loadFeedbackHistory();
  if (name === 'my-courses')         loadMyCourses();
  if (name === 'engagement')         loadEngagementReport();
  if (name === 'settings')           updateUserUI();
}

// ============================================================
// THEME
// ============================================================
function loadTheme() {
  const saved = localStorage.getItem('cf_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeUI(saved);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cf_theme', next);
  updateThemeUI(next);
}
function updateThemeUI(theme) {
  document.getElementById('themeIcon').textContent = theme === 'dark' ? '☀️' : '🌙';
  const label = document.getElementById('themeLabel');
  if (label) label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
}

// ============================================================
// STORAGE
// ============================================================
function loadStateFromStorage() {
  easyPoints             = parseInt(localStorage.getItem('cf_easy_pts')   || '0');
  mediumPoints           = parseInt(localStorage.getItem('cf_medium_pts') || '0');
  hardPoints             = parseInt(localStorage.getItem('cf_hard_pts')   || '0');
  totalPoints            = easyPoints + mediumPoints + hardPoints;
  pointsHistory          = JSON.parse(localStorage.getItem('cf_points_history')   || '[]');
  moduleCompleted        = JSON.parse(localStorage.getItem('cf_module_completed') || '{}');
  quizzesTaken           = parseInt(localStorage.getItem('cf_quizzes_taken') || '0');
  submittedFeedbacks     = JSON.parse(localStorage.getItem('cf_feedbacks')    || '[]');
  selectedLanguage       = localStorage.getItem('cf_language') || 'English';
  localEngagementSessions = JSON.parse(localStorage.getItem('cf_local_engagement') || '[]');
  updateTopbarPoints();
  const langSel = document.getElementById('languageSelect');
  if (langSel) langSel.value = selectedLanguage;
}

function saveStateToStorage() {
  localStorage.setItem('cf_easy_pts',         easyPoints);
  localStorage.setItem('cf_medium_pts',       mediumPoints);
  localStorage.setItem('cf_hard_pts',         hardPoints);
  localStorage.setItem('cf_points_history',   JSON.stringify(pointsHistory));
  localStorage.setItem('cf_module_completed', JSON.stringify(moduleCompleted));
  localStorage.setItem('cf_quizzes_taken',    quizzesTaken);
  localStorage.setItem('cf_feedbacks',        JSON.stringify(submittedFeedbacks));
  localStorage.setItem('cf_language',         selectedLanguage);
  localStorage.setItem('cf_local_engagement', JSON.stringify(localEngagementSessions));
}

function updateTopbarPoints() {
  totalPoints = easyPoints + mediumPoints + hardPoints;
  const el = document.getElementById('topbarPoints');
  if (el) el.textContent = totalPoints;
}

// ============================================================
// POINTS — separate per difficulty
// ============================================================
function addPoints(pts, difficulty, reason) {
  if (difficulty === 'easy')        easyPoints   += pts;
  else if (difficulty === 'medium') mediumPoints += pts;
  else if (difficulty === 'hard')   hardPoints   += pts;
  pointsHistory.unshift({ pts, difficulty, reason, at: new Date().toLocaleDateString() });
  updateTopbarPoints();
  saveStateToStorage();
  updateLevelsPage();
}

// ============================================================
// SAVED TOPICS
// ============================================================
function getSavedTopics() { return JSON.parse(localStorage.getItem('cf_saved_topics') || '[]'); }
function saveTopic() {
  const topic = document.getElementById('topicInput').value.trim();
  if (!topic) { showToast('Enter a topic first!', 'error'); return; }
  const topics = getSavedTopics();
  if (topics.find(t => t.name.toLowerCase() === topic.toLowerCase())) { showToast('Already saved!', 'info'); return; }
  topics.unshift({ name: topic, savedAt: new Date().toLocaleDateString() });
  localStorage.setItem('cf_saved_topics', JSON.stringify(topics));
  renderSavedTopicsBar();
  showToast('Topic saved!', 'success');
}
function deleteSavedTopic(name) {
  localStorage.setItem('cf_saved_topics', JSON.stringify(getSavedTopics().filter(t => t.name !== name)));
  renderSavedTopicsBar(); renderSavedTopicsGrid();
}
function loadSavedTopic(name) {
  document.getElementById('topicInput').value = name;
  showSection('written'); generateCourse();
}
function renderSavedTopicsBar() {
  const bar = document.getElementById('savedTopicsBar');
  if (!bar) return;
  const topics = getSavedTopics().slice(0, 5);
  if (!topics.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = '<span style="font-size:0.72rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.08em;">Recent:</span>';
  topics.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'saved-topic-chip';
    chip.innerHTML = `<span onclick="loadSavedTopic('${escHtml(t.name)}')">${escHtml(t.name)}</span><span class="chip-delete" onclick="deleteSavedTopic('${escHtml(t.name)}')">×</span>`;
    bar.appendChild(chip);
  });
}
function renderSavedTopicsGrid() {
  const grid = document.getElementById('savedTopicsGrid');
  if (!grid) return;
  const topics = getSavedTopics();
  if (!topics.length) { grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🔖</div><div class="empty-title">No saved topics yet</div></div>'; return; }
  grid.innerHTML = topics.map(t => `
    <div class="saved-topic-card">
      <div class="stc-name">${escHtml(t.name)}</div>
      <div class="stc-date">${escHtml(t.savedAt)}</div>
      <div class="stc-actions">
        <button class="btn-primary" onclick="loadSavedTopic('${escHtml(t.name)}')">Generate</button>
        <button class="btn-outline" onclick="deleteSavedTopic('${escHtml(t.name)}')">Delete</button>
      </div>
    </div>`).join('');
}

// ============================================================
// GENERATE COURSE
// ============================================================
async function generateCourse() {
  const topic = document.getElementById('topicInput').value.trim();
  if (!topic) { showToast('Enter a topic first!', 'error'); return; }
  const btn = document.getElementById('generateBtn');
  btn.disabled = true; btn.textContent = 'Generating...';
  const output = document.getElementById('courseOutput');
  output.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-title">Generating your course...</div><div class="empty-desc">This usually takes 10–20 seconds</div></div>`;
  try {
    const res  = await fetch(`${API_BASE}/generate`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({topic, language: selectedLanguage}) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Generation failed');
    currentCourse     = data.course;
    currentCourseId   = data.course_id;
    currentTopic      = topic;
    currentShareToken = data.share_token;
    renderCourse(data.course);
    showToast('Course generated! 🎉', 'success');
  } catch(e) {
    output.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Error</div><div class="empty-desc">${escHtml(e.message)}</div></div>`;
    showToast('Error: ' + e.message, 'error');
  } finally { btn.disabled = false; btn.textContent = 'Generate →'; }
}

function renderCourse(course) {
  const shareBtn = currentShareToken ? `<button class="btn-share" onclick="shareCourseLink()">🔗 Share Link</button>` : '';
  document.getElementById('courseOutput').innerHTML = `
    <div class="course-header-card">
      <div>
        <div class="course-title">${escHtml(course.course_title)}</div>
        <div class="course-desc">${escHtml(course.description)}</div>
        <div class="course-meta">
          <span class="course-meta-item">📚 ${course.modules?.length || 0} modules</span>
          <span class="course-meta-item">⏱️ ${escHtml(course.estimated_duration)}</span>
          <span class="course-meta-item">🌐 ${escHtml(selectedLanguage)}</span>
        </div>
      </div>
      <div class="course-share-btns">
        <button class="btn-share" onclick="downloadCoursePDF()">📄 Export PDF</button>
        ${shareBtn}
      </div>
    </div>
    <div class="modules-grid" id="modulesGrid">${(course.modules||[]).map(m => renderModuleCard(m)).join('')}</div>`;
  generateModuleImages(course);
}

// ============================================================
// MODULE IMAGES — Cloudflare Workers AI via the Flask backend
// ============================================================
const moduleImageCache = {};      // kept in memory only (not saved to DB / localStorage)
let   imageRunId       = 0;       // lets a newer render cancel an older image run

function moduleImageKey(m) { return `${currentTopic}_${m.id}_${m.title}`; }

async function generateModuleImages(course) {
  const runId = ++imageRunId;
  for (const m of (course.modules || [])) {
    if (runId !== imageRunId) return;                         // a newer course was rendered
    if (m.image_url || moduleImageCache[moduleImageKey(m)]) continue;
    try {
      const prompt = `A clean, modern educational illustration for a lesson titled "${m.title}" in a course about ${currentTopic}. The lesson teaches: ${(m.learning_objectives && m.learning_objectives[0]) || m.title}. Show the key idea as one clear visual metaphor, with a simple central subject and a few related objects around it. Flat vector style, smooth gradients, a harmonious color palette with a soft light background, balanced wide composition, lots of clean space, professional e-learning artwork, no text, no letters, no logos`;
      const res  = await fetch(`${API_BASE}/generate-module-image`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt}) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Image generation failed');
      if (runId !== imageRunId) return;
      moduleImageCache[moduleImageKey(m)] = data.image;
      const slot = document.getElementById(`module_img_${m.id}`);
      if (slot) {
        const el = document.createElement('img');
        el.className = 'module-image';
        el.id        = `module_img_${m.id}`;
        el.alt       = m.title;
        el.src       = data.image;
        slot.replaceWith(el);
      }
    } catch (e) {
      console.warn('Image generation failed for module', m.id, e);  // keep the placeholder; try the next module
    }
  }
}

function renderModuleCard(m) {
  const completed = moduleCompleted[`${currentTopic}_${m.id}`];
  const cachedImg = m.image_url || moduleImageCache[moduleImageKey(m)];
  const imgHtml   = cachedImg
    ? `<img class="module-image" id="module_img_${m.id}" src="${escHtml(cachedImg)}" alt="${escHtml(m.title)}" onerror="this.style.display='none'" loading="lazy"/>`
    : `<div class="module-image-placeholder" id="module_img_${m.id}">📚</div>`;
  return `
    <div class="module-card" id="module_${m.id}">
      <div class="module-header" onclick="toggleModule(${m.id})">
        <div class="module-number">${m.id}</div>
        <div class="module-icon">${escHtml(m.icon)}</div>
        <div class="module-title-wrap">
          <div class="module-title">${escHtml(m.title)}</div>
          <div class="module-meta">${escHtml(m.duration)} · ${escHtml(m.difficulty)}${completed ? ' · <span class="module-completed-badge">✓ Done</span>' : ''}</div>
        </div>
        <div class="module-expand-icon">▼</div>
      </div>
      <div class="module-body">
        ${imgHtml}
        <div class="module-objectives">
          <h4>Learning Objectives</h4>
          <ul>${(m.learning_objectives||[]).map(o => `<li>${escHtml(o)}</li>`).join('')}</ul>
        </div>
        <div class="module-content" id="content-${m.id}">${escHtml(m.content).replace(/\n/g,'<br>')}</div>
        <div class="module-takeaways">
          <h4>Key Takeaways</h4>
          <ul>${(m.key_takeaways||[]).map(t => `<li>${escHtml(t)}</li>`).join('')}</ul>
        </div>
        <textarea class="notes-textarea" id="notes-${m.id}" placeholder="Take notes here...">${localStorage.getItem(`cf_note_${currentTopic}_${m.id}`) || ''}</textarea>
        <div class="module-actions">
          <button class="btn-primary" onclick="openQuiz(${m.id})">🎯 Take Quiz</button>
          <button class="btn-outline" onclick="saveNote(${m.id})">💾 Save Note</button>
          <button class="btn-outline" onclick="markModuleDone(${m.id})">✓ Mark Done</button>
          <button class="btn-outline" id="tts-btn-${m.id}" onclick="toggleTTS(${m.id})">🔊 Read Aloud</button>
          <button class="btn-outline" id="tts-pause-btn-${m.id}" onclick="pauseTTS()" style="display:none">⏸ Pause</button>
        </div>
      </div>
    </div>`;
}

function toggleModule(id) {
  const card = document.getElementById(`module_${id}`);
  if (!card) return;
  const isOpen = card.classList.contains('open');
  document.querySelectorAll('.module-card').forEach(c => c.classList.remove('open'));
  if (!isOpen) card.classList.add('open');
}

function markModuleDone(moduleId) {
  moduleCompleted[`${currentTopic}_${moduleId}`] = true;
  localStorage.setItem('cf_module_completed', JSON.stringify(moduleCompleted));
  showToast('Module marked complete! ✓', 'success');
  if (currentCourse) renderCourse(currentCourse);
}

// ============================================================
// NOTES
// ============================================================
function saveNote(moduleId) {
  const text = document.getElementById(`notes-${moduleId}`)?.value || '';
  localStorage.setItem(`cf_note_${currentTopic}_${moduleId}`, text);
  showToast('📝 Notes saved!', 'success');
}

function renderSavedNotesGrid() {
  const grid = document.getElementById('savedNotesGrid');
  if (!grid) return;
  const notes = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('cf_note_')) {
      const val = localStorage.getItem(key);
      if (val?.trim()) {
        const parts = key.replace('cf_note_', '').split('_');
        const moduleId = parts.pop();
        const topic    = parts.join('_');
        notes.push({ topic, moduleId, content: val });
      }
    }
  }
  if (!notes.length) { grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🗒️</div><div class="empty-title">No saved notes</div></div>'; return; }
  grid.innerHTML = notes.map(n => `
    <div class="saved-note-card">
      <div class="snc-module">Module ${escHtml(n.moduleId)}</div>
      <div class="snc-topic">${escHtml(n.topic)}</div>
      <div class="snc-content">${escHtml(n.content)}</div>
    </div>`).join('');
}

// ============================================================
// TTS — with Pause
// ============================================================
function toggleTTS(moduleId) {
  const content  = document.getElementById(`content-${moduleId}`);
  if (!content) return;
  const btn      = document.getElementById(`tts-btn-${moduleId}`);
  const pauseBtn = document.getElementById(`tts-pause-btn-${moduleId}`);

  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (btn) { btn.classList.remove('speaking'); btn.textContent = '🔊 Read Aloud'; }
    if (pauseBtn) pauseBtn.style.display = 'none';
    return;
  }

  ttsUtterance      = new SpeechSynthesisUtterance(content.innerText);
  ttsUtterance.rate = 0.95;
  ttsUtterance.onstart = () => {
    if (btn)      { btn.classList.add('speaking'); btn.textContent = '🔊 Speaking...'; }
    if (pauseBtn) pauseBtn.style.display = 'inline-flex';
  };
  ttsUtterance.onend = ttsUtterance.onerror = () => {
    if (btn)      { btn.classList.remove('speaking'); btn.textContent = '🔊 Read Aloud'; }
    if (pauseBtn) pauseBtn.style.display = 'none';
  };
  window.speechSynthesis.speak(ttsUtterance);
}

function pauseTTS() {
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
    document.querySelectorAll('[id^="tts-pause-btn-"]').forEach(b => b.textContent = '⏸ Pause');
  } else {
    window.speechSynthesis.pause();
    document.querySelectorAll('[id^="tts-pause-btn-"]').forEach(b => b.textContent = '▶ Resume');
  }
}

function stopTTS(moduleId) {
  window.speechSynthesis.cancel();
  if (moduleId) {
    const btn = document.getElementById(`tts-btn-${moduleId}`);
    if (btn) { btn.classList.remove('speaking'); btn.textContent = '🔊 Read Aloud'; }
    const pauseBtn = document.getElementById(`tts-pause-btn-${moduleId}`);
    if (pauseBtn) pauseBtn.style.display = 'none';
  }
}

// ============================================================
// QUIZ — with level locking and correct points per difficulty
// ============================================================
let activeQuizModuleId = null;

function openQuiz(moduleId) {
  activeQuizModuleId = moduleId;
  const mod = currentCourse?.modules.find(m => m.id === moduleId);
  if (!mod) return;
  const difficulties = ['easy', 'medium', 'hard'];
  const randomDiff = difficulties[Math.floor(Math.random() * difficulties.length)];
  document.getElementById('quizModalTitle').textContent = `📝 Quiz — ${mod.title}`;
  document.getElementById('quizModal').classList.add('open');
  startQuiz(moduleId, randomDiff);
}

function openVideoQuiz() {
  if (!vcCurrentQuiz) return;
  const difficulties = ['easy', 'medium', 'hard'];
  const randomDiff = difficulties[Math.floor(Math.random() * difficulties.length)];
  document.getElementById('quizModalTitle').textContent = `🎬 Video Quiz`;
  document.getElementById('quizModal').classList.add('open');
  startVideoQuiz(randomDiff);
}

function closeQuiz() {
  document.getElementById('quizModal').classList.remove('open');
  if (activeQuizModuleId) stopTTS(activeQuizModuleId);
}

function renderLevelSelector(mod) {
  const body = document.getElementById('quizModalBody');
  body.innerHTML = `
    <p style="color:var(--text-2);margin-bottom:18px;font-size:0.9rem;">Select difficulty. Earn points for correct answers!</p>
    <div class="level-selector">
      <button class="level-btn easy-btn" onclick="startQuiz(${mod.id},'easy')">
        <span class="lock-icon">🟢</span>
        Easy
        <span class="pts-needed">+5 pts each</span>
      </button>
      <button class="level-btn medium-btn" onclick="startQuiz(${mod.id},'medium')">
        <span class="lock-icon">🟡</span>
        Medium
        <span class="pts-needed">+10 pts each</span>
      </button>
      <button class="level-btn hard-btn" onclick="startQuiz(${mod.id},'hard')">
        <span class="lock-icon">🔴</span>
        Hard
        <span class="pts-needed">+15 pts each</span>
      </button>
    </div>`;
}

function renderVideoLevelSelector() {
  const body = document.getElementById('quizModalBody');
  body.innerHTML = `
    <p style="color:var(--text-2);margin-bottom:18px;font-size:0.9rem;">Select difficulty for video quiz:</p>
    <div class="level-selector">
      <button class="level-btn easy-btn" onclick="startVideoQuiz('easy')">
        <span class="lock-icon">🟢</span>Easy
        <span class="pts-needed">+5 pts each</span>
      </button>
      <button class="level-btn medium-btn" onclick="startVideoQuiz('medium')">
        <span class="lock-icon">🟡</span>Medium
        <span class="pts-needed">+10 pts each</span>
      </button>
      <button class="level-btn hard-btn" onclick="startVideoQuiz('hard')">
        <span class="lock-icon">🔴</span>Hard
        <span class="pts-needed">+15 pts each</span>
      </button>
    </div>`;
}

async function startQuiz(moduleId, difficulty) {
  const mod = currentCourse?.modules.find(m => m.id === moduleId);
  if (!mod) return;
  const diffEmoji = difficulty === 'easy' ? '🟢' : difficulty === 'medium' ? '🟡' : '🔴';
  showToast(`${diffEmoji} ${difficulty.charAt(0).toUpperCase()+difficulty.slice(1)} difficulty selected!`, 'info');
  document.getElementById('quizModalBody').innerHTML = `
    <div class="quiz-loading"><div class="quiz-spinner"></div>
    <p>🤖 Generating ${difficulty} questions for "${mod.title}"...</p></div>`;
  try {
    const res  = await fetch(`${API_BASE}/generate-quiz`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ topic: currentTopic, module_title: mod.title, module_content: mod.content, difficulty })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Quiz generation failed');
    quizState = { questions: data.quiz, currentQ: 0, score: 0, answered: false, difficulty, moduleId, quizStreak: 0, isVideo: false };
    renderQuestion();
  } catch(err) {
    document.getElementById('quizModalBody').innerHTML = `<p style="color:var(--hard);text-align:center;padding:40px;">❌ ${err.message}</p>`;
  }
}

async function startVideoQuiz(difficulty) {
  if (!vcCurrentQuiz) return;
  const diffEmoji = difficulty === 'easy' ? '🟢' : difficulty === 'medium' ? '🟡' : '🔴';
  showToast(`${diffEmoji} ${difficulty.charAt(0).toUpperCase()+difficulty.slice(1)} difficulty selected!`, 'info');
  document.getElementById('quizModalBody').innerHTML = `
    <div class="quiz-loading"><div class="quiz-spinner"></div>
    <p>🤖 Generating ${difficulty} questions...</p></div>`;
  const transcriptEl = document.getElementById('vcTranscriptText');
  const transcriptContent = transcriptEl ? transcriptEl.innerText : '';
  try {
    const res  = await fetch(`${API_BASE}/generate-quiz`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ topic: vcCurrentTopic, module_title: vcCurrentTopic, module_content: transcriptContent, difficulty })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Quiz generation failed');
    quizState = { questions: data.quiz, currentQ: 0, score: 0, answered: false, difficulty, moduleId: null, quizStreak: 0, isVideo: true };
    renderQuestion();
  } catch(err) {
    document.getElementById('quizModalBody').innerHTML = `<p style="color:var(--hard);text-align:center;padding:40px;">❌ ${err.message}</p>`;
  }
}

function renderQuestion() {
  const { questions, currentQ, score } = quizState;
  if (currentQ >= questions.length) { renderQuizResults(); return; }
  const q    = questions[currentQ];
  const diff = q.detected_difficulty || quizState.difficulty || 'easy';
  const ptsPerQ = quizState.difficulty === 'easy' ? 5 : quizState.difficulty === 'medium' ? 10 : 15;
  quizState.answered = false;
  document.getElementById('quizModalBody').innerHTML = `
    <div class="quiz-question-block">
      <div class="quiz-question-header">
        <span class="quiz-question-num">Question ${currentQ+1} of ${questions.length}</span>
        <span class="quiz-score-live">⭐ ${score} pts</span>
      </div>
      <div class="difficulty-badge ${diff}">Difficulty: ${diff.toUpperCase()} · +${ptsPerQ}pts if correct</div>
      <div class="quiz-question-text">${escHtml(q.question)}</div>
      <div class="quiz-options" id="quizOptions">
        ${Object.entries(q.options||{}).map(([key, val]) => `
          <button class="quiz-option" onclick="selectAnswer('${key}','${q.correct}')" data-key="${key}">
            <span class="option-key">${key}</span>
            <span>${escHtml(val)}</span>
          </button>`).join('')}
      </div>
      <div id="quizExplanation"></div>
    </div>
    <div class="quiz-nav">
      <span style="color:var(--text-3);font-size:0.8rem;">No negative marking 🎉</span>
      <button class="btn-quiz-next" id="nextBtn" onclick="nextQuestion()" style="display:none;">
        ${currentQ+1 === questions.length ? '🏁 See Results' : 'Next →'}
      </button>
    </div>`;
}

function selectAnswer(selected, correct) {
  if (quizState.answered) return;
  quizState.answered = true;
  document.querySelectorAll('.quiz-option').forEach(btn => {
    btn.classList.add('answered');
    if (btn.dataset.key === correct)                       btn.classList.add('correct');
    if (btn.dataset.key === selected && selected !== correct) btn.classList.add('wrong');
  });
  const isCorrect = selected === correct;
  const diff      = quizState.difficulty;
  const ptsPerQ   = diff === 'easy' ? 5 : diff === 'medium' ? 10 : 15;
  if (isCorrect) {
    quizState.score += ptsPerQ;
    quizState.quizStreak = (quizState.quizStreak || 0) + 1;
    showToast(`✅ Correct! +${ptsPerQ} pts`, 'success');
  } else {
    quizState.quizStreak = 0;
    showToast('❌ Wrong answer', 'error');
  }
  const q = quizState.questions[quizState.currentQ];
  document.getElementById('quizExplanation').innerHTML = `
    <div class="quiz-explanation">💡 <strong>Explanation:</strong> ${escHtml(q.explanation)}</div>`;
  document.getElementById('nextBtn').style.display = 'block';
}

function nextQuestion() { quizState.currentQ++; renderQuestion(); }

function renderQuizResults() {
  const { score, questions, difficulty } = quizState;
  const ptsPerQ   = difficulty === 'easy' ? 5 : difficulty === 'medium' ? 10 : 15;
  const maxScore  = questions.length * ptsPerQ;
  const pct       = Math.round((score / maxScore) * 100);
  quizzesTaken++;
  addPoints(score, difficulty, `Quiz: ${difficulty} (${pct}%)`);
  saveStateToStorage();
  updateLevelsPage();
  const msg = pct === 100 ? '🎉 Perfect Score!' : pct >= 80 ? '🌟 Excellent!' : pct >= 60 ? '👍 Good job!' : pct >= 40 ? '📚 Keep going!' : '💪 Practice more!';
  document.getElementById('quizModalBody').innerHTML = `
    <div class="quiz-results">
      <div class="result-score-circle">
        <div class="result-score-num">${score}</div>
        <div class="result-score-total">/ ${maxScore} pts</div>
      </div>
      <div class="result-title">${msg}</div>
      <div class="result-message">${pct}% correct · ${difficulty.toUpperCase()} · +${ptsPerQ}pts per correct answer</div>
      <div class="result-badges">
        <span class="result-badge" style="color:var(--green);border-color:var(--green);">📊 ${pct}%</span>
        <span class="result-badge" style="color:var(--teal);border-color:var(--teal);">⭐ +${score} pts</span>
      </div>
      <button class="btn-primary" onclick="closeQuiz()" style="margin:0 auto;">✓ Done</button>
    </div>`;
}

function renderQuizCenter() {
  const el = document.getElementById('quizCenterOutput');
  if (!el) return;
  if (!currentCourse) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">🎯</div><div class="empty-title">Generate a course first</div></div>'; return; }
  el.innerHTML = `<div class="modules-grid">${currentCourse.modules.map(m => `
    <div class="module-card">
      <div class="module-header" style="cursor:default">
        <div class="module-number">${m.id}</div>
        <div class="module-icon">${escHtml(m.icon)}</div>
        <div class="module-title-wrap"><div class="module-title">${escHtml(m.title)}</div></div>
        <button class="btn-primary" onclick="openQuiz(${m.id})">Start Quiz</button>
      </div>
    </div>`).join('')}</div>`;
}

// ============================================================
// LEVELS — independent per difficulty
// ============================================================
function updateLevelsPage() {
  // Easy
  const easyPct  = Math.min((easyPoints   / EASY_COMPLETE)   * 100, 100);
  const medPct   = Math.min((mediumPoints / MEDIUM_COMPLETE) * 100, 100);
  const hardPct  = Math.min((hardPoints   / HARD_COMPLETE)   * 100, 100);

  const easyFill  = document.getElementById('easyFill');
  const medFill   = document.getElementById('mediumFill');
  const hardFill  = document.getElementById('hardFill');
  const easyStat  = document.getElementById('easyStatus');
  const medStatus = document.getElementById('mediumStatus');
  const hardStatus= document.getElementById('hardStatus');
  const easyPts   = document.getElementById('easyPtsDisplay');
  const medPts    = document.getElementById('mediumPtsDisplay');
  const hardPts   = document.getElementById('hardPtsDisplay');

  if (easyFill)  easyFill.style.width  = easyPct + '%';
  if (medFill)   medFill.style.width   = medPct  + '%';
  if (hardFill)  hardFill.style.width  = hardPct + '%';

  if (easyPts)  easyPts.textContent   = `${easyPoints} / ${EASY_COMPLETE} pts`;
  if (medPts)   medPts.textContent    = `${mediumPoints} / ${MEDIUM_COMPLETE} pts`;
  if (hardPts)  hardPts.textContent   = `${hardPoints} / ${HARD_COMPLETE} pts`;

  if (easyStat) {
    if (easyPoints >= EASY_COMPLETE)      { easyStat.textContent = '✓ Completed';  easyStat.className = 'level-card-status completed'; }
    else                                  { easyStat.textContent = '🔓 Unlocked';  easyStat.className = 'level-card-status unlocked'; }
  }
  if (medStatus) {
    if (mediumPoints >= MEDIUM_COMPLETE)  { medStatus.textContent = '✓ Completed'; medStatus.className = 'level-card-status completed'; }
    else                                  { medStatus.textContent = '🔓 Unlocked'; medStatus.className = 'level-card-status unlocked'; }
  }
  if (hardStatus) {
    if (hardPoints >= HARD_COMPLETE)      { hardStatus.textContent = '✓ Completed'; hardStatus.className = 'level-card-status completed'; }
    else                                  { hardStatus.textContent = '🔓 Unlocked'; hardStatus.className = 'level-card-status unlocked'; }
  }
}

function updatePointsPage() {
  const el = document.getElementById('pointsOutput');
  if (!el) return;
  el.innerHTML = `
    <div class="points-summary">
      <div class="points-stat"><div class="ps-label">Total Points</div><div class="ps-value">${totalPoints}</div></div>
      <div class="points-stat"><div class="ps-label">Easy Points</div><div class="ps-value" style="color:var(--easy)">${easyPoints}</div></div>
      <div class="points-stat"><div class="ps-label">Medium Points</div><div class="ps-value" style="color:var(--medium)">${mediumPoints}</div></div>
      <div class="points-stat"><div class="ps-label">Hard Points</div><div class="ps-value" style="color:var(--hard)">${hardPoints}</div></div>
      <div class="points-stat"><div class="ps-label">Quizzes Taken</div><div class="ps-value">${quizzesTaken}</div></div>
    </div>
    <div class="points-history">${pointsHistory.slice(0,20).map(p => `
      <div class="ph-item">
        <span>${escHtml(p.reason)}</span>
        <span class="ph-pts difficulty-${escHtml(p.difficulty||'easy')}">+${p.pts} pts</span>
      </div>`).join('') || '<div class="empty-state"><div class="empty-icon">⭐</div><div class="empty-title">No points yet</div></div>'}</div>`;
}

// ============================================================
// FEEDBACK
// ============================================================
function setRating(val) {
  feedbackRating = val;
  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.val) <= val);
  });
}

async function submitFeedback(event) {
  if (event) event.preventDefault();
  const name    = document.getElementById('fbName').value.trim() || 'Anonymous';
  const email   = document.getElementById('fbEmail').value.trim();
  const topic   = document.getElementById('fbTopic').value.trim();
  const message = document.getElementById('fbMessage').value.trim();
  if (!message) { showToast('⚠️ Please write a message!', 'error'); return; }
  try {
    const res  = await fetch(`${API_BASE}/submit-feedback`, {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({ name, email, topic, message, rating: feedbackRating })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    submittedFeedbacks.unshift({ name, email, topic, message, rating: feedbackRating, date: new Date().toLocaleDateString(), sentiment: data.sentiment });
    localStorage.setItem('cf_feedbacks', JSON.stringify(submittedFeedbacks));
    document.getElementById('feedbackForm').style.display    = 'none';
    document.getElementById('feedbackSuccess').style.display = 'block';
    const sr = document.getElementById('sentimentResult');
    sr.className   = `sentiment-result ${data.sentiment}`;
    const emoji    = data.sentiment === 'Positive' ? '😊' : data.sentiment === 'Negative' ? '😞' : '😐';
    sr.textContent = `${emoji} Sentiment: ${data.sentiment} (${data.confidence}% confidence)`;
    showToast('🎉 Feedback submitted!', 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

function resetFeedback() {
  document.getElementById('feedbackForm').style.display    = 'block';
  document.getElementById('feedbackSuccess').style.display = 'none';
  document.getElementById('fbName').value    = '';
  document.getElementById('fbEmail').value   = '';
  document.getElementById('fbTopic').value   = '';
  document.getElementById('fbMessage').value = '';
  feedbackRating = 5; setRating(5);
}

async function loadFeedbackHistory() {
  const grid = document.getElementById('feedbackHistoryGrid');
  if (!grid) return;
  if (!currentUser) {
    grid.innerHTML = submittedFeedbacks.length
      ? submittedFeedbacks.map(f => `
          <div class="feedback-history-card">
            <div class="fhc-header"><div class="fhc-name">${escHtml(f.name)}</div><div class="fhc-date">${escHtml(f.date)}</div></div>
            <div class="fhc-message">${escHtml(f.message)}</div>
            ${f.sentiment ? `<span class="fhc-sentiment ${f.sentiment}">${f.sentiment}</span>` : ''}
          </div>`).join('')
      : '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No submissions yet</div></div>';
    return;
  }
  try {
    const res  = await fetch(`${API_BASE}/get-feedback`, { credentials:'include' });
    const data = await res.json();
    if (!data.success) throw new Error();
    grid.innerHTML = data.feedbacks.length
      ? data.feedbacks.map(f => `
          <div class="feedback-history-card">
            <div class="fhc-header"><div class="fhc-name">${escHtml(f.name)}</div><div class="fhc-date">${escHtml((f.created_at||'').split('T')[0])}</div></div>
            <div class="fhc-message">${escHtml(f.message)}</div>
            <span class="fhc-sentiment ${f.sentiment}">${escHtml(f.sentiment)}</span>
          </div>`).join('')
      : '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No submissions yet</div></div>';
  } catch(e) { grid.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Error loading feedback</div></div>'; }
}

// ============================================================
// MY COURSES
// ============================================================
async function loadMyCourses() {
  const grid = document.getElementById('myCoursesGrid');
  if (!grid) return;
  if (!currentUser) { grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-title">Log in to see saved courses</div></div>'; return; }
  try {
    const res  = await fetch(`${API_BASE}/api/my-courses`, { credentials:'include' });
    const data = await res.json();
    if (!data.success) throw new Error();
    grid.innerHTML = data.courses.length
      ? `<div class="saved-topics-grid">${data.courses.map(c => `
          <div class="my-course-card">
            <div class="mcc-topic">${escHtml(c.topic)}</div>
            <div class="mcc-date">${escHtml((c.created_at||'').split('T')[0])}</div>
            <div class="mcc-actions">
              <button class="btn-share" onclick="copyShareLink('${escHtml(c.share_token)}')">🔗 Share</button>
            </div>
          </div>`).join('')}</div>`
      : '<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-title">No courses saved yet</div></div>';
  } catch(e) { grid.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Error</div></div>'; }
}

// ============================================================
// SHARING & PDF
// ============================================================
function shareCourseLink() {
  if (!currentShareToken) { showToast('Log in to share courses', 'info'); return; }
  copyShareLink(currentShareToken);
}
function copyShareLink(token) {
  const url = `${window.location.origin}/shared/${token}`;
  navigator.clipboard.writeText(url).then(() => showToast('Share link copied!', 'success')).catch(() => showToast('Copy failed', 'error'));
}
async function loadSharedCourse(token) {
  try {
    const res  = await fetch(`${API_BASE}/api/shared/${token}`);
    const data = await res.json();
    if (!data.success) return;
    currentCourse = data.course; currentTopic = data.topic;
    document.getElementById('topicInput').value = data.topic;
    hideLanding(); showSection('written'); renderCourse(data.course);
    showToast('Shared course loaded!', 'info');
  } catch(e) {}
}
function getSharedTokenFromUrl() {
  const m = window.location.pathname.match(/\/shared\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}
async function downloadCoursePDF() {
  if (!currentCourse) { showToast('No course to export', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 20;
  doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text(currentCourse.course_title, 20, y); y += 10;
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  const descLines = doc.splitTextToSize(currentCourse.description, 170);
  doc.text(descLines, 20, y); y += descLines.length * 6 + 8;
  currentCourse.modules?.forEach(m => {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFontSize(13); doc.setFont('helvetica','bold');
    doc.text(`Module ${m.id}: ${m.title}`, 20, y); y += 7;
    doc.setFontSize(10); doc.setFont('helvetica','normal');
    const lines = doc.splitTextToSize(m.content.substring(0,500), 170);
    lines.forEach(line => { if (y > 270) { doc.addPage(); y = 20; } doc.text(line, 20, y); y += 5; });
    y += 6;
  });
  doc.save(`${currentTopic.replace(/\s+/g,'_')}_course.pdf`);
  showToast('PDF downloaded!', 'success');
}

// ============================================================
// VIDEO COURSE — transcript first, then quiz
// ============================================================
async function searchYouTube() {
  const query = document.getElementById('vcSearchInput').value.trim();
  if (!query) { showToast('Enter a search query', 'error'); return; }
  const grid = document.getElementById('vcVideoGrid');
  grid.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-title">Searching...</div></div>';
  try {
    const res  = await fetch(`${API_BASE}/search-youtube`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({query}) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Search failed');
    grid.innerHTML = data.videos.map(v => `
      <div class="vc-video-card" id="vc_${escHtml(v.id)}" onclick="selectVideo('${escHtml(v.id)}','${escHtml(v.title.replace(/'/g,"\\'"))}','${escHtml(v.thumbnail)}','${escHtml(v.channel)}')">
        <img src="${escHtml(v.thumbnail)}" alt="${escHtml(v.title)}" loading="lazy"/>
        <div class="vc-video-card-info">
          <div class="vc-video-card-title">${escHtml(v.title)}</div>
          <div class="vc-video-card-channel">${escHtml(v.channel)}</div>
        </div>
      </div>`).join('');
  } catch(e) { grid.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">${escHtml(e.message)}</div></div>`; }
}

function selectVideo(id, title, thumb, channel) {
  vcSelectedVideoId    = id;
  vcSelectedVideoTitle = title;
  vcCurrentTopic       = title;
  document.querySelectorAll('.vc-video-card').forEach(c => c.classList.remove('selected'));
  document.getElementById(`vc_${id}`)?.classList.add('selected');
  document.getElementById('vcSelectedPanel').style.display   = 'block';
  document.getElementById('vcSelectedThumb').src             = thumb;
  document.getElementById('vcSelectedTitle').textContent     = title;
  document.getElementById('vcSelectedChannel').textContent   = channel;
  document.getElementById('vcResultPanel').style.display     = 'none';
  [1,2,3,4].forEach(n => setVcStep(n, ''));
  document.getElementById('vcStatusMsg').textContent = '';
}

function setVcStep(n, status) {
  const el = document.getElementById(`vcStep${n}`);
  if (!el) return;
  el.classList.remove('active','done');
  if (status === 'active') el.classList.add('active');
  if (status === 'done')   el.classList.add('done');
}

async function generateVideoContent() {
  if (!vcSelectedVideoId) { showToast('Select a video first', 'error'); return; }
  const btn       = document.getElementById('vcGenerateBtn');
  const statusMsg = document.getElementById('vcStatusMsg');
  btn.disabled    = true; btn.textContent = 'Processing...';
  [1,2,3,4].forEach(n => setVcStep(n,''));

  const steps = [
    { step:1, msg:'Fetching video captions...', delay:0 },
    { step:2, msg:'Preparing transcript...', delay:1500 },
    { step:3, msg:'Running RAG search...', delay:3000 },
    { step:4, msg:'Generating quiz with Groq...', delay:5000 },
  ];
  steps.forEach(({ step, msg, delay }) => {
    const t = setTimeout(() => { setVcStep(step,'active'); statusMsg.textContent = msg; }, delay);
    vcStepTimers.push(t);
  });

  try {
    const res  = await fetch(`${API_BASE}/generate-video-quiz`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ video_id: vcSelectedVideoId, video_title: vcSelectedVideoTitle, difficulty: 'easy' })
    });
    const data = await res.json();
    vcStepTimers.forEach(clearTimeout);
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
    [1,2,3,4].forEach(n => setVcStep(n,'done'));
    statusMsg.textContent = '✅ Done!';

    vcCurrentQuiz       = data.quiz;
    vcCurrentTopic      = vcSelectedVideoTitle;
    vcCurrentDifficulty = data.difficulty;

    // Show transcript first, then quiz button
    renderVideoResult(data.transcript, data.quiz);

  } catch(e) {
    vcStepTimers.forEach(clearTimeout);
    [1,2,3,4].forEach(n => setVcStep(n,''));
    showToast('Error: ' + e.message, 'error');
    statusMsg.textContent = '❌ ' + e.message;
  } finally {
    btn.disabled    = false;
    btn.textContent = '🚀 Generate Transcript + Quiz';
  }
}

function renderVideoResult(transcript, quiz) {
  const panel = document.getElementById('vcResultPanel');
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="vc-result-section">
      <h3 class="vc-result-heading">🎬 Watch Video</h3>
      <div class="vc-iframe-wrapper">
        <iframe
          src="https://www.youtube.com/embed/${escHtml(vcSelectedVideoId)}?rel=0&modestbranding=1"
          title="${escHtml(vcSelectedVideoTitle)}"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          class="vc-youtube-iframe">
        </iframe>
      </div>
    </div>
    <div class="vc-result-section">
      <h3 class="vc-result-heading">📄 What the course says?</h3>
      <div class="vc-transcript-box">
        <div class="vc-transcript-text" id="vcTranscriptText">${escHtml(transcript)}</div>
      </div>
      <div class="vc-transcript-actions">
        <textarea class="notes-textarea" id="vc-notes" placeholder="Take notes about this video..."></textarea>
        <div class="module-actions" style="margin-top:10px">
          <button class="btn-outline" onclick="saveVideoNote()">💾 Save Note</button>
          <button class="btn-outline" id="vc-tts-btn" onclick="toggleVideoTTS()">🔊 Read Aloud</button>
          <button class="btn-outline" id="vc-pause-btn" onclick="pauseTTS()" style="display:none">⏸ Pause</button>
          <button class="btn-outline" onclick="downloadVideoTranscriptPDF()">📄 Export PDF</button>
        </div>
      </div>
    </div>
    <div class="vc-quiz-section" style="margin-top:24px">
      <h3 class="vc-result-heading">🎯 Take Quiz on this Video</h3>
      <p style="color:var(--text-3);font-size:0.85rem;margin-bottom:16px">Select difficulty level to start the quiz</p>
      <button class="btn-primary" onclick="openVideoQuiz()">🎯 Start Quiz</button>
    </div>`;
}

function loadFooterPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const box = event.target.closest('.footer-photo-box');
    box.style.backgroundImage = `url(${e.target.result})`;
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
    box.querySelector('.footer-photo-box-icon').style.display = 'none';
    box.querySelector('.footer-photo-box-text').style.display = 'none';
    box.querySelector('div:last-child').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function saveVideoNote() {
  const text = document.getElementById('vc-notes')?.value || '';
  if (!text.trim()) { showToast('Write something first!', 'error'); return; }
  localStorage.setItem(`cf_note_video_${vcCurrentTopic}`, text);
  showToast('📝 Video note saved!', 'success');
}

function downloadVideoTranscriptPDF() {
  const transcriptEl = document.getElementById('vcTranscriptText');
  if (!transcriptEl) { showToast('No transcript available', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 20;
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(`🎬 ${vcCurrentTopic}`, 170);
  doc.text(titleLines, 20, y); y += titleLines.length * 8 + 6;
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`YouTube Video Transcript — exported ${new Date().toLocaleDateString()}`, 20, y); y += 10;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  const transcript = transcriptEl.innerText || '';
  const lines = doc.splitTextToSize(transcript, 170);
  lines.forEach(line => {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(line, 20, y); y += 5;
  });
  const filename = (vcCurrentTopic || 'video').replace(/\s+/g, '_').substring(0, 50);
  doc.save(`${filename}_transcript.pdf`);
  showToast('📄 Transcript PDF downloaded!', 'success');
}

function toggleVideoTTS() {
  const content  = document.getElementById('vcTranscriptText');
  if (!content) return;
  const btn      = document.getElementById('vc-tts-btn');
  const pauseBtn = document.getElementById('vc-pause-btn');
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (btn) btn.textContent = '🔊 Read Aloud';
    if (pauseBtn) pauseBtn.style.display = 'none';
    return;
  }
  ttsUtterance      = new SpeechSynthesisUtterance(content.innerText);
  ttsUtterance.rate = 0.95;
  ttsUtterance.onstart = () => { if (btn) btn.textContent = '🔊 Speaking...'; if (pauseBtn) pauseBtn.style.display = 'inline-flex'; };
  ttsUtterance.onend = ttsUtterance.onerror = () => { if (btn) btn.textContent = '🔊 Read Aloud'; if (pauseBtn) pauseBtn.style.display = 'none'; };
  window.speechSynthesis.speak(ttsUtterance);
}

// ============================================================
// UPLOAD FILE — original vision model
// ============================================================
function uploadDragOver(e)  { e.preventDefault(); document.getElementById('uploadDropzone').classList.add('dragover'); }
function uploadDragLeave(e) { document.getElementById('uploadDropzone').classList.remove('dragover'); }
function uploadDrop(e) {
  e.preventDefault();
  document.getElementById('uploadDropzone').classList.remove('dragover');
  addUploadFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf'));
}
function handleFileSelect(e) { addUploadFiles(Array.from(e.target.files)); e.target.value = ''; }
function addUploadFiles(files) {
  if (!files.length) return;
  uploadedFiles = uploadedFiles.concat(files);
  renderUploadPreviews();
  showToast(`${files.length} file(s) added`, 'success');
}
function renderUploadPreviews() {
  const container = document.getElementById('uploadPreviews');
  const actions   = document.getElementById('uploadActions');
  const countEl   = document.getElementById('uploadFileCount');
  if (!uploadedFiles.length) { container.innerHTML = ''; actions.style.display = 'none'; return; }
  actions.style.display = 'flex';
  countEl.textContent   = `${uploadedFiles.length} file(s)`;
  container.innerHTML   = uploadedFiles.map((f,i) => {
    const isPdf = f.type === 'application/pdf';
    return `<div class="upload-preview-card">${isPdf ? '<div class="upload-preview-pdf">📄</div>' : `<img src="${URL.createObjectURL(f)}" alt="${escHtml(f.name)}"/>`}<div class="upload-preview-name">${escHtml(f.name)}</div><button class="upload-preview-remove" onclick="removeUploadFile(${i})">✕</button></div>`;
  }).join('');
}
function removeUploadFile(i) { uploadedFiles.splice(i,1); renderUploadPreviews(); }
function clearUploadFiles() { uploadedFiles = []; renderUploadPreviews(); showToast('Files cleared','info'); }
function clearUploadChat() {
  uploadChatHistory = [];
  document.getElementById('uploadChatMessages').innerHTML = `<div class="upload-chat-welcome" id="uploadChatWelcome"><div class="ucw-icon">🤖</div><div class="ucw-title">Upload files to get started</div><div class="ucw-desc">Ask anything about your uploaded content!</div></div>`;
  showToast('Chat cleared','info');
}

async function sendUploadMessage() {
  const input   = document.getElementById('uploadChatInput');
  const message = input.value.trim();
  if (!message) { showToast('Type a question first!', 'error'); return; }
  input.value   = '';
  const sendBtn = document.getElementById('uploadSendBtn');
  sendBtn.disabled = true;
  document.getElementById('uploadChatWelcome')?.remove();
  appendChatBubble('user', message);
  uploadChatHistory.push({role:'user',text:message});
  const typingId = 'typing_' + Date.now();
  appendChatBubble('assistant', '⏳ Thinking...', typingId);
  try {
    const formData = new FormData();
    formData.append('message', message);
    formData.append('history', JSON.stringify(uploadChatHistory.slice(0,-1)));
    uploadedFiles.forEach(f => formData.append('files[]', f));
    const res  = await fetch(`${API_BASE}/image-chat`, { method:'POST', body: formData });
    const data = await res.json();
    document.getElementById(typingId)?.remove();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
    appendChatBubble('assistant', data.answer);
    uploadChatHistory.push({role:'assistant',text:data.answer});
  } catch(e) { document.getElementById(typingId)?.remove(); appendChatBubble('assistant', '❌ ' + e.message); }
  finally { sendBtn.disabled = false; }
}

function appendChatBubble(role, text, id) {
  const msgs = document.getElementById('uploadChatMessages');
  const div  = document.createElement('div');
  div.className  = `upload-bubble upload-bubble-${role}`;
  if (id) div.id = id;
  const formatted = escHtml(text).replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  div.innerHTML   = `<div class="upload-bubble-avatar">${role==='user'?'👤':'🤖'}</div><div class="upload-bubble-content">${formatted}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop  = msgs.scrollHeight;
}

// ============================================================
// VOICE NAVIGATION
// ============================================================
function initVoiceNav() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US';
  recognition.onresult = e => handleVoiceCommand(e.results[0][0].transcript.toLowerCase());
  recognition.onend    = () => { voiceActive = false; updateVoiceUI(); };
  recognition.onerror  = () => { voiceActive = false; updateVoiceUI(); };
}
function toggleVoiceNav() {
  if (!recognition) { showToast('Voice not supported in this browser', 'error'); return; }
  if (voiceActive) { recognition.stop(); voiceActive = false; updateVoiceUI(); return; }
  voiceActive = true; updateVoiceUI(); recognition.start();
}
function updateVoiceUI() {
  document.getElementById('voiceNavBtn')?.classList.toggle('listening', voiceActive);
  const status = document.getElementById('voiceStatus');
  if (status) status.style.display = voiceActive ? 'block' : 'none';
}
function handleVoiceCommand(cmd) {
  const speak = t => { const u = new SpeechSynthesisUtterance(t); u.rate = 1.1; window.speechSynthesis.speak(u); };
  if (cmd.includes('written course'))  { showSection('written');  speak('Opening written course'); }
  else if (cmd.includes('video'))      { showSection('video');    speak('Opening video course'); }
  else if (cmd.includes('quiz'))       { showSection('quiz');     speak('Opening quiz center'); }
  else if (cmd.includes('points'))     { showSection('points');   speak('Opening points'); }
  else if (cmd.includes('settings'))   { showSection('settings'); speak('Opening settings'); }
  else if (cmd.includes('feedback'))   { showSection('feedback'); speak('Opening feedback'); }
  else if (cmd.includes('upload'))     { showSection('upload');   speak('Opening upload'); }
  else if (cmd.includes('dark mode'))  { document.documentElement.setAttribute('data-theme','dark'); speak('Dark mode on'); }
  else if (cmd.includes('light mode')) { document.documentElement.setAttribute('data-theme','light'); speak('Light mode on'); }
  else if (cmd.includes('generate') && document.getElementById('topicInput')) { generateCourse(); speak('Generating your course'); }
  else if (cmd.match(/module (\d+)/)) { const n = parseInt(cmd.match(/module (\d+)/)[1]); toggleModule(n); speak(`Opening module ${n}`); }
  else { speak('Command not recognized.'); }
  showToast(`🎙️ "${cmd}"`, 'info');
}

// ============================================================
// FOCUS DETECTOR — MediaPipe Face Detection
// ============================================================
async function toggleEngagement() {
  if (engagementActive) { stopEngagement(); } else { await startEngagement(); }
}

async function startEngagement() {
  try {
    focusStream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.getElementById('focusVideo');
    video.srcObject = focusStream;
    await video.play();

    document.getElementById('focusBar').style.display = 'block';
    document.getElementById('focusToggleBtn').classList.add('active');
    engagementActive  = true;
    sessionStartTime  = Date.now();
    distractedTime    = 0;
    currentFocusScore = 100;
    nudgeShown        = false;
    document.getElementById('focusScoreDisplay').textContent = '100';
    document.getElementById('focusStatus').textContent = '👁️ Loading face detector...';

    // Load MediaPipe Face Detection
    await loadFaceDetectionModel();
    runFaceDetection();
    showToast('Focus detector enabled 👁️', 'success');
  } catch(e) {
    showToast('Camera access denied or not available', 'error');
    engagementActive = false;
  }
}

async function loadFaceDetectionModel() {
  return new Promise((resolve) => {
    if (faceDetectionModel) { resolve(); return; }
    const script = document.createElement('script');
    script.src   = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4/face_detection.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      faceDetectionModel = new FaceDetection({
        locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4/${file}`
      });
      faceDetectionModel.setOptions({ model: 'short', minDetectionConfidence: 0.5 });
      faceDetectionModel.onResults(onFaceResults);
      resolve();
    };
    script.onerror = () => { faceDetectionModel = null; resolve(); };
    document.head.appendChild(script);
  });
}

let noFaceSeconds   = 0;
let lastFaceCheck   = Date.now();

function runFaceDetection() {
  const video = document.getElementById('focusVideo');
  focusInterval = setInterval(async () => {
    if (!engagementActive || !video || video.readyState < 2) return;
    try {
      if (faceDetectionModel) {
        await faceDetectionModel.send({ image: video });
      } else {
        // Fallback: use canvas pixel analysis if MediaPipe fails
        const canvas = document.getElementById('focusCanvas');
        const ctx    = canvas.getContext('2d');
        canvas.width  = video.videoWidth  || 320;
        canvas.height = video.videoHeight || 240;
        ctx.drawImage(video, 0, 0);
        const data     = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let skinPx     = 0;
        const total    = data.length / 4;
        for (let i = 0; i < data.length; i += 16) {
          const r = data[i], g = data[i+1], b = data[i+2];
          if (r > 95 && g > 40 && b > 20 && r > g && r > b && (r - Math.min(g,b)) > 15) skinPx++;
        }
        const hasFace = (skinPx / (total / 4)) > 0.04;
        processFaceResult(hasFace);
      }
    } catch(e) {}
  }, 1000);
}

function onFaceResults(results) {
  const hasFace = results.detections && results.detections.length > 0;
  processFaceResult(hasFace);
}

function processFaceResult(hasFace) {
  if (!engagementActive) return;
  const totalSec = Math.max(1, (Date.now() - sessionStartTime) / 1000);
  if (!hasFace) {
    noFaceSeconds++;
    if (noFaceSeconds >= 5 && !nudgeShown) {
      showDistractionNudge();
      distractedTime++;
    }
    document.getElementById('focusStatus').textContent = `😴 Face not detected (${noFaceSeconds}s)`;
  } else {
    noFaceSeconds = 0;
    nudgeShown    = false;
    dismissNudge();
    document.getElementById('focusStatus').textContent = '✅ Face detected — Attentive';
  }
  currentFocusScore = Math.max(0, Math.round(100 - (distractedTime / totalSec) * 100));
  document.getElementById('focusScoreDisplay').textContent = currentFocusScore;
}

function showDistractionNudge() {
  nudgeShown = true;
  document.getElementById('distractionNudge').style.display = 'flex';
  setTimeout(() => { if (nudgeShown) { nudgeShown = false; dismissNudge(); } }, 5000);
}
function dismissNudge() {
  nudgeShown = false;
  document.getElementById('distractionNudge').style.display = 'none';
}

function stopEngagement() {
  engagementActive = false;
  if (focusInterval) { clearInterval(focusInterval); focusInterval = null; }
  if (focusStream)   { focusStream.getTracks().forEach(t => t.stop()); focusStream = null; }
  const video = document.getElementById('focusVideo');
  if (video) { video.srcObject = null; }
  document.getElementById('focusBar').style.display = 'none';
  document.getElementById('focusToggleBtn').classList.remove('active');
  dismissNudge();
  if (sessionStartTime) {
    const totalSec = Math.round((Date.now() - sessionStartTime) / 1000);
    const session  = {
      module_title:    currentTopic || 'Session',
      total_time:      totalSec,
      distracted_time: distractedTime,
      focus_score:     currentFocusScore,
      created_at:      new Date().toISOString()
    };
    localEngagementSessions.unshift(session);
    saveStateToStorage();
    if (currentUser) {
      fetch(`${API_BASE}/api/save-engagement`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ course_id: currentCourseId, module_title: session.module_title, total_time: totalSec, distracted_time: distractedTime, focus_score: currentFocusScore }) }).catch(()=>{});
    }
    sessionStartTime = null;
  }
  showToast('Focus session saved!', 'info');
}

// ============================================================
// ENGAGEMENT REPORT
// ============================================================
async function loadEngagementReport() {
  const el = document.getElementById('engagementReportOutput');
  if (!el) return;
  let sessions = [...localEngagementSessions];
  if (currentUser) {
    try {
      const res  = await fetch(`${API_BASE}/api/engagement-report`, { credentials:'include' });
      const data = await res.json();
      if (data.success && data.sessions.length) sessions = [...data.sessions, ...sessions];
    } catch(e) {}
  }
  if (!sessions.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">👁️</div><div class="empty-title">No sessions yet</div><div class="empty-desc">Enable focus detector while studying.</div></div>';
    return;
  }
  const avgFocus    = Math.round(sessions.reduce((a,s) => a+(s.focus_score||100), 0) / sessions.length);
  const totalTime   = sessions.reduce((a,s) => a+(s.total_time||0), 0);
  const totalDist   = sessions.reduce((a,s) => a+(s.distracted_time||0), 0);
  el.innerHTML = `
    <div class="engagement-cards">
      <div class="engagement-stat"><div class="engagement-stat-label">Avg Focus</div><div class="engagement-stat-value">${avgFocus}%</div></div>
      <div class="engagement-stat"><div class="engagement-stat-label">Study Time</div><div class="engagement-stat-value">${Math.round(totalTime/60)}m</div></div>
      <div class="engagement-stat"><div class="engagement-stat-label">Distracted</div><div class="engagement-stat-value">${totalDist}s</div></div>
      <div class="engagement-stat"><div class="engagement-stat-label">Sessions</div><div class="engagement-stat-value">${sessions.length}</div></div>
    </div>
    <div class="engagement-session-list">
      ${sessions.map(s => {
        const sc = (s.focus_score||100) >= 80 ? 'good' : (s.focus_score||100) >= 50 ? 'ok' : 'bad';
        return `<div class="engagement-session-card">
          <div class="esc-module">${escHtml(s.module_title||'Session')}</div>
          <div class="esc-stats">
            <span class="esc-stat">⏱️ ${Math.round((s.total_time||0)/60)}m</span>
            <span class="esc-stat">😴 ${s.distracted_time||0}s</span>
          </div>
          <div class="esc-score ${sc}">${s.focus_score||100}%</div>
        </div>`;
      }).join('')}
    </div>`;
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type='info') {
  const container = document.getElementById('toastContainer');
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
// ============================================================
// INTRO VIDEO — plays every visit, sound ON by default
// ============================================================
(function initIntroVideo() {
  const overlay = document.getElementById('introOverlay');
  const video   = document.getElementById('introVideo');
  const bar     = document.getElementById('introProgressBar');
  const muteBtn = document.getElementById('introMuteBtn');
  if (!overlay || !video) return;

  // Show landing after video ends or is skipped
  let introEnded = false;
  function endIntro() {
    if (introEnded) return;
    introEnded = true;
    clearTimeout(stallTimer);
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.6s ease';
    setTimeout(() => {
      overlay.style.display = 'none';
      document.getElementById('landingPage').style.display = 'flex';
    }, 600);
  }

  // Mute toggle
  window.toggleIntroMute = function() {
    video.muted = !video.muted;
    if (muteBtn) muteBtn.textContent = video.muted ? '🔇 Sound Off' : '🔊 Sound On';
  };

  // Try to play with sound; browsers may block unmuted autoplay
  video.muted = false;
  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      // Autoplay blocked — fall back to muted, show click-to-unmute hint
      video.muted = true;
      video.play();
      if (muteBtn) {
        muteBtn.textContent = '🔇 Click to Unmute';
        muteBtn.style.background = 'rgba(220,38,38,0.25)';
        muteBtn.style.borderColor = 'rgba(220,38,38,0.5)';
      }
    });
  }

  // Progress bar update
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    if (bar) bar.style.width = pct + '%';
  });

  video.addEventListener('ended', endIntro);
  video.addEventListener('error', endIntro);

  // Fallback: max 30s then skip
  let stallTimer = setTimeout(endIntro, 30000);

  // Make skip function global
  window.skipIntro = endIntro;
})();

// Nav sync handled directly in showSection and toggleSuper above

// ============================================================
// LAST COURSE / VIDEO RESTORE — for logged-in returning users
// ============================================================
function saveLastWrittenCourse(topic, course, shareToken) {
  try {
    localStorage.setItem('cf_last_written', JSON.stringify({ topic, course, shareToken }));
  } catch(e) {}
}
function saveLastVideoCourse(transcript, quiz, videoId, videoTitle, topic) {
  try {
    localStorage.setItem('cf_last_video', JSON.stringify({ transcript, quiz, videoId, videoTitle, topic }));
  } catch(e) {}
}
function restoreLastCourses() {
  try {
    const written = JSON.parse(localStorage.getItem('cf_last_written') || 'null');
    if (written && written.course) {
      currentCourse     = written.course;
      currentTopic      = written.topic;
      currentShareToken = written.shareToken;
      const inp = document.getElementById('topicInput');
      if (inp) inp.value = written.topic;
      renderCourse(written.course);
      showToast('📚 Last course restored!', 'info');
    }
  } catch(e) {}
  try {
    const vid = JSON.parse(localStorage.getItem('cf_last_video') || 'null');
    if (vid && vid.transcript) {
      vcSelectedVideoId    = vid.videoId;
      vcSelectedVideoTitle = vid.videoTitle;
      vcCurrentTopic       = vid.topic;
      vcCurrentQuiz        = vid.quiz;
      renderVideoResult(vid.transcript, vid.quiz);
    }
  } catch(e) {}
}

// Hook into generateCourse to auto-save
const _origRenderCourse = renderCourse;
window.renderCourse = function(course) {
  _origRenderCourse(course);
  saveLastWrittenCourse(currentTopic, course, currentShareToken);
};

// Hook into renderVideoResult to auto-save
const _origRenderVideoResult = renderVideoResult;
window.renderVideoResult = function(transcript, quiz) {
  _origRenderVideoResult(transcript, quiz);
  saveLastVideoCourse(transcript, quiz, vcSelectedVideoId, vcSelectedVideoTitle, vcCurrentTopic);
};

// Restore last courses when user lands on main app (logged in)
const _origHideLanding = hideLanding;
window.hideLanding = function() {
  _origHideLanding();
  setTimeout(() => {
    if (currentUser) restoreLastCourses();
  }, 100);
};

// ============================================================
// FAQ — now lives under the FEEDBACK (account) supersection
// ============================================================
function showFaqs() {
  // Activate the account supersection
  toggleSuper('account');
  // Then show the FAQ section
  showSection('faq');
}

function toggleFaq(questionEl) {
  const item = questionEl.closest('.faq-item');
  const isOpen = item.classList.contains('open');
  // Close all
  document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
  // Open clicked if it wasn't open
  if (!isOpen) item.classList.add('open');
}