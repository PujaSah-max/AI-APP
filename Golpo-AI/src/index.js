import Resolver from '@forge/resolver';
import api from '@forge/api';

const resolver = new Resolver();

const stripHtml = (html = '') =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const fetchPageDetails = async (pageId) => {
  if (!pageId) {
    throw new Error('pageId is required');
  }

  const endpoint = `/wiki/api/v2/pages/${pageId}?body-format=export_view`;
  const response = await api.asUser().requestConfluence(endpoint);

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to fetch page ${pageId}: ${message}`);
  }

  const page = await response.json();
  const summaryRaw = page.body?.export_view?.value || '';
  const summary = stripHtml(summaryRaw).slice(0, 400);

  return {
    id: page.id,
    title: page.title,
    type: page.type,
    spaceKey: page.space?.key,
    spaceName: page.space?.name,
    url: page._links?.webui ? `/wiki${page._links.webui}` : undefined,
    summary
  };
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
    return await fetchPageDetails(content.id);
  } catch (error) {
    console.error('Failed to fetch default page data', error);
    return {
      id: content.id,
      title: content.title,
      type: content.type,
      spaceKey: context.extension.space?.key,
      spaceName: context.extension.space?.name
    };
  }
});

resolver.define('getPageDetails', async ({ payload }) => {
  if (!payload?.pageId) {
    throw new Error('pageId is required');
  }

  return await fetchPageDetails(payload.pageId);
});

resolver.define('searchPages', async ({ payload }) => {
  const query = (payload?.query || '').trim();

  // Basic CQL query to find Confluence pages by title
  const escapedQuery = query.replace(/"/g, '\\"');
  const cql = query
    ? `type = "page" AND title ~ "${escapedQuery}"`
    : 'type = "page" ORDER BY lastmodified DESC';

  const endpoint = `/wiki/rest/api/search?limit=10&cql=${encodeURIComponent(cql)}&expand=content.space`;

  const response = await api.asUser().requestConfluence(endpoint);

  if (!response.ok) {
    const message = await response.text();
    console.error('Confluence search failed', message);
    throw new Error('Unable to search Confluence pages. Please try again.');
  }

  const data = await response.json();

  return (data?.results || [])
    .map((result) => ({
      id: result.content?.id,
      title: result.content?.title,
      spaceKey: result.content?.space?.key,
      spaceName: result.content?.space?.name
    }))
    .filter((page) => Boolean(page.id));
});

export const handler = resolver.getDefinitions();
