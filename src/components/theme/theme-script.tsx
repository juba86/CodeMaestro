/**
 * Pre-paint theme script (server component). Runs in <head> before the first
 * paint so light-mode users never see a dark flash:
 * localStorage "cm-theme" → legacy zustand store "prompt-builder-settings"
 * (state.theme) → "dark". "system" follows prefers-color-scheme.
 */
const SCRIPT = `(function(){try{
var t=null;try{t=localStorage.getItem("cm-theme");}catch(e){}
if(t!=="dark"&&t!=="light"&&t!=="system"){t=null;try{var s=localStorage.getItem("prompt-builder-settings");if(s){var p=JSON.parse(s);t=p&&p.state&&p.state.theme;}}catch(e){}}
if(t!=="dark"&&t!=="light"&&t!=="system")t="dark";
var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark",d);
var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",d?"#0d0d0f":"#fbfcfd");
}catch(e){}})();`;

export function ThemeScript() {
  return <script id="cm-theme-script" dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
