/**
 * PAVE Form Application Logic
 * Supports new submission and editing of existing cases with valid EditKey
 * Multi-stage tabbed navigation with real-time stage completion tick-marks
 */

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
};

const STAGES_CONFIG = [
  { id: "stage-1", label: "1. About You", isFullOnly: false },
  { id: "stage-2", label: "2. Project Details", isFullOnly: false },
  { id: "stage-3", label: "3. Organisations", isFullOnly: true },
  { id: "stage-4", label: "4. Focus of Engagement", isFullOnly: true },
  { id: "stage-5", label: "5. Participants", isFullOnly: true },
  { id: "stage-6", label: "6. Headline Findings", isFullOnly: true },
  { id: "stage-7", label: "7. Supporting Resources", isFullOnly: true },
  { id: "stage-8", label: "8. Consent & Submit", isFullOnly: false },
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
      const aiForms = getCheckedValues("aiForms");
      const subject = (document.getElementById("subjectMatter")?.value || "").trim();
      const goals = getCheckedValues("projectGoals");
      return aiForms.length > 0 || subject.length > 0 || goals.length > 0;
    }
    case "stage-5": {
      const inclusion = (document.getElementById("inclusionEfforts")?.value || "").trim();
      const limitations = (document.getElementById("limitations")?.value || "").trim();
      return state.participants.length > 0 || inclusion.length > 0 || limitations.length > 0;
    }
    case "stage-6": {
      const findings = (document.getElementById("headlineFindings")?.value || "").trim();
      const aiAssistance = getCheckedValues("aiAssistance");
      return findings.length > 0 || aiAssistance.length > 0;
    }
    case "stage-7": {
      const published = getCheckedValues("publishedResources");
      const photos = getCheckedValues("photosAvailable");
      return published.length > 0 || state.resources.length > 0 || photos.length > 0;
    }
    case "stage-8": {
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
    stage2NextBtn.dataset.target = isFull ? "stage-3" : "stage-8";
    stage2NextBtn.innerHTML = isFull ? "Next: Organisations &rarr;" : "Next: Consent &amp; Submit &rarr;";
  }

  const stage8PrevBtn = document.getElementById("stage8PrevBtn");
  if (stage8PrevBtn) {
    stage8PrevBtn.dataset.target = isFull ? "stage-7" : "stage-2";
    stage8PrevBtn.innerHTML = isFull ? "&larr; Back: Supporting Resources" : "&larr; Back: Project Details";
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

document.addEventListener("DOMContentLoaded", () => {
  initIntentToggle();
  initStageNavigation();
  initOrgPickers();
  initParticipantManager();
  initResourceManager();
  initFormSubmission();
  checkEditMode();
  renderStageTabs();
  goToStage("stage-1");
});

/* -------------------------------------------------------------
 * 1. Edit Mode Detection & Pre-population
 * ------------------------------------------------------------- */
async function checkEditMode() {
  const params = new URLSearchParams(window.location.search);
  const editKey = params.get("editKey") || params.get("editkey");
  const caseId = params.get("id") || params.get("caseId");

  if (!editKey) return;

  const banner = document.getElementById("editBanner");
  const bannerTitle = document.getElementById("editBannerTitle");
  const bannerSubtitle = document.getElementById("editBannerSubtitle");

  if (editKey.length < 12) {
    banner.classList.remove("hidden");
    banner.classList.add("error-banner");
    bannerTitle.textContent = "Edit Access Denied";
    bannerSubtitle.textContent = "The provided EditKey is invalid (must be at least 12 characters).";
    document.getElementById("caseForm").classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  bannerTitle.textContent = "Verifying Edit Credentials...";
  bannerSubtitle.textContent = "Fetching case details from database...";

  try {
    let url = `/api/case?editKey=${encodeURIComponent(editKey)}`;
    if (caseId) {
      url += `&id=${encodeURIComponent(caseId)}`;
    }

    const res = await fetch(url);
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
    state.editKey = c.editKey;

    // Show form
    document.getElementById("caseForm").classList.remove("hidden");

    // Hide 'What would you like to do' option when editing
    const intentEl = document.getElementById("intentFieldset");
    if (intentEl) intentEl.classList.add("hidden");

    // Always go to 'Provide full case book entry'
    state.submissionIntent = "full";
    const fullRadio = document.querySelector('input[name="submissionIntent"][value="full"]');
    if (fullRadio) fullRadio.checked = true;
    const fullStages = document.getElementById("fullCaseStages");
    if (fullStages) fullStages.classList.remove("hidden");

    // Set hidden inputs
    document.getElementById("caseId").value = c.id;
    document.getElementById("editKey").value = c.editKey;

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

    // Update banner and submit button
    bannerTitle.textContent = `Editing Case #${c.id}: "${c.projectTitle}"`;
    bannerSubtitle.textContent = `Status: ${c.workflowStatus}. Submitting will update the existing database record.`;
    document.getElementById("submitBtn").textContent = "Save Changes";

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
function initIntentToggle() {
  const radios = document.querySelectorAll('input[name="submissionIntent"]');

  radios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      state.submissionIntent = e.target.value;
      const isFull = e.target.value === "full";
      const fullSection = document.getElementById("fullCaseStages");
      if (fullSection) {
        if (isFull) {
          fullSection.classList.remove("hidden");
        } else {
          fullSection.classList.add("hidden");
        }
      }

      const activeStages = getActiveStages();
      if (!activeStages.some((s) => s.id === state.currentStageId)) {
        goToStage(activeStages[0].id);
      } else {
        goToStage(state.currentStageId);
      }
      renderStageTabs();
    });
  });
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
 * 6. Form Submission (Create or Edit)
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
      goToStage("stage-8");
      alert("Please agree to the consent statement before submitting.");
      document.getElementById("consentCheck")?.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = state.isEditMode ? "Saving Changes..." : "Submitting...";
    statusEl.className = "status-msg";
    statusEl.textContent = state.isEditMode ? "Updating case record in NocoDB..." : "Sending your case submission to NocoDB...";
    statusEl.classList.remove("hidden");

    const payload = {
      caseId: state.caseId,
      editKey: state.editKey,

      // Submitter
      submitterName: document.getElementById("submitterName").value.trim(),
      submitterEmail: email,
      submitterRoles: getCheckedValues("submitterRoles"),
      submissionIntent: state.submissionIntent,
      additionalAcknowledgements: document.getElementById("additionalAcknowledgements").value.trim(),

      // Project Details
      projectTitle: document.getElementById("projectTitle").value.trim(),
      projectUrl: projectUrl,
      projectDescription: document.getElementById("projectDescription").value.trim(),
      importanceReason: document.getElementById("importanceReason").value.trim(),
      initiatedMethods: getCheckedValues("initiatedMethods"),
      startYear: document.getElementById("startYear").value || null,
      projectStatus: document.getElementById("projectStatus").value || null,
      endYear: document.getElementById("endYear").value || null,

      // Full Case Fields
      leadOrganisations: state.leadOrganisations,
      fundingOrganisations: state.fundingOrganisations,
      involvedOrganisations: state.involvedOrganisations,
      aiForms: getCheckedValues("aiForms"),
      subjectMatter: document.getElementById("subjectMatter").value.trim(),
      projectGoals: getCheckedValues("projectGoals"),
      participants: state.participants,
      inclusionEfforts: document.getElementById("inclusionEfforts").value.trim(),
      limitations: document.getElementById("limitations").value.trim(),
      headlineFindings: document.getElementById("headlineFindings").value.trim(),
      aiAssistance: getCheckedValues("aiAssistance"),
      publishedResources: getCheckedValues("publishedResources"),
      resources: state.resources,
      photosAvailable: getCheckedValues("photosAvailable"),
    };

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Submission could not be completed.");
      }

      statusEl.className = "status-msg success";
      statusEl.innerHTML = `
        <h3>${state.isEditMode ? "Changes Saved!" : "Thank You!"}</h3>
        <p>${escapeHtml(result.message || "Your submission was successfully recorded.")}</p>
        <p><small>Reference Case Record ID: #${escapeHtml(result.caseId)}</small></p>
      `;

      if (!state.isEditMode) {
        form.reset();
        state.leadOrganisations = [];
        state.fundingOrganisations = [];
        state.involvedOrganisations = [];
        state.participants = [];
        state.resources = [];
        renderParticipantsList(document.getElementById("participantsList"));
        renderResourcesList(document.getElementById("resourcesList"));
        document.querySelectorAll(".selected-tags").forEach((el) => (el.innerHTML = ""));
      }

      window.scrollTo({ top: 0, behavior: "smooth" });
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
