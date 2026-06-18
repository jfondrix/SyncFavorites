document.addEventListener('DOMContentLoaded', () => {
  const vpsUrlInput   = document.getElementById('vpsUrl');
  const syncTokenInput = document.getElementById('syncToken');
  const saveBtn       = document.getElementById('saveConfig');
  const syncUpBtn     = document.getElementById('syncUp');
  const syncDownBtn   = document.getElementById('syncDown');
  const statusDiv     = document.getElementById('status');
  const connDot       = document.getElementById('connDot');
  const connLabel     = document.getElementById('connLabel');

  function showStatus(text, type) {
    statusDiv.textContent = text;
    statusDiv.className = 'status ' + (type || 'info');
  }

  function setConnected(url) {
    connDot.classList.add('connected');
    const display = url.replace(/^https?:\/\//, '');
    connLabel.textContent = display.length > 30 ? display.slice(0, 30) + '…' : display;
  }

  function setDisconnected() {
    connDot.classList.remove('connected');
    connLabel.textContent = 'Not configured';
  }

  function setSyncing(on) {
    syncUpBtn.disabled   = on;
    syncDownBtn.disabled = on;
  }

  // Load saved config on open
  chrome.storage.local.get(['vpsUrl', 'syncToken'], (result) => {
    if (result.vpsUrl)    vpsUrlInput.value    = result.vpsUrl;
    if (result.syncToken) syncTokenInput.value = result.syncToken;
    if (result.vpsUrl && result.syncToken) setConnected(result.vpsUrl);
  });

  // Save config
  saveBtn.addEventListener('click', () => {
    const vpsUrl    = vpsUrlInput.value.trim().replace(/\/$/, '');
    const syncToken = syncTokenInput.value.trim();

    if (!vpsUrl || !syncToken) {
      showStatus('Both VPS URL and token are required.', 'error');
      return;
    }

    chrome.storage.local.set({ vpsUrl, syncToken }, () => {
      setConnected(vpsUrl);
      showStatus('Configuration saved.', 'success');
    });
  });

  // Upload bookmarks
  syncUpBtn.addEventListener('click', () => {
    chrome.storage.local.get(['vpsUrl', 'syncToken'], (config) => {
      if (!config.vpsUrl || !config.syncToken) {
        showStatus('Save your server configuration first.', 'error');
        return;
      }

      setSyncing(true);
      showStatus('Reading bookmarks…', 'info');

      chrome.bookmarks.getTree((rootNodes) => {
        const bookmarks = rootNodes[0].children;

        fetch(`${config.vpsUrl}/bookmarks`, {
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
          showStatus('Bookmarks uploaded successfully.', 'success');
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
    chrome.storage.local.get(['vpsUrl', 'syncToken'], (config) => {
      if (!config.vpsUrl || !config.syncToken) {
        showStatus('Save your server configuration first.', 'error');
        return;
      }

      setSyncing(true);
      showStatus('Downloading from server…', 'info');

      fetch(`${config.vpsUrl}/bookmarks`, {
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
          showStatus('No bookmarks found on server.', 'error');
          setSyncing(false);
          return;
        }

        chrome.bookmarks.getTree((rootNodes) => {
          let syncFolder = null;

          function findFolder(nodes) {
            for (const node of nodes) {
              if (!node.url && node.title === 'SyncFav') {
                syncFolder = node;
                return;
              }
              if (node.children) findFolder(node.children);
            }
          }
          findFolder(rootNodes);

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

          function doImport(folderId) {
            for (const topNode of data.bookmarks) {
              if (!topNode.url && topNode.children) {
                // flatten top-level browser folders (Bookmarks bar, Other bookmarks)
                populateFolder(folderId, topNode.children);
              } else {
                populateFolder(folderId, [topNode]);
              }
            }
            showStatus('Bookmarks downloaded and merged.', 'success');
            setSyncing(false);
          }

          if (syncFolder) {
            chrome.bookmarks.getChildren(syncFolder.id, (children) => {
              Promise.all(children.map(c => new Promise(resolve => {
                chrome.bookmarks.removeTree(c.id, resolve);
              }))).then(() => doImport(syncFolder.id));
            });
          } else {
            chrome.bookmarks.create({ title: 'SyncFav' }, (newFolder) => {
              doImport(newFolder.id);
            });
          }
        });
      })
      .catch((err) => {
        showStatus(`Download failed: ${err.message}`, 'error');
        setSyncing(false);
      });
    });
  });

  // Deselect text inputs on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('input')) {
      syncTokenInput.type = 'password';
    }
  });
});
