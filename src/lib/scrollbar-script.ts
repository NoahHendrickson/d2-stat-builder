/** Inline head script (ES5): marks `<html data-scrollbars="classic">` when the
    platform draws scrollbars that take up room (Windows, or macOS with a mouse
    set to always show them). globals.css then gives every scroller the thin,
    arrowless app scrollbar instead of the stock grey one. Overlay scrollbars
    (macOS trackpad, phones) measure 0 wide and are left alone. It runs once per
    page load: on a Mac set to show scroll bars "automatically", plugging in a
    mouse mid-session brings the stock bars back until the next reload. */
export const SCROLLBAR_SCRIPT =
  '(function(){try{var e=document.documentElement,p=document.createElement("div");p.style.cssText="position:absolute;top:-999px;width:100px;height:100px;overflow:scroll";e.appendChild(p);if(p.offsetWidth-p.clientWidth>0)e.dataset.scrollbars="classic";e.removeChild(p)}catch(x){}})()';
