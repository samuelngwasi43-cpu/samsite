import { buildMetrics, calculateWeightedAverage, getMention } from './logic.js';

/* ─── Constantes ─────────────────────────────────────────── */
const CLASSES = [
  '1ère Secondaire','2ème Secondaire','3ème Humanités',
  '4ème Humanités','5ème Humanités','6ème Humanités'
];
const AVATAR_SEEDS = ['lyra','ember','aria','nova','axel','izzy','milo','zen'];
const avatarUrl = (seed) =>
  `https://api.dicebear.com/6.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=6366f1`;

/* ─── État global ────────────────────────────────────────── */
const app = document.getElementById('app');
const tokenKey = 'samsite-token';
let state = { user: null, dashboard: null, loading: true, error: '', activeNav: 'overview' };
let pendingUserPhotoUploadId = null;

/* ─── Utilitaires ────────────────────────────────────────── */
function getToken()       { return localStorage.getItem(tokenKey); }
function saveToken(t)     { localStorage.setItem(tokenKey, t); }
function clearToken()     { localStorage.removeItem(tokenKey); }

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function getRoleLabel(role) {
  return role === 'ADMIN' ? 'Administrateur' : role === 'PROFESSOR' ? 'Professeur' : 'Élève';
}

function getRoleColor(role) {
  return role === 'ADMIN' ? 'badge-rose' : role === 'PROFESSOR' ? 'badge-sky' : 'badge-emerald';
}

function getMentionClass(avg) {
  if (avg >= 16) return 'grade-A';
  if (avg >= 14) return 'grade-B';
  if (avg >= 12) return 'grade-C';
  return 'grade-D';
}

/* ─── Toast notifications ────────────────────────────────── */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

/* ─── API ────────────────────────────────────────────────── */
async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
  const response = await fetch(path, { ...options, headers: { ...headers, ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Erreur réseau');
  return payload;
}

async function bootstrap() {
  const token = getToken();
  if (!token) { state.loading = false; render(); return; }
  try {
    const data = await request('/api/me');
    state.user = data.user;
    state.dashboard = data.dashboard;
    state.error = '';
  } catch (e) { clearToken(); state.error = e.message; }
  finally { state.loading = false; render(); }
}

async function login(email, password) {
  try {
    const data = await request('/api/login', { method:'POST', body: JSON.stringify({ email, password }) });
    saveToken(data.token);
    state.user = data.user; state.dashboard = data.dashboard; state.error = '';
    state.activeNav = 'overview';
    render();
  } catch(e) { state.error = e.message; render(); }
}

async function logout() {
  try { await request('/api/logout', { method:'POST' }); } catch {}
  clearToken(); state.user = null; state.dashboard = null; render();
}

async function registerStudent(payload) {
  return await request('/api/register/student', { method:'POST', body: JSON.stringify(payload) });
}

async function refreshDashboard() {
  const data = await request('/api/dashboard');
  state.dashboard = data;
}

async function createUser(payload) {
  const data = await request('/api/users', { method:'POST', body: JSON.stringify(payload) });
  state.dashboard = data.dashboard; render();
}

async function updateUser(userId, payload) {
  const data = await request(`/api/users/${userId}`, { method:'PUT', body: JSON.stringify(payload) });
  state.dashboard = data.dashboard; render();
}

async function deleteUser(userId) {
  const data = await request(`/api/users/${userId}`, { method:'DELETE' });
  state.dashboard = data.dashboard; render();
}

async function createCourse(payload) {
  const data = await request('/api/courses', { method:'POST', body: JSON.stringify(payload) });
  state.dashboard = data.dashboard; render();
}

async function createAnnouncement(payload) {
  const data = await request('/api/announcements', { method:'POST', body: JSON.stringify(payload) });
  state.dashboard = data.dashboard; render();
}

async function createMeeting(payload) {
  const data = await request('/api/meetings', { method:'POST', body: JSON.stringify(payload) });
  state.dashboard = data.dashboard; render();
}

async function createGrade(payload) {
  const data = await request('/api/grades', { method:'POST', body: JSON.stringify(payload) });
  state.dashboard = data.dashboard; render();
}

async function createBulletin(payload) {
  const data = await request('/api/bulletins', { method:'POST', body: JSON.stringify(payload) });
  state.dashboard = data.dashboard; render();
}

/* ─── Render principal ───────────────────────────────────── */
function render() {
  if (state.loading) {
    app.innerHTML = `
      <div class="auth-layout">
        <div style="text-align:center;display:grid;gap:16px;place-items:center;">
          <div class="sidebar-logo-icon" style="width:56px;height:56px;font-size:1.5rem;">🎓</div>
          <div class="skeleton" style="width:160px;height:14px;border-radius:8px;"></div>
          <div class="text-3 text-sm">Chargement de la plateforme…</div>
        </div>
      </div>`;
    return;
  }
  if (!state.user) { renderAuth(); return; }

  const metrics = buildMetrics({
    users: state.dashboard?.users || [],
    courses: state.dashboard?.courses || [],
    grades: state.dashboard?.grades || []
  });

  const userPhoto = state.user.profile_photo_url || state.user.profilePhoto || '';
  const initials = (state.user.name || 'U').split(' ').map(p => p[0]).join('').slice(0,2).toUpperCase();

  app.innerHTML = `
    <div class="app-layout">
      ${renderSidebar(initials, userPhoto)}
      ${renderTopbar()}
      <main class="main-content animate-fade-in">
        ${renderMainPanel(metrics)}
      </main>
    </div>`;

  attachEventHandlers();
}

function renderSidebar(initials, photo) {
  const role = state.user?.role;
  const navAdmin = [
    { id:'overview',      icon:'📊', label:"Vue d'ensemble" },
    { id:'users',         icon:'👥', label:'Utilisateurs' },
    { id:'courses',       icon:'📚', label:'Cours' },
    { id:'grades',        icon:'📝', label:'Résultats' },
    { id:'bulletins',     icon:'📄', label:'Bulletins' },
    { id:'announcements', icon:'📢', label:'Annonces' },
    { id:'meetings',      icon:'🤝', label:'Réunions parents' },
    { id:'logs',          icon:'🗂️',  label:'Journal' },
  ];
  const navProf = [
    { id:'overview',  icon:'📊', label:"Vue d'ensemble" },
    { id:'grades',    icon:'📝', label:'Saisie des notes' },
    { id:'courses',   icon:'📚', label:'Mes cours' },
    { id:'bulletins', icon:'📄', label:'Bulletins' },
    { id:'announcements', icon:'📢', label:'Annonces' },
    { id:'meetings',  icon:'🤝', label:'Réunions parents' },
  ];
  const navStudent = [
    { id:'overview',      icon:'🏠', label:'Accueil' },
    { id:'grades',        icon:'🎯', label:'Mes résultats' },
    { id:'bulletins',     icon:'📄', label:'Mes bulletins' },
    { id:'courses',       icon:'📚', label:'Cours disponibles' },
    { id:'announcements', icon:'📢', label:'Annonces' },
    { id:'meetings',      icon:'🤝', label:'Réunions parents' },
  ];
  const navItems = role === 'ADMIN' ? navAdmin : role === 'PROFESSOR' ? navProf : navStudent;

  return `
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo-icon">🎓</div>
        <div>
          <div class="sidebar-logo-text">Samsite</div>
          <div class="sidebar-subtitle">Plateforme scolaire</div>
        </div>
      </div>
      <div class="sidebar-user">
        <div class="sidebar-user-avatar">
          ${photo ? `<img src="${escapeHtml(photo)}" alt="Photo" />` : escapeHtml(initials)}
        </div>
        <div>
          <div class="sidebar-user-name">${escapeHtml(state.user?.name || '')}</div>
          <div class="sidebar-user-role">${getRoleLabel(role)}</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section-label">Navigation</div>
        ${navItems.map(item => `
          <div class="nav-item${state.activeNav === item.id ? ' active' : ''}" data-nav="${item.id}">
            <div class="nav-icon">${item.icon}</div>
            ${escapeHtml(item.label)}
          </div>`).join('')}
      </nav>
      <div class="sidebar-footer">
        <button id="logout-btn" class="btn btn-danger btn-full btn-sm">🚪 Déconnexion</button>
      </div>
    </aside>`;
}

function renderTopbar() {
  const titles = {
    overview:"Vue d'ensemble", users:'Gestion des utilisateurs',
    courses:'Gestion des cours', grades:'Résultats & Notes',
    bulletins:'Bulletins scolaires', announcements:'Annonces',
    meetings:'Réunions de parents', logs:'Journal des actions'
  };
  return `
    <header class="topbar">
      <div>
        <div class="topbar-title">${escapeHtml(titles[state.activeNav] || 'Tableau de bord')}</div>
        <div class="topbar-sub">${new Date().toLocaleDateString('fr-FR',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
      </div>
      <div class="topbar-actions">
        <div class="pill">✉️ ${escapeHtml(state.user?.email || '')}</div>
        <span class="badge ${getRoleColor(state.user?.role)}">${getRoleLabel(state.user?.role)}</span>
      </div>
    </header>`;
}

function renderMainPanel(metrics) {
  const role = state.user?.role;
  if (role === 'ADMIN')     return renderAdminPanel(metrics);
  if (role === 'PROFESSOR') return renderProfPanel(metrics);
  return renderStudentPanel(metrics);
}

/* ─── VUE ADMIN ──────────────────────────────────────────── */
function renderAdminPanel(metrics) {
  const nav = state.activeNav;
  const users   = state.dashboard?.users || [];
  const courses = state.dashboard?.courses || [];
  const grades  = state.dashboard?.grades || [];
  const ann     = state.dashboard?.announcements || [];
  const meet    = state.dashboard?.meetings || [];
  const bulls   = state.dashboard?.bulletins || [];

  if (nav === 'overview') return renderAdminOverview(metrics, users, courses, grades, ann);
  if (nav === 'users')    return renderAdminUsers(users);
  if (nav === 'courses')  return renderAdminCourses(courses, users);
  if (nav === 'grades')   return renderAdminGrades(grades, users, courses);
  if (nav === 'bulletins')return renderAdminBulletins(bulls, users);
  if (nav === 'announcements') return renderAdminAnnouncements(ann);
  if (nav === 'meetings') return renderAdminMeetings(meet);
  if (nav === 'logs')     return renderAdminLogs();
  return '';
}

function renderAdminOverview(metrics, users, courses, grades, ann) {
  const userInfo = state.dashboard?.users?.find(u => u.id === state.user.id) || state.user;
  const photo = userInfo.profile_photo_url || userInfo.profilePhoto || '';
  const initials = (userInfo.name||'A').split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase();
  return `
    <div class="hero-banner animate-fade-up">
      <div class="hero-banner-content" style="display:flex;align-items:center;gap:24px;">
        <div style="width:72px;height:72px;border-radius:20px;overflow:hidden;flex-shrink:0;border:3px solid rgba(129,140,248,0.5);box-shadow:0 0 24px rgba(99,102,241,0.35);background:var(--grad-indigo);display:grid;place-items:center;font-weight:800;font-size:1.3rem;">
          ${photo ? `<img src="${escapeHtml(photo)}" alt="Photo" style="width:100%;height:100%;object-fit:cover;" />` : escapeHtml(initials)}
        </div>
        <div>
          <div class="hero-greeting">Bonjour, <span class="name">${escapeHtml(state.user.name)} 👋</span></div>
          <div class="hero-sub">Voici un aperçu complet de votre établissement. Gérez utilisateurs, cours, résultats et communications depuis un seul endroit.</div>
          <div class="hero-badges" style="margin-top:14px;">
            <span class="badge badge-indigo live">Système actif</span>
            <span class="badge badge-gold">🏫 Administration</span>
          </div>
        </div>
      </div>
    </div>
    <div class="metrics-grid">
      <div class="card card-pad metric-card animate-fade-up">
        <div class="metric-icon indigo">👥</div>
        <div class="metric-value">${metrics.users}</div>
        <div class="metric-label">Utilisateurs</div>
      </div>
      <div class="card card-pad metric-card animate-fade-up">
        <div class="metric-icon sky">🎓</div>
        <div class="metric-value">${metrics.professors}</div>
        <div class="metric-label">Professeurs</div>
      </div>
      <div class="card card-pad metric-card animate-fade-up">
        <div class="metric-icon emerald">📖</div>
        <div class="metric-value">${metrics.students}</div>
        <div class="metric-label">Élèves</div>
      </div>
      <div class="card card-pad metric-card animate-fade-up">
        <div class="metric-icon gold">📊</div>
        <div class="metric-value">${metrics.mean}/20</div>
        <div class="metric-label">Moyenne générale</div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:0;">
      <div class="card card-pad">
        <div class="section-title"><h2>📢 Dernières annonces</h2></div>
        <ul class="list-card" style="list-style:none;padding:0;display:grid;gap:8px;">
          ${ann.slice(0,3).map(a=>`<li class="card card-pad-sm" style="padding:12px 14px;">
            <div class="font-bold text-sm">${escapeHtml(a.title)}</div>
            <div class="muted text-xs" style="margin-top:4px;">${escapeHtml(a.body)}</div>
          </li>`).join('') || '<li class="muted text-sm">Aucune annonce.</li>'}
        </ul>
      </div>
      <div class="card card-pad">
        <div class="section-title"><h2>📚 Cours récents</h2></div>
        <ul class="list-card" style="list-style:none;padding:0;display:grid;gap:8px;">
          ${courses.slice(0,4).map(c=>{
            const teacher = users.find(u=>u.id===c.teacher_id);
            return `<li class="card card-pad-sm" style="padding:12px 14px;">
              <div class="font-bold text-sm">${escapeHtml(c.title)}</div>
              <div class="muted text-xs">${escapeHtml(c.class_name)} • ${escapeHtml(teacher?.name||'Prof')}</div>
            </li>`;
          }).join('') || '<li class="muted text-sm">Aucun cours.</li>'}
        </ul>
      </div>
    </div>`;
}

function renderAdminUsers(users) {
  return `
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="section-title"><h2>➕ Créer un compte</h2></div>
        <form id="user-form" class="form-grid">
          <div class="grid grid-2">
            <input name="name" class="input" placeholder="Nom complet" required />
            <input name="email" type="email" class="input" placeholder="Email" required />
          </div>
          <div class="grid grid-2">
            <input name="password" type="password" class="input" placeholder="Mot de passe" required />
            <select name="role" class="select">
              <option value="ADMIN">Administrateur</option>
              <option value="PROFESSOR">Professeur</option>
              <option value="STUDENT">Élève</option>
            </select>
          </div>
          <input name="phone" class="input" placeholder="Téléphone (optionnel)" />
          <input name="bio"   class="input" placeholder="Biographie / spécialité" />
          <input type="hidden" name="profilePhoto" id="profilePhoto" value="" />
          <div class="field">
            <div class="input-label">Photo de profil</div>
            <div class="profile-upload-row">
              <button type="button" id="select-create-photo-btn" class="button button-primary small">📎 Choisir une photo</button>
              <button type="button" id="remove-create-photo-btn" class="button button-amber small">✕ Supprimer</button>
            </div>
            <div id="create-photo-preview" class="profile-upload-preview" style="margin-top:8px;"><span class="muted small">Aucune photo sélectionnée</span></div>
            <input type="file" id="create-profile-photo-file" accept="image/*" style="display:none" />
          </div>
          <button class="button button-primary">Créer le compte</button>
        </form>
      </div>
      <div class="card card-pad">
        <div class="section-title">
          <h2>👥 Profils actifs</h2>
          <span class="badge badge-indigo">${users.length} comptes</span>
        </div>
        <div class="profile-list">
          ${users.map(u => {
            const initials = (u.name||'U').split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase();
            const photo = u.profile_photo_url || u.profilePhoto || '';
            return `
              <div class="profile-card">
                <div class="profile-avatar${!photo?' initials':''}">
                  ${photo?`<img src="${escapeHtml(photo)}" alt="${escapeHtml(u.name||'')}" />`:escapeHtml(initials)}
                </div>
                <div class="profile-main">
                  <div class="profile-row">
                    <div class="profile-name">${escapeHtml(u.name||'Utilisateur')}</div>
                    <span class="badge ${getRoleColor(u.role)} text-xs">${getRoleLabel(u.role)}</span>
                  </div>
                  <div class="profile-email">${escapeHtml(u.email||'')}</div>
                  <div class="profile-meta">
                    ${u.class_name||u.className?`<span class="badge badge-sky text-xs">${escapeHtml(u.class_name||u.className)}</span>`:''}
                    ${u.phone?`<span class="text-xs muted">📞 ${escapeHtml(u.phone)}</span>`:''}
                  </div>
                  ${u.bio?`<div class="muted text-xs">${escapeHtml(u.bio)}</div>`:''}
                  <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
                    <span class="text-xs muted">🔑</span>
                    <span class="font-mono text-xs" id="pw-display-${u.id}" style="color:var(--text-3);letter-spacing:0.1em;">••••••••</span>
                    <button class="tiny-btn" data-action="toggle-pw" data-user-id="${u.id}" data-pw="${escapeHtml(u.plain_password||'(chiffré)')}">👁️</button>
                  </div>
                </div>
                <div class="profile-actions">
                  <button class="tiny-btn" data-action="edit-user" data-user-id="${u.id}">✏️ Éditer</button>
                  <button class="tiny-btn" data-action="change-pw" data-user-id="${u.id}">🔑 MDP</button>
                  <button class="tiny-btn" data-action="change-photo" data-user-id="${u.id}">🖼️ Photo</button>
                  <button class="tiny-btn danger" data-action="delete-photo" data-user-id="${u.id}">🗑️ Photo</button>
                  <button class="tiny-btn danger" data-action="delete-user" data-user-id="${u.id}">✕ Supprimer</button>
                </div>
              </div>`;
          }).join('')}
        </div>
        <input type="file" id="profile-photo-file" accept="image/*" style="display:none" />
      </div>
    </div>`;
}

function renderAdminCourses(courses, users) {
  return `
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="section-title"><h2>📚 Créer un cours</h2></div>
        <form id="course-form" class="form-grid">
          <input name="title" class="input" placeholder="Titre du cours" required />
          <select name="className" class="select">
            ${CLASSES.map(c=>`<option value="${c}">${c}</option>`).join('')}
          </select>
          <select name="teacherId" class="select">
            ${users.filter(u=>u.role==='PROFESSOR').map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
          </select>
          <button class="button button-emerald">➕ Créer le cours</button>
        </form>
      </div>
      <div class="card card-pad">
        <div class="section-title">
          <h2>📋 Liste des cours</h2>
          <span class="badge badge-sky">${courses.length} cours</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Titre</th><th>Classe</th><th>Professeur</th><th>Actions</th></tr></thead>
            <tbody>
              ${courses.map(c=>{
                const teacher = users.find(u=>u.id===c.teacher_id);
                return `<tr>
                  <td class="font-bold">${escapeHtml(c.title)}</td>
                  <td><span class="badge badge-indigo text-xs">${escapeHtml(c.class_name)}</span></td>
                  <td>${escapeHtml(teacher?.name||'—')}</td>
                  <td>
                    <button class="tiny-btn" data-action="edit-course" data-course-id="${c.id}">✏️</button>
                    <button class="tiny-btn danger" data-action="delete-course" data-course-id="${c.id}">✕</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function renderAdminGrades(grades, users, courses) {
  return `
    <div class="card card-pad">
      <div class="section-title">
        <h2>📊 Tous les résultats</h2>
        <span class="badge badge-gold">${grades.length} notes</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Élève</th><th>Cours</th><th>Classe</th><th>Devoir/8</th><th>Examen/12</th><th>Moyenne/20</th><th>Mention</th></tr></thead>
          <tbody>
            ${grades.map(g=>{
              const student = users.find(u=>u.id===g.student_id);
              const course  = courses.find(c=>c.id===g.course_id);
              const avg = calculateWeightedAverage(g.homework, g.exam);
              return `<tr>
                <td class="font-bold">${escapeHtml(student?.name||'Élève')}</td>
                <td>${escapeHtml(course?.title||'Cours')}</td>
                <td><span class="badge badge-indigo text-xs">${escapeHtml(course?.class_name||'—')}</span></td>
                <td>${escapeHtml(String(g.homework))}</td>
                <td>${escapeHtml(String(g.exam))}</td>
                <td class="font-bold">${avg}/20</td>
                <td><span class="grade-badge ${getMentionClass(avg)}">${getMention(avg)}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderAdminBulletins(bulls, users) {
  return `
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="section-title"><h2>📄 Générer un bulletin</h2></div>
        <form id="bulletin-form" class="form-grid">
          <select name="studentId" class="select">
            ${users.filter(u=>u.role==='STUDENT').map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
          </select>
          <select name="className" class="select">
            ${CLASSES.map(c=>`<option value="${c}">${c}</option>`).join('')}
          </select>
          <input name="period" class="input" placeholder="Période" value="Semestre 1" />
          <textarea name="comment" class="textarea" placeholder="Commentaire (optionnel)" rows="3"></textarea>
          <button class="button button-primary">📄 Générer</button>
        </form>
        <div style="margin-top:14px;display:flex;gap:10px;">
          <button id="export-bulletins-csv" class="button button-emerald small">⬇️ Export CSV</button>
          <a href="/api/bulletins/export.pdf" target="_blank" class="button button-amber small" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:var(--radius);font-weight:700;font-size:0.83rem;background:linear-gradient(135deg,#f59e0b,#ef4444);color:white;">📑 Export PDF</a>
        </div>
      </div>
      <div class="card card-pad">
        <div class="section-title">
          <h2>📋 Bulletins générés</h2>
          <span class="badge badge-gold">${bulls.length}</span>
        </div>
        <div style="max-height:480px;overflow-y:auto;display:grid;gap:10px;">
          ${bulls.map(b=>{
            const student = users.find(u=>u.id===b.student_id);
            const avg = Number(b.average||0);
            return `<div class="card card-pad-sm" style="padding:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
                <div class="font-bold text-sm">${escapeHtml(student?.name||b.student_name||'Élève')}</div>
                <span class="grade-badge ${getMentionClass(avg)}">${avg}/20</span>
              </div>
              <div class="muted text-xs">${escapeHtml(b.class_name||'—')} • ${escapeHtml(b.period||'Semestre 1')}</div>
              ${b.comment?`<div class="muted text-xs" style="margin-top:4px;">${escapeHtml(b.comment)}</div>`:''}
              ${b.file_url?`<a href="${escapeHtml(b.file_url)}" target="_blank" class="link-inline" style="display:inline-block;margin-top:6px;">Voir PDF →</a>`:''}
            </div>`;
          }).join('') || '<div class="muted text-sm">Aucun bulletin généré.</div>'}
        </div>
      </div>
    </div>`;
}

function renderAdminAnnouncements(ann) {
  return `
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="section-title"><h2>📢 Publier une annonce</h2></div>
        <form id="announcement-form" class="form-grid">
          <input name="title" class="input" placeholder="Titre" required />
          <textarea name="body" class="textarea" placeholder="Contenu de l'annonce" rows="5"></textarea>
          <button class="button button-violet">📢 Publier</button>
        </form>
      </div>
      <div class="card card-pad">
        <div class="section-title"><h2>📋 Annonces publiées</h2><span class="badge badge-indigo">${ann.length}</span></div>
        <div style="display:grid;gap:10px;max-height:480px;overflow-y:auto;">
          ${ann.map(a=>`<div class="card card-pad-sm" style="padding:14px;">
            <div class="font-bold text-sm" style="margin-bottom:4px;">${escapeHtml(a.title)}</div>
            <div class="muted text-xs">${escapeHtml(a.body)}</div>
          </div>`).join('')||'<div class="muted text-sm">Aucune annonce.</div>'}
        </div>
      </div>
    </div>`;
}

function renderAdminMeetings(meet) {
  return `
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="section-title"><h2>🤝 Planifier une réunion</h2></div>
        <form id="meeting-form" class="form-grid">
          <input name="title" class="input" placeholder="Sujet de la réunion" required />
          <textarea name="body" class="textarea" placeholder="Détails, lieu, heure…" rows="5"></textarea>
          <button class="button button-amber">📅 Publier</button>
        </form>
      </div>
      <div class="card card-pad">
        <div class="section-title"><h2>📋 Réunions planifiées</h2><span class="badge badge-gold">${meet.length}</span></div>
        <div style="display:grid;gap:10px;max-height:480px;overflow-y:auto;">
          ${meet.map(m=>`<div class="card card-pad-sm" style="padding:14px;">
            <div class="font-bold text-sm" style="margin-bottom:4px;">🤝 ${escapeHtml(m.title)}</div>
            <div class="muted text-xs">${escapeHtml(m.body)}</div>
          </div>`).join('')||'<div class="muted text-sm">Aucune réunion planifiée.</div>'}
        </div>
      </div>
    </div>`;
}

function renderAdminLogs() {
  return `
    <div class="card card-pad">
      <div class="section-title"><h2>🗂️ Journal des actions</h2><span class="badge badge-emerald live">Temps réel</span></div>
      <div id="logs-panel">
        <div class="skeleton" style="height:40px;"></div>
        <div class="skeleton" style="height:40px;margin-top:8px;"></div>
        <div class="skeleton" style="height:40px;margin-top:8px;"></div>
      </div>
    </div>`;
}

/* ─── VUE PROFESSEUR ─────────────────────────────────────── */
function renderProfPanel(metrics) {
  const nav = state.activeNav;
  const courses = state.dashboard?.courses || [];
  const grades  = state.dashboard?.grades  || [];
  const users   = state.dashboard?.users   || [];
  const ann     = state.dashboard?.announcements || [];
  const meet    = state.dashboard?.meetings || [];
  const bulls   = state.dashboard?.bulletins || [];
  const myCourses = courses.filter(c => c.teacher_id === state.user.id);
  const students  = users.filter(u => u.role === 'STUDENT');

  if (nav === 'overview') return renderProfOverview(metrics, myCourses, grades, students);
  if (nav === 'grades')   return renderProfGrades(myCourses, students, grades);
  if (nav === 'courses')  return renderProfCourses(myCourses, grades, students);
  if (nav === 'bulletins') return renderProfBulletins(bulls, users, myCourses);
  if (nav === 'announcements') return `<div class="card card-pad"><div class="section-title"><h2>📢 Annonces</h2></div><div style="display:grid;gap:10px;">${ann.map(a=>`<div class="card card-pad-sm" style="padding:14px;"><div class="font-bold text-sm">${escapeHtml(a.title)}</div><div class="muted text-xs" style="margin-top:4px;">${escapeHtml(a.body)}</div></div>`).join('')||'<div class="muted text-sm">Aucune annonce.</div>'}</div></div>`;
  if (nav === 'meetings')      return `<div class="card card-pad"><div class="section-title"><h2>🤝 Réunions de parents</h2></div><div style="display:grid;gap:10px;">${meet.map(m=>`<div class="card card-pad-sm" style="padding:14px;"><div class="font-bold text-sm">🤝 ${escapeHtml(m.title)}</div><div class="muted text-xs" style="margin-top:4px;">${escapeHtml(m.body)}</div></div>`).join('')||'<div class="muted text-sm">Aucune réunion.</div>'}</div></div>`;
  return '';
}

function renderProfOverview(metrics, myCourses, grades, students) {
  const userInfo = state.dashboard?.users?.find(u => u.id === state.user.id) || state.user;
  const photo = userInfo.profile_photo_url || userInfo.profilePhoto || '';
  const initials = (userInfo.name||'P').split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase();
  return `
    <div class="hero-banner animate-fade-up">
      <div class="hero-banner-content" style="display:flex;align-items:center;gap:24px;">
        <div style="width:72px;height:72px;border-radius:20px;overflow:hidden;flex-shrink:0;border:3px solid rgba(14,165,233,0.5);box-shadow:0 0 24px rgba(14,165,233,0.3);background:var(--grad-indigo);display:grid;place-items:center;font-weight:800;font-size:1.3rem;">
          ${photo ? `<img src="${escapeHtml(photo)}" alt="Photo" style="width:100%;height:100%;object-fit:cover;" />` : escapeHtml(initials)}
        </div>
        <div>
          <div class="hero-greeting">Bonjour Prof. <span class="name">${escapeHtml(state.user.name)} 🧑‍🏫</span></div>
          <div class="hero-sub">Gérez vos cours, saisissez les notes de vos élèves et suivez leurs progrès en temps réel.</div>
          <div class="hero-badges" style="margin-top:14px;">
            <span class="badge badge-sky">${myCourses.length} cours assignés</span>
            <span class="badge badge-emerald live">Notes actives</span>
          </div>
        </div>
      </div>
    </div>
    <div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);">
      <div class="card card-pad metric-card">
        <div class="metric-icon sky">📚</div>
        <div class="metric-value">${myCourses.length}</div>
        <div class="metric-label">Mes cours</div>
      </div>
      <div class="card card-pad metric-card">
        <div class="metric-icon emerald">📝</div>
        <div class="metric-value">${grades.filter(g=>myCourses.some(c=>c.id===g.course_id)).length}</div>
        <div class="metric-label">Notes saisies</div>
      </div>
      <div class="card card-pad metric-card">
        <div class="metric-icon gold">📊</div>
        <div class="metric-value">${metrics.mean}/20</div>
        <div class="metric-label">Moyenne générale</div>
      </div>
    </div>
    <div class="card card-pad">
      <div class="section-title">
        <h2>📚 Mes cours</h2>
        <button id="print-professor-report" class="button button-primary small">🖨️ Imprimer la fiche</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Cours</th><th>Classe</th><th>Élève</th><th>Devoir/8</th><th>Examen/12</th><th>Moyenne</th><th>Mention</th></tr></thead>
          <tbody>
            ${myCourses.length ? myCourses.map(c=>{
              const cg = grades.filter(g=>g.course_id===c.id);
              if (!cg.length) return `<tr><td colspan="7" class="muted text-sm">${escapeHtml(c.title)} • ${escapeHtml(c.class_name)} — Aucune note</td></tr>`;
              return cg.map(g=>{
                const s = students.find(u=>u.id===g.student_id);
                const avg = calculateWeightedAverage(g.homework, g.exam);
                return `<tr>
                  <td class="font-bold">${escapeHtml(c.title)}</td>
                  <td><span class="badge badge-indigo text-xs">${escapeHtml(c.class_name)}</span></td>
                  <td>${escapeHtml(s?.name||'Élève')}</td>
                  <td>${g.homework}</td><td>${g.exam}</td>
                  <td class="font-bold">${avg}/20</td>
                  <td><span class="grade-badge ${getMentionClass(avg)}">${getMention(avg)}</span></td>
                </tr>`;
              }).join('');
            }).join('') : '<tr><td colspan="7" class="muted text-sm">Aucun cours assigné.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderProfGrades(myCourses, students, grades) {
  return `
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="section-title"><h2>📝 Saisie rapide des notes</h2></div>
        <form id="grade-form" class="form-grid">
          <select name="courseId" class="select">
            ${myCourses.map(c=>`<option value="${c.id}">${escapeHtml(c.title)} • ${escapeHtml(c.class_name)}</option>`).join('')}
          </select>
          <select name="studentId" class="select">
            ${students.map(s=>`<option value="${s.id}">${escapeHtml(s.name)} — ${escapeHtml(s.class_name||'—')}</option>`).join('')}
          </select>
          <div class="grid grid-2">
            <div class="field">
              <label class="field-label">Devoir (sur 8)</label>
              <input name="homework" type="number" step="0.1" class="input" min="0" max="8" required />
            </div>
            <div class="field">
              <label class="field-label">Examen (sur 12)</label>
              <input name="exam" type="number" step="0.1" class="input" min="0" max="12" required />
            </div>
          </div>
          <input name="semester" class="input" placeholder="Semestre" value="Semestre 1" />
          <button class="button button-emerald">💾 Enregistrer la note</button>
        </form>
      </div>
      <div class="card card-pad">
        <div class="section-title"><h2>📋 Saisie par tableau</h2></div>
        <select id="grade-table-course-select" class="select" style="margin-bottom:14px;">
          ${myCourses.map(c=>`<option value="${c.id}">${escapeHtml(c.title)} • ${escapeHtml(c.class_name)}</option>`).join('')}
        </select>
        <div id="grade-table"></div>
      </div>
    </div>`;
}

function renderProfCourses(myCourses, grades, students) {
  return `
    <div class="card card-pad">
      <div class="section-title">
        <h2>📚 Mes cours assignés</h2>
        <span class="badge badge-sky">${myCourses.length} cours</span>
      </div>
      <div style="display:grid;gap:14px;">
        ${myCourses.map(c=>{
          const cg = grades.filter(g=>g.course_id===c.id);
          const avgAll = cg.length ? (cg.reduce((s,g)=>s+calculateWeightedAverage(g.homework,g.exam),0)/cg.length).toFixed(2) : '—';
          return `<div class="card card-pad-sm" style="padding:18px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
              <div>
                <div class="font-bold">${escapeHtml(c.title)}</div>
                <div class="muted text-xs">${escapeHtml(c.class_name)}</div>
              </div>
              <div style="text-align:right;">
                <div class="font-bold">${avgAll !== '—' ? avgAll+'/20' : '—'}</div>
                <div class="muted text-xs">${cg.length} élève${cg.length>1?'s':''} noté${cg.length>1?'s':''}</div>
              </div>
            </div>
            ${cg.length ? `<div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,(Number(avgAll)/20)*100)}%;"></div></div>` : ''}
          </div>`;
        }).join('')||'<div class="muted text-sm">Aucun cours assigné.</div>'}
      </div>
    </div>`;
}

function renderProfBulletins(bulls, users, myCourses) {
  const myStudentIds = new Set();
  const grades = state.dashboard?.grades||[];
  grades.filter(g=>myCourses.some(c=>c.id===g.course_id)).forEach(g=>myStudentIds.add(g.student_id));
  const myBulls = bulls.filter(b=>myStudentIds.has(b.student_id));
  return `
    <div class="card card-pad">
      <div class="section-title">
        <h2>📄 Bulletins de mes élèves</h2>
        <a href="/api/bulletins/export.pdf" target="_blank" class="button button-amber small" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:var(--radius);font-weight:700;font-size:0.83rem;background:linear-gradient(135deg,#f59e0b,#ef4444);color:white;width:auto;">📑 PDF</a>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Élève</th><th>Classe</th><th>Période</th><th>Moyenne</th><th>Mention</th><th>Commentaire</th></tr></thead>
          <tbody>
            ${myBulls.map(b=>{
              const s = users.find(u=>u.id===b.student_id);
              const avg = Number(b.average||0);
              return `<tr>
                <td class="font-bold">${escapeHtml(s?.name||b.student_name||'Élève')}</td>
                <td>${escapeHtml(b.class_name||'—')}</td>
                <td>${escapeHtml(b.period||'—')}</td>
                <td class="font-bold">${avg}/20</td>
                <td><span class="grade-badge ${getMentionClass(avg)}">${getMention(avg)}</span></td>
                <td class="muted text-xs">${escapeHtml(b.comment||'—')}</td>
              </tr>`;
            }).join('')||'<tr><td colspan="6" class="muted text-sm">Aucun bulletin disponible.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ─── VUE ÉLÈVE ──────────────────────────────────────────── */
function renderStudentPanel(metrics) {
  const nav   = state.activeNav;
  const users = state.dashboard?.users || [];
  const userInfo = users.find(u=>u.id===state.user.id) || state.user;
  const grades  = (state.dashboard?.grades||[]).filter(g=>g.student_id===state.user.id);
  const bulls   = (state.dashboard?.bulletins||[]).filter(b=>b.student_id===state.user.id);
  const courses = state.dashboard?.courses||[];
  const ann     = state.dashboard?.announcements||[];
  const meet    = state.dashboard?.meetings||[];

  if (nav === 'overview') return renderStudentOverview(userInfo, grades, bulls, courses, metrics, ann, meet);
  if (nav === 'grades')   return renderStudentGrades(grades, courses);
  if (nav === 'bulletins')return renderStudentBulletins(bulls);
  if (nav === 'courses')  return renderStudentCourses(courses);
  if (nav === 'announcements') return `<div class="card card-pad"><div class="section-title"><h2>📢 Annonces</h2></div><div style="display:grid;gap:10px;">${ann.map(a=>`<div class="card card-pad-sm" style="padding:14px;"><div class="font-bold text-sm">${escapeHtml(a.title)}</div><div class="muted text-xs" style="margin-top:4px;">${escapeHtml(a.body)}</div></div>`).join('')||'<div class="muted text-sm">Aucune annonce.</div>'}</div></div>`;
  if (nav === 'meetings')      return `<div class="card card-pad"><div class="section-title"><h2>🤝 Réunions de parents</h2></div><div style="display:grid;gap:10px;">${meet.map(m=>`<div class="card card-pad-sm" style="padding:14px;"><div class="font-bold text-sm">🤝 ${escapeHtml(m.title)}</div><div class="muted text-xs" style="margin-top:4px;">${escapeHtml(m.body)}</div></div>`).join('')||'<div class="muted text-sm">Aucune réunion.</div>'}</div></div>`;
  return '';
}

function renderStudentOverview(userInfo, grades, bulls, courses, metrics, ann, meet) {
  const photo = userInfo.profile_photo_url || userInfo.profilePhoto || '';
  const initials = (userInfo.name||'E').split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase();
  return `
    <div class="hero-banner animate-fade-up">
      <div class="hero-banner-content" style="display:flex;align-items:center;gap:24px;">
        <div style="width:72px;height:72px;border-radius:20px;overflow:hidden;flex-shrink:0;border:3px solid rgba(16,185,129,0.5);box-shadow:0 0 24px rgba(16,185,129,0.3);background:var(--grad-emerald);display:grid;place-items:center;font-weight:800;font-size:1.3rem;">
          ${photo ? `<img src="${escapeHtml(photo)}" alt="Photo" style="width:100%;height:100%;object-fit:cover;" />` : escapeHtml(initials)}
        </div>
        <div>
          <div class="hero-greeting">Bonjour <span class="name">${escapeHtml(state.user.name)} 📚</span></div>
          <div class="hero-sub">Suivez vos résultats, consultez vos bulletins et restez informé des dernières nouvelles de l'établissement.</div>
          <div class="hero-badges" style="margin-top:14px;">
            <span class="badge badge-sky">${escapeHtml(userInfo.class_name||'Classe non définie')}</span>
            <span class="badge badge-gold">Année 2025-2026</span>
          </div>
        </div>
      </div>
    </div>
    <div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);">
      <div class="card card-pad metric-card">
        <div class="metric-icon indigo">🎯</div>
        <div class="metric-value">${grades.length}</div>
        <div class="metric-label">Notes reçues</div>
      </div>
      <div class="card card-pad metric-card">
        <div class="metric-icon gold">📊</div>
        <div class="metric-value">${grades.length ? (grades.reduce((s,g)=>s+calculateWeightedAverage(g.homework,g.exam),0)/grades.length).toFixed(2) : '—'}/20</div>
        <div class="metric-label">Ma moyenne</div>
      </div>
      <div class="card card-pad metric-card">
        <div class="metric-icon emerald">📄</div>
        <div class="metric-value">${bulls.length}</div>
        <div class="metric-label">Bulletins</div>
      </div>
    </div>
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="section-title"><h2>🎯 Mes derniers résultats</h2></div>
        ${grades.length ? grades.slice(0,5).map(g=>{
          const c = courses.find(cc=>cc.id===g.course_id);
          const avg = calculateWeightedAverage(g.homework,g.exam);
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);">
            <div>
              <div class="font-bold text-sm">${escapeHtml(c?.title||'Cours')}</div>
              <div class="muted text-xs">Devoir: ${g.homework}/8 • Examen: ${g.exam}/12</div>
            </div>
            <div style="text-align:right;">
              <div class="font-bold">${avg}/20</div>
              <span class="grade-badge ${getMentionClass(avg)} text-xs">${getMention(avg)}</span>
            </div>
          </div>`;
        }).join('') : '<div class="muted text-sm">Aucune note publiée.</div>'}
      </div>
      <div class="card card-pad">
        <div class="section-title"><h2>📢 Dernières annonces</h2></div>
        <div style="display:grid;gap:10px;">
          ${ann.slice(0,3).map(a=>`<div class="card card-pad-sm" style="padding:12px 14px;">
            <div class="font-bold text-sm">${escapeHtml(a.title)}</div>
            <div class="muted text-xs" style="margin-top:4px;">${escapeHtml(a.body)}</div>
          </div>`).join('')||'<div class="muted text-sm">Aucune annonce.</div>'}
        </div>
      </div>
    </div>`;
}

function renderStudentGrades(grades, courses) {
  return `
    <div class="card card-pad">
      <div class="section-title"><h2>🎯 Mes résultats</h2><span class="badge badge-gold">${grades.length} notes</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Cours</th><th>Classe</th><th>Devoir/8</th><th>Examen/12</th><th>Moyenne/20</th><th>Mention</th></tr></thead>
          <tbody>
            ${grades.length ? grades.map(g=>{
              const c = courses.find(cc=>cc.id===g.course_id);
              const avg = calculateWeightedAverage(g.homework,g.exam);
              return `<tr>
                <td class="font-bold">${escapeHtml(c?.title||'Cours')}</td>
                <td><span class="badge badge-indigo text-xs">${escapeHtml(c?.class_name||'—')}</span></td>
                <td>${g.homework}</td><td>${g.exam}</td>
                <td class="font-bold">${avg}/20</td>
                <td><span class="grade-badge ${getMentionClass(avg)}">${getMention(avg)}</span></td>
              </tr>`;
            }).join('') : '<tr><td colspan="6" class="muted text-sm">Aucune note publiée.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderStudentBulletins(bulls) {
  return `
    <div class="card card-pad">
      <div class="section-title"><h2>📄 Mes bulletins</h2><span class="badge badge-emerald">${bulls.length}</span></div>
      ${bulls.length ? `<div style="display:grid;gap:14px;">
        ${bulls.map(b=>{
          const avg = Number(b.average||0);
          return `<div class="card card-pad-sm" style="padding:20px;border-left:3px solid var(--indigo);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div>
                <div class="font-bold">${escapeHtml(b.period||'Semestre')}</div>
                <div class="muted text-xs">${escapeHtml(b.class_name||'—')}</div>
              </div>
              <div style="text-align:right;">
                <div class="metric-value" style="font-size:1.5rem;">${avg}/20</div>
                <span class="grade-badge ${getMentionClass(avg)}">${getMention(avg)}</span>
              </div>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,(avg/20)*100)}%;"></div></div>
            ${b.comment?`<div class="muted text-xs" style="margin-top:10px;">💬 ${escapeHtml(b.comment)}</div>`:''}
            ${b.file_url?`<a href="${escapeHtml(b.file_url)}" target="_blank" class="link-inline" style="display:inline-block;margin-top:8px;">Voir le PDF →</a>`:''}
          </div>`;
        }).join('')}
      </div>` : '<div class="muted text-sm">Aucun bulletin disponible pour le moment.</div>'}
    </div>`;
}

function renderStudentCourses(courses) {
  return `
    <div class="card card-pad">
      <div class="section-title"><h2>📚 Cours disponibles</h2></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px;">
        <select id="enroll-course-select" class="select" style="flex:1;min-width:200px;">
          ${courses.map(c=>`<option value="${c.id}">${escapeHtml(c.title)} • ${escapeHtml(c.class_name)}</option>`).join('')}
        </select>
        <button id="enroll-btn" class="button button-emerald" style="width:auto;">✅ S'inscrire</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Cours</th><th>Classe</th><th></th></tr></thead>
          <tbody>
            ${courses.map(c=>`<tr>
              <td class="font-bold">${escapeHtml(c.title)}</td>
              <td><span class="badge badge-indigo text-xs">${escapeHtml(c.class_name)}</span></td>
              <td><button class="tiny-btn" data-action="quick-enroll" data-course-id="${c.id}">S'inscrire</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ─── PAGE D'AUTHENTIFICATION ────────────────────────────── */
function renderAuth() {
  app.innerHTML = `
    <div class="auth-layout">
      <div class="auth-wrap">
        <div class="auth-left">
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:28px;">
            <div style="width:120px;height:120px;border-radius:32px;background:var(--grad-indigo);display:grid;place-items:center;font-size:3.5rem;box-shadow:0 0 80px rgba(99,102,241,0.5),var(--shadow-indigo);">🎓</div>
            <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:3rem;font-weight:800;letter-spacing:-0.04em;background:linear-gradient(135deg,#818cf8,#a78bfa,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-align:center;">Samsite</div>
            <div style="color:var(--text-3);font-size:0.9rem;letter-spacing:0.12em;text-transform:uppercase;text-align:center;">Plateforme Scolaire</div>
            <div style="width:48px;height:3px;border-radius:99px;background:var(--grad-indigo);"></div>
            <div style="color:var(--text-3);font-size:0.78rem;text-align:center;margin-top:auto;">© 2026 Samsite</div>
          </div>
        </div>
        <div class="auth-right">
          <div class="auth-tabs">
            <div class="auth-tab active" id="tab-login">Connexion</div>
            <div class="auth-tab" id="tab-register">Créer un compte</div>
          </div>

          <div class="auth-tab-panel active" id="panel-login">
            <div class="auth-form-title">Content de vous revoir 👋</div>
            <div class="auth-form-sub">Entrez vos identifiants pour accéder à votre espace.</div>
            ${state.error ? `<div class="toast-error" style="margin-bottom:16px;">⚠️ ${escapeHtml(state.error)}</div>` : ''}
            <form id="login-form" class="form-group">
              <div class="field">
                <label class="field-label">Adresse email</label>
                <input name="email" type="email" class="input" placeholder="votre@email.com" required />
              </div>
              <div class="field">
                <label class="field-label">Mot de passe</label>
                <input name="password" type="password" class="input" placeholder="••••••••" required />
              </div>
              <button class="button button-primary">🔓 Se connecter</button>
            </form>
          </div>

          <div class="auth-tab-panel" id="panel-register">
            <div class="auth-form-title">Créer un compte élève</div>
            <div class="auth-form-sub">Rejoignez la plateforme et suivez vos résultats.</div>
            <form id="register-form" class="form-group">
              <div class="field">
                <label class="field-label">Nom complet</label>
                <input name="name" class="input" placeholder="Jean Dupont" required />
              </div>
              <div class="field">
                <label class="field-label">Email</label>
                <input name="email" type="email" class="input" placeholder="votre@email.com" required />
              </div>
              <div class="field">
                <label class="field-label">Mot de passe</label>
                <input name="password" type="password" class="input" placeholder="Min. 6 caractères" required />
              </div>
              <div class="field">
                <label class="field-label">Classe</label>
                <select name="className" class="select">
                  ${CLASSES.map(c=>`<option value="${c}">${c}</option>`).join('')}
                </select>
              </div>
              <input type="hidden" name="registerAvatarUrl" id="registerAvatarUrl" value="" />
              <div class="field">
                <div class="input-label">Photo de profil</div>
                <div class="profile-upload-row">
                  <button type="button" id="select-register-photo-btn" class="button button-primary small">📎 Choisir une photo</button>
                  <button type="button" id="remove-register-photo-btn" class="button button-amber small">✕ Supprimer</button>
                </div>
                <div id="register-photo-preview" class="profile-upload-preview" style="margin-top:8px;"><span class="muted small">Aucune photo sélectionnée</span></div>
                <input type="file" id="register-profile-photo-file" accept="image/*" style="display:none" />
              </div>
              <button class="button button-emerald">🎓 Créer mon compte</button>
            </form>
          </div>
        </div>
      </div>
    </div>`;

  /* Onglets */
  document.getElementById('tab-login')?.addEventListener('click', () => {
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('panel-login').classList.add('active');
    document.getElementById('panel-register').classList.remove('active');
  });
  document.getElementById('tab-register')?.addEventListener('click', () => {
    document.getElementById('tab-register').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('panel-register').classList.add('active');
    document.getElementById('panel-login').classList.remove('active');
  });

  /* Login */
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await login(String(f.get('email')||''), String(f.get('password')||''));
  });

  /* Register */
  document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email    = String(f.get('email')||'');
    const password = String(f.get('password')||'');
    const photoFile = document.getElementById('register-profile-photo-file')?.files?.[0];
    const photo = photoFile ? await readFileAsDataURL(photoFile) : '';
    try {
      await registerStudent({ name:String(f.get('name')||''), email, password, className:String(f.get('className')||''), profilePhoto:photo });
      showToast('Compte créé avec succès !', 'success');
      await login(email, password);
    } catch(err) {
      state.error = err.message; render();
    }
  });

  document.getElementById('select-register-photo-btn')?.addEventListener('click', () => document.getElementById('register-profile-photo-file')?.click());
  document.getElementById('remove-register-photo-btn')?.addEventListener('click', () => {
    const inp = document.getElementById('register-profile-photo-file');
    const prev = document.getElementById('register-photo-preview');
    if (inp) inp.value = '';
    if (prev) prev.innerHTML = '<span class="muted small">Aucune photo sélectionnée</span>';
  });
  document.getElementById('register-profile-photo-file')?.addEventListener('change', async (e) => {
    const file = e.target?.files?.[0];
    const prev = document.getElementById('register-photo-preview');
    if (!file) { if (prev) prev.innerHTML = '<span class="muted small">Aucune photo sélectionnée</span>'; return; }
    const url = URL.createObjectURL(file);
    if (prev) prev.innerHTML = `<img src="${url}" alt="Aperçu" style="max-width:100%;max-height:80px;border-radius:10px;" />`;
  });

  /* Avatars register — supprimés */
}

/* ─── Gestionnaires d'événements ─────────────────────────── */
function attachEventHandlers() {
  /* Logout */
  document.getElementById('logout-btn')?.addEventListener('click', logout);

  /* Navigation sidebar */
  document.querySelectorAll('.nav-item[data-nav]').forEach(item => {
    item.addEventListener('click', () => {
      state.activeNav = item.getAttribute('data-nav');
      render();
    });
  });

  /* Formulaire créer utilisateur */
  document.getElementById('user-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const photoFile = document.getElementById('create-profile-photo-file')?.files?.[0];
    const profilePhoto = photoFile ? await readFileAsDataURL(photoFile) : String(f.get('profilePhoto')||'');
    try {
      await createUser({ name:String(f.get('name')||''), email:String(f.get('email')||''), password:String(f.get('password')||''), role:String(f.get('role')||'STUDENT'), phone:String(f.get('phone')||''), bio:String(f.get('bio')||''), profilePhoto });
      showToast('Compte créé !','success');
    } catch(err) { showToast(err.message,'error'); }
  });

  /* Photo create */
  document.getElementById('select-create-photo-btn')?.addEventListener('click', () => document.getElementById('create-profile-photo-file')?.click());
  document.getElementById('remove-create-photo-btn')?.addEventListener('click', () => {
    const inp = document.getElementById('create-profile-photo-file');
    const prev = document.getElementById('create-photo-preview');
    const hid  = document.getElementById('profilePhoto');
    if (inp) inp.value=''; if (hid) hid.value='';
    if (prev) prev.innerHTML='<span class="muted small">Aucune photo</span>';
  });
  document.getElementById('create-profile-photo-file')?.addEventListener('change', async (e) => {
    const file = e.target?.files?.[0];
    const prev = document.getElementById('create-photo-preview');
    if (!file) { if(prev) prev.innerHTML='<span class="muted small">Aucune</span>'; return; }
    const url = URL.createObjectURL(file);
    if (prev) prev.innerHTML=`<img src="${url}" alt="Aperçu" style="max-width:100%;max-height:80px;border-radius:10px;" />`;
  });

  /* Photo profil utilisateur (changer) */
  document.getElementById('profile-photo-file')?.addEventListener('change', async (e) => {
    const file = e.target?.files?.[0];
    if (!file || !pendingUserPhotoUploadId) return;
    try {
      const photo = await readFileAsDataURL(file);
      await updateUser(pendingUserPhotoUploadId, { profilePhoto: photo });
      showToast('Photo mise à jour !','success');
    } finally { pendingUserPhotoUploadId=null; e.target.value=''; }
  });

  /* Délégation de clics (actions sur boutons dynamiques) */
  document.body.addEventListener('click', async (e) => {
    const t = (e.target instanceof HTMLElement ? e.target : null)?.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    const uid  = t.getAttribute('data-user-id');
    const cid  = t.getAttribute('data-course-id');

    if (action==='delete-user' && uid) {
      if (!confirm('Supprimer ce profil ?')) return;
      try { await deleteUser(Number(uid)); showToast('Utilisateur supprimé','success'); } catch(err){showToast(err.message,'error');}
    }
    if (action==='toggle-pw' && uid) {
      const el = document.getElementById(`pw-display-${uid}`);
      if (!el) return;
      const pw = t.getAttribute('data-pw') || '(chiffré)';
      if (el.textContent.trim() === '••••••••') {
        el.textContent = pw;
        el.style.color = 'var(--gold-light)';
        t.textContent = '🙈';
      } else {
        el.textContent = '••••••••';
        el.style.color = 'var(--text-3)';
        t.textContent = '👁️';
      }
    }
    if (action==='change-pw' && uid) {
      const u = (state.dashboard?.users||[]).find(x=>x.id===Number(uid));
      if (!u) return;
      const newPw = prompt(`Nouveau mot de passe pour ${u.name} :`);
      if (!newPw || !newPw.trim()) return;
      try {
        await updateUser(Number(uid), { password: newPw.trim() });
        showToast(`Mot de passe de ${u.name} mis à jour !`, 'success');
      } catch(err) { showToast(err.message, 'error'); }
    }
    if (action==='change-photo' && uid) {
      pendingUserPhotoUploadId = Number(uid);
      document.getElementById('profile-photo-file')?.click();
    }
    if (action==='delete-photo' && uid) {
      if (!confirm('Supprimer la photo de profil ?')) return;
      await updateUser(Number(uid), { profilePhoto:'' });
      showToast('Photo supprimée','success');
    }
    if (action==='edit-user' && uid) {
      const u = (state.dashboard?.users||[]).find(x=>x.id===Number(uid));
      if (!u) return;
      const name = prompt('Nom complet', u.name||''); if(name===null) return;
      const email = prompt('Email', u.email||''); if(email===null) return;
      const role  = prompt('Rôle (ADMIN/PROFESSOR/STUDENT)', u.role||'STUDENT'); if(role===null) return;
      const cls   = prompt('Classe', u.class_name||''); if(cls===null) return;
      const phone = prompt('Téléphone', u.phone||''); if(phone===null) return;
      const bio   = prompt('Biographie', u.bio||''); if(bio===null) return;
      const pw    = prompt('Nouveau mot de passe (vide = inchangé)');
      await updateUser(Number(uid),{name,email,role:role.toUpperCase(),className:cls,phone,bio,...(pw?{password:pw}:{})});
      showToast('Profil mis à jour !','success');
    }
    if (action==='edit-course' && cid) {
      const c = (state.dashboard?.courses||[]).find(x=>x.id===Number(cid));
      if (!c) return;
      const title = prompt('Titre', c.title||''); if(title===null) return;
      const cls   = prompt('Classe', c.class_name||''); if(cls===null) return;
      let tid = c.teacher_id;
      if (state.user.role==='ADMIN') { const r=prompt('ID Professeur',String(tid)); if(r===null) return; tid=Number(r); }
      await request(`/api/courses/${cid}`,{method:'PUT',body:JSON.stringify({title,className:cls,teacherId:tid})});
      await refreshDashboard(); render();
      showToast('Cours modifié !','success');
    }
    if (action==='delete-course' && cid) {
      if (!confirm('Supprimer ce cours ?')) return;
      await request(`/api/courses/${cid}`,{method:'DELETE'});
      await refreshDashboard(); render();
      showToast('Cours supprimé','success');
    }
    if (action==='quick-enroll' && cid) {
      try {
        await request('/api/enroll',{method:'POST',body:JSON.stringify({courseId:Number(cid)})});
        showToast('Inscription réussie !','success');
        await refreshDashboard(); render();
      } catch(err){ showToast(err.message,'error'); }
    }
  });

  /* Formulaire cours */
  document.getElementById('course-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await createCourse({title:String(f.get('title')||''),className:String(f.get('className')||''),teacherId:Number(f.get('teacherId')||0)});
      showToast('Cours créé !','success');
    } catch(err){showToast(err.message,'error');}
  });

  /* Formulaire annonce */
  document.getElementById('announcement-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await createAnnouncement({title:String(f.get('title')||''),body:String(f.get('body')||'')});
    showToast('Annonce publiée !','success');
  });

  /* Formulaire réunion */
  document.getElementById('meeting-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await createMeeting({title:String(f.get('title')||''),body:String(f.get('body')||'')});
    showToast('Réunion planifiée !','success');
  });

  /* Formulaire bulletin */
  document.getElementById('bulletin-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await createBulletin({studentId:Number(f.get('studentId')||0),className:String(f.get('className')||''),period:String(f.get('period')||'Semestre 1'),comment:String(f.get('comment')||'')});
    showToast('Bulletin généré !','success');
  });

  /* Formulaire note (prof) */
  document.getElementById('grade-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await createGrade({studentId:Number(f.get('studentId')||0),courseId:Number(f.get('courseId')||0),homework:Number(f.get('homework')||0),exam:Number(f.get('exam')||0),semester:String(f.get('semester')||'Semestre 1')});
    showToast('Note enregistrée !','success');
  });

  /* Tableau de saisie rapide (prof) */
  const gradeTableSelect = document.getElementById('grade-table-course-select');
  if (gradeTableSelect) {
    const buildTable = () => {
      const cid = Number(gradeTableSelect.value);
      const course  = (state.dashboard?.courses||[]).find(c=>c.id===cid);
      const students = (state.dashboard?.users||[]).filter(u=>u.role==='STUDENT'&&(!course||u.class_name===course.class_name));
      const el = document.getElementById('grade-table');
      if (!el) return;
      el.innerHTML = students.map(s=>`
        <div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
          <div style="flex:1;font-size:0.88rem;font-weight:600;">${escapeHtml(s.name)}</div>
          <input data-sid="${s.id}" data-cid="${cid}" class="input" style="width:120px;" placeholder="Devoir/8" type="number" min="0" max="8" step="0.1" />
          <input data-sid="${s.id}" data-cid="${cid}" class="input" style="width:120px;" placeholder="Examen/12" type="number" min="0" max="12" step="0.1" />
          <button class="tiny-btn" data-action="save-row" data-sid="${s.id}" data-cid="${cid}">💾</button>
        </div>`).join('') || '<div class="muted text-sm">Aucun élève dans cette classe.</div>';
      el.querySelectorAll('[data-action="save-row"]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const sid=Number(btn.getAttribute('data-sid')), cid2=Number(btn.getAttribute('data-cid'));
          const inputs=[...el.querySelectorAll(`input[data-sid="${sid}"][data-cid="${cid2}"]`)];
          const hw=Number(inputs[0]?.value||0), ex=Number(inputs[1]?.value||0);
          await createGrade({studentId:sid,courseId:cid2,homework:hw,exam:ex,semester:'Semestre 1'});
          showToast('Note enregistrée !','success');
        });
      });
    };
    gradeTableSelect.addEventListener('change', buildTable);
    buildTable();
  }

  /* Imprimer fiche prof */
  document.getElementById('print-professor-report')?.addEventListener('click', () => {
    const courses = state.dashboard?.courses||[];
    const grades  = state.dashboard?.grades||[];
    const students= (state.dashboard?.users||[]).filter(u=>u.role==='STUDENT');
    const myCourses= courses.filter(c=>c.teacher_id===state.user.id);
    const rows = myCourses.map(c=>{
      const cg=grades.filter(g=>g.course_id===c.id);
      if(!cg.length) return `<tr><td colspan="6">${escapeHtml(c.title)} — Aucune note</td></tr>`;
      return cg.map(g=>{
        const s=students.find(u=>u.id===g.student_id);
        const avg=calculateWeightedAverage(g.homework,g.exam);
        return `<tr><td>${escapeHtml(c.title)}</td><td>${escapeHtml(c.class_name)}</td><td>${escapeHtml(s?.name||'Élève')}</td><td>${g.homework}</td><td>${g.exam}</td><td>${avg}</td></tr>`;
      }).join('');
    }).join('');
    const html=`<table><thead><tr><th>Cours</th><th>Classe</th><th>Élève</th><th>Devoir</th><th>Examen</th><th>Moyenne</th></tr></thead><tbody>${rows}</tbody></table>`;
    const w=window.open('','_blank','width=900,height=700');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Fiche cours</title><style>body{font-family:sans-serif;margin:24px;color:#111;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:10px;}th{background:#f4f4f5;}</style></head><body><h1>Fiche de cours</h1>${html}</body></html>`);
    w.document.close(); w.focus(); w.print();
  });

  /* Export CSV */
  document.getElementById('export-bulletins-csv')?.addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/bulletins/export',{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!resp.ok) throw new Error('Erreur export');
      const blob=await resp.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download='bulletins.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showToast('Export CSV téléchargé !','success');
    } catch(e){ showToast('Impossible d\'exporter','error'); }
  });

  /* Inscription cours (élève) */
  document.getElementById('enroll-btn')?.addEventListener('click', async () => {
    const sel=document.getElementById('enroll-course-select');
    if (!sel) return;
    try {
      await request('/api/enroll',{method:'POST',body:JSON.stringify({courseId:Number(sel.value)})});
      showToast('Inscription réussie !','success');
      await refreshDashboard(); render();
    } catch(e){ showToast(e.message,'error'); }
  });

  /* Logs admin */
  if (state.user?.role==='ADMIN' && state.activeNav==='logs') {
    (async () => {
      try {
        const data=await request('/api/logs');
        const panel=document.getElementById('logs-panel');
        if(!panel) return;
        panel.innerHTML=(data.logs||[]).map(l=>`
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <div><strong>${escapeHtml(l.actor_name||'Système')}</strong> — ${escapeHtml(l.action)}</div>
              <div class="text-xs muted">${escapeHtml(l.created_at)}</div>
            </div>
            ${l.details?`<div class="muted text-xs" style="margin-top:4px;">${escapeHtml(l.details)}</div>`:''}
          </div>`).join('')||'<div class="muted text-sm">Aucun log disponible.</div>';
      } catch { const panel=document.getElementById('logs-panel'); if(panel) panel.innerHTML='<div class="muted text-sm">Impossible de charger les logs.</div>'; }
    })();
  }
}

/* ─── Démarrage ──────────────────────────────────────────── */
bootstrap();
