(() => {
  'use strict';
  const releases = 'https://github.com/TreeX-xx/JanusX/releases';
  const status = document.getElementById('release-status');
  const note = document.getElementById('release-note');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  function setPackage(kind, asset) {
    if (!asset) {
      document.getElementById(`${kind}-label`).textContent = '查看其他版本';
      document.getElementById(`${kind}-meta`).textContent = '本次发布未提供此安装包';
      return false;
    }
    const url = new URL(asset.browser_download_url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/TreeX-xx/JanusX/releases/download/')) throw new Error('Unexpected asset URL');
    document.getElementById(`download-${kind}`).href = url.href;
    document.getElementById(`${kind}-label`).textContent = kind === 'setup' ? '下载 Windows 安装版' : '下载 Windows 便携版';
    const size = Number.isFinite(asset.size) && asset.size > 0 ? ` · ${(asset.size / 1048576).toFixed(1)} MB` : '';
    document.getElementById(`${kind}-meta`).textContent = `Windows x64 · .exe${size}`;
    return true;
  }

  async function loadRelease() {
    try {
      const response = await fetch('https://api.github.com/repos/TreeX-xx/JanusX/releases/latest', { signal: controller.signal });
      if (response.status === 404) {
        status.textContent = '暂无公开正式版';
        note.textContent = '尚未找到公开正式版。可前往 GitHub Releases 查看发布状态。';
        document.body.dataset.releaseState = 'empty';
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const release = await response.json();
      if (!Array.isArray(release.assets) || !release.tag_name) throw new Error('Invalid release');
      const setup = setPackage('setup', release.assets.find(asset => /^JanusX-.+-x64-setup\.exe$/i.test(asset.name)));
      const portable = setPackage('portable', release.assets.find(asset => /^JanusX-.+-x64-portable\.exe$/i.test(asset.name)));
      status.textContent = `最新正式版 ${release.tag_name}`;
      const date = new Date(release.published_at);
      if (Number.isFinite(date.getTime())) document.getElementById('release-date').textContent = `发布于 ${date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}`;
      document.body.dataset.releaseState = 'ready';
      note.textContent = setup && portable ? '安装包直连 GitHub Releases。版本与文件大小来自当前正式发布。' : '部分 Windows x64 安装包尚未提供，可前往全部版本查看其他发布。';
    } catch {
      status.textContent = '版本信息暂时不可用';
      note.textContent = '无法连接发布服务。请前往 GitHub Releases 手动选择安装包。';
      document.body.dataset.releaseState = 'error';
      for (const kind of ['setup', 'portable']) {
        document.getElementById(`download-${kind}`).href = releases;
        document.getElementById(`${kind}-label`).textContent = '前往 GitHub Releases';
        document.getElementById(`${kind}-meta`).textContent = 'Windows x64 · .exe';
      }
    } finally {
      clearTimeout(timeout);
      // Share the validated asset and release-history fallback with the first-screen action.
      const setupLink = document.getElementById('download-setup');
      const setupLabel = document.getElementById('setup-label').textContent;
      document.querySelectorAll('[data-download-setup]').forEach(link => {
        link.href = setupLink.href;
        link.querySelector('[data-download-label]').textContent = setupLabel === '下载 Windows 安装版' ? '下载 Windows 版' : setupLabel;
      });
    }
  }
  void loadRelease();
})();
