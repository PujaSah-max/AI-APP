import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

// Base URL for Golpo AI API - default to staging, overridable via Forge variable
const GOLPO_API_BASE_URL = (process.env.GOLPO_API_BASE_URL || 'https://staging-api.golpoai.com').replace(/\/$/, '');

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
    duration = '1 min',
    voice = 'solo-female',
    language = 'English',
    includeLogo = false,
    music = 'engaging',
    style = '',
    selectedQuickAction = null,
  } = videoSpecs || {};

  // Map duration to timing value
  const timingValue = duration === '30 sec' ? '0.5' : duration === '2 min' ? '2' : '1';

  // Map voice to correct format (convert "Solo Female" to "solo-female", etc.)
  const videoVoice = voice.toLowerCase().replace(/\s+/g, '-') || 'solo-female';

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
    video_type: 'long', // Ensure video type is set to 'long' for video generation
    audio_only: false, // Explicitly set to false to generate video, not audio
    use_color: true, // Enable color for video
    video_style: true, // Enable video style
    include_watermark: false,
    logo_url: includeLogo ? 'INCLUDE_LOGO' : null,
    logo_placement: null,
    language: language || 'English',
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

export const handler = resolver.getDefinitions();
