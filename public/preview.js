/**
 * PAVE Case Book — Client-Side Reactive Live Preview Engine
 *
 * Renders the PAVE Case Study Page ("What", "Who & where", "Resources and recommendations")
 * and the Browse Card view directly from live form inputs and application state,
 * including the interactive Leaflet mini-map powered by NocoDB linked Locations.
 */

(function () {
  "use strict";

  const previewState = {
    mode: "page", // 'page' | 'card'
    activeTab: "tab-what", // 'tab-what' | 'tab-who' | 'tab-outcomes'
    splitOpen: false,
    descriptionExpanded: false,
    carouselIndex: 0,
    leafletMap: null,
    leafletMarkerGroup: null,
    lastMarkersSignature: "",
  };

  /**
   * Safely sets sanitized HTML into a container element.
   * Uses the modern Sanitizer API (`Element.prototype.setHTML`) when available,
   * and falls back to DOMParser with strict element/attribute allowlisting.
   */
  const SAFE_TAGS = new Set([
    "P",
    "BR",
    "STRONG",
    "B",
    "EM",
    "I",
    "UL",
    "OL",
    "LI",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "BLOCKQUOTE",
    "CODE",
    "PRE",
    "A",
    "SPAN",
    "DIV",
    "HR",
  ]);
  const SAFE_ATTRS = new Set(["href", "target", "rel", "class"]);

  function setSafeHTML(container, htmlString) {
    if (!container) return;
    if ("setHTML" in Element.prototype) {
      try {
        container.setHTML(htmlString);
        return;
      } catch (_) {
        // Fallback below if sanitizer options differ across browser versions
      }
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");

    function cleanNode(node) {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          if (!SAFE_TAGS.has(child.tagName)) {
            const textNode = document.createTextNode(child.textContent || "");
            node.replaceChild(textNode, child);
            continue;
          }
          const attrs = Array.from(child.attributes);
          for (const attr of attrs) {
            const name = attr.name.toLowerCase();
            if (!SAFE_ATTRS.has(name)) {
              child.removeAttribute(attr.name);
            } else if (name === "href") {
              const val = (attr.value || "").trim();
              const isSafeHref =
                val.startsWith("http://") ||
                val.startsWith("https://") ||
                val.startsWith("mailto:") ||
                val.startsWith("#");
              if (!isSafeHref) {
                child.removeAttribute("href");
              } else if (val.startsWith("http")) {
                child.setAttribute("target", "_blank");
                child.setAttribute("rel", "noopener noreferrer");
              }
            }
          }
          cleanNode(child);
        } else if (child.nodeType !== Node.TEXT_NODE) {
          node.removeChild(child);
        }
      }
    }

    cleanNode(doc.body);
    container.replaceChildren(...Array.from(doc.body.childNodes));
  }

  function escapeHtml(val) {
    if (val === null || val === undefined) return "";
    return String(val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Lightweight Markdown-to-HTML converter supporting paragraphs, headings,
   * bold, italic, links, blockquotes, and bullet/numbered lists.
   */
  function renderMarkdownToHtml(mdText) {
    if (!mdText || typeof mdText !== "string") return "";
    const normalized = mdText.replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";

    const lines = normalized.split("\n");
    const htmlBlocks = [];
    let inUl = false;
    let inOl = false;
    let paragraphLines = [];

    const flushParagraph = () => {
      if (paragraphLines.length > 0) {
        htmlBlocks.push(`<p>${ paragraphLines.map(formatInlineMarkdown).join("<br>") }</p>`);
        paragraphLines = [];
      }
    };

    const closeLists = () => {
      if (inUl) {
        htmlBlocks.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        htmlBlocks.push("</ol>");
        inOl = false;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        flushParagraph();
        closeLists();
        continue;
      }

      // Headings
      const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        flushParagraph();
        closeLists();
        const level = Math.min(headingMatch[1].length + 2, 5); // h3..h5 inside preview
        htmlBlocks.push(`<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`);
        continue;
      }

      // Blockquote
      if (line.startsWith("> ")) {
        flushParagraph();
        closeLists();
        htmlBlocks.push(`<blockquote>${formatInlineMarkdown(line.slice(2))}</blockquote>`);
        continue;
      }

      // Unordered list item
      const ulMatch = line.match(/^[-*•]\s+(.+)$/);
      if (ulMatch) {
        flushParagraph();
        if (inOl) {
          htmlBlocks.push("</ol>");
          inOl = false;
        }
        if (!inUl) {
          htmlBlocks.push("<ul>");
          inUl = true;
        }
        htmlBlocks.push(`<li>${formatInlineMarkdown(ulMatch[1])}</li>`);
        continue;
      }

      // Ordered list item
      const olMatch = line.match(/^\d+\.\s+(.+)$/);
      if (olMatch) {
        flushParagraph();
        if (inUl) {
          htmlBlocks.push("</ul>");
          inUl = false;
        }
        if (!inOl) {
          htmlBlocks.push("<ol>");
          inOl = true;
        }
        htmlBlocks.push(`<li>${formatInlineMarkdown(olMatch[1])}</li>`);
        continue;
      }

      closeLists();
      paragraphLines.push(line);
    }

    flushParagraph();
    closeLists();

    return htmlBlocks.join("\n");
  }

  function formatInlineMarkdown(text) {
    let safe = escapeHtml(text);
    // Bold **text** or __text__
    safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/__(.+?)__/g, "<strong>$1</strong>");
    // Italic *text* or _text_
    safe = safe.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
    safe = safe.replace(/(^|[^_])_([^_]+)_(?!_)/g, "$1<em>$2</em>");
    // Inline code `code`
    safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Links [label](https://...)
    safe = safe.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return safe;
  }

  /**
   * Collects live case data from the DOM inputs and `window.paveFormState`
   */
  function collectLiveCaseData() {
    const appState = window.paveFormState || {};
    const getVal = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : "";
    };
    const getChecked = (name) =>
      Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((cb) => cb.value);

    return {
      id: appState.caseId || null,
      workflowStatus:
        document.getElementById("staffWorkflowStatus")?.value ||
        appState.workflowStatus ||
        (appState.submissionIntent === "nomination" ? "Nomination" : "Submission"),
      curationDecision: appState.curationDecision || "",
      projectTitle: getVal("projectTitle") || "Untitled Public Engagement Case",
      hasRealTitle: Boolean(getVal("projectTitle")),
      projectUrl: getVal("projectUrl"),
      projectDescription: getVal("projectDescription"),
      importanceReason: getVal("importanceReason"),
      subjectMatter: getVal("subjectMatter"),
      startYear: getVal("startYear"),
      projectStatus: getVal("projectStatus"),
      endYear: getVal("endYear"),
      submitterName: getVal("submitterName"),
      additionalAcknowledgements: getVal("additionalAcknowledgements"),
      aiForms: getChecked("aiForms"),
      projectGoals: getChecked("projectGoals"),
      initiatedMethods: getChecked("initiatedMethods"),
      inclusionEfforts: getVal("inclusionEfforts"),
      limitations: getVal("limitations"),
      headlineFindings: getVal("headlineFindings"),
      publishedResources: getChecked("publishedResources"),
      leadOrganisations: Array.isArray(appState.leadOrganisations) ? appState.leadOrganisations : [],
      fundingOrganisations: Array.isArray(appState.fundingOrganisations) ? appState.fundingOrganisations : [],
      involvedOrganisations: Array.isArray(appState.involvedOrganisations) ? appState.involvedOrganisations : [],
      participants: Array.isArray(appState.participants) ? appState.participants : [],
      resources: Array.isArray(appState.resources) ? appState.resources : [],
      messages: Array.isArray(appState.messages) ? appState.messages : [],
      photosAndImages: Array.isArray(appState.photosAndImages) ? appState.photosAndImages : [],
      methodImage: Array.isArray(appState.methodImage) ? appState.methodImage : [],
      methodImageCaption: appState.methodImageCaption || "",
      geographicScope: Array.isArray(appState.geographicScope) ? appState.geographicScope : [],
    };
  }

  /**
   * Computes aggregated participant cohort statistics and the natural-language
   * summary paragraph matching `_includes/case/screen_view.html` in the PAVE repo.
   */
  function buildCohortSummary(participants) {
    let totalParticipants = 0;
    let cohortCount = participants.length;
    let minHours = null;
    let maxHours = null;
    const allMethods = [];

    participants.forEach((cohort) => {
      const size = Number(cohort.participantCount);
      if (!isNaN(size) && size > 0) {
        totalParticipants += size;
      }
      const hours = parseFloat(cohort.engagementHours);
      if (!isNaN(hours) && hours > 0) {
        if (minHours === null || hours < minHours) minHours = hours;
        if (maxHours === null || hours > maxHours) maxHours = hours;
      }
      const methods = Array.isArray(cohort.engagementMethods) ? cohort.engagementMethods : [];
      methods.forEach((m) => {
        if (m && !allMethods.includes(m)) {
          allMethods.push(m);
        }
      });
    });

    if (totalParticipants === 0 && cohortCount === 0) {
      return {
        summaryHtml: "",
        allMethods,
        totalParticipants: 0,
      };
    }

    const parts = [];
    if (totalParticipants > 0) {
      let s = `This process engaged with a total of <strong>${escapeHtml(totalParticipants.toLocaleString())}</strong> people`;
      if (cohortCount > 1) {
        s += ` across <strong>${cohortCount}</strong> cohorts`;
      }
      s += ".";
      parts.push(s);
    } else if (cohortCount > 0) {
      parts.push(
        `This process engaged participants across <strong>${cohortCount}</strong> ${
          cohortCount === 1 ? "cohort" : "cohorts"
        }.`
      );
    }

    if (minHours !== null || allMethods.length > 0) {
      let s = "Participants were involved";
      if (minHours !== null) {
        if (minHours === maxHours) {
          s += ` for approximately <strong>${escapeHtml(minHours)}</strong> hours each`;
        } else {
          s += ` for between <strong>${escapeHtml(minHours)}</strong> and <strong>${escapeHtml(maxHours)}</strong> hours`;
        }
      }
      if (allMethods.length > 0) {
        if (allMethods.length === 1) {
          s += ` through <strong>${escapeHtml(allMethods[0].toLowerCase())}</strong> methods`;
        } else {
          const lower = allMethods.map((m) => escapeHtml(m.toLowerCase()));
          const last = lower.pop();
          s += ` through a range of methods including <strong>${lower.join(", ")} and ${last}</strong>`;
        }
      }
      s += ".";
      parts.push(s);
    }

    return {
      summaryHtml: parts.join(" "),
      allMethods,
      totalParticipants,
    };
  }

  /**
   * Collects unique location names & map markers from linked Locations across
   * Lead Organisations, Involved Organisations, Funding Organisations, and Participants.
   */
  function collectLocationsAndMarkers(data) {
    const participantLocationNames = [];
    const organiserLocationNames = [];
    const markers = [];

    const addUniqueName = (arr, name) => {
      const clean = (name || "").trim();
      if (clean && !arr.some((n) => n.toLowerCase() === clean.toLowerCase())) {
        arr.push(clean);
      }
    };

    // 1. Lead Organisations (#496a40)
    (data.leadOrganisations || []).forEach((org) => {
      (org.locations || []).forEach((loc) => {
        if (loc && loc.name) addUniqueName(organiserLocationNames, loc.name);
        if (loc && isFiniteNumber(loc.latitude) && isFiniteNumber(loc.longitude)) {
          markers.push({
            lat: Number(loc.latitude),
            lng: Number(loc.longitude),
            title: `${org.name} (Lead)`,
            locationName: loc.name || "",
            category: "lead",
            color: "#496a40",
            radius: 7,
            weight: 2,
          });
        }
      });
    });

    // 2. Involved Organisations (#8fa68b)
    (data.involvedOrganisations || []).forEach((org) => {
      (org.locations || []).forEach((loc) => {
        if (loc && loc.name) addUniqueName(organiserLocationNames, loc.name);
        if (loc && isFiniteNumber(loc.latitude) && isFiniteNumber(loc.longitude)) {
          markers.push({
            lat: Number(loc.latitude),
            lng: Number(loc.longitude),
            title: `${org.name} (Involved)`,
            locationName: loc.name || "",
            category: "involved",
            color: "#8fa68b",
            radius: 4.5,
            weight: 1.5,
          });
        }
      });
    });

    // 3. Funding Organisations (include in Organiser locations text list)
    (data.fundingOrganisations || []).forEach((org) => {
      (org.locations || []).forEach((loc) => {
        if (loc && loc.name) addUniqueName(organiserLocationNames, loc.name);
      });
    });

    // 4. Participants (#e67e22)
    (data.participants || []).forEach((cohort) => {
      const linkedLocs = Array.isArray(cohort.locations) ? cohort.locations : [];
      if (linkedLocs.length > 0) {
        linkedLocs.forEach((loc) => {
          if (loc && loc.name) addUniqueName(participantLocationNames, loc.name);
          if (loc && isFiniteNumber(loc.latitude) && isFiniteNumber(loc.longitude)) {
            markers.push({
              lat: Number(loc.latitude),
              lng: Number(loc.longitude),
              title: `${cohort.groupDescription || "Participants"} (Participants)`,
              locationName: loc.name || "",
              category: "participants",
              color: "#e67e22",
              radius: 5.5,
              weight: 1.5,
            });
          }
        });
      } else if (cohort.geographicOrigin) {
        addUniqueName(participantLocationNames, cohort.geographicOrigin);
      }
    });

    // Fallback to case-level geographicScope if participant locations are empty
    if (participantLocationNames.length === 0 && Array.isArray(data.geographicScope)) {
      data.geographicScope.forEach((loc) => {
        if (loc && loc.name) addUniqueName(participantLocationNames, loc.name);
      });
    }

    return {
      participantLocationNames,
      organiserLocationNames,
      markers,
    };
  }

  function isFiniteNumber(val) {
    return val !== null && val !== undefined && val !== "" && Number.isFinite(Number(val));
  }

  /**
   * Renders the full Case Study Page view inside `#pavePreviewViewport`
   */
  function renderCaseStudyPage(viewport, data) {
    const { summaryHtml, allMethods } = buildCohortSummary(data.participants);
    const { participantLocationNames, organiserLocationNames, markers } = collectLocationsAndMarkers(data);

    // Check for facilitation guide or evaluation in resources
    let hasFacilitationGuide = false;
    let hasEvaluation = false;
    (data.resources || []).forEach((r) => {
      const t = (r.resourceType || "").toLowerCase();
      if (t.includes("facilitation guide")) hasFacilitationGuide = true;
      if (t.includes("evaluation")) hasEvaluation = true;
    });

    // Format description (support <!--more--> split)
    let descTeaserHtml = "";
    let descRemainderHtml = "";
    const rawDesc = data.projectDescription || "";
    if (rawDesc.includes("<!--more-->")) {
      const parts = rawDesc.split("<!--more-->");
      descTeaserHtml = renderMarkdownToHtml(parts[0]);
      descRemainderHtml = renderMarkdownToHtml(parts.slice(1).join("\n\n"));
    } else {
      descTeaserHtml = renderMarkdownToHtml(rawDesc);
    }

    // Format When string
    let whenDisplay = "";
    if (data.startYear) {
      whenDisplay = String(data.startYear);
      if (data.endYear && String(data.endYear) !== String(data.startYear)) {
        whenDisplay += ` – ${data.endYear}`;
      } else if (data.projectStatus === "In Progress" && !data.endYear) {
        whenDisplay += " – Ongoing";
      }
    } else if (data.endYear) {
      whenDisplay = String(data.endYear);
    } else if (data.projectStatus) {
      whenDisplay = data.projectStatus;
    }

    // Group outcomes by type
    const outcomes = data.messages || [];
    const recCount = outcomes.filter((m) => (m.type || "Recommendation") === "Recommendation").length;
    const actCount = outcomes.filter((m) => m.type === "Action").length;
    const quoteCount = outcomes.filter((m) => m.type === "Quote").length;
    const issueCount = outcomes.filter((m) => m.type === "Issue").length;

    const outcomeSummaryParts = [];
    if (recCount > 0) {
      outcomeSummaryParts.push(
        `<a href="#pave-outcome-Recommendation" class="pave-outcome-jump">${recCount} ${
          recCount === 1 ? "recommendation" : "recommendations"
        }</a>`
      );
    }
    if (actCount > 0) {
      outcomeSummaryParts.push(
        `<a href="#pave-outcome-Action" class="pave-outcome-jump">${actCount} ${
          actCount === 1 ? "action" : "actions"
        }</a>`
      );
    }
    if (quoteCount > 0) {
      outcomeSummaryParts.push(
        `<a href="#pave-outcome-Quote" class="pave-outcome-jump">${quoteCount} participant ${
          quoteCount === 1 ? "quote" : "quotes"
        }</a>`
      );
    }
    if (issueCount > 0) {
      outcomeSummaryParts.push(
        `<a href="#pave-outcome-Issue" class="pave-outcome-jump">${issueCount} ${
          issueCount === 1 ? "theme raised" : "themes raised"
        }</a>`
      );
    }

    let outcomeSummarySentence = "";
    if (outcomeSummaryParts.length === 1) {
      outcomeSummarySentence = outcomeSummaryParts[0];
    } else if (outcomeSummaryParts.length === 2) {
      outcomeSummarySentence = `${outcomeSummaryParts[0]} and ${outcomeSummaryParts[1]}`;
    } else if (outcomeSummaryParts.length > 2) {
      const copy = [...outcomeSummaryParts];
      const last = copy.pop();
      outcomeSummarySentence = `${copy.join(", ")}, and ${last}`;
    }

    // Clamp carousel index
    if (outcomes.length > 0 && previewState.carouselIndex >= outcomes.length) {
      previewState.carouselIndex = 0;
    }

    const activeTab = previewState.activeTab || "tab-what";

    // Build outer page shell
    viewport.innerHTML = `
      <article class="pave-case-study-page">
        <!-- Header Banner -->
        <header class="pave-case-header-banner">
          <div class="pave-header-banner-inner">
            <h1 class="${data.hasRealTitle ? "" : "is-placeholder"}">${escapeHtml(data.projectTitle)}</h1>
            ${
              data.subjectMatter
                ? `<p class="pave-case-subtitle">${escapeHtml(data.subjectMatter)}</p>`
                : ""
            }
          </div>
          <div class="pave-tab-buttons-container" role="tablist" aria-label="Case study sections">
            <button type="button" class="pave-tab-button ${activeTab === "tab-what" ? "active" : ""}" data-pave-tab="tab-what" role="tab" aria-selected="${activeTab === "tab-what"}">
              What
            </button>
            <button type="button" class="pave-tab-button ${activeTab === "tab-who" ? "active" : ""}" data-pave-tab="tab-who" role="tab" aria-selected="${activeTab === "tab-who"}">
              Who &amp; where
            </button>
            <button type="button" class="pave-tab-button ${activeTab === "tab-outcomes" ? "active" : ""}" data-pave-tab="tab-outcomes" role="tab" aria-selected="${activeTab === "tab-outcomes"}">
              Resources and recommendations
            </button>
          </div>
        </header>

        <!-- TAB 1: WHAT -->
        <section id="pave-panel-what" class="pave-tab-panel ${activeTab === "tab-what" ? "active" : ""}" role="tabpanel">
          <div class="pave-tab-two-columns">
            <div class="pave-tab-left-col">
              <div class="pave-description-section">
                <div id="paveDescTeaser" class="pave-prose"></div>
                ${
                  descRemainderHtml
                    ? `
                      <button type="button" id="paveReadMoreBtn" class="pave-read-more-btn">
                        ${previewState.descriptionExpanded ? "Show less" : "Read more"}
                      </button>
                      <div id="paveDescMore" class="pave-prose ${previewState.descriptionExpanded ? "" : "hidden"}"></div>
                    `
                    : ""
                }
                ${
                  !rawDesc && data.importanceReason
                    ? `<div id="paveImportanceFallback" class="pave-prose"></div>`
                    : ""
                }
              </div>

              ${
                hasFacilitationGuide || hasEvaluation
                  ? `
                  <div class="pave-resource-callouts">
                    ${
                      hasFacilitationGuide
                        ? `<p><a href="#tab-outcomes" class="pave-switch-tab-link" data-target-tab="tab-outcomes">Find a facilitation guide in the resources section.</a></p>`
                        : ""
                    }
                    ${
                      hasEvaluation
                        ? `<p><a href="#tab-outcomes" class="pave-switch-tab-link" data-target-tab="tab-outcomes">An evaluation is available in the resources section.</a></p>`
                        : ""
                    }
                  </div>
                `
                  : ""
              }

              ${
                data.methodImage && data.methodImage.length > 0
                  ? `
                  <div class="pave-method-image-section">
                    <div class="pave-method-image-wrapper">
                      <img src="${escapeHtml(data.methodImage[0].url)}" alt="Method illustration" class="pave-method-image" loading="lazy">
                      ${
                        data.methodImageCaption
                          ? `<div class="pave-method-caption" id="paveMethodCaption"></div>`
                          : ""
                      }
                    </div>
                  </div>
                `
                  : ""
              }
            </div>

            <div class="pave-tab-right-col">
              ${
                data.submitterName
                  ? `
                  <div class="pave-case-source-attribution">
                    This case study has been created from information submitted by <strong>${escapeHtml(data.submitterName)}</strong>
                  </div>
                `
                  : ""
              }

              <table class="pave-metadata-table">
                <tbody>
                  ${
                    whenDisplay
                      ? `
                      <tr>
                        <th>When</th>
                        <td>${escapeHtml(whenDisplay)}</td>
                      </tr>
                    `
                      : ""
                  }
                  ${
                    data.aiForms.length > 0
                      ? `
                      <tr>
                        <th>Focus</th>
                        <td>${data.aiForms.map(escapeHtml).join(", ")}</td>
                      </tr>
                    `
                      : ""
                  }
                  ${
                    data.projectGoals.length > 0
                      ? `
                      <tr>
                        <th>Goals</th>
                        <td>
                          <ul class="pave-goals-list">
                            ${data.projectGoals
                              .map((goal) => {
                                if (goal.includes(":")) {
                                  const parts = goal.split(":");
                                  const head = parts.shift();
                                  return `<li><strong>${escapeHtml(head)}:</strong>${escapeHtml(parts.join(":"))}</li>`;
                                }
                                return `<li>${escapeHtml(goal)}</li>`;
                              })
                              .join("")}
                          </ul>
                        </td>
                      </tr>
                    `
                      : ""
                  }
                  ${
                    data.initiatedMethods.length > 0
                      ? `
                      <tr>
                        <th>Initiation method</th>
                        <td>${data.initiatedMethods.map(escapeHtml).join(", ")}</td>
                      </tr>
                    `
                      : ""
                  }
                  ${
                    allMethods.length > 0
                      ? `
                      <tr>
                        <th>Participation methods</th>
                        <td>${allMethods.map(escapeHtml).join(", ")}</td>
                      </tr>
                    `
                      : ""
                  }
                </tbody>
              </table>

              ${
                data.projectUrl
                  ? `
                  <div class="pave-project-website-link">
                    <a href="${escapeHtml(data.projectUrl)}" target="_blank" rel="noopener noreferrer" class="pave-btn-project-website">
                      Visit Project website <span class="pave-external-icon">↗</span>
                    </a>
                  </div>
                `
                  : ""
              }
            </div>
          </div>

          ${
            (data.photosAndImages && data.photosAndImages.length > 0) || outcomes.length > 0
              ? `
              <div class="pave-media-outcomes-grid ${
                data.photosAndImages.length > 0 && outcomes.length > 0 ? "two-cols" : "one-col"
              }">
                ${
                  data.photosAndImages.length > 0
                    ? `
                    <div class="pave-gallery-col">
                      <div class="pave-image-gallery">
                        ${data.photosAndImages
                          .map(
                            (img, idx) => `
                          <div class="pave-gallery-item">
                            <img src="${escapeHtml(img.thumbUrl || img.url)}" data-full-src="${escapeHtml(img.url)}" alt="${escapeHtml(img.title || `Project photo ${idx + 1}`)}" class="pave-gallery-img" loading="lazy">
                          </div>
                        `
                          )
                          .join("")}
                      </div>
                    </div>
                  `
                    : ""
                }

                ${
                  outcomes.length > 0
                    ? `
                    <div class="pave-carousel-col">
                      <div class="pave-message-carousel-wrapper">
                        <div class="pave-carousel-header">
                          <span class="pave-carousel-counter">
                            Message ${previewState.carouselIndex + 1} of ${outcomes.length}
                          </span>
                          <div class="pave-carousel-controls">
                            <button type="button" class="pave-carousel-btn" id="paveCarouselPrev" aria-label="Previous message">&#10094;</button>
                            <button type="button" class="pave-carousel-btn" id="paveCarouselNext" aria-label="Next message">&#10095;</button>
                          </div>
                        </div>
                        <div class="pave-carousel-slide">
                          ${renderCarouselSlideHtml(outcomes[previewState.carouselIndex], previewState.carouselIndex)}
                        </div>
                      </div>
                    </div>
                  `
                    : ""
                }
              </div>
            `
              : ""
          }
        </section>

        <!-- TAB 2: WHO & WHERE -->
        <section id="pave-panel-who" class="pave-tab-panel ${activeTab === "tab-who" ? "active" : ""}" role="tabpanel">
          <div class="pave-tab-two-columns">
            <div class="pave-tab-left-col">
              ${
                summaryHtml
                  ? `<div class="pave-cohort-summary"><p>${summaryHtml}</p></div>`
                  : ""
              }

              ${
                data.participants.length > 0
                  ? `
                  <div class="pave-cohorts-section">
                    <h3>Participant cohorts</h3>
                    ${data.participants
                      .map((cohort, idx) => {
                        const linkedNames = (cohort.locations || [])
                          .map((l) => l && l.name)
                          .filter(Boolean);
                        const locationDisplay =
                          linkedNames.length > 0
                            ? linkedNames.map(escapeHtml).join(", ") +
                              (cohort.geographicOrigin &&
                              !linkedNames.some(
                                (n) => n.toLowerCase() === cohort.geographicOrigin.trim().toLowerCase()
                              )
                                ? ` <span class="pave-loc-origin-note">(${escapeHtml(cohort.geographicOrigin)})</span>`
                                : "")
                            : escapeHtml(cohort.geographicOrigin || "");

                        return `
                          <div class="pave-cohort-item">
                            <h4>${escapeHtml(cohort.groupDescription || `Cohort ${idx + 1}`)}</h4>
                            <table class="pave-cohort-table">
                              <tbody>
                                ${
                                  cohort.recruitmentMethod || cohort.recruitmentDescription
                                    ? `
                                    <tr>
                                      <th>Recruitment</th>
                                      <td>
                                        ${cohort.recruitmentMethod ? `<strong>${escapeHtml(cohort.recruitmentMethod)}</strong>` : ""}${
                                        cohort.recruitmentMethod && cohort.recruitmentDescription ? ": " : ""
                                      }${cohort.recruitmentDescription ? escapeHtml(cohort.recruitmentDescription) : ""}
                                      </td>
                                    </tr>
                                  `
                                    : ""
                                }
                                ${
                                  cohort.participantCount
                                    ? `
                                    <tr>
                                      <th>Group size</th>
                                      <td>${escapeHtml(cohort.participantCount)}</td>
                                    </tr>
                                  `
                                    : ""
                                }
                                ${
                                  cohort.engagementHours
                                    ? `
                                    <tr>
                                      <th>Engagement time</th>
                                      <td>${escapeHtml(cohort.engagementHours)} hours</td>
                                    </tr>
                                  `
                                    : ""
                                }
                                ${
                                  cohort.targetPopulation
                                    ? `
                                    <tr>
                                      <th>Target Population</th>
                                      <td>${escapeHtml(cohort.targetPopulation)}</td>
                                    </tr>
                                  `
                                    : ""
                                }
                                ${
                                  Array.isArray(cohort.engagementMethods) && cohort.engagementMethods.length > 0
                                    ? `
                                    <tr>
                                      <th>Engagement Methods Used</th>
                                      <td>${cohort.engagementMethods.map(escapeHtml).join(", ")}</td>
                                    </tr>
                                  `
                                    : ""
                                }
                                ${
                                  Array.isArray(cohort.engagementLocations) && cohort.engagementLocations.length > 0
                                    ? `
                                    <tr>
                                      <th>Engagement Setting</th>
                                      <td>${cohort.engagementLocations.map(escapeHtml).join(", ")}</td>
                                    </tr>
                                  `
                                    : ""
                                }
                                ${
                                  locationDisplay
                                    ? `
                                    <tr>
                                      <th>Location</th>
                                      <td>${locationDisplay}</td>
                                    </tr>
                                  `
                                    : ""
                                }
                              </tbody>
                            </table>
                          </div>
                        `;
                      })
                      .join("")}
                  </div>
                `
                  : `<p class="pave-empty-hint">No participant cohorts have been added yet.</p>`
              }

              ${
                data.inclusionEfforts
                  ? `
                  <div class="pave-inclusion-section">
                    <h3>Inclusion</h3>
                    <div id="paveInclusionProse" class="pave-prose"></div>
                  </div>
                `
                  : ""
              }

              ${
                data.limitations
                  ? `
                  <div class="pave-limitations-section">
                    <h3>Learning and limitations</h3>
                    <div id="paveLimitationsProse" class="pave-prose"></div>
                  </div>
                `
                  : ""
              }

              ${
                participantLocationNames.length > 0 || organiserLocationNames.length > 0
                  ? `
                  <div class="pave-locations-card">
                    <h3>Locations</h3>
                    ${
                      participantLocationNames.length > 0
                        ? `
                        <div class="pave-loc-group">
                          <h4>Participant locations</h4>
                          <p>${participantLocationNames.map(escapeHtml).join(", ")}</p>
                        </div>
                      `
                        : ""
                    }
                    ${
                      organiserLocationNames.length > 0
                        ? `
                        <div class="pave-loc-group">
                          <h4>Organiser locations</h4>
                          <p>${organiserLocationNames.map(escapeHtml).join(", ")}</p>
                        </div>
                      `
                        : ""
                    }
                  </div>
                `
                  : ""
              }
            </div>

            <div class="pave-tab-right-col">
              <div class="pave-mini-map-card">
                <div id="pavePreviewMiniMap" class="pave-case-mini-map" aria-label="Case locations map"></div>
                <div class="pave-map-legend">
                  <span class="pave-legend-item">
                    <span class="pave-legend-dot is-lead"></span> Lead Org
                  </span>
                  <span class="pave-legend-item">
                    <span class="pave-legend-dot is-involved"></span> Involved Org
                  </span>
                  <span class="pave-legend-item">
                    <span class="pave-legend-dot is-participants"></span> Participants
                  </span>
                  <span class="pave-legend-count">
                    ${markers.length} ${markers.length === 1 ? "pin" : "pins"} plotted
                  </span>
                </div>
              </div>

              ${
                data.leadOrganisations.length > 0 ||
                data.fundingOrganisations.length > 0 ||
                data.involvedOrganisations.length > 0
                  ? `
                  <div class="pave-organisers-card">
                    <h3>Organisers</h3>
                    ${renderOrgCategoryList("Led by", data.leadOrganisations)}
                    ${renderOrgCategoryList("Funded by", data.fundingOrganisations)}
                    ${renderOrgCategoryList("Also involved", data.involvedOrganisations)}
                  </div>
                `
                  : ""
              }
            </div>
          </div>
        </section>

        <!-- TAB 3: RESOURCES AND RECOMMENDATIONS -->
        <section id="pave-panel-outcomes" class="pave-tab-panel ${activeTab === "tab-outcomes" ? "active" : ""}" role="tabpanel">
          <div class="pave-tab-two-columns">
            <div class="pave-tab-left-col">
              ${
                data.headlineFindings || outcomes.length > 0
                  ? `
                  <div class="pave-outcomes-section">
                    <h3>Key outcomes</h3>
                    ${
                      data.headlineFindings
                        ? `<div id="paveHeadlineProse" class="pave-prose pave-headline-findings"></div>`
                        : ""
                    }
                    ${
                      outcomeSummarySentence
                        ? `<p class="pave-outcomes-summary-intro">This project resulted in ${outcomeSummarySentence}.</p>`
                        : ""
                    }
                    <div class="pave-recommendations-list">
                      ${outcomes
                        .map((msg, idx) => renderOutcomeCardHtml(msg, idx, outcomes))
                        .join("")}
                    </div>
                  </div>
                `
                  : `<p class="pave-empty-hint">No headline findings or structured messages (recommendations, actions, issues, quotes) have been added yet.</p>`
              }
            </div>

            <div class="pave-tab-right-col">
              ${
                data.resources.length > 0
                  ? `
                  <div class="pave-resources-section">
                    <h3>Resources</h3>
                    <ul class="pave-resources-list">
                      ${data.resources
                        .map((res) => {
                          const t = (res.resourceType || "").toLowerCase();
                          const attachments = Array.isArray(res.attachments) ? res.attachments : [];
                          let icon = attachments.length > 0 && !res.url ? "📎" : "🔗";
                          if (t.includes("report") || t.includes("paper") || t.includes("poster")) icon = "📄";
                          else if (t.includes("video")) icon = "🎥";
                          else if (t.includes("evaluation")) icon = "📋";
                          else if (t.includes("guide") || t.includes("workshop")) icon = "🧭";
                          else if (t.includes("photo") || t.includes("image")) icon = "🖼️";

                          const primaryHref =
                            res.url ||
                            (attachments[0] && (attachments[0].url || attachments[0].rawUrl)) ||
                            "#";

                          const filesHtml =
                            attachments.length > 0
                              ? `<div class="pave-resource-files">
                                  ${attachments
                                    .map(
                                      (att) =>
                                        `<a href="${escapeHtml(att.url || att.rawUrl || "#")}" target="_blank" rel="noopener noreferrer" class="pave-resource-file-chip">📎 ${escapeHtml(att.title || "Download file")}</a>`
                                    )
                                    .join("")}
                                </div>`
                              : "";

                          return `
                            <li>
                              <div class="pave-resource-header">
                                <span class="pave-resource-icon" title="${escapeHtml(res.resourceType || "Resource")}">${icon}</span>
                                <a href="${escapeHtml(primaryHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                                  res.title || "Untitled Resource"
                                )}</a>
                              </div>
                              ${
                                res.description
                                  ? `<p class="pave-resource-desc">${escapeHtml(res.description)}</p>`
                                  : ""
                              }
                              ${filesHtml}
                              ${
                                res.license
                                  ? `<span class="pave-license-tag">License: ${escapeHtml(res.license)}</span>`
                                  : ""
                              }
                            </li>
                          `;
                        })
                        .join("")}
                    </ul>
                  </div>
                `
                  : `<div class="pave-resources-section"><h3>Resources</h3><p class="pave-empty-hint">No supporting resource links added yet.</p></div>`
              }
            </div>
          </div>
        </section>

        <!-- Footer -->
        <footer class="pave-case-footer">
          <div class="pave-footer-learn-more">
            <span>Learn more:</span>
            <button type="button" class="pave-footer-tab-btn ${activeTab === "tab-what" ? "active" : ""}" data-pave-tab="tab-what">What</button>
            <button type="button" class="pave-footer-tab-btn ${activeTab === "tab-who" ? "active" : ""}" data-pave-tab="tab-who">Who &amp; where</button>
            <button type="button" class="pave-footer-tab-btn ${activeTab === "tab-outcomes" ? "active" : ""}" data-pave-tab="tab-outcomes">Resources and recommendations</button>
          </div>
          ${
            data.submitterName || data.additionalAcknowledgements
              ? `
              <div class="pave-acknowledgements-block">
                <p>
                  ${data.submitterName ? `<strong>Submitted by:</strong> ${escapeHtml(data.submitterName)}` : ""}
                  ${data.submitterName && data.additionalAcknowledgements ? "<br>" : ""}
                  ${
                    data.additionalAcknowledgements
                      ? `<strong>Acknowledgements:</strong> ${escapeHtml(data.additionalAcknowledgements)}`
                      : ""
                  }
                </p>
              </div>
            `
              : ""
          }
        </footer>
      </article>
    `;

    // Safely populate Markdown-rendered sections using setSafeHTML
    const teaserEl = viewport.querySelector("#paveDescTeaser");
    if (teaserEl) {
      if (descTeaserHtml) {
        setSafeHTML(teaserEl, descTeaserHtml);
      } else if (!data.importanceReason) {
        setSafeHTML(
          teaserEl,
          `<p class="pave-empty-hint">Enter a brief project description in Stage 2 to see it formatted here.</p>`
        );
      }
    }
    const moreEl = viewport.querySelector("#paveDescMore");
    if (moreEl && descRemainderHtml) {
      setSafeHTML(moreEl, descRemainderHtml);
    }
    const impFallbackEl = viewport.querySelector("#paveImportanceFallback");
    if (impFallbackEl && data.importanceReason) {
      setSafeHTML(impFallbackEl, renderMarkdownToHtml(data.importanceReason));
    }
    const methodCapEl = viewport.querySelector("#paveMethodCaption");
    if (methodCapEl && data.methodImageCaption) {
      setSafeHTML(methodCapEl, renderMarkdownToHtml(data.methodImageCaption));
    }
    const incEl = viewport.querySelector("#paveInclusionProse");
    if (incEl && data.inclusionEfforts) {
      setSafeHTML(incEl, renderMarkdownToHtml(data.inclusionEfforts));
    }
    const limEl = viewport.querySelector("#paveLimitationsProse");
    if (limEl && data.limitations) {
      setSafeHTML(limEl, renderMarkdownToHtml(data.limitations));
    }
    const headEl = viewport.querySelector("#paveHeadlineProse");
    if (headEl && data.headlineFindings) {
      setSafeHTML(headEl, renderMarkdownToHtml(data.headlineFindings));
    }

    // Populate markdown inside outcome cards and carousel slide
    viewport.querySelectorAll("[data-md-content]").forEach((el) => {
      const raw = el.getAttribute("data-md-content") || "";
      setSafeHTML(el, renderMarkdownToHtml(raw));
    });

    // Attach interactive event listeners inside the rendered preview
    bindCaseStudyPageEvents(viewport, data, markers);
  }

  function renderOrgCategoryList(heading, orgs) {
    if (!Array.isArray(orgs) || orgs.length === 0) return "";
    return `
      <div class="pave-org-group">
        <h4>${escapeHtml(heading)}</h4>
        <ul class="pave-org-list">
          ${orgs
            .map((org) => {
              const locNames = (org.locations || [])
                .map((l) => l && l.name)
                .filter(Boolean)
                .join(", ");
              const locBadge = locNames
                ? ` <span class="pave-org-loc-hint" title="Main Location: ${escapeHtml(locNames)}">📍 ${escapeHtml(locNames)}</span>`
                : "";
              if (org.website) {
                return `<li><a href="${escapeHtml(org.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                  org.name
                )}</a>${locBadge}</li>`;
              }
              return `<li>${escapeHtml(org.name)}${locBadge}</li>`;
            })
            .join("")}
        </ul>
      </div>
    `;
  }

  function getOutcomeTypeMeta(type) {
    const t = type || "Recommendation";
    switch (t) {
      case "Action":
        return { label: "Action", icon: "⚡", cls: "type-action" };
      case "Quote":
        return { label: "Quote", icon: "💬", cls: "type-quote" };
      case "Issue":
        return { label: "Issue", icon: "⚠️", cls: "type-issue" };
      default:
        return { label: "Recommendation", icon: "💡", cls: "type-recommendation" };
    }
  }

  function renderCarouselSlideHtml(msg, idx) {
    if (!msg) return "";
    const meta = getOutcomeTypeMeta(msg.type);
    return `
      <a href="#pave-outcome-item-${idx}" class="pave-carousel-card-link" data-jump-outcome="pave-outcome-item-${idx}">
        <div class="pave-recommendation-card ${meta.cls} is-carousel-card">
          <div class="pave-rec-header">
            <span class="pave-rec-type-badge" title="${escapeHtml(meta.label)}">${meta.icon}</span>
            <h4>${escapeHtml(msg.title || `${meta.label} ${idx + 1}`)}</h4>
          </div>
          <div class="pave-rec-body pave-prose" data-md-content="${escapeHtml(msg.text || "")}"></div>
        </div>
      </a>
    `;
  }

  function renderOutcomeCardHtml(msg, idx, allOutcomes) {
    const type = msg.type || "Recommendation";
    const meta = getOutcomeTypeMeta(type);
    const isFirstOfType = allOutcomes.findIndex((m) => (m.type || "Recommendation") === type) === idx;
    const anchorAttr = isFirstOfType ? `id="pave-outcome-${escapeHtml(type)}"` : "";

    return `
      <div ${anchorAttr} class="pave-outcome-anchor-wrap">
        <div id="pave-outcome-item-${idx}" class="pave-recommendation-card ${meta.cls}">
          <div class="pave-rec-header">
            <span class="pave-rec-type-badge" title="${escapeHtml(meta.label)}">${meta.icon} ${escapeHtml(
              meta.label
            )}</span>
            <h4>${escapeHtml(msg.title || `${meta.label} ${idx + 1}`)}</h4>
          </div>
          <div class="pave-rec-body pave-prose" data-md-content="${escapeHtml(msg.text || "")}"></div>
        </div>
      </div>
    `;
  }

  /**
   * Renders the Browse Card view (`/cases/` index card preview)
   */
  function renderBrowseCardView(viewport, data) {
    const { allMethods, totalParticipants } = buildCohortSummary(data.participants);
    const { participantLocationNames, organiserLocationNames } = collectLocationsAndMarkers(data);
    const allLocs = [...new Set([...participantLocationNames, ...organiserLocationNames])];

    const firstParagraph = (data.projectDescription || data.importanceReason || "")
      .split("<!--more-->")[0]
      .split(/\n\s*\n/)[0]
      .trim();

    const curation = (data.curationDecision || "").toLowerCase();
    let tierClass = "mapping-case";
    let tierBadge = "Mapping Entry";
    if (curation.includes("featured")) {
      tierClass = "featured-case";
      tierBadge = "★ Featured Case";
    } else if (curation.includes("full") || data.participants.length > 0 || data.messages.length > 0) {
      tierClass = "full-case";
      tierBadge = "Full Case Study";
    }

    const leadNames = data.leadOrganisations.map((o) => o.name).filter(Boolean);

    viewport.innerHTML = `
      <div class="pave-browse-card-stage">
        <p class="pave-browse-stage-caption">
          Preview of how this entry appears in the <a href="https://www.pavecasebook.org/cases/" target="_blank" rel="noopener noreferrer">PAVE Case Book directory</a>:
        </p>
        <div class="pave-case-card ${tierClass}">
          <div class="pave-card-top">
            <div class="pave-card-tier-row">
              <span class="pave-tier-pill ${tierClass}">${escapeHtml(tierBadge)}</span>
              ${
                data.startYear
                  ? `<span class="pave-card-year">${escapeHtml(data.startYear)}${
                      data.endYear && String(data.endYear) !== String(data.startYear)
                        ? `–${escapeHtml(data.endYear)}`
                        : ""
                    }</span>`
                  : ""
              }
            </div>
            <h3 class="pave-card-title">${escapeHtml(data.projectTitle)}</h3>
            ${
              leadNames.length > 0
                ? `<div class="pave-card-org">${leadNames.map(escapeHtml).join(", ")}</div>`
                : ""
            }
            <div class="pave-card-summary pave-prose" id="paveCardSummaryProse"></div>
          </div>

          <div class="pave-card-meta">
            ${data.aiForms
              .slice(0, 3)
              .map((f) => `<span class="pave-meta-pill is-focus">${escapeHtml(f)}</span>`)
              .join("")}
            ${allMethods
              .slice(0, 3)
              .map((m) => `<span class="pave-meta-pill is-method">${escapeHtml(m)}</span>`)
              .join("")}
            ${allLocs
              .slice(0, 3)
              .map((l) => `<span class="pave-meta-pill is-location">📍 ${escapeHtml(l)}</span>`)
              .join("")}
            ${
              totalParticipants > 0
                ? `<span class="pave-meta-pill is-count">👥 ${escapeHtml(
                    totalParticipants.toLocaleString()
                  )} participants</span>`
                : ""
            }
          </div>
        </div>
      </div>
    `;

    const summaryEl = viewport.querySelector("#paveCardSummaryProse");
    if (summaryEl) {
      if (firstParagraph) {
        setSafeHTML(summaryEl, renderMarkdownToHtml(firstParagraph));
      } else {
        setSafeHTML(
          summaryEl,
          `<p class="pave-empty-hint">Add a brief project description to populate the card summary.</p>`
        );
      }
    }

    // Clicking the card switches to the full Case Study Page view
    const cardEl = viewport.querySelector(".pave-case-card");
    if (cardEl) {
      cardEl.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        setPreviewMode("page");
      });
    }
  }

  /**
   * Binds interactive tab switching, read-more toggle, carousel navigation,
   * outcome jump links, and Leaflet map initialization inside the Case Study Page.
   */
  function bindCaseStudyPageEvents(viewport, data, markers) {
    // Tab switching
    viewport.querySelectorAll("[data-pave-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-pave-tab");
        if (targetTab) {
          switchPreviewTab(targetTab);
        }
      });
    });

    // Links that switch to Resources & Recommendations tab
    viewport.querySelectorAll(".pave-switch-tab-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const targetTab = link.getAttribute("data-target-tab") || "tab-outcomes";
        switchPreviewTab(targetTab);
      });
    });

    // Read more / Show less toggle
    const readMoreBtn = viewport.querySelector("#paveReadMoreBtn");
    if (readMoreBtn) {
      readMoreBtn.addEventListener("click", () => {
        previewState.descriptionExpanded = !previewState.descriptionExpanded;
        renderLivePreview();
      });
    }

    // Carousel prev / next
    const prevBtn = viewport.querySelector("#paveCarouselPrev");
    const nextBtn = viewport.querySelector("#paveCarouselNext");
    const outcomesLen = (data.messages || []).length;
    if (prevBtn && outcomesLen > 0) {
      prevBtn.addEventListener("click", () => {
        previewState.carouselIndex = (previewState.carouselIndex - 1 + outcomesLen) % outcomesLen;
        renderLivePreview();
      });
    }
    if (nextBtn && outcomesLen > 0) {
      nextBtn.addEventListener("click", () => {
        previewState.carouselIndex = (previewState.carouselIndex + 1) % outcomesLen;
        renderLivePreview();
      });
    }

    // Carousel card click -> jump to outcome in tab-outcomes
    viewport.querySelectorAll("[data-jump-outcome]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const targetId = link.getAttribute("data-jump-outcome");
        switchPreviewTab("tab-outcomes", targetId);
      });
    });

    // Outcome summary count jump links
    viewport.querySelectorAll(".pave-outcome-jump").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const href = link.getAttribute("href") || "";
        const targetId = href.replace(/^#/, "");
        const targetEl = viewport.querySelector(`#${CSS.escape(targetId)}`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });

    // Initialize or update the Leaflet mini-map if the Who & where tab is active
    if (previewState.activeTab === "tab-who") {
      initOrUpdateLeafletMap(viewport, markers);
    }
  }

  /**
   * Initializes or updates the Leaflet mini-map inside `#pavePreviewMiniMap`
   */
  function initOrUpdateLeafletMap(viewport, markers) {
    const mapContainer = viewport.querySelector("#pavePreviewMiniMap");
    if (!mapContainer || typeof window.L === "undefined") return;

    // Tear down any previous map instance attached to a detached DOM element
    if (previewState.leafletMap) {
      try {
        previewState.leafletMap.remove();
      } catch (_) {}
      previewState.leafletMap = null;
      previewState.leafletMarkerGroup = null;
    }

    const map = window.L.map(mapContainer, {
      scrollWheelZoom: false,
      attributionControl: true,
    }).setView([20, 0], 2);

    const CARTODB_API_KEY = "cb1_4qtr_1_72e49fe987375b3637f246b7";

    window.L.tileLayer(
      `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTODB_API_KEY}`,
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }
    ).addTo(map);

    const group = window.L.featureGroup().addTo(map);
    const bounds = [];

    markers.forEach((m) => {
      if (Number.isFinite(m.lat) && Number.isFinite(m.lng)) {
        const circle = window.L.circleMarker([m.lat, m.lng], {
          radius: m.radius || 5.5,
          fillColor: m.color || "#e67e22",
          color: m.color || "#e67e22",
          weight: m.weight || 1.5,
          opacity: 0.95,
          fillOpacity: 0.78,
        });

        const popupText = m.locationName
          ? `<strong>${escapeHtml(m.title)}</strong><br><small>📍 ${escapeHtml(m.locationName)}</small>`
          : `<strong>${escapeHtml(m.title)}</strong>`;

        circle.bindPopup(popupText);
        circle.addTo(group);
        bounds.push([m.lat, m.lng]);
      }
    });

    previewState.leafletMap = map;
    previewState.leafletMarkerGroup = group;

    setTimeout(() => {
      if (!previewState.leafletMap) return;
      previewState.leafletMap.invalidateSize();
      if (bounds.length > 0) {
        previewState.leafletMap.fitBounds(bounds, { padding: [22, 22], maxZoom: 6 });
      } else {
        previewState.leafletMap.setView([20, 0], 1);
      }
    }, 60);
  }

  function switchPreviewTab(tabId, scrollToElementId = null) {
    previewState.activeTab = tabId;
    renderLivePreview();
    if (scrollToElementId) {
      setTimeout(() => {
        const el = document.getElementById(scrollToElementId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("pave-highlight-pulse");
          setTimeout(() => el.classList.remove("pave-highlight-pulse"), 1800);
        }
      }, 80);
    }
  }

  function setPreviewMode(mode) {
    previewState.mode = mode === "card" ? "card" : "page";
    document.querySelectorAll(".pave-mode-btn").forEach((btn) => {
      const isMatch = btn.getAttribute("data-preview-mode") === previewState.mode;
      btn.classList.toggle("is-active", isMatch);
      btn.setAttribute("aria-selected", isMatch ? "true" : "false");
    });
    renderLivePreview();
  }

  /**
   * Main entry point to render/update the live preview (shown on Stage 7 in Full Case or Edit Mode;
   * hidden in Nominate mode).
   */
  function renderLivePreview() {
    const stage7Mount = document.getElementById("livePreviewMountStage7");
    const viewport = document.getElementById("pavePreviewViewport");
    if (!viewport) return;

    const formState = window.paveFormState || {};
    const shouldShowPreview = Boolean(formState.isEditMode || formState.submissionIntent === "full");

    if (stage7Mount) {
      stage7Mount.classList.toggle("hidden", !shouldShowPreview);
    }

    if (!shouldShowPreview || formState.currentStageId !== "stage-7") {
      return;
    }

    const data = collectLiveCaseData();

    if (previewState.mode === "card") {
      renderBrowseCardView(viewport, data);
    } else {
      renderCaseStudyPage(viewport, data);
    }
  }

  /**
   * Renders the preview when navigating to Stage 7
   */
  function onStageChanged(stageId) {
    if (stageId === "stage-7") {
      renderLivePreview();
    }
  }

  function initLivePreviewEngine() {
    // Mode switcher buttons (Case Study Page vs Browse Card)
    document.querySelectorAll(".pave-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-preview-mode") || "page";
        setPreviewMode(mode);
      });
    });

    // Re-render preview reactively on form input / change events when on Stage 7
    const caseForm = document.getElementById("caseForm");
    let inputTimer = null;
    if (caseForm) {
      caseForm.addEventListener("input", () => {
        clearTimeout(inputTimer);
        inputTimer = setTimeout(() => {
          renderLivePreview();
        }, 120);
      });
      caseForm.addEventListener("change", () => {
        clearTimeout(inputTimer);
        inputTimer = setTimeout(() => {
          renderLivePreview();
        }, 60);
      });
    }

    renderLivePreview();
  }

  // Expose public hooks for app.js
  window.PaveLivePreview = {
    init: initLivePreviewEngine,
    render: renderLivePreview,
    onStageChanged,
    switchTab: switchPreviewTab,
    setMode: setPreviewMode,
  };
})();
