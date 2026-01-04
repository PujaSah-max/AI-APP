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
// Accepts optional pageId in payload (from frontend) or extracts from context
resolver.define('getCurrentPage', async ({ context, payload }) => {
  try {
    console.log('[resolver:getCurrentPage] Full context received:', JSON.stringify(context, null, 2));
    console.log('[resolver:getCurrentPage] Payload received:', JSON.stringify(payload, null, 2));
    
    // First, check if pageId was provided in payload (from frontend)
    let pageId = payload?.pageId || null;
    let pageTitle = null;
    let pageType = null;
    
    if (pageId && pageId !== 'unknown' && pageId !== 'current') {
      console.log('[resolver:getCurrentPage] Using pageId from payload:', pageId);
    } else {
      // Try multiple paths to extract page ID from context
      pageId = null;
      
      // Path 1: extension.content.id (most common for contentAction)
      if (context?.extension?.content?.id) {
        pageId = context.extension.content.id;
        pageTitle = context.extension.content.title;
        pageType = context.extension.content.type;
        console.log('[resolver:getCurrentPage] Found page ID from extension.content:', pageId);
      }
    // Path 2: location.contentId (for contentBylineItem)
    else if (context?.location?.contentId) {
      pageId = context.location.contentId;
      console.log('[resolver:getCurrentPage] Found page ID from location.contentId:', pageId);
    }
    // Path 2b: location.content.id (alternative location structure)
    else if (context?.location?.content?.id) {
      pageId = context.location.content.id;
      pageTitle = context.location.content.title;
      pageType = context.location.content.type;
      console.log('[resolver:getCurrentPage] Found page ID from location.content.id:', pageId);
    }
    // Path 2c: Try location object directly
    else if (context?.location?.id) {
      pageId = context.location.id;
      console.log('[resolver:getCurrentPage] Found page ID from location.id:', pageId);
    }
      // Path 3: content.id (direct content)
      else if (context?.content?.id) {
        pageId = context.content.id;
        pageTitle = context.content.title;
        pageType = context.content.type;
        console.log('[resolver:getCurrentPage] Found page ID from content:', pageId);
      }
      // Path 4: extension.contentId (alternative structure)
      else if (context?.extension?.contentId) {
        pageId = context.extension.contentId;
        console.log('[resolver:getCurrentPage] Found page ID from extension.contentId:', pageId);
      }
      // Path 5: Try to extract from any nested structure
      else if (context) {
        // Deep search for id fields
        const searchForId = (obj, depth = 0) => {
          if (depth > 3 || !obj || typeof obj !== 'object') return null;
          if (obj.id && typeof obj.id === 'string' && obj.id.length > 0 && obj.id !== 'unknown' && obj.id !== 'current') {
            return obj.id;
          }
          for (const key in obj) {
            if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
              const found = searchForId(obj[key], depth + 1);
              if (found) return found;
            }
          }
          return null;
        };
        pageId = searchForId(context);
        if (pageId) {
          console.log('[resolver:getCurrentPage] Found page ID from deep search:', pageId);
        }
      }
    }

    // If still no page ID, try to get it from Confluence API using space and other context info
    if (!pageId || pageId === 'unknown' || pageId === 'current') {
      console.warn('[resolver:getCurrentPage] No valid page ID found in context or payload');
      console.warn('[resolver:getCurrentPage] Context structure:', JSON.stringify(context, null, 2));
      
      // Try to extract space ID and use it to find pages (last resort)
      const spaceId = context?.extension?.space?.id || 
                      context?.space?.id || 
                      context?.location?.spaceId ||
                      context?.spaceId;
      
      if (spaceId) {
        console.log('[resolver:getCurrentPage] Found space ID, attempting to get recent pages:', spaceId);
        try {
          // Try to get the most recent page from the space
          const pagesResponse = await api.asUser().requestConfluence(
            route`/wiki/api/v2/spaces/${spaceId}/pages?limit=1&sort=-lastModified`,
            {
              headers: {
                Accept: 'application/json'
              }
            }
          );
          
          if (pagesResponse.ok) {
            const pagesData = await pagesResponse.json();
            if (pagesData.results && pagesData.results.length > 0) {
              pageId = pagesData.results[0].id;
              console.log('[resolver:getCurrentPage] Found page ID from space pages:', pageId);
            }
          }
        } catch (spaceError) {
          console.warn('[resolver:getCurrentPage] Failed to get pages from space:', spaceError.message);
        }
      }
      
      // If still no page ID, return unknown
      if (!pageId || pageId === 'unknown' || pageId === 'current') {
    return {
      id: 'unknown',
      title: 'Current Page',
          type: 'page',
          needsPageId: true
    };
      }
  }

    // Try to fetch full page details from Confluence API
  try {
      const { body } = await requestPageById(pageId);
      console.log('[resolver:getCurrentPage] Successfully fetched full page details from API');
    return body;
  } catch (error) {
      console.warn('[resolver:getCurrentPage] Failed to fetch full page data from API, returning basic info:', error.message);
      // Return basic info from context if API call fails
    return {
        id: pageId,
        title: pageTitle || 'Current Page',
        type: pageType || 'page'
      };
    }
  } catch (error) {
    console.error('[resolver:getCurrentPage] Unexpected error:', error);
    // Always return a valid response, never throw
    return {
      id: 'unknown',
      title: 'Current Page',
      type: 'page',
      needsPageId: true
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

// Helper function to check if current user is a Confluence admin
const checkAdminAccess = async () => {
  try {
    const response = await api.asUser().requestConfluence(
      route`/wiki/rest/api/user/current?expand=operations`
    );
    
    if (!response.ok) {
      console.warn('[checkAdminAccess] Failed to fetch user operations:', response.status, response.statusText);
      return false;
    }
    
    const userData = await response.json();
    const operations = userData.operations || [];
    
    // Check for admin operation on application
    const isAdmin = operations.some(op => 
      op.operation === 'administer' && op.targetType === 'application'
    );
    
    return isAdmin;
  } catch (error) {
    console.error('[checkAdminAccess] Error checking admin access:', error);
    return false;
  }
};

// Check if user is Confluence admin
resolver.define('checkAdminAccess', async () => {
  try {
    const isAdmin = await checkAdminAccess();
    return { isAdmin };
  } catch (error) {
    console.error('[resolver:checkAdminAccess] Error:', error);
    return { isAdmin: false };
  }
});

// Get admin API key (only accessible to admins, returns masked key)
resolver.define('getAdminApiKey', async () => {
  try {
    // First, verify admin access
    const isAdmin = await checkAdminAccess();
    if (!isAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }
    
    // Get admin API key from storage (stored at app level, not user level)
    const storageKey = 'golpo-admin-api-key';
    const storedKey = await storage.get(storageKey);
    
    if (storedKey && storedKey.apiKey) {
      // Return masked version for display (first 4 and last 4 characters)
      const apiKey = storedKey.apiKey;
      const maskedKey = apiKey.length > 8 
        ? `${apiKey.substring(0, 4)}${'*'.repeat(Math.max(0, apiKey.length - 8))}${apiKey.substring(apiKey.length - 4)}`
        : '****';
      
      return {
        hasKey: true,
        maskedKey: maskedKey
      };
    }
    
    return {
      hasKey: false,
      maskedKey: null
    };
  } catch (error) {
    console.error('[resolver:getAdminApiKey] Error:', error);
    throw new Error(`Failed to get admin API key: ${error?.message || 'Unknown error'}`);
  }
});

// Set admin API key (only accessible to admins, with validation)
resolver.define('setAdminApiKey', async ({ payload }) => {
  try {
    // First, verify admin access
    const isAdmin = await checkAdminAccess();
    if (!isAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }
    
    const { apiKey } = payload ?? {};
    
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error('API key is required');
    }
    
    const trimmedApiKey = apiKey.trim();
    
    // Validate the API key with Golpo's credits endpoint
    try {
      const validateResponse = await fetch(`${GOLPO_API_BASE_URL}/api/v1/users/credits`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': trimmedApiKey,
        },
      });
      
      if (!validateResponse.ok) {
        throw new Error('Invalid API key. Please check your API key and try again.');
      }
      
      console.log('[resolver:setAdminApiKey] ✅ Golpo API key validated successfully via /users/credits');
    } catch (validationError) {
      console.error('[resolver:setAdminApiKey] Golpo API key validation failed:', validationError);
      throw new Error(validationError?.message || 'Failed to validate Golpo API key. Please check the key and try again.');
    }
    
    // Store API key in storage at app level (not user-specific)
    // Maintain history of all API keys
    const storageKey = 'golpo-admin-api-key';
    const historyKey = 'golpo-admin-api-key-history';
    
    // Get existing history
    let apiKeyHistory = [];
    try {
      const existingHistory = await storage.get(historyKey);
      if (existingHistory && Array.isArray(existingHistory.keys)) {
        apiKeyHistory = existingHistory.keys;
      }
    } catch (error) {
      console.warn('[resolver:setAdminApiKey] Error reading API key history:', error);
    }
    
    // Check if this key already exists in history
    const keyExists = apiKeyHistory.some(item => item.apiKey === trimmedApiKey);
    
    // If key doesn't exist, add it to history
    if (!keyExists) {
      const maskedKey = trimmedApiKey.length > 8 
        ? `${trimmedApiKey.substring(0, 4)}${'*'.repeat(Math.max(0, trimmedApiKey.length - 8))}${trimmedApiKey.substring(trimmedApiKey.length - 4)}`
        : '****';
      
      apiKeyHistory.push({
        apiKey: trimmedApiKey,
        maskedKey: maskedKey,
        addedAt: new Date().toISOString(),
        updatedBy: 'admin'
      });
      
      // Store updated history
      await storage.set(historyKey, {
        keys: apiKeyHistory,
        lastUpdated: new Date().toISOString()
      });
    }
    
    // Store current API key (for backward compatibility and quick access)
    await storage.set(storageKey, {
      apiKey: trimmedApiKey,
      updatedAt: new Date().toISOString(),
      updatedBy: 'admin'
    });
    
    // Return masked version for display
    const maskedKey = trimmedApiKey.length > 8 
      ? `${trimmedApiKey.substring(0, 4)}${'*'.repeat(Math.max(0, trimmedApiKey.length - 8))}${trimmedApiKey.substring(trimmedApiKey.length - 4)}`
      : '****';
    
    return {
      success: true,
      maskedKey: maskedKey
    };
  } catch (error) {
    console.error('[resolver:setAdminApiKey] Error:', error);
    throw new Error(`Failed to set admin API key: ${error?.message || 'Unknown error'}`);
  }
});

// Helper function to get admin API key (for internal use in other resolvers)
// Only uses admin API key configured in global page
const getUserApiKeyInternal = async () => {
  try {
    // Get admin API key (configured in global page)
    const adminStorageKey = 'golpo-admin-api-key';
    const adminStoredKey = await storage.get(adminStorageKey);
    
    if (adminStoredKey && adminStoredKey.apiKey) {
      console.log('[getUserApiKeyInternal] Using admin API key');
      return adminStoredKey.apiKey;
    }

    return null;
  } catch (error) {
    console.warn('[getUserApiKeyInternal] Error getting admin API key:', error);
    return null;
  }
};

// Helper function to update cumulative credits usage for an API key
const updateCreditsUsage = async (apiKey, creditsUsed) => {
  try {
    if (!apiKey || creditsUsed <= 0) {
      return;
    }

    const usageStorageKey = 'golpo-api-key-usage';
    
    // Get existing usage data
    let usageData = {};
    try {
      const existing = await storage.get(usageStorageKey);
      if (existing && typeof existing === 'object') {
        usageData = existing;
      }
    } catch (error) {
      console.warn('[updateCreditsUsage] Error reading usage data:', error);
    }

    // Mask the API key for storage key
    const maskedKey = apiKey.length > 8 
      ? `${apiKey.substring(0, 4)}${'*'.repeat(Math.max(0, apiKey.length - 8))}${apiKey.substring(apiKey.length - 4)}`
      : '****';

    // Get or initialize usage for this API key
    const currentUsage = usageData[maskedKey] || 0;
    const newUsage = currentUsage + creditsUsed;

    // Update usage data
    usageData[maskedKey] = newUsage;
    usageData[`${maskedKey}_lastUpdated`] = new Date().toISOString();

    // Store updated usage data
    await storage.set(usageStorageKey, usageData);
    
    console.log(`[updateCreditsUsage] Updated credits usage for ${maskedKey}: ${currentUsage} + ${creditsUsed} = ${newUsage}`);
  } catch (error) {
    console.error('[updateCreditsUsage] Error updating credits usage:', error);
  }
};

// Resolver to get credits information for all API keys in history
resolver.define('getCredits', async () => {
  try {
    const historyKey = 'golpo-admin-api-key-history';
    
    // Get API key history
    let apiKeyHistory = [];
    try {
      const existingHistory = await storage.get(historyKey);
      if (existingHistory && Array.isArray(existingHistory.keys)) {
        apiKeyHistory = existingHistory.keys;
      }
    } catch (error) {
      console.warn('[resolver:getCredits] Error reading API key history:', error);
    }
    
    // If no history, try to get current API key and add it to history
    if (apiKeyHistory.length === 0) {
      const currentApiKey = await getUserApiKeyInternal();
      if (currentApiKey) {
        const maskedKey = currentApiKey.length > 8 
          ? `${currentApiKey.substring(0, 4)}${'*'.repeat(Math.max(0, currentApiKey.length - 8))}${currentApiKey.substring(currentApiKey.length - 4)}`
          : '****';
        
        apiKeyHistory = [{
          apiKey: currentApiKey,
          maskedKey: maskedKey,
          addedAt: new Date().toISOString(),
          updatedBy: 'admin'
        }];
      }
    }
    
    if (apiKeyHistory.length === 0) {
      throw new Error('Golpo API key is not configured. Please contact your administrator to configure the API key in the Global Page Settings.');
    }
    
    // Fetch credits for all API keys in parallel
    const creditsPromises = apiKeyHistory.map(async (keyItem) => {
      try {
        const creditsResponse = await fetch(`${GOLPO_API_BASE_URL}/api/v1/users/credits`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': keyItem.apiKey,
          },
        });
        
        if (!creditsResponse.ok) {
          const errorText = await creditsResponse.text();
          console.warn(`[resolver:getCredits] Failed to fetch credits for key ${keyItem.maskedKey}: ${creditsResponse.status} ${errorText}`);
          return {
            apiKey: keyItem.maskedKey,
            creditsUsage: 0,
            currentCredits: 0,
            error: `Failed to fetch: ${creditsResponse.status}`
          };
        }
        
        const creditsData = await creditsResponse.json();
        
        // Get stored cumulative usage for this API key
        const usageStorageKey = 'golpo-api-key-usage';
        let storedUsage = 0;
        try {
          const usageData = await storage.get(usageStorageKey);
          console.log(`[resolver:getCredits] Looking for usage data. Masked key: ${keyItem.maskedKey}`);
          console.log(`[resolver:getCredits] Usage data keys:`, usageData ? Object.keys(usageData) : 'null');
          if (usageData && typeof usageData === 'object') {
            // Try exact match first
            if (usageData[keyItem.maskedKey] !== undefined) {
              storedUsage = Number(usageData[keyItem.maskedKey]) || 0;
              console.log(`[resolver:getCredits] Found exact match for ${keyItem.maskedKey}: ${storedUsage}`);
            } else {
              // Try to find by matching masked key pattern (first 4 and last 4 chars)
              const keys = Object.keys(usageData);
              const keyPrefix = keyItem.maskedKey.substring(0, 4);
              const keySuffix = keyItem.maskedKey.substring(keyItem.maskedKey.length - 4);
              const matchingKey = keys.find(k => {
                if (k === keyItem.maskedKey) return true;
                if (k.length === keyItem.maskedKey.length && k.startsWith(keyPrefix) && k.endsWith(keySuffix)) return true;
                return false;
              });
              if (matchingKey) {
                storedUsage = Number(usageData[matchingKey]) || 0;
                console.log(`[resolver:getCredits] Found usage with matching key pattern: ${matchingKey} = ${storedUsage}`);
              } else {
                console.warn(`[resolver:getCredits] No matching key found for ${keyItem.maskedKey}`);
              }
            }
          } else {
            console.warn(`[resolver:getCredits] Usage data is not an object:`, typeof usageData);
          }
        } catch (error) {
          console.warn(`[resolver:getCredits] Error reading stored usage for ${keyItem.maskedKey}:`, error);
        }
        
        return {
          apiKey: keyItem.maskedKey,
          creditsUsage: storedUsage, // Use stored cumulative usage instead of API response
          currentCredits: creditsData.credits || creditsData.current_credits || 0,
          addedAt: keyItem.addedAt
        };
      } catch (error) {
        console.error(`[resolver:getCredits] Error fetching credits for key ${keyItem.maskedKey}:`, error);
        return {
          apiKey: keyItem.maskedKey,
          creditsUsage: 0,
          currentCredits: 0,
          error: error.message
        };
      }
    });
    
    const creditsResults = await Promise.all(creditsPromises);
    
    return {
      success: true,
      credits: creditsResults
    };
  } catch (error) {
    console.error('[resolver:getCredits] Error:', error);
    throw new Error(`Failed to fetch credits: ${error?.message || 'Unknown error'}`);
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
// COMMENTED OUT: Gemini AI script generation is disabled
/*
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
*/

// Generate video using Golpo AI API
resolver.define('generateVideo', async ({ payload }) => {
  try {
  const { document, videoSpecs, description, requestedBy: requestedByFromUi, accountId: accountIdFromPayload } = payload ?? {};

  if (!document) {
    throw new Error('Document is required to generate video.');
  }

  // Get admin API key (configured in global page)
  const API_KEY = await getUserApiKeyInternal();

  if (!API_KEY) {
    throw new Error('Golpo API key is not configured. Please contact your administrator to configure the API key in the Global Page Settings.');
  }

  // Fetch credits before video generation
  let creditsBefore = 0;
  try {
    const creditsResponseBefore = await fetch(`${GOLPO_API_BASE_URL}/api/v1/users/credits`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
    });
    
    if (creditsResponseBefore.ok) {
      const creditsDataBefore = await creditsResponseBefore.json();
      creditsBefore = creditsDataBefore.credits || creditsDataBefore.current_credits || 0;
      console.log('[resolver:generateVideo] Credits before generation:', creditsBefore);
    }
  } catch (error) {
    console.warn('[resolver:generateVideo] Failed to fetch credits before generation:', error);
  }

  // Build the prompt from the document
  // Include title and content, but exclude footer comments from prompt
  const title = document.title || '';
  const content = document.content || '';
  const documentText = title ? `TITLE: ${title}\nCONTENT:\n${content}` : content;

  if (!documentText || documentText.trim() === '') {
    throw new Error('Document content is empty. Cannot generate video.');
  }

  // COMMENTED OUT: Convert document to script using Gemini AI
  // console.log('[resolver:generateVideo] Step 1: Converting document to script using Gemini AI...');
  // console.log('[resolver:generateVideo] Document length:', documentText.length, 'characters');
  // console.log('[resolver:generateVideo] Video specs:', {
  //   duration: videoSpecs.duration || videoSpecs.durationLabel || '1 min',
  //   language: videoSpecs.language || 'English',
  //   description: description || 'None'
  // });
  // 
  // const videoScript = await convertDocumentToScript(documentText, videoSpecs, description, documentText);
  // 
  // // Log script generation result
  // if (videoScript && videoScript !== documentText) {
  //   console.log('[resolver:generateVideo] ✓ Successfully generated script from document');
  //   console.log('[resolver:generateVideo] Script length:', videoScript.length, 'characters');
  //   console.log('[resolver:generateVideo] ========== FULL GEMINI GENERATED SCRIPT ==========');
  //   console.log(videoScript);
  //   console.log('[resolver:generateVideo] ========== END OF GEMINI GENERATED SCRIPT ==========');
  // } else {
  //   console.warn('[resolver:generateVideo] ⚠ Script generation failed or skipped, using original document');
  //   console.log('[resolver:generateVideo] Using document length:', documentText.length, 'characters');
  //   console.log('[resolver:generateVideo] ========== ORIGINAL DOCUMENT (NO SCRIPT GENERATED) ==========');
  //   console.log(documentText);
  //   console.log('[resolver:generateVideo] ========== END OF ORIGINAL DOCUMENT ==========');
  // }
  
  // Use documentText directly as prompt (plain text, no JSON wrapper)
  const prompt = documentText;

  // Extract values from videoSpecs
  const {
    durationMinutes,
    durationLabel,
    duration = '1 min',
    voice = 'solo-female',
    language = 'English',
    
    useColor = false,
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
    
    // Use exact calculated duration (no rounding)
    const finalMinutes = calculatedMinutes;
    
    console.log(`[resolver:generateVideo] Content has ${wordCount} words. Calculated duration: ${finalMinutes.toFixed(2)} minutes`);
    
    return finalMinutes;
  };

  // Get content for duration calculation (exclude footer comments)
  const contentForDuration = document?.content || prompt || description || '';
  const calculatedDuration = calculateDurationFromContent(contentForDuration);

  // Map duration to timing value
  // Use user-selected duration if provided, otherwise use calculated duration
  const userSelectedDuration =
    parseDurationToMinutes(durationMinutes) ??
    parseDurationToMinutes(durationLabel) ??
    parseDurationToMinutes(duration);
  
  // Prioritize user selection over calculated duration
  let resolvedDuration;
  if (userSelectedDuration !== null) {
    resolvedDuration = userSelectedDuration;
    console.log(`[resolver:generateVideo] Using user-selected duration: ${resolvedDuration} minutes${calculatedDuration ? ` (calculated was ${calculatedDuration} minutes)` : ''}`);
  } else if (calculatedDuration) {
    resolvedDuration = calculatedDuration;
    console.log(`[resolver:generateVideo] Using calculated duration: ${resolvedDuration} minutes`);
  } else {
    // Fallback to 1 minute if nothing is provided
    resolvedDuration = 1;
    console.log(`[resolver:generateVideo] Using fallback duration: ${resolvedDuration} minutes`);
  }
  
  // Use exact user-selected duration (no rounding)
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

  // Use the document in JSON format
  const issueDocument = JSON.stringify(document);

  // Build request body with all parameters
  // Ensure video generation (not audio-only) by setting audio_only to false and video_type to 'long'
  const requestBody = {
    prompt,
    uploads: null,
    // direct_script: videoScript, // COMMENTED OUT: Use Gemini-generated script
    edited_script: null,
    own_narration_mode: false,
    has_custom_audio: false,
    bg_music: (music || 'engaging').toLowerCase(),
    video_duration: timingValue,
    video_voice: videoVoice,
    video_type: videoType,
    audio_only: false, // Explicitly set to false to generate video, not audio
    use_color: useColor || false, // Enable color for video based on user selection
    video_style: true, // Enable video style
    include_watermark: false,
    logo_url: null,
    logo_placement: null,
    language: videoLanguage,
    voice_instructions: videoVoice || '',
    video_instructions: style || '',
    script_mode: false,
    enable_script_editing: false,
    //attached_documents: issueDocument ? [issueDocument] : [],
    personality_1: selectedQuickAction || null,
    do_research: false,
    tts_model: 'accurate',
    style: videoVoice,
    bg_volume: 1.0,
    logo: null,
    timing: timingValue,
    // new_script: videoScript || description || null, // COMMENTED OUT: Use Gemini-generated script instead of raw document
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

    // Check if credits info is in the response
    const responseCredits = data?.credits_used || data?.creditsUsed || data?.credits_deducted || null;
    
    // Extract jobId and pageId from response/document
    const jobId = data?.job_id || data?.jobId || data?.id || data?.data?.job_id || data?.data?.jobId;
    const pageId = document?.pageId || document?.metadata?.pageId;

    // Store credits before value with jobId for tracking when video completes
    // Credits are deducted when video generation is completed, not immediately
    if (jobId && creditsBefore > 0) {
      try {
        const jobCreditsKey = `golpo-job-credits-${jobId}`;
        await storage.set(jobCreditsKey, {
          creditsBefore: creditsBefore,
          apiKey: API_KEY,
          createdAt: new Date().toISOString()
        });
        console.log(`[resolver:generateVideo] Stored credits before (${creditsBefore}) for job ${jobId}`);
      } catch (error) {
        console.warn('[resolver:generateVideo] Failed to store credits before for job:', error);
      }
    }

    // If we have a jobId and pageId, store job info in Forge storage for background polling
    if (jobId && pageId) {
      try {
        // Prefer requestedBy passed from UI (already running as the user)
        let requestedBy = requestedByFromUi || null;
        try {
          if (requestedBy) {
            console.log('[resolver:generateVideo] Using requestedBy from UI payload:', requestedBy);
          } else {
            console.log('[resolver:generateVideo] requestedBy not provided by UI, fetching current user data from Confluence API...');
          }
          
          // If not provided by UI, fall back to Confluence API lookups
          if (!requestedBy) {
            // Prefer Confluence API v2: GET /wiki/api/v2/users/me
            let meResponse = await api.asUser().requestConfluence(
              route`/wiki/api/v2/users/me`
            );
            
            // Fallback to REST API v1: GET /wiki/rest/api/user/current
            if (!meResponse.ok) {
              console.warn('[resolver:generateVideo] /wiki/api/v2/users/me failed, trying /wiki/rest/api/user/current...');
              try {
                meResponse = await api.asUser().requestConfluence(
                  route`/wiki/rest/api/user/current`
                );
              } catch (v1Error) {
                console.warn('[resolver:generateVideo] /wiki/rest/api/user/current also failed:', v1Error?.message);
              }
            }
            
            if (!requestedBy && meResponse && meResponse.ok) {
              const me = await meResponse.json();
              console.log('[resolver:generateVideo] User data received:', JSON.stringify(me, null, 2));
              
              // Normalise current user into requestedBy object
              requestedBy = {
                accountId: me.accountId || me.userKey || me.key || null,
                displayName: me.displayName || me.publicName || me.name || null,
                publicName: me.publicName || me.displayName || null,
                name: me.name || me.displayName || null,
                username: me.username || null,
                email: me.email || me.emailAddress || null,
                profilePicture:
                  me.profilePicture?.path ||
                  me.profilePicture?.href ||
                  me.avatarUrls?.['48x48'] ||
                  me.avatarUrls?.['32x32'] ||
                  me.avatarUrls?.['24x24'] ||
                  me.avatarUrls?.['16x16'] ||
                  null,
                type: me.type || me.userType || null,
              };
              
              // Store user info separately in Forge storage for future reference (optional)
              if (requestedBy.accountId) {
                const userStorageKey = `user-info-${requestedBy.accountId}`;
                try {
                  await storage.set(userStorageKey, {
                    ...requestedBy,
                    lastUpdated: new Date().toISOString(),
                  });
                  console.log('[resolver:generateVideo] ✅ Stored user info in Forge storage:', userStorageKey);
                } catch (userStorageError) {
                  console.warn('[resolver:generateVideo] Failed to store user info separately:', userStorageError);
                  // Continue even if separate storage fails
                }
              }
              
              console.log('[resolver:generateVideo] ✅ User data captured and ready to store with job:', {
                accountId: requestedBy.accountId,
                displayName: requestedBy.displayName,
              });
            } else {
              const errorText = meResponse ? await meResponse.text() : 'No response';
              console.warn('[resolver:generateVideo] Failed to fetch current user info for job metadata (both endpoints):', {
                status: meResponse?.status || 'unknown',
                statusText: meResponse?.statusText || 'unknown',
                error: errorText,
              });
            }
          }
        } catch (userError) {
          console.warn('[resolver:generateVideo] Error fetching current user info for job metadata:', {
            message: userError?.message,
            stack: userError?.stack,
          });
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
    // COMMENTED OUT: script generation info (Gemini AI disabled)
    const responseBody = {
      ...data
      // scriptGenerated: videoScript !== documentText,
      // scriptPreview: videoScript && videoScript !== documentText ? videoScript.substring(0, 200) + '...' : null
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

  // Stop long-running generations: if a job is older than 1 hour, cancel it (best-effort) and return timeout.
  // This is the "source of truth" used by the frontend to show the failure popup.
  const TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
  const TIMEOUT_LABEL = '1 hour';

  // Best-effort: cancel provider job
  const cancelProviderJob = async (apiKey, id) => {
    if (!apiKey) return false;

    const tryUrls = [
      `${GOLPO_API_BASE_URL}/api/v1/videos/${id}`,
      `${GOLPO_API_BASE_URL}/api/v1/videos/cancel`,
      `${GOLPO_API_BASE_URL}/api/v1/videos/${id}/cancel`
    ];

    for (const url of tryUrls) {
      try {
        let resp;
        if (url.endsWith(`/${id}`)) {
          resp = await fetchWithTimeout(url, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }
          }, 20000);
        } else {
          resp = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ job_id: id })
          }, 20000);
        }

        if (resp && (resp.ok || resp.status === 202 || resp.status === 204)) {
          console.log('[resolver:getVideoStatus] Provider cancel success for job:', id, 'via', url);
          return true;
        }
      } catch (e) {
        // continue
      }
    }
    return false;
  };

  const buildTimeoutResponse = () => ({
    status: 200,
    statusText: 'OK',
    body: {
      status: 'timeout',
      job_status: 'timeout',
      state: 'timeout',
      message: `Video generation took longer than ${TIMEOUT_LABEL} and was stopped. Please regenerate.`,
      error: 'Video generation timeout'
    }
  });

  try {
    const jobKey = `video-job-${jobId}`;
    const jobData = await storage.get(jobKey);

    if (jobData && jobData.createdAt) {
      const createdAt = new Date(jobData.createdAt).getTime();
      const elapsedMs = Date.now() - createdAt;

      if (Number.isFinite(elapsedMs) && elapsedMs >= TIMEOUT_MS) {
        console.log('[resolver:getVideoStatus] Job timed out, stopping generation:', { jobId, elapsedMs, timeoutMs: TIMEOUT_MS });

        // Get API key for cancellation attempt
        let apiKey = null;
        try {
          apiKey = await getUserApiKeyInternal();
        } catch (e) {}

        // Best-effort cancel at provider
        try {
          await cancelProviderJob(apiKey, jobId);
        } catch (e) {}

        // Remove job from active list & storage so background polling stops
        try {
          const activeJobsKey = 'active-video-jobs';
          const activeJobs = await storage.get(activeJobsKey) || [];
          const updatedJobs = activeJobs.filter(id => id !== jobId);
          await storage.set(activeJobsKey, updatedJobs);
        } catch (e) {}

        try {
          await storage.delete(jobKey);
        } catch (e) {}

        return buildTimeoutResponse();
      }
    }
  } catch (e) {
    // If timeout check fails, fall back to provider status below.
  }

  // Get admin API key (configured in global page)
  const API_KEY = await getUserApiKeyInternal();

  if (!API_KEY) {
    throw new Error('Golpo API key is not configured. Please contact your administrator to configure the API key in the Global Page Settings.');
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

    // Check if video is completed and track credits usage
    const videoStatus = data?.status || data?.state || data?.body?.status || '';
    const statusLower = videoStatus.toLowerCase();
    const isCompleted = statusLower === 'completed' || 
                       statusLower === 'ready' || 
                       statusLower === 'success' || 
                       statusLower === 'finished' || 
                       statusLower === 'done' ||
                       statusLower === 'complete';

    if (isCompleted && jobId) {
      try {
        // Get stored credits before value for this job
        const jobCreditsKey = `golpo-job-credits-${jobId}`;
        const jobCreditsData = await storage.get(jobCreditsKey);
        
        if (jobCreditsData && jobCreditsData.creditsBefore && !jobCreditsData.creditsTracked) {
          const creditsBefore = jobCreditsData.creditsBefore;
          const apiKey = jobCreditsData.apiKey || API_KEY;
          
          // Fetch current credits after completion
          const creditsResponseAfter = await fetch(`${GOLPO_API_BASE_URL}/api/v1/users/credits`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
          });
          
          if (creditsResponseAfter.ok) {
            const creditsDataAfter = await creditsResponseAfter.json();
            const creditsAfter = creditsDataAfter.credits || creditsDataAfter.current_credits || 0;
            const creditsUsed = creditsBefore - creditsAfter;
            
            console.log('[resolver:getVideoStatus] Video completed. Credits tracking:', {
              jobId: jobId,
              before: creditsBefore,
              after: creditsAfter,
              used: creditsUsed
            });
            
            if (creditsUsed > 0) {
              console.log('[resolver:getVideoStatus] Credits used for completed video:', creditsUsed);
              
              // Update cumulative credits usage for this API key
              await updateCreditsUsage(apiKey, creditsUsed);
              
              // Mark as tracked to avoid double counting
              await storage.set(jobCreditsKey, {
                ...jobCreditsData,
                creditsAfter: creditsAfter,
                creditsUsed: creditsUsed,
                creditsTracked: true,
                trackedAt: new Date().toISOString()
              });
            } else {
              console.warn('[resolver:getVideoStatus] No credits deducted. Before:', creditsBefore, 'After:', creditsAfter);
            }
          }
        } else if (jobCreditsData && jobCreditsData.creditsTracked) {
          console.log('[resolver:getVideoStatus] Credits already tracked for job:', jobId);
        }
      } catch (error) {
        console.warn('[resolver:getVideoStatus] Error tracking credits for completed video:', error);
      }
    }

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

// Cancel a video job (best-effort) - attempts to cancel at provider and marks job cancelled locally
resolver.define('cancelVideoJob', async ({ payload, context }) => {
  try {
    const { jobId, accountId } = payload ?? {};

    if (!jobId || typeof jobId !== 'string') {
      throw new Error('Job id is required to cancel video job.');
    }

    // Load job data from storage
    const jobKey = `video-job-${jobId}`;
    const jobData = await storage.get(jobKey);

    if (!jobData) {
      console.warn('[resolver:cancelVideoJob] Job not found in storage:', jobId);
      // Still attempt provider cancellation as a best-effort using API key
    }

    // Permission check: allow if caller is admin or accountId matches requestedBy.accountId
    const isAdmin = await checkAdminAccess();
    if (!isAdmin) {
      // If no accountId provided, try to proceed as server (best-effort) but log warning
      if (!accountId && jobData?.requestedBy?.accountId) {
        console.warn('[resolver:cancelVideoJob] No accountId provided by caller, proceeding as app');
      } else if (accountId && jobData && jobData.requestedBy && jobData.requestedBy.accountId && accountId !== jobData.requestedBy.accountId) {
        throw new Error('Unauthorized: only the job owner or an admin may cancel this job');
      }
    }

    // Get API key
    const API_KEY = await getUserApiKeyInternal();
    let providerCancelled = false;
    let providerResponse = null;

    if (API_KEY) {
      // Try a few plausible provider endpoints for cancellation (best-effort)
      const tryUrls = [
        `${GOLPO_API_BASE_URL}/api/v1/videos/${jobId}`,
        `${GOLPO_API_BASE_URL}/api/v1/videos/cancel`,
        `${GOLPO_API_BASE_URL}/api/v1/videos/${jobId}/cancel`
      ];

      for (const url of tryUrls) {
        try {
          // Prefer DELETE for direct resource removal, fallback to POST with body
          let resp;
          if (url.endsWith(`/${jobId}`)) {
            resp = await fetchWithTimeout(url, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
              }
            }, 20000);
          } else {
            resp = await fetchWithTimeout(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
              },
              body: JSON.stringify({ job_id: jobId })
            }, 20000);
          }

          providerResponse = resp;
          if (resp && (resp.ok || resp.status === 202 || resp.status === 204)) {
            providerCancelled = true;
            console.log('[resolver:cancelVideoJob] Provider reported cancel success for job:', jobId, 'via', url);
            break;
          } else {
            console.warn('[resolver:cancelVideoJob] Provider cancel attempt returned non-OK:', url, resp && resp.status);
            // continue trying other endpoints
          }
        } catch (err) {
          console.warn('[resolver:cancelVideoJob] Provider cancel attempt failed for', url, err && err.message);
          // try next
        }
      }
    } else {
      console.warn('[resolver:cancelVideoJob] No API key available for provider cancel - will mark job cancelled locally');
    }

    // Remove job from active list and storage (or mark cancelled)
    try {
      const activeJobsKey = 'active-video-jobs';
      const activeJobs = await storage.get(activeJobsKey) || [];
      const updatedJobs = activeJobs.filter(id => id !== jobId);
      await storage.set(activeJobsKey, updatedJobs);

      // Delete job entry if present
      try {
        await storage.delete(jobKey);
        console.log('[resolver:cancelVideoJob] Deleted job storage key:', jobKey);
      } catch (delErr) {
        console.warn('[resolver:cancelVideoJob] Failed to delete job storage key, attempting to mark cancelled:', delErr);
        if (jobData) {
          jobData.status = 'cancelled';
          jobData.cancelledAt = new Date().toISOString();
          try {
            await storage.set(jobKey, jobData);
            console.log('[resolver:cancelVideoJob] Marked job cancelled in storage:', jobKey);
          } catch (setErr) {
            console.warn('[resolver:cancelVideoJob] Failed to mark job cancelled in storage:', setErr);
          }
        }
      }
    } catch (cleanupErr) {
      console.warn('[resolver:cancelVideoJob] Failed to cleanup job from storage/active list:', cleanupErr);
    }

    return {
      success: true,
      canceled: providerCancelled,
      providerStatus: providerResponse ? (providerResponse.status || null) : null,
      message: providerCancelled ? 'Cancelled at provider' : 'Marked cancelled locally (best-effort)'
    };
  } catch (error) {
    console.error('[resolver:cancelVideoJob] Error:', error);
    return { success: false, error: error?.message || 'Unknown error' };
  }
});

resolver.define('fetchVideoFile', async ({ payload }) => {
  try {
  const { videoUrl } = payload ?? {};

    if (!videoUrl || typeof videoUrl !== 'string') {
    throw new Error('Video url is required to fetch media.');
  }

    // We now prefer a SIMPLE path for small videos:
    // - Always try to download the file once on the backend
    // - If it's reasonably small (<= MAX_SIZE), return base64 bytes
    // - If it's larger, return the original URL and let the frontend use chunked HTTP streaming
    //
    // This works for BOTH S3 and non-S3 URLs, and avoids sending large blobs
    // through Forge's GraphQL response (5MB limit).
    const isS3Url =
      videoUrl.includes('s3.amazonaws.com') ||
      videoUrl.includes('s3.us-east-2.amazonaws.com');

    console.log('[resolver:fetchVideoFile] Fetching video bytes to determine size', {
      videoUrl,
      isS3Url,
    });

    const response = await fetch(videoUrl, {
      method: 'GET',
      headers: {
        'Accept': 'video/mp4,video/*,*/*',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unable to read error body');
      console.error('[resolver:fetchVideoFile] Failed to fetch video', {
        videoUrl,
        status: response.status,
        statusText: response.statusText,
        errorBody: errorBody.substring(0, 500)
      });
      throw new Error(`Failed to fetch video content. Status: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader
      ? parseInt(contentLengthHeader, 10)
      : arrayBuffer.byteLength;
    // IMPORTANT: Forge GraphQL responses are limited to 5MB (5,242,880 bytes) total.
    // Base64 encoding adds ~33% overhead, plus JSON wrapper bytes.
    // To stay safely under the 5MB cap, we only inline videos up to ~3MB raw.
    const MAX_SIZE = 3 * 1024 * 1024; // 3MB raw bytes (~4MB base64) to avoid 5MB GraphQL limit
    
    // If file is too large, return URL for chunked download instead
    if (contentLength > MAX_SIZE) {
      console.log('[resolver:fetchVideoFile] File too large for inline base64, returning URL for chunked download', {
        contentLength,
        sizeInMB: (contentLength / (1024 * 1024)).toFixed(2),
        isS3Url,
      });
      return {
        signedUrl: videoUrl,
        contentType: response.headers.get('content-type') || 'video/mp4',
        useChunkedDownload: true,
        contentLength,
      };
    }
    
    // Only return bytes for small files (safe to send as base64)
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const contentType = response.headers.get('content-type') || 'video/mp4';

    console.log('[resolver:fetchVideoFile] Successfully fetched SMALL video for inline playback', {
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
    console.error('[resolver:fetchVideoFile] Error:', {
      videoUrl,
      error: error.message
    });
    throw new Error(`Failed to fetch video file: ${error.message}`);
  }
});

// Helper function for fetch with timeout
const fetchWithTimeout = async (url, options = {}, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
};

// Upload video to Atlassian Media API and return mediaId
// This streams the video from S3 to Media API without loading it into memory
resolver.define('uploadVideoToMedia', async ({ payload, context }) => {
  try {
    const { videoUrl } = payload ?? {};
    
    if (!videoUrl || typeof videoUrl !== 'string') {
      throw new Error('Video URL is required');
    }
    
    console.log('[resolver:uploadVideoToMedia] Starting upload to Media API:', videoUrl);
    
    // Fetch video from S3 as a stream (not loading into memory)
    const videoResponse = await fetch(videoUrl, {
      method: 'GET',
      headers: {
        'Accept': 'video/mp4,video/*,*/*',
      }
    });
    
    if (!videoResponse.ok) {
      throw new Error(`Failed to fetch video from S3: ${videoResponse.status} ${videoResponse.statusText}`);
    }
    
    // Get content type and size
    const contentType = videoResponse.headers.get('content-type') || 'video/mp4';
    const contentLength = videoResponse.headers.get('content-length');
    
    console.log('[resolver:uploadVideoToMedia] Video metadata:', {
      contentType,
      contentLength: contentLength ? `${(parseInt(contentLength) / (1024 * 1024)).toFixed(2)}MB` : 'unknown'
    });
    
    // Convert ReadableStream to Buffer for Media API upload
    // Note: For very large files, we should stream, but Forge API requires Buffer
    const arrayBuffer = await videoResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Upload to Confluence Media API using REST API
    // POST /wiki/rest/api/media/upload
    const filename = `golpo-video-${Date.now()}.mp4`;
    const boundary = `----WebKitFormBoundary${Date.now()}`;
    
    // Create multipart form data manually
    const formDataParts = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      '',
      buffer,
      `--${boundary}--`
    ];
    
    // Combine parts into single buffer
    const formDataBuffer = Buffer.concat(
      formDataParts.map(part => 
        typeof part === 'string' ? Buffer.from(part + '\r\n', 'utf8') : Buffer.concat([part, Buffer.from('\r\n')])
      )
    );
    
    const uploadResponse = await api.asUser().requestConfluence(
      route`/wiki/rest/api/media/upload`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: formDataBuffer,
      }
    );
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Media API upload failed: ${uploadResponse.status} ${errorText}`);
    }
    
    const uploadData = await uploadResponse.json();
    // Media API returns data in different formats, try multiple paths
    const mediaId = uploadData.results?.[0]?.data?.id || 
                    uploadData.results?.[0]?.id ||
                    uploadData.data?.id ||
                    uploadData.id;
    
    if (!mediaId) {
      throw new Error('Media API did not return mediaId');
    }
    
    console.log('[resolver:uploadVideoToMedia] ✅ Successfully uploaded to Media API, mediaId:', mediaId);
    
    return {
      mediaId: mediaId,
      contentType: contentType
    };
  } catch (error) {
    console.error('[resolver:uploadVideoToMedia] Error:', error);
    throw new Error(`Failed to upload video to Media API: ${error.message}`);
  }
});

// Get playback URL for a mediaId
// Returns a URL that can be used directly in <video> element with CSP compliance
resolver.define('getPlaybackUrl', async ({ payload, context }) => {
  try {
    const { mediaId } = payload ?? {};
    
    if (!mediaId || typeof mediaId !== 'string') {
      throw new Error('Media ID is required');
    }
    
    console.log('[resolver:getPlaybackUrl] Getting playback URL for mediaId:', mediaId);
    
    // Get playback URL from Confluence Media API
    // GET /wiki/rest/api/media/{mediaId}/playback
    const playbackResponse = await api.asUser().requestConfluence(
      route`/wiki/rest/api/media/${mediaId}/playback`,
      {
        method: 'GET',
      }
    );
    
    if (!playbackResponse.ok) {
      const errorText = await playbackResponse.text();
      throw new Error(`Failed to get playback URL: ${playbackResponse.status} ${errorText}`);
    }
    
    const playbackData = await playbackResponse.json();
    const playbackUrl = playbackData.url || playbackData.playbackUrl;
    
    if (!playbackUrl) {
      throw new Error('Media API did not return playback URL');
    }
    
    console.log('[resolver:getPlaybackUrl] ✅ Got playback URL:', playbackUrl);
    
    // Append ?client=forge to ensure proper authentication
    const finalUrl = playbackUrl.includes('?') 
      ? `${playbackUrl}&client=forge`
      : `${playbackUrl}?client=forge`;
    
    return {
      playbackUrl: finalUrl,
      mediaId: mediaId
    };
  } catch (error) {
    console.error('[resolver:getPlaybackUrl] Error:', error);
    throw new Error(`Failed to get playback URL: ${error.message}`);
  }
});

// Get signed video URL - returns a signed URL that frontend can fetch directly
// This avoids sending video bytes through Forge's GraphQL (5MB limit)
// DEPRECATED: Use uploadVideoToMedia + getPlaybackUrl instead
resolver.define('getSignedVideoUrl', async ({ payload }) => {
  try {
    const { videoUrl } = payload ?? {};
    
    if (!videoUrl || typeof videoUrl !== 'string') {
      throw new Error('Video URL is required');
    }
    
    console.log('[resolver:getSignedVideoUrl] Getting signed URL for:', videoUrl);
    
    // Check if URL is from S3
    const isS3Url = videoUrl.includes('s3.amazonaws.com') || videoUrl.includes('s3.us-east-2.amazonaws.com');
    
    if (isS3Url) {
      // For S3 URLs, extract the key and generate a signed URL
      // Example: https://golpo-stage-private.s3.us-east-2.amazonaws.com/files/abc123.mp4
      // Key would be: files/abc123.mp4
      
      try {
        // Extract S3 key from URL
        const urlObj = new URL(videoUrl);
        const key = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
        
        console.log('[resolver:getSignedVideoUrl] Extracted S3 key:', key);
        
        // For now, return the original URL if it's already accessible
        // If you have AWS SDK configured, you can generate a signed URL here:
        // const AWS = require('aws-sdk');
        // const s3 = new AWS.S3();
        // const signedUrl = s3.getSignedUrl('getObject', {
        //   Bucket: 'golpo-stage-private',
        //   Key: key,
        //   Expires: 300 // 5 minutes
        // });
        
        // For now, return the URL as-is (assuming it's already accessible or pre-signed)
        // Frontend will fetch it directly
        return {
          signedUrl: videoUrl,
          contentType: 'video/mp4',
          expiresIn: 300 // 5 minutes
        };
      } catch (parseError) {
        console.error('[resolver:getSignedVideoUrl] Failed to parse S3 URL:', parseError);
        // Fallback: return URL as-is
        return {
          signedUrl: videoUrl,
          contentType: 'video/mp4',
          expiresIn: 300
        };
      }
    }
    
    // For non-S3 URLs, return as-is (frontend will fetch directly)
    return {
      signedUrl: videoUrl,
      contentType: 'video/mp4',
      expiresIn: 300
    };
  } catch (error) {
    console.error('[resolver:getSignedVideoUrl] Error:', error);
    throw new Error(`Failed to get signed video URL: ${error.message}`);
  }
});

// Fetch a single chunk of video using HTTP Range request
// This allows downloading large files in chunks, bypassing Forge's 6MB payload limit
resolver.define('fetchVideoChunk', async ({ payload }) => {
  const { videoUrl, startByte, endByte } = payload || {};

  if (!videoUrl) {
    return {
      status: 400,
      error: 'videoUrl is required to fetch the video chunk.',
    };
  }

  try {
    // Build Range header for partial content request
    const rangeHeader = endByte
      ? `bytes=${startByte || 0}-${endByte}`
      : `bytes=${startByte || 0}-`;

    console.log(`[resolver:fetchVideoChunk] Fetching video chunk: ${rangeHeader} from ${videoUrl}`);

    const response = await fetchWithTimeout(
      videoUrl,
      {
        method: 'GET',
        headers: {
          'Accept': 'video/mp4, video/*, */*',
          'Range': rangeHeader,
        },
      },
      20000 // 20 second timeout
    );

    if (!response.ok && response.status !== 206) {
      // 206 is Partial Content, which is expected for Range requests
      const preview = await response.text().catch(() => 'Unable to read error body');
      console.error(`[resolver:fetchVideoChunk] Failed to fetch video chunk ${videoUrl}: ${response.status}`, preview);
      return {
        status: response.status,
        error: `Failed to fetch video chunk: ${response.statusText}`,
        details: preview.slice(0, 200),
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const contentType = response.headers.get('content-type') || 'video/mp4';
    const contentRange = response.headers.get('content-range');
   
    // Parse total file size from Content-Range header (e.g., "bytes 0-1023/5242880")
    let totalSize = null;
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)/);
      if (match) {
        totalSize = parseInt(match[1], 10);
      }
    }

    console.log(`[resolver:fetchVideoChunk] Successfully fetched video chunk, size: ${arrayBuffer.byteLength} bytes, total: ${totalSize || 'unknown'}`);

    return {
      status: 200,
      base64Data,
      contentType,
      chunkSize: arrayBuffer.byteLength,
      totalSize,
      isComplete: !endByte || (totalSize && arrayBuffer.byteLength >= totalSize),
    };
  } catch (error) {
    console.error('[resolver:fetchVideoChunk] Error fetching video chunk:', error);
    return {
      status: 500,
      error: error.message || 'Failed to fetch video chunk.',
    };
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
  const { pageId, videoUrl } = payload ?? {};

    if (!pageId || typeof pageId !== 'string') {
    throw new Error('Page id is required to add footer comment.');
  }

    if (!videoUrl || typeof videoUrl !== 'string') {
    throw new Error('Video URL is required to add footer comment.');
  }

  // IMPORTANT: Use Confluence "storage" (HTML) here because it has proven to be the most reliable
  // format across sites/endpoints and is what "worked fine before".
  const representation = 'storage';
  const generatedByName = await fetchCurrentUserDisplayName(api.asUser());
  const value = buildFooterCommentStorageHtml(videoUrl, generatedByName);

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
            representation,
            value
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
      
    console.log('[resolver:addVideoCommentToPage] Footer comment created successfully (ADF):', JSON.stringify(commentData, null, 2));

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
         statusLower === 'rejected' ||
         statusLower === 'timeout';
};

// Helper function to fetch user info by accountId from Confluence API
const fetchUserByAccountId = async (accountId, useAsApp = false) => {
  if (!accountId) {
    return null;
  }
  
  try {
    console.log('[fetchUserByAccountId] Fetching user info for accountId:', accountId);
    const apiCall = useAsApp ? api.asApp() : api.asUser();
    
    // Prefer Confluence REST API v1 with accountId query parameter
    // GET /wiki/rest/api/user?accountId={accountId}
    let userResponse = await apiCall.requestConfluence(
      route`/wiki/rest/api/user?accountId=${accountId}`
    );
    
    // If v1 API fails, try Confluence API v2 (accountId in path)
    if (!userResponse.ok) {
      console.log('[fetchUserByAccountId] REST API v1 failed, trying API v2 /users/{accountId}...');
      try {
        userResponse = await apiCall.requestConfluence(
          route`/wiki/api/v2/users/${accountId}`
        );
      } catch (v2Error) {
        console.warn('[fetchUserByAccountId] API v2 also failed:', v2Error?.message);
        // Keep the original response for error handling
      }
    }
    
    if (userResponse && userResponse.ok) {
      const userData = await userResponse.json();
      console.log('[fetchUserByAccountId] ✅ Successfully fetched user:', {
        accountId: userData.accountId || userData.userKey || accountId,
        displayName: userData.displayName || userData.displayName || userData.fullName,
        publicName: userData.publicName || userData.displayName || userData.fullName,
        name: userData.name || userData.displayName || userData.fullName,
        username: userData.username || userData.userKey || null,
      });
      
      // Handle different response formats (v2 vs v1)
      return {
        accountId: userData.accountId || userData.userKey || accountId,
        displayName: userData.displayName || userData.fullName || userData.publicName || userData.name || null,
        publicName: userData.publicName || userData.displayName || userData.fullName || null,
        name: userData.name || userData.displayName || userData.fullName || userData.publicName || null,
        username: userData.username || userData.userKey || null,
      };
    } else {
      const errorText = userResponse ? await userResponse.text() : 'No response';
      console.warn('[fetchUserByAccountId] Failed to fetch user:', {
        accountId,
        status: userResponse?.status || 'unknown',
        error: errorText,
      });
      return null;
    }
  } catch (error) {
    console.warn('[fetchUserByAccountId] Error fetching user by accountId:', {
      accountId,
      error: error?.message,
    });
    return null;
  }
};

// Helper function to build comment body in ADF (atlas_doc_format).
// Using ADF avoids Confluence showing the "legacy/unsupported content" warning banner.
// Also: do NOT display the raw URL text in the comment.
const buildCommentBodyAdf = async (videoUrl, requestedBy, useAsApp = false) => {
  console.log('[buildCommentBodyAdf] Input:', {
    videoUrl,
    requestedBy: requestedBy ? JSON.stringify(requestedBy, null, 2) : 'null',
    useAsApp,
  });

  const href = String(videoUrl || '');

  // Minimal ADF: friendly message + link text "▶ Play video"
  const adf = {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Video generated. Click the button below to play.' }
        ]
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '▶ Play video',
            marks: [
              {
                type: 'link',
                attrs: { href }
              }
            ]
          },
        ]
      }
    ]
  };

  console.log('[buildCommentBodyAdf] Final ADF:', JSON.stringify(adf));
  return adf;
};

// Helper function to build footer comment body in Confluence Storage format (HTML).
// This is used as a fallback when atlas_doc_format (ADF) is rejected by Confluence.
// IMPORTANT: Avoid showing raw URL text; render a friendly message + a link.
const buildFooterCommentStorageHtml = (videoUrl, generatedByName = null) => {
  const escapeHtml = (input) =>
    String(input ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const safeUrl = escapeHtml(videoUrl || '');
  const safeGeneratedBy = generatedByName ? escapeHtml(generatedByName) : '';
  // Use HTML entity for the play symbol to avoid encoding issues rendering as "???".
  const playText = '&#9658; Play video';
  const generatedByLine = safeGeneratedBy
    ? `<p style="margin-top: 12px; margin-bottom: 0;"><strong>Generated by:</strong> ${safeGeneratedBy}</p>`
    : '';

  return `<p><strong>Video generated.</strong> Click the button below to play.</p>
<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${playText}</a></p>${generatedByLine}`;
};

// Best-effort helper to get the current user's display name (for footer comment attribution).
// Uses v2 first, then falls back to v1.
const fetchCurrentUserDisplayName = async (apiCall) => {
  try {
    let meResponse = await apiCall.requestConfluence(route`/wiki/api/v2/users/me`);
    if (!meResponse.ok) {
      try {
        meResponse = await apiCall.requestConfluence(route`/wiki/rest/api/user/current`);
      } catch (e) {
        // ignore
      }
    }

    if (!meResponse?.ok) {
      return null;
    }

    const me = await meResponse.json();
    return me?.displayName || me?.publicName || me?.name || null;
  } catch (e) {
    return null;
  }
};

// Helper function to build video section HTML for page content
const buildVideoSectionHtml = (videoUrl) => {
  const safeUrl = String(videoUrl || '').replace(/"/g, '&quot;');
  return `<h2>Golpo AI Generated Video</h2><p><strong>Video generated.</strong> Click to play.</p><p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;background:#0052CC;color:#FFFFFF;border-radius:8px;text-decoration:none;font-weight:600;">▶ Play video</a></p>`;
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
      requestedBy: requestedBy ? {
        accountId: requestedBy.accountId,
        displayName: requestedBy.displayName,
        hasAccountId: !!requestedBy.accountId,
        hasDisplayName: !!requestedBy.displayName,
        fullData: requestedBy,
      } : null,
    });
    
    // IMPORTANT: Use Confluence "storage" (HTML) for maximum reliability.
    // This is what "worked fine before" and avoids failures when ADF is rejected.
    const generatedByName =
      requestedBy?.displayName ||
      requestedBy?.publicName ||
      requestedBy?.name ||
      requestedBy?.username ||
      null;
    const commentBodyStorage = buildFooterCommentStorageHtml(videoUrl, generatedByName);
    console.log('[processCompletedVideo] requestedBy value:', JSON.stringify(requestedBy, null, 2));

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
              value: commentBodyStorage
            }
          })
        }
      );
      
      if (commentResponse.ok) {
        const commentData = await commentResponse.json();
        console.log('[processCompletedVideo] Successfully added video to footer comments (storage):', JSON.stringify(commentData, null, 2));
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
    
    // Get list of active jobs first to determine which user's API key to use
    const activeJobsKey = 'active-video-jobs';
    const activeJobs = await storage.get(activeJobsKey) || [];
    
    // Get admin API key (configured in global page)
    // Note: For background polling, we need to get the API key from the job's requestedBy user
    // Get admin API key (configured in global page)
    let API_KEY = null;
    try {
      API_KEY = await getUserApiKeyInternal();
    } catch (keyError) {
      console.warn('[pollVideoStatusBackground] Error getting admin API key:', keyError);
    }
    
    if (!API_KEY) {
      console.error('[pollVideoStatusBackground] Golpo API key not configured');
      return { error: 'API key not configured', processed: 0 };
    }
    
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
        
        // Log requestedBy to debug user name issue
        console.log('[pollVideoStatusBackground] Retrieved job data for:', jobId, {
          pageId,
          requestedBy: requestedBy ? {
            accountId: requestedBy.accountId,
            displayName: requestedBy.displayName,
            hasAccountId: !!requestedBy.accountId,
            hasDisplayName: !!requestedBy.displayName,
          } : null,
        });
        
        // If requestedBy is missing, try to retrieve from separate user storage
        let finalRequestedBy = requestedBy;
        
        // First, check if requestedBy exists but might be stored differently
        if (!finalRequestedBy && jobData.requestedBy) {
          finalRequestedBy = jobData.requestedBy;
          console.log('[pollVideoStatusBackground] Using requestedBy directly from jobData:', finalRequestedBy);
        }
        
        // If still missing or incomplete (missing displayName), try to retrieve from separate user storage
        if (!finalRequestedBy || (!finalRequestedBy.displayName && !finalRequestedBy.publicName && !finalRequestedBy.name && !finalRequestedBy.username)) {
          console.warn('[pollVideoStatusBackground] requestedBy missing or incomplete in job data, trying to retrieve from storage...');
          console.log('[pollVideoStatusBackground] Current requestedBy:', JSON.stringify(finalRequestedBy, null, 2));
          
          // Try to get accountId from jobData to look up user info
          const accountIdToLookup = finalRequestedBy?.accountId || finalRequestedBy?.id || jobData.requestedBy?.accountId || jobData.requestedBy?.id;
          
          if (accountIdToLookup) {
            // Try to retrieve user info from separate storage using accountId
            try {
              const userStorageKey = `user-info-${accountIdToLookup}`;
              const storedUserInfo = await storage.get(userStorageKey);
              if (storedUserInfo) {
                // Merge stored user info with existing requestedBy to preserve all data
                finalRequestedBy = {
                  ...finalRequestedBy,
                  ...storedUserInfo,
                  accountId: accountIdToLookup, // Ensure accountId is set
                };
                console.log('[pollVideoStatusBackground] ✅ Retrieved user info from separate storage:', finalRequestedBy);
              } else {
                console.warn('[pollVideoStatusBackground] User info not found in separate storage for accountId:', accountIdToLookup);
                // If we have accountId but no stored info, try to fetch from API (but only if we have accountId)
                if (accountIdToLookup && !finalRequestedBy) {
                  finalRequestedBy = { accountId: accountIdToLookup };
                }
              }
            } catch (storageError) {
              console.warn('[pollVideoStatusBackground] Failed to retrieve user info from storage:', storageError);
            }
          } else {
            console.warn('[pollVideoStatusBackground] No accountId found to lookup user info');
          }
        }
        
        // Final check - log what we're passing (especially displayName)
        console.log('[pollVideoStatusBackground] Final requestedBy to pass:', JSON.stringify(finalRequestedBy, null, 2));
        if (finalRequestedBy) {
          console.log('[pollVideoStatusBackground] ✅ Has displayName:', !!finalRequestedBy.displayName, 'Value:', finalRequestedBy.displayName);
          console.log('[pollVideoStatusBackground] ✅ Has publicName:', !!finalRequestedBy.publicName, 'Value:', finalRequestedBy.publicName);
          console.log('[pollVideoStatusBackground] ✅ Has name:', !!finalRequestedBy.name, 'Value:', finalRequestedBy.name);
          console.log('[pollVideoStatusBackground] ✅ Has accountId:', !!finalRequestedBy.accountId, 'Value:', finalRequestedBy.accountId);
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
            console.log('[pollVideoStatusBackground] Calling processCompletedVideo with requestedBy:', finalRequestedBy);
            await processCompletedVideo(jobId, videoUrl, pageId, true, finalRequestedBy);
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

// Get the pollVideoStatusBackground function from resolver
const pollVideoStatusBackgroundFunc = resolverDefinitions['pollVideoStatusBackground'];

// Wrapper function for scheduled trigger - calls the resolver function directly
const pollVideoStatusBackgroundWrapper = async ({ context }) => {
  try {
    console.log('[pollVideoStatusBackground] ========== SCHEDULED TRIGGER INVOKED ==========');
    console.log('[pollVideoStatusBackground] Context:', JSON.stringify(context, null, 2));
    console.log('[pollVideoStatusBackground] Timestamp:', new Date().toISOString());
    
    // Call the resolver function directly (it's defined with resolver.define but can be called directly)
    // The resolver function doesn't use payload, so we call it with empty payload
    const resolverFunc = resolverDefinitions['pollVideoStatusBackground'];
    if (resolverFunc) {
      // Resolver functions expect { payload } but this one doesn't use it
      return await resolverFunc({ payload: {}, context });
    }
    
    // Fallback: call the polling logic directly
    console.warn('[pollVideoStatusBackground] Resolver function not found in definitions, calling polling logic directly');
    // Import the polling logic inline (it's already defined above)
    return await pollVideoStatusBackgroundDirect();
  } catch (error) {
    console.error('[pollVideoStatusBackground] Error in scheduled trigger wrapper:', error);
    return { error: error?.message || 'Unknown error in scheduled trigger' };
  }
};

// Direct implementation for scheduled trigger (extracted from resolver.define)
const pollVideoStatusBackgroundDirect = async () => {
  try {
    console.log('[pollVideoStatusBackground] Starting background polling (direct call)');
    
    // Get list of active jobs first to determine which user's API key to use
    const activeJobsKey = 'active-video-jobs';
    const activeJobs = await storage.get(activeJobsKey) || [];
    
    // Get admin API key (configured in global page)
    // Note: For background polling, we need to get the API key from the job's requestedBy user
    // Get admin API key (configured in global page)
    let API_KEY = null;
    try {
      API_KEY = await getUserApiKeyInternal();
    } catch (keyError) {
      console.warn('[pollVideoStatusBackground] Error getting admin API key:', keyError);
    }
    
    if (!API_KEY) {
      console.error('[pollVideoStatusBackground] Golpo API key not configured');
      return { error: 'API key not configured', processed: 0 };
    }
    
    if (activeJobs.length === 0) {
      console.log('[pollVideoStatusBackground] No active jobs to poll');
      return { message: 'No active jobs', processed: 0 };
    }

    console.log('[pollVideoStatusBackground] Found active jobs:', activeJobs.length);

    let processed = 0;
    let completed = 0;
    let failed = 0;
    const remainingJobs = [];

    // Poll each active job (same logic as resolver function)
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
        
        // Get final requestedBy (same logic as resolver)
        let finalRequestedBy = requestedBy;
        if (!finalRequestedBy && jobData.requestedBy) {
          finalRequestedBy = jobData.requestedBy;
        }
        
        if (!finalRequestedBy || (!finalRequestedBy.displayName && !finalRequestedBy.publicName && !finalRequestedBy.name && !finalRequestedBy.username)) {
          const accountIdToLookup = finalRequestedBy?.accountId || finalRequestedBy?.id || jobData.requestedBy?.accountId || jobData.requestedBy?.id;
          if (accountIdToLookup) {
            try {
              const userStorageKey = `user-info-${accountIdToLookup}`;
              const storedUserInfo = await storage.get(userStorageKey);
              if (storedUserInfo) {
                finalRequestedBy = storedUserInfo;
              }
            } catch (storageError) {
              console.warn('[pollVideoStatusBackground] Failed to retrieve user info from storage:', storageError);
            }
          }
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
          const videoUrl = extractVideoUrlFromStatus(statusData);
          if (videoUrl) {
            await processCompletedVideo(jobId, videoUrl, pageId, true, finalRequestedBy);
            completed++;
          } else {
            remainingJobs.push(jobId);
          }
        } else if (isVideoFailed(statusData)) {
          // Remove failed job
          try {
            await storage.delete(jobKey);
            const updatedJobs = activeJobs.filter(id => id !== jobId);
            await storage.set(activeJobsKey, updatedJobs);
          } catch (cleanupError) {
            console.warn('[pollVideoStatusBackground] Failed to cleanup failed job:', cleanupError);
          }
          failed++;
        } else {
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
    }

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
};

// Export handler for resolver (required by manifest.yml)
export const handler = resolverDefinitions;

// Export function for scheduled trigger (required by manifest.yml)
export const pollVideoStatusBackground = pollVideoStatusBackgroundFunc || pollVideoStatusBackgroundWrapper;
