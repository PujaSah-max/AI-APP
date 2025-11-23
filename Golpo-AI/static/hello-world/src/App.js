import React, { useCallback, useEffect, useState } from "react";
import { invoke, view, requestConfluence, getContext } from "@forge/bridge";
import golpoIcon from "./static/golpo-logo.png";
import VideoIcon from "./components/VideoIcon";

const APP_TITLE = "Golpo AI";
const APP_TAGLINE = "Generate engaging videos from your Confluence page";

const quickActions = ["Whiteboard explainer video of Confluence page"];

// Helper to strip HTML/markup for summaries
const stripMarkup = (html) => {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
};

// Helper to convert API page to UI format
const toUiPage = (page) => {
  if (!page) return null;
  const summary = page.body?.storage?.value
    ? stripMarkup(page.body.storage.value).slice(0, 180) + "..."
    : "No content available";
  return {
    id: page.id,
    title: page.title || "Untitled",
    summary,
  };
};

// Helper function to get current page ID from URL or parent window
const getPageIdFromUrl = () => {
  try {
    const url = window.location.href;
    const pathname = window.location.pathname;
    console.log("[GolpoAI] Attempting to extract page ID from URL:", { url, pathname });

    let match = url.match(/\/pages\/(\d+)/);
    if (match) {
      console.log("[GolpoAI] Found page ID from URL pattern 1:", match[1]);
      return match[1];
    }
    match = url.match(/pageId=(\d+)/);
    if (match) {
      console.log("[GolpoAI] Found page ID from URL pattern 2:", match[1]);
      return match[1];
    }
    match = url.match(/\/spaces\/[^\/]+\/pages\/(\d+)/);
    if (match) {
      console.log("[GolpoAI] Found page ID from URL pattern 3:", match[1]);
      return match[1];
    }
    const pathMatch = pathname.match(/\/pages\/(\d+)/);
    if (pathMatch) {
      console.log("[GolpoAI] Found page ID from pathname:", pathMatch[1]);
      return pathMatch[1];
    }
    if (window.location.hash) {
      const hashMatch = window.location.hash.match(/pageId=(\d+)/);
      if (hashMatch) {
        console.log("[GolpoAI] Found page ID from hash:", hashMatch[1]);
        return hashMatch[1];
      }
    }

    // Try parent window if in iframe
    try {
      if (window.parent && window.parent !== window) {
        const parentUrl = window.parent.location.href;
        const parentPathname = window.parent.location.pathname;
        console.log("[GolpoAI] Trying parent window URL:", { parentUrl, parentPathname });

        match = parentUrl.match(/\/pages\/(\d+)/);
        if (match) {
          console.log("[GolpoAI] Found page ID from parent URL:", match[1]);
          return match[1];
        }
        match = parentPathname.match(/\/pages\/(\d+)/);
        if (match) {
          console.log("[GolpoAI] Found page ID from parent pathname:", match[1]);
          return match[1];
        }
      }
    } catch (parentErr) {
      console.log("[GolpoAI] Cannot access parent window (expected in some contexts):", parentErr.message);
    }

    // Try meta tags or data attributes
    try {
      const metaPageId = document.querySelector('meta[name="ajs-content-id"], meta[property="ajs-content-id"]');
      if (metaPageId) {
        const pageId = metaPageId.getAttribute("content");
        if (pageId) {
          console.log("[GolpoAI] Found page ID from meta tag:", pageId);
          return pageId;
        }
      }
      const body = document.body;
      if (body) {
        const dataPageId =
          body.getAttribute("data-content-id") ||
          body.getAttribute("data-page-id") ||
          body.getAttribute("data-contentid");
        if (dataPageId) {
          console.log("[GolpoAI] Found page ID from data attribute:", dataPageId);
          return dataPageId;
        }
      }
      if (window.__ATL_PAGE_ID__) {
        console.log("[GolpoAI] Found page ID from __ATL_PAGE_ID__:", window.__ATL_PAGE_ID__);
        return String(window.__ATL_PAGE_ID__);
      }
      if (window.AJS && window.AJS.params && window.AJS.params.contentId) {
        console.log("[GolpoAI] Found page ID from AJS.params:", window.AJS.params.contentId);
        return String(window.AJS.params.contentId);
      }
    } catch (metaErr) {
      console.log("[GolpoAI] Could not get page ID from meta/data:", metaErr.message);
    }

    console.warn("[GolpoAI] Could not extract page ID from URL or document");
  } catch (e) {
    console.warn("[GolpoAI] Error extracting page ID from URL:", e);
  }
  return null;
};

// Helper to safely call invoke with fallback
const safeInvoke = async (functionName, payload = {}) => {
  try {
    return await invoke(functionName, payload);
  } catch (error) {
    if (error?.message?.includes("Entry point") && error?.message?.includes("could not be invoked")) {
      console.log(`[GolpoAI] invoke('${functionName}') not available (likely contentBylineItem), will use fallback`);
      throw new Error("INVOKE_NOT_AVAILABLE");
    }
    throw error;
  }
};

// Helper to fetch page details directly using requestConfluence
const fetchPageByIdDirect = async (pageId) => {
  if (!pageId) {
    throw new Error("Page id is required to load Confluence page details directly.");
  }
  try {
    const response = await requestConfluence(
      `/wiki/api/v2/pages/${pageId}?fields=id,title,status,createdAt,authorId,spaceId,body,version,_links&body-format=storage`
    );
    if (!response.ok) {
      const errorBody = await response.text();
      console.error("[GolpoAI] Failed to retrieve Confluence page by id directly", {
        pageId,
        status: response.status,
        statusText: response.statusText,
        errorBody,
      });
      throw new Error(`Unable to load Confluence page ${pageId}. Status: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("[GolpoAI] Error fetching page by ID directly:", error);
    throw error;
  }
};

// Helper to fetch footer comments directly using requestConfluence
const fetchFooterCommentsDirect = async (pageId) => {
  if (!pageId) {
    throw new Error("Page id is required to load footer comments directly.");
  }
  try {
    const response = await requestConfluence(`/wiki/api/v2/pages/${pageId}/footer-comments`);
    if (!response.ok) {
      const errorBody = await response.text();
      console.error("[GolpoAI] Failed to retrieve footer comments directly", {
        pageId,
        status: response.status,
        statusText: response.statusText,
        errorBody,
      });
      throw new Error(`Unable to load footer comments for page ${pageId}. Status: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("[GolpoAI] Error fetching footer comments directly:", error);
    throw error;
  }
};

const QuickActionIcon = () => (
  <span style={styles.actionIconWrapper}>
    <svg width="18" height="18" viewBox="0 0 36 36" fill="none">
      <rect x="4" y="9" width="20" height="18" rx="6" stroke="#8856ff" strokeWidth="3" />
      <path
        d="M24 16.5L31 12V24L24 19.5"
        stroke="#8856ff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

function App() {
  const [selectedAction, setSelectedAction] = useState(0);
  const [description, setDescription] = useState("");
  const [hoveredAction, setHoveredAction] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Video specification options
  const [duration, setDuration] = useState("1 min");
  const [voice, setVoice] = useState("Solo Female");
  const [language, setLanguage] = useState("English");
  const [includeLogo, setIncludeLogo] = useState(false);

  // Detect if we're in contentBylineItem (no resolver available)
  const [isBylineItem, setIsBylineItem] = useState(false);

  // Your logic preserved 👇
  const [pages, setPages] = useState([]);
  const [documentPayload, setDocumentPayload] = useState(null);
  const [footerComments, setFooterComments] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");

  const maxChars = 500;

  // Detect module type on mount
  useEffect(() => {
    const detectModuleType = async () => {
      try {
        await invoke("getCurrentPage", {});
        setIsBylineItem(false); // contentAction has resolver
      } catch (error) {
        setIsBylineItem(true); // contentBylineItem doesn't have resolver
      }
    };
    detectModuleType();
  }, []);

  // Fetch page info on load
  useEffect(() => {
    const fetchPageInfo = async (retryCount = 0) => {
      try {
        let pageInfo = null;
        let isInvoked = false;

        // For contentBylineItem, prioritize getContext() first
        if (isBylineItem) {
          try {
            console.log("[GolpoAI] fetchPageInfo: contentBylineItem - trying getContext()");
            const context = await getContext();
            console.log("[GolpoAI] fetchPageInfo: getContext() result:", context);
            if (context?.content?.id) {
              pageInfo = { id: context.content.id, title: context.content.title || "Page", type: context.content.type || "page" };
              console.log("[GolpoAI] fetchPageInfo: Got page info from getContext()", pageInfo);
            }
          } catch (contextErr) {
            console.warn("[GolpoAI] fetchPageInfo: getContext() failed, trying URL:", contextErr);
            const pageIdFromUrl = getPageIdFromUrl();
            if (pageIdFromUrl) {
              pageInfo = { id: pageIdFromUrl, title: "Page from URL", type: "page" };
              console.log("[GolpoAI] fetchPageInfo: Got page info from URL", pageInfo);
            }
          }
        } else {
          // For contentAction, try invoke first
          try {
            pageInfo = await safeInvoke("getCurrentPage", {});
            isInvoked = true;
            console.log("[GolpoAI] getCurrentPage response (attempt " + (retryCount + 1) + "):", pageInfo);
          } catch (invokeError) {
            console.warn("[GolpoAI] invoke('getCurrentPage') failed, falling back to getContext():", invokeError);
            // Fallback to getContext()
            try {
              const context = await getContext();
              if (context?.content?.id) {
                pageInfo = { id: context.content.id, title: context.content.title || "Page", type: context.content.type || "page" };
                console.log("[GolpoAI] fetchPageInfo: Got page info from getContext()", pageInfo);
              }
            } catch (contextErr) {
              console.warn("[GolpoAI] fetchPageInfo: getContext() failed, trying URL:", contextErr);
              const pageIdFromUrl = getPageIdFromUrl();
              if (pageIdFromUrl) {
                pageInfo = { id: pageIdFromUrl, title: "Page from URL", type: "page" };
                console.log("[GolpoAI] fetchPageInfo: Got page info from URL", pageInfo);
              }
            }
          }
        }

        if (pageInfo && pageInfo.id && pageInfo.id !== "unknown" && pageInfo.id !== "current") {
          console.log("[GolpoAI] Initial page fetched", pageInfo.id);

          // Fetch full page details
          try {
            const fullPageInfo = isInvoked
              ? (await safeInvoke("getPageById", { pageId: pageInfo.id }))?.body
              : await fetchPageByIdDirect(pageInfo.id);

            if (fullPageInfo) {
              console.log("[GolpoAI] Full page details fetched on load", fullPageInfo.id);
              setDocumentPayload(fullPageInfo);
              const mapped = toUiPage(fullPageInfo);
              if (mapped) {
                setPages([mapped]);
              }
            } else {
              // Fallback to basic page info if full fetch returns empty body
              setDocumentPayload(pageInfo);
              const mapped = toUiPage(pageInfo);
              if (mapped) {
                setPages([mapped]);
              }
            }
          } catch (fetchError) {
            console.warn("[GolpoAI] Could not fetch full page details, using basic info:", fetchError);
            // Use basic page info if full fetch fails
            setDocumentPayload(pageInfo);
            const mapped = toUiPage(pageInfo);
            if (mapped) {
              setPages([mapped]);
            }
          }
        } else {
          console.warn("[GolpoAI] Page info not available or id is unknown:", pageInfo);
          // If no valid page info, clear any existing pages
          setPages([]);
        }
      } catch (err) {
        console.error("[GolpoAI] Error fetching current page:", err);
        if (retryCount < 2) {
          // Retry up to 2 times
          setTimeout(() => fetchPageInfo(retryCount + 1), 500);
        } else {
          setError("Unable to fetch the current Confluence page: " + err.message + ". Please ensure you are on a Confluence page and try again.");
        }
      }
    };
    // Wait a bit for isBylineItem to be detected, then fetch
    const timer = setTimeout(() => {
      fetchPageInfo();
    }, 100);
    
    return () => clearTimeout(timer);
  }, [isBylineItem]);

  // Resolve page ID from various sources
  const resolvePageId = useCallback(async () => {
    console.log("[GolpoAI] resolvePageId called, isBylineItem:", isBylineItem);
    
    // First try cached document payload
    if (documentPayload?.id && documentPayload.id !== "unknown" && documentPayload.id !== "current") {
      console.log("[GolpoAI] resolvePageId using cached documentPayload", documentPayload.id);
      return documentPayload.id;
    }
    
    // Then try pages array
    if (pages[0]?.id && pages[0].id !== "unknown" && pages[0].id !== "current") {
      console.log("[GolpoAI] resolvePageId using first page entry", pages[0].id);
      return pages[0].id;
    }
    
    // For contentBylineItem, prioritize getContext() first
    if (isBylineItem) {
      try {
        console.log("[GolpoAI] resolvePageId: contentBylineItem - trying getContext()");
        const context = await getContext();
        console.log("[GolpoAI] resolvePageId: getContext() result:", context);
        
        if (context?.content?.id) {
          const pageId = context.content.id;
          console.log("[GolpoAI] resolvePageId: Found page ID from getContext()", pageId);
          return pageId;
        }
      } catch (contextErr) {
        console.warn("[GolpoAI] resolvePageId: getContext() failed:", contextErr);
      }
      
      // Fallback to URL parsing for contentBylineItem
      const pageIdFromUrl = getPageIdFromUrl();
      if (pageIdFromUrl) {
        console.log("[GolpoAI] resolvePageId: Found page ID from URL", pageIdFromUrl);
        return pageIdFromUrl;
      }
    }
    
    // For contentAction, try invoke first
    try {
      let current = null;
      let isInvoked = false;
      
      try {
        console.log("[GolpoAI] resolvePageId: Trying invoke('getCurrentPage')");
        current = await safeInvoke("getCurrentPage", {});
        isInvoked = true;
        console.log("[GolpoAI] resolvePageId: invoke('getCurrentPage') success", current);
      } catch (invokeError) {
        console.warn("[GolpoAI] resolvePageId: invoke('getCurrentPage') failed, trying alternatives:", invokeError);
        
        // Try getContext() as fallback
        try {
          const context = await getContext();
          console.log("[GolpoAI] resolvePageId: getContext() result:", context);
          if (context?.content?.id) {
            current = { id: context.content.id, title: context.content.title, type: context.content.type };
            console.log("[GolpoAI] resolvePageId: Using page ID from getContext()", current.id);
          }
        } catch (contextErr) {
          console.warn("[GolpoAI] resolvePageId: getContext() failed:", contextErr);
        }
        
        // If still no page ID, try URL parsing
        if (!current?.id) {
          const pageIdFromUrl = getPageIdFromUrl();
          if (pageIdFromUrl) {
            current = { id: pageIdFromUrl, title: "Page from URL", type: "page" };
            console.log("[GolpoAI] resolvePageId: Using page ID from URL", pageIdFromUrl);
          }
        }
      }

      if (current?.id && current.id !== "unknown" && current.id !== "current") {
        console.log("[GolpoAI] resolvePageId: Valid page ID found", current.id);
        return current.id;
      } else {
        console.warn("[GolpoAI] resolvePageId: Invalid page ID", current?.id);
      }
    } catch (err) {
      console.error("[GolpoAI] resolvePageId: Error getting current page:", err);
    }
    
    console.error("[GolpoAI] resolvePageId: All methods failed, returning null");
    return null;
  }, [documentPayload, pages, isBylineItem]);

  const openModal = async () => {
    setActionLoading(true);
    setError("");

    try {
      // First try to get page ID from resolvePageId
      let targetId = await resolvePageId();
      console.log("[GolpoAI] openModal: resolvePageId returned", targetId);

      // If that fails, try multiple fallback methods
      if (!targetId) {
        console.log("[GolpoAI] openModal: resolvePageId returned null, trying alternatives...");
        
        // Try getContext() first (works for both contentAction and contentBylineItem)
        try {
          const context = await getContext();
          console.log("[GolpoAI] openModal: getContext() result:", context);
          if (context?.content?.id) {
            targetId = context.content.id;
            console.log("[GolpoAI] openModal: Got page ID from getContext()", targetId);
          }
        } catch (contextErr) {
          console.warn("[GolpoAI] openModal: getContext() failed:", contextErr);
        }
        
        // If still no ID, try invoke (for contentAction)
        if (!targetId) {
          try {
            const currentPage = await safeInvoke("getCurrentPage", {});
            if (currentPage?.id && currentPage.id !== "unknown" && currentPage.id !== "current") {
              targetId = currentPage.id;
              console.log("[GolpoAI] openModal: Got page ID from getCurrentPage:", targetId);
            }
          } catch (invokeErr) {
            if (invokeErr.message === "INVOKE_NOT_AVAILABLE") {
              console.log("[GolpoAI] openModal: invoke not available, trying URL");
            } else {
              console.log("[GolpoAI] openModal: invoke error, trying URL:", invokeErr);
            }
          }
        }
        
        // Last resort: try URL parsing
        if (!targetId) {
          targetId = getPageIdFromUrl();
          if (targetId) {
            console.log("[GolpoAI] openModal: Got page ID from URL:", targetId);
          }
        }
      }

      if (!targetId) {
        console.error("[GolpoAI] openModal: All methods failed to get page ID");
        throw new Error("Missing page id");
      }
      
      console.log("[GolpoAI] openModal: Final page ID resolved", targetId);

      console.log("[GolpoAI] handleGenerateVideoClick resolved page id", targetId);

      // Determine if we should use invoke or direct API calls
      let isInvoked = false;
      try {
        await safeInvoke("getPageById", { pageId: targetId });
        isInvoked = true;
      } catch (invokeErr) {
        if (invokeErr.message !== "INVOKE_NOT_AVAILABLE") {
          throw invokeErr;
        }
      }

      // Fetch page and footer comments
      let pageBody = null;
      let footerResult = [];

      if (isInvoked) {
        const [pageResponse, footerResponse] = await Promise.all([
          safeInvoke("getPageById", { pageId: targetId }),
          safeInvoke("getFooterComments", { pageId: targetId }),
        ]);
        pageBody = pageResponse?.body;
        footerResult = footerResponse?.body?.results || [];
      } else {
        pageBody = await fetchPageByIdDirect(targetId);
        try {
          const footerData = await fetchFooterCommentsDirect(targetId);
          footerResult = footerData.results || [];
        } catch (footerErr) {
          console.warn("[GolpoAI] Could not fetch footer comments:", footerErr);
        }
      }

      console.log("[GolpoAI] handleGenerateVideoClick fetched document body", pageBody?.id);
      console.log("[GolpoAI] handleGenerateVideoClick fetched document body", pageBody);
      console.log("[GolpoAI] handleGenerateVideoClick fetched footer comments", footerResult.length);
      console.log("[GolpoAI] handleGenerateVideoClick fetched footer comments", footerResult);

      // Update document payload and pages with full document
      setDocumentPayload(pageBody);
      const mapped = toUiPage(pageBody);
      if (mapped) {
        setPages([mapped]);
      } else {
        setPages([]);
      }

      setFooterComments(footerResult);

      // Open specs modal after data is fetched
      setIsModalOpen(true);
    } catch (err) {
      console.error("[GolpoAI] Failed to fetch page document", err);
      const errorMessage = err?.message || "Unknown error";
      if (errorMessage.includes("Missing page id")) {
        setError("Unable to detect the current Confluence page. Please ensure you are viewing a Confluence page (not a space or other page type) and try again. If the issue persists, refresh the page.");
      } else {
        setError(`Unable to fetch the current Confluence page: ${errorMessage}. Please ensure you are on a Confluence page and try again.`);
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Apply larger styles only for contentBylineItem, keep contentAction unchanged
  const currentStyles = isBylineItem ? {
    ...styles,
    page: {
      ...styles.page,
      padding: "20px",
      width: "100%",
      maxWidth: "100%",
      height: "100%",
      minHeight: "100%",
      overflow: "auto",
    },
    closeButton: {
      ...styles.closeButton,
      top: "20px",
      right: "20px",
      fontSize: "24px",
    },
    heroContainer: {
      ...styles.heroContainer,
      marginBottom: "16px",
    },
    heroCard: {
      ...styles.heroCard,
      padding: "18px 24px",
    },
    heroContent: {
      ...styles.heroContent,
      gap: "14px",
    },
    logo: {
      ...styles.logo,
      width: 64,
      height: 64,
    },
    heroTitle: {
      ...styles.heroTitle,
      fontSize: "26px",
    },
    scrollArea: {
      ...styles.scrollArea,
      marginTop: "16px",
      maxHeight: "none",
      overflowY: "visible",
      overflowX: "hidden",
      flex: "1 1 auto",
    },
    mainHeading: {
      ...styles.mainHeading,
      fontSize: "22px",
      marginBottom: "16px",
    },
    sectionHeading: {
      ...styles.sectionHeading,
      fontSize: "18px",
      marginBottom: "8px",
    },
    sectionDescription: {
      ...styles.sectionDescription,
      fontSize: "15px",
      marginBottom: "16px",
    },
    contentSection: {
      ...styles.contentSection,
      marginBottom: "16px",
    },
    actionList: {
      ...styles.actionList,
      gap: "12px",
    },
    actionButton: {
      ...styles.actionButton,
      padding: "14px 20px",
      fontSize: "15px",
      gap: "14px",
    },
    actionIconWrapper: {
      ...styles.actionIconWrapper,
      width: "32px",
      height: "32px",
    },
    contextSection: {
      ...styles.contextSection,
      marginTop: "16px",
      maxHeight: "none",
    },
    contextCard: {
      ...styles.contextCard,
      gap: "10px",
      marginBottom: "16px",
      overflow: "visible",
    },
    pageCard: {
      ...styles.pageCard,
      padding: "14px 18px",
      overflow: "visible",
    },
    pageTitle: {
      ...styles.pageTitle,
      fontSize: "16px",
      marginBottom: "6px",
    },
    pageSummary: {
      ...styles.pageSummary,
      fontSize: "13px",
    },
    textareaLabel: {
      ...styles.textareaLabel,
      fontSize: "15px",
      marginBottom: "10px",
    },
    textarea: {
      ...styles.textarea,
      height: 110,
      minHeight: 110,
      maxHeight: 110,
      padding: "14px",
      fontSize: "15px",
    },
    textareaFooter: {
      ...styles.textareaFooter,
      marginTop: "12px",
      fontSize: "13px",
    },
    generateButton: {
      ...styles.generateButton,
      padding: "12px 20px",
      fontSize: "15px",
      gap: "10px",
    },
  } : styles;

  return (
    <div style={currentStyles.page}>
      {/* Close Button */}
      <button
        onClick={() => view.close()}
        style={currentStyles.closeButton}
      >
        ✖
      </button>

      {/* Header */}
      <header style={currentStyles.heroContainer}>
        <section style={currentStyles.heroCard}>
          <div style={currentStyles.heroContent}>
            <img src={golpoIcon} style={currentStyles.logo} alt="Golpo AI" />
            <h1 style={currentStyles.heroTitle}>{APP_TITLE}</h1>
          </div>
        </section>
      </header>

      {/* Main Scroll UI */}
      <div style={currentStyles.scrollArea}>
        {/* Main Heading */}
        <section style={currentStyles.contentSection}>
          <h1 style={currentStyles.mainHeading}>{APP_TAGLINE}</h1>
        </section>

        {/* Action list */}
        <section style={currentStyles.contentSection}>
          <div style={currentStyles.actionList}>
            {quickActions.map((action, index) => {
              const isActive = selectedAction === index;
              const isHovered = hoveredAction === index;

              return (
                <button
                  key={index}
                  style={{
                    ...currentStyles.actionButton,
                    ...(isActive || isHovered ? currentStyles.actionButtonActive : {}),
                  }}
                  onClick={() => {
                    setSelectedAction(index);
                    setDescription(action);
                  }}
                  onMouseEnter={() => setHoveredAction(index)}
                  onMouseLeave={() => setHoveredAction(null)}
                >
                  <QuickActionIcon />
                  <span>{action}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Context Section - Display current page */}
        {pages.length > 0 && (
          <section style={currentStyles.contextSection}>
            <h2 style={currentStyles.sectionHeading}>Context</h2>
            <div style={currentStyles.contextCard}>
              {pages.map((page) => (
                <div key={page.id} style={currentStyles.pageCard}>
                  <h3 style={currentStyles.pageTitle}>{page.title}</h3>
                  <p style={currentStyles.pageSummary}>{page.summary}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Describe your video section */}
        <section style={currentStyles.contextSection}>
          <label style={currentStyles.textareaLabel}>Describe your video</label>
          <textarea
            style={currentStyles.textarea}
            placeholder="Describe what should appear in video..."
            maxLength={maxChars}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div style={currentStyles.textareaFooter}>
            <span>{description.length} / {maxChars}</span>
            <button
              disabled={!description}
              onClick={openModal}
              style={{
                ...currentStyles.generateButton,
                ...(description ? currentStyles.generateButtonActive : currentStyles.generateButtonDisabled),
              }}
            >
              <VideoIcon size={18} />
              Generate Video
            </button>
          </div>
        </section>

        {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
                  </div>

      {/* Modal */}
      {isModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            {/* Modal Header */}
            <div style={styles.modalHeader}>
              <div style={styles.modalIconWrapper}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="4" width="14" height="12" rx="3" stroke="#7C3AED" strokeWidth="2" />
                  <path
                    d="M16 10L21 6V18L16 14"
                    stroke="#7C3AED"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
        </div>
              <div>
                <h3 style={styles.modalTitle}>Video Specifications</h3>
                <p style={styles.modalSubtitle}>Customize your video settings before generation.</p>
              </div>
            </div>

            {/* Modal Form */}
            <div style={styles.modalForm}>
              <div style={styles.formRow}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Duration</label>
                <select
                    style={styles.formSelect}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  >
                    <option value="30 sec">30 sec</option>
                    <option value="1 min">1 min</option>
                    <option value="2 min">2 min</option>
                    <option value="3 min">3 min</option>
                    <option value="5 min">5 min</option>
                  </select>
                </div>

                <div style={styles.formField}>
                  <label style={styles.formLabel}>Voice</label>
                  <select
                    style={styles.formSelect}
                    value={voice}
                    onChange={(e) => setVoice(e.target.value)}
                  >
                    <option value="Solo Female">Solo Female</option>
                    <option value="Solo Male">Solo Male</option>
                    <option value="Duet">Duet</option>
                </select>
                </div>
              </div>

              <div style={styles.formField}>
                <label style={styles.formLabel}>Language</label>
                <select
                  style={styles.formSelect}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="English">English</option>
                  <option value="Spanish">Spanish</option>
                  <option value="French">French</option>
                  <option value="German">German</option>
                  <option value="Hindi">Hindi</option>
                </select>
              </div>

              <div style={styles.formCheckboxRow}>
                <input
                  type="checkbox"
                  id="includeLogo"
                  checked={includeLogo}
                  onChange={(e) => setIncludeLogo(e.target.checked)}
                  style={styles.formCheckbox}
                />
                <label htmlFor="includeLogo" style={styles.formCheckboxLabel}>
                  Include company logo
              </label>
            </div>
            </div>

            {/* Modal Footer */}
            <div style={styles.modalFooter}>
              <button style={styles.modalCancelButton} onClick={() => setIsModalOpen(false)}>
                Cancel
              </button>
              <button style={styles.modalGenerateButton}>
                ✨ Generate Video
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

/* ------------------------ STYLE SYSTEM ------------------------ */
const styles = {
  page: {
    fontFamily: "Segoe UI, sans-serif",
    padding: "24px",
    background: "#ffffff",
    width: "100%",
    maxWidth: "100%",
    height: "100%",
    minHeight: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "auto",
    margin: 0,
    boxSizing: "border-box",
    position: "relative",
  },
  closeButton: {
    position: "absolute",
    top: 20,
    right: 20,
    background: "transparent",
    border: "none",
    fontSize: "24px",
    cursor: "pointer",
    fontWeight: 600,
  },
  heroContainer: { marginBottom: 20, flexShrink: 0 },
  heroCard: {
    background: "linear-gradient(to right, #faf5ff, #fdf2f8, #fff7ed)",
    padding: "20px 24px",
    borderRadius: "18px",
  },
  heroContent: { display: "flex", alignItems: "center", gap: 14 },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 14,
    objectFit: "cover",
  },
  heroTitle: { fontSize: 26, fontWeight: 700, margin: 0 },

  scrollArea: {
    marginTop: 16,
    overflowY: "auto",
    overflowX: "hidden",
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    paddingBottom: 20,
  },

  mainHeading: { fontSize: 22, marginBottom: 24, marginTop: 0, flexShrink: 0, fontWeight: 600, color: "#1e293b" },
  sectionHeading: { fontSize: 20, marginBottom: 8, marginTop: 0, flexShrink: 0, fontWeight: 600 },
  sectionDescription: { fontSize: 15, color: "#555", marginBottom: 18, flexShrink: 0, marginTop: 0 },
  contentSection: { marginBottom: 20, flexShrink: 0 },

  actionList: { display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 },
  actionButton: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 20px",
    borderRadius: 14,
    border: "1px solid #ececec",
    cursor: "pointer",
    background: "#fff",
    transition: "all .2s",
    flexShrink: 0,
    fontSize: 15,
    fontWeight: 500,
  },
  actionButtonActive: {
    background: "linear-gradient(90deg, #f6f3ff, #fdf6ff)",
    borderColor: "#d1b7ff",
  },

  actionIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 10,
    background: "#f5f6fb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  contextSection: { marginTop: 18, flexShrink: 0, display: "flex", flexDirection: "column" },
  contextCard: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginBottom: 16,
    flexShrink: 0,
  },
  pageCard: {
    padding: "14px 18px",
    borderRadius: 14,
    border: "1px solid #e0e0e0",
    background: "#f9fafb",
    flexShrink: 0,
  },
  pageTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 6,
    color: "#333",
    marginTop: 0,
  },
  pageSummary: {
    fontSize: 13,
    color: "#666",
    lineHeight: 1.4,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },

  textareaLabel: { fontSize: 15, marginBottom: 10, display: "block", flexShrink: 0, marginTop: 0, fontWeight: 500 },
  textarea: {
    width: "100%",
    height: 110,
    minHeight: 110,
    maxHeight: 110,
    padding: 14,
    borderRadius: 14,
    border: "1px solid #ddd",
    background: "#f8f9ff",
    resize: "none",
    flexShrink: 0,
    fontFamily: "inherit",
    fontSize: 15,
    boxSizing: "border-box",
  },
  textareaFooter: {
    marginTop: 12,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0,
    fontSize: 14,
  },

  generateButton: {
    padding: "12px 24px",
    borderRadius: 14,
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 15,
    fontWeight: 600,
  },
  generateButtonActive: {
    background: "linear-gradient(90deg, #7C3AED, #EC4899)",
    color: "#fff",
  },
  generateButtonDisabled: {
    background: "#ddd",
    cursor: "not-allowed",
    color: "#777",
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  modal: {
    width: 500,
    maxWidth: "90vw",
    background: "#fff",
    padding: 28,
    borderRadius: 16,
    boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
  },
  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 24,
  },
  modalIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: "#f5f3ff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#1e293b",
    margin: 0,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#64748b",
    margin: 0,
  },
  modalForm: {
    marginBottom: 24,
  },
  formRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    marginBottom: 16,
  },
  formField: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: 500,
    color: "#334155",
  },
  formSelect: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#fff",
    fontSize: 14,
    color: "#1e293b",
    cursor: "pointer",
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 6L11 1' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 12px center",
    paddingRight: 36,
  },
  formCheckboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  formCheckbox: {
    width: 18,
    height: 18,
    cursor: "pointer",
    accentColor: "#7C3AED",
  },
  formCheckboxLabel: {
    fontSize: 14,
    color: "#334155",
    cursor: "pointer",
    userSelect: "none",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    paddingTop: 20,
    borderTop: "1px solid #e2e8f0",
  },
  modalCancelButton: {
    padding: "10px 20px",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    color: "#64748b",
    transition: "all 0.2s",
  },
  modalGenerateButton: {
    padding: "10px 20px",
    background: "linear-gradient(90deg, #7C3AED, #EC4899)",
    color: "#fff",
    borderRadius: 10,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    border: "none",
    display: "flex",
    alignItems: "center",
    gap: 6,
    transition: "all 0.2s",
  },
};
