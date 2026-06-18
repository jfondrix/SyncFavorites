document.getElementById('saveConfig').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value;
  const binId = document.getElementById('binId').value;
  chrome.storage.local.set({ apiKey, binId }, () => {
    document.getElementById('status').innerText = "Configuration Saved!";
  });
});

// Load saved config when popup opens
chrome.storage.local.get(['apiKey', 'binId'], (data) => {
  if(data.apiKey) document.getElementById('apiKey').value = data.apiKey;
  if(data.binId) document.getElementById('binId').value = data.binId;
});

// Upload Bookmarks to Cloud
document.getElementById('syncUp').addEventListener('click', () => {
  chrome.storage.local.get(['apiKey', 'binId'], (config) => {
    if (!config.apiKey || !config.binId) {
      document.getElementById('status').innerText = "Please configure keys first!";
      return;
    }
    
    // Grabs your "Other Bookmarks" or "Favorites Bar" folder structure
    chrome.bookmarks.getTree((rootNodes) => {
      fetch(`https://api.jsonbin.io/v3/b/${config.binId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': config.apiKey
        },
        body: JSON.stringify({ bookmarks: rootNodes[0].children })
      })
      .then(res => res.json())
      .then(() => { document.getElementById('status').innerText = "Uploaded successfully!"; })
      .catch(err => { document.getElementById('status').innerText = "Upload failed."; });
    });
  });
});

// Download Bookmarks from Cloud
document.getElementById('syncDown').addEventListener('click', () => {
  chrome.storage.local.get(['apiKey', 'binId'], (config) => {
    fetch(`https://api.jsonbin.io/v3/b/${config.binId}/latest`, {
      headers: { 'X-Master-Key': config.apiKey }
    })
    .then(res => res.json())
    .then(data => {
      const incoming = data.record.bookmarks;
      // Cleverly builds bookmarks into a clean folder so it doesn't duplicate everything
      chrome.bookmarks.create({ title: 'Synced Favorites' }, (newFolder) => {
        incoming.forEach(node => importNodes(node, newFolder.id));
        document.getElementById('status').innerText = "Downloaded & Merged!";
      });
    });
  });
});

function importNodes(node, parentId) {
  if (node.url) {
    chrome.bookmarks.create({ parentId: parentId, title: node.title, url: node.url });
  } else if (node.children) {
    chrome.bookmarks.create({ parentId: parentId, title: node.title }, (newParent) => {
      node.children.forEach(child => importNodes(child, newParent.id));
    });
  }
}