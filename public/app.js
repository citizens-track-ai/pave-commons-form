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
  submissionIntent: "nomination",
  currentStageId: "stage-1",
  leadOrganisations: [],      // Array of { id, name } OR { name, isNew: true, website?: string }
  fundingOrganisations: [],
  involvedOrganisations: [],
  participants: [],          // Array of participant group objects
  resources: [],             // Array of resource objects
  messages: [],              // Array of message objects: { id, title, text, type }
  staffToken: null,
  staffUser: null,           // { id, email, displayName, role }
  staffCanEdit: false,
  comments: [],              // Array of NocoDB record comments
  revisions: [],             // Array of NocoDB record revision audit entries
  activityWarning: null,
  activeDrawerTab: "comments",
};

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
  return STAGES_CONFIG.filter((s) => !s.isFullOnly || isFull);
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
      return published.length > 0 || state.resources.length > 0 || photos.length > 0;
    }
    case "stage-7": {
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
}

function goToStage(targetStageId) {
  const activeStages = getActiveStages();
  const exists = activeStages.some((s) => s.id === targetStageId);
  if (!exists) targetStageId = activeStages[0].id;

  state.currentStageId = targetStageId;

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
    stage2NextBtn.innerHTML = isFull ? "Next: Organisations &rarr;" : "Next: Consent &amp; Submit &rarr;";
  }

  const stage7PrevBtn = document.getElementById("stage7PrevBtn");
  if (stage7PrevBtn) {
    stage7PrevBtn.dataset.target = isFull ? "stage-6" : "stage-2";
    stage7PrevBtn.innerHTML = isFull ? "&larr; Back: Supporting Resources" : "&larr; Back: Project Details";
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
    form.addEventListener("input", () => updateStageProgress());
    form.addEventListener("change", () => updateStageProgress());
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initAboutLanding();
  initIntentToggle();
  initStageNavigation();
  initOrgPickers();
  initParticipantManager();
  initResourceManager();
  initMessagesManager();
  initStaffAuthAndDrawer();
  initFormSubmission();
  await restoreStaffSession();
  await checkEditMode();
  renderStageTabs();
  renderMessagesTable();
  goToStage("stage-1");
});

function initAboutLanding() {
  const startBtn = document.getElementById("startSubmissionBtn");
  const backBtn = document.getElementById("backToAboutBtn");
  const aboutSection = document.getElementById("aboutIntroSection");
  const caseForm = document.getElementById("caseForm");

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      if (aboutSection) aboutSection.classList.add("hidden");
      if (caseForm) caseForm.classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (caseForm) caseForm.classList.add("hidden");
      if (aboutSection) aboutSection.classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
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

async function restoreStaffSession() {
  let savedToken = null;
  try {
    savedToken = sessionStorage.getItem(STAFF_TOKEN_STORAGE_KEY);
  } catch (_) {}
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
        updateStaffAuthUI();
        return;
      }
    }
  } catch (_) {}

  // Clear invalid token
  try {
    sessionStorage.removeItem(STAFF_TOKEN_STORAGE_KEY);
  } catch (_) {}
}

function updateStaffAuthUI() {
  const loginBtn = document.getElementById("staffLoginBtn");
  const activeBadge = document.getElementById("staffActiveBadge");
  const userLabel = document.getElementById("staffUserLabel");
  const composerAttr = document.getElementById("composerAttribution");

  if (state.staffUser) {
    if (loginBtn) loginBtn.classList.add("hidden");
    if (activeBadge) activeBadge.classList.remove("hidden");
    if (userLabel) {
      userLabel.textContent = `${state.staffUser.displayName} (${state.staffUser.role})`;
    }
    if (composerAttr) {
      composerAttr.textContent = `Posting as ${state.staffUser.displayName} (${state.staffUser.email})`;
    }
  } else {
    if (loginBtn) loginBtn.classList.remove("hidden");
    if (activeBadge) activeBadge.classList.add("hidden");
  }
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
        try {
          sessionStorage.setItem(STAFF_TOKEN_STORAGE_KEY, rawToken);
        } catch (_) {}

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
    logoutBtn.addEventListener("click", async () => {
      state.staffToken = null;
      state.staffUser = null;
      state.staffCanEdit = false;
      state.comments = [];
      state.revisions = [];
      try {
        sessionStorage.removeItem(STAFF_TOKEN_STORAGE_KEY);
      } catch (_) {}
      closeStaffDrawer();
      updateStaffAuthUI();
      await checkEditMode();
    });
  }

  if (openDrawerBtn) {
    openDrawerBtn.addEventListener("click", () => openStaffDrawer());
  }
  if (closeDrawerBtn) {
    closeDrawerBtn.addEventListener("click", () => closeStaffDrawer());
  }
  if (backdrop) {
    backdrop.addEventListener("click", () => closeStaffDrawer());
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
  const backdrop = document.getElementById("staffDrawerBackdrop");
  if (drawer) drawer.classList.remove("hidden");
  if (backdrop) backdrop.classList.remove("hidden");
  renderDrawerContents();
}

function closeStaffDrawer() {
  const drawer = document.getElementById("staffDrawer");
  const backdrop = document.getElementById("staffDrawerBackdrop");
  if (drawer) drawer.classList.add("hidden");
  if (backdrop) backdrop.classList.add("hidden");
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

  if (countBadge) countBadge.textContent = String(cCount);
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
              ${
                hasFieldDiff
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
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  const str = String(val);
  return str.length > 180 ? str.slice(0, 180) + "…" : str;
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
      ? "A valid EditKey is required to edit this case, or click 'Staff Sign In' above with your NocoDB account."
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
    state.isEditMode = true;
    state.caseId = c.id;
    state.editKey = c.editKey || editKey;
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

    // Prepopulate resources
    state.resources = c.resources || [];
    renderResourcesList(document.getElementById("resourcesList"));

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
    bannerSubtitle.textContent = `Status: ${c.workflowStatus || "Submission"}. Submitting will update the existing database record.`;
    document.getElementById("submitBtn").textContent = "Save Changes";

    if (state.staffUser) {
      staffBadge?.classList.remove("hidden");
      openDrawerBtn?.classList.remove("hidden");
      if (state.staffCanEdit && workflowRow && workflowSelect) {
        workflowRow.classList.remove("hidden");
        workflowSelect.value = c.workflowStatus || "Submission";
      }
      renderDrawerContents();
    } else {
      staffBadge?.classList.add("hidden");
      openDrawerBtn?.classList.add("hidden");
      workflowRow?.classList.add("hidden");
    }

    renderStageTabs();
    goToStage("stage-1");
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
      itemEl.innerHTML = `<strong>${escapeHtml(org.name)}</strong>${org.website ? ` <small>(${escapeHtml(org.website)})</small>` : ""}`;
      itemEl.addEventListener("click", () => onSelect({ id: org.id, name: org.name }));
      dropdownEl.appendChild(itemEl);
    });
  }

  if (!hasExactMatch) {
    const addNewEl = document.createElement("div");
    addNewEl.className = "dropdown-item add-new";
    addNewEl.innerHTML = `<em>+ Add new organisation:</em> <strong>"${escapeHtml(query)}"</strong>`;
    addNewEl.addEventListener("click", () => {
      onSelect({ name: query, isNew: true });
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
    tag.innerHTML = `
      ${escapeHtml(org.name)} ${org.isNew ? '<small>(New)</small>' : ''}
      <button type="button" aria-label="Remove">&times;</button>
    `;
    tag.querySelector("button").addEventListener("click", () => {
      state[stateKey].splice(index, 1);
      renderSelectedTags(tagsEl, stateKey);
      updateStageProgress();
    });
    tagsEl.appendChild(tag);
  });
  updateStageProgress();
}

/* -------------------------------------------------------------
 * 4. Participant Groups Repeater Manager
 * ------------------------------------------------------------- */
function initParticipantManager() {
  const listEl = document.getElementById("participantsList");
  const addBtn = document.getElementById("addParticipantBtn");
  const modal = document.getElementById("participantModal");
  const modalTitle = document.getElementById("participantModalTitle");
  const saveBtn = document.getElementById("saveParticipantBtn");
  const cancelBtn = document.getElementById("cancelParticipantBtn");
  const dialogForm = document.getElementById("participantDialogForm");

  let editingParticipantIndex = null;

  addBtn.addEventListener("click", () => {
    if (state.participants.length >= 15) {
      alert("Maximum of 15 participant groups reached.");
      return;
    }
    editingParticipantIndex = null;
    dialogForm.reset();
    setCheckedValues("p_location", []);
    setCheckedValues("p_methods", []);
    setCheckedValues("p_learning", []);
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
  });
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
    });

    listEl.appendChild(card);
  });
}

/* -------------------------------------------------------------
 * 5. Resources Repeater Manager
 * ------------------------------------------------------------- */
function initResourceManager() {
  const listEl = document.getElementById("resourcesList");
  const addBtn = document.getElementById("addResourceBtn");
  const modal = document.getElementById("resourceModal");
  const modalTitle = document.getElementById("resourceModalTitle");
  const saveBtn = document.getElementById("saveResourceBtn");
  const cancelBtn = document.getElementById("cancelResourceBtn");
  const dialogForm = document.getElementById("resourceDialogForm");

  let editingResourceIndex = null;

  addBtn.addEventListener("click", () => {
    if (state.resources.length >= 20) {
      alert("Maximum of 20 resources reached.");
      return;
    }
    editingResourceIndex = null;
    dialogForm.reset();
    if (modalTitle) modalTitle.textContent = "Add Resource Link";
    saveBtn.textContent = "Add Resource";
    modal.showModal();
  });

  cancelBtn.addEventListener("click", () => {
    editingResourceIndex = null;
    modal.close();
  });

  window.openEditResource = function (idx) {
    const r = state.resources[idx];
    if (!r) return;
    editingResourceIndex = idx;
    dialogForm.reset();

    if (modalTitle) modalTitle.textContent = "Edit Resource Link";
    saveBtn.textContent = "Save Changes";

    document.getElementById("r_title").value = r.title || "";
    document.getElementById("r_url").value = r.url || "";
    document.getElementById("r_type").value = r.resourceType || "Other";
    document.getElementById("r_desc").value = r.description || "";
    document.getElementById("r_license").value = r.license || "";

    modal.showModal();
  };

  saveBtn.addEventListener("click", () => {
    const title = document.getElementById("r_title").value.trim();
    const url = document.getElementById("r_url").value.trim();
    if (!title || !url) {
      alert("Please provide both a resource title and URL.");
      return;
    }

    if (!isValidClientUrl(url)) {
      alert("Resource URL must start with http:// or https://");
      return;
    }

    const resData = {
      title,
      url,
      resourceType: document.getElementById("r_type").value,
      description: document.getElementById("r_desc").value.trim(),
      license: document.getElementById("r_license").value.trim(),
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

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <strong>${idx + 1}. <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="resource-link">${escapeHtml(r.title)}</a></strong>
          <span class="badge-edit">Click to edit</span>
        </div>
        <div class="card-actions">
          <button type="button" class="btn-remove" aria-label="Remove resource">&times; Remove</button>
        </div>
      </div>
      <div><small>${escapeHtml(r.resourceType)}${r.description ? ` - ${escapeHtml(r.description)}` : ""}</small></div>
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
    });

    listEl.appendChild(card);
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
 * 7. Form Submission (Create or Edit)
 * ------------------------------------------------------------- */
function initFormSubmission() {
  const form = document.getElementById("caseForm");
  const statusEl = document.getElementById("statusMessage");
  const submitBtn = document.getElementById("submitBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

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
    submitBtn.textContent = state.isEditMode ? "Saving Changes..." : "Saving your submission...";
    statusEl.className = "status-msg";
    statusEl.textContent = state.isEditMode ? "Saving your changes..." : "Saving your submission...";
    statusEl.classList.remove("hidden");

    try {
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
        workflowStatus: state.staffCanEdit
          ? document.getElementById("staffWorkflowStatus")?.value || undefined
          : undefined,
      };

      const res = await fetch("/api/submit", {
        method: "POST",
        headers: getStaffHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Submission could not be completed.");
      }

      if (state.isEditMode) {
        // Edit mode: show confirmation above the form
        const updatedStatus = payload.workflowStatus;
        if (updatedStatus) {
          const bannerSubtitle = document.getElementById("editBannerSubtitle");
          if (bannerSubtitle) {
            bannerSubtitle.textContent = `Status: ${updatedStatus}. Submitting will update the existing database record.`;
          }
        }
        statusEl.className = "status-msg success";
        statusEl.innerHTML = `
          <h3>Changes Saved!</h3>
          <p>${escapeHtml(result.message || "Your case record was updated successfully.")}</p>
          <p><small>${
            state.staffCanEdit
              ? "Changes were saved using your NocoDB editor credentials."
              : "You can make further edits anytime using your edit link until the submission is published."
          }</small></p>
        `;
        if (state.staffUser && state.caseId) {
          try {
            const actRes = await fetch(`/api/case/comments?id=${encodeURIComponent(state.caseId)}`, {
              headers: getStaffHeaders(),
            });
            if (actRes.ok) {
              const actData = await actRes.json();
              state.comments = actData.comments || state.comments;
              state.revisions = actData.revisions || state.revisions;
              state.activityWarning = actData.permissionWarning || null;
              renderDrawerContents();
            }
          } catch (_) {}
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
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
      }
    } catch (err) {
      statusEl.className = "status-msg error";
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = state.isEditMode ? "Save Changes" : "Submit Case Entry";
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
