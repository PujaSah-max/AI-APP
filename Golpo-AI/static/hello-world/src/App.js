import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke, view, getContext } from "@forge/bridge";
import golpoIcon from "./static/golpo-logo.png";
import VideoIcon from "./components/VideoIcon";

const APP_TITLE = "Golpo AI";
const APP_TAGLINE = "Generate engaging videos from your Confluence page";

const quickActions = ["Whiteboard explainer video of Confluence page"];
const VIDEO_STATUS_POLL_INTERVAL = 5000; // ms

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

    console.warn("[GolpoAI] Could not extract page ID from URL or document");
  } catch (e) {
    console.warn("[GolpoAI] Error extracting page ID from URL:", e);
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
  const [music, setMusic] = useState("engaging");
  const [style, setStyle] = useState("");

  // Detect if we're in contentBylineItem (no resolver available)
  const [isBylineItem, setIsBylineItem] = useState(false);

  // Your logic preserved 👇
  const [pages, setPages] = useState([]);
  const [documentPayload, setDocumentPayload] = useState(null);
  const [footerComments, setFooterComments] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [golpoAIDocument, setGolpoAIDocument] = useState(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoGenerationResult, setVideoGenerationResult] = useState(null);
  const [isPollingVideoStatus, setIsPollingVideoStatus] = useState(false);
  const [videoJobId, setVideoJobId] = useState(null);
  const [videoStatusMessage, setVideoStatusMessage] = useState("");
  const [videoReadyInfo, setVideoReadyInfo] = useState(null);
  const [showVideoReadyModal, setShowVideoReadyModal] = useState(false);
  const [copyUrlMessage, setCopyUrlMessage] = useState("");
  const [videoPlayerUrl, setVideoPlayerUrl] = useState(null);

  const maxChars = 500;
  const videoStatusTimerRef = useRef(null);
  const videoObjectUrlRef = useRef(null);
  const videoElementRef = useRef(null);
  const cleanupVideoObjectUrl = useCallback(() => {
    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current);
      videoObjectUrlRef.current = null;
    }
    setVideoPlayerUrl(null);
  }, []);

  const prepareVideoSource = useCallback(
    async (url) => {
      cleanupVideoObjectUrl();
      if (!url) {
        return;
      }

      // Always use backend resolver for contentAction module to bypass CSP
      if (!isBylineItem) {
        try {
          const backendResponse = await safeInvoke("fetchVideoFile", { videoUrl: url });
          if (backendResponse?.base64Data) {
            const blob = base64ToBlob(backendResponse.base64Data, backendResponse.contentType || "video/mp4");
            const objectUrl = URL.createObjectURL(blob);
            videoObjectUrlRef.current = objectUrl;
            setVideoPlayerUrl(objectUrl);
            console.log("[GolpoAI] prepareVideoSource: Successfully created blob URL from backend fetch");
            return;
          } else {
            console.warn("[GolpoAI] prepareVideoSource: Backend response missing base64Data");
          }
        } catch (invokeError) {
          console.error("[GolpoAI] prepareVideoSource: Backend fetch failed - cannot use direct URL due to CSP:", invokeError);
          // Don't fall back to direct URL - it will violate CSP
          // Instead, show error to user or use alternative method
          setCopyUrlMessage("Unable to load video. Please try downloading or opening in new tab.");
          setTimeout(() => setCopyUrlMessage(""), 5000);
          return;
        }
      }

      // For bylineItem, we can't use backend resolver, so we can't load video
      // Just store the URL for copy/download purposes
      console.warn("[GolpoAI] prepareVideoSource: contentBylineItem module - video playback not available");
      setVideoPlayerUrl(null);
    },
    [cleanupVideoObjectUrl, safeInvoke, isBylineItem]
  );


  useEffect(() => {
    return () => {
      if (videoStatusTimerRef.current) {
        clearTimeout(videoStatusTimerRef.current);
      }
      cleanupVideoObjectUrl();
    };
  }, [cleanupVideoObjectUrl]);

  const clearVideoStatusTimer = useCallback(() => {
    if (videoStatusTimerRef.current) {
      clearTimeout(videoStatusTimerRef.current);
      videoStatusTimerRef.current = null;
    }
  }, []);

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
  const keywords = ["failed", "error", "cancelled", "denied", "rejected"];
  return keywords.some((keyword) => normalized.includes(keyword));
};

  const handleVideoReady = useCallback(
    (statusPayload, jobId = null) => {
      if (!statusPayload) {
        return;
      }

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
      prepareVideoSource(videoUrl);
      setShowVideoReadyModal(true);
    },
    [clearVideoStatusTimer, videoJobId, prepareVideoSource]
  );

  const pollVideoStatus = useCallback(
    async (jobId, attempt = 0) => {
      if (!jobId) {
        return;
      }

      setVideoStatusMessage("Generating video...");

      try {
        const response = await safeInvoke("getVideoStatus", { jobId });
        const statusPayload = response?.body || response;
        const status =
          statusPayload?.status ||
          statusPayload?.data?.status ||
          statusPayload?.job_status ||
          statusPayload?.state ||
          "";

        console.log("[GolpoAI] pollVideoStatus response:", statusPayload);

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
          setError("Video generation failed. Please try again.");
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
      }
    },
    [clearVideoStatusTimer, handleVideoReady, safeInvoke]
  );

  const startVideoStatusPolling = useCallback(
    (jobId) => {
      if (!jobId) {
        return;
      }

      clearVideoStatusTimer();
      setVideoJobId(jobId);
      setIsPollingVideoStatus(true);
      setVideoStatusMessage("Your Golpo video is being generated...");
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

  const openInNewTab = (url) => {
    if (!url) {
      return;
    }
    
    // Try window.open first (requires allow-popups sandbox permission)
    try {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (opened) {
        return; // Successfully opened
      }
    } catch (error) {
      console.log("[GolpoAI] window.open blocked, trying link element fallback:", error);
    }
    
    // Fallback: Create a link element and click it
    // This works even without popup permissions for downloads/new tabs
    try {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
      }, 100);
    } catch (fallbackError) {
      console.error("[GolpoAI] Unable to open URL in new tab:", fallbackError);
      // Last resort: Copy URL to clipboard and show message
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
          setCopyUrlMessage("URL copied to clipboard. Please paste in a new tab.");
          setTimeout(() => setCopyUrlMessage(""), 5000);
        }).catch(() => {
          setCopyUrlMessage(`Please copy this URL manually: ${url}`);
          setTimeout(() => setCopyUrlMessage(""), 10000);
        });
      } else {
        setCopyUrlMessage(`Please copy this URL manually: ${url}`);
        setTimeout(() => setCopyUrlMessage(""), 10000);
      }
    }
  };

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

  const handlePlayVideo = useCallback(
    (url) => {
      if (!requireContentActionForMedia("play the video")) {
        return;
      }

      const targetUrl = url || videoPlayerUrl || videoReadyInfo?.videoUrl;
      if (!targetUrl) {
        console.warn("[GolpoAI] No video URL provided for play");
        setCopyUrlMessage("Video URL not available to play");
        setTimeout(() => setCopyUrlMessage(""), 4000);
        return;
      }

      const element = videoElementRef.current;
      if (element) {
        element.currentTime = 0;
        const playPromise = element.play();
        if (playPromise?.catch) {
          playPromise.catch((err) => {
            console.warn("[GolpoAI] Could not play video in modal, opening in new tab:", err);
            openInNewTab(targetUrl);
          });
        }
      } else {
        openInNewTab(targetUrl);
      }
    },
    [videoReadyInfo, videoPlayerUrl, requireContentActionForMedia]
  );

  const handleDownloadVideo = useCallback(async () => {
    if (!requireContentActionForMedia("download the video")) {
      return;
    }

    const remoteUrl = videoReadyInfo?.downloadUrl || videoReadyInfo?.videoUrl;
    if (!remoteUrl) {
      console.warn("[GolpoAI] No video URL provided for download");
      setCopyUrlMessage("Video URL not available to download");
      setTimeout(() => setCopyUrlMessage(""), 4000);
      return;
    }

    const triggerDownload = (blobOrUrl) => {
      const link = document.createElement("a");
      link.href = blobOrUrl;
      link.download = `golpo-video-${videoReadyInfo?.jobId || Date.now()}.mp4`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        if (blobOrUrl.startsWith("blob:")) {
          URL.revokeObjectURL(blobOrUrl);
        }
      }, 100);
    };

    if (videoPlayerUrl && videoPlayerUrl.startsWith("blob:")) {
      triggerDownload(videoPlayerUrl);
      return;
    }

    try {
      const backendResponse = await safeInvoke("fetchVideoFile", { videoUrl: remoteUrl });
      if (backendResponse?.base64Data) {
        const blob = base64ToBlob(backendResponse.base64Data, backendResponse.contentType || "video/mp4");
        const blobUrl = URL.createObjectURL(blob);
        triggerDownload(blobUrl);
        console.log("[GolpoAI] Download successful via backend fetch");
        return;
      } else {
        console.warn("[GolpoAI] Backend response missing base64Data");
      }
    } catch (invokeError) {
      console.error("[GolpoAI] Backend download fetch failed:", invokeError);
      // Don't try direct download - it will violate CSP
      // Instead, open in new tab as fallback
      setCopyUrlMessage("Download unavailable. Opening video in new tab...");
      setTimeout(() => {
        setCopyUrlMessage("");
        openInNewTab(remoteUrl);
      }, 2000);
      return;
    }

    // If we reach here, backend fetch didn't return expected data
    console.warn("[GolpoAI] Unable to download via backend, opening in new tab");
    setCopyUrlMessage("Opening video in new tab for download...");
    setTimeout(() => {
      setCopyUrlMessage("");
      openInNewTab(remoteUrl);
    }, 1000);
  }, [videoPlayerUrl, videoReadyInfo, safeInvoke, requireContentActionForMedia]);

  const closeVideoReadyModal = () => {
    cleanupVideoObjectUrl();
    setShowVideoReadyModal(false);
    setVideoReadyInfo(null);
  };

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

        // For contentBylineItem, prioritize getContext() first
        if (isBylineItem) {
          try {
            console.log("[GolpoAI] fetchPageInfo: contentBylineItem - trying getContext()");
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
            } else {
              console.warn("[GolpoAI] fetchPageInfo: getContext() returned but no page ID found, trying URL");
            }
          } catch (contextErr) {
            console.warn("[GolpoAI] fetchPageInfo: getContext() failed, trying URL:", contextErr);
          }
          
          // If getContext() didn't provide page ID, try URL parsing
          if (!pageInfo || !pageInfo.id) {
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
            console.log("[GolpoAI] getCurrentPage response (attempt " + (retryCount + 1) + "):", pageInfo);
          } catch (invokeError) {
            console.warn("[GolpoAI] invoke('getCurrentPage') failed, falling back to getContext():", invokeError);
            // Fallback to getContext()
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
            const fullPageInfo = (await safeInvoke("getPageById", { pageId: pageInfo.id }))?.body;

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
          // Don't set error here - page might be available when user clicks Generate Video
          setPages([]);
          // Only set error if we've exhausted all retries
          if (retryCount >= 2) {
            console.log("[GolpoAI] All retries exhausted, page ID will be fetched when Generate Video is clicked");
          }
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

  // Handle video generation
  const handleGenerateVideo = async () => {
    if (!golpoAIDocument) {
      setError("Document is not ready. Please try again.");
      return;
    }

    setIsGeneratingVideo(true);
    setIsPollingVideoStatus(false);
    setError("");
    setVideoGenerationResult(null);
    setVideoStatusMessage("Contacting Golpo AI to generate your video...");

    try {
      console.log("[GolpoAI] handleGenerateVideo: Starting video generation");
      console.log("[GolpoAI] handleGenerateVideo: Document:", golpoAIDocument);
      console.log("[GolpoAI] handleGenerateVideo: Video specs:", {
        duration,
        voice,
        language,
        includeLogo,
      });

      // Prepare video specifications with all parameters
      const videoSpecs = {
        duration: duration,
        voice: voice,
        language: language,
        includeLogo: includeLogo,
        music: music,
        style: style,
        selectedQuickAction: description || (selectedAction !== null ? quickActions[selectedAction] : null),
      };

      // Call backend to generate video
      const response = await safeInvoke("generateVideo", {
        document: golpoAIDocument,
        videoSpecs: videoSpecs,
        description: description,
      });

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

      if (generatedJobId) {
        console.log("[GolpoAI] handleGenerateVideo: Job id detected", generatedJobId);
        startVideoStatusPolling(generatedJobId);
      } else if (immediateVideoUrl) {
        console.log("[GolpoAI] handleGenerateVideo: Video URL returned immediately");
        handleVideoReady(responseBody);
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

            {/* Error Display */}
            {error && (
              <div style={{ color: "red", marginBottom: 16, padding: 12, background: "#fee", borderRadius: 8 }}>
                {error}
              </div>
            )}

            {/* Video Generation Result */}
            {videoGenerationResult && (
              <div style={{ marginBottom: 16, padding: 12, background: "#efe", borderRadius: 8, color: "#060" }}>
                <strong>Video Generation Started!</strong>
                <pre style={{ marginTop: 8, fontSize: 12, overflow: "auto" }}>
                  {JSON.stringify(videoGenerationResult, null, 2)}
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
                {isGeneratingVideo ? "Generating..." : "✨ Generate Video"}
              </button>
            </div>
          </div>
        </div>
      )}
              </div>

    {(isGeneratingVideo || isPollingVideoStatus) && (
      <div style={styles.loadingOverlay}>
        <div style={styles.loadingCard}>
          <div style={styles.loadingSpinner} />
          <div style={styles.loadingEmoji}>🎬</div>
          <h3 style={styles.loadingTitle}>Generating your Golpo video</h3>
          {videoStatusMessage && (
            <p style={styles.loadingMessage}>{videoStatusMessage}</p>
          )}
          {videoJobId && (
            <p style={styles.loadingJobId}>Job ID: {videoJobId}</p>
          )}
          <p style={styles.loadingSubtext}>
            This usually takes less than a minute. You can keep this window open.
          </p>
            </div>
      </div>
    )}

    {showVideoReadyModal && (
      <div style={styles.videoReadyOverlay}>
        <div style={styles.videoReadyCard}>
          <button
            style={styles.videoReadyCloseButton}
            onClick={closeVideoReadyModal}
            aria-label="Close video status"
          >
            ×
          </button>
          <h3 style={styles.videoReadyTitle}>🎉 Video generated successfully!</h3>
          {videoReadyInfo?.jobId && (
            <p style={styles.videoReadyMeta}>Job ID: {videoReadyInfo.jobId}</p>
          )}
          {videoReadyInfo?.videoUrl ? (
            <>
              <video
                ref={videoElementRef}
                style={styles.videoPreview}
                src={videoPlayerUrl || undefined}
                controls
                preload="auto"
                crossOrigin="anonymous"
                playsInline
              />
              {!videoPlayerUrl && videoReadyInfo?.videoUrl && (
                <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
                  <p>Video preview unavailable due to security restrictions.</p>
                  <p>Use "Play video" or "Download video" buttons below.</p>
                </div>
              )}
              <div style={styles.videoReadyActions}>
              <button
                  style={styles.videoReadySecondaryButton}
                  onClick={() => handleCopyVideoUrl(videoReadyInfo.videoUrl)}
                >
                  Copy URL
                </button>
                <button
                style={{
                    ...styles.videoReadyPrimaryButton,
                    ...(isBylineItem ? styles.videoActionDisabled : {})
                  }}
                  onClick={() => handlePlayVideo(videoReadyInfo.videoUrl)}
                  disabled={isBylineItem}
                  title={isBylineItem ? "Open Golpo AI from page actions to play video" : undefined}
                >
                  Play video
              </button>
                {!isBylineItem && videoPlayerUrl && videoPlayerUrl.startsWith("blob:") ? (
                  <a
                    href={videoPlayerUrl}
                    download={`golpo-video-${videoReadyInfo?.jobId || Date.now()}.mp4`}
                    style={{
                      ...styles.videoReadyPrimaryButton,
                      textDecoration: "none",
                      display: "inline-block",
                      pointerEvents: "auto",
                    }}
                    title="Download video"
                  >
                    Download video
                  </a>
                ) : (
                  <button
                style={{
                      ...styles.videoReadyPrimaryButton,
                      ...(isBylineItem ? styles.videoActionDisabled : {})
                    }}
                    onClick={handleDownloadVideo}
                    disabled={isBylineItem}
                    title={isBylineItem ? "Open Golpo AI from page actions to download video" : undefined}
                  >
                    Download video
              </button>
                )}
            </div>
              {copyUrlMessage && (
                <div style={styles.copyUrlToast}>
                  {copyUrlMessage}
        </div>
              )}
            </>
          ) : (
            <pre style={styles.videoReadyDebug}>
              {JSON.stringify(videoReadyInfo?.raw ?? videoReadyInfo, null, 2)}
            </pre>
      )}
    </div>
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
    border: "none",
    fontSize: 14,
    fontWeight: 600,
    transition: "opacity 0.2s",
  },
  modalGenerateButtonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
    fontSize: 14,
    fontWeight: 600,
    border: "none",
    display: "flex",
    alignItems: "center",
    gap: 6,
    transition: "all 0.2s",
  },
  loadingOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "rgba(15, 23, 42, 0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 1000,
    color: "#fff",
    textAlign: "center",
  },
  loadingCard: {
    background: "rgba(15, 23, 42, 0.92)",
    borderRadius: 20,
    padding: "32px 40px",
    maxWidth: 420,
    width: "90%",
    boxShadow: "0 20px 40px rgba(15, 23, 42, 0.45)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  loadingSpinner: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "4px solid rgba(255,255,255,0.2)",
    borderTopColor: "#fff",
    animation: "golpo-spin 1s linear infinite",
    marginBottom: 12,
  },
  loadingEmoji: { fontSize: 40, marginBottom: 12 },
  loadingTitle: { margin: 0, fontSize: 20, fontWeight: 700 },
  loadingMessage: { marginTop: 12, fontSize: 14 },
  loadingJobId: { marginTop: 8, fontSize: 13, opacity: 0.85 },
  loadingSubtext: { marginTop: 12, fontSize: 12, opacity: 0.7 },
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
    padding: "28px 32px",
    maxWidth: 520,
    width: "95%",
    boxShadow: "0 25px 55px rgba(15, 23, 42, 0.25)",
    position: "relative",
    textAlign: "left",
  },
  videoReadyCloseButton: {
    position: "absolute",
    top: 16,
    right: 16,
    border: "none",
    background: "transparent",
    fontSize: 22,
    cursor: "pointer",
  },
  videoReadyTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: "#0f172a",
  },
  videoReadyMeta: {
    marginTop: 8,
    fontSize: 13,
    color: "#475569",
  },
  videoPreview: {
    width: "100%",
    marginTop: 16,
    borderRadius: 16,
    background: "#000",
  },
  videoReadyActions: {
    marginTop: 18,
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
  },
  copyUrlToast: {
    marginTop: 12,
    background: "#10b981",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: 10,
    fontWeight: 600,
    textAlign: "center",
    width: "100%",
    boxShadow: "0 6px 20px rgba(16, 185, 129, 0.35)",
  },
  videoReadyPrimaryButton: {
    flex: 1,
    minWidth: 140,
    padding: "12px 16px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(90deg, #7C3AED, #EC4899)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
  videoActionDisabled: {
    cursor: "not-allowed",
    opacity: 0.5,
    pointerEvents: "none",
  },
  videoReadySecondaryButton: {
    flex: 1,
    minWidth: 140,
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid #cbd5ff",
    background: "#fff",
    color: "#475569",
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
};
