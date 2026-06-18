document.addEventListener('DOMContentLoaded', () => {
  const vpsUrlInput    = document.getElementById('vpsUrl');
  const syncTokenInput = document.getElementById('syncToken');
  const profileInput   = document.getElementById('profileName');
  const saveBtn        = document.getElementById('saveConfig');
  const syncUpBtn      = document.getElementById('syncUp');
  const syncDownBtn    = document.getElementById('syncDown');
  const statusDiv      = document.getElementById('status');
  const connDot        = document.getElementById('connDot');
  const connLabel      = document.getElementById('connLabel');

  function showStatus(text, type) {
    statusDiv.textContent = text;
    statusDiv.className = 'status ' + (type || 'info');
  }

  function setConnected(url, profile) {
    connDot.classList.add('connected');
    const display = url.replace(/^https?:\/\//, '');
    const label = (display.length > 22 ? display.slice(0, 22) + '…' : display) + (profile ? ` · ${profile}` : '');
    connLabel.textContent = label;
  }

  function setDisconnected() {
    connDot.classList.remove('connected');
    connLabel.textContent = 'Not configured';
  }

  function setSyncing(on) {
    syncUpBtn.disabled  = on;
    syncDownBtn.disabled = on;
  }

  // Load saved config on open
  chrome.storage.local.get(['vpsUrl', 'syncToken', 'profileName'], (result) => {
    if (result.vpsUrl)      vpsUrlInput.value    = result.vpsUrl;
    if (result.syncToken)   syncTokenInput.value = result.syncToken;
    if (result.profileName) profileInput.value   = result.profileName;
    if (result.vpsUrl && result.syncToken) setConnected(result.vpsUrl, result.profileName);
  });

  // Save config
  saveBtn.addEventListener('click', () => {
    const vpsUrl      = vpsUrlInput.value.trim().replace(/\/$/, '');
    const syncToken   = syncTokenInput.value.trim();
    const profileName = profileInput.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '') || 'default';

    if (!vpsUrl || !syncToken) {
      showStatus('VPS URL and token are required.', 'error');
      return;
    }

    chrome.storage.local.set({ vpsUrl, syncToken, profileName }, () => {
      profileInput.value = profileName;
      setConnected(vpsUrl, profileName);
      showStatus('Configuration saved.', 'success');
    });
  });

  // Upload bookmarks
  syncUpBtn.addEventListener('click', () => {
    chrome.storage.local.get(['vpsUrl', 'syncToken', 'profileName'], (config) => {
      if (!config.vpsUrl || !config.syncToken) {
        showStatus('Save your server configuration first.', 'error');
        return;
      }

      const profile = config.profileName || 'default';
      setSyncing(true);
      showStatus('Reading bookmarks…', 'info');

      chrome.bookmarks.getTree((rootNodes) => {
        const bookmarks = rootNodes[0].children;

        fetch(`${config.vpsUrl}/bookmarks/${profile}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.syncToken}`
          },
          body: JSON.stringify({ bookmarks })
        })
        .then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Server returned ${res.status}`);
          }
          return res.json();
        })
        .then(() => {
          showStatus(`Uploaded to profile "${profile}".`, 'success');
        })
        .catch((err) => {
          showStatus(`Upload failed: ${err.message}`, 'error');
        })
        .finally(() => setSyncing(false));
      });
    });
  });

  // Download bookmarks
  syncDownBtn.addEventListener('click', () => {
    chrome.storage.local.get(['vpsUrl', 'syncToken', 'profileName'], (config) => {
      if (!config.vpsUrl || !config.syncToken) {
        showStatus('Save your server configuration first.', 'error');
        return;
      }

      const profile = config.profileName || 'default';
      setSyncing(true);
      showStatus('Downloading from server…', 'info');

      fetch(`${config.vpsUrl}/bookmarks/${profile}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.syncToken}`
        }
      })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Server returned ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (!data.bookmarks || data.bookmarks.length === 0) {
          showStatus(`No bookmarks found for profile "${profile}".`, 'error');
          setSyncing(false);
          return;
        }

        const BAR_ID = '1';

        function populateFolder(folderId, nodes) {
          for (const node of nodes) {
            if (node.url) {
              chrome.bookmarks.create({ parentId: folderId, title: node.title, url: node.url });
            } else if (node.children && node.children.length > 0) {
              chrome.bookmarks.create({ parentId: folderId, title: node.title }, (newFolder) => {
                populateFolder(newFolder.id, node.children);
              });
            }
          }
        }

        chrome.bookmarks.getChildren(BAR_ID, (existing) => {
          Promise.all(existing.map(c => new Promise(resolve => {
            chrome.bookmarks.removeTree(c.id, resolve);
          }))).then(() => {
            for (const topNode of data.bookmarks) {
              if (!topNode.url && (topNode.title === 'Bookmarks bar' || topNode.title === 'Favorites bar' || topNode.id === '1')) {
                populateFolder(BAR_ID, topNode.children || []);
              }
            }
            showStatus(`Bookmarks bar synced from profile "${profile}".`, 'success');
            setSyncing(false);
          });
        });
      })
      .catch((err) => {
        showStatus(`Download failed: ${err.message}`, 'error');
        setSyncing(false);
      });
    });
  });
});
