import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';

const resolver = new Resolver();

// Base URL for Golpo AI API - default to staging, overridable via Forge variable
const GOLPO_API_BASE_URL = (process.env.GOLPO_API_BASE_URL || 'https://staging-api.golpoai.com').replace(/\/$/, '');

// Base URL for Google Gemini AI API
const GEMINI_API_BASE_URL = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');

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
  try {
    if (!pageId || typeof pageId !== 'string') {
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
      let errorBody = 'Unable to read error body';
      try {
        errorBody = await response.text();
      } catch (e) {
        console.warn('[requestPageById] Failed to read error body:', e);
      }
    console.error('Failed to retrieve Confluence page by id', {
      pageId,
      status: response.status,
      statusText: response.statusText,
        errorBody: errorBody.substring(0, 500) // Limit error body length
    });
    throw new Error(`Unable to load Confluence page ${pageId}. Status: ${response.status} ${response.statusText}`);
  }

    let body;
    try {
      body = await response.json();
    } catch (jsonError) {
      console.error('[requestPageById] Failed to parse response JSON:', jsonError);
      throw new Error(`Invalid response format from Confluence API for page ${pageId}`);
    }
    
  console.log('[resolver:requestPageById] payload', JSON.stringify(body));
  return { response, body };
  } catch (error) {
    console.error('[requestPageById] Error fetching page:', error);
    throw error;
  }
};

// resolver.define('getText', (req) => {
//   console.log(req);

//   return 'Hello, world!';
// });

// Get current page information from the resolver context plus REST data
resolver.define('getCurrentPage', async ({ context }) => {
  try {
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
      // Return fallback data instead of throwing
    return {
        id: content.id || 'unknown',
        title: content.title || 'Current Page',
        type: content.type || 'page'
      };
    }
  } catch (error) {
    console.error('[resolver:getCurrentPage] Unexpected error:', error);
    // Always return a valid response, never throw
    return {
      id: 'unknown',
      title: 'Current Page',
      type: 'page'
    };
  }
});

resolver.define('getPageById', async ({ payload }) => {
  try {
  const { pageId } = payload ?? {};
    if (!pageId) {
      throw new Error('Page id is required.');
    }
  const { response, body } = await requestPageById(pageId);
  return {
    status: response.status,
    statusText: response.statusText,
    body
  };
  } catch (error) {
    console.error('[resolver:getPageById] Error:', error);
    throw new Error(`Failed to get page: ${error?.message || 'Unknown error'}`);
  }
});

resolver.define('getFooterComments', async ({ payload }) => {
  try {
  const { pageId } = payload ?? {};

    if (!pageId || typeof pageId !== 'string') {
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
      let errorBody = 'Unable to read error body';
      try {
        errorBody = await response.text();
      } catch (e) {
        console.warn('[getFooterComments] Failed to read error body:', e);
      }
    console.error('Failed to retrieve footer comments', {
      pageId,
      status: response.status,
      statusText: response.statusText,
        errorBody: errorBody.substring(0, 500)
    });
    throw new Error(`Unable to load footer comments for page ${pageId}. Status: ${response.status} ${response.statusText}`);
  }

    let commentBody;
    try {
      commentBody = await response.json();
    } catch (jsonError) {
      console.error('[getFooterComments] Failed to parse response JSON:', jsonError);
      throw new Error(`Invalid response format from Confluence API for footer comments`);
    }
    
  console.log('[resolver:getFooterComments] payload', JSON.stringify(commentBody));

  return {
    status: response.status,
    statusText: response.statusText,
    body: commentBody
  };
  } catch (error) {
    console.error('[resolver:getFooterComments] Error:', error);
    throw new Error(`Failed to get footer comments: ${error?.message || 'Unknown error'}`);
  }
});

resolver.define('addFooterComment', async ({ payload }) => {
  try {
  const { pageId, commentHtml } = payload ?? {};

    if (!pageId || typeof pageId !== 'string') {
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
      let errorBody = 'Unable to read error body';
      try {
        errorBody = await response.text();
      } catch (e) {
        console.warn('[addFooterComment] Failed to read error body:', e);
      }
    console.error('Failed to add footer comment', {
      pageId,
      status: response.status,
      statusText: response.statusText,
        errorBody: errorBody.substring(0, 500)
    });
    throw new Error(`Unable to add footer comment for page ${pageId}. Status: ${response.status} ${response.statusText}`);
  }

    let resultBody;
    try {
      resultBody = await response.json();
    } catch (jsonError) {
      console.error('[addFooterComment] Failed to parse response JSON:', jsonError);
      throw new Error(`Invalid response format from Confluence API`);
    }
    
  console.log('[resolver:addFooterComment] payload', JSON.stringify(resultBody));

  return {
    status: response.status,
    statusText: response.statusText,
    body: resultBody
  };
  } catch (error) {
    console.error('[resolver:addFooterComment] Error:', error);
    throw new Error(`Failed to add footer comment: ${error?.message || 'Unknown error'}`);
  }
});

// Convert document to video script using Gemini AI
// documentText: plain text extracted from the Confluence page
// videoSpecs: options such as duration and language to guide script length and tone
// description: optional brief provided by the user to influence the script
// issueDocument: optional richer/structured document representation
const convertDocumentToScript = async (documentText, videoSpecs = {}, description = '', issueDocument = '') => {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    
    if (!GEMINI_API_KEY) {
      console.warn('[resolver:convertDocumentToScript] Gemini API key not configured, using document as-is');
      return documentText || ''; // Fallback to original document if Gemini is not configured
    }

    const { duration = '1 min', language = 'English' } = videoSpecs;
    const issueDocumentText = issueDocument || documentText;
  
    // Build prompt for Gemini to convert document to video script
    const prompt = `You are a professional video script writer. Convert the following document into a clear, concise video script that summarizes the document without turning it into a long story or narrative.

The script should:

- Deliver an accurate, concise summary of the document's key points
- Use straightforward, professional, conversational language
- Avoid storytelling or fictionalized framing
- Provide only essential details and actionable insights
- Match the selected video duration (keep pacing and length aligned with approximately ${duration})
- Be written in ${language} language
- Include a brief intro stating the video topic and a short closing statement

${description ? `Video Brief/Description: ${description}\n\n` : ''}Issue Document:

${issueDocumentText}

Generate only the script text, with no markdown formatting or additional commentary.`;

    // Use Gemini API v1beta generateContent endpoint
    const model = 'gemini-2.5-flash'; // or 'gemini-1.5-pro' for newer models
    const apiUrl = `${GEMINI_API_BASE_URL}/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[resolver:convertDocumentToScript] Gemini API error', {
        status: response.status,
        statusText: response.statusText,
        errorBody
      });
      // Fallback to original document on error
      console.warn('[resolver:convertDocumentToScript] Falling back to original document');
      return documentText || '';
    }

    const data = await response.json();
    const script = data?.candidates?.[0]?.content?.parts?.[0]?.text || documentText;
    
    console.log('[resolver:convertDocumentToScript] Successfully converted document to script', {
      originalLength: documentText.length,
      scriptLength: script.length
    });
    
    // Log the full script generated by Gemini
    if (script && script !== documentText) {
      console.log('[resolver:convertDocumentToScript] ========== GEMINI API GENERATED SCRIPT ==========');
      console.log(script);
      console.log('[resolver:convertDocumentToScript] ========== END OF GEMINI API SCRIPT ==========');
    } else {
      console.log('[resolver:convertDocumentToScript] Using original document (no script generated)');
    }
    
    return script || documentText || '';
  } catch (error) {
    console.error('[resolver:convertDocumentToScript] Unexpected error:', error);
    console.error('[resolver:convertDocumentToScript] Error details:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name
    });
    // Fallback to original document on error - never throw, always return something
    console.warn('[resolver:convertDocumentToScript] Falling back to original document');
    return documentText || ''; // Ensure we always return a string
  }
};

// Generate video using Golpo AI API
resolver.define('generateVideo', async ({ payload }) => {
  try {
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
  const documentText = document.fullText || document.content || '';

  if (!documentText || documentText.trim() === '') {
    throw new Error('Document content is empty. Cannot generate video.');
  }

  // Convert document to script using Gemini AI
  console.log('[resolver:generateVideo] Step 1: Converting document to script using Gemini AI...');
  console.log('[resolver:generateVideo] Document length:', documentText.length, 'characters');
  console.log('[resolver:generateVideo] Video specs:', {
    duration: videoSpecs.duration || videoSpecs.durationLabel || '1 min',
    language: videoSpecs.language || 'English',
    description: description || 'None'
  });
  
  const videoScript = await convertDocumentToScript(documentText, videoSpecs, description, documentText);
  
  // Log script generation result
  if (videoScript && videoScript !== documentText) {
    console.log('[resolver:generateVideo] ✓ Successfully generated script from document');
    console.log('[resolver:generateVideo] Script length:', videoScript.length, 'characters');
    console.log('[resolver:generateVideo] ========== FULL GEMINI GENERATED SCRIPT ==========');
    console.log(videoScript);
    console.log('[resolver:generateVideo] ========== END OF GEMINI GENERATED SCRIPT ==========');
  } else {
    console.warn('[resolver:generateVideo] ⚠ Script generation failed or skipped, using original document');
    console.log('[resolver:generateVideo] Using document length:', documentText.length, 'characters');
    console.log('[resolver:generateVideo] ========== ORIGINAL DOCUMENT (NO SCRIPT GENERATED) ==========');
    console.log(documentText);
    console.log('[resolver:generateVideo] ========== END OF ORIGINAL DOCUMENT ==========');
  }
  
  // Use the script as the prompt for video generation
  const prompt = videoScript;

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

  // Calculate estimated duration based on content length
  // Average reading speed for video narration: ~150-180 words per minute
  // We'll use 150 words/min as a conservative estimate and add 30% buffer
  const calculateDurationFromContent = (content) => {
    if (!content || typeof content !== 'string') return null;
    
    // Count words (split by whitespace and filter empty strings)
    const words = content.trim().split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;
    
    // Calculate duration: words / words_per_minute * buffer
    // Using 150 words/min as base, with 1.3x buffer (30% extra)
    const wordsPerMinute = 150;
    const bufferMultiplier = 1.3;
    const calculatedMinutes = (wordCount / wordsPerMinute) * bufferMultiplier;
    
    // Round up to nearest 0.5 minutes and ensure minimum of 2 minutes
    const roundedMinutes = Math.ceil(calculatedMinutes * 2) / 2;
    const finalMinutes = Math.max(roundedMinutes, 2);
    
    console.log(`[resolver:generateVideo] Content has ${wordCount} words. Calculated duration: ${finalMinutes} minutes (base: ${calculatedMinutes.toFixed(2)} minutes)`);
    
    return finalMinutes;
  };

  // Get content for duration calculation
  const contentForDuration = document?.fullText || document?.content || prompt || description || '';
  const calculatedDuration = calculateDurationFromContent(contentForDuration);

  // Map duration to timing value
  // API requires minimum 2 minutes, so enforce that
  const MINIMUM_DURATION_MINUTES = 2;
  
  // Use calculated duration if available, otherwise use user selection or default
  let resolvedDuration = calculatedDuration;
  
  // If user specified a duration, use the larger of user selection or calculated duration
  const userSelectedDuration =
    parseDurationToMinutes(durationMinutes) ??
    parseDurationToMinutes(durationLabel) ??
    parseDurationToMinutes(duration);
  
  if (userSelectedDuration !== null && userSelectedDuration > calculatedDuration) {
    resolvedDuration = userSelectedDuration;
    console.log(`[resolver:generateVideo] Using user-selected duration: ${resolvedDuration} minutes (calculated was ${calculatedDuration} minutes)`);
  } else if (calculatedDuration) {
    resolvedDuration = calculatedDuration;
    console.log(`[resolver:generateVideo] Using calculated duration: ${resolvedDuration} minutes`);
  } else {
    resolvedDuration = userSelectedDuration ?? MINIMUM_DURATION_MINUTES;
    console.log(`[resolver:generateVideo] Using fallback duration: ${resolvedDuration} minutes`);
  }
  
  // Enforce minimum duration requirement
  if (resolvedDuration < MINIMUM_DURATION_MINUTES) {
    console.warn(`[resolver:generateVideo] Duration ${resolvedDuration} minutes is below minimum ${MINIMUM_DURATION_MINUTES} minutes. Using minimum.`);
    resolvedDuration = MINIMUM_DURATION_MINUTES;
  }
  
  // Add extra buffer to ensure we're always above API's estimated requirement
  // Round up to next 0.5 minute increment to be safe
  resolvedDuration = Math.ceil(resolvedDuration * 2) / 2;
  
  console.log(`[resolver:generateVideo] Final resolved duration: ${resolvedDuration} minutes`);
  
  const timingValue = resolvedDuration.toString();
  const videoType = 'long';

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

  // Use the script generated by Gemini AI instead of raw document
  // The script is already optimized for video generation
  const issueDocument = videoScript || prompt || null;

  // Build request body with all parameters
  // Ensure video generation (not audio-only) by setting audio_only to false and video_type to 'long'
  const requestBody = {
    prompt,
    uploads: null,
    direct_script: videoScript, // Use Gemini-generated script
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
    new_script: videoScript || description || null, // Use Gemini-generated script instead of raw document
    aspect_ratio: '16:9', // Force landscape orientation (16:9 aspect ratio)
    orientation: 'landscape', // Force landscape orientation
    video_orientation: 'landscape', // Alternative parameter name for orientation
    video_aspect_ratio: '16:9', // Alternative parameter name for aspect ratio
    format: 'landscape', // Alternative format parameter
    video_format: 'landscape', // Alternative video format parameter
  };

  console.log('[resolver:generateVideo] requestBody:', JSON.stringify(requestBody, null, 2));

  let response;
  response = await fetch(`${GOLPO_API_BASE_URL}/api/v1/videos/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
    let errorBody = 'Unable to read error body';
    try {
      errorBody = await response.text();
    } catch (e) {
      console.warn('[resolver:generateVideo] Failed to read error body:', e);
    }
    
    let errorMessage = `Golpo AI API error: ${response.status} ${response.statusText}`;
    
    // Try to parse error body for more details
    try {
      const errorJson = JSON.parse(errorBody);
      if (errorJson.detail) {
        errorMessage += `. ${errorJson.detail}`;
      } else if (errorJson.message) {
        errorMessage += `. ${errorJson.message}`;
      } else {
        errorMessage += `. ${errorBody.substring(0, 500)}`;
      }
    } catch (parseError) {
      errorMessage += `. ${errorBody.substring(0, 500)}`;
    }
    
      console.error('[resolver:generateVideo] Golpo AI API error', {
        status: response.status,
        statusText: response.statusText,
      errorBody: errorBody.substring(0, 500),
      errorMessage
    });
    
    throw new Error(errorMessage);
  }

  let data;
  try {
    data = await response.json();
  } catch (jsonError) {
    console.error('[resolver:generateVideo] Failed to parse response JSON:', jsonError);
    throw new Error('Invalid response format from Golpo AI API');
  }
    
    console.log('[resolver:generateVideo] Step 2: Golpo AI API response received');
    console.log('[resolver:generateVideo] Golpo AI API response:', JSON.stringify(data, null, 2));

    // Extract jobId and pageId from response/document
    const jobId = data?.job_id || data?.jobId || data?.id || data?.data?.job_id || data?.data?.jobId;
    const pageId = document?.pageId || document?.metadata?.pageId;

    // If we have a jobId and pageId, store job info in Forge storage for background polling
    if (jobId && pageId) {
      try {
        // Try to capture the user who requested this video
        let requestedBy = null;
        try {
          const meResponse = await api.asUser().requestConfluence(
            route`/wiki/api/v2/users/me`
          );
          if (meResponse.ok) {
            const me = await meResponse.json();
            requestedBy = {
              accountId: me.accountId || me.id || null,
              displayName: me.displayName || me.publicName || null,
            };
          } else {
            console.warn('[resolver:generateVideo] Failed to fetch current user info for job metadata:', meResponse.status);
          }
        } catch (userError) {
          console.warn('[resolver:generateVideo] Error fetching current user info for job metadata:', userError);
        }

        const jobKey = `video-job-${jobId}`;
        const jobData = {
          jobId,
          pageId,
          createdAt: new Date().toISOString(),
          status: 'processing',
          document: {
            pageId: document.pageId,
            title: document.title
          },
          requestedBy,
        };
        
        await storage.set(jobKey, jobData);
        console.log('[resolver:generateVideo] ✅ Stored job info in storage:', jobKey);
        console.log('[resolver:generateVideo] Job data:', JSON.stringify(jobData, null, 2));
        
        // Also add to a list of active jobs for the scheduled trigger to process
        const activeJobsKey = 'active-video-jobs';
        try {
          const activeJobs = await storage.get(activeJobsKey) || [];
          if (!activeJobs.includes(jobId)) {
            activeJobs.push(jobId);
            await storage.set(activeJobsKey, activeJobs);
            console.log('[resolver:generateVideo] ✅ Added job to active jobs list. Total active jobs:', activeJobs.length);
            console.log('[resolver:generateVideo] Active jobs:', activeJobs);
          } else {
            console.log('[resolver:generateVideo] Job already in active jobs list');
          }
        } catch (listError) {
          console.error('[resolver:generateVideo] ❌ Failed to update active jobs list:', listError);
          // Continue even if this fails
        }
      } catch (storageError) {
        console.error('[resolver:generateVideo] ❌ Failed to store job info in storage:', storageError);
        console.error('[resolver:generateVideo] Storage error details:', JSON.stringify(storageError, null, 2));
        // Continue even if storage fails - don't break the response
      }
    } else {
      console.warn('[resolver:generateVideo] ⚠️ Missing jobId or pageId - cannot store for background processing');
      console.warn('[resolver:generateVideo] jobId:', jobId, 'pageId:', pageId);
    }
    // Include script generation info in response for frontend logging
    const responseBody = {
      ...data,
      scriptGenerated: videoScript !== documentText,
      scriptPreview: videoScript && videoScript !== documentText ? videoScript.substring(0, 200) + '...' : null
    };

    return {
      status: response?.status || 200,
      statusText: response?.statusText || 'OK',
      body: responseBody
    };
  } catch (error) {
    console.error('[resolver:generateVideo] Error calling Golpo AI API:', error);
    const errorMessage = error?.message || 'Unknown error occurred';
    console.error('[resolver:generateVideo] Full error details:', {
      message: errorMessage,
      stack: error?.stack,
      name: error?.name
    });
    throw new Error(`Failed to generate video: ${errorMessage}`);
  }
});

// Poll Golpo AI for video generation status by job id
resolver.define('getVideoStatus', async ({ payload }) => {
  try {
    const { jobId } = payload ?? {};

    if (!jobId || typeof jobId !== 'string') {
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
    } catch (innerError) {
      console.error('[resolver:getVideoStatus] Error calling Golpo AI status API:', innerError);
      throw innerError;
    }
  } catch (error) {
    console.error('[resolver:getVideoStatus] Error:', error);
    const errorMessage = error?.message || 'Unknown error occurred';
    console.error('[resolver:getVideoStatus] Full error details:', {
      message: errorMessage,
      stack: error?.stack,
      name: error?.name,
      jobId: payload?.jobId
    });
    throw new Error(`Failed to fetch video status: ${errorMessage}`);
  }
});

// Fetch video file via backend to bypass CSP restrictions
resolver.define('fetchVideoFile', async ({ payload }) => {
  try {
    const { videoUrl } = payload ?? {};

    if (!videoUrl || typeof videoUrl !== 'string') {
      throw new Error('Video url is required to fetch media.');
    }

  console.log('[resolver:fetchVideoFile] Fetching video from:', videoUrl);
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
// resolver.define('addVideoToPageContent', async ({ payload }) => {
//   const { pageId, videoUrl, videoSectionHtml } = payload ?? {};

//   if (!pageId) {
//     throw new Error('Page id is required to update page content.');
//   }

//   if (!videoUrl) {
//     throw new Error('Video URL is required to update page content.');
//   }

//   if (!videoSectionHtml) {
//     throw new Error('Video section HTML is required to update page content.');
//   }

//   console.log('[resolver:addVideoToPageContent] Adding video URL to page content for page', pageId, 'with video URL:', videoUrl);

//   try {
//     // First, get the current page to preserve existing content and get version number
//     const getPageResponse = await api.asUser().requestConfluence(
//       route`/wiki/api/v2/pages/${pageId}?body-format=storage`,
//       {
//         headers: {
//           'Accept': 'application/json'
//         }
//       }
//     );

//     if (!getPageResponse.ok) {
//       const errorBody = await getPageResponse.text();
//       console.error('[resolver:addVideoToPageContent] Failed to get current page', {
//         pageId,
//         status: getPageResponse.status,
//         statusText: getPageResponse.statusText,
//         errorBody
//       });
//       throw new Error(`Unable to get current page ${pageId}. Status: ${getPageResponse.status} ${getPageResponse.statusText}`);
//     }

//     const currentPage = await getPageResponse.json();
//     const currentVersion = currentPage.version?.number || 1;
//     const currentBody = currentPage.body?.storage?.value || '';
//     const currentTitle = currentPage.title || '';

//     // Check if there's already a video section in the page content
//     // Use the comment markers to reliably find and replace the video section
//     const videoSectionStartMarker = '<!-- GOLPO_AI_VIDEO_SECTION_START -->';
//     const videoSectionEndMarker = '<!-- GOLPO_AI_VIDEO_SECTION_END -->';
    
//     // Pattern to match everything from start marker to end marker (non-greedy)
//     const videoSectionPattern = new RegExp(
//       videoSectionStartMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 
//       '[\\s\\S]*?' + 
//       videoSectionEndMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
//       'i'
//     );
    
//     let updatedBody;
//     if (videoSectionPattern.test(currentBody)) {
//       // Replace existing video section with the new one
//       updatedBody = currentBody.replace(videoSectionPattern, videoSectionHtml);
//       console.log('[resolver:addVideoToPageContent] Found existing video section, replacing with new one');
//     } else {
//       // No existing video section found, append the new one
//       updatedBody = currentBody + videoSectionHtml;
//       console.log('[resolver:addVideoToPageContent] No existing video section found, appending new one');
//     }

//     // Update the page with new content
//     const updateResponse = await api.asUser().requestConfluence(
//       route`/wiki/api/v2/pages/${pageId}`,
//       {
//         method: 'PUT',
//         headers: {
//           'Accept': 'application/json',
//           'Content-Type': 'application/json'
//         },
//         body: JSON.stringify({
//           id: pageId,
//           status: 'current',
//           title: currentTitle,
//           body: {
//             representation: 'storage',
//             value: updatedBody
//           },
//           version: {
//             number: currentVersion + 1,
//             message: 'Added Golpo AI generated video link'
//           }
//         })
//       }
//     )

//     if (!updateResponse.ok) {
//       const errorBody = await updateResponse.text();
//       console.error('[resolver:addVideoToPageContent] Failed to update page content', {
//         pageId,
//         status: updateResponse.status,
//         statusText: updateResponse.statusText,
//         errorBody
//       });
//       throw new Error(`Unable to update page content for page ${pageId}. Status: ${updateResponse.status} ${updateResponse.statusText}`);
//     }

//     const updatedPage = await updateResponse.json();
//     console.log('[resolver:addVideoToPageContent] Page content updated successfully:', JSON.stringify(updatedPage, null, 2));

//     return {
//       status: updateResponse.status,
//       statusText: updateResponse.statusText,
//       body: updatedPage
//     };
//   } catch (error) {
//     console.error('[resolver:addVideoToPageContent] Error updating page content:', error);
//     throw new Error(`Failed to add video to page content: ${error.message}`);
//   }
// });

// Add video URL as a footer comment to the Confluence page
resolver.define('addVideoCommentToPage', async ({ payload }) => {
  try {
    const { pageId, videoUrl, commentBodyHtml } = payload ?? {};

    if (!pageId || typeof pageId !== 'string') {
      throw new Error('Page id is required to add footer comment.');
    }

    if (!videoUrl || typeof videoUrl !== 'string') {
      throw new Error('Video URL is required to add footer comment.');
    }

    if (!commentBodyHtml || typeof commentBodyHtml !== 'string') {
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
        let errorBody = 'Unable to read error body';
        try {
          errorBody = await response.text();
        } catch (e) {
          console.warn('[addVideoCommentToPage] Failed to read error body:', e);
        }
        console.error('[resolver:addVideoCommentToPage] Failed to create footer comment', {
          pageId,
          status: response.status,
          statusText: response.statusText,
          errorBody: errorBody.substring(0, 500)
        });
        throw new Error(`Unable to add footer comment to page ${pageId}. Status: ${response.status} ${response.statusText}`);
      }

      let commentData;
      try {
        commentData = await response.json();
      } catch (jsonError) {
        console.error('[addVideoCommentToPage] Failed to parse response JSON:', jsonError);
        throw new Error(`Invalid response format from Confluence API`);
      }
      
      console.log('[resolver:addVideoCommentToPage] Footer comment created successfully:', JSON.stringify(commentData, null, 2));

      return {
        status: response.status,
        statusText: response.statusText,
        body: commentData
      };
    } catch (innerError) {
      console.error('[resolver:addVideoCommentToPage] Error creating footer comment:', innerError);
      throw innerError;
    }
  } catch (error) {
    console.error('[resolver:addVideoCommentToPage] Error:', error);
    throw new Error(`Failed to add video comment to page: ${error?.message || 'Unknown error'}`);
  }
});

// Helper function to extract video URL from status response
// This matches the frontend extractVideoUrlFromPayload logic
const extractVideoUrlFromStatus = (statusData) => {
  if (!statusData) {
    return null;
  }
  
  // Try paths in the same order as frontend extractVideoUrlFromPayload
  const possiblePaths = [
    statusData.video_url,
    statusData.download_url,
    statusData.podcast_url,
    statusData?.data?.video_url,
    statusData?.data?.download_url,
    statusData?.data?.podcast_url,
    statusData?.result?.video_url,
    // Additional paths for different response formats
    statusData.videoUrl,
    statusData.downloadUrl,
    statusData.podcastUrl,
    statusData?.data?.videoUrl,
    statusData?.data?.downloadUrl,
    statusData?.data?.podcastUrl,
    statusData?.result?.videoUrl,
    statusData?.result?.download_url,
    statusData?.result?.downloadUrl,
    statusData.url,
    statusData?.data?.url,
    statusData?.result?.url,
  ];
  
  // Find first valid URL (must be a string and contain http or .mp4)
  for (const url of possiblePaths) {
    if (url && typeof url === 'string' && (url.includes('http') || url.includes('.mp4'))) {
      console.log('[extractVideoUrlFromStatus] ✅ Found video URL:', url);
      return url;
    }
  }
  
  // Log the full response structure for debugging
  console.warn('[extractVideoUrlFromStatus] ⚠️ No video URL found in response');
  console.warn('[extractVideoUrlFromStatus] Response keys:', Object.keys(statusData || {}));
  if (statusData?.data) {
    console.warn('[extractVideoUrlFromStatus] Response.data keys:', Object.keys(statusData.data || {}));
  }
  console.warn('[extractVideoUrlFromStatus] Full structure:', JSON.stringify(statusData, null, 2));
  return null;
};

// Helper function to check if video is ready
const isVideoReady = (statusData) => {
  const status = statusData?.status || statusData?.data?.status || '';
  const statusLower = status.toLowerCase();
  return statusLower === 'completed' || 
         statusLower === 'ready' || 
         statusLower === 'success' || 
         statusLower === 'finished' || 
         statusLower === 'done' ||
         statusLower === 'complete';
};

// Helper function to check if video generation failed
const isVideoFailed = (statusData) => {
  const status = statusData?.status || statusData?.data?.status || '';
  const statusLower = status.toLowerCase();
  return statusLower === 'failed' || 
         statusLower === 'error' || 
         statusLower === 'cancelled' || 
         statusLower === 'denied' || 
         statusLower === 'rejected';
};

// Helper function to build comment HTML for video URL
// Optionally includes the user who requested the video (from job metadata)
const buildCommentBodyHtml = (videoUrl, requestedBy) => {
  const safeRequestedBy =
    (requestedBy &&
      (requestedBy.displayName ||
        requestedBy.publicName ||
        requestedBy.name ||
        requestedBy.username ||
        (typeof requestedBy === 'string' ? requestedBy : null))) ||
    null;

  const requestedByHtml = safeRequestedBy
    ? `<p><em>Requested by: ${safeRequestedBy}</em></p>`
    : '';

  return `<p><a href="${videoUrl}" target="_blank" rel="noopener noreferrer">${videoUrl}</a></p>${requestedByHtml}`;
};

// Helper function to build video section HTML for page content
const buildVideoSectionHtml = (videoUrl) => {
  return `<h2>Golpo AI Generated Video</h2><p><a href="${videoUrl}" target="_blank" rel="noopener noreferrer">${videoUrl}</a></p>`;
};

// Process completed video: add to comments only (not page content)
// Use asApp() for scheduled triggers (no user context), asUser() for resolver calls
// requestedBy: optional user info ({ displayName, accountId, ... }) captured when the job was created
const processCompletedVideo = async (jobId, videoUrl, pageId, useAsApp = false, requestedBy = null) => {
  try {
    console.log('[processCompletedVideo] Processing completed video:', {
      jobId,
      videoUrl,
      pageId,
      useAsApp,
      requestedBy,
    });
    
    const commentBodyHtml = buildCommentBodyHtml(videoUrl, requestedBy);

    // Use asApp() for scheduled triggers, asUser() for resolver calls
    const apiCall = useAsApp ? api.asApp() : api.asUser();

    // Add video as footer comment only (not to page content)
    try {
      const commentResponse = await apiCall.requestConfluence(
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
              value: commentBodyHtml
            }
          })
        }
      );
      
      if (commentResponse.ok) {
        const commentData = await commentResponse.json();
        console.log('[processCompletedVideo] Successfully added video to footer comments:', JSON.stringify(commentData, null, 2));
      } else {
        const errorText = await commentResponse.text();
        console.error('[processCompletedVideo] Failed to add footer comment:', commentResponse.status, errorText);
      }
    } catch (commentError) {
      console.error('[processCompletedVideo] Failed to add footer comment:', commentError);
    }

    // Remove job from storage and active jobs list
    try {
      const jobKey = `video-job-${jobId}`;
      await storage.delete(jobKey);
      
      const activeJobsKey = 'active-video-jobs';
      const activeJobs = await storage.get(activeJobsKey) || [];
      const updatedJobs = activeJobs.filter(id => id !== jobId);
      await storage.set(activeJobsKey, updatedJobs);
      
      console.log('[processCompletedVideo] Removed job from storage:', jobId);
    } catch (cleanupError) {
      console.warn('[processCompletedVideo] Failed to cleanup job storage:', cleanupError);
    }

    return { success: true };
  } catch (error) {
    console.error('[processCompletedVideo] Error processing completed video:', error);
    console.error('[processCompletedVideo] Full error details:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
      jobId,
      pageId
    });
    // Don't throw - log and return failure status
    return { success: false, error: error?.message || 'Unknown error' };
  }
};

// Web trigger function to poll video status in background
resolver.define('pollVideoStatusBackground', async () => {
  try {
    console.log('[pollVideoStatusBackground] Starting background polling');
    
    const API_KEY = process.env.GOLPO_API_KEY || 'api-key';
    if (!API_KEY || API_KEY === 'api-key') {
      console.error('[pollVideoStatusBackground] Golpo API key not configured');
      return { error: 'API key not configured', processed: 0 };
    }
    // Get list of active jobs
    const activeJobsKey = 'active-video-jobs';
    const activeJobs = await storage.get(activeJobsKey) || [];
    
    if (activeJobs.length === 0) {
      console.log('[pollVideoStatusBackground] No active jobs to poll');
      return { message: 'No active jobs', processed: 0 };
    }

    console.log('[pollVideoStatusBackground] Found active jobs:', activeJobs.length);

    let processed = 0;
    let completed = 0;
    let failed = 0;
    const remainingJobs = [];

    // Poll each active job
    for (const jobId of activeJobs) {
      try {
        const jobKey = `video-job-${jobId}`;
        const jobData = await storage.get(jobKey);
        
        if (!jobData) {
          console.warn('[pollVideoStatusBackground] Job data not found for:', jobId);
          continue;
        }

        const { pageId, requestedBy } = jobData;
        if (!pageId) {
          console.warn('[pollVideoStatusBackground] Page ID missing for job:', jobId);
          continue;
        }

        // Check video status
        const statusUrl = `${GOLPO_API_BASE_URL}/api/v1/videos/status/${jobId}`;
        const response = await fetch(statusUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY
          }
        });

        if (!response.ok) {
          console.warn('[pollVideoStatusBackground] Status check failed for job:', jobId, response.status);
          remainingJobs.push(jobId);
          continue;
        }

        let statusData;
        try {
          statusData = await response.json();
        } catch (jsonError) {
          console.error('[pollVideoStatusBackground] Failed to parse status response JSON:', jsonError);
          remainingJobs.push(jobId);
          continue;
        }
        processed++;

        // Check if video is ready
        if (isVideoReady(statusData)) {
          console.log('[pollVideoStatusBackground] Video status is ready for job:', jobId);
          console.log('[pollVideoStatusBackground] Full status response:', JSON.stringify(statusData, null, 2));
          
          const videoUrl = extractVideoUrlFromStatus(statusData);
          if (videoUrl) {
            console.log('[pollVideoStatusBackground] ✅ Video ready for job:', jobId);
            console.log('[pollVideoStatusBackground] Video URL:', videoUrl);
            console.log('[pollVideoStatusBackground] Processing completed video...');
            // Use asApp() since this is called from scheduled trigger (no user context)
            // Pass requestedBy from job metadata so we can attribute the comment
            await processCompletedVideo(jobId, videoUrl, pageId, true, requestedBy);
            console.log('[pollVideoStatusBackground] ✅ Successfully processed completed video for job:', jobId);
            completed++;
          } else {
            console.warn('[pollVideoStatusBackground] ⚠️ Video ready but no URL found for job:', jobId);
            console.warn('[pollVideoStatusBackground] Status data structure:', JSON.stringify(statusData, null, 2));
            // Keep job in list to retry - maybe URL will appear in next poll
            remainingJobs.push(jobId);
          }
        } else if (isVideoFailed(statusData)) {
          console.log('[pollVideoStatusBackground] Video generation failed for job:', jobId);
          // Remove failed job from storage
          try {
            await storage.delete(jobKey);
            const updatedJobs = activeJobs.filter(id => id !== jobId);
            await storage.set(activeJobsKey, updatedJobs);
          } catch (cleanupError) {
            console.warn('[pollVideoStatusBackground] Failed to cleanup failed job:', cleanupError);
          }
          failed++;
        } else {
          // Still processing, keep in list
          const currentStatus = statusData?.status || statusData?.data?.status || 'unknown';
          console.log('[pollVideoStatusBackground] ⏳ Job still processing:', jobId, 'Status:', currentStatus);
          remainingJobs.push(jobId);
        }
      } catch (jobError) {
        console.error('[pollVideoStatusBackground] Error processing job:', jobId, jobError);
        remainingJobs.push(jobId);
      }
    }

    // Update active jobs list
    try {
      await storage.set(activeJobsKey, remainingJobs);
    } catch (storageError) {
      console.error('[pollVideoStatusBackground] Failed to update active jobs list:', storageError);
      // Don't throw - continue even if storage update fails
    }

    console.log('[pollVideoStatusBackground] Polling complete:', {
      processed,
      completed,
      failed,
      remaining: remainingJobs.length
    });

    return {
      processed,
      completed,
      failed,
      remaining: remainingJobs.length
    };
  } catch (error) {
    console.error('[pollVideoStatusBackground] Error in background polling:', error);
    return { error: error.message };
  }
});

// Export handler for resolver and scheduled trigger function
const resolverDefinitions = resolver.getDefinitions();

// Export handler for resolver (required by manifest.yml)
module.exports.handler = resolverDefinitions;

// Export function for scheduled trigger (required by manifest.yml)
module.exports.pollVideoStatusBackground = async ({ context }) => {
  console.log('[pollVideoStatusBackground] ========== SCHEDULED TRIGGER INVOKED ==========');
  console.log('[pollVideoStatusBackground] Context:', JSON.stringify(context, null, 2));
  console.log('[pollVideoStatusBackground] Timestamp:', new Date().toISOString());
  
  // Get the resolver function
  const resolverFunc = resolverDefinitions['pollVideoStatusBackground'];
  if (resolverFunc) {
    return await resolverFunc({ context });
  }
  
  // Fallback implementation if resolver not found
  console.error('[pollVideoStatusBackground] Resolver function not found, using fallback');
  return { error: 'Resolver function not found' };
};
