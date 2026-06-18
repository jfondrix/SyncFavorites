document.addEventListener('DOMContentLoaded', () => {
  const vpsUrlInput    = document.getElementById('vpsUrl');
  const syncTokenInput = document.getElementById('syncToken');
  const profileInput   = document.getElementById('profileName');
  const saveBtn        = document.getElementById('saveConfig');
  const syncUpBtn      = document.getElementById('syncUp');
  const syncDownBtn    = document.getElementById('syncDown');
  const mergeBtn       = document.getElementById('mergeBtn');
  const mergeProfileInput = document.getElementById('mergeProfile');
  const statusDiv      = document.getElementById('status');
  const connDot        = document.getElementById('connDot');
  const connLabel      = document.getElementById('connLabel');

  function showStatus(text, type) {
    statusDiv.textContent = text;
    statusDiv.className = 'status ' + (type || 'info');
  }

  function countBookmarks(nodes) {
    let bookmarks = 0, folders = 0;
    for (const node of nodes) {
      if (node.url) {
        bookmarks++;
      } else if (node.children) {
        folders++;
        const child = countBookmarks(node.children);
        bookmarks += child.bookmarks;
        folders   += child.folders;
      }
    }
    return { bookmarks, folders };
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
    syncUpBtn.disabled   = on;
    syncDownBtn.disabled = on;
    mergeBtn.disabled    = on;
  }

  const BAR_TITLES = new Set(['Bookmarks bar', 'Favorites bar', 'Barre des favoris', 'Lesezeichenleiste', 'Barra de favoritos', 'Barra dei preferiti']);
  function isBarNode(n) { return !n.url && (BAR_TITLES.has(n.title) || n.id === '1' || n.parentId === '0'); }

  // Collect all URLs from a bookmark tree into a Set
  function collectUrls(nodes, set = new Set()) {
    for (const node of nodes) {
      if (node.url) set.add(node.url);
      if (node.children) collectUrls(node.children, set);
    }
    return set;
  }

  // Add only bookmarks whose URLs are not already in existingUrls
  function mergeNodes(nodes, parentId, existingUrls, added) {
    for (const node of nodes) {
      if (node.url) {
        if (!existingUrls.has(node.url)) {
          chrome.bookmarks.create({ parentId, title: node.title, url: node.url });
          existingUrls.add(node.url);
          added.count++;
        }
      } else if (node.children && node.children.length > 0) {
        chrome.bookmarks.create({ parentId, title: node.title }, (newFolder) => {
          mergeNodes(node.children, newFolder.id, existingUrls, added);
        });
      }
    }
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
        const bookmarks_data = bookmarks;

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
          const { bookmarks, folders } = countBookmarks(bookmarks_data);
          showStatus(`Uploaded to "${profile}": ${bookmarks} bookmarks, ${folders} folders.`, 'success');
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

      showStatus('Importing bookmarks, please wait…', 'info');

      chrome.runtime.sendMessage({
        action: 'download',
        vpsUrl: config.vpsUrl,
        syncToken: config.syncToken,
        profile
      }, (response) => {
        if (!response || !response.ok) {
          showStatus(`Download failed: ${response ? response.error : 'No response from background'}`, 'error');
          setSyncing(false);
          return;
        }
        const { bookmarks: bCount, folders: fCount } = countBookmarks(response.barNode ? response.barNode.children || [] : []);
        showStatus(`Downloaded "${profile}": ${bCount} bookmarks, ${fCount} folders.`, 'success');
        setSyncing(false);
      });
    });
  });

  // Merge from another profile into current bookmarks bar
  mergeBtn.addEventListener('click', () => {
    chrome.storage.local.get(['vpsUrl', 'syncToken', 'profileName'], (config) => {
      if (!config.vpsUrl || !config.syncToken) {
        showStatus('Save your server configuration first.', 'error');
        return;
      }

      const sourceProfile = mergeProfileInput.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
      const currentProfile = config.profileName || 'default';

      if (!sourceProfile) {
        showStatus('Enter the source profile name to merge from.', 'error');
        return;
      }

      if (sourceProfile === currentProfile) {
        showStatus('Source and current profile are the same.', 'error');
        return;
      }

      setSyncing(true);
      showStatus(`Fetching profile "${sourceProfile}"…`, 'info');

      fetch(`${config.vpsUrl}/bookmarks/${sourceProfile}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${config.syncToken}` }
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
          showStatus(`Profile "${sourceProfile}" is empty.`, 'error');
          setSyncing(false);
          return;
        }

        const BAR_ID = '1';

        chrome.bookmarks.getTree((rootNodes) => {
          // Collect all existing URLs from the full tree
          const existingUrls = collectUrls(rootNodes[0].children);
          const added = { count: 0 };

          // Find bookmarks bar node in source profile
          const barNode = data.bookmarks.find(isBarNode);
          const sourceNodes = barNode ? barNode.children || [] : [];

          mergeNodes(sourceNodes, BAR_ID, existingUrls, added);

          setTimeout(() => {
            showStatus(`Merged "${sourceProfile}" → "${currentProfile}": ${added.count} new bookmarks added.`, 'success');
            setSyncing(false);
          }, 500);
        });
      })
      .catch((err) => {
        showStatus(`Merge failed: ${err.message}`, 'error');
        setSyncing(false);
      });
    });
  });
});
