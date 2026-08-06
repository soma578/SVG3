import {
  resolveArtifactUrl,
  validateArtifactIndex,
  verifyArtifactIndexSignature,
} from './artifactIndex.js';

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
};

export const createArtifactBrowser = ({ state, elements, fetchJson }) => {
  let localIndexRequest = null;

  const selectedArtifact = () => state.artifacts.find((entry) => (
    `${entry.packageId}:${entry.regionId}` === elements.importArtifact.value
  )) || null;

  const renderMetadata = () => {
    const artifact = selectedArtifact();
    const distribution = artifact?.distribution;
    const isArtifactKind = elements.importKind.value === 'artifact'
      || elements.importKind.value === 'signed-index';
    elements.importArtifactMeta.hidden = !artifact || !isArtifactKind;
    elements.artifactDownload.hidden = !artifact?.archive;
    elements.artifactDescription.hidden = !artifact;
    elements.artifactActionHelp.hidden = !artifact;
    if (!artifact) {
      elements.artifactDescription.textContent = '';
      elements.artifactDownload.removeAttribute('href');
      elements.artifactDownload.removeAttribute('download');
      elements.artifactDownload.removeAttribute('title');
      return;
    }
    elements.artifactPublisher.textContent = distribution.publisher.name;
    elements.artifactDescription.textContent = artifact.description || `${artifact.title}のSVGMap配布レイヤーです。`;
    elements.artifactLicense.textContent = `${distribution.license.name} (${distribution.license.spdx})`;
    const published = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(
      new Date(distribution.publishedAt),
    );
    const archiveLabel = artifact.archive
      ? `ZIP ${formatBytes(artifact.archive.bytes)}`
      : formatBytes(artifact.bytes);
    elements.artifactRelease.textContent = `${published} · v${distribution.packageVersion} · ${archiveLabel}`;
    if (artifact.archive) {
      const archiveUrl = resolveArtifactUrl(artifact, state.artifactIndexUrl, artifact.archive.path);
      elements.artifactDownload.href = archiveUrl.href;
      elements.artifactDownload.download = artifact.archive.fileName;
      elements.artifactDownload.title = `SHA-256: ${artifact.archive.sha256}`;
    } else {
      elements.artifactDownload.removeAttribute('href');
      elements.artifactDownload.removeAttribute('download');
      elements.artifactDownload.removeAttribute('title');
    }
  };

  const renderOptions = () => {
    const selected = elements.importArtifact.value;
    const mounted = new Map(state.layers.map((layer) => [layer.id, layer]));
    const artifacts = state.artifacts.filter((artifact) => artifact.regionId === state.regionId);
    elements.importArtifact.replaceChildren();
    for (const artifact of artifacts) {
      const option = document.createElement('option');
      option.value = `${artifact.packageId}:${artifact.regionId}`;
      const layer = mounted.get(artifact.layerId);
      const stateLabel = layer ? layer.visible ? '表示中' : '追加済み' : '利用可能';
      option.textContent = `${artifact.title || artifact.packageId}（${stateLabel}）`;
      option.selected = option.value === selected;
      elements.importArtifact.append(option);
    }
    elements.importArtifact.disabled = artifacts.length === 0;
    if (elements.importKind.value === 'artifact' || elements.importKind.value === 'signed-index') {
      elements.importSubmit.disabled = artifacts.length === 0;
    }
    renderMetadata();
  };

  const applyIndex = (index, indexUrl, external) => {
    validateArtifactIndex(index, { requireSignature: external });
    state.artifacts = index.artifacts.filter((artifact) => (
      !external || artifact.portability?.lawaModes?.isolated === 'native-supported'
    ));
    state.artifactIndexUrl = indexUrl;
    state.artifactIndexExternal = external;
    renderOptions();
    return state.artifacts;
  };

  const loadLocal = async () => {
    const indexUrl = new URL('/map/distribution/portable/index.json', location.href).href;
    if (!localIndexRequest) {
      localIndexRequest = fetchJson(indexUrl)
        .then((index) => applyIndex(index, indexUrl, false))
        .catch((error) => {
          localIndexRequest = null;
          throw error;
        });
    } else {
      await localIndexRequest;
      if (state.artifactIndexUrl !== indexUrl) applyIndex(await fetchJson(indexUrl), indexUrl, false);
      else renderOptions();
    }
    return state.artifacts;
  };

  const loadSigned = async () => {
    const rawUrl = elements.importIndexUrl.value.trim();
    if (!rawUrl) throw new Error('署名済み配布一覧のURLを入力してください');
    const indexUrl = new URL(rawUrl, location.href);
    if (indexUrl.protocol !== 'https:' && indexUrl.hostname !== 'localhost' && indexUrl.hostname !== '127.0.0.1') {
      throw new Error('外部配布一覧はHTTPS URLを指定してください');
    }
    const [response, trustStore] = await Promise.all([
      fetch(indexUrl, { mode: 'cors' }),
      fetchJson('/map/distribution/trusted-publishers.json'),
    ]);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const index = await response.json();
    await verifyArtifactIndexSignature(index, trustStore);
    const artifacts = applyIndex(index, response.url || indexUrl.href, true);
    if (artifacts.length === 0) throw new Error('isolated対応のartifactがありません');
    return artifacts;
  };

  const reset = () => {
    state.artifacts = [];
    state.artifactIndexUrl = '';
    state.artifactIndexExternal = false;
    renderOptions();
  };

  return {
    loadLocal,
    loadSigned,
    renderMetadata,
    renderOptions,
    reset,
    selectedArtifact,
  };
};
