import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cfg = window.CHOMP_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey
  && !String(cfg.supabaseUrl).includes("YOUR_PROJECT")
  && !String(cfg.supabaseAnonKey).includes("YOUR_SUPABASE"));

const supabase = configured
  ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

let session = null;
let bootstrap = null;
let viewAs = null;
let activeTab = "dashboard";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fmtPts = (n) => {
  const x = round2(n);
  return x.toFixed(2).replace(/\.?0+$/, "");
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

function toast(msg, kind = "info") {
  const el = document.createElement("div");
  el.className = "toast " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "");
  el.textContent = msg;
  $("toast-wrap").appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function setSync(state) {
  const d = $("syncDot");
  if (!d) return;
  d.className = "sync" + (state === "loading" ? " loading" : state === "err" ? " err" : "");
  d.title = state === "loading" ? "Loading…" : state === "err" ? "Error" : "Ready";
}

function isAdmin() {
  return (bootstrap?.me?.roles || []).includes("admin");
}

function isIosSafari() {
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
  return iOS && !standalone;
}

function showIosInstallBanner() {
  const banner = $("iosInstall");
  if (!banner) return;
  try {
    if (localStorage.getItem("chomp_ios_install_dismissed") === "1") return;
  } catch (_) {}
  if (isIosSafari()) banner.classList.add("visible");
}

async function logEvent(type, payload = {}) {
  if (!supabase || !session) return;
  try {
    await supabase.rpc("log_app_event", { p_type: type, p_payload: payload });
  } catch (_) {
    /* non-fatal for PMF logging */
  }
}

async function getBootstrap() {
  const { data, error } = await supabase.rpc("get_bootstrap", { view_as: viewAs || null });
  if (error) throw error;
  return data;
}

async function toggleChore(choreId) {
  const { data, error } = await supabase.rpc("toggle_chore", {
    chore_id: choreId,
    view_as: viewAs || null,
  });
  if (error) throw error;
  return data;
}

async function redeemReward(rewardId) {
  const { data, error } = await supabase.rpc("redeem_reward", {
    reward_id: rewardId,
    view_as: viewAs || null,
  });
  if (error) throw error;
  return data;
}

function todayEarnedFromBootstrap() {
  const chores = bootstrap?.chores || [];
  const checked = bootstrap?.progress?.checked || {};
  // Solo chores (no group_key)
  let solo = 0;
  const groups = {};
  for (const c of chores) {
    if (c.group_key) {
      if (!groups[c.group_key]) groups[c.group_key] = [];
      groups[c.group_key].push(c);
    } else if (checked[c.id]) {
      solo += Number(c.pts) || 0;
    }
  }
  let grp = 0;
  for (const g of Object.keys(groups)) {
    const members = groups[g];
    if (members.length && members.every((c) => checked[c.id])) {
      grp += members.reduce((s, c) => s + (Number(c.pts) || 0), 0);
    }
  }
  return round2(solo + grp);
}

function updateBank() {
  const pts = Number(bootstrap?.progress?.points ?? 0);
  const el = $("bankPts");
  el.textContent = (pts < 0 ? "−" : "") + fmtPts(Math.abs(pts));
  el.className = "bank-pts " + (pts > 0 ? "positive" : pts < 0 ? "negative" : "zero");
  const who = viewAs
    ? (bootstrap?.householdMembers || []).find((m) => m.id === viewAs)?.username
    : bootstrap?.me?.username;
  $("bankSub").textContent = pts === 0
    ? "Start checking off chores!"
    : `${fmtPts(Math.abs(pts))} pts ${pts < 0 ? "in debt" : "saved up"}${who ? " · " + cap(who) : ""}`;

  const chores = bootstrap?.chores || [];
  const checked = bootstrap?.progress?.checked || {};
  const done = chores.filter((c) => checked[c.id]).length;
  $("bankProgress").innerHTML = chores.length
    ? `<strong>${done}</strong>/${chores.length} done`
    : "No chores";
  $("bankDate").textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });

  const target = Number(bootstrap?.settings?.daily_target ?? 15);
  const earned = todayEarnedFromBootstrap();
  const pct = target > 0 ? Math.min(100, Math.round((earned / target) * 100)) : 0;
  $("targetLabel").innerHTML = `<strong>${fmtPts(earned)}</strong> / ${fmtPts(target)} pts`;
  const bar = $("targetBar");
  bar.style.width = pct + "%";
  bar.className = "progress-fill" + (earned >= target ? " hit" : "");
}

function fillImpersonate() {
  const wrap = $("viewAsWrap");
  const sel = $("viewAsSelect");
  if (!isAdmin()) {
    wrap.classList.remove("visible");
    return;
  }
  wrap.classList.add("visible");
  const members = (bootstrap?.householdMembers || []).filter((m) =>
    (m.roles || []).includes("chore")
  );
  sel.innerHTML = '<option value="">— Select a user —</option>'
    + members.map((m) => `<option value="${m.id}">${esc(cap(m.username))}</option>`).join("");
  sel.value = viewAs || "";
}

function renderDashboard() {
  const list = $("choreList");
  if (isAdmin() && !viewAs) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">👤</div>Select a user in <strong>Impersonate</strong> to see their dashboard.</div>';
    $("dashSub").textContent = "Select a user to view their dashboard";
    return;
  }
  const chores = bootstrap?.chores || [];
  const checked = bootstrap?.progress?.checked || {};
  if (!chores.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">📋</div>No chores yet.</div>';
    $("dashSub").textContent = "No chores set up";
    return;
  }
  const groups = {};
  const solos = [];
  for (const c of chores) {
    if (c.group_key) {
      if (!groups[c.group_key]) groups[c.group_key] = [];
      groups[c.group_key].push(c);
    } else solos.push(c);
  }
  let html = "";
  for (const g of Object.keys(groups)) {
    const members = groups[g];
    const dc = members.filter((c) => checked[c.id]).length;
    const gp = round2(members.reduce((s, c) => s + (Number(c.pts) || 0), 0));
    const allDone = dc === members.length;
    html += `<div class="chore-item" style="cursor:default;opacity:.95"><div class="chore-body"><div class="chore-name">${esc(g)} <span style="font-size:10px;color:var(--accent)">group</span></div><div class="chore-meta">${dc}/${members.length} done · ${fmtPts(gp)} pts when complete</div></div><div class="pts-badge ${allDone ? "earned" : ""}">${allDone ? "✓ " : "🔒 "}${fmtPts(gp)}</div></div>`;
    for (const c of members) {
      const ck = !!checked[c.id];
      html += `<div class="chore-item ${ck ? "done" : ""}" data-chore="${esc(c.id)}" style="margin-left:12px"><div class="chore-check ${ck ? "checked" : ""}">${ck ? "✓" : ""}</div><div class="chore-body"><div class="chore-name">${esc(c.name)}</div></div><div class="pts-badge">${fmtPts(c.pts)}</div></div>`;
    }
  }
  for (const c of solos) {
    const ck = !!checked[c.id];
    html += `<div class="chore-item ${ck ? "done" : ""}" data-chore="${esc(c.id)}"><div class="chore-check ${ck ? "checked" : ""}">${ck ? "✓" : ""}</div><div class="chore-body"><div class="chore-name">${esc(c.name)}</div><div class="chore-meta">Individual · ${fmtPts(c.pts)} pts</div></div><div class="pts-badge ${ck ? "earned" : ""}">${ck ? "✓ " : "+"}${fmtPts(c.pts)}</div></div>`;
  }
  list.innerHTML = html;
  const done = chores.filter((c) => checked[c.id]).length;
  $("dashSub").textContent = done === chores.length && chores.length
    ? "All done! Amazing work!"
    : `${done} of ${chores.length} completed`;
}

function renderRewards() {
  const list = $("rewardList");
  if (isAdmin() && !viewAs) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">👤</div>Select a user to see rewards.</div>';
    return;
  }
  const rewards = (bootstrap?.rewards || []).filter((r) =>
    !viewAs || r.assignee_id === viewAs
  );
  const pts = Number(bootstrap?.progress?.points ?? 0);
  if (!rewards.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">🎁</div>No rewards yet.</div>';
    return;
  }
  list.innerHTML = rewards.map((r) => {
    const isTimer = r.type === "timer";
    const cost = isTimer ? null : Number(r.cost) || 0;
    const can = isTimer || pts >= cost;
    const meta = isTimer
      ? `⏱ ${fmtPts(r.timer_pts)} pts / ${r.timer_hours} hr`
      : `${fmtPts(cost)} pts`;
    return `<div class="reward-item" style="cursor:default">
      <div class="reward-body"><div class="reward-name">${esc(r.name)}</div><div class="reward-meta">${meta}</div></div>
      ${isTimer
        ? `<span class="pts-badge">Timer</span>`
        : `<button class="btn btn-sm ${can ? "btn-primary" : ""}" data-reward="${esc(r.id)}" ${can ? "" : "disabled"} type="button">${can ? "Redeem" : "Short"}</button>`}
    </div>`;
  }).join("");
}

function renderHistory() {
  const list = $("historyList");
  if (isAdmin() && !viewAs) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">👤</div>Select a user to see history.</div>';
    return;
  }
  const days = bootstrap?.historyDays || [];
  if (!days.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">📜</div>No history yet.</div>';
    return;
  }
  list.innerHTML = days.map((day, i) => {
    const entries = [...(day.entries || [])].reverse();
    const rows = entries.map((e) => `
      <div class="history-entry" style="cursor:default;border:none;border-bottom:1px solid var(--border);border-radius:0">
        <div class="history-entry-body">
          <div class="chore-name">${esc(e.label)}</div>
          <div class="history-entry-time">${esc(e.entry_time)} · ${esc(e.type)}</div>
        </div>
        <div class="pts-badge ${Number(e.pts) >= 0 ? "earned" : ""}">${Number(e.pts) !== 0 ? (Number(e.pts) > 0 ? "+" : "") + fmtPts(e.pts) : ""}</div>
      </div>`).join("");
    return `<div class="history-day">
      <div class="history-day-hd" data-hday="${i}">
        <div><div class="history-day-title">${esc(day.day)}</div>
        <div class="bank-stat">Earned ${fmtPts(day.daily_earned)} · Spent ${fmtPts(day.daily_spent)}${day.penalty ? ` · Penalty ${fmtPts(day.penalty)}` : ""}</div></div>
      </div>
      <div class="history-entries ${i === 0 ? "" : "hidden"}" id="hday-${i}">${rows || '<div class="empty">No entries</div>'}</div>
    </div>`;
  }).join("");
}

function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("tab-dashboard").classList.toggle("hidden", tab !== "dashboard");
  $("tab-rewards").classList.toggle("hidden", tab !== "rewards");
  $("tab-history").classList.toggle("hidden", tab !== "history");
  if (tab === "dashboard") renderDashboard();
  if (tab === "rewards") renderRewards();
  if (tab === "history") renderHistory();
}

function renderAll() {
  $("userLabel").textContent = cap(bootstrap?.me?.username || "");
  fillImpersonate();
  updateBank();
  showTab(activeTab);
}

async function refresh() {
  setSync("loading");
  try {
    bootstrap = await getBootstrap();
    // Admin with no viewAs: auto-pick first chore user for a usable dashboard
    if (isAdmin() && !viewAs) {
      const first = (bootstrap.householdMembers || []).find((m) => (m.roles || []).includes("chore"));
      if (first) {
        viewAs = first.id;
        try { sessionStorage.setItem("chomp_viewas", viewAs); } catch (_) {}
        bootstrap = await getBootstrap();
      }
    }
    renderAll();
    setSync("ok");
  } catch (e) {
    setSync("err");
    toast(e.message || "Failed to load", "err");
  }
}

function showScreen(name) {
  $("setupScreen").classList.toggle("hidden", name !== "setup");
  $("loginScreen").classList.toggle("hidden", name !== "login");
  $("appShell").classList.toggle("hidden", name !== "app");
}

async function enterApp() {
  showScreen("app");
  showIosInstallBanner();
  try {
    const saved = sessionStorage.getItem("chomp_viewas");
    if (saved) viewAs = saved;
  } catch (_) {}
  await refresh();
  await logEvent("app_open", { source: "web-pwa", standalone: window.matchMedia("(display-mode: standalone)").matches });
}

async function doLogin() {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  const err = $("loginError");
  err.textContent = "";
  if (!email || !password) {
    err.textContent = "Enter email and password";
    return;
  }
  $("loginBtn").disabled = true;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  $("loginBtn").disabled = false;
  if (error) {
    err.textContent = error.message;
    return;
  }
  session = data.session;
  await enterApp();
}

async function doLogout() {
  viewAs = null;
  bootstrap = null;
  try { sessionStorage.removeItem("chomp_viewas"); } catch (_) {}
  await supabase.auth.signOut();
  session = null;
  showScreen("login");
}

function wireEvents() {
  $("loginBtn")?.addEventListener("click", doLogin);
  $("loginPassword")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
  $("logoutBtn")?.addEventListener("click", doLogout);
  $("iosInstallDismiss")?.addEventListener("click", () => {
    $("iosInstall").classList.remove("visible");
    try { localStorage.setItem("chomp_ios_install_dismissed", "1"); } catch (_) {}
  });
  $("viewAsSelect")?.addEventListener("change", async (e) => {
    viewAs = e.target.value || null;
    try {
      if (viewAs) sessionStorage.setItem("chomp_viewas", viewAs);
      else sessionStorage.removeItem("chomp_viewas");
    } catch (_) {}
    await refresh();
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
  $("choreList")?.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-chore]");
    if (!row) return;
    const id = row.getAttribute("data-chore");
    setSync("loading");
    try {
      bootstrap = await toggleChore(id);
      await logEvent("chore_toggle", { chore_id: id });
      renderAll();
      setSync("ok");
      toast("Updated", "ok");
    } catch (err) {
      setSync("err");
      toast(err.message || "Toggle failed", "err");
    }
  });
  $("rewardList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-reward]");
    if (!btn || btn.disabled) return;
    const id = btn.getAttribute("data-reward");
    setSync("loading");
    try {
      bootstrap = await redeemReward(id);
      await logEvent("reward_redeem", { reward_id: id });
      renderAll();
      setSync("ok");
      toast("Redeemed!", "ok");
    } catch (err) {
      setSync("err");
      toast(err.message || "Redeem failed", "err");
    }
  });
  $("historyList")?.addEventListener("click", (e) => {
    const hd = e.target.closest("[data-hday]");
    if (!hd) return;
    const i = hd.getAttribute("data-hday");
    $("hday-" + i)?.classList.toggle("hidden");
  });
}

async function boot() {
  wireEvents();

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/sw.js"); } catch (_) {}
  }

  if (!configured) {
    showScreen("setup");
    return;
  }

  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (session) await enterApp();
  else showScreen("login");

  supabase.auth.onAuthStateChange((_event, next) => {
    session = next;
    if (!session) showScreen("login");
  });
}

boot();
