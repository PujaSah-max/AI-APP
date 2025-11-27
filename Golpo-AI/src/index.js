import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

// Base URL for Golpo AI API - default to staging, overridable via Forge variable
const GOLPO_API_BASE_URL = (process.env.GOLPO_API_BASE_URL || 'https://staging-api.golpoai.com').replace(/\/$/, '');

const durationLabelMap = {
  '30 sec': 0.5,
  '1 min': 1,
  '2 min': 2,
  '3 min': 3,
  '5 min': 5,
};

// Map display language names to backend accepted keywords
const languageKeywordMap = {
  'English': 'english',
  'Hindi': 'hindi',
  'Spanish': 'spanish',
  'French': 'french',
  'German': 'german',
  'Italian': 'italian',
  'Portuguese': 'portuguese',
  'Russian': 'russian',
  'Japanese': 'japanese',
  'Korean': 'korean',
  'Chinese': 'chinese',
  'Mandarin': 'mandarin',
  'Arabic': 'arabic',
  'Dutch': 'dutch',
  'Polish': 'polish',
  'Turkish': 'turkish',
  'Swedish': 'swedish',
  'Danish': 'danish',
  'Norwegian': 'norwegian',
  'Finnish': 'finnish',
  'Greek': 'greek',
  'Czech': 'czech',
  'Hungarian': 'hungarian',
  'Romanian': 'romanian',
  'Thai': 'thai',
  'Vietnamese': 'vietnamese',
  'Indonesian': 'indonesian',
  'Malay': 'malay',
  'Tamil': 'tamil',
  'Telugu': 'telugu',
  'Bengali': 'bengali',
  'Marathi': 'marathi',
  'Gujarati': 'gujarati',
  'Kannada': 'kannada',
  'Malayalam': 'malayalam',
  'Punjabi': 'punjabi',
  'Urdu': 'urdu',
};

const parseDurationToMinutes = (input) => {
  if (typeof input === 'number' && !Number.isNaN(input)) {
    return input;
  }

  if (typeof input === 'string') {
    const numericValue = parseFloat(input);
    if (!Number.isNaN(numericValue)) {
      return numericValue;
    }

    const normalized = input.trim().toLowerCase();
    if (durationLabelMap[normalized]) {
      return durationLabelMap[normalized];
    }

    const minutesMatch = normalized.match(/([\d.]+)\s*(min|minute|minutes)/);
    if (minutesMatch) {
      const minutes = parseFloat(minutesMatch[1]);
      if (!Number.isNaN(minutes)) {
        return minutes;
      }
    }

    const secondsMatch = normalized.match(/([\d.]+)\s*(sec|second|seconds)/);
    if (secondsMatch) {
      const seconds = parseFloat(secondsMatch[1]);
      if (!Number.isNaN(seconds)) {
        return seconds / 60;
      }
    }
  }

  return null;
};

const requestPageById = async (pageId) => {
  if (!pageId) {
    throw new Error('Page id is required to load Confluence page details.');
  }

  const response = await api.asUser().requestConfluence(
    route`/wiki/api/v2/pages/${pageId}?fields=id,title,status,createdAt,authorId,spaceId,body,version,_links&body-format=storage`,
    {
      headers: {
        Accept: 'application/json'
      }
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Failed to retrieve Confluence page by id', {
      pageId,
      status: response.status,
      statusText: response.statusText,
      errorBody
    });
    throw new Error(`Unable to load Confluence page ${pageId}. Status: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  console.log('[resolver:requestPageById] payload', JSON.stringify(body));
  return { response, body };
};

resolver.define('getText', (req) => {
  console.log(req);

  return 'Hello, world!';
});

// Get current page information from the resolver context plus REST data
resolver.define('getCurrentPage', async ({ context }) => {
  console.log('[resolver:getCurrentPage] context:', JSON.stringify({
    hasExtension: !!context?.extension,
    extensionType: context?.extension?.type,
    hasContent: !!context?.extension?.content,
    contentId: context?.extension?.content?.id,
    contentTitle: context?.extension?.content?.title
  }));

  const content = context?.extension?.content;

  if (!content?.id) {
    console.warn('[resolver:getCurrentPage] No content ID found in context');
    return {
      id: 'unknown',
      title: 'Current Page',
      type: 'page'
    };
  }

  try {
    const { body } = await requestPageById(content.id);
    return body;
  } catch (error) {
    console.error('[resolver:getCurrentPage] Failed to fetch default page data', error);
    return {
      id: content.id,
      title: content.title,
      type: content.type
    };
  }
});

resolver.define('getPageById', async ({ payload }) => {
  const { pageId } = payload ?? {};
  const { response, body } = await requestPageById(pageId);
  return {
    status: response.status,
    statusText: response.statusText,
    body
  };
});

resolver.define('getFooterComments', async ({ payload }) => {
  const { pageId } = payload ?? {};

  if (!pageId) {
    throw new Error('Page id is required to load footer comments.');
  }

  const response = await api.asUser().requestConfluence(
    route`/wiki/api/v2/pages/${pageId}/footer-comments?fields=id,body,author,authorId,createdAt,version,status&body-format=storage&body-format=atlas_doc_format`,
    {
      headers: {
        Accept: 'application/json'
      }
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Failed to retrieve footer comments', {
      pageId,
      status: response.status,
      statusText: response.statusText,
      errorBody
    });
    throw new Error(`Unable to load footer comments for page ${pageId}. Status: ${response.status} ${response.statusText}`);
  }

  const commentBody = await response.json();
  console.log('[resolver:getFooterComments] payload', JSON.stringify(commentBody));

  return {
    status: response.status,
    statusText: response.statusText,
    body: commentBody
  };
});

resolver.define('addFooterComment', async ({ payload }) => {
  const { pageId, commentHtml } = payload ?? {};

  if (!pageId) {
    throw new Error('Page id is required to add footer comments.');
  }

  if (!commentHtml || typeof commentHtml !== 'string' || commentHtml.trim() === '') {
    throw new Error('Comment body is required to add footer comments.');
  }

  const response = await api.asUser().requestConfluence(
    route`/wiki/api/v2/footer-comments`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pageId,
        body: {
          representation: 'storage',
          value: commentHtml
        }
      })
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Failed to add footer comment', {
      pageId,
      status: response.status,
      statusText: response.statusText,
      errorBody
    });
    throw new Error(`Unable to add footer comment for page ${pageId}. Status: ${response.status} ${response.statusText}`);
  }

  const resultBody = await response.json();
  console.log('[resolver:addFooterComment] payload', JSON.stringify(resultBody));

  return {
    status: response.status,
    statusText: response.statusText,
    body: resultBody
  };
});

// Generate video using Golpo AI API
resolver.define('generateVideo', async ({ payload }) => {
  const { document, videoSpecs, description } = payload ?? {};

  if (!document) {
    throw new Error('Document is required to generate video.');
  }

  // Get API key from environment variable
  // You'll need to set this in Forge: forge variables set GOLPO_API_KEY your-api-key
  const API_KEY = process.env.GOLPO_API_KEY || 'api-key'; // Replace with your actual API key

  if (!API_KEY || API_KEY === 'api-key') {
    throw new Error('Golpo API key is not configured. Please set GOLPO_API_KEY environment variable.');
  }

  // Build the prompt from the document
  // Use fullText which contains title, content, and comments
  const prompt = document.fullText || document.content || '';

  if (!prompt || prompt.trim() === '') {
    throw new Error('Document content is empty. Cannot generate video.');
  }

  // Extract values from videoSpecs
  const {
    durationMinutes,
    durationLabel,
    duration = '1 min',
    voice = 'solo-female',
    language = 'English',
    includeLogo = false,
    music = 'engaging',
    style = '',
    selectedQuickAction = null,
  } = videoSpecs || {};

  // Map duration to timing value
  const resolvedDuration =
    parseDurationToMinutes(durationMinutes) ??
    parseDurationToMinutes(durationLabel) ??
    parseDurationToMinutes(duration) ??
    1;
  const timingValue = resolvedDuration.toString();
  const videoType = resolvedDuration <= 1 ? 'short' : 'long';

  // Map voice to correct format (convert "Solo Female" to "solo-female", etc.)
  const videoVoice = voice.toLowerCase().replace(/\s+/g, '-') || 'solo-female';

  // Map language to backend accepted keyword
  // Convert display name (e.g., "English") to backend keyword (e.g., "english")
  // Also handle direct keywords (e.g., "english", "en") and lowercase variants
  const normalizeLanguage = (lang) => {
    if (!lang) return 'english'; // Default to English
    
    const normalized = lang.trim();
    
    // Check if it's already a valid keyword (lowercase)
    if (languageKeywordMap[normalized] || Object.values(languageKeywordMap).includes(normalized.toLowerCase())) {
      return languageKeywordMap[normalized] || normalized.toLowerCase();
    }
    
    // Try to find in the map (case-insensitive)
    const found = Object.keys(languageKeywordMap).find(
      key => key.toLowerCase() === normalized.toLowerCase()
    );
    
    if (found) {
      return languageKeywordMap[found];
    }
    
    // Handle special cases: "en" -> "english", "zh" -> "chinese", etc.
    const codeMap = {
      'en': 'english',
      'hi': 'hindi',
      'es': 'spanish',
      'fr': 'french',
      'de': 'german',
      'it': 'italian',
      'pt': 'portuguese',
      'ru': 'russian',
      'ja': 'japanese',
      'ko': 'korean',
      'zh': 'chinese',
      'ar': 'arabic',
      'nl': 'dutch',
      'pl': 'polish',
      'tr': 'turkish',
      'sv': 'swedish',
      'da': 'danish',
      'no': 'norwegian',
      'fi': 'finnish',
      'el': 'greek',
      'cs': 'czech',
      'hu': 'hungarian',
      'ro': 'romanian',
      'th': 'thai',
      'vi': 'vietnamese',
      'id': 'indonesian',
      'ms': 'malay',
      'ta': 'tamil',
      'te': 'telugu',
      'bn': 'bengali',
      'mr': 'marathi',
      'gu': 'gujarati',
      'kn': 'kannada',
      'ml': 'malayalam',
      'pa': 'punjabi',
      'ur': 'urdu',
    };
    
    if (codeMap[normalized.toLowerCase()]) {
      return codeMap[normalized.toLowerCase()];
    }
    
    // Default: try lowercase, fallback to english
    return normalized.toLowerCase() || 'english';
  };
  
  const videoLanguage = normalizeLanguage(language);

  // Use the structured document created from fetched page data and footer comments
  // The document.fullText contains: TITLE, CONTENT, and FOOTER COMMENTS
  const issueDocument = document.fullText || document.content || prompt || null;

  // Build request body with all parameters
  // Ensure video generation (not audio-only) by setting audio_only to false and video_type to 'long'
  const requestBody = {
    prompt,
    uploads: null,
    direct_script: null,
    edited_script: null,
    own_narration_mode: false,
    has_custom_audio: false,
    bg_music: (music || 'engaging').toLowerCase(),
    video_duration: timingValue,
    video_voice: videoVoice,
    video_type: videoType,
    audio_only: false, // Explicitly set to false to generate video, not audio
    use_color: false, // Enable color for video
    video_style: true, // Enable video style
    include_watermark: false,
    logo_url: includeLogo ? 'INCLUDE_LOGO' : null,
    logo_placement: null,
    language: videoLanguage,
    voice_instructions: videoVoice || '',
    video_instructions: style || '',
    script_mode: false,
    enable_script_editing: false,
    attached_documents: issueDocument ? [issueDocument] : [],
    personality_1: selectedQuickAction || null,
    do_research: false,
    tts_model: 'accurate',
    style: videoVoice,
    bg_volume: includeLogo ? 1.4 : 1.0,
    logo: includeLogo ? 'INCLUDE_LOGO' : null,
    timing: timingValue,
    new_script: issueDocument || description || null, // Use the document created from page data and footer comments
    aspect_ratio: '16:9', // Force landscape orientation (16:9 aspect ratio)
    orientation: 'landscape', // Force landscape orientation
    video_orientation: 'landscape', // Alternative parameter name for orientation
    video_aspect_ratio: '16:9', // Alternative parameter name for aspect ratio
    format: 'landscape', // Alternative format parameter
    video_format: 'landscape', // Alternative video format parameter
  };

  console.log('[resolver:generateVideo] requestBody:', JSON.stringify(requestBody, null, 2));

  try {
    const response = await fetch(`${GOLPO_API_BASE_URL}/api/v1/videos/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[resolver:generateVideo] Golpo AI API error', {
        status: response.status,
        statusText: response.statusText,
        errorBody
      });
      throw new Error(`Golpo AI API error: ${response.status} ${response.statusText}. ${errorBody}`);
    }

    const data = await response.json();
    console.log('[resolver:generateVideo] Golpo AI API response:', JSON.stringify(data, null, 2));

    return {
      status: response.status,
      statusText: response.statusText,
      body: data
    };
  } catch (error) {
    console.error('[resolver:generateVideo] Error calling Golpo AI API:', error);
    throw new Error(`Failed to generate video: ${error.message}`);
  }
});

// Poll Golpo AI for video generation status by job id
resolver.define('getVideoStatus', async ({ payload }) => {
  const { jobId } = payload ?? {};

  if (!jobId) {
    throw new Error('Job id is required to check video status.');
  }

  const API_KEY = process.env.GOLPO_API_KEY || 'api-key';

  if (!API_KEY || API_KEY === 'api-key') {
    throw new Error('Golpo API key is not configured. Please set GOLPO_API_KEY environment variable.');
  }

  const statusUrl = `${GOLPO_API_BASE_URL}/api/v1/videos/status/${jobId}`;
  console.log('[resolver:getVideoStatus] Checking status for job', jobId, 'using', statusUrl);

  try {
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[resolver:getVideoStatus] Golpo AI status error', {
        status: response.status,
        statusText: response.statusText,
        errorBody
      });
      throw new Error(`Golpo AI status error: ${response.status} ${response.statusText}. ${errorBody}`);
    }

    const data = await response.json();
    console.log('[resolver:getVideoStatus] Status response:', JSON.stringify(data, null, 2));

    return {
      status: response.status,
      statusText: response.statusText,
      body: data
    };
  } catch (error) {
    console.error('[resolver:getVideoStatus] Error calling Golpo AI status API:', error);
    throw new Error(`Failed to fetch video status: ${error.message}`);
  }
});

// Fetch video file via backend to bypass CSP restrictions
resolver.define('fetchVideoFile', async ({ payload }) => {
  const { videoUrl } = payload ?? {};

  if (!videoUrl) {
    throw new Error('Video url is required to fetch media.');
  }

  console.log('[resolver:fetchVideoFile] Fetching video from:', videoUrl);

  try {
    const response = await fetch(videoUrl, {
      method: 'GET',
      headers: {
        'Accept': 'video/mp4,video/*,*/*',
        'Cache-Control': 'no-cache'
      }
    });

    // Check for CORS-related errors
    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unable to read error body');
      const corsHeaders = {
        'access-control-allow-origin': response.headers.get('access-control-allow-origin'),
        'access-control-allow-methods': response.headers.get('access-control-allow-methods'),
        'access-control-allow-headers': response.headers.get('access-control-allow-headers')
      };
      
      console.error('[resolver:fetchVideoFile] Failed to fetch video', {
        videoUrl,
        status: response.status,
        statusText: response.statusText,
        errorBody: errorBody.substring(0, 500), // Limit error body length
        corsHeaders
      });

      // Provide more specific error message for CORS issues
      if (response.status === 0 || response.status === 403) {
        throw new Error(`CORS or access denied. Ensure S3 bucket CORS is configured. Status: ${response.status}`);
      }
      
      throw new Error(`Failed to fetch video content. Status: ${response.status} ${response.statusText}`);
    }

    // Log CORS headers for debugging
    const corsHeaders = {
      'access-control-allow-origin': response.headers.get('access-control-allow-origin'),
      'access-control-expose-headers': response.headers.get('access-control-expose-headers')
    };
    console.log('[resolver:fetchVideoFile] CORS headers received:', corsHeaders);

    const arrayBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const contentType = response.headers.get('content-type') || 'video/mp4';
    const contentLength = response.headers.get('content-length') || arrayBuffer.byteLength;

    console.log('[resolver:fetchVideoFile] Successfully fetched video', {
      contentType,
      contentLength,
      sizeInMB: (contentLength / (1024 * 1024)).toFixed(2)
    });

    return {
      base64Data,
      contentType,
      contentLength
    };
  } catch (error) {
    console.error('[resolver:fetchVideoFile] Error fetching video file:', {
      videoUrl,
      error: error.message,
      stack: error.stack
    });
    
    // Provide helpful error message for CORS issues
    if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
      throw new Error(`CORS configuration issue. Please ensure S3 bucket 'golpo-stage-private' has CORS enabled with AllowedOrigin: '*' and AllowedMethod: 'GET'. Original error: ${error.message}`);
    }
    
    throw new Error(`Failed to fetch video file: ${error.message}`);
  }
});

// Add video URL to the page content itself
resolver.define('addVideoToPageContent', async ({ payload }) => {
  const { pageId, videoUrl, videoSectionHtml } = payload ?? {};

  if (!pageId) {
    throw new Error('Page id is required to update page content.');
  }

  if (!videoUrl) {
    throw new Error('Video URL is required to update page content.');
  }

  if (!videoSectionHtml) {
    throw new Error('Video section HTML is required to update page content.');
  }

  console.log('[resolver:addVideoToPageContent] Adding video URL to page content for page', pageId, 'with video URL:', videoUrl);

  try {
    // First, get the current page to preserve existing content and get version number
    const getPageResponse = await api.asUser().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}?body-format=storage`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    if (!getPageResponse.ok) {
      const errorBody = await getPageResponse.text();
      console.error('[resolver:addVideoToPageContent] Failed to get current page', {
        pageId,
        status: getPageResponse.status,
        statusText: getPageResponse.statusText,
        errorBody
      });
      throw new Error(`Unable to get current page ${pageId}. Status: ${getPageResponse.status} ${getPageResponse.statusText}`);
    }

    const currentPage = await getPageResponse.json();
    const currentVersion = currentPage.version?.number || 1;
    const currentBody = currentPage.body?.storage?.value || '';
    const currentTitle = currentPage.title || '';

    // Check if there's already a video section in the page content
    // Use the comment markers to reliably find and replace the video section
    const videoSectionStartMarker = '<!-- GOLPO_AI_VIDEO_SECTION_START -->';
    const videoSectionEndMarker = '<!-- GOLPO_AI_VIDEO_SECTION_END -->';
    
    // Pattern to match everything from start marker to end marker (non-greedy)
    const videoSectionPattern = new RegExp(
      videoSectionStartMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 
      '[\\s\\S]*?' + 
      videoSectionEndMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i'
    );
    
    let updatedBody;
    if (videoSectionPattern.test(currentBody)) {
      // Replace existing video section with the new one
      updatedBody = currentBody.replace(videoSectionPattern, videoSectionHtml);
      console.log('[resolver:addVideoToPageContent] Found existing video section, replacing with new one');
    } else {
      // No existing video section found, append the new one
      updatedBody = currentBody + videoSectionHtml;
      console.log('[resolver:addVideoToPageContent] No existing video section found, appending new one');
    }

    // Update the page with new content
    const updateResponse = await api.asUser().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}`,
      {
        method: 'PUT',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: pageId,
          status: 'current',
          title: currentTitle,
          body: {
            representation: 'storage',
            value: updatedBody
          },
          version: {
            number: currentVersion + 1,
            message: 'Added Golpo AI generated video link'
          }
        })
      }
    );

    if (!updateResponse.ok) {
      const errorBody = await updateResponse.text();
      console.error('[resolver:addVideoToPageContent] Failed to update page content', {
        pageId,
        status: updateResponse.status,
        statusText: updateResponse.statusText,
        errorBody
      });
      throw new Error(`Unable to update page content for page ${pageId}. Status: ${updateResponse.status} ${updateResponse.statusText}`);
    }

    const updatedPage = await updateResponse.json();
    console.log('[resolver:addVideoToPageContent] Page content updated successfully:', JSON.stringify(updatedPage, null, 2));

    return {
      status: updateResponse.status,
      statusText: updateResponse.statusText,
      body: updatedPage
    };
  } catch (error) {
    console.error('[resolver:addVideoToPageContent] Error updating page content:', error);
    throw new Error(`Failed to add video to page content: ${error.message}`);
  }
});

// Add video URL as a footer comment to the Confluence page
resolver.define('addVideoCommentToPage', async ({ payload }) => {
  const { pageId, videoUrl, commentBodyHtml } = payload ?? {};

  if (!pageId) {
    throw new Error('Page id is required to add footer comment.');
  }

  if (!videoUrl) {
    throw new Error('Video URL is required to add footer comment.');
  }

  if (!commentBodyHtml) {
    throw new Error('Comment body HTML is required to add footer comment.');
  }

  // Use the comment body HTML provided by frontend
  const commentBody = commentBodyHtml;

  console.log('[resolver:addVideoCommentToPage] Adding footer comment to page', pageId, 'with video URL:', videoUrl);

  try {
    const response = await api.asUser().requestConfluence(
      route`/wiki/api/v2/footer-comments`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pageId: pageId,
          body: {
            representation: 'storage',
            value: commentBody
          }
        })
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[resolver:addVideoCommentToPage] Failed to create footer comment', {
        pageId,
        status: response.status,
        statusText: response.statusText,
        errorBody
      });
      throw new Error(`Unable to add footer comment to page ${pageId}. Status: ${response.status} ${response.statusText}`);
    }

    const commentData = await response.json();
    console.log('[resolver:addVideoCommentToPage] Footer comment created successfully:', JSON.stringify(commentData, null, 2));

    return {
      status: response.status,
      statusText: response.statusText,
      body: commentData
    };
  } catch (error) {
    console.error('[resolver:addVideoCommentToPage] Error creating footer comment:', error);
    throw new Error(`Failed to add video comment to page: ${error.message}`);
  }
});

export const handler = resolver.getDefinitions();
