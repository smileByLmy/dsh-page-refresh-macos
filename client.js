window.__ModuleLoader__.load({
  id: 'dsh-page-refresh-macos',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    const h = React.createElement;

    // ── Sizing matches the shipped header utilities so the row never jumps ──
    const BTN = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26px',
      height: '26px',
      marginLeft: '4px',
      padding: 0,
      border: 'none',
      borderRadius: '6px',
      background: 'transparent',
      color: 'inherit',
      fontSize: '15px',
      lineHeight: 1,
      cursor: 'pointer',
      opacity: 0.75,
      verticalAlign: 'middle',
    };
    const BTN_HOVER = { background: 'rgba(128,128,128,0.22)', opacity: 1 };
    const BTN_ACTIVE = { background: 'rgba(128,128,128,0.30)', opacity: 1 };

    // ── Menu surface uses theme tokens so it follows light/dark automatically ──
    const MENU = {
      position: 'absolute',
      top: 'calc(100% + 7px)',
      right: 0,
      minWidth: '210px',
      padding: '6px',
      borderRadius: '11px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-overlay)',
      boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
      zIndex: 2147483000,
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
    };
    const ITEM = {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      width: '100%',
      padding: '8px 10px',
      border: 'none',
      borderRadius: '7px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
      lineHeight: 1.2,
      textAlign: 'left',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    };
    const ITEM_HOVER = { background: 'rgba(128,128,128,0.16)' };
    const BACKDROP = {
      position: 'fixed',
      inset: 0,
      zIndex: 2147482999,
      background: 'transparent',
    };
    const NOTE = {
      padding: '7px 10px',
      fontSize: '12px',
      lineHeight: 1.55,
      color: 'var(--dsw-alias-label-secondary)',
      maxWidth: '210px',
      whiteSpace: 'normal',
    };
    const NOTE_BAD = { color: 'var(--dsw-alias-state-error-primary)' };

    // ── Line icons on a 24 grid; stroke follows currentColor ──
    function svgProps(size) {
      return {
        width: size || 16,
        height: size || 16,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        style: { flex: '0 0 auto' },
      };
    }

    function IconPower(props) {
      return h('svg', svgProps(props.size),
        h('path', { key: 'a', d: 'M12 3.2v8.4' }),
        h('path', { key: 'b', d: 'M6.6 6.9a7.6 7.6 0 1 0 10.8 0' }),
      );
    }

    function IconRestart(props) {
      return h('svg', svgProps(props.size),
        h('path', { key: 'a', d: 'M3.8 12a8.2 8.2 0 1 0 2.5-5.9' }),
        h('path', { key: 'b', d: 'M3.6 4.4v5.2h5.2' }),
      );
    }

    // Blackout veil: covered in the same tick as the click, so the perceived
    // latency is zero even though the process takes a moment to stop.
    function makeVeil(text) {
      const veil = document.createElement('div');
      veil.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:#0b0b0f;' +
        'display:flex;align-items:center;justify-content:center;' +
        'color:#5a5a66;font:13px/1.6 system-ui,sans-serif;letter-spacing:1px';
      veil.textContent = text;
      document.body.appendChild(veil);
      return veil;
    }

    function PowerButton() {
      const [hover, setHover] = React.useState(false);
      const [open, setOpen] = React.useState(false);
      const [hoverItem, setHoverItem] = React.useState('');
      const [note, setNote] = React.useState(null); // { bad, text }

      function close() {
        setOpen(false);
        setHoverItem('');
        setNote(null);
      }

      async function fire(kind) {
        const isClose = kind === 'close';
        const route = isClose ? '/api/power-macos/close' : '/api/power-macos/restart';
        const label = isClose ? '正在关闭 DeepSeek Harness' : '正在重启 DeepSeek Harness';

        setNote({ bad: false, text: label });
        const veil = makeVeil(label);
        let logHint = '';

        try {
          const r = await fetch(route, { method: 'POST' });
          if (!r.ok) {
            const body = await r.text().catch(() => '');
            if (veil.parentNode) veil.remove();
            setNote({
              bad: true,
              text: (isClose ? '关闭' : '重启') + '请求被拒 HTTP ' + r.status +
                (body ? '\n' + body.split('\n')[0].slice(0, 120) : ''),
            });
            return;
          }
          try {
            const j = await r.json();
            if (j && j.logFile) logHint = '\n日志：' + j.logFile;
          } catch { /* a non-JSON body is fine */ }
        } catch (e) {
          if (veil.parentNode) veil.remove();
          setNote({
            bad: true,
            text: (isClose ? '关闭' : '重启') + '请求发不出去：' + (e && e.message ? e.message : '网络错误'),
          });
          return;
        }

        // Restart reconnects on its own and the veil dies with the page.
        // Fallbacks below only matter when the process never came back.
        setTimeout(() => {
          if (!veil.parentNode) return;
          veil.remove();
          setNote({
            bad: true,
            text: isClose
              ? '4 秒内没关掉，可能被别的东西拦住了' + logHint
              : '没重启起来，请手动运行 dsh --profile web' + logHint,
          });
        }, isClose ? 4000 : 90000);
      }

      function item(kind, label, Icon) {
        const hot = hoverItem === kind;
        return h('button', {
          key: kind,
          type: 'button',
          role: 'menuitem',
          style: hot ? Object.assign({}, ITEM, ITEM_HOVER) : ITEM,
          onMouseEnter: () => setHoverItem(kind),
          onMouseLeave: () => setHoverItem(''),
          onClick: () => fire(kind),
        }, h(Icon, { size: 16 }), h('span', { key: 't' }, label));
      }

      const shown = open
        ? (hover ? Object.assign({}, BTN, BTN_ACTIVE) : BTN)
        : (hover ? Object.assign({}, BTN, BTN_HOVER) : BTN);

      return h('div', { style: { position: 'relative', display: 'inline-flex' } },
        h('button', {
          type: 'button',
          title: '电源',
          'aria-label': '电源',
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          style: shown,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onClick: () => (open ? close() : (setNote(null), setOpen(true))),
        }, h(IconPower, { size: 16 })),
        open ? h(React.Fragment, null,
          h('div', { key: 'bd', style: BACKDROP, onClick: close }),
          h('div', { key: 'menu', role: 'menu', style: MENU },
            note
              ? h('div', { style: note.bad ? Object.assign({}, NOTE, NOTE_BAD) : NOTE }, note.text)
              : [
                  item('close', '关闭 DeepSeek Harness', IconPower),
                  item('restart', '重启 DeepSeek Harness', IconRestart),
                ],
          ),
        ) : null,
      );
    }

    function RefreshButton() {
      const [hover, setHover] = React.useState(false);
      return h('button', {
        type: 'button',
        title: '刷新页面',
        'aria-label': '刷新页面',
        style: hover ? Object.assign({}, BTN, BTN_HOVER) : BTN,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onClick: () => window.location.reload(),
      }, '\u21BB'); // ↻
    }

    function apply(ctx) {
      const slots = ctx.get('slots');
      if (slots === undefined) return;

      slots.inject('conversation.session.header.utilities', () => slots.register(
        { name: 'conversation.session.header.utilities', id: 'dsh-page-refresh-macos-refresh', order: 999, label: '刷新页面' },
        () => React.createElement(RefreshButton),
      ));

      slots.inject('conversation.session.header.utilities', () => slots.register(
        { name: 'conversation.session.header.utilities', id: 'dsh-page-refresh-macos-power', order: 998, label: '电源' },
        () => React.createElement(PowerButton),
      ));
    }

    exports.name = 'dsh-page-refresh-macos-client';
    exports.inject = ['slots'];
    exports.apply = apply;
    return module.exports;
  },
});
