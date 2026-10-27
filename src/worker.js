/**
 * Cloudflare Worker for PAVE Casebook Form
 * 
 * Interacts with NocoDB dataset:
 * Base ID: p1t9vvz76dbkcv8
 * Cases Table: m1e33iafsgoy4re
 * Organisations Table: mecsh2ykfxm0s2f
 * Participants Table: mtys2m273atfyd9
 * Resources Table: mm1j25f6w0s1hsn
 */

const NOCODB_DEFAULT_BASE_URL = "https://app.nocodb.com";
const BASE_ID = "p1t9vvz76dbkcv8";

const TABLES = {
  CASES: "m1e33iafsgoy4re",
  ORGANISATIONS: "mecsh2ykfxm0s2f",
  PARTICIPANTS: "mtys2m273atfyd9",
  RESOURCES: "mm1j25f6w0s1hsn",
};

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100 KB limit
const MAX_PARTICIPANTS = 15;
const MAX_RESOURCES = 20;
const MAX_ORGS_PER_FIELD = 20;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders();

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    const nocodbBaseUrl = env.NOCODB_BASE_URL || NOCODB_DEFAULT_BASE_URL;
    const nocodbToken = env.NOCODB_API_TOKEN;

    if (!nocodbToken && url.pathname.startsWith("/api/")) {
      console.error("Configuration error: NOCODB_API_TOKEN is missing.");
      return jsonResponse(
        { error: "Server configuration error. Please contact administrator." },
        500,
        corsHeaders
      );
    }

    try {
      // 1. Search organisations endpoint
      if (url.pathname === "/api/organisations" && request.method === "GET") {
        return await handleSearchOrganisations(url, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 2. Load case for editing endpoint
      if (url.pathname === "/api/case" && request.method === "GET") {
        return await handleGetCaseForEdit(url, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 3. Submit or Edit Case Form endpoint
      if (url.pathname === "/api/submit" && request.method === "POST") {
        return await handleSubmitOrEditCase(request, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 4. Static asset serving when deployed as Cloudflare Worker with [assets]
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return jsonResponse({ error: "Endpoint not found" }, 404, corsHeaders);
    } catch (err) {
      console.error("Worker unhandled error:", err);
      return jsonResponse(
        { error: "An unexpected error occurred. Please try again later." },
        500,
        corsHeaders
      );
    }
  },
};

/**
 * Handle searching organisations in NocoDB table
 */
async function handleSearchOrganisations(url, baseUrl, token, corsHeaders) {
  const rawQuery = url.searchParams.get("q") || "";
  const query = sanitizeSearchQuery(rawQuery);

  if (query.length < 2) {
    return jsonResponse(
      {
        list: [],
        query,
        hasExactMatch: false,
        message: "Please enter at least 2 characters to search.",
      },
      200,
      { ...corsHeaders, "Cache-Control": "public, max-age=60" }
    );
  }

  const encodedQuery = encodeURIComponent(`(Name,like,%${query}%)`);
  const nocoUrl = `${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records?where=${encodedQuery}&limit=25&fields=Id,Name,Website address,Organisation type`;

  const res = await fetch(nocoUrl, {
    headers: { "xc-token": token },
  });

  if (!res.ok) {
    const errorDetails = await res.text();
    console.error("NocoDB query error:", res.status, errorDetails);
    return jsonResponse(
      { error: "Failed to search organisations. Please try again." },
      502,
      corsHeaders
    );
  }

  const data = await res.json();
  const list = (data.list || []).map(formatOrg);

  const hasExactMatch = list.some(
    (org) => org.name.toLowerCase() === query.toLowerCase()
  );

  return jsonResponse(
    {
      list,
      query,
      hasExactMatch,
    },
    200,
    {
      ...corsHeaders,
      "Cache-Control": "public, max-age=60",
    }
  );
}

function formatOrg(raw) {
  return {
    id: raw.Id || raw.id,
    name: sanitizeString(raw.Name || raw["cqkqjxbtc9sjzuk"] || "Untitled Organisation", 200),
    website: sanitizeString(raw["Website address"] || raw["c68nspve2ypnur8"] || "", 255),
    type: raw["Organisation type"] || raw["cwhtaz65osbz1ql"] || [],
  };
}

/**
 * Handle GET /api/case?editKey=...[&id=...]
 * Conditions:
 * 1. editKey is provided and length >= 12
 * 2. Record exists and its stored EditKey matches and is >= 12 characters
 * 3. Workflow: Status is 'Completed'
 */
async function handleGetCaseForEdit(url, baseUrl, token, corsHeaders) {
  const editKey = sanitizeString(url.searchParams.get("editKey") || url.searchParams.get("editkey") || "", 60);
  const rawId = url.searchParams.get("id") || url.searchParams.get("caseId") || "";
  const caseId = rawId ? Number(rawId) : null;

  if (!editKey || editKey.length < 12) {
    return jsonResponse(
      { error: "A valid edit key of at least 12 characters is required." },
      400,
      corsHeaders
    );
  }

  // Construct query: by EditKey and optional ID
  let whereClause = `(EditKey,eq,${editKey})`;
  if (caseId && !isNaN(caseId)) {
    whereClause = `(Id,eq,${caseId})~and(EditKey,eq,${editKey})`;
  }

  const queryUrl = `${baseUrl}/api/v2/tables/${TABLES.CASES}/records?where=${encodeURIComponent(whereClause)}&limit=1`;
  const res = await fetch(queryUrl, {
    headers: { "xc-token": token },
  });

  if (!res.ok) {
    console.error("Failed to query case for edit:", res.status, await res.text());
    return jsonResponse({ error: "Failed to look up case." }, 502, corsHeaders);
  }

  const data = await res.json();
  const cases = data.list || [];

  if (cases.length === 0) {
    return jsonResponse(
      { error: "Case not found or invalid edit key." },
      404,
      corsHeaders
    );
  }

  const rawCase = cases[0];
  const targetId = rawCase.Id || rawCase.id;

  // Retrieve complete record with linked fields
  const detailRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records/${targetId}`, {
    headers: { "xc-token": token },
  });

  if (!detailRes.ok) {
    return jsonResponse({ error: "Failed to load case details." }, 502, corsHeaders);
  }

  const caseRecord = await detailRes.json();
  const status = (caseRecord["Workflow: Status"] || "").trim().toLowerCase();
  const storedKey = (caseRecord["EditKey"] || "").trim();

  // Validate condition: 'Completed' cases should NOT be possible to edit
  if (status === "completed") {
    return jsonResponse(
      {
        error: "This case has been marked as 'Completed' and can no longer be edited.",
        currentStatus: caseRecord["Workflow: Status"],
      },
      403,
      corsHeaders
    );
  }

  // Validate condition: Stored EditKey must be at least 12 characters and match
  if (storedKey.length < 12 || storedKey !== editKey) {
    return jsonResponse(
      { error: "Invalid edit key for this case." },
      403,
      corsHeaders
    );
  }

  // Fetch linked participant details if present
  let participants = [];
  const linkedParts = caseRecord["Participants"] || [];
  const partIds = linkedParts.map((p) => p.Id || p.id).filter(Boolean);

  if (partIds.length > 0) {
    const partsWhere = encodeURIComponent(`(Id,in,${partIds.join(",")})`);
    const partsRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.PARTICIPANTS}/records?where=${partsWhere}&limit=50`,
      { headers: { "xc-token": token } }
    );
    if (partsRes.ok) {
      const partsData = await partsRes.json();
      participants = (partsData.list || []).map((p) => ({
        id: p.Id || p.id,
        groupDescription: p["Group description"] || "",
        participantCount: p["How many people took part?"] || "",
        engagementHours: p["On average, how many hours did each participant engage for?"] || "",
        engagementLocations: ensureArray(p["Where did engagement take place?"]),
        recruitmentMethod: p["Recruitment method"] || "",
        recruitmentDescription: p["Recruitment description"] || "",
        targetPopulation: p["Was there a specific target population?"] || "",
        geographicOrigin: p["Where were participants from?"] || "",
        engagementMethods: ensureArray(p["Which of the following methods were used to engage participants?"]),
        learningFacilitationOptions: ensureArray(p["Do any of the following apply?"]),
        notes: p["Additional notes"] || "",
      }));
    }
  }

  // Fetch linked resources if present
  let resources = [];
  const linkedResources = caseRecord["Supporting resources"] || [];
  const resIds = linkedResources.map((r) => r.Id || r.id).filter(Boolean);

  if (resIds.length > 0) {
    const resWhere = encodeURIComponent(`(Id,in,${resIds.join(",")})`);
    const resourcesRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.RESOURCES}/records?where=${resWhere}&limit=50`,
      { headers: { "xc-token": token } }
    );
    if (resourcesRes.ok) {
      const resData = await resourcesRes.json();
      resources = (resData.list || []).map((r) => ({
        id: r.Id || r.id,
        title: r["Title"] || "",
        url: r["URL"] || "",
        resourceType: r["Select"] || "Other",
        description: r["Short description"] || "",
        license: r["License"] || "",
      }));
    }
  }

  // Fetch linked organisation names from Organisations table
  const allOrgIds = [
    ...(caseRecord["Lead organisations"] || []),
    ...(caseRecord["Funding Organisations"] || []),
    ...(caseRecord["Involved organisations"] || []),
  ]
    .map((o) => (typeof o === "object" ? (o.Id || o.id || (o.id_fields && o.id_fields.Id)) : o))
    .filter(Boolean);

  const orgMap = new Map();
  if (allOrgIds.length > 0) {
    const uniqueOrgIds = [...new Set(allOrgIds)];
    const orgWhere = encodeURIComponent(`(Id,in,${uniqueOrgIds.join(",")})`);
    const orgRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records?where=${orgWhere}&limit=100`,
      { headers: { "xc-token": token } }
    );
    if (orgRes.ok) {
      const orgData = await orgRes.json();
      (orgData.list || []).forEach((org) => {
        const id = org.Id || org.id;
        const name = org.Name || org["cqkqjxbtc9sjzuk"] || `Organisation #${id}`;
        orgMap.set(Number(id), name);
      });
    }
  }

  // Format organisation lists
  const formatOrgLink = (arr) =>
    (arr || []).map((o) => {
      const id = Number(typeof o === "object" ? (o.Id || o.id || (o.id_fields && o.id_fields.Id)) : o);
      const name = orgMap.get(id) || (o && typeof o === "object" && (o.Name || o.fields?.Name)) || `Organisation #${id}`;
      return { id, name };
    });

  return jsonResponse(
    {
      case: {
        id: targetId,
        editKey: storedKey,
        workflowStatus: caseRecord["Workflow: Status"],
        projectTitle: caseRecord["Project Title"] || "",
        projectUrl: caseRecord["Project URL"] || "",
        projectDescription: caseRecord["Provide a brief description of the project"] || "",
        importanceReason: caseRecord["Why is this project important to include in the case book?"] || "",
        initiatedMethods: ensureArray(caseRecord["How was the project initiated?"]),
        startYear: caseRecord["What year did the project start?"] || "",
        projectStatus: caseRecord["Project status"] || "",
        endYear: caseRecord["What year did the project conclude?"] || "",
        submitterName: caseRecord["Submitted by"] || "",
        submitterEmail: caseRecord["Contact e-mail"] || "",
        submitterRoles: ensureArray(caseRecord["Submitter role"]),
        additionalAcknowledgements: caseRecord["Additional acknowledgements"] || "",
        aiForms: ensureArray(caseRecord["What form of AI is the project about?"]),
        subjectMatter: caseRecord["Describe the subject matter in your own words (one line)"] || "",
        projectGoals: ensureArray(caseRecord["Project goals"]),
        inclusionEfforts: caseRecord["Inclusion efforts"] || "",
        limitations: caseRecord["What limitations to the project should be noted?"] || "",
        headlineFindings: caseRecord["Headline findings"] || "",
        aiAssistance: ensureArray(caseRecord["Was AI used to assist in summary generation?"]),
        publishedResources: ensureArray(caseRecord["Which of the following resources are available for this project?"]),
        photosAvailable: ensureArray(caseRecord["Photos available?"]),
        leadOrganisations: formatOrgLink(caseRecord["Lead organisations"]),
        fundingOrganisations: formatOrgLink(caseRecord["Funding Organisations"]),
        involvedOrganisations: formatOrgLink(caseRecord["Involved organisations"]),
        participants,
        resources,
      },
    },
    200,
    corsHeaders
  );
}

/**
 * Handle Case submission (Create new OR Update existing)
 */
async function handleSubmitOrEditCase(request, baseUrl, token, corsHeaders) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return jsonResponse(
      { error: "Request payload too large. Maximum allowed size is 100 KB." },
      413,
      corsHeaders
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload." }, 400, corsHeaders);
  }

  if (!payload || typeof payload !== "object") {
    return jsonResponse({ error: "Invalid request format." }, 400, corsHeaders);
  }

  const isEditMode = Boolean(payload.caseId && payload.editKey);
  let existingCaseId = null;

  // If in edit mode, strictly verify authorization conditions
  if (isEditMode) {
    const editKey = sanitizeString(payload.editKey, 60);
    const caseId = Number(payload.caseId);

    if (!editKey || editKey.length < 12 || isNaN(caseId)) {
      return jsonResponse(
        { error: "Invalid edit credentials provided." },
        400,
        corsHeaders
      );
    }

    const checkRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records/${caseId}`, {
      headers: { "xc-token": token },
    });

    if (!checkRes.ok) {
      return jsonResponse({ error: "Existing case record not found." }, 404, corsHeaders);
    }

    const existingRec = await checkRes.json();
    const status = (existingRec["Workflow: Status"] || "").trim().toLowerCase();
    const storedKey = (existingRec["EditKey"] || "").trim();

    if (status === "completed") {
      return jsonResponse(
        { error: "This case has been marked as 'Completed' and can no longer be edited." },
        403,
        corsHeaders
      );
    }

    if (storedKey.length < 12 || storedKey !== editKey) {
      return jsonResponse(
        { error: "Invalid edit key for this case." },
        403,
        corsHeaders
      );
    }

    existingCaseId = caseId;
  }

  // Validate required Project Title
  const projectTitle = sanitizeString(payload.projectTitle, 250);
  if (!projectTitle) {
    return jsonResponse({ error: "Project Title is required." }, 400, corsHeaders);
  }

  // Validate Submitter Email
  const submitterEmail = sanitizeString(payload.submitterEmail, 150);
  if (!submitterEmail || !isValidEmail(submitterEmail)) {
    return jsonResponse(
      { error: "A valid contact email address is required." },
      400,
      corsHeaders
    );
  }

  // Strict URL validation on Project URL
  const projectUrl = sanitizeString(payload.projectUrl, 500);
  if (projectUrl && !isValidHttpUrl(projectUrl)) {
    return jsonResponse(
      { error: "Project URL must be a valid http:// or https:// address." },
      400,
      corsHeaders
    );
  }

  // Resolve organisations (Lead, Funding, Involved)
  const leadOrgIds = await resolveOrganisations(
    clampArray(payload.leadOrganisations, MAX_ORGS_PER_FIELD),
    baseUrl,
    token
  );
  const fundingOrgIds = await resolveOrganisations(
    clampArray(payload.fundingOrganisations, MAX_ORGS_PER_FIELD),
    baseUrl,
    token
  );
  const involvedOrgIds = await resolveOrganisations(
    clampArray(payload.involvedOrganisations, MAX_ORGS_PER_FIELD),
    baseUrl,
    token
  );

  // Prepare Case data
  const isNomination = payload.submissionIntent === "nomination";
  const caseData = {
    "Project Title": projectTitle,
    "Project URL": projectUrl || null,
    "Provide a brief description of the project": sanitizeString(payload.projectDescription, 10000) || null,
    "Why is this project important to include in the case book?": sanitizeString(payload.importanceReason, 5000) || null,
    "How was the project initiated?": sanitizeStringArray(payload.initiatedMethods, 5),
    "What year did the project start?": clampNumber(payload.startYear, 1950, 2050),
    "Project status": sanitizeAllowedOption(payload.projectStatus, ["Planned", "In Progress", "Complete"]),
    "What year did the project conclude?": clampNumber(payload.endYear, 1950, 2050),
    "Submitted by": sanitizeString(payload.submitterName, 150) || null,
    "Contact e-mail": submitterEmail,
    "Submitter role": sanitizeStringArray(payload.submitterRoles, 10),
    "Additional acknowledgements": sanitizeString(payload.additionalAcknowledgements, 500) || null,
    "What form of AI is the project about?": sanitizeStringArray(payload.aiForms, 10),
    "Describe the subject matter in your own words (one line)": sanitizeString(payload.subjectMatter, 300) || null,
    "Project goals": sanitizeStringArray(payload.projectGoals, 15),
    "Inclusion efforts": sanitizeString(payload.inclusionEfforts, 5000) || null,
    "What limitations to the project should be noted?": sanitizeString(payload.limitations, 5000) || null,
    "Headline findings": sanitizeString(payload.headlineFindings, 10000) || null,
    "Was AI used to assist in summary generation?": sanitizeStringArray(payload.aiAssistance, 5),
    "Which of the following resources are available for this project?": sanitizeStringArray(payload.publishedResources, 10),
    "Photos available?": sanitizeStringArray(payload.photosAvailable, 5),
  };

  // Only assign workflow status on initial creation (preserve 'Completed' on edits)
  if (!isEditMode) {
    caseData["Workflow: Status"] = isNomination ? "Nomination" : "Submission";
    caseData["EditKey"] = generateSecureKey(16);
  }

  // Assign organisation links directly in case payload using bare primary keys [1, 2]
  caseData["Lead organisations"] = leadOrgIds;
  caseData["Funding Organisations"] = fundingOrgIds;
  caseData["Involved organisations"] = involvedOrgIds;

  let finalCaseId;

  if (isEditMode) {
    // UPDATE existing record
    const updateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records`, {
      method: "PATCH",
      headers: {
        "xc-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ Id: existingCaseId, ...caseData }]),
    });

    if (!updateRes.ok) {
      console.error("NocoDB Case update error:", updateRes.status, await updateRes.text());
      return jsonResponse({ error: "Failed to update case record in database." }, 502, corsHeaders);
    }
    finalCaseId = existingCaseId;
  } else {
    // CREATE new record
    const caseCreateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records`, {
      method: "POST",
      headers: {
        "xc-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([caseData]),
    });

    if (!caseCreateRes.ok) {
      console.error("NocoDB Case creation error:", caseCreateRes.status, await caseCreateRes.text());
      return jsonResponse(
        { error: "Unable to save case submission in database. Please check your entries." },
        502,
        corsHeaders
      );
    }

    const createdRecords = await caseCreateRes.json();
    const createdCase = Array.isArray(createdRecords) ? createdRecords[0] : createdRecords;
    finalCaseId = createdCase.Id || createdCase.id;
  }

  // Sync Participant records
  const rawParticipants = clampArray(payload.participants, MAX_PARTICIPANTS);
  const participantIds = [];

  for (const p of rawParticipants) {
    const pFields = {
      "Group description": sanitizeString(p.groupDescription, 250) || "Participant Group",
      "How many people took part?": clampNumber(p.participantCount, 0, 10000000),
      "On average, how many hours did each participant engage for?": clampNumber(p.engagementHours, 0, 10000),
      "Where did engagement take place?": sanitizeStringArray(p.engagementLocations, 5),
      "Recruitment method": sanitizeString(p.recruitmentMethod, 100) || null,
      "Recruitment description": sanitizeString(p.recruitmentDescription, 1000) || null,
      "Was there a specific target population?": sanitizeString(p.targetPopulation, 500) || null,
      "Where were participants from?": sanitizeString(p.geographicOrigin, 500) || null,
      "Which of the following methods were used to engage participants?": sanitizeStringArray(p.engagementMethods, 20),
      "Do any of the following apply?": sanitizeStringArray(p.learningFacilitationOptions, 5),
      "Additional notes": sanitizeString(p.notes, 3000) || null,
    };

    if (p.id) {
      // Update existing participant
      await fetch(`${baseUrl}/api/v2/tables/${TABLES.PARTICIPANTS}/records`, {
        method: "PATCH",
        headers: { "xc-token": token, "Content-Type": "application/json" },
        body: JSON.stringify([{ Id: p.id, ...pFields }]),
      });
      participantIds.push(p.id);
    } else {
      // Create new participant linked to this case
      pFields["Cases"] = [{ Id: finalCaseId }];
      const partCreateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.PARTICIPANTS}/records`, {
        method: "POST",
        headers: { "xc-token": token, "Content-Type": "application/json" },
        body: JSON.stringify([pFields]),
      });
      if (partCreateRes.ok) {
        const createdParts = await partCreateRes.json();
        const rec = Array.isArray(createdParts) ? createdParts[0] : createdParts;
        participantIds.push(rec.Id || rec.id);
      }
    }
  }

  // Sync Supporting Resources
  const rawResources = clampArray(payload.resources, MAX_RESOURCES);
  const resourceIds = [];

  for (const r of rawResources) {
    const title = sanitizeString(r.title, 250);
    const resUrl = sanitizeString(r.url, 500);

    if (title && resUrl && isValidHttpUrl(resUrl)) {
      const rFields = {
        "Title": title,
        "URL": resUrl,
        "Select": sanitizeString(r.resourceType, 100) || "Other",
        "Short description": sanitizeString(r.description, 1000) || null,
        "License": sanitizeString(r.license, 100) || null,
      };

      if (r.id) {
        // Update existing resource
        await fetch(`${baseUrl}/api/v2/tables/${TABLES.RESOURCES}/records`, {
          method: "PATCH",
          headers: { "xc-token": token, "Content-Type": "application/json" },
          body: JSON.stringify([{ Id: r.id, ...rFields }]),
        });
        resourceIds.push(r.id);
      } else {
        // Create new resource linked to this case
        rFields["Cases"] = [{ Id: finalCaseId }];
        const resCreate = await fetch(`${baseUrl}/api/v2/tables/${TABLES.RESOURCES}/records`, {
          method: "POST",
          headers: { "xc-token": token, "Content-Type": "application/json" },
          body: JSON.stringify([rFields]),
        });
        if (resCreate.ok) {
          const createdR = await resCreate.json();
          const rec = Array.isArray(createdR) ? createdR[0] : createdR;
          resourceIds.push(rec.Id || rec.id);
        }
      }
    }
  }

  // Link all relation fields directly on the Case record in NocoDB v2 using bare primary keys
  const caseLinksUpdate = {
    Id: finalCaseId,
    "Lead organisations": leadOrgIds,
    "Funding Organisations": fundingOrgIds,
    "Involved organisations": involvedOrgIds,
    "Participants": participantIds,
    "Supporting resources": resourceIds,
  };

  const patchLinksRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records`, {
    method: "PATCH",
    headers: {
      "xc-token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([caseLinksUpdate]),
  });
  if (!patchLinksRes.ok) {
    console.warn("Failed to patch Case child links:", patchLinksRes.status, await patchLinksRes.text());
  }

  return jsonResponse(
    {
      success: true,
      caseId: finalCaseId,
      mode: isEditMode ? "edit" : "create",
      message: isEditMode
        ? "Case record updated successfully."
        : isNomination
        ? "Project nomination recorded successfully."
        : "Full case study entry submitted successfully.",
    },
    200,
    corsHeaders
  );
}

/**
 * Resolves an array of organisation items
 */
async function resolveOrganisations(orgsList, baseUrl, token) {
  if (!Array.isArray(orgsList) || orgsList.length === 0) return [];

  const finalIds = [];

  for (const item of orgsList) {
    if (!item) continue;

    if (typeof item === "number" || (typeof item === "string" && !isNaN(Number(item)))) {
      finalIds.push(Number(item));
      continue;
    }

    if (item.id && !isNaN(Number(item.id))) {
      finalIds.push(Number(item.id));
      continue;
    }

    const name = sanitizeString(item.name, 200);
    if (!name || name.length < 2) continue;

    const safeNameQuery = sanitizeSearchQuery(name);
    const encodedWhere = encodeURIComponent(`(Name,eq,${safeNameQuery})`);

    const checkRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records?where=${encodedWhere}&limit=1`,
      { headers: { "xc-token": token } }
    );

    if (checkRes.ok) {
      const checkData = await checkRes.json();
      if (checkData.list && checkData.list.length > 0) {
        finalIds.push(checkData.list[0].Id || checkData.list[0].id);
        continue;
      }
    }

    let website = sanitizeString(item.website, 255);
    if (website && !isValidHttpUrl(website)) {
      website = null;
    }

    const createRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records`, {
      method: "POST",
      headers: {
        "xc-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          "Name": name,
          "Website address": website,
          "Organisation type": sanitizeStringArray(item.type, 5),
        },
      ]),
    });

    if (createRes.ok) {
      const created = await createRes.json();
      const rec = Array.isArray(created) ? created[0] : created;
      finalIds.push(rec.Id || rec.id);
    }
  }

  return [...new Set(finalIds)];
}

/* -------------------------------------------------------------
 * Security & Helper Utilities
 * ------------------------------------------------------------- */

function generateSecureKey(len = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomValues = new Uint8Array(len);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < len; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

function sanitizeSearchQuery(query) {
  if (!query || typeof query !== "string") return "";
  return query
    .replace(/[()~,"'\\;<>`\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, 60);
}

function sanitizeString(val, maxLen = 1000) {
  if (!val || typeof val !== "string") return "";
  return val.trim().slice(0, maxLen);
}

function sanitizeStringArray(arr, maxItems = 10) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, maxItems)
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => sanitizeString(item, 150));
}

function sanitizeAllowedOption(val, allowedList) {
  if (typeof val === "string" && allowedList.includes(val)) {
    return val;
  }
  return null;
}

function clampArray(arr, maxItems) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, maxItems);
}

function clampNumber(val, min, max) {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  if (isNaN(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n);
}

function isValidHttpUrl(str) {
  if (!str || typeof str !== "string") return false;
  try {
    const parsed = new URL(str);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidEmail(email) {
  if (!email || typeof email !== "string" || email.length > 150) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function ensureArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map((item) => (typeof item === "object" && item !== null ? item.title || item.Name || String(item) : String(item).trim())).filter(Boolean);
  }
  if (typeof val === "string") {
    val = val.trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      try {
        const parsed = JSON.parse(val);
        return ensureArray(parsed);
      } catch (e) {}
    }
    return val.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [String(val)];
}

