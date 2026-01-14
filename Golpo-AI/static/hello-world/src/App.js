import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, view, getContext, requestConfluence } from "@forge/bridge";
import golpoIcon from "./static/GOLPO_ICON_1.png";
import SparklesIcon from "./components/SparklesIcon";

const APP_TITLE = "Golpo AI";
const APP_TAGLINE = "Generate engaging videos from your Confluence page";

// TEMP (testing): override credits returned from backend.
// Set to a number (e.g. 0) to force the low-credits popup; keep null to use real credits.
const FORCE_TEST_CREDITS = null;

const quickActions = ["Whiteboard explainer video of Confluence page"];
const durationOptions = [
  { label: "15 sec", minutes: 0.25 },
  { label: "30 sec", minutes: 0.5 },
  { label: "1 min", minutes: 1 },
  { label: "2 min", minutes: 2 },
  { label: "4 min", minutes: 4 },
];
const languageOptions = [
  "English",
  "Hindi",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Russian",
  "Japanese",
  "Korean",
  "Chinese",
  "Mandarin",
  "Arabic",
  "Dutch",
  "Polish",
  "Turkish",
  "Swedish",
  "Danish",
  "Norwegian",
  "Finnish",
  "Greek",
  "Czech",
  "Hungarian",
  "Romanian",
  "Thai",
  "Vietnamese",
  "Indonesian",
  "Malay",
  "Tamil",
  "Telugu",
  "Bengali",
  "Marathi",
  "Gujarati",
  "Kannada",
  "Malayalam",
  "Punjabi",
  "Urdu",
];
// Polling too frequently causes excessive re-renders in the Confluence iframe.
// Keep this comfortably slow; backend polling continues separately.
const VIDEO_STATUS_POLL_INTERVAL = 12000; // ms

// Helper to strip HTML/markup for summaries
const stripMarkup = (html) => {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
};

// Helper to extract text from ADF (Atlas Document Format)
const extractTextFromADF = (adf) => {
  if (!adf) return "";
  if (typeof adf === "string") {
    try {
      const parsed = JSON.parse(adf);
      return extractTextFromADFNode(parsed);
    } catch (e) {
      return adf;
    }
  }
  if (typeof adf === "object") {
    return extractTextFromADFNode(adf);
  }
  return "";
};

// Helper to recursively extract text from ADF nodes
const extractTextFromADFNode = (node) => {
  if (!node) return "";
  let text = "";

  if (node.type === "text" && node.text) {
    text += node.text;
  }

  if (node.content && Array.isArray(node.content)) {
    node.content.forEach((child) => {
      text += extractTextFromADFNode(child);
    });
  }

  // Add line breaks for paragraphs and headings
  if (node.type === "paragraph" || node.type === "heading") {
    text += "\n";
  }

  return text;
};

// Helper to extract body content from page
const extractPageBodyContent = (pageBody) => {
  if (!pageBody) return "";

  // Try storage format first
  if (pageBody.body?.storage?.value) {
    return stripMarkup(pageBody.body.storage.value);
  }

  // Try atlas_doc_format
  if (pageBody.body?.atlas_doc_format?.value) {
    const adfValue = pageBody.body.atlas_doc_format.value;
    return extractTextFromADF(adfValue);
  }

  // Try body directly
  if (pageBody.body) {
    if (typeof pageBody.body === "string") {
      return stripMarkup(pageBody.body);
    }
    if (pageBody.body.value) {
      return extractTextFromADF(pageBody.body.value);
    }
  }

  return "";
};

// Helper to extract comment body content
const extractCommentBodyContent = (comment) => {
  if (!comment || !comment.body) return "";

  // Try storage format
  if (comment.body.storage?.value) {
    return stripMarkup(comment.body.storage.value);
  }

  // Try atlas_doc_format
  if (comment.body.atlas_doc_format?.value) {
    return extractTextFromADF(comment.body.atlas_doc_format.value);
  }

  // Try plain text
  if (typeof comment.body === "string") {
    return stripMarkup(comment.body);
  }

  return "";
};

// Helper to extract author name from comment
const extractCommentAuthor = (comment) => {
  if (!comment) return "Unknown";

  // Try various author field paths
  const authorPaths = [
    comment.author?.displayName,
    comment.author?.name,
    comment.author?.username,
    comment.author?.publicName,
    comment.author?.userKey,
    comment.authorId,
    comment.creator?.displayName,
    comment.creator?.name,
    comment.creator?.username,
    comment.createdBy?.displayName,
    comment.createdBy?.name,
  ];

  for (const authorName of authorPaths) {
    if (authorName && typeof authorName === "string" && authorName.trim() !== "") {
      return authorName.trim();
    }
  }

  return "Unknown";
};

// Helper to create a document for Golpo AI API
const createGolpoAIDocument = (pageBody, footerComments) => {
  const pageTitle = pageBody?.title || "Untitled Page";
  const pageContent = extractPageBodyContent(pageBody);

  // Build comments section with detailed information
  let commentsSection = "";
  if (footerComments && footerComments.length > 0) {
    commentsSection = "\n\n--- FOOTER COMMENTS ---\n\n";
    footerComments.forEach((comment, index) => {
      const commentText = extractCommentBodyContent(comment);
      const author = extractCommentAuthor(comment);
      const date = comment.createdAt ? new Date(comment.createdAt).toLocaleString() : "";

      commentsSection += `Comment ${index + 1} (by ${author}${date ? ` on ${date}` : ""}):\n`;
      commentsSection += commentText + "\n\n";
    });
  }

  // Create the document object with enhanced comment information
  const document = {
    title: pageTitle,
    pageId: pageBody?.id || "",
    content: pageContent,
    comments: footerComments?.map((comment, index) => {
      const commentText = extractCommentBodyContent(comment);
      const author = extractCommentAuthor(comment);

      return {
        id: comment.id || `comment-${index}`,
        author: author,
        authorId: comment.authorId || comment.author?.accountId || "",
        authorDetails: {
          displayName: comment.author?.displayName || author,
          name: comment.author?.name,
          username: comment.author?.username,
          accountId: comment.author?.accountId || comment.authorId,
        },
        createdAt: comment.createdAt || "",
        body: commentText,
        rawBody: comment.body, // Keep raw body for reference
      };
    }) || [],
    fullText: `TITLE: ${pageTitle}\n\nCONTENT:\n${pageContent}${commentsSection}`,
    metadata: {
      pageId: pageBody?.id || "",
      spaceId: pageBody?.spaceId || "",
      version: pageBody?.version?.number || 1,
      createdAt: pageBody?.createdAt || "",
      commentCount: footerComments?.length || 0,
    },
  };

  return document;
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
    const search = window.location.search;
    console.log("[GolpoAI] Attempting to extract page ID from URL:", { url, pathname, search });

    // Try various URL patterns
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
    match = url.match(/\/wiki\/spaces\/[^\/]+\/pages\/(\d+)/);
    if (match) {
      console.log("[GolpoAI] Found page ID from URL pattern 4:", match[1]);
      return match[1];
    }

    // Try pathname
    const pathMatch = pathname.match(/\/pages\/(\d+)/);
    if (pathMatch) {
      console.log("[GolpoAI] Found page ID from pathname:", pathMatch[1]);
      return pathMatch[1];
    }

    // Try search params
    if (search) {
      const searchParams = new URLSearchParams(search);
      const pageIdParam = searchParams.get("pageId") || searchParams.get("contentId");
      if (pageIdParam) {
        console.log("[GolpoAI] Found page ID from search params:", pageIdParam);
        return pageIdParam;
      }
    }

    // Try hash
    if (window.location.hash) {
      const hashMatch = window.location.hash.match(/pageId=(\d+)/);
      if (hashMatch) {
        console.log("[GolpoAI] Found page ID from hash:", hashMatch[1]);
        return hashMatch[1];
      }
    }

    // Try parent window if in iframe (more thorough)
    // Note: This will fail with cross-origin errors in iframe contexts, which is expected
    try {
      if (window.parent && window.parent !== window) {
        try {
          const parentUrl = window.parent.location.href;
          const parentPathname = window.parent.location.pathname;
          const parentSearch = window.parent.location.search;
          console.log("[GolpoAI] Trying parent window URL:", { parentUrl, parentPathname, parentSearch });

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
          if (parentSearch) {
            const parentParams = new URLSearchParams(parentSearch);
            const parentPageId = parentParams.get("pageId") || parentParams.get("contentId");
            if (parentPageId) {
              console.log("[GolpoAI] Found page ID from parent search params:", parentPageId);
              return parentPageId;
            }
          }
        } catch (locationErr) {
          // Cross-origin error is expected in iframe contexts - silently continue
          if (locationErr.message && locationErr.message.includes("cross-origin")) {
            // Expected in iframe contexts, don't log as error
          } else {
            console.log("[GolpoAI] Cannot access parent location:", locationErr.message);
          }
        }

        // Try parent document
        try {
          const parentDoc = window.parent.document;
          if (parentDoc) {
            const parentBody = parentDoc.body;
            if (parentBody) {
              const parentDataId = parentBody.getAttribute("data-content-id") ||
                parentBody.getAttribute("data-page-id") ||
                parentBody.getAttribute("data-contentid");
              if (parentDataId) {
                console.log("[GolpoAI] Found page ID from parent document body:", parentDataId);
                return parentDataId;
              }
            }
          }
        } catch (docErr) {
          // Cross-origin error is expected in iframe contexts - silently continue
          if (docErr.message && docErr.message.includes("cross-origin")) {
            // Expected in iframe contexts, don't log as error
          } else {
            console.log("[GolpoAI] Cannot access parent document:", docErr.message);
          }
        }
      }
    } catch (parentErr) {
      // Cross-origin error is expected in iframe contexts - silently continue
      if (parentErr.message && parentErr.message.includes("cross-origin")) {
        // Expected in iframe contexts, don't log as error
      } else {
        console.log("[GolpoAI] Cannot access parent window:", parentErr.message);
      }
    }

    // Try meta tags or data attributes (more thorough)
    try {
      // Try multiple meta tag selectors
      const metaSelectors = [
        'meta[name="ajs-content-id"]',
        'meta[property="ajs-content-id"]',
        'meta[name="content-id"]',
        'meta[property="content-id"]',
        'meta[name="page-id"]',
        'meta[property="page-id"]'
      ];

      for (const selector of metaSelectors) {
        const metaPageId = document.querySelector(selector);
        if (metaPageId) {
          const pageId = metaPageId.getAttribute("content");
          if (pageId) {
            console.log("[GolpoAI] Found page ID from meta tag:", pageId);
            return pageId;
          }
        }
      }

      // Try body data attributes
      const body = document.body;
      if (body) {
        const dataPageId =
          body.getAttribute("data-content-id") ||
          body.getAttribute("data-page-id") ||
          body.getAttribute("data-contentid") ||
          body.getAttribute("data-pageid");
        if (dataPageId) {
          console.log("[GolpoAI] Found page ID from data attribute:", dataPageId);
          return dataPageId;
        }
      }

      // Try document element
      const html = document.documentElement;
      if (html) {
        const htmlDataId = html.getAttribute("data-content-id") ||
          html.getAttribute("data-page-id");
        if (htmlDataId) {
          console.log("[GolpoAI] Found page ID from html element:", htmlDataId);
          return htmlDataId;
        }
      }

      // Try window globals
      if (window.__ATL_PAGE_ID__) {
        console.log("[GolpoAI] Found page ID from __ATL_PAGE_ID__:", window.__ATL_PAGE_ID__);
        return String(window.__ATL_PAGE_ID__);
      }
      if (window.AJS && window.AJS.params && window.AJS.params.contentId) {
        console.log("[GolpoAI] Found page ID from AJS.params:", window.AJS.params.contentId);
        return String(window.AJS.params.contentId);
      }
      if (window.confluence && window.confluence.contentId) {
        console.log("[GolpoAI] Found page ID from window.confluence:", window.confluence.contentId);
        return String(window.confluence.contentId);
      }

      // Try to find in script tags or JSON-LD
      const scripts = document.querySelectorAll('script[type="application/json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          if (data.contentId || data.pageId || data.id) {
            const foundId = data.contentId || data.pageId || data.id;
            console.log("[GolpoAI] Found page ID from JSON script:", foundId);
            return String(foundId);
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    } catch (metaErr) {
      console.log("[GolpoAI] Could not get page ID from meta/data:", metaErr.message);
    }

    // Only log as debug, not warning - this is a normal fallback scenario
    console.log("[GolpoAI] Could not extract page ID from URL or document - will try other methods");
  } catch (e) {
    // Only log as debug, not warning - this is expected in some contexts
    console.log("[GolpoAI] Error extracting page ID from URL (non-critical):", e.message);
  }
  return null;
};

// Helper to extract page ID from context
const extractPageIdFromContext = (context) => {
  if (!context) {
    console.log("[GolpoAI] extractPageIdFromContext: context is null/undefined");
    return null;
  }

  console.log("[GolpoAI] extractPageIdFromContext: Full context object:", JSON.stringify(context, null, 2));

  // Try various paths in the context object (more comprehensive)
  const possiblePaths = [
    context.content?.id,
    context.extension?.content?.id,
    context.contentId,
    context.pageId,
    context.page?.id,
    context.id,
    context.content?.contentId,
    context.extension?.content?.contentId,
    context.extension?.contentId,
    context.content?.pageId,
    context.extension?.pageId,
    // Try nested structures
    context?.extension?.content?.id,
    context?.content?.id,
    // Try array access
    context?.content?.[0]?.id,
    context?.extension?.content?.[0]?.id,
  ];

  for (const pageId of possiblePaths) {
    if (pageId && pageId !== "unknown" && pageId !== "current" && String(pageId).trim() !== "") {
      console.log("[GolpoAI] extractPageIdFromContext: Found page ID", pageId);
      return String(pageId);
    }
  }

  // Try to find ID in nested objects recursively (limited depth)
  const findIdRecursively = (obj, depth = 0, maxDepth = 3) => {
    if (depth > maxDepth || !obj || typeof obj !== 'object') return null;

    // Check common ID field names
    const idFields = ['id', 'contentId', 'pageId', 'content-id', 'page-id'];
    for (const field of idFields) {
      if (obj[field] && obj[field] !== "unknown" && obj[field] !== "current") {
        const foundId = String(obj[field]).trim();
        if (foundId) {
          console.log("[GolpoAI] extractPageIdFromContext: Found page ID recursively", foundId);
          return foundId;
        }
      }
    }

    // Recursively search in nested objects
    for (const key in obj) {
      if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
        const found = findIdRecursively(obj[key], depth + 1, maxDepth);
        if (found) return found;
      }
    }

    return null;
  };

  const recursiveId = findIdRecursively(context);
  if (recursiveId) {
    return recursiveId;
  }

  console.warn("[GolpoAI] extractPageIdFromContext: No page ID found in context");
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

const base64ToBlob = (base64, contentType = "application/octet-stream") => {
  const byteCharacters = atob(base64);
  const byteArrays = [];
  const sliceSize = 1024;

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i += 1) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays, { type: contentType });
};

// Helper to escape HTML for safe embedding
const escapeHtml = (text) => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

// Helper to escape JavaScript string for onclick handlers
const escapeJsString = (str) => {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
};

const QuickActionIcon = () => (
  <span style={styles.actionIconWrapper}>
    <svg width="18" height="18" viewBox="0 0 36 36" fill="none">
      <rect x="4" y="9" width="20" height="18" rx="6" stroke="#FF4D6D" strokeWidth="3" />
      <path
        d="M24 16.5L31 12V24L24 19.5"
        stroke="#FF4D6D"
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
  const [duration, setDuration] = useState(durationOptions[1].minutes.toString());
  const [voice, setVoice] = useState("Solo Female");
  const [language, setLanguage] = useState("English");
  const [useColor, setUseColor] = useState(false);
  const [music, setMusic] = useState("engaging");
  const [style, setStyle] = useState("");
  const [useIframeForVideo, setUseIframeForVideo] = useState(false);
  const selectedDurationOption = useMemo(
    () => durationOptions.find((option) => option.minutes.toString() === duration) ?? durationOptions[1],
    [duration]
  );

  // Detect if we're in contentBylineItem (no resolver available)
  const [isBylineItem, setIsBylineItem] = useState(false);

  // Your logic preserved 👇
  const [pages, setPages] = useState([]);
  const [documentPayload, setDocumentPayload] = useState(null);
  const [footerComments, setFooterComments] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [durationWarning, setDurationWarning] = useState(null);
  const [golpoAIDocument, setGolpoAIDocument] = useState(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoGenerationResult, setVideoGenerationResult] = useState(null);
  const [isPollingVideoStatus, setIsPollingVideoStatus] = useState(false);
  const [videoJobId, setVideoJobId] = useState(null);
  const [videoStatusMessage, setVideoStatusMessage] = useState("");
  const [videoReadyInfo, setVideoReadyInfo] = useState(null);
  const [currentPageId, setCurrentPageId] = useState(null);
  const [showVideoCompletionModal, setShowVideoCompletionModal] = useState(false);
  const [completedVideoUrl, setCompletedVideoUrl] = useState(null);
  const [copyUrlMessage, setCopyUrlMessage] = useState("");
  const [videoPlayerUrl, setVideoPlayerUrl] = useState(null);
  const [latestVideoUrl, setLatestVideoUrl] = useState(null);
  const [allVideoUrls, setAllVideoUrls] = useState([]); // Array to store all video URLs
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0); // Index of currently displayed video
  const [showVideoExistsModal, setShowVideoExistsModal] = useState(false);
  const [videoOrientation, setVideoOrientation] = useState("portrait"); // "landscape" or "portrait"
  const [isLoadingVideo, setIsLoadingVideo] = useState(false); // Loading state for "Go to Video" button
  
  // API Key Configuration State - Removed (using admin API key from global page)
  const [isVideoTooLarge, setIsVideoTooLarge] = useState(false); // Track if video is too large to play in modal
  const [currentUser, setCurrentUser] = useState(null); // Current Confluence user info for attribution
  const [showVideoPlayerModal, setShowVideoPlayerModal] = useState(false); // Whether to show video player modal

  // Low credits warning modal (does NOT change backend credit logic; only warns before starting generation)
  const [showLowCreditsModal, setShowLowCreditsModal] = useState(false);
  const [lowCreditsInfo, setLowCreditsInfo] = useState({
    currentCredits: null,
    requiredCredits: null,
    breakdown: "",
  });

  const maxChars = 500;

  // COMMENTED OUT: Duration warning code - no longer needed
  // Calculate minimum required duration based on document length
  // Typical video narration: ~150-200 words per minute
  // Average word length: ~5 characters, so ~750-1000 characters per minute
  // const calculateMinimumDuration = useCallback((documentText) => {
  //   if (!documentText || documentText.trim() === '') return 0;
  //   
  //   // Estimate words (rough approximation: split by spaces)
  //   const wordCount = documentText.trim().split(/\s+/).length;
  //   
  //   // Use conservative estimate: 150 words per minute
  //   const wordsPerMinute = 150;
  //   const minimumMinutes = Math.ceil(wordCount / wordsPerMinute);
  //   
  //   return minimumMinutes;
  // }, []);

  // COMMENTED OUT: Check if selected duration is sufficient and show warning
  // const validateDuration = useCallback(() => {
  //   if (!golpoAIDocument) {
  //     setDurationWarning(null);
  //     return true;
  //   }

  //   const documentText = golpoAIDocument?.fullText || golpoAIDocument?.content || '';
  //   const minimumDuration = calculateMinimumDuration(documentText);
  //   const selectedMinutes = selectedDurationOption.minutes;

  //   if (minimumDuration > 0 && selectedMinutes < minimumDuration) {
  //     // Find suitable duration options from dropdown
  //     const suitableOptions = durationOptions.filter(opt => opt.minutes >= minimumDuration);
  //     const suggestedDurations = suitableOptions.length > 0 
  //       ? suitableOptions.map(opt => opt.label).join(', ')
  //       : durationOptions[durationOptions.length - 1].label; // Fallback to longest option
  //     const warningMessage = `The selected duration (${selectedDurationOption.label}) may be too short for the document content. Estimated minimum duration: ${minimumDuration} minute${minimumDuration !== 1 ? 's' : ''}. Suggested duration${suitableOptions.length > 1 ? 's' : ''}: ${suggestedDurations}`;
  //     
  //     setDurationWarning({
  //       type: 'warning',
  //       message: warningMessage,
  //       minimumDuration,
  //       suggestedDurations: suitableOptions.length > 0 ? suitableOptions : [durationOptions[durationOptions.length - 1]]
  //     });
  //     return false;
  //   } else {
  //     setDurationWarning(null);
  //     return true;
  //   }
  // }, [golpoAIDocument, selectedDurationOption, calculateMinimumDuration]);

  // COMMENTED OUT: Validate duration when it changes or document is loaded
  // useEffect(() => {
  //   if (golpoAIDocument) {
  //     validateDuration();
  //   }
  // }, [duration, golpoAIDocument, validateDuration]);
  const videoStatusTimerRef = useRef(null);
  const previousLatestUrlRef = useRef(null);
  const completionCheckIntervalRef = useRef(null);
  const videoGenerationStartRef = useRef(null); // Timestamp when generation started
  const videoObjectUrlRef = useRef(null);
  const videoElementRef = useRef(null);
  const fullscreenVideoRef = useRef(null);
  // Prevent overlapping polls + reduce re-renders from setting identical status text
  const pollInFlightRef = useRef(false);
  const lastStatusTextRef = useRef("");
  const [showVideoFailureModal, setShowVideoFailureModal] = useState(false);
  const [videoFailureMessage, setVideoFailureMessage] = useState("");
  const [isFullscreenVideo, setIsFullscreenVideo] = useState(false);

  // Fetch current Confluence user info for attribution (runs as the user via bridge)
  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        console.log("[GolpoAI] Fetching current user info via requestConfluence...");
        // Prefer REST API v1 current user endpoint
        const response = await requestConfluence("/wiki/rest/api/user/current", {
          headers: { Accept: "application/json" },
        });
        if (!response || !response.ok) {
          console.warn("[GolpoAI] Failed to fetch current user via /wiki/rest/api/user/current. Status:", response?.status);
          return;
        }
        const me = await response.json();
        const normalized = {
          accountId: me.accountId || me.userKey || me.key || null,
          displayName: me.displayName || me.publicName || me.name || null,
          publicName: me.publicName || me.displayName || null,
          name: me.name || me.displayName || null,
          username: me.username || null,
          email: me.email || me.emailAddress || null,
        };
        console.log("[GolpoAI] Current user info captured:", normalized);
        setCurrentUser(normalized);
      } catch (err) {
        console.warn("[GolpoAI] Error fetching current user info via requestConfluence:", err);
      }
    };
    fetchCurrentUser();
  }, []);

  // Fetch user's API key on component mount
  // API key configuration removed - using admin API key from global page
  
  // Function to clear the completion check interval
  const clearCompletionCheckInterval = useCallback(() => {
    if (completionCheckIntervalRef.current) {
      clearInterval(completionCheckIntervalRef.current);
      completionCheckIntervalRef.current = null;
    }
  }, []);
  
  // Track if user manually dismissed the modal in current session
  const modalDismissedRef = useRef(false);
  const isClosingModalRef = useRef(false); // Prevent multiple rapid clicks
  const cleanupVideoObjectUrl = useCallback(() => {
    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current);
      videoObjectUrlRef.current = null;
    }
    setVideoPlayerUrl(null);
  }, []);

  const copyUrlToClipboardFallback = useCallback((url, download = false, customMessage = null) => {
    const message = customMessage || (download 
      ? "Video URL copied to clipboard. Paste in your browser address bar to download."
      : "Video URL copied to clipboard. Paste in a new tab to open the video.");
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setCopyUrlMessage(message);
        setTimeout(() => setCopyUrlMessage(""), 7000);
      }).catch(() => {
        // Fallback for browsers without clipboard API
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          setCopyUrlMessage(message);
          setTimeout(() => setCopyUrlMessage(""), 7000);
        } catch (err) {
          setCopyUrlMessage(`Please copy this URL: ${url}`);
          setTimeout(() => setCopyUrlMessage(""), 10000);
        }
        document.body.removeChild(textArea);
      });
    } else {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = url;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        setCopyUrlMessage(message);
        setTimeout(() => setCopyUrlMessage(""), 7000);
      } catch (err) {
        setCopyUrlMessage(`Please copy this URL: ${url}`);
        setTimeout(() => setCopyUrlMessage(""), 10000);
      }
      document.body.removeChild(textArea);
    }
  }, []);

  // Chunked download/play function - downloads video in chunks to bypass Forge's 5MB limit
  // Dynamically calculates optimal chunk size to handle any file size safely
  // Accounts for base64 encoding overhead (~33% increase) to stay under 5MB limit
  // Chunked download function - downloads video in chunks to bypass Forge's 5MB limit
  // Dynamically calculates optimal chunk size to handle any file size safely
  // Accounts for base64 encoding overhead (~33% increase) to stay under 5MB limit
  const downloadVideoInChunks = useCallback(async (videoUrl, contentType = 'video/mp4', forPlayback = false, jobId = null) => {
    // Forge's GraphQL response limit: 5,242,880 bytes (5MB)
    const FORGE_RESPONSE_LIMIT = 5 * 1024 * 1024; // 5,242,880 bytes
   
    // Base64 encoding increases size by ~33% (4/3 ratio)
    // Calculate maximum safe raw chunk size: limit / (4/3) = limit * 0.75
    // Using 0.73 (slightly more conservative) for safety margin
    const MAX_RAW_CHUNK_SIZE = Math.floor(FORGE_RESPONSE_LIMIT * 0.73);
   
    // For HTTP Range streaming (playback), use smaller chunks for faster initial load
    // For downloads, use larger chunks for efficiency
    const CHUNK_SIZE = forPlayback 
      ? Math.min(1 * 1024 * 1024, MAX_RAW_CHUNK_SIZE) // 1MB chunks for streaming (faster start)
      : MAX_RAW_CHUNK_SIZE; // 3.65MB chunks for downloads (more efficient)
   
    console.log(`[GolpoAI] Using HTTP Range streaming with chunk size: ${(CHUNK_SIZE / (1024 * 1024)).toFixed(2)}MB (${CHUNK_SIZE} bytes) for ${forPlayback ? 'playback' : 'download'}`);
   
    const chunks = [];
    let totalSize = null;
    let currentByte = 0;

    if (forPlayback) {
      setIsLoadingVideo(true);
      setCopyUrlMessage('Preparing video...');
    } else {
      setCopyUrlMessage('Preparing download...');
    }

    // First, get the file size by fetching the first chunk
    try {
      const firstChunkResponse = await invoke('fetchVideoChunk', {
        videoUrl,
        startByte: 0,
        endByte: CHUNK_SIZE - 1,
      });

      if (firstChunkResponse?.error || firstChunkResponse?.status >= 400) {
        throw new Error(firstChunkResponse?.error || `Failed to fetch first chunk: ${firstChunkResponse?.status}`);
      }

      if (!firstChunkResponse?.base64Data) {
        throw new Error('First chunk missing data');
      }

      totalSize = firstChunkResponse.totalSize;
      chunks.push(base64ToBlob(firstChunkResponse.base64Data, contentType));
      currentByte = firstChunkResponse.chunkSize;

      console.log(`File size: ${totalSize || 'unknown'} bytes, downloaded: ${currentByte} bytes`);
      
      // For playback, ALWAYS use MediaSource API with HTTP Range streaming
      // This provides true progressive streaming - video plays as it downloads
      // Uses fetchVideoChunk (HTTP Range requests) to stream chunks progressively
      const useMediaSource = forPlayback && window.MediaSource;
      
      if (useMediaSource) {
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        console.log(`[GolpoAI] ========== MediaSource Streaming START ==========`);
        console.log(`[GolpoAI] Using HTTP Range streaming with MediaSource API for video playback (${sizeMB}MB)`);
        console.log(`[GolpoAI] Total size: ${totalSize} bytes, Chunk size: ${CHUNK_SIZE} bytes`);
        console.log(`[GolpoAI] Estimated chunks: ${Math.ceil(totalSize / CHUNK_SIZE)}`);
        
        try {
          // Use MediaSource API - proxy (fetchVideoChunk) fetches from S3, we stream chunks progressively
          console.log("[GolpoAI] Creating MediaSource instance...");
          const mediaSource = new MediaSource();
          const blobUrl = URL.createObjectURL(mediaSource);
          console.log("[GolpoAI] MediaSource created, blob URL:", blobUrl);
          console.log("[GolpoAI] MediaSource initial readyState:", mediaSource.readyState);
          
          // Set blob URL early so video element can start loading
          videoObjectUrlRef.current = blobUrl;
          console.log("[GolpoAI] Setting videoPlayerUrl via safe setter...");
          setVideoPlayerUrlSafe(blobUrl); // Use safe setter
          setIsLoadingVideo(false);
          setCopyUrlMessage('Streaming video...');
          console.log("[GolpoAI] Blob URL set, waiting for sourceopen event...");
          
          mediaSource.addEventListener('sourceopen', async () => {
            try {
              console.log('[GolpoAI] ========== MediaSource sourceopen EVENT ==========');
              console.log('[GolpoAI] MediaSource sourceopen event fired, readyState:', mediaSource.readyState);
              console.log('[GolpoAI] SourceBuffers length:', mediaSource.sourceBuffers.length);
              
              // Verify MediaSource is open
              if (mediaSource.readyState !== 'open') {
                console.error(`[GolpoAI] ❌ MediaSource readyState is not 'open': ${mediaSource.readyState}`);
                throw new Error(`MediaSource readyState is not 'open': ${mediaSource.readyState}`);
              }
              
              console.log('[GolpoAI] MediaSource is open, trying to add SourceBuffer...');
              
              // Try common MP4 codecs
              let sourceBuffer;
              const codecs = [
                'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
                'video/mp4; codecs="avc1.4D001E, mp4a.40.2"',
                'video/mp4; codecs="avc1.64001E, mp4a.40.2"',
                'video/mp4'
              ];
              
              for (const codec of codecs) {
                try {
                  console.log(`[GolpoAI] Attempting to add SourceBuffer with codec: ${codec}`);
                  sourceBuffer = mediaSource.addSourceBuffer(codec);
                  console.log(`[GolpoAI] ✅ SourceBuffer created successfully with codec: ${codec}`);
                  console.log(`[GolpoAI] SourceBuffer mode: ${sourceBuffer.mode}`);
                  console.log(`[GolpoAI] SourceBuffer updating: ${sourceBuffer.updating}`);
                  break;
                } catch (e) {
                  console.warn(`[GolpoAI] Codec ${codec} not supported, trying next...`, e.message);
                }
              }
              
              if (!sourceBuffer) {
                console.error('[GolpoAI] ❌ No supported codec found for MediaSource');
                throw new Error('No supported codec found');
              }
              
              console.log('[GolpoAI] SourceBuffer ready, preparing to append first chunk...');
              
              // Helper to wait for source buffer to be ready
              const waitForBuffer = () => {
                return new Promise(resolve => {
                  if (!sourceBuffer.updating) {
                    resolve();
                  } else {
                    sourceBuffer.addEventListener('updateend', resolve, { once: true });
                  }
                });
              };
              
              // Add first chunk from proxy
              console.log('[GolpoAI] Waiting for SourceBuffer to be ready for first chunk...');
              await waitForBuffer();
              console.log('[GolpoAI] SourceBuffer ready, converting first chunk to ArrayBuffer...');
              const firstBlob = base64ToBlob(firstChunkResponse.base64Data, contentType);
              const firstArrayBuffer = await firstBlob.arrayBuffer();
              console.log(`[GolpoAI] First chunk ArrayBuffer size: ${firstArrayBuffer.byteLength} bytes`);
              console.log('[GolpoAI] Appending first chunk to SourceBuffer...');
              sourceBuffer.appendBuffer(firstArrayBuffer);
              console.log('[GolpoAI] ✅ First chunk appended, SourceBuffer updating:', sourceBuffer.updating);
              
              // HTTP Range streaming: Fetch chunks progressively using Range requests
              // Video plays as chunks are downloaded (true progressive streaming)
              (async () => {
                try {
                  let streamByte = currentByte;
                  const prefetchAhead = 2; // Prefetch 2 chunks ahead for smoother playback
                  let nextChunkPromise = null;
                  let consecutiveFailures = 0;
                  const MAX_CONSECUTIVE_FAILURES = 3;
                  
                  while (streamByte < totalSize) {
                    try {
                      // Wait for buffer to be ready
                      await waitForBuffer();
                      
                      // Check if MediaSource is still open
                      if (mediaSource.readyState !== 'open') {
                        console.warn(`[GolpoAI] MediaSource readyState changed to '${mediaSource.readyState}', stopping stream`);
                        break;
                      }
                      
                      // If we have a prefetched chunk, use it
                      if (nextChunkPromise) {
                        try {
                          const prefetched = await nextChunkPromise;
                          if (prefetched) {
                            await waitForBuffer();
                            if (mediaSource.readyState === 'open' && !sourceBuffer.updating) {
                              sourceBuffer.appendBuffer(prefetched.arrayBuffer);
                              streamByte = prefetched.nextByte;
                              nextChunkPromise = null;
                              consecutiveFailures = 0; // Reset failure counter on success
                              
                              // Update progress
                              const progress = Math.round((streamByte / totalSize) * 100);
                              setCopyUrlMessage(`Streaming video... ${progress}%`);
                              console.log(`[GolpoAI] Streamed to ${progress}% (${streamByte}/${totalSize} bytes)`);
                              continue;
                            }
                          }
                        } catch (prefetchError) {
                          console.warn('[GolpoAI] Prefetch error, will fetch directly:', prefetchError);
                          nextChunkPromise = null;
                        }
                      }
                      
                      // Fetch current chunk using HTTP Range request
                      const endByte = Math.min(streamByte + CHUNK_SIZE - 1, totalSize - 1);
                      console.log(`[GolpoAI] HTTP Range request: bytes=${streamByte}-${endByte} (${Math.round((streamByte / totalSize) * 100)}%)`);
                      
                      let chunkResponse;
                      try {
                        chunkResponse = await invoke('fetchVideoChunk', {
                          videoUrl,
                          startByte: streamByte,
                          endByte: endByte,
                        });
                      } catch (invokeError) {
                        consecutiveFailures++;
                        console.warn(`[GolpoAI] Chunk fetch failed (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, invokeError);
                        
                        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                          throw new Error(`Failed to fetch chunk after ${MAX_CONSECUTIVE_FAILURES} attempts`);
                        }
                        
                        // Wait a bit before retrying
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                      }
                      
                      if (chunkResponse?.error || chunkResponse?.status >= 400) {
                        consecutiveFailures++;
                        console.warn(`[GolpoAI] Chunk response error (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, chunkResponse?.error || chunkResponse?.status);
                        
                        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                          throw new Error(chunkResponse?.error || `Failed to fetch chunk: ${chunkResponse?.status}`);
                        }
                        
                        // Wait a bit before retrying
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                      }
                      
                      if (!chunkResponse?.base64Data) {
                        console.warn(`[GolpoAI] Chunk missing data at byte ${streamByte}, trying to continue...`);
                        // Try to skip this chunk and continue
                        streamByte += CHUNK_SIZE;
                        if (streamByte >= totalSize) {
                          break;
                        }
                        continue;
                      }
                      
                      // Reset failure counter on successful fetch
                      consecutiveFailures = 0;
                      
                      await waitForBuffer();
                      
                      // Double-check MediaSource is still open before appending
                      if (mediaSource.readyState !== 'open') {
                        console.warn(`[GolpoAI] ❌ MediaSource closed during streaming, stopping at ${Math.round((streamByte / totalSize) * 100)}%`);
                        console.warn(`[GolpoAI] MediaSource readyState: ${mediaSource.readyState}`);
                        break;
                      }
                      
                      console.log(`[GolpoAI] Converting chunk ${Math.round((streamByte / totalSize) * 100)}% to ArrayBuffer...`);
                      const chunkBlob = base64ToBlob(chunkResponse.base64Data, contentType);
                      const chunkArrayBuffer = await chunkBlob.arrayBuffer();
                      console.log(`[GolpoAI] Chunk ArrayBuffer size: ${chunkArrayBuffer.byteLength} bytes`);
                      
                      if (!sourceBuffer.updating) {
                        console.log(`[GolpoAI] SourceBuffer not updating, appending chunk immediately...`);
                        sourceBuffer.appendBuffer(chunkArrayBuffer);
                        streamByte += chunkResponse.chunkSize;
                        console.log(`[GolpoAI] ✅ Chunk appended, SourceBuffer updating: ${sourceBuffer.updating}`);
                      } else {
                        // Wait for buffer to finish updating
                        console.log(`[GolpoAI] SourceBuffer is updating, waiting for updateend...`);
                        await waitForBuffer();
                        console.log(`[GolpoAI] SourceBuffer ready, appending chunk...`);
                        sourceBuffer.appendBuffer(chunkArrayBuffer);
                        streamByte += chunkResponse.chunkSize;
                        console.log(`[GolpoAI] ✅ Chunk appended after wait, SourceBuffer updating: ${sourceBuffer.updating}`);
                      }
                      
                      // Prefetch next chunk(s) ahead for smoother playback
                      if (streamByte < totalSize && prefetchAhead > 0) {
                        const nextEndByte = Math.min(streamByte + CHUNK_SIZE - 1, totalSize - 1);
                        nextChunkPromise = (async () => {
                          try {
                            const nextResponse = await invoke('fetchVideoChunk', {
                              videoUrl,
                              startByte: streamByte,
                              endByte: nextEndByte,
                            });
                            if (nextResponse?.base64Data) {
                              const nextBlob = base64ToBlob(nextResponse.base64Data, contentType);
                              return {
                                arrayBuffer: await nextBlob.arrayBuffer(),
                                nextByte: streamByte + nextResponse.chunkSize
                              };
                            }
                          } catch (e) {
                            console.warn('[GolpoAI] Prefetch failed:', e);
                          }
                          return null;
                        })();
                      }
                      
                      // Update progress
                      const progress = Math.round((streamByte / totalSize) * 100);
                      setCopyUrlMessage(`Streaming video... ${progress}%`);
                      console.log(`[GolpoAI] Streamed to ${progress}% (${streamByte}/${totalSize} bytes)`);
                      
                      if (streamByte >= totalSize) {
                        break;
                      }
                    } catch (chunkError) {
                      console.error('[GolpoAI] Error processing chunk:', chunkError);
                      consecutiveFailures++;
                      
                      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                        throw chunkError;
                      }
                      
                      // Wait before retrying
                      await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                  }
                  
                  // Wait for final append to complete
                  console.log('[GolpoAI] Waiting for final chunk to be appended...');
                  await waitForBuffer();
                  console.log('[GolpoAI] Final chunk appended, checking MediaSource state...');
                  
                  // Only call endOfStream if MediaSource is still open
                  if (mediaSource.readyState === 'open') {
                    try {
                      console.log('[GolpoAI] Calling mediaSource.endOfStream()...');
                      mediaSource.endOfStream();
                      setCopyUrlMessage('');
                      console.log(`[GolpoAI] ✅ HTTP Range streaming completed - video ready to play`);
                      console.log(`[GolpoAI] Total bytes streamed: ${streamByte}/${totalSize} (${Math.round((streamByte / totalSize) * 100)}%)`);
                      console.log(`[GolpoAI] ========== MediaSource Streaming COMPLETE ==========`);
                    } catch (eofError) {
                      console.warn('[GolpoAI] ❌ Failed to end stream (MediaSource may have closed):', eofError);
                      console.warn('[GolpoAI] MediaSource readyState:', mediaSource.readyState);
                      setCopyUrlMessage('');
                    }
                  } else if (mediaSource.readyState === 'ended') {
                    // MediaSource is already ended - this is normal and expected
                    console.log(`[GolpoAI] MediaSource already ended (readyState: 'ended') - streaming completed successfully`);
                    setCopyUrlMessage('');
                  } else {
                    // MediaSource is in 'closed' state or another unexpected state
                    console.warn(`[GolpoAI] MediaSource readyState is '${mediaSource.readyState}', cannot end stream`);
                    setCopyUrlMessage('');
                  }
                } catch (streamError) {
                  console.error('[GolpoAI] HTTP Range streaming error:', streamError);
                  
                  // Only call endOfStream if MediaSource is still open
                  if (mediaSource.readyState === 'open') {
                    try {
                      mediaSource.endOfStream('network');
                    } catch (eofError) {
                      console.warn('[GolpoAI] Failed to end stream on error (MediaSource may have closed):', eofError);
                    }
                  }
                  setCopyUrlMessage('Streaming error. Video may not play completely.');
                }
              })();
              
              console.log('[GolpoAI] MediaSource streaming function completed, returning blob URL:', blobUrl);
              return blobUrl;
            } catch (initError) {
              console.error('[GolpoAI] ❌ MediaSource initialization error:', initError);
              console.error('[GolpoAI] Error stack:', initError.stack);
              
              // Only call endOfStream if MediaSource is still open
              if (mediaSource.readyState === 'open') {
                try {
                  console.log('[GolpoAI] Attempting to end stream on init error...');
                  mediaSource.endOfStream('network');
                } catch (eofError) {
                  console.warn('[GolpoAI] Failed to end stream on init error (MediaSource may have closed):', eofError);
                }
              }
              throw initError;
            }
          });
          
          console.log('[GolpoAI] MediaSource event listener attached, returning blob URL:', blobUrl);
          return blobUrl;
        } catch (mediaSourceError) {
          console.warn('[GolpoAI] ❌ MediaSource API failed, falling back to blob approach:', mediaSourceError);
          console.warn('[GolpoAI] MediaSource error details:', mediaSourceError.message, mediaSourceError.stack);
          // For playback, if MediaSource fails, download all chunks and create a blob
          // Continue to download remaining chunks
        }
      }

      // If MediaSource failed or not used, download all chunks and create a blob URL
      if (forPlayback) {
        console.log('[GolpoAI] Downloading all chunks for playback blob...');
        setCopyUrlMessage('Downloading video...');
        
        // Download remaining chunks
        while (!totalSize || currentByte < totalSize) {
          const endByte = totalSize
            ? Math.min(currentByte + CHUNK_SIZE - 1, totalSize - 1)
            : currentByte + CHUNK_SIZE - 1;

          const chunkResponse = await invoke('fetchVideoChunk', {
            videoUrl,
            startByte: currentByte,
            endByte: endByte,
          });

          if (chunkResponse?.error || chunkResponse?.status >= 400) {
            throw new Error(chunkResponse?.error || `Failed to fetch chunk: ${chunkResponse?.status}`);
          }

          if (!chunkResponse?.base64Data) {
            throw new Error('Chunk missing data');
          }

          chunks.push(base64ToBlob(chunkResponse.base64Data, contentType));
          currentByte += chunkResponse.chunkSize;

          // Update progress
          if (totalSize) {
            const progress = Math.round((currentByte / totalSize) * 100);
            setCopyUrlMessage(`Downloading video... ${progress}%`);
          }

          // If we got less data than requested, we've reached the end
          if (chunkResponse.chunkSize < CHUNK_SIZE || (totalSize && currentByte >= totalSize)) {
            break;
          }

          // Update total size if we got it from this chunk
          if (chunkResponse.totalSize && !totalSize) {
            totalSize = chunkResponse.totalSize;
          }
        }

        // Create blob URL from all chunks
        console.log('[GolpoAI] Creating blob URL from all chunks...');
        const completeBlob = new Blob(chunks, { type: contentType });
        const blobUrl = URL.createObjectURL(completeBlob);
        videoObjectUrlRef.current = blobUrl;
        
        console.log('[GolpoAI] ✅ Blob URL created from all chunks:', blobUrl);
        setIsLoadingVideo(false);
        setCopyUrlMessage("");
        setVideoPlayerUrlSafe(blobUrl);
        
        return blobUrl;
      } else {
        // For download, continue with existing logic
        try {
          const firstBlob = chunks[0];
          if (firstBlob) {
            const tempBlobUrl = URL.createObjectURL(firstBlob);
            videoObjectUrlRef.current = tempBlobUrl;
            setVideoPlayerUrlSafe(tempBlobUrl);
            setIsLoadingVideo(false);
            setCopyUrlMessage('Loading video...');
            console.log('[GolpoAI] Created temporary blob URL from first chunk for playback');
          }
        } catch (tempBlobError) {
          console.warn('[GolpoAI] Failed to create temporary blob URL:', tempBlobError);
        }
      }

      // Update progress
      if (totalSize) {
        const progress = Math.round((currentByte / totalSize) * 100);
        if (forPlayback) {
          setCopyUrlMessage(`Loading video... ${progress}%`);
        } else {
          setCopyUrlMessage(`Downloading... ${progress}%`);
        }
      } else {
        if (forPlayback) {
          setCopyUrlMessage('Loading video...');
        } else {
          setCopyUrlMessage('Downloading...');
        }
      }

      // Download remaining chunks
      while (!totalSize || currentByte < totalSize) {
        const endByte = totalSize
          ? Math.min(currentByte + CHUNK_SIZE - 1, totalSize - 1)
          : currentByte + CHUNK_SIZE - 1;

        const chunkResponse = await invoke('fetchVideoChunk', {
          videoUrl,
          startByte: currentByte,
          endByte: endByte,
        });

        if (chunkResponse?.error || chunkResponse?.status >= 400) {
          throw new Error(chunkResponse?.error || `Failed to fetch chunk: ${chunkResponse?.status}`);
        }

        if (!chunkResponse?.base64Data) {
          throw new Error('Chunk missing data');
        }

        chunks.push(base64ToBlob(chunkResponse.base64Data, contentType));
        currentByte += chunkResponse.chunkSize;

        // Update progress
        if (totalSize) {
          const progress = Math.round((currentByte / totalSize) * 100);
          if (forPlayback) {
            setCopyUrlMessage(`Loading video... ${progress}%`);
          } else {
            setCopyUrlMessage(`Downloading... ${progress}%`);
          }
        }

        // If we got less data than requested, we've reached the end
        if (chunkResponse.chunkSize < CHUNK_SIZE || (totalSize && currentByte >= totalSize)) {
          break;
        }

        // Update total size if we got it from this chunk
        if (chunkResponse.totalSize && !totalSize) {
          totalSize = chunkResponse.totalSize;
        }
      }

      // Combine all chunks into a single blob
      if (forPlayback) {
        setCopyUrlMessage('Assembling video...');
      } else {
        setCopyUrlMessage('Assembling video...');
      }
      const completeBlob = new Blob(chunks, { type: contentType });
      const blobUrl = URL.createObjectURL(completeBlob);

      if (forPlayback) {
        // For playback, set the blob URL
        console.log(`[GolpoAI] ✅ Large video chunked download complete! Setting blob URL for playback: ${blobUrl}, blob size: ${(completeBlob.size / (1024 * 1024)).toFixed(2)}MB`);
        videoObjectUrlRef.current = blobUrl;
        
        // CRITICAL: Use safe setter to ensure only blob URLs are set
        setVideoPlayerUrlSafe(blobUrl);
        setIsLoadingVideo(false);
        setCopyUrlMessage('');
        
        console.log(`[GolpoAI] ✅ Video loaded successfully: ${(completeBlob.size / (1024 * 1024)).toFixed(2)}MB, blob URL set for playback`);
        console.log(`[GolpoAI] ✅ Blob URL: ${blobUrl}`);
        console.log(`[GolpoAI] ✅ videoPlayerUrl should now be: ${blobUrl}`);
        
        // Force a small delay to ensure React state updates
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verify blob URL was set correctly
        setTimeout(() => {
          console.log(`[GolpoAI] ✅ Verification: videoPlayerUrl is now: ${videoPlayerUrl}`);
          if (videoPlayerUrl === blobUrl || (videoPlayerUrl && videoPlayerUrl.startsWith('blob:'))) {
            console.log(`[GolpoAI] ✅ Verified: videoPlayerUrl is correctly set to blob URL`);
          } else {
            console.warn(`[GolpoAI] ⚠️ Warning: videoPlayerUrl may not be set correctly. Expected: ${blobUrl}, Got: ${videoPlayerUrl}`);
          }
        }, 300);
        
        return blobUrl;
      } else {
        // For download, use friend's exact logic
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `golpo-video-${videoJobId || jobId || Date.now()}.mp4`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();

        // Cleanup
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(blobUrl);
        }, 100);

        setCopyUrlMessage('Downloaded!');
        setTimeout(() => setCopyUrlMessage(''), 2000);
        console.log(`Video download successful: ${completeBlob.size} bytes`);
        return blobUrl;
      }
    } catch (error) {
      console.error('Chunked download failed:', error);
      setIsLoadingVideo(false);
      setCopyUrlMessage('');
      throw error;
    }
  }, [invoke, videoJobId]);

  // Safe setter for videoPlayerUrl - prevents S3 URLs from being set (CSP violation)
  // Allows Media API URLs, blob URLs, and data URLs
  const setVideoPlayerUrlSafe = useCallback((urlToSet) => {
    if (!urlToSet) {
      setVideoPlayerUrl(null);
      return;
    }
    
    // NEVER allow S3 URLs - they violate CSP
    if (urlToSet.includes('s3.amazonaws.com') || urlToSet.includes('s3.us-east-2.amazonaws.com')) {
      console.error("[GolpoAI] BLOCKED: Attempted to set S3 URL to videoPlayerUrl - this would violate CSP!");
      setVideoPlayerUrl(null);
      return;
    }
    
    // Allow Media API URLs (api.media.atlassian.com) - these are CSP-compliant
    const isMediaApiUrl = urlToSet.includes('api.media.atlassian.com') || 
                          urlToSet.includes('media.atlassian.com') ||
                          urlToSet.includes('tdp-os.services.atlassian.com');
    
    // Allow blob:, data:, localhost, or Media API URLs
    if (urlToSet.startsWith('blob:') || 
        urlToSet.startsWith('data:') || 
        urlToSet.startsWith('http://localhost') || 
        urlToSet.startsWith('https://localhost') ||
        isMediaApiUrl) {
      setVideoPlayerUrl(urlToSet);
      console.log("[GolpoAI] ✅ Set video URL (Media API or blob):", urlToSet.substring(0, 100));
    } else {
      console.warn("[GolpoAI] Blocked non-allowed URL from being set to videoPlayerUrl:", urlToSet);
      setVideoPlayerUrl(null);
    }
  }, []);

  // Helper function to get video size using HEAD request or first chunk
  const getVideoSize = useCallback(async (videoUrl) => {
    try {
      // Try to get size from backend resolver (uses HEAD request or first chunk)
      const firstChunkResponse = await invoke('fetchVideoChunk', {
        videoUrl,
        startByte: 0,
        endByte: 1023, // Just get first 1KB to check headers
      });
      
      if (firstChunkResponse?.totalSize) {
        return firstChunkResponse.totalSize;
      }
      
      // Fallback: try to get from Content-Length header via backend
      // For now, return null if we can't determine size
      return null;
    } catch (error) {
      console.warn("[GolpoAI] Could not determine video size:", error);
      return null;
    }
  }, []);

  // Helper function to convert base64 to blob URL
  const base64ToBlobUrl = useCallback((base64, type = "video/mp4") => {
    const byteString = atob(base64);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < byteString.length; i++) {
      uint8Array[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([uint8Array], { type });
    return URL.createObjectURL(blob);
  }, []);

  const prepareVideoSource = useCallback(
    async (url) => {
      // Simple video playback:
      // - For SMALL videos: fetch base64 data and convert to blob URL.
      // - For LARGE videos: use HTTP Range + chunked download via downloadVideoInChunks.
      console.log("[GolpoAI] prepareVideoSource: Processing URL:", url?.substring(0, 100));
      
      cleanupVideoObjectUrl();
      setVideoOrientation("portrait"); // Reset to default, will be updated when metadata loads
      if (!url) {
        setIsLoadingVideo(false);
        setVideoPlayerUrl(null);
        return;
      }

      setIsLoadingVideo(true);
      setCopyUrlMessage("Loading video...");
      setIsVideoTooLarge(false);
      
      try {
        console.log("[GolpoAI] prepareVideoSource: Calling fetchVideoFile resolver");
        const response = await safeInvoke("fetchVideoFile", { videoUrl: url });
        
        if (response?.base64Data) {
          // SMALL video path: inline base64 → blob URL
          console.log("[GolpoAI] prepareVideoSource: Converting base64 to blob URL");
          const blobUrl = base64ToBlobUrl(response.base64Data, response.contentType || 'video/mp4');
          videoObjectUrlRef.current = blobUrl;
          
          console.log("[GolpoAI] prepareVideoSource: ✅ Blob URL created");
          setIsLoadingVideo(false);
          setCopyUrlMessage("");
          setVideoPlayerUrlSafe(blobUrl);
          console.log("[GolpoAI] prepareVideoSource: ✅ Video URL set, ready for playback");
          return;
        }

        // LARGE video path: we don't try to stream in modal (codec support is unreliable in sandbox).
        // Instead, mark as too large and rely on Copy URL / Download (which use chunked download).
        if (response?.useChunkedDownload && response?.signedUrl) {
          console.log("[GolpoAI] prepareVideoSource: Large video detected, skipping modal playback. Use Copy URL or Download.");
          setIsLoadingVideo(false);
          setIsVideoTooLarge(true);
          setCopyUrlMessage("This video is too large to play here. Use Copy URL or Download.");
          setTimeout(() => setCopyUrlMessage(""), 5000);
          return;
        }

        // Fallback: no data and no chunked info
        console.warn("[GolpoAI] prepareVideoSource: No playable data returned (no base64Data or signedUrl).");
        setIsVideoTooLarge(true);
        setIsLoadingVideo(false);
        setCopyUrlMessage("Video cannot be loaded in preview. Use Copy URL or Download.");
        setTimeout(() => setCopyUrlMessage(""), 5000);
        
      } catch (error) {
        console.error("[GolpoAI] prepareVideoSource: ❌ ERROR:", error);
        console.error("[GolpoAI] prepareVideoSource: Error message:", error.message);
        
        setVideoPlayerUrl(null);
        setIsLoadingVideo(false);
        setIsVideoTooLarge(true);
        setCopyUrlMessage("Failed to load video. Use 'Copy URL' or 'Download' buttons below.");
        setTimeout(() => setCopyUrlMessage(""), 5000);
      }
    },
    [cleanupVideoObjectUrl, safeInvoke, base64ToBlobUrl]
  );

  // CRITICAL: Final safety net - monitor videoPlayerUrl and immediately clear any S3 URLs
  // This prevents CSP violations even if something bypasses the safe setter
  useEffect(() => {
    if (videoPlayerUrl && (videoPlayerUrl.includes('s3.amazonaws.com') || videoPlayerUrl.includes('s3.us-east-2.amazonaws.com'))) {
      console.error("[GolpoAI] EMERGENCY BLOCK: videoPlayerUrl contains S3 URL! Clearing immediately to prevent CSP violation:", videoPlayerUrl);
      setVideoPlayerUrl(null);
      setIsLoadingVideo(false);
      setCopyUrlMessage("Video URL blocked for security. Using proxy method...");
      // If we have a video URL from videoReadyInfo, retry with proxy
      if (videoReadyInfo?.videoUrl) {
        const videoUrl = videoReadyInfo.videoUrl;
        console.log("[GolpoAI] Retrying with proxy resolver for:", videoUrl);
        prepareVideoSource(videoUrl).catch(err => {
          console.error("[GolpoAI] Proxy retry failed:", err);
        });
      }
    }
  }, [videoPlayerUrl, videoReadyInfo?.videoUrl, prepareVideoSource]);

  // Continuous monitor - check video element src periodically and clear S3 URLs.
  // IMPORTANT: do NOT run this too frequently, otherwise the iframe becomes sluggish.
  useEffect(() => {
    if (!showVideoPlayerModal) return;
    const video = videoElementRef.current;
    if (!video) return;

    const checkInterval = setInterval(() => {
      const currentSrc = video.src || video.getAttribute("src") || "";

      // If video element has S3 URL, clear it immediately
      if (currentSrc && (currentSrc.includes("s3.amazonaws.com") || currentSrc.includes("s3.us-east-2.amazonaws.com"))) {
        console.error("[GolpoAI] MONITOR: Video element has S3 URL! Clearing immediately:", currentSrc);
        try {
          video.src = "";
          video.setAttribute("src", "");
          video.removeAttribute("src");
          video.load();
          setVideoPlayerUrl(null);

          // Retry with prepareVideoSource if we have a video URL
          if (videoReadyInfo?.videoUrl && !videoReadyInfo.videoUrl.includes("s3.")) {
            // Only retry if it's not already an S3 URL (to avoid infinite loop)
            prepareVideoSource(videoReadyInfo.videoUrl).catch((err) => {
              console.error("[GolpoAI] Monitor retry failed:", err);
            });
          }
        } catch (e) {
          console.error("[GolpoAI] Error clearing S3 URL in monitor:", e);
        }
      }
    }, 1000); // Check every 1s (was 100ms)

    return () => clearInterval(checkInterval);
  }, [showVideoPlayerModal, videoReadyInfo?.videoUrl, prepareVideoSource]);

  // CRITICAL: Monitor video element ref and block S3 URLs from being set
  // Also intercept src setter to prevent S3 URLs
  useEffect(() => {
    if (videoElementRef.current) {
      const video = videoElementRef.current;
      
      // Intercept src setter to block S3 URLs - MORE AGGRESSIVE
      let originalSrcDescriptor;
      try {
        originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src') || 
                                      Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'src');
        
        if (originalSrcDescriptor && originalSrcDescriptor.set) {
          const originalSetter = originalSrcDescriptor.set;
          Object.defineProperty(video, 'src', {
            set: function(value) {
              // CRITICAL: Block S3 URLs immediately
              if (value && (value.includes('s3.amazonaws.com') || value.includes('s3.us-east-2.amazonaws.com'))) {
                console.error("[GolpoAI] BLOCKED: Attempted to set S3 URL to video.src:", value);
                // Clear src immediately using multiple methods
                try {
                  this.setAttribute('src', '');
                  this.removeAttribute('src');
                } catch (e) {
                  // Ignore errors
                }
                // Also clear via original setter with empty string
                try {
                  originalSetter.call(this, '');
                } catch (e) {
                  // Ignore errors
                }
                return;
              }
              // Only allow blob URLs
              if (value && !value.startsWith('blob:') && !value.startsWith('data:')) {
                console.warn("[GolpoAI] Blocked non-blob URL from being set to video.src:", value);
                try {
                  this.setAttribute('src', '');
                  this.removeAttribute('src');
                } catch (e) {
                  // Ignore errors
                }
                try {
                  originalSetter.call(this, '');
                } catch (e) {
                  // Ignore errors
                }
                return;
              }
              // Only set if it's a blob or data URL
              originalSetter.call(this, value);
            },
            get: originalSrcDescriptor.get,
            configurable: true,
            enumerable: true
          });
        }
      } catch (interceptError) {
        console.warn("[GolpoAI] Failed to intercept video src setter:", interceptError);
        // Continue with other checks even if interception fails
      }
      
      // Check current src and clear if S3
      const currentSrc = video.src || video.getAttribute('src');
      if (currentSrc && (currentSrc.includes('s3.amazonaws.com') || currentSrc.includes('s3.us-east-2.amazonaws.com'))) {
        console.error("[GolpoAI] EMERGENCY: Video element has S3 URL! Clearing immediately:", currentSrc);
        video.src = '';
        video.setAttribute('src', '');
        video.load();
        setVideoPlayerUrl(null);
        setIsLoadingVideo(false);
        
        // Retry with proxy if we have a video URL
        if (videoReadyInfo?.videoUrl) {
          prepareVideoSource(videoReadyInfo.videoUrl).catch(err => {
            console.error("[GolpoAI] Proxy retry from ref monitor failed:", err);
          });
        }
      }
      
      // Cleanup: restore original setter when component unmounts
      return () => {
        if (originalSrcDescriptor && originalSrcDescriptor.set) {
          try {
            Object.defineProperty(video, 'src', originalSrcDescriptor);
          } catch (e) {
            // Ignore errors during cleanup
          }
        }
      };
    }
  }, [videoElementRef.current, videoReadyInfo?.videoUrl, prepareVideoSource]);

  useEffect(() => {
    return () => {
      if (videoStatusTimerRef.current) {
        clearTimeout(videoStatusTimerRef.current);
      }
      cleanupVideoObjectUrl();
    };
  }, [cleanupVideoObjectUrl]);


  // Clear loading state when video player URL is ready
  useEffect(() => {
    if (videoPlayerUrl) {
      // Video URL is ready, clear loading (video element will handle onLoadedMetadata)
      setIsLoadingVideo(false);
    }
  }, [videoPlayerUrl]);

  const clearVideoStatusTimer = useCallback(() => {
    if (videoStatusTimerRef.current) {
      clearTimeout(videoStatusTimerRef.current);
      videoStatusTimerRef.current = null;
    }
  }, []);

  // const clearCompletionCheckInterval = useCallback(() => {
  //   if (completionCheckIntervalRef.current) {
  //     clearInterval(completionCheckIntervalRef.current);
  //     completionCheckIntervalRef.current = null;
  //   }
  // }, []);

  const extractJobIdFromResponse = (payload) => {
    if (!payload) {
      return null;
    }
    return (
      payload.job_id ||
      payload.jobId ||
      payload.id ||
      payload?.data?.job_id ||
      payload?.data?.jobId ||
      payload?.job?.id ||
      null
    );
  };

  const extractVideoUrlFromPayload = (payload) => {
    if (!payload) {
      return null;
    }
    return (
      payload.video_url ||
      payload.download_url ||
      payload.podcast_url ||
      payload?.data?.video_url ||
      payload?.data?.download_url ||
      payload?.data?.podcast_url ||
      payload?.result?.video_url ||
      null
    );
  };

  const normalizeStatus = (status) => (typeof status === "string" ? status.toLowerCase() : "");

  const isSuccessStatus = (status) => {
    const normalized = normalizeStatus(status);
    if (!normalized) return false;
    const keywords = ["completed", "ready", "success", "finished", "done", "complete"];
    return keywords.some((keyword) => normalized.includes(keyword));
  };

  const isFailureStatus = (status) => {
    const normalized = normalizeStatus(status);
    if (!normalized) return false;
    const keywords = ["failed", "error", "cancelled", "denied", "rejected", "timeout"];
    return keywords.some((keyword) => normalized.includes(keyword));
  };

  // Restore video generation status when app opens (runs on mount)
  useEffect(() => {
    const restoreVideoGenerationStatus = async () => {
      try {
        const storedJobId = localStorage.getItem('golpo_video_job_id');
        const storedPageId = localStorage.getItem('golpo_video_page_id');
        const modalDismissed = localStorage.getItem('golpo_video_modal_dismissed');
        
        // Only restore if there's a job ID AND it matches the current page
        if (storedJobId && storedPageId) {
          // Check if modal was dismissed in current session (ref) - if so, don't restore
          if (modalDismissedRef.current) {
            console.log("[GolpoAI] Modal was manually dismissed in current session - not restoring");
            return;
          }
          
          // If modal was dismissed in previous session, clear the flag and restore (user revisited app)
          if (modalDismissed === 'true') {
            localStorage.removeItem('golpo_video_modal_dismissed');
            modalDismissedRef.current = false; // Reset ref for new session
            console.log("[GolpoAI] Modal was dismissed previously, but user revisited app - will restore");
          }
          
          // Get current page ID to compare
          let pageId = null;
          try {
            const pageInfo = await safeInvoke("getCurrentPage", {});
            pageId = pageInfo?.id || pageInfo?.pageId || null;
            setCurrentPageId(pageId); // Update state for page-specific modal check
            console.log("[GolpoAI] Current page ID:", pageId, "Stored page ID:", storedPageId);
          } catch (pageError) {
            console.warn("[GolpoAI] Could not get current page ID:", pageError);

            // Fallbacks for pageId detection (important for contentBylineItem / when invoke fails)
            try {
              const context = await getContext();
              const contextPageId = extractPageIdFromContext(context);
              if (contextPageId) {
                pageId = contextPageId;
                setCurrentPageId(pageId);
                console.log("[GolpoAI] Current page ID (from getContext):", pageId, "Stored page ID:", storedPageId);
              }
            } catch (contextErr) {
              // ignore
            }

            if (!pageId) {
              const urlPageId = getPageIdFromUrl();
              if (urlPageId) {
                pageId = urlPageId;
                setCurrentPageId(pageId);
                console.log("[GolpoAI] Current page ID (from URL):", pageId, "Stored page ID:", storedPageId);
              }
            }
          }
          
          // Only restore if we're on the same page where video was generated
          if (pageId && pageId !== storedPageId) {
            console.log("[GolpoAI] Video generation is for a different page. Current:", pageId, "Stored:", storedPageId);
            // Don't restore - this video is for a different page
            return;
          }
          
          // If we couldn't get current page ID, still check status but log a warning
          if (!pageId) {
            console.warn("[GolpoAI] Could not determine current page ID, will restore status anyway (may show on wrong page)");
          }
          
          console.log("[GolpoAI] App opened - checking for ongoing video generation on this page, job:", storedJobId);
          
          // Check if video is already complete by checking status
          try {
            const statusResponse = await safeInvoke("getVideoStatus", { jobId: storedJobId });
            const statusPayload = statusResponse?.body || statusResponse;
            
            if (statusPayload) {
              const status = statusPayload?.status || 
                            statusPayload?.data?.status || 
                            statusPayload?.job_status || 
                            statusPayload?.state || 
                            "";
              
              if (isSuccessStatus(status)) {
                // Video is complete - extract URL and show completion popup
                const videoUrl = extractVideoUrlFromPayload(statusPayload);
                
                if (videoUrl) {
                  console.log("[GolpoAI] Video already completed, showing completion popup. URL:", videoUrl);
                  
                  // Clear localStorage
                  localStorage.removeItem('golpo_video_job_id');
                  localStorage.removeItem('golpo_video_page_id');
                  localStorage.setItem('golpo_last_seen_video_url', videoUrl);
                  
                  // Update state and show completion popup
                  setLatestVideoUrl(videoUrl);
                  setCompletedVideoUrl(videoUrl);
                  setIsGeneratingVideo(false);
                  setVideoStatusMessage("");
                  
                  // Show completion popup after a brief delay to prevent flicker
                  setTimeout(() => {
                    setShowVideoCompletionModal(true);
                    console.log("[GolpoAI] Completion popup shown for already-completed video");
                  }, 100);
                } else {
                  // No URL found - just clear localStorage
                  console.log("[GolpoAI] Video already completed but no URL found, clearing stored job");
                  localStorage.removeItem('golpo_video_job_id');
                  localStorage.removeItem('golpo_video_page_id');
                }
                return;
              } else if (isFailureStatus(status)) {
                // Video failed (including server-side timeout) - show failure popup and clear localStorage
                const normalized = normalizeStatus(status);
                const isTimeout = normalized.includes("timeout");

                console.log("[GolpoAI] Video generation failed during restore. Status:", status, "Timeout:", isTimeout);

                try {
                  localStorage.removeItem('golpo_video_job_id');
                  localStorage.removeItem('golpo_video_page_id');
                  localStorage.removeItem('golpo_video_job_start_ts');
                } catch (e) {}

                setVideoGenerationResult(null);
                setIsGeneratingVideo(false);
                setIsPollingVideoStatus(false);
                setVideoStatusMessage("");

                // Show failure popup (this is what users expect instead of being stuck on "Generating")
                setVideoFailureMessage(
                  statusPayload?.message ||
                    statusPayload?.body?.message ||
                    (isTimeout
                      ? "Video generation failed: it has taken longer than expected. Please try regenerating the video."
                      : "Video generation failed. Please try regenerating the video.")
                );
                setShowVideoFailureModal(true);
                return;
              }
            }
          } catch (statusError) {
            console.warn("[GolpoAI] Could not check video status, will restore message anyway:", statusError);
          }
          
          // Video is still processing - restore the "Video Generation Started!" message
          console.log("[GolpoAI] Restoring video generation status for job:", storedJobId);
          setVideoGenerationResult({
            job_id: storedJobId,
            status: "processing"
          });
          setVideoJobId(storedJobId);
          // Restore stored start timestamp for timeout checks
          try {
            const storedTs = localStorage.getItem('golpo_video_job_start_ts');
            if (storedTs) {
              videoGenerationStartRef.current = parseInt(storedTs, 10);
            }
          } catch (e) {
            console.warn('[GolpoAI] Failed to restore video generation start timestamp:', e);
          }
          setIsGeneratingVideo(true);
          setVideoStatusMessage("Processing");
          
          // Start polling for status updates
          if (completionCheckIntervalRef.current) {
            clearInterval(completionCheckIntervalRef.current);
          }
          
          const checkForCompletion = async () => {
            try {
              const statusResponse = await safeInvoke("getVideoStatus", { jobId: storedJobId });
              const statusPayload = statusResponse?.body || statusResponse;
              
              if (!statusPayload) {
                console.log("[GolpoAI] No status response received");
                return;
              }

              // NOTE: Timeout is handled server-side via getVideoStatus returning status: "timeout".
              // We intentionally do not do a separate client-side 1h timer here to avoid conflicting behaviour.
              
              // Extract status from response
              const status = statusPayload?.status || 
                            statusPayload?.data?.status || 
                            statusPayload?.job_status || 
                            statusPayload?.state || 
                            "";
              
              console.log("[GolpoAI] Video status check:", status);
              
              // Check if video is ready
              if (isSuccessStatus(status)) {
                // Extract video URL from status response
                const videoUrl = extractVideoUrlFromPayload(statusPayload);
                
                if (videoUrl) {
                  console.log("[GolpoAI] ✅ Video completed! URL:", videoUrl);
                  
                  // Clear the interval first
                  if (completionCheckIntervalRef.current) {
                    clearInterval(completionCheckIntervalRef.current);
                    completionCheckIntervalRef.current = null;
                  }
                  
                  // Clear generation result and show completion
                  setVideoGenerationResult(null);
                  setVideoStatusMessage("Complete");
                  
                  // Wait a moment, then show completion popup
                  // Even if modal was dismissed, show completion popup when video is ready
                  setTimeout(() => {
                    setCompletedVideoUrl(videoUrl);
                    // Set completion modal first to prevent flicker
                    setShowVideoCompletionModal(true);
                    
                    // Use requestAnimationFrame to ensure smooth transition
                    requestAnimationFrame(() => {
                      setIsGeneratingVideo(false);
                      setIsPollingVideoStatus(false);
                      setVideoStatusMessage("");
                    });
                    
                    localStorage.removeItem('golpo_video_job_id');
                    localStorage.removeItem('golpo_video_page_id');
                    localStorage.removeItem('golpo_video_modal_dismissed');
                    localStorage.setItem('golpo_last_seen_video_url', videoUrl);
                    // Update latestVideoUrl state so it shows in the UI
                    setLatestVideoUrl(videoUrl);
                    // Reset dismissed flag since video is complete
                    modalDismissedRef.current = false;
                  }, 2000);
                } else {
                  console.log("[GolpoAI] Video status is complete but no URL found");
                }
              } else if (isFailureStatus(status)) {
                console.log("[GolpoAI] Video generation failed with status:", status);
                
                // Clear the interval on failure
                if (completionCheckIntervalRef.current) {
                  clearInterval(completionCheckIntervalRef.current);
                  completionCheckIntervalRef.current = null;
                }
                
                setVideoGenerationResult(null);
                setIsGeneratingVideo(false);
                setIsPollingVideoStatus(false);
                setVideoStatusMessage("");

                try {
                  localStorage.removeItem('golpo_video_job_id');
                  localStorage.removeItem('golpo_video_page_id');
                  localStorage.removeItem('golpo_video_job_start_ts');
                } catch (e) {}

                const normalized = normalizeStatus(status);
                const isTimeout = normalized.includes("timeout");
                setVideoFailureMessage(
                  statusPayload?.message ||
                    statusPayload?.body?.message ||
                    (isTimeout
                      ? "Video generation failed: it has taken longer than expected. Please try regenerating the video."
                      : "Video generation failed. Please try regenerating the video.")
                );
                setShowVideoFailureModal(true);
              } else {
                // Still processing - polling continues in background
                // Only update UI if modal is still open (not dismissed)
                if (!modalDismissedRef.current) {
                  console.log("[GolpoAI] Video still processing, status:", status);
                  setVideoGenerationResult({
                    job_id: storedJobId,
                    status: status || "processing"
                  });
                  setVideoStatusMessage("Status: Processing - Video generation in progress...");
                } else {
                  // Modal was dismissed - polling continues but doesn't update UI or reopen modal
                  console.log("[GolpoAI] Video still processing (polling continues in background, modal stays closed)");
                }
              }
            } catch (error) {
              console.warn("[GolpoAI] Error checking video status:", error);
            }
          };
          
          // Check immediately and then every 15 seconds
          console.log("[GolpoAI] Starting status check interval for restored job:", storedJobId);
          checkForCompletion();
          completionCheckIntervalRef.current = setInterval(checkForCompletion, 15000);
        }
      } catch (error) {
        console.warn("[GolpoAI] Error restoring video generation status:", error);
      }
    };
    
    // Run restoration check when app opens
    restoreVideoGenerationStatus();
  }, [safeInvoke, isSuccessStatus, isFailureStatus, extractVideoUrlFromPayload, setVideoGenerationResult, setVideoJobId, setIsGeneratingVideo, setVideoStatusMessage, setCompletedVideoUrl, setShowVideoCompletionModal, setLatestVideoUrl, completionCheckIntervalRef]); // Include dependencies needed for restoration

  // Get current page ID on mount for page-specific modal checks
  useEffect(() => {
    const getCurrentPageId = async () => {
      try {
        // Prefer resolver (contentAction) but fallback to getContext()/URL (contentBylineItem)
        let pageId = null;
        try {
          const pageInfo = await safeInvoke("getCurrentPage", {});
          pageId = pageInfo?.id || pageInfo?.pageId || null;
        } catch (e) {
          // ignore and fallback below
        }

        if (!pageId) {
          try {
            const context = await getContext();
            pageId = extractPageIdFromContext(context);
          } catch (e) {
            // ignore
          }
        }

        if (!pageId) {
          pageId = getPageIdFromUrl();
        }

        setCurrentPageId(pageId || null);
        console.log("[GolpoAI] Current page ID set:", pageId || null);
      } catch (error) {
        console.warn("[GolpoAI] Could not get current page ID:", error);
      }
    };
    getCurrentPageId();
  }, [safeInvoke]);

  // Extract all video URLs from comments only
  const extractAllVideoUrls = useCallback((pageData, comments) => {
    const videoUrls = new Set(); // Use Set to avoid duplicates

    // Extract from comments only
    if (comments && Array.isArray(comments)) {
      comments.forEach((comment) => {
        const commentText = extractCommentBodyContent(comment);
        // Look for video URLs in comment text
        const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+\.mp4[^\s<>"{}|\\^`\[\]]*)/gi;
        let urlMatch;
        while ((urlMatch = urlRegex.exec(commentText)) !== null) {
          if (urlMatch[1]) {
            videoUrls.add(urlMatch[1]);
          }
        }
        // Also check comment body HTML
        if (comment.body?.storage?.value) {
          const commentHtml = comment.body.storage.value;
          const hrefMatches = commentHtml.matchAll(/href="([^"]+)"|(https?:\/\/[^\s<>"{}|\\^`\[\]]+\.mp4[^\s<>"{}|\\^`\[\]]*)/gi);
          for (const match of hrefMatches) {
            const url = match[1] || match[2];
            if (url && url.includes('http') && (url.includes('.mp4') || url.includes('golpo') || url.includes('video'))) {
              videoUrls.add(url);
            }
          }
        }
      });
    }

    return Array.from(videoUrls).filter(url => url && url.trim().length > 0);
  }, []); // extractCommentBodyContent is defined outside, so no dependency needed

  // Helper function to check if we're on the correct page before showing completion popup
  const isOnCorrectPage = useCallback(async () => {
    try {
      const storedPageId = localStorage.getItem('golpo_video_page_id');
      if (!storedPageId) {
        // No stored page ID means video was generated before page tracking was added
        // Allow popup to show (backward compatibility)
        return true;
      }
      
      // Get current page ID
      const pageInfo = await safeInvoke("getCurrentPage", {});
      const currentPageId = pageInfo?.id || pageInfo?.pageId || null;
      
      if (!currentPageId) {
        // Can't determine current page, allow popup (better to show than hide)
        console.warn("[GolpoAI] Could not determine current page ID, allowing completion popup");
        return true;
      }
      
      const isCorrectPage = currentPageId === storedPageId;
      console.log("[GolpoAI] Page check for completion popup - Current:", currentPageId, "Stored:", storedPageId, "Match:", isCorrectPage);
      return isCorrectPage;
    } catch (error) {
      console.warn("[GolpoAI] Error checking page ID for completion popup:", error);
      // On error, allow popup to show (better to show than hide)
      return true;
    }
  }, [safeInvoke]);

  const handleVideoReady = useCallback(
    async (statusPayload, jobId = null) => {
      if (!statusPayload) {
        return;
      }
      
      // Clear video generation result when video is ready
      setVideoGenerationResult(null);

      // Show "Status: Complete" before closing
      setVideoStatusMessage("Status: Complete");

      // Wait a moment to show "Status: Complete" status
      await new Promise(resolve => setTimeout(resolve, 1000));

      clearVideoStatusTimer();
      setIsGeneratingVideo(false);
      setIsPollingVideoStatus(false);
      setVideoStatusMessage("");

      const videoUrl = extractVideoUrlFromPayload(statusPayload);
      const normalizedInfo = {
        jobId: jobId || extractJobIdFromResponse(statusPayload) || videoJobId,
        videoUrl,
        downloadUrl: videoUrl || statusPayload?.download_url,
        status: statusPayload?.status || statusPayload?.data?.status || "completed",
        raw: statusPayload
      };

      setVideoReadyInfo(normalizedInfo);
      // Reset video too large flag when new video is ready
      setIsVideoTooLarge(false);
      // Set loading to true to show loading state while preparing video
      setIsLoadingVideo(true);
      
      // CRITICAL: Always use prepareVideoSource for S3 URLs to convert to blob
      // Never let video element see S3 URL directly
      if (videoUrl && (videoUrl.includes('s3.amazonaws.com') || videoUrl.includes('s3.us-east-2.amazonaws.com'))) {
        console.log("[GolpoAI] S3 URL detected, converting to blob via prepareVideoSource");
        await prepareVideoSource(videoUrl);
      } else {
      prepareVideoSource(videoUrl);
      }
      
      // Show completion popup when video is ready (only if on correct page)
      if (videoUrl) {
        setCompletedVideoUrl(videoUrl);
        
        // Update status to "Complete" first
        setVideoStatusMessage("Status: Complete");
        
        // Wait a moment to show "Status: Complete" before closing
        setTimeout(async () => {
          // Check if we're on the correct page before showing popup
          const onCorrectPage = await isOnCorrectPage();
          if (onCorrectPage) {
            // Set completion modal first to prevent flicker
            setShowVideoCompletionModal(true);
            console.log("[GolpoAI] handleVideoReady: Showing completion popup for video:", videoUrl);
            
            // Use requestAnimationFrame to ensure smooth transition
            requestAnimationFrame(() => {
              setIsGeneratingVideo(false);
              setIsPollingVideoStatus(false);
              setVideoStatusMessage("");
            });
          } else {
            console.log("[GolpoAI] handleVideoReady: Not showing completion popup - on different page");
            setIsGeneratingVideo(false);
            setIsPollingVideoStatus(false);
            setVideoStatusMessage("");
          }
        }, 1500); // Show "Complete" status for 1.5 seconds
      }
      
      // Ensure loading state is false so any loading overlay is removed
      setIsLoadingVideo(false);
      // Note: latestVideoUrl will be fetched from comments after page refresh
      // Do not set it directly here - only fetch from comments

      // Automatically add video URL to page content and as footer comment
      // NOTE: We always *attempt* to add the footer comment for all module types.
      // Some modules may not have resolver access; those attempts will fail safely (non-blocking).
      if (videoUrl) {
        try {
          // Get page ID from various sources (most reliable first)
          let pageId =
            documentPayload?.id ||
            currentPageId ||
            pages?.[0]?.id ||
            golpoAIDocument?.pageId ||
            null;

          // Fallback to any stored pageId we persisted when generation started
          if (!pageId) {
            try {
              pageId = localStorage.getItem("golpo_video_page_id");
            } catch (e) {
              // ignore
            }
          }

          if (pageId && pageId !== "unknown" && pageId !== "current") {
            console.log("[GolpoAI] handleVideoReady: Adding video URL to page content for page", pageId);

            const videoSectionHtml = buildVideoSectionHtml(videoUrl);
            const commentBodyHtml = buildCommentBodyHtml(videoUrl);

            // Add video to page content (main content area)
            try {
              await safeInvoke("addVideoToPageContent", {
                pageId: pageId,
                videoUrl: videoUrl,
                videoSectionHtml: videoSectionHtml
              });
              console.log("[GolpoAI] handleVideoReady: Successfully added video URL to page content");

              // Refresh the page to show the updated content immediately
              // Try to refresh parent window if in iframe, otherwise refresh current window
              setTimeout(() => {
                try {
                  if (window.parent && window.parent !== window) {
                    // We're in an iframe, try to refresh parent
                    window.parent.location.reload();
                  } else {
                    // We're in the main window, refresh it
                    window.location.reload();
                  }
                } catch (refreshError) {
                  // If refresh fails (e.g., cross-origin), show a message to user
                  console.warn("[GolpoAI] handleVideoReady: Could not auto-refresh page:", refreshError);
                  setCopyUrlMessage("Video link added to page! Please refresh to see it.");
                  setTimeout(() => setCopyUrlMessage(""), 5000);
                }
              }, 1000); // Small delay to ensure the update is processed
            } catch (contentError) {
              // Don't block the UI if content update fails - just log the error
              console.warn("[GolpoAI] handleVideoReady: Failed to add video to page content (non-blocking):", contentError);
            }

            // Also add as footer comment for reference (this is the primary persistent record)
            try {
              await safeInvoke("addVideoCommentToPage", {
                pageId: pageId,
                videoUrl: videoUrl,
                commentBodyHtml: commentBodyHtml
              });
              console.log("[GolpoAI] handleVideoReady: Successfully added video URL to footer comments");
              
              // Immediately fetch the latest comments to get the newest video URL
              try {
                // Small delay to ensure comment is saved
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const footerResponse = await safeInvoke("getFooterComments", { pageId: pageId });
                const latestComments = footerResponse?.body?.results || [];
                
                if (latestComments && latestComments.length > 0) {
                  // Extract video URLs from the latest comments (newest first)
                  const allUrls = extractAllVideoUrls(null, latestComments);
                  
                  if (allUrls.length > 0) {
                    // Set the latest video URL from the newest comment (last one is newest)
                    const latestUrl = allUrls[allUrls.length - 1];
                    setLatestVideoUrl(latestUrl);
                    setAllVideoUrls(allUrls);
                    setCurrentVideoIndex(allUrls.length - 1);
                    console.log("[GolpoAI] handleVideoReady: Latest video URL updated from newest comment:", latestUrl);
                  } else {
                    // Fallback: use the generated video URL directly
                    setLatestVideoUrl(videoUrl);
                    console.log("[GolpoAI] handleVideoReady: Using generated video URL directly:", videoUrl);
                  }
                } else {
                  // Fallback: use the generated video URL directly
                  setLatestVideoUrl(videoUrl);
                  console.log("[GolpoAI] handleVideoReady: No comments found, using generated video URL directly:", videoUrl);
                }
              } catch (fetchError) {
                // Fallback: use the generated video URL directly if fetch fails
                console.warn("[GolpoAI] handleVideoReady: Failed to fetch latest comments, using generated video URL:", fetchError);
                setLatestVideoUrl(videoUrl);
              }
            } catch (commentError) {
              // Don't block the UI if comment creation fails - just log the error
              console.warn("[GolpoAI] handleVideoReady: Failed to add footer comment (non-blocking):", commentError);
              // Still set the video URL directly even if comment creation fails
              setLatestVideoUrl(videoUrl);
              setCopyUrlMessage("Video generated, but we couldn't add it to page comments automatically.");
              setTimeout(() => setCopyUrlMessage(""), 4000);
            }
          } else {
            console.warn("[GolpoAI] handleVideoReady: No valid page ID found, skipping video link addition");
            setCopyUrlMessage("Video generated, but we couldn't detect the page ID to add a comment.");
            setTimeout(() => setCopyUrlMessage(""), 4000);
          }
        } catch (err) {
          // Don't block the UI if there's an error
          console.warn("[GolpoAI] handleVideoReady: Error attempting to add video link (non-blocking):", err);
        }
      }
    },
    [clearVideoStatusTimer, videoJobId, prepareVideoSource, documentPayload, currentPageId, pages, golpoAIDocument, safeInvoke, extractAllVideoUrls]
  );

  const pollVideoStatus = useCallback(
    async (jobId, attempt = 0) => {
      if (!jobId) {
        return;
      }

      // Avoid overlapping polls if the previous request is still in-flight.
      if (pollInFlightRef.current) {
        return;
      }

      pollInFlightRef.current = true;
      try {
        const response = await safeInvoke("getVideoStatus", { jobId });
        const statusPayload = response?.body || response;
        const status =
          statusPayload?.status ||
          statusPayload?.data?.status ||
          statusPayload?.job_status ||
          statusPayload?.state ||
          "";

        // Update status message, but avoid re-rendering if text hasn't changed
        const nextStatusText = isSuccessStatus(status) ? "Status: Complete" : "Status: Processing";
        if (lastStatusTextRef.current !== nextStatusText) {
          lastStatusTextRef.current = nextStatusText;
          setVideoStatusMessage(nextStatusText);
        }

        const videoUrlCandidate = extractVideoUrlFromPayload(statusPayload);

        if (isSuccessStatus(status) || videoUrlCandidate) {
          handleVideoReady(
            videoUrlCandidate ? { ...statusPayload, video_url: videoUrlCandidate } : statusPayload,
            jobId
          );
          return;
        }

        if (isFailureStatus(status)) {
          clearVideoStatusTimer();
          setIsGeneratingVideo(false);
          setIsPollingVideoStatus(false);
          
          // Check if it's a timeout status
          const isTimeout = status && normalizeStatus(status).includes("timeout");
          if (isTimeout) {
            // Close generation modal (isGeneratingVideo is already set to false) and show failure modal
            setVideoFailureMessage(statusPayload?.message || statusPayload?.body?.message || "Video generation took longer than 1 hour and was stopped. Please regenerate.");
            setShowVideoFailureModal(true);
          } else {
            // For other failures, show error message
            setError("Video generation failed. Please try again.");
          }
          return;
        }

        videoStatusTimerRef.current = setTimeout(() => {
          pollVideoStatus(jobId, attempt + 1);
        }, VIDEO_STATUS_POLL_INTERVAL);
      } catch (statusError) {
        console.error("[GolpoAI] pollVideoStatus error:", statusError);

        videoStatusTimerRef.current = setTimeout(() => {
          pollVideoStatus(jobId, attempt + 1);
        }, VIDEO_STATUS_POLL_INTERVAL);
      } finally {
        pollInFlightRef.current = false;
      }
    },
    [clearVideoStatusTimer, handleVideoReady, safeInvoke, isOnCorrectPage, normalizeStatus, setShowVideoFailureModal, setVideoFailureMessage]
  );

  const startVideoStatusPolling = useCallback(
    (jobId) => {
      if (!jobId) {
        return;
      }

      clearVideoStatusTimer();
      setVideoJobId(jobId);
      setIsPollingVideoStatus(true);
      // Prime status text without forcing repeated updates during polling
      lastStatusTextRef.current = "Status: Processing";
      setVideoStatusMessage("Status: Processing");
      pollVideoStatus(jobId, 0);
    },
    [clearVideoStatusTimer, pollVideoStatus]
  );

  const handleCopyVideoUrl = useCallback(async (url) => {
    if (!url) {
      setCopyUrlMessage("No video URL available");
      setTimeout(() => setCopyUrlMessage(""), 3000);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopyUrlMessage("✓ URL copied to clipboard!");
      // Clear message after 3 seconds
      setTimeout(() => setCopyUrlMessage(""), 3000);
    } catch (copyError) {
      console.warn("[GolpoAI] Unable to copy video URL:", copyError);
      // Fallback: select text in a temporary input
      try {
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setCopyUrlMessage("✓ URL copied to clipboard!");
        setTimeout(() => setCopyUrlMessage(""), 3000);
      } catch (fallbackError) {
        setCopyUrlMessage("Failed to copy URL. Please copy manually.");
        setTimeout(() => setCopyUrlMessage(""), 5000);
      }
    }
  }, []);

  const openInNewTab = useCallback((url, download = false) => {
    if (!url) {
      return false;
    }

    // In sandboxed iframes, opening new tabs/windows is often blocked
    // Try link element approach first, but immediately fall back to clipboard if it fails
    let linkClicked = false;
    
    try {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      if (download) {
        // Extract filename from URL or use default
        const urlParts = url.split('/');
        const filename = urlParts[urlParts.length - 1] || `golpo-video-${Date.now()}.mp4`;
        link.download = filename;
      }
      link.style.display = "none";
      link.style.position = "absolute";
      link.style.left = "-9999px";
      document.body.appendChild(link);
      
      // Use requestAnimationFrame to ensure the link is in the DOM
      requestAnimationFrame(() => {
        try {
      link.click();
          linkClicked = true;
      setTimeout(() => {
            if (document.body.contains(link)) {
        document.body.removeChild(link);
            }
          }, 200);
        } catch (clickError) {
          console.warn("[GolpoAI] Link click may be blocked by sandbox, using clipboard:", clickError);
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          // Fall back to clipboard immediately
          copyUrlToClipboardFallback(url, download);
        }
      });
      
      // Also set up clipboard fallback in case link click is silently blocked
      setTimeout(() => {
        if (!linkClicked) {
          copyUrlToClipboardFallback(url, download);
        }
      }, 500);
      
      return linkClicked;
    } catch (fallbackError) {
      console.warn("[GolpoAI] Unable to create link element, using clipboard:", fallbackError);
      copyUrlToClipboardFallback(url, download);
      return false;
    }
  }, [copyUrlToClipboardFallback]);

  const triggerSimpleDownload = useCallback((url) => {
    if (!url) {
      return;
    }
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = `golpo-video-${Date.now()}.mp4`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
      }, 100);
    } catch (err) {
      console.warn("[GolpoAI] Simple download failed, copying URL to clipboard:", err);
      copyUrlToClipboardFallback(url, true);
    }
  }, []);

  const requireContentActionForMedia = useCallback(
    (actionDescription) => {
      if (isBylineItem) {
        setCopyUrlMessage(`Please open the Golpo AI page action to ${actionDescription}.`);
        setTimeout(() => setCopyUrlMessage(""), 4000);
        return false;
      }
      return true;
    },
    [isBylineItem]
  );

  // Function to play video in fullscreen
  const playVideoInFullscreen = useCallback(async (videoUrl) => {
    try {
      console.log("[GolpoAI] Preparing video for fullscreen playback:", videoUrl);
      setIsLoadingVideo(true);
      
      // Set up video ready info
      const normalizedInfo = {
        jobId: videoReadyInfo?.jobId || null,
        videoUrl: videoUrl,
        downloadUrl: videoUrl,
        status: "completed",
        raw: { video_url: videoUrl }
      };
      setVideoReadyInfo(normalizedInfo);
      
      // Prepare video source (will use chunked download for S3 URLs)
      await prepareVideoSource(videoUrl);
      
      // Wait for the blob URL to be ready (with timeout)
      // We'll poll the videoObjectUrlRef which is set by downloadVideoInChunks
      let attempts = 0;
      const maxAttempts = 50; // Wait up to 5 seconds
      let currentBlobUrl = null;
      
      while (attempts < maxAttempts) {
        // Check both videoObjectUrlRef and videoPlayerUrl state
        if (videoObjectUrlRef.current && videoObjectUrlRef.current.startsWith('blob:')) {
          currentBlobUrl = videoObjectUrlRef.current;
          break;
        }
        // Also check state (in case it's set via setVideoPlayerUrlSafe)
        if (videoPlayerUrl && videoPlayerUrl.startsWith('blob:')) {
          currentBlobUrl = videoPlayerUrl;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      if (!currentBlobUrl || !currentBlobUrl.startsWith('blob:')) {
        throw new Error("Video URL not ready for fullscreen playback after waiting");
      }
      
      // Create a fullscreen video container
      const fullscreenContainer = document.createElement('div');
      fullscreenContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: #000;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      
      const video = document.createElement('video');
      video.src = currentBlobUrl;
      video.controls = true;
      video.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
      `;
      
      // Close button
      const closeButton = document.createElement('button');
      closeButton.innerHTML = '✖';
      closeButton.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        font-size: 20px;
        cursor: pointer;
        z-index: 1000000;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      
      const closeFullscreen = () => {
        if (fullscreenContainer.parentNode) {
          fullscreenContainer.parentNode.removeChild(fullscreenContainer);
        }
        setIsFullscreenVideo(false);
        setIsLoadingVideo(false);
        // Exit fullscreen if browser is in fullscreen mode
        if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement) {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
          }
        }
      };
      
      closeButton.onclick = closeFullscreen;
      
      // Handle escape key
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          closeFullscreen();
          document.removeEventListener('keydown', handleEscape);
        }
      };
      document.addEventListener('keydown', handleEscape);
      
      fullscreenContainer.appendChild(video);
      fullscreenContainer.appendChild(closeButton);
      document.body.appendChild(fullscreenContainer);
      
      setIsFullscreenVideo(true);
      setIsLoadingVideo(false);
      
      // Try to enter fullscreen mode
      try {
        if (fullscreenContainer.requestFullscreen) {
          await fullscreenContainer.requestFullscreen();
        } else if (fullscreenContainer.webkitRequestFullscreen) {
          await fullscreenContainer.webkitRequestFullscreen();
        } else if (fullscreenContainer.mozRequestFullScreen) {
          await fullscreenContainer.mozRequestFullScreen();
        } else if (fullscreenContainer.msRequestFullscreen) {
          await fullscreenContainer.msRequestFullscreen();
        }
      } catch (fsError) {
        console.warn("[GolpoAI] Could not enter fullscreen mode, but video container is shown:", fsError);
      }
      
      // Play video
      video.play().catch(err => {
        console.warn("[GolpoAI] Autoplay failed, user can click play:", err);
      });
      
      // Cleanup on video end
      video.onended = () => {
        closeFullscreen();
      };
      
      console.log("[GolpoAI] Video playing in fullscreen");
    } catch (error) {
      console.error("[GolpoAI] Failed to play video in fullscreen:", error);
      setIsLoadingVideo(false);
      setIsFullscreenVideo(false);
      setCopyUrlMessage("Failed to play video in fullscreen. Opening in new tab...");
      setTimeout(() => setCopyUrlMessage(""), 5000);
      // Fallback to new tab
      try {
        window.open(videoUrl, '_blank', 'noopener,noreferrer');
      } catch (openError) {
        copyUrlToClipboardFallback(videoUrl, false, "Video URL copied to clipboard.");
      }
    }
  }, [prepareVideoSource, copyUrlToClipboardFallback]);

  // Helper function to trigger download - defined outside to avoid scope issues
  const triggerDownload = useCallback((blobOrUrl, jobId = null) => {
      try {
      const link = document.createElement("a");
      link.href = blobOrUrl;
        link.download = `golpo-video-${jobId || Date.now()}.mp4`;
        // Don't use target="_blank" for downloads - it causes sandbox popup errors
        // The download attribute handles the download without opening a new window
        link.style.display = "none";
        link.style.position = "absolute";
        link.style.left = "-9999px";
      document.body.appendChild(link);
        
        // Use requestAnimationFrame to ensure link is in DOM before clicking
        requestAnimationFrame(() => {
          try {
      link.click();
      setTimeout(() => {
              if (document.body.contains(link)) {
        document.body.removeChild(link);
              }
        if (blobOrUrl.startsWith("blob:")) {
          URL.revokeObjectURL(blobOrUrl);
        }
            }, 200);
          } catch (clickError) {
            console.warn("[GolpoAI] Link click failed, using clipboard fallback:", clickError);
            if (document.body.contains(link)) {
              document.body.removeChild(link);
            }
            // Fallback to clipboard if download fails
            copyUrlToClipboardFallback(blobOrUrl, true);
          }
        });
      } catch (error) {
        console.warn("[GolpoAI] Download trigger failed, using clipboard fallback:", error);
        // Fallback to clipboard if download fails
        copyUrlToClipboardFallback(blobOrUrl, true);
      }
  }, [copyUrlToClipboardFallback]);

  // Simple blob download handler
  const handleBlobDownload = useCallback(() => {
    if (!videoPlayerUrl) {
      console.warn("[GolpoAI] No video player URL available for download");
      setCopyUrlMessage("Video not loaded. Please wait for video to load.");
      setTimeout(() => setCopyUrlMessage(""), 3000);
      return;
    }

    if (!requireContentActionForMedia("download the video")) {
      return;
    }

    try {
      const link = document.createElement("a");
      link.href = videoPlayerUrl;
      link.download = `golpo-video-${Date.now()}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setCopyUrlMessage("Download started...");
      setTimeout(() => setCopyUrlMessage(""), 2000);
      console.log("[GolpoAI] Blob download initiated");
    } catch (error) {
      console.error("[GolpoAI] Blob download failed:", error);
      setCopyUrlMessage("Download failed. Please try again.");
      setTimeout(() => setCopyUrlMessage(""), 3000);
    }
  }, [videoPlayerUrl, requireContentActionForMedia]);

  const handleDownloadVideo = useCallback(async () => {
    if (!requireContentActionForMedia("download the video")) {
      return;
    }

    // If we already have a blob URL, use simple blob download
    if (videoPlayerUrl && videoPlayerUrl.startsWith("blob:")) {
      handleBlobDownload();
      return;
    }

    const remoteUrl = videoReadyInfo?.downloadUrl || videoReadyInfo?.videoUrl;
    if (!remoteUrl) {
      console.warn("[GolpoAI] No video URL provided for download");
      setCopyUrlMessage("Video URL not available to download");
      setTimeout(() => setCopyUrlMessage(""), 4000);
      return;
    }

    // Try to fetch video and create blob URL for download
    try {
      console.log("[GolpoAI] Fetching video for download");
      setCopyUrlMessage("Preparing download...");
      
      const response = await safeInvoke("fetchVideoFile", { videoUrl: remoteUrl });
      
      if (response?.base64Data) {
        // Convert base64 to blob URL and download
        const blobUrl = base64ToBlobUrl(response.base64Data, response.contentType || 'video/mp4');
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `golpo-video-${Date.now()}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        setCopyUrlMessage("Download started...");
        setTimeout(() => setCopyUrlMessage(""), 2000);
        
        // Clean up the temporary blob URL after a delay
        setTimeout(() => {
          if (blobUrl && blobUrl.startsWith('blob:')) {
            URL.revokeObjectURL(blobUrl);
          }
        }, 1000);
        return;
      }

      // LARGE video: use chunked download via fetchVideoChunk
      if (response?.useChunkedDownload && response?.signedUrl) {
        console.log("[GolpoAI] Video too large for inline download, using chunked download");
        try {
          await downloadVideoInChunks(response.signedUrl, response.contentType || 'video/mp4', false, videoReadyInfo?.jobId || null);
          return;
        } catch (chunkError) {
          console.error("[GolpoAI] Chunked download failed, falling back to open in new window:", chunkError);
        }
      }

      // Final fallback: open original URL in new window
      console.warn("[GolpoAI] Falling back to opening video URL in new window for download");
      try {
        window.open(remoteUrl, '_blank');
        setCopyUrlMessage("Video opened in new window");
        setTimeout(() => setCopyUrlMessage(""), 3000);
      } catch (openError) {
        setCopyUrlMessage("Please copy the URL to download the video");
        setTimeout(() => setCopyUrlMessage(""), 3000);
      }
    } catch (error) {
      console.error("[GolpoAI] Download failed:", error);
      // Fallback: try to open in new window
      try {
        window.open(remoteUrl, '_blank');
        setCopyUrlMessage("Video opened in new window");
        setTimeout(() => setCopyUrlMessage(""), 3000);
      } catch (openError) {
        setCopyUrlMessage("Download failed. Please copy the URL.");
        setTimeout(() => setCopyUrlMessage(""), 3000);
      }
    }
  }, [videoPlayerUrl, videoReadyInfo, safeInvoke, requireContentActionForMedia, base64ToBlobUrl, handleBlobDownload]);

  // Modal-based video preview has been removed; video is now played inline with a loading popup only

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

  useEffect(() => {
    const styleId = "golpo-loading-spinner-style";
    if (!document.getElementById(styleId)) {
      const styleTag = document.createElement("style");
      styleTag.id = styleId;
      styleTag.innerHTML = `
        @keyframes golpo-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(styleTag);
    }
  }, []);

  // Fetch page info on load
  useEffect(() => {
    const fetchPageInfo = async (retryCount = 0) => {
      try {
        let pageInfo = null;

        // Use backend API as primary source - it has access to resolver context
        // Also try getContext() to help backend if needed
        let extractedPageId = null;
        
        // Try getContext() to help backend API (optional helper)
        if (typeof getContext === 'function') {
          try {
            const context = await getContext();
            extractedPageId = extractPageIdFromContext(context);
            if (extractedPageId) {
              console.log("[GolpoAI] fetchPageInfo: Extracted page ID from getContext() to help backend:", extractedPageId);
            }
          } catch (contextErr) {
            // Non-critical, backend will try its own context
            console.log("[GolpoAI] fetchPageInfo: getContext() not available, backend will use its context");
          }
        }
        
        // Call backend API - it should extract page ID from resolver context
        // Pass extracted page ID if available to help backend
        try {
          const payload = extractedPageId ? { pageId: extractedPageId } : {};
          console.log("[GolpoAI] fetchPageInfo: Calling backend API getCurrentPage (attempt " + (retryCount + 1) + "/3)");
          pageInfo = await safeInvoke("getCurrentPage", payload);
          console.log("[GolpoAI] getCurrentPage response:", pageInfo);
          
          // Validate the response - backend API should always return valid page info
          if (pageInfo && pageInfo.id && pageInfo.id !== "unknown" && pageInfo.id !== "current") {
            console.log("[GolpoAI] fetchPageInfo: Successfully got page info from backend API:", pageInfo.id);
          } else {
            // Backend returned invalid response, retry
            console.log("[GolpoAI] fetchPageInfo: Backend API returned invalid response, will retry");
            pageInfo = null;
            if (retryCount < 2) {
              const delay = (retryCount + 1) * 1500; // 1.5s, 3s delays
              console.log("[GolpoAI] Retrying backend API in " + delay + "ms...");
              setTimeout(() => fetchPageInfo(retryCount + 1), delay);
              return; // Exit early to retry
            } else {
              throw new Error("Backend API could not fetch page info after retries");
            }
          }
        } catch (invokeError) {
          console.log("[GolpoAI] Backend API getCurrentPage failed (attempt " + (retryCount + 1) + "/3):", invokeError.message);
          pageInfo = null;
          
          // Retry backend API
          if (retryCount < 2) {
            const delay = (retryCount + 1) * 1500; // 1.5s, 3s delays
            console.log("[GolpoAI] Retrying backend API in " + delay + "ms...");
            setTimeout(() => fetchPageInfo(retryCount + 1), delay);
            return; // Exit early to retry
        } else {
            throw new Error("Backend API failed after retries: " + invokeError.message);
          }
        }
        
        // Old code path removed - now using backend API first for both module types
        if (false) {
          // For contentAction, prioritize backend API - try with longer timeout
          try {
            console.log("[GolpoAI] fetchPageInfo: Attempting backend API getCurrentPage (attempt " + (retryCount + 1) + "/3)");
            // Use Promise.race with timeout to ensure we don't wait too long
            const apiCall = safeInvoke("getCurrentPage", {});
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Backend API timeout')), 10000)
            );
            pageInfo = await Promise.race([apiCall, timeoutPromise]);
            console.log("[GolpoAI] getCurrentPage response:", pageInfo);
            
            // Validate response
            if (pageInfo && pageInfo.id && pageInfo.id !== "unknown" && pageInfo.id !== "current") {
              console.log("[GolpoAI] fetchPageInfo: Successfully got valid page ID from backend API:", pageInfo.id);
            } else {
              console.log("[GolpoAI] fetchPageInfo: Backend API returned invalid page ID, will retry");
              pageInfo = null;
              throw new Error("Invalid page ID from backend API");
            }
          } catch (invokeError) {
            console.log("[GolpoAI] invoke('getCurrentPage') failed (attempt " + (retryCount + 1) + "), will retry:", invokeError.message);
            pageInfo = null;
            // Don't fall back immediately - retry backend API first
            if (retryCount < 2) {
              const delay = (retryCount + 1) * 1500; // 1.5s, 3s delays
              console.log("[GolpoAI] Retrying backend API in " + delay + "ms...");
              setTimeout(() => fetchPageInfo(retryCount + 1), delay);
              return; // Exit early to retry
            }
            // Only fallback after all retries exhausted
            console.log("[GolpoAI] All backend API retries exhausted, trying fallback methods");
            // Fallback to getContext() - check if it's available first
            if (typeof getContext === 'function') {
            try {
              const context = await getContext();
              console.log("[GolpoAI] fetchPageInfo: getContext() result:", JSON.stringify(context, null, 2));
              const pageId = extractPageIdFromContext(context);
              if (pageId) {
                pageInfo = {
                  id: pageId,
                  title: context.content?.title || context.extension?.content?.title || "Page",
                  type: context.content?.type || context.extension?.content?.type || "page"
                };
                console.log("[GolpoAI] fetchPageInfo: Got page info from getContext()", pageInfo);
              }
            } catch (contextErr) {
                console.log("[GolpoAI] fetchPageInfo: getContext() failed, trying URL (non-critical):", contextErr.message);
                const pageIdFromUrl = getPageIdFromUrl();
                if (pageIdFromUrl) {
                  pageInfo = { id: pageIdFromUrl, title: "Page from URL", type: "page" };
                  console.log("[GolpoAI] fetchPageInfo: Got page info from URL", pageInfo);
                }
              }
            } else {
              console.log("[GolpoAI] fetchPageInfo: getContext() is not available, trying URL");
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

          // Fetch full page details and footer comments in parallel for faster loading
          try {
            const [fullPageInfoResponse, footerCommentsResponse] = await Promise.all([
              safeInvoke("getPageById", { pageId: pageInfo.id }),
              safeInvoke("getFooterComments", { pageId: pageInfo.id })
            ]);

            const fullPageInfo = fullPageInfoResponse?.body;
            const fetchedFooterComments = footerCommentsResponse?.body?.results || [];

            // Set footer comments state
            setFooterComments(fetchedFooterComments);

            if (fullPageInfo) {
              console.log("[GolpoAI] Full page details fetched on load", fullPageInfo.id);
              setDocumentPayload(fullPageInfo);
              
              // Extract all video URLs from comments immediately
              const allUrls = extractAllVideoUrls(null, fetchedFooterComments);
              setAllVideoUrls(allUrls);
              if (allUrls.length > 0) {
                // Set latest video URL from comments (last one is newest since comments are added at the end)
                const latestUrl = allUrls[allUrls.length - 1];
                setLatestVideoUrl(latestUrl);
                setCurrentVideoIndex(allUrls.length - 1);
                console.log("[GolpoAI] Latest video URL set from newest comment:", latestUrl);
                
                // Check if user had a video generation in progress (stored in localStorage)
                const storedJobId = localStorage.getItem('golpo_video_job_id');
                const storedPageId = localStorage.getItem('golpo_video_page_id');
                
                // If there was a job in progress and we're on the same page
                if (storedJobId && storedPageId === fullPageInfo.id) {
                  // Check if video is already complete (new video URL exists)
                  if (latestUrl) {
                    const lastSeenUrl = localStorage.getItem('golpo_last_seen_video_url');
                    if (latestUrl !== lastSeenUrl) {
                      // Video completed while user was away
                      console.log("[GolpoAI] Video generation completed while user was away! Showing popup");
                      setCompletedVideoUrl(latestUrl);
                      setShowVideoCompletionModal(true);
                      // Clear stored job ID since video is complete
                      localStorage.removeItem('golpo_video_job_id');
                      localStorage.removeItem('golpo_video_page_id');
                      localStorage.setItem('golpo_last_seen_video_url', latestUrl);
                    }
                  } else {
                    // Video is still generating - restore the "Video Generation Started!" message
                    console.log("[GolpoAI] Restoring video generation status for job:", storedJobId);
                    setVideoGenerationResult({
                      job_id: storedJobId,
                      status: "processing"
                    });
                    setVideoJobId(storedJobId);
                    // Restore stored start timestamp for timeout checks
                    try {
                      const storedTs = localStorage.getItem('golpo_video_job_start_ts');
                      if (storedTs) {
                        videoGenerationStartRef.current = parseInt(storedTs, 10);
                      }
                    } catch (e) {
                      console.warn('[GolpoAI] Failed to restore video generation start timestamp:', e);
                    }
                    setIsGeneratingVideo(true);
                    setVideoStatusMessage("Status: Processing - Video generation in progress...");
                    
                    // Start polling for status updates using the same pattern as handleGenerateVideo
                    if (completionCheckIntervalRef.current) {
                      clearInterval(completionCheckIntervalRef.current);
                    }
                    
                    const checkForCompletion = async () => {
                      try {
                        const statusResponse = await safeInvoke("getVideoStatus", { jobId: storedJobId });
                        const statusPayload = statusResponse?.body || statusResponse;
                        
                        if (!statusPayload) {
                          console.log("[GolpoAI] No status response received");
                          return;
                        }
                        
                        // Extract status from response
                        const status = statusPayload?.status || 
                                      statusPayload?.data?.status || 
                                      statusPayload?.job_status || 
                                      statusPayload?.state || 
                                      "";

                        // NOTE: Timeout is handled server-side via getVideoStatus returning status: "timeout".
                        // We intentionally do not do a separate client-side 1h timer here to avoid conflicting behaviour.
                        
                        console.log("[GolpoAI] Video status check:", status);
                        
                        // Check if video is ready
                        if (isSuccessStatus(status)) {
                          // Extract video URL from status response
                          const videoUrl = extractVideoUrlFromPayload(statusPayload);
                          
                          if (videoUrl) {
                            console.log("[GolpoAI] ✅ Video completed! URL:", videoUrl);
                            
                            // Clear the interval first
                            if (completionCheckIntervalRef.current) {
                              clearInterval(completionCheckIntervalRef.current);
                              completionCheckIntervalRef.current = null;
                            }
                            
                            // Clear generation result and show completion
                            setVideoGenerationResult(null);
                            setVideoStatusMessage("Status: Complete");
                            
                            // Wait a moment, then show completion popup
                            setTimeout(() => {
                              setCompletedVideoUrl(videoUrl);
                              // Set completion modal first to prevent flicker
                              setShowVideoCompletionModal(true);
                              
                              // Use requestAnimationFrame to ensure smooth transition
                              requestAnimationFrame(() => {
                                setIsGeneratingVideo(false);
                                setVideoStatusMessage("");
                              });
                              
                              localStorage.removeItem('golpo_video_job_id');
                              localStorage.removeItem('golpo_video_page_id');
                              localStorage.setItem('golpo_last_seen_video_url', videoUrl);
                              // Update latestVideoUrl state so it shows in the UI
                              setLatestVideoUrl(videoUrl);
                              // Don't reload - let user see the popup and manually refresh if needed
                            }, 2000);
                          } else {
                            console.log("[GolpoAI] Video status is complete but no URL found");
                          }
                        } else if (isFailureStatus(status)) {
                          console.log("[GolpoAI] Video generation failed with status:", status);
                          
                          // Clear the interval on failure
                          if (completionCheckIntervalRef.current) {
                            clearInterval(completionCheckIntervalRef.current);
                            completionCheckIntervalRef.current = null;
                          }
                          
                          setVideoGenerationResult(null);
                          setIsGeneratingVideo(false);
                          setIsPollingVideoStatus(false);
                          setVideoStatusMessage("");

                          try {
                            localStorage.removeItem('golpo_video_job_id');
                            localStorage.removeItem('golpo_video_page_id');
                            localStorage.removeItem('golpo_video_job_start_ts');
                          } catch (e) {}

                          const normalized = normalizeStatus(status);
                          const isTimeout = normalized.includes("timeout");
                          setVideoFailureMessage(
                            statusPayload?.message ||
                              statusPayload?.body?.message ||
                              (isTimeout
                                ? "Video generation failed: it has taken longer than expected. Please try regenerating the video."
                                : "Video generation failed. Please try regenerating the video.")
                          );
                          setShowVideoFailureModal(true);
                        } else {
                          // Still processing - update status message
                          console.log("[GolpoAI] Video still processing, status:", status);
                          setVideoGenerationResult({
                            job_id: storedJobId,
                            status: status || "processing"
                          });
                          setVideoStatusMessage("Status: Processing - Video generation in progress...");
                        }
                      } catch (error) {
                        console.warn("[GolpoAI] Error checking video status:", error);
                      }
                    };
                    
                    // Check immediately and then every 15 seconds
                    console.log("[GolpoAI] Starting status check interval for restored job:", storedJobId);
                    checkForCompletion();
                    completionCheckIntervalRef.current = setInterval(checkForCompletion, 15000);
                  }
                }
              }
              
              // Check for any pending video jobs and trigger background polling
              // This ensures videos are processed even if user closed the tab
              try {
                await safeInvoke("pollVideoStatusBackground");
                console.log("[GolpoAI] Background polling triggered on page load");
              } catch (pollError) {
                console.warn("[GolpoAI] Failed to trigger background polling:", pollError);
              }
              const mapped = toUiPage(fullPageInfo);
              if (mapped) {
                setPages([mapped]);
              }
            } else {
              // Fallback to basic page info if full fetch returns empty body
              setDocumentPayload(pageInfo);
              
              // Still extract video URLs from comments even if page body fetch failed
              const allUrls = extractAllVideoUrls(null, fetchedFooterComments);
              setAllVideoUrls(allUrls);
              if (allUrls.length > 0) {
                // Set latest video URL from comments (last one is newest since comments are added at the end)
                const latestUrl = allUrls[allUrls.length - 1];
                setLatestVideoUrl(latestUrl);
                setCurrentVideoIndex(allUrls.length - 1);
                console.log("[GolpoAI] Latest video URL set from newest comment (fallback):", latestUrl);
              }
              
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
          // Only log warning on last retry attempt, otherwise just debug log
          if (retryCount >= 2) {
            console.log("[GolpoAI] Page info not available after retries. Page ID will be fetched when Generate Video is clicked.");
          } else {
            console.log("[GolpoAI] Page info not yet available (attempt " + (retryCount + 1) + "/3), will retry...");
          }
          // If no valid page info, clear any existing pages
          // Don't set error here - page might be available when user clicks Generate Video
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
    // Fetch immediately when UI loads (no delay)
      fetchPageInfo();
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
        console.log("[GolpoAI] resolvePageId: getContext() result:", JSON.stringify(context, null, 2));

        const pageId = extractPageIdFromContext(context);
        if (pageId) {
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

      try {
        console.log("[GolpoAI] resolvePageId: Trying invoke('getCurrentPage')");
        current = await safeInvoke("getCurrentPage", {});
        console.log("[GolpoAI] resolvePageId: invoke('getCurrentPage') success", current);
      } catch (invokeError) {
        console.warn("[GolpoAI] resolvePageId: invoke('getCurrentPage') failed, trying alternatives:", invokeError);

        // Try getContext() as fallback
        try {
          const context = await getContext();
          console.log("[GolpoAI] resolvePageId: getContext() result:", JSON.stringify(context, null, 2));
          const pageId = extractPageIdFromContext(context);
          if (pageId) {
            current = {
              id: pageId,
              title: context.content?.title || context.extension?.content?.title || "Page",
              type: context.content?.type || context.extension?.content?.type || "page"
            };
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
      // Use the same logic for both contentAction and contentBylineItem
      // First try to get page ID from resolvePageId
      let targetId = await resolvePageId();
      console.log("[GolpoAI] openModal: resolvePageId returned", targetId);

      // If that fails, try the same fallback methods for both modules
      if (!targetId) {
        console.log("[GolpoAI] openModal: resolvePageId returned null, trying alternatives...");

        // Try invoke first (works for contentAction, will fail for contentBylineItem)
        try {
          const currentPage = await safeInvoke("getCurrentPage", {});
          if (currentPage?.id && currentPage.id !== "unknown" && currentPage.id !== "current") {
            targetId = currentPage.id;
            console.log("[GolpoAI] openModal: Got page ID from getCurrentPage:", targetId);
          }
        } catch (invokeErr) {
          if (invokeErr.message === "INVOKE_NOT_AVAILABLE") {
            console.log("[GolpoAI] openModal: invoke not available (contentBylineItem), trying getContext()");
          } else {
            console.log("[GolpoAI] openModal: invoke error, trying getContext():", invokeErr);
          }

          // Fallback to getContext() (works for both modules)
          try {
            const context = await getContext();
            console.log("[GolpoAI] openModal: getContext() result:", JSON.stringify(context, null, 2));
            const pageId = extractPageIdFromContext(context);
            if (pageId) {
              targetId = pageId;
              console.log("[GolpoAI] openModal: Got page ID from getContext()", targetId);
            }
          } catch (contextErr) {
            console.warn("[GolpoAI] openModal: getContext() failed:", contextErr);
          }
        }

        // Last resort: try URL parsing (for both modules)
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

      // Use backend resolvers for all data fetching
      let pageBody = null;
      let footerResult = [];

      try {
        console.log("[GolpoAI] openModal: Fetching page and footer comments via backend for page", targetId);
        const [pageResponse, footerResponse] = await Promise.all([
          safeInvoke("getPageById", { pageId: targetId }),
          safeInvoke("getFooterComments", { pageId: targetId }),
        ]);

        pageBody = pageResponse?.body;
        footerResult = footerResponse?.body?.results || [];

        console.log("[GolpoAI] openModal: Successfully fetched via backend");
        console.log("[GolpoAI] openModal: Footer comments response:", JSON.stringify(footerResponse?.body, null, 2));
        console.log("[GolpoAI] openModal: Footer comments count:", footerResult.length);

        if (footerResult && footerResult.length > 0) {
          console.log("[GolpoAI] Footer Comments Details:");
          footerResult.forEach((comment, index) => {
            console.log(`[GolpoAI] Comment ${index + 1} (backend):`, {
              id: comment.id,
              body: comment.body,
              bodyValue: comment.body?.storage?.value || comment.body?.atlas_doc_format?.value || comment.body,
              author: comment.author,
              authorId: comment.authorId,
              createdAt: comment.createdAt,
              version: comment.version,
              status: comment.status,
              _links: comment._links,
            });
          });
        }
      } catch (invokeErr) {
        console.error("[GolpoAI] openModal: Backend fetch failed:", invokeErr);
        throw new Error(`Failed to fetch page data via backend: ${invokeErr.message}`);
      }

      console.log("[GolpoAI] handleGenerateVideoClick fetched document body", pageBody?.id);
      console.log("[GolpoAI] handleGenerateVideoClick fetched document body", pageBody);
      console.log("[GolpoAI] handleGenerateVideoClick fetched footer comments count:", footerResult.length);
      console.log("[GolpoAI] handleGenerateVideoClick fetched footer comments (full):", JSON.stringify(footerResult, null, 2));

      // Log detailed footer comment values with author information
      if (footerResult && footerResult.length > 0) {
        console.log("[GolpoAI] ========== RAW FOOTER COMMENTS ==========");
        footerResult.forEach((comment, index) => {
          const commentText = extractCommentBodyContent(comment);
          const author = extractCommentAuthor(comment);

          console.log(`\n[GolpoAI] --- Raw Comment ${index + 1} ---`);
          console.log("[GolpoAI] Comment ID:", comment.id);
          console.log("[GolpoAI] Comment Author (extracted):", author);
          console.log("[GolpoAI] Comment Author Object:", comment.author);
          console.log("[GolpoAI] Comment Author ID:", comment.authorId);
          console.log("[GolpoAI] Comment Value/Text (extracted):", commentText);
          console.log("[GolpoAI] Comment Raw Body:", comment.body);
          console.log("[GolpoAI] Comment Created At:", comment.createdAt);
          console.log("[GolpoAI] Comment Full Object:", JSON.stringify(comment, null, 2));
        });
        console.log("\n[GolpoAI] ========== END OF RAW COMMENTS ==========");
      } else {
        console.log("[GolpoAI] No footer comments found for this page");
      }

      // Create document for Golpo AI API
      const golpoAIDocument = createGolpoAIDocument(pageBody, footerResult);

      // Console log the document for verification
      console.log("=".repeat(80));
      console.log("[GolpoAI] ========== GOLPO AI DOCUMENT ==========");
      console.log("=".repeat(80));
      console.log("[GolpoAI] Document Object:", JSON.stringify(golpoAIDocument, null, 2));
      console.log("[GolpoAI] Document Title:", golpoAIDocument.title);
      console.log("[GolpoAI] Document Page ID:", golpoAIDocument.pageId);
      console.log("[GolpoAI] Document Content Length:", golpoAIDocument.content.length, "characters");
      console.log("[GolpoAI] Document Comments Count:", golpoAIDocument.comments.length);
      console.log("[GolpoAI] Document Full Text Length:", golpoAIDocument.fullText.length, "characters");
      console.log("[GolpoAI] Document Metadata:", golpoAIDocument.metadata);

      // Log detailed comment information
      if (golpoAIDocument.comments && golpoAIDocument.comments.length > 0) {
        console.log("\n[GolpoAI] ========== FOOTER COMMENTS DETAILS ==========");
        golpoAIDocument.comments.forEach((comment, index) => {
          console.log(`\n[GolpoAI] --- Comment ${index + 1} ---`);
          console.log("[GolpoAI] Comment ID:", comment.id);
          console.log("[GolpoAI] Comment Author:", comment.author);
          console.log("[GolpoAI] Comment Author ID:", comment.authorId);
          console.log("[GolpoAI] Comment Author Details:", comment.authorDetails);
          console.log("[GolpoAI] Comment Created At:", comment.createdAt);
          console.log("[GolpoAI] Comment Value/Text:", comment.body);
          console.log("[GolpoAI] Comment Value Length:", comment.body.length, "characters");
        });
        console.log("\n[GolpoAI] ========== END OF COMMENTS ==========");
      } else {
        console.log("\n[GolpoAI] No footer comments found in document");
      }

      console.log("\n[GolpoAI] ========== DOCUMENT FULL TEXT ==========");
      console.log(golpoAIDocument.fullText);
      console.log("=".repeat(80));
      console.log("[GolpoAI] ========== END OF DOCUMENT ==========");
      console.log("=".repeat(80));

      // Update document payload and pages with full document
      setDocumentPayload(pageBody);
      // Extract all video URLs from comments only
      const allUrls = extractAllVideoUrls(null, footerResult);
      setAllVideoUrls(allUrls);
      if (allUrls.length > 0) {
        // Set latest video URL from comments (last one is newest since comments are added at the end)
        const latestUrl = allUrls[allUrls.length - 1];
        setLatestVideoUrl(latestUrl);
        setCurrentVideoIndex(allUrls.length - 1);
        console.log("[GolpoAI] Latest video URL set from newest comment:", latestUrl);
      }
      const mapped = toUiPage(pageBody);
      if (mapped) {
        setPages([mapped]);
      } else {
        setPages([]);
      }

      setFooterComments(footerResult);
      setGolpoAIDocument(golpoAIDocument); // Store document for video generation
      console.log("[GolpoAI] Footer comments stored in state:", footerResult.length, "comments");
      console.log("[GolpoAI] Golpo AI document stored in state for video generation");

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

  const handleGenerateVideoClick = useCallback(async () => {
    if (actionLoading || description.length < 1) {
      return;
    }

    // Always proceed to generate/regenerate - no modal check
    try {
      await openModal();
    } catch (err) {
      console.error("[GolpoAI] handleGenerateVideoClick failed:", err);
      setError(err?.message || "Unable to open the video generator. Please try again.");
    }
  }, [actionLoading, description.length, openModal]);

  // Handle video generation
  const handleGenerateVideo = async () => {
    if (!golpoAIDocument) {
      setError("Document is not ready. Please try again.");
      return;
    }

    // ---------------------- Low credits warning (UI only) ----------------------
    // Criteria (per 1 min):
    // - Script generation only: 0.1
    // - Video from generated script: 0.9 (plus script 0.1 if script step enabled)
    // - Video without generating script: 1.0
    // - Audio without generating script: 0.1
    // - Audio after generating script: 0.1 (script) + 0.1 (audio) = 0.2
    //
    // Current UI flow generates a video directly from document (no script step), so we warn using:
    // "Generating video without generating script: 1 for 1min".
    //
    // IMPORTANT: This does NOT modify backend credit deduction/tracking; it only shows a warning
    // when current credits are below the estimated requirement.
    try {
      const minutes = Number(selectedDurationOption?.minutes || 1);

      // Current mode in this UI:
      const perMinute = 1.0; // video without generating script
      const requiredCredits = minutes * perMinute;

      // Fetch current credits from backend (admin key credits)
      const creditsResponse = await safeInvoke("getCredits", {});
      const creditsPayload = creditsResponse?.body || creditsResponse;
      const creditsList = creditsPayload?.credits || [];
      const firstKey = Array.isArray(creditsList) ? creditsList.find((c) => typeof c?.currentCredits === "number") : null;
      const currentCredits = firstKey?.currentCredits;

      const effectiveCredits =
        typeof FORCE_TEST_CREDITS === "number" ? FORCE_TEST_CREDITS : currentCredits;

      if (typeof effectiveCredits === "number" && Number.isFinite(effectiveCredits) && effectiveCredits < requiredCredits) {
        setLowCreditsInfo({
          currentCredits: effectiveCredits,
          requiredCredits,
          breakdown: `${perMinute} credits / min × ${minutes} min = ${requiredCredits.toFixed(2)} credits`,
        });
        setShowLowCreditsModal(true);
        return;
      }
    } catch (creditErr) {
      // Non-blocking. If credits fetch fails, we continue with existing behavior.
      console.warn("[GolpoAI] Low credits check failed (non-blocking):", creditErr);
    }

    // COMMENTED OUT: Validate duration before generating
    // const isValidDuration = validateDuration();
    // if (!isValidDuration && durationWarning) {
    //   // Show error with warning message
    //   setError(durationWarning.message);
    //   console.warn("[GolpoAI] Duration validation failed:", durationWarning.message);
    //   return;
    // }

    setIsGeneratingVideo(true);
    setIsPollingVideoStatus(false);
    setError("");
    setVideoGenerationResult(null);

    try {
      const durationMinutes = selectedDurationOption.minutes;

      console.log("[GolpoAI] handleGenerateVideo: Starting video generation");
      console.log("[GolpoAI] handleGenerateVideo: Document:", golpoAIDocument);
      console.log("[GolpoAI] handleGenerateVideo: Video specs:", {
        durationMinutes,
        durationLabel: selectedDurationOption.label,
        voice,
        language,
        useColor,
      });

      // Prepare video specifications with all parameters
      const videoSpecs = {
        durationMinutes,
        durationLabel: selectedDurationOption.label,
        voice: voice,
        language: language,
        
        useColor: useColor,
        music: music,
        style: style,
        selectedQuickAction: description || (selectedAction !== null ? quickActions[selectedAction] : null),
      };

      // COMMENTED OUT: Step 1: Convert document to script using Gemini AI
      // const issueDocument = golpoAIDocument?.fullText || golpoAIDocument?.content || '';
      // let generatedScript = null;

      // if (issueDocument) {
      //   try {
      //     setVideoStatusMessage("Converting document to script via Gemini AI...");
      //     console.log("[GolpoAI] Step 1: Converting issue document to script via Gemini AI...");
      //     console.log("[GolpoAI] Document length:", issueDocument.length, "characters");
      //     console.log("[GolpoAI] Description:", description || "None");
      //     console.log("[GolpoAI] Video specs for script generation:", {
      //       duration: selectedDurationOption.label,
      //       language: language,
      //     });

      //     // Note: The conversion happens in the backend generateVideo resolver
      //     // We log here to show the process has started
      //     console.log("[GolpoAI] Sending document to backend for Gemini AI script conversion...");
      //   } catch (geminiError) {
      //     console.error("[GolpoAI] Failed to prepare script conversion:", geminiError);
      //     // Continue with document if script generation fails
      //   }
      // }

      // COMMENTED OUT: Step 2: Generate video with the script (conversion happens in backend)
      setVideoStatusMessage("Generating video...");
      console.log("[GolpoAI] Calling backend to generate video...");

      // Extract documentText and create prompt (same as backend does)
      // Include title and content, but exclude footer comments from prompt
      // Use plain text directly (no JSON wrapper)
      const title = golpoAIDocument?.title || '';
      const content = golpoAIDocument?.content || '';
      const documentText = title ? `TITLE: ${title}\n\nCONTENT:\n${content}` : content;
      
      // Log the prompt that will be sent to backend
      console.log("[GolpoAI] ========== PROMPT FOR VIDEO GENERATION ==========");
      console.log("[GolpoAI] Prompt (plain text):", documentText);
      console.log("[GolpoAI] Document text length:", documentText.length, "characters");
      console.log("[GolpoAI] ========== END OF PROMPT ==========");

      // Call backend to generate video
      const response = await safeInvoke("generateVideo", {
        document: golpoAIDocument,
        videoSpecs: videoSpecs,
        description: description,
        requestedBy: currentUser || null,
        // Pass accountId explicitly so backend can load the correct per-user API key
        accountId: currentUser?.accountId || null,
      });

      console.log("[GolpoAI] handleGenerateVideo: Video generation response received");
      
      // COMMENTED OUT: Check if script was generated (backend logs will show this)
      // if (response?.body?.scriptGenerated) {
      //   console.log("[GolpoAI] ✓ Script successfully generated via Gemini AI");
      //   console.log("[GolpoAI] Script preview:", response.body.scriptPreview || "Available in backend logs");
      // } else {
      //   console.log("[GolpoAI] Using document directly (script generation may have been skipped or failed)");
      // }

      console.log("[GolpoAI] handleGenerateVideo: Video generation response:", response);
      const responseBody = response?.body || response;

      if (!responseBody) {
        throw new Error("Invalid response from video generation API");
      }

      setVideoGenerationResult(responseBody);
      const generatedJobId = extractJobIdFromResponse(responseBody);
      const immediateVideoUrl = extractVideoUrlFromPayload(responseBody);

      // Close specs modal once request is accepted
      setIsModalOpen(false);

      if (immediateVideoUrl) {
        // Video is ready immediately, process it
        console.log("[GolpoAI] handleGenerateVideo: Video URL returned immediately");
        handleVideoReady(responseBody);
      } else if (generatedJobId) {
        // Job ID returned - backend will poll in background
        console.log("[GolpoAI] handleGenerateVideo: Job id detected, backend will poll in background", generatedJobId);
        setVideoJobId(generatedJobId);
        // Record generation start timestamp for timeout detection
        try {
          const nowTs = Date.now();
          videoGenerationStartRef.current = nowTs;
          localStorage.setItem('golpo_video_job_start_ts', nowTs.toString());
        } catch (e) {
          console.warn('[GolpoAI] Failed to store video generation start timestamp:', e);
        }
        // Keep loading state visible to show video is being generated
        setIsGeneratingVideo(true);
        setVideoStatusMessage("Status: Processing - Video generation in progress...");
        
        // Store job ID and page ID in localStorage to detect completion on return
        const pageId = documentPayload?.id || pages[0]?.id || golpoAIDocument?.pageId;
        if (pageId && pageId !== "unknown" && pageId !== "current") {
          try {
            localStorage.setItem('golpo_video_job_id', generatedJobId);
            localStorage.setItem('golpo_video_page_id', pageId);
            console.log("[GolpoAI] Stored video job info in localStorage for return detection");
          } catch (storageError) {
            console.warn("[GolpoAI] Failed to store job info in localStorage:", storageError);
          }
        }
        
        // Store current latest URL to detect when new video appears
        // Initialize with current latestVideoUrl or empty string to detect new videos
        const initialUrl = latestVideoUrl || "";
        previousLatestUrlRef.current = initialUrl;
        if (latestVideoUrl) {
          try {
            localStorage.setItem('golpo_last_seen_video_url', latestVideoUrl);
          } catch (storageError) {
            console.warn("[GolpoAI] Failed to store last seen URL:", storageError);
          }
        }
        
        // Start checking for completion periodically (every 15 seconds)
        if (completionCheckIntervalRef.current) {
          clearInterval(completionCheckIntervalRef.current);
        }
        console.log("[GolpoAI] Starting completion check interval for job:", generatedJobId, "Initial URL:", initialUrl);
        
        // Define the check function to reuse it
        const checkForCompletion = async () => {
          try {
            // Get current videoJobId from state (it might have changed)
            const currentJobId = videoJobId || generatedJobId;
            if (!currentJobId) {
              console.log("[GolpoAI] No job ID available, skipping completion check");
              return;
            }
            
            console.log("[GolpoAI] Checking video status from Golpo API, jobId:", currentJobId);
            
            // Check video status directly from Golpo API instead of comments
            const statusResponse = await safeInvoke("getVideoStatus", { jobId: currentJobId });
            const statusPayload = statusResponse?.body || statusResponse;
            
            if (!statusPayload) {
              console.log("[GolpoAI] No status response received");
              return;
            }
            
            // Extract status from response
            const status = statusPayload?.status || 
                          statusPayload?.data?.status || 
                          statusPayload?.job_status || 
                          statusPayload?.state || 
                          "";
            
            console.log("[GolpoAI] Video status:", status);
            
            // Check if video is ready
            if (isSuccessStatus(status)) {
              // Extract video URL from status response
              const videoUrl = extractVideoUrlFromPayload(statusPayload);
              
              if (videoUrl) {
                console.log("[GolpoAI] ✅ Video completed! URL:", videoUrl);
                
                // Update state with video URL
                setLatestVideoUrl(videoUrl);
                setCompletedVideoUrl(videoUrl);
                
                // Update status to "Complete" immediately - keep loader visible with this status
                setVideoStatusMessage("Status: Complete");
                console.log("[GolpoAI] Status updated to Complete");
                
                // Clear the interval first to prevent multiple triggers
                if (completionCheckIntervalRef.current) {
                  clearInterval(completionCheckIntervalRef.current);
                  completionCheckIntervalRef.current = null;
                }
                
                // Always show completion popup when video is generated (only if on correct page)
                // Wait 2 seconds to show "Status: Complete" in loader, then show completion popup
                setTimeout(async () => {
                  console.log("[GolpoAI] Checking if should show completion popup");
                  console.log("[GolpoAI] completedVideoUrl:", videoUrl);
                  
                  // Check if we're on the correct page before showing popup
                  const storedPageId = localStorage.getItem('golpo_video_page_id');
                  let onCorrectPage = true;
                  
                  if (storedPageId) {
                    try {
                      const pageInfo = await safeInvoke("getCurrentPage", {});
                      const currentPageId = pageInfo?.id || pageInfo?.pageId || null;
                      onCorrectPage = currentPageId === storedPageId;
                      console.log("[GolpoAI] Page check - Current:", currentPageId, "Stored:", storedPageId, "Match:", onCorrectPage);
                    } catch (pageError) {
                      console.warn("[GolpoAI] Could not check page ID, allowing popup:", pageError);
                      onCorrectPage = true; // Allow popup on error
                    }
                  }
                  
                  if (onCorrectPage) {
                    console.log("[GolpoAI] Setting showVideoCompletionModal to true");
                    
                    // Clear localStorage
                    localStorage.removeItem('golpo_video_job_id');
                    localStorage.removeItem('golpo_video_page_id');
                    localStorage.setItem('golpo_last_seen_video_url', videoUrl);
                    
                    // Ensure completedVideoUrl is set before showing modal
                    setCompletedVideoUrl(videoUrl);
                    
                    // Set completion modal first, then close loading modal to prevent flicker
                    setShowVideoCompletionModal(true);
                    
                    // Use requestAnimationFrame to ensure smooth transition
                    requestAnimationFrame(() => {
                      setIsGeneratingVideo(false);
                      setIsPollingVideoStatus(false);
                      setVideoStatusMessage("");
                    });
                    
                    previousLatestUrlRef.current = videoUrl;
                    console.log("[GolpoAI] Completion popup should now be visible");
                  } else {
                    console.log("[GolpoAI] Not showing completion popup - on different page");
                    // Still clear localStorage and update state, just don't show popup
                    localStorage.removeItem('golpo_video_job_id');
                    localStorage.removeItem('golpo_video_page_id');
                    localStorage.setItem('golpo_last_seen_video_url', videoUrl);
                    setCompletedVideoUrl(videoUrl);
                    setIsGeneratingVideo(false);
                    setIsPollingVideoStatus(false);
                    setVideoStatusMessage("");
                    previousLatestUrlRef.current = videoUrl;
                  }
                }, 2000); // Show "Complete" status for 2 seconds, then show completion popup
              } else {
                console.log("[GolpoAI] Video status is complete but no URL found in response");
              }
            } else if (isFailureStatus(status)) {
              console.log("[GolpoAI] Video generation failed with status:", status);
              setVideoStatusMessage("Status: Failed");
              // Clear the interval on failure
              if (completionCheckIntervalRef.current) {
                clearInterval(completionCheckIntervalRef.current);
                completionCheckIntervalRef.current = null;
              }
            } else {
              console.log("[GolpoAI] Video still processing, status:", status);
              setVideoStatusMessage("Status: Processing - Video generation in progress...");
            }
          } catch (checkError) {
            console.error("[GolpoAI] Error checking for video completion:", checkError);
          }
        };
        
        // Run immediate check first, then set up interval
        checkForCompletion();
        completionCheckIntervalRef.current = setInterval(checkForCompletion, 15000); // Check every 15 seconds for faster detection
      } else {
        console.warn("[GolpoAI] handleGenerateVideo: No job id or video URL returned, showing raw response");
        handleVideoReady(responseBody);
      }
    } catch (err) {
      console.error("[GolpoAI] handleGenerateVideo: Failed to generate video", err);
      setError(`Failed to generate video: ${err.message || "Unknown error"}`);
      clearVideoStatusTimer();
      setIsGeneratingVideo(false);
      setIsPollingVideoStatus(false);
    }
  };

  // Apply larger styles only for contentBylineItem, keep contentAction unchanged
  const currentStyles = isBylineItem ? {
    ...styles,
    page: {
      ...styles.page,
      padding: "10px 14px",
      width: "100%",
      maxWidth: "100%",
      height: "100%",
      minHeight: "100%",
      maxHeight: "100%",
      overflow: "auto",
      margin: 0,
    },
    closeButton: {
      ...styles.closeButton,
      top: "4px",
      right: "4px",
      fontSize: "20px",
    },
    heroContainer: {
      ...styles.heroContainer,
      marginBottom: "12px",
    },
    heroCard: {
      ...styles.heroCard,
      padding: "10px 14px",
    },
    heroContent: {
      ...styles.heroContent,
      gap: "8px",
    },
    logo: {
      ...styles.logo,
      width: 40,
      height: 40,
    },
    heroTitle: {
      ...styles.heroTitle,
      fontSize: "16px",
      fontWeight: 700,
      letterSpacing: "-0.01em",
    },
    scrollArea: {
      ...styles.scrollArea,
      marginTop: "8px",
      maxHeight: "none",
      overflowY: "visible",
      overflowX: "hidden",
      flex: "1 1 auto",
    },
    helpHeading: {
      ...styles.helpHeading,
      fontSize: "15px",
      fontWeight: 600,
      marginBottom: "8px",
      letterSpacing: "-0.01em",
    },
    mainHeading: {
      ...styles.mainHeading,
      fontSize: "13px",
      fontWeight: 500,
      marginBottom: "8px",
      lineHeight: 1.5,
    },
    sectionHeading: {
      ...styles.sectionHeading,
      fontSize: "14px",
      fontWeight: 600,
      marginBottom: "8px",
      letterSpacing: "-0.01em",
    },
    sectionDescription: {
      ...styles.sectionDescription,
      fontSize: "12px",
      fontWeight: 400,
      marginBottom: "12px",
      lineHeight: 1.5,
      color: "#64748b",
    },
    contentSection: {
      ...styles.contentSection,
      marginBottom: "16px",
    },
    actionList: {
      ...styles.actionList,
      gap: "8px",
    },
    actionButton: {
      ...styles.actionButton,
      padding: "10px 14px",
      fontSize: "12px",
      gap: "8px",
      lineHeight: 1.4,
    },
    actionIconWrapper: {
      ...styles.actionIconWrapper,
      width: "24px",
      height: "24px",
    },
    contextSection: {
      ...styles.contextSection,
      marginTop: "12px",
      maxHeight: "none",
    },
    contextCard: {
      ...styles.contextCard,
      gap: "8px",
      marginBottom: "12px",
      overflow: "visible",
    },
    pageCard: {
      ...styles.pageCard,
      padding: "12px 14px",
      overflow: "visible",
      borderRadius: "12px",
    },
    pageTitle: {
      ...styles.pageTitle,
      fontSize: "13px",
      fontWeight: 600,
      marginBottom: "6px",
      lineHeight: 1.4,
    },
    pageSummary: {
      ...styles.pageSummary,
      fontSize: "11px",
      lineHeight: 1.5,
      color: "#64748b",
    },
    textareaLabel: {
      ...styles.textareaLabel,
      fontSize: "13px",
      fontWeight: 600,
      marginBottom: "8px",
      letterSpacing: "-0.01em",
    },
    textarea: {
      ...styles.textarea,
      height: 70,
      minHeight: 70,
      maxHeight: 70,
      padding: "10px 12px",
      fontSize: "12px",
      lineHeight: 1.5,
      borderRadius: "12px",
    },
    textareaFooter: {
      ...styles.textareaFooter,
      marginTop: "8px",
      fontSize: "11px",
      lineHeight: 1.4,
    },
    generateButton: {
      ...styles.generateButton,
      padding: "10px 18px",
      fontSize: "13px",
      fontWeight: 600,
      gap: "8px",
      letterSpacing: "-0.01em",
    },
    latestVideoCard: {
      ...styles.latestVideoCard,
      marginTop: 20,
      padding: "10px 14px",
      marginBottom: 16,
      gap: 8,
    },
    latestVideoRow: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      flexWrap: "nowrap",
      whiteSpace: "nowrap",
    },
    latestVideoLabel: {
      ...styles.latestVideoSubtitle,
      fontSize: "16px",
      fontWeight: 700,
      margin: 0,
      color: "#111827",
      whiteSpace: "nowrap",
    },
    latestVideoLinkButton: {
      background: "transparent",
      border: "none",
      padding: 0,
      margin: 0,
      color: "#0066cc",
      textDecoration: "underline",
      cursor: "pointer",
      fontSize: "16px",
      fontWeight: 500,
      lineHeight: 1.2,
      fontFamily: "inherit",
      outline: "none",
      boxShadow: "none",
      appearance: "none",
      WebkitAppearance: "none",
      whiteSpace: "nowrap",
    },
  } : styles;

  return (
    <>
      <div style={currentStyles.page}>
        {/* Close Button */}
        <button
          onClick={async () => {
            try {
              await view.close();
            } catch (error) {
              // Silently handle "not closable" errors - this is expected in some contexts
              if (error?.message?.includes("not closable") || error?.message?.includes("closable")) {
                // View is not closable in this context, which is fine
                return;
              }
              // For other errors, log but don't show to user
              console.log("[GolpoAI] View close not available in this context");
              // Fallback: try to close by hiding the UI
              if (window.parent && window.parent.postMessage) {
                window.parent.postMessage({ type: "close" }, "*");
              }
            }
          }}
          style={currentStyles.closeButton}
          aria-label="Close"
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

        {latestVideoUrl && (
          <section style={currentStyles.latestVideoCard}>
            <div style={currentStyles.latestVideoRow}>
              <span style={currentStyles.latestVideoLabel}>Recently generated video:</span>
              <button
                type="button"
                style={currentStyles.latestVideoLinkButton}
                onClick={async () => {
                  console.log("[GolpoAI] ========== Open video clicked (latest video) ==========");
                  console.log("[GolpoAI] Video URL:", latestVideoUrl);

                  if (!requireContentActionForMedia("play the video")) {
                    console.log("[GolpoAI] Content action required check failed");
                    return;
                  }

                  setIsLoadingVideo(true);
                  setError("");

                  try {
                    console.log("[GolpoAI] Preparing video for modal playback");
                    const normalizedInfo = {
                      jobId: null, // We don't have job ID from URL
                      videoUrl: latestVideoUrl,
                      downloadUrl: latestVideoUrl,
                      status: "completed",
                      raw: { video_url: latestVideoUrl },
                    };

                    setVideoReadyInfo(normalizedInfo);
                    setIsVideoTooLarge(false);
                    setVideoPlayerUrl(null);
                    setShowVideoPlayerModal(true);

                    // Prepare video source - converts to blob and plays inside modal
                    await prepareVideoSource(latestVideoUrl);
                    console.log("[GolpoAI] ✅ Video source prepared successfully for modal playback");
                  } catch (error) {
                    console.error("[GolpoAI] ❌ ERROR opening latest video in modal:", error);
                    setIsLoadingVideo(false);
                    setIsVideoTooLarge(true);
                    setError(`Failed to load video: ${error.message}`);
                  }
                }}
              >
                {isLoadingVideo ? "Opening..." : "Open Video"}
              </button>
            </div>
          </section>
        )}

        {/* Main Scroll UI */}
        <div style={currentStyles.scrollArea}>
          {/* Main Heading */}
          <section style={currentStyles.contentSection}>
            <p style={currentStyles.helpHeading}>How Can I help?</p>
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
                onClick={handleGenerateVideoClick}
                disabled={description.length < 1}
                style={{
                  ...currentStyles.generateButton,
                  ...(description.length > 0 ? currentStyles.generateButtonActive : currentStyles.generateButtonDisabled),
                }}
                type="button"
              >
                {latestVideoUrl ? (
                  <SparklesIcon size={20} />
                ) : (
                  <span style={currentStyles.generateButtonIcon} aria-hidden>
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 36 36"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <rect x="4" y="9" width="20" height="18" rx="6" stroke={description.length > 0 ? "#FF4D6D" : "#fff"} strokeWidth="3" fill="none" />
                      <path
                        d="M24 16.5L31 12V24L24 19.5"
                        stroke={description.length > 0 ? "#FF4D6D" : "#fff"}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
                <span>{latestVideoUrl ? "Regenerate" : "Generate Video"}</span>
              </button>
            </div>
          </section>

          {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
        </div>

        {/* Modal */}
        {isModalOpen && (
          <div style={styles.modalOverlay}>
            <div style={styles.modal}>
              {/* Loader overlay */}
              {actionLoading && (
                <div style={styles.modalLoaderOverlay}>
                  <p style={styles.modalLoaderText}>Loading form...</p>
                </div>
              )}

              {/* Modal Header */}
              <div style={styles.modalHeader}>
                <div style={styles.modalIconWrapper}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <rect x="2" y="4" width="14" height="12" rx="3" stroke="#FF4D6D" strokeWidth="2" />
                    <path
                      d="M16 10L21 6V18L16 14"
                      stroke="#FF4D6D"
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
              <div style={{ ...styles.modalForm, opacity: actionLoading ? 0.5 : 1, pointerEvents: actionLoading ? 'none' : 'auto' }}>
                <div style={styles.formRow}>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Duration</label>
                    <select
                      style={styles.formSelect}
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    >
                      {durationOptions.map((option) => (
                        <option key={option.label} value={option.minutes}>
                          {option.label}
                        </option>
                      ))}
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
                      
                    </select>
                  </div>
                </div>

                {/* COMMENTED OUT: Duration Warning - Horizontal layout spanning full width */}
                {/* {durationWarning && (
                  <div style={{
                    marginTop: 12,
                    marginBottom: 12,
                    padding: "12px 16px",
                    borderRadius: 8,
                    background: "#FFF4E6",
                    border: "1px solid #FFB84D",
                    fontSize: 13,
                    color: "#8B4513",
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    flexWrap: "wrap"
                  }}>
                    <div style={{ 
                      fontWeight: 600, 
                      fontSize: 16,
                      flexShrink: 0
                    }}>⚠️</div>
                    <div style={{ 
                      flex: 1,
                      minWidth: 200,
                      lineHeight: 1.5
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Duration Warning</div>
                      <div>{durationWarning.message}</div>
                    </div>
                    {durationWarning.suggestedDurations && durationWarning.suggestedDurations.length > 0 && (
                      <div style={{ 
                        display: "flex", 
                        gap: 8, 
                        flexWrap: "wrap",
                        alignItems: "center",
                        flexShrink: 0
                      }}>
                        <div style={{ 
                          fontWeight: 500, 
                          fontSize: 12,
                          color: "#8B4513",
                          marginRight: 4
                        }}>Suggested:</div>
                        {durationWarning.suggestedDurations.map((option) => (
                          <button
                            key={option.label}
                            onClick={() => {
                              setDuration(option.minutes.toString());
                              setDurationWarning(null);
                            }}
                            style={{
                              padding: "6px 14px",
                              borderRadius: 6,
                              border: "1px solid #FFB84D",
                              background: "#FFFFFF",
                              color: "#8B4513",
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: "pointer",
                              transition: "all 0.2s",
                              whiteSpace: "nowrap"
                            }}
                            onMouseEnter={(e) => {
                              e.target.style.background = "#FFB84D";
                              e.target.style.color = "#FFFFFF";
                            }}
                            onMouseLeave={(e) => {
                              e.target.style.background = "#FFFFFF";
                              e.target.style.color = "#8B4513";
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )} */}

                <div style={styles.formField}>
                  <label style={styles.formLabel}>Language</label>
                  <select
                    style={styles.formSelect}
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    {languageOptions.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={styles.formCheckboxRow}>
                  <input
                    type="checkbox"
                    id="useColor"
                    checked={useColor}
                    onChange={(e) => setUseColor(e.target.checked)}
                    style={styles.formCheckbox}
                  />
                  <label htmlFor="useColor" style={styles.formCheckboxLabel}>
                    Generate video with color
                  </label>
                </div>
              </div>

              {/* Error Display */}
              {error && (
                <div style={{ color: "red", marginBottom: 16, padding: 12, background: "#fee", borderRadius: 8 }}>
                  {error}
                </div>
              )}

              {/* Video Generation Result */}
              {videoGenerationResult && videoGenerationResult.status === "processing" && (
                <div style={{ marginBottom: 16, padding: 12, background: "#efe", borderRadius: 8, color: "#060" }}>
                  <strong>Video Generation Started!</strong>
                  <pre style={{ marginTop: 8, fontSize: 12, overflow: "auto", whiteSpace: "pre-wrap" }}>
{`  "job_id": "${videoGenerationResult.job_id || ""}",
  "status": "${videoGenerationResult.status || ""}",`}
                  </pre>
                </div>
              )}

              {/* Modal Footer */}
              <div style={styles.modalFooter}>
                <button style={styles.modalCancelButton} onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button
                  style={{
                    ...styles.modalGenerateButton,
                    ...((isGeneratingVideo || !golpoAIDocument) ? styles.modalGenerateButtonDisabled : {})
                  }}
                  onClick={handleGenerateVideo}
                  disabled={isGeneratingVideo || !golpoAIDocument}
                >
                  {!isGeneratingVideo && <SparklesIcon size={20} />}
                  {isGeneratingVideo ? "Generating..." : "Generate Video"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {isGeneratingVideo && !modalDismissedRef.current && (() => {
        // Check if we're on the correct page before showing modal
        const storedPageId = localStorage.getItem('golpo_video_page_id');
        const isOnCorrectPage = !storedPageId || !currentPageId || currentPageId === storedPageId;
        
        if (!isOnCorrectPage) {
          console.log("[GolpoAI] Modal not shown - on different page. Current:", currentPageId, "Stored:", storedPageId);
          return null;
        }
        
        return (
        <div style={styles.loadingOverlay}>
          <div style={styles.loadingCard}>
            {/* First stage: fetching documents / starting job (show spinner, no close) */}
            {!videoJobId && (
              <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
                <div style={styles.loadingSpinner} />
              </div>
            )}

            {/* Second stage: job created & processing (no spinner, allow close after completion) */}
            {videoJobId && videoStatusMessage === "Complete" && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  // Prevent multiple rapid clicks - check FIRST before any state changes
                  if (isClosingModalRef.current) {
                    console.log("[GolpoAI] Close already in progress, ignoring click");
                    return;
                  }
                  
                  // Set flag IMMEDIATELY to prevent any subsequent clicks
                  isClosingModalRef.current = true;
                  
                  console.log("[GolpoAI] Closing video generation modal, job ID:", videoJobId);
                  
                  // Set flags FIRST to prevent modal from reopening
                  modalDismissedRef.current = true; // Session-level flag
                  localStorage.setItem('golpo_video_modal_dismissed', 'true'); // Persist for app revisit
                  
                  // DON'T clear the interval - let polling continue in background
                  // Polling will continue but won't reopen the modal
                  
                  // Update states to close modal immediately - set both flags that control modal visibility
                  setIsGeneratingVideo(false);
                  setIsPollingVideoStatus(false);
                  setVideoStatusMessage("");
                  setVideoGenerationResult(null);
                  
                  console.log("[GolpoAI] Modal closed - polling continues in background");
                  
                  // Reset closing flag after a delay to allow state updates to complete
                  setTimeout(() => {
                    isClosingModalRef.current = false;
                  }, 500);
                }}
                style={{
                  ...styles.loadingCloseButton,
                  zIndex: 1001,
                }}
                title="Close"
                onMouseEnter={(e) => {
                  e.target.style.color = "#1e293b";
                  e.target.style.background = "#e2e8f0";
                  e.target.style.borderColor = "#cbd5e1";
                }}
                onMouseLeave={(e) => {
                  e.target.style.color = "#475569";
                  e.target.style.background = "#f8fafc";
                  e.target.style.borderColor = "#e2e8f0";
                }}
              >
                ×
              </button>
            )}
            
            <h3 style={styles.loadingTitle}>Generating your Golpo video</h3>
            <p style={styles.loadingMessage}>
              {!videoJobId
                ? "We’re fetching your page content and preparing your video request..."
                : "We’re working on your video. This may take a few minutes."}
            </p>
            <p style={styles.loadingSubtext}>
              {!videoJobId ? (
                <>
                  <strong>Please wait while we start video generation...</strong>
                </>
              ) : (
                <>
                  <strong>You can safely close this window.</strong> The video link will be automatically added to your page comments once it's ready.
                </>
              )}
            </p>
          </div>
        </div>
        );
      })()}

      {showVideoCompletionModal && (
        <div style={styles.videoReadyOverlay}>
          <div style={styles.videoCompletionCard}>
            <button
              onClick={() => {
                setShowVideoCompletionModal(false);
                setCompletedVideoUrl(null);
                clearCompletionCheckInterval();
              }}
              style={styles.modalCloseButton}
              title="Close"
              onMouseEnter={(e) => {
                e.target.style.background = "#f1f5f9";
                e.target.style.color = "#334155";
              }}
              onMouseLeave={(e) => {
                e.target.style.background = "transparent";
                e.target.style.color = "#64748b";
              }}
            >
              ×
            </button>
            <div style={styles.modalHeader}>
              <div style={styles.modalIconWrapper}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="4" width="14" height="12" rx="3" stroke="#FF4D6D" strokeWidth="2" />
                  <path
                    d="M16 10L21 6V18L16 14"
                    stroke="#FF4D6D"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2 style={styles.modalTitle}>Your video is ready!</h2>
            </div>
            <div style={styles.modalBody}>
              <p style={{ marginBottom: 8, color: "#475569", lineHeight: 1.45, fontSize: 13 }}>
                Your Golpo AI video has been generated and the link has been added to this page's comments.
              </p>
              <p style={{ marginBottom: 14, color: "#475569", lineHeight: 1.45, fontSize: 13 }}>
                You can scroll to the latest comment to view the video link, or use the buttons below.
              </p>
              <div style={styles.modalActions}>
                <button
                  style={styles.modalPrimaryButton}
                  onClick={async () => {
                    // Use completedVideoUrl or latestVideoUrl directly - same as automatic preview
                    const videoUrlToPlay = completedVideoUrl || latestVideoUrl || allVideoUrls[allVideoUrls.length - 1];
                    
                    if (!videoUrlToPlay) {
                      setCopyUrlMessage("Video URL not found. Please check the comments section.");
                      setTimeout(() => setCopyUrlMessage(""), 3000);
                      return;
                    }
                    
                    setShowVideoCompletionModal(false);
                    setIsLoadingVideo(true);
                    setError("");
                    
                    try {
                      // Check video size to decide: modal (small) or new tab (large)
                      const VIDEO_SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB threshold
                      const videoSize = await getVideoSize(videoUrlToPlay);
                      const isLargeVideo = videoSize && videoSize > VIDEO_SIZE_THRESHOLD;
                      
                      console.log(`[GolpoAI] Video size: ${videoSize ? (videoSize / (1024 * 1024)).toFixed(2) + 'MB' : 'unknown'}, isLarge: ${isLargeVideo}`);
                      
                      if (isLargeVideo) {
                        // Large video: open directly in new tab
                        console.log("[GolpoAI] Large video detected, opening directly in new tab");
                        setIsLoadingVideo(false);
                        try {
                          // Try to open in new tab
                          const newWindow = window.open(videoUrlToPlay, '_blank', 'noopener,noreferrer');
                          if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
                            // If window.open failed (blocked by popup blocker or CSP), fall back to clipboard
                            console.warn("[GolpoAI] window.open failed, falling back to clipboard");
                            copyUrlToClipboardFallback(videoUrlToPlay, false, "Large video detected. Video URL copied to clipboard. Paste in a new tab to open the video.");
                          }
                        } catch (openError) {
                          // If window.open throws an error, fall back to clipboard
                          console.warn("[GolpoAI] window.open error, falling back to clipboard:", openError);
                          copyUrlToClipboardFallback(videoUrlToPlay, false, "Large video detected. Video URL copied to clipboard. Paste in a new tab to open the video.");
                        }
                        clearCompletionCheckInterval();
                      } else {
                        // Small video: play in modal using blob URL
                        console.log("[GolpoAI] Small video detected, preparing modal playback");
                        const normalizedInfo = {
                          jobId: videoJobId,
                          videoUrl: videoUrlToPlay,
                          downloadUrl: videoUrlToPlay,
                          status: "completed",
                          raw: { video_url: videoUrlToPlay }
                        };
                        setVideoReadyInfo(normalizedInfo);
                        setLatestVideoUrl(videoUrlToPlay);
                        setShowVideoCompletionModal(false);
                        setShowVideoPlayerModal(true);
                        await prepareVideoSource(videoUrlToPlay);
                        // Ensure loading state is false so loading overlay is removed
                        setIsLoadingVideo(false);
                        setCompletedVideoUrl(null);
                        clearCompletionCheckInterval();
                      }
                    } catch (err) {
                      console.error("[GolpoAI] Open video failed:", err);
                      // On error, try to open in new tab as fallback
                      setIsLoadingVideo(false);
                      try {
                        const newWindow = window.open(videoUrlToPlay, '_blank', 'noopener,noreferrer');
                        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
                          copyUrlToClipboardFallback(videoUrlToPlay, false, "Video URL copied to clipboard. Paste in a new tab to open the video.");
                        }
                      } catch (openError) {
                        copyUrlToClipboardFallback(videoUrlToPlay, false, "Video URL copied to clipboard. Paste in a new tab to open the video.");
                      }
                      clearCompletionCheckInterval();
                    }
                  }}
                >
                  Open video
                </button>
                <button
                  style={styles.modalSecondaryButton}
                  onClick={() => {
                    setShowVideoCompletionModal(false);
                    setCompletedVideoUrl(null);
                    clearCompletionCheckInterval();
                  }}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showVideoFailureModal && (
        <div style={styles.videoReadyOverlay}>
          <div style={styles.videoReadyCard}>
            <button
              onClick={() => {
                setShowVideoFailureModal(false);
                setVideoFailureMessage("");
                clearCompletionCheckInterval();
              }}
              style={styles.modalCloseButton}
              title="Close"
            >
              ×
            </button>
            <div style={styles.modalHeader}>
              <div style={styles.modalIconWrapper}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="4" width="14" height="12" rx="3" stroke="#FF4D6D" strokeWidth="2" />
                  <path d="M16 10L21 6V18L16 14" stroke="#FF4D6D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 style={styles.modalTitle}>Video generation failed</h2>
            </div>
            <div style={styles.modalBody}>
              <p style={{ marginBottom: 12, color: "#475569", lineHeight: 1.6 }}>
                {videoFailureMessage || 'The video generation failed or timed out. You can try regenerating the video.'}
              </p>
              <div style={styles.modalActions}>
                <button
                  style={styles.modalPrimaryButton}
                  onClick={async () => {
                    setShowVideoFailureModal(false);
                    setVideoFailureMessage("");
                    // Attempt to regenerate
                    try {
                      await handleGenerateVideo();
                    } catch (err) {
                      console.error('[GolpoAI] Regenerate after failure failed:', err);
                      setError('Regeneration failed. Please try again.');
                    }
                  }}
                >
                  Regenerate
                </button>
                <button
                  style={styles.modalSecondaryButton}
                  onClick={() => {
                    setShowVideoFailureModal(false);
                    setVideoFailureMessage("");
                    clearCompletionCheckInterval();
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLowCreditsModal && (
        <div style={styles.videoReadyOverlay}>
          <div style={styles.videoReadyCard}>
            <button
              onClick={() => {
                setShowLowCreditsModal(false);
              }}
              style={styles.modalCloseButton}
              title="Close"
            >
              ×
            </button>
            <div style={styles.modalHeader}>
              <div style={styles.modalIconWrapper}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2L22 20H2L12 2Z"
                    stroke="#FF4D6D"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path d="M12 9V13" stroke="#FF4D6D" strokeWidth="2" strokeLinecap="round" />
                  <path d="M12 17H12.01" stroke="#FF4D6D" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h2 style={styles.modalTitle}>Low credits</h2>
            </div>
            <div style={styles.modalBody}>
              <p style={{ marginBottom: 12, color: "#475569", lineHeight: 1.6 }}>
                You have low credits. Video can&apos;t be generated.
              </p>
              <div style={styles.modalActions}>
                <button
                  style={styles.modalSecondaryButton}
                  onClick={() => setShowLowCreditsModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Key Configuration Modal - Removed (using admin API key from global page) */}

      {showVideoExistsModal && (
        <div style={styles.videoExistsOverlay}>
          <div style={styles.videoExistsCard}>
            <div style={styles.videoExistsHeader}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="4" width="14" height="12" rx="3" stroke="#FF4D6D" strokeWidth="2" />
                <path
                  d="M16 10L21 6V18L16 14"
                  stroke="#FF4D6D"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <h3 style={styles.videoExistsTitle}>Video Already Exists</h3>
            </div>
            <p style={styles.videoExistsMessage}>
              A video has already been generated for this context combination. You can either view the existing video or generate a new one.
            </p>
            <div style={styles.videoExistsActions}>
              <button
                style={styles.videoExistsCancelButton}
                onClick={() => setShowVideoExistsModal(false)}
              >
                Cancel
              </button>
              <button
                style={styles.videoExistsGoToButton}
                onClick={async () => {
                  setShowVideoExistsModal(false);
                   setIsLoadingVideo(true);
                   setError("");
                  
                  try {
                    // Fetch page ID using the same logic as openModal
                    let targetId = await resolvePageId();
                    
                    if (!targetId) {
                      // Try fallback methods
                      try {
                        const currentPage = await safeInvoke("getCurrentPage", {});
                        if (currentPage?.id && currentPage.id !== "unknown" && currentPage.id !== "current") {
                          targetId = currentPage.id;
                        }
                      } catch (invokeErr) {
                        if (invokeErr.message !== "INVOKE_NOT_AVAILABLE") {
                          console.warn("[GolpoAI] Go to Video: getCurrentPage failed:", invokeErr);
                        }
                      }
                      
                      if (!targetId) {
                        try {
                          const context = await getContext();
                          const pageId = extractPageIdFromContext(context);
                          if (pageId) {
                            targetId = pageId;
                          }
                        } catch (contextErr) {
                          console.warn("[GolpoAI] Go to Video: getContext() failed:", contextErr);
                        }
                      }
                      
                      if (!targetId) {
                        targetId = getPageIdFromUrl();
                      }
                    }
                    
                    if (!targetId) {
                      setError("Unable to fetch page ID. Please try again.");
                       setIsLoadingVideo(false);
                      return;
                    }
                    
                    // Fetch page content to get the latest video URL
                    const pageResponse = await safeInvoke("getPageById", { pageId: targetId });
                    const pageBody = pageResponse?.body;
                    
                    if (!pageBody) {
                      setError("Unable to fetch page content. Please try again.");
                       setIsLoadingVideo(false);
                      return;
                    }
                    
                     // Extract all video URLs from page body and comments
                     const footerResponse = await safeInvoke("getFooterComments", { pageId: targetId });
                     const footerResult = footerResponse?.body?.results || [];
                     const allUrls = extractAllVideoUrls(pageBody, footerResult);
                     
                     if (allUrls.length === 0) {
                       setError("No videos found on this page.");
                       setIsLoadingVideo(false);
                      return;
                    }
                     
                     setAllVideoUrls(allUrls);
                     // Use last video (newest since comments are added at the end)
                     const recentVideoUrl = allUrls[allUrls.length - 1];
                     setCurrentVideoIndex(allUrls.length - 1);
                    
                    // Set up video info for modal playback
                    const normalizedInfo = {
                      jobId: null,
                      videoUrl: recentVideoUrl,
                      downloadUrl: recentVideoUrl,
                      status: "completed",
                      raw: { video_url: recentVideoUrl }
                    };
                    setVideoReadyInfo(normalizedInfo);
                    setLatestVideoUrl(recentVideoUrl);
                    setShowVideoPlayerModal(true);
                    await prepareVideoSource(recentVideoUrl);
                    // Ensure loading state is false so loading overlay is removed
                    setIsLoadingVideo(false);
                  } catch (err) {
                    console.error("[GolpoAI] Go to Video failed:", err);
                    setError(err?.message || "Unable to fetch video. Please try again.");
                     setIsLoadingVideo(false);
                  }
                }}
              >
                <span style={styles.videoExistsPlayIcon}>▶</span>
                Go to Video
              </button>
              <button
                style={styles.videoExistsRegenerateButton}
                onClick={async () => {
                  setShowVideoExistsModal(false);
                  try {
                    await openModal();
                  } catch (err) {
                    console.error("[GolpoAI] Failed to open modal after regenerate:", err);
                    setError(err?.message || "Unable to open the video generator. Please try again.");
                  }
                }}
              >
                <SparklesIcon size={18} />
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Simple video player modal with Close, Copy URL, and Download buttons */}
      {showVideoPlayerModal && videoReadyInfo?.videoUrl && (
        <div style={styles.videoReadyOverlay}>
          <div style={styles.videoPlayerCard}>
            <button
              style={styles.videoReadyCloseButton}
              onClick={() => {
                // Close modal and clean up video state
                cleanupVideoObjectUrl();
                setShowVideoPlayerModal(false);
                setIsLoadingVideo(false);
                setIsVideoTooLarge(false);
                setVideoPlayerUrl(null);
              }}
              aria-label="Close video"
            >
              ×
            </button>
            <h3 style={styles.videoReadyTitle}>Golpo AI Video</h3>

            <div style={styles.videoModalBody}>
              {isVideoTooLarge ? (
                <>
                  <p style={styles.videoModalMessage}>
                    This video is ready, but it’s too large to play inside this window.
                  </p>
                  {videoReadyInfo?.videoUrl && (
                    <a
                      href={videoReadyInfo.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.videoModalLink}
                      onClick={(e) => {
                        // Require Ctrl+Click (or Cmd+Click) to open in a new tab.
                        // Plain click shows a helpful hint instead.
                        if (!e.ctrlKey && !e.metaKey) {
                          e.preventDefault();
                          setCopyUrlMessage("Press Ctrl+Click (or ⌘+Click on Mac) to open the video.");
                          setTimeout(() => setCopyUrlMessage(""), 3000);
                        }
                      }}
                    >
                      Open video in a new tab
                    </a>
                  )}
                </>
              ) : videoPlayerUrl ? (
                <video
                  id="modal-video-player"
                  key={videoPlayerUrl}
                  ref={videoElementRef}
                  style={styles.videoPreview}
                  src={videoPlayerUrl}
                  controls
                  autoPlay
                  preload="auto"
                  crossOrigin="anonymous"
                  playsInline
                  onLoadStart={() => {
                    console.log("[GolpoAI] Modal video load started, URL:", videoPlayerUrl);
                    setIsLoadingVideo(true);
                  }}
                  onLoadedMetadata={async (e) => {
                    const video = e.target;
                    console.log("[GolpoAI] Modal video metadata loaded, dimensions:", video.videoWidth, "x", video.videoHeight);
                    if (video.videoWidth && video.videoHeight) {
                      const isLandscape = video.videoWidth > video.videoHeight;
                      setVideoOrientation(isLandscape ? "landscape" : "portrait");
                    }
                    setIsLoadingVideo(false);
                    try {
                      console.log("[GolpoAI] Attempting to auto-play modal video");
                      await video.play();
                      console.log("[GolpoAI] ✅ Modal video is now playing");
                    } catch (playError) {
                      console.warn("[GolpoAI] Modal auto-play was prevented:", playError);
                    }
                  }}
                  onCanPlay={async () => {
                    console.log("[GolpoAI] Modal video can play");
                    setIsLoadingVideo(false);
                    const video = videoElementRef.current || document.getElementById("modal-video-player");
                    if (video && video.paused) {
                      try {
                        await video.play();
                        console.log("[GolpoAI] ✅ Modal video started playing on canPlay");
                      } catch (playError) {
                        console.log("[GolpoAI] Modal play was prevented, user can click play");
                      }
                    }
                  }}
                  onError={(e) => {
                    const video = e.target;
                    const error = video?.error;
                    const currentSrc = video?.src || videoPlayerUrl;
                    let errorMessage = "Unknown error";
                    if (error) {
                      switch (error.code) {
                        case error.MEDIA_ERR_ABORTED:
                          errorMessage = "Video playback aborted";
                          break;
                        case error.MEDIA_ERR_NETWORK:
                          errorMessage = "Network error while loading video";
                          break;
                        case error.MEDIA_ERR_DECODE:
                          errorMessage = "Video decoding error";
                          break;
                        case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                          errorMessage = "Video format not supported";
                          break;
                        default:
                          errorMessage = `Video error code: ${error.code}`;
                      }
                    }
                    console.warn(`[GolpoAI] Modal video element error: ${errorMessage}`, {
                      src: currentSrc?.substring(0, 100),
                      errorCode: error?.code,
                    });
                    setIsLoadingVideo(false);
                    setIsVideoTooLarge(true);
                  }}
                />
              ) : (
                <div style={styles.videoModalLoading}>
                  <h4 style={styles.loadingTitle}>Preparing your video</h4>
                  <p style={styles.loadingMessage}>Please wait while we load your video...</p>
                </div>
              )}
            </div>

            <div style={styles.videoReadyActions}>
              <button
                style={styles.videoReadySecondaryButton}
                onClick={handleDownloadVideo}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global toast for copy/download messages */}
      {copyUrlMessage && (
        <div style={styles.copyUrlToast}>
          {copyUrlMessage}
        </div>
      )}
    </>
  );
}

export default App;

/* ------------------------ STYLE SYSTEM ------------------------ */
const styles = {
  page: {
    fontFamily: "Segoe UI, sans-serif",
    padding: "12px",
    background: "#ffffff",
    width: "100%",
    maxWidth: "100%",
    height: "100%",
    minHeight: "100%",
    maxHeight: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "auto",
    margin: 0,
    boxSizing: "border-box",
    position: "relative",
  },
  closeButton: {
    position: "absolute",
    top: 6,
    right: 6,
    background: "transparent",
    border: "none",
    fontSize: "24px",
    cursor: "pointer",
    fontWeight: 600,
  },
  heroContainer: { marginBottom: 4, flexShrink: 0 },
  heroCard: {
    background: "linear-gradient(to right,  #cac6caff, #f5bdc4ff, #fff7ed)",
    padding: "10px 14px",
    borderRadius: "18px",
  },
  latestVideoCard: {
    borderRadius: 16,
    border: "1px solid #d6c9ff",
    background: "#f8f5ff",
    padding: "8px 10px",
    marginBottom: 10,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  latestVideoPlayerWrapper: {
    marginTop: 8,
  },
  latestVideoHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  latestVideoTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: "#2B1F35",
  },
  latestVideoSubtitle: {
    margin: "0 0 2px 0",
    fontSize: 14,
    color: "#5f4b8b",
  },
  // "Recently generated video: Open Video" row (link-style button)
  latestVideoRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "nowrap",
    whiteSpace: "nowrap",
  },
  latestVideoLabel: {
    fontSize: "14px",
    fontWeight: 700,
    margin: 0,
    color: "#111827",
    whiteSpace: "nowrap",
  },
  latestVideoLinkButton: {
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    color: "#0066cc",
    textDecoration: "underline",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
    lineHeight: 1.2,
    fontFamily: "inherit",
    outline: "none",
    boxShadow: "none",
    appearance: "none",
    WebkitAppearance: "none",
    whiteSpace: "nowrap",
  },
  latestVideoBadge: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    padding: "4px 10px",
    borderRadius: 999,
    background: "#e0d4ff",
    color: "#3b2d71",
  },
  latestVideoUrl: {
    margin: 0,
    fontFamily: "monospace",
    fontSize: 13,
    background: "#fff",
    borderRadius: 10,
    border: "1px solid #e0d7ff",
    padding: "10px 12px",
    wordBreak: "break-all",
    color: "#3b2d71",
  },
  latestVideoUrlLink: {
    color: "#0066cc",
    textDecoration: "underline",
    fontSize: 13,
    wordBreak: "break-all",
    fontFamily: "monospace",
    cursor: "pointer",
    pointerEvents: "auto",
    position: "relative",
    zIndex: 10,
    display: "inline-block",
  },
  latestVideoTooLargeMessage: {
    marginTop: 8,
    fontSize: 13,
    color: "#6c757d",
  },
  videoModalBody: {
    marginTop: 16,
  },
  videoModalLoading: {
    padding: "24px 16px",
    textAlign: "center",
  },
  videoModalMessage: {
    padding: "16px 12px",
    textAlign: "center",
    fontSize: 14,
    color: "#475569",
  },
  videoModalLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    fontSize: 14,
    color: "#2563eb",
    textDecoration: "underline",
    cursor: "pointer",

    // Make a <button> look like a link (so click can call window.open without Ctrl)
    background: "transparent",
    border: "none",
    padding: 0,
    fontFamily: "inherit",
  },
  videoModalPlayButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    padding: "10px 16px",
    borderRadius: 999,
    border: "1px solid #7C3AED",
    background: "#7C3AED",
    color: "#ffffff",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 10px 20px rgba(124, 58, 237, 0.18)",
  },
  latestVideoActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  },
  latestVideoPrimaryButton: {
    padding: "10px 18px",
    borderRadius: 999,
    border: "none",
    background: "linear-gradient(120deg, #2B1F35 0%, #FF4D6D 100%)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 8px 16px rgba(43, 31, 53, 0.2)",
  },
  latestVideoSecondaryButton: {
    padding: "10px 18px",
    borderRadius: 999,
    border: "1px solid #d0c4ff",
    background: "#fff",
    color: "#3b2d71",
    fontWeight: 600,
    cursor: "pointer",
  },
  latestVideoPlayButton: {
    padding: "10px 18px",
    borderRadius: 999,
    border: "none",
    background: "linear-gradient(120deg, #FF4D6D 0%, #FF8FA3 100%)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(255, 77, 109, 0.3)",
    transition: "all 0.2s ease",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  heroContent: { display: "flex", alignItems: "center", gap: 12 },
  logo: {
    width: 52,
    height: 52,
    borderRadius: 14,
    objectFit: "cover",
  },
  heroTitle: { fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.2px" },

  scrollArea: {
    marginTop: 12,
    overflowY: "auto",
    overflowX: "hidden",
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    paddingBottom: 4,
  },

  helpHeading: { fontSize: 16, marginBottom: 2, marginTop: 0, flexShrink: 0, fontWeight: 700, color: "#1e293b", lineHeight: 1.25 },
  mainHeading: { fontSize: 14, marginBottom: 6, marginTop: 0, flexShrink: 0, fontWeight: 400, color: "#1e293b", lineHeight: 1.35 },
  sectionHeading: { fontSize: 16, marginBottom: 2, marginTop: 0, flexShrink: 0, fontWeight: 650, lineHeight: 1.25 },
  sectionDescription: { fontSize: 13, color: "#555", marginBottom: 8, flexShrink: 0, marginTop: 0, lineHeight: 1.35 },
  contentSection: { marginBottom: 4, flexShrink: 0 },

  actionList: { display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 },
  actionButton: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ececec",
    cursor: "pointer",
    background: "#fff",
    transition: "all .2s",
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 500,
  },
  actionButtonActive: {
    background: "linear-gradient(90deg, #f6f3ff, #fdf6ff)",
    borderColor: "#d1b7ff",
  },

  actionIconWrapper: {
    width: 28,
    height: 28,
    borderRadius: 10,
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

  textareaLabel: { fontSize: 14, marginBottom: 8, display: "block", flexShrink: 0, marginTop: 0, fontWeight: 600, color: "#111827" },
  textarea: {
    width: "100%",
    height: 96,
    minHeight: 96,
    maxHeight: 96,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #ddd",
    background: "#f8f9ff",
    resize: "none",
    flexShrink: 0,
    fontFamily: "inherit",
    fontSize: 14,
    boxSizing: "border-box",
  },
  textareaFooter: {
    marginTop: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0,
    fontSize: 13,
  },

  generateButton: {
    padding: "10px 24px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  },
  generateButtonActive: {
    background: "linear-gradient(120deg, #2B1F35 0%, #FF4D6D 55% 100%)",
    color: "#fff",
    boxShadow: "none",
  },
  generateButtonDisabled: {
    background: "linear-gradient(120deg, #C9C7D1 0%, #F7D8E1 100%)",
    cursor: "not-allowed",
    color: "rgba(255,255,255,0.9)",
    boxShadow: "none",
  },
  generateButtonIconWrapper: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "inherit",
  },
  generateButtonIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
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
    width: 360,
    maxWidth: "80vw",
    maxHeight: "85vh",
    background: "#fff",
    padding: 18,
    borderRadius: 16,
    boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
    position: "relative",
    overflowY: "auto",
  },
  modalLoaderOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(255, 255, 255, 0.95)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    zIndex: 10,
  },
  modalLoaderSpinner: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "4px solid rgba(124, 58, 237, 0.2)",
    borderTopColor: "#7C3AED",
    animation: "golpo-spin 1s linear infinite",
    marginBottom: 12,
  },
  modalLoaderText: {
    margin: 0,
    fontSize: 14,
    color: "#64748b",
    fontWeight: 500,
  },
  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  modalIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  modalTitle: {
    fontSize: 18,
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
    marginBottom: 16,
  },
  formRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginBottom: 12,
  },
  formField: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: 500,
    color: "#334155",
  },
  formHelperText: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 6,
    marginBottom: 0,
  },
  formInput: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#fff",
    fontSize: 14,
    color: "#1e293b",
    fontFamily: "inherit",
    outline: "none",
    transition: "border-color 0.2s",
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
    gap: 8,
    marginTop: 12,
    marginBottom: 6,
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
    paddingTop: 16,
    borderTop: "1px solid #e2e8f0",
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 16,
  },
  modalPrimaryButton: {
    padding: "10px 20px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(120deg, #2B1F35 0%, #FF4D6D 100%)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14,
    transition: "all 0.2s",
  },
  modalSecondaryButton: {
    padding: "10px 20px",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    background: "#fff",
    color: "#3b2d71",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14,
    transition: "all 0.2s",
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
    padding: "12px 30px",
    background: "linear-gradient(120deg, #2B1F35 0%, #FF4D6D 55%, #FF9FB0 100%)",
    color: "#fff",
    borderRadius: 999,
    cursor: "pointer",
    border: "none",
    fontSize: 15,
    fontWeight: 600,
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    display: "flex",
    alignItems: "center",
    gap: 12,
    boxShadow: "none",
  },
  modalGenerateButtonDisabled: {
    background: "linear-gradient(120deg, #C9C7D1 0%, #F7D8E1 100%)",
    cursor: "not-allowed",
    fontSize: 15,
    fontWeight: 600,
    border: "none",
    display: "flex",
    alignItems: "center",
    gap: 12,
    transition: "all 0.2s",
    boxShadow: "none",
    color: "rgba(255,255,255,0.9)",
  },
  loadingOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "rgba(15, 23, 42, 0.85)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 1000,
    color: "#000",
    textAlign: "center",
  },
  loadingCard: {
    background: "white",
    borderRadius: 20,
    padding: "24px 28px",
    maxWidth: 350,
    width: "85%",
    boxShadow: "0 20px 40px rgba(0, 0, 0, 0.15)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    border: "1px solid #e5e7eb",
    position: "relative",
  },
  loadingSpinner: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "4px solid rgba(255, 77, 109, 0.2)",
    borderTopColor: "#FF4D6D",
    animation: "golpo-spin 1s linear infinite",
    margin: "0 auto 12px", // center horizontally and add bottom spacing
  },
  loadingEmoji: { fontSize: 40, marginBottom: 12 },
  loadingTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: "#000" },
  loadingMessage: { marginTop: 10, fontSize: 14, color: "#000", fontWeight: 600, minHeight: "20px" },
  loadingJobId: { marginTop: 8, fontSize: 13, color: "#475569", opacity: 0.9, fontWeight: 700 },
  loadingSubtext: { marginTop: 12, fontSize: 12, color: "#475569", opacity: 0.8, fontWeight: 700 },
  loadingCloseButton: {
    position: "absolute",
    top: 12,
    right: 12,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    fontSize: 24,
    color: "#475569",
    cursor: "pointer",
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    transition: "all 0.2s",
    lineHeight: 1,
    padding: 0,
    fontWeight: 400,
    zIndex: 1000,
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
  },
  loadingCloseButtonHover: {
    background: "#f1f5f9",
    color: "#334155",
  },
  modalCloseButton: {
    position: "absolute",
    top: 16,
    right: 16,
    background: "transparent",
    border: "none",
    fontSize: 28,
    color: "#64748b",
    cursor: "pointer",
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    transition: "all 0.2s",
    lineHeight: 1,
    padding: 0,
  },
  videoReadyOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "rgba(15, 23, 42, 0.65)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 1001,
  },
  videoReadyCard: {
    background: "#fff",
    borderRadius: 20,
    padding: "20px 24px",
    maxWidth: 600,
    width: "90%",
    maxHeight: "85vh",
    overflowY: "auto",
    boxShadow: "0 25px 55px rgba(15, 23, 42, 0.25)",
    position: "relative",
    textAlign: "left",
  },
  // Smaller card used only for the "Your video is ready!" completion popup
  videoCompletionCard: {
    background: "#fff",
    borderRadius: 18,
    padding: "16px 18px",
    maxWidth: 520,
    width: "90%",
    maxHeight: "75vh",
    overflowY: "auto",
    boxShadow: "0 22px 45px rgba(15, 23, 42, 0.22)",
    position: "relative",
    textAlign: "left",
  },
  // Smaller card used only for the "Golpo AI Video" player modal (keeps other popups unchanged)
  videoPlayerCard: {
    background: "#fff",
    borderRadius: 18,
    padding: "14px 16px",
    maxWidth: 420,
    width: "88%",
    maxHeight: "70vh",
    overflowY: "auto",
    boxShadow: "0 22px 45px rgba(15, 23, 42, 0.22)",
    position: "relative",
    textAlign: "left",
  },
  videoReadyCloseButton: {
    position: "absolute",
    top: 16,
    right: 16,
    border: "1px solid #dc2626",
    background: "#fecaca",
    color: "#dc2626",
    fontSize: 14,
    fontWeight: 600,
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
    zIndex: 1000,
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
  },
  videoReadyTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: "#0f172a",
  },
  videoReadyMeta: {
    marginTop: 8,
    fontSize: 13,
    color: "#475569",
  },
  videoNavigation: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 16,
    marginBottom: 8,
    padding: "12px 16px",
    background: "#f8f9fa",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
  },
  videoNavButton: {
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid #7C3AED",
    background: "linear-gradient(120deg, #2B1F35 0%, #FF4D6D 100%)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14,
    transition: "opacity 0.2s",
  },
  videoNavButtonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
    background: "#e2e8f0",
    borderColor: "#cbd5e1",
    color: "#94a3b8",
  },
  videoNavCounter: {
    fontSize: 14,
    fontWeight: 600,
    color: "#475569",
    flex: 1,
    textAlign: "center",
  },
  videoPreview: {
    width: "100%",
    maxWidth: "100%",
    marginTop: 16,
    borderRadius: 16,
    background: "#000",
    objectFit: "contain", // Show full video without cropping
    aspectRatio: "16 / 9", // Fixed 16:9 aspect ratio
  },
  videoReadyActions: {
    marginTop: 18,
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "flex-end",
  },
  copyUrlToast: {
    position: "fixed",
    right: 24,
    bottom: 24,
    background: "#111827",
    color: "#f9fafb",
    padding: "8px 14px",
    borderRadius: 999,
    fontWeight: 500,
    textAlign: "center",
    fontSize: 12,
    zIndex: 9999,
    boxShadow: "0 4px 10px rgba(15,23,42,0.3)",
  },
  videoReadyPrimaryButton: {
    flex: "none",
    minWidth: 90,
    maxWidth: 160,
    padding: "8px 14px",
    borderRadius: 999,
    border: "none",
    background: "linear-gradient(120deg, #2B1F35 0%, #FF4D6D 100%)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 12px 24px rgba(43, 31, 53, 0.25)",
  },
  videoActionDisabled: {
    cursor: "not-allowed",
    opacity: 0.5,
    pointerEvents: "none",
  },
  videoReadySecondaryButton: {
    flex: "none",
    minWidth: 90,
    maxWidth: 160,
    padding: "8px 14px",
    borderRadius: 999,
    border: "1px solid #2B1F35",
    background: "#fff",
    color: "#2B1F35",
    fontWeight: 600,
    cursor: "pointer",
  },
  videoReadyDebug: {
    marginTop: 16,
    background: "#f8fafc",
    borderRadius: 12,
    padding: 12,
    maxHeight: 220,
    overflow: "auto",
    fontSize: 12,
  },
  videoExistsOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "rgba(15, 23, 42, 0.65)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 1001,
  },
  videoExistsCard: {
    background: "#fff",
    borderRadius: 20,
    padding: "20px 24px",
    maxWidth: 400,
    width: "90%",
    boxShadow: "0 25px 55px rgba(15, 23, 42, 0.25)",
    position: "relative",
  },
  videoExistsHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  videoExistsIcon: {
    fontSize: 24,
    color: "#ffff",
  },
  videoExistsTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: "#0f172a",
  },
  videoExistsMessage: {
    margin: "0 0 24px 0",
    fontSize: 15,
    color: "#475569",
    lineHeight: 1.5,
  },
  videoExistsActions: {
    display: "flex",
    gap: 12,
    justifyContent: "flex-end",
  },
  videoExistsCancelButton: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#475569",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14,
  },
  videoExistsGoToButton: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "1px solid #ef4444",
    background: "#fff",
    color: "#ef4444",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  videoExistsPlayIcon: {
    fontSize: 12,
  },
  videoExistsRegenerateButton: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "none",
    background: "linear-gradient(120deg, #2B1F35 0%, #FF4D6D 100%)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    gap: 6,
    boxShadow: "0 4px 12px rgba(43, 31, 53, 0.3)",
  },
};

// const buildVideoSectionHtml = (videoUrl) => {
//   const safeUrl = videoUrl || "";
//   const escapedUrl = escapeHtml(safeUrl);
//   const escapedUrlForJs = escapeJsString(safeUrl);

//   return `<!-- GOLPO_AI_VIDEO_SECTION_START -->
// <div style="background: #E8F5E9; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #C8E6C9;">
//   <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px;">
//     <div style="width: 48px; height: 48px; background: #A5D6A7; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
//       <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <rect x="3" y="5" width="14" height="12" rx="2" fill="#FFFFFF"/>
//         <path d="M17 10L21 7V17L17 14V10Z" fill="#FFFFFF"/>
//       </svg>
//     </div>
//     <div style="flex: 1;">
//       <p style="margin: 0; font-size: 14px; color: #2E7D32; line-height: 1.4;">
//         A video explanation has been generated for this page using Golpo AI.
//       </p>
//        <p style="margin: 0; fontSize: 14px; color: #424242; word-break: break-all; font-family: monospace;">
//       <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" style="color: #424242; text-decoration: underline; cursor: pointer;">${escapedUrl}</a>
//     </p>
//     </div>
//   </div>

//   <div style="display: flex; gap: 12px; flex-wrap: wrap;">
//     <button onclick="(function(){const url='${escapedUrlForJs}';if(navigator.clipboard){navigator.clipboard.writeText(url).then(()=>alert('Link copied to clipboard!')).catch(()=>{const el=document.createElement('textarea');el.value=url;el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);el.select();document.execCommand('copy');document.body.removeChild(el);alert('Link copied to clipboard!')})}else{const el=document.createElement('textarea');el.value=url;el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);el.select();document.execCommand('copy');document.body.removeChild(el);alert('Link copied to clipboard!')}})()" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; background: #2E7D32; color: #FFFFFF; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#1B5E20'" onmouseout="this.style.background='#2E7D32'">
//       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
//         <rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
//       </svg>
//       Copy URL
//     </button>

//     <button onclick="(function(){const url='${escapedUrlForJs}';const link=document.createElement('a');link.href=url;link.download='golpo-video.mp4';link.style.display='none';document.body.appendChild(link);link.click();setTimeout(()=>document.body.removeChild(link),100)})()" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; background: #FFFFFF; color: #2E7D32; border: 1px solid #A5D6A7; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#F1F8E9'" onmouseout="this.style.background='#FFFFFF'">
//       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M8 11V2M8 11L5 8M8 11L11 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
//         <path d="M2 13H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
//       </svg>
//       Play Video
//     </button>

    
//   </div>
// </div>
// <!-- GOLPO_AI_VIDEO_SECTION_END -->`;
// };

const buildCommentBodyHtml = (videoUrl) => {
  const safeUrl = escapeHtml(videoUrl || "");

  return `<div style="background: #E8F5E9; border-radius: 8px; padding: 16px; border: 1px solid #C8E6C9;">
  <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 700; color: #1B5E20;">🎬 Golpo AI Video Generated</p>
  <p style="margin: 0; font-size: 14px; color: #2E7D32;">Video URL: <a href="${safeUrl}" style="color: #2E7D32; text-decoration: underline;">${safeUrl}</a></p>
</div>`;
};

