/**
 * Client half of the thinking-mode bundle: a level control that sits in the
 * composer tool row immediately before the model selector.
 *
 * The control is the same decision the model seat's effort pane makes, hoisted
 * next to the model: it reads the Session's shared model directory, offers the
 * levels the selected model's adapter advertises, and submits through the same
 * `select` call — so the durable Session selection stays the one source of
 * truth and a change made here is visible in the model menu and vice versa.
 *
 * The control renders only for a model that advertises reasoning levels, so a
 * deployment whose models do not reason keeps a clean composer.
 *
 * The module is plain JavaScript: React and react-dom come from the browser
 * module table, and no Harness Client package is imported as a module.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-thinking-mode',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;

    const NS = 'thinking-mode';
    const SLOT = 'conversation.input.right';
    const ID = 'thinking-mode';

    const en = {
      'trigger.aria': 'Thinking level',
      'trigger.off': 'Off',
      'trigger.default': 'Default',
      'trigger.busy': 'Applying thinking level',
      'menu.aria': 'Thinking level',
      'menu.heading': 'Thinking',
      'menu.default': 'Model default',
      'menu.current': 'Current',
      'menu.close': 'Close',
    };
    const zh = {
      'trigger.aria': '思考等级',
      'trigger.off': '关闭',
      'trigger.default': '默认',
      'trigger.busy': '正在应用思考等级',
      'menu.aria': '思考等级',
      'menu.heading': '思考',
      'menu.default': '模型默认',
      'menu.current': '当前',
      'menu.close': '关闭',
    };

    const STYLE = `
.dsh-thinking-root { display: inline-flex; min-width: 0; position: relative; }
.dsh-thinking-trigger {
  display: inline-flex; align-items: center; gap: 6px; min-width: 0;
  height: 28px; padding: 0 8px; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 1; cursor: pointer;
}
.dsh-thinking-trigger:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-thinking-trigger:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-thinking-trigger[data-on='true'] { color: var(--dsw-alias-brand-primary); }
.dsh-thinking-trigger:disabled { cursor: default; opacity: .55; }
.dsh-thinking-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 96px; }
.dsh-thinking-menu {
  position: fixed; z-index: 60; min-width: 176px; max-width: 260px;
  padding: 4px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-bg-overlay); box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  font-size: 13px; color: var(--dsw-alias-label-primary);
}
.dsh-thinking-heading {
  padding: 6px 8px 4px; color: var(--dsw-alias-label-secondary);
  font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
}
.dsh-thinking-item {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%;
  padding: 6px 8px; border: none; border-radius: 6px; background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.dsh-thinking-item:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-thinking-item:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dsh-thinking-item[aria-checked='true'] { color: var(--dsw-alias-brand-primary); }
.dsh-thinking-item:disabled { cursor: default; opacity: .55; }
.dsh-thinking-note { padding: 4px 8px 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
`;

    /** Order the levels with `off` first, then keeping the adapter's order. */
    function orderedEfforts(reasoning) {
      const efforts = reasoning === undefined ? [] : [...reasoning.efforts];
      efforts.sort((left, right) => (left.id === 'off' ? 0 : 1) - (right.id === 'off' ? 0 : 1));
      return efforts;
    }

    /**
     * The thinking level control.
     * @param props - injected face from the registration plus the Session seat.
     */
    function ThinkingMode({ available, directory, load, select, sessionId, t }) {
      const state = useSyncExternalStore(
        useCallback((notify) => directory.subscribe(notify), [directory]),
        useCallback(() => directory.getSnapshot(), [directory]),
      );
      const [open, setOpen] = useState(false);
      const [position, setPosition] = useState(null);
      const rootRef = useRef(null);
      const menuRef = useRef(null);
      const triggerRef = useRef(null);

      const current = state.current;
      const groups = state.groups;

      const reasoning = useMemo(() => {
        if (current === null) return undefined;
        for (const group of groups) {
          if (group.id !== current.provider) continue;
          const model = group.models.find((entry) => entry.id === current.model);
          if (model !== undefined) return model.reasoning;
        }
        return undefined;
      }, [groups, current === null ? null : current.provider, current === null ? null : current.model]);

      const efforts = useMemo(() => orderedEfforts(reasoning), [reasoning]);
      const effectiveEffort = current?.reasoningEffort ?? reasoning?.defaultEffort;
      const busy = state.status === 'selecting' && state.pending !== null;

      useEffect(() => {
        if (available) load();
      }, [available, load]);

      const close = useCallback((restoreFocus) => {
        setOpen(false);
        setPosition(null);
        if (restoreFocus) triggerRef.current?.focus();
      }, []);

      useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          if (rootRef.current?.contains(event.target) === true) return;
          if (menuRef.current?.contains(event.target) === true) return;
          close(false);
        };
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          close(true);
        };
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
        };
      }, [open, close]);

      const show = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect !== undefined) {
          const width = 200;
          setPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
            bottom: Math.max(8, window.innerHeight - rect.top + 6),
            width,
          });
        }
        setOpen(true);
      }, []);

      const apply = useCallback(
        (effort) => {
          if (current === null) return;
          close(true);
          select({
            provider: current.provider,
            model: current.model,
            ...(effort === undefined ? {} : { reasoningEffort: effort }),
          }).catch(() => {});
        },
        [close, current === null ? null : current.provider, current === null ? null : current.model, select],
      );

      const label = effectiveEffort === undefined
        ? (reasoning === undefined ? '' : t('trigger.default'))
        : (reasoning.efforts.find((effort) => effort.id === effectiveEffort)?.name ?? effectiveEffort);

      // A model whose adapter advertises no levels has nothing this control can say.
      if (!available || current === null || reasoning === undefined) return null;

      const on = effectiveEffort !== undefined && effectiveEffort !== 'off';
      const options = [
        ...(reasoning.defaultEffort === undefined
          ? [{ key: 'default', effort: undefined, label: t('menu.default') }]
          : []),
        ...efforts.map((effort) => ({
          key: `effort:${effort.id}`,
          effort: effort.id,
          label: effort.id === 'off' ? t('trigger.off') : effort.name,
          description: effort.description,
        })),
      ];

      return h(
        'div',
        { className: 'dsh-thinking-root', ref: rootRef },
        h('style', null, STYLE),
        h(
          'button',
          {
            ref: triggerRef,
            type: 'button',
            className: 'dsh-thinking-trigger',
            'data-on': on ? 'true' : 'false',
            'aria-label': `${t('trigger.aria')}: ${label}`,
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-busy': busy ? true : undefined,
            title: `${t('trigger.aria')}: ${label}`,
            disabled: busy,
            onClick: () => (open ? close(true) : show()),
          },
          h(
            'svg',
            { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
            h('path', {
              fill: 'currentColor',
              opacity: on ? 1 : 0.4,
              d: 'M8 1a4 4 0 0 0-2.4 7.2c.4.3.65.75.65 1.24V10h3.5v-.56c0-.49.25-.94.65-1.24A4 4 0 0 0 8 1Zm-1.75 10.5h3.5V13h-3.5v-1.5ZM8 14.4a1.6 1.6 0 0 0 1.4-.9H6.6a1.6 1.6 0 0 0 1.4.9Z',
            }),
          ),
          h('span', { className: 'dsh-thinking-label' }, label),
        ),
        open && position !== null
          ? ReactDOM.createPortal(
              h(
                'div',
                {
                  ref: menuRef,
                  className: 'dsh-thinking-menu',
                  role: 'menu',
                  'aria-label': t('menu.aria'),
                  style: { left: `${position.left}px`, bottom: `${position.bottom}px`, width: `${position.width}px` },
                },
                h('div', { className: 'dsh-thinking-heading' }, t('menu.heading')),
                ...options.map((option) =>
                  h(
                    'button',
                    {
                      key: option.key,
                      type: 'button',
                      className: 'dsh-thinking-item',
                      role: 'menuitemradio',
                      'aria-checked': option.effort === effectiveEffort,
                      disabled: busy,
                      title: option.description,
                      onClick: () => apply(option.effort),
                    },
                    h('span', null, option.label),
                    option.effort === effectiveEffort ? h('span', { 'aria-hidden': true }, '✓') : null,
                  ),
                ),
                busy ? h('div', { className: 'dsh-thinking-note' }, t('trigger.busy')) : null,
              ),
              document.body,
            )
          : null,
      );
    }

    return {
      inject: ['slots', 'locale', 'sessions', 'modelDirectories'],

      /**
       * Register the dictionaries and the composer control.
       * @param ctx - the Client root context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'thinking-mode: dictionaries');
        const t = ctx.locale.bind(NS);
        const models = ctx.modelDirectories;
        const sessions = ctx.sessions;

        ctx.slots.inject(SLOT, () =>
          ctx.slots.register(
            {
              name: SLOT,
              id: ID,
              order: 10,
              inject: (sessionId) => {
                const directory = models.directoryFor(sessionId);
                const available = sessions.subagentAddress(sessionId) === undefined;
                return {
                  available,
                  sessionId,
                  directory: directory.store,
                  load: () => {
                    if (available) directory.load().catch(() => {});
                  },
                  select: (selection) => (available ? directory.select(selection) : Promise.resolve(undefined)),
                  t,
                };
              },
            },
            ThinkingMode,
          ),
        );
      },
    };
  },
});