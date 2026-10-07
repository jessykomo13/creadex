// Styles du moteur d'exécution (partagés par l'éditeur et les jeux exportés)

export const RUNTIME_CSS = `
.rt-overlay{position:absolute;inset:0;z-index:3;overflow:hidden;container-type:size;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.rt-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ui-layer{position:absolute;inset:0;pointer-events:none;z-index:2;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Rounded","Segoe UI",Roboto,sans-serif}
.ui-layer.preview{z-index:4}
.ui-text{position:absolute;white-space:pre;line-height:1.15;pointer-events:none}
.ui-button{position:absolute;pointer-events:auto;border:none;font-weight:700;font-family:inherit;box-shadow:0 4px 0 rgba(0,0,0,.25),0 6px 14px rgba(0,0,0,.25);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.ui-button:active{filter:brightness(1.18)}
.ui-layer.preview .ui-button{pointer-events:none}
.ui-image{position:absolute;overflow:hidden}
.ui-fill{height:100%}
.vcontrols{position:absolute;inset:0;pointer-events:none;z-index:3}
.vctl{pointer-events:auto;touch-action:none}
.vjoy-zone{position:absolute;left:0;bottom:0;width:46%;height:52%;display:flex;align-items:flex-end;justify-content:flex-start;padding:0 0 calc(var(--vpad) + env(safe-area-inset-bottom)) calc(var(--vpad) + env(safe-area-inset-left))}
.rt-overlay{--vj:clamp(84px,30cqmin,130px);--vb:clamp(52px,17cqmin,78px);--vpad:clamp(10px,5cqmin,24px)}
.vjoy-base{width:var(--vj,120px);height:var(--vj,120px);border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.35);position:relative;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);transition:background .15s}
.vjoy-base.active{background:rgba(255,255,255,.2)}
.vjoy-knob{position:absolute;left:50%;top:50%;width:46%;height:46%;transform-origin:center;translate:-50% -50%;border-radius:50%;background:rgba(255,255,255,.75);box-shadow:0 3px 10px rgba(0,0,0,.35)}
.vbtn{position:absolute;width:var(--vb,74px);height:var(--vb,74px);border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 clamp(12px,4.2cqmin,17px)/1 -apple-system,system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.45);-webkit-user-select:none;user-select:none}
.vbtn-a{right:calc(var(--vpad) + env(safe-area-inset-right));bottom:calc(var(--vpad) * 1.3 + env(safe-area-inset-bottom));background:rgba(34,197,94,.55)}
.vbtn-b{right:calc(var(--vpad) * 1.6 + var(--vb) + env(safe-area-inset-right));bottom:calc(var(--vpad) * 2 + var(--vb) * .45 + env(safe-area-inset-bottom));background:rgba(239,68,68,.55)}
.vbtn.pressed{transform:scale(.92);filter:brightness(1.3)}
`;

export function injectRuntimeCSS() {
  if (document.getElementById('crea-rt-css')) return;
  const s = document.createElement('style');
  s.id = 'crea-rt-css';
  s.textContent = RUNTIME_CSS;
  document.head.appendChild(s);
}
