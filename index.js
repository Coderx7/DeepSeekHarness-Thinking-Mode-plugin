/**
 * Host half of the thinking-mode bundle.
 *
 * The Client half renders the level control beside the composer's model seat;
 * this half is what makes that control possible. A model only offers reasoning
 * levels when the adapter that owns its route describes them, and for a
 * self-hosted OpenAI-compatible endpoint that description lives in the
 * provider profile — a `reasoningEfforts` dict per model plus a `compat`
 * block naming how the endpoint expects thinking to travel on the wire.
 *
 * A profile's own `cordis.patch.yml` outranks every bundle layer, so a bundle
 * patch cannot add those fields to a row the profile already restates. This
 * plugin therefore declares them once in the profile patch itself, through the
 * same config-editor service a Settings page writes with, for the routes and
 * models named in its own `config`. Nothing is written for a field that is
 * already there, so a second activation, a hand edit, or a Models-page change
 * is left alone.
 *
 * @module @local/dsh-thinking-mode
 */

/** The reasoning levels every pi-ai route understands, in escalation order. */
const KNOWN_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** What `chat-template` dispatch is told to read from the selected level. */
const DEFAULT_LEVELS = { off: null, low: 'low', medium: 'medium', xhigh: 'xhigh' };

/** Whether a value is a plain record (not null, not an array). */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The declared levels, restricted to names the adapter accepts.
 * @param levels - the plugin's `levels` config value, when supplied.
 * @returns level name to wire spelling; `null` means "send nothing".
 */
function normalizeLevels(levels) {
  const source = isRecord(levels) ? levels : DEFAULT_LEVELS;
  const next = {};
  for (const level of KNOWN_LEVELS) {
    if (!Object.hasOwn(source, level)) continue;
    const wire = source[level];
    if (wire === null) next[level] = null;
    else if (typeof wire === 'string' && wire.length > 0) next[level] = wire;
  }
  return next;
}

/** Whether two level dicts declare the same levels with the same spellings. */
function sameLevels(left, right) {
  const leftKeys = Object.keys(left ?? {}).sort();
  const rightKeys = Object.keys(right ?? {}).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && (left ?? {})[key] === (right ?? {})[key]);
}

/**
 * The `compat` block plus whether it needed a change.
 *
 * `thinkingFormat: chat-template` is pi-ai's escape hatch for an endpoint it
 * cannot recognize; `chatTemplateKwargs` is what that format sends, with
 * `$var` placeholders resolved from the request's selected level. Templates
 * that gate thinking on `enable_thinking` (Qwen and its derivatives) read
 * exactly these three keys.
 * @param compat - the route's stored `compat`, when it has one.
 * @returns the compat block to store and whether it differs from the stored one.
 */
function ensureCompat(compat) {
  const next = { ...(isRecord(compat) ? compat : {}) };
  let changed = false;
  if (next.thinkingFormat !== 'chat-template') {
    next.thinkingFormat = 'chat-template';
    changed = true;
  }
  const kwargs = { ...(isRecord(next.chatTemplateKwargs) ? next.chatTemplateKwargs : {}) };
  if (!Object.hasOwn(kwargs, 'enable_thinking')) {
    kwargs.enable_thinking = { $var: 'thinking.enabled' };
    changed = true;
  }
  if (!Object.hasOwn(kwargs, 'reasoning_effort')) {
    kwargs.reasoning_effort = { $var: 'thinking.effort' };
    changed = true;
  }
  if (kwargs.preserve_thinking !== true) {
    kwargs.preserve_thinking = true;
    changed = true;
  }
  if (changed) next.chatTemplateKwargs = kwargs;
  return { compat: next, changed };
}

/**
 * One route's next profile fields, or undefined when it needs no change.
 *
 * A route this plugin does not recognize is left alone: inventing a profile
 * would name no endpoint, protocol, or models, and could not be served.
 * @param profile - the route's stored profile.
 * @param levels - normalized levels to declare.
 * @param wanted - model ids to declare, or null for every model on the route.
 * @param defaultEffort - level to store as the route default, or undefined.
 * @returns the fields to write, or undefined.
 */
function ensureProfile(profile, levels, wanted, defaultEffort) {
  if (!isRecord(profile)) return undefined;
  const models = Array.isArray(profile.models) ? profile.models : [];
  // Without a model list there is no model to describe; the route inherits a
  // catalog whose models this plugin cannot name.
  if (models.length === 0) return undefined;
  if (wanted !== null && !models.some((entry) => isRecord(entry) && wanted.has(String(entry.id)))) return undefined;

  let declared = 0;
  const nextModels = models.map((entry) => {
    if (!isRecord(entry)) return entry;
    if (wanted !== null && !wanted.has(String(entry.id))) return entry;
    const current = entry.reasoningEfforts;
    // `false` is an explicit "this model does not reason"; never override it.
    if (current === false) return entry;
    if (isRecord(current) && sameLevels(current, levels)) return entry;
    declared += 1;
    return { ...entry, reasoningEfforts: { ...(isRecord(current) ? current : {}), ...levels } };
  });

  const { compat, changed: compatChanged } = ensureCompat(profile.compat);
  const wantsDefault = defaultEffort !== undefined && profile.reasoning !== defaultEffort;
  if (!compatChanged && declared === 0 && !wantsDefault) return undefined;

  const next = {};
  if (compatChanged) next.compat = compat;
  if (declared > 0) next.models = nextModels;
  if (wantsDefault) next.reasoning = defaultEffort;
  return next;
}

/**
 * Compute the routes' next fields without writing anything.
 * @param providers - the stored provider profiles.
 * @param config - this plugin's row config.
 * @returns the routes to update, the patch to apply, and whether any level is usable.
 */
function planDeclaration(providers, config) {
  const named = (Array.isArray(config.providers) ? config.providers : []).filter(
    (provider) => typeof provider === 'string' && provider.length > 0,
  );
  const levels = normalizeLevels(config.levels);
  const wanted = (Array.isArray(config.models) ? config.models : []).map(String);
  const defaultEffort =
    typeof config.defaultEffort === 'string' && config.defaultEffort !== 'provider' ? config.defaultEffort : undefined;
  const patch = {};
  for (const provider of named) {
    const fields = ensureProfile(providers[provider], levels, wanted.length === 0 ? null : new Set(wanted), defaultEffort);
    if (fields !== undefined) patch[provider] = fields;
  }
  return { patch, routes: Object.keys(patch), levelsDeclared: Object.keys(levels).length > 0 };
}

/**
 * Declare the thinking capability for every configured route.
 * @param configEditor - the live config-editor service.
 * @param config - this plugin's row config.
 * @param log - logger for the refusal paths.
 * @returns the route names written; empty when everything was already declared.
 */
async function declareThinking(configEditor, config, log) {
  const ns = typeof config.settingsNs === 'string' && config.settingsNs.length > 0 ? config.settingsNs : 'llm-pi-ai';
  const entry = configEditor.entries().find((row) => row.options.id === ns);
  if (entry === undefined) {
    log.warn(`thinking-mode: no profile entry "${ns}" is active; leaving provider profiles alone`);
    return [];
  }
  const current = isRecord(entry.options.config) ? entry.options.config : {};
  const { patch, routes, levelsDeclared } = planDeclaration(isRecord(current.providers) ? current.providers : {}, config);
  if (!levelsDeclared) {
    log.warn('thinking-mode: `levels` declares no level this harness understands; nothing to declare');
    return [];
  }
  if (routes.length === 0) return [];
  await configEditor.edit(entry, (raw) => {
    // Recompute against the freshest value so a concurrent edit is not undone,
    // and merge into each route's own profile: the fields this plugin adds are
    // a handful beside the endpoint, credential, and protocol the route needs.
    const fresh = isRecord(raw) ? raw : {};
    const freshProviders = isRecord(fresh.providers) ? fresh.providers : {};
    const freshPatch = planDeclaration(freshProviders, config).patch;
    if (Object.keys(freshPatch).length === 0) return fresh;
    const providers = { ...freshProviders };
    for (const [route, fields] of Object.entries(freshPatch)) {
      providers[route] = { ...(isRecord(freshProviders[route]) ? freshProviders[route] : {}), ...fields };
    }
    return { ...fresh, providers };
  });
  return routes;
}

/**
 * Mount the Host half: declare the thinking capability once, then stop.
 *
 * The declaration describes how a model is served, so it belongs to the
 * profile rather than to this plugin's activation; nothing is registered, and
 * nothing is released when the plugin unloads. The edited entry appears in the
 * profile patch beside the row this plugin owns, which is what a Settings page
 * would have written.
 * @param ctx - the profile-root context.
 * @param config - the `thinking-mode` row's config.
 */
export function apply(ctx, config) {
  const row = isRecord(config) ? config : {};
  if (row.enabled === false) return;
  ctx.inject(['configEditor'], (scope) => {
    scope.effect(() => {
      declareThinking(scope.configEditor, row, ctx.logger)
        .then((routes) => {
          if (routes.length > 0) ctx.logger.info(`thinking-mode: declared thinking levels for ${routes.join(', ')}`);
        })
        .catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          ctx.logger.warn(`thinking-mode: could not declare thinking levels (${reason})`);
        });
      return () => {
        // Nothing to release: the declaration is user configuration.
      };
    }, 'thinking-mode: declare thinking levels');
  });
}