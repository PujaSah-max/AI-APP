import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

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
  return { response, body };
};

resolver.define('getText', (req) => {
  console.log(req);

  return 'Hello, world!';
});

// Get current page information from the resolver context plus REST data
resolver.define('getCurrentPage', async ({ context }) => {
  const content = context?.extension?.content;

  if (!content?.id) {
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
    console.error('Failed to fetch default page data', error);
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

  const response = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}/footer-comments`, {
    headers: {
      Accept: 'application/json'
    }
  });

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

  return {
    status: response.status,
    statusText: response.statusText,
    body: await response.json()
  };
});

export const handler = resolver.getDefinitions();
