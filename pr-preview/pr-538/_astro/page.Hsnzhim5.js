const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_astro/mermaid.core.DmiPKWu8.js","_astro/src._wTxv9u9.js","_astro/chunk-Y2CYZVJY.DsF7k-Jl.js","_astro/preload-helper.DkPL1a-l.js","_astro/chunk-BG4553SI.C25df41Z.js","_astro/chunk-DQASFODM.ctq4OkZR.js","_astro/chunk-6MUBBAK2.D1esy9Dn.js","_astro/dist.bNkushdK.js","_astro/line.pmYhy4R-.js","_astro/path.fybaL0A-.js","_astro/array.BifhSqXX.js","_astro/chunk-STOXU5M4.ClzsJix7.js","_astro/chunk-R3KSYZAL.C_AXYm8O.js","_astro/chunk-X4PVCEUW.Bgr1WsDT.js","_astro/rough.esm.Dy-Kn_BL.js","_astro/chunk-AXFCVDMN.CWePB589.js","_astro/chunk-J5ZVWO5B.Ddht6hlJ.js","_astro/chunk-LEVMRMFU.CmBHmIrA.js","_astro/chunk-DUW6YSOI.BXwCdHHB.js","_astro/chunk-M57EVK23.R395R1DC.js"])))=>i.map(i=>d[i]);
import{t as e}from"./preload-helper.DkPL1a-l.js";var t={},n=new Set,r=new WeakSet,i=!0,a=void 0,o=!1;function s(e){o||(o=!0,i??=e?.prefetchAll??!1,a??=e?.defaultStrategy??`hover`,c(),l(),u(),f())}function c(){for(let e of[`touchstart`,`mousedown`])document.addEventListener(e,e=>{let t=e.target.closest(`a`);h(t,`tap`)&&p(t.href,{ignoreSlowConnection:!0})},{passive:!0})}function l(){let e;document.body.addEventListener(`focusin`,e=>{let n=e.target.closest(`a`);h(n,`hover`)&&t(n.href)},{passive:!0}),document.body.addEventListener(`focusout`,n,{passive:!0}),_(()=>{for(let e of document.getElementsByTagName(`a`))r.has(e)||h(e,`hover`)&&(r.add(e),e.addEventListener(`mouseenter`,e=>t(e.currentTarget.href),{passive:!0}),e.addEventListener(`mouseleave`,n,{passive:!0}))});function t(t){e&&clearTimeout(e),e=setTimeout(()=>{p(t)},80)}function n(){e&&=(clearTimeout(e),0)}}function u(){let e;_(()=>{for(let t of document.getElementsByTagName(`a`))r.has(t)||h(t,`viewport`)&&(r.add(t),e??=d(),e.observe(t))})}function d(){let e=new WeakMap;return new IntersectionObserver((t,n)=>{for(let r of t){let t=r.target,i=e.get(t);r.isIntersecting?(i&&clearTimeout(i),e.set(t,setTimeout(()=>{n.unobserve(t),e.delete(t),p(t.href)},300))):i&&(clearTimeout(i),e.delete(t))}})}function f(){_(()=>{for(let e of document.getElementsByTagName(`a`))h(e,`load`)&&p(e.href)})}function p(e,r){e=e.replace(/#.*/,``);let i=r?.ignoreSlowConnection??!1;if(m(e,i)){if(n.add(e),document.createElement(`link`).relList?.supports?.(`prefetch`)){let t=document.createElement(`link`);t.rel=`prefetch`,t.setAttribute(`href`,e),document.head.append(t)}else{let n=new Headers;for(let[e,r]of Object.entries(t))n.set(e,r);fetch(e,{priority:`low`,headers:n}).catch(()=>{})}}}function m(e,t){if(!navigator.onLine||!t&&g())return!1;try{let t=new URL(e,location.href);return location.origin===t.origin&&(location.pathname!==t.pathname||location.search!==t.search)&&!n.has(e)}catch{}return!1}function h(e,t){if(e?.tagName!==`A`)return!1;let n=e.dataset.astroPrefetch;return n===`false`?!1:t===`tap`&&(n!=null||i)&&g()?!0:n==null&&i||n===``?t===a:n===t}function g(){if(`connection`in navigator){let e=navigator.connection;return e.saveData||/2g/.test(e.effectiveType)}return!1}function _(e){e();let t=!1;document.addEventListener(`astro:page-load`,()=>{t?e():t=!0}),new MutationObserver(t=>{for(let n of t)for(let t of n.addedNodes)if(t instanceof Element&&(t.tagName===`A`||t.querySelector?.(`a`))){e();return}}).observe(document.body,{childList:!0,subtree:!0})}document.querySelector(`pre.mermaid`)&&e(async()=>{let{default:e}=await import(`./mermaid.core.DmiPKWu8.js`);return{default:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19])).then(({default:e})=>{e.startOnLoad=!1});var v=(...e)=>console.error(`[astro-mermaid]`,...e),y=()=>document.querySelectorAll(`pre.mermaid`).length>0,b=null;async function x(){return b||(b=e(async()=>{let{default:e}=await import(`./mermaid.core.DmiPKWu8.js`);return{default:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19])).then(async({default:e})=>{let t=[];if(t&&t.length>0){t.length;let n=t.map(e=>e.icons?{name:e.name,icons:e.icons}:{name:e.name,loader:()=>fetch(e.url).then(e=>e.json())});await e.registerIconPacks(n)}return e}).catch(e=>{throw v(`Failed to load mermaid:`,e),b=null,e}),b)}var S={startOnLoad:!1,theme:`default`,layout:`dagre`,look:`classic`,themeVariables:{radius:8},flowchart:{padding:22,nodeSpacing:60,rankSpacing:90},themeCSS:`.node rect, .node circle, .node ellipse, .node polygon, .node path { fill: var(--color-surface) !important; stroke: var(--color-border-strong) !important; stroke-width: 1.5px !important; } .cluster rect { fill: var(--color-surface-sunken) !important; stroke: var(--color-border-strong) !important; } .edgePath .path, .flowchart-link, .messageLine0, .messageLine1 { stroke: var(--color-text-muted) !important; stroke-width: 1.5px !important; } .marker, .arrowMarkerPath, marker path, #arrowhead path { fill: var(--color-text-muted) !important; stroke: var(--color-text-muted) !important; } .node.person rect, .node.person circle, .node.person ellipse, .node.person polygon, .node.person path { fill: var(--color-overdue-bg) !important; stroke: var(--color-overdue-text) !important; } .cluster.person rect { fill: var(--color-overdue-bg) !important; stroke: var(--color-overdue-text) !important; } .node.ours rect, .node.ours circle, .node.ours ellipse, .node.ours polygon, .node.ours path { fill: var(--color-accent-soft) !important; stroke: var(--color-accent) !important; } .cluster.ours rect { fill: var(--color-accent-soft) !important; stroke: var(--color-accent) !important; } .node.platform rect, .node.platform circle, .node.platform ellipse, .node.platform polygon, .node.platform path { fill: var(--color-current-bg) !important; stroke: var(--color-current-border) !important; } .cluster.platform rect { fill: var(--color-current-bg) !important; stroke: var(--color-current-border) !important; } .node.external rect, .node.external circle, .node.external ellipse, .node.external polygon, .node.external path { fill: var(--color-surface-sunken) !important; stroke: var(--color-border-strong) !important; } .cluster.external rect { fill: var(--color-surface-sunken) !important; stroke: var(--color-border-strong) !important; } .nodeLabel, .nodeLabel p, .label, .label text, .cluster-label, .cluster-label span, .edgeLabel span, .messageText, .loopText, .loopText tspan, .labelText, .noteText, .actor, text.actor > tspan { fill: var(--color-text) !important; color: var(--color-text) !important; } .labelBkg { background-color: var(--color-bg) !important; border-radius: 4px !important; } .edgeLabel p { background-color: var(--color-bg) !important; color: var(--color-text) !important; padding: 2px 6px !important; border-radius: 4px !important; } .edgeLabel rect { fill: var(--color-bg) !important; opacity: 1 !important; } rect.actor { fill: var(--color-surface) !important; stroke: var(--color-border-strong) !important; stroke-width: 1.5px !important; } .actor-line { stroke: var(--color-border-strong) !important; } .activation0, .activation1, .activation2 { fill: var(--color-accent-soft) !important; stroke: var(--color-accent) !important; } .note { fill: var(--color-current-bg) !important; stroke: var(--color-current-border) !important; } .loopLine { stroke: var(--color-border-strong) !important; } .labelBox { fill: var(--color-surface-raised) !important; stroke: var(--color-border-strong) !important; } rect.rect[fill='rgba(0,0,0,0.01)'] { fill: var(--color-overdue-bg) !important; stroke: var(--color-overdue-text) !important; stroke-width: 1px !important; } rect.rect[fill='rgba(0,0,0,0.02)'] { fill: var(--color-accent-soft) !important; stroke: var(--color-accent) !important; stroke-width: 1px !important; } rect.rect[fill='rgba(0,0,0,0.03)'] { fill: var(--color-current-bg) !important; stroke: var(--color-current-border) !important; stroke-width: 1px !important; } rect.rect[fill='rgba(0,0,0,0.04)'] { fill: var(--color-surface-sunken) !important; stroke: var(--color-border-strong) !important; stroke-width: 1px !important; } .sequenceNumber { fill: var(--color-on-accent) !important; } #sequencenumber { fill: var(--color-accent) !important; }`},C={light:`default`,dark:`dark`};async function w(){let e=document.querySelectorAll(`pre.mermaid`);if(e.length,e.length===0)return;let t=await x(),n=S.theme;{let e=document.documentElement.getAttribute(`data-theme`),t=document.body.getAttribute(`data-theme`);n=C[e||t]||S.theme}t.initialize({...S,theme:n,gitGraph:{mainBranchName:`main`,showCommitLabel:!0,showBranches:!0,rotateCommitLabel:!0}});for(let n of e){if(n.hasAttribute(`data-processed`))continue;n.hasAttribute(`data-diagram`)||n.setAttribute(`data-diagram`,n.textContent||``);let e=n.getAttribute(`data-diagram`)||``,r=`mermaid-`+Math.random().toString(36).slice(2,11);try{let i=document.getElementById(r);i&&i.remove();let{svg:a}=await t.render(r,e);n.innerHTML=a,n.setAttribute(`data-processed`,`true`)}catch(e){v(`Mermaid rendering error for diagram:`,r,e);let t=document.createElement(`div`);t.style.cssText=`color: red; padding: 1rem; border: 1px solid red; border-radius: 0.5rem;`;let i=document.createElement(`strong`);i.textContent=`Error rendering diagram:`;let a=document.createElement(`span`);a.textContent=` `+(e.message||`Unknown error`),t.appendChild(i),t.appendChild(a),n.textContent=``,n.appendChild(t),n.setAttribute(`data-processed`,`true`)}}}y()&&w();{let e=new MutationObserver(e=>{for(let t of e)t.type===`attributes`&&t.attributeName===`data-theme`&&(document.querySelectorAll(`pre.mermaid[data-processed]`).forEach(e=>{e.removeAttribute(`data-processed`)}),w())});e.observe(document.documentElement,{attributes:!0,attributeFilter:[`data-theme`]}),e.observe(document.body,{attributes:!0,attributeFilter:[`data-theme`]})}document.addEventListener(`astro:after-swap`,()=>{y()&&w()});var T=document.createElement(`style`);T.textContent=`
            /* Prevent layout shifts by setting minimum height */
            pre.mermaid {
              display: flex;
              justify-content: center;
              align-items: center;
              margin: 2rem 0;
              padding: 1rem;
              background-color: transparent;
              border: none;
              overflow: auto;
              min-height: 200px; /* Prevent layout shift */
              position: relative;
            }
            
            /* Loading state with skeleton loader */
            pre.mermaid:not([data-processed]) {
              background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
              background-size: 200% 100%;
              animation: shimmer 1.5s infinite;
            }
            
            /* Dark mode skeleton loader */
            [data-theme="dark"] pre.mermaid:not([data-processed]) {
              background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
              background-size: 200% 100%;
            }
            
            @keyframes shimmer {
              0% {
                background-position: -200% 0;
              }
              100% {
                background-position: 200% 0;
              }
            }
            
            /* Show processed diagrams with smooth transition */
            pre.mermaid[data-processed] {
              animation: none;
              background: transparent;
              min-height: auto; /* Allow natural height after render */
            }
            
            /* Ensure responsive sizing for mermaid SVGs */
            pre.mermaid svg {
              max-width: 100%;
              height: auto;
            }
            
            /* Optional: Add subtle background for better visibility */
            @media (prefers-color-scheme: dark) {
              pre.mermaid[data-processed] {
                background-color: rgba(255, 255, 255, 0.02);
                border-radius: 0.5rem;
              }
            }
            
            @media (prefers-color-scheme: light) {
              pre.mermaid[data-processed] {
                background-color: rgba(0, 0, 0, 0.02);
                border-radius: 0.5rem;
              }
            }
            
            /* Respect user's color scheme preference */
            [data-theme="dark"] pre.mermaid[data-processed] {
              background-color: rgba(255, 255, 255, 0.02);
              border-radius: 0.5rem;
            }
            
            [data-theme="light"] pre.mermaid[data-processed] {
              background-color: rgba(0, 0, 0, 0.02);
              border-radius: 0.5rem;
            }
          `,document.head.appendChild(T),s();