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
  MESSAGES: "mujfx489gv4v1co",
};

const LINK_FIELDS = {
  CASE_LEAD_ORGS: "cfsr6shftjp5rh8",
  CASE_FUNDING_ORGS: "ctry6dyg5238w16",
  CASE_INVOLVED_ORGS: "crlcp2kthfjwijy",
  CASE_PARTICIPANTS: "clfmrd6qe6r4l6w",
  CASE_RESOURCES: "c3ph7cav2ieep3q",
  CASE_MESSAGES: "cgcjd052mayfjgo",
};

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100 KB limit
const MAX_PARTICIPANTS = 15;
const MAX_RESOURCES = 20;
const MAX_ORGS_PER_FIELD = 20;
const MAX_MESSAGES = 100;

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

      // 2. Staff authentication check endpoint
      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        return await handleAuthMe(request, nocodbBaseUrl, corsHeaders);
      }

      // 3. Load case for editing endpoint
      if (url.pathname === "/api/case" && request.method === "GET") {
        return await handleGetCaseForEdit(request, url, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 4. Case Comments & Revision History endpoint (Staff only)
      if (url.pathname === "/api/case/comments" && (request.method === "GET" || request.method === "POST")) {
        return await handleCaseComments(request, url, nocodbBaseUrl, corsHeaders);
      }

      // 5. Submit or Edit Case Form endpoint
      if (url.pathname === "/api/submit" && request.method === "POST") {
        return await handleSubmitOrEditCase(request, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 6. Static asset serving when deployed as Cloudflare Worker with [assets]
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
 * Verify a user-supplied NocoDB Personal API Token against NocoDB's user/base role API.
 * Checks `X-Noco-Token` or `Authorization: Bearer <token>`.
 */
async function verifyStaffUser(request, baseUrl) {
  let userToken = request.headers.get("X-Noco-Token") || "";
  if (!userToken) {
    const authHeader = request.headers.get("Authorization") || "";
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      userToken = authHeader.slice(7).trim();
    }
  }
  userToken = sanitizeString(userToken, 250);
  if (!userToken || userToken.length < 10) {
    return { isAuthenticated: false, user: null, userToken: null };
  }

  try {
    const meRes = await fetch(`${baseUrl}/api/v1/db/auth/user/me?base_id=${BASE_ID}`, {
      headers: { "xc-token": userToken },
    });

    if (!meRes.ok) {
      return { isAuthenticated: false, user: null, userToken: null };
    }

    const meData = await meRes.json();
    if (!meData || !meData.id || !meData.email) {
      return { isAuthenticated: false, user: null, userToken: null };
    }

    const baseRoles = meData.base_roles || {};
    const workspaceRoles = meData.workspace_roles || {};
    const allowedRoles = ["owner", "creator", "editor", "commenter"];

    let activeRole = allowedRoles.find((r) => baseRoles[r] === true) || null;
    if (!activeRole) {
      if (workspaceRoles["workspace-level-owner"] || workspaceRoles["workspace-level-creator"] || workspaceRoles["workspace-level-editor"]) {
        activeRole = "editor";
      }
    }

    if (!activeRole || baseRoles["no-access"]) {
      return { isAuthenticated: false, user: null, userToken: null, reason: "User does not have editor/commenter access to this base." };
    }

    const canEdit = ["owner", "creator", "editor"].includes(activeRole);
    return {
      isAuthenticated: true,
      canEdit,
      user: {
        id: meData.id,
        email: meData.email,
        displayName: meData.display_name || meData.email,
        role: activeRole,
      },
      userToken,
    };
  } catch (err) {
    console.error("Failed to verify NocoDB user token:", err);
    return { isAuthenticated: false, user: null, userToken: null };
  }
}

/**
 * Handle GET /api/auth/me
 * Validates the user's NocoDB personal API token and returns user profile & role.
 */
async function handleAuthMe(request, baseUrl, corsHeaders) {
  const staff = await verifyStaffUser(request, baseUrl);
  if (!staff.isAuthenticated) {
    return jsonResponse(
      {
        authenticated: false,
        error: staff.reason || "Invalid NocoDB API token or insufficient permissions on this base.",
      },
      401,
      corsHeaders
    );
  }

  return jsonResponse(
    {
      authenticated: true,
      canEdit: staff.canEdit,
      user: staff.user,
    },
    200,
    corsHeaders
  );
}

/**
 * Fetch comments and revision history for a case record from NocoDB's meta/comments API
 */
async function fetchCaseCommentsAndAudits(caseId, baseUrl, tokenToUse, fallbackToken) {
  const fetchWithToken = async (tok, commentsOnly) => {
    const url = `${baseUrl}/api/v2/meta/comments?fk_model_id=${TABLES.CASES}&row_id=${encodeURIComponent(caseId)}${commentsOnly ? "&comments_only=true" : ""}`;
    return await fetch(url, { headers: { "xc-token": tok } });
  };

  let allItems = [];
  let permissionWarning = null;

  // Try fetching full activity stream (comments + revision audits) with staff token first, then fallback token
  let res = await fetchWithToken(tokenToUse, false);
  if (!res.ok && fallbackToken && fallbackToken !== tokenToUse) {
    res = await fetchWithToken(fallbackToken, false);
  }

  if (res.ok) {
    const data = await res.json();
    allItems = data.list || (Array.isArray(data) ? data : []);
  } else {
    try {
      const errBody = await res.json();
      if (errBody?.message) {
        permissionWarning = errBody.message;
      }
    } catch (_) {}
  }

  const comments = [];
  const revisions = [];

  for (const item of allItems) {
    const opType = item.op_type || "";
    const isComment = opType === "COMMENT" || (!opType && item.comment) || Boolean(item.comment && opType !== "DATA_UPDATE");

    if (isComment && item.comment) {
      comments.push({
        id: item.id,
        comment: item.comment,
        user: item.user || item.created_by_email || "NocoDB User",
        userId: item.fk_user_id || null,
        resolved: Boolean(item.resolved),
        createdAt: item.created_at || item.CreatedAt || null,
        updatedAt: item.updated_at || item.UpdatedAt || null,
      });
    } else {
      // Parse audit / revision entry
      let parsedDetails = null;
      let summary = item.description || "";
      let fieldTitle = null;
      let oldValue = null;
      let newValue = null;

      if (item.details) {
        try {
          parsedDetails = typeof item.details === "string" ? JSON.parse(item.details) : item.details;
          if (parsedDetails && typeof parsedDetails === "object") {
            const colMeta = parsedDetails.column_meta || {};
            const dataObj = parsedDetails.data || {};
            const oldObj = parsedDetails.old_data || {};
            const changedKeys = Object.keys(dataObj);
            if (changedKeys.length > 0) {
              const key = changedKeys[0];
              // Redact raw EditKey values in audit display for safety
              if (key === "EditKey") {
                fieldTitle = "EditKey";
                oldValue = oldObj[key] ? "••••••••" : null;
                newValue = dataObj[key] ? "•••••••• (Updated)" : null;
              } else {
                fieldTitle = colMeta[key]?.title || key;
                oldValue = oldObj[key] !== undefined ? oldObj[key] : null;
                newValue = dataObj[key] !== undefined ? dataObj[key] : null;
              }
            }
          }
        } catch (_) {}
      }

      revisions.push({
        id: item.id,
        opType: opType || "UPDATE",
        opSubType: item.op_sub_type || null,
        user: item.user || "System",
        field: fieldTitle,
        oldValue,
        newValue,
        description: summary || null,
        createdAt: item.created_at || item.CreatedAt || null,
      });
    }
  }

  return { comments, revisions, permissionWarning };
}

/**
 * Handle GET & POST /api/case/comments
 * Allows authenticated NocoDB staff users to read or post comments & view revision history.
 */
async function handleCaseComments(request, url, baseUrl, corsHeaders) {
  const staff = await verifyStaffUser(request, baseUrl);
  if (!staff.isAuthenticated) {
    return jsonResponse(
      { error: "Staff authentication required to view or post comments." },
      401,
      corsHeaders
    );
  }

  if (request.method === "GET") {
    const rawId = url.searchParams.get("id") || url.searchParams.get("caseId") || "";
    const caseId = Number(rawId);
    if (!caseId || isNaN(caseId)) {
      return jsonResponse({ error: "Valid caseId is required." }, 400, corsHeaders);
    }

    const { comments, revisions, permissionWarning } = await fetchCaseCommentsAndAudits(
      caseId,
      baseUrl,
      staff.userToken,
      null
    );

    return jsonResponse(
      {
        caseId,
        comments,
        revisions,
        permissionWarning,
      },
      200,
      corsHeaders
    );
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400, corsHeaders);
    }

    const caseId = Number(body.caseId || body.id);
    const commentText = sanitizeString(body.comment, 5000);

    if (!caseId || isNaN(caseId)) {
      return jsonResponse({ error: "Valid caseId is required." }, 400, corsHeaders);
    }
    if (!commentText) {
      return jsonResponse({ error: "Comment text cannot be empty." }, 400, corsHeaders);
    }

    const postRes = await fetch(`${baseUrl}/api/v2/meta/comments`, {
      method: "POST",
      headers: {
        "xc-token": staff.userToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fk_model_id: TABLES.CASES,
        row_id: String(caseId),
        comment: commentText,
      }),
    });

    if (!postRes.ok) {
      let errMsg = "Failed to post comment to NocoDB.";
      try {
        const errJson = await postRes.json();
        if (errJson?.message) errMsg = errJson.message;
      } catch (_) {}
      return jsonResponse({ error: errMsg }, postRes.status === 403 ? 403 : 502, corsHeaders);
    }

    const { comments, revisions, permissionWarning } = await fetchCaseCommentsAndAudits(
      caseId,
      baseUrl,
      staff.userToken,
      null
    );

    return jsonResponse(
      {
        success: true,
        comments,
        revisions,
        permissionWarning,
      },
      200,
      corsHeaders
    );
  }

  return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
}

/**
 * Handle GET /api/case?editKey=...[&id=...]
 * Conditions:
 * 1. Public users: editKey is provided (>= 12 chars), matches stored EditKey, and Workflow: Status is not 'Completed'
 * 2. Authenticated NocoDB staff users: can load by id or editKey, can edit 'Completed' cases, and receive comments + revision history
 */
async function handleGetCaseForEdit(request, url, baseUrl, token, corsHeaders) {
  const staff = await verifyStaffUser(request, baseUrl);
  const isStaff = staff.isAuthenticated && staff.canEdit;

  const editKey = sanitizeString(url.searchParams.get("editKey") || url.searchParams.get("editkey") || "", 60);
  const rawId = url.searchParams.get("id") || url.searchParams.get("caseId") || "";
  const caseId = rawId ? Number(rawId) : null;

  if (!isStaff && (!editKey || editKey.length < 12)) {
    return jsonResponse(
      { error: "A valid edit key of at least 12 characters is required." },
      400,
      corsHeaders
    );
  }

  if (isStaff && (!editKey || editKey.length < 12) && (!caseId || isNaN(caseId))) {
    return jsonResponse(
      { error: "Please provide a valid Case ID (?id=...) or EditKey to load a case." },
      400,
      corsHeaders
    );
  }

  // Construct query: by EditKey and/or ID
  let whereClause = "";
  if (isStaff && caseId && !isNaN(caseId) && (!editKey || editKey.length < 12)) {
    whereClause = `(Id,eq,${caseId})`;
  } else if (caseId && !isNaN(caseId)) {
    whereClause = `(Id,eq,${caseId})~and(EditKey,eq,${editKey})`;
  } else {
    whereClause = `(EditKey,eq,${editKey})`;
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

  // Validate condition: 'Completed' cases can only be edited by authenticated NocoDB staff
  if (status === "completed" && !isStaff) {
    return jsonResponse(
      {
        error: "This case has been marked as 'Completed' and can no longer be edited. (NocoDB editors can sign in using 'Staff Sign In' to edit completed cases.)",
        currentStatus: caseRecord["Workflow: Status"],
      },
      403,
      corsHeaders
    );
  }

  // Validate condition: Stored EditKey must be at least 12 characters and match (unless authenticated staff)
  if (!isStaff && (storedKey.length < 12 || storedKey !== editKey)) {
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

  // Fetch linked messages if present
  let messages = [];
  const linkedMessages = caseRecord["Messages"] || [];
  const msgIds = extractIds(linkedMessages);

  if (msgIds.length > 0) {
    const msgWhere = encodeURIComponent(`(Id,in,${msgIds.join(",")})`);
    const messagesRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.MESSAGES}/records?where=${msgWhere}&limit=100`,
      { headers: { "xc-token": token } }
    );
    if (messagesRes.ok) {
      const msgData = await messagesRes.json();
      const rawMsgList = msgData.list || [];
      const typeCounters = {};
      messages = rawMsgList.map((m) => {
        const type = m["Type"] || "Recommendation";
        typeCounters[type] = (typeCounters[type] || 0) + 1;
        return {
          id: m.Id || m.id,
          title: m["Title"] || `${type} ${typeCounters[type]}`,
          text: m["Name"] || "",
          type,
        };
      });
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

  // If authenticated NocoDB staff user, also fetch comments and revision history
  let comments = [];
  let revisions = [];
  let activityWarning = null;
  if (staff.isAuthenticated) {
    const activity = await fetchCaseCommentsAndAudits(targetId, baseUrl, staff.userToken, token);
    comments = activity.comments;
    revisions = activity.revisions;
    activityWarning = activity.permissionWarning;
  }

  return jsonResponse(
    {
      staff: staff.isAuthenticated
        ? {
            authenticated: true,
            canEdit: staff.canEdit,
            user: staff.user,
          }
        : { authenticated: false },
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
        messages,
        comments: staff.isAuthenticated ? comments : undefined,
        revisions: staff.isAuthenticated ? revisions : undefined,
        activityWarning: staff.isAuthenticated ? activityWarning : undefined,
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

  const staff = await verifyStaffUser(request, baseUrl);
  const isStaffEditor = staff.isAuthenticated && staff.canEdit;
  // Use staff member's personal token for NocoDB mutations so NocoDB audit history attributes changes to them
  const activeWriteToken = isStaffEditor && staff.userToken ? staff.userToken : token;

  const isEditMode = Boolean(payload.caseId && (payload.editKey || isStaffEditor));
  let existingCaseId = null;
  let existingRec = null;

  // If in edit mode, strictly verify authorization conditions
  if (isEditMode) {
    const editKey = sanitizeString(payload.editKey, 60);
    const caseId = Number(payload.caseId);

    if (isNaN(caseId) || (!isStaffEditor && (!editKey || editKey.length < 12))) {
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

    existingRec = await checkRes.json();
    const status = (existingRec["Workflow: Status"] || "").trim().toLowerCase();
    const storedKey = (existingRec["EditKey"] || "").trim();

    if (status === "completed" && !isStaffEditor) {
      return jsonResponse(
        { error: "This case has been marked as 'Completed' and can no longer be edited." },
        403,
        corsHeaders
      );
    }

    if (!isStaffEditor && (storedKey.length < 12 || storedKey !== editKey)) {
      return jsonResponse(
        { error: "Invalid edit key for this case." },
        403,
        corsHeaders
      );
    }

    existingCaseId = caseId;
  }

  // Extract current relationship link IDs if editing
  const currentLeadOrgIds = extractIds(existingRec?.["Lead organisations"]);
  const currentFundingOrgIds = extractIds(existingRec?.["Funding Organisations"]);
  const currentInvolvedOrgIds = extractIds(existingRec?.["Involved organisations"]);
  const currentPartIds = extractIds(existingRec?.["Participants"]);
  const currentResIds = extractIds(existingRec?.["Supporting resources"]);
  const currentMsgIds = extractIds(existingRec?.["Messages"]);

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
    activeWriteToken
  );
  const fundingOrgIds = await resolveOrganisations(
    clampArray(payload.fundingOrganisations, MAX_ORGS_PER_FIELD),
    baseUrl,
    activeWriteToken
  );
  const involvedOrgIds = await resolveOrganisations(
    clampArray(payload.involvedOrganisations, MAX_ORGS_PER_FIELD),
    baseUrl,
    activeWriteToken
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

  // Only assign workflow status and editKey on initial creation (or allow authenticated staff to update workflow status)
  let generatedEditKey = null;
  if (!isEditMode) {
    caseData["Workflow: Status"] = isNomination ? "Nomination" : "Submission";
    generatedEditKey = generateSecureKey(16);
    caseData["EditKey"] = generatedEditKey;
  } else if (isStaffEditor && payload.workflowStatus) {
    const allowedWorkflow = sanitizeAllowedOption(payload.workflowStatus, [
      "Nomination",
      "Submission",
      "Under Review",
      "Completed",
      "Rejected",
    ]);
    if (allowedWorkflow) {
      caseData["Workflow: Status"] = allowedWorkflow;
    }
  }

  let finalCaseId;

  if (isEditMode) {
    // UPDATE existing record
    const updateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records`, {
      method: "PATCH",
      headers: {
        "xc-token": activeWriteToken,
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
        "xc-token": activeWriteToken,
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
        headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
        body: JSON.stringify([{ Id: p.id, ...pFields }]),
      });
      participantIds.push(Number(p.id));
    } else {
      // Create new participant record
      const partCreateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.PARTICIPANTS}/records`, {
        method: "POST",
        headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
        body: JSON.stringify([pFields]),
      });
      if (partCreateRes.ok) {
        const createdParts = await partCreateRes.json();
        const rec = Array.isArray(createdParts) ? createdParts[0] : createdParts;
        const newId = rec.Id || rec.id;
        if (newId) participantIds.push(Number(newId));
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
          headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
          body: JSON.stringify([{ Id: r.id, ...rFields }]),
        });
        resourceIds.push(Number(r.id));
      } else {
        // Create new resource
        const resCreate = await fetch(`${baseUrl}/api/v2/tables/${TABLES.RESOURCES}/records`, {
          method: "POST",
          headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
          body: JSON.stringify([rFields]),
        });
        if (resCreate.ok) {
          const createdR = await resCreate.json();
          const rec = Array.isArray(createdR) ? createdR[0] : createdR;
          const newId = rec.Id || rec.id;
          if (newId) resourceIds.push(Number(newId));
        }
      }
    }
  }


  // Sync Messages
  const rawMessages = clampArray(payload.messages, MAX_MESSAGES);
  const messageIds = [];
  const msgTypeCounters = {};

  for (const m of rawMessages) {
    const text = sanitizeString(m.text || m.name, 10000);
    const type = sanitizeAllowedOption(m.type, ["Action", "Issue", "Recommendation", "Quote"]) || "Recommendation";

    if (text) {
      msgTypeCounters[type] = (msgTypeCounters[type] || 0) + 1;
      const defaultTitle = `${type} ${msgTypeCounters[type]}`;
      const title = sanitizeString(m.title, 250) || defaultTitle;

      const mFields = {
        "Title": title,
        "Name": text,
        "Type": type,
      };

      if (m.id) {
        // Update existing message
        await fetch(`${baseUrl}/api/v2/tables/${TABLES.MESSAGES}/records`, {
          method: "PATCH",
          headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
          body: JSON.stringify([{ Id: m.id, ...mFields }]),
        });
        messageIds.push(Number(m.id));
      } else {
        // Create new message
        const msgCreateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.MESSAGES}/records`, {
          method: "POST",
          headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
          body: JSON.stringify([mFields]),
        });
        if (msgCreateRes.ok) {
          const createdMsg = await msgCreateRes.json();
          const rec = Array.isArray(createdMsg) ? createdMsg[0] : createdMsg;
          const newId = rec.Id || rec.id;
          if (newId) messageIds.push(Number(newId));
        }
      }
    }
  }

  // Sync all relationship links using NocoDB's dedicated link endpoints
  await Promise.all([
    syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_LEAD_ORGS, finalCaseId, leadOrgIds, currentLeadOrgIds, baseUrl, activeWriteToken),
    syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_FUNDING_ORGS, finalCaseId, fundingOrgIds, currentFundingOrgIds, baseUrl, activeWriteToken),
    syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_INVOLVED_ORGS, finalCaseId, involvedOrgIds, currentInvolvedOrgIds, baseUrl, activeWriteToken),
    syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_PARTICIPANTS, finalCaseId, participantIds, currentPartIds, baseUrl, activeWriteToken),
    syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_RESOURCES, finalCaseId, resourceIds, currentResIds, baseUrl, activeWriteToken),
    syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_MESSAGES, finalCaseId, messageIds, currentMsgIds, baseUrl, activeWriteToken),
  ]);

  return jsonResponse(
    {
      success: true,
      caseId: finalCaseId,
      editKey: isEditMode ? payload.editKey : generatedEditKey,
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Noco-Token",
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

function extractIds(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((o) => (typeof o === "object" && o !== null ? (o.Id || o.id || (o.id_fields && o.id_fields.Id)) : o))
    .filter((id) => id !== null && id !== undefined && !isNaN(Number(id)))
    .map(Number);
}

/**
 * Syncs many-to-many relationship links using NocoDB's dedicated /links/ endpoint.
 * Adds newly linked records and removes unlinked records.
 */
async function syncTableLinks(tableId, fieldId, recordId, desiredIds, currentIds, baseUrl, token) {
  const currentSet = new Set((currentIds || []).map(Number));
  const desiredSet = new Set((desiredIds || []).map(Number));

  const toAdd = [...desiredSet].filter((id) => !currentSet.has(id));
  const toRemove = [...currentSet].filter((id) => !desiredSet.has(id));

  if (toAdd.length > 0) {
    try {
      const addRes = await fetch(`${baseUrl}/api/v2/tables/${tableId}/links/${fieldId}/records/${recordId}`, {
        method: "POST",
        headers: {
          "xc-token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toAdd.map((id) => ({ Id: id }))),
      });
      if (!addRes.ok) {
        console.warn(`Failed to add links on table ${tableId}, field ${fieldId}:`, addRes.status, await addRes.text());
      }
    } catch (err) {
      console.warn(`Exception adding links on table ${tableId}, field ${fieldId}:`, err);
    }
  }

  if (toRemove.length > 0) {
    try {
      const delRes = await fetch(`${baseUrl}/api/v2/tables/${tableId}/links/${fieldId}/records/${recordId}`, {
        method: "DELETE",
        headers: {
          "xc-token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toRemove.map((id) => ({ Id: id }))),
      });
      if (!delRes.ok) {
        console.warn(`Failed to remove links on table ${tableId}, field ${fieldId}:`, delRes.status, await delRes.text());
      }
    } catch (err) {
      console.warn(`Exception removing links on table ${tableId}, field ${fieldId}:`, err);
    }
  }
}


