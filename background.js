const BAR_TITLES = new Set(['Bookmarks bar', 'Favorites bar', 'Barre des favoris', 'Lesezeichenleiste', 'Barra de favoritos', 'Barra dei preferiti']);

function isBarNode(n) {
  return !n.url && (BAR_TITLES.has(n.title) || n.id === '1' || n.parentId === '0');
}

async function populateFolder(folderId, nodes) {
  for (const node of nodes) {
    if (node.url) {
      await new Promise(resolve => chrome.bookmarks.create({ parentId: folderId, title: node.title, url: node.url }, resolve));
    } else if (node.children && node.children.length > 0) {
      const newFolder = await new Promise(resolve => chrome.bookmarks.create({ parentId: folderId, title: node.title }, resolve));
      await populateFolder(newFolder.id, node.children);
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'download') {
    const { vpsUrl, syncToken, profile } = msg;

    fetch(`${vpsUrl}/bookmarks/${profile}`, {
      headers: { 'Authorization': `Bearer ${syncToken}` }
    })
    .then(res => res.ok ? res.json() : res.json().then(e => Promise.reject(e.error || `Server ${res.status}`)))
    .then(async (data) => {
      if (!data.bookmarks || data.bookmarks.length === 0) {
        sendResponse({ ok: false, error: `No bookmarks found for profile "${profile}".` });
        return;
      }

      const BAR_ID = '1';
      const existing = await new Promise(resolve => chrome.bookmarks.getChildren(BAR_ID, resolve));
      await Promise.all(existing.map(c => new Promise(resolve => chrome.bookmarks.removeTree(c.id, resolve))));

      const barNode = data.bookmarks.find(isBarNode);
      if (barNode) {
        await populateFolder(BAR_ID, barNode.children || []);
      }

      sendResponse({ ok: true, barNode });
    })
    .catch(err => sendResponse({ ok: false, error: String(err) }));

    return true; // keep message channel open for async response
  }
});
