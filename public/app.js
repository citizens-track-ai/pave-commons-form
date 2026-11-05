/**
 * PAVE Form Application Logic
 * Supports new submission and editing of existing cases with valid EditKey
 * Multi-stage tabbed navigation with real-time stage completion tick-marks
 */

const STAFF_TOKEN_STORAGE_KEY = "pave_nocodb_staff_token";

const state = {
  isEditMode: false,
  caseId: null,
  editKey: null,
  workflowStatus: "Submission",
  curationDecision: "",
  submissionIntent: "nomination",
  currentStageId: "stage-1",
  leadOrganisations: [],      // Array of { id, name, website?, locations?: [] }
  fundingOrganisations: [],
  involvedOrganisations: [],
  participants: [],          // Array of participant group objects (including locations: [])
  resources: [],             // Array of resource objects
  messages: [],              // Array of message objects: { id, title, text, type }
  photosAndImages: [],       // Array of { url, thumbUrl, title }
  methodImage: [],           // Array of { url, thumbUrl, title }
  methodImageCaption: "",
  geographicScope: [],
  staffToken: null,
  staffUser: null,           // { id, email, displayName, role }
  staffCanEdit: false,
  assignedTo: [],            // Array of { id, email, displayName }
  assignableUsers: [],       // Array of { id, email, displayName }
  comments: [],              // Array of NocoDB record comments
  revisions: [],             // Array of NocoDB record revision audit entries
  activityWarning: null,
  activeDrawerTab: "comments",
};

window.paveFormState = state;

const STAGES_CONFIG = [
  { id: "stage-1", label: "About You", isFullOnly: false },
  { id: "stage-2", label: "Project Details", isFullOnly: false },
  { id: "stage-3", label: "Organisations", isFullOnly: true },
  { id: "stage-4", label: "Participants", isFullOnly: true },
  { id: "stage-5", label: "Outputs", isFullOnly: true },
  { id: "stage-6", label: "Resources", isFullOnly: true },
  { id: "stage-7", label: "Review & Submit", isFullOnly: false },
];

function getActiveStages() {
  const isFull = state.submissionIntent === "full" || state.isEditMode;
  return STAGES_CONFIG.filter((s) => !s.isFullOnly || isFull).map((s) => {
    if (s.id === "stage-7" && state.isEditMode) {
      return { ...s, label: "Preview / Save" };
    }
    return s;
  });
}

function isStageComplete(stageId) {
  switch (stageId) {
    case "stage-1": {
      const email = (document.getElementById("submitterEmail")?.value || "").trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
    case "stage-2": {
      const title = (document.getElementById("projectTitle")?.value || "").trim();
      const url = (document.getElementById("projectUrl")?.value || "").trim();
      const desc = (document.getElementById("projectDescription")?.value || "").trim();
      return title.length > 0 && isValidClientUrl(url) && desc.length >= 5;
    }
    case "stage-3": {
      return (
        state.leadOrganisations.length > 0 ||
        state.fundingOrganisations.length > 0 ||
        state.involvedOrganisations.length > 0
      );
    }
    case "stage-4": {
      const inclusion = (document.getElementById("inclusionEfforts")?.value || "").trim();
      const limitations = (document.getElementById("limitations")?.value || "").trim();
      return state.participants.length > 0 || inclusion.length > 0 || limitations.length > 0;
    }
    case "stage-5": {
      const findings = (document.getElementById("headlineFindings")?.value || "").trim();
      const aiAssistance = getCheckedValues("aiAssistance");
      const hasMessages = state.messages.some((m) => m.text && m.text.trim().length > 0);
      return findings.length > 0 || aiAssistance.length > 0 || hasMessages;
    }
    case "stage-6": {
      const published = getCheckedValues("publishedResources");
      const photos = getCheckedValues("photosAvailable");
      return (
        published.length > 0 ||
        state.resources.length > 0 ||
        photos.length > 0 ||
        state.photosAndImages.length > 0
      );
    }
    case "stage-7": {
      if (state.isEditMode) {
        return getDirtyScopes().length === 0;
      }
      return Boolean(document.getElementById("consentCheck")?.checked);
    }
    default:
      return false;
  }
}

function renderStageTabs() {
  const tabsList = document.getElementById("formTabsList");
  if (!tabsList) return;

  const activeStages = getActiveStages();
  tabsList.innerHTML = "";

  activeStages.forEach((stage, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stage-tab-btn";
    btn.id = `tab-${stage.id}`;
    btn.dataset.stageId = stage.id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", stage.id === state.currentStageId ? "true" : "false");
    btn.setAttribute("aria-controls", stage.id);

    const isDone = isStageComplete(stage.id);
    if (isDone) btn.classList.add("is-complete");
    if (stage.id === state.currentStageId) btn.classList.add("is-active");

    btn.innerHTML = `
      <span class="tab-badge">
        <span class="tab-num">${idx + 1}</span>
        <span class="tab-tick" aria-hidden="true">&#10003;</span>
      </span>
      <span class="tab-label">${escapeHtml(stage.label)}</span>
    `;

    btn.addEventListener("click", () => {
      goToStage(stage.id);
    });

    tabsList.appendChild(btn);
  });

  updateStageProgress();
}

function updateStageProgress() {
  const activeStages = getActiveStages();
  let completedCount = 0;

  activeStages.forEach((stage) => {
    const isDone = isStageComplete(stage.id);
    if (isDone) completedCount++;

    const tabBtn = document.getElementById(`tab-${stage.id}`);
    if (tabBtn) {
      if (isDone) {
        tabBtn.classList.add("is-complete");
      } else {
        tabBtn.classList.remove("is-complete");
      }
      if (stage.id === state.currentStageId) {
        tabBtn.classList.add("is-active");
        tabBtn.setAttribute("aria-selected", "true");
      } else {
        tabBtn.classList.remove("is-active");
        tabBtn.setAttribute("aria-selected", "false");
      }
    }
  });

  const total = activeStages.length;
  const currentIdx = activeStages.findIndex((s) => s.id === state.currentStageId);
  const currentNum = currentIdx >= 0 ? currentIdx + 1 : 1;
  const currentStage = activeStages[currentIdx] || activeStages[0];

  const labelEl = document.getElementById("stageProgressLabel");
  const percentEl = document.getElementById("stageProgressPercent");
  const fillEl = document.getElementById("stageProgressFill");

  if (labelEl) {
    labelEl.textContent = `Stage ${currentNum} of ${total}: ${currentStage ? currentStage.label : ""}`;
  }
  const pct = Math.round((completedCount / total) * 100);
  if (percentEl) {
    percentEl.textContent = `${completedCount} of ${total} Completed (${pct}%)`;
  }
  if (fillEl) {
    fillEl.style.width = `${pct}%`;
  }

  if (window.PaveLivePreview && typeof window.PaveLivePreview.render === "function") {
    window.PaveLivePreview.render();
  }
}

function goToStage(targetStageId, options = {}) {
  const activeStages = getActiveStages();
  const exists = activeStages.some((s) => s.id === targetStageId);
  if (!exists) targetStageId = activeStages[0].id;

  const previousStageId = state.currentStageId;
  state.currentStageId = targetStageId;

  // In edit mode, automatically save any dirty changes when moving between stages
  if (state.isEditMode && !options.skipAutoSave && previousStageId !== targetStageId) {
    saveEditChanges();
  }

  // Show only current stage
  document.querySelectorAll(".form-stage").forEach((panel) => {
    if (panel.id === targetStageId) {
      panel.classList.remove("hidden");
    } else {
      panel.classList.add("hidden");
    }
  });

  // Update dynamic Next / Back links based on current active stages sequence
  const isFull = state.submissionIntent === "full" || state.isEditMode;

  const stage2NextBtn = document.getElementById("stage2NextBtn");
  if (stage2NextBtn) {
    stage2NextBtn.dataset.target = isFull ? "stage-3" : "stage-7";
    stage2NextBtn.innerHTML = isFull ? "Next: Organisations &rarr;" : "Next: Review &amp; Submit &rarr;";
  }

  const stage6NextBtn = document.getElementById("stage6NextBtn");
  if (stage6NextBtn) {
    stage6NextBtn.dataset.target = "stage-7";
    stage6NextBtn.innerHTML = state.isEditMode
      ? "Next: Preview / Save &rarr;"
      : "Next: Review &amp; Submit &rarr;";
  }

  const stage7ConsentFieldset = document.getElementById("stage7ConsentFieldset");
  const consentCheck = document.getElementById("consentCheck");
  if (stage7ConsentFieldset && consentCheck) {
    if (state.isEditMode) {
      stage7ConsentFieldset.classList.add("hidden");
      consentCheck.required = false;
    } else {
      stage7ConsentFieldset.classList.remove("hidden");
      consentCheck.required = true;
    }
  }

  const stage7PrevBtn = document.getElementById("stage7PrevBtn");
  if (stage7PrevBtn) {
    stage7PrevBtn.dataset.target = isFull ? "stage-6" : "stage-2";
    stage7PrevBtn.innerHTML = isFull ? "&larr; Back: Supporting Resources" : "&larr; Back: Project Details";
  }

  if (window.PaveLivePreview && typeof window.PaveLivePreview.onStageChanged === "function") {
    window.PaveLivePreview.onStageChanged(targetStageId);
  }

  updateStageProgress();

  // Scroll smoothly to stage tabs container
  const navContainer = document.querySelector(".stage-nav-container");
  if (navContainer) {
    navContainer.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function initStageNavigation() {
  document.addEventListener("click", (e) => {
    const nextBtn = e.target.closest(".btn-next-stage");
    if (nextBtn) {
      const target = nextBtn.dataset.target;
      if (target) goToStage(target);
      return;
    }

    const prevBtn = e.target.closest(".btn-prev-stage");
    if (prevBtn) {
      const target = prevBtn.dataset.target;
      if (target) goToStage(target);
      return;
    }
  });

  // Listen to input and change events across the whole form to update tick marks immediately
  const form = document.getElementById("caseForm");
  if (form) {
    form.addEventListener("input", () => {
      updateStageProgress();
      refreshDirtyStateUI();
    });
    form.addEventListener("change", () => {
      updateStageProgress();
      refreshDirtyStateUI();
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initAboutLanding();
  initIntentToggle();
  initStageNavigation();
  initOrgPickers();
  initParticipantManager();
  initResourceManager();
  initPhotoManager();
  initMessagesManager();
  initStaffAuthAndDrawer();
  initEditAutoSaveControls();
  initFormSubmission();
  if (window.PaveLivePreview && typeof window.PaveLivePreview.init === "function") {
    window.PaveLivePreview.init();
  }
  await restoreStaffSession();
  await checkEditMode();
  renderStageTabs();
  renderMessagesTable();
  goToStage("stage-1", { skipAutoSave: true });
});

let hasVisitedForm = false;
let returnToSuccessScreen = false;

function updateAboutMenuState(isAboutVisible) {
  const aboutMenuBtn = document.getElementById("topMenuAboutBtn");
  const newEntryBtn = document.getElementById("topMenuNewEntryBtn");
  const startBtn = document.getElementById("startSubmissionBtn");

  if (aboutMenuBtn) {
    aboutMenuBtn.classList.toggle("is-active", Boolean(isAboutVisible));
    aboutMenuBtn.setAttribute("aria-pressed", isAboutVisible ? "true" : "false");
  }
  if (newEntryBtn) {
    const isNewActive = !state.isEditMode && !isAboutVisible;
    newEntryBtn.classList.toggle("is-active", isNewActive);
    newEntryBtn.setAttribute("aria-pressed", isNewActive ? "true" : "false");
  }
  if (startBtn) {
    if (state.isEditMode) {
      startBtn.innerHTML = "&larr; Back to Editing Case";
    } else if (returnToSuccessScreen) {
      startBtn.innerHTML = "&larr; Back to Submission Confirmation";
    } else if (hasVisitedForm) {
      startBtn.innerHTML = "Return to Form &rarr;";
    } else {
      startBtn.innerHTML = "Next &rarr;";
    }
  }
}

function showAboutScreen() {
  const aboutSection = document.getElementById("aboutIntroSection");
  const caseForm = document.getElementById("caseForm");
  const successScreen = document.getElementById("submissionSuccessScreen");

  if (successScreen && !successScreen.classList.contains("hidden")) {
    returnToSuccessScreen = true;
    successScreen.classList.add("hidden");
  }
  if (caseForm && !caseForm.classList.contains("hidden")) {
    hasVisitedForm = true;
    caseForm.classList.add("hidden");
  }
  if (aboutSection) {
    aboutSection.classList.remove("hidden");
  }
  updateAboutMenuState(true);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function hideAboutScreen() {
  const aboutSection = document.getElementById("aboutIntroSection");
  const caseForm = document.getElementById("caseForm");
  const successScreen = document.getElementById("submissionSuccessScreen");

  if (aboutSection) {
    aboutSection.classList.add("hidden");
  }
  if (returnToSuccessScreen && successScreen) {
    returnToSuccessScreen = false;
    successScreen.classList.remove("hidden");
  } else if (caseForm) {
    hasVisitedForm = true;
    caseForm.classList.remove("hidden");
  }
  updateAboutMenuState(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function initAboutLanding() {
  const startBtn = document.getElementById("startSubmissionBtn");
  const backBtn = document.getElementById("backToAboutBtn");
  const topAboutBtn = document.getElementById("topMenuAboutBtn");
  const newEntryBtn = document.getElementById("topMenuNewEntryBtn");
  const aboutSection = document.getElementById("aboutIntroSection");

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      hideAboutScreen();
    });
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      showAboutScreen();
    });
  }

  if (topAboutBtn) {
    topAboutBtn.addEventListener("click", () => {
      const isAboutVisible = aboutSection && !aboutSection.classList.contains("hidden");
      if (isAboutVisible && (state.isEditMode || hasVisitedForm || returnToSuccessScreen)) {
        hideAboutScreen();
      } else {
        showAboutScreen();
      }
    });
  }

  if (newEntryBtn) {
    newEntryBtn.addEventListener("click", (e) => {
      if (!state.isEditMode) {
        e.preventDefault();
        hideAboutScreen();
        goToStage("stage-1", { skipAutoSave: true });
      }
    });
  }
}

/* -------------------------------------------------------------
 * 0. NocoDB Staff Authentication & Comments/History Drawer
 * ------------------------------------------------------------- */
function getStaffHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (state.staffToken) {
    headers["X-Noco-Token"] = state.staffToken;
  }
  return headers;
}

function saveStaffTokenToStorage(token) {
  try {
    localStorage.setItem(STAFF_TOKEN_STORAGE_KEY, token);
  } catch (_) { }
  try {
    sessionStorage.setItem(STAFF_TOKEN_STORAGE_KEY, token);
  } catch (_) { }
}

function clearStaffTokenFromStorage() {
  try {
    localStorage.removeItem(STAFF_TOKEN_STORAGE_KEY);
  } catch (_) { }
  try {
    sessionStorage.removeItem(STAFF_TOKEN_STORAGE_KEY);
  } catch (_) { }
}

function getStaffTokenFromStorage() {
  try {
    const fromLocal = localStorage.getItem(STAFF_TOKEN_STORAGE_KEY);
    if (fromLocal) return fromLocal;
  } catch (_) { }
  try {
    const fromSession = sessionStorage.getItem(STAFF_TOKEN_STORAGE_KEY);
    if (fromSession) {
      // Migrate existing session token to localStorage so it persists across tabs/reloads
      try {
        localStorage.setItem(STAFF_TOKEN_STORAGE_KEY, fromSession);
      } catch (_) { }
      return fromSession;
    }
  } catch (_) { }
  return null;
}

async function restoreStaffSession() {
  const savedToken = getStaffTokenFromStorage();
  if (!savedToken) return;

  try {
    const res = await fetch("/api/auth/me", {
      headers: { "X-Noco-Token": savedToken },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        state.staffToken = savedToken;
        state.staffUser = data.user;
        state.staffCanEdit = Boolean(data.canEdit);
        if (Array.isArray(data.assignableUsers)) {
          state.assignableUsers = data.assignableUsers;
        }
        updateStaffAuthUI();
        return;
      }
    }
    if (res.status === 401 || res.status === 403) {
      clearStaffTokenFromStorage();
    }
  } catch (_) {
    // Keep stored token if network request failed transiently
  }
}

function populateAssignedToSelect() {
  const assignedSelect = document.getElementById("staffAssignedTo");
  if (!assignedSelect) return;

  const userMap = new Map();
  const addOptionUser = (u) => {
    if (!u || typeof u !== "object") return;
    const id = String(u.id || "").trim();
    const email = String(u.email || "").trim();
    if (!id && !email) return;
    const key = id || email.toLowerCase();
    if (!userMap.has(key)) {
      userMap.set(key, {
        id: id || email,
        email,
        displayName: u.displayName || u.display_name || email || id,
      });
    }
  };

  (state.assignableUsers || []).forEach(addOptionUser);
  if (state.staffUser) addOptionUser(state.staffUser);
  (state.assignedTo || []).forEach(addOptionUser);

  const currentAssigned = Array.isArray(state.assignedTo) && state.assignedTo.length > 0
    ? state.assignedTo[0]
    : null;
  const selectedId = currentAssigned ? String(currentAssigned.id || currentAssigned.email || "") : "";

  assignedSelect.innerHTML = "";
  const unassignedOpt = document.createElement("option");
  unassignedOpt.value = "";
  unassignedOpt.textContent = "Unassigned";
  assignedSelect.appendChild(unassignedOpt);

  for (const u of userMap.values()) {
    const opt = document.createElement("option");
    opt.value = u.id;
    const isSelf =
      state.staffUser &&
      ((state.staffUser.id && u.id === state.staffUser.id) ||
        (state.staffUser.email && u.email && u.email.toLowerCase() === state.staffUser.email.toLowerCase()));
    opt.textContent = isSelf && !u.displayName.includes("(You)")
      ? `${u.displayName} (You)`
      : u.displayName;
    assignedSelect.appendChild(opt);
  }

  assignedSelect.value = selectedId;
}

function updateStaffAuthUI() {
  const loginBtn = document.getElementById("staffLoginBtn");
  const activeBadge = document.getElementById("staffActiveBadge");
  const userLabel = document.getElementById("staffUserLabel");
  const composerAttr = document.getElementById("composerAttribution");

  if (state.staffUser) {
    if (loginBtn) {
      loginBtn.textContent = "Sign out";
      loginBtn.title = "Sign out of staff session";
    }
    if (activeBadge) activeBadge.classList.remove("hidden");
    if (userLabel) {
      const name = (state.staffUser.displayName || "").trim();
      const email = (state.staffUser.email || "").trim();
      const labelText =
        name && email && !name.includes(email)
          ? `${name} (${email})`
          : name || email || "Signed in";
      userLabel.textContent = labelText;
      userLabel.title = labelText;
    }
    if (composerAttr) {
      composerAttr.textContent = `Posting as ${state.staffUser.displayName || state.staffUser.email}`;
    }
  } else {
    if (loginBtn) {
      loginBtn.textContent = "Sign in";
      loginBtn.title = "Sign in with NocoDB";
    }
    if (activeBadge) activeBadge.classList.add("hidden");
  }
}

async function logoutStaff() {
  state.staffToken = null;
  state.staffUser = null;
  state.staffCanEdit = false;
  state.comments = [];
  state.revisions = [];
  clearStaffTokenFromStorage();
  closeStaffDrawer();
  updateStaffAuthUI();
  await checkEditMode();
}

function initStaffAuthAndDrawer() {
  const loginBtn = document.getElementById("staffLoginBtn");
  const logoutBtn = document.getElementById("staffLogoutBtn");
  const loginModal = document.getElementById("staffLoginModal");
  const tokenInput = document.getElementById("staffTokenInput");
  const cancelLoginBtn = document.getElementById("cancelStaffLoginBtn");
  const confirmLoginBtn = document.getElementById("confirmStaffLoginBtn");
  const loginError = document.getElementById("staffLoginError");

  const openDrawerBtn = document.getElementById("openDrawerBtn");
  const closeDrawerBtn = document.getElementById("closeDrawerBtn");
  const backdrop = document.getElementById("staffDrawerBackdrop");
  const tabCommentsBtn = document.getElementById("drawerTabCommentsBtn");
  const tabHistoryBtn = document.getElementById("drawerTabHistoryBtn");
  const commentForm = document.getElementById("drawerCommentForm");

  if (loginBtn && loginModal) {
    loginBtn.addEventListener("click", () => {
      if (state.staffUser) {
        logoutStaff();
        return;
      }
      if (tokenInput) tokenInput.value = "";
      if (loginError) {
        loginError.textContent = "";
        loginError.classList.add("hidden");
      }
      loginModal.showModal();
      setTimeout(() => tokenInput?.focus(), 50);
    });
  }

  if (cancelLoginBtn && loginModal) {
    cancelLoginBtn.addEventListener("click", () => loginModal.close());
  }

  if (confirmLoginBtn && loginModal) {
    confirmLoginBtn.addEventListener("click", async () => {
      const rawToken = (tokenInput?.value || "").trim();
      if (!rawToken || rawToken.length < 10) {
        if (loginError) {
          loginError.textContent = "Please paste a valid NocoDB personal API token.";
          loginError.classList.remove("hidden");
        }
        return;
      }

      confirmLoginBtn.disabled = true;
      confirmLoginBtn.textContent = "Verifying...";
      if (loginError) loginError.classList.add("hidden");

      try {
        const res = await fetch("/api/auth/me", {
          headers: { "X-Noco-Token": rawToken },
        });
        const data = await res.json();

        if (!res.ok || !data.authenticated) {
          throw new Error(data.error || "Could not verify NocoDB API token.");
        }

        state.staffToken = rawToken;
        state.staffUser = data.user;
        state.staffCanEdit = Boolean(data.canEdit);
        if (Array.isArray(data.assignableUsers)) {
          state.assignableUsers = data.assignableUsers;
        }
        saveStaffTokenToStorage(rawToken);

        updateStaffAuthUI();
        loginModal.close();

        // Re-check edit mode in case we are viewing a Completed case or ?id=... URL
        await checkEditMode();
      } catch (err) {
        if (loginError) {
          loginError.textContent = err.message;
          loginError.classList.remove("hidden");
        }
      } finally {
        confirmLoginBtn.disabled = false;
        confirmLoginBtn.textContent = "Verify & Sign In";
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => logoutStaff());
  }

  if (openDrawerBtn) {
    openDrawerBtn.addEventListener("click", () => toggleStaffDrawer());
  }
  if (closeDrawerBtn) {
    closeDrawerBtn.addEventListener("click", () => closeStaffDrawer());
  }

  if (tabCommentsBtn) {
    tabCommentsBtn.addEventListener("click", () => switchDrawerTab("comments"));
  }
  if (tabHistoryBtn) {
    tabHistoryBtn.addEventListener("click", () => switchDrawerTab("history"));
  }

  if (commentForm) {
    commentForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await submitCaseComment();
    });
  }
}

function openStaffDrawer(tab) {
  if (tab) switchDrawerTab(tab);
  const drawer = document.getElementById("staffDrawer");
  const toggleBtn = document.getElementById("openDrawerBtn");
  if (drawer) drawer.classList.remove("hidden");
  document.body.classList.add("has-staff-drawer-open");
  if (toggleBtn) {
    toggleBtn.classList.add("is-active");
    toggleBtn.setAttribute("aria-expanded", "true");
  }
  renderDrawerContents();
}

function closeStaffDrawer() {
  const drawer = document.getElementById("staffDrawer");
  const toggleBtn = document.getElementById("openDrawerBtn");
  if (drawer) drawer.classList.add("hidden");
  document.body.classList.remove("has-staff-drawer-open");
  if (toggleBtn) {
    toggleBtn.classList.remove("is-active");
    toggleBtn.setAttribute("aria-expanded", "false");
  }
}

function toggleStaffDrawer(tab) {
  const drawer = document.getElementById("staffDrawer");
  if (drawer && !drawer.classList.contains("hidden")) {
    closeStaffDrawer();
  } else {
    openStaffDrawer(tab);
  }
}

function switchDrawerTab(tab) {
  state.activeDrawerTab = tab === "history" ? "history" : "comments";
  const tabCommentsBtn = document.getElementById("drawerTabCommentsBtn");
  const tabHistoryBtn = document.getElementById("drawerTabHistoryBtn");
  const panelComments = document.getElementById("drawerPanelComments");
  const panelHistory = document.getElementById("drawerPanelHistory");

  if (state.activeDrawerTab === "comments") {
    tabCommentsBtn?.classList.add("is-active");
    tabCommentsBtn?.setAttribute("aria-selected", "true");
    tabHistoryBtn?.classList.remove("is-active");
    tabHistoryBtn?.setAttribute("aria-selected", "false");
    panelComments?.classList.remove("hidden");
    panelHistory?.classList.add("hidden");
  } else {
    tabHistoryBtn?.classList.add("is-active");
    tabHistoryBtn?.setAttribute("aria-selected", "true");
    tabCommentsBtn?.classList.remove("is-active");
    tabCommentsBtn?.setAttribute("aria-selected", "false");
    panelHistory?.classList.remove("hidden");
    panelComments?.classList.add("hidden");
  }
}

function renderDrawerContents() {
  const countBadge = document.getElementById("drawerCountBadge");
  const commentsTabCount = document.getElementById("drawerCommentsTabCount");
  const historyTabCount = document.getElementById("drawerHistoryTabCount");
  const drawerTitle = document.getElementById("drawerTitle");
  const permNotice = document.getElementById("drawerPermissionNotice");
  const commentsListEl = document.getElementById("drawerCommentsList");
  const historyListEl = document.getElementById("drawerHistoryList");

  const cCount = state.comments.length;
  const hCount = state.revisions.length;

  if (countBadge) countBadge.textContent = String(cCount + hCount);
  if (commentsTabCount) commentsTabCount.textContent = String(cCount);
  if (historyTabCount) historyTabCount.textContent = String(hCount);
  if (drawerTitle && state.caseId) {
    drawerTitle.textContent = `Case #${state.caseId} Activity`;
  }

  if (permNotice) {
    if (state.activityWarning) {
      permNotice.innerHTML = `
        <strong>Token Scope Notice:</strong> ${escapeHtml(state.activityWarning)}
        <div><small>To read/write comments via API, ensure your NocoDB API token has <code>commentList</code> and <code>commentRow</code> permissions enabled (or use an unrestricted personal API token).</small></div>
      `;
      permNotice.classList.remove("hidden");
    } else {
      permNotice.classList.add("hidden");
      permNotice.innerHTML = "";
    }
  }

  // Render Comments
  if (commentsListEl) {
    if (cCount === 0) {
      commentsListEl.innerHTML = `<p class="empty-note">No comments on this case yet.</p>`;
    } else {
      commentsListEl.innerHTML = state.comments
        .map(
          (c) => `
          <div class="drawer-comment-card ${c.resolved ? "is-resolved" : ""}">
            <div class="comment-card-meta">
              <strong class="comment-author">${escapeHtml(c.user || "NocoDB User")}</strong>
              <span class="comment-date">${escapeHtml(formatTimestamp(c.createdAt))}</span>
            </div>
            <div class="comment-card-body">${escapeHtml(c.comment)}</div>
          </div>
        `
        )
        .join("");
    }
  }

  // Render Revision History
  if (historyListEl) {
    if (hCount === 0) {
      historyListEl.innerHTML = `<p class="empty-note">No revision history entries found for this case.</p>`;
    } else {
      historyListEl.innerHTML = state.revisions
        .map((rev) => {
          const hasFieldDiff = Boolean(rev.field);
          const beforeStr = formatAuditValue(rev.oldValue);
          const afterStr = formatAuditValue(rev.newValue);
          return `
            <div class="drawer-history-card">
              <div class="history-card-meta">
                <strong class="history-author">${escapeHtml(rev.user || "System")}</strong>
                <span class="history-date">${escapeHtml(formatTimestamp(rev.createdAt))}</span>
              </div>
              ${hasFieldDiff
              ? `<div class="history-field-name">Updated <code>${escapeHtml(rev.field)}</code></div>
                     <div class="history-diff">
                       <div class="diff-old"><span class="diff-label">Before:</span> ${escapeHtml(beforeStr)}</div>
                       <div class="diff-new"><span class="diff-label">After:</span> ${escapeHtml(afterStr)}</div>
                     </div>`
              : `<div class="history-desc">${escapeHtml(rev.description || rev.opSubType || rev.opType || "Record updated")}</div>`
            }
            </div>
          `;
        })
        .join("");
    }
  }
}

async function submitCaseComment() {
  if (!state.caseId || !state.staffToken) return;
  const input = document.getElementById("newCommentInput");
  const btn = document.getElementById("postCommentBtn");
  const errEl = document.getElementById("commentSubmitError");

  const commentText = (input?.value || "").trim();
  if (!commentText) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Posting...";
  }
  if (errEl) errEl.classList.add("hidden");

  try {
    const res = await fetch("/api/case/comments", {
      method: "POST",
      headers: getStaffHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        caseId: state.caseId,
        comment: commentText,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to post comment.");
    }

    if (input) input.value = "";
    state.comments = data.comments || [];
    state.revisions = data.revisions || state.revisions;
    state.activityWarning = data.permissionWarning || null;
    renderDrawerContents();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Post Comment";
    }
  }
}

function formatTimestamp(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

function formatAuditValue(val) {
  if (val === null || val === undefined || val === "") return "(empty)";
  if (Array.isArray(val)) {
    if (val.length === 0) return "(none / cleared)";
    return val
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const name = item.display_name || item.displayName || item.name || item.title || "";
        const email = item.email || "";
        if (name && email && !name.includes(email)) return `${name} (${email})`;
        return name || email || item.id || JSON.stringify(item);
      })
      .join(", ");
  }
  if (typeof val === "object") {
    const name = val.display_name || val.displayName || val.name || val.title || "";
    if (name) return name;
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  const str = String(val);
  return str.length > 250 ? str.slice(0, 250) + "…" : str;
}

/* -------------------------------------------------------------
 * 1. Edit Mode Detection & Pre-population
 * ------------------------------------------------------------- */
async function checkEditMode() {
  const params = new URLSearchParams(window.location.search);
  const editKey = params.get("editKey") || params.get("editkey") || "";
  const caseId = params.get("id") || params.get("caseId") || "";

  if (!editKey && !caseId) return;

  // Hide the initial About landing section and Back-to-About button when in edit mode
  const aboutIntroEl = document.getElementById("aboutIntroSection");
  if (aboutIntroEl) aboutIntroEl.classList.add("hidden");
  const backToAboutRow = document.getElementById("backToAboutRow");
  if (backToAboutRow) backToAboutRow.classList.add("hidden");
  updateAboutMenuState(false);

  const banner = document.getElementById("editBanner");
  const bannerTitle = document.getElementById("editBannerTitle");
  const bannerSubtitle = document.getElementById("editBannerSubtitle");
  const staffBadge = document.getElementById("editBannerStaffBadge");
  const workflowRow = document.getElementById("staffWorkflowRow");
  const workflowSelect = document.getElementById("staffWorkflowStatus");
  const openDrawerBtn = document.getElementById("openDrawerBtn");

  banner.classList.remove("error-banner");

  if (!state.staffCanEdit && editKey.length < 12) {
    banner.classList.remove("hidden");
    banner.classList.add("error-banner");
    bannerTitle.textContent = "Edit Access Denied";
    bannerSubtitle.textContent = caseId
      ? "A valid EditKey is required to edit this case, or click 'Sign in' above with your NocoDB account."
      : "The provided EditKey is invalid (must be at least 12 characters).";
    document.getElementById("caseForm").classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  bannerTitle.textContent = "Verifying Edit Credentials...";
  bannerSubtitle.textContent = "Fetching case details from database...";

  try {
    const queryParts = [];
    if (editKey) queryParts.push(`editKey=${encodeURIComponent(editKey)}`);
    if (caseId) queryParts.push(`id=${encodeURIComponent(caseId)}`);
    const url = `/api/case?${queryParts.join("&")}`;

    const res = await fetch(url, {
      headers: getStaffHeaders(),
    });
    const data = await res.json();

    if (!res.ok) {
      banner.classList.add("error-banner");
      bannerTitle.textContent = "Cannot Edit This Record";
      bannerSubtitle.textContent = data.error || "Unable to authorize editing for this record.";
      document.getElementById("caseForm").classList.add("hidden");
      return;
    }

    const c = data.case;
    if (data.staff && Array.isArray(data.staff.assignableUsers)) {
      state.assignableUsers = data.staff.assignableUsers;
    }
    state.isEditMode = true;
    state.caseId = c.id;
    state.editKey = c.editKey || editKey;
    state.workflowStatus = c.workflowStatus || "Submission";
    state.assignedTo = Array.isArray(c.assignedTo) ? c.assignedTo : [];
    state.curationDecision = c.curationDecision || "";
    state.photosAndImages = Array.isArray(c.photosAndImages) ? c.photosAndImages : [];
    state.methodImage = Array.isArray(c.methodImage) ? c.methodImage : [];
    state.methodImageCaption = c.methodImageCaption || "";
    state.geographicScope = Array.isArray(c.geographicScope) ? c.geographicScope : [];
    state.comments = Array.isArray(c.comments) ? c.comments : [];
    state.revisions = Array.isArray(c.revisions) ? c.revisions : [];
    state.activityWarning = c.activityWarning || null;

    // Show form
    document.getElementById("caseForm").classList.remove("hidden");

    // Hide 'What would you like to do' and intro card when editing
    const intentEl = document.getElementById("intentFieldset");
    if (intentEl) intentEl.classList.add("hidden");
    const aboutIntroEl = document.getElementById("aboutIntroSection");
    if (aboutIntroEl) aboutIntroEl.classList.add("hidden");
    updateAboutMenuState(false);

    // Always go to 'Provide full case book entry'
    state.submissionIntent = "full";
    const fullRadio = document.querySelector('input[name="submissionIntent"][value="full"]');
    if (fullRadio) fullRadio.checked = true;
    updateFullCaseVisibility();

    // Set hidden inputs
    document.getElementById("caseId").value = c.id;
    document.getElementById("editKey").value = c.editKey || "";

    // Populate basic fields
    document.getElementById("submitterName").value = c.submitterName || "";
    document.getElementById("submitterEmail").value = c.submitterEmail || "";
    setCheckedValues("submitterRoles", c.submitterRoles);
    document.getElementById("additionalAcknowledgements").value = c.additionalAcknowledgements || "";

    document.getElementById("projectTitle").value = c.projectTitle || "";
    document.getElementById("projectUrl").value = c.projectUrl || "";
    document.getElementById("projectDescription").value = c.projectDescription || "";
    document.getElementById("importanceReason").value = c.importanceReason || "";
    setCheckedValues("initiatedMethods", c.initiatedMethods);
    document.getElementById("startYear").value = c.startYear || "";
    document.getElementById("projectStatus").value = c.projectStatus || "";
    document.getElementById("endYear").value = c.endYear || "";

    // Full case fields
    setCheckedValues("aiForms", c.aiForms);
    document.getElementById("subjectMatter").value = c.subjectMatter || "";
    setCheckedValues("projectGoals", c.projectGoals);
    document.getElementById("inclusionEfforts").value = c.inclusionEfforts || "";
    document.getElementById("limitations").value = c.limitations || "";
    document.getElementById("headlineFindings").value = c.headlineFindings || "";
    setCheckedValues("aiAssistance", c.aiAssistance);
    setCheckedValues("publishedResources", c.publishedResources);
    setCheckedValues("photosAvailable", c.photosAvailable);

    // Prepopulate organisations
    state.leadOrganisations = c.leadOrganisations || [];
    state.fundingOrganisations = c.fundingOrganisations || [];
    state.involvedOrganisations = c.involvedOrganisations || [];
    renderSelectedTags(document.getElementById("leadOrgsPicker_tags"), "leadOrganisations");
    renderSelectedTags(document.getElementById("fundingOrgsPicker_tags"), "fundingOrganisations");
    renderSelectedTags(document.getElementById("involvedOrgsPicker_tags"), "involvedOrganisations");

    // Prepopulate participants
    state.participants = c.participants || [];
    renderParticipantsList(document.getElementById("participantsList"));

    // Prepopulate resources & photos
    state.resources = c.resources || [];
    renderResourcesList(document.getElementById("resourcesList"));
    renderPhotosGallery();

    // Prepopulate messages
    const msgTypeCounters = {};
    state.messages = (c.messages || []).map((m) => {
      const type = m.type || m.Type || "Recommendation";
      msgTypeCounters[type] = (msgTypeCounters[type] || 0) + 1;
      return {
        id: m.id || null,
        title: m.title || m.Title || `${type} ${msgTypeCounters[type]}`,
        text: m.text || m.Name || "",
        type,
      };
    });
    renderMessagesTable();

    // Update banner and staff controls
    bannerTitle.textContent = `Editing Case #${c.id}: "${c.projectTitle}"`;
    bannerSubtitle.textContent = `Status: ${c.workflowStatus || "Submission"}. Changes are saved automatically as you move between stages.`;
    document.getElementById("submitBtn").textContent = "Save Changes";
    document.getElementById("stageNavSaveStatus")?.classList.remove("hidden");

    if (state.staffUser) {
      staffBadge?.classList.remove("hidden");
      openDrawerBtn?.classList.remove("hidden");
      if (state.staffCanEdit && workflowRow && workflowSelect) {
        workflowRow.classList.remove("hidden");
        workflowSelect.value = c.workflowStatus || "Submission";
        populateAssignedToSelect();
      }
      renderDrawerContents();
    } else {
      staffBadge?.classList.add("hidden");
      openDrawerBtn?.classList.add("hidden");
      workflowRow?.classList.add("hidden");
    }

    captureSavedSnapshots();
    updateEditSaveStatusUI("saved");

    renderStageTabs();
    goToStage("stage-1", { skipAutoSave: true });
    updateStageProgress();
  } catch (err) {
    banner.classList.add("error-banner");
    bannerTitle.textContent = "Error Loading Record";
    bannerSubtitle.textContent = err.message;
    document.getElementById("caseForm").classList.add("hidden");
  }
}

/* -------------------------------------------------------------
 * 2. Nomination vs Full Case Toggle
 * ------------------------------------------------------------- */
function updateFullCaseVisibility() {
  const isFull = state.submissionIntent === "full" || state.isEditMode;
  const fullSection = document.getElementById("fullCaseStages");
  if (fullSection) {
    if (isFull) {
      fullSection.classList.remove("hidden");
    } else {
      fullSection.classList.add("hidden");
    }
  }

  document.querySelectorAll(".full-case-only").forEach((el) => {
    if (isFull) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

function initIntentToggle() {
  const radios = document.querySelectorAll('input[name="submissionIntent"]');

  radios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      state.submissionIntent = e.target.value;
      updateFullCaseVisibility();

      const activeStages = getActiveStages();
      if (!activeStages.some((s) => s.id === state.currentStageId)) {
        goToStage(activeStages[0].id);
      } else {
        goToStage(state.currentStageId);
      }
      renderStageTabs();
    });
  });

  updateFullCaseVisibility();
}

/* -------------------------------------------------------------
 * 3. Organisation Pickers (Search + Add If Not Found)
 * ------------------------------------------------------------- */
function initOrgPickers() {
  setupOrgPicker("leadOrgsPicker", "leadOrganisations");
  setupOrgPicker("fundingOrgsPicker", "fundingOrganisations");
  setupOrgPicker("involvedOrgsPicker", "involvedOrganisations");
}

function setupOrgPicker(containerId, stateKey) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="selected-tags" id="${containerId}_tags"></div>
    <div class="picker-search-box">
      <input type="text" class="org-search-input" placeholder="Type organisation name to search or add...">
      <div class="search-dropdown hidden"></div>
    </div>
  `;

  const tagsEl = container.querySelector(".selected-tags");
  const inputEl = container.querySelector(".org-search-input");
  const dropdownEl = container.querySelector(".search-dropdown");

  let debounceTimer;

  inputEl.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();

    if (query.length < 2) {
      dropdownEl.innerHTML = "";
      dropdownEl.classList.add("hidden");
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        dropdownEl.innerHTML = `<div class="dropdown-item loading">Searching organisations...</div>`;
        dropdownEl.classList.remove("hidden");

        const res = await fetch(`/api/organisations?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        const results = data.list || [];
        const hasExactMatch = data.hasExactMatch || false;

        renderDropdownResults(dropdownEl, query, results, hasExactMatch, (selectedItem) => {
          const alreadyAdded = state[stateKey].some(
            (o) => (o.id && o.id === selectedItem.id) || o.name.toLowerCase() === selectedItem.name.toLowerCase()
          );

          if (!alreadyAdded) {
            state[stateKey].push(selectedItem);
            renderSelectedTags(tagsEl, stateKey);
            updateStageProgress();
            if (state.isEditMode) {
              saveEditChanges({ scopes: ["organisations"] });
            }
          }

          inputEl.value = "";
          dropdownEl.innerHTML = "";
          dropdownEl.classList.add("hidden");
        });
      } catch (err) {
        dropdownEl.innerHTML = `<div class="dropdown-item error">Error fetching results</div>`;
      }
    }, 250);
  });

  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) {
      dropdownEl.classList.add("hidden");
    }
  });
}

function renderDropdownResults(dropdownEl, query, results, hasExactMatch, onSelect) {
  dropdownEl.innerHTML = "";

  if (results.length > 0) {
    results.forEach((org) => {
      const itemEl = document.createElement("div");
      itemEl.className = "dropdown-item";
      const locLabel =
        Array.isArray(org.locations) && org.locations.length > 0
          ? ` <small class="dropdown-loc-badge">📍 ${escapeHtml(
              org.locations.map((l) => l.name).join(", ")
            )}</small>`
          : "";
      itemEl.innerHTML = `<strong>${escapeHtml(org.name)}</strong>${
        org.website ? ` <small>(${escapeHtml(org.website)})</small>` : ""
      }${locLabel}`;
      itemEl.addEventListener("click", () =>
        onSelect({
          id: org.id,
          name: org.name,
          website: org.website || "",
          type: org.type || [],
          locations: Array.isArray(org.locations) ? org.locations : [],
        })
      );
      dropdownEl.appendChild(itemEl);
    });
  }

  if (!hasExactMatch) {
    const addNewEl = document.createElement("div");
    addNewEl.className = "dropdown-item add-new";
    addNewEl.innerHTML = `<em>+ Add new organisation:</em> <strong>"${escapeHtml(query)}"</strong>`;
    addNewEl.addEventListener("click", () => {
      onSelect({ name: query, isNew: true, website: "", locations: [] });
    });
    dropdownEl.appendChild(addNewEl);
  }

  dropdownEl.classList.remove("hidden");
}

function renderSelectedTags(tagsEl, stateKey) {
  if (!tagsEl) return;
  tagsEl.innerHTML = "";
  state[stateKey].forEach((org, index) => {
    const tag = document.createElement("span");
    tag.className = "tag" + (org.isNew ? " tag-new" : "");
    const locNames =
      Array.isArray(org.locations) && org.locations.length > 0
        ? org.locations.map((l) => l.name).filter(Boolean).join(", ")
        : "";
    tag.innerHTML = `
      ${escapeHtml(org.name)}
      ${locNames ? `<small class="tag-loc-pill" title="Main Location: ${escapeHtml(locNames)}">📍 ${escapeHtml(locNames)}</small>` : ""}
      ${org.isNew ? '<small>(New)</small>' : ''}
      <button type="button" aria-label="Remove">&times;</button>
    `;
    tag.querySelector("button").addEventListener("click", () => {
      state[stateKey].splice(index, 1);
      renderSelectedTags(tagsEl, stateKey);
      updateStageProgress();
      if (state.isEditMode) {
        saveEditChanges({ scopes: ["organisations"] });
      }
    });
    tagsEl.appendChild(tag);
  });
  updateStageProgress();
}

/* -------------------------------------------------------------
 * 4. Participant Groups Repeater Manager + Linked Locations Picker
 * ------------------------------------------------------------- */
function initParticipantManager() {
  const listEl = document.getElementById("participantsList");
  const addBtn = document.getElementById("addParticipantBtn");
  const modal = document.getElementById("participantModal");
  const modalTitle = document.getElementById("participantModalTitle");
  const saveBtn = document.getElementById("saveParticipantBtn");
  const cancelBtn = document.getElementById("cancelParticipantBtn");
  const dialogForm = document.getElementById("participantDialogForm");
  const locPickerContainer = document.getElementById("p_locationsPicker");

  let editingParticipantIndex = null;
  let currentParticipantLocations = []; // Array of { id?, name, latitude?, longitude?, countryCode?, isNew? }

  // Initialize Location Picker inside Participant Modal
  let locTagsEl = null;
  let locInputEl = null;
  let locDropdownEl = null;

  if (locPickerContainer) {
    locPickerContainer.innerHTML = `
      <div class="selected-tags" id="p_locationsPicker_tags"></div>
      <div class="picker-search-box">
        <input type="text" class="org-search-input" id="p_locationSearchInput" placeholder="Search city, region or country (e.g. United Kingdom, Nairobi)...">
        <div class="search-dropdown hidden" id="p_locationSearchDropdown"></div>
      </div>
    `;
    locTagsEl = locPickerContainer.querySelector(".selected-tags");
    locInputEl = locPickerContainer.querySelector(".org-search-input");
    locDropdownEl = locPickerContainer.querySelector(".search-dropdown");

    let locDebounceTimer;
    locInputEl.addEventListener("input", (e) => {
      clearTimeout(locDebounceTimer);
      const query = e.target.value.trim();

      if (query.length < 2) {
        locDropdownEl.innerHTML = "";
        locDropdownEl.classList.add("hidden");
        return;
      }

      locDebounceTimer = setTimeout(async () => {
        try {
          locDropdownEl.innerHTML = `<div class="dropdown-item loading">Searching locations...</div>`;
          locDropdownEl.classList.remove("hidden");

          const res = await fetch(`/api/locations?q=${encodeURIComponent(query)}`);
          const data = await res.json();
          const results = data.list || [];
          const hasExactMatch = data.hasExactMatch || false;

          renderLocationDropdownResults(locDropdownEl, query, results, hasExactMatch, async (selectedLoc) => {
            const alreadyAdded = currentParticipantLocations.some(
              (l) =>
                (l.id && selectedLoc.id && l.id === selectedLoc.id) ||
                l.name.toLowerCase() === selectedLoc.name.toLowerCase()
            );

            if (!alreadyAdded) {
              currentParticipantLocations.push(selectedLoc);
              renderParticipantLocationTags();

              // If newly added location has no coordinates yet, geocode in background for immediate map preview
              if (selectedLoc.isNew && (selectedLoc.latitude == null || selectedLoc.longitude == null)) {
                try {
                  const geoRes = await fetch(
                    `/api/locations?geocode=1&q=${encodeURIComponent(selectedLoc.name)}`
                  );
                  if (geoRes.ok) {
                    const geoData = await geoRes.json();
                    if (geoData.geocoded) {
                      selectedLoc.latitude = geoData.geocoded.latitude;
                      selectedLoc.longitude = geoData.geocoded.longitude;
                      selectedLoc.countryCode = geoData.geocoded.countryCode || "";
                      renderParticipantLocationTags();
                    }
                  }
                } catch (_) {}
              }
            }

            locInputEl.value = "";
            locDropdownEl.innerHTML = "";
            locDropdownEl.classList.add("hidden");
          });
        } catch (err) {
          locDropdownEl.innerHTML = `<div class="dropdown-item error">Error searching locations</div>`;
        }
      }, 220);
    });

    document.addEventListener("click", (e) => {
      if (locPickerContainer && !locPickerContainer.contains(e.target)) {
        locDropdownEl?.classList.add("hidden");
      }
    });
  }

  function renderParticipantLocationTags() {
    if (!locTagsEl) return;
    locTagsEl.innerHTML = "";
    currentParticipantLocations.forEach((loc, idx) => {
      const hasCoords = loc.latitude != null && loc.longitude != null;
      const tag = document.createElement("span");
      tag.className = "tag" + (loc.isNew ? " tag-new" : "");
      tag.innerHTML = `
        📍 ${escapeHtml(loc.name)}
        ${hasCoords ? `<small class="tag-coord-check" title="Plotted on map (${Number(loc.latitude).toFixed(2)}, ${Number(loc.longitude).toFixed(2)})">&#10003;</small>` : ""}
        ${loc.isNew ? "<small>(New)</small>" : ""}
        <button type="button" aria-label="Remove location">&times;</button>
      `;
      tag.querySelector("button").addEventListener("click", () => {
        currentParticipantLocations.splice(idx, 1);
        renderParticipantLocationTags();
      });
      locTagsEl.appendChild(tag);
    });
  }

  addBtn.addEventListener("click", () => {
    if (state.participants.length >= 15) {
      alert("Maximum of 15 participant groups reached.");
      return;
    }
    editingParticipantIndex = null;
    currentParticipantLocations = [];
    dialogForm.reset();
    setCheckedValues("p_location", []);
    setCheckedValues("p_methods", []);
    setCheckedValues("p_learning", []);
    renderParticipantLocationTags();
    if (modalTitle) modalTitle.textContent = "Add Participant Group";
    saveBtn.textContent = "Add Group";
    modal.showModal();
  });

  cancelBtn.addEventListener("click", () => {
    editingParticipantIndex = null;
    modal.close();
  });

  window.openEditParticipant = function (idx) {
    const p = state.participants[idx];
    if (!p) return;
    editingParticipantIndex = idx;
    dialogForm.reset();

    if (modalTitle) modalTitle.textContent = "Edit Participant Group";
    saveBtn.textContent = "Save Changes";

    document.getElementById("p_groupDescription").value = p.groupDescription || "";
    document.getElementById("p_participantCount").value = p.participantCount != null ? p.participantCount : "";
    document.getElementById("p_engagementHours").value = p.engagementHours != null ? p.engagementHours : "";

    setCheckedValues("p_location", p.engagementLocations);
    document.getElementById("p_recruitmentMethod").value = p.recruitmentMethod || "";
    document.getElementById("p_recruitmentDescription").value = p.recruitmentDescription || "";
    document.getElementById("p_targetPopulation").value = p.targetPopulation || "";
    document.getElementById("p_geographicOrigin").value = p.geographicOrigin || "";
    currentParticipantLocations = Array.isArray(p.locations)
      ? p.locations.map((l) => ({ ...l }))
      : [];
    renderParticipantLocationTags();
    setCheckedValues("p_methods", p.engagementMethods);
    setCheckedValues("p_learning", p.learningFacilitationOptions);
    document.getElementById("p_notes").value = p.notes || "";

    modal.showModal();
  };

  saveBtn.addEventListener("click", () => {
    const desc = document.getElementById("p_groupDescription").value.trim();
    if (!desc) {
      alert("Please provide a group description.");
      return;
    }

    const count = document.getElementById("p_participantCount").value;
    const hours = document.getElementById("p_engagementHours").value;
    const locations = getCheckedValues("p_location");
    const recMethod = document.getElementById("p_recruitmentMethod").value;
    const recDesc = document.getElementById("p_recruitmentDescription").value.trim();
    const targetPop = document.getElementById("p_targetPopulation").value.trim();
    const geo = document.getElementById("p_geographicOrigin").value.trim();
    const methods = getCheckedValues("p_methods");
    const learning = getCheckedValues("p_learning");
    const notes = document.getElementById("p_notes").value.trim();

    const participantData = {
      groupDescription: desc,
      participantCount: count ? Math.abs(parseInt(count, 10)) : null,
      engagementHours: hours ? Math.abs(parseFloat(hours)) : null,
      engagementLocations: locations,
      recruitmentMethod: recMethod,
      recruitmentDescription: recDesc,
      targetPopulation: targetPop,
      geographicOrigin: geo,
      locations: [...currentParticipantLocations],
      engagementMethods: methods,
      learningFacilitationOptions: learning,
      notes: notes,
    };

    if (editingParticipantIndex !== null && editingParticipantIndex >= 0) {
      const existing = state.participants[editingParticipantIndex];
      if (existing && existing.id) {
        participantData.id = existing.id;
      }
      state.participants[editingParticipantIndex] = participantData;
      editingParticipantIndex = null;
    } else {
      state.participants.push(participantData);
    }

    renderParticipantsList(listEl);
    updateStageProgress();
    modal.close();
    if (state.isEditMode) {
      saveEditChanges({ scopes: ["participants"] });
    }
  });
}

function renderLocationDropdownResults(dropdownEl, query, results, hasExactMatch, onSelect) {
  dropdownEl.innerHTML = "";

  if (results.length > 0) {
    results.forEach((loc) => {
      const itemEl = document.createElement("div");
      itemEl.className = "dropdown-item";
      const cc = loc.countryCode ? ` <small>[${escapeHtml(loc.countryCode)}]</small>` : "";
      const coords =
        loc.latitude != null && loc.longitude != null
          ? ` <small class="dropdown-loc-badge">(${Number(loc.latitude).toFixed(2)}, ${Number(
              loc.longitude
            ).toFixed(2)})</small>`
          : "";
      itemEl.innerHTML = `<strong>📍 ${escapeHtml(loc.name)}</strong>${cc}${coords}`;
      itemEl.addEventListener("click", () =>
        onSelect({
          id: loc.id,
          name: loc.name,
          latitude: loc.latitude,
          longitude: loc.longitude,
          countryCode: loc.countryCode || "",
        })
      );
      dropdownEl.appendChild(itemEl);
    });
  }

  if (!hasExactMatch) {
    const addNewEl = document.createElement("div");
    addNewEl.className = "dropdown-item add-new";
    addNewEl.innerHTML = `<em>+ Add &amp; geocode new location:</em> <strong>"${escapeHtml(query)}"</strong>`;
    addNewEl.addEventListener("click", () => {
      onSelect({ name: query, isNew: true, latitude: null, longitude: null, countryCode: "" });
    });
    dropdownEl.appendChild(addNewEl);
  }

  dropdownEl.classList.remove("hidden");
}

function renderParticipantsList(listEl) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (state.participants.length === 0) {
    listEl.innerHTML = `<p class="empty-note">No participant groups added yet.</p>`;
    return;
  }

  state.participants.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "repeater-card clickable-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("title", "Click to edit this participant group");

    const methods = Array.isArray(p.engagementMethods)
      ? p.engagementMethods
      : (typeof p.engagementMethods === "string" ? p.engagementMethods.split(",").map((s) => s.trim()).filter(Boolean) : []);

    const linkedLocNames = Array.isArray(p.locations)
      ? p.locations.map((l) => l && l.name).filter(Boolean)
      : [];

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <strong>${idx + 1}. ${escapeHtml(p.groupDescription)}</strong>
          <span class="badge-edit">Click to edit</span>
        </div>
        <div class="card-actions">
          <button type="button" class="btn-remove" aria-label="Remove group">&times; Remove</button>
        </div>
      </div>
      <div class="card-details">
        ${p.participantCount ? `<span><strong>Count:</strong> ${escapeHtml(p.participantCount)}</span> ` : ""}
        ${p.engagementHours ? `<span><strong>Hours:</strong> ${escapeHtml(p.engagementHours)}h</span> ` : ""}
        ${p.recruitmentMethod ? `<span><strong>Recruitment:</strong> ${escapeHtml(p.recruitmentMethod)}</span> ` : ""}
        ${linkedLocNames.length > 0 ? `<span><strong>Map Locations:</strong> 📍 ${linkedLocNames.map(escapeHtml).join(", ")}</span> ` : p.geographicOrigin ? `<span><strong>From:</strong> ${escapeHtml(p.geographicOrigin)}</span> ` : ""}
        ${methods.length > 0 ? `<div><small>Methods: ${methods.map(escapeHtml).join(", ")}</small></div>` : ""}
      </div>
    `;

    card.addEventListener("click", () => {
      if (window.openEditParticipant) {
        window.openEditParticipant(idx);
      }
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (window.openEditParticipant) {
          window.openEditParticipant(idx);
        }
      }
    });

    const removeBtn = card.querySelector(".btn-remove");
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.participants.splice(idx, 1);
      renderParticipantsList(listEl);
      updateStageProgress();
      if (state.isEditMode) {
        saveEditChanges({ scopes: ["participants"] });
      }
    });

    listEl.appendChild(card);
  });
}

/* -------------------------------------------------------------
 * 5. File Upload Helper + Resources & Project Photos Managers
 * ------------------------------------------------------------- */
function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!n || isNaN(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadFilesToApi(fileList, category = "resource") {
  const files = Array.from(fileList || []).filter((f) => f && f.size > 0);
  if (files.length === 0) return [];

  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      throw new Error(`File "${file.name}" exceeds the 20 MB maximum file size limit.`);
    }
  }

  const formData = new FormData();
  files.forEach((f) => formData.append("files", f, f.name));

  const res = await fetch(`/api/upload?category=${encodeURIComponent(category)}`, {
    method: "POST",
    headers: getStaffHeaders(),
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || "File upload failed.");
  }

  return Array.isArray(data.attachments) ? data.attachments : [];
}

function initResourceManager() {
  const listEl = document.getElementById("resourcesList");
  const addBtn = document.getElementById("addResourceBtn");
  const modal = document.getElementById("resourceModal");
  const modalTitle = document.getElementById("resourceModalTitle");
  const saveBtn = document.getElementById("saveResourceBtn");
  const cancelBtn = document.getElementById("cancelResourceBtn");
  const dialogForm = document.getElementById("resourceDialogForm");
  const fileDropzone = document.getElementById("r_fileDropzone");
  const fileInput = document.getElementById("r_fileInput");
  const triggerFileBtn = document.getElementById("r_triggerFileBtn");
  const uploadStatusEl = document.getElementById("r_uploadStatus");
  const attachmentsListEl = document.getElementById("r_attachmentsList");
  const modalErrorEl = document.getElementById("r_modalError");

  let editingResourceIndex = null;
  let currentResourceAttachments = [];
  let isUploadingResourceFile = false;

  function showModalError(msg) {
    if (!modalErrorEl) {
      alert(msg);
      return;
    }
    if (!msg) {
      modalErrorEl.textContent = "";
      modalErrorEl.classList.add("hidden");
    } else {
      modalErrorEl.textContent = msg;
      modalErrorEl.classList.remove("hidden");
    }
  }

  function setResourceUploadStatus(text, type = "info") {
    if (!uploadStatusEl) return;
    if (!text) {
      uploadStatusEl.textContent = "";
      uploadStatusEl.className = "upload-status-bar hidden";
      return;
    }
    uploadStatusEl.textContent = text;
    uploadStatusEl.className = `upload-status-bar is-${type}`;
  }

  function renderModalResourceAttachments() {
    if (!attachmentsListEl) return;
    attachmentsListEl.innerHTML = "";
    if (currentResourceAttachments.length === 0) return;

    currentResourceAttachments.forEach((att, idx) => {
      const item = document.createElement("div");
      item.className = "modal-attachment-chip";
      const sizeStr = formatFileSize(att.size);
      item.innerHTML = `
        <a href="${escapeHtml(att.url || att.rawUrl || "#")}" target="_blank" rel="noopener noreferrer" class="attachment-chip-link">
          📎 ${escapeHtml(att.title || "Uploaded file")}
        </a>
        ${sizeStr ? `<span class="attachment-chip-size">(${escapeHtml(sizeStr)})</span>` : ""}
        <button type="button" class="btn-remove-attachment" aria-label="Remove file">&times;</button>
      `;
      item.querySelector(".btn-remove-attachment").addEventListener("click", () => {
        currentResourceAttachments.splice(idx, 1);
        renderModalResourceAttachments();
      });
      attachmentsListEl.appendChild(item);
    });
  }

  async function handleResourceFilesSelected(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.size > 0);
    if (files.length === 0) return;

    if (currentResourceAttachments.length + files.length > 10) {
      showModalError("A maximum of 10 files can be attached to a single resource.");
      return;
    }

    showModalError("");
    isUploadingResourceFile = true;
    saveBtn.disabled = true;
    setResourceUploadStatus(`Uploading ${files.length} ${files.length === 1 ? "file" : "files"}...`, "loading");

    try {
      const uploaded = await uploadFilesToApi(files, "resource");
      currentResourceAttachments.push(...uploaded);
      renderModalResourceAttachments();

      // Auto-populate resource title from first file name if currently blank
      const titleInput = document.getElementById("r_title");
      if (titleInput && !titleInput.value.trim() && uploaded.length > 0 && uploaded[0].title) {
        titleInput.value = uploaded[0].title.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ");
      }

      setResourceUploadStatus(
        `✓ Uploaded ${uploaded.length} ${uploaded.length === 1 ? "file" : "files"}`,
        "success"
      );
      setTimeout(() => setResourceUploadStatus(""), 3500);
    } catch (err) {
      setResourceUploadStatus(`⚠ ${err.message}`, "error");
    } finally {
      isUploadingResourceFile = false;
      saveBtn.disabled = false;
      if (fileInput) fileInput.value = "";
    }
  }

  if (triggerFileBtn && fileInput) {
    triggerFileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (fileDropzone && fileInput) {
    fileDropzone.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target === fileInput) return;
      fileInput.click();
    });

    fileDropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      fileDropzone.classList.add("is-dragover");
    });

    fileDropzone.addEventListener("dragleave", () => {
      fileDropzone.classList.remove("is-dragover");
    });

    fileDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      fileDropzone.classList.remove("is-dragover");
      if (e.dataTransfer?.files?.length) {
        handleResourceFilesSelected(e.dataTransfer.files);
      }
    });

    fileInput.addEventListener("change", () => {
      if (fileInput.files?.length) {
        handleResourceFilesSelected(fileInput.files);
      }
    });
  }

  addBtn.addEventListener("click", () => {
    if (state.resources.length >= 20) {
      alert("Maximum of 20 resources reached.");
      return;
    }
    editingResourceIndex = null;
    currentResourceAttachments = [];
    dialogForm.reset();
    showModalError("");
    setResourceUploadStatus("");
    renderModalResourceAttachments();
    if (modalTitle) modalTitle.textContent = "Add Supporting Resource";
    saveBtn.textContent = "Add Resource";
    modal.showModal();
  });

  cancelBtn.addEventListener("click", () => {
    editingResourceIndex = null;
    currentResourceAttachments = [];
    showModalError("");
    setResourceUploadStatus("");
    modal.close();
  });

  window.openEditResource = function (idx) {
    const r = state.resources[idx];
    if (!r) return;
    editingResourceIndex = idx;
    dialogForm.reset();
    showModalError("");
    setResourceUploadStatus("");

    if (modalTitle) modalTitle.textContent = "Edit Supporting Resource";
    saveBtn.textContent = "Save Changes";

    document.getElementById("r_title").value = r.title || "";
    document.getElementById("r_url").value = r.url || "";
    document.getElementById("r_type").value = r.resourceType || "Other";
    document.getElementById("r_desc").value = r.description || "";
    document.getElementById("r_license").value = r.license || "";
    currentResourceAttachments = Array.isArray(r.attachments)
      ? r.attachments.map((a) => ({ ...a }))
      : [];
    renderModalResourceAttachments();

    modal.showModal();
  };

  saveBtn.addEventListener("click", () => {
    if (isUploadingResourceFile) return;

    const title = document.getElementById("r_title").value.trim();
    const url = document.getElementById("r_url").value.trim();

    if (!title) {
      showModalError("Please provide a resource title.");
      document.getElementById("r_title")?.focus();
      return;
    }

    if (!url && currentResourceAttachments.length === 0) {
      showModalError("Please provide a Resource URL or upload at least one file.");
      return;
    }

    if (url && !isValidClientUrl(url)) {
      showModalError("Resource URL must start with http:// or https://");
      document.getElementById("r_url")?.focus();
      return;
    }

    showModalError("");

    const resData = {
      title,
      url: url || "",
      resourceType: document.getElementById("r_type").value,
      description: document.getElementById("r_desc").value.trim(),
      license: document.getElementById("r_license").value.trim(),
      attachments: [...currentResourceAttachments],
    };

    if (editingResourceIndex !== null && editingResourceIndex >= 0) {
      const existing = state.resources[editingResourceIndex];
      if (existing && existing.id) {
        resData.id = existing.id;
      }
      state.resources[editingResourceIndex] = resData;
      editingResourceIndex = null;
    } else {
      state.resources.push(resData);
    }

    renderResourcesList(listEl);
    updateStageProgress();
    modal.close();
    if (state.isEditMode) {
      saveEditChanges({ scopes: ["resources"] });
    }
  });
}

function renderResourcesList(listEl) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (state.resources.length === 0) {
    listEl.innerHTML = `<p class="empty-note">No resources added yet.</p>`;
    return;
  }

  state.resources.forEach((r, idx) => {
    const card = document.createElement("div");
    card.className = "repeater-card clickable-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("title", "Click to edit this resource");

    const attachments = Array.isArray(r.attachments) ? r.attachments : [];
    const primaryHref = r.url || (attachments[0] && (attachments[0].url || attachments[0].rawUrl)) || "";

    const titleHtml = primaryHref
      ? `<a href="${escapeHtml(primaryHref)}" target="_blank" rel="noopener noreferrer" class="resource-link">${escapeHtml(r.title)}</a>`
      : `<span>${escapeHtml(r.title)}</span>`;

    const attachmentBadgesHtml =
      attachments.length > 0
        ? `<div class="resource-card-attachments">
            ${attachments
              .map(
                (att) =>
                  `<a href="${escapeHtml(att.url || att.rawUrl || "#")}" target="_blank" rel="noopener noreferrer" class="resource-file-badge" title="Open uploaded file">📎 ${escapeHtml(att.title || "Uploaded file")}</a>`
              )
              .join("")}
          </div>`
        : "";

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <strong>${idx + 1}. ${titleHtml}</strong>
          <span class="badge-edit">Click to edit</span>
        </div>
        <div class="card-actions">
          <button type="button" class="btn-remove" aria-label="Remove resource">&times; Remove</button>
        </div>
      </div>
      <div><small>${escapeHtml(r.resourceType || "Resource")}${r.description ? ` - ${escapeHtml(r.description)}` : ""}${r.license ? ` (${escapeHtml(r.license)})` : ""}</small></div>
      ${attachmentBadgesHtml}
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      if (window.openEditResource) {
        window.openEditResource(idx);
      }
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (e.target.closest("a")) return;
        e.preventDefault();
        if (window.openEditResource) {
          window.openEditResource(idx);
        }
      }
    });

    const removeBtn = card.querySelector(".btn-remove");
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.resources.splice(idx, 1);
      renderResourcesList(listEl);
      updateStageProgress();
      if (state.isEditMode) {
        saveEditChanges({ scopes: ["resources"] });
      }
    });

    listEl.appendChild(card);
  });
}

/* -------------------------------------------------------------
 * 5b. Project Photos Upload & Gallery Manager (Stage 6)
 * ------------------------------------------------------------- */
function initPhotoManager() {
  const dropzone = document.getElementById("photoUploadDropzone");
  const fileInput = document.getElementById("photoFileInput");
  const triggerBtn = document.getElementById("triggerPhotoInputBtn");
  const statusEl = document.getElementById("photoUploadStatus");

  if (!dropzone || !fileInput) return;

  function setPhotoStatus(text, type = "info") {
    if (!statusEl) return;
    if (!text) {
      statusEl.textContent = "";
      statusEl.className = "upload-status-bar hidden";
      return;
    }
    statusEl.textContent = text;
    statusEl.className = `upload-status-bar is-${type}`;
  }

  async function handlePhotoFilesSelected(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.size > 0);
    if (files.length === 0) return;

    if (state.photosAndImages.length + files.length > 20) {
      setPhotoStatus("⚠ Maximum of 20 project photos allowed per case.", "error");
      return;
    }

    setPhotoStatus(`Uploading ${files.length} ${files.length === 1 ? "photo" : "photos"}...`, "loading");
    if (triggerBtn) triggerBtn.disabled = true;

    try {
      const uploaded = await uploadFilesToApi(files, "photo");
      state.photosAndImages.push(...uploaded);

      // Automatically check "I have photos from this project to upload"
      const uploadCheck = document.getElementById("photosAvailableUploadCheck");
      if (uploadCheck && !uploadCheck.checked) {
        uploadCheck.checked = true;
      }
      // Uncheck "There are no photos available from this project" if checked
      const noPhotosCb = document.querySelector(
        'input[name="photosAvailable"][value="There are no photos available from this project"]'
      );
      if (noPhotosCb && noPhotosCb.checked) {
        noPhotosCb.checked = false;
      }

      renderPhotosGallery();
      updateStageProgress();

      setPhotoStatus(
        `✓ Uploaded ${uploaded.length} ${uploaded.length === 1 ? "photo" : "photos"}`,
        "success"
      );
      setTimeout(() => setPhotoStatus(""), 3500);

      if (state.isEditMode) {
        saveEditChanges({ scopes: ["case"] });
      }
    } catch (err) {
      setPhotoStatus(`⚠ ${err.message}`, "error");
    } finally {
      if (triggerBtn) triggerBtn.disabled = false;
      fileInput.value = "";
    }
  }

  if (triggerBtn) {
    triggerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  dropzone.addEventListener("click", (e) => {
    if (e.target.closest("button") || e.target === fileInput) return;
    fileInput.click();
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("is-dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("is-dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-dragover");
    if (e.dataTransfer?.files?.length) {
      handlePhotoFilesSelected(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.length) {
      handlePhotoFilesSelected(fileInput.files);
    }
  });

  renderPhotosGallery();
}

function renderPhotosGallery() {
  const galleryEl = document.getElementById("photosGalleryList");
  if (!galleryEl) return;

  galleryEl.innerHTML = "";
  if (!Array.isArray(state.photosAndImages) || state.photosAndImages.length === 0) {
    return;
  }

  state.photosAndImages.forEach((photo, idx) => {
    const card = document.createElement("div");
    card.className = "photo-gallery-card";
    const imgSrc = photo.thumbUrl || photo.url || photo.rawUrl || "";
    const fullHref = photo.url || photo.rawUrl || imgSrc;
    const title = photo.title || `Photo ${idx + 1}`;
    const sizeStr = formatFileSize(photo.size);

    card.innerHTML = `
      <a href="${escapeHtml(fullHref)}" target="_blank" rel="noopener noreferrer" class="photo-gallery-thumb-link" title="View full image">
        <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy" class="photo-gallery-thumb">
      </a>
      <div class="photo-gallery-meta">
        <span class="photo-gallery-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        ${sizeStr ? `<small class="photo-gallery-size">${escapeHtml(sizeStr)}</small>` : ""}
      </div>
      <button type="button" class="btn-remove-photo" aria-label="Remove photo" title="Remove photo">&times;</button>
    `;

    card.querySelector(".btn-remove-photo").addEventListener("click", () => {
      state.photosAndImages.splice(idx, 1);
      renderPhotosGallery();
      updateStageProgress();
      if (state.isEditMode) {
        saveEditChanges({ scopes: ["case"] });
      }
    });

    galleryEl.appendChild(card);
  });
}

/* -------------------------------------------------------------
 * 6. Messages Manager (Outputs Stage: Issues, Actions, Recommendations, Quotes)
 * ------------------------------------------------------------- */
const AUTO_TITLE_PATTERN = /^(Issue|Action|Recommendation|Quote)\s+\d+$/i;

function getNextMessageTitle(type) {
  const targetType = type || "Recommendation";
  const count = state.messages.filter((m) => m.type === targetType).length + 1;
  return `${targetType} ${count}`;
}

function recalculateAutoTitles() {
  const counts = {};
  state.messages.forEach((m) => {
    const t = m.type || "Recommendation";
    counts[t] = (counts[t] || 0) + 1;
    const trimmed = (m.title || "").trim();
    if (!trimmed || AUTO_TITLE_PATTERN.test(trimmed)) {
      m.title = `${t} ${counts[t]}`;
    }
  });
}

function initMessagesManager() {
  const pasteModal = document.getElementById("pasteMessagesModal");
  const pasteTitle = document.getElementById("pasteModalTitle");
  const pasteTypeSelect = document.getElementById("pasteMessagesType");
  const pasteTextarea = document.getElementById("pasteMessagesTextarea");
  const pasteCount = document.getElementById("pastePreviewCount");
  const cancelBtn = document.getElementById("cancelPasteBtn");
  const confirmBtn = document.getElementById("confirmPasteBtn");

  const btnIssue = document.getElementById("addIssuesBtn");
  const btnAction = document.getElementById("addActionsBtn");
  const btnRec = document.getElementById("addRecommendationsBtn");
  const btnQuote = document.getElementById("addQuotesBtn");

  function openPasteModal(type) {
    if (!pasteModal) return;
    const targetType = type || "Recommendation";
    if (pasteTypeSelect) pasteTypeSelect.value = targetType;
    if (pasteTitle) {
      const titles = {
        Issue: "Add Issues",
        Action: "Add Actions",
        Recommendation: "Add Recommendations",
        Quote: "Add Quotes",
      };
      pasteTitle.textContent = titles[targetType] || `Add ${targetType}s`;
    }
    if (pasteTextarea) {
      pasteTextarea.value = "";
    }
    if (pasteCount) {
      pasteCount.textContent = "0 entries detected";
    }
    pasteModal.showModal();
    if (pasteTextarea) {
      setTimeout(() => pasteTextarea.focus(), 60);
    }
  }

  if (btnIssue) btnIssue.addEventListener("click", () => openPasteModal("Issue"));
  if (btnAction) btnAction.addEventListener("click", () => openPasteModal("Action"));
  if (btnRec) btnRec.addEventListener("click", () => openPasteModal("Recommendation"));
  if (btnQuote) btnQuote.addEventListener("click", () => openPasteModal("Quote"));

  if (pasteTextarea && pasteCount) {
    pasteTextarea.addEventListener("input", () => {
      const lines = pasteTextarea.value
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      pasteCount.textContent = `${lines.length} ${lines.length === 1 ? "entry" : "entries"} detected`;
    });
  }

  if (cancelBtn && pasteModal) {
    cancelBtn.addEventListener("click", () => pasteModal.close());
  }

  if (confirmBtn && pasteModal) {
    confirmBtn.addEventListener("click", () => {
      const lines = (pasteTextarea?.value || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        alert("Please paste at least one line of text or click Cancel.");
        pasteTextarea?.focus();
        return;
      }

      const selectedType = pasteTypeSelect?.value || "Recommendation";
      lines.forEach((line) => {
        state.messages.push({
          id: null,
          title: getNextMessageTitle(selectedType),
          text: line,
          type: selectedType,
        });
      });

      pasteModal.close();
      renderMessagesTable();
      updateStageProgress();
      if (state.isEditMode) {
        saveEditChanges({ scopes: ["messages"] });
      }
    });
  }
}

function getMessageTypeClass(type) {
  if (type === "Issue") return "type-issue";
  if (type === "Action") return "type-action";
  if (type === "Quote") return "type-quote";
  return "type-recommendation";
}

function renderMessagesTable() {
  const container = document.getElementById("messagesTableContainer");
  if (!container) return;

  container.innerHTML = "";

  if (state.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "messages-empty-state";
    empty.innerHTML = `
      <div class="empty-icon">📝</div>
      <p class="empty-title">No outputs added yet</p>
      <p class="empty-hint">Click <strong>+ Add issues</strong>, <strong>+ Add actions</strong>, <strong>+ Add recommendations</strong>, or <strong>+ Add quotes</strong> above to bulk paste entries, or add a single line directly.</p>
      <button type="button" class="btn-secondary btn-sm" id="emptyAddSingleBtn">+ Add single message</button>
    `;
    container.appendChild(empty);

    const emptyAddBtn = empty.querySelector("#emptyAddSingleBtn");
    if (emptyAddBtn) {
      emptyAddBtn.addEventListener("click", () => {
        const defaultType = "Recommendation";
        state.messages.push({
          id: null,
          title: getNextMessageTitle(defaultType),
          text: "",
          type: defaultType,
        });
        renderMessagesTable();
        const inputs = container.querySelectorAll(".msg-text-input");
        if (inputs.length) inputs[inputs.length - 1].focus();
        updateStageProgress();
      });
    }
    return;
  }

  // Counts
  const issueCount = state.messages.filter((m) => m.type === "Issue").length;
  const actionCount = state.messages.filter((m) => m.type === "Action").length;
  const recCount = state.messages.filter((m) => m.type === "Recommendation").length;
  const quoteCount = state.messages.filter((m) => m.type === "Quote").length;

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "messages-table-wrap";

  let rowsHtml = "";
  state.messages.forEach((msg, idx) => {
    const typeClass = getMessageTypeClass(msg.type);
    rowsHtml += `
      <tr data-index="${idx}">
        <td class="col-type">
          <select class="msg-type-select ${typeClass}" data-index="${idx}">
            <option value="Issue" ${msg.type === "Issue" ? "selected" : ""}>Issue</option>
            <option value="Action" ${msg.type === "Action" ? "selected" : ""}>Action</option>
            <option value="Recommendation" ${msg.type === "Recommendation" ? "selected" : ""}>Recommendation</option>
            <option value="Quote" ${msg.type === "Quote" ? "selected" : ""}>Quote</option>
          </select>
        </td>
        <td class="col-title">
          <input type="text" class="msg-title-input" data-index="${idx}" value="${escapeHtml(msg.title || "")}" placeholder="e.g. ${escapeHtml(msg.type || "Recommendation")} 1">
        </td>
        <td class="col-content">
          <textarea class="msg-text-input" data-index="${idx}" rows="2" placeholder="Enter message text...">${escapeHtml(msg.text)}</textarea>
        </td>
        <td class="col-actions">
          <button type="button" class="btn-remove-msg" data-index="${idx}" title="Remove entry" aria-label="Remove entry">&times;</button>
        </td>
      </tr>
    `;
  });

  tableWrapper.innerHTML = `
    <table class="messages-table">
      <thead>
        <tr>
          <th style="width: 155px;">Type</th>
          <th style="width: 190px;">Short Title</th>
          <th>Message Content (Inline Editable)</th>
          <th style="width: 45px; text-align: center;"></th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <div class="messages-table-footer">
      <button type="button" class="btn-secondary btn-sm" id="tableAddSingleBtn">+ Add single message</button>
      <div class="messages-counts-summary">
        <span class="count-pill pill-issue">${issueCount} Issues</span>
        <span class="count-pill pill-action">${actionCount} Actions</span>
        <span class="count-pill pill-rec">${recCount} Recommendations</span>
        <span class="count-pill pill-quote">${quoteCount} Quotes</span>
        <span class="count-total">Total: ${state.messages.length}</span>
      </div>
    </div>
  `;

  container.appendChild(tableWrapper);

  // Wire events
  const titleInputs = tableWrapper.querySelectorAll(".msg-title-input");
  titleInputs.forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (!isNaN(idx) && state.messages[idx]) {
        state.messages[idx].title = e.target.value;
        updateStageProgress();
        refreshDirtyStateUI();
      }
    });
  });

  const textInputs = tableWrapper.querySelectorAll(".msg-text-input");
  textInputs.forEach((ta) => {
    ta.addEventListener("input", (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (!isNaN(idx) && state.messages[idx]) {
        state.messages[idx].text = e.target.value;
        updateStageProgress();
        refreshDirtyStateUI();
      }
    });
  });

  const typeSelects = tableWrapper.querySelectorAll(".msg-type-select");
  typeSelects.forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (!isNaN(idx) && state.messages[idx]) {
        const newType = e.target.value;
        state.messages[idx].type = newType;
        sel.className = `msg-type-select ${getMessageTypeClass(newType)}`;
        recalculateAutoTitles();
        tableWrapper.querySelectorAll(".msg-title-input").forEach((inp) => {
          const i = parseInt(inp.dataset.index, 10);
          if (!isNaN(i) && state.messages[i]) {
            inp.value = state.messages[i].title || "";
            inp.placeholder = `e.g. ${state.messages[i].type || "Recommendation"} 1`;
          }
        });
        updateMessagesSummaryPills(container);
        updateStageProgress();
        refreshDirtyStateUI();
      }
    });
  });

  const deleteBtns = tableWrapper.querySelectorAll(".btn-remove-msg");
  deleteBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (!isNaN(idx)) {
        state.messages.splice(idx, 1);
        recalculateAutoTitles();
        renderMessagesTable();
        updateStageProgress();
        if (state.isEditMode) {
          saveEditChanges({ scopes: ["messages"] });
        }
      }
    });
  });

  const tableAddBtn = tableWrapper.querySelector("#tableAddSingleBtn");
  if (tableAddBtn) {
    tableAddBtn.addEventListener("click", () => {
      const defaultType = "Recommendation";
      state.messages.push({
        id: null,
        title: getNextMessageTitle(defaultType),
        text: "",
        type: defaultType,
      });
      renderMessagesTable();
      const updatedInputs = container.querySelectorAll(".msg-text-input");
      if (updatedInputs.length) {
        const lastInput = updatedInputs[updatedInputs.length - 1];
        lastInput.focus();
        lastInput.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      updateStageProgress();
    });
  }
}

function updateMessagesSummaryPills(container) {
  const issueCount = state.messages.filter((m) => m.type === "Issue").length;
  const actionCount = state.messages.filter((m) => m.type === "Action").length;
  const recCount = state.messages.filter((m) => m.type === "Recommendation").length;
  const quoteCount = state.messages.filter((m) => m.type === "Quote").length;

  const pillIssue = container.querySelector(".pill-issue");
  const pillAction = container.querySelector(".pill-action");
  const pillRec = container.querySelector(".pill-rec");
  const pillQuote = container.querySelector(".pill-quote");
  const totalEl = container.querySelector(".count-total");

  if (pillIssue) pillIssue.textContent = `${issueCount} Issues`;
  if (pillAction) pillAction.textContent = `${actionCount} Actions`;
  if (pillRec) pillRec.textContent = `${recCount} Recommendations`;
  if (pillQuote) pillQuote.textContent = `${quoteCount} Quotes`;
  if (totalEl) totalEl.textContent = `Total: ${state.messages.length}`;
}

/* -------------------------------------------------------------
 * 7. Edit Mode Progressive Auto-Save & Form Submission
 * ------------------------------------------------------------- */
let lastSavedSnapshots = {
  case: "",
  organisations: "",
  participants: "",
  messages: "",
  resources: "",
};
let isAutoSaving = false;
let pendingAutoSave = false;

function buildSubmissionPayload(scopes = null) {
  const email = (document.getElementById("submitterEmail")?.value || "").trim();
  const projectUrl = (document.getElementById("projectUrl")?.value || "").trim();

  const payload = {
    caseId: state.caseId,
    editKey: state.editKey,

    // Submitter
    submitterName: (document.getElementById("submitterName")?.value || "").trim(),
    submitterEmail: email,
    submitterRoles: getCheckedValues("submitterRoles"),
    submissionIntent: state.submissionIntent,
    additionalAcknowledgements: (document.getElementById("additionalAcknowledgements")?.value || "").trim(),

    // Project Details
    projectTitle: (document.getElementById("projectTitle")?.value || "").trim(),
    projectUrl: projectUrl,
    projectDescription: (document.getElementById("projectDescription")?.value || "").trim(),
    importanceReason: (document.getElementById("importanceReason")?.value || "").trim(),
    initiatedMethods: getCheckedValues("initiatedMethods"),
    startYear: document.getElementById("startYear")?.value || null,
    projectStatus: document.getElementById("projectStatus")?.value || null,
    endYear: document.getElementById("endYear")?.value || null,

    // Full Case Fields
    leadOrganisations: state.leadOrganisations,
    fundingOrganisations: state.fundingOrganisations,
    involvedOrganisations: state.involvedOrganisations,
    aiForms: getCheckedValues("aiForms"),
    subjectMatter: (document.getElementById("subjectMatter")?.value || "").trim(),
    projectGoals: getCheckedValues("projectGoals"),
    participants: state.participants,
    inclusionEfforts: (document.getElementById("inclusionEfforts")?.value || "").trim(),
    limitations: (document.getElementById("limitations")?.value || "").trim(),
    headlineFindings: (document.getElementById("headlineFindings")?.value || "").trim(),
    messages: state.messages.filter((m) => m.text && m.text.trim().length > 0),
    aiAssistance: getCheckedValues("aiAssistance"),
    publishedResources: getCheckedValues("publishedResources"),
    resources: state.resources,
    photosAvailable: getCheckedValues("photosAvailable"),
    photosAndImages: state.photosAndImages,
    workflowStatus: state.staffCanEdit
      ? document.getElementById("staffWorkflowStatus")?.value || undefined
      : undefined,
    assignedTo: state.staffCanEdit
      ? (() => {
          const val = document.getElementById("staffAssignedTo")?.value || "";
          return val ? [val] : [];
        })()
      : undefined,
  };

  if (Array.isArray(scopes) && scopes.length > 0) {
    payload.scopes = scopes;
  }

  return payload;
}

function getScopeSnapshots() {
  const p = buildSubmissionPayload();
  return {
    case: JSON.stringify({
      submitterName: p.submitterName,
      submitterEmail: p.submitterEmail,
      submitterRoles: p.submitterRoles,
      additionalAcknowledgements: p.additionalAcknowledgements,
      projectTitle: p.projectTitle,
      projectUrl: p.projectUrl,
      projectDescription: p.projectDescription,
      importanceReason: p.importanceReason,
      initiatedMethods: p.initiatedMethods,
      startYear: p.startYear,
      projectStatus: p.projectStatus,
      endYear: p.endYear,
      aiForms: p.aiForms,
      subjectMatter: p.subjectMatter,
      projectGoals: p.projectGoals,
      inclusionEfforts: p.inclusionEfforts,
      limitations: p.limitations,
      headlineFindings: p.headlineFindings,
      aiAssistance: p.aiAssistance,
      publishedResources: p.publishedResources,
      photosAvailable: p.photosAvailable,
      photosAndImages: (p.photosAndImages || []).map((img) => ({
        rawUrl: img.rawUrl || img.url || "",
        title: img.title || "",
      })),
      workflowStatus: p.workflowStatus || "",
      assignedTo: p.assignedTo || [],
    }),
    organisations: JSON.stringify({
      lead: p.leadOrganisations,
      funding: p.fundingOrganisations,
      involved: p.involvedOrganisations,
    }),
    participants: JSON.stringify(p.participants),
    messages: JSON.stringify(p.messages),
    resources: JSON.stringify(
      (p.resources || []).map((r) => ({
        id: r.id || null,
        title: r.title || "",
        url: r.url || "",
        resourceType: r.resourceType || "Other",
        description: r.description || "",
        license: r.license || "",
        attachments: (r.attachments || []).map((a) => ({
          rawUrl: a.rawUrl || a.url || "",
          title: a.title || "",
        })),
      }))
    ),
  };
}

function captureSavedSnapshots(scopes = null) {
  const current = getScopeSnapshots();
  if (Array.isArray(scopes) && scopes.length > 0) {
    scopes.forEach((s) => {
      if (current[s] !== undefined) {
        lastSavedSnapshots[s] = current[s];
      }
    });
  } else {
    lastSavedSnapshots = current;
  }
}

function getDirtyScopes() {
  if (!state.isEditMode) return [];
  const current = getScopeSnapshots();
  return Object.keys(current).filter((scope) => current[scope] !== lastSavedSnapshots[scope]);
}

function updateEditSaveStatusUI(status, customMessage = "") {
  const bannerPill = document.getElementById("editBannerSaveStatus");
  const bannerText = document.getElementById("editBannerSaveStatusText");
  const navPill = document.getElementById("stageNavSaveStatus");
  const navText = document.getElementById("stageNavSaveStatusText");
  const saveNowBtn = document.getElementById("editSaveNowBtn");
  const submitBtn = document.getElementById("submitBtn");

  const stateClasses = ["is-saved", "is-dirty", "is-saving", "is-error"];
  [bannerPill, navPill].forEach((el) => {
    if (!el) return;
    stateClasses.forEach((c) => el.classList.remove(c));
    el.classList.add(`is-${status}`);
  });

  if (status === "saving") {
    if (bannerText) bannerText.textContent = customMessage || "Saving changes...";
    if (navText) navText.textContent = "Saving...";
    if (saveNowBtn) {
      saveNowBtn.disabled = true;
      saveNowBtn.textContent = "Saving...";
      saveNowBtn.classList.remove("hidden");
    }
    if (state.isEditMode && submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving Changes...";
    }
  } else if (status === "dirty") {
    if (bannerText) bannerText.textContent = customMessage || "Unsaved changes";
    if (navText) navText.textContent = "Unsaved changes";
    if (saveNowBtn) {
      saveNowBtn.disabled = false;
      saveNowBtn.textContent = "Save now";
      saveNowBtn.classList.remove("hidden");
    }
    if (state.isEditMode && submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Changes";
    }
  } else if (status === "error") {
    if (bannerText) bannerText.textContent = customMessage || "Save failed — click Save now to retry";
    if (navText) navText.textContent = "Save failed";
    if (saveNowBtn) {
      saveNowBtn.disabled = false;
      saveNowBtn.textContent = "Retry Save";
      saveNowBtn.classList.remove("hidden");
    }
    if (state.isEditMode && submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Retry Save Changes";
    }
  } else {
    // "saved"
    if (bannerText) bannerText.textContent = customMessage || "All changes saved";
    if (navText) navText.textContent = "All changes saved";
    if (saveNowBtn) {
      saveNowBtn.disabled = false;
      saveNowBtn.textContent = "Save now";
      saveNowBtn.classList.add("hidden");
    }
    if (state.isEditMode && submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Changes";
    }
  }
}

function refreshDirtyStateUI() {
  if (!state.isEditMode || isAutoSaving) return;
  const dirty = getDirtyScopes();
  if (dirty.length > 0) {
    updateEditSaveStatusUI("dirty");
  } else {
    updateEditSaveStatusUI("saved");
  }
}

async function saveEditChanges(options = {}) {
  if (!state.isEditMode || !state.caseId) return { skipped: true };

  const dirtyScopes =
    Array.isArray(options.scopes) && options.scopes.length > 0
      ? [...new Set([...options.scopes, ...getDirtyScopes()])]
      : getDirtyScopes();

  if (!options.force && dirtyScopes.length === 0) {
    updateEditSaveStatusUI("saved");
    return { skipped: true };
  }

  if (isAutoSaving) {
    pendingAutoSave = true;
    return { queued: true };
  }

  const scopesToSave =
    dirtyScopes.length > 0
      ? dirtyScopes
      : ["case", "organisations", "participants", "resources", "messages"];

  const payload = buildSubmissionPayload(scopesToSave);

  if (!payload.projectTitle) {
    updateEditSaveStatusUI("error", "Project Title (Stage 2) is required to save");
    return { error: "Project Title is required." };
  }

  if (payload.projectUrl && !isValidClientUrl(payload.projectUrl)) {
    updateEditSaveStatusUI("error", "Project URL (Stage 2) must start with http:// or https://");
    return { error: "Invalid Project URL." };
  }

  if (payload.submitterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.submitterEmail)) {
    updateEditSaveStatusUI("error", "Please enter a valid contact email in Stage 1");
    return { error: "Invalid Contact Email." };
  }

  isAutoSaving = true;
  updateEditSaveStatusUI("saving");

  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: getStaffHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || "Could not save changes.");
    }

    // Sync assigned NocoDB record IDs back into client state so subsequent saves update instead of duplicating
    if (result.syncedData) {
      if (Array.isArray(result.syncedData.participants)) {
        state.participants = result.syncedData.participants;
      }
      if (Array.isArray(result.syncedData.resources)) {
        state.resources = result.syncedData.resources;
      }
      if (Array.isArray(result.syncedData.messages)) {
        // Preserve any blank rows the user is actively typing while updating IDs of non-empty messages
        const syncedList = result.syncedData.messages;
        let syncedIdx = 0;
        state.messages = state.messages.map((m) => {
          if (m.text && m.text.trim().length > 0 && syncedIdx < syncedList.length) {
            return syncedList[syncedIdx++];
          }
          return m;
        });
      }
      if (Array.isArray(result.syncedData.leadOrganisations)) {
        state.leadOrganisations = result.syncedData.leadOrganisations;
      }
      if (Array.isArray(result.syncedData.fundingOrganisations)) {
        state.fundingOrganisations = result.syncedData.fundingOrganisations;
      }
      if (Array.isArray(result.syncedData.involvedOrganisations)) {
        state.involvedOrganisations = result.syncedData.involvedOrganisations;
      }
    }

    captureSavedSnapshots(scopesToSave);

    // Update banner title/status if changed
    const bannerTitle = document.getElementById("editBannerTitle");
    if (bannerTitle && payload.projectTitle) {
      bannerTitle.textContent = `Editing Case #${state.caseId}: "${payload.projectTitle}"`;
    }
    if (payload.workflowStatus) {
      const bannerSubtitle = document.getElementById("editBannerSubtitle");
      if (bannerSubtitle) {
        bannerSubtitle.textContent = `Status: ${payload.workflowStatus}. Changes are saved automatically as you move between stages.`;
      }
    }

    // Refresh drawer revision history in background if staff user is signed in
    if (state.staffUser && state.caseId) {
      fetch(`/api/case/comments?id=${encodeURIComponent(state.caseId)}`, {
        headers: getStaffHeaders(),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((actData) => {
          if (actData) {
            state.comments = actData.comments || state.comments;
            state.revisions = actData.revisions || state.revisions;
            state.activityWarning = actData.permissionWarning || null;
            renderDrawerContents();
          }
        })
        .catch(() => {});
    }

    const remainingDirty = getDirtyScopes();
    if (remainingDirty.length > 0) {
      updateEditSaveStatusUI("dirty");
    } else {
      updateEditSaveStatusUI("saved");
    }
    updateStageProgress();

    return { success: true, result };
  } catch (err) {
    updateEditSaveStatusUI("error", `Save failed: ${err.message}`);
    return { error: err.message };
  } finally {
    isAutoSaving = false;
    if (pendingAutoSave) {
      pendingAutoSave = false;
      saveEditChanges();
    }
  }
}

function initEditAutoSaveControls() {
  const saveNowBtn = document.getElementById("editSaveNowBtn");
  const workflowSelect = document.getElementById("staffWorkflowStatus");
  const assignedSelect = document.getElementById("staffAssignedTo");

  if (saveNowBtn) {
    saveNowBtn.addEventListener("click", () => {
      saveEditChanges({ force: true });
    });
  }

  if (workflowSelect) {
    workflowSelect.addEventListener("change", () => {
      if (state.isEditMode) {
        saveEditChanges({ scopes: ["case"] });
      }
    });
  }

  if (assignedSelect) {
    assignedSelect.addEventListener("change", () => {
      if (state.isEditMode) {
        saveEditChanges({ scopes: ["case"] });
      }
    });
  }

  window.addEventListener("beforeunload", (e) => {
    if (state.isEditMode && (isAutoSaving || getDirtyScopes().length > 0)) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

function initFormSubmission() {
  const form = document.getElementById("caseForm");
  const statusEl = document.getElementById("statusMessage");
  const submitBtn = document.getElementById("submitBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (state.isEditMode) {
      const res = await saveEditChanges({ force: true });
      if (statusEl && res.success) {
        statusEl.className = "status-msg success";
        statusEl.innerHTML = `
          <h3>Changes Saved!</h3>
          <p>${escapeHtml(res.result?.message || "Your case record was updated successfully.")}</p>
          <p><small>${
            state.staffCanEdit
              ? "Changes were saved using your NocoDB editor credentials."
              : "You can make further edits anytime using your edit link until the submission is published."
          }</small></p>
        `;
        statusEl.classList.remove("hidden");
        setTimeout(() => {
          statusEl.classList.add("hidden");
        }, 4500);
      } else if (statusEl && res.error) {
        statusEl.className = "status-msg error";
        statusEl.textContent = `Error: ${res.error}`;
        statusEl.classList.remove("hidden");
      }
      return;
    }

    if (!isStageComplete("stage-1")) {
      goToStage("stage-1");
      alert("Please provide a valid contact email in Stage 1 before submitting.");
      document.getElementById("submitterEmail")?.focus();
      return;
    }

    if (!isStageComplete("stage-2")) {
      goToStage("stage-2");
      alert("Please ensure Project Title, a valid Project URL (http/https), and Brief Description are filled in Stage 2.");
      document.getElementById("projectTitle")?.focus();
      return;
    }

    if (!document.getElementById("consentCheck").checked) {
      goToStage("stage-7");
      alert("Please agree to the consent statement before submitting.");
      document.getElementById("consentCheck")?.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving your submission...";
    statusEl.className = "status-msg";
    statusEl.textContent = "Saving your submission...";
    statusEl.classList.remove("hidden");

    try {
      const payload = buildSubmissionPayload();

      const res = await fetch("/api/submit", {
        method: "POST",
        headers: getStaffHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Submission could not be completed.");
      }

      // New entry created: hide the form and show the dedicated success screen with edit link
      form.classList.add("hidden");
      const editBanner = document.getElementById("editBanner");
      if (editBanner) editBanner.classList.add("hidden");
      const aboutIntroEl = document.getElementById("aboutIntroSection");
      if (aboutIntroEl) aboutIntroEl.classList.add("hidden");

      const editKey = result.editKey || state.editKey || "";
      const editUrl = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(result.caseId)}&editKey=${encodeURIComponent(editKey)}`;

      const successScreen = document.getElementById("submissionSuccessScreen");
      if (successScreen) {
        successScreen.innerHTML = `
          <h2>Thank You for Your Submission!</h2>
          <p>Your project entry (<strong>#${escapeHtml(result.caseId)}: ${escapeHtml(payload.projectTitle)}</strong>) has been saved.</p>
          
          <div class="edit-link-container">
            <label for="editUrlField">Your Edit Link</label>
            <p style="margin-top: 0; font-size: 0.9rem; color: #166534;">
              You can save this link to make edits to your submission in future at any time until it is published.
            </p>
            <div class="edit-link-box">
              <input type="text" id="editUrlField" class="edit-link-input" value="${escapeHtml(editUrl)}" readonly>
              <button type="button" id="copyEditLinkBtn" class="btn-copy-link">Copy Link</button>
            </div>
          </div>

          <div class="success-actions">
            <a href="${escapeHtml(editUrl)}" class="btn-primary" style="display: inline-block; text-decoration: none;">View / Edit Your Submission</a>
            <a href="/" class="btn-secondary" style="display: inline-block; text-decoration: none;">Submit Another Project</a>
          </div>
        `;
        successScreen.classList.remove("hidden");

        const copyBtn = document.getElementById("copyEditLinkBtn");
        const inputField = document.getElementById("editUrlField");
        if (copyBtn && inputField) {
          copyBtn.addEventListener("click", async () => {
            try {
              inputField.select();
              await navigator.clipboard.writeText(editUrl);
              copyBtn.textContent = "✓ Copied!";
              copyBtn.classList.add("copied");
              setTimeout(() => {
                copyBtn.textContent = "Copy Link";
                copyBtn.classList.remove("copied");
              }, 3000);
            } catch (_) {
              inputField.focus();
              inputField.select();
              document.execCommand("copy");
              copyBtn.textContent = "✓ Copied!";
              setTimeout(() => {
                copyBtn.textContent = "Copy Link";
              }, 3000);
            }
          });
        }
      }

      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      statusEl.className = "status-msg error";
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Case Entry";
    }
  });
}

/* -------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------- */
function getCheckedValues(name) {
  const checked = document.querySelectorAll(`input[name="${name}"]:checked`);
  return Array.from(checked).map((el) => el.value);
}

function setCheckedValues(name, values) {
  const arr = Array.isArray(values)
    ? values
    : (typeof values === "string" ? values.split(",").map((s) => s.trim()).filter(Boolean) : (values ? [values] : []));
  const checkboxes = document.querySelectorAll(`input[name="${name}"]`);
  checkboxes.forEach((cb) => {
    cb.checked = arr.includes(cb.value);
  });
}

function isValidClientUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
