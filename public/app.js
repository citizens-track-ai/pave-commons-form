/**
 * PAVE Form Application Logic
 * Supports new submission and editing of existing 'Completed' cases with valid EditKey
 */

const state = {
  isEditMode: false,
  caseId: null,
  editKey: null,
  submissionIntent: "nomination",
  leadOrganisations: [],      // Array of { id, name } OR { name, isNew: true, website?: string }
  fundingOrganisations: [],
  involvedOrganisations: [],
  participants: [],          // Array of participant group objects
  resources: [],             // Array of resource objects
};

document.addEventListener("DOMContentLoaded", () => {
  initIntentToggle();
  initOrgPickers();
  initParticipantManager();
  initResourceManager();
  initFormSubmission();
  checkEditMode();
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
    document.getElementById("fullCaseSection").classList.remove("hidden");

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
  const fullSection = document.getElementById("fullCaseSection");

  radios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      state.submissionIntent = e.target.value;
      if (e.target.value === "full") {
        fullSection.classList.remove("hidden");
      } else {
        fullSection.classList.add("hidden");
      }
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
    });
    tagsEl.appendChild(tag);
  });
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

    if (!document.getElementById("consentCheck").checked) {
      alert("Please check the consent box before submitting.");
      return;
    }

    const projectUrl = document.getElementById("projectUrl").value.trim();
    if (projectUrl && !isValidClientUrl(projectUrl)) {
      alert("Project URL must be a valid http:// or https:// address.");
      document.getElementById("projectUrl").focus();
      return;
    }

    const email = document.getElementById("submitterEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert("Please enter a valid email address.");
      document.getElementById("submitterEmail").focus();
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
