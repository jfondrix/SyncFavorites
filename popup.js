document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const binIdInput = document.getElementById('binId');
  const saveBtn = document.getElementById('saveConfig');
  const syncUpBtn = document.getElementById('syncUp');
  const syncDownBtn = document.getElementById('syncDown');
  const statusDiv = document.getElementById('status');

  function showStatus(text, color) {
    statusDiv.textContent = text;
    statusDiv.style.color = color || 'black';
  }

  // 1. Startup: Load saved configuration
  chrome.storage.local.get(['apiKey', 'binId'], (result) => {
    if (result.apiKey) apiKeyInput.value = result.apiKey;
    if (result.binId) binIdInput.value = result.binId;
    if (result.apiKey && result.binId) {
      showStatus('Keys loaded. Ready.', 'green');
    }
  });

  // 2. Save Configuration
  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const binId = binIdInput.value.trim();

    if (!apiKey || !binId) {
      showStatus('Error: Fields cannot be empty!', 'red');
      return;
    }

    chrome.storage.local.set({ apiKey, binId }, () => {
      showStatus('Configuration Saved!', 'green');
    });
  });

  // 3. Sync Up: Upload local bookmarks to JSONBin
  syncUpBtn.addEventListener('click', () => {
    chrome.storage.local.get(['apiKey', 'binId'], (config) => {
      if (!config.apiKey || !config.binId) {
        showStatus('Please configure keys first!', 'red');
        return;
      }

      showStatus('Uploading...', 'orange');

      chrome.bookmarks.getTree((rootNodes) => {
        fetch(`https://api.jsonbin.io/v3/b/${config.binId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            // By passing your key strictly as X-Access-Key, JSONBin will authorize the sync 
            'X-Access-Key': config.apiKey
          },
          body: JSON.stringify({ bookmarks: rootNodes[0].children })
        })
        .then(async response => {
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData.message || `Server status ${response.status}`;
            throw new Error(errMsg);
          }
          return response.json();
        })
        .then(() => {
          showStatus('Uploaded successfully!', 'green');
        })
        .catch(error => {
          showStatus(`Upload failed: ${error.message}`, 'red');
        });
      });
    });
  });

  // 4. Sync Down: Download bookmarks from JSONBin
  syncDownBtn.addEventListener('click', () => {
    chrome.storage.local.get(['apiKey', 'binId'], (config) => {
      if (!config.apiKey || !config.binId) {
        showStatus('Please configure keys first!', 'red');
        return;
      }

      showStatus('Downloading...', 'orange');

      fetch(`https://api.jsonbin.io/v3/b/${config.binId}/latest`, {
        method: 'GET',
        headers: {
          'X-Access-Key': config.apiKey
        }
      })
      .then(async response => {
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.message || `Server status ${response.status}`;
          throw new Error(errMsg);
        }
        return response.json();
      })
      .then(data => {
        const incoming = data.record.bookmarks;
        if (!incoming || incoming.length === 0) {
          showStatus('Cloud vault is empty.', 'red');
          return;
        }

        chrome.bookmarks.getTree((rootNodes) => {
          let existingFolder = null;
          
          function findFolder(nodes) {
            for (let node of nodes) {
              if (!node.url && node.title === 'Synced Favorites') {
                existingFolder = node;
                return;
              }
              if (node.children) findFolder(node.children);
            }
          }
          findFolder(rootNodes);

          if (existingFolder) {
            chrome.bookmarks.getChildren(existingFolder.id, (children) => {
              const promises = children.map(child => chrome.bookmarks.removeTree(child.id));
              Promise.all(promises).then(() => {
                incoming.forEach(node => importNodes(node, existingFolder.id));
                showStatus('Downloaded & Updated!', 'green');
              });
            });
          } else {
            chrome.bookmarks.create({ title: 'Synced Favorites' }, (newFolder) => {
              incoming.forEach(node => importNodes(node, newFolder.id));
              showStatus('Downloaded & Merged!', 'green');
            });
          }
        });
      })
      .catch(error => {
        showStatus(`Download failed: ${error.message}`, 'red');
      });
    });
  });

  // 5. Recursive node processor
  function importNodes(node, parentId) {
    if (node.url) {
      chrome.bookmarks.create({ parentId: parentId, title: node.title, url: node.url });
    } else if (node.children && node.children.length > 0) {
      if (node.title === "" || node.title === "Favorites bar" || node.title === "Other bookmarks") {
        node.children.forEach(child => importNodes(child, parentId));
      } else {
        chrome.bookmarks.create({ parentId: parentId, title: node.title }, (newParent) => {
          node.children.forEach(child => importNodes(child, newParent.id));
        });
      }
    }
  }
});