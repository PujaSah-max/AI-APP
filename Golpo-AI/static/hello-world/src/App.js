import React, { useCallback, useEffect, useState } from 'react';
import { invoke, view } from '@forge/bridge';
import VideoIcon from './components/VideoIcon';

const containerStyle = {
  fontFamily: 'var(--ds-font-family-sans)',
  backgroundColor: '#fff',
  color: '#172b4d',
  padding: '20px 24px',
  borderRadius: '16px',
  boxShadow: '0 14px 32px rgba(9, 30, 66, 0.16)',
  maxWidth: '760px',
  width: '100%',
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '24px'
};

const headlineStyle = {
  display: 'flex',
  gap: '12px',
  alignItems: 'center'
};

const cardStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  border: '1px solid #dfe1e6',
  borderRadius: '16px',
  padding: '18px',
  cursor: 'pointer',
  transition: 'box-shadow 120ms ease, transform 120ms ease',
  boxShadow: '0 6px 16px rgba(9, 30, 66, 0.12)'
};

const pillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '12px',
  padding: '6px 16px',
  borderRadius: '999px',
  background: '#f6e9ff',
  color: '#5e2ca5',
  border: '1px solid #deb3ff'
};

function App() {
  const [data, setData] = useState('');
  const [prompt, setPrompt] = useState('');
  const [showSpecs, setShowSpecs] = useState(false);
  const [duration, setDuration] = useState('1 min');
  const [language, setLanguage] = useState('English');
  const [pages, setPages] = useState([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const maxChars = 500;

  useEffect(() => {
    invoke('getText', { example: 'my-invoke-variable' }).then(setData);
    
    // Get current page and add it to context by default
    invoke('getCurrentPage', {})
      .then((pageInfo) => {
        if (pageInfo && pageInfo.id !== 'unknown') {
          setPages([pageInfo]);
        }
      })
      .catch((err) => {
        console.error('Error fetching current page:', err);
        // Fallback: add a placeholder page
        setPages([{ id: 'current', title: 'Current Page', type: 'page' }]);
      });
  }, []);

  const fetchSearchResults = useCallback(
    async (query) => {
      setSearchLoading(true);
      setSearchError('');
      try {
        const results = await invoke('searchPages', { query });
        setSearchResults(results);
      } catch (error) {
        console.error('Unable to fetch search results', error);
        setSearchResults([]);
        setSearchError('Unable to fetch pages. Please try again.');
      } finally {
        setSearchLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    const debounce = setTimeout(() => {
      fetchSearchResults(searchQuery);
    }, 300);

    return () => clearTimeout(debounce);
  }, [fetchSearchResults, isSearchOpen, searchQuery]);

  return (
      <div style={{ ...containerStyle, position: 'relative' }}>
      <button
        onClick={async () => {
          if (view?.close) {
            await view.close();
          } else if (window.closeModal) {
            window.closeModal();
          } else {
            window.parent.postMessage({ type: 'closeGolpoModal' }, '*');
          }
        }}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: 'transparent',
          border: 'none',
          fontSize: '20px',
          color: '#5e6c84',
          cursor: 'pointer',
          padding: 4
        }}
        aria-label="Close Golpo AI"
      >
        ×
      </button>
      <div style={headlineStyle}>
        <VideoIcon size={56} />
        <div>
          <div style={{ fontSize: '18px', fontWeight: 600 }}>Golpo AI</div>
          <div style={{ color: '#5e6c84', fontSize: '14px' }}>
            Generate engaging videos from your Confluence data
          </div>
        </div>
      </div>

      <section>
        <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>How can I help?</h2>
        <div
          style={cardStyle}
          onClick={() => {
            setIsSearchOpen(true);
            setSearchQuery('');
            fetchSearchResults('');
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(9, 30, 66, 0.16)';
            e.currentTarget.style.transform = 'translateY(-2px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(9, 30, 66, 0.12)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <VideoIcon size={56} />
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '16px' }}>
              Create whiteboard explainer video of Confluence pages
            </div>
            <div style={{ fontSize: '13px', color: '#5e6c84' }}>
              Click to search and add Confluence pages
            </div>
          </div>
          <span style={pillStyle}>
            <span style={{ fontSize: '10px' }}>Auto</span>
          </span>
        </div>
      </section>

      <section
        style={{
          border: '1px solid #dfe1e6',
          borderRadius: '16px',
          padding: '18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: '#deebff',
                color: '#0052cc',
                fontWeight: 600,
                fontSize: '14px'
              }}
            >
              i
            </span>
            <strong>Context ({pages.length})</strong>
          </div>
        </div>
        {pages.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {pages.map((page, index) => (
              <div
                key={page.id || index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: '#f4f5f7',
                  borderRadius: '8px',
                  fontSize: '13px'
                }}
              >
                <div>
                  <span style={{ color: '#172b4d', fontWeight: 500 }}>
                    {page.title || 'Current Page'}
                  </span>
                  {page.spaceName && (
                    <div style={{ color: '#6b778c', fontSize: '12px' }}>{page.spaceName}</div>
                  )}
                  {page.summary && (
                    <div style={{ color: '#6b778c', fontSize: '12px', marginTop: '4px' }}>
                      {page.summary}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setPages(pages.filter((_, i) => i !== index));
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#5e6c84',
                    cursor: 'pointer',
                    fontSize: '18px',
                    padding: '0 4px',
                    lineHeight: 1
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: '13px', color: '#6b778c' }}>
            No pages selected yet. Click the card above to search your Confluence pages.
          </div>
        )}
        <div style={{ fontSize: '14px', color: '#5e6c84' }}>Describe your video</div>
        <textarea
          placeholder="Tell me what to highlight in your video"
          style={{
            borderRadius: '16px',
            border: '1px solid #dfe1e6',
            padding: '12px',
            fontSize: '14px',
            minHeight: '140px',
            resize: 'vertical',
            fontFamily: 'inherit'
          }}
          value={prompt}
          onChange={(event) => {
            const nextValue = event.target.value.slice(0, maxChars);
            setPrompt(nextValue);
          }}
          maxLength={maxChars}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px'
          }}
        >
          <span style={{ fontSize: '12px', color: '#6b778c' }}>
            {prompt.length} / {maxChars}
          </span>
          <button
            onClick={() => setShowSpecs(true)}
            style={{
              marginLeft: 'auto',
              padding: '10px 22px',
              borderRadius: '999px',
              border: 'none',
              background: 'linear-gradient(90deg, #a259ff, #f15bb5)',
              color: '#fff',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
              boxShadow: '0 8px 20px rgba(162, 89, 255, 0.35)'
            }}
          >
            Generate Video
          </button>
        </div>
      </section>
      {isSearchOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(9, 30, 66, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
            padding: '20px'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '640px',
              background: '#fff',
              borderRadius: '20px',
              boxShadow: '0 20px 40px rgba(9, 30, 66, 0.25)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <VideoIcon size={44} />
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 600 }}>Select a Confluence page</div>
                  <div style={{ color: '#5e6c84', fontSize: '14px' }}>
                    Search your workspace and pick a page to summarize.
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsSearchOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '22px',
                  color: '#5e6c84',
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search Confluence pages"
              style={{
                padding: '12px 14px',
                borderRadius: '12px',
                border: '1px solid #dfe1e6',
                fontSize: '14px'
              }}
            />
            <div
              style={{
                maxHeight: '260px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              {searchLoading && <div style={{ color: '#6b778c' }}>Searching pages…</div>}
              {searchError && <div style={{ color: '#c9372c' }}>{searchError}</div>}
              {!searchLoading && !searchError && searchResults.length === 0 && (
                <div style={{ color: '#6b778c' }}>No pages found. Try a different search.</div>
              )}
              {!searchLoading &&
                !searchError &&
                searchResults.map((result) => (
                  <button
                    key={result.id}
                    onClick={async () => {
                      try {
                        setSearchLoading(true);
                        const details = await invoke('getPageDetails', { pageId: result.id });
                        setPages([details]);
                        setIsSearchOpen(false);
                      } catch (error) {
                        console.error('Failed to load page details', error);
                        setSearchError('Unable to load page details. Please try again.');
                      } finally {
                        setSearchLoading(false);
                      }
                    }}
                    style={{
                      textAlign: 'left',
                      border: '1px solid #dfe1e6',
                      borderRadius: '12px',
                      padding: '12px',
                      background: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#172b4d' }}>{result.title}</span>
                    <span style={{ fontSize: '12px', color: '#6b778c' }}>
                      {result.spaceName || result.spaceKey || 'Unknown space'}
                    </span>
                  </button>
                ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setIsSearchOpen(false)}
                style={{
                  padding: '10px 18px',
                  borderRadius: '999px',
                  border: '1px solid #dfe1e6',
                  background: '#fff',
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#172b4d'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {showSpecs && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(9, 30, 66, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            padding: '20px'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '640px',
              background: '#fff',
              borderRadius: '20px',
              boxShadow: '0 20px 40px rgba(9, 30, 66, 0.25)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px'
            }}
          >
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <VideoIcon size={48} />
              <div>
                <div style={{ fontSize: '20px', fontWeight: 600 }}>Video Specifications</div>
                <div style={{ color: '#5e6c84' }}>Customize your video settings before generation</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <label style={{ flex: 1, minWidth: 180, fontSize: '14px', color: '#5e6c84' }}>
                Duration
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  style={{
                    marginTop: 6,
                    width: '100%',
                    padding: '12px',
                    borderRadius: '12px',
                    border: '1px solid #dfe1e6',
                    fontSize: '14px'
                  }}
                >
                  <option>30 sec</option>
                  <option>1 min</option>
                  <option>2 min</option>
                  <option>3 min</option>
                  <option>4 min</option>
                  <option>5 min</option>
                  
                </select>
              </label>
              <label style={{ flex: 1, minWidth: 180, fontSize: '14px', color: '#5e6c84' }}>
                Language
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  style={{
                    marginTop: 6,
                    width: '100%',
                    padding: '12px',
                    borderRadius: '12px',
                    border: '1px solid #dfe1e6',
                    fontSize: '14px'
                  }}
                >
                  <option>English</option>
                  <option>Spanish</option>
                  <option>French</option>
                  <option>German</option>
                  <option>Italian</option>
                 
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setShowSpecs(false)}
                style={{
                  padding: '10px 20px',
                  borderRadius: '999px',
                  border: '1px solid #dfe1e6',
                  background: '#fff',
                  color: '#172b4d',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  console.log('Generate video', { prompt, duration, language });
                  setShowSpecs(false);
                }}
                style={{
                  padding: '10px 24px',
                  borderRadius: '999px',
                  border: 'none',
                  background: 'linear-gradient(90deg, #a259ff, #f15bb5)',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 8px 20px rgba(162, 89, 255, 0.35)'
                }}
              >
                Generate Video
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
