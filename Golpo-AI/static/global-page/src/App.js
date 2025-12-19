import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@forge/bridge';
import './App.css';

/**
 * This is the main Custom UI view rendered inside the Confluence Global Page iframe.
 *
 * Goal: Provide a simple landing-style page that matches the user-provided mock,
 * with messaging tailored to Confluence pages.
 */
function App() {
  const [expandedStep, setExpandedStep] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCheckingAdmin, setIsCheckingAdmin] = useState(true);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [isEditingApiKey, setIsEditingApiKey] = useState(false);
  const [isLoadingApiKey, setIsLoadingApiKey] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  const navigationSteps = [
    {
      id: 1,
      title: "Find a Confluence page",
      description:
        "Open the page you want to explain using a video.",
      image: "./nav-search.png",
      details: [
        "Use the Confluence search bar to find relevant content",
        "Open the page you want to convert into a video"
      ],
      arrows: []
    },
    {
      id: 2,
      title: 'Access Golpo AI from page menu',
      description: 'Open the three dots menu and find Golpo AI under Apps',
      image: './nav-menu.png',
      details: [
        'Open any Confluence page you want to work with',
        'Look for the three dots (⋯) button in the top right corner of the page header, next to Edit and Share buttons',
        'Click the three dots to open the dropdown menu',
        'Hover over or click "Apps" in the menu (it has a four-square icon with a plus sign)',
        'A submenu will appear on the left showing available apps',
        'Select "Golpo AI " from the Apps submenu to launch the app'
      ],
      arrows: []
    },
    {
      id: 3,
      title: 'Using Golpo AI to generate videos',
      description: 'Create videos from your Confluence pages using action cards and context',
      image: './nav-ui-1.png',
      image2: './nav-ui-2.png',
      details: [
        'When Golpo AI opens, the most recently generated video appears at the top of the panel',
        'The interface has action cards that you can interact with',
        'Click on an action card to add it to the description box',
        'The context section automatically adds information from the current Confluence page',
        'Click the "Generate" button to start generating your whiteboard video',

      ],
      arrows: []
    },
    {
      id: 4,
      title: 'View and manage your generated videos',
      description: 'Access and manage your created whiteboard videos',
      image: './nav-step4.png',
      details: [
      'Click Go to Video to open the most recently generated video for this page',

      'Select Regenerate to create a new version of the video',
      'After the video generation is complete, you can view it in the interface',
      'The generated video will be displayed with options to preview, download, or share',
      'The generated video will automatically appear in your page comments once complete'
      ],
    arrows: []
}
  ];

  // Check admin access on mount
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        setIsCheckingAdmin(true);
        const result = await invoke('checkAdminAccess');
        setIsAdmin(result?.isAdmin || false);
      } catch (error) {
        console.error('[App] Error checking admin access:', error);
        setIsAdmin(false);
      } finally {
        setIsCheckingAdmin(false);
      }
    };
    checkAdmin();
  }, []);

  // Fetch API key when opening settings modal
  const handleOpenSettings = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    try {
      setIsLoadingApiKey(true);
      setSettingsError('');
      const result = await invoke('getAdminApiKey');
      if (result) {
        const { hasKey, maskedKey } = result;
        setApiKeyConfigured(!!hasKey);
        setApiKeyMasked(maskedKey || null);
        setApiKey('');
        // If no API key exists, allow editing immediately
        setIsEditingApiKey(!hasKey);
      } else {
        // No result means no API key, allow editing
        setIsEditingApiKey(true);
        setApiKeyConfigured(false);
        setApiKeyMasked(null);
      }
      setShowSettingsModal(true);
    } catch (error) {
      console.error('[App] Error fetching admin API key:', error);
      setSettingsError(error?.message || 'Failed to load API key configuration');
      // On error, allow editing
      setIsEditingApiKey(true);
    } finally {
      setIsLoadingApiKey(false);
    }
  }, [isAdmin]);

  // Save admin API key
  const handleSaveApiKey = useCallback(async () => {
    if (!apiKey || apiKey.trim() === '') {
      setSettingsError('Please enter an API key');
      return;
    }

    try {
      setIsSavingApiKey(true);
      setSettingsError('');
      const result = await invoke('setAdminApiKey', { apiKey: apiKey.trim() });
      if (result && result.success) {
        setApiKeyConfigured(true);
        setApiKeyMasked(result.maskedKey || null);
        setApiKey('');
        setIsEditingApiKey(false);
        // Keep modal open to show success state
      } else {
        setSettingsError(result?.message || 'Failed to save API key');
      }
    } catch (err) {
      console.error('[App] Error saving admin API key:', err);
      if (err.message && err.message.includes('Invalid API key')) {
        setSettingsError('Invalid API key. Please check your API key and try again.');
      } else {
        setSettingsError(err?.message || 'Failed to save API key');
      }
    } finally {
      setIsSavingApiKey(false);
    }
  }, [apiKey]);

  // Handle Update API Key button click
  const handleUpdateApiKey = useCallback(() => {
    if (apiKeyConfigured && !isEditingApiKey) {
      setIsEditingApiKey(true);
      setApiKey('');
      setApiKeyConfigured(false);
    } else {
      handleSaveApiKey();
    }
  }, [apiKeyConfigured, isEditingApiKey, handleSaveApiKey]);

  const toggleStep = (stepId) => {
    setExpandedStep(expandedStep === stepId ? null : stepId);
  };

  return (
  <div className="page">
    <div className="shell">
      <header className="topBar">
        <div className="brand">
          <div className="brandIconWrap">
            <img
              className="brandIcon"
              src="./golpo-icon.png"
              alt="Golpo AI logo"
            />
          </div>

          <div className="brandText">
            <div className="brandName">Golpo AI</div>

          </div>
        </div>

        <div className="actions">
          {isAdmin && (
            <button
              className="btn btnSecondary"
              onClick={handleOpenSettings}
              disabled={isCheckingAdmin}
            >
              Settings
            </button>
          )}
        </div>
      </header>

      <main className="hero">
        <h1 className="heroTitle">
          Transform Confluence pages into engaging whiteboard videos
        </h1>

        <p className="heroSubtitle">
          Golpo AI converts your Confluence pages into AI-generated whiteboard videos, helping teams explain ideas faster and share knowledge more effectively
        </p>
      </main>

      <section className="navGuide">
        <h2 className="navGuideTitle">Create your first video with Golpo AI</h2>
        <p className="navGuideIntro">Follow these simple steps to generate a video from any Confluence page:</p>

        <div className="navSteps">
          {navigationSteps.map((step) => (
            <div key={step.id} className={`navStep ${expandedStep === step.id ? 'expanded' : ''}`}>
              <button
                type="button"
                className="navStepHeader"
                onClick={() => toggleStep(step.id)}
                aria-expanded={expandedStep === step.id}
              >
                <div className="navStepNumber">{step.id}</div>
                <div className="navStepContent">
                  <div className="navStepTitle">{step.title}</div>
                  <div className="navStepDesc">{step.description}</div>
                </div>
                <div className="navStepToggle">
                  {expandedStep === step.id ? '−' : '+'}
                </div>
              </button>

              {expandedStep === step.id && (
                <div className="navStepBody">
                  <div className={`navStepImageWrap ${step.image2 ? 'hasTwoImages' : ''} ${[1, 2, 4].includes(step.id) ? 'smallImage' : ''}`}>
                    <img
                      src={step.image}
                      alt={`Step ${step.id} navigation guide`}
                      className="navStepImage"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        if (e.target.nextSibling) {
                          e.target.nextSibling.style.display = 'flex';
                        }
                      }}
                    />
                    <div className="navStepImagePlaceholder" style={{ display: 'none' }}>
                      <div className="placeholderIcon">📸</div>
                      <div className="placeholderText">Navigation image {step.id}</div>
                    </div>
                    {step.image2 && (
                      <img
                        src={step.image2}
                        alt={`Step ${step.id} navigation guide - part 2`}
                        className="navStepImage navStepImageSecond"
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    )}
                    {step.arrows && step.arrows.map((arrow, arrowIdx) => (
                      <div
                        key={arrowIdx}
                        className="navArrow"
                        style={arrow}
                      >
                        <div className="arrowLine"></div>
                        <div className="arrowHead"></div>
                        <div className="arrowLabel">
                          {arrow.showLogo && (
                            <img
                              src="./logo.png"
                              alt="Golpo AI logo"
                              className="arrowLogo"
                              onError={(e) => e.target.style.display = 'none'}
                            />
                          )}
                          {arrow.text}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="navStepDetails">
                    <div className="navStepDetailsTitle">Detailed steps:</div>
                    <ul className="navStepList">
                      {step.details.map((detail, idx) => (
                        <li key={idx}>{detail}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>

    {/* Settings Modal */}
    {showSettingsModal && (
      <div className="modalOverlay" onClick={() => setShowSettingsModal(false)}>
        <div className="modalContent" onClick={(e) => e.stopPropagation()}>
          <div className="modalHeader">
            <div>
              <h3 className="modalTitle">Configure Golpo AI API Key</h3>
              <p className="modalDescription">
                Enter your Golpo AI API key to generate videos.
                <br />
                Your API key is stored securely and is only accessible by you.
              </p>
            </div>
          </div>
          <div className="feedbackForm">
            <div className="formGroup">
              <label htmlFor="apiKey">API Key</label>
              <input
                id="apiKey"
                type={isEditingApiKey ? "password" : "text"}
                className="formInput"
                value={isEditingApiKey ? apiKey : (apiKeyMasked || '')}
                placeholder="Enter your API key here"
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setApiKeyConfigured(false);
                  setSettingsError('');
                  // Ensure we're in editing mode when user types
                  if (!isEditingApiKey) {
                    setIsEditingApiKey(true);
                  }
                }}
                onFocus={() => {
                  // If showing masked key, switch to edit mode
                  if (apiKeyMasked && !isEditingApiKey) {
                    setApiKey('');
                    setIsEditingApiKey(true);
                  }
                }}
                disabled={isLoadingApiKey || isSavingApiKey}
                readOnly={!isEditingApiKey && !!apiKeyMasked}
              />
              {apiKeyMasked && apiKeyConfigured && !isEditingApiKey && (
                <p className="formHelperText">
                  Click "Update API Key" to replace the existing key.
                </p>
              )}
            </div>
            {apiKeyConfigured && !isEditingApiKey && (
              <div className="apiKeySuccessMessage">
                <span className="successIcon">✓</span>
                <span className="successText">API key configured</span>
              </div>
            )}
            {settingsError && (
              <div style={{ 
                padding: '12px', 
                marginBottom: '16px', 
                background: '#fff4e5', 
                border: '1px solid #ffab00', 
                borderRadius: '6px',
                color: '#172b4d',
                fontSize: '13px'
              }}>
                {settingsError}
              </div>
            )}
            <div className="formActions">
              <button
                className="btn btnSecondary"
                onClick={() => {
                  setShowSettingsModal(false);
                  setSettingsError('');
                  setApiKey('');
                  setIsEditingApiKey(false);
                }}
                disabled={isSavingApiKey}
              >
                Cancel
              </button>
              <button
                className="btn btnPrimary"
                onClick={handleUpdateApiKey}
                disabled={isLoadingApiKey || isSavingApiKey || (isEditingApiKey && !apiKey && !apiKeyConfigured)}
              >
                {isSavingApiKey
                  ? 'Saving...'
                  : apiKeyConfigured && !isEditingApiKey
                  ? 'Update API Key'
                  : 'Save API Key'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
  );
}

export default App;

