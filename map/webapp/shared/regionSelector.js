const renderOptions = (select, entries, selectedId, labelForEntry) => {
  select.replaceChildren();
  for (const entry of entries) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = labelForEntry(entry);
    option.disabled = entry.dataStatus === 'empty';
    option.selected = entry.id === selectedId;
    select.append(option);
  }
};

export const createRegionSelector = ({
  regionSelect,
  municipalitySelect,
  fetchJson,
  state,
  onChange,
}) => {
  const loadMunicipalities = async () => {
    const index = await fetchJson(
      `/map/regions/${encodeURIComponent(state.regionId)}/municipalities.json`,
    );
    state.municipalities = index.municipalities || [];
    const selected = state.municipalities.find((entry) => entry.id === state.municipalityId)
      || state.municipalities.find((entry) => entry.dataStatus !== 'empty')
      || state.municipalities[0]
      || null;
    state.municipality = selected;
    state.municipalityId = selected?.id || '';
    renderOptions(
      municipalitySelect,
      state.municipalities,
      state.municipalityId,
      (entry) => entry.label,
    );
  };

  const selectRegion = async (regionId, notify = true) => {
    state.regionId = regionId;
    state.municipalityId = '';
    regionSelect.value = regionId;
    await loadMunicipalities();
    if (notify) await onChange('region');
  };

  const selectMunicipality = async (municipalityId, notify = true) => {
    state.municipalityId = municipalityId;
    state.municipality = state.municipalities.find((entry) => entry.id === municipalityId) || null;
    municipalitySelect.value = municipalityId;
    if (notify) await onChange('municipality');
  };

  const start = async () => {
    const index = await fetchJson('/map/regions/index.json');
    state.regions = index.regions || [];
    state.regionId = state.regions.some((entry) => entry.id === state.regionId)
      ? state.regionId
      : index.defaultRegionId || state.regions[0]?.id || 'okayama';
    renderOptions(
      regionSelect,
      state.regions,
      state.regionId,
      (entry) => entry.label || entry.prefecture || entry.id,
    );
    await loadMunicipalities();
  };

  regionSelect.addEventListener('change', () => void selectRegion(regionSelect.value));
  municipalitySelect.addEventListener(
    'change',
    () => void selectMunicipality(municipalitySelect.value),
  );

  return { start, selectRegion, selectMunicipality };
};
