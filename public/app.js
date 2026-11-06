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

/* -------------------------------------------------------------
 * 1b. Form Validation Engine & Field Highlighting
 * ------------------------------------------------------------- */
function getCaseValidationErrors(isEdit = state.isEditMode) {
  const errors = [];

  // Stage 1: Submitter Email
  const emailInput = document.getElementById("submitterEmail");
  const email = (emailInput?.value || "").trim();
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!isEdit) {
    if (!email) {
      errors.push({
        stageId: "stage-1",
        stageName: "Stage 1 (About You)",
        fieldId: "submitterEmail",
        label: "Contact Email",
        message: "Contact email address is required so we can send your edit link and review updates.",
      });
    } else if (!isEmailValid) {
      errors.push({
        stageId: "stage-1",
        stageName: "Stage 1 (About You)",
        fieldId: "submitterEmail",
        label: "Contact Email",
        message: `"${escapeHtml(email)}" is not a valid email address. Please use the format name@example.com.`,
      });
    }
  } else if (email && !isEmailValid) {
    errors.push({
      stageId: "stage-1",
      stageName: "Stage 1 (About You)",
      fieldId: "submitterEmail",
      label: "Contact Email",
      message: `"${escapeHtml(email)}" is not a valid email address.`,
    });
  }

  // Stage 2: Project Title
  const titleInput = document.getElementById("projectTitle");
  const title = (titleInput?.value || "").trim();
  if (!title) {
    errors.push({
      stageId: "stage-2",
      stageName: "Stage 2 (Project Details)",
      fieldId: "projectTitle",
      label: "Project Title",
      message: "Project title is required.",
    });
  }

  // Stage 2: Project URL
  const urlInput = document.getElementById("projectUrl");
  const url = (urlInput?.value || "").trim();
  if (!url) {
    errors.push({
      stageId: "stage-2",
      stageName: "Stage 2 (Project Details)",
      fieldId: "projectUrl",
      label: "Project URL",
      message: "Project URL is required so readers can find the official project reports and resources.",
    });
  } else if (!isValidClientUrl(url)) {
    errors.push({
      stageId: "stage-2",
      stageName: "Stage 2 (Project Details)",
      fieldId: "projectUrl",
      label: "Project URL",
      message: "Project URL must be a valid web address starting with http:// or https:// (e.g. https://example.org).",
    });
  }

  // Stage 2: Brief Description of the Project
  const descInput = document.getElementById("projectDescription");
  const desc = (descInput?.value || "").trim();
  if (!desc) {
    errors.push({
      stageId: "stage-2",
      stageName: "Stage 2 (Project Details)",
      fieldId: "projectDescription",
      label: "Brief Description of the Project",
      message: "Brief description of the project is required to summarize the initiative.",
    });
  } else if (desc.length < 5) {
    errors.push({
      stageId: "stage-2",
      stageName: "Stage 2 (Project Details)",
      fieldId: "projectDescription",
      label: "Brief Description of the Project",
      message: "Brief description of the project must be at least 5 characters long.",
    });
  }

  // Stage 7: Consent Statement
  if (!isEdit) {
    const consentInput = document.getElementById("consentCheck");
    if (!consentInput || !consentInput.checked) {
      errors.push({
        stageId: "stage-7",
        stageName: "Stage 7 (Review & Submit)",
        fieldId: "consentCheck",
        label: "Consent & Data Protection Policy",
        message: "You must agree to the terms and data protection policy before submitting.",
      });
    }
  }

  return errors;
}

function getStageValidationErrors(stageId, isEdit = state.isEditMode) {
  const allErrors = getCaseValidationErrors(isEdit);
  return allErrors.filter((e) => e.stageId === stageId);
}

function clearValidationSummary() {
  const summaries = document.querySelectorAll(".validation-summary-card");
  summaries.forEach((el) => {
    el.innerHTML = "";
    el.classList.add("hidden");
  });
}

function showValidationSummary(errors, targetContainerId = null) {
  if (!Array.isArray(errors) || errors.length === 0) {
    clearValidationSummary();
    return;
  }

  let container = null;
  if (targetContainerId) {
    container = document.getElementById(targetContainerId);
  }
  if (!container) {
    if (state.currentStageId === "stage-7") {
      container = document.getElementById("stage7ValidationSummary");
    } else {
      container = document.getElementById("formValidationSummary");
    }
  }
  if (!container) return;

  const countText = errors.length === 1 ? "1 required field" : `${errors.length} required fields`;

  container.innerHTML = `
    <div class="validation-summary-header">
      <span class="validation-summary-icon" aria-hidden="true">⚠️</span>
      <div>
        <strong class="validation-summary-title">Cannot submit yet — please complete ${countText}:</strong>
        <p class="validation-summary-subtitle">Click any field below to jump straight to it.</p>
      </div>
    </div>
    <ul class="validation-summary-list" role="list">
      ${errors
        .map(
          (err) => `
        <li>
          <button type="button" class="btn-validation-jump" data-stage="${escapeHtml(err.stageId)}" data-field="${escapeHtml(err.fieldId)}" title="Click to jump to ${escapeHtml(err.label)}">
            <span class="jump-arrow" aria-hidden="true">&rarr;</span>
            <span class="jump-stage">${escapeHtml(err.stageName)}:</span>
            <span class="jump-field">${escapeHtml(err.label)}</span>
            <span class="jump-desc">— ${escapeHtml(err.message)}</span>
          </button>
        </li>
      `
        )
        .join("")}
    </ul>
  `;
  container.classList.remove("hidden");

  // Highlight all invalid fields with .input-error and inline messages
  errors.forEach((err) => {
    highlightFieldError(err.fieldId, err.message);
  });

  // Attach jump button click events
  container.querySelectorAll(".btn-validation-jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stage = btn.dataset.stage;
      const fieldId = btn.dataset.field;
      if (stage) goToStage(stage);
      if (fieldId) {
        setTimeout(() => {
          focusAndHighlightField(fieldId);
        }, 120);
      }
    });
  });

  // Smoothly scroll to the error summary
  container.scrollIntoView({ behavior: "smooth", block: "center" });
}

function focusAndHighlightField(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.focus();
  el.classList.add("input-error");

  if (el.classList.contains("rich-textarea")) {
    el.closest(".rich-editor-wrapper")?.classList.add("input-error");
  }
}

function highlightFieldError(fieldId, message) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  el.classList.add("input-error");
  const formGroup = el.closest(".form-group");
  if (formGroup) {
    if (el.classList.contains("rich-textarea")) {
      formGroup.querySelector(".rich-editor-wrapper")?.classList.add("input-error");
    }
    if (el.id === "consentCheck") {
      formGroup.querySelector(".consent-checkbox-label")?.classList.add("input-error");
    }

    let errText = formGroup.querySelector(`.field-error-text[data-for="${fieldId}"]`);
    if (!errText) {
      errText = document.createElement("span");
      errText.className = "field-error-text";
      errText.setAttribute("data-for", fieldId);
      errText.setAttribute("role", "alert");
      formGroup.appendChild(errText);
    }
    errText.textContent = message || "This field is required.";
  }
}

function clearFieldError(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  el.classList.remove("input-error");
  const formGroup = el.closest(".form-group");
  if (formGroup) {
    formGroup.querySelector(".rich-editor-wrapper")?.classList.remove("input-error");
    formGroup.querySelector(".consent-checkbox-label")?.classList.remove("input-error");
    const errText = formGroup.querySelector(`.field-error-text[data-for="${fieldId}"]`);
    if (errText) errText.remove();
  }
}

function initValidationAutoClear() {
  const form = document.getElementById("caseForm");
  if (!form) return;

  ["input", "change"].forEach((evtName) => {
    form.addEventListener(evtName, (e) => {
      const target = e.target;
      if (target && target.id) {
        clearFieldError(target.id);
      }
      const currentErrors = getCaseValidationErrors();
      if (currentErrors.length === 0) {
        clearValidationSummary();
      }
    });
  });
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

async function goToStage(targetStageId, options = {}) {
  const activeStages = getActiveStages();
  const exists = activeStages.some((s) => s.id === targetStageId);
  if (!exists) targetStageId = activeStages[0].id;

  const previousStageId = state.currentStageId;
  state.currentStageId = targetStageId;

  // In signed in mode, automatically save any edited organisation or location details when navigating stages
  if (state.staffUser && previousStageId !== targetStageId) {
    if (previousStageId === "stage-3") {
      await saveAllDirtyStaffOrganisations();
    } else if (previousStageId === "stage-4") {
      await saveAllDirtyStaffLocations();
    }
  }

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

  // When navigating to Stage 7 (Review & Submit), check for any remaining required fields
  if (targetStageId === "stage-7" && !state.isEditMode) {
    const remainingErrors = getCaseValidationErrors(false);
    if (remainingErrors.length > 0) {
      showValidationSummary(remainingErrors, "stage7ValidationSummary");
    } else {
      clearValidationSummary();
    }
  } else if (targetStageId !== "stage-7") {
    const s7Summary = document.getElementById("stage7ValidationSummary");
    if (s7Summary) s7Summary.classList.add("hidden");
  }

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
      const currentStageId = state.currentStageId;
      const stageErrors = getStageValidationErrors(currentStageId);
      if (stageErrors.length > 0) {
        showValidationSummary(stageErrors);
        focusAndHighlightField(stageErrors[0].fieldId);
        return;
      }
      clearValidationSummary();
      const target = nextBtn.dataset.target;
      if (target) goToStage(target);
      return;
    }

    const prevBtn = e.target.closest(".btn-prev-stage");
    if (prevBtn) {
      clearValidationSummary();
      const target = prevBtn.dataset.target;
      if (target) goToStage(target);
      return;
    }
  });

  initValidationAutoClear();

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
  initMethodImageManager();
  initRichTextEditors();
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
  const orgsSection = document.getElementById("staffOrgsEditorSection");
  const locsSection = document.getElementById("staffLocationsEditorSection");
  const kanbanBtn = document.getElementById("topMenuKanbanBtn");
  const kanbanDivider = document.getElementById("topMenuKanbanDivider");

  if (state.staffUser) {
    if (loginBtn) {
      loginBtn.textContent = "Sign out";
      loginBtn.title = "Sign out of staff session";
    }
    if (activeBadge) activeBadge.classList.remove("hidden");
    if (kanbanBtn) kanbanBtn.classList.remove("hidden");
    if (kanbanDivider) kanbanDivider.classList.remove("hidden");
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

    if (orgsSection) {
      orgsSection.classList.remove("hidden");
      renderStaffOrganisationsTable();
    }
    if (locsSection) {
      locsSection.classList.remove("hidden");
      renderStaffLocationsList();
    }
    const methodImgSection = document.getElementById("staffMethodImageSection");
    if (methodImgSection) {
      methodImgSection.classList.remove("hidden");
      renderMethodImageUI();
    }
  } else {
    if (loginBtn) {
      loginBtn.textContent = "Sign in";
      loginBtn.title = "Sign in with NocoDB";
    }
    if (activeBadge) activeBadge.classList.add("hidden");
    if (kanbanBtn) kanbanBtn.classList.add("hidden");
    if (kanbanDivider) kanbanDivider.classList.add("hidden");
    if (orgsSection) orgsSection.classList.add("hidden");
    if (locsSection) locsSection.classList.add("hidden");
    const methodImgSection = document.getElementById("staffMethodImageSection");
    if (methodImgSection) methodImgSection.classList.add("hidden");
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
      if (state.staffCanEdit && workflowRow) {
        workflowRow.classList.remove("hidden");
        if (workflowSelect) workflowSelect.value = c.workflowStatus || "Submission";
        const curationSelect = document.getElementById("staffCurationDecision");
        if (curationSelect) curationSelect.value = c.curationDecision || "";
        populateAssignedToSelect();
      }
      renderDrawerContents();
      renderStaffOrganisationsTable();
      renderStaffLocationsList();
      renderMethodImageUI();
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
  if (state.staffUser) {
    renderStaffOrganisationsTable();
    renderStaffLocationsList();
  }
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

function renderParticipantsList(listEl = document.getElementById("participantsList")) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (state.participants.length === 0) {
    listEl.innerHTML = `<p class="empty-note">No participant groups added yet.</p>`;
    if (state.staffUser) {
      renderStaffLocationsList();
    }
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
  if (state.staffUser) {
    renderStaffLocationsList();
  }
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

/* -------------------------------------------------------------
 * 4b. Staff Entity Editors: Collapsible Organisations & Locations Tables
 * ------------------------------------------------------------- */
const ISO_COUNTRY_CODES = [
  { code: "", name: "(None / Not specified)" },
  { code: "AF", name: "Afghanistan (AF)" },
  { code: "AL", name: "Albania (AL)" },
  { code: "DZ", name: "Algeria (DZ)" },
  { code: "AR", name: "Argentina (AR)" },
  { code: "AM", name: "Armenia (AM)" },
  { code: "AU", name: "Australia (AU)" },
  { code: "AT", name: "Austria (AT)" },
  { code: "BD", name: "Bangladesh (BD)" },
  { code: "BE", name: "Belgium (BE)" },
  { code: "BR", name: "Brazil (BR)" },
  { code: "CA", name: "Canada (CA)" },
  { code: "CL", name: "Chile (CL)" },
  { code: "CN", name: "China (CN)" },
  { code: "CO", name: "Colombia (CO)" },
  { code: "CR", name: "Costa Rica (CR)" },
  { code: "HR", name: "Croatia (HR)" },
  { code: "CY", name: "Cyprus (CY)" },
  { code: "CZ", name: "Czech Republic (CZ)" },
  { code: "DK", name: "Denmark (DK)" },
  { code: "EG", name: "Egypt (EG)" },
  { code: "EE", name: "Estonia (EE)" },
  { code: "ET", name: "Ethiopia (ET)" },
  { code: "FI", name: "Finland (FI)" },
  { code: "FR", name: "France (FR)" },
  { code: "DE", name: "Germany (DE)" },
  { code: "GH", name: "Ghana (GH)" },
  { code: "GR", name: "Greece (GR)" },
  { code: "HK", name: "Hong Kong (HK)" },
  { code: "HU", name: "Hungary (HU)" },
  { code: "IS", name: "Iceland (IS)" },
  { code: "IN", name: "India (IN)" },
  { code: "ID", name: "Indonesia (ID)" },
  { code: "IE", name: "Ireland (IE)" },
  { code: "IL", name: "Israel (IL)" },
  { code: "IT", name: "Italy (IT)" },
  { code: "JP", name: "Japan (JP)" },
  { code: "JO", name: "Jordan (JO)" },
  { code: "KE", name: "Kenya (KE)" },
  { code: "KR", name: "South Korea (KR)" },
  { code: "LV", name: "Latvia (LV)" },
  { code: "LT", name: "Lithuania (LT)" },
  { code: "LU", name: "Luxembourg (LU)" },
  { code: "MY", name: "Malaysia (MY)" },
  { code: "MX", name: "Mexico (MX)" },
  { code: "MA", name: "Morocco (MA)" },
  { code: "NP", name: "Nepal (NP)" },
  { code: "NL", name: "Netherlands (NL)" },
  { code: "NZ", name: "New Zealand (NZ)" },
  { code: "NG", name: "Nigeria (NG)" },
  { code: "NO", name: "Norway (NO)" },
  { code: "PK", name: "Pakistan (PK)" },
  { code: "PE", name: "Peru (PE)" },
  { code: "PH", name: "Philippines (PH)" },
  { code: "PL", name: "Poland (PL)" },
  { code: "PT", name: "Portugal (PT)" },
  { code: "QA", name: "Qatar (QA)" },
  { code: "RO", name: "Romania (RO)" },
  { code: "RW", name: "Rwanda (RW)" },
  { code: "SA", name: "Saudi Arabia (SA)" },
  { code: "SG", name: "Singapore (SG)" },
  { code: "ZA", name: "South Africa (ZA)" },
  { code: "ES", name: "Spain (ES)" },
  { code: "SE", name: "Sweden (SE)" },
  { code: "CH", name: "Switzerland (CH)" },
  { code: "TW", name: "Taiwan (TW)" },
  { code: "TZ", name: "Tanzania (TZ)" },
  { code: "TH", name: "Thailand (TH)" },
  { code: "TN", name: "Tunisia (TN)" },
  { code: "TR", name: "Turkey (TR)" },
  { code: "UG", name: "Uganda (UG)" },
  { code: "UA", name: "Ukraine (UA)" },
  { code: "AE", name: "United Arab Emirates (AE)" },
  { code: "GB", name: "United Kingdom (GB)" },
  { code: "US", name: "United States (US)" },
  { code: "UY", name: "Uruguay (UY)" },
  { code: "VN", name: "Vietnam (VN)" },
  { code: "ZM", name: "Zambia (ZM)" },
  { code: "ZW", name: "Zimbabwe (ZW)" },
];

function getKnownCaseLocations() {
  const locMap = new Map();
  const registerLoc = (l) => {
    if (!l) return;
    const lid = Number(l.id || l.Id);
    if (lid && !locMap.has(lid)) {
      locMap.set(lid, {
        id: lid,
        name: l.name || l.Name || `Location #${lid}`,
        countryCode: l.countryCode || l["Country Code"] || "",
        latitude: l.latitude !== undefined ? l.latitude : l.Latitude,
        longitude: l.longitude !== undefined ? l.longitude : l.Longitude,
      });
    }
  };

  (state.participants || []).forEach((p) => {
    (p.locations || []).forEach(registerLoc);
  });

  const allOrgs = [
    ...(state.leadOrganisations || []),
    ...(state.fundingOrganisations || []),
    ...(state.involvedOrganisations || []),
  ];
  allOrgs.forEach((org) => {
    (org.locations || []).forEach(registerLoc);
  });

  return [...locMap.values()];
}

function updateOrgInLocalState(updatedOrg) {
  if (!updatedOrg || !updatedOrg.id) return;
  const updateList = (list) => {
    (list || []).forEach((o) => {
      if (Number(o.id) === Number(updatedOrg.id)) {
        o.name = updatedOrg.name;
        o.website = updatedOrg.website;
        o.type = updatedOrg.type;
        o.locations = updatedOrg.locations || [];
      }
    });
  };

  updateList(state.leadOrganisations);
  updateList(state.fundingOrganisations);
  updateList(state.involvedOrganisations);
}

function updateLocationInLocalState(updatedLoc) {
  if (!updatedLoc || !updatedLoc.id) return;
  const updateLocObj = (l) => {
    if (Number(l.id) === Number(updatedLoc.id)) {
      l.name = updatedLoc.name;
      l.latitude = updatedLoc.latitude;
      l.longitude = updatedLoc.longitude;
      l.countryCode = updatedLoc.countryCode;
    }
  };

  (state.participants || []).forEach((p) => {
    (p.locations || []).forEach(updateLocObj);
  });

  const allOrgs = [
    ...(state.leadOrganisations || []),
    ...(state.fundingOrganisations || []),
    ...(state.involvedOrganisations || []),
  ];
  allOrgs.forEach((org) => {
    (org.locations || []).forEach(updateLocObj);
  });
}

function renderStaffOrganisationsTable() {
  const container = document.getElementById("staffOrgsTableContainer");
  const countEl = document.getElementById("staffOrgsCount");
  if (!container) return;

  const orgMap = new Map();
  const addOrgWithRole = (orgList, roleName) => {
    (orgList || []).forEach((org) => {
      const key = org.id ? `id_${org.id}` : `name_${(org.name || "").toLowerCase()}`;
      if (!orgMap.has(key)) {
        orgMap.set(key, {
          org,
          roles: new Set([roleName]),
        });
      } else {
        orgMap.get(key).roles.add(roleName);
      }
    });
  };

  addOrgWithRole(state.leadOrganisations, "Lead");
  addOrgWithRole(state.fundingOrganisations, "Funder");
  addOrgWithRole(state.involvedOrganisations, "Involved");

  const orgEntries = [...orgMap.values()];
  if (countEl) {
    countEl.textContent = `${orgEntries.length} linked`;
  }

  if (orgEntries.length === 0) {
    container.innerHTML = `<p class="empty-note">No organisations linked yet. Search and select organisations above to edit their database details here.</p>`;
    return;
  }

  const availableLocations = getKnownCaseLocations();

  container.innerHTML = orgEntries
    .map(({ org, roles }, index) => {
      const orgId = org.id || null;
      const roleBadges = [...roles]
        .map((r) => `<span class="staff-role-badge staff-role-${r.toLowerCase()}">${r}</span>`)
        .join(" ");

      const currentMainLoc = Array.isArray(org.locations) && org.locations.length > 0 ? org.locations[0] : null;

      const rawTypes = Array.isArray(org.type)
        ? org.type
        : typeof org.type === "string" && org.type.trim()
        ? org.type.split(",").map((s) => s.trim())
        : [];

      const KNOWN_TYPES = [
        "Private sector",
        "Funder",
        "Public sector",
        "Non-profit",
        "Research",
        "Individual Donor",
      ];

      const typePillsHtml = KNOWN_TYPES.map((t) => {
        const isChecked = rawTypes.includes(t);
        return `
          <label class="org-type-pill ${isChecked ? "is-selected" : ""}">
            <input type="checkbox" name="orgType_${index}" value="${escapeHtml(t)}" ${isChecked ? "checked" : ""}>
            <span>${escapeHtml(t)}</span>
          </label>
        `;
      }).join("");

      return `
        <div class="staff-entity-card" data-org-id="${orgId || ""}" data-org-index="${index}">
          <div class="staff-entity-card-header">
            <div class="staff-entity-header-left">
              <strong>${escapeHtml(org.name || "Untitled Organisation")}</strong>
              ${roleBadges}
              ${orgId ? `<span class="staff-entity-id-tag">ID: #${orgId}</span>` : `<span class="badge badge-amber">(Unsaved New Org)</span>`}
            </div>
            <div class="staff-entity-header-actions">
              <span class="staff-inline-status" id="orgStatus_${index}"></span>
            </div>
          </div>

          <div class="staff-card-grid">
            <div class="staff-field-group">
              <label for="orgNameInput_${index}">Organisation Title *</label>
              <input type="text" id="orgNameInput_${index}" value="${escapeHtml(org.name || "")}" placeholder="e.g. Health Foundation">
            </div>

            <div class="staff-field-group">
              <label for="orgWebInput_${index}">Website URL</label>
              <input type="url" id="orgWebInput_${index}" value="${escapeHtml(org.website || "")}" placeholder="https://example.org">
            </div>

            <div class="staff-field-group" style="grid-column: 1 / -1;">
              <label>Organisation Type(s)</label>
              <div class="org-types-pills" id="orgTypesPills_${index}">
                ${typePillsHtml}
              </div>
            </div>

            <div class="staff-field-group" style="grid-column: 1 / -1;">
              <label>Main Location (Headquarters / City)</label>
              <div class="org-single-location-picker" id="orgLocPicker_${index}">
                <div class="selected-tags" id="orgLocTags_${index}"></div>
                <div class="picker-search-box ${currentMainLoc ? "hidden" : ""}" id="orgLocSearchBox_${index}">
                  <input type="text" class="org-search-input" id="orgLocInput_${index}" placeholder="Search or add &amp; geocode location (e.g. London, Nairobi)...">
                  <div class="search-dropdown hidden" id="orgLocDropdown_${index}"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="staff-entity-footer">
            <button type="button" class="btn-staff-entity-save" id="saveOrgBtn_${index}" ${!orgId ? "disabled title='Save case changes first to assign a database ID'" : ""}>
              💾 Save Organisation Details
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach event listeners
  orgEntries.forEach(({ org }, index) => {
    const cardEl = container.querySelector(`[data-org-index="${index}"]`);
    if (!cardEl) return;

    const nameInput = cardEl.querySelector(`#orgNameInput_${index}`);
    const webInput = cardEl.querySelector(`#orgWebInput_${index}`);
    const saveBtn = cardEl.querySelector(`#saveOrgBtn_${index}`);
    const statusEl = cardEl.querySelector(`#orgStatus_${index}`);

    const currentMainLoc = Array.isArray(org.locations) && org.locations.length > 0 ? org.locations[0] : null;
    let cardMainLoc = currentMainLoc ? { ...currentMainLoc } : null;

    // Single-location picker controls
    const locTagsEl = cardEl.querySelector(`#orgLocTags_${index}`);
    const locSearchBox = cardEl.querySelector(`#orgLocSearchBox_${index}`);
    const locInputEl = cardEl.querySelector(`#orgLocInput_${index}`);
    const locDropdownEl = cardEl.querySelector(`#orgLocDropdown_${index}`);

    const renderCardLocTag = () => {
      if (!locTagsEl || !locSearchBox) return;
      locTagsEl.innerHTML = "";
      if (cardMainLoc) {
        const hasCoords =
          cardMainLoc.latitude !== null &&
          cardMainLoc.latitude !== undefined &&
          cardMainLoc.longitude !== null &&
          cardMainLoc.longitude !== undefined;
        const tag = document.createElement("span");
        tag.className = "tag" + (cardMainLoc.isNew ? " tag-new" : "");
        const cc = cardMainLoc.countryCode ? ` [${escapeHtml(cardMainLoc.countryCode)}]` : "";
        const coordsBadge = hasCoords
          ? ` <small class="tag-coord-check" title="Plotted on map (${Number(cardMainLoc.latitude).toFixed(2)}, ${Number(cardMainLoc.longitude).toFixed(2)})">&#10003;</small>`
          : "";
        tag.innerHTML = `
          📍 ${escapeHtml(cardMainLoc.name || "Location")}${cc}${coordsBadge}
          ${cardMainLoc.isNew ? "<small>(New)</small>" : ""}
          <button type="button" aria-label="Remove main location">&times;</button>
        `;
        tag.querySelector("button").addEventListener("click", () => {
          cardMainLoc = null;
          renderCardLocTag();
          if (locInputEl) {
            locInputEl.value = "";
            setTimeout(() => locInputEl.focus(), 50);
          }
        });
        locTagsEl.appendChild(tag);

        if (hasCoords) {
          const mapBtn = document.createElement("a");
          mapBtn.href = `https://www.google.com/maps?q=${cardMainLoc.latitude},${cardMainLoc.longitude}`;
          mapBtn.target = "_blank";
          mapBtn.rel = "noopener noreferrer";
          mapBtn.className = "btn-map-preview";
          mapBtn.title = "View on Google Maps";
          mapBtn.innerHTML = "🗺️ Map ↗";
          locTagsEl.appendChild(mapBtn);
        }

        locSearchBox.classList.add("hidden");
      } else {
        locSearchBox.classList.remove("hidden");
      }
    };

    renderCardLocTag();

    let locDebounceTimer;
    if (locInputEl && locDropdownEl) {
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
              cardMainLoc = { ...selectedLoc };
              renderCardLocTag();

              // If newly added location has no coordinates yet, geocode in background
              if (selectedLoc.isNew && (selectedLoc.latitude == null || selectedLoc.longitude == null)) {
                try {
                  const geoRes = await fetch(
                    `/api/locations?geocode=1&q=${encodeURIComponent(selectedLoc.name)}`
                  );
                  if (geoRes.ok) {
                    const geoData = await geoRes.json();
                    if (geoData.geocoded) {
                      cardMainLoc.latitude = geoData.geocoded.latitude;
                      cardMainLoc.longitude = geoData.geocoded.longitude;
                      cardMainLoc.countryCode = geoData.geocoded.countryCode || "";
                      renderCardLocTag();
                    }
                  }
                } catch (_) {}
              }

              locInputEl.value = "";
              locDropdownEl.innerHTML = "";
              locDropdownEl.classList.add("hidden");
            });
          } catch {
            locDropdownEl.innerHTML = `<div class="dropdown-item error">Error searching locations</div>`;
          }
        }, 220);
      });

      document.addEventListener("click", (e) => {
        if (!cardEl.contains(e.target)) {
          locDropdownEl?.classList.add("hidden");
        }
      });
    }

    let initialName = (org.name || "").trim();
    let initialWeb = (org.website || "").trim();
    let initialTypes = (Array.isArray(org.type)
      ? org.type
      : typeof org.type === "string" && org.type.trim()
      ? org.type.split(",").map((s) => s.trim())
      : []
    ).sort();
    let initialLocId = currentMainLoc && currentMainLoc.id ? Number(currentMainLoc.id) : null;
    let initialLocName = currentMainLoc && currentMainLoc.name ? currentMainLoc.name.trim() : "";

    cardEl._isDirty = () => {
      const curName = (nameInput?.value || "").trim();
      const curWeb = (webInput?.value || "").trim();
      const curTypes = Array.from(cardEl.querySelectorAll(`.org-types-pills input:checked`))
        .map((cb) => cb.value)
        .sort();
      const curLocId = cardMainLoc && cardMainLoc.id ? Number(cardMainLoc.id) : null;
      const curLocName = cardMainLoc && cardMainLoc.name ? cardMainLoc.name.trim() : "";

      if (cardMainLoc && cardMainLoc.isNew) return true;
      if (curName !== initialName) return true;
      if (curWeb !== initialWeb) return true;
      if (JSON.stringify(curTypes) !== JSON.stringify(initialTypes)) return true;
      if (curLocId !== initialLocId) return true;
      if (curLocName !== initialLocName) return true;
      return false;
    };

    const checkAndShowDirty = () => {
      const dirty = cardEl._isDirty();
      if (dirty) {
        cardEl.dataset.isDirty = "true";
        if (statusEl && !statusEl.classList.contains("is-saving")) {
          statusEl.className = "staff-inline-status is-unsaved";
          statusEl.textContent = "Unsaved changes";
        }
      } else {
        delete cardEl.dataset.isDirty;
        if (statusEl && statusEl.classList.contains("is-unsaved")) {
          statusEl.textContent = "";
        }
      }
    };

    cardEl._save = async () => {
      if (!org.id) return false;
      const newName = (nameInput?.value || "").trim();
      if (!newName) {
        if (statusEl) {
          statusEl.className = "staff-inline-status is-error";
          statusEl.textContent = "Title cannot be empty.";
        }
        return false;
      }
      const newWeb = (webInput?.value || "").trim();
      const selectedTypes = Array.from(cardEl.querySelectorAll(`.org-types-pills input:checked`)).map(
        (cb) => cb.value
      );

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      if (statusEl) {
        statusEl.className = "staff-inline-status is-saving";
        statusEl.textContent = "Updating database...";
      }

      try {
        const res = await fetch("/api/organisations/update", {
          method: "PATCH",
          headers: getStaffHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            id: org.id,
            name: newName,
            website: newWeb,
            type: selectedTypes,
            mainLocation: cardMainLoc,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to update organisation.");
        }

        updateOrgInLocalState(data.organisation);
        delete cardEl.dataset.isDirty;

        initialName = (data.organisation.name || "").trim();
        initialWeb = (data.organisation.website || "").trim();
        initialTypes = (Array.isArray(data.organisation.type) ? data.organisation.type : []).sort();
        const updatedMainLoc =
          Array.isArray(data.organisation.locations) && data.organisation.locations.length > 0
            ? data.organisation.locations[0]
            : null;
        initialLocId = updatedMainLoc && updatedMainLoc.id ? Number(updatedMainLoc.id) : null;
        initialLocName = updatedMainLoc && updatedMainLoc.name ? updatedMainLoc.name.trim() : "";
        cardMainLoc = updatedMainLoc ? { ...updatedMainLoc } : null;

        if (statusEl) {
          statusEl.className = "staff-inline-status is-saved";
          statusEl.textContent = "✓ Saved!";
          setTimeout(() => {
            if (statusEl && !cardEl.dataset.isDirty) statusEl.textContent = "";
          }, 3000);
        }

        renderSelectedTags(document.getElementById("leadOrgsPicker_tags"), "leadOrganisations");
        renderSelectedTags(document.getElementById("fundingOrgsPicker_tags"), "fundingOrganisations");
        renderSelectedTags(document.getElementById("involvedOrgsPicker_tags"), "involvedOrganisations");
        return true;
      } catch (err) {
        if (statusEl) {
          statusEl.className = "staff-inline-status is-error";
          statusEl.textContent = `Error: ${err.message}`;
        }
        return false;
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Save Organisation Details";
      }
    };

    if (nameInput) {
      nameInput.addEventListener("input", checkAndShowDirty);
    }
    if (webInput) {
      webInput.addEventListener("input", checkAndShowDirty);
    }

    const pills = cardEl.querySelectorAll(".org-type-pill");
    pills.forEach((pill) => {
      const checkbox = pill.querySelector("input[type='checkbox']");
      checkbox?.addEventListener("change", () => {
        pill.classList.toggle("is-selected", checkbox.checked);
        checkAndShowDirty();
      });
    });

    if (saveBtn && org.id) {
      saveBtn.addEventListener("click", () => cardEl._save());
    }
  });
}

async function saveAllDirtyStaffOrganisations() {
  const container = document.getElementById("staffOrgsTableContainer");
  if (!container) return;
  const cards = container.querySelectorAll(".staff-entity-card");
  const savePromises = [];
  cards.forEach((card) => {
    if (typeof card._isDirty === "function" && card._isDirty() && typeof card._save === "function") {
      savePromises.push(card._save());
    }
  });
  if (savePromises.length > 0) {
    await Promise.all(savePromises);
    renderStaffLocationsList();
  }
}

function renderStaffLocationsList() {
  const container = document.getElementById("staffLocationsListContainer");
  const countEl = document.getElementById("staffLocationsCount");
  if (!container) return;

  const locMap = new Map();

  // 1. Participant locations
  (state.participants || []).forEach((p, pIdx) => {
    const pLabel = p.targetPopulation || p.description || `Group ${pIdx + 1}`;
    (p.locations || []).forEach((l) => {
      const key = l.id ? `id_${l.id}` : `name_${(l.name || "").toLowerCase()}`;
      if (!locMap.has(key)) {
        locMap.set(key, {
          location: l,
          participantTags: [pLabel],
          orgTags: [],
        });
      } else {
        const item = locMap.get(key);
        if (!item.participantTags.includes(pLabel)) {
          item.participantTags.push(pLabel);
        }
      }
    });
  });

  // 2. Organisation locations
  const allOrgs = [
    ...(state.leadOrganisations || []).map((o) => ({ ...o, role: "Lead" })),
    ...(state.fundingOrganisations || []).map((o) => ({ ...o, role: "Funder" })),
    ...(state.involvedOrganisations || []).map((o) => ({ ...o, role: "Involved" })),
  ];

  allOrgs.forEach((org) => {
    (org.locations || []).forEach((l) => {
      const key = l.id ? `id_${l.id}` : `name_${(l.name || "").toLowerCase()}`;
      const orgTag = `${org.name || "Organisation"} (Main Location)`;
      if (!locMap.has(key)) {
        locMap.set(key, {
          location: l,
          participantTags: [],
          orgTags: [orgTag],
        });
      } else {
        const item = locMap.get(key);
        if (!item.orgTags.includes(orgTag)) {
          item.orgTags.push(orgTag);
        }
      }
    });
  });

  const locEntries = [...locMap.values()];
  if (countEl) {
    countEl.textContent = `${locEntries.length} location${locEntries.length === 1 ? "" : "s"}`;
  }

  if (locEntries.length === 0) {
    container.innerHTML = `<p class="empty-note">No locations associated with this case yet. Add locations to participants or organisations above to edit them here.</p>`;
    return;
  }

  container.innerHTML = locEntries
    .map(({ location: loc, participantTags, orgTags }, index) => {
      const locId = loc.id || null;
      const pTagsHtml = participantTags
        .map((t) => `<span class="loc-tag loc-tag-participant">👥 Participant: ${escapeHtml(t)}</span>`)
        .join(" ");
      const oTagsHtml = orgTags
        .map((t) => `<span class="loc-tag loc-tag-org">🏢 Organisation: ${escapeHtml(t)}</span>`)
        .join(" ");

      const lat =
        loc.latitude !== null && loc.latitude !== undefined && !isNaN(Number(loc.latitude))
          ? Number(loc.latitude)
          : "";
      const lng =
        loc.longitude !== null && loc.longitude !== undefined && !isNaN(Number(loc.longitude))
          ? Number(loc.longitude)
          : "";
      const hasCoords = lat !== "" && lng !== "";
      const mapsUrl = hasCoords ? `https://www.google.com/maps?q=${lat},${lng}` : "#";

      const currentCc = (loc.countryCode || "").toUpperCase();
      let countryOptionsHtml = "";
      ISO_COUNTRY_CODES.forEach((c) => {
        const isSel = c.code === currentCc;
        countryOptionsHtml += `<option value="${c.code}" ${isSel ? "selected" : ""}>${escapeHtml(c.name)}</option>`;
      });

      return `
        <div class="staff-entity-card" data-loc-id="${locId || ""}" data-loc-index="${index}">
          <div class="staff-entity-card-header">
            <div class="staff-entity-header-left">
              <div class="loc-tags-row">
                ${pTagsHtml}
                ${oTagsHtml}
              </div>
              ${locId ? `<span class="staff-entity-id-tag">ID: #${locId}</span>` : `<span class="badge badge-amber">(Unsaved New Location)</span>`}
            </div>
            <div class="staff-entity-header-actions">
              <span class="staff-inline-status" id="locStatus_${index}"></span>
            </div>
          </div>

          <div class="staff-card-grid">
            <div class="staff-field-group">
              <label for="locNameInput_${index}">Location Name *</label>
              <input type="text" id="locNameInput_${index}" value="${escapeHtml(loc.name || "")}" placeholder="e.g. Manchester, Greater Manchester">
            </div>

            <div class="staff-field-group">
              <label for="locCountrySelect_${index}">Country Code</label>
              <select id="locCountrySelect_${index}">
                ${countryOptionsHtml}
              </select>
            </div>

            <div class="staff-field-group">
              <label for="locLatInput_${index}">Latitude</label>
              <input type="number" step="any" id="locLatInput_${index}" value="${lat}" placeholder="e.g. 53.4808">
            </div>

            <div class="staff-field-group">
              <label for="locLngInput_${index}">Longitude</label>
              <input type="number" step="any" id="locLngInput_${index}" value="${lng}" placeholder="e.g. -2.2426">
            </div>
          </div>

          <div class="staff-entity-footer">
            <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-map-preview ${hasCoords ? "" : "is-disabled"}" id="locMapBtn_${index}" title="Open these coordinates in Google Maps">
              🗺️ Open in Google Maps ↗
            </a>
            <button type="button" class="btn-staff-geocode" id="locGeocodeBtn_${index}" title="Re-run geocoding using location name and country code">
              📍 Geocode
            </button>
            <button type="button" class="btn-staff-entity-save" id="saveLocBtn_${index}" ${!locId ? "disabled title='Save case changes first to assign a database ID'" : ""}>
              💾 Save Location Details
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach event listeners
  locEntries.forEach(({ location: loc }, index) => {
    const cardEl = container.querySelector(`[data-loc-index="${index}"]`);
    if (!cardEl) return;

    const nameInput = cardEl.querySelector(`#locNameInput_${index}`);
    const countrySelect = cardEl.querySelector(`#locCountrySelect_${index}`);
    const latInput = cardEl.querySelector(`#locLatInput_${index}`);
    const lngInput = cardEl.querySelector(`#locLngInput_${index}`);
    const mapBtn = cardEl.querySelector(`#locMapBtn_${index}`);
    const geocodeBtn = cardEl.querySelector(`#locGeocodeBtn_${index}`);
    const saveBtn = cardEl.querySelector(`#saveLocBtn_${index}`);
    const statusEl = cardEl.querySelector(`#locStatus_${index}`);

    let initialLocName = (loc.name || "").trim();
    let initialCountryCode = (loc.countryCode || "").toUpperCase();
    let initialLat =
      loc.latitude !== null && loc.latitude !== undefined && !isNaN(Number(loc.latitude))
        ? Number(loc.latitude)
        : null;
    let initialLng =
      loc.longitude !== null && loc.longitude !== undefined && !isNaN(Number(loc.longitude))
        ? Number(loc.longitude)
        : null;

    cardEl._isDirty = () => {
      const curName = (nameInput?.value || "").trim();
      const curCc = (countrySelect?.value || "").toUpperCase();
      const rawLat = latInput?.value;
      const rawLng = lngInput?.value;
      const curLat = rawLat !== "" && !isNaN(Number(rawLat)) ? Number(rawLat) : null;
      const curLng = rawLng !== "" && !isNaN(Number(rawLng)) ? Number(rawLng) : null;

      if (curName !== initialLocName) return true;
      if (curCc !== initialCountryCode) return true;
      if (curLat !== initialLat) return true;
      if (curLng !== initialLng) return true;
      return false;
    };

    const checkAndShowDirty = () => {
      const dirty = cardEl._isDirty();
      if (dirty) {
        cardEl.dataset.isDirty = "true";
        if (statusEl && !statusEl.classList.contains("is-saving")) {
          statusEl.className = "staff-inline-status is-unsaved";
          statusEl.textContent = "Unsaved changes";
        }
      } else {
        delete cardEl.dataset.isDirty;
        if (statusEl && statusEl.classList.contains("is-unsaved")) {
          statusEl.textContent = "";
        }
      }
    };

    const updateMapLink = () => {
      const latVal = parseFloat(latInput?.value);
      const lngVal = parseFloat(lngInput?.value);
      if (!isNaN(latVal) && !isNaN(lngVal)) {
        if (mapBtn) {
          mapBtn.href = `https://www.google.com/maps?q=${latVal},${lngVal}`;
          mapBtn.classList.remove("is-disabled");
        }
      } else {
        if (mapBtn) {
          mapBtn.href = "#";
          mapBtn.classList.add("is-disabled");
        }
      }
    };

    if (geocodeBtn) {
      geocodeBtn.addEventListener("click", async () => {
        const queryName = (nameInput?.value || "").trim();
        if (!queryName) {
          if (statusEl) {
            statusEl.className = "staff-inline-status is-error";
            statusEl.textContent = "Please enter a location name first.";
          }
          nameInput?.focus();
          return;
        }

        const selectedCc = (countrySelect?.value || "").trim();

        geocodeBtn.disabled = true;
        geocodeBtn.textContent = "Geocoding...";
        if (statusEl) {
          statusEl.className = "staff-inline-status is-saving";
          statusEl.textContent = `Looking up "${queryName}"${selectedCc ? ` in ${selectedCc}` : ""}...`;
        }

        try {
          let geocodeUrl = `/api/locations?geocode=1&q=${encodeURIComponent(queryName)}`;
          if (selectedCc) {
            geocodeUrl += `&countryCode=${encodeURIComponent(selectedCc)}`;
          }

          const res = await fetch(geocodeUrl);
          const data = await res.json();

          if (data && data.geocoded) {
            const { latitude, longitude, countryCode: resCc } = data.geocoded;

            if (latitude != null && longitude != null) {
              if (latInput) latInput.value = latitude;
              if (lngInput) lngInput.value = longitude;

              if (resCc && countrySelect && !countrySelect.value) {
                countrySelect.value = resCc.toUpperCase();
              }

              updateMapLink();
              checkAndShowDirty();

              if (statusEl) {
                statusEl.className = "staff-inline-status is-saved";
                statusEl.textContent = `✓ Geocoded: ${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}${resCc ? ` (${resCc})` : ""}`;
                setTimeout(() => {
                  if (statusEl && cardEl.dataset.isDirty) {
                    statusEl.className = "staff-inline-status is-unsaved";
                    statusEl.textContent = "Unsaved changes";
                  }
                }, 3500);
              }
            } else {
              throw new Error("No coordinates returned.");
            }
          } else {
            if (statusEl) {
              statusEl.className = "staff-inline-status is-error";
              statusEl.textContent = `No geocode results for "${queryName}"${selectedCc ? ` in ${selectedCc}` : ""}. Try refining the name.`;
            }
          }
        } catch (err) {
          if (statusEl) {
            statusEl.className = "staff-inline-status is-error";
            statusEl.textContent = `Geocode failed: ${err.message}`;
          }
        } finally {
          geocodeBtn.disabled = false;
          geocodeBtn.textContent = "📍 Geocode";
        }
      });
    }

    cardEl._save = async () => {
      if (!loc.id) return false;
      const newName = (nameInput?.value || "").trim();
      if (!newName) {
        if (statusEl) {
          statusEl.className = "staff-inline-status is-error";
          statusEl.textContent = "Location name cannot be empty.";
        }
        return false;
      }

      const newCc = (countrySelect?.value || "").trim();
      const rawLat = latInput?.value;
      const rawLng = lngInput?.value;
      const newLat = rawLat !== "" && !isNaN(Number(rawLat)) ? Number(rawLat) : null;
      const newLng = rawLng !== "" && !isNaN(Number(rawLng)) ? Number(rawLng) : null;

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      if (statusEl) {
        statusEl.className = "staff-inline-status is-saving";
        statusEl.textContent = "Updating database...";
      }

      try {
        const res = await fetch("/api/locations/update", {
          method: "PATCH",
          headers: getStaffHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            id: loc.id,
            name: newName,
            latitude: newLat,
            longitude: newLng,
            countryCode: newCc,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to update location.");
        }

        updateLocationInLocalState(data.location);
        delete cardEl.dataset.isDirty;

        initialLocName = (data.location.name || "").trim();
        initialCountryCode = (data.location.countryCode || "").toUpperCase();
        initialLat = data.location.latitude;
        initialLng = data.location.longitude;

        if (statusEl) {
          statusEl.className = "staff-inline-status is-saved";
          statusEl.textContent = "✓ Saved!";
          setTimeout(() => {
            if (statusEl && !cardEl.dataset.isDirty) statusEl.textContent = "";
          }, 3000);
        }

        renderParticipantsList();
        return true;
      } catch (err) {
        if (statusEl) {
          statusEl.className = "staff-inline-status is-error";
          statusEl.textContent = `Error: ${err.message}`;
        }
        return false;
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Save Location Details";
      }
    };

    nameInput?.addEventListener("input", checkAndShowDirty);
    countrySelect?.addEventListener("change", checkAndShowDirty);
    latInput?.addEventListener("input", () => {
      updateMapLink();
      checkAndShowDirty();
    });
    lngInput?.addEventListener("input", () => {
      updateMapLink();
      checkAndShowDirty();
    });

    if (saveBtn && loc.id) {
      saveBtn.addEventListener("click", () => cardEl._save());
    }
  });
}

async function saveAllDirtyStaffLocations() {
  const container = document.getElementById("staffLocationsListContainer");
  if (!container) return;
  const cards = container.querySelectorAll(".staff-entity-card");
  const savePromises = [];
  cards.forEach((card) => {
    if (typeof card._isDirty === "function" && card._isDirty() && typeof card._save === "function") {
      savePromises.push(card._save());
    }
  });
  if (savePromises.length > 0) {
    await Promise.all(savePromises);
    renderParticipantsList();
  }
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
  if (state.staffUser) {
    renderStaffLocationsList();
  }
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
 * 5c. Staff Method Image & Caption Manager (Stage 2)
 * ------------------------------------------------------------- */
function renderMethodImageUI() {
  const previewCard = document.getElementById("methodImagePreview");
  const dropzone = document.getElementById("methodImageDropzone");
  const captionInput = document.getElementById("methodImageCaptionInput");

  if (captionInput) {
    captionInput.value = state.methodImageCaption || "";
  }

  if (!previewCard) return;

  if (Array.isArray(state.methodImage) && state.methodImage.length > 0) {
    const item = state.methodImage[0];
    const imgUrl = item.thumbUrl || item.url || item.rawUrl || "";
    const title = item.title || item.name || "Method Image";

    previewCard.innerHTML = `
      <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(title)}" class="method-image-thumb">
      <div class="method-image-meta">
        <div class="method-image-filename" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        <a href="${escapeHtml(item.url || imgUrl)}" target="_blank" rel="noopener noreferrer">View full size &rarr;</a>
      </div>
      <button type="button" id="removeMethodImageBtn" class="btn-remove-method-image" title="Remove method image">
        &times; Remove
      </button>
    `;
    previewCard.classList.remove("hidden");
    dropzone?.classList.add("hidden");

    document.getElementById("removeMethodImageBtn")?.addEventListener("click", () => {
      state.methodImage = [];
      renderMethodImageUI();
      refreshDirtyStateUI();
      if (state.isEditMode) {
        saveEditChanges({ scopes: ["case"] });
      }
      if (window.PaveLivePreview && typeof window.PaveLivePreview.triggerUpdate === "function") {
        window.PaveLivePreview.triggerUpdate();
      }
    });
  } else {
    previewCard.innerHTML = "";
    previewCard.classList.add("hidden");
    dropzone?.classList.remove("hidden");
  }
}

function initMethodImageManager() {
  const dropzone = document.getElementById("methodImageDropzone");
  const fileInput = document.getElementById("methodImageFileInput");
  const triggerBtn = document.getElementById("triggerMethodImageBtn");
  const statusEl = document.getElementById("methodImageUploadStatus");
  const captionInput = document.getElementById("methodImageCaptionInput");

  if (!dropzone || !fileInput) return;

  function setStatus(text, type = "info") {
    if (!statusEl) return;
    if (!text) {
      statusEl.textContent = "";
      statusEl.className = "upload-status-bar hidden";
      return;
    }
    statusEl.textContent = text;
    statusEl.className = `upload-status-bar is-${type}`;
  }

  async function handleMethodFile(file) {
    if (!file || file.size === 0) return;
    if (file.size > 20 * 1024 * 1024) {
      setStatus("⚠ File exceeds the 20 MB size limit.", "error");
      return;
    }

    setStatus("Uploading method image...", "loading");
    if (triggerBtn) triggerBtn.disabled = true;

    try {
      const uploaded = await uploadFilesToApi([file], "method-image");
      if (uploaded.length > 0) {
        state.methodImage = [uploaded[0]];
        renderMethodImageUI();
        setStatus("Method image uploaded successfully.", "success");
        setTimeout(() => setStatus(""), 3000);
        refreshDirtyStateUI();
        if (state.isEditMode) {
          saveEditChanges({ scopes: ["case"] });
        }
        if (window.PaveLivePreview && typeof window.PaveLivePreview.triggerUpdate === "function") {
          window.PaveLivePreview.triggerUpdate();
        }
      }
    } catch (err) {
      setStatus(`Upload failed: ${err.message}`, "error");
    } finally {
      if (triggerBtn) triggerBtn.disabled = false;
      fileInput.value = "";
    }
  }

  triggerBtn?.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) {
      handleMethodFile(fileInput.files[0]);
    }
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("drag-over");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleMethodFile(e.dataTransfer.files[0]);
    }
  });

  if (captionInput) {
    captionInput.addEventListener("input", (e) => {
      state.methodImageCaption = e.target.value;
      refreshDirtyStateUI();
      if (window.PaveLivePreview && typeof window.PaveLivePreview.triggerUpdate === "function") {
        window.PaveLivePreview.triggerUpdate();
      }
    });
  }

  renderMethodImageUI();
}

/* -------------------------------------------------------------
 * 5d. Simple Markdown Rich Text Editor Component
 * ------------------------------------------------------------- */
function formatMarkdownText(textarea, before, after = "", defaultText = "") {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;
  const selected = val.substring(start, end);

  let replacement = "";
  let newStart = start;
  let newEnd = end;

  if (selected.length > 0) {
    // If text is already surrounded with formatting, unwrap it (toggle)
    if (
      val.substring(start - before.length, start) === before &&
      val.substring(end, end + after.length) === after
    ) {
      textarea.value = val.substring(0, start - before.length) + selected + val.substring(end + after.length);
      newStart = start - before.length;
      newEnd = end - before.length;
    } else {
      replacement = before + selected + after;
      textarea.value = val.substring(0, start) + replacement + val.substring(end);
      newStart = start + before.length;
      newEnd = start + before.length + selected.length;
    }
  } else {
    const textToInsert = defaultText || "text";
    replacement = before + textToInsert + after;
    textarea.value = val.substring(0, start) + replacement + val.substring(end);
    newStart = start + before.length;
    newEnd = start + before.length + textToInsert.length;
  }

  textarea.focus();
  textarea.setSelectionRange(newStart, newEnd);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function formatMarkdownLines(textarea, prefix) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;

  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = val.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = val.length;

  const lines = val.substring(lineStart, lineEnd).split("\n");
  const allPrefixed = lines.every((l) => l.startsWith(prefix));

  const newLines = lines.map((l, idx) => {
    if (allPrefixed) {
      return l.substring(prefix.length);
    }
    if (prefix === "1. ") {
      return `${idx + 1}. ${l.replace(/^\d+\.\s*/, "")}`;
    }
    return `${prefix}${l.replace(/^[-*>\s]+/, "")}`;
  });

  const replacement = newLines.join("\n");
  textarea.value = val.substring(0, lineStart) + replacement + val.substring(lineEnd);
  textarea.focus();
  textarea.setSelectionRange(lineStart, lineStart + replacement.length);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function insertMarkdownLink(textarea) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);
  const title = selected || "link title";
  const url = prompt("Enter link URL (e.g. https://example.com):", "https://");
  if (!url) return;

  const linkMd = `[${title}](${url.trim()})`;
  textarea.value = textarea.value.substring(0, start) + linkMd + textarea.value.substring(end);
  textarea.focus();
  textarea.setSelectionRange(start + 1, start + 1 + title.length);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderMarkdownPreview(mdText) {
  if (!mdText || !mdText.trim()) return '<em style="color: #94a3b8;">Nothing to preview</em>';
  let html = escapeHtml(mdText);

  // Headers
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // Bold & Italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/gim, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/gim, "<em>$1</em>");

  // Blockquotes
  html = html.replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Bullet and numbered lists
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, "<li>$1</li>");
  html = html.replace(/^\s*\d+\.\s+(.*$)/gim, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/gims, "<ul>$1</ul>");
  html = html.replace(/<\/ul>\s*<ul>/gim, "");

  // Paragraphs
  const paragraphs = html.split(/\n{2,}/);
  html = paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<h") || trimmed.startsWith("<ul") || trimmed.startsWith("<blockquote")) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .filter(Boolean)
    .join("");

  return html;
}

function initRichTextEditors() {
  const textareas = document.querySelectorAll("textarea.rich-textarea");
  textareas.forEach((textarea) => {
    if (textarea.dataset.richInit === "true") return;
    textarea.dataset.richInit = "true";

    // Ensure rows is at least 6
    if (!textarea.getAttribute("rows") || parseInt(textarea.getAttribute("rows"), 10) < 6) {
      textarea.setAttribute("rows", "6");
    }

    const wrapper = document.createElement("div");
    wrapper.className = "rich-editor-wrapper";
    textarea.parentNode.insertBefore(wrapper, textarea);

    const toolbar = document.createElement("div");
    toolbar.className = "rich-editor-toolbar";
    toolbar.innerHTML = `
      <div class="rich-toolbar-left" role="toolbar" aria-label="Text formatting">
        <button type="button" class="rich-toolbar-btn btn-bold" title="Bold (**text**)" aria-label="Bold"><strong>B</strong></button>
        <button type="button" class="rich-toolbar-btn btn-italic" title="Italic (*text*)" aria-label="Italic"><em>I</em></button>
        <button type="button" class="rich-toolbar-btn btn-heading" title="Heading (### text)" aria-label="Heading">H</button>
        <span class="rich-toolbar-divider" aria-hidden="true"></span>
        <button type="button" class="rich-toolbar-btn btn-bullet" title="Bulleted list (- item)" aria-label="Bullet list">•</button>
        <button type="button" class="rich-toolbar-btn btn-numbered" title="Numbered list (1. item)" aria-label="Numbered list">1.</button>
        <button type="button" class="rich-toolbar-btn btn-quote" title="Blockquote (> quote)" aria-label="Quote">&rdquo;</button>
        <button type="button" class="rich-toolbar-btn btn-link" title="Link ([title](url))" aria-label="Link">🔗</button>
      </div>
      <div class="rich-toolbar-tabs" role="tablist" aria-label="Editor modes">
        <button type="button" class="rich-tab-btn tab-write is-active" role="tab" aria-selected="true">Write</button>
        <button type="button" class="rich-tab-btn tab-preview" role="tab" aria-selected="false">Preview</button>
      </div>
    `;

    const preview = document.createElement("div");
    preview.className = "rich-editor-preview hidden";
    preview.setAttribute("role", "tabpanel");

    wrapper.appendChild(toolbar);
    wrapper.appendChild(textarea);
    wrapper.appendChild(preview);

    const btnBold = toolbar.querySelector(".btn-bold");
    const btnItalic = toolbar.querySelector(".btn-italic");
    const btnHeading = toolbar.querySelector(".btn-heading");
    const btnBullet = toolbar.querySelector(".btn-bullet");
    const btnNumbered = toolbar.querySelector(".btn-numbered");
    const btnQuote = toolbar.querySelector(".btn-quote");
    const btnLink = toolbar.querySelector(".btn-link");
    const tabWrite = toolbar.querySelector(".tab-write");
    const tabPreview = toolbar.querySelector(".tab-preview");

    btnBold?.addEventListener("click", () => formatMarkdownText(textarea, "**", "**", "bold text"));
    btnItalic?.addEventListener("click", () => formatMarkdownText(textarea, "*", "*", "italic text"));
    btnHeading?.addEventListener("click", () => formatMarkdownLines(textarea, "### "));
    btnBullet?.addEventListener("click", () => formatMarkdownLines(textarea, "- "));
    btnNumbered?.addEventListener("click", () => formatMarkdownLines(textarea, "1. "));
    btnQuote?.addEventListener("click", () => formatMarkdownLines(textarea, "> "));
    btnLink?.addEventListener("click", () => insertMarkdownLink(textarea));

    tabWrite?.addEventListener("click", () => {
      tabWrite.classList.add("is-active");
      tabWrite.setAttribute("aria-selected", "true");
      tabPreview?.classList.remove("is-active");
      tabPreview?.setAttribute("aria-selected", "false");
      textarea.classList.remove("hidden");
      preview.classList.add("hidden");
      textarea.focus();
    });

    tabPreview?.addEventListener("click", () => {
      tabPreview.classList.add("is-active");
      tabPreview.setAttribute("aria-selected", "true");
      tabWrite?.classList.remove("is-active");
      tabWrite?.setAttribute("aria-selected", "false");
      preview.innerHTML = renderMarkdownPreview(textarea.value);
      textarea.classList.add("hidden");
      preview.classList.remove("hidden");
    });

    // Switch back to Write mode if HTML5 validation triggers on hidden textarea
    textarea.addEventListener("invalid", () => {
      tabWrite?.click();
    });

    // Keyboard shortcuts
    textarea.addEventListener("keydown", (e) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === "b") {
        e.preventDefault();
        formatMarkdownText(textarea, "**", "**", "bold text");
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "i") {
        e.preventDefault();
        formatMarkdownText(textarea, "*", "*", "italic text");
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "k") {
        e.preventDefault();
        insertMarkdownLink(textarea);
      }
    });
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
    methodImage: state.methodImage,
    methodImageCaption: (document.getElementById("methodImageCaptionInput")?.value || state.methodImageCaption || "").trim(),
    workflowStatus: state.staffCanEdit
      ? document.getElementById("staffWorkflowStatus")?.value || undefined
      : undefined,
    curationDecision: state.staffCanEdit
      ? document.getElementById("staffCurationDecision")?.value ?? ""
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
      methodImage: (p.methodImage || []).map((img) => ({
        rawUrl: img.rawUrl || img.url || "",
        title: img.title || "",
      })),
      methodImageCaption: p.methodImageCaption || "",
      workflowStatus: p.workflowStatus || "",
      curationDecision: p.curationDecision || "",
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

  if (state.staffUser) {
    await saveAllDirtyStaffOrganisations();
    await saveAllDirtyStaffLocations();
  }

  const scopesToSave =
    dirtyScopes.length > 0
      ? dirtyScopes
      : ["case", "organisations", "participants", "resources", "messages"];

  const payload = buildSubmissionPayload(scopesToSave);

  if (!payload.projectTitle) {
    updateEditSaveStatusUI("error", "Project Title (Stage 2) is required to save");
    highlightFieldError("projectTitle", "Project Title is required.");
    return { error: "Project Title is required." };
  }

  if (payload.projectUrl && !isValidClientUrl(payload.projectUrl)) {
    updateEditSaveStatusUI("error", "Project URL (Stage 2) must start with http:// or https://");
    highlightFieldError("projectUrl", "Project URL must be a valid http:// or https:// address.");
    return { error: "Invalid Project URL." };
  }

  if (payload.submitterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.submitterEmail)) {
    updateEditSaveStatusUI("error", "Please enter a valid contact email in Stage 1");
    highlightFieldError("submitterEmail", "Please enter a valid contact email.");
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
      state.workflowStatus = payload.workflowStatus;
    }
    if (payload.curationDecision !== undefined) {
      state.curationDecision = payload.curationDecision;
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
      renderStaffOrganisationsTable();
      renderStaffLocationsList();
      renderMethodImageUI();
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
  const curationSelect = document.getElementById("staffCurationDecision");

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

  if (curationSelect) {
    curationSelect.addEventListener("change", () => {
      if (state.isEditMode) {
        saveEditChanges({ scopes: ["case"] });
      }
    });
  }

  const methodCaptionInput = document.getElementById("methodImageCaptionInput");
  if (methodCaptionInput) {
    methodCaptionInput.addEventListener("change", () => {
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
      const editErrors = getCaseValidationErrors(true);
      if (editErrors.length > 0) {
        showValidationSummary(editErrors);
        focusAndHighlightField(editErrors[0].fieldId);
        return;
      }
      clearValidationSummary();

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
        statusEl.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          statusEl.classList.add("hidden");
        }, 4500);
      } else if (statusEl && res.error) {
        statusEl.className = "status-msg error";
        statusEl.textContent = `Error: ${res.error}`;
        statusEl.classList.remove("hidden");
        statusEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    // New Submission: check all required fields across all stages
    const allErrors = getCaseValidationErrors(false);
    if (allErrors.length > 0) {
      showValidationSummary(allErrors, "stage7ValidationSummary");
      focusAndHighlightField(allErrors[0].fieldId);
      return;
    }
    clearValidationSummary();

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
