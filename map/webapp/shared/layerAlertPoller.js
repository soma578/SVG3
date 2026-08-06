const SEVERITIES = new Set(['normal', 'advisory', 'evacuation', 'danger']);
const MIN_POLL_MS = 60_000;
const DEFAULT_POLL_MS = 120_000;
const MAX_FAILURE_BACKOFF_MS = 15 * 60_000;

export const validateLayerAlertSummary = (summary, layerId) => (
  summary?.schemaVersion === 1
  && summary.kind === 'svg3-layer-alert-summary'
  && summary.layerId === layerId
  && SEVERITIES.has(summary.maxSeverity)
  && Array.isArray(summary.affected)
);

export const alertPollInterval = (layers) => {
  const requested = layers
    .map((layer) => Number(layer.alertFeed?.pollMs))
    .filter((value) => Number.isFinite(value) && value > 0);
  return Math.max(MIN_POLL_MS, requested.length > 0 ? Math.min(...requested) : DEFAULT_POLL_MS);
};

export const createLayerAlertPoller = ({
  getLayers,
  fetchJson,
  summaries,
  onChange,
  documentRef = document,
  windowRef = window,
}) => {
  let timer = null;
  let generation = 0;
  let running = false;
  let consecutiveFailures = 0;

  const clearTimer = () => {
    if (timer) windowRef.clearTimeout(timer);
    timer = null;
  };

  const schedule = (layers, currentGeneration) => {
    if (!running || currentGeneration !== generation || documentRef.hidden) return;
    const baseInterval = alertPollInterval(layers);
    const backoff = Math.min(
      MAX_FAILURE_BACKOFF_MS,
      baseInterval * (2 ** Math.min(consecutiveFailures, 4)),
    );
    timer = windowRef.setTimeout(() => void poll(currentGeneration), backoff);
  };

  const poll = async (currentGeneration) => {
    if (!running || currentGeneration !== generation || documentRef.hidden) return;
    const layers = getLayers().filter((layer) => layer.alertFeed?.url);
    let successCount = 0;
    await Promise.all(layers.map(async (layer) => {
      try {
        const summary = await fetchJson(layer.alertFeed.url, { cache: 'no-store' });
        if (!validateLayerAlertSummary(summary, layer.id)) throw new Error('alert summaryが不正です');
        summaries.set(layer.id, summary);
        successCount += 1;
      } catch (error) {
        console.warn('[layer-alert-poller] alert feed unavailable', layer.alertFeed.url, error);
      }
    }));
    if (!running || currentGeneration !== generation) return;
    consecutiveFailures = layers.length > 0 && successCount === 0
      ? consecutiveFailures + 1
      : 0;
    onChange();
    schedule(layers, currentGeneration);
  };

  const start = () => {
    generation += 1;
    running = true;
    consecutiveFailures = 0;
    clearTimer();
    summaries.clear();
    onChange();
    const layers = getLayers().filter((layer) => layer.alertFeed?.url);
    if (layers.length > 0 && !documentRef.hidden) void poll(generation);
  };

  const stop = () => {
    generation += 1;
    running = false;
    clearTimer();
  };

  const handleVisibilityChange = () => {
    clearTimer();
    if (running && !documentRef.hidden) void poll(generation);
  };
  documentRef.addEventListener('visibilitychange', handleVisibilityChange);

  const dispose = () => {
    stop();
    documentRef.removeEventListener('visibilitychange', handleVisibilityChange);
  };

  return { dispose, start, stop };
};
