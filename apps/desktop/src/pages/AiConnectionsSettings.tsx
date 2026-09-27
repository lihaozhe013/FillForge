import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AiConnectionInput,
  AiConnectionSummary,
  AiModelDiscoveryRequest,
  AiModelProfile
} from '../lib/generated-types';
import type { AppErrorDtoLike } from '../lib/ipc-protocol';
import { ErrorBanner, Section } from '../components/ui';
import { extractError, useAsyncData } from '../hooks/useAsyncData';

type ConnectionDraft = {
  id?: string;
  name: string;
  protocol: AiConnectionInput['protocol'];
  baseUrl: string;
  models: AiModelProfile[];
  defaultModel: string;
  apiKey: string;
  removeApiKey: boolean;
  hasApiKey: boolean;
};

const MAX_CONFIGURED_MODELS = 256;
const DISCOVERED_PAGE_SIZE = 100;

function createEmptyConnection(name = ''): ConnectionDraft {
  return {
    name,
    protocol: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    models: [],
    defaultModel: '',
    apiKey: '',
    removeApiKey: false,
    hasApiKey: false
  };
}

function connectionDraft(connection: AiConnectionSummary): ConnectionDraft {
  return {
    id: connection.id,
    name: connection.name,
    protocol: connection.protocol,
    baseUrl: connection.baseUrl,
    models: connection.models.map((model) => ({ ...model })),
    defaultModel: connection.defaultModel,
    apiKey: '',
    removeApiKey: false,
    hasApiKey: connection.hasApiKey
  };
}

function newModel(model = ''): AiModelProfile {
  return { id: crypto.randomUUID(), model };
}

export function AiConnectionsSettings() {
  const { t } = useTranslation();
  const connections = useAsyncData(() => window.fillforge.aiConnections.list(), []);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [isNewConnection, setIsNewConnection] = useState(false);
  const [connectionDraftState, setConnectionDraftState] = useState<ConnectionDraft>(() =>
    createEmptyConnection()
  );
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discoveryTruncated, setDiscoveryTruncated] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [visibleDiscoveredCount, setVisibleDiscoveredCount] = useState(DISCOVERED_PAGE_SIZE);
  const [deleteConnection, setDeleteConnection] = useState<string | null>(null);
  const [error, setError] = useState<AppErrorDtoLike | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const list = connections.data;
    if (!list || isNewConnection || selectedConnection) return;
    const initial =
      list.connections.find((item) => item.id === list.defaultConnectionId) ?? list.connections[0];
    if (initial) {
      setSelectedConnection(initial.id);
      setConnectionDraftState(connectionDraft(initial));
    }
  }, [connections.data, isNewConnection, selectedConnection]);

  useEffect(() => {
    if (!connections.data || !selectedConnection || isNewConnection) return;
    const selected = connections.data.connections.find((item) => item.id === selectedConnection);
    if (selected) setConnectionDraftState(connectionDraft(selected));
  }, [connections.data, isNewConnection, selectedConnection]);

  const activeConnection = useMemo(
    () => connections.data?.connections.find((item) => item.id === selectedConnection),
    [connections.data, selectedConnection]
  );
  const defaultConnectionId = connections.data?.defaultConnectionId ?? '';
  const matchingDiscovered = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase();
    return query
      ? discoveredModels.filter((model) => model.toLocaleLowerCase().includes(query))
      : discoveredModels;
  }, [discoveredModels, modelSearch]);
  const visibleDiscovered = matchingDiscovered.slice(0, visibleDiscoveredCount);
  const modelDraftCount = connectionDraftState.models.length;
  const configuredModelCount = connectionDraftState.models.filter((model) =>
    model.model.trim()
  ).length;

  function clearDiscovery() {
    setDiscoveredModels([]);
    setDiscoveryTruncated(false);
    setModelSearch('');
    setVisibleDiscoveredCount(DISCOVERED_PAGE_SIZE);
  }

  function updateConnection<K extends keyof ConnectionDraft>(key: K, value: ConnectionDraft[K]) {
    setNotice(null);
    setConnectionDraftState((current) => {
      const next = { ...current, [key]: value };
      if (key === 'apiKey' && value) next.removeApiKey = false;
      if (key === 'removeApiKey' && value === true) next.apiKey = '';
      return next;
    });
  }

  function updateModel(index: number, change: Partial<AiModelProfile>) {
    setConnectionDraftState((current) => {
      const previous = current.models[index];
      if (!previous) return current;
      const nextModel = { ...previous, ...change };
      const models = current.models.map((model, modelIndex) =>
        modelIndex === index ? nextModel : model
      );
      const defaultModel =
        current.defaultModel === previous.model || !current.defaultModel
          ? nextModel.model
          : current.defaultModel;
      return { ...current, models, defaultModel };
    });
    setNotice(null);
  }

  function addModel(modelName = '') {
    const model = modelName.trim();
    if (model && connectionDraftState.models.some((item) => item.model === model)) {
      if (!connectionDraftState.defaultModel) updateConnection('defaultModel', model);
      return;
    }
    if (modelDraftCount >= MAX_CONFIGURED_MODELS) {
      setNotice(t('settings.modelLimitReached'));
      return;
    }
    const item = newModel(model);
    setConnectionDraftState((current) => ({
      ...current,
      models: [...current.models, item],
      defaultModel: current.defaultModel || model
    }));
    setNotice(null);
  }

  function moveModel(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= connectionDraftState.models.length) return;
    setConnectionDraftState((current) => {
      const models = [...current.models];
      const currentModel = models[index];
      const targetModel = models[target];
      if (!currentModel || !targetModel) return current;
      models[index] = targetModel;
      models[target] = currentModel;
      return { ...current, models };
    });
  }

  function removeModel(index: number) {
    setConnectionDraftState((current) => {
      const removed = current.models[index];
      const models = current.models.filter((_model, modelIndex) => modelIndex !== index);
      const defaultModel =
        removed?.model === current.defaultModel
          ? (models.find((model) => model.model.trim())?.model ?? '')
          : current.defaultModel;
      return { ...current, models, defaultModel };
    });
  }

  function requestForModel(model: string): AiModelDiscoveryRequest {
    return {
      ...(connectionDraftState.id ? { id: connectionDraftState.id } : {}),
      protocol: connectionDraftState.protocol,
      baseUrl: connectionDraftState.baseUrl,
      model,
      ...(connectionDraftState.apiKey ? { apiKey: connectionDraftState.apiKey } : {}),
      useSavedApiKey:
        connectionDraftState.hasApiKey &&
        !connectionDraftState.removeApiKey &&
        !connectionDraftState.apiKey
    };
  }

  async function discoverModels() {
    const model =
      connectionDraftState.defaultModel ||
      connectionDraftState.models.find((item) => item.model.trim())?.model ||
      '';
    setBusy(true);
    setError(null);
    setNotice(null);
    clearDiscovery();
    try {
      const result = await window.fillforge.aiConnections.discoverModels(requestForModel(model));
      setDiscoveredModels(result.models);
      setDiscoveryTruncated(result.truncated);
      setNotice(
        result.source === 'validatedModel'
          ? t('settings.modelVerified')
          : t('settings.modelsFound', { count: result.models.length })
      );
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    const model =
      connectionDraftState.defaultModel ||
      connectionDraftState.models.find((item) => item.model.trim())?.model ||
      discoveredModels[0] ||
      '';
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await window.fillforge.aiConnections.test(requestForModel(model));
      setNotice(t('settings.connectionTestPassed'));
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveConnection() {
    const models = connectionDraftState.models
      .map((model) => ({
        ...model,
        model: model.model.trim(),
        ...(model.label?.trim() ? { label: model.label.trim() } : { label: undefined })
      }))
      .filter((model) => model.model.length > 0);
    const defaultModel = models.some((model) => model.model === connectionDraftState.defaultModel)
      ? connectionDraftState.defaultModel
      : (models[0]?.model ?? '');
    const input: AiConnectionInput = {
      ...(connectionDraftState.id ? { id: connectionDraftState.id } : {}),
      name: connectionDraftState.name,
      protocol: connectionDraftState.protocol,
      baseUrl: connectionDraftState.baseUrl,
      models,
      defaultModel,
      ...(connectionDraftState.apiKey ? { apiKey: connectionDraftState.apiKey } : {}),
      removeApiKey: connectionDraftState.removeApiKey
    };
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.fillforge.aiConnections.save(input);
      const saved = input.id
        ? result.connections.find((item) => item.id === input.id)
        : result.connections.at(-1);
      connections.reload();
      if (saved) {
        setSelectedConnection(saved.id);
        setIsNewConnection(false);
        setConnectionDraftState(connectionDraft(saved));
      }
      setNotice(t('settings.connectionSaved'));
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await window.fillforge.aiConnections.setDefault(id || null);
      connections.reload();
      setNotice(t('settings.defaultConnectionSaved'));
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function removeConnection(id: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await window.fillforge.aiConnections.delete(id);
      connections.reload();
      setDeleteConnection(null);
      if (selectedConnection === id) {
        const next =
          result.connections.find((item) => item.id === result.defaultConnectionId) ??
          result.connections[0];
        if (next) {
          setSelectedConnection(next.id);
          setConnectionDraftState(connectionDraft(next));
        } else {
          setSelectedConnection(null);
          setIsNewConnection(true);
          setConnectionDraftState(createEmptyConnection());
        }
      }
      setNotice(t('settings.connectionRemoved'));
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  function startNewConnection() {
    setSelectedConnection(null);
    setIsNewConnection(true);
    setConnectionDraftState(createEmptyConnection(t('settings.newConnection')));
    setDeleteConnection(null);
    setNotice(null);
    setError(null);
    clearDiscovery();
  }

  function selectConnection(connection: AiConnectionSummary) {
    setSelectedConnection(connection.id);
    setIsNewConnection(false);
    setConnectionDraftState(connectionDraft(connection));
    setDeleteConnection(null);
    setNotice(null);
    setError(null);
    clearDiscovery();
  }

  return (
    <>
      <div className="settings-section-heading connection-heading">
        <div>
          <h2>{t('settings.aiConnections')}</h2>
          <p>{t('settings.aiConnectionsDescription')}</p>
        </div>
        <button onClick={startNewConnection}>{t('settings.addConnection')}</button>
      </div>
      <ErrorBanner error={error ?? connections.error} />
      <div className="connection-default-card">
        <label>
          {t('settings.defaultConnection')}
          <select
            value={defaultConnectionId}
            disabled={busy || !connections.data?.connections.length}
            onChange={(event) => void setDefault(event.target.value)}
          >
            <option value="">{t('settings.noConnections')}</option>
            {(connections.data?.connections ?? []).map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">{t('settings.defaultConnectionNote')}</p>
      </div>
      <div className="connection-layout">
        <Section title={t('settings.connections')}>
          {connections.loading && <p className="empty-hint">{t('common.loading')}</p>}
          {(connections.data?.connections ?? []).map((connection) => {
            const defaultModel = connection.models.find(
              (model) => model.model === connection.defaultModel
            );
            return (
              <div
                className={`connection-list-item${selectedConnection === connection.id ? ' selected' : ''}`}
                key={connection.id}
              >
                <button className="connection-select" onClick={() => selectConnection(connection)}>
                  <span className="connection-avatar">
                    {connection.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{connection.name}</strong>
                    <small>
                      {connection.protocol === 'responses' ? 'Responses' : 'Chat Completions'} ·{' '}
                      {defaultModel?.label || defaultModel?.model || connection.defaultModel}
                    </small>
                  </span>
                </button>
                {deleteConnection === connection.id ? (
                  <div className="connection-delete-confirm">
                    <span>{t('settings.deleteConfirm')}</span>
                    <button className="link" onClick={() => setDeleteConnection(null)}>
                      {t('common.cancel')}
                    </button>
                    <button
                      className="link danger"
                      disabled={busy}
                      onClick={() => void removeConnection(connection.id)}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                ) : (
                  <button
                    className="link danger connection-delete"
                    disabled={busy}
                    onClick={() => setDeleteConnection(connection.id)}
                    aria-label={t('settings.deleteConnection')}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {(connections.data?.connections.length ?? 0) === 0 && !connections.loading && (
            <p className="empty-hint">{t('settings.noConnections')}</p>
          )}
        </Section>

        <div className="connection-editor">
          <Section
            title={activeConnection ? t('settings.editConnection') : t('settings.newConnection')}
          >
            <div className="connection-form">
              <div className="connection-form-card">
                <h3>{t('settings.connectionDetails')}</h3>
                <label>
                  {t('settings.connectionName')}
                  <input
                    value={connectionDraftState.name}
                    onChange={(event) => updateConnection('name', event.target.value.slice(0, 160))}
                    placeholder={t('settings.connectionNamePlaceholder')}
                  />
                </label>
                <label>
                  {t('settings.protocol')}
                  <select
                    value={connectionDraftState.protocol}
                    onChange={(event) =>
                      updateConnection(
                        'protocol',
                        event.target.value as AiConnectionInput['protocol']
                      )
                    }
                  >
                    <option value="responses">Responses API</option>
                    <option value="chat-completions">Chat Completions</option>
                  </select>
                </label>
                <label>
                  {t('settings.baseUrl')}
                  <input
                    value={connectionDraftState.baseUrl}
                    onChange={(event) =>
                      updateConnection('baseUrl', event.target.value.slice(0, 2048))
                    }
                    placeholder="https://api.example.com/v1"
                  />
                </label>
                <small className="muted">{t('settings.endpointHint')}</small>
              </div>
              <div className="connection-form-card">
                <h3>{t('settings.apiKey')}</h3>
                <label>
                  {t('settings.apiKey')}
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={connectionDraftState.apiKey}
                    onChange={(event) =>
                      updateConnection('apiKey', event.target.value.slice(0, 4096))
                    }
                    placeholder={
                      connectionDraftState.hasApiKey
                        ? t('settings.keySavedPlaceholder')
                        : t('settings.keyPlaceholder')
                    }
                  />
                </label>
                <small className="muted">{t('settings.keyStoreHint')}</small>
                {connectionDraftState.hasApiKey && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={connectionDraftState.removeApiKey}
                      onChange={(event) => updateConnection('removeApiKey', event.target.checked)}
                    />
                    {t('settings.removeKey')}
                  </label>
                )}
                <div className="connection-actions">
                  <button disabled={busy} onClick={() => void testConnection()}>
                    {t('settings.testConnection')}
                  </button>
                </div>
              </div>
              <div className="connection-form-card">
                <div className="connection-card-heading">
                  <div>
                    <h3>{t('settings.models')}</h3>
                    <p className="muted">{t('settings.modelsHint')}</p>
                  </div>
                  <button
                    disabled={busy || modelDraftCount >= MAX_CONFIGURED_MODELS}
                    onClick={() => addModel()}
                  >
                    {t('settings.addModel')}
                  </button>
                </div>
                <div className="ai-model-list">
                  {connectionDraftState.models.map((model, index) => (
                    <div className="ai-model-card" key={model.id}>
                      <div className="ai-model-card-header">
                        <strong>{t('settings.modelNumber', { index: index + 1 })}</strong>
                        <div className="ai-model-card-actions">
                          <button
                            disabled={index === 0}
                            aria-label={t('settings.moveUp')}
                            title={t('settings.moveUp')}
                            onClick={() => moveModel(index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            disabled={index === connectionDraftState.models.length - 1}
                            aria-label={t('settings.moveDown')}
                            title={t('settings.moveDown')}
                            onClick={() => moveModel(index, 1)}
                          >
                            ↓
                          </button>
                          <button
                            className="danger"
                            aria-label={`${t('common.delete')} ${model.model || index + 1}`}
                            onClick={() => removeModel(index)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <label>
                        {t('settings.modelIdLabel')}
                        <input
                          value={model.model}
                          onChange={(event) =>
                            updateModel(index, { model: event.target.value.slice(0, 256) })
                          }
                          placeholder="model-name"
                        />
                      </label>
                      <label>
                        {t('settings.displayNameLabel')}
                        <input
                          value={model.label ?? ''}
                          onChange={(event) =>
                            updateModel(index, {
                              label: event.target.value.slice(0, 256) || undefined
                            })
                          }
                          placeholder={t('settings.optionalPlaceholder')}
                        />
                      </label>
                      <label className="ai-model-default">
                        <input
                          type="radio"
                          name="default-ai-model"
                          checked={
                            connectionDraftState.defaultModel === model.model &&
                            model.model.length > 0
                          }
                          onChange={() => updateConnection('defaultModel', model.model)}
                          disabled={!model.model}
                        />
                        {t('settings.defaultModel')}
                      </label>
                    </div>
                  ))}
                  {connectionDraftState.models.length === 0 && (
                    <p className="empty-hint">{t('settings.addModelFirst')}</p>
                  )}
                </div>
                <div className="discovery-actions">
                  <button
                    className="primary"
                    disabled={
                      busy || !connectionDraftState.name.trim() || configuredModelCount === 0
                    }
                    onClick={() => void saveConnection()}
                  >
                    {t('common.save')}
                  </button>
                  <button
                    disabled={busy || !connectionDraftState.baseUrl.trim()}
                    onClick={() => void discoverModels()}
                  >
                    {busy ? t('settings.discovering') : t('settings.discoverModels')}
                  </button>
                </div>
                {discoveredModels.length > 0 && (
                  <div className="discovered-models">
                    <label>
                      {t('settings.searchDiscoveredModels')}
                      <input
                        type="search"
                        value={modelSearch}
                        onChange={(event) => {
                          setModelSearch(event.target.value);
                          setVisibleDiscoveredCount(DISCOVERED_PAGE_SIZE);
                        }}
                        placeholder={t('settings.searchDiscoveredModels')}
                      />
                    </label>
                    <p className="muted" role="status">
                      {t('settings.modelSearchResults', {
                        shown: visibleDiscovered.length,
                        count: matchingDiscovered.length
                      })}
                    </p>
                    {discoveryTruncated && (
                      <p className="muted" role="status">
                        {t('settings.modelsTruncated')}
                      </p>
                    )}
                    {matchingDiscovered.length > 0 ? (
                      <ul
                        className="discovered-model-list"
                        aria-label={t('settings.discoveredModels')}
                      >
                        {visibleDiscovered.map((model) => {
                          const alreadyAdded = connectionDraftState.models.some(
                            (item) => item.model === model
                          );
                          return (
                            <li key={model}>
                              <span title={model}>{model}</span>
                              <button
                                disabled={alreadyAdded || modelDraftCount >= MAX_CONFIGURED_MODELS}
                                onClick={() => addModel(model)}
                              >
                                {alreadyAdded ? t('settings.modelAdded') : t('settings.addModel')}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="muted">{t('settings.noMatchingModels')}</p>
                    )}
                    {visibleDiscovered.length < matchingDiscovered.length && (
                      <button
                        onClick={() =>
                          setVisibleDiscoveredCount((count) => count + DISCOVERED_PAGE_SIZE)
                        }
                      >
                        {t('settings.showMoreModels', {
                          count: Math.min(
                            DISCOVERED_PAGE_SIZE,
                            matchingDiscovered.length - visibleDiscovered.length
                          )
                        })}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {notice && (
                <div className="connection-notice" role="status">
                  {notice}
                </div>
              )}
              <p className="muted connection-privacy-note">{t('settings.connectionPrivacy')}</p>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
